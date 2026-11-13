import {isDeepStrictEqual} from 'node:util'
import {conversationSource} from '../channels/message-safety.js'
// Model view only. SQL and Pi retain the original source/actions/effect receipts.
// In particular, never copy audit histories and mutable scheduling queues here.
const fields=['taskId','sessionId','ownerActorId','groupId','conversationId','title','objective','request','requirements','requirementRevision','contextRevision','controlRevision','leaseEpoch','status','control','sourceRefs','dependencies','archiveRestore']
export function executionTaskBrief(task){
 if(!task)return task
 return Object.fromEntries(fields.filter(key=>task[key]!==undefined).map(key=>[key,task[key]]))
}
export function executionContext(input,audit=[]){
 const admitted=new Set(audit.filter(row=>row.domain==='admission'&&row.kind==='admitted').map(row=>row.payload.id))
 const prior=[]
 for(const row of audit){
  if(row.domain!=='admission'||!['enqueued','enqueued-internal'].includes(row.kind)||!admitted.has(row.payload.id)||row.payload.source?.kind!=='task-input')continue
  try{prior.push(JSON.parse(row.payload.content[0].text))}catch{}
 }
 const seenSources=new Map(prior.flatMap(body=>(body.sources??[]).map(source=>[source.sourceId,source.version])))
 const sources=(input.sources??[]).filter(source=>!seenSources.has(source.sourceId)||seenSources.get(source.sourceId)!==source.version).map(({stages,...source})=>conversationSource(source))
 // Review inputs must retain the exact original candidates even when previously seen.
 const selected=input.humanReview||input.dialogue?(input.sources??[]).map(({stages,...source})=>conversationSource(source)):sources
 const ids=new Set(selected.map(source=>source.sourceId))
 const last=prior.at(-1),revision=last?.task?.contextRevision??-1
 const updates=(input.task?.supplements??[]).filter(item=>item.contextRevision>revision&&(item.requirementRevision===undefined||item.requirementRevision===input.task.requirementRevision)).map(({id,text,contextRevision})=>({id,text,contextRevision}))
 if(input.task?.currentInput&&!updates.some(row=>row.id===input.task.currentInput.id)&&!prior.some(body=>body.currentInput?.id===input.task.currentInput.id||body.supplement?.messageId===input.task.currentInput.id||body.updates?.some(row=>row.id===input.task.currentInput.id)))updates.push(input.task.currentInput)
 return {task:executionTaskBrief(input.task),sources:selected,materials:input.materials?.filter(item=>ids.has(item.sourceId)).map(conversationSource),updates,
  dialogue:input.dialogue,humanReview:input.humanReview,blockers:input.blockers}
}

/** The journal is the authority for an already enqueued packet, even if the
 * current projection/formatter/material descriptors have since changed. */
export function retainExecutionPacket(packet,retained){
 if(!retained)return packet
 if(retained.id!==packet.id||retained.source?.kind!=='task-input'||!isDeepStrictEqual(retained.source.taskSession,packet.source.taskSession))throw Object.assign(new Error('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'})
 packet.source=structuredClone(retained.source);packet.content=structuredClone(retained.content)
 return packet
}
