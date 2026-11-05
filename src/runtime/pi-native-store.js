import {createHash,randomUUID} from 'node:crypto'
import {open,link,unlink,readFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {buildSessionProjection,convertToLlm} from '@earendil-works/pi-coding-agent'
import {decodePiJournal,validateNativeAudit} from './pi-journal.js'

const fail=code=>Object.assign(new Error(code),{code})
const clone=value=>structuredClone(value)
const hash=value=>createHash('sha256').update(value).digest('hex')

/** Durability around an official, non-persisting manager. The owner must drain its
 * AgentSession before close; this module neither drives nor replays agent work. */
export function nativeStore({backend,path,header,manager,lease,data,options={}}) {
  const id=header.id
  let committed=data?.entries??[],piHeader=clone(manager.getHeader()),newFile=!data,closed=false,closing,poisoned,chain=Promise.resolve()
  const assertOpen=()=>{if(closed)throw fail('PI_SESSION_HANDLE_CLOSED');if(poisoned)throw poisoned}
  const snapshot=()=>({format:'pi-native-v1',header:clone(header),nativeEntryCount:committed.length,auditCount:committed.filter(e=>e.type==='custom'&&e.customType==='night.audit').length,revision:hash(JSON.stringify(committed.at(-1)??piHeader)),formatStatus:'current'})
  async function persist(signal) {
    assertOpen();signal?.throwIfAborted()
    if(backend.path(id)!==path)throw fail('PI_SESSION_ROUTE_CHANGED')
    await backend.checkedFile(id,newFile);await lease.check();signal?.throwIfAborted()
    if(!newFile){const disk=decodePiJournal(await readFile(path),id,{requireComplete:true});if(JSON.stringify(disk.piHeader)!==JSON.stringify(piHeader)||JSON.stringify(disk.entries)!==JSON.stringify(committed))throw fail('PI_SESSION_PREFIX_CHANGED')}
    const before=clone(manager.getEntries()),leaf=manager.getLeafId()
    if(JSON.stringify(manager.getHeader())!==JSON.stringify(piHeader)||JSON.stringify(before.slice(0,committed.length))!==JSON.stringify(committed))throw fail('PI_SESSION_PREFIX_CHANGED')
    if(!newFile&&before.length===committed.length&&leaf===committed.at(-1)?.id)return
    for(const entry of before.slice(committed.length)){
      if(entry.type==='custom'&&entry.customType==='night.audit')validateReceipt(entry.data)
      if(entry.type==='custom'&&entry.customType?.startsWith('night.')&&!['night.header','night.audit'].includes(entry.customType))throw fail('PI_SESSION_NATIVE_RESERVED_ENTRY')
    }
    const projection=buildSessionProjection(before,leaf)
    convertToLlm(projection.messages)
    const auditCount=before.filter(e=>e.type==='custom'&&e.customType==='night.audit').length
    const suffix=before.slice(committed.length)
    manager.appendCustomEntry('night.commit',{version:2,entryCount:before.length,auditCount,previousCommit:committed.at(-1)?.id??null,entriesHash:hash((newFile?JSON.stringify(piHeader)+'\n':'')+suffix.map(e=>JSON.stringify(e)).join('\n'))})
    const all=clone(manager.getEntries()),bytes=(newFile?JSON.stringify(piHeader)+'\n':'')+all.slice(committed.length).map(e=>JSON.stringify(e)).join('\n')+'\n'
    // Validate the exact proposed authoritative file with the shared strict codec.
    const complete=Buffer.from(JSON.stringify(piHeader)+'\n'+all.map(e=>JSON.stringify(e)).join('\n')+'\n')
    decodePiJournal(complete,id,{requireComplete:true})
    let file,started=false
    const temp=newFile?join(dirname(path),'.pending-pi-'+randomUUID()):undefined
    try {
      signal?.throwIfAborted();started=true
      file=await open(temp??path,newFile?'wx':'a',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=undefined
      if(temp){await link(temp,path);await unlink(temp)}
      if(newFile&&process.platform!=='win32'){const dir=await open(dirname(path),'r');try{await dir.sync()}finally{await dir.close()}}
      await lease.check();committed=all;newFile=false
    }catch(error){if(started)poisoned=Object.assign(new Error('PI_SESSION_COMMIT_UNCERTAIN',{cause:error}),{code:'PI_SESSION_COMMIT_UNCERTAIN'});throw poisoned??error}
    finally{await file?.close();if(temp)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error})}
  }
  function validateReceipt(receipt){validateNativeAudit(receipt);const validate=options.auditKinds?.[receipt.domain+'/'+receipt.kind];if(typeof validate!=='function'||validate(clone(receipt.payload))!==true)throw fail('PI_SESSION_AUDIT_KIND_UNREGISTERED')}
  const handle={kind:'pi-native',format:'pi-native-v1',id,header:clone(header),manager,access:'write',snapshot,
    enqueue(){throw fail('PI_SESSION_NATIVE_HOST_EVENT_FORBIDDEN')},
    append(){throw fail('PI_SESSION_NATIVE_HOST_EVENT_FORBIDDEN')},
    appendAudit(receipt){assertOpen();if(closing)throw fail('PI_SESSION_HANDLE_CLOSED');validateReceipt(receipt);return manager.appendCustomEntry('night.audit',clone(receipt))},
    commit({signal}={}){if(closing||backend.closed)return Promise.reject(fail('PI_SESSION_HANDLE_CLOSED'));const operation=chain.then(()=>persist(signal)).catch(error=>{const last=manager.getEntries().at(-1);if(last?.customType==='night.commit'&&last.id!==committed.at(-1)?.id)poisoned??=error;throw error});chain=operation.catch(()=>{});return operation},
    flush(options){return handle.commit(options)},
    reader(){throw fail('PI_SESSION_NATIVE_AUDIT_API_REQUIRED')},
    async readAudit(){await chain;assertOpen();return clone(committed.filter(e=>e.type==='custom'&&e.customType==='night.audit').map(e=>e.data))},
    async readAuditEntries(){await chain;assertOpen();return clone(committed.filter(e=>e.type==='custom'&&e.customType==='night.audit').map(e=>({entryId:e.id,parentId:e.parentId,receipt:e.data})))},
    close(){return closing??=(async()=>{try{await chain;await persist()}finally{closed=true;backend.handles.delete(handle);if(backend.writers.get(id)===handle)backend.writers.delete(id);unregister?.();await lease.close()}})()},
    [Symbol.asyncDispose](){return handle.close()},
  }
  const unregister=backend.ctx.get('piAuthority').register(id,{context(){assertOpen();const projection=clone(manager.buildSessionProjection());return {projection,piMessages:projection.messages}},describe(){assertOpen();return {engine:'pi-session-manager',format:'pi-native-v1',path,sessionId:id,leafId:manager.getLeafId()}}})
  backend.handles.add(handle);backend.writers.set(id,handle)
  return handle
}
