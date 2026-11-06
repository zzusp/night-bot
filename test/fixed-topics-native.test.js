import {isDeepStrictEqual} from 'node:util'
import NativeSessionController from '../src/native-session-controller.js'
import NativeSchedule from '../src/native-schedule.js'
import * as scheduleTools from '../src/native-tool-schedule.js'
import { nativeLifecycle, nativeLifecycleTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { available, reason, nativeRuntimeHost as nativeTaskHost, latestInput, modelToolValues, waitUntil } from './fixtures/runtime-official-host.js'
import { openDynamicTaskStore } from '../packages/dingtalk-core/dynamic-task-store.js'
import { openTaskSessionService } from '../packages/dingtalk-core/task-session-service.js'
import { openResidentStore } from '../packages/dingtalk-core/store.js'
import { createFixedTopicHandler } from '../packages/dingtalk-core/fixed-topic-handler.js'
import { createPlatformSchedules } from '../packages/dingtalk-core/platform-schedule.js'
import { sessionWorkspace } from '../packages/dingtalk-core/session-workspaces.js'
import { createDwsAdapter } from '../packages/dingtalk-core/dws-adapter.js'
import { sendWorkflowNotification } from '../packages/dingtalk-core/group-message.js'
import { taskNotificationRecovery } from '../packages/dingtalk-core/notification-delivery.js'
import { fixedUnitRequestId } from '../packages/dingtalk-core/fixed-topics.js'

async function nativeSchedule(h) {
  if(h.ctx.get('schedule'))return true
  if(!h.ctx.get('sessionController'))await h.ctx.plugin(NativeSessionController)
  await h.ctx.plugin(NativeSchedule,{})
  await h.ctx.plugin(scheduleTools)
  await h.ctx.schedule.ready
  await h.ctx.fiber.await()
  h.ctx.schedule.start()
  return true
}

function fixedReplyModel(category) {
  let queried=false,replied=false,settled=false
  return request=>{
    const input=latestInput(request),names=request.tools.map(tool=>tool.name)
    if(names.includes('channel_triage_submit'))return [{name:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'平台问询需要读取当前事实'}))}}]
    assert.ok(names.includes('resident_router_settle'))
    assert.ok(names.includes('platform_task_query'));assert.ok(!names.includes('platform_reply_submit'))
    const source=input.events.find(event=>event.source)?.source
    if(!queried){queried=true;return [{name:'platform_task_query',args:{state:category==='agent-platform'?'completed':'all'}}]}
    if(!replied){replied=true;return [{name:'resident_router_reply',args:{operationId:'immediate-platform-reply',sourceId:source.sourceId,messageVersion:source.version,text:'当前范围没有已完成任务；可继续提供需要核查的事项。'}}]}
    if(!settled){settled=true;return [{name:'resident_router_settle',args:{operationId:'settle-platform-request',eventIds:input.events.map(event=>event.id)}}]}
    return []
  }
}
const fixedMessage = { groupId: 'native-group', messageId: 'platform-request', senderOpenDingTalkId: 'native-user',
  text: '测试助手，请说明今天的工作成果', occurredAt: '2026-10-28T00:00:00Z', mentionedAgent: true }

