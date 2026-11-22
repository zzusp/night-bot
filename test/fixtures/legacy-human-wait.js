import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
// Offline historical snapshot fixture, matching the persisted task/humanRequest
// and notification.prepare v1 shapes before 3739b753 (main 87121030).
// Never calls a current production command to create a retired question.
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
export function restoreLegacyHumanWait(dbPath,taskId,decision,{audience=decision.audience??'requester',prepareNotice=false,operatorUserId,requestId='legacy-question:'+taskId}={}){
 const db=new DatabaseSync(dbPath)
 try{
  const task=JSON.parse(db.prepare('SELECT body FROM dynamic_tasks WHERE id=?').get(taskId).body)
  assert.equal(task.drained,true,'restore only into a stopped isolated fixture')
  assert.ok(!task.humanRequests?.length,'never overwrite a historical request')
  const stamp=task.completion?.at??task.lastDecision?.at
  assert.ok(stamp,'the scaffold must have a recorded stop')
  if(task.status==='completed'){
   assert.ok(['wait','blocked'].includes(task.completion?.result?.action),'only a synthetic stopped scaffold can become a legacy wait')
   // Place the historical wait in a later run; keep the scaffold's real completion receipt intact.
   task.status='active';task.completion=null;task.requirementRevision++;task.controlRevision++;task.runSequence++
  }
  assert.equal(task.status,'active')
  const request={requestId,audience,status:'waiting-reply',question:decision.question,reason:decision.summary,waitingReason:decision.summary,objective:task.objective,evidence:decision.evidence??[],attemptedActions:decision.attemptedActions??[],requirementRevision:task.requirementRevision,controlRevision:task.controlRevision,createdAt:stamp}
  task.humanRequests=[request]
  task.lastDecision={...task.lastDecision,...decision,question:decision.question,action:'blocked'}
  db.prepare('UPDATE dynamic_tasks SET body=? WHERE id=?').run(JSON.stringify(task),taskId)
  let notification
  if(prepareNotice){
   const source=task.sourceRefs.map(id=>db.prepare('SELECT body FROM dynamic_sources WHERE id=?').get(id)).filter(Boolean).map(row=>JSON.parse(row.body)).find(source=>source.channel!=='web')
   if(audience==='operator'||source){
    const id=audience==='operator'?'operator-request:'+requestId:`question:${taskId}:${requestId}`
    const payload=audience==='operator'?{text:decision.question+'\n\n请在人工介入页答复，或引用本消息回复处理结果。',audience,humanRequestId:requestId,recipientUserId:operatorUserId,fact:{taskId},kind:'question'}:{text:decision.question,audience,humanRequestId:requestId,conversationId:source.groupId,sourceMessageId:source.messageId,actorId:source.actorId,sourceId:source.sourceId,sourceVersion:source.version,recipientActorIds:[source.actorId],fact:{taskId},kind:'question'}
    const body={taskId,requirementRevision:task.requirementRevision,kind:'question',payload}
    notification={id,notificationId:id,...body,payloadDigest:createHash('sha256').update(canonical(body)).digest('hex'),state:'prepared',createdAt:stamp,updatedAt:stamp}
    db.prepare('INSERT INTO dynamic_notifications(id,body) VALUES (?,?)').run(id,JSON.stringify(notification))
   }
  }
  return {task,notification}
 }finally{db.close()}
}
