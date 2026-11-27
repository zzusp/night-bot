import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {taskNotificationRecovery} from '../packages/dingtalk-core/notification-delivery.js'
import {blockUnsupportedAttachment,withoutAttachmentPromise} from '../packages/dingtalk-core/group-notification.js'

const contents='# 现场核对草稿\n合成测试内容。\n'
const reply='核对已完成，见附件。'
const call=(tool,args)=>({tool,args})
const result=(body,name)=>body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name===name

test('attachment preflight never replaces a claimed send or an existing receipt',()=>{
 assert.equal(withoutAttachmentPromise(reply),'核对已完成。\n\n文件已保留，当前会话不支持发送附件。')
 for(const notification of [{state:'unknown'},{state:'delivered',receipt:{messageId:'actual'}},{state:'prepared',sendStartedAt:'now'},{state:'prepared',sendPermit:{attempt:1}}]){
  const before=structuredClone(notification)
  assert.equal(blockUnsupportedAttachment(notification,'later'),false)
  assert.deepEqual(notification,before)
 }
})

test('Router respects file capabilities and preserves independently proven attachment and text receipts',{timeout:nativeTestTimeout(65000)},async t=>{
 let h
 const planned=new Map(),replied=new Set(),receipts=new Map(),attempts=[]
 const capabilities={conversationTypes:['chat','chat-room'],files:['chat-room'],standaloneMarkdown:true}
 let holdOldFile=true
 h=await residentRouterHost(t,async body=>{
  const names=requestTools(body)
  if(names.includes('task_result')){
   if(result(body,'task_result'))return {text:'Done'}
   if(!result(body,'write'))return call('write',{path:'work/report.md',content:contents})
   return call('task_result',{decision:{action:'complete',summary:'核对已完成。',evidence:[],limitations:[],artifacts:['work/report.md'],deliveryFiles:[{path:'work/report.md',caption:'核对草稿'}]}})
  }
  if(!names.includes('resident_router_settle'))return {text:'No work'}
  if(result(body,'resident_router_settle'))return {text:'Settled'}
  const packet=requestEnvelope(body,'Router 请求：'),event=packet.events.find(row=>row.source)
  if(event?.source.messageId==='send-existing'){
   if(result(body,'resident_router_reply'))return call('resident_router_settle',{operationId:'settle-resend',eventIds:packet.events.map(row=>row.id),
    noTaskDispositions:[{eventId:event.id,outcome:'handled-inline',reason:'Delivered through Router outbox.',sourceQuote:event.source.text}]})
   const task=await h.query('task.get',{taskId:'task-private'})
   return call('resident_router_reply',{operationId:'send-existing',sourceId:event.sourceId,messageVersion:event.messageVersion,text:'原文件见附件。',replyPurpose:'direct-answer',
    taskDelivery:{taskId:task.taskId,requirementRevision:task.requirementRevision,artifactIds:task.completion.result.artifactFiles.map(file=>file.artifact.artifactId)}})
  }
  if(event&&!planned.has(event.source.messageId)){
   const id='task-'+event.source.messageId
   planned.set(event.source.messageId,{id,source:event.source})
   return call('resident_task_plan',{operationId:id,sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:id,title:id,objective:'创建一次合成测试草稿',requirements:[],handoff:'在 work/report.md 保留合成测试草稿'}],dependencies:[]})
  }
  const done=packet.events.find(row=>row.kind==='task.completed')
  if(done&&!replied.has(done.taskId)){
   replied.add(done.taskId)
   const {source}=[...planned.values()].find(row=>row.id===done.taskId)
   const task=await h.query('task.get',{taskId:done.taskId})
   return call('resident_router_reply',{operationId:'reply-'+done.taskId,sourceId:source.sourceId,messageVersion:source.version,text:reply,completionEventId:done.taskEventId,replyPurpose:'task-update',
    taskDelivery:{taskId:done.taskId,requirementRevision:task.requirementRevision,artifactIds:task.completion.result.artifactFiles.map(file=>file.artifact.artifactId)}})
  }
  return call('resident_router_settle',{operationId:'settle-'+packet.events.map(row=>row.id).join(','),eventIds:packet.events.map(row=>row.id)})
 },{
  strictModelDecisions:true,transportCapabilities:capabilities,
  canSend:row=>!(holdOldFile&&row.payload.artifact&&row.payload.sourceRef.messageId==='old'),
  async send(envelope){
   const receipt={messageId:'text-proof-'+attempts.length,visible:true}
   attempts.push({kind:'text',envelope});receipts.set(envelope.deliveryKey,receipt);return {ack:true}
  },
  readback:envelope=>receipts.get(envelope.deliveryKey),
  async sendFile(envelope,notification,file){
   assert.equal(await readFile(file.path,'utf8'),contents)
   const receipt={messageId:'file-proof-'+attempts.length,visible:true,artifactId:notification.payload.artifact.artifactId}
   attempts.push({kind:'file',envelope});receipts.set(envelope.deliveryKey,receipt);return {ack:true}
  },
  readbackFile:envelope=>receipts.get(envelope.deliveryKey)
 })
 const parts=async messageId=>(await h.query('notification.list')).filter(row=>row.payload.sourceRef?.messageId===messageId)
 async function deliver(message,attachmentState){
  await h.receive(message)
  await eventually(async()=>{
   const rows=await parts(message.messageId),parent=rows.find(row=>!row.payload.artifact),file=rows.find(row=>row.payload.artifact)
   return parent?.state==='delivered'&&file?.state===attachmentState?true:undefined
  },`${message.messageId} delivery states`).catch(async error=>{t.diagnostic(JSON.stringify({results:h.results.map(x=>[x.name,x.result.error??x.result.value]),parts:await parts(message.messageId),alerts:h.service.listAlerts()}));throw error})
  await h.service.whenIdle()
  return parts(message.messageId)
 }
 const privateParts=await deliver(channelMessage('private',{type:'chat',conversationId:'private-room'}),'failed')
 const parent=privateParts.find(row=>!row.payload.artifact),file=privateParts.find(row=>row.payload.artifact)
 assert.match(parent.payload.text,/核对已完成/)
 assert.match(parent.payload.text,/当前会话不支持发送附件/)
 assert.doesNotMatch(parent.payload.text,/见附件/)
 assert.equal(file.deliveryError.code,'CHANNEL_FILE_DELIVERY_UNSUPPORTED')
 assert.equal(file.deliveryError.knownNotSent,true)
 assert.equal(file.deliveryError.retryable,false)
 assert.equal(file.sendPermit,undefined)
 assert.equal(taskNotificationRecovery(file).action,null)
 assert.equal((await h.query('task.get',{taskId:'task-private'})).completion.result.artifactFiles[0].artifact.sha256,file.payload.artifact.sha256)
 assert.deepEqual(attempts.map(row=>row.kind),['text'])
 const groupParts=await deliver(channelMessage('group'),'delivered')
 assert.ok(groupParts.every(row=>row.receipt?.messageId))
 assert.equal(groupParts.find(row=>!row.payload.artifact).payload.text,reply)
 assert.deepEqual(attempts.map(row=>row.kind),['text','text','file'])
 const oldParts=await deliver(channelMessage('old',{conversationId:'other-group'}),'prepared')
 assert.ok(oldParts.find(row=>row.payload.artifact))
 capabilities.files=[]
 holdOldFile=false
 await h.restart();await h.service.whenIdle()
 const recovered=(await parts('old')).find(row=>row.payload.artifact)
 assert.equal(recovered.state,'failed')
 assert.equal(recovered.deliveryError.code,'CHANNEL_FILE_DELIVERY_UNSUPPORTED')
 assert.equal(recovered.sendPermit,undefined)
 assert.deepEqual(attempts.map(row=>row.kind),['text','text','file','text'])
 assert.match((await parts('old')).find(row=>!row.payload.artifact).receipt.messageId,/text-proof-/)
 capabilities.files=['chat-room']
 await h.restart();await h.service.whenIdle()
 assert.equal((await parts('old')).find(row=>row.payload.artifact).state,'failed')
 assert.deepEqual(attempts.map(row=>row.kind),['text','text','file','text'])
 capabilities.files=['chat-room','chat']
 const before=(await h.query('task.list')).length
 const resend=await deliver(channelMessage('send-existing',{type:'chat',conversationId:'private-room',text:'请把原草稿文件发给我。'}),'delivered')
 assert.equal(resend.find(row=>row.payload.artifact).payload.artifact.sha256,file.payload.artifact.sha256)
 assert.equal((await h.query('task.list')).length,before)
 assert.deepEqual(attempts.slice(-2).map(row=>[row.kind,row.envelope.type,row.envelope.conversationId]),[['text','chat','private-room'],['file','chat','private-room']])
})