for(const category of ['agent-platform','out-of-scope'])test(`resident Router ${category} query replies through the real outbound ledger without an active Topic`,{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
  const root=await mkdtemp(join(tmpdir(),'router-platform-native-'));let h
  t.after(async()=>{await h?.close();await rm(root,{recursive:true,force:true})})
  await t.beginBusiness();h=await t.step(()=>nativeTaskHost(root,fixedReplyModel(category)))
  await t.step(()=>h.service.ingest(fixedMessage));await t.step(()=>h.service.whenIdle())
  await t.step(()=>h.service.recover());await t.step(()=>h.service.whenIdle())
  const [notification]=await h.query('notification.list')
  assert.ok(notification,JSON.stringify(h.toolResults));assert.equal(notification.kind,'router-reply');assert.equal(notification.state,'delivered')
  assert.equal(notification.taskId,null);assert.deepEqual(notification.payload.topicRefs,[]);assert.deepEqual(notification.payload.taskIds,[])
  assert.equal(notification.payload.sourceRef.messageId,fixedMessage.messageId);assert.equal(notification.payload.sourceRef.actorId,fixedMessage.senderOpenDingTalkId)
  assert.equal(notification.payload.sourceVersion,1);assert.equal(notification.payload.sourceMessageId,fixedMessage.messageId);assert.equal(notification.payload.actorId,fixedMessage.senderOpenDingTalkId)
  assert.deepEqual(notification.payload.atOpenDingTalkIds,[fixedMessage.senderOpenDingTalkId]);assert.equal(h.sent.length,1);assert.equal(h.readbacks.length,1)
  assert.deepEqual(h.residentStore.getGroup(fixedMessage.groupId).topics,[]);assert.deepEqual(await h.query('task.list'),[])
  const actorId=h.toolResults.find(row=>row.name==='resident_router_reply').sessionId
  const saved=await h.ctx.sessionPersistence.readNative(actorId,{requireComplete:true})
  assert.equal(saved.header.runtimeOwner,'conversation-router');assert.equal(saved.header.conversationId,fixedMessage.groupId)
  assert.ok(saved.audit.some(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'))
  const prepare={notificationId:notification.id,taskId:null,requirementRevision:1,kind:notification.kind,payload:notification.payload}
  const changes=[p=>{p.sourceRef.actorId='other-actor'},p=>{p.conversationId='other-group'},p=>{p.sourceRef.messageVersion=2},p=>{p.sourceRef.messageId='foreign-message'},p=>{p.atAll=true}]
  for(const [index,change] of changes.entries()){
    const payload=structuredClone(notification.payload);change(payload)
    await assert.rejects(h.service.store.command({id:'invalid-router-source-'+index,kind:'notification.prepare',args:{...prepare,payload}}),{code:'DYNAMIC_DIRECT_SOURCE_INVALID'})
  }
  await h.service.recover();await h.service.whenIdle();assert.equal(h.sent.length,1)
}))

for (const legacyFrozen of [false, true]) test(`restart resumes a frozen fixed reply before notification prepare without regenerating it: legacy=${legacyFrozen}`, { ...({ skip: !available ? reason : false, timeout: 20000 }), timeout: nativeLifecycleTimeout(20000) }, nativeLifecycle(20000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fixed-outbound-restart-'))
  let h
  t.after(async () => { await h?.close(); await rm(root, { recursive: true, force: true }) })
  const ledger = await openDynamicTaskStore({ dbPath: join(root, 'dynamic.db'), instanceId: 'native-test', initialize: true })
  t.after(() => ledger.close())
  await t.beginBusiness()
  h = await t.step(async () => nativeTaskHost(root, () => {assert.fail('历史冻结答复不能重新推理')}, {store:ledger}))
  await h.residentStore.ingest(fixedMessage)
  await h.residentStore.routeMessages({groupId:fixedMessage.groupId,routeId:'old-fixed-route',routingRevision:0,routes:[{messageId:fixedMessage.messageId,messageVersion:1,units:[{unitKey:'old-platform',summary:'历史平台问询',sourceRefs:[{quote:fixedMessage.text}],topics:[],fixedTopic:'agent-platform',reason:'旧版已冻结'}]}]})
  await ledger.command({id:'historical-fixed-source',kind:'source.record',args:{sourceId:'historical-fixed-source',groupId:fixedMessage.groupId,messageId:fixedMessage.messageId,actorId:fixedMessage.senderOpenDingTalkId,version:1,text:fixedMessage.text}})
  const message=h.residentStore.getGroup(fixedMessage.groupId).messages[0],unit=message.units[0],outboundId=fixedUnitRequestId(fixedMessage.groupId,message,unit)
  await h.residentStore.appendOutbox({groupId:fixedMessage.groupId,outboundId,sourceMessageId:outboundId,topicRefs:[],taskIds:[],fixedTopic:'agent-platform',sourceVersion:1,matterUnitRefs:[{unitId:unit.unitId,unitRevision:unit.unitRevision}],replyKind:'substantive',text:'历史已冻结工作汇报，恢复时保留原文及受众。',atOpenDingTalkIds:[fixedMessage.senderOpenDingTalkId],...(legacyFrozen?{replyToMessageId:fixedMessage.messageId,replyToSenderOpenDingTalkId:fixedMessage.senderOpenDingTalkId}:{sourceRef:{messageId:fixedMessage.messageId,messageVersion:1,actorId:fixedMessage.senderOpenDingTalkId}})})
  const [frozen] = h.residentStore.getGroup(fixedMessage.groupId).outbox
  assert.ok(frozen,JSON.stringify(h.service.listAlerts())); assert.equal(frozen.status, 'pending')
  assert.equal(h.sent.length, 0); assert.deepEqual(await t.step(async () => h.query('notification.list')), [])
  assert.equal(h.residentStore.getGroup(fixedMessage.groupId).messages[0].units[0].fixedTopicHandledAt, undefined)
  await t.step(async () => h.close()); await t.step(async () => ledger.close())
  h = await t.step(async () => nativeTaskHost(root, () => { assert.fail('frozen reply must not invoke a model again') }, { initialize: false }))
  await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
  const [notification] = await t.step(async () => h.query('notification.list'))
  assert.ok(notification,JSON.stringify({alerts:h.service.listAlerts(),frozen:h.residentStore.getGroup(fixedMessage.groupId).outbox}));assert.equal(notification.id, frozen.outboundId); assert.equal(notification.state, 'delivered')
  assert.equal(notification.payload.sourceMessageId, legacyFrozen ? fixedMessage.messageId : undefined)
  assert.equal(notification.payload.sourceRef?.messageId, legacyFrozen ? undefined : fixedMessage.messageId)
  assert.equal(notification.payload.text, frozen.text)
  assert.equal(h.sent.length, 1); assert.equal(h.readbacks.length, 1)
  assert.equal(h.residentStore.getGroup(fixedMessage.groupId).outbox.length, 1)
  assert.deepEqual(await t.step(async () => h.query('task.list')), [])
  await t.step(async () => h.close())
  h = await t.step(async () => nativeTaskHost(root, () => { assert.fail('delivered fixed reply must not regenerate') }, { initialize: false }))
  await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
  assert.equal(h.sent.length, 0); assert.equal(h.readbacks.length, 0)
  assert.equal((await t.step(async () => h.query('notification.list'))).length, 1)
}))

