import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, writeFile, rm, link} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {request as httpRequest} from 'node:http'
import Channels from '../../../src/channels/service.js'
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
    identity: envelope => {
      if (options.validateIdentity) Channels.prototype.identity.call({host: {runtimePaths: {workspaces: root}}}, envelope)
      return {sessionId: 'conversation-' + envelope.channelId + '-' + envelope.conversationId, binding: {actorId: 'verified-web-operator'}}
    },
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
  const config = {channelId: 'web', senderId: 'configured-operator', operatorName: Object.hasOwn(options, 'operatorName') ? options.operatorName : '操作者', port: 0}
  if (options.history) {
    const directory = join(paths.state, 'web-console-' + createHash('sha256').update(config.channelId).digest('hex').slice(0, 16))
    await mkdir(directory, {mode: 0o700})
    const old = await openWebLedger(directory)
    for (const conversationId of ['canonical-old', 'retained-old']) {
      old.reserve({requestId: 'seed-' + conversationId, conversationId, groupId: 'conversation-web-' + conversationId, text: conversationId, senderId: config.senderId, channelId: config.channelId})
    }
    old.close()
  }
  let web = await createWebConsole({channels, paths, config, getApplication: () => app, getSessionPersistence: () => options.persistence, getMemory: () => options.memory, getOperatorSettings: () => options.settings, dist})
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
    async restart() {await web.close(); web = await createWebConsole({channels, paths, config, getApplication: () => app, getSessionPersistence: () => options.persistence, getMemory: () => options.memory, getOperatorSettings: () => options.settings, dist}); cookie = undefined; csrfToken = undefined},
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
  assert.deepEqual(f.received[0], {type: 'chat', channelId: 'web', senderId: 'configured-operator', senderName: '操作者', conversationId: first.body.conversationId, messageId: input.requestId, text: input.text})
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

test('渠道连接阶段只用真实 health 白名单，启用状态和私有错误不能冒充连接', async t => {
  const f = await fixture(t); await f.login()
  const stages = ['starting', 'waiting-auth', 'ready', 'paused', 'recovering', 'listening', 'error', 'stopped', 'PRIVATE_UNKNOWN_STATE']
  const expected = []
  f.app.config.channelPlugins = stages.map((state, index) => {
    const channelId = 'health-' + index, healthy = index % 2 === 0
    const health = {state, healthy, credentials: 'PRIVATE_HEALTH_CREDENTIAL', path: '/private/health'}
    Object.defineProperty(health, 'lastError', {get() {assert.fail('raw adapter error must not be read')}})
    f.channels.plugins.set(channelId, {health})
    expected.push({channelId, type: 'fixture-chat', enabled: false, connectionState: index === 8 ? 'unknown' : state, restartRequired: false, liveApplied: false,
      errorCode: state === 'waiting-auth' ? 'CHANNEL_AUTH_REQUIRED' : state === 'error' ? 'CHANNEL_ADAPTER_ERROR' : null, connected: healthy})
    return {type: 'fixture-chat', channelId, enabled: false, config: {token: 'PRIVATE_CONFIG_CREDENTIAL'}}
  })
  for (const [channelId, health] of [['absent', undefined], ['invalid', {state: 'ready', healthy: 'PRIVATE_NOT_BOOLEAN'}]]) {
    f.app.config.channelPlugins.push({type: 'fixture-chat', channelId, enabled: true})
    if (health) f.channels.plugins.set(channelId, {health})
    expected.push({channelId, type: 'fixture-chat', enabled: true, connectionState: health ? 'ready' : 'unknown', errorCode: null, restartRequired: false, liveApplied: !!health})
  }
  for (const writesAuthorized of [true, false, undefined]) {
    const channelId = 'dws-authorization-' + String(writesAuthorized)
    f.app.config.channelPlugins.push({type: 'dingtalk-dws', channelId, enabled: true,
      config: {dingtalk_profile: 'PRIVATE_PROFILE', dingtalk_conversation_type: 'chat-room', dingtalk_writes_authorized: writesAuthorized}})
    f.channels.plugins.set(channelId, {bindingActive:writesAuthorized!==undefined,health: {state: 'ready', healthy: true}})
    expected.push({channelId, type: 'dingtalk-dws', enabled: true, connectionState: 'ready', errorCode: null,
      restartRequired: false, liveApplied: writesAuthorized!==undefined, name: channelId, conversationType: 'chat-room', promptConfigured: false,
      writesAuthorized: writesAuthorized === true, connected: true})
  }
  for(const item of expected){
    const row=f.app.config.channelPlugins.find(row=>row.channelId===item.channelId)
    const version=createHash('sha256').update(JSON.stringify(row)).digest('hex')
    Object.assign(item,{savedVersion:version,runningVersion:version,runningConnectionState:item.connectionState,runningErrorCode:item.errorCode})
    if(typeof item.connected==='boolean')item.runningConnected=item.connected
    if(row.type==='dingtalk-dws')Object.assign(item,{runningName:item.name,runningConversationType:item.conversationType})
  }
  const result = await f.fetchApi('/api/channels')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.items, expected)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|lastError|credentials|token|\/private\//)
  assert.equal(f.received.length, 0, 'reading connection state cannot admit or replay business work')
})

