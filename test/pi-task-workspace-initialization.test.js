import test, {mock, after} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync} from 'node:fs'
import {mkdtemp, readdir, rm, writeFile, readFile} from 'node:fs/promises'
import {setImmediate as turn} from 'node:timers/promises'
import {tmpdir} from 'node:os'
import {basename, dirname, join} from 'node:path'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

// 独立文件隔离模块 mock；保留真实 SDK/服务/SQLite，禁止加载 Native FFI。
const contracts = await import('../src/process/contracts.js')
const require = createRequire(import.meta.url)
mock.module(new URL('../src/process/contracts.js', import.meta.url), {cache:true, namedExports:{...contracts,
  createLazyRequire(specifier, parent) {
    if (specifier === 'koffi') return () => { throw Error('Native FFI is forbidden in workspace contract tests') }
    return contracts.createLazyRequire(specifier, parent)
  },
}})
const acl = await import('../src/process/windows-acl.js')
assert.equal(Object.keys(require.cache).some(path => path.endsWith('koffi.node')), false)
let active
mock.module(new URL('../src/process/windows-acl.js', import.meta.url), {cache:true, namedExports:{...acl,
  createPrivateTaskWorkDirectories(paths) {
    assert.ok(active, 'Directory boundary must belong to this isolated case')
    const taskId = basename(dirname(paths.work))
    const begin = active.commands.findLast(row => row.command.kind === 'task.workspace.begin' && row.command.args.taskId === taskId)
    assert.ok(begin?.receipt, 'The real begin transaction must commit before directory creation')
    assert.equal(begin.receipt.result.task.workspaceInitialization.state, 'initializing')
    active.calls.push({taskId, paths})
    return active.create(paths, taskId)
  },
}})
// SQLite 的公开端口被冻结；仅包装测试实例的方法边界，所有事务仍交原 store。
const dynamic = await import('../packages/dingtalk-core/dynamic-task-store.js')
mock.module(new URL('../packages/dingtalk-core/dynamic-task-store.js', import.meta.url), {cache:true, namedExports:{...dynamic,
  async openDynamicTaskStore(...args) {
    const store = await dynamic.openDynamicTaskStore(...args)
    return Object.defineProperties(Object.create(store), {
      command:{value:store.command, configurable:true, writable:true},
      close:{value:store.close, configurable:true, writable:true},
    })
  },
}})
const {providerHost, result, latestInput} = await import('./fixtures/provider-official-host.js')
const {taskDirectories} = await import('../packages/dingtalk-core/session-workspaces.js')
const {TaskArchives, backupTask, restoreTask, adoptTaskArchive} = await import('../src/tasks/archive.js')
after(() => assert.equal(Object.keys(require.cache).some(path => path.endsWith('koffi.node')), false))
const {registerTaskSession} = await import('../src/tasks/session-routes.js')

