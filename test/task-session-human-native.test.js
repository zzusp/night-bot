import { nativeLifecycle, nativeLifecycleTimeout, nativeTestTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { available, reason, nativeRuntimeHost, latestInput, modelToolValues, waitUntil, topicTaskCalls } from './fixtures/runtime-official-host.js'
import { handleRequest } from '../packages/dingtalk-core/http.js'
import {getSystemMessageText} from '@earendil-works/pi-ai'
const requestSystemText=request=>request.messages.filter(message=>message.role==='system').map(getSystemMessageText).join('\n')
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

for (const failure of ['none', 'empty', 'invalid-source', 'topic']) {
 // 空返回另含失败停留和新真实答复后的完整复核，保留全部来源与无重试断言。
 const businessMs=failure==='empty'?45000:30000
 test(`群业务成员完整答复经只读复核解除，发起人无关消息不解除且不空转：${failure}`, { skip: !available ? reason : false, timeout: nativeLifecycleTimeout(businessMs) }, nativeLifecycle(businessMs, async (t) => {
  let original, topicId, resumed, reviewStep = 0
  const reviewProgress=[]
  const reviewLeases = [], answer = '测试助手，可以，但只允许 UAT2；点击编辑即持久化待提交，不能把变更延后到提交时。'
  const wait = summary => call('task_result', { decision: { action: 'wait', summary, evidence: [], limitations: [] } })
  const h = await fixture(t, async request => {
    const incoming = latestInput(request)
    if (incoming.trigger === 'task-facts') return topicTaskCalls(request)
    const routed=routeTask(request,original)
    if(routed)return routed
    const input = latestInput(request)
    if (!input.task.humanRequests.length) return [requestHuman('requester')]
    if (input.humanReview) {
      const source = input.sources.find(item => input.humanReview.sourceIds.includes(item.sourceId))
      reviewProgress.push({messageId:source.messageId,step:reviewStep,at:new Date().toISOString()})
      assert.equal(input.task.humanRequests[0].status, 'waiting-reply')
      reviewLeases.push(input.humanReview.requestId)
      if (source.messageId === 'unrelated-owner') return [wait('原发起人说的是另一事项，未回答环境和编辑持久化条件，保留原问题')]
      assert.equal(source.actorId, 'business-responsible')
      assert.equal(source.text, answer, '完整限制不能被话题摘要代替')
      assert.match(requestSystemText(request), /真实作者的业务角色[、和]权限/)
      if (failure === 'empty' && reviewStep++ === 0) return []
      if (failure === 'invalid-source'&&reviewStep++===0) return [call('task_human_resolve', { requestId: input.humanReview.requestId,
        sourceId: 'forged-source', reason: '伪造来源必须拒绝', evidence: ['无效来源'] })]
      if(failure==='invalid-source')return [call('task_result',{decision:{action:'wait',summary:'非法来源未解除原问题',evidence:[],limitations:['DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID']}})]
      if (['none', 'topic'].includes(failure) && reviewStep++ === 0) return [call('bash',{command:'echo forbidden',description:'Must not run in read-only review'}),
        call('write', { path:'work/forbidden.txt', content: 'must not write' }), finish('不得提前完成')]
      if (['none', 'topic'].includes(failure)) assert.match(JSON.stringify(request.messages), /DYNAMIC_HUMAN_REVIEW_READ_ONLY/)
      return [call('task_human_resolve', { requestId: input.humanReview.requestId, sourceId: source.sourceId,
        reason: '原任务明确该成员负责业务条件，答复对应待答问题并限定 UAT2 及点击编辑即持久化；未新增权限', evidence: [answer] }),
        call('bash',{command:'echo forbidden',description:'Resolve does not widen this review run'}),
        wait('已保存完整业务答复，等待下一统筹轮继续原任务')]
    }
    resumed = input
    return [wait('已在独立正常轮收到完整答复，按原目标及附加条件继续')]
  })
  await t.beginBusiness()

  t.onCancel(()=>t.diagnostic(JSON.stringify({humanReviewProgress:{failure,reviewStep,requests:h.requests.length,reviewProgress,alerts:h.service.listAlerts(),lastTools:h.toolResults.slice(-5).map(item=>({name:item.name,error:item.result.error}))}})))
  const created = await t.step(async () => { await h.service.ingest({ groupId: 'native-group', messageId: 'origin-business-review-'+failure, senderOpenDingTalkId: 'native-user', text: '测试助手，由业务负责人 business-responsible 确认编辑持久化方案，现有授权只在 UAT2 验证', occurredAt: new Date().toISOString() }); await h.service.whenIdle(); return (await h.query('task.list'))[0] })
  await t.step(async () => h.service.whenIdle())
  original = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  await t.step(async () => h.service.ingest({ groupId: 'native-group', messageId: 'unrelated-owner', senderOpenDingTalkId: 'native-user', text: '测试助手，另外一件事下周讨论', occurredAt: new Date().toISOString() }))
  await t.step(async () => h.service.whenIdle())
  const kept = await t.step(async () => h.query('task.get', { taskId: original.taskId }))
  assert.equal(kept.humanRequests[0].status, 'waiting-reply')
  assert.equal(kept.humanRequests.length, 1)
  assert.match(kept.lastDecision.summary, /未回答环境/)
  const count = h.requests.length
  await t.step(async () => h.service.whenIdle())
  assert.equal(h.requests.length, count, '未回答问题时消费本次来源，不主动空转')
  await t.step(async () => h.service.ingest({ groupId: 'native-group', messageId: 'business-answer', senderOpenDingTalkId: 'business-responsible', text: answer, occurredAt: new Date().toISOString() }))
  await t.step(async () => h.service.whenIdle())
  if (!['none', 'topic'].includes(failure)) {
    const interrupted = await t.step(async () => h.query('task.get', { taskId: original.taskId })), wakes = await t.step(async () => h.query('wake.list', { taskId: original.taskId }))
    assert.equal(interrupted.humanRequests[0].status, 'waiting-reply')
    if(failure==='empty')assert.ok(wakes.some(item => item.kind === 'task.supplement' && item.state !== 'acked'))
    if (failure === 'invalid-source') {
      assert.ok(h.toolResults.some(item=>item.name==='task_human_resolve'&&item.result.isError&&JSON.stringify(item.result).includes('DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID')))
      assert.equal(interrupted.providerRecovery, null)
      assert.deepEqual(interrupted.lastDecision.limitations, ['DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID'])
      const count = h.requests.length
      await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
      assert.equal(h.requests.length, count, '非法来源后明确wait不自动重试或空转')
      assert.equal((await t.step(async () => h.query('execution.list'))).length, 0)
      return
    }
    assert.equal(interrupted.providerRecovery, null, '空返回不再授权 Host 自动退避重试')
    const heldReview = interrupted.humanRequests[0].reviewFailures.at(-1)
    assert.equal(heldReview.code, 'TASK_SESSION_NO_SUBMISSION')
    const heldSources = await Promise.all(heldReview.sourceIds.map(sourceId => h.query('source.get', { sourceId })))
    assert.ok(heldSources.some(source => source.messageId === 'business-answer' && source.text === answer), '失败复核保留原始完整答复与作者')
    const heldCount = h.requests.length
    for (let i = 0; i < 3; i++) { await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle()) }
    assert.equal(h.requests.length, heldCount, '同一失败来源不触发 Host 自动复核或空转')
    assert.equal(resumed, undefined)
    await t.step(async () => h.service.ingest({ groupId: 'native-group', messageId: 'business-answer-explicit-renewed', senderOpenDingTalkId: 'business-responsible', text: answer, occurredAt: new Date().toISOString() }))
    await t.step(async () => h.service.whenIdle())
  }
  const after = await t.step(async () => h.query('task.get', { taskId: original.taskId }))
  assert.equal(after.humanRequests[0].status, 'answered')
  assert.equal(after.humanRequests[0].reply, answer)
  assert.ok(after.humanRequests[0].resolution.reason.includes('点击编辑即持久化'))
  assert.equal(after.sessionId, original.sessionId)
  assert.equal(after.requirementRevision, original.requirementRevision)
  assert.equal(after.controlRevision, original.controlRevision)
  assert.equal(after.humanRequests.length, 1)
  assert.equal(resumed.humanReview, undefined)
  assert.ok((await h.query('wake.list',{taskId:original.taskId})).some(item=>item.kind==='human.responded'))
  assert.equal(resumed.sources.find(item => item.actorId === 'business-responsible').text, answer)
  if (failure === 'empty') assert.ok(resumed.sources.some(source => source.messageId === 'business-answer-explicit-renewed' && source.actorId === 'business-responsible' && source.text === answer), '续办消费真实的新答复来源，不能伪造旧来源的自动重试')
  assert.equal((await t.step(async () => h.query('execution.list'))).length, 0, '复核工具无法派发执行')
  assert.equal((await t.step(async () => h.query('operation.list'))).length, 0, '复核没有写操作')
  if (['none', 'topic'].includes(failure)) {const denied=h.toolResults.find(item=>item.name==='write');assert.equal(denied.result.isError,true);assert.match(JSON.stringify(denied),/DYNAMIC_HUMAN_REVIEW_READ_ONLY|FS_SANDBOX_DENIED/)}
  const decisions = await t.step(async () => h.query('task.decisions', { taskId: original.taskId }))
  assert.ok(decisions.decisions.some(item => item.decision.summary.includes('未回答环境')))
  assert.ok(decisions.decisions.some(item => item.decision.summary.includes('已保存完整业务答复')))
  assert.ok(reviewLeases.length >= 2)
}))
}

