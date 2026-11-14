import test from 'node:test'
import assert from 'node:assert/strict'
import { createObserverAlertPages } from '../packages/dingtalk-core/observer-alert-pages.js'
import { hasRestartIsolation, isolationDigest } from '../packages/dingtalk-core/native-restart-isolation.js'
import { restartFixture } from './fixtures/native-restart-isolation.js'

function audited(acknowledged = true) {
 const f = restartFixture(acknowledged)
 f.operation.id = f.operation.operationId
 // Synthetic counterpart of the persisted Windows scope probe; no private logs or identifiers.
 const provenance = { kind: 'native-windows-restart-probe', historicalJobObjectIdentity: 'unavailable', isolationBasis: 'bounded-producer-exclusion' }
 const isolation = { ...f.receipt, kind: 'native-source-scope-isolation', issuer: 'native-windows-scope-evidence-v1',
  sourceScopeQuiescent: true, durableSourceExclusion: true, activeSourceCount: 0, provenance, provenanceDigest: isolationDigest(provenance) }
 isolation.binding.operationDigest = isolationDigest(f.operation)
 const proof = { kind: 'native-host-restart-isolated', ...isolation.binding, observations: [{ sequence: 1 }], isolation }
 f.operation.recoverySettlement = { kind: 'host-restart-isolated', exitStatus: 'unknown', noReplay: true, partialEffectsPossible: true,
  operatorSourceId: 'synthetic-operator', humanRequestId: 'synthetic-human', proof }
 assert.equal(hasRestartIsolation(f.operation), true)
 return f.operation
}
function alerts(operation, extras = {}) {
 return createObserverAlertPages({ failures: new Map(), tasks: new Map(), operations: new Map([[operation.id, operation]]), notifications: new Map(), ...extras })
}

for (const acknowledged of [true, false]) test(`audited ${acknowledged ? 'acknowledged' : 'missing-result'} restart is not an active alert and preserves history`, async () => {
 const operation = audited(acknowledged), before = structuredClone(operation), pages = alerts(operation)
 assert.deepEqual(pages.all(), [])
 assert.equal((await pages.page()).total, 0)
 assert.deepEqual(operation, before)
 assert.equal(operation.state, 'unknown'); assert.equal(operation.result, null); assert.equal(operation.job.status, 'running')
})

const invalid = {
 'no audit': o => { delete o.recoverySettlement },
 'wrong recovery reason': o => { o.recoveryReason = 'other' },
 'missing operator confirmation': o => { delete o.recoverySettlement.operatorSourceId },
 'missing investigation evidence': o => { o.recoverySettlement.proof.observations = [] },
 'scope not drained': o => { o.recoverySettlement.proof.isolation.sourceScopeQuiescent = false },
 'remaining source': o => { o.recoverySettlement.proof.isolation.activeSourceCount = 1 },
 'writers not excluded': o => { o.recoverySettlement.proof.isolation.externalWritersExcluded = false },
 'invalid provenance digest': o => { o.recoverySettlement.proof.isolation.provenanceDigest = 'stale' },
 'stale operation digest': o => { o.recoverySettlement.proof.operationDigest = 'stale' },
 'foreign task binding': o => { o.recoverySettlement.proof.taskId = 'other' },
 'replay not forbidden': o => { o.recoverySettlement.noReplay = false },
}
for (const [name, mutate] of Object.entries(invalid)) test(`unknown remains active: ${name}`, async () => {
 const operation = audited(); mutate(operation)
 const before = structuredClone(operation), pages = alerts(operation)
 assert.equal(pages.all().length, 1)
 assert.equal((await pages.page()).total, 1)
 assert.deepEqual(operation, before)
})

test('audit transition refreshes pagination without suppressing independent unknown or notification failures', async () => {
 const operation = audited(), audit = operation.recoverySettlement
 delete operation.recoverySettlement
 const other = { id: 'other', operationId: 'other', state: 'unknown' }
 const pages = alerts(operation, { operations: new Map([[operation.id, operation], [other.id, other]]),
  notifications: new Map([['notice', { id: 'notice', state: 'unknown' }]]) })
 assert.equal((await pages.page()).total, 3)
 operation.recoverySettlement = audit
 const page = await pages.page()
 assert.equal(page.total, 2)
 assert.deepEqual(pages.all().map(x => x.alertId).sort(), ['notification:notice', 'operation:other'])
})

