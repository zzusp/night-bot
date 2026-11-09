import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openExecutionStore } from '../packages/dingtalk-core/execution-store.js'
import { openExecutionArtifacts } from '../packages/dingtalk-core/execution-artifacts.js'
import { createExecutionController } from '../packages/dingtalk-core/execution-controller.js'

test('历史原生证据绑定会话任务与需求，保留成功失败和未知调用', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'owner-native-evidence-'))
  const store = await openExecutionStore({ dbPath: join(directory, 'control.sqlite'), instanceId: 'native-evidence', initialize: true })
  const directories = { logicalTaskId: 'task', ...Object.fromEntries(['work','tmp','outputs'].map(area => [area,join(directory,'tasks','tasks','task',area)])) }
  for (const area of ['work','tmp','outputs']) await mkdir(directories[area], { recursive: true })
  const artifacts = await openExecutionArtifacts({ directory: join(directory,'artifacts'), initialize: true, taskWorkspaceRoot: join(directory,'tasks'), getTaskDirectories: async () => directories })
  t.after(async () => { await store.close() })
  const requirementRef = (await artifacts.put({ request: '核对撤回是否拒绝' }, { taskId: 'task' })).ref
  await store.command({ id: 'accept', kind: 'task.accept', args: { taskId: 'task', requirementRef, requirementRevision: 1, sessionId: 'native-session', criteria: ['核对撤回是否拒绝'], sourceKey: 'source', eventKey: 'created' } })
  const send = async (kind, args) => (await store.command({ id: randomUUID(), kind, args })).result
  const claim = await send('task.owner.claim', { taskId:'task', turnId:'native-turn', expectedLeaseEpoch:0 })
  await send('task.owner.sessionBound', { taskId:'task', turnId:claim.turnId, leaseEpoch:claim.leaseEpoch, sessionId:claim.sessionId })
  const binding = { taskId:'task', turnId:claim.turnId, leaseEpoch:claim.leaseEpoch, requirementRevision:1, sessionId:claim.sessionId, ownerEpoch:claim.ownerEpoch }
  const success = { isError:false, content:[{type:'text',text:'{"status":"rejected"}'}] }
  const failure = { isError:true, content:[{type:'text',text:'Access denied'}], error:{code:'ACCESS_DENIED'} }
  const facts = [
    {callId:'success',phase:'started',result:null}, {callId:'success',phase:'settled',result:success},
    {callId:'failed',phase:'started',result:null}, {callId:'failed',phase:'settled',result:failure},
    {callId:'unknown',phase:'started',result:null},
  ], refs = []
  for (const fact of facts) {
    const ref = (await artifacts.put({kind:'task-native-execution',execution:binding,toolName:'pwsh',...fact}, {taskId:'task'})).ref
    if (!refs.length) {
      for (const drift of [{sessionId:'other-session'},{ownerEpoch:claim.ownerEpoch+1},{requirementRevision:99}])
        await assert.rejects(send('task.owner.native-evidence', {...binding,...drift,evidenceRef:ref}), {code:'TASK_OWNER_NATIVE_STALE'})
      await assert.rejects(send('task.owner.native-evidence', {...binding,evidenceRef:ref.replace('tasks/task/','tasks/other-task/')}), {code:'TASK_OWNER_NATIVE_EVIDENCE_INVALID'})
      assert.deepEqual(await store.query({kind:'task.owner.native-evidence',taskId:'task'}), [])
    }
    await send('task.owner.native-evidence', {...binding,evidenceRef:ref}); refs.push(ref)
  }
  const persisted = await store.query({kind:'task.owner.native-evidence',taskId:'task'})
  assert.deepEqual(persisted.map(item=>item.artifactRef), refs)
  assert.deepEqual((await Promise.all(persisted.map(item=>artifacts.read(item.artifactRef)))).map(({callId,phase,result})=>({callId,phase,result})), facts)
  assert.equal(persisted.length, 5)
})

