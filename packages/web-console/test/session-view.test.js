import test from 'node:test'
import assert from 'node:assert/strict'
import {taskSessionView} from '../server/session-view.js'

const task = {taskId: 'task-one', session: {sessionId: 'pi-one', sessionBound: true}}
const project = (id, message) => ({sourceEntry: {id, type: 'message', timestamp: '2026-11-07T02:00:00Z'}, messages: [message]})
function snapshot() {
  return {header: {id: 'pi-one'}, entries: [{id: 'commit-one'}],
    audit: [{domain: 'task', kind: 'identity', version: 1, payload: {taskId: 'task-one', sessionId: 'pi-one'}}],
    context: {projection: {entries: [
      project('system', {role: 'system', content: 'PRIVATE_SYSTEM_PROMPT'}),
      project('input', {role: 'custom', customType: 'night.business-input', details: {source: {kind: 'task-input', taskSession: {taskId: 'task-one', sessionId: 'pi-one'}}},
        content: [{type: 'text', text: JSON.stringify({task: {request: '核对目标'}, sources: [{sourceId: 'source-one', version: 1, text: '用户原始来源'}], materials: [{path: 'D:\\private\\secret.txt'}], blockers: [{permissionToken: 'PRIVATE_PERMISSION'}]})}]}),
      project('assistant', {role: 'assistant', content: [{type: 'thinking', thinking: 'PRIVATE_THINKING'}, {type: 'text', text: '正在核对实际执行结果'}, {type: 'toolCall', name: 'read', id: 'call-one', arguments: {apiKey: 'PRIVATE_ARGUMENT', path: 'D:\\private\\file'}}]}),
      project('result', {role: 'toolResult', toolName: 'read', toolCallId: 'call-one', isError: false, details: {secret: 'PRIVATE_DETAILS'}, content: [{type: 'text', text: JSON.stringify({summary: '已有结果', credentials: {value: 'PRIVATE_CREDENTIAL'}, path: 'D:\\private\\file', permissionToken: 'PRIVATE_TOKEN'})}]}),
    ]}},
  }
}

test('execution view uses task-bound strict Pi projection and excludes private system/thinking/parameters/materials', async () => {
  const value = snapshot(), calls = []
  const persistence = {async readNative(id, options) {calls.push({id, options}); return value}}
  const result = await taskSessionView({task, persistence})
  assert.deepEqual(calls, [{id: 'pi-one', options: {requireComplete: true}}])
  assert.equal(result.status, 'ready'); assert.equal(result.scope, 'current-session-context')
  assert.equal(result.items.length, 4)
  assert.equal(result.items[0].text, '用户原始来源')
  assert.equal(result.items.find(row => row.kind === 'tool-call').toolName, 'read')
  assert.match(result.items.find(row => row.kind === 'tool-result').text, /已有结果/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|D:\\\\private|materials|blockers|arguments|thinking/)
  assert.equal(result.items.find(row => row.kind === 'tool-result').redacted, true)
  assert.deepEqual(value, snapshot(), 'reading does not mutate Pi projection or its journal snapshot')
})

test('session pages keep revision identity and latest-first pages without claiming raw complete history', async () => {
  const value = snapshot(), persistence = {readNative: async () => value}
  const first = await taskSessionView({task, persistence, limit: 2})
  assert.equal(first.items.length, 2); assert.equal(first.nextOffset, 2)
  const older = await taskSessionView({task, persistence, offset: 2, limit: 2, revision: first.revision})
  assert.equal(older.items[0].text, '用户原始来源'); assert.equal(older.nextOffset, null)
  value.entries.push({id: 'next-commit'})
  await assert.rejects(taskSessionView({task, persistence, offset: 2, limit: 2, revision: first.revision}), {code: 'SESSION_PAGE_STALE'})
  await assert.rejects(taskSessionView({task, persistence, limit: 51}), {code: 'PAGE_INVALID'})
})

test('foreign task/session identities fail closed before exposing messages', async () => {
  for (const mutate of [value => {value.header.id = 'foreign'}, value => {value.audit[0].payload.taskId = 'foreign'}, value => {value.audit.push(value.audit[0])}, value => {value.context.projection.entries[1].messages[0].details.source.taskSession.taskId = 'foreign'}]) {
    const value = snapshot(); mutate(value)
    await assert.rejects(taskSessionView({task, persistence: {readNative: async () => value}}), error => ['SESSION_IDENTITY_INVALID', 'SESSION_SOURCE_IDENTITY_INVALID'].includes(error.code))
  }
})

test('uncommitted tails, absent not-yet-started sessions and unreadable journals remain explicit without replay', async () => {
  for (const code of ['PI_SESSION_UNCOMMITTED_TAIL', 'PI_SESSION_COMMIT_REQUIRED']) {
    const result = await taskSessionView({task, persistence: {readNative: async () => {throw Object.assign(new Error('private path'), {code})}}})
    assert.equal(result.status, 'pending'); assert.equal(result.reason, 'SESSION_COMMIT_PENDING'); assert.deepEqual(result.items, [])
  }
  const missing = {readNative: async () => {throw Object.assign(new Error('private path'), {name: 'SessionPersistenceNotFoundError'})}}
  assert.equal((await taskSessionView({task: {...task, session: {...task.session, sessionBound: false}}, persistence: missing})).reason, 'SESSION_NOT_STARTED')
  const unavailable = await taskSessionView({task, persistence: missing})
  assert.equal(unavailable.status, 'unavailable'); assert.doesNotMatch(JSON.stringify(unavailable), /private path/)
})
