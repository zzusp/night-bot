import assert from 'node:assert/strict'
import test from 'node:test'
import {nativeResidentSnapshot} from './fixtures/native-domain-snapshot.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'

test('历史Host动作阻塞跨重启保留后续来源、去重账及禁止提前完成', async t => {
  const snapshot = { tables: {}, global: null }
  const domain=await nativeResidentSnapshot(snapshot)
  let store=await openResidentStore(domain.domains)
  t.after(async()=>{try{await store.close()}finally{await domain.close()}})
  await store.subscribe({ groupId: 'g' })
  const ingest = messageId => store.ingest({ groupId: 'g', messageId, text: messageId, occurredAt: '2026-10-19T08:00:00Z' })
  await ingest('blocked-source')
  await store.routeMessages({ groupId: 'g', routeId: 'initial-route', routingRevision: 0,
    routes: [{ messageId: 'blocked-source', messageVersion: 1, topics: [{ newTopicKey: 'shared', title: '原任务续办' }] }] })
  const topicId = store.listTopics('g')[0].topicId
  const accepted = await store.acceptTopicDecision({ groupId: 'g', topicId, revision: 1, decisionId: 'blocked-decision',
    decision: { actions: [{ kind: 'new-task', title: '原任务', objective: '仅接纳任务', acceptanceCriteria: ['保留原授权'] }] } })
  assert.equal(accepted.status, 'accepted')
  const operation = accepted.record.operations[0]
  await store.updateTopicDecision({ groupId: 'g', topicId, decisionId: accepted.record.decisionId,
    patch: { status: 'blocked', attempt: 1, error: 'TASK_TOPIC_AUTHENTICATED_SOURCE_REQUIRED',
      operations: [{ ...operation, status: 'blocked', attempt: 1, lastError: 'TASK_TOPIC_AUTHENTICATED_SOURCE_REQUIRED' }] } })
  await ingest('later-source')
  await store.routeMessages({ groupId: 'g', routeId: 'later-route', routingRevision: 1,
    routes: [{ messageId: 'later-source', messageVersion: 1, topics: [{ topicId, relationship: 'continuation', reason: '原事项补充' }] }] })
  const snapshotBeforeRestart=structuredClone(store.getGroup('g'))
  await store.close()
  store=await openResidentStore(domain.domains)
  for(const key of ['topics','messages','routeHistory','taskReservations','outbox'])assert.deepEqual(JSON.parse(JSON.stringify(store.getGroup('g')[key])),JSON.parse(JSON.stringify(snapshotBeforeRestart[key])),key+' retains its full persisted history')
  const duplicate=await store.acceptTopicDecision({groupId:'g',topicId,revision:1,decisionId:'blocked-decision',decision:accepted.record.decision})
  assert.equal(duplicate.status,'duplicate')
  const topic = store.getTopic('g', topicId)
  assert.equal(topic.revision, 2)
  assert.equal(topic.processedRevision, 0)
  assert.equal(topic.decisions.length, 1)
  assert.equal(topic.decisions[0].status, 'blocked')
  assert.equal(topic.decisions[0].operations[0].lastError, 'TASK_TOPIC_AUTHENTICATED_SOURCE_REQUIRED')
  assert.equal(store.listTasks().length, 0)
  assert.equal(store.getGroup('g').outbox.length, 0)
  await assert.rejects(store.completeTopicDecision({ groupId: 'g', topicId, decisionId: accepted.record.decisionId }), /topic_decision_operations_pending/)
})
