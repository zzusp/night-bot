import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, writeFile, rm, link} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {request as httpRequest} from 'node:http'
import {createWebConsole, apply} from '../server/plugin.js'
import {openWebLedger} from '../server/ledger.js'
import {accessCredential, browserSessions} from '../server/security.js'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'night-web-console-'))
  const paths = {secrets: join(root, 'secrets'), state: join(root, 'state')}
  const dist = join(root, 'dist')
  for (const path of [...Object.values(paths), dist]) await mkdir(path)
  await writeFile(join(dist, 'index.html'), '<!doctype html><html lang="zh"><title>Night Bot</title></html>')
  await writeFile(join(dist, 'app.js'), 'export const ready = true')
  const received = [], transports = new Map(), plugins = new Map()
  const channels = {
    transports, plugins,
    identity: envelope => ({sessionId: 'conversation-' + envelope.channelId + '-' + envelope.conversationId}),
    groupContext: id => id === 'room-one' ? {channelId: 'team-chat', type: 'chat-room', conversationId: 'team'} : undefined,
    registerTransport(id, value) {assert.equal(transports.has(id), false); transports.set(id, value); return () => transports.delete(id)},
    registerPlugin(id, value) {plugins.set(id, value); return () => plugins.delete(id)},
    async receive(envelope) {
      received.push(envelope)
      if (options.receive) return options.receive(envelope)
      return {accepted: true}
    },
  }
  const rows = [{taskId: 'task-one', title: '核对任务证据', state: 'running', objective: '保留既有执行会话', groupId: 'room-one', updatedAt: '2026-11-07T01:00:00Z',
    ...(options.blockers ? {blockers: options.blockers} : {}),
    session: {role: 'execution', sessionId: 'pi-one', status: 'running', workspaceDir: '/private/work', logPath: '/private/journal'},
    result: {summary: '进行中', path: '/private/artifact'}, timeline: {version: 1, task: {state: 'running'}, executions: [], human: {segments: []}}}]
  const app = {
    config: {channelPlugins: [{type: 'test-chat', channelId: 'team-chat', enabled: true, config: {apiKey: 'DO_NOT_EXPOSE'}}, {type: 'web-console', channelId: 'web', enabled: true}]},
    tasks: {
      async boardTasks(query) {if (options.taskError?.(query)) throw new Error('PRIVATE_INTERNAL_ERROR'); const items = rows.filter(row => !query.state || row.state === query.state); return {items, total: items.length, offset: 0, limit: query.limit, revision: 'r1', nextOffset: null}},
      listObserverGroups() {return [{groupId: 'room-one', name: '项目讨论'}]},
      async taskDetail(id) {return rows.find(row => row.taskId === id)},
      async taskDialogue(id) {return {taskId: id, sessionId: 'pi-one', messages: [{id: 'm1', role: 'user', text: '原消息'}], writable: true, error: null}},
      async taskExecutions() {return {executions: [], total: 0, nextOffset: null}},
      async observerGroupPage(id, query) {
        if (id !== 'room-one') return null
        const items = query.collection === 'messages' ? [{messageId: 'in-1', text: '<script>untrusted</script>', senderName: '成员', occurredAt: '2026-11-07T01:00:00Z', processingState: 'processed', taskSessionRefs: ['task-one']}]
          : [{outboundId: 'out-1', text: '正在核对', notificationState: 'unknown', sendStartedAt: '2026-11-07T01:00:01Z', taskIds: ['task-one']}]
        return {items, total: 1, nextOffset: null, revision: 'messages-r1'}
      },
    },
  }
  const config = {channelId: 'web', senderId: 'configured-operator', operatorName: '操作者', port: 0}
  let web = await createWebConsole({channels, paths, config, getApplication: () => app, getSessionPersistence: () => options.persistence, dist})
  t.after(async () => {await web.close(); await rm(root, {recursive: true, force: true})})
  let cookie, csrfToken
  const fetchApi = async (path, {method = 'GET', body, headers = {}} = {}) => {
    const response = await fetch(web.origin + path, {method, headers: {origin: web.origin, ...(cookie ? {cookie} : {}), ...(csrfToken ? {'x-csrf-token': csrfToken} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})})
    const value = await response.json()
    return {response, status: response.status, body: value}
  }
  const login = async () => {
    const token = (await readFile(web.credentialPath, 'utf8')).trim()
    const result = await fetchApi('/api/login', {method: 'POST', body: {token}})
    assert.equal(result.status, 200)
    cookie = result.response.headers.get('set-cookie').split(';')[0]
    csrfToken = result.body.csrfToken
    assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
    assert.equal(JSON.stringify(result.body).includes(token), false)
    return result
  }
  return {root, paths, dist, channels, received, app, fetchApi, login, get web() {return web},
    async restart() {await web.close(); web = await createWebConsole({channels, paths, config, getApplication: () => app, getSessionPersistence: () => options.persistence, dist}); cookie = undefined; csrfToken = undefined},
  }
}

