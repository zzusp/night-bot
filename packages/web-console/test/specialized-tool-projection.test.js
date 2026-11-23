import test from 'node:test'
import assert from 'node:assert/strict'
import {routerSessionView, taskSessionView} from '../server/session-view.js'

const name = 'resident_task_lookup_async'
const project = (id, message) => ({sourceEntry: {id, type: 'message', timestamp: '2026-11-23T10:00:00Z'}, messages: [message]})
const call = (id, toolName = name, args = {taskIds: ['PRIVATE_TASK_A','PRIVATE_TASK_B'], sourceId: 'PRIVATE_SOURCE', operationId: 'PRIVATE_OPERATION', messageVersion: 1}) => project('call-'+id, {role: 'assistant', content: [{type: 'toolCall', id, name: toolName, arguments: args}]})
const result = (id, toolName = name, extra = {}) => project('result-'+id, {role: 'toolResult', toolCallId: id, toolName, isError: false,
  content: [{type: 'text', text: JSON.stringify({lookupId: 'PRIVATE_LOOKUP', status: 'pending', readOnly: true, summary: 'PRIVATE_SUMMARY', taskIds: ['PRIVATE_TASK_A']})}],
  details: {kind: 'pi-web-subagent', sessionId: 'PRIVATE_CHILD_SESSION', profile: 'PRIVATE_PROFILE', description: 'PRIVATE_CHILD_NAME'}, ...extra})
function fixture(entries) {
  const router = {id: 'conversation-one', activeSessionId: 'router-session', generation: 1, phase: 'idle'}
  const snapshot = {header: {id: router.activeSessionId, runtimeOwner: 'conversation-router', conversationId: router.id, generation: 1}, entries: [{id: 'commit-one'}], context: {projection: {entries}}}
  return {router, snapshot, options: {conversationId: router.id, readRouter: async () => router, persistence: {readNative: async () => snapshot}}}
}

test('authorized Router projection exposes only task count and literal read-only lookup receipt', async () => {
  const f = fixture([call('lookup'), result('lookup')]), before = structuredClone(f.snapshot)
  const page = await routerSessionView(f.options)
  assert.equal(page.status, 'ready')
  assert.equal(page.items.length, 2)
  assert.deepEqual(JSON.parse(page.items[0].text), {taskCount: 2})
  assert.deepEqual(JSON.parse(page.items[1].text), {status: 'pending', readOnly: true})
  assert.equal(page.items[0].callId, page.items[1].callId)
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|pi-web-subagent|profile|lookupId|readOnlyLookupSession/)
  assert.deepEqual(f.snapshot, before)
})

test('orphan/duplicate/name-mismatched/failed results cannot borrow specialized lookup projection', async () => {
  for (const entries of [
    [result('missing')],
    [call('same'), {...call('same'), sourceEntry: {id: 'duplicate', type: 'message'}}, result('same')],
    [call('wrong','memory_read',{key:'PRIVATE_KEY'}),result('wrong')],
    [call('failed'),result('failed',name,{isError:true})],
  ]) {
    const page = await routerSessionView(fixture(entries).options)
    const outputs = page.items.filter(row => row.kind === 'tool-result')
    assert.ok(outputs.length)
    assert.ok(outputs.every(row => !row.text.includes('readOnly') && !row.text.includes('"pending"')))
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|pi-web-subagent|profile/)
  }
})

test('task history and invented child details do not acquire Router lookup or child-session reads', async () => {
  const task = {taskId: 'task-one', session: {sessionId: 'task-session', sessionBound: true}}
  const snapshot = {header:{id:'task-session'},entries:[{id:'commit'}],audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-one',sessionId:'task-session'}}],context:{projection:{entries:[call('lookup'),result('lookup'),call('child','subagent',{description:'PRIVATE_DESCRIPTION'}),result('child','subagent')]}}}
  const page = await taskSessionView({task,persistence:{readNative:async()=>snapshot}})
  assert.ok(page.items.every(row => !row.text.includes('taskCount') && !row.text.includes('readOnly')))
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|pi-web-subagent|profile/)
  assert.equal(page.items.find(row => row.toolName === 'subagent').toolName, 'subagent')
})

test('memory/skill private catalogs and facts stay behind their independent content authorization', async () => {
  const entries = ['memory_read','memory_search','skill','resident_memory_remember','resident_skill_query','resident_skill_mutate'].flatMap((tool,index) => [
    call(String(index),tool,{topic:'PRIVATE_TOPIC',key:'PRIVATE_KEY',query:'PRIVATE_QUERY',name:'PRIVATE_SKILL',body:'PRIVATE_BODY'}),
    result(String(index),tool,{content:[{type:'text',text:'PRIVATE_FACTS_AND_CATALOG'}]}),
  ])
  const page = await routerSessionView(fixture(entries).options)
  assert.equal(page.items.length, entries.length)
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|pi-web-subagent|profile/)
})

test('Router identity revalidation rejects changed generation before specialized content can return', async () => {
  const f = fixture([call('lookup'),result('lookup')]);let reads=0
  await assert.rejects(routerSessionView({...f.options,readRouter:async()=>++reads===1?f.router:{...f.router,generation:2}}),{code:'SESSION_PAGE_STALE'})
  f.snapshot.header.conversationId = 'other-conversation'
  await assert.rejects(routerSessionView(f.options),{code:'SESSION_IDENTITY_INVALID'})
})