// Host execution session resumes its frozen node; Task Owner cannot authorize repairs.
async function managedRecoveryRequest({controller,artifacts,runId,summary,commandId}) {
 const recovery=await controller.inspectNodeRecovery(runId);assert.equal(recovery.repairable,true,JSON.stringify(recovery))
 const state=await controller.state(runId),plan=await controller.taskPlan(state.run.taskId)
 const context=await artifacts.put({kind:'execution-recovery-context',taskId:state.run.taskId,runId,nodeRunId:recovery.nodeRunId,generation:recovery.generation,diagnosis:summary,strategy:summary,evidenceRefs:recovery.evidenceRefs,problemKey:recovery.problemKey,requirementRevision:plan.task.requirementRevision,planRevision:plan.task.planRevision,controlRevision:plan.task.controlRevision})
 return {commandId,runId,expectedRevision:recovery.runRevision,nodeRunId:recovery.nodeRunId,generation:recovery.generation,leaseEpoch:recovery.leaseEpoch,inputDigest:recovery.inputDigest,contextRef:context.ref}
}

test('执行会话续行原Agent并保留成功前缀与输入', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'owner-agent-continuation-'))
  const store = await openExecutionStore({ dbPath: join(directory, 'control.sqlite'), instanceId: 'owner-agent-continuation', initialize: true })
  const artifacts = await openExecutionArtifacts({ directory: join(directory, 'artifacts'), initialize: true })
  let prefixCalls = 0, finalCalls = 0
  const visits = []
  const agentSessions = { async close() {}, async cancel() {}, async run({ binding, input, recoveryContext, onSessionBound, onResult }) {
    await onSessionBound()
    visits.push({ binding, input, recoveryContext })
    if (visits.length === 1) await onResult({ ready: false, reason: '查询参数错误，需修正后继续' })
    else {
      assert.equal(recoveryContext.kind, 'execution-recovery-context')
      assert.equal(recoveryContext.nodeRunId, binding.nodeRunId)
      assert.equal(recoveryContext.strategy, '根据原始诊断修正查询参数并继续当前核验')
      await onResult({ ready: true, result: 7 })
    }
    return { status: 'submitted' }
  } }
  const object = { type: 'object' }
  const workflow = { id: 'review-inventory', version: '1', nodes: [
    { id: 'prepare', version: '1', executor: 'code', allowedEffects: ['pure'], inputSchema: object, outputSchema: object,
      mapInput: ({ requirement }) => requirement, execute: async () => { prefixCalls++; return { prepared: true } } },
    { id: 'review', version: '1', executor: 'agent', allowedEffects: ['read'], allowedTools: [], provider: 'fixture', model: 'scripted', prompt: '核对当前库存',
      inputSchema: object, outputSchema: object, mapInput: ({ previousOutput }) => previousOutput,
      admitOutput: ({ output }) => output.ready ? { outcome: 'succeeded' } : { outcome: 'failed', waitReason: { kind: 'recovery', reference: 'AGENT_WORK_BLOCKED' } } },
    { id: 'finish', version: '1', executor: 'code', allowedEffects: ['pure'], inputSchema: object, outputSchema: object,
      mapInput: ({ previousOutput }) => previousOutput, execute: async ({ input }) => { finalCalls++; return input } },
  ] }
  const controller = createExecutionController({ store, artifacts, workflows: [workflow], sessions: agentSessions })
  t.after(async () => { await controller.close(); await store.close() })
  await controller.createTaskPlan({ commandId: 'plan', taskId: 'task', stages: [{ stageId: 'first', workflowId: workflow.id, input: { request: '核对库存' } }] })
  const started = await controller.advanceTaskPlan('task'), runId = started.stages[0].runId
  const failed = await controller.whenIdle(runId)
  await controller.advanceTaskPlan('task')
  assert.equal((await controller.taskPlan('task')).stages[0].status, 'blocked')
  assert.deepEqual((await controller.state(runId)).nodes,failed.nodes)
  const resumeRequest=await managedRecoveryRequest({controller,artifacts,runId,summary:'根据原始诊断修正查询参数并继续当前核验',commandId:'host-resume-original'})
  await controller.resumeNode(resumeRequest)
  const resumed = await controller.whenIdle(runId)
  await controller.resumeNode(resumeRequest)
  assert.equal(resumed.run.status, 'succeeded')
  assert.equal(resumed.run.generation, failed.run.generation)
  assert.equal(prefixCalls, 1); assert.equal(finalCalls, 1); assert.equal(visits.length, 2)
  for (const field of ['sessionId', 'nodeRunId', 'generation', 'inputDigest']) assert.equal(visits[1].binding[field], visits[0].binding[field], field)
  assert.ok(visits[1].binding.leaseEpoch > visits[0].binding.leaseEpoch)
  assert.deepEqual(visits[1].input, visits[0].input)
  assert.equal(resumed.nodes[0].outputRef, failed.nodes[0].outputRef)
})

