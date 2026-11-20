import {isDeepStrictEqual} from 'node:util'
import {conversationSource} from '../channels/message-safety.js'
import {ROUTER_HANDOFF_POLICY} from '../channels/router-handoff.js'
// Model view only. SQL and Pi retain the original source/actions/effect receipts.
// In particular, never copy audit histories and mutable scheduling queues here.
const fields=['taskId','sessionId','ownerActorId','groupId','conversationId','title','objective','request','requirements','requirementRevision','contextRevision','controlRevision','leaseEpoch','status','control','sourceRefs','dependencies','archiveRestore']
export const sourceOnlyTaskInput=task=>task?.metadata?.routerInputPolicy==='source-only-v1'
export const routerHandoffTaskInput=task=>task?.metadata?.routerInputPolicy===ROUTER_HANDOFF_POLICY
const routerHandoffSourceFields=['sourceId','messageId','version','actorId','actorRole','senderId','senderName','channelId','channelType','groupId','conversationId','channel','timestamp','authorizationRevoked','archiveRestoreHold']
const verifiedSourceFields=['sourceId','messageId','version','actorId','actorRole','senderId','senderName','channelId','channelType','mentionedAgent','mentions','groupId','conversationId','channel','text','timestamp','resources','quote','authorizationRevoked','triageHold','archiveRestoreHold','platformFlags']
const project=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))

export function executionTaskBrief(task){
 if(!task)return task
 const brief=Object.fromEntries(fields.filter(key=>task[key]!==undefined).map(key=>[key,task[key]]))
 if(sourceOnlyTaskInput(task)||routerHandoffTaskInput(task)){
  for(const key of ['title','objective','request','requirements'])delete brief[key]
  brief.inputPolicy=task.metadata.routerInputPolicy
  if(sourceOnlyTaskInput(task)&&task.metadata.routerSourceSelection)brief.sourceSelection=task.metadata.routerSourceSelection
  if(brief.dependencies)brief.dependencies=brief.dependencies.map(({condition,evaluation,...facts})=>facts)
 }
 return brief
}
export function executionContext(input,audit=[]){
 const admitted=new Set(audit.filter(row=>row.domain==='admission'&&row.kind==='admitted').map(row=>row.payload.id))
 const prior=[]
 for(const row of audit){
  if(row.domain!=='admission'||!['enqueued','enqueued-internal'].includes(row.kind)||!admitted.has(row.payload.id)||row.payload.source?.kind!=='task-input')continue
  try{prior.push(JSON.parse(row.payload.content[0].text))}catch{}
 }
 const projectSource=source=>{
  if(routerHandoffTaskInput(input.task))return conversationSource(project(source,routerHandoffSourceFields))
  return sourceOnlyTaskInput(input.task)?conversationSource(project(source,verifiedSourceFields)):conversationSource(source)
 }
 const seenSources=new Map(prior.flatMap(body=>(body.sources??[]).map(source=>[source.sourceId,source.version])))
 const sources=(input.sources??[]).filter(source=>!seenSources.has(source.sourceId)||seenSources.get(source.sourceId)!==source.version).map(({stages,...source})=>projectSource(source))
 // Review inputs must retain the exact original candidates even when previously seen.
 const selected=input.humanReview||input.dialogue?(input.sources??[]).map(({stages,...source})=>projectSource(source)):sources
 const ids=new Set(selected.map(source=>source.sourceId))
 const last=prior.at(-1),revision=last?.task?.contextRevision??-1
 const updates=(input.task?.supplements??[]).filter(item=>item.contextRevision>revision&&(item.requirementRevision===undefined||item.requirementRevision===input.task.requirementRevision)).map(({id,text,contextRevision})=>({id,text,contextRevision}))
 if(input.task?.currentInput&&!updates.some(row=>row.id===input.task.currentInput.id)&&!prior.some(body=>body.currentInput?.id===input.task.currentInput.id||body.supplement?.messageId===input.task.currentInput.id||body.updates?.some(row=>row.id===input.task.currentInput.id)))updates.push(input.task.currentInput)
 const usesHandoff=routerHandoffTaskInput(input.task)
 const admittedHandoffs=new Set(prior.flatMap(body=>(body.handoffs??[]).map(item=>item.id)))
 const handoffs=usesHandoff?(input.task.metadata.routerHandoffs??[]).filter(row=>!admittedHandoffs.has(row.id)
   &&row.requirementRevision===input.task.requirementRevision&&row.contextRevision<=(input.task.contextRevision??0))
   .map(row=>project(row,['id','sourceId','messageVersion','requirementRevision','contextRevision','text'])):[]
 const directInput=input.task?.currentInput
 const directSource=usesHandoff&&directInput&&(input.sources??[]).find(source=>source.channel==='web'&&source.sourceId===directInput.sourceId
   &&source.version===directInput.messageVersion&&source.requestIdentity?.action)
 const directUpdates=directSource&&updates.some(row=>row.id===directInput.id)?[project(directInput,['id','sourceId','messageVersion','text'])]:[]
 const materials=input.materials?.filter(item=>ids.has(item.sourceId)).map(item=>usesHandoff
   ? {...project(item,['taskId','sourceId','messageId','version','actorId']),
     resources:item.resources?.map(({value,...resource})=>({...resource,...value?.file?{file:value.file}:{}}))}
   : conversationSource(item))
 return {task:executionTaskBrief(input.task),sources:selected,materials,updates:usesHandoff?directUpdates:sourceOnlyTaskInput(input.task)?[]:updates,
  ...(usesHandoff?{handoffs}:{}),dialogue:input.dialogue,humanReview:input.humanReview,blockers:input.blockers,
  jobReconciliations:audit.filter(row=>row.domain==='job'&&row.kind==='reconciled').map(({payload:p})=>({jobId:p.jobId,toolCall:p.toolCall,outcome:p.outcome,exitStatus:p.exitStatus,producerObservation:p.producerObservation,partialEffectsPossible:true,noReplay:true,evidence:p.evidence}))}
}

/** The journal is the authority for an already enqueued packet, even if the
 * current projection/formatter/material descriptors have since changed. */
export function retainExecutionPacket(packet,retained){
 if(!retained)return packet
 if(retained.id!==packet.id||retained.source?.kind!=='task-input'||!isDeepStrictEqual(retained.source.taskSession,packet.source.taskSession))throw Object.assign(new Error('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'})
 packet.source=structuredClone(retained.source);packet.content=structuredClone(retained.content)
 return packet
}
