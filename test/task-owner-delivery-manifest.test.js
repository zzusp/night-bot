import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openExecutionStore } from '../packages/dingtalk-core/execution-store.js'
import { openExecutionArtifacts } from '../packages/dingtalk-core/execution-artifacts.js'
import { createExecutionController } from '../packages/dingtalk-core/execution-controller.js'
import { createTaskWorkflowContracts } from '../packages/dingtalk-core/task-workflow-contracts.js'
import { readTaskMaterials, readTaskMaterialValue } from '../packages/dingtalk-core/execution-artifacts.js'

async function fixture(t, { action = 'complete', domainProof = false, sharedOutput = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'owner-manifest-')), dbPath = join(directory, 'control.sqlite')
  const store = await openExecutionStore({ dbPath, instanceId: 'manifest', initialize: true })
  let controller, directories
  t.after(async () => { await controller?.close(); await store.close() })
  const artifacts = await openExecutionArtifacts({ directory: join(directory, 'artifacts'), initialize: true })
  if (sharedOutput) {
    directories = { logicalTaskId: 'task', ...Object.fromEntries(['work', 'tmp', 'outputs'].map(area => [area, join(directory, area)])) }
    for (const area of ['work', 'tmp', 'outputs']) await mkdir(directories[area])
    await writeFile(join(directories.outputs, 'report.md'), '已验证的报告')
    artifacts.getTaskDirectories = async () => directories
  }
  const workflow = { id: 'report', version: '1', ownerContract: { id: 'report-result', version: '1',
    resultContract: { id: 'report', version: '1', requiredFields: ['summary'] }, validateCompletion: () => true },
    nodes: [{ id: 'report', version: '1', executor: 'code', allowedEffects: ['pure'],
      inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      mapInput: ({ requirement }) => requirement, execute: async () => ({ summary: '结果已核验' }) }] }
  if (domainProof) {
    workflow.nodes.unshift({ ...workflow.nodes[0], id: 'proof', execute: async () => ({ taskRunId: '901' }) })
    workflow.ownerContract.readArtifacts = ({ stage, state }) => ({ completionEvidenceRefs: [stage.outputRef],
      nodeArtifacts: [{ nodeId: 'proof', artifactRef: state.nodes[0].outputRef }],
      domainEvidence: { taskRunId: '901' } })
  }
  controller = createExecutionController({ store, artifacts, workflows: [workflow] })
  const helpers = createTaskWorkflowContracts({ controller, store, artifacts })
  const requirement = { request: '交付报告', acceptanceCriteria: ['交付报告'], scope: {} }
  await controller.createTaskPlan({ commandId: 'create', taskId: 'task', stages: [{ stageId: 'first', workflowId: 'report', input: requirement }] })
  if (action === 'complete') {
    const started = await controller.advanceTaskPlan('task')
    await controller.whenIdle(started.stages[0].runId)
    await controller.advanceTaskPlan('task')
  }
  await store.command({ id: 'init', kind: 'task.owner.init', args: { taskId: 'task', sessionId: 'historical-manifest-session', criteria: requirement.acceptanceCriteria, sourceKey: 'source' } })
  await store.command({ id: 'bind', kind: 'task.requirement.bind-legacy', args: { taskId: 'task', expectedRequirementRevision: 1,
    requirementRef: (await artifacts.put(requirement, { taskId: 'task' })).ref, sessionId: 'historical-manifest-session',
    criteria: requirement.acceptanceCriteria, sourceKey: 'source', eventKey: 'bind' } })
  const plan = await controller.taskPlan('task'), items = await store.query({ kind: 'task.owner.acceptance', taskId: 'task' })
  const evidenceRefs = plan.stages[0].outputRef ? [plan.stages[0].outputRef] : []
  const decision = { action, summary: '处理当前任务', evidenceRefs,
    ...(action === 'complete' ? { assessments: items.map(item => ({ itemId: item.itemId, status: 'satisfied', evidenceRefs })) }
      : { condition: { kind: 'business-input', missing: '确认结论', responsibleParty: '需求方', resumeWhen: '确认后继续', evidenceRefs } }) }
  return { store, artifacts, helpers, controller, requirement, plan, decision, dbPath, directories,
    authorize: decision => helpers.authorizeCompletion({ taskId: 'task', requirement, plan, decision }),
    manifest: decision => helpers.readDeliveryManifest({ taskId: 'task', requirement, plan, decision }) }
}