const windows = {skip:process.platform !== 'win32', timeout:nativeTestTimeout(20000)}
const resources = {handles:{acquired:0, closed:0, retained:0}, local:{acquired:0, closed:0, retained:0}}
function createDirectories({work, tmp}) {
  mkdirSync(dirname(work)); mkdirSync(work); mkdirSync(tmp)
  return {mocked:true, nativeResources:structuredClone(resources)}
}
function containsError(error, expected) {
  return error === expected || error?.errors?.some(child => containsError(child, expected)) === true
}
const contexts = new WeakMap()
async function fixture(t, {root, initialize=true, create=createDirectories, finishError, route, beginGate, closeError}={}) {
  let context = contexts.get(t)
  if (!context) {
    context = {hosts:[], roots:[]}; contexts.set(t, context)
    t.after(async () => {
      const errors=[]
      for (const host of context.hosts.toReversed()) try { await host.close() } catch (error) { errors.push(error) }
      if (errors.length) throw new AggregateError(errors, 'Workspace contract Host cleanup failed')
      for (const path of context.roots) await rm(path, {recursive:true, force:true})
    })
  }
  const owned = !root
  root ??= await mkdtemp(join(tmpdir(), 'night-workspace-contract-'))
  const state = {commands:[], calls:[], create}
  active = state
  if (owned) context.roots.push(root)
  const h = await providerHost(t, {root, initialize, route, config:{dbPath:join(root,'data/state/tasks.sqlite')}, decide:async (request, host) => {
    const task = await host.query('task.get', {taskId:latestInput(request).task.taskId})
    assert.equal(task.workspaceInitialization.state, 'ready')
    return [result('wait', 'Retain this isolated workspace contract result')]
  }})
  context.hosts.push(h)
  const original = h.service.store.command.bind(h.service.store)
  t.mock.method(h.service.store, 'command', async command => {
    const row = {command}; state.commands.push(row)
    if (command.kind === 'task.workspace.finish' && finishError) { row.error=finishError; throw finishError }
    try {
      row.receipt = await original(command)
      if (command.kind === 'task.workspace.begin' && beginGate) {
        beginGate.started.resolve(row.receipt)
        await beginGate.release.promise
      }
      return row.receipt
    } catch (error) { row.error=error; throw error }
  })
  if (closeError) {
    const close = h.close
    let closing
    h.close = () => closing ??= assert.rejects(close(), error => containsError(error, closeError))
  }
  return Object.assign(h, {commands:state.commands, calls:state.calls})
}
const createArgs = requestId => ({requestId, objective:'Verify Host workspace initialization without native execution'})
async function onlyTask(h) {
  const tasks = await h.query('task.list'); assert.equal(tasks.length, 1)
  return tasks[0]
}
async function assertHidden(h, task) {
  assert.equal((await h.service.boardTasks()).find(row => row.taskId === task.taskId).session.workspaceDir, null)
  const page = await h.service.boardTasks({limit:20})
  assert.equal(page.items.find(row => row.taskId === task.taskId).session.workspaceDir, null)
  await assert.rejects(h.service.store.command({id:'claim:'+task.taskId, kind:'task.claim', args:{taskId:task.taskId}}), /WORKSPACE_NOT_READY/)
  await assert.rejects(taskDirectories(h.ctx.runtimePaths.workspaces, task.taskId, {task}), /WORKSPACE_NOT_READY/)
  const archives = new TaskArchives({paths:h.ctx.runtimePaths, store:h.service.store, routes:h.ctx.get('taskSessionRoutes')})
  await assert.rejects(archives.register(task), /WORKSPACE_NOT_READY/)
  await assert.rejects(registerTaskSession(h.ctx.runtimePaths, h.ctx.get('taskSessionRoutes'), task), /WORKSPACE_NOT_READY/)
}

test('Windows workspace initialization: Web concurrency, current ready projection and cold replay preserve one initialization and existing work', windows, async t => {
  const h = await fixture(t), args = createArgs('web-once')
  const [first, duplicate] = await Promise.all([h.service.createTask(args), h.service.createTask(args)])
  await h.service.whenIdle()
  assert.equal(first.taskId, duplicate.taskId); assert.equal(h.calls.length, 1)
  assert.equal((await onlyTask(h)).workspaceInitialization.state, 'ready')
  assert.equal(h.commands.filter(row => row.command.kind === 'task.workspace.begin').length, 1)
  assert.equal(h.commands.filter(row => row.command.kind === 'task.workspace.finish').length, 1)
  const creation = h.commands.find(row => row.command.kind === 'task.create')
  assert.equal(creation.receipt.result.task.workspaceInitialization.state, 'pending')
  assert.equal(duplicate.workspaceInitialization.state, 'ready')
  const root = first.session.workspaceDir
  const directories = (await readdir(root, {withFileTypes:true})).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.deepEqual(directories, ['materials', 'outputs', 'reviews', 'sessions', 'tmp', 'work'])
  await writeFile(join(root, 'work', 'retained.txt'), 'original completed filesystem effect')
  await h.close()
  const cold = await fixture(t, {root:h.root, initialize:false, create() { assert.fail('Cold recovery cannot create native directories') }})
  await cold.service.recover(); await cold.service.whenIdle()
  const replay = await cold.service.createTask(args); await cold.service.whenIdle()
  assert.equal(replay.taskId, first.taskId); assert.equal(cold.calls.length, 0)
  assert.equal(replay.session.workspaceDir, root)
  assert.equal(await readFile(join(root, 'work', 'retained.txt'), 'utf8'), 'original completed filesystem effect')
  assert.equal((await onlyTask(cold)).workspaceInitialization.state, 'ready')
})

