import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {nativeResidentSnapshot} from './fixtures/native-domain-snapshot.js'
import {providerHost,result} from './fixtures/provider-official-host.js'
import {memoryHost} from './fixtures/memory-host.js'
import { openResidentStore } from '../packages/dingtalk-core/store.js'
import { handleRequest } from '../packages/dingtalk-core/http.js'
import { taskNotificationRecovery } from '../packages/dingtalk-core/notification-delivery.js'
import { taskNotificationOutbound } from '../packages/dingtalk-core/task-message-projections.js'
import { openTaskSessionService } from '../packages/dingtalk-core/task-session-service.js'

// Actual official Host, provider loopback, SQL and HTTP. No Owner/leaf drivers.
test('official Single HTTP preserves one session, source revisions, idempotence and cancellation CAS',async t=>{
 const h=await providerHost(t,{decide:()=>[result('wait','Await the current authorized source')]}),service=h.service
 const runtime={isTaskSessionMode:()=>true,listTaskView:()=>service.boardTasks(),getTaskSessionDetail:id=>service.taskDetail(id),
  getTaskSessionExecutions:(...args)=>service.taskExecutions(...args),getTaskSessionDecisions:(...args)=>service.taskDecisions(...args),
  createTask:args=>service.createTask(args),appendTaskContext:args=>service.appendTaskContext(args),cancelTask:args=>service.cancelTask(args),
  getTaskDialogue:id=>service.taskDialogue(id),sendTaskDialogue:args=>service.sendTaskDialogue(args)}
 const server=createServer((req,res)=>handleRequest(req,res,runtime).catch(error=>{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}))}))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const base=`http://127.0.0.1:${server.address().port}`
 const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}}
 for(const path of ['/state/coordination-sources','/state/coordination-sources/old','/state/coordination-work'])assert.equal((await fetch(base+path)).status,410)
 const input={requestId:'official-http-create',groupId:'native-group',title:'Original HTTP task',objective:'Inspect only the original HTTP request and await authorized context',context:'Original exact HTTP source'}
 const created=await post('/tasks',input);assert.equal(created.status,200,JSON.stringify(created.body));await service.whenIdle()
 const id=created.body.taskId,sessionId=created.body.session.sessionId;assert.ok(id&&sessionId)
 const count=h.taskRequests().length
 const duplicate=await post('/tasks',input);assert.equal(duplicate.status,200);assert.equal(duplicate.body.taskId,id);await service.whenIdle();assert.equal(h.taskRequests().length,count)
 assert.deepEqual(await h.query('execution.list',{taskId:id}),[])
 let detail=await service.taskDetail(id)
 const missing=await post(`/tasks/${id}/context`,{requestId:'classification-missing',context:'No implicit authorization',expectedRequirementRevision:detail.requirementRevision,expectedControlRevision:detail.controlRevision});assert.equal(missing.status,400)
 const text='Explicit new authorized context, still the same objective'
 const args={requestId:'preserve-exact',progressImpact:'preserve',context:text,expectedRequirementRevision:detail.requirementRevision,expectedControlRevision:detail.controlRevision}
 const amended=await post(`/tasks/${id}/context`,args);assert.equal(amended.status,200,JSON.stringify(amended.body));await service.whenIdle()
 assert.equal(amended.body.session.sessionId,sessionId)
 const before=h.taskRequests().length;await post(`/tasks/${id}/context`,args);await service.whenIdle();assert.equal(h.taskRequests().length,before)
 detail=await service.taskDetail(id);assert.equal(detail.requirementRevision,1);assert.equal(detail.contextRevision,1)
 const native=await h.stored(id);assert.ok(JSON.stringify(native.entries).includes(text));assert.ok(JSON.stringify(native.entries).includes(input.context))
 assert.equal(native.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)
 const cancelled=await post(`/tasks/${id}/cancel`,{requestId:'cancel-exact',reason:'Stop this authorized request',expectedControlRevision:detail.controlRevision});assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));await service.whenIdle()
 assert.equal((await service.taskDetail(id)).control,'cancelled')
 const stale=await post(`/tasks/${id}/cancel`,{requestId:'stale-cancel',reason:'Stale revision',expectedControlRevision:detail.controlRevision});assert.equal(stale.status,409)
 assert.deepEqual(await h.query('execution.list',{taskId:id}),[])
})

const notificationGuardError = { phase: 'send', knownNotSent: true, retryable: true, exitCode: 1, stdout: '',
  stderr: JSON.stringify({ error: { category: 'api', code: 1, origin: 'mcp_gateway', operation: 'chat/get_conversation_info',
    reason: 'topic_quote_guard_unavailable', retryable: true, message: '无法确认引用回复目标是否属于话题圈，已阻止发送' } }) }