test('optional plugin disabled does not register lifecycle or open storage', async () => {
  await apply(new Proxy({}, {get() {assert.fail('disabled adapter must be inert')}}), {enabled: false})
})

test('real HTTP requires token login, same-origin mutation and CSRF; logout revokes the session', async t => {
  const f = await fixture(t)
  assert.equal((await f.fetchApi('/api/tasks')).status, 401)
  assert.equal((await f.fetchApi('/api/login', {method: 'POST', body: {token: 'wrong'}})).status, 401)
  await f.login()
  assert.equal((await f.fetchApi('/api/session')).body.operator.name, '操作者')
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: {requestId: 'one', text: '你好'}, headers: {'x-csrf-token': 'forged'}})).status, 403)
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: {requestId: 'one', text: '你好'}, headers: {origin: 'https://evil.example'}})).status, 403)
  assert.equal((await f.fetchApi('/api/logout', {method: 'POST', body: {}})).status, 200)
  assert.equal((await f.fetchApi('/api/session')).status, 401)
  assert.equal(f.received.length, 0)
})

test('DNS rebinding, cross-site fetch and request identity injection are rejected', async t => {
  const f = await fixture(t); await f.login()
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.web.origin + '/api/session', {headers: {host: 'evil.example'}}, response => {response.resume(); resolve(response.statusCode)})
    request.on('error', reject); request.end()
  })
  assert.equal(reboundStatus, 403)
  assert.equal((await f.fetchApi('/api/session', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403)
  for (const field of ['senderId', 'channelId', 'type', 'sessionId']) {
    const result = await f.fetchApi('/api/chat', {method: 'POST', body: {requestId: 'forged', text: 'hello', [field]: 'someone-else'}})
    assert.equal(result.status, 400)
  }
  assert.equal(f.received.length, 0)
})

test('chat admission preserves configured identity and exact text; retries read the original receipt', async t => {
  const f = await fixture(t); await f.login()
  const input = {requestId: 'request-one', text: '  请核对这项任务。\n保留原话。  '}
  const first = await f.fetchApi('/api/chat', {method: 'POST', body: input})
  assert.equal(first.status, 202); assert.equal(first.body.status, 'accepted')
  assert.equal(f.received.length, 1)
  assert.deepEqual(f.received[0], {type: 'chat', channelId: 'web', senderId: 'configured-operator', conversationId: first.body.conversationId, messageId: input.requestId, text: input.text})
  const duplicate = await f.fetchApi('/api/chat', {method: 'POST', body: input})
  assert.equal(duplicate.body.conversationId, first.body.conversationId); assert.equal(f.received.length, 1)
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: {...input, text: 'changed'}})).status, 409)
  const detail = await f.fetchApi('/api/chat/' + first.body.conversationId)
  assert.equal(detail.body.messages[0].text, input.text)
  assert.equal((await f.fetchApi('/api/requests/request-one')).body.status, 'accepted')
  assert.equal((await f.fetchApi('/api/chat')).body.total, 1)
})

test('uncertain admission is durable and never automatically replayed, including after restart', async t => {
  const f = await fixture(t, {receive() {throw new Error('private internal failure')}}); await f.login()
  const body = {conversationId: 'uncertain-chat', requestId: 'uncertain-request', text: '请处理'}
  const first = await f.fetchApi('/api/chat', {method: 'POST', body})
  assert.equal(first.status, 409); assert.equal(first.body.status, 'unknown')
  assert.equal(JSON.stringify(first.body).includes('private internal'), false)
  await f.restart(); await f.login()
  assert.equal((await f.fetchApi('/api/requests/uncertain-request')).body.status, 'unknown')
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body})).status, 409)
  assert.equal(f.received.length, 1)
})

test('resolved Host refusal is rejected and never presented as admitted or replayed', async t => {
  const f = await fixture(t, {receive() {return {accepted: false, processing: 'quarantined', reason: 'PRIVATE_REASON'}}}); await f.login()
  const body = {conversationId: 'rejected-chat', requestId: 'rejected-request', text: '请处理'}
  const result = await f.fetchApi('/api/chat', {method: 'POST', body})
  assert.equal(result.status, 422); assert.equal(result.body.accepted, false); assert.equal(result.body.status, 'rejected')
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_REASON/)
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body})).status, 422)
  assert.equal((await f.fetchApi('/api/requests/rejected-request')).body.status, 'rejected')
  assert.equal(f.received.length, 1)
})

