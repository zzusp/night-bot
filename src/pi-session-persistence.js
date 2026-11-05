import {nativeStore} from './runtime/pi-native-store.js'
import {decodePiJournal,piJournalFilename} from './runtime/pi-journal.js'
import { restorePiReplay } from './pi-replay.js'
import { Service } from '@deepseek-ai/cordis'
import { SessionManager, buildSessionProjection, convertToLlm } from '@earendil-works/pi-coding-agent'
import { mkdir, readFile, writeFile, open, stat, readdir, truncate, rm, lstat, link, unlink } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  SessionPersistenceNotFoundError, SessionAlreadyExistsError, SessionAlreadyOwnedError, SessionReadOnlyError,
  SessionHandleClosedError, SessionOwnershipLostError, materializeCreateHeader, materializeAppendBatch, validateStoredEvents,
} from './native-persistence-protocol.js'

const owners = new Map()
const digest = value => createHash('sha256').update(value).digest('hex')
const zeroUsage = () => ({ input:0, output:0, cacheRead:0, cacheWrite:0, totalTokens:0, cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0} })
const parseArgs = raw => { try { return JSON.parse(raw || '{}') } catch { return raw } }
const hostMessage = event => !event ? null : event.type === 'user/message' ? event.data
  : ['system/message','developer/message','assistant/message','tool/result'].includes(event.type) ? event.data.message : null
const fail = code => Object.assign(new Error(code), { code })
const clean = value => structuredClone(value)

