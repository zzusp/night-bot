import {readPiLiveOutput} from './runtime/pi-live-output.js'
import {nativeStore} from './runtime/pi-native-store.js'
import {decodePiJournal,piJournalFilename} from './runtime/pi-journal.js'
import { Service } from '@deepseek-ai/cordis'
import { SessionManager, buildSessionProjection, convertToLlm } from '@earendil-works/pi-coding-agent'
import { mkdir, readFile, writeFile, open, stat, readdir, rm, lstat, link, unlink } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  SessionPersistenceNotFoundError, SessionAlreadyExistsError, SessionAlreadyOwnedError,
  SessionOwnershipLostError, materializeCreateHeader,
} from './native-persistence-protocol.js'

const owners = new Map()
const READ_CACHE_BYTES = 32 * 1024 * 1024
const digest = value => createHash('sha256').update(value).digest('hex')
const fail = code => Object.assign(new Error(code), { code })
const clean = value => structuredClone(value)
const fileStamp = info => JSON.stringify([info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs])

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
 * Only native commit-v2 batches are authoritative. Strict opens reject every
 * uncommitted physical tail; no read or writer silently truncates evidence.
 */
async function load(path,id,codec,requireComplete=false) {
  const before=await lstat(path).catch(error=>{if(error.code==='ENOENT')throw new SessionPersistenceNotFoundError(id);throw error})
  const bytes=await readFile(path).catch(error=>{if(error.code==='ENOENT')throw new SessionPersistenceNotFoundError(id);throw error})
  const after=await lstat(path)
  if(fileStamp(before)!==fileStamp(after)||before.isSymbolicLink()||!before.isFile()||before.nlink!==1)throw fail('PI_SESSION_CHANGED')
  return {...decode(bytes,id,codec,requireComplete),journalDigest:fileStamp(after)+':'+digest(bytes)}
}
function decode(bytes,id,codec,requireComplete=false){
  const result=decodePiJournal(bytes,id,{codec,requireComplete})
  convertToLlm(buildSessionProjection(result.entries,result.entries.at(-1)?.id??null).messages)
  return result
}
function sessionStat(data){
  return {header:clean(data.header),format:data.format,nativeEntryCount:data.entries.length,auditCount:data.audit.length,revision:digest(JSON.stringify(data.entries.at(-1))),sizeBytes:data.committedBytes,formatStatus:'current'}
}
export async function validatePiArchiveSession(path,id){return load(path,id,undefined,true)}
/** A read-only Pi projection of one already-validated committed snapshot.
 * Never re-open a physical tail with Pi's permissive parser. */
function projectedContext(projection){return {projection,piMessages:projection.messages}}

function committedContext(data){
  const projection=clean(buildSessionProjection(data.entries??[],data.entries?.at(-1)?.id??null))
  return {engine:'pi-session-manager',format:data.format,nativeEntryCount:data.entries.length,auditCount:data.audit.length,...projectedContext(projection)}
}

