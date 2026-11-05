import {isDeepStrictEqual} from 'node:util'
import {taskEffectBinding,taskEffectDigest,taskEffectInvocationKey} from './effect-reconciliation.js'
import {admissionAuditKinds} from '../runtime/pi-business-admission.js'
const fail=code=>{throw Object.assign(new Error(code),{code})}
/** Resolve a tool's actual official assistant branch, never the mutable owner
 * binding or a latest-message projection. */
export function taskToolInputOrigin(manager,{callId,name,args,taskId,sessionId,atEntryId}){
 const branch=manager.getBranch(atEntryId),assistant=branch.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
 const calls=assistant?.message.content.filter(block=>block.type==='toolCall'&&block.id===callId&&block.name===name)
 if(calls?.length!==1||!isDeepStrictEqual(calls[0].arguments,args))fail('TASK_EFFECT_CALL_AMBIGUOUS')
 const callBranch=manager.getBranch(assistant.id)
 const input=callBranch.findLast(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.source?.kind==='task-input')
 if(!input||Object.keys(input.details).length!==2)fail('TASK_EFFECT_ORIGIN_INPUT_REQUIRED')
 const binding=taskEffectBinding(input.details.source.taskSession)
 if(binding.taskId!==taskId||binding.sessionId!==sessionId)fail('TASK_EFFECT_ORIGIN_BINDING_MISMATCH')
 const audit=callBranch.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit').map(entry=>entry.data)
 const packet=audit.find(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===input.details.packetId)
 if(packet?.version!==1||!admissionAuditKinds['admission/enqueued'](packet.payload)||!isDeepStrictEqual(packet.payload.source,input.details.source)||!isDeepStrictEqual(packet.payload.content,input.content)||!audit.some(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.version===1&&receipt.payload.id===packet.payload.id&&receipt.payload.entryId===input.id))fail('TASK_EFFECT_ADMISSION_REQUIRED')
 return {binding,name,callId,argumentsDigest:taskEffectDigest(calls[0].arguments),packet:structuredClone(packet.payload),inputEntryId:input.id,packetId:packet.payload.id,inputDigest:taskEffectDigest(packet.payload),callEntryId:assistant.id,invocationKey:taskEffectInvocationKey({sessionId,callEntryId:assistant.id,callId}),key:taskEffectDigest({requirementRevision:binding.requirementRevision,contextRevision:binding.contextRevision,controlRevision:binding.controlRevision,name,args})}
}

/** Resolve a persisted Night v1/v2 attempt against its exact official call.
 * v1 is read without rewriting its receipts or manufacturing an identity. */
export function taskEffectIntentOrigin(manager,intent,{taskId,sessionId}){
 if(intent.version!==undefined&&intent.version!==2)fail('TASK_EFFECT_AUDIT_INVALID')
 const matches=manager.getEntries().filter(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data.domain==='task'&&entry.data.kind==='effect-intent'&&entry.data.payload.key===intent.key)
 if(matches.length!==1)fail('TASK_EFFECT_INTENT_AMBIGUOUS')
 const entry=matches[0]
 if(!isDeepStrictEqual(entry.data.payload,Object.fromEntries(Object.keys(entry.data.payload).map(key=>[key,intent[key]]))))fail('TASK_EFFECT_AUDIT_INVALID')
 const branch=manager.getBranch(entry.id),calls=branch.flatMap(row=>row.type==='message'&&row.message.role==='assistant'&&(intent.version!==2||row.id===intent.invocation?.callEntryId)?row.message.content.filter(block=>block.type==='toolCall'&&block.id===intent.callId&&block.name===intent.name).map(block=>({entry:row,block})):[])
 // Night v1 keys included the actual input revisions and arguments. Providers
 // may reuse call IDs across turns: validate each official candidate first and
 // require a unique full legacy-key match, never guess the latest call.
 const resolved=calls.map(call=>({call,origin:taskToolInputOrigin(manager,{callId:intent.callId,name:intent.name,args:call.block.arguments,taskId,sessionId,atEntryId:call.entry.id})})).filter(({origin})=>intent.version===2||origin.key===intent.key)
 if(resolved.length!==1)fail('TASK_EFFECT_CALL_AMBIGUOUS')
 const {call,origin}=resolved[0]
 if(intent.version===2){
  const expected={callEntryId:origin.callEntryId,inputEntryId:origin.inputEntryId,packetId:origin.packetId,inputDigest:origin.inputDigest,originBinding:origin.binding}
  if(intent.key!==origin.invocationKey||!isDeepStrictEqual(intent.invocation,expected))fail('TASK_EFFECT_INVOCATION_MISMATCH')
 }else if(origin.key!==intent.key)fail('TASK_EFFECT_ARGUMENTS_MISMATCH')
 return {...origin,intentEntryId:entry.id,intentDigest:taskEffectDigest(entry),argumentsDigest:taskEffectDigest(call.block.arguments)}
}

/** Exact unresolved business intents, attested only after the real owner drain. */
export function unresolvedTaskInputOrigins(manager,intents,identity){
 const inputs=[]
 for(const intent of intents.values()){
  if(intent.settled)continue
  const origin=taskEffectIntentOrigin(manager,intent,identity)
  inputs.push({intentEntryId:origin.intentEntryId,intentDigest:origin.intentDigest,originBinding:origin.binding})
 }
 return inputs
}

/** Repair only already committed Night admission facts across the SQL/native
 * boundary. This function never delivers input or invokes a model. */
export function committedLiveSupplementAdmissions(manager,task){
 const branch=manager.getBranch(),audit=branch.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit').map(entry=>entry.data),result=[]
 for(const row of task.liveSupplements??[]){
  if(row.state!=='pending'||row.leaseEpoch!==task.leaseEpoch)continue
  if(row.requirementRevision!==task.requirementRevision||row.controlRevision!==task.controlRevision)continue
  const packetId='task-supplement:'+row.wakeId,acks=audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packetId)
  if(!acks.length)continue
  if(acks.length!==1||acks[0].version!==1||!admissionAuditKinds['admission/admitted'](acks[0].payload))fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')
  const packets=audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId),inputs=branch.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.packetId===packetId)
  if(packets.length!==1||packets[0].version!==1||!admissionAuditKinds['admission/enqueued'](packets[0].payload)||inputs.length!==1)fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')
  const packet=packets[0].payload,input=inputs[0],binding=taskEffectBinding(packet.source.taskSession)
  if(packet.source.kind!=='task-input'||!isDeepStrictEqual(input.details,{packetId,source:packet.source})||!isDeepStrictEqual(input.content,packet.content)||acks[0].payload.entryId!==input.id||binding.taskId!==task.taskId||binding.sessionId!==task.sessionId||binding.leaseEpoch!==row.leaseEpoch||binding.requirementRevision!==row.requirementRevision||binding.controlRevision!==row.controlRevision||binding.contextRevision!==row.contextRevision)fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')
  let body;try{body=JSON.parse(packet.content[0].text)}catch{fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')}
  if(!isDeepStrictEqual(body.sources,row.sourceSnapshots)||body.task?.request!==row.request||body.task.contextRevision!==row.contextRevision||body.supplement?.messageId!==row.messageId||body.supplement.contextRevision!==row.contextRevision)fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')
  result.push({messageId:row.messageId,entryId:input.id,packetId,binding:{kind:'task-session',...binding}})
 }
 return result
}
