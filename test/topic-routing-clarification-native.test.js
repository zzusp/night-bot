import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {taskNotificationRecovery} from '../packages/dingtalk-core/notification-delivery.js'

// The former Topic hold/epoch is retired. Clarification is a source-bound
// Router reply; a later authenticated source resumes the same logical Router.
for(const unknown of [false,true])test(`Router clarification retains exact source identity through cold recovery without self-echo or duplicate sends: unknown=${unknown}`,{timeout:nativeTestTimeout(50000)},async t=>{
 let h,readable=!unknown,modelCalls=0
 const question='请说明要核查哪张发票？'
 h=await residentRouterHost(t,body=>{
  modelCalls++
  const names=requestTools(body)
  if(names.includes('channel_triage_submit')){
   const input=requestEnvelope(body,'一级分诊请求：')
   return{tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'原交办需要明确核查对象'}))}}
  }
  if(names.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
   const accepted=h.results.filter(row=>!row.result.isError&&row.name==='resident_router_reply').map(row=>row.result.value?.notification?.payload?.sourceId??row.result.value?.payload?.sourceId)
   const settled=h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1).result.isError
   if(body.messages.at(-1)?.role==='tool'&&settled)return{text:'本批处置已提交'}
   if(source&&!accepted.includes(source.sourceId))return{tool:'resident_router_reply',args:{operationId:'clarify:'+source.sourceId,sourceId:source.sourceId,messageVersion:source.version,text:source.messageId==='clarify'?question:'收到明确对象，后续按该发票核查。'}}
   return{tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
  }
  const input=requestEnvelope(body,'Router 交接请求：')
  return{text:JSON.stringify({currentIntent:'原问题对象未明确，不创建空任务；后续只认新原文',unresolvedQuestions:[question],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff})}
 },{send:async()=>{if(unknown&&!readable)throw Error('lost send acknowledgement');return{messageId:'clarification-visible'}},readback:async()=>{if(!readable)throw Error('readback unavailable');return{messageId:'clarification-visible',visible:true}}})
 const original=channelMessage('clarify',{text:'assistant，请核查那张发票。'})
 await h.receive(original);await h.service.whenIdle()
 let notice=(await h.query('notification.list'))[0]
 assert.ok(notice);assert.equal(notice.kind,'router-reply');assert.equal(notice.taskId,null);assert.equal(notice.payload.text,question)
 assert.deepEqual(notice.payload.sourceRef,{messageId:'clarify',messageVersion:1,actorId:h.host.ctx.channels.identity(original).principal});assert.equal(h.sent[0].senderId,'alice');assert.deepEqual(notice.payload.topicRefs,[])
 assert.equal(notice.state,unknown?'unknown':'delivered');assert.equal(h.sent.length,1);assert.deepEqual(await h.query('task.list'),[])
 const state=await h.query('router.get',{conversationId:notice.payload.conversationId})
 const source=await h.query('source.get',{sourceId:notice.payload.sourceId});assert.equal(source.routed,true)
 const requests=modelCalls
 readable=true;await h.restart();await h.service.whenIdle()
 notice=await h.query('notification.get',{notificationId:notice.id})
 if(notice.state!=='delivered'){await h.service.retryNotification({groupId:notice.payload.conversationId,notificationId:notice.id,expectedToken:taskNotificationRecovery(notice).expectedToken});await h.service.whenIdle()}
 assert.equal((await h.query('notification.get',{notificationId:notice.id})).state,'delivered');assert.equal(h.sent.length,1);assert.equal(modelCalls,requests)
 const echo=await h.receive(channelMessage('clarification-visible',{text:question}));assert.equal(echo.reason,'own-notification')
 await h.receive(original);await h.service.whenIdle();assert.equal(h.sent.length,1);assert.equal(modelCalls,requests)
 await h.receive(channelMessage('clarify-answer',{text:'assistant，是本月新开的发票。'}));await h.service.whenIdle()
 const current=await h.query('router.get',{conversationId:notice.payload.conversationId});assert.equal(current.id,state.id);assert.ok(current.cursor>state.cursor)
 assert.equal((await h.query('notification.list')).length,2);assert.equal(h.sent.length,2);assert.deepEqual(await h.query('task.list'),[])
})