export default class PiSessionPersistence extends Service {
  static inject=['piAuthority']
  identity=Symbol('native-pi-session-persistence')
  constructor(ctx,config) {
    super(ctx,'sessionPersistence');this.taskRoutes=ctx.get('taskSessionRoutes');this.config={...config,root:resolve(config.root)};this.closed=false;this.handles=new Set();this.writers=new Map();this.readCache=new Map();this.readCacheBytes=0
    ctx.effect(()=>async()=>{this.closed=true;this.readCache.clear();this.readCacheBytes=0;const results=await Promise.allSettled([...this.handles].map(h=>h.close()));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Pi persistence close failed')})
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
  readLive(id) {
    if(this.closed)return null
    const actor=this.ctx.get('agents')?.get(id)
    if(!actor||actor.id!==id||actor.metadata?.id!==id||actor.piSession?.sessionId!==id||actor.lifecycle?.isLive()!==true)return null
    return readPiLiveOutput(actor)
  }
  digestReads = new Map()
  async readNativeDigest(id) {
    if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    // Deduplicate only concurrent reads, never reuse a completed disk check.
    if(this.digestReads.has(id))return this.digestReads.get(id)
    const reading=(async()=>{
      await this.checkedFile(id)
      const path=this.path(id),before=await lstat(path),file=await open(path,'r')
      const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs
      try {
        const opened=await file.stat()
        if(!same(before,opened)||!opened.isFile()||opened.nlink!==1)throw fail('PI_SESSION_CHANGED')
        const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536)
        let position=0
        while(position<opened.size){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,opened.size-position),position);if(!bytesRead)throw fail('PI_SESSION_CHANGED');hash.update(buffer.subarray(0,bytesRead));position+=bytesRead}
        await this.checkedFile(id)
        if(this.path(id)!==path||!same(opened,await file.stat())||!same(opened,await lstat(path)))throw fail('PI_SESSION_CHANGED')
        return fileStamp(opened)+':'+hash.digest('hex')
      } finally {await file.close()}
    })()
    this.digestReads.set(id,reading)
    try{return await reading}finally{if(this.digestReads.get(id)===reading)this.digestReads.delete(id)}
  }
  async readNative(id,options={}) {
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    await this.checkedFile(id)
    const path=this.path(id),codec=this.ctx.get('portablePaths')
    const before=await lstat(path)
    const bytes=await readFile(path).catch(error=>{if(error.code==='ENOENT')throw new SessionPersistenceNotFoundError(id);throw error})
    const after=await lstat(path)
    await this.checkedFile(id)
    if(this.path(id)!==path||fileStamp(before)!==fileStamp(after)||before.isSymbolicLink()||!before.isFile()||before.nlink!==1)throw fail('PI_SESSION_CHANGED')
    const journalDigest=fileStamp(after)+':'+digest(bytes)
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    const cached=this.readCache.get(id)
    // 每次读取真实字节；mtime/size 相同也不能绕过提交链和物理尾校验。
    if(cached&&cached.path===path&&cached.codec===codec&&cached.bytes.equals(bytes)){
      this.readCache.delete(id);this.readCache.set(id,cached)
      return clean({...cached.snapshot,journalDigest})
    }
    if(cached){this.readCache.delete(id);this.readCacheBytes-=cached.bytes.length}
    const data=decode(bytes,id,codec,options.requireComplete===true)
    if(data.format!=='pi-native-v1')throw fail('PI_SESSION_NATIVE_UPGRADE_REQUIRED')
    options.signal?.throwIfAborted()
    const nameManager=SessionManager.inMemory(data.header.cwd,undefined,[data.piHeader,...data.entries])
    const nameEntry=data.entries.findLast(entry=>entry.type==='session_info')
    const snapshot={format:data.format,journalDigest,header:data.header,entries:data.entries,audit:data.audit,
      sessionName:{name:nameManager.getSessionName(),nameEntryId:nameEntry?.id},
      auditEntries:data.entries.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit').map((entry,index)=>({entryId:entry.id,parentId:entry.parentId,data:data.audit[index]})),
      context:committedContext(data)}
    if(data.committedBytes===bytes.length&&bytes.length<=READ_CACHE_BYTES){
      while(this.readCacheBytes+bytes.length>READ_CACHE_BYTES){
        const oldest=this.readCache.keys().next().value
        this.readCacheBytes-=this.readCache.get(oldest).bytes.length;this.readCache.delete(oldest)
      }
      this.readCache.set(id,{path,codec,bytes,snapshot});this.readCacheBytes+=bytes.length
    }
    return clean(snapshot)
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
  async stat(id,options={}){options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');await this.checkedFile(id,true);if(this.writers.has(id))return this.writers.get(id).snapshot();try{const data=await load(this.path(id),id,this.ctx.get('portablePaths'));return sessionStat(data)}catch(error){if(error.name==='SessionPersistenceNotFoundError')return undefined;throw error}}
  async list(options={}){
    options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
    await this.checkedRoot(true)
    const names=(await readdir(this.config.root)).filter(name=>name.endsWith('.pi.jsonl')),result=[]
    const inspect=async name=>{
      options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
      await this.checkedRoot(false)
      const path=join(this.config.root,name),info=await lstat(path)
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw fail('PI_SESSION_PATH_UNSAFE')
      const bytes=await readFile(path),newline=bytes.indexOf(10),header=JSON.parse(bytes.toString('utf8',0,newline<0?bytes.length:newline))
      if(this.path(header.id)!==path)throw fail('PI_SESSION_FILENAME_MISMATCH')
      options.signal?.throwIfAborted();if(this.closed)throw fail('PI_PERSISTENCE_CLOSED')
      return this.writers.get(header.id)?.snapshot()??sessionStat(decode(bytes,header.id,this.ctx.get('portablePaths')))
    }
    // 每份日志只读一次；小批并行隐藏磁盘延迟，失败也先排空本批 I/O。
    for(let offset=0;offset<names.length;offset+=8){
      const batch=await Promise.allSettled(names.slice(offset,offset+8).map(inspect))
      for(const row of batch){if(row.status==='rejected')throw row.reason;result.push(row.value)}
    }
    for(const id of this.taskRoutes?.keys()??[]){const item=await this.stat(id,options);if(item)result.push(item)}
    const ids=new Set(result.map(item=>item.header.id))
    for(const writer of this.writers.values())if(!ids.has(writer.id)){result.push(writer.snapshot());ids.add(writer.id)}
    options.signal?.throwIfAborted();return result
  }
  async flush(){if(this.closed)throw fail('PI_PERSISTENCE_CLOSED');const results=await Promise.allSettled([...this.writers.values()].map(handle=>handle.flush()));const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'Pi persistence flush failed')}
}