test('inbox projection startup failure releases the real ledger for an official Host retry',async t=>{
 const root=await mkdtemp(join(tmpdir(),'inbox-startup-')),dbPath=join(root,'tasks.sqlite'),native=await memoryHost(t)
 const args={ctx:native.host.ctx,residentStore:{listGroups:()=>[],getGroup:()=>null},legacy:{getAgentConfig:()=>({workspaceDir:root})},config:{dbPath,workspaceDir:root,instanceId:'inbox-startup',initialize:true}}
 try{
  await writeFile(dbPath+'.observer-inbox.sqlite','invalid sqlite')
  await assert.rejects(openTaskSessionService(args),/not a database/)
  await unlink(dbPath+'.observer-inbox.sqlite')
  const retry=await openTaskSessionService({...args,config:{...args.config,initialize:false}})
  await retry.close();assert.equal(native.requests.length,0);assert.equal(native.host.ctx.agents.list().length,0)
 }finally{await rm(root,{recursive:true,force:true})}
})

async function notificationServiceFixture(t, notifications) {
  const root = await mkdtemp(join(tmpdir(), 'notification-service-retry-')),storage=await nativeResidentSnapshot(),native=await memoryHost(t)
  const residentStore = await openResidentStore(storage.domains)
  await residentStore.subscribe({ groupId: 'g', name: '合成群', responsibility: '仅隔离测试' })
  const noop = async () => {}
  const service = await openTaskSessionService({ ctx:native.host.ctx, residentStore, notifications,
    legacy: { getAgentConfig: () => ({ workspaceDir: root }), getGroup: id => residentStore.getGroup(id) },
    config: { dbPath: join(root, 'tasks.sqlite'), workspaceDir: root, instanceId: 'notification-service', initialize: true } })
  t.after(async () => { await service.close(); await residentStore.close(); await storage.close(); await rm(root, { recursive: true, force: true }) })
  let sequence = 0
  const command = (kind, args) => service.store.command({ kind, args, id: `fixture:${++sequence}` })
  const read = id => service.store.query({ kind: 'notification.get', notificationId: id })
  const prepare = async (id, payload = {}) => (await command('notification.prepare', { notificationId: id, requirementRevision: 1, kind: 'topic-reply',
    payload: { conversationId: 'g', sourceMessageId: 'source', actorId: 'owner', sourceVersion: 1, text: '合成原回复', replyKind: 'substantive',
      fact: { topicRefs: [{ topicId: 'topic', revision: 1 }] }, ...payload } })).result.notification
  const failed = async (id, payload = {}, outbound = {}) => {
    await prepare(id, payload)
    const started = (await command('notification.start', { notificationId: id })).result.notification
    await command('notification.receipt', { notificationId: id, dispatchToken: started.dispatchToken, state: 'failed', error: notificationGuardError,
      nextAttemptAt: '2099-01-01T00:00:00Z' })
    const row = await read(id)
    await residentStore.projectTaskNotification({ groupId: 'g', outbound: { ...taskNotificationOutbound(row), ...outbound } })
    return row
  }
  const retry = row => service.retryNotification({ groupId: 'g', notificationId: row.id, expectedToken: taskNotificationRecovery(row).expectedToken })
  return { service, residentStore, command, read, prepare, failed, retry, dbPath: join(root, 'tasks.sqlite') }
}

test('notification service manual recovery uses the original identity, stages and private response whitelist', async t => {
  let sends = 0
  const f = await notificationServiceFixture(t, { send: async row => { sends++; assert.equal(row.id, 'notice'); return { openTaskId: 'accepted' } },
    readback: async () => ({ messageId: 'verified', conversationId: 'g' }) })
  await f.command('source.record', { sourceId: 'stage-source', groupId: 'g', messageId: 'source', actorId: 'owner', text: '合成来源', version: 1 })
  await f.residentStore.ingest({groupId:'g',messageId:'verified',text:'合成原回复',senderOpenDingTalkId:'unknown-at-ingress',occurredAt:'2026-10-29T00:00:00Z'})
  assert.equal(f.residentStore.getGroup('g').messages.find(message=>message.messageId==='verified').sourceKind,'channel')
  await f.service.observerGroupPage.ready()
  assert.equal((await f.service.observerGroupPage('g')).items.some(message=>message.messageId==='verified'),true)
  const failed = await f.failed('notice')
  const result = await f.retry(failed)
  assert.deepEqual(result, { groupId: 'g', notificationId: 'notice', status: 'attempted', action: 'send' })
  assert.doesNotMatch(JSON.stringify(result), /payload|合成原回复|owner|dispatchToken/)
  const delivered = await f.read('notice')
  assert.equal(delivered.state, 'delivered'); assert.equal(delivered.sendAttemptCount, 2); assert.equal(sends, 1)
  assert.equal(delivered.payloadDigest, failed.payloadDigest)
  const source = await f.service.store.query({ kind: 'source.get', sourceId: 'stage-source' })
  assert.deepEqual(source.stages.map(stage => stage.stage), ['send', 'readback'])
  assert.ok(source.stages.every(stage => stage.completedAt))
  assert.equal(f.residentStore.getGroup('g').outbox.find(row => row.outboundId === 'notice').notificationState, 'delivered')
  await f.service.observerGroupPage.ready()
  assert.equal((await f.service.observerGroupPage('g')).items.some(message=>message.messageId==='verified'),false,'late delivery identity removes the earlier echo from the persistent inbox')
  await assert.rejects(f.retry(failed), { code: 'DYNAMIC_NOTIFICATION_RECOVERY_STALE' })
  await assert.rejects(f.retry(delivered), { code: 'TASK_NOTIFICATION_RECOVERY_FORBIDDEN' })
  assert.equal(f.service.listAlerts().some(row => row.alertId === 'failure:notice'), false, 'a forbidden click is not a delivery failure')
})