test('partial overview failure preserves other sections without reflecting internal errors', async t => {
  const f = await fixture(t, {taskError: query => query.state === 'waiting'}); await f.login()
  const result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200); assert.equal(result.body.waiting, null)
  assert.equal(result.body.sectionErrors.waiting, 'SECTION_UNAVAILABLE'); assert.equal(result.body.running.total, 1)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_INTERNAL_ERROR/)
})

test('overview isolates throwing channel health and conversation reads from healthy task sections', async t => {
  const f = await fixture(t); await f.login()
  f.channels.plugins.set('team-chat', {get health() {throw new Error('PRIVATE_CHANNEL_FAILURE')}})
  let result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200)
  assert.equal(result.body.channels, null)
  assert.deepEqual(result.body.sectionErrors, {channels: 'SECTION_UNAVAILABLE'})
  assert.equal(result.body.conversations.length, 1)
  assert.equal(result.body.running.total, 1)
  f.app.tasks.listObserverGroups = () => {throw new Error('PRIVATE_CONVERSATION_FAILURE')}
  result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200)
  assert.equal(result.body.conversations, null)
  assert.deepEqual(result.body.sectionErrors, {channels: 'SECTION_UNAVAILABLE', conversations: 'SECTION_UNAVAILABLE'})
  assert.equal(result.body.tasks.total, 1)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_/)
})

