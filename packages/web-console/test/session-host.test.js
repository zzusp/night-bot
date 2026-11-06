import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {memoryHost} from '../../../test/fixtures/memory-host.js'
import {nativeTestTimeout} from '../../../test/fixtures/native-lifecycle.js'
import {apply as applyApplication, inject} from '../../../src/application.js'
import {createWebConsole} from '../server/plugin.js'

test('task session API reads actual committed Pi source and tool records without changing history', {timeout: nativeTestTimeout(30000)}, async t => {
  const f = await memoryHost(t, body => {
    if (JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')) return {text: '{"lessons":[]}'}
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
    assert.deepEqual(detailView.body.result.evidence, ['fixture-observation', '[路径已隐藏]'])
    assert.ok(detailView.body.timeline.task.events.some(event => event.kind === 'completed'))
    assert.doesNotMatch(JSON.stringify(detailView.body), /REDACT_ME|sensitive|private\.txt|fixture-tool-argument/)
    assert.equal(task.result.evidence[1], '/private/fixture-tool-argument', 'Web redaction leaves the real completion receipt unchanged')
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
    assert.doesNotMatch(visible, /REDACT_ME|sensitive|private\.txt|fixture-tool-argument|"materials"\s*:|"taskSession"\s*:/)
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