test('notification service rejects wrong group, missing identity, operator rows and stale CAS without effects', async t => {
  const f = await notificationServiceFixture(t, { send: async () => assert.fail('must not send'), readback: async () => assert.fail('must not read') })
  const row = await f.prepare('notice'), expectedToken = taskNotificationRecovery(row).expectedToken
  const before = await f.service.store.query({ kind: 'notification.list' })
  for (const args of [{ groupId: 'other', notificationId: row.id, expectedToken }, { groupId: 'g', notificationId: 'missing', expectedToken },
    { groupId: '', notificationId: row.id, expectedToken }])
    await assert.rejects(f.service.retryNotification(args), { code: 'TASK_NOTIFICATION_NOT_FOUND' })
  await assert.rejects(f.service.retryNotification({ groupId: 'g', notificationId: row.id, expectedToken: 'old' }), { code: 'DYNAMIC_NOTIFICATION_RECOVERY_STALE' })
  assert.deepEqual(await f.service.store.query({ kind: 'notification.list' }), before)
  const privateRow = await f.prepare('private', { audience: 'operator', recipientUserId: 'PRIVATE' })
  await assert.rejects(f.retry(privateRow), { code: 'TASK_NOTIFICATION_NOT_FOUND' })
  assert.equal(f.residentStore.getGroup('g').outbox.some(row => row.outboundId === 'private'), false)
})

for (const gate of ['superseded', 'recall', 'confirmation', 'task-terminal']) test(`notification service shares automatic retirement gate: ${gate}`, async t => {
  const f = await notificationServiceFixture(t, { send: async () => assert.fail('retired intent must not send'), readback: async () => assert.fail('must not read') })
  const outbound = gate === 'superseded' ? { status: 'superseded', supersededByOutboundId: 'new' }
    : gate === 'recall' ? { recallStatus: 'recalled' } : {}
  if (gate === 'task-terminal') {
    await f.command('task.create', { taskId: 'terminal', groupId: 'g', request: '合成任务', operationId: 'decision:action:0' })
    await f.command('task.control', { taskId: 'terminal', control: 'cancelled' })
    outbound.taskIds = ['terminal']; outbound.decisionId = 'decision'
  }
  const payload = ['confirmation', 'task-terminal'].includes(gate) ? { replyKind: 'confirmation' } : {}
  const row = await f.failed('notice', payload, outbound)
  await assert.rejects(f.service.retryNotification({ groupId: 'g', notificationId: row.id, expectedToken: 'old' }),
    { code: 'DYNAMIC_NOTIFICATION_RECOVERY_STALE' })
  assert.deepEqual(await f.read('notice'), row)
  await assert.rejects(f.retry(row), { code: 'TASK_NOTIFICATION_RECOVERY_FORBIDDEN' })
  const retired = await f.read('notice')
  assert.equal(retired.retirement.reason, ['superseded', 'recall'].includes(gate) ? 'superseded'
    : gate === 'confirmation' ? 'confirmation-reassessment-required' : 'task-terminal')
  assert.equal(retired.sendAttemptCount, 1)
  assert.equal(f.service.listAlerts().some(row => row.alertId === 'failure:notice'), false, 'retirement is not a failed effect')
  await f.failed('automatic', payload, outbound)
  await f.service.whenIdle()
  assert.equal((await f.read('notice')).sendAttemptCount, 1)
  assert.equal((await f.read('automatic')).retirement.reason, retired.retirement.reason)
  assert.equal((await f.read('automatic')).sendAttemptCount, 1)
})

