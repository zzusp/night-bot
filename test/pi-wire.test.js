import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, get, request } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createHost } from '../src/host.js'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const jsonGet = url => new Promise((resolve, reject) => get(url, response => {
  let body = ''; response.on('data', chunk => { body += chunk }); response.on('end', () => {
    try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
  })
}).on('error', reject))

const jsonPut = (url, value) => new Promise((resolve, reject) => {
  const body = JSON.stringify(value), req = request(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
    let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => {
      try { resolve({ status: response.statusCode, body: JSON.parse(text) }) } catch (error) { reject(error) }
    })
  }); req.on('error', reject); req.end(body)
})

test('Pi loop executes a real local OpenAI-compatible wire request, tool, and follow-up', { timeout: 20000 }, async t => {
  const root = await mkdtemp('/tmp/night-pi-wire-'), requests = []
  let host
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    requests.push(JSON.parse(raw))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'fixture-completion', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
      choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
    if (requests.length === 1) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'echo', arguments: '{"text":"wire-value"}' } }] })
      chunk({}, 'tool_calls')
    } else { chunk({ role: 'assistant', content: 'wire verified' }); chunk({}, 'stop') }
    res.end('data: [DONE]\n\n')
  })
  t.after(async () => { try { await host?.close() } finally { await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); delete process.env.NIGHT_BOT_WIRE_TEST_KEY } })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  process.env.NIGHT_BOT_WIRE_TEST_KEY = 'fixture-key-local-only'
  host = await createHost({ stateDir: join(root, 'state'), workspaceDir: join(root, 'work'),
    model: { provider: 'fixture', model: 'fixture-model' },
    providers: { fixture: { api: 'openai-completions', apiKeyEnv: 'NIGHT_BOT_WIRE_TEST_KEY', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      models: [{ id: 'fixture-model', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 1024 }] } } })
  const handle = await host.ctx.agents.create({ sessionId: 'wire-session', agentOptions: { provider: 'fixture', model: 'fixture-model' },
    meta: { cwd: join(root, 'work') }, setup: async c => { c.tools.register({ name: 'echo', description: 'Echo exact text',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: value.text }] }, execute: async args => args }) } })
  assert.equal(handle.agent.constructor.name, 'PiLoopAgent')
  assert.equal(host.ctx.get('nativePiProvider').adapter.constructor.name, 'NativePiProvider')
  handle.agent.session.deriveMessages = () => { throw new Error('Legacy DSH context derivation must not serve model requests') }
  assert.equal(host.ctx.get('piAuthority').describe('wire-session').engine, 'pi-session-manager')
  handle.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Echo wire-value using echo.' }] }))
  await handle.agent.whenIdle()
  const events = handle.agent.session.snapshotEvents()
  assert.equal(events.findLast(e => e.type === 'turn/end').data.reason.kind, 'completed', JSON.stringify(events.findLast(e => e.type === 'turn/end').data.reason))
  assert.equal(requests.length, 2)
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'echo'))
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.content.includes('wire-value')))
  assert.equal(events.filter(e => e.type === 'tool/call').length, 1)
  assert.equal(events.filter(e => e.type === 'tool/result').length, 1)
  await handle.dispose()
})

test('headless CLI starts, serves health, and drains on SIGTERM with DingTalk disabled', { timeout: 20000 }, async t => {
  const root = await mkdtemp('/tmp/night-pi-cli-')
  const portServer = createServer(); await new Promise(r => portServer.listen(0, '127.0.0.1', r))
  const port = portServer.address().port; await new Promise(r => portServer.close(r))
  const config = { stateDir: join(root, 'state'), workspaceDir: join(root, 'work'), model: { provider: 'fixture', model: 'first' }, providers: { fixture: { api: 'openai-completions', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'first' }, { id: 'second' }] } },
    resident: { port, dws: { enabled: false, writesAuthorized: false }, taskSessions: { instanceId: 'cli-fixture', ownerActorId: 'fixture-owner', webActorId: 'fixture-owner', ingressEpoch: '2026-11-04T00:00:00Z', initialize: true } } }
  const path = join(root, 'config.json'); await writeFile(path, JSON.stringify(config))
  let child = spawn(process.execPath, ['bin/night-bot.js', path], { cwd: process.cwd(), stdio: ['ignore','pipe','pipe'] })
  let output = ''; child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  let exited = once(child, 'exit')
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; await rm(root, { recursive: true, force: true }) })
  let health
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail('CLI exited: ' + output)
    try { health = await jsonGet(`http://127.0.0.1:${port}/health`); break } catch {}
    await new Promise(r => setTimeout(r, 50))
  }
  assert.equal(health?.status, 'ok', output)
  assert.equal(health.transport, 'fake-dws')
  const saved = await jsonPut(`http://127.0.0.1:${port}/config/agent`, { provider: 'fixture', model: 'second' })
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.model, 'second')
  child.kill('SIGTERM'); const [code] = await exited
  assert.equal(code, 0, output)
  child = spawn(process.execPath, ['bin/night-bot.js', path], { cwd: process.cwd(), stdio: ['ignore','pipe','pipe'] })
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b }); exited = once(child, 'exit')
  let restored
  const restartDeadline = Date.now() + 10000
  while (Date.now() < restartDeadline) {
    if (child.exitCode !== null) assert.fail('Restart exited: ' + output)
    try { restored = await jsonGet(`http://127.0.0.1:${port}/state/agent-config`); break } catch {}
    await new Promise(r => setTimeout(r, 50))
  }
  assert.equal(restored?.model, 'second', output)
  child.kill('SIGTERM'); const [restartedCode] = await exited; assert.equal(restartedCode, 0, output)
})