test('native platform tools coexist with preset tools and full access stays session-local', { ...({ skip: !available ? reason : false, timeout: 20000 }), timeout: nativeLifecycleTimeout(20000) }, nativeLifecycle(20000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'platform-native-'))
  let h, store, handler, step = 0
  t.after(async () => { await handler?.close(); await store?.close(); await h?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  await t.step(async () => writeFile(join(root, 'probe.txt'), 'native-platform-read'))
  const errors = [], modes = []
  h = await t.step(async () => nativeTaskHost(root, request => {
    const names = request.tools.map(tool => tool.name)
    for (const name of ['read', 'write', 'platform_task_query', 'platform_reply_submit']) assert.ok(names.includes(name), name)
    if (step++ === 0) return [{ name: 'read', args: { path: join(root, 'probe.txt') } }, { name: 'platform_task_query', args: { state: 'completed', day: 'today' } }]
    return [{ name: 'platform_reply_submit', args: { atOpenDingTalkIds: ['test-actor'], text: '约定时间已过，现补报：本群当前范围没有完成记录。' } }]
  }, { resident: true }))
  h.ctx.on('tools/result', exec => modes.push(h.ctx.permissionPresets.current(exec.agent)))
  h.ctx.on('agent/error', event => errors.push(event.error))
  const ordinary = await t.step(async () => h.ctx.agents.create({ sessionId: 'ordinary-session',meta:{cwd:h.ctx.runtimePaths.workspaces},agentOptions:{provider:'native-task-test',model:'controlled'} }))
  assert.equal(h.ctx.permissionPresets.current(ordinary.agent), 'workspace-write')
  assert.throws(()=>h.ctx.agents.withInitiator(ordinary.agent,()=>createFixedTopicHandler({ctx:h.ctx,store:{},root:h.ctx.runtimePaths.workspaces})),/PLATFORM_QUERY_HOST_CONTEXT_REQUIRED/)
  store = await t.step(async () => openResidentStore(h.ctx.storageDomain))
  await t.step(async () => store.subscribe({ groupId: 'test-group', timezone: 'Asia/Shanghai' }))
  const text = '八点十分汇报今天工作成果'
  await t.step(async () => store.ingest({ groupId: 'test-group', messageId: 'test-message', text, occurredAt: '2026-10-28T00:00:00Z', senderOpenDingTalkId: 'test-actor' }))
  await t.step(async () => store.routeMessages({ groupId: 'test-group', routeId: 'test-route', routingRevision: 0, routes: [{ messageId: 'test-message', messageVersion: 1,
    units: [{ unitKey: 'report', summary: '工作汇报', sourceRefs: [{ quote: text }], topics: [], fixedTopic: 'agent-platform', reason: '平台汇报' }] }] }))
  handler = createFixedTopicHandler({ ctx: h.ctx, store, root:h.ctx.runtimePaths.workspaces, legacy: { getAgentConfig: () => ({ agentPreset: 'night-bot' }) },
    models: { provider: 'native-task-test', model: 'controlled' }, now: () => Date.parse('2026-10-28T00:30:00Z'),
    readTasks: async () => [], appendOutbox: args => store.appendOutbox(args), onError: (_group, error) => errors.push(error) })
  handler.schedule('test-group'); await t.step(async () => handler.whenIdle()); handler.schedule('test-group'); await t.step(async () => handler.whenIdle())
  assert.deepEqual(errors, [], JSON.stringify({ requests: h.requests.length, results: h.toolResults, errors: errors.map(error => error?.message) }))
  assert.equal(h.requests.length, 2)
  assert.deepEqual(h.toolResults.map(item => [item.name, item.result.isError === true]).sort(), [['platform_reply_submit', false], ['platform_task_query', false], ['read', false]])
  assert.match(JSON.stringify(h.toolResults.find(item=>item.name==='read').result.content),/native-platform-read/)
  assert.ok(modes.length === 3 && modes.every(mode => mode === 'danger-full-access'))
  assert.equal(h.ctx.permissionPresets.current(ordinary.agent), 'workspace-write')
  assert.equal(store.getGroup('test-group').outbox.length, 1)
  assert.equal(store.listTasks().length, 0)
  await t.step(async () => ordinary.dispose())
}))