test('Windows workspace initialization: partial failure stays hidden and idle across replay and restart without acknowledging its wake', windows, async t => {
  const nativeError = Object.assign(new Error('Scripted partial native creation'), {code:'TASK_WORKSPACE_NATIVE_UNVERIFIED', nativeResources:structuredClone(resources)})
  const h = await fixture(t, {create(paths) { mkdirSync(dirname(paths.work)); throw nativeError }}), args = createArgs('web-partial')
  await assert.rejects(h.service.createTask(args), {code:'TASK_WORKSPACE_NOT_READY'})
  await h.service.whenIdle()
  const task = await onlyTask(h); assert.equal(task.workspaceInitialization.state, 'failed')
  assert.deepEqual(task.workspaceInitialization.nativeResources, nativeError.nativeResources)
  await assertHidden(h, task)
  const wakes = await h.query('wake.list', {taskId:task.taskId}); assert.ok(wakes.length)
  await assert.rejects(h.service.createTask(args), {code:'TASK_WORKSPACE_NOT_READY'})
  const health = await h.service.recover(); await h.service.whenIdle()
  assert.equal(h.calls.length, 1); assert.equal(h.taskRequests().length, 0)
  assert.deepEqual(await h.query('wake.list', {taskId:task.taskId}), wakes)
  assert.equal(health.failures.find(row => row.id === task.taskId).cause, nativeError)
  await h.close()
  const cold = await fixture(t, {root:h.root, initialize:false, create() { assert.fail('Failed initialization cannot be retried on restart') }})
  await cold.service.recover(); await cold.service.whenIdle()
  await assert.rejects(cold.service.createTask(args), {code:'TASK_WORKSPACE_NOT_READY'})
  await cold.service.whenIdle(); assert.equal(cold.calls.length, 0); assert.equal(cold.taskRequests().length, 0)
  await assertHidden(cold, await onlyTask(cold))
  assert.deepEqual(await cold.query('wake.list', {taskId:task.taskId}), wakes)
})

test('Windows workspace initialization: native failure plus finish failure retains original errors and ownership with no second attempt', windows, async t => {
  const ownership = {handles:[{handle:101n, attempted:true, closed:false}], allocations:[]}
  const nativeError = Object.assign(new Error('Native closure remains unknown'), {code:'TASK_WORKSPACE_NATIVE_UNVERIFIED', nativeResources:{handles:{acquired:1, closed:0, retained:1}, local:{acquired:0, closed:0, retained:0}}})
  Object.defineProperty(nativeError, 'nativeOwnership', {value:ownership})
  const commitError = Object.assign(new Error('Scripted finish commit failure'), {code:'TEST_COMMIT_UNCERTAIN'})
  const h = await fixture(t, {create() { throw nativeError }, finishError:commitError, closeError:nativeError}), args = createArgs('finish-unknown')
  await assert.rejects(h.service.createTask(args), {code:'TASK_WORKSPACE_NOT_READY'})
  await h.service.whenIdle(); const task = await onlyTask(h)
  assert.equal(task.workspaceInitialization.state, 'initializing'); await assertHidden(h, task)
  const health = await h.service.recover(); await h.service.whenIdle()
  const diagnostic = health.failures.find(row => row.id === task.taskId)
  assert.equal(diagnostic.code, 'TASK_WORKSPACE_INITIALIZATION_COMMIT_UNCERTAIN')
  assert.deepEqual(diagnostic.nativeResources, nativeError.nativeResources)
  assert.equal(Object.getOwnPropertyDescriptor(diagnostic, 'cause').enumerable, false)
  assert.deepEqual(diagnostic.cause.errors, [nativeError, commitError])
  assert.equal(diagnostic.cause.errors[0].nativeOwnership, ownership)
  await assert.rejects(h.service.createTask(args), {code:'TASK_WORKSPACE_NOT_READY'})
  await h.service.whenIdle(); assert.equal(h.calls.length, 1)
  assert.equal(h.commands.filter(row => row.command.kind === 'task.workspace.finish').length, 1)
  assert.equal(h.taskRequests().length, 0)
})

