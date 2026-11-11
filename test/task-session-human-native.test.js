import { nativeLifecycle, nativeLifecycleTimeout, nativeTestTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { available, reason, nativeRuntimeHost, latestInput, modelToolValues, waitUntil, topicTaskCalls } from './fixtures/runtime-official-host.js'
import { handleRequest } from '../packages/dingtalk-core/http.js'
const taskSessionMessages=request=>request.messages.filter(message=>message.role==='user').flatMap(message=>(typeof message.content==='string'?[{type:'text',text:message.content}]:message.content??[]).filter(part=>{try{return part.type==='text'&&!!JSON.parse(part.text).task}catch{return false}}).map(part=>({role:message.role,text:part.text})))
const call = (name, args) => ({ name, args })
const humanRequest=args=>call('task_result',{decision:{action:'blocked',summary:args.reason,question:args.question,audience:args.audience,evidence:args.evidence??[],attemptedActions:args.attemptedActions??[],limitations:[]}})
const requestHuman = (audience = 'operator') => call('task_result', { decision:{action:'blocked',audience, summary: '目标环境尚未明确，不能自行扩大授权', question: '请明确本次允许的环境和操作范围', evidence: ['已读取原始交办'],limitations:[], attemptedActions: ['核对现有需求，未执行外部修改']} })
const finish = summary => call('task_result', { decision: { action: 'complete', summary, evidence: ['已核对人工原文和原执行结果'], limitations: [] } })
async function fixture(t, decide, options) {
  const root = await mkdtemp(join(tmpdir(), 'task-human-native-'))
  const modelTaskMessages=[]
  const h = await nativeRuntimeHost(root,async(request,...args)=>{modelTaskMessages.push(...taskSessionMessages(request));if(latestInput(request).trigger==='task-facts')return topicTaskCalls(request);return decide(request,...args)},options)
  h.humanModelTaskMessages=modelTaskMessages
  t.after(async () => { try { await h.close() } finally { await rm(root, { recursive: true, force: true }) } })
  return h
}
async function pending(h) { return (await h.service.listAuthorizationRequests()).find(item => item.status === 'waiting-reply') }

function routeTask(request,task){return topicTaskCalls(request,{task})}
async function createGroupTask(h,id,objective){await h.service.ingest({groupId:'native-group',messageId:id,senderOpenDingTalkId:'native-user',text:'测试助手，'+objective,occurredAt:new Date().toISOString()});await h.service.whenIdle();return h.query('task.get',{taskId:(await h.query('task.list')).at(-1).taskId})}

for(const failure of ['none','empty','invalid-source'])test(`Router 判断业务答复并续原会话，无关补充及无效决定保持等待：${failure}`,{timeout:nativeTestTimeout(45000)},async t=>{
  let original,resumed,faultUsed=false,turns=0
  const answer='测试助手，只允许 UAT2 只读核对；点击编辑即持久化，不授权任何实施。'
  const h=await fixture(t,async request=>{
    const routed=routeTask(request,original)
    if(routed){
      const next=routed[0]
      if(next?.name==='resident_task_action'){
        const input=latestInput(request),source=input.events.find(event=>event.source?.sourceId===next.args.sourceId)?.source
        if(source?.messageId.startsWith('business-answer')){
          const current=await h.query('task.get',{taskId:original.taskId})
          if(!faultUsed&&['empty','invalid-source'].includes(failure)){
            faultUsed=true
            return [call('resident_task_action',{...next.args,kind:'resume',expectedContextRevision:current.contextRevision??0,
              humanRequestId:current.humanRequests[0].requestId,reason:failure==='empty'?' ':'业务负责人明确给出完整限制',
              ...(failure==='invalid-source'?{sourceId:'forged-source'}:{})})]
          }
          if(source.messageId==='business-answer-renewed'||!['empty','invalid-source'].includes(failure))return [call('resident_task_action',{...next.args,kind:'resume',
            humanRequestId:current.humanRequests[0].requestId,expectedContextRevision:current.contextRevision??0,reason:'已核对业务负责人的完整 UAT2 只读条件，不新增实施权限'})]
        }
      }
      return routed
    }
    const input=latestInput(request);turns++
    assert.equal(input.humanReview,undefined)
    if(!input.task.humanRequests.length)return [requestHuman('requester')]
    resumed=input
    return [call('task_result',{decision:{action:'wait',summary:'原会话已接纳 Router 核实的限制，保持只读',evidence:[answer],limitations:[]}})]
  })
  original=await createGroupTask(h,'origin-business-'+failure,'由业务负责人确认 UAT2 只读条件，不允许实施')
  assert.equal(original.humanRequests[0].status,'waiting-reply')
  const initialTurns=turns
  await h.service.ingest({groupId:'native-group',messageId:'unrelated-owner',senderOpenDingTalkId:'native-user',text:'测试助手，另一件事下周讨论',occurredAt:new Date().toISOString()});await h.service.whenIdle()
  assert.equal((await h.query('task.get',{taskId:original.taskId})).humanRequests[0].status,'waiting-reply');assert.equal(turns,initialTurns)
  await h.service.ingest({groupId:'native-group',messageId:'business-answer',senderOpenDingTalkId:'business-responsible',text:answer,occurredAt:new Date().toISOString()});await h.service.whenIdle()
  if(['empty','invalid-source'].includes(failure)){
    assert.equal((await h.query('task.get',{taskId:original.taskId})).humanRequests[0].status,'waiting-reply');assert.equal(turns,initialTurns)
    assert.ok(h.toolResults.some(row=>row.name==='resident_task_action'&&row.result.isError&&JSON.stringify(row.result).includes(failure==='empty'?'ROUTER_ARGUMENT_INVALID':'ROUTER_SOURCE_FORBIDDEN')))
    const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
    await h.service.ingest({groupId:'native-group',messageId:'business-answer-renewed',senderOpenDingTalkId:'business-responsible',text:answer,occurredAt:new Date().toISOString()});await h.service.whenIdle()
  }
  const after=await h.query('task.get',{taskId:original.taskId})
  assert.equal(after.sessionId,original.sessionId);assert.equal(after.requirementRevision,original.requirementRevision);assert.equal(after.controlRevision,original.controlRevision)
  assert.equal(after.humanRequests[0].status,'answered');assert.equal(after.humanRequests[0].reply,answer);assert.equal(after.humanRequests[0].resolution.kind,'router')
  assert.ok(resumed.sources.some(source=>source.actorId==='business-responsible'&&source.text===answer));assert.equal(turns,initialTurns+1)
  assert.deepEqual(await h.query('execution.list'),[]);assert.deepEqual(await h.query('operation.list'),[])
  assert.ok(!h.toolResults.some(row=>row.name==='task_human_resolve'))
})

test('待实施批准期间由 Router 答复事实追问，内部证据不外发且不绕过原问题',{timeout:nativeTestTimeout(30000)},async t=>{
  let original,turns=0,replyStep=0
  const summary='此前导入问题已只读核对；当前点击编辑持久化只有方案，仍等确认。'
  const h=await fixture(t,async request=>{
    const routed=routeTask(request,original)
    if(routed){
      const input=latestInput(request),source=input.events?.find(event=>event.source?.messageId==='fact-question')?.source
      if(source&&routed[0]?.name==='resident_router_settle'&&replyStep<2)return [call('resident_router_reply',{
        operationId:'fact-reply',sourceId:source.sourceId,messageVersion:source.version,text:replyStep++===0?summary+' '+source.sourceId:summary})]
      return routed
    }
    turns++;assert.equal(latestInput(request).humanReview,undefined);return [requestHuman('requester')]
  })
  original=await createGroupTask(h,'fact-followup','核对既有修复与当前编辑持久化方案；实施需要另行确认')
  const initialTurns=turns
  await h.service.ingest({groupId:'native-group',messageId:'fact-question',senderOpenDingTalkId:'native-user',text:'测试助手，方案未确认，你前面查到了什么？',occurredAt:new Date().toISOString()});await h.service.whenIdle()
  const after=await h.query('task.get',{taskId:original.taskId}),replies=h.sent.filter(item=>item.payload.sourceRef?.messageId==='fact-question')
  assert.equal(after.humanRequests[0].status,'waiting-reply');assert.equal(after.humanRequests[0].requestId,original.humanRequests[0].requestId)
  assert.equal(after.sessionId,original.sessionId);assert.equal(turns,initialTurns)
  assert.equal(replies.length,1);assert.equal(replies[0].payload.text,summary);assert.deepEqual(replies[0].payload.recipientActorIds,['native-user'])
  assert.deepEqual(replies[0].payload.sourceRef,{messageId:'fact-question',messageVersion:1,actorId:'native-user'})
  assert.equal((await h.query('notification.get',{notificationId:replies[0].id})).state,'delivered')
  assert.ok(h.toolResults.some(row=>row.name==='resident_router_reply'&&row.result.isError&&JSON.stringify(row.result).includes('GROUP_REPLY_INTERNAL_DETAILS')))
  const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
  assert.deepEqual(await h.query('execution.list'),[])
})

for(const batched of [true,false])test(`Router 保留两条事实追问来源并分别送达，不启动执行复核：并行入站=${batched}`,{timeout:nativeTestTimeout(40000)},async t=>{
  let original,turns=0;const replies=new Set(),summaries=['第一项只完成只读排查，仍待确认。','第二项查到已有实现，本轮未实施。']
  const h=await fixture(t,async request=>{
    const routed=routeTask(request,original)
    if(routed){
      const input=latestInput(request)
      if(routed[0]?.name==='resident_router_settle'){
        const source=input.events.find(event=>event.source&&['batch-first','batch-second'].includes(event.source.messageId)&&!replies.has(event.source.sourceId))?.source
        if(source){replies.add(source.sourceId);return [call('resident_router_reply',{operationId:'fact:'+source.sourceId,sourceId:source.sourceId,messageVersion:source.version,
          text:summaries[source.messageId==='batch-first'?0:1]})]}
      }
      return routed
    }
    turns++;return [requestHuman('requester')]
  })
  original=await createGroupTask(h,'batch-followup-'+batched,'方案等待确认，仅回答事实追问')
  const initialTurns=turns,messages=['batch-first','batch-second','batch-unrelated'].map((messageId,index)=>({groupId:'native-group',messageId,
    senderOpenDingTalkId:'member-'+index,text:index<2?`测试助手，第 ${index+1} 项目前实施了什么？`:'测试助手，另一件事下周再聊',occurredAt:new Date().toISOString()}))
  if(batched)await Promise.all(messages.map(message=>h.service.ingest(message)))
  else for(const message of messages){await h.service.ingest(message);await h.service.whenIdle()}
  await h.service.whenIdle()
  const after=await h.query('task.get',{taskId:original.taskId}),sent=h.sent.filter(row=>['batch-first','batch-second'].includes(row.payload.sourceRef?.messageId))
  assert.equal(after.humanRequests[0].status,'waiting-reply');assert.equal(after.sessionId,original.sessionId);assert.equal(turns,initialTurns)
  assert.equal(sent.length,2);assert.deepEqual(sent.map(row=>row.payload.text).sort(),summaries.toSorted())
  for(const reply of sent){assert.equal((await h.query('notification.get',{notificationId:reply.id})).state,'delivered')
    assert.deepEqual(reply.payload.recipientActorIds,[reply.payload.sourceRef.actorId])}
  assert.ok(!h.sent.some(row=>row.payload.sourceRef?.messageId==='batch-unrelated'))
  assert.deepEqual(await h.query('execution.list'),[]);assert.deepEqual(await h.query('operation.list'),[])
  const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
})

for(const permission of [false,true])test(`operator technical reply retains original business scope in one official session; retired correction=${permission}`,{timeout:30000},async t=>{
 const objective='修复后部署到UAT2，隔离验证，不操作真实申请',reply='技术已恢复；不新增部署批准，不撤销此前明确交办范围。',seen=[];let turns=0
 const h=await fixture(t,async request=>{const routed=topicTaskCalls(request);if(routed)return routed;const input=latestInput(request);seen.push(input);return ++turns===1?[requestHuman('operator')]:[call('task_result',{decision:{action:'wait',summary:'按原交办及真实技术来源继续，未执行外部部署',evidence:[reply],limitations:[]}})]},{config:{webActorId:'operator-user'}})
 const before=await createGroupTask(h,'business-authorization',objective),request=await pending(h),original=await h.query('task.get',{taskId:before.taskId})
 const originalPolicy=(await h.ctx.sessionPersistence.readNative(original.sessionId)).audit.filter(receipt=>['permission','sandbox','approval'].includes(receipt.domain))
 const args={taskId:original.taskId,humanRequestId:request.requestId,requestId:'scope-continuation',reply,expectedRequirementRevision:original.requirementRevision,expectedControlRevision:original.controlRevision}
 if(permission){
  const correction={executionId:'retired-execution',expectedInputVersion:1,mode:'danger-full-access',reason:'旧执行权限纠正不得变成单任务授权'}
  await assert.rejects(h.service.respondHumanRequest({...args,checkOnly:true,executionPermissionCorrection:correction}),/TASK_EXECUTION_PERMISSION_CORRECTION_SCOPE/)
  const server=createServer((req,res)=>handleRequest(req,res,{respondTaskHumanRequest:input=>h.service.respondHumanRequest(input)}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const {taskId,humanRequestId,...body}=args,response=await fetch(`http://127.0.0.1:${server.address().port}/tasks/${taskId}/human-requests/${encodeURIComponent(humanRequestId)}/reply/check`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,executionPermissionCorrection:correction})});assert.ok(response.status>=400);assert.match(JSON.stringify(await response.json()),/TASK_EXECUTION_PERMISSION_CORRECTION_SCOPE/)
  assert.deepEqual(await h.query('task.get',{taskId:original.taskId}),original)
 }
 await h.service.respondHumanRequest(args);await h.service.whenIdle();const after=await h.query('task.get',{taskId:original.taskId})
 assert.equal(after.sessionId,original.sessionId);assert.equal(after.requirementRevision,original.requirementRevision);assert.equal(after.controlRevision,original.controlRevision);assert.equal(after.humanRequests[0].status,'answered');assert.equal(after.lastDecision.action,'wait');assert.equal(turns,2)
 assert.equal(seen.at(-1).sources.find(source=>source.messageId==='business-authorization').text,'测试助手，'+objective);assert.equal(seen.at(-1).sources.find(source=>source.text===reply).actorId,'operator-user')
 const saved=await h.ctx.sessionPersistence.readNative(after.sessionId);assert.equal(saved.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='identity').length,1);assert.deepEqual(saved.audit.filter(receipt=>['permission','sandbox','approval'].includes(receipt.domain)),originalPolicy)
 assert.deepEqual(await h.query('execution.list'),[]);assert.deepEqual(await h.query('operation.list'),[])
})

