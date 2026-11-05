import NativeSessionQuery from '../src/native-session-query.js'
import NativeSessionController from '../src/native-session-controller.js'
import { nativeLifecycle, nativeLifecycleTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { available, reason, nativeTaskHost } from './fixtures/task-session-native-host.js'
import { createTaskSessions } from '../packages/dingtalk-dsh-assistant/task-session.js'
import { installTaskSessionPersistence } from '../packages/dingtalk-dsh-assistant/task-session-persistence.js'
import { inspectSession } from '../packages/dingtalk-dsh-assistant/session-persistence.js'

test('owned read-only session observation cannot acquire a cold task writer and the Host resumes next lease', { ...({ skip: !available ? reason : false, timeout: 15000 }), timeout: nativeLifecycleTimeout(15000) }, nativeLifecycle(15000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'task-follow-conflict-'))
  const h = await nativeTaskHost(root, async () => [{ name: 'task_session_submit', args: { decision: { action: 'wait', summary: '原统筹等待执行结果', evidence: [], limitations: [] } } }], { resident: true })
  await t.beginBusiness()

  const cwd = join(root, 'tasks', 'task-follow'); await t.step(async () => mkdir(cwd, { recursive: true }))
  const persistence = await t.step(async () => installTaskSessionPersistence(h.ctx, { root }))
  const manager = createTaskSessions({ ctx: h.ctx, isCurrent: async () => true, getWorkspaceDir: async () => cwd,
    registerPersistence: value => persistence.register(value), withPersistenceWriter: (binding, action) => persistence.runOwned(binding, action) })
  t.after(async () => { try { await manager.close(); await h.close() } finally { await rm(root, { recursive: true, force: true }) } })
  const run = (leaseEpoch, sessionBound) => manager.run({ binding: { kind: 'task-session', taskId: 'task-follow', sessionId: 'follow-owner', leaseEpoch, sessionBound },
    provider: 'native-task-test', model: 'controlled', agentPreset: 'native-test', input: { task: { title: '原任务', objective: '继续原任务' }, wakes: [] },
    onSessionBound: async () => {}, submit: async () => ({ accepted: true }) })
  assert.equal((await t.step(async () => run(1, false))).status, 'submitted')
  assert.equal(h.ctx.agents.get('follow-owner'), undefined)
  const before=await t.step(async()=>inspectSession(h.ctx.sessionPersistence,'follow-owner'))
  await t.step(async()=>h.ctx.plugin(NativeSessionQuery))
  await t.step(async()=>h.ctx.plugin(NativeSessionController))
  const observation=await t.step(async()=>h.ctx.sessionQuery.observeSession('follow-owner'))
  try{
    assert.equal(observation.header.id,'follow-owner');assert.ok(observation.events.length>0)
    assert.equal(h.ctx.agents.get('follow-owner'),undefined);assert.equal(h.ctx.sessions.get('follow-owner'),undefined)
    const activation=await t.step(async()=>h.ctx.sessionController.resolveAgent('follow-owner'))
    assert.ok(activation.error);assert.match(activation.error.message,/TASK_SESSION_HOST_WRITER_REQUIRED|NIGHT_SESSION_TASK_OWNED/)
    assert.equal(h.ctx.agents.get('follow-owner'),undefined);assert.equal(h.ctx.sessions.get('follow-owner'),undefined)
  }finally{await observation[Symbol.asyncDispose]?.();observation[Symbol.dispose]?.()}
  assert.deepEqual((await t.step(async()=>inspectSession(h.ctx.sessionPersistence,'follow-owner'))).events,before.events)
  assert.equal((await t.step(async () => run(2, true))).status, 'submitted')
  const log = await t.step(async () => inspectSession(h.ctx.sessionPersistence, 'follow-owner'))
  assert.deepEqual([...new Set(log.events.filter(event => event.type === 'user/message' && event.data.source?.taskSession).map(event => event.data.source.taskSession.leaseEpoch))], [1,2])
  assert.equal(h.requests.length, 2)
}))
