import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {openDynamicTaskStore} from '../../../packages/dingtalk-core/dynamic-task-store.js'
import {memoryScope} from '../../../src/memory/scope.js'
import {memoryHost} from '../../../test/fixtures/memory-host.js'
import {nativeTestTimeout} from '../../../test/fixtures/native-lifecycle.js'
import {apply as applyApplication, inject} from '../../../src/application.js'
import {createWebConsole} from '../server/plugin.js'

test('task session API reads actual committed Pi source, todos and tool records without changing history', {timeout: nativeTestTimeout(30000)}, async t => {
  let taskTurns = 0
  const f = await memoryHost(t, body => {
    if (JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')) return {text: '{"lessons":[]}'}
    if (body.tools?.some(tool => tool.function.name === 'task_result') && taskTurns++ === 0) return {tool: 'todo_write', args: {todos: [
      {content: '核对 /fixture/materials/report.txt', status: 'completed'},
      {content: '保留模型实际提交状态', status: 'in_progress'},
    ]}}
    if (body.tools?.some(tool => tool.function.name === 'task_result')) return {tool: 'task_result', args: {decision: {
      action: 'complete', summary: '已验证本次隔离任务的执行记录。', evidence: ['fixture-observation', '/private/fixture-tool-argument'], limitations: [],
    }}}
    return {text: 'Verified isolated fixture'}
  })
  const config = {...f.config, resident: {port: 0, taskSessions: {
    instanceId: 'web-session-records', ownerActorId: 'fixture-owner', webActorId: 'fixture-owner',
    ingressEpoch: '2026-01-01T00:00:00Z', initialize: true, reasoningMode: 'inherit',
  }}}
  let web
  try {
    await f.host.ctx.plugin({inject, apply: ctx => applyApplication(ctx, config)})
    const app = f.host.ctx.get('application')
    web = await createWebConsole({channels: f.host.ctx.channels, paths: f.host.ctx.runtimePaths,
      config: {channelId: 'web-session-records', senderId: 'session-operator', port: 0},
      getApplication: () => app, getSessionPersistence: () => f.host.ctx.sessionPersistence,
    })
    const login = await fetch(web.origin + '/api/login', {method: 'POST', headers: {origin: web.origin, 'content-type': 'application/json'},
      body: JSON.stringify({token: (await readFile(web.credentialPath, 'utf8')).trim()}),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const api = async path => {
      const response = await fetch(web.origin + path, {headers: {origin: web.origin, cookie}})
      return {status: response.status, body: await response.json()}
    }
    const objective = '仅核对 USER_SESSION_MARKER 原始请求，不执行外部操作。apiKey=REDACT_ME；文件 C:\\sensitive\\private.txt'
    const created = await app.tasks.createTask({requestId: 'web-session-proof', title: '执行记录只读验证', objective})
    await app.tasks.whenIdle()
    const task = await app.tasks.taskDetail(created.taskId)
    assert.equal(task.status, 'completed', JSON.stringify(task.result))
    assert.deepEqual(task.blockers, {executions: [], operations: [], legacy: []}, 'the real core keeps its original three-collection contract')
    const detailView = await api('/api/tasks/' + created.taskId)
    assert.equal(detailView.status, 200)
    assert.deepEqual(detailView.body.blockers, [], 'only the Web projection converts the contract to display rows')
    assert.equal(detailView.body.result.summary, '已验证本次隔离任务的执行记录。')
    assert.deepEqual(detailView.body.result.evidence, ['fixture-observation', '/private/fixture-tool-argument'])
    assert.ok(detailView.body.timeline.task.events.some(event => event.kind === 'completed'))
    assert.doesNotMatch(JSON.stringify(detailView.body), /REDACT_ME/)
    assert.equal(task.result.evidence[1], '/private/fixture-tool-argument', 'Web projection leaves the real completion receipt unchanged')
    const persistence = f.host.ctx.sessionPersistence, journal = persistence.path(task.session.sessionId)
    const before = await readFile(journal)
    const snapshot = await persistence.readNative(task.session.sessionId, {requireComplete: true})
    assert.ok(snapshot.entries.some(entry => entry.type === 'message' && entry.message.role === 'assistant'
      && entry.message.content.some(block => block.type === 'toolCall' && block.name === 'task_result')))
    const requestCount = f.requests.length
    const endpoint = '/api/tasks/' + created.taskId + '/session'
    const result = await api(endpoint)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.status, 'ready'); assert.equal(result.body.scope, 'current-session-context')
    assert.equal(result.body.sessionId, task.session.sessionId)
    assert.ok(result.body.items.some(row => row.role === 'user' && row.kind === 'source' && row.text.includes('USER_SESSION_MARKER')), 'actual authorized source must remain visible')
    assert.ok(result.body.items.some(row => row.kind === 'tool-call' && row.toolName === 'task_result'), 'actual Pi tool invocation must be visible')
    assert.ok(result.body.items.some(row => row.kind === 'tool-result' && row.toolName === 'task_result' && row.text.length > 0), 'actual Pi tool receipt must be visible')
    const visible = result.body.items.map(row => row.text).join('\n')
    assert.doesNotMatch(visible, /REDACT_ME|"materials"\s*:|"taskSession"\s*:/)
    assert.ok(visible.includes('/private/fixture-tool-argument'))
    assert.deepEqual(result.body.todos.items.map(row => row.status), ['completed', 'in_progress'])
    assert.equal(result.body.todos.items[0].text, '核对 /fixture/materials/report.txt')
    assert.equal(visible.includes(f.root), false)
    assert.ok(result.body.items.every(row => !Object.hasOwn(row, 'arguments') && !Object.hasOwn(row, 'details')))
    assert.ok(result.body.items.every(row => ['user', 'assistant', 'tool'].includes(row.role)))
    const page = await api(endpoint + '?limit=1')
    assert.equal(page.status, 200); assert.equal(page.body.items.length, 1)
    assert.equal(page.body.total, result.body.total); assert.equal(page.body.revision, result.body.revision)
    assert.equal(page.body.nextOffset, 1)
    const earlier = await api(endpoint + '?offset=1&limit=1&revision=' + page.body.revision)
    assert.equal(earlier.status, 200); assert.notEqual(earlier.body.items[0].id, page.body.items[0].id)
    assert.equal((await api(endpoint + '?revision=stale')).status, 409)
    assert.equal((await api(endpoint + '?sessionId=foreign-session')).status, 400)
    assert.equal((await api(endpoint + '?limit=51')).status, 400)
    assert.deepEqual(await readFile(journal), before, 'session views cannot append, repair or replay the journal')
    assert.equal(f.requests.length, requestCount, 'session views cannot invoke a model')
    await web.close(); web = undefined
    assert.deepEqual(await readFile(journal), before, 'closing the optional view cannot mutate task history')
  } finally {await web?.close()}
})


test('learning HTTP 使用真实复盘落库与当前 memory/skill，正文按 scope/version 授权且读取不触发推理', {timeout: nativeTestTimeout(30000)}, async t => {
  const f = await memoryHost(t, body => {
    if (!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')) return {text: '不应执行其他推理'}
    const input = JSON.parse(body.messages.findLast(row => row.role === 'user').content)
    return {text: JSON.stringify({lessons: [{key: 'check-evidence', summary: '核对真实结果并保留可验证来源',
      why: '该任务的核查步骤可复用', howToApply: '读取当前证据', evidenceIds: [input.eventId],
      skill: {steps: ['读取当前证据', '核对实际终态'], reason: '本任务已有直接证据', applicability: '同类证据核对', evidenceBacked: true}}]})}
  })
  const channels = f.host.ctx.channels, channelId = 'web-learning', senderId = 'reader'
  const owner = channels.identity({type: 'chat', channelId, senderId, conversationId: 'learning-view', messageId: 'learning-view', text: 'learning-view'}).binding.actorId
  const store = await openDynamicTaskStore({dbPath: join(f.host.ctx.runtimePaths.state, 'learning-tasks.sqlite'), instanceId: 'web-learning', initialize: true})
  let web, detach
  try {
    const command = (id, kind, args) => store.command({id, kind, args})
    await command('create', 'task.create', {taskId: 'learn-one', request: '核对隔离任务', ownerActorId: owner})
    const binding = (await command('claim', 'task.claim', {taskId: 'learn-one'})).result.binding
    const completion = (await command('complete', 'task.complete', {binding, summary: '核对已完成'})).completionEvent
    const reflection = f.host.ctx.reflection
    detach = reflection.attachStore(store, {ownerActorId: owner, model: f.config.model})
    await reflection.whenIdle()
    const scope = memoryScope({actorId: owner}), stateFile = join(reflection.directory(scope), 'state.json')
    const before = await readFile(stateFile), requestCount = f.requests.length
    assert.equal(requestCount, 1, 'only actual tool-free retrospective inference is expected')
    assert.ok(f.requests.every(body => !body.tools?.length))
    const open = async actor => {
      web = await createWebConsole({channels, paths: f.host.ctx.runtimePaths, config: {channelId, senderId: actor, port: 0},
        getApplication: () => ({tasks: {store}}), getReflection: () => reflection, getMemory: () => f.host.ctx.memory})
      const login = await fetch(web.origin + '/api/login', {method: 'POST', headers: {origin: web.origin, 'content-type': 'application/json'},
        body: JSON.stringify({token: (await readFile(web.credentialPath, 'utf8')).trim()})})
      assert.equal(login.status, 200)
      const cookie = login.headers.get('set-cookie').split(';')[0]
      return async path => {
        const response = await fetch(web.origin + path, {headers: {origin: web.origin, cookie}})
        return {status: response.status, body: await response.json()}
      }
    }
    const api = await open(senderId), endpoint = '/api/tasks/learn-one/learning'
    const evolution = await api('/api/evolution')
    assert.equal(evolution.status, 200); assert.equal(evolution.body.memory.acceptedCount, 1); assert.equal(evolution.body.skills.activeCount, 1); assert.equal(evolution.body.items.find(row=>row.kind==='memory').provenance.taskId,'learn-one')
    const agent = await f.agent('evolution-reader', {actorId: owner})
    const baseline = (await api('/api/evolution')).body
    await f.host.ctx.memory.read(agent.agent, {topic: 'experience'})
    await f.host.ctx.memory.search(agent.agent, {query: '核对'})
    const learned = (await reflection.catalog(agent.agent))[0]
    assert.ok(learned); await reflection.skill(learned, agent.agent)
    const measured = (await api('/api/evolution')).body
    // Direct Host calls and resource preparation have no committed tool result.
    // Web must not substitute the core's dedicated counters for journal evidence.
    assert.equal(measured.memory.readCount, baseline.memory.readCount)
    assert.equal(measured.memory.searchCount, baseline.memory.searchCount)
    assert.equal(measured.skills.loadCount, null)
    assert.equal(measured.usageCoverage.status, 'partial')
    const durableUsage = JSON.parse(await readFile(join(f.host.ctx.memory.store.directory(scope), 'usage.json'), 'utf8'))
    assert.equal(durableUsage.readCount, 1); assert.equal(durableUsage.searchCount, 1); assert.ok(durableUsage.loadCount > 0)
    const measuredAgain = (await api('/api/evolution')).body
    assert.deepEqual(measuredAgain.memory, measured.memory); assert.deepEqual(measuredAgain.skills, measured.skills)
    const index = await api(endpoint)
    assert.equal(index.status, 200); assert.equal(index.body.status, 'ready')
    assert.equal(index.body.reviews[0].status, 'done'); assert.equal(index.body.reviews[0].eventId, completion.id)
    assert.deepEqual(index.body.changes.map(row => row.kind).sort(), ['memory', 'skill'])
    for (const change of index.body.changes) {
      assert.equal(change.status, 'applied'); assert.equal(change.canRead, true)
      assert.match(change.version, /^[a-f0-9]{64}$/)
      assert.equal(change.source.taskId, 'learn-one'); assert.equal(change.source.eventId, completion.id)
      const result = await api(endpoint + '/changes/' + change.id + '?version=' + change.version)
      assert.equal(result.status, 200); assert.equal(result.body.version, change.version)
      assert.ok(result.body.text.includes(change.kind === 'memory' ? '核对真实结果并保留可验证来源' : '核对实际终态'))
      assert.equal((await api(endpoint + '/changes/' + change.id + '?version=' + '0'.repeat(64))).status, 409)
    }
    assert.equal((await api(endpoint + '/changes/' + '0'.repeat(64) + '?version=' + '0'.repeat(64))).status, 404)
    assert.deepEqual(await readFile(stateFile), before); assert.equal(f.requests.length, requestCount)
    const skill = index.body.changes.find(row => row.kind === 'skill')
    await command('create-next', 'task.create', {taskId: 'learn-two', request: '核对第二份独立证据', ownerActorId: owner})
    const nextBinding = (await command('claim-next', 'task.claim', {taskId: 'learn-two'})).result.binding
    await command('complete-next', 'task.complete', {binding: nextBinding, summary: '第二份证据已核对'})
    reflection.scan(); await reflection.whenIdle()
    assert.equal(f.requests.length, requestCount + 1, 'a new committed completion causes exactly one new retrospective')
    assert.equal((await api(endpoint + '/changes/' + skill.id + '?version=' + skill.version)).status, 409)
    const current = await api(endpoint)
    assert.notEqual(current.body.changes.find(row => row.id === skill.id).version, skill.version)
    await web.close(); web = undefined
    const foreign = await open('another-reader'), summary = await foreign(endpoint)
    const excluded = await foreign('/api/evolution'); assert.equal(excluded.body.memory.acceptedCount, 2); assert.equal(excluded.body.skills.activeCount, 1); assert.equal(excluded.body.memory.readCount, measured.memory.readCount)
    assert.equal(summary.status, 200); assert.ok(summary.body.changes.every(row => row.canRead === true))
    for (const change of summary.body.changes) assert.equal((await foreign(endpoint + '/changes/' + change.id + '?version=' + change.version)).status, 200)
    assert.equal(f.requests.length, requestCount + 1, 'HTTP reads never schedule retrospective or task inference')
  } finally {await web?.close(); detach?.(); await store.close()}
})