test('task details and dialogue whitelist nested facts and redact displayed credentials and paths', async t => {
  const f = await fixture(t); await f.login()
  const token = (await readFile(f.web.credentialPath, 'utf8')).trim()
  const task = await f.app.tasks.taskDetail('task-one')
  task.objective = '业务原话'.repeat(5000) + '保留末尾'
  task.result = {action: 'complete', summary: '结果可见 ' + token, question: '需要确认吗？', evidence: ['已核对 /private/evidence.txt', {text: 'PRIVATE_NESTED_EVIDENCE'}],
    limitations: ['尚未线上验收'], artifactFiles: [{artifact: {logicalPath: 'PRIVATE_ARTIFACT', localPath: 'PRIVATE_LOCAL'}}],
    arguments: {command: 'PRIVATE_COMMAND'}, credential: 'PRIVATE_CREDENTIAL', unknownFutureField: 'PRIVATE_FUTURE'}
  task.timeline = {version: 1, privateFuture: 'PRIVATE_TIMELINE', task: {status: 'active', complete: true,
    events: [{kind: 'created', at: '2026-11-07T01:00:00Z', sequence: 1, authorization: 'PRIVATE_EVENT'}]},
    executions: [{id: 'run-one', title: '执行记录', status: 'completed', privateFuture: 'PRIVATE_TRACK',
      milestones: [{id: 'm1', summary: '构建已完成', at: '2026-11-07T01:00:01Z', input: {password: 'PRIVATE_INPUT'}}],
      conclusions: [{id: 'c1', summary: '已核对', evidence: ['确认成功'], artifacts: ['PRIVATE_ARTIFACT_PATH']}]}],
    human: {segments: [{id: 'h1', status: 'waiting-reply', description: '请确认下一步 token=PRIVATE_INLINE', startedAt: '2026-11-07T01:00:01Z', permission: 'PRIVATE_PERMISSION'}]}}
  f.app.tasks.taskDialogue = async () => ({taskId: task.taskId, sessionId: 'pi-one', writable: true, error: 'PRIVATE_ERROR', messages: [{
    id: 'd1', text: '确认继续', actorId: 'PRIVATE_ACTOR', receivedAt: '2026-11-07T01:00:00Z', reply: '已收到',
    replyError: {message: 'PRIVATE_STACK', token}, internal: 'PRIVATE_DIALOGUE',
  }]})
  const original = JSON.stringify(task)
  const detail = await f.fetchApi('/api/tasks/task-one')
  assert.equal(detail.status, 200)
  assert.equal(detail.body.objective, task.objective, 'business fields are not silently truncated using the execution-log limit')
  assert.equal(detail.body.result.action, 'complete')
  assert.equal(detail.body.result.question, '需要确认吗？')
  assert.deepEqual(detail.body.result.limitations, ['尚未线上验收'])
  assert.deepEqual(detail.body.result.evidence, ['已核对 [路径已隐藏]'])
  assert.deepEqual(detail.body.timeline.task.events, [{kind: 'created', sequence: 1, at: '2026-11-07T01:00:00Z'}])
  assert.equal(detail.body.timeline.executions[0].milestones[0].summary, '构建已完成')
  assert.match(detail.body.timeline.human.segments[0].description, /请确认下一步/)
  const dialogue = await f.fetchApi('/api/tasks/task-one/dialogue')
  assert.deepEqual(dialogue.body.messages, [{id: 'd1', text: '确认继续', receivedAt: '2026-11-07T01:00:00Z', reply: '已收到'}])
  assert.equal(dialogue.body.error, 'TASK_DIALOGUE_UNAVAILABLE'); assert.equal(dialogue.body.writable, false)
  const serialized = JSON.stringify([detail.body, dialogue.body, (await f.fetchApi('/api/tasks')).body])
  assert.doesNotMatch(serialized, /PRIVATE_|\/private\/|artifactFiles|arguments|credential|unknownFutureField|actorId|replyError/)
  assert.equal(serialized.includes(token), false)
  assert.equal(JSON.stringify(task), original, 'read projection never alters the authoritative task')
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

test('conversation title and admission state follow durable insertion order across equal timestamps and clock rollback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-ledger-order-'))
  let ledger = await openWebLedger(root)
  t.after(async () => {ledger.close(); await rm(root, {recursive: true, force: true})})
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-11-07T01:00:00Z')})
  const reserve = (requestId, text) => ledger.reserve({requestId, conversationId: 'chat', groupId: 'group', text, senderId: 'operator', channelId: 'web'})
  reserve('z-first', '第一条消息'); ledger.settle('z-first', 'accepted')
  await ledger.transport('web', 'operator').send({type: 'chat', channelId: 'web', senderId: 'operator', conversationId: 'chat',
    deliveryKey: 'first-reply', replyToMessageId: 'z-first', text: '第一条回复'})
  reserve('a-second', '第二条消息'); ledger.settle('a-second', 'rejected')
  assert.equal(ledger.chats().items[0].title, '第一条消息')
  assert.equal(ledger.chats().items[0].status, 'rejected')
  assert.equal(ledger.chat('chat').status, 'rejected')
  assert.deepEqual(ledger.chat('chat').messages.map(message => message.text), ['第一条消息', '第二条消息', '第一条回复'])
  assert.ok(ledger.chat('chat').messages.every(message => !Object.hasOwn(message, 'sequence')))
  t.mock.timers.setTime(Date.parse('2026-11-07T00:59:59Z'))
  reserve('m-last', '回拨后的第三条消息')
  assert.equal(ledger.chats().items[0].title, '第一条消息')
  assert.equal(ledger.chat('chat').status, 'pending')
  ledger.close(); ledger = await openWebLedger(root)
  assert.equal(ledger.chat('chat').status, 'unknown')
  assert.equal(ledger.chats().items[0].status, 'unknown')
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
  now = 12 * 60 * 60 * 1000 - 1
  assert.equal(sessions.require(request, true), session)
  assert.match(headers.get('set-cookie'), /Max-Age=43200/)
  now += 1
  assert.throws(() => sessions.require(request), {code: 'AUTH_REQUIRED'})
  for (let i = 0; i < 5; i++) assert.throws(() => sessions.login('wrong', response), {code: 'AUTH_INVALID'})
  assert.throws(() => sessions.login('secret', response), {code: 'AUTH_RATE_LIMITED'})
  now += 30_000; assert.ok(sessions.login('secret', response))
})