test('Windows workspace initialization: request fresh and ready fields cannot authorize initialization, claim, archive or ensure', windows, async t => {
  const h = await fixture(t)
  const receipt = await h.service.store.command({id:'untrusted-create', kind:'task.create', args:{taskId:'untrusted-ready', request:'Request fields are not Host authority', fresh:true, workspaceInitialization:{state:'ready'}, metadata:{fresh:true, workspaceInitialization:{state:'ready'}}}})
  const task = receipt.result.task
  assert.deepEqual(task.workspaceInitialization, {state:'pending', creationCommandId:'untrusted-create', sessionId:task.sessionId})
  await assertHidden(h, task)
  await h.service.recover(); await h.service.whenIdle()
  assert.equal(h.calls.length, 0); assert.equal(h.taskRequests().length, 0)
  assert.equal((await onlyTask(h)).workspaceInitialization.state, 'pending')
})

function routerRoute({rollback=false}={}) {
  let attempts=0, plan
  return request => {
    if (!request.tools.some(tool => tool.name === 'resident_router_settle')) return undefined
    const input=latestInput(request), source=input.events.find(event => event.source)?.source
    if (source && attempts < 2) {
      attempts++
      plan ??= {operationId:'workspace-router-operation', sourceId:source.sourceId, messageVersion:source.version,
        tasks:[{taskId:'router-work-a', title:'First task', objective:'Retain the initialized first task', requirements:[]}, {taskId:'router-work-b', title:'Second task', objective:'Do not replay failed initialization', requirements:[]}],
        dependencies:rollback ? [{taskId:'router-work-a', prerequisiteTaskId:'router-work-a', condition:'invalid self dependency'}] : []}
      return [{name:'resident_task_plan', args:plan}]
    }
    const settled=request.messages.some(message => message.role === 'toolResult' && message.toolName === 'resident_router_settle' && !message.isError)
    return settled ? [] : [{name:'resident_router_settle', args:{operationId:'workspace-router-settle', eventIds:input.events.map(event => event.id)}}]
  }
}
const message = {groupId:'native-group', messageId:'workspace-original-request', senderOpenDingTalkId:'native-user', senderName:'Requester', occurredAt:new Date().toISOString(), text:'测试助手，请安排两个事项并保留独立初始化状态。'}

test('Windows workspace initialization: real Router batch and inner operation replay under a new outer receipt preserve per-task outcomes', windows, async t => {
  const h = await fixture(t, {route:routerRoute(), create(paths, taskId) { if (taskId === 'router-work-b') throw Object.assign(new Error('Second task creation failed'), {code:'TASK_WORKSPACE_NATIVE_UNVERIFIED'}); return createDirectories(paths) }})
  await h.service.ingest(message); await h.service.whenIdle()
  const plans = h.commands.filter(row => row.command.kind === 'router.plan' && row.receipt)
  assert.equal(plans.length, 2); assert.notEqual(plans[0].command.id, plans[1].command.id)
  assert.ok(plans.every(row => row.receipt.replayed === false))
  assert.deepEqual(plans[1].receipt.result.tasks, plans[0].receipt.result.tasks)
  assert.deepEqual(h.calls.map(row => row.taskId), ['router-work-a', 'router-work-b'])
  const a = await h.query('task.get', {taskId:'router-work-a'}), b = await h.query('task.get', {taskId:'router-work-b'})
  assert.equal(a.workspaceInitialization.state, 'ready'); assert.equal(b.workspaceInitialization.state, 'failed')
  assert.equal(a.workspaceInitialization.creationCommandId, plans[0].command.id+':router-work-a')
  assert.ok(h.taskRequests().length); await assertHidden(h, b)
  const wakes = await h.query('wake.list', {taskId:b.taskId}); assert.ok(wakes.length)
  await h.service.recover(); await h.service.whenIdle()
  assert.equal(h.calls.length, 2); assert.deepEqual(await h.query('wake.list', {taskId:b.taskId}), wakes)
})

