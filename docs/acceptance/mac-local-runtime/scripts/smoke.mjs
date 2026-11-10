import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {once} from 'node:events'
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {resolve, join} from 'node:path'
import {setTimeout} from 'node:timers/promises'

const repo = process.cwd()
const parent = join(repo, 'data/workspaces')
await mkdir(parent, {recursive: true})
const root = await mkdtemp(join(parent, 'mac-runtime-'))
const configFile = join(root, 'data/config/config.json')
const requests = []
let child, closed, output = '', shellAttempted = false, probeShell = false
const model = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  requests.push(body)
  const tools = body.tools?.map(tool => tool.function.name) ?? []
  let name, args
  if (tools.includes('task_result')) {
    if (probeShell && !shellAttempted) {
      assert.ok(tools.includes('bash'))
      shellAttempted = true
      name = 'bash'; args = {command: 'printf MAC_SHELL_PROBE', description: 'Print a harmless Mac runtime marker'}
    } else {
      name = 'task_result'; args = {decision: {action: 'complete', summary: 'MAC_TASK_RESULT', evidence: ['local HTTP objective'], limitations: ['Shell capability is assessed from its actual tool result, not task completion.']}}
    }
  } else if (tools.includes('resident_router_settle') && body.messages.at(-1)?.role !== 'tool') {
    const text = body.messages.flatMap(message => typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text))
    const line = text.toReversed().flatMap(value => value.split('\n')).find(value => value.startsWith('Router 请求：'))
    const input = JSON.parse(line.slice('Router 请求：'.length))
    name = 'resident_router_settle'; args = {eventIds: input.events.map(event => event.id), operationId: 'mac-settle-' + requests.length}
  }
  res.writeHead(200, {'content-type': 'text/event-stream'})
  const chunk = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({id: 'mac-local-' + requests.length, object: 'chat.completion.chunk', created: 1, model: 'mac-fixture', choices: [{index: 0, delta, finish_reason}]}) + '\n\n')
  if (name) {
    chunk({role: 'assistant', tool_calls: [{index: 0, id: 'mac-call-' + requests.length, type: 'function', function: {name, arguments: JSON.stringify(args)}}]})
    chunk({}, 'tool_calls')
  } else {chunk({role: 'assistant', content: JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION') ? '{"lessons":[]}' : 'Local observation complete.'}); chunk({}, 'stop')}
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
const reserve = async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
const run = async args => {
  const process = spawn(globalThis.process.execPath, args, {cwd: repo, stdio: ['ignore', 'pipe', 'pipe']})
  let result = ''
  process.stdout.on('data', value => result += value)
  process.stderr.on('data', value => result += value)
  assert.deepEqual(await once(process, 'close'), [0, null], result)
}
const poll = async read => {
  for (;;) {
    if (child?.exitCode !== null || child?.signalCode !== null) throw Error('Service exited: ' + output)
    const value = await read()
    if (value) return value
    await setTimeout(50)
  }
}
const corePort = await reserve(), webPort = await reserve()
const core = `http://127.0.0.1:${corePort}`, web = `http://127.0.0.1:${webPort}`
let cookie, csrf
const api = async (path, {method = 'GET', body, authenticated = true} = {}) => {
  const response = await fetch(web + path, {method, headers: {origin: web, ...(authenticated && cookie ? {cookie, 'x-csrf-token': csrf} : {}), ...(body ? {'content-type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})})
  return {status: response.status, response, body: await response.json()}
}
try {
  await run(['bin/night-bot-init.js', '--root', root, '--actor', 'mac-fixture-operator', '--provider', 'fixture', '--model', 'mac-fixture', '--key-env', 'MAC_RUNTIME_FIXTURE_KEY', '--base-url', `http://127.0.0.1:${model.address().port}/v1`, '--api', 'openai-completions'])
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  config.providers.fixture.models = [{id: 'mac-fixture', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 1024}]
  config.resident.port = corePort
  config.channelPluginDirs = [resolve(repo, 'packages')]
  config.channelPlugins = [{type: 'web-console', channelId: 'mac-local-web', enabled: true, config: {senderId: 'mac-fixture-operator', port: webPort}}]
  await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', {mode: 0o600})
  child = spawn(process.execPath, ['bin/night-bot-run.js', configFile], {cwd: repo, env: {...process.env, MAC_RUNTIME_FIXTURE_KEY: 'local-only-not-a-real-credential'}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']})
  child.stdout.on('data', value => output += value)
  child.stderr.on('data', value => output += value)
  closed = once(child, 'close')
  const health = await poll(async () => {
    try {const response = await fetch(core + '/health'); return response.ok && response.json()} catch {return false}
  })
  assert.equal(health.status, 'ok')
  const page = await fetch(web + '/')
  assert.equal(page.status, 200)
  const html = await page.text()
  for (const asset of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) assert.equal((await fetch(web + asset[1])).status, 200)
  assert.equal((await api('/api/tasks', {authenticated: false})).status, 401)
  const tokenFile = join(root, 'data/secrets', 'web-console-' + createHash('sha256').update('mac-local-web').digest('hex').slice(0, 16), 'access-token')
  const login = await api('/api/login', {method: 'POST', body: {token: (await readFile(tokenFile, 'utf8')).trim()}, authenticated: false})
  assert.equal(login.status, 200)
  cookie = login.response.headers.get('set-cookie').split(';')[0]
  csrf = login.body.csrfToken
  const permissions = await api('/api/permissions')
  assert.equal(permissions.status, 200)
  assert.equal(permissions.body.mode, 'ask')
  const createTask = async (requestId, objective) => {
    const response = await fetch(core + '/tasks', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({requestId, groupId: 'mac-local-scope', title: 'Mac runtime smoke', objective})})
    assert.equal(response.status, 200)
    const created = await response.json()
    const detail = await poll(async () => {
      const response = await fetch(core + '/state/tasks/' + created.taskId + '/detail')
      assert.equal(response.status, 200)
      const value = await response.json()
      return value.drained && (value.status === 'completed' || value.result?.action === 'blocked') ? value : false
    })
    return {created, detail}
  }
  const {created, detail} = await createTask('mac-runtime-task', 'Report the exact local task result without executing commands or sending any channel message.')
  assert.equal(detail.status, 'completed')
  assert.equal(detail.completion.result.summary, 'MAC_TASK_RESULT')
  const tasks = await api('/api/tasks')
  assert.equal(tasks.status, 200)
  assert.ok(tasks.body.items.some(task => task.taskId === created.taskId || task.id === created.taskId))
  probeShell = true
  const shell = await createTask('mac-runtime-shell', 'Run the harmless printf probe and report its observed outcome without sending any channel message.')
  assert.ok(shellAttempted)
  const observedTools = requests.flatMap(request => request.messages).filter(message => message.role === 'tool').map(message => message.content)
  const shellPassed = observedTools.some(value => String(value).includes('MAC_SHELL_PROBE'))
  console.log(JSON.stringify({installRoot: root, core, web, health: health.status, staticAssets: 'PASS', unauthenticatedStatus: 401, loginStatus: login.status, mode: permissions.body.mode, protection: permissions.body.protection, taskStatus: detail.status, drained: detail.drained, modelRequests: requests.length, shellTaskId: shell.created.taskId, shellStatus: shell.detail.status, shellDrained: shell.detail.drained, shellResult: shell.detail.result, shellCheck: shellPassed ? 'PASS' : 'FAIL'}, null, 2))
  if (!shellPassed) process.exitCode = 1
  child.send({type: 'night-bot-shutdown'})
  assert.deepEqual(await closed, [0, null], output)
  assert.equal(await fetch(core + '/health').then(() => true, () => false), false)
  assert.equal(await fetch(web + '/').then(() => true, () => false), false)
  console.log('PASS: managed shutdown exited 0 and both listeners closed; isolated installation retained, no real vendor calls.')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {child.send({type: 'night-bot-shutdown'}); await closed}
  await new Promise(resolve => model.close(resolve))
}
