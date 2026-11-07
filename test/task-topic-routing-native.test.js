// Web mutation regressions retained after active Topic routing retirement.
import { nativeLifecycle, nativeLifecycleTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import testRunner from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rmdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { taskDirectories } from '../packages/dingtalk-core/session-workspaces.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDynamicTaskStore } from '../packages/dingtalk-core/dynamic-task-store.js'
import { openTaskSessionService } from '../packages/dingtalk-core/task-session-service.js'
import { available, reason, nativeTaskHost, latestInput, waitUntil, topicTaskCalls } from './fixtures/routing-official-host.js'
const call = (name, args) => ({name,args})
async function extraHost(t,prefix,decide){
 const root=await mkdtemp(join(tmpdir(),prefix));let host
 t.after(async()=>{try{await host?.close()}finally{await rm(root,{recursive:true,force:true})}})
 host=await nativeTaskHost(root,decide);return host
}

for (const committed of [false, true]) testRunner(`replan fences a Single task claim ${committed ? 'after commit' : 'before commit'}`, {timeout:nativeLifecycleTimeout(30000)}, nativeLifecycle(30000, async t => {
  const root=await mkdtemp(join(tmpdir(),'single-task-claim-gate-')),gate=Promise.withResolvers()
  t.onCancel(()=>gate.resolve())
  let host,store,entered=false,revised=false,blocked=false,claimError
  const claims=[],modeled=[]
  t.after(async()=>{gate.resolve();await host?.close();await store?.close();await rm(root,{recursive:true,force:true})})
  await t.beginBusiness()
  host=await nativeTaskHost(root,request=>{
    const routes=topicTaskCalls(request);if(routes)return routes
    const input=latestInput(request);modeled.push(structuredClone(input))
    if(input.task.requirementRevision!==2)return[{name:'write',args:{path:'work/stale-generation.txt',content:'must never execute'}}]
    const successfulWrite=request.messages.some(message=>message.role==='toolResult'&&message.toolName==='write'&&!message.isError)
    if(!successfulWrite)return[{name:'write',args:{path:'work/current-generation.txt',content:JSON.stringify({revision:input.task.requirementRevision,sources:input.sources.map(source=>({sourceId:source.sourceId,version:source.version,text:source.text}))})}}]
    return[{name:'task_result',args:{decision:{action:'wait',summary:'Only the current revision executed with its actual sources',evidence:['current-generation.txt'],limitations:[]}}}]
  },{serviceFactory:async args=>{
    store=await openDynamicTaskStore({dbPath:args.config.dbPath,instanceId:args.config.instanceId,initialize:true,webActorId:args.config.webActorId})
    return openTaskSessionService({...args,store:{...store,async command(request){
      const hold=request.kind==='task.claim'&&!blocked
      if(hold){blocked=true;if(!committed){entered=true;await gate.promise}}
      let receipt
      try{receipt=await store.command(request)}catch(error){if(request.kind==='task.claim')claimError=error.code;throw error}
      if(request.kind==='task.claim')claims.push(structuredClone(receipt.result.binding))
      if(hold&&committed){entered=true;await gate.promise}
      if(request.kind==='task.revise')revised=true
      return receipt
    }}})
  }})
  try{
    const task=await host.service.createTask({groupId:'native-group',requestId:'claim-create',title:'领取竞态',objective:'检查任务，按真实后续修订执行'})
    await waitUntil(()=>entered,'Actual task.claim reaches the commit boundary',10000)
    const before=await host.query('task.get',{taskId:task.taskId}),originalSources=await Promise.all(before.sourceRefs.map(sourceId=>host.query('source.get',{sourceId})))
    assert.equal(before.requirementRevision,1);assert.equal(before.drained,!committed);assert.equal(modeled.length,0)
    let accepted=false
    const pending=host.service.appendTaskContext({taskId:task.taskId,requestId:'claim-replan',progressImpact:'replan',expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision,context:'更新要求：仅按版本二核对并保存真实来源。'}).then(value=>{accepted=true;return value})
    await waitUntil(()=>revised,'Actual task.revise commits while the old claim response is gated',5000)
    assert.equal(accepted,false,'Replan cannot return before the inflight old claim drains');assert.equal(modeled.length,0)
    gate.resolve();await pending;await host.service.whenIdle()
    const after=await host.query('task.get',{taskId:task.taskId});assert.equal(after.requirementRevision,2);assert.equal(after.sessionId,before.sessionId);assert.equal(after.drained,true);assert.equal(claimError,undefined)
    assert.ok(modeled.length>=2);assert.ok(modeled.every(input=>input.task.requirementRevision===2),'No stale revision may reach the actual SDK provider')
    assert.equal(claims[0].requirementRevision,committed?1:2)
    if(committed){assert.ok(claims.some(binding=>binding.requirementRevision===2));assert.equal(claims.at(-1).leaseEpoch,claims[0].leaseEpoch+1)}
    else assert.equal(claims.length,1,'Before-commit replan is consumed by the original current claim')
    const sourceRows=await Promise.all(after.sourceRefs.map(sourceId=>host.query('source.get',{sourceId}))),revisionSource=sourceRows.find(source=>source.requestIdentity?.request?.requestId==='claim-replan')
    assert.ok(revisionSource);assert.equal(revisionSource.actorId,'native-user');assert.equal(revisionSource.channel,'web');assert.match(revisionSource.text,/更新要求/)
    for(const source of originalSources)assert.deepEqual(await host.query('source.get',{sourceId:source.sourceId}),source)
    for(const input of modeled){assert.ok(input.sources.some(source=>source.sourceId===revisionSource.sourceId&&source.version===revisionSource.version&&source.text===revisionSource.text));for(const source of originalSources)assert.ok(input.sources.some(row=>row.sourceId===source.sourceId&&row.version===source.version&&row.text===source.text))}
    const saved=await host.ctx.sessionPersistence.readNative(after.sessionId,{requireComplete:true}),intents=saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent')
    assert.equal(intents.length,1);assert.equal(intents[0].payload.name,'write');assert.equal(intents[0].payload.invocation.originBinding.requirementRevision,2);assert.equal(saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,1)
    const output=JSON.parse(await readFile(join(saved.header.cwd,'work/current-generation.txt'),'utf8'));assert.equal(output.revision,2);assert.ok(output.sources.some(source=>source.sourceId===revisionSource.sourceId))
    await assert.rejects(readFile(join(saved.header.cwd,'work/stale-generation.txt')),{code:'ENOENT'});assert.deepEqual(await host.query('execution.list'),[])
  }finally{gate.resolve()}
}))

testRunner('Web revisions serialize per task while a different task makes progress', { ...({ timeout: 30000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'task-admission-isolation-'))
  const gate = Promise.withResolvers()
t.onCancel(() => gate.resolve())

  let host, store, entered = false, block = false
  const ownerRuns = new Map()
  const sessions = { async run({ binding, submit }) { ownerRuns.set(binding.taskId, (ownerRuns.get(binding.taskId) ?? 0) + 1); await submit({ action: 'wait', summary: '等待输入', evidence: [], limitations: [] }); return { status: 'submitted' } }, async cancel() {}, async close() {} }
  t.after(async () => { gate.resolve(); await host?.close(); await store?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  host = await t.step(async () => nativeTaskHost(root, async () => { throw new Error('Unexpected native model call') }, { serviceFactory: async args => {
    store = await openDynamicTaskStore({ dbPath: args.config.dbPath, instanceId: args.config.instanceId, initialize: true, webActorId: args.config.webActorId })
    const proxy = { ...store, async command(request) {
      if (block && request.kind === 'task.revise' && !entered) { entered = true; await gate.promise }
      return store.command(request)
    } }
    return openTaskSessionService({ ...args, store: proxy, taskSessions: sessions })
  } }))
  const first = await t.step(async () => host.service.createTask({ groupId: 'native-group', requestId: 'serial-create', title: '任务一', objective: '检查任务一' }))
  await t.step(async () => host.residentStore.subscribe({ groupId: 'independent-group', name: '独立群', responsibility: '隔离测试' }))
  const second = await t.step(async () => host.service.createTask({ groupId: 'independent-group', requestId: 'independent-create', title: '任务二', objective: '检查任务二' }))
  await t.step(async () => host.service.whenIdle())
  const a = await t.step(async () => host.query('task.get', { taskId: first.taskId })), b = await t.step(async () => host.query('task.get', { taskId: second.taskId }))
  const params = { taskId: first.taskId, progressImpact: 'replan', expectedRequirementRevision: a.requirementRevision, expectedControlRevision: a.controlRevision }
  block = true
  const pending = host.service.appendTaskContext({ ...params, requestId: 'serial-first', context: '第一条变更' })
  await t.step(async () => waitUntil(() => entered, '第一任务修订进入门闩', 5000))
  const duplicateRevision = host.service.appendTaskContext({ ...params, requestId: 'serial-second', context: '第二条变更' }).then(value => ({ value }), error => ({ error }))
  const independent = await t.step(async () => host.service.appendTaskContext({ taskId: second.taskId, requestId: 'independent-replan', progressImpact: 'replan',
    expectedRequirementRevision: b.requirementRevision, expectedControlRevision: b.controlRevision, context: '独立任务变更' }))
  assert.equal(independent.taskId, second.taskId)
  assert.equal((await t.step(async () => host.query('task.get', { taskId: first.taskId }))).requirementRevision, a.requirementRevision)
  assert.equal(ownerRuns.get(first.taskId), 1)
  gate.resolve()
  await t.step(async () => pending)
  const result = await t.step(async () => duplicateRevision)
  assert.ok(result.error)
  assert.equal(result.error.code, 'DYNAMIC_TASK_REVISION_STALE')
  await t.step(async () => host.service.whenIdle())
  assert.equal((await t.step(async () => host.query('task.get', { taskId: first.taskId }))).requirementRevision, a.requirementRevision + 1)
  assert.equal((await t.step(async () => host.query('task.get', { taskId: second.taskId }))).requirementRevision, b.requirementRevision + 1)
  assert.equal(ownerRuns.get(first.taskId), 2)
  assert.equal(ownerRuns.get(second.taskId), 2)
}))

testRunner('failed Web old-drain releases admission and replays the committed request without duplicating revision', {timeout:nativeLifecycleTimeout(30000)}, nativeLifecycle(30000, async t=>{
 const root=await mkdtemp(join(tmpdir(),'web-drain-failure-'));let host,cancels=0,runs=0
 const sessions={async run({submit}){runs++;await submit({action:'wait',summary:'等待补充',evidence:[],limitations:[]});return{status:'submitted'}},async cancel(){if(++cancels===1)throw Object.assign(new Error('fixture cancel failed'),{code:'FIXTURE_CANCEL_FAILED'})},async close(){}}
 t.after(async()=>{try{await host?.close()}finally{await rm(root,{recursive:true,force:true})}})
 await t.beginBusiness();host=await nativeTaskHost(root,()=>{throw Error('Unexpected model call')},{serviceFactory:args=>openTaskSessionService({...args,taskSessions:sessions})})
 const created=await host.service.createTask({groupId:'native-group',requestId:'drain-create',objective:'核对真实排空失败恢复'});await host.service.whenIdle()
 const task=await host.query('task.get',{taskId:created.taskId}),request={taskId:task.taskId,requestId:'drain-replan',progressImpact:'replan',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,context:'排空失败后仍保留本次明确变更'}
 await assert.rejects(host.service.appendTaskContext(request),/fixture cancel failed/)
 await host.service.appendTaskContext(request);await host.service.whenIdle()
 const after=await host.query('task.get',{taskId:task.taskId})
 assert.equal(after.requirementRevision,2);assert.equal(after.sessionId,task.sessionId);assert.equal(after.drained,true);assert.equal(runs,2)
 assert.equal((await host.query('source.list')).filter(source=>source.text===request.context).length,1)
 assert.equal((await host.query('task.list')).length,1);assert.deepEqual(host.residentStore.listTopics('native-group'),[])
}))

testRunner('Web material failure recovers once and retries the same request without repeating work', { ...({ timeout: 30000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'web-material-recovery-'))
  let host, store, target, runs = 0, injected = false, restarting = false
  const sessions = {
    async run({ submit }) { runs++; await submit({ action: 'wait', summary: '等待输入', evidence: [], limitations: [] }); return { status: 'submitted' } },
    async cancel() {}, async close() {},
  }
  t.after(async () => { await host?.close(); await store?.close(); await rm(root, { recursive: true, force: true }) })
  const options = { serviceFactory: async args => {
    store = await openDynamicTaskStore({ dbPath: args.config.dbPath, instanceId: args.config.instanceId, initialize: !restarting, webActorId: args.config.webActorId })
    const proxy = { ...store, async command(request) {
      const result = await store.command(request)
      if (request.kind === 'task.revise' && !injected) {
        injected = true
        const task = result.result.task, sourceId = task.sourceRefs.at(-1)
        const directories = await taskDirectories(args.ctx.runtimePaths.workspaces, task.taskId, { create: true })
        const digest = createHash('sha256').update(JSON.stringify(sourceId)).digest('hex').slice(0, 32)
        target = join(directories.materials, `source-${digest}.json`)
        await mkdir(target)
      }
      return result
    } }
    return openTaskSessionService({ ...args, store: proxy, taskSessions: sessions })
  } }
  await t.beginBusiness()
  host = await t.step(async () => nativeTaskHost(root, async () => { throw new Error('Unexpected native model call') }, options))
  const task = await t.step(async () => host.service.createTask({ groupId: 'native-group', requestId: 'material-create', title: '材料检查', objective: '检查材料' }))
  await t.step(async () => host.service.whenIdle())
  const before = await t.step(async () => host.query('task.get', { taskId: task.taskId }))
  const request = { taskId: task.taskId, requestId: 'material-revision', progressImpact: 'replan', expectedRequirementRevision: before.requirementRevision,
    expectedControlRevision: before.controlRevision, context: '更新检查要求' }
  await t.step(async () => assert.rejects(host.service.appendTaskContext(request), /TASK_MATERIAL_PATH_INVALID/))
  await t.step(async () => host.service.whenIdle())
  const revised = await t.step(async () => host.query('task.get', { taskId: task.taskId }))
  assert.equal(revised.requirementRevision, before.requirementRevision + 1)
  assert.equal(runs, 1)
  const failedSource = (await t.step(async () => host.query('source.list'))).find(source => source.text === request.context)
  assert.equal(failedSource.requestIdentity.request.requestId,request.requestId)
  const frozenIdentity=structuredClone(failedSource.requestIdentity)
  await t.step(async () => host.close()); await t.step(async () => store.close()); host = undefined; store = undefined
  await t.step(async () => rmdir(target))
  restarting = true
  host = await t.step(async () => nativeTaskHost(root, async () => { throw new Error('Unexpected native model call') }, options))
  const reordered = { context: request.context, expectedControlRevision: request.expectedControlRevision, expectedRequirementRevision: request.expectedRequirementRevision,
    progressImpact: request.progressImpact, requestId: request.requestId, taskId: request.taskId }
  assert.equal((await t.step(async () => host.service.appendTaskContext(reordered))).taskId, task.taskId)
  await t.step(async () => host.service.recover()); await t.step(async () => host.service.whenIdle())
  assert.equal(JSON.parse(await t.step(async () => readFile(target, 'utf8'))).taskId, task.taskId)
  assert.equal(runs, 2)
  assert.equal((await t.step(async () => host.service.appendTaskContext(reordered))).taskId, task.taskId)
  assert.deepEqual((await host.query('source.get',{sourceId:failedSource.sourceId})).requestIdentity,frozenIdentity)
  assert.equal((await host.query('source.list')).filter(row=>row.messageId==='web:'+request.requestId).length,1)
  await t.step(async () => assert.rejects(host.service.appendTaskContext({ ...reordered, context: '不同内容' }), { code: 'DYNAMIC_COMMAND_ID_CONFLICT' }))
  await t.step(async () => host.service.whenIdle())
  assert.equal((await t.step(async () => host.query('task.get', { taskId: task.taskId }))).requirementRevision, revised.requirementRevision)
  assert.equal(runs, 2)
}))

testRunner('Web replan blocks a new execution session while old-generation cancellation is in flight', { ...({ timeout: 30000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const releaseQuery = Promise.withResolvers(), releaseNew = Promise.withResolvers()
t.onCancel(() => releaseNew.resolve())

t.onCancel(() => releaseQuery.resolve())

  let host, store, intercept = false, blocked = false, runs = 0, accepted = false, started = false
  const cancellations = []
  const sessions = {
    async run({ submit }) {
      runs++
      if (runs === 1) {
        await submit({ action: 'wait', summary: '等待输入', evidence: [], limitations: [] })
        return { status: 'submitted' }
      }
      started = true
      await releaseNew.promise
      await submit({ action: 'wait', summary: '等待补充', evidence: [], limitations: [] })
      return { status: 'submitted' }
    },
    async cancel(taskId) { cancellations.push({ taskId, runs }) },
    async close() { releaseNew.resolve() },
  }
  const root = await mkdtemp(join(tmpdir(), 'web-replan-query-gate-'))
  t.after(async () => { releaseQuery.resolve(); releaseNew.resolve(); await host?.close(); await store?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  host = await t.step(async () => nativeTaskHost(root, async () => { throw new Error('Unexpected native model call') }, {
    serviceFactory: async args => {
      store = await openDynamicTaskStore({ dbPath: args.config.dbPath, instanceId: args.config.instanceId, initialize: true, webActorId: args.config.webActorId })
      const proxy = { ...store,
        async command(request) {
          const result = await store.command(request)
          if (request.kind === 'task.revise') intercept = true
          return result
        },
        async query(request) {
          if (intercept && !blocked && request.kind === 'execution.list' && request.taskId) {
            blocked = true
            await releaseQuery.promise
          }
          return store.query(request)
        },
      }
      return openTaskSessionService({ ...args, store: proxy, taskSessions: sessions })
    },
  }))
  const task = await t.step(async () => host.service.createTask({ groupId: 'native-group', requestId: 'query-gate-create', title: '检查文件', objective: '检查文件' }))
  await t.step(async () => host.service.whenIdle())
  const before = await t.step(async () => host.query('task.get', { taskId: task.taskId }))
  const pending = host.service.appendTaskContext({ taskId: task.taskId, requestId: 'query-gate-replan', progressImpact: 'replan',
    expectedRequirementRevision: before.requirementRevision, expectedControlRevision: before.controlRevision, context: '新增文件名称检查' }).then(value => { accepted = true; return value })
  await t.step(async () => waitUntil(() => blocked, 'execution.list 门闩已进入', 5000))
  await t.step(async () => new Promise(resolve => setImmediate(resolve)))
  assert.equal(runs, 1, '旧代取消边界未完成时不能启动新执行会话')
  assert.equal(accepted, false)
  releaseQuery.resolve()
  await t.step(async () => waitUntil(() => started, '新执行会话 已启动', 5000))
  await t.step(async () => waitUntil(() => accepted, '新执行会话 未结束时接纳应返回', 5000))
  assert.deepEqual(cancellations.map(item => item.runs), [1], '新执行会话 不得被旧代取消')
  assert.equal((await t.step(async () => pending)).taskId, task.taskId)
  releaseNew.resolve()
  await t.step(async () => host.service.whenIdle())
}))

testRunner('Web replan drains the old execution session without waiting for the new execution session', { ...({ timeout: 30000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const oldEntered = Promise.withResolvers(), releaseOld = Promise.withResolvers()
t.onCancel(() => releaseOld.resolve())

  const newEntered = Promise.withResolvers(), releaseNew = Promise.withResolvers()
t.onCancel(() => releaseNew.resolve())

  let turns = 0, accepted = false, newFinished = false
  t.after(() => { releaseOld.resolve(); releaseNew.resolve() })
  const h = await extraHost(t, 'web-replan-owner-gates-', async request => {
    assert.ok(request.tools.some(tool => tool.name === 'task_result'))
    if (++turns === 1) { oldEntered.resolve(); await releaseOld.promise }
    else { newEntered.resolve(); await releaseNew.promise; newFinished = true }
    return [call('task_result', { decision: { action: 'wait', summary: '等待补充', evidence: [], limitations: [] } })]
  })
  await t.beginBusiness()

  const created = await t.step(async () => h.service.createTask({ groupId: 'native-group', requestId: 'gate-create', title: '检查文件', objective: '检查文件并等待补充' }))
  await t.step(async () => oldEntered.promise)
  const original = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  const pending = h.service.appendTaskContext({ taskId: created.taskId, requestId: 'gate-replan', progressImpact: 'replan',
    expectedRequirementRevision: original.requirementRevision, expectedControlRevision: original.controlRevision, context: '补充检查文件名称' }).then(value => { accepted = true; return value })
  await t.step(async () => waitUntil(async () => (await h.query('task.get', { taskId: created.taskId })).requirementRevision > original.requirementRevision, 'replan 已提交', 5000))
  assert.equal(accepted, false, '旧执行会话 尚未排空时不能接纳')
  assert.equal(turns,1,'旧模型 body 尚未释放时不得启动新执行会话')
  releaseOld.resolve()
  await t.step(async () => newEntered.promise)
  await t.step(async () => waitUntil(() => accepted, '新执行会话 尚未结束时接纳应返回', 5000))
  assert.equal(newFinished, false)
  const result = await t.step(async () => pending)
  assert.equal(result.taskId, created.taskId)
  releaseNew.resolve()
  await t.step(async () => h.service.whenIdle())
}))

testRunner('Web edits reject stale requirement and control revisions without changing the task or creating Topics', { ...({ timeout: 30000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const h = await extraHost(t, 'task-topic-web-stale-', async request => {
    assert.ok(request.tools.some(tool => tool.name === 'task_result'))
    return [call('task_result', { decision: { action: 'wait', summary: '等待后续补充', evidence: [], limitations: [] } })]
  })
  await t.beginBusiness()

  const created = await t.step(async () => h.service.createTask({ groupId: 'native-group', requestId: 'web-create', title: 'Web 文件检查', objective: '检查文件并等待补充' }))
  await t.step(async () => h.service.whenIdle())
  const original = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(original.requirementRevision, 1)
  await t.step(async () => h.service.appendTaskContext({ taskId: created.taskId, requestId: 'web-append', progressImpact: 'replan', expectedRequirementRevision: 1, expectedControlRevision: original.controlRevision, context: '新增文件名称检查要求' }))
  await t.step(async () => h.service.whenIdle())
  const revised = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(revised.requirementRevision, 2)
  const topics = h.residentStore.listTopics('native-group')
  assert.equal(topics.length,0,'Web mutations do not create active Topics')
  const topicSnapshot = JSON.stringify(topics)
  await t.step(async () => assert.rejects(h.service.appendTaskContext({ taskId: created.taskId, requestId: 'web-stale-append', progressImpact: 'replan', expectedRequirementRevision: 1, expectedControlRevision: original.controlRevision, context: '这条过期补充必须拒绝' }), { code: 'DYNAMIC_TASK_REVISION_STALE' }))
  await t.step(async () => assert.rejects(h.service.cancelTask({ taskId: created.taskId, requestId: 'web-stale-cancel', expectedRequirementRevision: revised.requirementRevision,
    expectedControlRevision: revised.controlRevision - 1, reason: '过期控制版本必须拒绝' }), { code: 'DYNAMIC_TASK_REVISION_STALE' }))
  const unchanged = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(unchanged.requirementRevision, revised.requirementRevision)
  assert.equal(unchanged.controlRevision, revised.controlRevision)
  assert.equal(unchanged.control, revised.control)
  assert.equal(unchanged.request, revised.request)
  assert.equal(JSON.stringify(h.residentStore.listTopics('native-group')), topicSnapshot)
  assert.equal((await t.step(async () => h.query('task.list'))).length, 1)
}))

testRunner('native Web reopen preserves task identity and rejects stale input; HTTP retry is idempotent', { ...({ timeout: 30000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  await t.beginBusiness()
  const { createServer } = await t.step(async () => import('node:http'))
  const { handleRequest } = await t.step(async () => import('../packages/dingtalk-core/http.js'))
  const h = await t.step(async () => extraHost(t, 'web-reopen-', async () => [call('task_result', { decision: { action: 'complete', summary: '原事项已核对', evidence: ['fixture'], limitations: [] } })]))
  const created = await t.step(async () => h.service.createTask({ requestId: 'original', groupId: 'native-group', title: '原PR', objective: '核对原PR', acceptanceCriteria: ['核对完成'] }))
  await t.step(async () => h.service.whenIdle())
  const original = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(original.status, 'completed')
  const runtime = { isTaskSessionMode: () => true, getTaskSessionDetail: id => h.service.taskDetail(id), reopenTask: args => h.service.reopenTask(args) }
  const server = createServer((req, res) => handleRequest(req, res, runtime))
  await t.step(async () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/tasks/${original.taskId}/reopen`
  const args = { requestId: 'review-followup', context: '只处理新增审查，保留原提测证据', expectedRequirementRevision: original.requirementRevision, expectedControlRevision: original.controlRevision }
  const post = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await t.step(async () => post({ ...args, actorId: 'other' }))).status, 400)
  assert.equal((await t.step(async () => post({ ...args, requestId:'review-stale', expectedControlRevision: original.controlRevision + 1 }))).status, 409)
  assert.equal((await t.step(async () => post(args))).status, 200)
  await t.step(async () => h.service.whenIdle())
  assert.equal((await t.step(async () => post(args))).status, 200)
  await t.step(async () => h.service.whenIdle())
  const reopened = await t.step(async () => h.query('task.get', { taskId: original.taskId }))
  assert.equal(reopened.runSequence, original.runSequence + 1)
  assert.equal(reopened.sessionId, original.sessionId)
  assert.equal((await t.step(async () => h.query('task.list'))).length, 1)
  assert.equal(reopened.sourceRefs.length, original.sourceRefs.length + 1)
  assert.equal(h.residentStore.listTopics('native-group').length, 0)
}))
