import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {memoryHost} from '../../../test/fixtures/memory-host.js'
import {nativeTestTimeout} from '../../../test/fixtures/native-lifecycle.js'
import {requestEnvelope, requestTools, eventually} from '../../../test/fixtures/resident-router-host.js'
import {createHost} from '../../../src/host.js'
import {apply as applyApplication, inject} from '../../../src/application.js'

async function availablePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test('discovered Web plugin reaches real channel triage and durable reply readback; restart preserves one delivery', {timeout: nativeTestTimeout(45000)}, async t => {
  const f = await memoryHost(t, body => {
    if (!requestTools(body).includes('channel_triage_submit')) return {text: 'No task execution requested'}
    const input = requestEnvelope(body, '一级分诊请求：')
    return {tool: 'channel_triage_submit', args: {dispositions: input.messages.map(message => ({
      sourceId: message.sourceId, messageVersion: message.version ?? message.messageVersion,
      needsHandling: false, reason: 'Local verified greeting only', reply: '你好，Web 渠道已收到这条消息。',
    }))}}
  })
  await f.close()
  const channelId = 'web-integration', senderId = 'configured-web-operator', port = await availablePort()
  const config = {...f.config,
    channelPluginDirs: [fileURLToPath(new URL('../../', import.meta.url))],
    channelPlugins: [{type: 'web-console', enabled: true, channelId, config: {senderId, port}}],
    resident: {port: 0, taskSessions: {instanceId: 'web-integration', ownerActorId: 'fixture-owner', webActorId: 'fixture-owner', ingressEpoch: '2026-01-01T00:00:00Z', initialize: true, reasoningMode: 'inherit'}},
  }
  const origin = 'http://127.0.0.1:' + port
  let host, app, cookie, csrfToken
  const boot = async () => {
    host = await createHost(config, {environmentOptions: {inherited: {MEMORY_FIXTURE_KEY: 'local-fixture'}}})
    assert.ok(host.ctx.channels.transports.has(channelId), 'delivery transport must exist before application recovery, while HTTP ingress still waits for ready')
    await host.ctx.plugin({inject, apply: ctx => applyApplication(ctx, config)})
    app = host.ctx.get('application')
  }
  const api = async (path, body) => {
    const response = await fetch(origin + path, {method: body === undefined ? 'GET' : 'POST', headers: {origin,
      ...(cookie ? {cookie} : {}), ...(csrfToken ? {'x-csrf-token': csrfToken} : {}), ...(body === undefined ? {} : {'content-type': 'application/json'}),
    }, ...(body === undefined ? {} : {body: JSON.stringify(body)})})
    return {response, body: await response.json()}
  }
  const login = async () => {
    const namespace = 'web-console-' + createHash('sha256').update(channelId).digest('hex').slice(0, 16)
    const token = (await readFile(join(host.ctx.runtimePaths.secrets, namespace, 'access-token'), 'utf8')).trim()
    const result = await api('/api/login', {token})
    assert.equal(result.response.status, 200, JSON.stringify(result.body))
    cookie = result.response.headers.get('set-cookie').split(';')[0]
    csrfToken = result.body.csrfToken
  }
  try {
    await boot(); await login()
    assert.ok(host.ctx.channels.transports.has(channelId), 'real plugin discovery must register its channel transport')
    assert.equal(host.ctx.get('dingtalkChannel'), undefined)
    const input = {conversationId: 'web-chat', requestId: 'web-greeting', text: '你好，请确认收到。'}
    const result = await api('/api/chat', input)
    assert.equal(result.response.status, 202, JSON.stringify(result.body)); assert.equal(result.body.accepted, true)
    await eventually(async () => (await api('/api/chat/web-chat')).body.messages.some(message => message.role === 'assistant'), 'durable Web reply', t.signal)
    await app.tasks.whenIdle()
    const actual = (await api('/api/chat/web-chat')).body
    assert.equal(actual.messages.filter(message => message.role === 'assistant').length, 1)
    assert.equal(actual.messages.find(message => message.role === 'assistant').text, '你好，Web 渠道已收到这条消息。')
    const sources = await app.tasks.store.query({kind: 'source.list'})
    const source = sources.find(value => value.messageId === input.requestId)
    assert.equal(source.text, input.text)
    const identity = host.ctx.channels.identity({type: 'chat', channelId, senderId, conversationId: input.conversationId, messageId: input.requestId, text: input.text})
    assert.equal(source.actorId, identity.principal)
    assert.equal(source.groupId, identity.sessionId)
    const notifications = await app.tasks.store.query({kind: 'notification.list'})
    assert.equal(notifications.length, 1); assert.equal(notifications[0].state, 'delivered')
    assert.equal((await app.tasks.store.query({kind: 'task.list'})).length, 0, 'a greeting does not manufacture a task')
    const conversations = (await api('/api/conversations')).body.items
    assert.ok(conversations.some(row => row.id === identity.sessionId && row.type === 'chat' && row.channelId === channelId))
    const channelMessages = (await api('/api/conversations/' + identity.sessionId + '/messages')).body.items
    assert.ok(channelMessages.some(row => row.role === 'user' && row.text === input.text))
    assert.ok(channelMessages.some(row => row.role === 'assistant' && row.status === 'delivered'))
    assert.equal((await api('/api/tasks')).body.total, 0)
    const requestCount = f.requests.length
    const channels = host.ctx.channels
    await host.close(); host = undefined
    assert.equal(channels.transports.has(channelId), false, 'Host stop must release optional HTTP transport')
    cookie = undefined; csrfToken = undefined
    config.resident.taskSessions.initialize = false
    await boot(); await login()
    const duplicate = await api('/api/chat', input)
    assert.equal(duplicate.response.status, 202); assert.equal(duplicate.body.duplicate, true)
    await app.tasks.whenIdle()
    assert.equal(f.requests.length, requestCount, 'the original request is read back without rerunning triage')
    assert.equal((await api('/api/chat/web-chat')).body.messages.filter(message => message.role === 'assistant').length, 1)
    assert.equal((await app.tasks.store.query({kind: 'notification.list'})).length, 1)

    // Preserve a real prepared notification across shutdown. Only transport
    // availability is removed; real triage/admission and delivery gates remain.
    host.ctx.channels.transports.delete(channelId)
    const pendingInput = {conversationId: 'web-chat', requestId: 'pending-greeting', text: '这条回复在恢复渠道后送达。'}
    assert.equal((await api('/api/chat', pendingInput)).body.accepted, true)
    const prepared = await eventually(async () => (await app.tasks.store.query({kind: 'notification.list'}))
      .find(value => value.payload.sourceMessageId === pendingInput.requestId && value.state === 'prepared'), 'prepared reply while transport unavailable', t.signal)
    await app.tasks.whenIdle()
    assert.equal(prepared.sendAttemptCount ?? 0, 0, 'unavailable transport must not claim a send')
    const beforeRecoveryRequests = f.requests.length
    await host.close(); host = undefined; cookie = undefined; csrfToken = undefined
    await boot(); await login()
    await eventually(async () => (await app.tasks.store.query({kind: 'notification.get', notificationId: prepared.id}))?.state === 'delivered', 'automatic delivery recovery after restart', t.signal)
    await app.tasks.whenIdle()
    assert.equal(f.requests.length, beforeRecoveryRequests, 'restoring a prepared delivery cannot rerun the original message')
    const recovered = (await api('/api/chat/web-chat')).body.messages.filter(message => message.role === 'assistant')
    assert.equal(recovered.length, 2)
    assert.equal((await app.tasks.store.query({kind: 'notification.list'})).length, 2)
  } finally {await host?.close()}
})