test('rc2 native schedule tool remains visible and reports its delegated-session boundary truthfully', { ...({ skip: !available ? reason : false, timeout: 20000 }), timeout: nativeLifecycleTimeout(20000) }, nativeLifecycle(20000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'platform-schedule-native-'))
  let h, handle, step = 0
  t.after(async () => { await handle?.dispose(); await h?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  h = await t.step(async () => nativeTaskHost(root, request => {
    assert.ok(request.tools.some(tool => tool.name === 'schedule_create'))
    return step++ === 0 ? [{ name: 'schedule_create', args: { title: '工作汇报', prompt: '汇报当前工作成果', after_seconds: 600 } }] : []
  }, { resident: true }))
  if (!await t.step(async () => nativeSchedule(h))) return
  const packet={id:'schedule-probe',source:{kind:'fixture-probe'},content:[{type:'text',text:JSON.stringify({task:{title:'检查当前会话的原生调度边界'}})}]}
  handle = await t.step(async () => h.ctx.agents.create({ sessionId: 'schedule-platform-session',authorizeInput:candidate=>isDeepStrictEqual(candidate,packet), meta: { cwd: h.ctx.runtimePaths.workspaces, origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: 'native-task-test', model: 'controlled' }, setup: async (agentCtx, agent) => {
      await agentCtx.get('agentPresets').mount(agentCtx, 'night-bot')
      await agentCtx.get('permissionPresets').set(agent, 'danger-full-access')
    } }))
  await handle.agent.input.enqueue(packet);await handle.agent.input.deliver(packet.id)
  await t.step(async () => handle.agent.whenIdle())
  assert.equal(h.toolResults[0].name, 'schedule_create')
  assert.match(JSON.stringify(h.toolResults[0].result), /subagent_session/)
  assert.deepEqual(await t.step(async () => h.ctx.schedule.list({ sessionId: handle.agent.id })), [])
}))