for (const repairable of [true, false]) test(`领域失败与外部等待保留真实诊断且不自动重试：${repairable}`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'owner-continuation-'))
  const store = await openExecutionStore({ dbPath: join(directory, 'control.sqlite'), instanceId: 'continuation', initialize: true })
  const artifacts = await openExecutionArtifacts({ directory: join(directory, 'artifacts'), initialize: true })
  const workflow = { id: 'inspect', version: '1', nodes: [{ id: 'read', version: '1', executor: 'code', allowedEffects: ['read'],
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, mapInput: ({ requirement }) => requirement,
    execute: async () => { if (repairable) return { parameter: 'column', reason: 'QUERY_PARAMETER_INVALID' }
      throw Object.assign(Error('等待真人审批'), { code: 'PLUGIN_APPROVAL_PENDING', evidence: [{ approval: 'pending' }] }) },
    ...(repairable ? { admitOutput: () => ({ outcome: 'failed', waitReason: { kind: 'recovery', reference: 'QUERY_PARAMETER_INVALID' } }) } : {}) }] }
  const controller = createExecutionController({ store, artifacts, workflows: [workflow] })
  t.after(async () => { await controller.close(); await store.close() })
  await controller.createTaskPlan({ commandId: 'plan', taskId: 'task', stages: [{ stageId: 'first', workflowId: 'inspect', input: { request: '读取当前表' } }] })
  const started = await controller.advanceTaskPlan('task'), runId = started.stages[0].runId
  const state = await controller.whenIdle(runId)
  const failedPlan = await controller.advanceTaskPlan('task')
  assert.equal(failedPlan.stages[0].status, repairable ? 'blocked' : 'running')
  const evidenceRefs = state.nodes[0].evidenceRefs
  assert.ok(evidenceRefs.length)
  assert.deepEqual((await controller.state(runId)).nodes, state.nodes)
  assert.deepEqual(await store.query({ kind: 'effect.list', runId }), [])
})

