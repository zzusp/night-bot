import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestText,requestTools,eventually} from './fixtures/resident-router-host.js'
import {taskNotificationRecovery} from '../packages/dingtalk-core/notification-delivery.js'

const triage=body=>requestEnvelope(body,'一级分诊请求：')
const handling=(input,reply)=>({tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:!reply,reason:'依据本条完整原文作轻量处置',...(reply?{reply:reply(source)}:{})}))}})
function settle(body){const input=requestEnvelope(body,'Router 请求：');return body.messages.at(-1)?.role==='tool'?{text:'本批必要处置已可靠入账'}:{tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}}
function handoff(body){const input=requestEnvelope(body,'Router 交接请求：');if(input&&!requestTools(body).length)return {text:JSON.stringify({currentIntent:'保留原文引用，后续按真实账本继续',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff})}}

test('一级分诊收到明确交办即承接，在 Router 未完成时可靠引用回复且不重复发送',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
  const acknowledgement='收到，我会排查这个内存告警，核实后反馈。'
  let triageRequest,routerInput
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit')){triageRequest=body;const value=handling(triage(body),()=>acknowledgement);for(const row of value.args.dispositions)row.needsHandling=true;return value}
    if(requestTools(body).includes('resident_router_settle')){routerInput=requestEnvelope(body,'Router 请求：');entered.resolve();await release.promise;return settle(body)}
    return {text:'无其他工作'}
  })
  const original=channelMessage('reply-before-router',{text:'请排查这个测试节点的内存告警，仅调查，不修改配置。'})
  await h.receive(original);await entered.promise
  const prompt=requestText({messages:triageRequest.messages.filter(message=>message.role==='system')}).join(String.fromCharCode(10))
  assert.match(prompt,/首答用于及时反馈会处理对应事项/)
  assert.match(prompt,/在本次分诊提交简短reply/)
  assert.match(prompt,/不等待Router安排、工具查询或任务结果/)
  assert.match(prompt,/reason须同时说明是否处理及回复或静默的依据/)
  assert.doesNotMatch(prompt,/需处理也可省略reply/)
  await eventually(()=>h.sent.length===1&&h.readbacks.length===1,'preliminary reply reaches the fake channel before Router gate releases',t.signal)
  const source=(await h.query('source.list'))[0],envelope=h.sent[0],conversationId=source.groupId
  assert.equal(envelope.replyToMessageId,original.messageId);assert.equal(envelope.text,acknowledgement)
  assert.equal(routerInput.events.find(event=>event.sourceId===source.sourceId).triageReply.payload.text,acknowledgement)
  assert.equal((await h.query('router.get',{conversationId})).cursor,0)
  assert.equal((await h.query('router.inbox',{conversationId})).length,1)
  release.resolve();await h.service.whenIdle()
  const [notice]=await h.query('notification.list');assert.equal(notice.kind,'triage-reply');assert.equal(notice.state,'delivered')
  assert.equal(notice.payload.sourceRef.messageId,original.messageId);assert.equal(notice.payload.sourceRef.actorId,source.actorId)
  await h.receive(original);await h.service.whenIdle();assert.equal(h.sent.length,1)
  assert.deepEqual(await h.query('task.list'),[])
})

test('cold recovery reclassifies only uncommitted original sources and reads back an unknown private send without resending',{timeout:nativeTestTimeout(45000)},async t=>{
  let mode='hold',readable=false
  const h=await residentRouterHost(t,body=>{
    if(requestTools(body).includes('channel_triage_submit'))return mode==='hold'?{text:'尚未提交分诊，不能假装原文已处置'}:handling(triage(body),source=>'你好，已收到 '+source.text)
    return {text:'无需Router'}
  },{send:async()=>{throw Error('Lost acknowledgement after an actual fixture send')},readback:async()=>{if(!readable)throw Error('Readback unavailable');return {messageId:'external-proof',visible:true}}})
  const original=channelMessage('private-uncertain',{type:'chat',text:'你好'})
  await h.receive(original);await h.service.whenIdle()
  const before=(await h.query('source.list'))[0]
  assert.notEqual(before.routed,true);assert.equal((await h.query('triage.pending',{conversationId:before.groupId})).length,1)
  const oldTriage=h.requests.filter(body=>requestTools(body).includes('channel_triage_submit')).length
  mode='finish';await h.restart();await h.service.whenIdle()
  const [unknown]=await h.query('notification.list')
  assert.equal(unknown.state,'unknown');assert.equal(h.sent.length,1)
  assert.equal(h.sent[0].type,'chat');assert.deepEqual(h.sent[0].recipientIds,[]);assert.equal(h.sent[0].replyToMessageId,original.messageId)
  assert.equal(unknown.payload.sourceId,before.sourceId);assert.equal(unknown.payload.sourceRef.actorId,before.actorId)
  assert.ok(h.requests.filter(body=>requestTools(body).includes('channel_triage_submit')).length>oldTriage)
  readable=true;await h.restart()
  const current=await h.query('notification.get',{notificationId:unknown.id})
  if(current.state!=='delivered')await h.service.retryNotification({groupId:before.groupId,notificationId:unknown.id,expectedToken:taskNotificationRecovery(current).expectedToken})
  await h.service.whenIdle()
  assert.equal((await h.query('notification.get',{notificationId:unknown.id})).state,'delivered')
  await h.receive(original);await h.service.whenIdle();assert.equal(h.sent.length,1)
  assert.deepEqual(await h.query('router.list'),[]);assert.deepEqual(await h.query('task.list'),[])
})

test('startup first-tier admits the latest full original batch when arrivals precede official delivery',{timeout:nativeTestTimeout(30000)},async t=>{
  const observed=[]
  const h=await residentRouterHost(t,body=>{if(requestTools(body).includes('channel_triage_submit')){const input=triage(body);observed.push(input.messages.map(source=>source.messageId));return handling(input,source=>'已记录 '+source.text)}return {text:'无需Router'}})
  await Promise.all([h.receive(channelMessage('startup-a')),h.receive(channelMessage('startup-b',{senderId:'bob'}))])
  await h.service.whenIdle()
  assert.deepEqual(new Set(observed[0]),new Set(['startup-a','startup-b']))
  assert.equal(observed.length,1);assert.equal(h.sent.length,2)
  assert.deepEqual(new Set(h.sent.map(envelope=>envelope.replyToMessageId)),new Set(['startup-a','startup-b']))
  assert.ok((await h.query('source.list')).every(source=>source.routed));assert.deepEqual(await h.query('router.list'),[])
})