test('技术申请进入Web和登录人私聊，精确引用及真实作者恢复原任务，零技术群询问', { ...({ skip: !available ? reason : false, timeout: 30000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  let ownerTurns = 0, resumed, h
  const sent = []
  await t.beginBusiness()
  h = await t.step(async () => fixture(t, async request => {
    const calls = topicTaskCalls(request)
    if (calls) return calls
    if (++ownerTurns === 1) return [humanRequest({ audience: 'operator', reason: '原生能力需修复', question: '请恢复GitHub查询能力', evidence: ['已核实Host拒绝'], attemptedActions: ['读取原操作日志'] })]
    resumed = latestInput(request)
    return [finish('人工技术处理结果已接纳')]
  }, { config: { operatorUserId: 'actual-login-user' }, notifications: {
    async send(notification) { sent.push(notification); return { messageId: notification.payload.audience === 'operator' ? 'operator-notice' : `group-${sent.length}` } },
    async readback(notification) { return notification.payload.audience === 'operator'
      ? { messageId: 'operator-notice', conversationId: 'self-private', senderActorId: 'actual-operator', observedAt: new Date().toISOString() }
      : { messageId: notification.ack.messageId, visible: true } },
  } }))
  await t.step(async () => h.service.ingest({ groupId: 'native-group', messageId: 'business-request', senderOpenDingTalkId: 'native-user', text: '测试助手，核查既有业务目标', occurredAt: new Date().toISOString() }))
  await t.step(async () => h.service.whenIdle())
  const request = await t.step(async () => pending(h)), waiting = (await t.step(async () => h.query('task.list')))[0]
  assert.equal(request.audience, 'operator')
  assert.equal(request.notification.state, 'delivered')
  const privateNotice = sent.find(item => item.payload.audience === 'operator')
  assert.equal(privateNotice.payload.recipientUserId, 'actual-login-user')
  assert.equal(privateNotice.payload.humanRequestId, request.requestId, '内部申请关联保留在元数据')
  assert.ok(!privateNotice.payload.text.includes(request.requestId), '原生引用即可定位申请，无需在正文展示编号')
  assert.match(privateNotice.payload.text, /引用本消息回复/)
  assert.equal(h.residentStore.getGroup('native-group').outbox.length, 1, '私聊通知不投影为业务群发件箱')
  assert.ok(!h.residentStore.getGroup('native-group').outbox.some(item => item.text.includes('恢复GitHub')))
  const reply = { groupId: 'self-private', messageId: 'human-private-answer', senderOpenDingTalkId: 'actual-operator',
    quotedMessage: { messageId: 'operator-notice' }, text: '技术能力已修复，请沿原任务继续只读核查', occurredAt: new Date().toISOString() }
  for (const change of [{ groupId: 'native-group' }, { senderOpenDingTalkId: 'native-user' }, { quotedMessage: { messageId: 'other' } }])
    await t.step(async () => assert.rejects(h.service.respondPrivateHumanReply({ ...reply, ...change }), /DYNAMIC_HUMAN_RESPONSE_FORBIDDEN|TASK_HUMAN_PRIVATE_REQUEST_NOT_FOUND/))
  await t.step(async () => h.service.respondPrivateHumanReply(reply)); await t.step(async () => h.service.whenIdle())
  const completed = (await t.step(async () => h.query('task.list')))[0]
  assert.equal(completed.sessionId, waiting.sessionId)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.humanRequests[0].replyChannel, 'private')
  assert.equal(completed.humanRequests[0].actorId, 'actual-operator')
  assert.equal(resumed.sources.find(item => item.messageId === reply.messageId).actorId, 'actual-operator')
  await t.step(async () => h.service.respondPrivateHumanReply(reply)); await t.step(async () => h.service.whenIdle())
  assert.equal(ownerTurns, 2)
  assert.equal(sent.filter(item => item.payload.audience === 'operator').length, 1)
}))