test('待实施批准期间事实追问保留来源并明确通知，内部证据不外发且不绕过原问题',{timeout:nativeTestTimeout(30000)},async t=>{
 let original,reviewStep=0
 const summary='此前 UPR 导入覆盖修复已核对；当前点击编辑持久化只有方案，仍等你确认。'
 const h=await fixture(t,async request=>{const routed=routeTask(request,original);if(routed)return routed;const input=latestInput(request)
  if(!input.task.humanRequests.length)return [requestHuman('requester')]
  assert.ok(input.humanReview);const source=input.sources.find(item=>input.humanReview.sourceIds.includes(item.sourceId));assert.ok(source)
  if(source.messageId==='unrelated-followup')return [call('task_result',{decision:{action:'wait',summary:'另一事项未答原问题',evidence:[],limitations:[]}})]
  assert.match(requestSystemText(request),/事实追问.*不是|事实追问.*保持原问题/)
  const decision={action:'wait',summary,evidence:['仅根据原任务已有来源答复事实；未收到实施批准'],limitations:[],replySourceId:source.sourceId}
  if(reviewStep++===0)decision.summary+=' '+input.task.taskId
  return [call('task_result',{decision})]
 })
 original=await createGroupTask(h,'fact-followup','核对 UPR 既有修复与当前编辑持久化方案；实施需要另行确认')
 await h.service.ingest({groupId:'native-group',messageId:'fact-question',senderOpenDingTalkId:'native-user',text:'测试助手，方案没确认，你前面改动的是什么？',occurredAt:new Date().toISOString()});await h.service.whenIdle()
 const after=await h.query('task.get',{taskId:original.taskId});assert.equal(after.humanRequests[0].status,'waiting-reply');assert.equal(after.humanRequests[0].requestId,original.humanRequests[0].requestId);assert.equal(after.sessionId,original.sessionId);assert.equal(after.requirementRevision,original.requirementRevision);assert.equal(after.controlRevision,original.controlRevision)
 const replies=h.sent.filter(item=>item.payload.sourceRef?.messageId==='fact-question');const deliveredFactCount=after.humanRequests[0].followupReplies.length;assert.equal(replies.length,1);assert.equal(replies[0].payload.text,summary);assert.equal(replies[0].payload.replyToMessageId,undefined);assert.deepEqual(replies[0].payload.recipientActorIds,['native-user'])
 const notification=await h.query('notification.get',{notificationId:replies[0].id});assert.equal(notification.taskId,original.taskId);assert.deepEqual(notification.payload.sourceRef,{messageId:'fact-question',messageVersion:1,actorId:'native-user'});assert.equal((await h.query('source.get',{sourceId:notification.payload.sourceId})).messageId,'fact-question')
 assert.equal((await h.query('notification.get',{notificationId:replies[0].id})).state,'delivered');assert.ok(h.readbacks.some(item=>item.id===replies[0].id));assert.ok(h.toolResults.some(item=>item.name==='task_result'&&item.result.isError&&JSON.stringify(item.result).includes('GROUP_REPLY_INTERNAL_DETAILS')))
 await h.service.ingest({groupId:'native-group',messageId:'unrelated-followup',senderOpenDingTalkId:'native-user',text:'测试助手，另外一件事下周再聊',occurredAt:new Date().toISOString()});await h.service.whenIdle();const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count);assert.equal((await h.query('task.get',{taskId:original.taskId})).humanRequests[0].followupReplies.length,deliveredFactCount);assert.deepEqual(await h.query('execution.list'),[])
})

