import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {inspectionVersion} from '../tasks/inspection.js'
import {routerTaskSummary} from './router-task-view.js'

const replyId=parts=>'router-operation:'+createHash('sha256').update(JSON.stringify(parts)).digest('hex')
export const completionReplyId=(conversationId,eventId,sourceId,messageVersion)=>replyId([conversationId,'completion-reply',eventId,sourceId,messageVersion])
export const blockedReplyId=(conversationId,eventId)=>replyId([conversationId,'continued-blocked-reply',eventId])
const stoppedExecution=event=>event?.kind==='task.inspection'&&event.reason==='execution-failed'&&event.expected?.drained===true&&(!!event.sessionId||!!event.brief?.technicalFailure)
export const isTaskOutcome=event=>event?.kind==='task.completed'||event?.kind==='task.blocked'&&event.resultSource==='pi-task-result'||stoppedExecution(event)
export const suppressChannelOutcome=task=>!!task.webTaskOutcome
 &&task.webTaskOutcome.requirementRevision===task.requirementRevision
 &&task.webTaskOutcome.controlRevision===task.controlRevision
 &&(task.webTaskOutcome.contextRevision===(task.contextRevision??0)
 ||Number.isInteger(task.webTaskOutcome.leaseEpoch)&&task.webTaskOutcome.leaseEpoch===task.leaseEpoch)
 ||task.supplements?.some(row=>row.suppressChannelOutcome===true
 &&row.contextRevision===task.contextRevision&&row.requirementRevision===task.requirementRevision)===true
export const outcomeOriginId=task=>task?.metadata?.authorizationSourceId??task?.sourceRefs?.[0]
export const isOutcomeChannelSource=(source,conversationId)=>source?.groupId===conversationId&&['im','chat','chat-room'].includes(source.channel)&&source.routed===true
export function currentOutcomeBinding(task,event,conversationId){
 if(!isTaskOutcome(event)||!task||event.taskId!==task.taskId||task.groupId!==conversationId||task.archivedAt||task.archiveRestoreHold||task.archiveRestore?.reviewRequired
   ||event.requirementRevision!==task.requirementRevision||event.controlRevision!==task.controlRevision)return
 if(event.kind==='task.completed'){
  const completion=task.completion
  if(task.status!=='completed'||completion?.commandId!==event.commandId||completion?.requirementRevision!==event.requirementRevision||completion?.controlRevision!==event.controlRevision)return
 }else if(stoppedExecution(event)){
  if(task.status!=='active'||task.control!=='active'||!task.inspection?.pending||task.inspection.key!==event.inspectionKey
    ||!isDeepStrictEqual(event.expected,inspectionVersion(task))
    ||(event.sessionId!==undefined?event.sessionId!==task.sessionId:!isDeepStrictEqual(event.brief.technicalFailure,task.technicalFailure)))return
 }else{
  const decision=task.lastDecision
  if(task.status!=='active'||task.control!=='active'||decision?.action!=='blocked'||!isDeepStrictEqual(decision,event.result)
    ||decision.requirementRevision!==task.requirementRevision||decision.controlRevision!==task.controlRevision||decision.contextRevision!==(task.contextRevision??0))return
 }
 return {eventId:event.id,taskId:task.taskId,...event.commandId!==undefined?{commandId:event.commandId}:{},requirementRevision:event.requirementRevision,controlRevision:event.controlRevision}
}
const bounded=(values,max=8)=>({items:(Array.isArray(values)?values:[]).slice(0,max),truncated:Array.isArray(values)&&values.length>max})
const clip=(value,max=2048)=>typeof value==='string'?value.slice(0,max):''
// The reply anchor remains stable. Its wording scope follows the exact inputs
// that were handed to the Work for this revision, not the rewritten handoff.
export async function outcomeReplyScope(query,conversationId,task,event,original){
 const seen=new Set([original.sourceId]),refs=[]
 for(const row of (task.metadata?.routerHandoffs??[]).toReversed()){
  if(row.requirementRevision!==event.requirementRevision||row.contextRevision>(event.contextRevision??task.contextRevision??0)
    ||seen.has(row.sourceId)||!task.sourceRefs.includes(row.sourceId))continue
  seen.add(row.sourceId);refs.push(row)
 }
 const updates=[]
 for(const ref of refs.reverse()){
  const source=await query('router.source-current',{conversationId,sourceId:ref.sourceId})
  if(source?.sourceId!==ref.sourceId||source.conversationId!==conversationId||source.version!==ref.messageVersion
    ||source.retracted||source.authorizationRevoked||source.triageHold||source.archiveRestoreHold||typeof source.text!=='string')continue
  updates.push({sourceId:source.sourceId,messageVersion:source.version,text:source.text})
 }
 return {outcomeEventId:event.id,sourceId:original.sourceId,messageVersion:original.version,text:original.text,
  ...updates.length?{updates}:{}}
}