for(const firstState of ['prepared','unknown'])test(`a newer authenticated message version fences an old ${firstState} Router reply without granting another send`,{timeout:nativeTestTimeout(50000)},async t=>{
 let h,hold=firstState==='prepared',readable=false
 h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(names.includes('channel_triage_submit')){
   const input=requestEnvelope(body,'一级分诊请求：')
   return{tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'按当前认证版本处理澄清'}))}}
  }
  if(names.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
   if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return{text:'已结清本批'}
   const accepted=h.results.some(row=>row.name==='resident_router_reply'&&!row.result.isError&&row.result.value?.notification?.payload?.sourceId===source?.sourceId)
   if(source&&!accepted)return{tool:'resident_router_reply',args:{operationId:'versioned-clarification:'+source.sourceId,sourceId:source.sourceId,messageVersion:source.version,text:source.version===1?'旧版对象尚未明确，请补充。':'按新版明确对象继续核查。'}}
   return{tool:'resident_router_settle',args:{operationId:'versioned-settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
  }
  const input=requestEnvelope(body,'Router 交接请求：')
  return{text:JSON.stringify({currentIntent:'只认当前来源版本，未知发送仅回读旧收据',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff})}
 },{wrapStore:store=>({...store,command:async command=>{
   if(hold&&command.kind==='notification.start')throw Object.assign(Error('fixture holds dispatch before start'),{code:'DYNAMIC_NOTIFICATION_SOURCE_PENDING'})
   return store.command(command)
  }}),send:async envelope=>{
   const notice=await h.query('notification.get',{notificationId:envelope.deliveryKey})
   if(notice.payload.sourceRef.messageVersion===1&&firstState==='unknown')throw Error('lost original acknowledgement')
   return{messageId:'visible-version-'+notice.payload.sourceRef.messageVersion}
  },readback:async envelope=>{
   const notice=await h.query('notification.get',{notificationId:envelope.deliveryKey})
   if(notice.payload.sourceRef.messageVersion===1&&!readable)throw Error('original readback unavailable')
   return{messageId:'visible-version-'+notice.payload.sourceRef.messageVersion,visible:true}
  }})
 const original=channelMessage('edited-clarification',{messageVersion:1,text:'assistant，核查那张发票。'})
 await h.receive(original);await h.service.whenIdle()
 const old=(await h.query('notification.list')).find(row=>row.payload.sourceRef.messageVersion===1)
 assert.ok(old);assert.equal(old.state,firstState)
 assert.equal(h.sent.filter(envelope=>envelope.deliveryKey===old.id).length,firstState==='unknown'?1:0)
 // Hold before notification.start, never after a transport effect, then admit v2.
 hold=false
 await h.receive({...original,messageVersion:2,text:'assistant，改为核查本月新开的发票。'});await h.service.whenIdle()
 const latest=(await h.query('notification.list')).find(row=>row.payload.sourceRef.messageVersion===2)
 assert.ok(latest);assert.equal(latest.state,'delivered');assert.notEqual(latest.payload.sourceId,old.payload.sourceId)
 await h.service.recover();await h.service.whenIdle()
 assert.equal(h.sent.filter(envelope=>envelope.deliveryKey===old.id).length,firstState==='unknown'?1:0)
 if(firstState==='prepared'){
  await assert.rejects(h.store.command({id:'force-old-prepared-start',kind:'notification.start',args:{notificationId:old.id}}),{code:'DYNAMIC_TRIAGE_SOURCE_STALE'})
  assert.equal((await h.query('notification.get',{notificationId:old.id})).state,'prepared')
 }else{
  readable=true
  const pending=await h.query('notification.get',{notificationId:old.id})
  const retry=await h.service.retryNotification({groupId:pending.payload.conversationId,notificationId:pending.id,expectedToken:taskNotificationRecovery(pending).expectedToken})
  assert.equal(retry.action,'readback');assert.equal((await h.query('notification.get',{notificationId:old.id})).state,'delivered')
  assert.ok(h.readbacks.some(envelope=>envelope.deliveryKey===old.id))
 }
 assert.equal(h.sent.filter(envelope=>envelope.deliveryKey===old.id).length,firstState==='unknown'?1:0)
 assert.equal(h.sent.filter(envelope=>envelope.deliveryKey===latest.id).length,1)
 assert.deepEqual(await h.query('task.list'),[])
})
