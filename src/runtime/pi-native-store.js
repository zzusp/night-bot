import {isDeepStrictEqual} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import {open,link,unlink} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {SessionManager,buildSessionProjection,convertToLlm} from '@earendil-works/pi-coding-agent'
import {validatePiJournalEntry,validateNativeAudit} from './pi-journal.js'
import {deepFreeze} from '../native-values.js'

const fail=code=>Object.assign(new Error(code),{code})
const clone=value=>structuredClone(value)
const hash=value=>createHash('sha256').update(value).digest('hex')
export const fileStamp=info=>JSON.stringify([info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs])

/** Durability around an official, non-persisting manager. The owner must drain its
 * AgentSession before close; this module neither drives nor replays agent work. */
export function nativeStore({backend,path,header,initial,lease,data,options={}}) {
  const id=header.id,piHeader=deepFreeze(initial[0])
  // 锁定版 Pi 在预加载数组尾部追加。每次检查该合同，不读取 SDK 私有字段。
  const manager=SessionManager.inMemory(header.cwd,undefined,initial)
  let committedCount=data?.entries.length??0,lastCommit=data?.entries.at(-1)
  const seen=new Set(),audits=[]
  for(const entry of data?.entries??[]){
    deepFreeze(entry);seen.add(entry.id)
    if(entry.type==='custom'&&entry.customType==='night.audit')audits.push(entry)
  }
  let stamp=data?.fileStamp,closed=false,closing,poisoned,chain=Promise.resolve()
  const assertOpen=()=>{if(closed)throw fail('PI_SESSION_HANDLE_CLOSED');if(poisoned)throw poisoned}
  const snapshot=()=>({format:'pi-native-v1',header:clone(header),nativeEntryCount:committedCount,auditCount:audits.length,revision:hash(JSON.stringify(lastCommit??piHeader)),formatStatus:'current'})
  const assertManager=()=>{
    if(manager.getHeader()!==piHeader||manager.getEntryCount()!==initial.length-1||
      lastCommit&&manager.getEntry(lastCommit.id)!==lastCommit)throw fail('PI_SESSION_PREFIX_CHANGED')
  }
  async function persist(signal) {
    assertOpen();signal?.throwIfAborted()
    if(backend.path(id)!==path)throw fail('PI_SESSION_ROUTE_CHANGED')
    const newFile=stamp===undefined,info=await backend.checkedFile(id,newFile)
    await lease.check();signal?.throwIfAborted()
    if(newFile?info!==undefined:fileStamp(info)!==stamp)throw fail('PI_SESSION_PREFIX_CHANGED')
    assertManager()
    const leaf=manager.getLeafId(),entryCount=initial.length-1
    if(!newFile&&entryCount===committedCount&&leaf===lastCommit.id)return
    const suffix=initial.slice(committedCount+1),ids=new Set(),batchAudits=[]
    const entries={has:id=>seen.has(id)||ids.has(id)}
    const lines=suffix.map(entry=>{
      const stored=JSON.parse(JSON.stringify(entry))
      validatePiJournalEntry(stored,entries,newFile&&ids.size===0)
      if(manager.getEntry(stored.id)!==entry||stored.parentId!==entry.parentId||stored.type!==entry.type)throw fail('PI_SESSION_PREFIX_CHANGED')
      if(stored.type==='custom'&&stored.customType?.startsWith('night.')&&!['night.header','night.audit'].includes(stored.customType))throw fail('PI_SESSION_NATIVE_RESERVED_ENTRY')
      if(stored.type==='custom'&&stored.customType==='night.audit'){
        validateReceipt(stored.data);batchAudits.push(entry)
      }
      // Pi 校验新条目的投影；上下文编辑只需要它引用的条目，不用重建整条分支。
      const target=stored.type==='context_edit'?manager.getEntry(stored.targetId):undefined
      const local=target?[{...target,parentId:null},{...stored,parentId:target.id}]:[{...stored,parentId:null}]
      convertToLlm(buildSessionProjection(local,stored.id).messages)
      ids.add(stored.id)
      return JSON.stringify(stored)
    })
    if(newFile){
      const source=suffix[0]
      if(piHeader.id!==id||piHeader.type!=='session'||piHeader.version!==3||source?.type!=='custom'||source.customType!=='night.header'||source.data?.header?.id!==id)throw fail('PI_SESSION_IDENTITY_MISMATCH')
      if(source.data.importedFrom!==undefined)throw fail('PI_SESSION_IMPORT_UNSUPPORTED')
    }
    if(leaf!==null&&!entries.has(leaf))throw fail('PI_SESSION_TREE_CORRUPT')
    for(const entry of suffix)deepFreeze(entry)
    const batch=(newFile?JSON.stringify(piHeader)+'\n':'')+lines.join('\n')
    let file,marker,started=false
    const temp=newFile?join(dirname(path),'.pending-pi-'+randomUUID()):undefined
    try {
      signal?.throwIfAborted()
      marker=manager.appendCustomEntry('night.commit',{version:2,entryCount,auditCount:audits.length+batchAudits.length,previousCommit:lastCommit?.id??null,entriesHash:hash(batch)})
      assertManager()
      const commit=deepFreeze(manager.getEntry(marker))
      if(initial.at(-1)!==commit||commit.parentId!==leaf)throw fail('PI_SESSION_PREFIX_CHANGED')
      const bytes=(batch?batch+'\n':'')+JSON.stringify(commit)+'\n'
      started=true
      file=await open(temp??path,newFile?'wx':constants.O_WRONLY|constants.O_APPEND|(constants.O_NOFOLLOW??0),0o600)
      if(!newFile){const opened=await file.stat();if(!opened.isFile()||opened.nlink!==1||fileStamp(opened)!==stamp)throw fail('PI_SESSION_PREFIX_CHANGED')}
      await file.writeFile(bytes);await file.sync()
      const written=await file.stat()
      if(written.size!==(info?.size??0)+Buffer.byteLength(bytes))throw fail('PI_SESSION_PREFIX_CHANGED')
      await file.close();file=undefined
      if(temp){await link(temp,path);await unlink(temp)}
      if(newFile&&process.platform!=='win32'){const dir=await open(dirname(path),'r');try{await dir.sync()}finally{await dir.close()}}
      await lease.check()
      if(backend.path(id)!==path)throw fail('PI_SESSION_ROUTE_CHANGED')
      const published=await backend.checkedFile(id)
      if(published.dev!==written.dev||published.ino!==written.ino||published.size!==written.size)throw fail('PI_SESSION_PREFIX_CHANGED')
      stamp=fileStamp(published);committedCount=entryCount+1;lastCommit=commit
      for(const entry of suffix)seen.add(entry.id)
      seen.add(marker);for(const entry of batchAudits)audits.push(entry)
    }catch(error){
      if(started)poisoned=Object.assign(new Error('PI_SESSION_COMMIT_UNCERTAIN',{cause:error}),{code:'PI_SESSION_COMMIT_UNCERTAIN'})
      else if(marker)poisoned=error
      throw poisoned??error
    }finally{await file?.close();if(temp)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error})}
  }
  const pathCodec=backend.ctx.get('portablePaths')
  const sourceHeader=clone(initial[1]?.data.header)
  const logicalReceipt=receipt=>pathCodec?.readAuditReceipt?.(receipt,{sourceHeader,logicalHeader:header})??receipt
  function validateReceipt(receipt,verifyPaths=true){validateNativeAudit(receipt);const validate=options.auditKinds?.[receipt.domain+'/'+receipt.kind];if(typeof validate!=='function'||validate(clone(receipt.payload))!==true)throw fail('PI_SESSION_AUDIT_KIND_UNREGISTERED');if(verifyPaths&&!pathCodec?.auditReceipt&&receipt.pathBindings!==undefined)throw fail('PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY');if(verifyPaths&&pathCodec?.auditReceipt){const {pathBindings,...plain}=receipt,expected=pathCodec.auditReceipt(plain);if(!isDeepStrictEqual(pathBindings,expected.pathBindings))throw fail('PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY')}}
  const handle={kind:'pi-native',format:'pi-native-v1',id,header:clone(header),manager,access:'write',snapshot,
    enqueue(){throw fail('PI_SESSION_NATIVE_HOST_EVENT_FORBIDDEN')},
    append(){throw fail('PI_SESSION_NATIVE_HOST_EVENT_FORBIDDEN')},
    appendAudit(receipt){assertOpen();if(closing)throw fail('PI_SESSION_HANDLE_CLOSED');const copied=clone(receipt);if(copied.pathBindings!==undefined)throw fail('PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY');validateReceipt(copied,false);const stored=pathCodec?.auditReceipt?.(copied)??copied;return manager.appendCustomEntry('night.audit',stored)},
    commit({signal}={}){if(closing||backend.closed)return Promise.reject(fail('PI_SESSION_HANDLE_CLOSED'));const operation=chain.then(()=>persist(signal));chain=operation.catch(()=>{});return operation},
    flush(options){return handle.commit(options)},
    reader(){throw fail('PI_SESSION_NATIVE_AUDIT_API_REQUIRED')},
    async readAudit(){await chain;assertOpen();return clone(audits.map(e=>logicalReceipt(e.data)))},
    async readAuditEntries(){await chain;assertOpen();return clone(audits.map(e=>({entryId:e.id,parentId:e.parentId,receipt:logicalReceipt(e.data)})))},
    close(){return closing??=(async()=>{try{await chain;await persist()}finally{closed=true;backend.handles.delete(handle);if(backend.writers.get(id)===handle)backend.writers.delete(id);unregister?.();await lease.close()}})()},
    [Symbol.asyncDispose](){return handle.close()},
  }
  const unregister=backend.ctx.get('piAuthority').register(id,{context(){assertOpen();const projection=clone(manager.buildSessionProjection());return {projection,piMessages:projection.messages}},describe(){assertOpen();return {engine:'pi-session-manager',format:'pi-native-v1',path,sessionId:id,leafId:manager.getLeafId()}}})
  backend.handles.add(handle);backend.writers.set(id,handle)
  return handle
}
