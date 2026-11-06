import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coordinationArtifactScope, resolveTaskArtifactScope } from '../packages/dingtalk-dsh-assistant/task-artifact-scope.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'artifact-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scope = await coordinationArtifactScope(root, { coordinationId: 'coordination-one', memberTaskIds: ['task-a', 'task-b', 'task-c'] })
  return {root,scope}
}

test('all team members receive the same authenticated correction source without changing their Task versions', async t => {
  const f = await fixture(t)
  const sourceId = 'web:correction', actorId = 'operator'
  const correction = { coordinationId: f.scope.coordinationId, revision: 1, artifactRoot: f.scope.artifactRoot, reason: '只纠正测试产物布局', actorId }
  const coordination = { id: f.scope.coordinationId, revision: 1, state: 'active', artifactScopeCorrection: { ...correction, sourceId, recordedAt: '2026-10-24T00:00:00Z' } }
  const tasks = f.scope.memberTaskIds.map(taskId => ({ taskId, groupId: 'group', ownerActorId: actorId, requirementRevision: 1, contextRevision: 0 }))
  const query = async (kind, args) => kind === 'coordination.list' ? [coordination] : kind === 'coordination.get'
    ? { members: tasks.map(task => ({ taskId: task.taskId, state: 'ready' })) }
    : kind === 'coordination.schedule.list' ? [] : kind === 'task.get' ? tasks.find(task => task.taskId === args.taskId)
    : { sourceId, actorId, channel: 'web', requestIdentity: { artifactScopeCorrection: correction } }
  for (const task of tasks) {
    const scope = await resolveTaskArtifactScope({ root: f.root, task, query })
    assert.equal(scope.artifactRoot, f.scope.artifactRoot)
    assert.deepEqual(scope.authorizationSource, { sourceId, actorId, recordedAt: '2026-10-24T00:00:00Z', reason: correction.reason })
    assert.equal(task.contextRevision, 0)
    assert.equal(task.requirementRevision, 1)
  }
  correction.actorId = 'foreign'
  await assert.rejects(resolveTaskArtifactScope({ root: f.root, task: tasks[0], query }), { code: 'TASK_ARTIFACT_CORRECTION_SOURCE_INVALID' })
})

function recurringLedger(f) {
  const coordination = { id: f.scope.coordinationId, groupId: 'group', state: 'active' }
  const templates = f.scope.memberTaskIds.map((taskId, index) => {
    const id = 'template-' + index
    return { id, coordinationId: coordination.id, taskId, state: 'template', recurringTemplateScheduleId: 'daily',
      commandDigest: 'template-digest-' + index, command: { id: `coordination-command:${coordination.id}:${id}`,
        kind: 'task.coordination.input', args: { taskId, action: 'supplement', sourceRefs: ['accepted-source'], text: 'fixed material' } } }
  })
  const frozen = member => ({ instructionId: member.id, taskId: member.taskId, commandDigest: member.commandDigest, command: structuredClone(member.command) })
  const schedule = { id: 'daily', coordinationId: coordination.id, revision: 1, rule: { kind: 'daily' }, history: [],
    action: { kind: 'task-command', instructionIds: templates.map(item => item.id), frozenInstructions: templates.map(frozen) } }
  const members = [...templates], occurrences = []
  return { coordination, schedule, templates, members, occurrences,
    slot(number) {
      const slotId = 'slot-' + number, occurrenceId = 'occurrence-' + number
      const next = templates.map(template => {
        const id = `${template.id}:slot:${slotId}`, command = structuredClone(template.command)
        command.id = `coordination-command:${coordination.id}:${id}`
        return { id, taskId: template.taskId, coordinationId: coordination.id, state: 'applied',
          templateInstructionId: template.id, recurringOccurrenceId: occurrenceId, authorizationSourceRefs: ['accepted-source'],
          command, commandDigest: 'slot-digest-' + id }
      })
      members.push(...next)
      occurrences.push({ id: occurrenceId, slotId, coordinationId: coordination.id, scheduleId: schedule.id,
        acceptedScheduleRevision: 1, templateAction: structuredClone(schedule.action),
        action: { kind: 'task-command', instructionIds: next.map(item => item.id), frozenInstructions: next.map(frozen) } })
    },
    query: async (kind, args) => kind === 'coordination.list' ? [coordination] : kind === 'coordination.get' ? { members }
      : kind === 'coordination.schedule.list' ? [schedule] : kind === 'task.get' ? { taskId: args.taskId, groupId: 'group' }
      : occurrences.find(item => item.id === args.occurrenceId),
  }
}