test('人工外发问题入账前拒绝真实任务运行标识，内部证据与业务链接保留',{timeout:30000},async t=>{
 let step=0,internalId;const business='请核对 PR #253 与订单 SG18：https://example.com/orders/SG18'
 const h=await fixture(t,request=>{const input=latestInput(request);internalId=input.task.taskId;const args={audience:'operator',reason:'需要核对业务信息',question:business,evidence:[`内部诊断：${internalId}`],attemptedActions:['已核对现有资料']};if(step===0)args.question='请处理 '+internalId;if(step===1)args.attemptedActions=['已检查 '+internalId];step++;return [humanRequest(args)]},{config:{operatorUserId:'actual-login-user'}})
 const created=await h.service.createTask({groupId:'native-group',requestId:'public-human-copy',objective:'核对业务信息'});await h.service.whenIdle();assert.equal(step,3)
 const current=await h.query('task.get',{taskId:created.taskId});assert.equal(current.humanRequests.length,1);assert.deepEqual(current.humanRequests[0].evidence,[`内部诊断：${internalId}`]);const notices=h.sent.filter(item=>item.payload.audience==='operator');assert.equal(notices.length,1);assert.ok(notices[0].payload.text.includes(business));assert.ok(!notices[0].payload.text.includes(internalId));assert.ok(!notices[0].payload.text.includes(current.humanRequests[0].requestId));const rejected=h.toolResults.filter(item=>item.name==='task_result'&&item.result.isError);assert.equal(rejected.length,2);assert.ok(rejected.every(item=>JSON.stringify(item.result).includes('GROUP_REPLY_INTERNAL_DETAILS')))
})

