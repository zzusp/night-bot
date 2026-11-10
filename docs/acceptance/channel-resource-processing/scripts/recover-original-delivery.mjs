import assert from 'node:assert/strict'
import {readFile,readdir,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {setTimeout} from 'node:timers/promises'
import {taskNotificationRecovery} from '../../../../packages/dingtalk-core/notification-delivery.js'
import {assertWorkflowNotificationReply,taskReplySendRetryProof} from '../../../../packages/dingtalk-core/group-message.js'
import {taskFilePath} from '../../../../packages/dingtalk-core/session-workspaces.js'

// 只续操作者指定的原冻结交付；不改账本、不调用 vendor CLI，不重新执行任务。
const [mode,installation,notificationId]=process.argv.slice(2)
assert.ok(['--check','--apply','--verify'].includes(mode));assert.ok(installation&&notificationId)
const root=resolve(installation),data=join(root,'data'),config=JSON.parse(await readFile(join(data,'config/config.json'),'utf8'))
assert.equal(config.resident.host,'127.0.0.1')
const db=new DatabaseSync(join(data,'state/tasks.sqlite'),{readOnly:true})
const hash=value=>createHash('sha256').update(value).digest('hex')
const get=(table,id)=>JSON.parse(db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id).body)
const parent=get('dynamic_notifications',notificationId),task=get('dynamic_tasks',parent.taskId),source=get('dynamic_sources',parent.payload.sourceId)
const parts=()=>db.prepare("SELECT body FROM dynamic_notifications WHERE id=? OR json_extract(body,'$.payload.deliveryId')=?").all(notificationId,notificationId).map(row=>JSON.parse(row.body))
const sourceOrigin=({stages,...origin})=>origin
const before=parts(),taskHash=hash(JSON.stringify(task)),sourceHash=hash(JSON.stringify(sourceOrigin(source)))
assert.equal(task.status,'completed');assert.equal(task.control,'active');assert.equal(task.requirementRevision,parent.requirementRevision)
assert.equal(source.version,parent.payload.sourceVersion);assert.equal(source.groupId,parent.payload.conversationId)
assert.deepEqual(parent.payload.sourceRef,{messageId:source.messageId,messageVersion:source.version,actorId:source.actorId})
assert.ok(!task.archivedAt&&!source.authorizationRevoked&&!source.triageHold&&!source.archiveRestoreHold)
assertWorkflowNotificationReply({...parent,replySourceText:source.text})
const recovery=taskNotificationRecovery(parent)
if(mode!=='--verify'){assert.ok(taskReplySendRetryProof(parent));assert.equal(recovery.action,'send')}
const files=[]
for(const part of before.filter(row=>row.payload.artifact)){
 const artifact=part.payload.artifact
 assert.equal(part.state,mode==='--verify'?'delivered':'prepared');assert.equal(part.sendAttemptCount??0,mode==='--verify'?1:0)
 const bytes=await readFile(join(taskFilePath(join(data,'workspaces'),task.taskId,'outputs'),artifact.fileRef))
 assert.equal(bytes.length,artifact.size);assert.equal(hash(bytes),artifact.sha256)
 files.push({fileName:artifact.fileName,size:artifact.size,sha256:artifact.sha256})
}
assert.equal(files.length,parent.payload.taskDelivery.artifactIds.length)
const sessions=taskFilePath(join(data,'workspaces'),task.taskId,'sessions')
async function journals(){
 const entries=await readdir(sessions,{recursive:true,withFileTypes:true}),out={}
 for(const entry of entries.filter(entry=>entry.isFile()&&entry.name.endsWith('.jsonl'))){const file=join(entry.parentPath,entry.name);out[file]=hash(await readFile(file))}
 return out
}
const beforeJournals=await journals()
const health=await fetch('http://127.0.0.1:'+config.resident.port+'/health').then(r=>r.json());assert.equal(health.status,'ok')
console.log(JSON.stringify({check:'PASS',effects:0,files:files.length,payloadDigest:parent.payloadDigest,taskCompleted:true,journals:Object.keys(beforeJournals).length}))
if(mode==='--verify'){
 assert.equal(parent.state,'delivered');assert.equal(parent.sendAttemptCount,2)
 for(const part of before){assert.equal(part.state,'delivered');assert.ok(part.receipt?.messageId);if(part.payload.artifact){assert.equal(part.receipt.sha256,part.payload.artifact.sha256);assert.equal(part.receipt.size,part.payload.artifact.size);assert.equal(part.receipt.artifactId,part.payload.artifact.artifactId)}}
 for(const file of Object.keys(beforeJournals))assert.ok((await stat(file)).mtimeMs<Date.parse(parent.sendStartedAt),'task journal must predate notification retry')
 console.log(JSON.stringify({event:'verified-persisted-delivery',textDelivered:true,filesDelivered:files.length,files,platformFileReceiptsVerified:true,taskCompleted:true,taskJournalPredatesRetry:true,parts:before.map(row=>({part:row.payload.artifact?'file':'text',state:row.state,attempts:row.sendAttemptCount,receiptVerified:true}))}))
}
if(mode==='--apply'){
 const url='http://127.0.0.1:'+config.resident.port+'/config/groups/'+encodeURIComponent(source.groupId)+'/notifications/'+encodeURIComponent(notificationId)+'/retry'
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedToken:recovery.expectedToken})})
 const result=await response.json();if(!response.ok)throw Object.assign(new Error('HOST_RECOVERY_REJECTED'),{status:response.status,code:result.error?.code??result.error})
 let previous
 for(;;){
  const current=parts(),states=current.map(row=>row.state).join(',')
  if(states!==previous){console.log(JSON.stringify({event:'delivery-state',states:current.map(row=>({part:row.payload.artifact?'file':'text',state:row.state,attempts:row.sendAttemptCount??0,code:row.lastReadbackError?.code??row.deliveryError?.code}))}));previous=states}
  if(current.some(row=>row.state==='failed'||row.state==='superseded'))throw new Error('ORIGINAL_DELIVERY_FAILED')
  if(current.every(row=>row.state==='delivered')){
   assert.equal(current.length,before.length)
   for(const row of current){const original=before.find(value=>value.id===row.id);assert.ok(original);assert.deepEqual(row.payload,original.payload);assert.equal(row.payloadDigest,original.payloadDigest);assert.equal(row.sendAttemptCount,row.payload.artifact?1:2);assert.ok(row.receipt?.messageId)}
   assert.equal(hash(JSON.stringify(get('dynamic_tasks',task.taskId))),taskHash)
   assert.equal(hash(JSON.stringify(sourceOrigin(get('dynamic_sources',source.sourceId)))),sourceHash)
   assert.deepEqual(await journals(),beforeJournals)
   for(const row of current.filter(row=>row.payload.artifact)){assert.equal(row.receipt.sha256,row.payload.artifact.sha256);assert.equal(row.receipt.size,row.payload.artifact.size);assert.equal(row.receipt.artifactId,row.payload.artifact.artifactId)}
   console.log(JSON.stringify({event:'verified-delivery',checkedAt:new Date().toISOString(),textDelivered:true,filesDelivered:files.length,files,originalPayloadsUnchanged:true,taskUnchanged:true,sourceOriginUnchanged:true,taskJournalsUnchanged:true,duplicateSends:0,parts:current.map(row=>({part:row.payload.artifact?'file':'text',state:row.state,attempts:row.sendAttemptCount,readbacks:row.readbackAttemptCount??0,receiptVerified:true}))}))
   break
  }
  await setTimeout(1000)
 }
}
db.close()
