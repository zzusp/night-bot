import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// Exercise the production request helper, with only its clock/fetch controlled.
const source = ts.transpileModule(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText
const {api, ApiError, errorText, EVOLUTION_SNAPSHOT_TIMEOUT_MS} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

function clock(t) {
  t.mock.timers.enable({apis: ['setTimeout']})
  const budgets = []
  t.mock.method(AbortSignal, 'timeout', ms => {
    budgets.push(ms)
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), ms)
    return controller.signal
  })
  return budgets
}
function pendingFetch(t, {body = false} = {}) {
  const requests = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const {signal} = options
    const pending = new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, {once: true})
      requests.push({url, signal, resolve: value => {
        signal.removeEventListener('abort', abort)
        resolve(body ? value : {ok: true, json: async () => value})
      }})
    })
    return body ? Promise.resolve({ok: true, json: () => pending}) : pending
  })
  return requests
}

test('ordinary APIs and evolution item bodies retain the 20-second deadline', async t => {
  const budgets = clock(t), requests = pendingFetch(t)
  const pending = ['/tasks', '/evolution/items/abc?revision=1'].map(path => assert.rejects(api(path), {name: 'TimeoutError'}))
  assert.deepEqual(budgets, [20000, 20000])
  t.mock.timers.tick(19999)
  assert.ok(requests.every(request => !request.signal.aborted))
  t.mock.timers.tick(1)
  await Promise.all(pending)
  assert.ok(requests.every(request => request.signal.aborted))
})

for (const path of ['/evolution?kind=memory', '/evolution?kind=skill&refresh=1']) {
  test(`${path} accepts a snapshot after 30 seconds without retrying`, async t => {
    const budgets = clock(t), requests = pendingFetch(t)
    const response = api(path, {timeoutMs: EVOLUTION_SNAPSHOT_TIMEOUT_MS})
    t.mock.timers.tick(30000)
    assert.deepEqual(budgets, [120000])
    assert.equal(requests.length, 1)
    assert.equal(requests[0].signal.aborted, false)
    requests[0].resolve({status: 'ready', items: []})
    assert.deepEqual(await response, {status: 'ready', items: []})
  })
}

test('snapshot wait is finite at 120 seconds and exposes an actionable timeout', async t => {
  clock(t)
  const requests = pendingFetch(t)
  const response = api('/evolution?kind=memory', {timeoutMs: EVOLUTION_SNAPSHOT_TIMEOUT_MS})
  const rejected = assert.rejects(response, error => {
    assert.equal(error.name, 'TimeoutError')
    assert.match(errorText(error), /连接超时/)
    return true
  })
  t.mock.timers.tick(119999)
  assert.equal(requests[0].signal.aborted, false)
  t.mock.timers.tick(1)
  await rejected
  assert.equal(requests.length, 1)
})

test('caller cancellation still ends a long snapshot wait immediately', async t => {
  clock(t)
  const requests = pendingFetch(t), controller = new AbortController()
  const rejected = assert.rejects(api('/evolution?kind=memory', {timeoutMs: EVOLUTION_SNAPSHOT_TIMEOUT_MS, signal: controller.signal}), {name: 'AbortError'})
  t.mock.timers.tick(30000)
  assert.equal(requests[0].signal.aborted, false)
  controller.abort()
  await rejected
  assert.equal(requests.length, 1)
})

test('snapshot deadline also covers a stalled response body without masking it as invalid JSON', async t => {
  clock(t)
  pendingFetch(t, {body: true})
  const rejected = assert.rejects(api('/evolution?kind=memory', {timeoutMs: EVOLUTION_SNAPSHOT_TIMEOUT_MS}), {name: 'TimeoutError'})
  await Promise.resolve()
  t.mock.timers.tick(120000)
  await rejected
})

test('malformed JSON without a cancellation still reports INVALID_RESPONSE', async t => {
  clock(t)
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => {throw new SyntaxError('invalid')}}))
  await assert.rejects(api('/tasks'), error => error instanceof ApiError && error.code === 'INVALID_RESPONSE')
})