for (const scenario of ['before-due', 'late-bridge', 'superseded']) test('Host native one-shot survives restart, retains child identity, queries fresh facts and delivers once: ' + scenario, { ...({ skip: !available ? reason : false, timeout: 15000 }), timeout: nativeLifecycleTimeout(15000) }, nativeLifecycle(15000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'platform-due-native-'))
  // 固定测试时钟，冷启动与持久化耗时不能提前消耗提醒的等待时间。
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const restoreLate = scenario === 'late-bridge', superseded = scenario === 'superseded'
  let h, handler, originalTurns = 0, dueTurns = 0, taskTitle = '创建时旧事实', receiptFault = scenario === 'before-due'
  const errors = [], childHeaders = [], taskReads = [], scheduled = { title: '工作汇报', prompt: '汇报本群今天的工作成果' }
  const boot = async (late = false) => {
    h = await nativeTaskHost(root, request => {
      if (request.tools.some(tool => tool.name === 'platform_schedule_submit')) {
        if (originalTurns++ === 0) {
          // Cold Host/preset startup is not part of the reminder's waiting time.
          // Freeze one target at submission, then retry that exact same instant.
          scheduled.at = new Date(Date.now() + 2500).toISOString()
          return [0, 1].map(() => ({ name: 'platform_schedule_submit', args: scheduled }))
        }
        return [{ name: 'platform_reply_submit', args: { atOpenDingTalkIds: ['original-actor'], text: '已安排本次工作汇报。' } }]
      }
      if (!request.tools.some(tool => tool.name === 'platform_task_query')) return []
      if (dueTurns++ === 0) return [{ name: 'platform_task_query', args: { state: 'completed', day: 'today' } }]
      assert.match(JSON.stringify(request.messages), /到期时新事实/)
      return [{ name: 'platform_reply_submit', args: { atOpenDingTalkIds: ['original-actor'], text: '本群当前完成一项：到期时新事实。' } }]
    }, { resident: true })
    h.ctx.on('agent/error', event => errors.push(event.error))
    h.ctx.on('tools/result', exec => { if (exec.name === 'platform_schedule_submit') childHeaders.push(exec.agent.metadata) })
    h.residentStore = await openResidentStore(h.ctx.storageDomain)
    const update = h.residentStore.updatePlatformSchedule
    h.residentStore.updatePlatformSchedule = (id, changes) => {
      if (receiptFault && changes.scheduleId) { receiptFault = false; throw new Error('injected_receipt_write_failure') }
      return update(id, changes)
    }
    if (late) {
      if (!await nativeSchedule(h)) return false
      await waitUntil(async () => (await h.ctx.schedule.catalog())[0]?.status === 'inactive', 'native service delivers while bridge is loading')
    }
    handler = createFixedTopicHandler({ ctx: h.ctx, store: h.residentStore, root:h.ctx.runtimePaths.workspaces, legacy: { getAgentConfig: () => ({ agentPreset: 'night-bot' }) },
      models: { provider: 'native-task-test', model: 'controlled' }, readTasks: async groupId => {
        taskReads.push({ groupId, title: taskTitle, at: Date.now() })
        return [{ taskId: 'test-task', groupId, title: taskTitle, state: 'completed', completedAt: new Date().toISOString() }]
      },
      appendOutbox: args => h.residentStore.appendOutbox(args), onError: (_group, error) => errors.push(error) })
    return late || nativeSchedule(h)
  }
  t.after(async () => { await handler?.close(); await h?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  if (!await t.step(async () => boot())) return
  await t.step(async () => h.residentStore.subscribe({ groupId: 'scheduled-group', timezone: 'Asia/Shanghai' }))
  const text = '稍后汇报本群今天工作成果'
  await t.step(async () => h.residentStore.ingest({ groupId: 'scheduled-group', messageId: 'scheduled-source', senderOpenDingTalkId: 'original-actor', text, occurredAt: new Date().toISOString() }))
  await t.step(async () => h.residentStore.routeMessages({ groupId: 'scheduled-group', routeId: 'scheduled-route', routingRevision: 0, routes: [{ messageId: 'scheduled-source', messageVersion: 1,
    units: [{ unitKey: 'scheduled', summary: '定时汇报', sourceRefs: [{ quote: text }], topics: [], fixedTopic: 'agent-platform', reason: '一次平台事项' }] }] }))
  handler.schedule('scheduled-group'); await t.step(async () => handler.whenIdle())
  assert.deepEqual(errors, [])
  const [record] = await t.step(async () => h.ctx.schedule.catalog())
  assert.equal((await t.step(async () => h.ctx.schedule.catalog())).length, 1, JSON.stringify(h.toolResults))
  assert.equal(record.status, 'active')
  if (scenario === 'before-due') assert.equal(h.toolResults.filter(item => item.name === 'platform_schedule_submit' && item.result.isError).length, 1)
  assert.ok(childHeaders.length === 2 && childHeaders.every(header => header.origin === 'subagent' && header.delegationDepth === 1))
  const persisted = await t.step(async () => h.ctx.sessionPersistence.readNative(record.sessionId,{requireComplete:true}))
  assert.equal(persisted.header.origin, undefined); assert.equal(persisted.header.delegationDepth ?? 0, 0)
  assert.equal(h.residentStore.getGroup('scheduled-group').outbox.length, 1)
  if (superseded) await t.step(async () => h.residentStore.ingest({ groupId: 'scheduled-group', messageId: 'scheduled-source', messageVersion: 2, senderOpenDingTalkId: 'original-actor', text: '撤回之前的汇报要求', occurredAt: new Date().toISOString() }))
  taskTitle = '到期时新事实'
  await t.step(async () => handler.close()); await t.step(async () => h.close())
  if (restoreLate) t.mock.timers.tick(2501)
  await t.step(async () => boot(restoreLate))
  if (!restoreLate) { t.mock.timers.tick(2501); h.ctx.schedule.start() }
  await t.step(async () => waitUntil(() => h.residentStore.getPlatformSchedule(record.sessionId)?.outcome === (superseded ? 'superseded' : 'replied'), 'native reminder settles the original group report').catch(async error=>{t.diagnostic(JSON.stringify({tools:h.toolResults,errors:errors.map(e=>e.stack),dueTurns,originalTurns,catalog:await h.ctx.schedule.catalog(),binding:h.residentStore.getPlatformSchedule(record.sessionId),actor:h.ctx.agents.get(record.sessionId)?{id:record.sessionId,status:h.ctx.agents.get(record.sessionId).status,admission:h.ctx.agents.get(record.sessionId).admission.pending()}:null}));throw error}))
  // The Agent can settle before Schedule's separate inbox flush/status commit.
  // Await that durable boundary too; neither completion stands in for the other.
  await t.step(async () => waitUntil(async () => (await h.ctx.schedule.catalog()).find(item => item.id === record.id)?.status === 'inactive', 'original native reminder commits its delivery'))
  assert.deepEqual(errors, [])
  const outbox = h.residentStore.getGroup('scheduled-group').outbox
  assert.equal(outbox.length, superseded ? 1 : 2)
  assert.ok(outbox.every(item => item.sourceRef.messageId === 'scheduled-source' && item.sourceRef.actorId === 'original-actor' && !item.replyToMessageId))
  assert.equal((await t.step(async () => h.ctx.schedule.catalog()))[0].status, 'inactive')
  assert.equal((await t.step(async () => h.ctx.schedule.history({ sessionId: record.sessionId, id: record.id, limit: 10 }))).records.length, 1)
  assert.ok(taskReads.some(read => read.title === '创建时旧事实' && read.at < Date.parse(scheduled.at)))
  const dueReads = taskReads.filter(read => read.at >= Date.parse(scheduled.at))
  assert.equal(dueReads.length, superseded ? 0 : 1, JSON.stringify(taskReads))
  assert.ok(dueReads.every(read => read.groupId === 'scheduled-group' && read.title === '到期时新事实'))
  const restored = await t.step(async () => h.ctx.sessionController.resolveAgent(record.sessionId))
  await assert.rejects(restored.agent.input.enqueue({id:'duplicate-delivery-probe',source:{kind:'schedule'},content:[{type:'text',text:'[SCHEDULE REMINDER]\n重复送入同一事项'}]}),{code:'PI_BUSINESS_ADMISSION_DENIED'})
  await t.step(async () => restored.agent.whenIdle().catch(error=>{if(!['platform_schedule_settled','platform_schedule_superseded'].includes(error.code))throw error}))
  assert.equal(dueTurns, superseded ? 0 : 2); assert.equal(h.residentStore.getGroup('scheduled-group').outbox.length, superseded ? 1 : 2)
  assert.equal(h.residentStore.listTasks().length, 0)
}))