test('transport delivery uses durable exact receipts, supports readback after restart and refuses conflict', async t => {
  const f = await fixture(t); await f.login()
  await f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: 'reply-chat', requestId: 'reply-request', text: '你好'}})
  const envelope = {type: 'chat', channelId: 'web', senderId: 'configured-operator', conversationId: 'reply-chat', deliveryKey: 'reply-one', text: '你好，我在。', replyToMessageId: 'reply-request'}
  const transport = f.channels.transports.get('web')
  const [first, duplicate] = await Promise.all([transport.send(envelope), transport.send(envelope)])
  assert.equal(first.messageId, duplicate.messageId)
  await assert.rejects(transport.send({...envelope, text: 'changed'}), {code: 'WEB_DELIVERY_CONFLICT'})
  await assert.rejects(transport.send({...envelope, senderId: 'forged'}), {code: 'WEB_DELIVERY_SCOPE_INVALID'})
  assert.equal(await transport.readback({...envelope, deliveryKey: 'missing'}), undefined)
  await f.restart(); await f.login()
  assert.equal(f.channels.transports.get('web').readback(envelope).messageId, first.messageId)
  const detail = await f.fetchApi('/api/chat/reply-chat')
  assert.equal(detail.body.messages.length, 2)
  assert.equal(detail.body.messages.find(row => row.role === 'assistant').status, 'delivered')
})

test('task/channel views only project existing facts and never return configuration secrets or private paths', async t => {
  const f = await fixture(t); await f.login()
  const overview = await f.fetchApi('/api/overview')
  assert.equal(overview.body.running.total, 1); assert.equal(overview.body.waiting.total, 0)
  assert.equal(overview.body.channels[0].connected, undefined, 'configured is not proof of live connection')
  const task = await f.fetchApi('/api/tasks/task-one')
  assert.equal(task.body.session.sessionId, 'pi-one'); assert.deepEqual(task.body.timeline.executions, [])
  assert.doesNotMatch(JSON.stringify([overview.body, task.body]), /DO_NOT_EXPOSE|workspaceDir|logPath|\/private\//)
  assert.equal((await f.fetchApi('/api/tasks/task-one/dialogue')).body.writable, false)
  assert.equal((await f.fetchApi('/api/tasks?state=fake')).status, 400)
  assert.equal((await f.fetchApi('/api/tasks?limit=101')).status, 400)
  const messages = (await f.fetchApi('/api/conversations/room-one/messages')).body
  assert.equal(messages.items[0].status, 'processed')
  assert.equal(messages.items[1].status, 'unknown', 'processed input cannot manufacture delivered output')
  assert.equal((await f.fetchApi('/api/conversations')).body.items[0].type, 'chat-room')
})

test('partial overview failure preserves other sections without reflecting internal errors', async t => {
  const f = await fixture(t, {taskError: query => query.state === 'waiting'}); await f.login()
  const result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200); assert.equal(result.body.waiting, null)
  assert.equal(result.body.sectionErrors.waiting, 'SECTION_UNAVAILABLE'); assert.equal(result.body.running.total, 1)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_INTERNAL_ERROR/)
})

test('task blocker HTTP projection flattens all three real collections and excludes their private payloads', async t => {
  const blockers = {
    executions: [{executionId: 'execution-one', status: 'running', drained: false, recovering: true,
      input: {title: '核对构建结果', objective: 'PRIVATE_OBJECTIVE', context: 'PRIVATE_CONTEXT'}, result: {token: 'PRIVATE_EXECUTION_RESULT'}, resources: {keys: ['PRIVATE_RESOURCE']}}],
    operations: [{operationId: 'operation-one', state: 'unknown', definition: {toolName: 'pwsh', arguments: {command: 'PRIVATE_COMMAND', apiKey: 'PRIVATE_KEY'}},
      dispatchBinding: {token: 'PRIVATE_DISPATCH'}, resourceKeys: ['PRIVATE_RESOURCE'], result: {stdout: 'PRIVATE_RESULT'}}],
    legacy: [{id: 'legacy-one', kind: 'external-operation', state: 'unknown', source: 'D:\\PRIVATE_SOURCE\\token', resourceKeys: ['PRIVATE_LEGACY_RESOURCE'], evidenceRef: 'PRIVATE_EVIDENCE', resolved: false}],
  }
  const f = await fixture(t, {blockers}); await f.login()
  const result = await f.fetchApi('/api/tasks/task-one')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.blockers.map(row => row.kind), ['execution', 'operation', 'legacy'])
  assert.deepEqual(result.body.blockers.map(row => row.title), ['核对构建结果', '待核实操作：pwsh', '历史阻断待核实'])
  assert.deepEqual(result.body.blockers.map(row => row.status), ['running', 'unknown', 'unknown'])
  assert.equal(result.body.blockers[0].drained, false); assert.equal(result.body.blockers[0].recovering, true)
  assert.equal(result.body.blockers[1].toolName, 'pwsh')
  assert.equal(new Set(result.body.blockers.map(row => row.id)).size, 3)
  assert.ok(result.body.blockers.every(row => /^[a-f0-9]{64}$/.test(row.id)))
  assert.doesNotMatch(JSON.stringify(result.body.blockers), /PRIVATE_|arguments|definition|resources|source|result|token|binding/i)
  assert.deepEqual((await f.fetchApi('/api/tasks/task-one')).body.blockers, result.body.blockers)
  assert.equal(blockers.operations[0].definition.arguments.command, 'PRIVATE_COMMAND', 'the core object remains untouched')
})