test('evolution endpoint authenticates, binds operator scope, validates pagination and redacts names', async t => {
  const calls = []
  const f = await fixture(t, {memory: {async inspectEvolution(binding, options) {
    calls.push({binding, options})
    return {status: 'ready', items: [{id: 'one', kind: 'memory', name: 'record /private/secret.txt'}], total: 1}
  }}})
  assert.equal((await f.fetchApi('/api/evolution')).status, 401)
  await f.login()
  const result = await f.fetchApi('/api/evolution?kind=skill&offset=2&limit=10')
  assert.equal(result.status, 200)
  assert.deepEqual(calls, [{binding: {actorId: 'verified-web-operator'}, options: {kind: 'skill', offset: 2, limit: 10}}])
  assert.doesNotMatch(JSON.stringify(result.body), /private\/secret/)
  for (const query of ['kind=other', 'limit=51', 'offset=-1', 'actorId=other']) assert.equal((await f.fetchApi('/api/evolution?' + query)).status, 400)
  assert.equal(calls.length, 1)
})

test('evolution unavailable service and failed reads never become zero counts', async t => {
  const f = await fixture(t)
  await f.login()
  assert.deepEqual((await f.fetchApi('/api/evolution')).body, {status: 'unavailable', reason: 'EVOLUTION_UNAVAILABLE'})
  const failed = await fixture(t, {memory: {inspectEvolution() {throw Error('/private/body')}}})
  await failed.login()
  const result = await failed.fetchApi('/api/evolution')
  assert.equal(result.status, 503)
  assert.deepEqual(result.body, {error: 'EVOLUTION_UNAVAILABLE'})
})

test('recent history exposes channel routes alongside Web chats and preserves verified operator name', async t => {
  const f=await fixture(t);await f.login()
  const initial=await f.fetchApi('/api/recent-conversations?offset=0&limit=20')
  assert.equal(initial.status,200)
  assert.deepEqual(initial.body.items.map(item=>({id:item.id,title:item.title,kind:item.kind})),[{id:'room-one',title:'项目讨论',kind:'channel'}])
  const sent=await f.fetchApi('/api/chat',{method:'POST',body:{conversationId:'recent-web',requestId:'recent-input',text:'Recent Web input'}})
  assert.equal(sent.status,202)
  assert.equal(f.received.at(-1).senderName,'操作者')
  const combined=await f.fetchApi('/api/recent-conversations?offset=0&limit=1')
  assert.equal(combined.body.total,2);assert.equal(combined.body.items[0].kind,'web');assert.equal(combined.body.nextOffset,1)
  const next=await f.fetchApi('/api/recent-conversations?offset=1&limit=1')
  assert.equal(next.body.items[0].id,'room-one');assert.equal(next.body.nextOffset,null)
})

