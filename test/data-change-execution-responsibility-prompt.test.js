import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openExecutionStore } from '../packages/dingtalk-core/execution-store.js'
import { openExecutionArtifacts, executionDigest, executionError } from '../packages/dingtalk-core/execution-artifacts.js'
import { createExecutionController } from '../packages/dingtalk-core/execution-controller.js'
import { createTaskWorkflowContracts } from '../packages/dingtalk-core/task-workflow-contracts.js'
import { externalWorkflowOwnerContract } from '../packages/dingtalk-core/task-release-workflows.js'

const schema = { type: 'object', additionalProperties: true }

for (const hostValidated of [false, true]) test(`数据变更领域诊断要求显式Host维护且只读检查不产生效果，Host受信校验=${hostValidated}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'data-change-prompt-'))
  const store = await openExecutionStore({ dbPath: join(root, 'control.sqlite'), instanceId: 'prompt', initialize: true })
  const artifacts = await openExecutionArtifacts({ directory: join(root, 'artifacts'), initialize: true })
  const requirement = { request: '本地夹具添加列', target: { instance: 'fixture', database: 'fixture', environment: 'uat' },
    baseline: { snapshotId: 'fixture', sha256: 'a'.repeat(64) }, sources: [{ id: 'fixture-source', content: '本地夹具', sha256: 'b'.repeat(64) }], constraints: [] }
  const candidate = { applySql: hostValidated ? 'ALTER TABLE public.fixture ADD COLUMN optional_value integer DEFAULT 0;' : '',
    rollbackSql: '仅测试候选，不执行SQL', verificationSql: '只读夹具说明', expectedChange: '仅本地夹具' }
  let validationEnabled = false, validationCalls = 0
  const workflow = { id: 'task-data-change', version: 'prompt-fixture', ownerContract: externalWorkflowOwnerContract, nodes: [
    { id: 'freeze-input', version: '1', executor: 'code', allowedEffects: ['pure'], inputSchema: schema, outputSchema: schema,
      mapInput: ({ requirement }) => requirement, execute: async ({ input }) => input },
    { id: 'propose-sql', version: '1', executor: 'code', allowedEffects: ['pure'], inputSchema: schema, outputSchema: schema,
      mapInput: ({ previousOutput }) => previousOutput, execute: async () => candidate },
    { id: 'validate-package', version: '1', executor: 'code', allowedEffects: ['pure'], inputSchema: schema, outputSchema: schema,
      mapInput: ({ previousOutput, requirement }) => ({ proposal: previousOutput, requirement }), execute: async ({ input }) => {
        validationCalls++
        if (!validationEnabled) throw executionError(hostValidated ? 'BYTEBASE_PRECONDITIONS_UNCONFIRMED' : 'DATA_CHANGE_PROPOSAL_INVALID')
        const body = { ...input.proposal, target: input.requirement.target, baseline: input.requirement.baseline, sourceDigest: executionDigest(input.requirement.sources) }
        return { ...body, validation: { adapterId: 'fixture-readonly', adapterVersion: '1', receiptId: 'fixture-receipt', packageDigest: executionDigest(body) } }
      } },
    { id: 'approval-gate', version: '1', executor: 'code', allowedEffects: ['pure'], inputSchema: schema, outputSchema: schema,
      mapInput: ({ previousOutput }) => previousOutput, execute: async () => { throw Error('APPROVAL_MUST_NOT_RUN') } },
  ] }
  const controller = createExecutionController({ store, artifacts, workflows: [workflow] })
  t.after(async () => { await controller.close(); await store.close() })
  await controller.createTaskPlan({ commandId: 'plan', taskId: 'task', stages: [{ stageId: 'sql', workflowId: workflow.id, input: requirement }] })
  const plan = await controller.advanceTaskPlan('task'), runId = plan.stages[0].runId
  await controller.whenIdle(runId)
  const before = await controller.state(runId)
  assert.equal(before.run.status, 'waiting')
  validationEnabled = hostValidated
  const contracts = createTaskWorkflowContracts({ controller, store, artifacts })
  const observed = await contracts.inspectCurrentExecution('task')
  assert.equal(observed.repairable, true)
  assert.equal(!!observed.validationSource, hostValidated)
  assert.equal(observed.mode, 'repair-proposal')
  assert.equal(observed.requiresCurrentQuery, true)
  assert.equal(observed.queryContextRequired, true)
  assert.equal(observed.waitingNodes[0].reason, hostValidated ? 'BYTEBASE_PRECONDITIONS_UNCONFIRMED' : 'DATA_CHANGE_PROPOSAL_INVALID')
  assert.doesNotMatch(observed.instruction, /repairCurrentStage|workflowRevision|task_execution_control/)
  assert.match(observed.instruction, /仅为诊断与修正建议/)
  assert.match(observed.instruction, /实际可用的显式Host维护入口及当前权限校验/)
  assert.match(observed.instruction, /不得凭本诊断发起外部效果/)
  assert.match(observed.instruction, /本次精确SQL.*真实产出.*不得原样重试空SQL.*不得替换既有工单或批准.*独立真人审批/)
  if (hostValidated) assert.match(observed.instruction, /不需要重复查询已有目录事实.*独立真人审批/)
  else assert.match(observed.instruction, /受信结构资料.*不同于上次失败.*不得原样重试空SQL.*不得替换既有工单或批准/)
  assert.deepEqual(await controller.state(runId), before)
  assert.deepEqual(await store.query({ kind: 'effect.list', runId }), [])
  assert.ok(validationCalls >= 1)
})