export function completionResultView(result){
 const value=result??{},evidence=bounded(value.evidence),limitations=bounded(value.limitations)
 const refs=evidence.items.map(item=>typeof item==='string'?clip(item,300):Object.fromEntries(['ref','path','id','summary'].filter(k=>typeof item?.[k]==='string').map(k=>[k,clip(item[k],300)])))
 return {...typeof value.action==='string'?{action:value.action}:{},summary:clip(value.summary),evidence:refs,limitations:limitations.items.map(x=>clip(x,512)),
  detailAvailable:true,omittedFields:Object.keys(value).filter(key=>!['action','summary','evidence','limitations','artifactFiles','artifacts','deliveryFiles'].includes(key)),truncated:evidence.truncated||limitations.truncated||JSON.stringify(value.evidence??[]).length>JSON.stringify(refs).length||JSON.stringify(value.limitations??[]).length>JSON.stringify(limitations.items.map(x=>clip(x,512))).length||typeof value.summary==='string'&&value.summary.length>2048,
  artifactCount:Array.isArray(value.artifactFiles)?value.artifactFiles.length:0}
}
// Read projections only: current Host commands still recheck source, generation,
// revisions, dependencies, effects and the original single execution session.
export async function routerTaskContext(query,conversationId,taskId,{completionEvent}={}){
 const task=await query('task.get',{taskId})
 if(!task||task.groupId!==conversationId||task.conversationId&&task.conversationId!==conversationId)return {status:'unavailable',taskId}
 const summary=routerTaskSummary(task),request=clip(task.request),dependencies=await query('router.dependencies',{conversationId,taskId}),selected=bounded(dependencies)
 const value={status:'ready',task:summary,request,requestTruncated:typeof task.request==='string'&&task.request.length>request.length,
  dependencies:selected.items,dependenciesTruncated:selected.truncated,readOnly:true,asOf:new Date().toISOString()}
 value.requiresFullRead=!!task.archiveRestoreHold||!!task.archiveRestore?.reviewRequired||value.requestTruncated||selected.truncated||!!summary.truncatedFields?.length
 if(completionEvent){
  const proof=completionEvent.taskEvent
  if(completionEvent.taskId!==taskId||completionEvent.kind!=='task.completed'||proof?.kind!=='task.completed'||proof.taskId!==taskId||proof.id!==completionEvent.taskEventId||proof.commandId!==task.completion?.commandId||task.status!=='completed'||proof.requirementRevision!==task.requirementRevision||proof.controlRevision!==task.controlRevision||task.completion.requirementRevision!==task.requirementRevision||task.completion.controlRevision!==task.controlRevision||task.archivedAt||task.archiveRestoreHold||task.archiveRestore?.reviewRequired)return {...value,completion:{status:'stale',eventId:completionEvent.taskEventId}}
  const sources=bounded(task.sourceRefs),sourceViews=[]
  for(const sourceId of sources.items){
   const source=await query('router.source-current',{conversationId,sourceId})
   if(source?.sourceId!==sourceId||source.conversationId!==conversationId||!Number.isSafeInteger(source.version)||source.retracted||source.authorizationRevoked||source.triageHold||source.archiveRestoreHold){sourceViews.push({sourceId,status:'unavailable'});continue}
   const receipts=await query('router.reply-history',{conversationId,sourceId,limit:3})
   const notificationId=completionReplyId(conversationId,proof.id,sourceId,source.version),completionReply=await query('router.reply-history',{conversationId,notificationId,limit:1})
   sourceViews.push({sourceId,messageId:source.messageId,messageVersion:source.version,actorId:source.actorId,status:'current',completionReply:{...completionReply,notificationId,replies:completionReply.replies.filter(row=>row.notificationId===notificationId&&row.sourceId===sourceId&&row.messageVersion===source.version&&row.completionEventId===proof.id)},replyHistory:{...receipts,replies:receipts.replies.filter(row=>row.sourceId===sourceId&&row.messageVersion===source.version)}})
  }
  value.completion={status:'current',eventId:proof.id,commandId:proof.commandId,summary:clip(task.completion.summary),summaryTruncated:typeof task.completion.summary==='string'&&task.completion.summary.length>2048,
   result:completionResultView(task.completion.result),sources:sourceViews,sourcesTruncated:sources.truncated,at:task.completion.at,
   evidenceStatus:'recorded-task-result-not-independent-verification'}
  value.completion.requiresFullRead=value.completion.summaryTruncated||value.completion.result.truncated||!!value.completion.result.omittedFields.length
  value.completion.fullRequiredFor=['dependency-evaluation','artifact-delivery']
 }
 return value
}