test('recurring slots resolve one stable template Task set and keep the same immutable root', async t => {
  const f = await fixture(t), ledger = recurringLedger(f)
  const task = { taskId: 'task-a', groupId: 'group' }
  ledger.slot(1)
  const first = await resolveTaskArtifactScope({ root: f.root, task, query: ledger.query })
  ledger.slot(2)
  const second = await resolveTaskArtifactScope({ root: f.root, task, query: ledger.query })
  assert.deepEqual(first, second)
  assert.deepEqual(second.memberTaskIds, ['task-a', 'task-b', 'task-c'])
  assert.equal(second.artifactRoot, f.scope.artifactRoot)
})

const invalidRecurring = {
  'forged template': ledger => { ledger.members.at(-3).templateInstructionId = 'forged' },
  'unfrozen member': ledger => { ledger.templates[0].state = 'ready' },
  'foreign template coordination': ledger => { ledger.templates[0].coordinationId = 'foreign' },
  'changed frozen template': ledger => { ledger.templates[0].command.args.text = 'changed' },
  'new Task creation': ledger => { ledger.templates[0].createCommand = { kind: 'task.create' } },
  'unsupported command': ledger => { ledger.templates[0].command.kind = 'task.create' },
  'missing occurrence': ledger => { ledger.occurrences.length = 0 },
  'foreign occurrence coordination': ledger => { ledger.occurrences[0].coordinationId = 'foreign' },
  'foreign schedule': ledger => { ledger.occurrences[0].scheduleId = 'foreign' },
  'changed slot command': ledger => { ledger.members.at(-3).command.args.action = 'cancel' },
  'forged authorization source': ledger => { ledger.members.at(-3).authorizationSourceRefs = ['forged'] },
  'changed accepted Task set': ledger => {
    const old = structuredClone(ledger.schedule)
    old.action.instructionIds.pop(); old.action.frozenInstructions.pop()
    ledger.schedule.history.push(old)
  },
}
for (const [name, mutate] of Object.entries(invalidRecurring)) test('recurring artifact scope rejects ' + name, async t => {
  const f = await fixture(t), ledger = recurringLedger(f); ledger.slot(1); mutate(ledger)
  await assert.rejects(resolveTaskArtifactScope({ root: f.root, task: { taskId: 'task-a', groupId: 'group' }, query: ledger.query }), { code: 'TASK_ARTIFACT_RECURRING_SCOPE_UNSUPPORTED' })
})

test('recurring target cannot gain a second coordination root', async t => {
  const f = await fixture(t), ledger = recurringLedger(f); ledger.slot(1)
  const query = (kind, args) => kind === 'coordination.list' ? [ledger.coordination, { id: 'foreign-team', state: 'active' }]
    : kind === 'coordination.get' && args.coordinationId === 'foreign-team' ? { members: [{ taskId: 'task-a', state: 'ready' }] }
    : kind === 'coordination.schedule.list' && args.coordinationId === 'foreign-team' ? [] : ledger.query(kind, args)
  await assert.rejects(resolveTaskArtifactScope({ root: f.root, task: { taskId: 'task-a', groupId: 'group' }, query }), { code: 'TASK_ARTIFACT_COORDINATION_AMBIGUOUS' })
})

test('recurring template target must still exist in the accepted group', async t => {
  const f = await fixture(t), ledger = recurringLedger(f); ledger.slot(1)
  for (const target of [null, { taskId: 'task-a', groupId: 'foreign-group' }]) {
    const query = (kind, args) => kind === 'task.get' && args.taskId === 'task-a' ? target : ledger.query(kind, args)
    await assert.rejects(resolveTaskArtifactScope({ root: f.root, task: { taskId: 'task-a', groupId: 'group' }, query }), { code: 'TASK_ARTIFACT_RECURRING_SCOPE_UNSUPPORTED' })
  }
})