for (const audience of ['all', 'members']) test(`native due ${audience} report shares final delivery and recovers attachments after cold restart`, { ...({ skip: !available ? reason : false, timeout: 15000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'platform-scheduled-ledger-'))
  let h, originalTurns = 0, dueTurns = 0, initialize = true, filesReadable = false
  const dwsCalls = [], adapter = createDwsAdapter({ enabled: true, writesAuthorized: true, runner: { run: async args => { dwsCalls.push(args); return { exitCode: 0, stdout: '{"success":true}' } } } })
  const sends = [], errors = [], scheduleInput = { title: '工作汇报', prompt: '汇报本群今天完成情况' }
  const route = fixedReplyModel('agent-platform')
  const boot = async () => {
    h = await nativeTaskHost(root, request => {
      if(request.tools.some(tool=>tool.name==='channel_triage_submit'))return route(request)
      if(request.tools.some(tool=>tool.name==='resident_router_settle')){
        const input=latestInput(request),source=input.events.find(event=>event.source)?.source
        const identity={sourceId:source.sourceId,messageVersion:source.version}
        if(originalTurns++===0){scheduleInput.at=new Date(Date.now()+10000).toISOString();return [{name:'platform_schedule_submit',args:{...scheduleInput,...identity,operationId:'future-platform-report'}}]}
        if(originalTurns===2){assert.ok(modelToolValues(request).some(value=>value.status==='scheduled'),'真实排期收据成功后才能确认安排');return [{name:'resident_router_reply',args:{...identity,operationId:'scheduled-confirmation',text:'已安排本次工作汇报。'}}]}
        if(originalTurns===3)return [{name:'resident_router_settle',args:{operationId:'settle-future-report',eventIds:input.events.map(event=>event.id)}}]
        return []
      }
      if (!request.tools.some(tool => tool.name === 'platform_task_query')) return []
      if (dueTurns++ === 0) return [{ name: 'platform_task_query', args: { state: 'completed', day: 'today' } }]
      const page = modelToolValues(request).find(value => Array.isArray(value.items) && value.asOf)
      assert.ok(page, 'due report must read real task-service facts')
      assert.ok(Date.parse(page.asOf) >= Date.parse(scheduleInput.at))
      assert.deepEqual(page.items, [])
      return [{ name: 'platform_reply_submit', args: { ...(audience === 'all' ? { atAll: true } : { atOpenDingTalkIds: ['reviewer', 'native-user'] }), replyToMessageId: fixedMessage.messageId,
        text: '本次工作汇报：当前范围没有已完成任务。[验收说明](https://example.org/result)', files: [1, 2].map(index => ({ path: `result-${index}.png`, caption: `核验项${index}` })) } }]
    }, { resident: true })
    h.ctx.on('agent/error', event => errors.push(event.error))
    h.residentStore = await openResidentStore(h.ctx.storageDomain)
    if (initialize) {
      await h.residentStore.subscribe({ groupId: 'native-group', timezone: 'Asia/Shanghai', responsibility: '处理交办给测试助手的工作' })
      await h.residentStore.setAgentNames(['测试助手'])
      await h.residentStore.ingest({ groupId: 'native-group', messageId: 'reviewer-message', senderOpenDingTalkId: 'reviewer', text: '我是验收成员', occurredAt: new Date().toISOString() })
      await h.residentStore.routeMessages({ groupId: 'native-group', routeId: 'reviewer-route', routingRevision: 0, routes: [{ messageId: 'reviewer-message', messageVersion: 1, units: [], ignoredRefs: [{ quote: '我是验收成员', reason: '背景身份' }] }] })
      const directory = await sessionWorkspace(h.ctx.runtimePaths.workspaces, 'platform')
      for (const index of [1, 2]) await writeFile(join(directory, `result-${index}.png`), Buffer.from([137,80,78,71,index]))
    }
    const legacy = { getAgentConfig: () => ({ workspaceDir: h.ctx.runtimePaths.workspaces, agentPreset: 'night-bot', provider: 'native-task-test', model: 'controlled', agentNames: ['测试助手'] }),
      getGroup: id => h.residentStore.getGroup(id) }
    h.service = await openTaskSessionService({ ctx: h.ctx, residentStore: h.residentStore, legacy,
      config: { workspaceDir: h.ctx.runtimePaths.workspaces, dbPath: join(root, 'dynamic.db'), instanceId: 'scheduled-native-test', initialize, ownerActorId: 'native-user', provider: 'native-task-test' },
      notifications: {
        async send(notification) { await sendWorkflowNotification(adapter, notification); sends.push(structuredClone(notification)); return { messageId: `delivered-${notification.id}` } },
        async sendFile(notification, file) { assert.equal(file.artifactId, notification.payload.artifact.artifactId); sends.push(structuredClone(notification)); return { messageId: `delivered-${notification.id}` } },
        async readbackFile(notification) { return filesReadable ? { messageId: notification.ack.messageId, visible: true } : undefined },
        async readback(notification) { return { messageId: notification.ack.messageId, visible: true } },
      } })
    h.query = (kind, args = {}) => h.service.store.query({ kind, ...args })
    if (!await nativeSchedule(h)) return false
    initialize = false
    await h.service.recover(); await h.service.whenIdle()
    return true
  }
  t.after(async () => { await h?.close(); await rm(root, { recursive: true, force: true }) })
  t.onCancel(async()=>t.diagnostic(JSON.stringify({platformFinal:{notices:h?await h.query('notification.list'):[],alerts:h?.service.listAlerts(),errors:errors.map(value=>value.stack)}})))
  await t.beginBusiness()
  if (!await t.step(async () => boot())) return
  await t.step(async () => h.service.ingest({ ...fixedMessage, text: '测试助手，稍后汇报本群今天完成情况', occurredAt: new Date().toISOString() }))
  await t.step(async () => h.service.whenIdle())
  const [record] = await t.step(async () => h.ctx.schedule.catalog()), [confirmation] = await t.step(async () => h.query('notification.list'))
  assert.ok(record,JSON.stringify({tools:h.toolResults,alerts:h.service.listAlerts(),errors:errors.map(error=>error.message)}));assert.equal(record.status, 'active'); assert.equal(confirmation.state, 'delivered')
  assert.equal(sends.length, 1); assert.equal(dueTurns, 0)
  await t.step(async () => h.close()); await t.step(async () => boot())
  await t.step(async () => waitUntil(() => h.residentStore.getPlatformSchedule(record.sessionId)?.outcome === 'replied', 'scheduled report prepared after native cold restore')
    .catch(error => { t.diagnostic(JSON.stringify({ tools: h.toolResults.slice(-4), errors: errors.map(value => value.message) })); throw error }))
  await t.step(async () => waitUntil(async () => (await h.ctx.schedule.catalog()).find(item => item.id === record.id)?.status === 'inactive', 'original native report commits its delivery'))
  await t.step(async () => h.service.whenIdle())
  await t.step(async () => waitUntil(async () => (await h.query('notification.list')).some(item => item.payload.artifact && item.ack && item.readbackAttemptCount > 0), 'first attachment has its original ACK and unconfirmed readback')
    .catch(async error => { t.diagnostic(JSON.stringify({ recovery: await h.service.recover(), errors: errors.map(value => value.stack) })); throw error }))
  const notices = await t.step(async () => h.query('notification.list')), report = notices.find(item => item.id !== confirmation.id)
  assert.equal(notices.length, 4); assert.equal(report.kind, 'platform-reply'); assert.equal(report.state, 'delivered')
  const binding=h.residentStore.getPlatformSchedule(record.sessionId)
  assert.equal(binding.scheduleId,record.id);assert.equal(binding.at,scheduleInput.at)
  assert.equal(report.id,`${binding.requestId}-scheduled-delivery`)
  assert.equal(report.payload.sourceId,confirmation.payload.sourceId)
  assert.equal(report.payload.sourceRef.messageId, fixedMessage.messageId); assert.equal(report.payload.sourceRef.actorId, fixedMessage.senderOpenDingTalkId)
  assert.equal(report.payload.sourceMessageId, undefined); assert.equal(report.payload.actorId, undefined)
  assert.deepEqual(report.payload.topicRefs, []); assert.deepEqual(report.payload.atOpenDingTalkIds, audience === 'all' ? [] : ['reviewer', 'native-user']); assert.equal(report.payload.atAll, audience === 'all' ? true : undefined)
  const [firstFile, secondFile] = notices.filter(item => item.payload.artifact)
  assert.ok(['starting', 'unknown'].includes(firstFile.state)); assert.ok(firstFile.ack); assert.equal(secondFile.state, 'prepared')
  assert.equal(firstFile.payload.afterNotificationId, report.id); assert.equal(secondFile.payload.afterNotificationId, firstFile.id)
  assert.equal(firstFile.payload.artifact.taskId, undefined); assert.equal(firstFile.payload.artifact.platformSource.sessionId, record.sessionId);assert.equal(firstFile.payload.artifact.platformSource.sourceId,report.payload.sourceId);assert.equal(firstFile.payload.artifact.platformSource.unitId,undefined)
  assert.match(report.payload.text, /result-1.png：核验项1/); assert.ok(!dwsCalls.at(-1).includes('--ref-msg-id'))
  assert.equal(dwsCalls.at(-1).includes('--at-all'), audience === 'all')
  assert.ok(dwsCalls.at(-1).includes('--markdown'))
  assert.equal(sends.length, 3); assert.equal(dueTurns, 2); assert.deepEqual(errors, [])
  assert.deepEqual(await t.step(async () => h.query('task.list')), []); assert.deepEqual(h.residentStore.getGroup(fixedMessage.groupId).topics, [])
  assert.equal((await t.step(async () => h.ctx.schedule.catalog())).length, 1)
  assert.equal((await t.step(async () => h.ctx.schedule.history({ sessionId: record.sessionId, id: record.id, limit: 10 }))).records.length, 1)
  await t.step(async () => h.close()); filesReadable = true; await t.step(async () => boot())
  const pending = await t.step(async () => h.query('notification.get', { notificationId: firstFile.id }))
  await t.step(async () => h.service.retryNotification({ groupId: fixedMessage.groupId, notificationId: firstFile.id, expectedToken: taskNotificationRecovery(pending).expectedToken }))
  await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
  await t.step(async () => waitUntil(async () => (await h.query('notification.list')).every(item => item.state === 'delivered'), 'remaining parts read back after restart').catch(async error=>{t.diagnostic(JSON.stringify({remaining:(await h.query('notification.list')).map(item=>({id:item.id,state:item.state,ack:item.ack,error:item.deliveryError,nextAttemptAt:item.nextAttemptAt})),alerts:h.service.listAlerts(),errors:errors.map(value=>value.stack)}));throw error}))
  assert.equal(sends.length, 4); assert.equal(dueTurns, 2)
  assert.equal(new Set(sends.map(item => item.id)).size, 4, 'no already sent item is resent')
  assert.ok((await t.step(async () => h.query('notification.list'))).every(item => item.state === 'delivered'))
  const deliveredFile = await t.step(async () => h.query('notification.get', { notificationId: firstFile.id }))
  const echo = await t.step(async () => h.service.ingest({ groupId: fixedMessage.groupId, messageId: deliveredFile.receipt.messageId,
    senderOpenDingTalkId: fixedMessage.senderOpenDingTalkId, text: '[file] result-1.png', occurredAt: new Date().toISOString() }))
  assert.equal(echo.reason, 'own-notification', 'shared attachment receipts retain existing self-echo filtering')
  await t.step(async () => h.close()); await t.step(async () => boot()); assert.equal(sends.length, 4); assert.equal(dueTurns, 2)
}))