for (const batched of [true, false]) test(`积压的两条事实追问均送达且无关来源不空转：同一唤醒=${batched}`, { ...({ skip: !available ? reason : false, timeout: 30000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const reviewed = [], sourceIds = ['batch-first', 'batch-second', 'batch-unrelated'];let original
  const h = await fixture(t, async request => {
    const routed = routeTask(request,original)
    if (routed) return routed
    const input = latestInput(request)
    if (!input.task.humanRequests.length) return [requestHuman('requester')]
    assert.ok(input.humanReview, '未答原问题时只允许事实核对')
    reviewed.push(input.humanReview.sourceIds)
    const sourceId = input.humanReview.sourceIds[0]
    const decision = { action: 'wait', summary: sourceId === sourceIds[0] ? '第一项目前只完成只读排查，仍待方案确认。'
      : sourceId === sourceIds[1] ? '第二项已查到既有实现，本轮尚未实施变更。' : '该条与原问题无关，保留原待答问题。',
      evidence: ['已核对当前待答问题和本条完整来源，未收到批准'], limitations: [] }
    if (sourceId !== sourceIds[2]) decision.replySourceId = sourceId
    return [call('task_result', { decision })]
  })
  await t.beginBusiness()

  const created=await createGroupTask(h,'batch-followup-'+batched,'方案等待确认，允许只读回答事实追问')
  await t.step(async () => h.service.whenIdle())
  original = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  // 在恢复调度前积压完整来源，精确覆盖一个 wake 含多来源和多个 wake 两种账本状态。
  const command = (kind, args, id) => h.service.store.command({ id: `batch:${id}`, kind, args })
  for (const [index, sourceId] of sourceIds.entries()) {
    await t.step(async () => command('source.record', { sourceId, groupId: 'native-group', messageId: `message-${index}`, actorId: `member-${index}`,
      text: index < 2 ? `第 ${index + 1} 项目前已经实施了什么？` : '另一件事下周再聊', channel: 'im' }, `source-${index}`))
    await t.step(async () => command('source.routed', { sourceId, receipt: [{ taskId: original.taskId }] }, `routed-${index}`))
  }
  for (const [index, refs] of (batched ? [sourceIds] : sourceIds.map((_, index) => sourceIds.slice(0, index + 1))).entries())
    await t.step(async () => command('task.supplement', { taskId: original.taskId, expectedRequirementRevision: original.requirementRevision,
      expectedControlRevision: original.controlRevision, messageId: `batch-${index}`, text: '待答期间收到新来源',
      sourceRefs: [...original.sourceRefs, ...refs] }, `supplement-${index}`))
  await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
  assert.deepEqual(reviewed, [sourceIds, sourceIds.slice(1), sourceIds.slice(2)])
  const after = await t.step(async () => h.query('task.get', { taskId: original.taskId }))
  assert.equal(after.humanRequests[0].status, 'waiting-reply')
  assert.equal(after.humanRequests[0].requestId, original.humanRequests[0].requestId)
  assert.equal(after.sessionId, original.sessionId)
  assert.deepEqual(after.humanRequests[0].followupReplies.map(item => item.sourceId), sourceIds.slice(0, 2))
  const replies=h.sent.filter(item=>sourceIds.includes(item.payload.sourceId))
  assert.equal(replies.length,2)
  assert.ok(replies.every(item=>item.payload.replyToMessageId===undefined&&item.payload.replyToSenderOpenDingTalkId===undefined))
  assert.deepEqual(replies.map(item=>item.payload.sourceRef),[{messageId:'message-0',messageVersion:1,actorId:'member-0'},{messageId:'message-1',messageVersion:1,actorId:'member-1'}])
  assert.deepEqual(replies.map(item=>item.payload.sourceId),sourceIds.slice(0,2))
  assert.deepEqual(replies.map(item => item.payload.recipientActorIds), [['member-0'], ['member-1']])
  for (const reply of replies) assert.equal((await t.step(async () => h.query('notification.get', { notificationId: reply.id }))).state, 'delivered')
  assert.equal((await t.step(async () => h.query('execution.list'))).length, 0)
  assert.equal((await t.step(async () => h.query('operation.list'))).length, 0)
  const count = h.requests.length
  await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
  assert.equal(h.requests.length, count)
  assert.equal(h.sent.filter(item=>replies.some(reply=>reply.id===item.id)).length,2);assert.equal(h.sent.some(item=>item.payload.sourceRef?.messageId==='message-2'),false)
}))

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

test('an original official task tool result cannot bypass human waiting and survives same-session reply',{timeout:30000},async t=>{
 let step=0,answered
 const proof='原任务此前只读核对结果，不能冒充人工授权'
 const h=await fixture(t,async request=>{const input=latestInput(request);if(!input.task.humanRequests.length){if(step++===0)return [call('read',{path:'materials/original.txt'})];return [requestHuman()]};answered=input;assert.match(JSON.stringify(request.messages),new RegExp(proof));return [finish('依据人工只读边界与原结果完成')]})
 // A managed task-local material is Host-owned evidence, not another execution session.
 const id='human-original-result';await h.service.store.command({id:'prepare-original-task',kind:'task.create',args:{taskId:id,groupId:'native-group',request:'核对原目标',ownerActorId:'native-user'}})
 const {taskWorkspace}=await import('../packages/dingtalk-core/session-workspaces.js'),{mkdir,writeFile}=await import('node:fs/promises'),cwd=await taskWorkspace(h.ctx.runtimePaths.workspaces,id);await mkdir(join(cwd,'materials'),{recursive:true});await writeFile(join(cwd,'materials','original.txt'),proof)
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
 const h=await fixture(t,async request=>{let routed=routeTask(request,original);if(routed){if(changed&&original&&routed[0].name==='resident_task_action')routed[0].args={...routed[0].args,kind:'revise',text:reply,objective:reply};return routed}
  const input=latestInput(request);if(!input.task.humanRequests.length)return [requestHuman('requester')]
  if(input.humanReview)return [call('task_human_resolve',{requestId:input.humanReview.requestId,sourceId:input.humanReview.sourceIds[0],reason:'原需求人明确限定同一事项的UAT3只读范围',evidence:[reply]}),call('task_result',{decision:{action:'wait',summary:'核验完整限制后由下一轮继续',evidence:[reply],limitations:[]}})]
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
 const h=await fixture(t,async request=>{const routed=routeTask(request,original);if(routed)return routed;const input=latestInput(request)
  if(!input.task.humanRequests.length){if(phase++===0)return [call('write',{path:'work/independent-progress.txt',content:'已授权范围内的独立修复已完成；原件精确复现待补证'})];return [humanRequest({audience:'requester',reason:'已知契约修复已保存；匿名原件仅阻塞精确复现',question:'请原需求负责人补充原件；不索取账号、不猜测匿名上传人',evidence:['独立修复已保存'],attemptedActions:['保留既有成果，不修改共享数据或部署']})]}
  if(input.humanReview)return [call('task_human_resolve',{requestId:input.humanReview.requestId,sourceId:input.humanReview.sourceIds[0],reason:'原需求人通过现受管入口补齐原件且仅准许只读复现',evidence:[answer]}),call('task_result',{decision:{action:'wait',summary:'原件来源与限制已核实，本轮保持只读',evidence:[answer],limitations:[]}})]
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