test('native human request waits without repeat wakes; authenticated HTTP reply resumes the original session from actual source text', { ...({ skip: !available ? reason : false, timeout: 30000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  let turns = 0, replyInput
  const h = await fixture(t, async request => {
    const input = latestInput(request); turns++
    if (turns === 1) return [requestHuman()]
    replyInput = input
    return [finish('仅按人工明确的 UAT3 范围完成核对')]
  })
  await t.beginBusiness()

  const created = await t.step(async () => h.service.createTask({ groupId: 'native-group', requestId: 'human-native', objective: '按明确范围核对' }))
  await t.step(async () => h.service.whenIdle())
  const request = await t.step(async () => pending(h)), waiting = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.ok(request)
  assert.equal(waiting.lastDecision.action, 'blocked')
  assert.equal(waiting.drained, true)
  assert.deepEqual(request.attemptedActions, ['核对现有需求，未执行外部修改'])
  for (let i = 0; i < 3; i++) { await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle()) }
  assert.equal(turns, 1)
  const server = createServer((req, res) => handleRequest(req, res, { respondTaskHumanRequest: args => h.service.respondHumanRequest(args) }))
  await t.step(async () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/tasks/${created.taskId}/human-requests/${encodeURIComponent(request.requestId)}/reply`
  const body = { requestId: 'real-human-response', reply: '仅允许 UAT3 的只读核对；不得修改生产或发布', expectedRequirementRevision: waiting.requirementRevision, expectedControlRevision: waiting.controlRevision }
  const forbidden = await t.step(async () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://outside.invalid' }, body: JSON.stringify(body) }))
  assert.equal(forbidden.status, 403)
  const response = await t.step(async () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  assert.equal(response.status, 200, JSON.stringify(await t.step(async () => response.json())))
  await t.step(async () => h.service.whenIdle())
  const completed = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.sessionId, waiting.sessionId)
  assert.equal(completed.requirementRevision, 1)
  assert.equal(completed.humanRequests[0].status, 'answered')
  assert.equal(replyInput.sources.find(source => source.text === body.reply)?.actorId, 'native-user')
  assert.ok(!JSON.stringify(replyInput).includes('unlimitedApproval'))
  assert.equal((await t.step(async () => h.query('task.list'))).length, 1)
  assert.equal((await t.step(async () => h.query('execution.list'))).length, 0)
}))

test('an original official task tool result cannot bypass human waiting and survives same-session reply',{timeout:nativeTestTimeout(30000)},async t=>{
 const materialReady=Promise.withResolvers();t.after(()=>materialReady.resolve())
 let step=0,answered
 const proof='原任务此前只读核对结果，不能冒充人工授权'
 const h=await fixture(t,async request=>{const input=latestInput(request);if(!input.task.humanRequests.length){await materialReady.promise;if(step++===0)return [call('read',{path:'materials/original.txt'})];return [requestHuman()]};answered=input;assert.match(JSON.stringify(request.messages),new RegExp(proof));return [finish('依据人工只读边界与原结果完成')]})
 // A managed task-local material is Host-owned evidence, not another execution session.
 const created=await h.service.createTask({groupId:'native-group',requestId:'human-original-result',objective:'核对原目标'}),id=created.taskId
 const {taskWorkspace}=await import('../packages/dingtalk-core/session-workspaces.js'),{writeFile}=await import('node:fs/promises'),cwd=await taskWorkspace(h.ctx.runtimePaths.workspaces,id);await writeFile(join(cwd,'materials','original.txt'),proof);materialReady.resolve()
 await h.service.recover();await h.service.whenIdle();const waiting=await h.query('task.get',{taskId:id}),request=await pending(h);assert.ok(request)
 const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
 await h.service.respondHumanRequest({taskId:id,humanRequestId:request.requestId,requestId:'reply-original-result',reply:'仅使用现有只读结果，不追加写入',expectedRequirementRevision:waiting.requirementRevision,expectedControlRevision:waiting.controlRevision});await h.service.whenIdle()
 const after=await h.query('task.get',{taskId:id});assert.equal(after.status,'completed');assert.equal(after.sessionId,waiting.sessionId);assert.ok(answered.sources.some(source=>source.text==='仅使用现有只读结果，不追加写入'))
 const saved=await h.ctx.sessionPersistence.readNative(after.sessionId);assert.equal(saved.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='read').length,1);assert.deepEqual(await h.query('execution.list'),[])
})

test('a native blocked decision without a human question is corrected into an explicit durable request', { ...({ skip: !available ? reason : false, timeout: 30000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  let steps = 0
  const h = await fixture(t, async request => {
    steps++
    if (steps === 1) return [call('task_result', { decision: { action: 'blocked', summary: '需要人工', evidence: [], limitations: [] } })]
    assert.match(JSON.stringify(request.messages), /TASK_QUESTION_REQUIRED/)
    return [requestHuman()]
  })
  await t.beginBusiness()

  const created = await t.step(async () => h.service.createTask({ groupId: 'native-group', requestId: 'human-correction', objective: '按实际边界处理' }))
  await t.step(async () => h.service.whenIdle())
  assert.equal(steps, 2)
  const task = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(task.humanRequests.length, 1)
  assert.equal(task.humanRequests[0].status, 'waiting-reply')
  assert.equal(task.lastDecision.question, '请明确本次允许的环境和操作范围')
  assert.ok(h.toolResults.some(item => item.name === 'task_result' && item.result.isError))
}))

for(const changed of [false,true])test(`original-group human input preserves clarification and fences explicit authorization changes: changed=${changed}`,{timeout:nativeTestTimeout(30000)},async t=>{
 let original,answeredInput;const reply='测试助手，本次只允许 UAT3 只读核对，不得发布生产。'
 const h=await fixture(t,async request=>{let routed=routeTask(request,original);if(routed){if(original&&routed[0].name==='resident_task_action'){const current=await h.query('task.get',{taskId:original.taskId});routed[0].args={...routed[0].args,...(changed?{kind:'revise',text:reply,objective:reply}:{kind:'resume',humanRequestId:current.humanRequests[0].requestId,expectedContextRevision:current.contextRevision??0,reason:'原需求人补齐 UAT3 只读范围，不新增实施权限'})}}return routed}
  const input=latestInput(request);if(!input.task.humanRequests.length)return [requestHuman('requester')]
  assert.equal(input.humanReview,undefined)
  answeredInput=input;return [call('task_result',{decision:{action:'wait',summary:'保持原任务来源和当前范围',evidence:[reply],limitations:[]}})]
 })
 original=await createGroupTask(h,'original-group-answer','原群原任务核对，边界未明确前只读');await h.service.ingest({groupId:'native-group',messageId:'real-group-human-answer',senderOpenDingTalkId:'native-user',text:reply,occurredAt:new Date().toISOString()});await h.service.whenIdle()
 const after=await h.query('task.get',{taskId:original.taskId});assert.equal(after.sessionId,original.sessionId);assert.deepEqual(await h.query('execution.list'),[])
 if(changed){assert.equal(after.requirementRevision,original.requirementRevision+1,JSON.stringify(h.toolResults.filter(row=>row.name==='resident_task_action').map(row=>row.result)));assert.equal(after.humanRequests[0].status,'superseded');assert.equal(after.controlRevision,original.controlRevision)}else{assert.equal(after.requirementRevision,original.requirementRevision);assert.equal(after.humanRequests[0].status,'answered');assert.equal(after.humanRequests[0].reply,reply);assert.ok(answeredInput.sources.some(source=>source.messageId==='real-group-human-answer'&&source.actorId==='native-user'&&source.text===reply))}
})

test('Web answer recalls its delivered operator notification once without recalling group replies', { ...({ skip: !available ? reason : false, timeout: 30000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  let turns = 0
  const recalls = []
  const h = await fixture(t, async request => {
    const routed = topicTaskCalls(request)
    if (routed) return routed
    return ++turns === 1 ? [requestHuman()] : [finish('已按人工答复继续')]
  }, { config: { operatorUserId: 'login', webActorId: 'web-user' }, notifications: {
    async send(notification) { return { messageId: notification.id } },
    async readback(notification) { return { messageId: notification.id, conversationId: notification.payload.audience === 'operator' ? 'self-private' : 'native-group', senderActorId: 'login', visible: true } },
    async recall(notification) { recalls.push(notification); return { ...notification.receipt, recallStatus: 'SUCCESS' } },
  } })
  await t.beginBusiness()

  await t.step(async () => h.service.ingest({ groupId: 'native-group', messageId: 'request', senderOpenDingTalkId: 'native-user', text: '测试助手，检查原业务需求', occurredAt: new Date().toISOString() }))
  await t.step(async () => h.service.whenIdle())
  const request = await t.step(async () => pending(h)), task = (await t.step(async () => h.query('task.list')))[0]
  const reply = { taskId: task.taskId, humanRequestId: request.requestId, requestId: 'web-reply', reply: '已修复原能力',
    expectedRequirementRevision: task.requirementRevision, expectedControlRevision: task.controlRevision }
  await t.step(async () => Promise.all([h.service.respondHumanRequest(reply), h.service.respondHumanRequest(reply)]))
  await t.step(async () => h.service.whenIdle())
  await t.step(async () => h.service.respondHumanRequest(reply))
  await t.step(async () => h.service.whenIdle())
  assert.equal(recalls.length, 1)
  assert.equal(recalls[0].payload.humanRequestId, request.requestId)
  assert.equal(recalls[0].payload.audience, 'operator')
  assert.equal(recalls[0].receipt.conversationId, 'self-private')
  const answered = (await t.step(async () => h.service.listAuthorizationRequests())).find(item => item.requestId === request.requestId)
  assert.equal(answered.status, 'answered')
  assert.equal(answered.notification.recall.state, 'recalled')
}))


test('anonymous missing-original-file wait preserves completed authorized progress, inspection and same-session recovery',{timeout:nativeTestTimeout(30000)},async t=>{
 let original,resumed,phase=0;const answer='原件已通过原受管入口提供；仅只读复现，不修改权限、共享数据或部署。'
 const h=await fixture(t,async request=>{const routed=routeTask(request,original);if(routed){if(original&&routed[0].name==='resident_task_action'){const current=await h.query('task.get',{taskId:original.taskId});routed[0].args={...routed[0].args,kind:'resume',humanRequestId:current.humanRequests[0].requestId,expectedContextRevision:current.contextRevision??0,reason:'原需求人通过受管入口补齐原件，保持只读限制'}}return routed}const input=latestInput(request)
  if(!input.task.humanRequests.length){if(phase++===0)return [call('write',{path:'work/independent-progress.txt',content:'已授权范围内的独立修复已完成；原件精确复现待补证'})];return [humanRequest({audience:'requester',reason:'已知契约修复已保存；匿名原件仅阻塞精确复现',question:'请原需求负责人补充原件；不索取账号、不猜测匿名上传人',evidence:['独立修复已保存'],attemptedActions:['保留既有成果，不修改共享数据或部署']})]}
  assert.equal(input.humanReview,undefined)
  resumed=input;return [finish('沿原任务及已保存成果完成只读核验')]
 })
 original=await createGroupTask(h,'anonymous-original','修复已确认导出契约；上传人未知的原件只用于精确只读复现，不改变共享写权限或部署范围')
 const question=original.humanRequests[0];assert.equal(question.audience,'requester');assert.equal(question.status,'waiting-reply');const before=await h.ctx.sessionPersistence.readNative(original.sessionId);const progressPath=join(before.header.cwd,'work','independent-progress.txt');assert.equal(await readFile(progressPath,'utf8'),'已授权范围内的独立修复已完成；原件精确复现待补证');assert.equal(before.context.projection.messages.findLast(message=>message.role==='toolResult'&&message.toolName==='write').isError,false);assert.equal(before.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent'&&receipt.payload.name==='write').length,1)
 const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
 await h.service.ingest({groupId:'native-group',messageId:'route-answer',senderOpenDingTalkId:'native-user',text:answer,occurredAt:new Date().toISOString()});await h.service.whenIdle();const after=await h.query('task.get',{taskId:original.taskId});assert.equal(after.status,'completed');assert.equal(after.sessionId,original.sessionId);assert.equal(after.humanRequests[0].status,'answered');assert.ok(resumed.sources.some(source=>source.text===answer))
 const saved=await h.ctx.sessionPersistence.readNative(after.sessionId);assert.equal(saved.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent'&&receipt.payload.name==='write').length,1,'already completed authorized progress is not rerun');assert.equal(await readFile(progressPath,'utf8'),'已授权范围内的独立修复已完成；原件精确复现待补证');assert.deepEqual(await h.query('execution.list'),[]);assert.ok(!h.sent.some(item=>/账号|上传人身份/.test(item.payload.text)&&item.payload.audience==='operator'))
})

for (const direct of [false, true]) test(`Web human wait without a real group source preserves the question without group or operator delivery: direct=${direct}`, { skip: !available ? reason : false, timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async t => {
  let attempted = false, resumedInput
  const h = await fixture(t, async request => {
    const routed = topicTaskCalls(request); if (routed) return routed
    if (!attempted) {
      attempted = true
      return direct ? [call('task_result', { decision: { action: 'blocked', summary: '需要原需求人补齐验证入口', question: '请提供现有验证入口', evidence: [], limitations: [] } })] : [requestHuman('requester')]
    }
    resumedInput=latestInput(request)
    return [call('task_result', { decision: { action: 'wait', summary: '已核对真实Web答复，保持原任务范围，不猜测群收件人', evidence: [], limitations: [] } })]
  })
  await t.beginBusiness()
  const created = await t.step(() => h.service.createTask({ groupId: 'native-group', requestId: 'unbound-web-question', objective: '仅Web来源任务' }))
  await t.step(() => h.service.whenIdle())
  const task = await t.step(() => h.query('task.get', { taskId: created.taskId }))
  assert.equal(task.humanRequests.length,1)
  const question=task.humanRequests[0]
  assert.equal(question.audience,direct?'operator':'requester');assert.equal(question.status,'waiting-reply')
  assert.equal((await h.query('notification.list')).length,0);assert.equal(h.sent.length,0)
  const reply={taskId:task.taskId,humanRequestId:question.requestId,requestId:'unbound-web-answer',reply:'已提供原Web验证入口，仅限原授权只读范围',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}
  await assert.rejects(h.service.respondHumanRequest({...reply,expectedRequirementRevision:task.requirementRevision+1}),{code:'DYNAMIC_HUMAN_REQUEST_STALE'})
  await assert.rejects(h.service.respondHumanRequest({...reply,humanRequestId:'forged-question'}),{code:'DYNAMIC_NOT_FOUND'})
  await assert.rejects(h.service.store.command({id:'unbound-forged-source',kind:'task.human.respond',args:{taskId:task.taskId,requestId:question.requestId,sourceId:'forged-group-source',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}}),{code:'DYNAMIC_NOT_FOUND'})
  await h.service.respondHumanRequest(reply);await h.service.whenIdle()
  const after=await h.query('task.get',{taskId:task.taskId}),sources=await Promise.all(after.sourceRefs.map(sourceId=>h.query('source.get',{sourceId})))
  assert.equal(after.sessionId,task.sessionId);assert.equal(after.requirementRevision,task.requirementRevision);assert.equal(after.humanRequests[0].status,'answered')
  assert.ok(sources.every(source=>source.channel==='web'));assert.ok(sources.some(source=>source.actorId==='native-user'&&source.text===reply.reply))
  assert.ok(resumedInput,'真实Web答复必须启动原执行会话的续办轮');assert.equal(resumedInput.task.taskId,task.taskId)
  assert.ok(resumedInput.sources.some(source=>source.actorId==='native-user'&&source.text===reply.reply))
  assert.equal(after.lastDecision.action,'wait');assert.equal(after.lastDecision.summary,'已核对真实Web答复，保持原任务范围，不猜测群收件人')
  assert.equal((await h.query('notification.list')).length,0);assert.equal(h.sent.length,0);assert.deepEqual(await h.query('execution.list'),[])
}))