test('Host refuses an expired instant without scheduling tomorrow, while native source binding stays trusted', { ...({ skip: !available ? reason : false, timeout: 10000 }), timeout: nativeLifecycleTimeout(10000) }, nativeLifecycle(10000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'platform-expired-native-'))
  let h, bridge
  t.after(async () => { await bridge?.close(); await h?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  h = await t.step(async () => nativeTaskHost(root, () => [], { resident: true }))
  if (!await t.step(async () => nativeSchedule(h))) return
  h.residentStore = await t.step(async () => openResidentStore(h.ctx.storageDomain))
  await t.step(async () => h.residentStore.subscribe({ groupId: 'g', timezone: 'Asia/Shanghai' }))
  const text = '定点汇报'
  await t.step(async () => h.residentStore.ingest({ groupId: 'g', messageId: 'm', senderOpenDingTalkId: 'actor', text, occurredAt: new Date().toISOString() }))
  await t.step(async () => h.residentStore.routeMessages({ groupId: 'g', routeId: 'r', routingRevision: 0, routes: [{ messageId: 'm', messageVersion: 1,
    units: [{ unitKey: 'u', summary: '定时', sourceRefs: [{ quote: text }], topics: [], fixedTopic: 'agent-platform', reason: '平台事项' }] }] }))
  const message = h.residentStore.getGroup('g').messages[0], unit = message.units[0]
  const source = { groupId: 'g', messageId: 'm', messageVersion: 1, unitId: unit.unitId, unitRevision: unit.unitRevision, timezone: 'Asia/Shanghai', requestId: fixedUnitRequestId('g', message, unit) }
  bridge = createPlatformSchedules({ ctx: h.ctx, store: h.residentStore, root:h.ctx.runtimePaths.workspaces, legacy: { getAgentConfig: () => ({ agentPreset: 'night-bot' }) },
    readTasks: async () => [], appendOutbox: () => assert.fail('expired request must not send') })
  const args = { title: '工作汇报', prompt: '汇报工作', at: new Date(Date.now() - 60000).toISOString() }
  assert.equal((await t.step(async () => bridge.submit(source, args))).status, 'expired')
  assert.deepEqual(await t.step(async () => h.ctx.schedule.catalog()), [])
  await t.step(async () => assert.rejects(bridge.submit({ ...source, groupId: 'other' }, { ...args, at: new Date(Date.now() + 60000).toISOString() }), /source_stale/))
  await t.step(async () => assert.rejects(bridge.submit(source, { ...args, at: '2026-10-30T12:00:00' }), /requires_offset/))
  await t.step(async () => assert.rejects(bridge.submit(source, { ...args, at: '2099-02-30T12:00:00+08:00' }), /time_invalid/))
  const future = { ...args, at: new Date(Date.now() + 60000).toISOString() }
  const accepted = await t.step(async () => bridge.submit(source, future)), [record] = await t.step(async () => h.ctx.schedule.catalog())
  assert.equal(accepted.status, 'scheduled')
  await t.step(async () => assert.rejects(bridge.submit(source, { ...future, title: '不同事项' }), /identity_conflict/))
  await t.step(async () => h.ctx.schedule.delete({ sessionId: record.sessionId, id: record.id }))
  assert.equal((await t.step(async () => bridge.submit(source, future))).status, 'cancelled')
  assert.deepEqual(await t.step(async () => h.ctx.schedule.catalog()), [])
}))