async function processIdentity(pid = process.pid) {
  if (process.platform !== 'linux') return null
  const boot = (await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()
  const value = await readFile(`/proc/${pid}/stat`,'utf8')
  return boot + ':' + value.slice(value.lastIndexOf(')')+2).split(' ')[19]
}
async function alive(owner) {
  try { process.kill(owner.pid,0) } catch(error) { if(error.code==='ESRCH')return false; return true }
  if (owner.processIdentity) try { return await processIdentity(owner.pid) === owner.processIdentity } catch { return true }
  return true
}
async function acquire(path,id) {
  if (owners.has(path)) throw new SessionAlreadyOwnedError(id)
  const lock=path+'.lock', token=randomUUID(), metadata={version:1,pid:process.pid,processIdentity:await processIdentity(),token}
  for(let attempt=0;attempt<3;attempt++) {
    try {
      await mkdir(lock,{mode:0o700})
      await writeFile(join(lock,'owner.json'),JSON.stringify(metadata),{flag:'wx',mode:0o600})
      owners.set(path,token)
      let releasing
      return {
        async check(){const observed=JSON.parse(await readFile(join(lock,'owner.json'),'utf8').catch(()=>'{"token":null}'));if(observed.token!==token)throw new SessionOwnershipLostError(id)},
        close(){return releasing??=(async()=>{
          const observed=JSON.parse(await readFile(join(lock,'owner.json'),'utf8').catch(()=>'{"token":null}'))
          if(observed.token!==token)throw new SessionOwnershipLostError(id)
          await rm(lock,{recursive:true});owners.delete(path)
        })()},
      }
    } catch(error) {
      if(error.code!=='EEXIST')throw error
      if((await lstat(lock)).isSymbolicLink())throw fail('PI_SESSION_PATH_UNSAFE')
      let owner
      try {owner=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'))}catch{throw fail('PI_SESSION_LOCK_UNCERTAIN')}
      if(owner.version!==1||!Number.isSafeInteger(owner.pid)||typeof owner.token!=='string')throw fail('PI_SESSION_LOCK_UNCERTAIN')
      if(await alive(owner))throw new SessionAlreadyOwnedError(id)
      const guard=lock+'.reap'
      try {await mkdir(guard)}catch{throw new SessionAlreadyOwnedError(id)}
      try {
        const current=JSON.parse(await readFile(join(lock,'owner.json'),'utf8'))
        if(current.token!==owner.token||await alive(current))throw new SessionAlreadyOwnedError(id)
        await rm(lock,{recursive:true})
      }finally{await rm(guard,{recursive:true,force:true})}
    }
  }
  throw new SessionAlreadyOwnedError(id)
}

/** Strict reader: Pi's permissive parser is never used to discard damaged history.
 * Only batches terminated by night.commit are authoritative. A write owner may
 * truncate an uncommitted physical tail; read handles never modify the file.
 */
async function load(path,id,codec,requireComplete=false) {
  const bytes=await readFile(path).catch(error=>{if(error.code==='ENOENT')throw new SessionPersistenceNotFoundError(id);throw error})
  const result=decodePiJournal(bytes,id,{codec,requireComplete})
  if(result.format!=='pi-native-v1')validateStoredEvents(result.header,result.events,{kind:'pi-jsonl',path})
  else convertToLlm(buildSessionProjection(result.entries,result.entries.at(-1)?.id??null).messages)
  return result
}
export async function validatePiArchiveSession(path,id){return load(path,id,undefined,true)}
async function piContent(content,ctx,signal) {
  const result=[]
  for(const block of content) {
    if(block.type==='text')result.push({type:'text',text:block.text})
    else if(block.type==='reasoning')result.push({type:'thinking',thinking:block.text})
    else if(block.type==='tool-call')result.push({type:'toolCall',id:block.id,name:block.name,arguments:parseArgs(block.arguments)})
    else if(block.type==='image') {
      const attachments=ctx.get('attachments');if(!attachments)throw fail('PI_SESSION_ATTACHMENT_PROVIDER_REQUIRED')
      const image=await attachments.readImage(block.attachment,signal)
      result.push({type:'image',data:Buffer.from(image.data).toString('base64'),mimeType:image.ref.mediaType})
    } else result.push({type:'text',text:JSON.stringify(block)})
  }
  return result
}
export async function projectPiMessage(message,ctx,signal) {
  const content=await piContent(message.content,ctx,signal), timestamp=Date.now()
  if(message.role==='assistant')return restorePiReplay({role:'assistant',content,provider:message.source.provider,model:message.source.model,api:'host',usage:zeroUsage(),stopReason:content.some(b=>b.type==='toolCall')?'toolUse':'stop',timestamp},message.source)
  if(message.role==='tool')return {role:'toolResult',content,toolCallId:message.toolCallId,toolName:'host',isError:message.isError===true,timestamp}
  return {role:'user',content,timestamp}
}
/** A read-only Pi projection of one already-validated committed snapshot.
 * Never re-open a physical tail with Pi's permissive parser. */
function projectedContext(projection){return {projection,piMessages:projection.messages}}

function committedContext(data){
  const projection=clean(buildSessionProjection(data.entries??[],data.entries?.at(-1)?.id??null))
  return {engine:'pi-session-manager',...data.format==='pi-native-v1'?{format:data.format,nativeEntryCount:data.entries.length,auditCount:data.audit.length}:{eventCount:data.events.length},...projectedContext(projection)}
}

function projection(events) {
  const nodes=[],anchors=new Map()
  for(const event of events) {
    if(!event.surfaceOp)continue
    if(event.surfaceOp==='append'){nodes.push(event);anchors.set(event.seq,event.seq);continue}
    const start=anchors.get(event.surfaceOp.startSeq),end=anchors.get(event.surfaceOp.endSeq)
    const a=nodes.findIndex(e=>e.seq===start),b=nodes.findIndex(e=>e.seq===end)
    if(a<0||b<a)throw fail('PI_SESSION_REPLACEMENT_INVALID')
    const removed=new Set(nodes.slice(a,b+1).map(e=>e.seq))
    for(const [key,value] of anchors)if(removed.has(value))anchors.set(key,event.seq)
    nodes.splice(a,b-a+1,event);anchors.set(event.seq,event.seq)
  }
  return nodes
}

export default class PiSessionPersistence extends Service {
  static inject=['piAuthority']
  identity=Symbol('native-pi-session-persistence')
  constructor(ctx,config) {
    super(ctx,'sessionPersistence');this.taskRoutes=ctx.get('taskSessionRoutes');this.config={...config,root:resolve(config.root)};this.closed=false;this.handles=new Set();this.writers=new Map()
    ctx.on('session/event',(session,event)=>{
      const handle=this.writers.get(session.id)
      if(handle)handle.enqueue(event)
    })
    ctx.on('session/flush',session=>this.writers.get(session.id)?.flush())
    ctx.on('session/disposed',session=>this.writers.get(session.id)?.close().catch(error=>ctx.logger.warn(error.message)))
    ctx.effect(()=>async()=>{this.closed=true;const results=await Promise.allSettled([...this.handles].map(h=>h.close()));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Pi persistence close failed')})
  }
  async checkedRoot(create=false,root=this.config.root) {
    const paths=[];let cursor=root
    while(dirname(cursor)!==cursor){paths.unshift(cursor);cursor=dirname(cursor)}
    for(const path of paths){
      let info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error})
      if(!info){if(!create)return false;await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error});info=await lstat(path)}
      if(!info.isDirectory()||info.isSymbolicLink())throw fail('PI_SESSION_PATH_UNSAFE')
    }
    return true
  }
  async checkedFile(id,allowMissing=false) {
    if(!await this.checkedRoot(false,dirname(this.path(id)))){if(allowMissing)return;throw new SessionPersistenceNotFoundError(id)}
    const path=this.path(id),info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error})
    if(!info){if(allowMissing)return;throw new SessionPersistenceNotFoundError(id)}
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw fail('PI_SESSION_PATH_UNSAFE')
  }
  path(id){const filename=piJournalFilename(id);return this.taskRoutes?.get(id)??join(this.config.root,filename)}
  async createNative(header,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    header=materializeCreateHeader(header)
    await this.checkedRoot(true,dirname(this.path(header.id)));await this.checkedFile(header.id,true)
    const path=this.path(header.id),lease=await acquire(path,header.id)
    try {
      try{await stat(path);throw new SessionAlreadyExistsError(header.id)}catch(error){if(error.code!=='ENOENT')throw error}
      options.signal?.throwIfAborted()
      const manager=SessionManager.inMemory(header.cwd);manager.newSession({id:header.id})
      manager.appendCustomEntry('night.header',{header:this.ctx.get('portablePaths')?.header(header)??header,storage:{engine:'pi-native',version:1}})
      return nativeStore({backend:this,path,header,manager,lease,options})
    }catch(error){await lease.close();throw error}
  }
  async readNative(id,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    await this.checkedFile(id)
    const data=await load(this.path(id),id,this.ctx.get('portablePaths'),options.requireComplete===true)
    if(data.format!=='pi-native-v1')throw fail('PI_SESSION_NATIVE_UPGRADE_REQUIRED')
    options.signal?.throwIfAborted()
    return clean({format:data.format,header:data.header,audit:data.audit,context:committedContext(data)})
  }
  async openNative(id,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    await this.checkedFile(id)
    const path=this.path(id),lease=await acquire(path,id)
    try {
      const data=await load(path,id,this.ctx.get('portablePaths'),true)
      if(data.format!=='pi-native-v1')throw fail('PI_SESSION_NATIVE_UPGRADE_REQUIRED')
      options.signal?.throwIfAborted()
      const manager=SessionManager.inMemory(data.header.cwd,undefined,[data.piHeader,...data.entries])
      return nativeStore({backend:this,path,header:data.header,manager,lease,data,options})
    }catch(error){await lease.close();throw error}
  }
  async create(header,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');header=materializeCreateHeader(header)
    await this.checkedRoot(true,dirname(this.path(header.id)))
    await this.checkedFile(header.id,true)
    const path=this.path(header.id),lease=await acquire(path,header.id)
    try {
      try{await stat(path);throw new SessionAlreadyExistsError(header.id)}catch(e){if(e.code!=='ENOENT')throw e}
      const manager=SessionManager.inMemory(header.cwd);manager.newSession({id:header.id})
      manager.appendCustomEntry('night.header',{header:this.ctx.get('portablePaths')?.header(header)??header,inheritedEventCount:options.inheritedEventCount??0})
      const handle=await this.makeHandle({path,header,inheritedEventCount:options.inheritedEventCount??0,manager,events:[],lease,storedEntries:0,newFile:true})
      return handle
    }catch(error){await lease.close();throw error}
  }
  async open(id,access,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedRoot(true,dirname(this.path(id)))
    await this.checkedFile(id,true)
    const live=this.writers.get(id)
    if(access==='read'&&live&&live.kind!=='pi-native')return live.reader()
    const path=this.path(id),lease=access==='write'?await acquire(path,id):undefined
    try {
      const data=await load(path,id,this.ctx.get('portablePaths'))
      if(data.format==='pi-native-v1')throw fail('PI_SESSION_NATIVE_AUDIT_API_REQUIRED')
      let manager
      if(access==='write') {
        if(data.totalBytes!==data.committedBytes)await truncate(path,data.committedBytes)
        manager=SessionManager.inMemory(data.header.cwd);manager.setSessionFile(path)
      }
      return await this.makeHandle({...data,path,access,lease,manager,storedEntries:data.entries.length,newFile:false})
    }catch(error){const errors=[error];for(const close of [()=>lease?.close()])try{await close()}catch(cleanup){errors.push(cleanup)};if(errors.length>1)throw new AggregateError(errors,'Pi session open failed',{cause:error});throw error}
  }
  async makeHandle({path,header,inheritedEventCount,manager,events,entries,lease,access='write',storedEntries,newFile}) {
    const backend=this,id=header.id,pending=[]
    let chain=Promise.resolve(),closed=false,closing,poisoned,unregister
    const assertOpen=operation=>{if(closed)throw new SessionHandleClosedError(id,operation);if(poisoned)throw poisoned}
    const initialMetadata=manager?.getEntries().find(e=>e.type==='custom'&&e.customType==='night.header')?.data
    const mutation=job=>{
      if(closing||backend.closed)return Promise.reject(new SessionHandleClosedError(id,'write'))
      const result=chain.then(job).catch(error=>{
        if(!poisoned) {
          try {
            manager=SessionManager.inMemory(header.cwd)
            if(newFile){manager.newSession({id});manager.appendCustomEntry('night.header',initialMetadata)}
            else manager.setSessionFile(path)
          }catch(rollback){poisoned=new AggregateError([error,rollback],'Pi journal rollback failed',{cause:error});throw poisoned}
        }
        throw error
      })
      chain=result.catch(()=>{});return result
    }
    async function appendNative(event,copy=false) {
      const message=hostMessage(event)
      if(!message||!message.content.length){if(!copy){if(event.type==='request/header'){const config=event.data.header.config;manager.appendModelChange(config.provider,config.model);if(config.reasoningEffort)manager.appendThinkingLevelChange(config.reasoningEffort)}manager.appendCustomEntry('night.event',{event})}return}
      if(message.role==='system'||message.role==='developer')manager.appendCustomMessageEntry('night.'+message.role,await piContent(message.content,backend.ctx),false,{event,copy,contentHash:digest(JSON.stringify(await piContent(message.content,backend.ctx)))})
      else {const projected=await projectPiMessage(message,backend.ctx);if(projected.role==='toolResult'){const call=manager.getEntries().findLast(e=>e.type==='message'&&e.message.role==='assistant'&&e.message.content.some(b=>b.type==='toolCall'&&b.id===projected.toolCallId))?.message.content.find(b=>b.type==='toolCall'&&b.id===projected.toolCallId);if(call)projected.toolName=call.name}if(event.data.usage){const u=event.data.usage;projected.usage={...zeroUsage(),input:u.inputTokens,output:u.outputTokens,cacheRead:u.cacheReadTokens??0,cacheWrite:u.cacheWriteTokens??0,totalTokens:u.totalTokens??u.inputTokens+u.outputTokens}}projected.night={event,copy,contentHash:digest(JSON.stringify(projected.content))};manager.appendMessage(projected)}
    }
    async function commit(batch=[]) {
      assertOpen('append');if(backend.path(id)!==path)throw fail('PI_SESSION_ROUTE_CHANGED');await backend.checkedFile(id,newFile);await lease.check();if(!batch.length&&!newFile)return
      const copied=materializeAppendBatch(batch)
      if(copied.some((e,i)=>e.seq!==events.length+i))throw fail('PI_SESSION_EVENT_SEQUENCE_INVALID')
      const combined=[...events,...copied]
      validateStoredEvents(header,clean(combined),{kind:'pi-jsonl',path})
      for(const rawEvent of copied) {
        const event=backend.ctx.get('portablePaths')?.event(rawEvent)??rawEvent
        if(event.surfaceOp&&event.surfaceOp!=='append') {
          manager.appendCustomEntry('night.event',{event})
          manager.resetLeaf()
          for(const visible of projection(combined.filter(e=>e.seq<=event.seq)))await appendNative(visible,true)
        }else await appendNative(event)
      }
      const preceding=manager.getEntries().slice(storedEntries)
      manager.appendCustomEntry('night.commit',{eventCount:combined.length,previousCommit:entries?.at(-1)?.id??null,entriesHash:digest((newFile?JSON.stringify(manager.getHeader())+'\n':'')+preceding.map(e=>JSON.stringify(e)).join('\n'))})
      const all=manager.getEntries(),suffix=all.slice(storedEntries)
      const bytes=(newFile?JSON.stringify(manager.getHeader())+'\n':'')+suffix.map(e=>JSON.stringify(e)).join('\n')+'\n'
      let file,writeFailure;const temporary=newFile?join(dirname(path),'.pending-pi-'+randomUUID()):undefined
      try {
        file=await open(temporary??path,newFile?'wx':'a',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined
        if(temporary){await link(temporary,path);await unlink(temporary)}
        if(newFile&&process.platform!=='win32'){const directory=await open(dirname(path),'r');try{await directory.sync()}finally{await directory.close()}}
        await lease.check()
      }catch(error){writeFailure=error}
      finally{
        const errors=writeFailure?[writeFailure]:[]
        try{await file?.close()}catch(error){errors.push(error)}
        if(temporary)try{await unlink(temporary)}catch(error){if(error.code!=='ENOENT')errors.push(error)}
        if(errors.length){poisoned=Object.assign(new Error('PI_SESSION_COMMIT_UNCERTAIN',{cause:errors.length===1?errors[0]:new AggregateError(errors,'Pi write and cleanup failed')}),{code:'PI_SESSION_COMMIT_UNCERTAIN'});throw poisoned}
      }
      events=combined;entries=all;storedEntries=all.length;newFile=false
    }
    const handle={id,header,inheritedEventCount,access,
      reader(){
        let ended=false
        const reader={id,header,inheritedEventCount,access:'read',
          async read(offset=0,length,options={}) {
            options.signal?.throwIfAborted()
            if(ended||backend.closed)throw new SessionHandleClosedError(id,'read')
            await chain
            const codec=backend.ctx.get('portablePaths'),data=newFile?{events,entries:entries??[]}:await load(path,id,codec)
            return{eventState:'detached',events:clean(data.events.slice(offset,length===undefined?undefined:offset+length)),...options.includeContext?{context:committedContext(data)}:{}}
          },
          async append(){throw new SessionReadOnlyError(id,'append')},
          async flush(){throw new SessionReadOnlyError(id,'flush')},
          async close(){ended=true;backend.handles.delete(reader)},
          [Symbol.asyncDispose](){return this.close()},
        }
        backend.handles.add(reader);return reader
      },
      snapshot(){assertOpen('stat');return{header:clean(header),eventCount:events.length,revision:digest(JSON.stringify(entries?.at(-1)??header)),formatStatus:'current'}},
      enqueue(event){if(closing||closed||backend.closed){poisoned=fail('PI_SESSION_LATE_EVENT');throw poisoned}pending.push(event)},
      append(batch,options={}){options.signal?.throwIfAborted();if(access!=='write')return Promise.reject(new SessionReadOnlyError(id,'append'));return mutation(()=>commit(batch))},
      async read(offset=0,length,options={}){options.signal?.throwIfAborted();assertOpen('read');const codec=backend.ctx.get('portablePaths');let data;if(access==='write'){await chain;assertOpen('read');data={events,entries:entries??[]}}else data=await load(path,id,codec);options.signal?.throwIfAborted();return{eventState:'detached',events:clean(data.events.slice(offset,length===undefined?undefined:offset+length)),...options.includeContext?{context:committedContext(data)}:{}}},
      flush(options={}){options.signal?.throwIfAborted();if(access!=='write')return Promise.reject(new SessionReadOnlyError(id,'flush'));return mutation(async()=>{const batch=pending.splice(0);try{await commit(batch)}catch(error){pending.unshift(...batch);throw error}})},
      close(){
        return closing??=(async()=>{
          const errors=[]
          try{
            await chain
            if(poisoned)throw poisoned
            if(access==='write'){
              const batch=pending.splice(0)
              if(!newFile||batch.length||events.length)await commit(batch)
            }
            if(poisoned)throw poisoned
          }catch(error){errors.push(error)}
          closed=true;backend.handles.delete(handle)
          if(access==='write'&&backend.writers.get(id)===handle){backend.writers.delete(id);unregister?.()}
          for(const release of [()=>lease?.close()])try{await release()}catch(error){errors.push(error)}
          if(errors.length)throw new AggregateError(errors,'Pi session close failed',{cause:errors[0]})
        })()
      },
      [Symbol.asyncDispose](){return handle.close()},
    }
    if(access==='write') {
      unregister=this.ctx.get('piAuthority').register(id,{
        context(options){assertOpen('context');return projectedContext(clean(manager.buildSessionProjection()))},
        describe(){return{engine:'pi-session-manager',path,sessionId:manager.getSessionId(),leafId:manager.getLeafId(),events:events.length}},
      })
      this.writers.set(id,handle)
    }
    this.handles.add(handle);return handle
  }
  async stat(id,options={}){options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedFile(id,true);if(this.writers.has(id))return this.writers.get(id).snapshot();try{const data=await load(this.path(id),id,this.ctx.get('portablePaths'));return{header:clean(data.header),...data.format==='pi-native-v1'?{format:data.format,nativeEntryCount:data.entries.length,auditCount:data.audit.length}:{eventCount:data.events.length},revision:digest(JSON.stringify(data.entries.at(-1))),sizeBytes:data.committedBytes,formatStatus:'current'}}catch(error){if(error.name==='SessionPersistenceNotFoundError')return undefined;throw error}}
  async list(options={}){options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedRoot(true);const result=[];for(const name of await readdir(this.config.root)){if(!name.endsWith('.pi.jsonl'))continue;const path=join(this.config.root,name);const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw fail('PI_SESSION_PATH_UNSAFE');const bytes=await readFile(path,'utf8');const header=JSON.parse(bytes.split('\n')[0]);if(this.path(header.id)!==path)throw fail('PI_SESSION_FILENAME_MISMATCH');const item=await this.stat(header.id,options);if(item)result.push(item)}for(const id of this.taskRoutes?.keys()??[]){const item=await this.stat(id,options);if(item)result.push(item)}const ids=new Set(result.map(item=>item.header.id));for(const writer of this.writers.values())if(!ids.has(writer.id)){result.push(writer.snapshot());ids.add(writer.id)}return result}
  async flush(){if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');const results=await Promise.allSettled([...this.writers.values()].map(handle=>handle.flush()));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Pi persistence flush failed')}
}