test('a read-only wait report keeps unresolved native effects visible after transient failures clear',async()=>{
 const task={taskId:'held-task',status:'active',updatedAt:'2026-11-12T00:00:00Z',lastDecision:{action:'wait',summary:'Read-only inspection finished',limitations:['TASK_EFFECT_UNCERTAIN_NO_REPLAY'],evidence:['Unresolved effect: write; intentEntryId=original-intent']}}
 const pages=createObserverAlertPages({failures:new Map(),tasks:new Map([[task.taskId,task]]),operations:new Map(),notifications:new Map()})
 const alert=pages.all().find(row=>row.taskId===task.taskId)
 assert.ok(alert);assert.match(alert.detail,/TASK_EFFECT_UNCERTAIN_NO_REPLAY/)
 assert.equal((await pages.page()).items.length,1)
 // A controlled reconciliation replaces the old held decision; it is not inferred from a read.
 task.lastDecision={action:'wait',summary:'Original effect was reconciled',limitations:[]};task.updatedAt='2026-11-12T00:01:00Z'
 assert.deepEqual(pages.all(),[])
})

test('普通等待和业务阻断保留为任务待处理，不进入运行告警分页',async()=>{
 const make=(id,action,question)=>({taskId:id,status:'active',drained:true,updatedAt:'2026-11-14T00:00:00Z',lastDecision:{action,question,summary:'等待外部条件',limitations:[]}})
 const tasks=new Map([['wait',make('wait','wait','请提供受管身份')],['blocked',make('blocked','blocked',null)],['quiet',make('quiet','wait',null)]])
 const before=structuredClone(tasks),pages=createObserverAlertPages({tasks,failures:new Map(),operations:new Map(),notifications:new Map()})
 assert.deepEqual(pages.all().map(row=>row.type),['task','task'])
 assert.equal((await pages.page({type:'task'})).total,2)
 assert.equal((await pages.page({type:'runtime'})).total,0)
 assert.equal((await pages.page()).total,2)
 assert.deepEqual(tasks,before)
})

test('未知效果、排空或技术失败及未知发送仍属于运行告警',async()=>{
 const tasks=new Map()
 for(const [id,extra]of Object.entries({effect:{limitations:['TASK_EFFECT_UNCERTAIN_NO_REPLAY']},job:{limitations:['TASK_JOB_UNCERTAIN_NO_REPLAY']},drain:{sessionFailure:{code:'TASK_SESSION_DRAIN_FAILED'}},technical:{technicalFailure:{code:'TASK_PI_PROVIDER_ERROR'}},submission:{limitations:['TASK_SESSION_NO_SUBMISSION']},provider:{providerRecovery:{hostRetryDisabled:true}}})){
  const {limitations=[],...state}=extra
  tasks.set(id,{taskId:id,status:'active',...state,lastDecision:{action:'wait',question:['effect','job'].includes(id)?'请核验':null,summary:'等待核实',limitations}})
 }
 const pages=createObserverAlertPages({tasks,failures:new Map([['host',{id:'host',code:'TASK_RECOVERY_FAILED'}]]),operations:new Map([['op',{id:'op',state:'unknown'}]]),notifications:new Map([['notice',{id:'notice',state:'unknown'}]])})
 assert.equal(pages.all().length,9);assert.ok(pages.all().every(row=>row.type==='runtime'))
 assert.equal((await pages.page({type:'runtime'})).total,9)
 assert.equal((await pages.page({type:'task'})).total,0)
})

test('分类变化即使时间戳相同也使旧分页失效',async()=>{
 const task={taskId:'same',status:'active',updatedAt:'2026-11-14T00:00:00Z',lastDecision:{action:'wait',question:'请核验',summary:'待处理',limitations:[]}}
 const pages=createObserverAlertPages({tasks:new Map([[task.taskId,task]]),failures:new Map(),operations:new Map(),notifications:new Map()})
 const first=await pages.page({type:'task'});assert.equal(first.total,1)
 task.lastDecision.limitations=['TASK_JOB_UNCERTAIN_NO_REPLAY']
 assert.equal((await pages.page({type:'runtime'})).total,1)
 assert.equal((await pages.page({type:'task'})).total,0)
 await assert.rejects(pages.page({revision:first.revision}),{code:'OBSERVER_PAGE_STALE'})
})