test('assets use security headers; missing assets do not stop APIs', async t => {
  const f = await fixture(t); await f.login()
  const html = await fetch(f.web.origin)
  assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await fetch(f.web.origin + '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal((await fetch(f.web.origin + '/%2eenv')).status, 400)
  assert.equal((await fetch(f.web.origin + '/secrets%5caccess-token')).status, 400)
  await rm(join(f.dist, 'index.html'))
  assert.equal((await fetch(f.web.origin)).status, 503)
  assert.equal((await f.fetchApi('/api/tasks')).status, 200)
})

test('closing a browser request does not abort already admitted channel work', async t => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers()
  const f = await fixture(t, {async receive() {started.resolve(); await gate.promise; return {accepted: true}}})
  const login = await f.login(), cookie = login.response.headers.get('set-cookie').split(';')[0]
  const req = httpRequest(f.web.origin + '/api/chat', {method: 'POST', headers: {origin: f.web.origin, cookie, 'x-csrf-token': login.body.csrfToken, 'content-type': 'application/json'}}, () => {})
  req.on('error', () => {})
  req.end(JSON.stringify({conversationId: 'disconnect-chat', requestId: 'disconnect-request', text: '断线后继续'}))
  await started.promise; req.destroy(); gate.resolve()
  let receipt
  for (let attempt = 0; attempt < 20; attempt++) {
    receipt = await f.fetchApi('/api/requests/disconnect-request')
    if (receipt.body.status === 'accepted') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(receipt.body.status, 'accepted'); assert.equal(f.received.length, 1)
})

test('pending ledger admission becomes unknown after reopening', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-ledger-')); t.after(() => rm(root, {recursive: true, force: true}))
  let ledger = await openWebLedger(root)
  ledger.reserve({requestId: 'pending', conversationId: 'chat', groupId: 'group', text: 'hello', senderId: 'operator', channelId: 'web'})
  ledger.close(); ledger = await openWebLedger(root)
  try {assert.equal(ledger.request('pending').status, 'unknown')} finally {ledger.close()}
})

test('credential reads reject hard links and malformed oversized files without replacing them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-secret-')); t.after(() => rm(root, {recursive: true, force: true}))
  const prior = join(root, 'existing-secret'), directory = join(root, 'web')
  await mkdir(directory, {mode: 0o700}); await writeFile(prior, 'A'.repeat(43) + '\n', {mode: 0o600})
  const credential = join(directory, 'access-token')
  await link(prior, credential)
  await assert.rejects(accessCredential(directory), {code: 'WEB_ACCESS_TOKEN_UNSAFE'})
  assert.equal(await readFile(prior, 'utf8'), 'A'.repeat(43) + '\n')
  await rm(credential); await writeFile(credential, 'B'.repeat(1000), {mode: 0o600})
  await assert.rejects(accessCredential(directory), {code: 'WEB_ACCESS_TOKEN_UNSAFE'})
  assert.equal((await readFile(credential)).length, 1000)
})

test('expired sessions fail closed and login attempts are bounded', () => {
  let now = 0
  const sessions = browserSessions({token: 'secret', channelId: 'test', now: () => now}), headers = new Map(), response = {setHeader: (key, value) => headers.set(key, value)}
  const session = sessions.login('secret', response), request = {headers: {cookie: headers.get('set-cookie').split(';')[0], 'x-csrf-token': session.csrfToken}}
  assert.equal(sessions.require(request, true), session)
  now += 13 * 60 * 60 * 1000
  assert.throws(() => sessions.require(request), {code: 'AUTH_REQUIRED'})
  for (let i = 0; i < 5; i++) assert.throws(() => sessions.login('wrong', response), {code: 'AUTH_INVALID'})
  assert.throws(() => sessions.login('secret', response), {code: 'AUTH_RATE_LIMITED'})
  now += 30_000; assert.ok(sessions.login('secret', response))
})
