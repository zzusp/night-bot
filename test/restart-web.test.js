import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve, sep } from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { handleRequest } from '../packages/dingtalk-core/http.js'
import { openDynamicTaskStore } from '../packages/dingtalk-core/dynamic-task-store.js'
import { DatabaseSync } from 'node:sqlite'

test('当前HTTP看板请求真实分页，health正常不掩盖分页503', async t => {
  let missing = false
  const calls = [], page = total => ({ items: [], total, offset: 0, limit: 1, revision: 'fixture' })
  const read = (kind, options) => {
    calls.push({ kind, options })
    if (missing) throw Object.assign(new Error('OBSERVER_PAGINATION_MIGRATION_REQUIRED'), { code: 'OBSERVER_PAGINATION_MIGRATION_REQUIRED' })
    return page(kind === 'tasks' ? 3 : 2)
  }
  const runtime = { listRecoveryIssues: () => [], getDwsBridgeHealth: () => ({ healthy: true }),
    listTaskView: options => read('tasks', options), listAuthorizationRequests: options => read('authorizations', options) }
  const server = createServer((request, response) => handleRequest(request, response, runtime, { transport: 'dws' }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const health = await fetch(base + '/health'); assert.equal(health.status, 200); assert.equal((await health.json()).inboundProcessing, true)
  const tasks = await fetch(base + '/state/tasks?offset=0&limit=1')
  const authorizations = await fetch(base + '/state/authorizations?offset=0&limit=1&filter=pending')
  assert.equal(tasks.status, 200); assert.deepEqual(await tasks.json(), page(3))
  assert.equal(authorizations.status, 200); assert.deepEqual(await authorizations.json(), page(2))
  assert.deepEqual(calls, [
    { kind: 'tasks', options: { offset: 0, limit: 1, state: undefined, archived: false, groupId: undefined, topicId: undefined, revision: undefined } },
    { kind: 'authorizations', options: { offset: 0, limit: 1, filter: 'pending', revision: undefined } },
  ])
  missing = true
  for (const path of ['/state/tasks?offset=0&limit=1', '/state/authorizations?offset=0&limit=1&filter=pending']) {
    assert.equal((await fetch(base + '/health')).status, 200)
    const response = await fetch(base + path)
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'OBSERVER_PAGINATION_MIGRATION_REQUIRED' })
  }
})