// 使用完整原生 Store 和持久文件，覆盖维护命令、事务 CAS 与重启；不连接外部服务。
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'owner-completion-recovery-'))
  const dbPath = join(directory, 'control.sqlite'), instanceId = 'recovery-test'
  const stores = [], controllers = []
  const open = async initialize => {
    const store = await openExecutionStore({ dbPath, instanceId, ...(initialize ? { initialize: true } : {}) })
    stores.push(store); return store
  }
  let store = await open(true)
  const artifacts = await openExecutionArtifacts({ directory: join(directory, 'artifacts'), initialize: true })
  const workflow = { id: 'historical', version: '1', nodes: [{ id: 'calculate', version: '1', executor: 'code',
    allowedEffects: ['pure'], inputSchema: { type: 'number' }, outputSchema: { type: 'number' },
    mapInput: ({ requirement }) => requirement, execute: async ({ input }) => input + 1 }] }
  const controller = createExecutionController({ store, artifacts, workflows: [workflow] }); controllers.push(controller)
  t.after(async () => { for (const c of controllers) await c.close(); for (const s of stores) await s.close() })
  const send = async (kind, args, id = randomUUID()) => (await store.command({ id, kind, args })).result
  await controller.createTaskPlan({ commandId: 'plan', taskId: 'task', stages: [{ stageId: 'one', workflowId: workflow.id, input: 1 }] })
  await send('task.owner.init', { taskId: 'task', sessionId: 'historical-session', criteria: ['结果为2'], sourceKey: 'source' })
  const running = await controller.advanceTaskPlan('task')
  await controller.whenIdle(running.stages[0].runId)
  const plan = await controller.advanceTaskPlan('task'), stage = plan.stages[0]
  const payload = { taskId: 'task', planRevision: 1, stageId: stage.stageId, workflowId: stage.workflowId,
    status: stage.status, runId: stage.runId, outputRef: stage.outputRef, evidenceRefs: stage.evidenceRefs }
  const payloadRef = (await artifacts.put(payload)).ref
  const digest = value => createHash('sha256').update(JSON.stringify([value])).digest('hex').slice(0, 40)
  const eventKey = `stage-${digest(['task', 1, stage.stageId, stage.status])}`
  await send('task.owner.event', { taskId: 'task', eventKey, eventType: 'workflow.succeeded', payloadRef }, `owner-event:${eventKey}`)
  const claim = await send('task.owner.claim', { taskId: 'task', turnId: 'complete', expectedLeaseEpoch: 0 })
  await send('task.owner.sessionBound', { taskId: 'task', turnId: 'complete', leaseEpoch: claim.leaseEpoch, sessionId: claim.sessionId })
  await send('task.owner.candidate', { taskId: 'task', turnId: 'complete', leaseEpoch: claim.leaseEpoch,
    decision: { action: 'complete', summary: '已有完成证明', evidenceRefs: [stage.outputRef],
      assessments: [{ itemId: 'acceptance-1', status: 'satisfied', evidenceRefs: [stage.outputRef] }] } })
  await send('task.owner.accept', { taskId: 'task', turnId: 'complete', leaseEpoch: claim.leaseEpoch })
  await send('task.owner.applied', { taskId: 'task', turnId: 'complete', leaseEpoch: claim.leaseEpoch })
  const before = await store.query({ kind: 'task.owner', taskId: 'task' })
  const duplicate = () => send('task.owner.event', { taskId: 'task', eventKey: `stage-${digest(payload)}`,
    eventType: 'workflow.succeeded', payloadRef })
  const maintain = () => send('runtime.maintenance.change', { active: true, expectedRevision: 0,
    maintenanceId: 'repair-observations', actorId: 'owner', reason: '验证重复观察恢复' })
  const reopen = async mutate => {
    await controller.close(); await store.close()
    if (mutate) { const db = new DatabaseSync(dbPath); try { mutate(db) } finally { db.close() } }
    store = await open(false)
  }
  return { before, send, duplicate, maintain, reopen, dbPath,
    get store() { return store }, async proof() { return store.query({ kind: 'task.owner.completed-observations', taskId: 'task' }) } }
}
const recoveryArgs = proof => Object.fromEntries(['taskId', 'completeTurnId', 'expectedOwnerRevision', 'expectedEventWatermark',
  'maintenanceId', 'expectedMaintenanceRevision', 'actorId'].map(key => [key, proof[key]]).concat([['reason', '恢复稳定身份升级产生的重复成功事件']]))

test('原生维护恢复仅处理重复观察，重启保留原complete及错误回合与事件', async t => {
  const f = await fixture(t)
  const duplicate = await f.duplicate()
  const claim = await f.send('task.owner.claim', { taskId: 'task', turnId: 'misawakened', expectedLeaseEpoch: 1 })
  await f.send('task.owner.release', { taskId: 'task', turnId: 'misawakened', leaseEpoch: claim.leaseEpoch, reason: 'WORKFLOW_OWNER_CONTRACT_UNAVAILABLE' })
  await assert.rejects(f.proof(), { code: 'TASK_OWNER_RECOVERY_REQUIRES_MAINTENANCE' })
  await f.maintain()
  const proof = await f.proof(), args = recoveryArgs(proof)
  assert.deepEqual(proof.duplicateEventSequences, [duplicate.eventSeq])
  for (const changed of [{ expectedOwnerRevision: 0 }, { expectedEventWatermark: 0 }, { expectedMaintenanceRevision: 0 },
    { completeTurnId: 'other' }, { maintenanceId: 'other' }, { actorId: 'other' }]) {
    await assert.rejects(f.send('task.owner.reconcile-completed-observations', { ...args, ...changed }), { code: 'TASK_OWNER_RECOVERY_STALE' })
  }
  const result = await f.send('task.owner.reconcile-completed-observations', args, 'recovery')
  assert.equal(result.status, 'reconciled')
  assert.equal((await f.send('task.owner.reconcile-completed-observations', args, 'recovery')).status, 'reconciled')
  await f.reopen()
  const after = await f.store.query({ kind: 'task.owner', taskId: 'task' })
  assert.equal(after.status, 'idle'); assert.equal(after.eventWatermark, after.processedWatermark)
  assert.deepEqual(after.decision, f.before.decision)
  const db = new DatabaseSync(f.dbPath, { readOnly: true })
  try {
    assert.equal(db.prepare("SELECT status FROM task_owner_turns WHERE turn_id='misawakened'").get().status, 'released')
    assert.equal(db.prepare('SELECT turn_id FROM task_events WHERE seq=?').get(duplicate.eventSeq).turn_id, 'complete')
    assert.equal(db.prepare("SELECT count(*) n FROM task_owner_turns WHERE status='accepted'").get().n, 1)
    assert.equal(db.prepare("SELECT count(*) n FROM execution_events WHERE kind='task.owner.reconcile-completed-observations'").get().n, 1)
  } finally { db.close() }
})

