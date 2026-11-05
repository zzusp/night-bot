import {taskEffectDigest} from './effect-reconciliation.js'
import {nativeBusinessAuditKinds} from '../runtime/pi-business-state.js'
/** Standing Night authorization facts, not conversation or model projection. */
export async function readTaskEffectScope(ctx,task,stored){
 const memory=ctx.get('memory');await memory?.bindingReady
 const binding=memory?.bindings?.get(task.sessionId)
 if(!binding||binding.actorId!==task.ownerActorId||(binding.groupId??null)!==(task.groupId??null))throw Object.assign(new Error('TASK_EFFECT_MEMORY_SCOPE_MISMATCH'),{code:'TASK_EFFECT_MEMORY_SCOPE_MISMATCH'})
 const facts={};let cwd=stored.header.cwd
 for(const row of stored.audit){
  const name=row.domain+'/'+row.kind
  if(['permission/selected','sandbox/policy','approval/policy','directory/changed'].includes(name)){
   if(row.version!==1||!nativeBusinessAuditKinds[name](row.payload))throw Object.assign(new Error('TASK_EFFECT_AUTHORIZATION_FACT_INVALID'),{code:'TASK_EFFECT_AUTHORIZATION_FACT_INVALID'})
   if(name==='directory/changed')cwd=row.payload.cwd;else facts[name]=row.payload
  }
 }
 if(!facts['permission/selected'])throw Object.assign(new Error('TASK_EFFECT_AUTHORIZATION_FACT_REQUIRED'),{code:'TASK_EFFECT_AUTHORIZATION_FACT_REQUIRED'})
 return {taskId:task.taskId,sessionId:task.sessionId,taskRoot:stored.header.cwd,workingDirectory:cwd,ownerActorId:task.ownerActorId,groupId:task.groupId??null,
  channelDigest:taskEffectDigest({ownerActorId:task.ownerActorId,groupId:task.groupId??null,metadata:task.metadata??{}}),
  authorizationDigest:taskEffectDigest({facts,memoryBinding:binding})}
}