test('Windows workspace initialization: invalid real Router plans roll back before native directory creation', windows, async t => {
  const h = await fixture(t, {route:routerRoute({rollback:true})})
  await h.service.ingest(message); await h.service.whenIdle()
  const attempts = h.commands.filter(row => row.command.kind === 'router.plan')
  assert.equal(attempts.length, 2); assert.ok(attempts.every(row => row.error))
  assert.deepEqual(await h.query('task.list'), []); assert.equal(h.calls.length, 0)
  assert.equal(h.taskRequests().length, 0)
  const results = h.toolResults.filter(row => row.name === 'resident_task_plan')
  assert.equal(results.length, 2); assert.ok(results.every(row => row.result.isError))
})

test('Windows workspace initialization: idle and close await accepted initialization and same-task replay, then reject new admissions', windows, async t => {
  const gate = {started:Promise.withResolvers(), release:Promise.withResolvers()}
  t.after(() => gate.release.resolve())
  const h = await fixture(t, {beginGate:gate}), args = createArgs('admission-drain')
  const first = h.service.createTask(args), duplicate = h.service.createTask(args)
  await gate.started.promise
  let idleReturned=false, closeReturned=false, storeCloses=0
  const originalClose = h.service.store.close.bind(h.service.store)
  t.mock.method(h.service.store, 'close', async () => { storeCloses++; return originalClose() })
  const idle = h.service.whenIdle().then(() => { idleReturned=true })
  const closing = h.service.close().then(() => { closeReturned=true })
  try {
    await turn(); await turn()
    assert.equal(idleReturned, false); assert.equal(closeReturned, false); assert.equal(storeCloses, 0)
    assert.equal(h.calls.length, 0)
    assert.equal((await onlyTask(h)).workspaceInitialization.state, 'initializing')
  } finally { gate.release.resolve() }
  const [created, replay] = await Promise.all([first, duplicate, idle, closing])
  assert.equal(created.taskId, replay.taskId); assert.equal(h.calls.length, 1)
  assert.equal(storeCloses, 1)
  assert.equal(h.commands.filter(row => row.command.kind === 'task.workspace.finish').length, 1)
  await assert.rejects(h.service.createTask(createArgs('after-close')), {code:'TASK_SESSION_CLOSED'})
  assert.equal(h.calls.length, 1)
})


test('Windows workspace initialization: sealed restore and adopt preserve ready identity and held review without another native creation', windows, async t => {
  const h = await fixture(t), created = await h.service.createTask(createArgs('restore-workspace'))
  await h.service.whenIdle()
  const original = await onlyTask(h)
  await writeFile(join(created.session.workspaceDir,'work','proof.txt'), 'retained task-local work')
  await h.close()
  const config = {installRoot:h.root, dataDir:'data', resident:{taskSessions:{instanceId:'native-test', initialize:false}}}
  const backup = join(h.root,'backups','workspace-contract')
  await backupTask(config,original.taskId,backup)
  const root = await mkdtemp(join(tmpdir(),'night-workspace-contract-restore-'))
  contexts.get(t).roots.push(root)
  const next = {...config, installRoot:root, resident:{taskSessions:{instanceId:'native-test', initialize:true}}}
  const restored = await restoreTask(next,backup)
  assert.equal(restored.paused,true); assert.equal(restored.reviewRequired,true)
  const adopted = await adoptTaskArchive(next,original.taskId)
  assert.equal(adopted.ok,true); assert.equal(h.calls.length,1)
  const cold = await fixture(t,{root,initialize:false,create(){assert.fail('Restore and adopt cannot initialize existing task directories')}})
  await cold.service.recover(); await cold.service.whenIdle()
  const task = await onlyTask(cold)
  assert.deepEqual(task.workspaceInitialization,original.workspaceInitialization)
  assert.equal(task.control,'paused'); assert.equal(task.archiveRestore.reviewRequired,true)
  await assert.rejects(cold.service.store.command({id:'unreviewed-restored-claim',kind:'task.claim',args:{taskId:task.taskId}}),/RESTORE_REVIEW_REQUIRED/)
  assert.equal(cold.calls.length,0); assert.equal(cold.taskRequests().length,0)
  assert.equal(await readFile(join(root,'data/workspaces/tasks',task.taskId,'work/proof.txt'),'utf8'),'retained task-local work')
})
