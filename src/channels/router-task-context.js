import {createHash} from 'node:crypto'
import {routerTaskSummary} from './router-task-view.js'

export const completionReplyId=(conversationId,eventId,sourceId,messageVersion)=>'router-operation:'+createHash('sha256').update(JSON.stringify([conversationId,'completion-reply',eventId,sourceId,messageVersion])).digest('hex')
const bounded=(values,max=8)=>({items:(Array.isArray(values)?values:[]).slice(0,max),truncated:Array.isArray(values)&&values.length>max})
const clip=(value,max=2048)=>typeof value==='string'?value.slice(0,max):''
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