test('原生Node冷加载保持ESM、CJS、动态导入及worker导出', async t => {
  await mkdir(resolve('docs/tmp'), { recursive: true })
  const directory = await mkdtemp(resolve('docs/tmp/web-loader-'))
  assert.equal(directory.startsWith(resolve('docs/tmp') + sep), true)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const esm = pathToFileURL(resolve(directory, 'esm.mjs')).href
  const cjs = pathToFileURL(resolve(directory, 'cjs.cjs')).href
  await writeFile(resolve(directory, 'esm.mjs'), 'export const value=7; export default value;')
  await writeFile(resolve(directory, 'cjs.cjs'), 'exports.value=11;')
  const program = resolve(directory, 'run.mjs')
  await writeFile(program, `
import { Worker } from 'node:worker_threads';
const esm=await import(${JSON.stringify(esm)}), cjs=await import(${JSON.stringify(cjs)});
const dynamic=await import(${JSON.stringify(esm)});
const worker=new Worker("const {parentPort,workerData}=require('node:worker_threads');import(workerData).then(m=>parentPort.postMessage(m.value))",{eval:true,workerData:${JSON.stringify(esm)}});
const value=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
console.log(JSON.stringify({esm:esm.value,cjs:cjs.value,same:esm===dynamic,worker:value}));
`)
  const normal = spawnSync(process.execPath, [program], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(normal.status, 0, normal.stderr)
  assert.deepEqual(JSON.parse(normal.stdout), { esm: 7, cjs: 11, same: true, worker: 7 })
})

test('正式账本冷启动拒绝活owner及marker错配，原starting效果保身份进入unknown', async t => {
  const directory = await mkdtemp(resolve('docs/tmp/startup-ledger-'))
  const config = { dbPath: resolve(directory, 'dynamic.sqlite'), instanceId: 'startup', initialize: true }
  let store = await openDynamicTaskStore(config), child
  t.after(async () => { await store?.close(); if (child?.connected) child.send('close'); if (child && child.exitCode === null) await new Promise(resolve => child.once('exit', resolve)); await rm(directory, { recursive: true, force: true }) })
  let sequence = 0
  const command = (kind, args) => store.command({ id: 'startup-' + ++sequence, kind, args })
  await command('task.create', { taskId: 'retained', request: '保留原任务和原效果' })
  await store.close(); store = null
  const markerPath = config.dbPath + '.initialized', marker = JSON.parse(await readFile(markerPath, 'utf8'))
  const rows = () => {
    const db = new DatabaseSync(config.dbPath, { readOnly: true })
    try { return Object.fromEntries(['tasks', 'executions', 'operations'].map(table => [table, db.prepare(`SELECT * FROM dynamic_${table} ORDER BY rowid`).all()])) }
    finally { db.close() }
  }
  const moduleUrl = new URL('../packages/dingtalk-core/dynamic-task-store.js', import.meta.url).href
  const program = `const {openDynamicTaskStore}=await import(${JSON.stringify(moduleUrl)});const store=await openDynamicTaskStore(${JSON.stringify({ ...config, initialize: false })});process.on('message',async message=>{if(message==='close'){await store.close();process.disconnect()}});process.send('ready')`
  child = spawn(process.execPath, ['--input-type=module', '-e', program], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; child.stderr.on('data', value => { stderr += value })
  await new Promise((resolve, reject) => { child.once('message', message => message === 'ready' ? resolve() : reject(new Error('Unexpected owner ready message'))); child.once('error', reject); child.once('exit', code => reject(new Error(`Owner exited before ready ${code}: ${stderr}`))) })
  let before = rows()
  await assert.rejects(openDynamicTaskStore({ ...config, initialize: false }), { code: 'DYNAMIC_STORE_ALREADY_OPEN' })
  assert.deepEqual(rows(), before)
  const exited = new Promise(resolve => child.once('exit', resolve)); child.send('close'); assert.equal(await exited, 0, stderr)
  for (const [change, code] of [[{ initToken: 'different' }, 'DYNAMIC_INITIALIZATION_MARKER_MISMATCH'], [{ instanceId: 'different' }, 'DYNAMIC_INITIALIZATION_MARKER_INVALID']]) {
    await writeFile(markerPath, JSON.stringify({ ...marker, ...change }))
    before = rows(); await assert.rejects(openDynamicTaskStore({ ...config, initialize: false }), { code }); assert.deepEqual(rows(), before)
  }
  await writeFile(markerPath, JSON.stringify(marker))
  store = await openDynamicTaskStore({ ...config, initialize: false })
  const task = (await command('task.claim', { taskId: 'retained' })).result
  const dispatched = (await command('execution.dispatch', { binding: task.binding, key: 'original', prompt: '仅隔离账本测试', input: { objective: '保留身份' } })).result.execution
  const binding = (await command('execution.claim', { executionId: dispatched.executionId })).result.binding
  const operation = (await command('operation.prepare', { binding, key: 'original-effect', definition: { toolName: 'fixture-only' }, resourceKeys: [] })).result.operation
  await command('operation.start', { binding, operationId: operation.operationId })
  const original = await store.query({ kind: 'operation.get', operationId: operation.operationId })
  assert.equal(original.state, 'starting')
  await store.close(); store = await openDynamicTaskStore({ ...config, initialize: false })
  const recovered = await store.query({ kind: 'operation.get', operationId: operation.operationId })
  assert.equal(recovered.state, 'unknown'); assert.equal(recovered.recoveryReason, 'host_restart')
  for (const field of ['operationId', 'executionId', 'taskId', 'key', 'definition']) assert.deepEqual(recovered[field], original[field])
  assert.equal((await store.query({ kind: 'task.get', taskId: 'retained' })).request, '保留原任务和原效果')
  assert.equal((await store.query({ kind: 'execution.list', taskId: 'retained' })).length, 1)
  assert.equal((await store.query({ kind: 'operation.list', taskId: 'retained' })).length, 1)
})