// 业务验收使用真实领域合同；随后仅核历史Store的持久引用与版本栅栏。
async function persistDecision(f, { decision = f.decision, stale = false } = {}) {
  const send = async (kind, args) => (await f.store.command({ id: kind, kind, args })).result
  const claim = await send('task.owner.claim', { taskId: 'task', turnId: 'manifest-turn', expectedLeaseEpoch: 0 })
  const turn = { taskId: 'task', turnId: claim.turnId, leaseEpoch: claim.leaseEpoch }
  await send('task.owner.sessionBound', { ...turn, sessionId: claim.sessionId })
  let deliveryManifestRef
  if (decision.action === 'complete') {
    assert.equal(await f.authorize(decision), true)
    deliveryManifestRef = (await f.artifacts.put(await f.manifest(decision), { taskId: 'task' })).ref
  }
  await send('task.owner.candidate', { ...turn, decision })
  if (stale) await send('task.owner.event', { taskId: 'task', eventKey: 'after-candidate', eventType: 'task.context' })
  return send('task.owner.accept', { ...turn, ...(deliveryManifestRef ? { deliveryManifestRef } : {}) })
}

test('领域验收回执绑定决策正文，克隆需重新校验且历史接纳拒绝陈旧水位', async t => {
  for (const name of ['clone', 'summary', 'scope', 'stale']) await t.test(name, async t => {
    const f = await fixture(t)
    assert.equal(await f.authorize(f.decision), true)
    assert.equal((await f.manifest(f.decision)).businessValidation.status, 'accepted')
    if (name === 'clone') {
      const cloned = structuredClone(f.decision)
      assert.equal((await f.manifest(cloned)).businessValidation.status, 'unverified')
      await persistDecision(f, { decision: cloned })
      assert.ok((await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' })).ref)
    } else if (name === 'stale') {
      await assert.rejects(persistDecision(f, { stale: true }), { code: 'TASK_OWNER_CANDIDATE_STALE' })
    } else {
      if (name === 'summary') f.decision.summary = '另一结论'
      else f.decision.evidenceRefs = ['foreign']
      assert.equal((await f.manifest(f.decision)).businessValidation.status, 'unverified')
      if (name === 'scope') await assert.rejects(f.authorize(f.decision), { code: 'TASK_OWNER_COMPLETION_UNVERIFIED' })
    }
    if (name !== 'clone') assert.equal(await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' }), null)
  })
})

test('领域正文可读成功节点且只接纳当前阶段绑定证据', async t => {
  const f = await fixture(t, { domainProof: true }), stage = f.plan.stages[0]
  const proof = await f.helpers.readStageArtifacts({ taskId: 'task', stage, plan: f.plan })
  assert.deepEqual(proof.domainEvidence, { taskRunId: '901' })
  assert.deepEqual(proof.completionEvidenceRefs, [stage.outputRef])
  const nodeRef = proof.nodeArtifacts[0].artifactRef
  assert.notEqual(nodeRef, stage.outputRef)
  assert.deepEqual(await f.artifacts.read(nodeRef), { taskRunId: '901' })
  const decision = structuredClone(f.decision)
  decision.evidenceRefs = [nodeRef]; decision.assessments.forEach(item => { item.evidenceRefs = [nodeRef] })
  assert.equal(await f.authorize(decision), true)
  assert.deepEqual(decision.evidenceRefs, [stage.outputRef])
  const foreign = structuredClone(f.decision)
  foreign.evidenceRefs = ['foreign-task-ref']; foreign.assessments.forEach(item => { item.evidenceRefs = ['foreign-task-ref'] })
  await assert.rejects(f.authorize(foreign), { code: 'TASK_OWNER_COMPLETION_UNVERIFIED' })
  await persistDecision(f, { decision })
  assert.equal((await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' })).taskId, 'task')
})
test('领域清单快照与验收正式清单分离，历史引用可冷恢复读取', async t => {
  const f = await fixture(t)
  assert.equal(await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' }), null)
  const snapshot = await f.manifest()
  assert.equal(snapshot.complete, false); assert.equal(snapshot.acceptance[0].status, 'pending')
  const snapshotRef = (await f.artifacts.put(snapshot, { taskId: 'task' })).ref
  await persistDecision(f)
  const saved = await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' })
  assert.equal(saved.taskId, 'task'); assert.equal(saved.requirementRevision, 1); assert.equal(saved.planRevision, 1)
  assert.notEqual(saved.ref, snapshotRef)
  const manifest = await f.artifacts.read(saved.ref)
  assert.equal(manifest.complete, true); assert.equal(manifest.acceptance[0].status, 'satisfied')
  assert.equal(manifest.businessValidation.status, 'accepted')
  assert.equal(manifest.businessValidation.items[0].itemId, manifest.acceptance[0].itemId)
  assert.match(manifest.businessValidation.items[0].validators[0].policyDigest, /^[a-f0-9]{64}$/)
  await f.store.close()
  const reopened = await openExecutionStore({ dbPath: f.dbPath, instanceId: 'manifest' })
  try { assert.deepEqual(await reopened.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' }), saved) }
  finally { await reopened.close() }
})

test('真实需求或计划事务使旧完成清单失效', async t => {
  for (const column of ['requirement_revision', 'plan_revision']) await t.test(column, async t => {
    const f = await fixture(t); await persistDecision(f)
    assert.ok(await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' }))
    if (column === 'requirement_revision') await f.store.command({ id: 'change-requirement', kind: 'task.requirement.update', args: {
      taskId: 'task', expectedRequirementRevision: 1, requirementRef: (await f.artifacts.put({ request: '新的要求' }, { taskId: 'task' })).ref, eventKey: 'new-requirement' } })
    else await f.controller.reviseTaskPlan({ commandId: 'new-plan', taskId: 'task', expectedPlanRevision: 1,
      expectedControlRevision: 1, requirementRevision: 1, affectedFrom: 0,
      stages: [{ stageId: 'second', workflowId: 'report', input: f.requirement }] })
    assert.equal(await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' }), null)
  })
})

test('wait不存正式清单，未完成计划与外任务正文不能获得领域完成回执', async t => {
  const f = await fixture(t, { action: 'wait' }); await persistDecision(f)
  assert.equal(await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' }), null)
  const snapshot = await f.manifest()
  assert.equal(snapshot.complete, false); assert.equal(snapshot.businessValidation.status, 'unverified')
  const complete = { ...f.decision, action: 'complete' }; delete complete.condition
  await assert.rejects(f.authorize(complete), error => error.code === 'TASK_OWNER_COMPLETION_UNVERIFIED' && error.completionGate.gate === 'plan-current-and-complete')
  await assert.rejects(f.helpers.readDeliveryManifest({ taskId: 'foreign', plan: f.plan, requirement: f.requirement }), { code: 'WORKFLOW_OWNER_STAGE_MISMATCH' })
})

test('历史事件、领域快照和正式清单均写入当前任务归属', async t => {
  const f = await fixture(t), writes = [], put = f.artifacts.put
  f.artifacts.put = async (value, options) => { writes.push({ value, options }); return put(value, options) }
  const eventRef = (await f.artifacts.put({ marker: 'routing' }, { taskId: 'task' })).ref
  await f.store.command({ id: 'event', kind: 'task.owner.event', args: { taskId: 'task', eventKey: 'routing', eventType: 'task.created', payloadRef: eventRef } })
  await f.artifacts.put(await f.manifest(), { taskId: 'task' }); await persistDecision(f)
  assert.ok(writes.some(entry => entry.value?.marker === 'routing'))
  assert.ok(writes.some(entry => entry.value?.kind === 'task-delivery-manifest' && entry.value.complete === false))
  assert.ok(writes.some(entry => entry.value?.kind === 'task-delivery-manifest' && entry.value.complete === true))
  for (const entry of writes) assert.deepEqual(entry.options, { taskId: 'task' })
})

test('共享outputs可读但索引不是领域完成证明', async t => {
  const f = await fixture(t, { sharedOutput: true })
  const index = await readTaskMaterials({ directories: f.directories, artifacts: f.artifacts })
  assert.ok(index.files.some(file => file.relativePath === 'outputs/report.md'))
  assert.equal((await readTaskMaterialValue({ directories: f.directories, artifacts: f.artifacts, artifactRef: 'outputs/report.md' })).text, '已验证的报告')
  const foreign = (await f.artifacts.put({ marker: 'foreign' }, { taskId: 'other' })).ref
  await assert.rejects(readTaskMaterialValue({ directories: f.directories, artifacts: f.artifacts, artifactRef: foreign }), { code: 'TASK_MATERIAL_SCOPE_INVALID' })
  const decision = structuredClone(f.decision)
  decision.evidenceRefs = ['task-materials-index']; decision.assessments.forEach(item => { item.evidenceRefs = ['task-materials-index'] })
  await assert.rejects(f.authorize(decision), { code: 'TASK_OWNER_COMPLETION_UNVERIFIED' })
  await persistDecision(f)
  assert.equal((await f.store.query({ kind: 'task.owner.delivery-manifest', taskId: 'task' })).taskId, 'task')
})
