import {readNativeHistory} from '../../packages/dingtalk-core/native-maintenance-drain.js'
import {isolationDigest as hash} from '../../packages/dingtalk-core/native-restart-isolation.js'

const bindingKeys=['taskId','executionId','sessionId','requirementRevision','controlRevision','inputVersion','inputDigest','leaseEpoch']
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const text=value=>typeof value==='string'&&value.length>0
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const sameBinding=(a,b)=>bindingKeys.every(key=>a?.[key]===b?.[key])
const validBinding=value=>exact(value,bindingKeys)&&['taskId','executionId','sessionId','inputDigest'].every(key=>text(value[key]))&&['requirementRevision','controlRevision','inputVersion','leaseEpoch'].every(key=>Number.isSafeInteger(value[key])&&value[key]>0)
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const unknown=value=>exact(value,['operationId','operationDigest','callId','argumentsDigest'])&&text(value.operationId)&&text(value.callId)&&hex(value.operationDigest)&&hex(value.argumentsDigest)
export const maintenanceAuditKinds=Object.freeze({
 'execution/bound':value=>exact(value,['binding'])&&validBinding(value.binding),
 'execution/admission-paused':value=>exact(value,['binding','pauseId','turnId'])&&validBinding(value.binding)&&text(value.pauseId)&&text(value.turnId),
 'execution/terminal':value=>exact(value,['binding','pauseId','turnId','cutLeafId','reason','active','effects'])&&validBinding(value.binding)&&text(value.pauseId)&&text(value.turnId)&&text(value.cutLeafId)
  &&['cancelled','completed','failed'].includes(value.reason)&&exact(value.active,['model','tools','processes','jobs'])&&Object.values(value.active).every(count=>count===0)
  &&exact(value.effects,['state','unknown'])&&value.effects.state==='held'&&Array.isArray(value.effects.unknown)&&value.effects.unknown.every(unknown)
  &&new Set(value.effects.unknown.map(row=>row.operationId)).size===value.effects.unknown.length&&new Set(value.effects.unknown.map(row=>row.callId)).size===value.effects.unknown.length,
})
const fail=()=>{throw Object.assign(new Error('DYNAMIC_MAINTENANCE_NATIVE_DRAIN_RECEIPTS_REQUIRED'),{code:'DYNAMIC_MAINTENANCE_NATIVE_DRAIN_RECEIPTS_REQUIRED'})}

/** Validates explicit Host attestations, not model/tool transcript semantics.
 * This is only the session half of a maintenance proof. The caller must still
 * verify stopped Host/process identities, paused ledger/control digest and
 * operator approval. It never settles effects or grants replay. */
function verifyNativeDrainReceipts(stored,binding,{operations=[],terminalEntryId}={}){
 if(stored?.format!=='pi-native-v1'||!validBinding(binding)||!Array.isArray(stored.auditEntries))fail()
 const receipts=stored.auditEntries.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data?.domain==='execution')
 if(receipts.some(entry=>entry.data.version!==1||!maintenanceAuditKinds['execution/'+entry.data.kind]?.(entry.data.payload)))fail()
 const bound=receipts.findLastIndex(entry=>entry.data.kind==='bound')
 if(bound<0||!sameBinding(receipts[bound].data.payload.binding,binding))fail()
 const segment=receipts.slice(bound),paused=segment.filter(entry=>entry.data.kind==='admission-paused'),terminals=segment.filter(entry=>entry.data.kind==='terminal')
 if(paused.length!==1||terminals.length!==1||segment.indexOf(paused[0])>=segment.indexOf(terminals[0]))fail()
 const pause=paused[0].data.payload,entry=terminals[0],terminal=entry.data.payload
 if(!sameBinding(pause.binding,binding)||!sameBinding(terminal.binding,binding)||pause.pauseId!==terminal.pauseId||pause.turnId!==terminal.turnId
  ||!stored.context?.projection?.entries.some(item=>item.sourceEntry.id===entry.id)||entry.parentId!==terminal.cutLeafId||terminalEntryId!==undefined&&terminalEntryId!==entry.id||stored.terminalEntryId!==entry.id)fail()
 const activeOperations=operations.filter(row=>row.taskId===binding.taskId&&row.executionId===binding.executionId)
 if(activeOperations.some(row=>row.state==='starting'))fail()
 const unresolved=activeOperations.filter(row=>row.state==='unknown'),refs=terminal.effects.unknown
 if(unresolved.length!==refs.length)fail()
 const pendingOperations=refs.map(ref=>{
  const operation=unresolved.find(row=>row.operationId===ref.operationId)
  if(!operation||!sameBinding(operation.dispatchBinding,binding)||hash(operation)!==ref.operationDigest||operation.definition?.argumentsDigest!==ref.argumentsDigest
   ||operation.key!==`native:${binding.executionId}:${binding.inputVersion}:${binding.leaseEpoch}:${ref.callId}`)fail()
  return {operationId:ref.operationId,operationDigest:ref.operationDigest,callId:ref.callId}
 })
 return {kind:'native-drain-receipts',terminalEntryId:entry.id,binding,pendingOperations,noReplay:true,partialEffectsPossible:true}
}


/** Only controlled task journal I/O supplies attestations. Caller-provided
 * records, projections or transcript messages are never accepted as proof. */
export function readNativeDrainReceipts(workspace,binding,{pathCodec,operations,terminalEntryId}={}){
 const stored=readNativeHistory(workspace,binding,{pathCodec})
 return verifyNativeDrainReceipts(stored,binding,{operations,terminalEntryId})
}