const unsafe = [
  ['新业务事件', db => db.prepare("UPDATE task_events SET event_type='intent.received' WHERE seq=(SELECT max(seq) FROM task_events)").run(), 'TASK_OWNER_RECOVERY_EVENT_CHANGED'],
  ['不同产出', db => db.prepare("UPDATE task_events SET payload_ref='sha256-different.json' WHERE seq=(SELECT max(seq) FROM task_events)").run(), 'TASK_OWNER_RECOVERY_EVENT_CHANGED'],
  ['权限变化', db => db.prepare('UPDATE task_owners SET authorization_revision=authorization_revision+1').run(), 'TASK_OWNER_RECOVERY_COMPLETION_CHANGED'],
  ['要求变化', db => db.prepare('UPDATE business_tasks SET requirement_revision=requirement_revision+1').run(), 'TASK_OWNER_RECOVERY_COMPLETION_CHANGED'],
  ['计划变化', db => { db.prepare('UPDATE business_tasks SET plan_revision=plan_revision+1').run(); db.prepare('UPDATE task_plan_stages SET plan_revision=plan_revision+1').run() }, 'TASK_OWNER_RECOVERY_COMPLETION_CHANGED'],
  ['新业务执行', db => db.prepare("UPDATE execution_runs SET updated_at='2099-01-01T00:00:00.000Z'").run(), 'TASK_OWNER_RECOVERY_EXECUTION_CHANGED'],
  ['节点未排空', db => db.prepare('UPDATE execution_nodes SET drained=0').run(), 'TASK_OWNER_RECOVERY_REQUIRES_MAINTENANCE'],
  ['阶段未成功', db => db.prepare("UPDATE task_plan_stages SET status='blocked'").run(), 'TASK_OWNER_RECOVERY_STAGE_CHANGED'],
  ['原完成证明未应用', db => db.prepare("UPDATE task_owner_turns SET application_status='pending' WHERE turn_id='complete'").run(), 'TASK_OWNER_RECOVERY_COMPLETION_CHANGED'],
  ['完成后接纳业务决定', db => db.exec(`INSERT INTO task_owner_turns(turn_id,task_id,lease_epoch,event_watermark,
    requirement_revision,plan_revision,control_revision,authorization_revision,input_fence_revision,
    decision_json,status,application_status,created_at,updated_at)
    SELECT 'new-action',task_id,lease_epoch,event_watermark,requirement_revision,plan_revision,control_revision,
    authorization_revision,input_fence_revision,'{"action":"advance"}','accepted','applied',created_at,updated_at
    FROM task_owner_turns WHERE turn_id='complete'`), 'TASK_OWNER_RECOVERY_COMPLETION_CHANGED'],
  ['不确定外部效果', db => db.exec(`INSERT INTO execution_effects(effect_id,kind,run_id,node_run_id,node_id,generation,input_digest,
    definition_digest,definition_json,resource_keys_json,authorization_ref,state,created_at,updated_at)
    SELECT 'unknown','operation',run_id,node_run_id,node_id,generation,input_digest,input_digest,'{}','[]','authorized','unknown',
    '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z' FROM execution_nodes LIMIT 1`), 'TASK_OWNER_RECOVERY_REQUIRES_MAINTENANCE'],
]
for (const [name, mutate, code] of unsafe) test(`完成观察恢复拒绝${name}`, async t => {
  const f = await fixture(t); await f.duplicate(); await f.maintain(); await f.reopen(mutate)
  await assert.rejects(f.proof(), { code })
})

