import {isDeepStrictEqual} from 'node:util'
import {maintenanceAuditKinds} from './native-maintenance-receipts.js'

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const text=value=>typeof value==='string'&&value.length>0
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const binding=value=>maintenanceAuditKinds['execution/bound']({binding:value})
const admitted=(value,key)=>exact(value,[key,'entryId','binding'])&&text(value[key])&&text(value.entryId)&&binding(value.binding)
export const executionInputAuditKinds=Object.freeze({
 'execution/input-admitted':value=>admitted(value,'inputId'),
 'execution/feedback-admitted':value=>admitted(value,'messageId'),
})
const fail=code=>{throw Object.assign(new Error(code),{code})}
const ownerMatches=(left,right)=>['taskId','executionId','sessionId'].every(key=>left[key]===right[key])

/** Read permanent business admission evidence from the committed native journal.
 * Pi projections remain the context authority. An admission is not undone when
 * Pi branches, compacts or edits its context, so links use original Pi entries,
 * never a regenerated message list or the currently visible branch alone.
 * Nothing here classifies an external effect or proves execution quiescence.
 */
export async function readNativeExecutionInputs(persistence,expected,{signal}={}){
 if(!binding(expected))fail('EXECUTION_NATIVE_BINDING_INVALID')
 const stored=await persistence.readNative(expected.sessionId,{requireComplete:true,signal})
 if(stored.format!=='pi-native-v1'||stored.header.id!==expected.sessionId||!Array.isArray(stored.entries))fail('EXECUTION_NATIVE_HISTORY_REQUIRED')
 const byId=new Map(stored.entries.map((entry,index)=>[entry.id,{entry,index}]))
 const receipts=stored.entries.flatMap((entry,index)=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data?.domain==='execution'?[{entry,index,receipt:entry.data}]:[])
 const bounds=receipts.filter(row=>row.receipt.kind==='bound')
 if(!bounds.length||bounds.some(row=>row.receipt.version!==1||!maintenanceAuditKinds['execution/bound'](row.receipt.payload)||!ownerMatches(row.receipt.payload.binding,expected)))fail('EXECUTION_NATIVE_IDENTITY_MISMATCH')
 const selected=bounds.at(-1)
 if(!isDeepStrictEqual(selected.receipt.payload.binding,expected))fail('EXECUTION_NATIVE_BINDING_CHANGED')
 const seen=new Set(),inputs=[],feedback=[]
 for(const row of receipts){
  const {receipt}=row,kind=receipt.kind,key=kind==='input-admitted'?'inputId':kind==='feedback-admitted'?'messageId':undefined
  if(!key)continue
  if(receipt.version!==1||!executionInputAuditKinds['execution/'+kind](receipt.payload))fail('EXECUTION_NATIVE_ADMISSION_INVALID')
  const payload=receipt.payload
  if(!ownerMatches(payload.binding,expected))fail('EXECUTION_NATIVE_IDENTITY_MISMATCH')
  const bound=bounds.findLast(candidate=>candidate.index<row.index)
  if(!bound||!isDeepStrictEqual(bound.receipt.payload.binding,payload.binding))fail('EXECUTION_NATIVE_ADMISSION_BINDING_CHANGED')
  const linked=byId.get(payload.entryId)
  if(!linked||linked.index>=row.index||linked.entry.type!=='custom_message'||linked.entry.customType!=='night.business-input'
    ||linked.entry.details?.packetId!==payload[key]||!record(linked.entry.details?.source))fail('EXECUTION_NATIVE_ADMISSION_LINK_INVALID')
  const identity=payload[key]
  if(seen.has(identity))fail('EXECUTION_NATIVE_ADMISSION_DUPLICATE')
  seen.add(identity)
  const result={...structuredClone(payload),source:structuredClone(linked.entry.details.source)}
  ;(kind==='input-admitted'?inputs:feedback).push(result)
 }
 return {format:stored.format,header:stored.header,context:stored.context,binding:structuredClone(expected),bindingEntryId:selected.entry.id,inputs,feedback}
}