test('singleton Web HTTP blocks arbitrary extra chats, concurrent creation and survives restart', async t => {
  const f = await fixture(t); await f.login()
  const current = (await f.fetchApi('/api/chat-current')).body.conversationId
  assert.equal((await f.fetchApi(`/api/chat/${current}`)).body.canonicalConversationId, current)
  const results = await Promise.all(Array.from({length: 8}, (_, i) => f.fetchApi('/api/chat', {method: 'POST', body: {requestId: `parallel-${i}`, text: `hello ${i}`}})))
  assert.ok(results.every(result => result.status === 202 && result.body.conversationId === current))
  assert.equal((await f.fetchApi('/api/chat')).body.total, 1)
  const denied = await f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: 'attempt-extra', requestId: 'extra', text: 'no new chat'}})
  assert.equal(denied.status, 409); assert.equal(denied.body.error, 'WEB_CHAT_SINGLETON')
  assert.equal((await f.fetchApi('/api/requests/extra')).status, 404)
  assert.equal((await f.fetchApi('/api/chat/attempt-extra')).status, 404)
  assert.equal(f.received.length, 8)
  await f.restart(); await f.login()
  assert.equal((await f.fetchApi('/api/chat-current')).body.conversationId, current)
  assert.equal((await f.fetchApi('/api/recent-conversations')).body.items.filter(item => item.kind === 'channel').length, 1)
})

test('singleton ledger pins earliest scope history, keeps histories and unknown receipts without replay', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-singleton-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  let ledger = await openWebLedger(root)
  const input = (id, conversationId, senderId = 'operator', channelId = 'custom-web') => ({requestId: id, conversationId, senderId, channelId, groupId: 'group-' + conversationId, text: id})
  const foreign = input('foreign-request', 'foreign-chat', 'other-operator')
  const first = input('first', 'first-chat'), old = input('old-unknown', 'old-chat')
  ledger.reserve(foreign); ledger.reserve(first); ledger.settle(first.requestId, 'accepted'); ledger.reserve(old)
  ledger.close()
  ledger = await openWebLedger(root, {channelId: 'custom-web', senderId: 'operator'})
  assert.equal(ledger.canonical(), 'first-chat')
  assert.equal(ledger.chat('old-chat').canonicalConversationId, 'first-chat')
  assert.equal(ledger.chat('foreign-chat').canonicalConversationId, 'first-chat')
  assert.equal(ledger.chat('first-chat').canonicalConversationId, 'first-chat')
  assert.equal(ledger.reserve(old).status, 'unknown')
  assert.equal(ledger.reserve(old).duplicate, true)
  assert.throws(() => ledger.reserve({...old, text: 'changed'}), {code: 'CHAT_REQUEST_CONFLICT'})
  assert.throws(() => ledger.reserve(input('extra', 'old-chat')), {code: 'WEB_CHAT_SINGLETON'})
  assert.throws(() => ledger.reserve(input('extra-new', 'new-chat')), {code: 'WEB_CHAT_SINGLETON'})
  assert.equal(ledger.chats().total, 3)
  // Already-authorized old deliveries may finish; singleton pinning must not erase them.
  await ledger.transport('custom-web', 'operator').send({type: 'chat', channelId: 'custom-web', senderId: 'operator', conversationId: 'old-chat', deliveryKey: 'old-delivery', text: 'retained reply'})
  assert.equal(ledger.chat('old-chat').messages.at(-1).text, 'retained reply')
  ledger.close()
  ledger = await openWebLedger(root, {channelId: 'custom-web', senderId: 'operator'})
  assert.equal(ledger.canonical(), 'first-chat'); assert.equal(ledger.request('old-unknown').status, 'unknown')
  ledger.close()
})


