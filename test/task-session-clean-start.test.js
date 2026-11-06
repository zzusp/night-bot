import { nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTaskResidentRuntime } from '../packages/dingtalk-dsh-assistant/task-resident-runtime.js'
import { startDwsBridge } from '../packages/dingtalk-dsh-assistant/dws-bridge.js'

const epoch = '2026-10-13T00:00:00Z'

function legacyGroup() {
  return { groupId: 'g', name: '保留群配置', responsibility: '保留群职责', residentSessionId: 'old-group-session', nextSequence: 2,
    messages: [{ messageId: 'old-message', sequence: 1, text: '旧消息仅供传输游标', messageVersion: 1, occurredAt: '2026-10-12T23:59:00Z', routingStatus: 'routed', agentDeliveryStatus: 'delivered', senderOpenDingTalkId: 'real-owner' }],
    outbox: [{ outboundId: 'old-outbound', sourceMessageId: 'task-result:task-old:completed:1', text: '旧结果不能重新发', status: 'pending', readbackRequired: true }],
    topics: [], routingRevision: 0, routeHistory: [], taskReservations: [], coordinationRequests: {} }
}
function legacyTask(index) {
  return { taskId: `task-old-${index}`, groupId: 'g', topicRefs: [{ topicId: 'old-topic', revision: 1 }], inputVersion: 1,
    objective: '旧任务不能启动', state: 'waiting', childSessionId: `old-session-${index}`, waitingKind: 'human-intervention', waitingReason: '旧阻塞',
    humanBlocker: { requestId: `old-blocker-${index}`, category: 'human-decision', requestedAction: '旧操作', status: 'pending-send' },
    createdAt: epoch, updatedAt: epoch }
}

test('active transport facade exposes notification read models without legacy DWS sending or retrying them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'task-clean-facade-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const group = legacyGroup(), tasks = Array.from({ length: 152 }, (_, i) => legacyTask(i))
  for (const state of ['prepared', 'unknown']) group.outbox.push({ outboundId: `current-${state}`, sourceMessageId: `task-notification:current-${state}`, text: '当前通知由task service持有', status: 'pending', readbackRequired: true, notificationState: state })
  const snapshot = structuredClone({ group, tasks })
  let historyReads = 0, outboundCalls = 0, closed = 0
  const forbidden = () => { historyReads++; throw new Error('LEGACY_TASK_READ_FORBIDDEN') }
  const store = { getAgentWorkspaceDir: () => root, getGroup: id => id === 'g' ? group : undefined, listGroups: () => [group],
    listTasks: forbidden, getTask: forbidden, listTopics: () => [], getTopic: () => undefined, getTopicContext: () => undefined,
    listTaskTimings: forbidden, listPerformance: forbidden, listActivities: forbidden, listAlerts: forbidden,
    async close() { closed++ } }
  const runtime = await openTaskResidentRuntime({ agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) } }, store, root)
  const completed = Promise.withResolvers(), warnings = [], backfills = []
  const stop = startDwsBridge({ runtime, logger: { warn: error => warnings.push(error) }, humanUserId: 'configured-user',
    humanPollIntervalMs: 0, groupBackfillIntervalMs: 0, outboxRetryIntervalMs: 5,
    adapter: {
      startGroupSubscription() { return { done: completed.promise, stop() { completed.resolve() } } },
      async readGroupRange(_id, range) { backfills.push(range); return { messages: [], complete: true } },
      async sendSelf() { outboundCalls++; throw new Error('OLD_SEND_FORBIDDEN') },
      async sendGroup() { outboundCalls++; throw new Error('OLD_SEND_FORBIDDEN') },
      async findHumanBlockerExchange() { outboundCalls++; throw new Error('OLD_LOOKUP_FORBIDDEN') },
      async findOutboundMessage() { outboundCalls++; throw new Error('OLD_LOOKUP_FORBIDDEN') },
    },
  })
  try {
    await waitUntil(() => backfills.length, 'initial cursor backfill')
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(backfills[0].start, '2026-10-12T23:58:30.000Z')
    assert.deepEqual(runtime.getGroup('g').messages, group.messages)
    runtime.isOwnNotification = message => message.groupId === 'g' && message.messageId === 'old-message'
    assert.deepEqual(runtime.getGroup('g').messages, [])
    assert.deepEqual(runtime.listGroups()[0].messages, [])
    assert.equal(group.messages.length, 1, '仅过滤投影，保留原始历史')
    runtime.isOwnNotification = () => false
    assert.equal(runtime.getGroup('g').name, group.name)
    assert.equal(runtime.getGroup('g').responsibility, group.responsibility)
    assert.deepEqual(runtime.getGroup('g').outbox, group.outbox)
    assert.equal(runtime.taskSessionNotifications, true)
    await assert.rejects(async () => runtime.prepareOutbound({ groupId: 'g', outbound: group.outbox[0] }), { code: 'WORKFLOW_RETIRED' })
    for (const method of ['listTasks', 'listTopics', 'listTaskTimings', 'listActivities', 'listAlerts', 'listAuthorizationRequests']) assert.deepEqual(runtime[method](), [])
    assert.deepEqual(runtime.listPerformance().rows, [])
    assert.equal(runtime.getTask('task-old-1'), undefined)
    assert.equal(runtime.getAuthorizationRequest('old-blocker-1'), undefined)
    assert.deepEqual(warnings, [])
    assert.equal(outboundCalls, 0)
    assert.equal(historyReads, 0)
    assert.deepEqual({ group, tasks }, snapshot)
  } finally { await stop(); await runtime.close() }
  assert.equal(closed, 1)
})
