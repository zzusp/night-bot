import { restorePiReplay } from './pi-replay.js'
import LegacyJsonlPersistence from './legacy-v4/dsh-session-persistence-jsonl/lib/index.js'
import { Service, Context } from '@deepseek-ai/cordis'
import { SessionManager } from '@earendil-works/pi-coding-agent'
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
const logicalEvent = entry => entry.type === 'custom' && entry.customType === 'night.event' ? entry.data.event
  : entry.type === 'message' && !entry.message.night?.copy ? entry.message.night?.event
  : entry.type === 'custom_message' && !entry.details?.copy ? entry.details?.event : undefined
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
async function load(path,id,codec) {
  const bytes=await readFile(path).catch(error=>{if(error.code==='ENOENT')throw new SessionPersistenceNotFoundError(id);throw error})
  let offset=0, committedBytes=0, entries=[], committed=[], header,previousCommit=null,batch=[];const seen=new Set()
  for(const raw of bytes.toString('utf8').split(/(?<=\n)/)) {
    if(!raw.endsWith('\n'))break
    let entry;try{entry=JSON.parse(raw)}catch{throw fail('PI_SESSION_JOURNAL_CORRUPT')}
    offset+=Buffer.byteLength(raw)
    if(!header) {
      if(entry.type!=='session'||entry.version!==3||entry.id!==id)throw fail('PI_SESSION_FORMAT_UNSUPPORTED')
      header=entry;continue
    }
    if(typeof entry.id!=='string'||seen.has(entry.id)||entry.parentId!==null&&!seen.has(entry.parentId))throw fail('PI_SESSION_TREE_CORRUPT')
    entries.push(entry);seen.add(entry.id)
    if(entry.type==='custom'&&entry.customType==='night.commit'){
      const hash=digest((previousCommit===null?JSON.stringify(header)+'\n':'')+batch.map(e=>JSON.stringify(e)).join('\n'))
      if(entry.data.previousCommit!==previousCommit||entry.data.entriesHash!==hash)throw fail('PI_SESSION_CHECKSUM_MISMATCH')
      committed=entries.slice();committedBytes=offset;previousCommit=entry.id;batch=[]
    }else batch.push(entry)
  }
  if(!header||!committed.length)throw fail('PI_SESSION_COMMIT_REQUIRED')
  const metadata=committed.find(e=>e.type==='custom'&&e.customType==='night.header')?.data
  if(!metadata||metadata.header.id!==id)throw fail('PI_SESSION_IDENTITY_MISMATCH')
  const events=committed.map(logicalEvent).filter(Boolean).map(event=>codec?.readEvent(event)??event)
  const logicalHeader=codec?.readHeader(metadata.header)??metadata.header
  if(events.some((e,i)=>e.seq!==i)||committed.at(-1).data.eventCount!==events.length)throw fail('PI_SESSION_EVENT_SEQUENCE_INVALID')
  validateStoredEvents(logicalHeader,events,{kind:'pi-jsonl',path})
  return {header:logicalHeader,inheritedEventCount:metadata.inheritedEventCount,importedFrom:metadata.importedFrom,legacyEventHash:metadata.legacyEventHash,events,entries:committed,piHeader:header,committedBytes,totalBytes:bytes.length}
}
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
function nativeHostMessage(message) {
  const metadata=message.role==='custom'?message.details:message.night
  const original=hostMessage(metadata?.event)
  if(!original)throw fail('PI_SESSION_CONTEXT_PROVENANCE_REQUIRED')
  const native=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content
  const content=native.map((block,index)=>{
    if(block.type==='text') {
      if(['file','tool-addition','tool-removal'].includes(original.content[index]?.type)) {
        try {const decoded=JSON.parse(block.text);if(decoded.type===original.content[index].type)return decoded}catch{}
      }
      return {type:'text',text:block.text}
    }
    if(block.type==='thinking')return {type:'reasoning',text:block.thinking}
    if(block.type==='toolCall')return {type:'tool-call',id:block.id,name:block.name,arguments:typeof block.arguments==='string'?block.arguments:JSON.stringify(block.arguments)}
    if(block.type==='image') {
      if(metadata.contentHash!==digest(JSON.stringify(native))||original.content[index]?.type!=='image')throw fail('PI_INLINE_IMAGE_REQUIRES_NATIVE_PROVIDER')
      return original.content[index]
    }
    throw fail('PI_SESSION_CONTEXT_BLOCK_UNSUPPORTED')
  })
  const source=clean(original.source)
  if(metadata.contentHash!==digest(JSON.stringify(native)))delete source.replayState
  return {...clean(original),content,source}
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
    super(ctx,'sessionPersistence');this.config={...config,root:resolve(config.root)};this.legacyContext=undefined;this.closed=false;this.handles=new Set();this.writers=new Map()
    ctx.on('session/event',(session,event)=>{
      const handle=this.writers.get(session.id)
      if(handle)handle.enqueue(event)
    })
    ctx.on('session/flush',session=>this.writers.get(session.id)?.flush())
    ctx.on('session/disposed',session=>this.writers.get(session.id)?.close().catch(error=>ctx.logger.warn(error.message)))
    ctx.effect(()=>async()=>{this.closed=true;const results=await Promise.allSettled([...this.handles].map(h=>h.close()));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);await this.legacyLoading?.catch(()=>{});if(this.legacyContext)await this.legacyContext.fiber.dispose();if(errors.length)throw new AggregateError(errors,'Pi persistence close failed')})
  }
  async checkedRoot(create=false) {
    const paths=[];let cursor=this.config.root
    while(dirname(cursor)!==cursor){paths.unshift(cursor);cursor=dirname(cursor)}
    for(const path of paths){
      let info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error})
      if(!info){if(!create)return false;await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error});info=await lstat(path)}
      if(!info.isDirectory()||info.isSymbolicLink())throw fail('PI_SESSION_PATH_UNSAFE')
    }
    return true
  }
  async checkedFile(id,allowMissing=false) {
    if(!await this.checkedRoot(false)){if(allowMissing)return;throw new SessionPersistenceNotFoundError(id)}
    const path=this.path(id),info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error})
    if(!info){if(allowMissing)return;throw new SessionPersistenceNotFoundError(id)}
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw fail('PI_SESSION_PATH_UNSAFE')
  }
  async legacy() {
    if(!await this.checkedRoot(false))return undefined
    if(this.legacyLoading)return this.legacyLoading
    if(this.legacyContext)return this.legacyContext.get('sessionPersistence')
    const entries=await readdir(this.config.root,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})
    if(!entries.some(entry=>entry.isDirectory()&&!entry.name.endsWith('.lock')&&!entry.name.endsWith('.reap')))return undefined
    return this.legacyLoading=(async()=>{const context=new Context();try{await context.plugin(LegacyJsonlPersistence,{root:this.config.root,compression:this.config.compression??'none'});this.legacyContext=context;return context.get('sessionPersistence')}catch(error){await context.fiber.dispose();throw error}})().finally(()=>{this.legacyLoading=undefined})
  }
  async importedHandle(id,access,lease,options) {
    const legacy=await this.legacy(),snapshot=await legacy?.stat(id,options)
    if(!snapshot)throw new SessionPersistenceNotFoundError(id)
    if(access==='read')return legacy.open(id,'read',options)
    const fence=await legacy.open(id,'write',options)
    let handle
    try {
      const {events}=await fence.read(),header=fence.header
      const manager=SessionManager.inMemory(header.cwd);manager.newSession({id:header.id})
      manager.appendCustomEntry('night.header',{header,inheritedEventCount:fence.inheritedEventCount,importedFrom:'dsh-jsonl',legacyRevision:snapshot.revision,legacyEventHash:digest(JSON.stringify({header,events}))})
      handle=await this.makeHandle({path:this.path(id),header,inheritedEventCount:fence.inheritedEventCount,manager,events:[],lease,legacyFence:fence,storedEntries:0,newFile:true})
      await handle.append(events);await handle.flush();return handle
    }catch(error){try{await(handle?handle.close():fence.close())}catch(cleanup){throw new AggregateError([error,cleanup],'Pi legacy import failed',{cause:error})}throw error}
  }
  path(id){if(typeof id!=='string'||!id)throw fail('PI_SESSION_ID_INVALID');return join(this.config.root,digest(id)+'.pi.jsonl')}
  async create(header,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');header=materializeCreateHeader(header)
    await this.checkedRoot(true)
    await this.checkedFile(header.id,true)
    const path=this.path(header.id),lease=await acquire(path,header.id)
    try {
      try{await stat(path);throw new SessionAlreadyExistsError(header.id)}catch(e){if(e.code!=='ENOENT')throw e}
      if(await(await this.legacy())?.stat(header.id,options))throw new SessionAlreadyExistsError(header.id)
      const manager=SessionManager.inMemory(header.cwd);manager.newSession({id:header.id})
      manager.appendCustomEntry('night.header',{header:this.ctx.get('portablePaths')?.header(header)??header,inheritedEventCount:options.inheritedEventCount??0})
      const handle=await this.makeHandle({path,header,inheritedEventCount:options.inheritedEventCount??0,manager,events:[],lease,storedEntries:0,newFile:true})
      return handle
    }catch(error){await lease.close();throw error}
  }
  async open(id,access,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedRoot(true)
    await this.checkedFile(id,true)
    const live=this.writers.get(id)
    if(access==='read'&&live)return live.reader()
    const path=this.path(id),lease=access==='write'?await acquire(path,id):undefined
    let legacyFence
    try {
      let data
      try{data=await load(path,id,this.ctx.get('portablePaths'))}catch(error){if(error.name==='SessionPersistenceNotFoundError')return await this.importedHandle(id,access,lease,options);throw error}
      const legacyBackend=access==='write'&&data.importedFrom?await this.legacy():undefined
      legacyFence=legacyBackend&&await legacyBackend.stat(id,options)?await legacyBackend.open(id,'write',options):undefined
      if(data.importedFrom){
        if(!legacyFence)throw fail('PI_LEGACY_SOURCE_MISSING')
        const original=await legacyFence.read()
        if(!data.legacyEventHash||digest(JSON.stringify({header:legacyFence.header,events:original.events}))!==data.legacyEventHash)throw fail('PI_LEGACY_SOURCE_DIVERGED')
      }
      let manager
      if(access==='write') {
        if(data.totalBytes!==data.committedBytes)await truncate(path,data.committedBytes)
        manager=SessionManager.inMemory(data.header.cwd);manager.setSessionFile(path)
      }
      return await this.makeHandle({...data,path,access,lease,legacyFence,manager,storedEntries:data.entries.length,newFile:false})
    }catch(error){const errors=[error];for(const close of [()=>legacyFence?.close(),()=>lease?.close()])try{await close()}catch(cleanup){errors.push(cleanup)};if(errors.length>1)throw new AggregateError(errors,'Pi session open failed',{cause:error});throw error}
  }
  async makeHandle({path,header,inheritedEventCount,manager,events,entries,lease,legacyFence,access='write',storedEntries,newFile}) {
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
      assertOpen('append');await backend.checkedFile(id,newFile);await lease.check();if(!batch.length&&!newFile)return
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
      let file,writeFailure;const temporary=newFile?join(backend.config.root,'.pending-pi-'+randomUUID()):undefined
      try {
        file=await open(temporary??path,newFile?'wx':'a',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined
        if(temporary){await link(temporary,path);await unlink(temporary)}
        if(newFile&&process.platform!=='win32'){const directory=await open(backend.config.root,'r');try{await directory.sync()}finally{await directory.close()}}
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
            const current=newFile?events:(await load(path,id,backend.ctx.get('portablePaths'))).events
            return{eventState:'detached',events:clean(current.slice(offset,length===undefined?undefined:offset+length))}
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
      async read(offset=0,length,options={}){options.signal?.throwIfAborted();assertOpen('read');if(access==='write'){await chain;assertOpen('read');return{eventState:'detached',events:clean(events.slice(offset,length===undefined?undefined:offset+length))}}const data=await load(path,id,backend.ctx.get('portablePaths'));return{eventState:'detached',events:clean(data.events.slice(offset,length===undefined?undefined:offset+length))}},
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
          for(const release of [()=>legacyFence?.close(),()=>lease?.close()])try{await release()}catch(error){errors.push(error)}
          if(errors.length)throw new AggregateError(errors,'Pi session close failed',{cause:errors[0]})
        })()
      },
      [Symbol.asyncDispose](){return handle.close()},
    }
    if(access==='write') {
      unregister=this.ctx.get('piAuthority').register(id,{
        context(){assertOpen('context');const messages=structuredClone(manager.buildSessionContext().messages);return{piMessages:messages,hostMessages:messages.map(nativeHostMessage).filter(message=>message&&message.content.length)}},
        describe(){return{engine:'pi-session-manager',path,sessionId:manager.getSessionId(),leafId:manager.getLeafId(),events:events.length}},
      })
      this.writers.set(id,handle)
    }
    this.handles.add(handle);return handle
  }
  async stat(id,options={}){options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedFile(id,true);if(this.writers.has(id))return this.writers.get(id).snapshot();try{const data=await load(this.path(id),id,this.ctx.get('portablePaths'));return{header:clean(data.header),eventCount:data.events.length,revision:digest(JSON.stringify(data.entries.at(-1))),sizeBytes:data.committedBytes,formatStatus:'current'}}catch(error){if(error.name==='SessionPersistenceNotFoundError')return (await this.legacy())?.stat(id,options);throw error}}
  async list(options={}){options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedRoot(true);const result=[];for(const name of await readdir(this.config.root)){if(!name.endsWith('.pi.jsonl'))continue;const path=join(this.config.root,name);const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw fail('PI_SESSION_PATH_UNSAFE');const bytes=await readFile(path,'utf8');const header=JSON.parse(bytes.split('\n')[0]);if(this.path(header.id)!==path)throw fail('PI_SESSION_FILENAME_MISMATCH');const item=await this.stat(header.id,options);if(item)result.push(item)}const ids=new Set(result.map(item=>item.header.id));for(const writer of this.writers.values())if(!ids.has(writer.id)){result.push(writer.snapshot());ids.add(writer.id)}for(const item of await(await this.legacy())?.list(options)??[])if(!ids.has(item.header.id))result.push(item);return result}
  async flush(){if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');const results=await Promise.allSettled([...this.writers.values()].map(handle=>handle.flush()));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Pi persistence flush failed')}
}