test('historical Web routes stay normal entry points but new requests continue only canonical history', async t => {
  const f = await fixture(t, {history: true}); await f.login()
  const before = (await f.fetchApi('/api/chat/retained-old')).body
  assert.equal(before.canonicalConversationId, 'canonical-old')
  assert.equal('readOnly' in before, false)
  const input = {conversationId: 'retained-old', requestId: 'normal-old-entry', text: 'continue normally'}
  const accepted = await f.fetchApi('/api/chat', {method: 'POST', body: input})
  assert.equal(accepted.status, 202); assert.equal(accepted.body.conversationId, 'canonical-old')
  assert.equal(f.received[0].conversationId, 'canonical-old')
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: input})).body.duplicate, true)
  assert.equal(f.received.length, 1)
  const after = (await f.fetchApi('/api/chat/retained-old')).body
  assert.deepEqual(after.messages, before.messages)
  const recovered = await f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: 'retained-old', requestId: 'seed-retained-old', text: 'retained-old'}})
  assert.equal(recovered.status, 409); assert.equal(recovered.body.status, 'unknown'); assert.equal(recovered.body.duplicate, true)
  assert.equal(f.received.length, 1)
  assert.equal((await f.fetchApi('/api/chat')).body.total, 2)
})

test('concurrent first explicit Web IDs admit one conversation, not two', async t => {
  const f = await fixture(t); await f.login()
  const results = await Promise.all(['first-a', 'first-b'].map(id => f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: id, requestId: id, text: id}})))
  assert.deepEqual(results.map(row => row.status).sort(), [202, 409])
  assert.equal(f.received.length, 1)
  assert.equal((await f.fetchApi('/api/chat-current')).body.conversationId, f.received[0].conversationId)
  assert.equal((await f.fetchApi('/api/chat')).body.total, 1)
})


test('Web operator names normalize before real channel schema validation and receipt reservation', async t => {
  for (const [operatorName, expected] of [['', '本机操作者'], ['   ', '本机操作者'], ['x'.repeat(257), 'x'.repeat(256)], ['  显示名  ', '显示名'], [42, '本机操作者']]) {
    await t.test(JSON.stringify(operatorName).slice(0, 40), async t => {
      const f = await fixture(t, {operatorName, validateIdentity: true}); await f.login()
      assert.equal((await f.fetchApi('/api/session')).body.operator.name, expected)
      const input = {requestId: 'name-check', text: 'hello'}
      const result = await f.fetchApi('/api/chat', {method: 'POST', body: input})
      assert.equal(result.status, 202); assert.equal(result.body.accepted, true)
      assert.equal(f.received[0].senderName, expected)
      assert.equal((await f.fetchApi('/api/requests/name-check')).body.status, 'accepted')
      assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: input})).body.duplicate, true)
      assert.equal(f.received.length, 1)
    })
  }
})


test('渠道执行接口按可见会话与真实任务归属读取，归档任务不依赖当前消息页', async t => {
  const f = await fixture(t); await f.login()
  const calls = []
  f.app.tasks.store = {async query(query) {
    calls.push(query)
    if (query.kind === 'task.list') return [{taskId: 'archived-task', groupId: 'room-one'}, {taskId: 'foreign-task', groupId: 'other-room'}]
    if (query.kind === 'task.get') return {taskId: query.taskId, groupId: query.taskId === 'foreign-task' ? 'other-room' : 'room-one', sessionId: null, sessionBound: false}
    if (query.kind === 'router.get') return null
  }}
  assert.deepEqual((await f.fetchApi('/api/conversations/room-one/tasks')).body, {taskIds: ['archived-task'], taskHistoryStatus: 'ready'})
  assert.deepEqual(calls[0], {kind: 'task.list', groupId: 'room-one', archived: 'all'})
  assert.equal((await f.fetchApi('/api/conversations/room-one/session')).body.status, 'pending')
  assert.equal((await f.fetchApi('/api/conversations/room-one/tasks/archived-task/session')).body.status, 'unavailable')
  assert.equal((await f.fetchApi('/api/conversations/room-one/tasks/foreign-task/session')).status, 404)
  assert.equal((await f.fetchApi('/api/conversations/room-one/tasks/foreign-task/session/messages/body?revision=r1')).status, 404)
  const before = calls.length
  for (const path of ['/tasks', '/session', '/tasks/archived-task/session']) assert.equal((await f.fetchApi('/api/conversations/hidden-room' + path)).status, 404)
  assert.equal(calls.length, before, '不可见会话不能探测持久历史')
  delete f.app.tasks.store
  assert.deepEqual((await f.fetchApi('/api/conversations/room-one/tasks')).body, {taskIds: null, taskHistoryStatus: 'unavailable'})
  assert.equal((await f.fetchApi('/api/conversations/room-one/session')).status, 503)
  assert.equal(f.received.length, 0)
})