test('notification service manual unknown recovery is readback-only and rejects concurrent automatic or manual effects', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  let sends = 0, reads = 0
  t.after(() => release.resolve())
  const f = await notificationServiceFixture(t, { send: async () => { sends++; throw new Error('network timeout') },
    readback: async () => { reads++; entered.resolve(); await release.promise; return { messageId: 'verified', conversationId: 'g' } } })
  await f.prepare('notice')
  await f.service.whenIdle()
  const unknown = await f.read('notice')
  assert.equal(unknown.state, 'unknown'); assert.equal(sends, 1)
  const pending = f.retry(unknown)
  await entered.promise
  await assert.rejects(f.retry(unknown), { code: 'TASK_NOTIFICATION_RECOVERY_IN_PROGRESS' })
  const auto = f.service.whenIdle()
  release.resolve(); await pending; await auto
  assert.equal(reads, 1); assert.equal(sends, 1); assert.equal((await f.read('notice')).state, 'delivered')
})


test('notification service manual refusal remains recoverable after credentials are repaired', async t => {
  let blocked = true, sends = 0
  const f = await notificationServiceFixture(t, { send: async () => {
    sends++
    if (blocked) throw Object.assign(new Error('upstream HTTP 401'), notificationGuardError)
    return { openTaskId: 'accepted' }
  }, readback: async () => ({ messageId: 'verified' }) })
  const failed = await f.failed('notice')
  await assert.rejects(f.retry(failed), /upstream HTTP 401/)
  const stillFailed = await f.read('notice')
  assert.equal(stillFailed.state, 'failed'); assert.equal(stillFailed.sendAttemptCount, 2)
  assert.ok(Date.parse(stillFailed.nextAttemptAt) > Date.now())
  blocked = false
  await f.retry(stillFailed)
  assert.equal((await f.read('notice')).state, 'delivered'); assert.equal(sends, 2)
})

test('notification service refuses manual replay of historical coordination without touching its receipt', async t => {
  const f = await notificationServiceFixture(t, { send: async () => assert.fail('retired notice must not send'), readback: async () => assert.fail('retired notice must not restart') })
  const old = { id: 'old-notice', notificationId: 'old-notice', kind: 'coordination', state: 'unknown',
    payload: { conversationId: 'g', text: 'Historical question' }, dispatchToken: 'prior-attempt' }
  const db = new DatabaseSync(f.dbPath)
  db.prepare('INSERT INTO dynamic_notifications(id,body) VALUES (?,?)').run(old.id, JSON.stringify(old)); db.close()
  await assert.rejects(f.retry(old), { code: 'INDEPENDENT_COORDINATION_RETIRED' })
  await f.service.whenIdle()
  assert.deepEqual(await f.read(old.id), old)
})

test('manual readback does not block a new send and both notifications settle without replay', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  t.after(() => release.resolve())
  const sends = [], reads = []
  const f = await notificationServiceFixture(t, { send: async row => { sends.push(row.id); return { messageId: `sent-${row.id}` } },
    readback: async row => { reads.push(row.id); if (row.id === 'manual') { entered.resolve(); await release.promise }; return { messageId: `sent-${row.id}`, visible: true } } })
  await f.prepare('manual')
  const claimed = (await f.command('notification.start', { notificationId: 'manual' })).result.notification
  await f.command('notification.receipt', { notificationId: 'manual', dispatchToken: claimed.dispatchToken, state: 'unknown',
    nextAttemptAt: '2099-01-01T00:00:00Z' })
  const pending = f.retry(await f.read('manual'))
  await entered.promise
  await f.prepare('queued')
  await f.service.recover()
  const deadline = Date.now() + 700
  while ((await f.read('queued')).state !== 'delivered' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await f.read('queued')).state, 'delivered', 'Independent send/readback lanes must drain new work while the manual readback is waiting')
  assert.equal((await f.read('manual')).state, 'unknown')
  release.resolve(); await pending
  assert.equal((await f.read('manual')).state, 'delivered')
  assert.deepEqual(sends, ['queued']); assert.deepEqual(reads, ['manual', 'queued'])
})

test('notification service manual recovery cannot race the original automatic send', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  t.after(() => release.resolve())
  let sends = 0
  const f = await notificationServiceFixture(t, { send: async () => { sends++; entered.resolve(); await release.promise; return { openTaskId: 'accepted' } },
    readback: async () => ({ messageId: 'verified' }) })
  await f.prepare('notice')
  const automatic = f.service.whenIdle()
  await entered.promise
  await assert.rejects(f.retry(await f.read('notice')), { code: 'TASK_NOTIFICATION_RECOVERY_IN_PROGRESS' })
  release.resolve(); await automatic
  assert.equal(sends, 1); assert.equal((await f.read('notice')).state, 'delivered')
})