test('历史查询证据按当前需求和turn持久绑定，旧修复候选在Store拒绝',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'owner-current-query-repair-'))
 const store=await openExecutionStore({dbPath:join(directory,'control.sqlite'),instanceId:'query-repair',initialize:true})
 const directories={logicalTaskId:'task',...Object.fromEntries(['work','tmp','outputs'].map(area=>[area,join(directory,'tasks','tasks','task',area)]))}
 for(const area of ['work','tmp','outputs'])await mkdir(directories[area],{recursive:true})
 const artifacts=await openExecutionArtifacts({directory:join(directory,'artifacts'),initialize:true,taskWorkspaceRoot:join(directory,'tasks'),getTaskDirectories:async()=>directories})
 const workflow={id:'blocked-query',version:'1',nodes:[{id:'inspect',version:'1',executor:'code',allowedEffects:['read'],inputSchema:{type:'object'},outputSchema:{type:'object'},mapInput:({requirement})=>requirement,execute:async()=>({reason:'QUERY_PARAMETER_INVALID'}),admitOutput:()=>({outcome:'failed',waitReason:{kind:'recovery',reference:'QUERY_PARAMETER_INVALID'}})}]}
 const controller=createExecutionController({store,artifacts,workflows:[workflow]})
 const send=async(kind,args)=>(await store.command({id:randomUUID(),kind,args})).result
 t.after(async()=>{await controller.close();await store.close()})
 await controller.createTaskPlan({commandId:'plan',taskId:'task',stages:[{stageId:'first',workflowId:workflow.id,input:{request:'查目标结构'}}]})
 const started=await controller.advanceTaskPlan('task'),runId=started.stages[0].runId
 const state=await controller.whenIdle(runId);await controller.advanceTaskPlan('task')
 const initialRequirement=(await artifacts.put({request:'查目标结构'},{taskId:'task'})).ref
 await send('task.requirement.bind-legacy',{taskId:'task',expectedRequirementRevision:1,requirementRef:initialRequirement,sessionId:'query-session',criteria:['核验当前目标结构'],sourceKey:'source',eventKey:'bind-current'})
 const refs=[]
 for(const revision of [1,2]){
  if(revision===2){
   const requirementRef=(await artifacts.put({request:'删除name，先只读核验'},{taskId:'task'})).ref
   await send('task.requirement.update',{taskId:'task',expectedRequirementRevision:1,requirementRef,eventKey:'new-requirement'})
   assert.deepEqual(await store.query({kind:'task.owner.query-evidence',taskId:'task'}),[])
   assert.ok((await store.query({kind:'task.owner.events',taskId:'task'})).some(e=>e.eventType==='query.succeeded'&&e.payloadRef===refs[0]))
   await assert.rejects(store.query({kind:'task.owner.query-evidence',taskId:'task',requirementRevision:1}),{code:'TASK_OWNER_QUERY_STALE'})
  }
  const claim=await send('task.owner.claim',{taskId:'task',turnId:'query-turn-'+revision,expectedLeaseEpoch:revision-1})
  assert.equal(claim.sessionId,'query-session')
  const turn={taskId:'task',turnId:claim.turnId,leaseEpoch:claim.leaseEpoch}
  await send('task.owner.sessionBound',{...turn,sessionId:claim.sessionId})
  const binding={...turn,requirementRevision:revision}
  if(revision===2)await assert.rejects(send('task.owner.query-evidence',{...binding,requirementRevision:1,evidenceRef:refs[0]}),{code:'TASK_OWNER_QUERY_STALE'})
  const ref=(await artifacts.put({kind:'agent-query-evidence',execution:{...binding,sessionId:claim.sessionId},result:{columns:['id','name'],revision},verification:{sourceRefs:['fixture-readonly-catalog']}},{taskId:'task'})).ref
  await assert.rejects(send('task.owner.query-evidence',{...binding,evidenceRef:ref.replace('tasks/task/','tasks/foreign/')}),{code:'TASK_OWNER_QUERY_EVIDENCE_INVALID'})
  await send('task.owner.query-evidence',{...binding,evidenceRef:ref});refs.push(ref)
  const current=await store.query({kind:'task.owner.query-evidence',taskId:'task'})
  assert.equal(current.length,1);assert.equal(current[0].turnId,claim.turnId);assert.equal(current[0].artifactRef,ref)
  await assert.rejects(send('task.owner.candidate',{...turn,decision:{action:'repairCurrentStage',summary:'旧动作',evidenceRefs:[ref]}}),{code:'TASK_OWNER_EXECUTION_REPAIR_DISABLED'})
  const decision={action:'wait',summary:'current evidence recorded',evidenceRefs:[ref],condition:{kind:'execution',missing:'managed continuation',responsibleParty:'Host',resumeWhen:'managed helper admits recovery',evidenceRefs:[ref]}}
  await send('task.owner.candidate',{...turn,decision});await send('task.owner.accept',turn);await send('task.owner.applied',turn)
 }
 assert.notEqual(refs[0],refs[1]);assert.deepEqual((await controller.state(runId)).nodes,state.nodes)
 assert.equal((await store.query({kind:'task.owner',taskId:'task'})).decision.action,'wait')
})