test('服务重启撤销浏览器会话但不轮换访问令牌，原令牌仍可显式重连', async t => {
  const f = await fixture(t), token = (await readFile(f.web.credentialPath, 'utf8')).trim()
  const login = await f.login(), oldCookie = login.response.headers.get('set-cookie').split(';')[0]
  await f.restart()
  assert.equal((await readFile(f.web.credentialPath, 'utf8')).trim(), token)
  assert.equal((await f.fetchApi('/api/session', {headers: {cookie: oldCookie}})).status, 401)
  assert.equal((await f.fetchApi('/api/login', {method: 'POST', body: {token}})).status, 200)
  assert.equal(f.received.length, 0)
})


test('设置API沿用浏览器鉴权、同源和CSRF，拒绝注入且异常不反射凭据',async t=>{
 const calls=[],settings={appearance:async()=>({name:'测试助手',icon:'robot'}),view:async()=>({appearance:{name:'测试助手',icon:'robot'},secrets:{github:{configured:true}}}),saveSecret:async(kind,body)=>{calls.push({kind,action:body.action});if(body.value==='FAIL_TEST_SECRET')throw Error('FAIL_TEST_SECRET');return {ok:true}},saveAppearance:async()=>({ok:true})}
 const f=await fixture(t,{settings})
 assert.deepEqual((await f.fetchApi('/api/appearance')).body,{name:'测试助手',icon:'robot'})
 assert.equal((await f.fetchApi('/api/settings')).status,401)
 await f.login()
 assert.equal((await f.fetchApi('/api/settings')).body.appearance.name,'测试助手')
 const secret={action:'replace',value:'TEST_ONLY_SECRET',confirm:true,expectedVersion:'version'}
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:secret,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:secret,headers:{origin:'https://evil.invalid'}})).status,403)
 assert.equal(calls.length,0)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:{...secret,path:'/private/secret'}})).status,400)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:secret})).status,200)
 const failed=await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:{...secret,value:'FAIL_TEST_SECRET'}})
 assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.body),/FAIL_TEST_SECRET/)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:{...secret,value:'x'.repeat(17000)}})).status,413)
 assert.equal(f.received.length,0)
})


test('Web transport binds retained delivery and message reads to stored channel and sender ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-transport-scope-'))
  const ledger = await openWebLedger(root)
  t.after(async () => {ledger.close(); await rm(root, {recursive: true, force: true})})
  for (const [conversationId, senderId, channelId] of [
    ['own-history', 'operator', 'web'],
    ['foreign-sender', 'other-operator', 'web'],
    ['foreign-channel', 'operator', 'other-web'],
  ]) ledger.reserve({requestId: 'message-' + conversationId, conversationId, senderId, channelId, groupId: 'group-' + conversationId, text: conversationId})
  const transport = ledger.transport('web', 'operator')
  const envelope = conversationId => ({type: 'chat', channelId: 'web', senderId: 'operator', conversationId,
    deliveryKey: 'delivery-' + conversationId, messageId: 'message-' + conversationId, text: 'reply'})
  for (const conversationId of ['foreign-sender', 'foreign-channel']) {
    await assert.rejects(transport.send(envelope(conversationId)), {code: 'WEB_DELIVERY_SCOPE_INVALID'})
    assert.throws(() => transport.readback(envelope(conversationId)), {code: 'WEB_DELIVERY_SCOPE_INVALID'})
    await assert.rejects(transport.readMessage(envelope(conversationId)), {code: 'WEB_MESSAGE_NOT_FOUND'})
    assert.equal(ledger.chat(conversationId).messages.length, 1)
  }
  assert.equal((await transport.send(envelope('own-history'))).visible, true)
  assert.equal((await transport.readMessage(envelope('own-history'))).senderId, 'operator')
})