test('执行会话按validator真实身份纠正原agent且错误绑定拒绝', async t => {
 const directory=await mkdtemp(join(tmpdir(),'owner-validator-identity-')),store=await openExecutionStore({dbPath:join(directory,'control.sqlite'),instanceId:'owner-validator',initialize:true}),artifacts=await openExecutionArtifacts({directory:join(directory,'artifacts'),initialize:true})
 let prefixCalls=0,proposalCalls=0,validatorCalls=0
 const object={type:'object'},workflow={id:'owner-engineering',version:'18',nodes:[
  {id:'prepare-workspace',version:'1',executor:'code',allowedEffects:['pure'],inputSchema:object,outputSchema:object,mapInput:({requirement})=>requirement,execute:async({input})=>{prefixCalls++;return input}},
  {id:'inspect-and-propose',version:'1',executor:'agent',allowedEffects:['read'],allowedTools:[],provider:'test',model:'test',prompt:'纠正提案',inputSchema:object,outputSchema:object,mapInput:({previousOutput})=>previousOutput},
  {id:'validate-proposal',version:'1',executor:'code',allowedEffects:['pure'],inputSchema:object,outputSchema:object,mapInput:({previousOutput})=>previousOutput,execute:async({input})=>{validatorCalls++;if(!input.valid)throw Object.assign(Error('ENGINEERING_NO_EFFECT_MODIFICATION'),{code:'ENGINEERING_NO_EFFECT_MODIFICATION'});return input}},
  {id:'finish',version:'1',executor:'code',allowedEffects:['pure'],inputSchema:object,outputSchema:object,mapInput:({previousOutput})=>previousOutput,execute:async({input})=>input}
 ]}
 const controller=createExecutionController({store,artifacts,workflows:[workflow],sessions:{async close(){},async cancel(){},async assertDrained(){},async run({recoveryContext,onSessionBound,onResult}){proposalCalls++;await onSessionBound();await onResult({valid:!!recoveryContext});return{status:'submitted'}}}})
 t.after(async()=>{await controller.close();await store.close()})
 await controller.createTaskPlan({commandId:'plan',taskId:'task',stages:[{stageId:'engineering',workflowId:workflow.id,input:{request:'修复候选'}}]})
 const started=await controller.advanceTaskPlan('task'),runId=started.stages[0].runId,before=await controller.whenIdle(runId)
 await store.command({id:'register',kind:'workflow.register',args:{workflowId:workflow.id,digest:before.run.workflowDigest,definitionVersion:'18',config:{kind:'engineering',taskId:'task',runId}}})
 await controller.advanceTaskPlan('task')
 assert.deepEqual((await controller.state(runId)).nodes,before.nodes)
 const resumeRequest=await managedRecoveryRequest({controller,artifacts,runId,summary:'阅读原校验诊断并纠正提案',commandId:'host-validator-resume'})
 for(const change of [{nodeRunId:'foreign'},{generation:before.run.generation+1},{expectedRevision:before.run.revision+1},{leaseEpoch:resumeRequest.leaseEpoch+1},{inputDigest:'0'.repeat(64)}])await assert.rejects(controller.resumeNode({...resumeRequest,...change,commandId:randomUUID()}),{code:'NODE_RECOVERY_NOT_ADMITTED'})
 await controller.resumeNode(resumeRequest)
 const after=await controller.whenIdle(runId)
 await controller.resumeNode(resumeRequest)
 assert.equal(after.run.status,'succeeded');assert.equal(after.run.generation,before.run.generation);assert.equal(prefixCalls,1);assert.equal(proposalCalls,2);assert.equal(validatorCalls,2)
 assert.equal(after.nodes[1].nodeRunId,before.nodes[1].nodeRunId);assert.equal(after.nodes[1].sessionId,before.nodes[1].sessionId);assert.deepEqual(after.nodes[0],before.nodes[0])

})
