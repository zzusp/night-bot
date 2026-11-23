import test from 'node:test'
import assert from 'node:assert/strict'
import {specializedToolInput, specializedToolOutput} from '../server/specialized-tool-activity.js'
import {specializedToolPresentation, specializedToolLabel, specializedToolSummary, hasSpecializedToolContent} from '../src/specialized-tool-content.ts'

const name = 'resident_task_lookup_async'
const identity = {sessionId: 'router-session', conversationId: 'conversation', generation: 1}

test('Router lookup input projects only requested count, never identity or task names', () => {
  const args = {taskIds: ['PRIVATE_TASK_A', 'PRIVATE_TASK_B'], operationId: 'PRIVATE_OPERATION', sourceId: 'PRIVATE_SOURCE', messageVersion: 12}
  Object.defineProperty(args, 'privateDetails', {enumerable: true, get() {throw Error('must not inspect unknown fields')}})
  const value = specializedToolInput(name, args, identity)
  assert.deepEqual(JSON.parse(value.text), {taskCount: 2})
  assert.equal(value.redacted, true)
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_/)
  for (const taskIds of [[], ['a','b','c','d'], ['a','a'], [null], [' '], 'a']) {
    assert.equal(specializedToolInput(name, {taskIds}, identity), null)
  }
})

test('lookup metadata requires Router scope, never grants task/subagent/memory reads', () => {
  for (const invalid of [undefined, {}, {...identity, taskId: 'task'}, {...identity, taskId: ''}, {...identity, generation: 0}, {...identity, conversationId: ''}, {...identity, sessionId: ''}]) {
    assert.equal(specializedToolInput(name, {taskIds: ['a']}, invalid), null)
    assert.equal(specializedToolOutput(name, {status: 'pending', readOnly: true}, invalid), null)
  }
  for (const tool of ['memory_read', 'skill', 'resident_skill_query', 'subagent', 'task_delegate', 'resident_task_lookup_async_other']) {
    assert.equal(specializedToolInput(tool, {taskIds: ['a']}, identity), null)
    assert.equal(specializedToolOutput(tool, {status: 'completed', readOnly: true}, identity), null)
  }
})

test('lookup receipt selects enums only and does not inspect private child/snapshot details', () => {
  for (const status of ['pending','completed','failed','timed-out','interrupted']) {
    const raw = {status, readOnly: true, lookupId: 'PRIVATE_LOOKUP', summary: 'PRIVATE_SUMMARY', snapshots: [{title: 'PRIVATE_TITLE'}], sessionId: 'PRIVATE_CHILD'}
    Object.defineProperty(raw, 'details', {enumerable: true, get() {throw Error('private details accessed')}})
    const result = specializedToolOutput(name, raw, identity)
    assert.deepEqual(JSON.parse(result.text), {status, readOnly: true})
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|sessionId|snapshots|summary/)
  }
  for (const raw of [null, [], 'pending', {status: 'pending'}, {status: 'pending', readOnly: false}, {status: 'PRIVATE_STATUS', readOnly: true}]) {
    assert.equal(specializedToolOutput(name, raw, identity), null)
  }
})

test('specialized kinds use exact known tool names, never infer a child-session capability', () => {
  for (const tool of ['skill', 'memory_index', 'memory_read', 'memory_search', 'resident_memory_reconcile', 'resident_skill_mutate', name]) assert.equal(hasSpecializedToolContent(tool), true)
  for (const tool of ['subagent', 'task_delegate', '__proto__', 'constructor', 'plugin_memory_read', 'memory_secret_custom']) {
    assert.equal(hasSpecializedToolContent(tool), false)
    assert.equal(specializedToolPresentation({toolName: tool, phase: 'output', text: 'public text'}), null)
  }
  assert.equal(specializedToolLabel(name), '后台只读查询')
  assert.equal(specializedToolLabel('resident_skill_mutate'), '维护技能')
})

test('accepted lookup remains waiting even though the submitting tool has returned', () => {
  const input = specializedToolPresentation({toolName: name, phase: 'input', text: '{"taskCount":3}'})
  assert.deepEqual(input.fields, [{label: '请求范围', value: '3 项任务'}])
  const pending = specializedToolPresentation({toolName: name, phase: 'output', text: '{"status":"pending","readOnly":true}'})
  assert.deepEqual(pending.fields, [{label: '查询状态', value: '已接纳，等待结果'}, {label: '权限', value: '只读'}])
  assert.doesNotMatch(JSON.stringify(pending), /已完成|执行中|进度|session|href/)
})

test('only a complete paired public result replaces the header tool status with query status', () => {
  const output = {text:'{"status":"pending","readOnly":true}', status:'completed'}
  assert.deepEqual(specializedToolSummary(name, output), {label:'等待查询结果',tone:'neutral'})
  for(const change of [{isError:true},{status:'error'},{status:'running'},{transient:true},{truncated:true},{textNextOffset:10},{textTotal:1000},{text:'{"status":"pending","readOnly":true,"private":"extra"}'}]) {
    assert.equal(specializedToolSummary(name,{...output,...change}),null)
  }
  for(const tool of ['subagent','memory_read','resident_skill_query'])assert.equal(specializedToolSummary(tool,output),null)
  for(const status of ['completed','failed','timed-out','interrupted'])assert.match(specializedToolSummary(name,{...output,text:JSON.stringify({status,readOnly:true})}).label,/^查询/)
})

test('failure/cancel status is about the query, not the referenced business task', () => {
  for (const [status, label] of [['failed','查询失败'],['timed-out','查询超时'],['interrupted','查询已中断'],['completed','查询已完成']]) {
    const result = specializedToolPresentation({toolName: name, phase: 'output', text: JSON.stringify({status, readOnly: true})})
    assert.equal(result.fields[0].value, label)
  }
})

test('paging, errors, unknown fields and partial JSON keep exact already-public text', () => {
  const texts = ['<script>not markup</script>', '{"taskCount":2,"future":"public-extra"}', '{"taskCount":', '{"taskCount":0}', '{"status":"unknown","readOnly":true}', '']
  for (const text of texts) {
    const value = specializedToolPresentation({toolName: name, phase: 'input', text})
    assert.equal(value.text, text)
    assert.deepEqual(value.fields, [])
  }
  const text = '{"status":"pending","readOnly":true}'
  for (const extra of [{offset: 16000}, {isError: true}]) assert.equal(specializedToolPresentation({toolName: name, phase: 'output', text, ...extra}).text, text)
})

test('memory and skill display never manufacture target names, body text or persisted success', () => {
  for (const toolName of ['memory_read','memory_forget','resident_skill_mutate','resident_memory_remember']) {
    const input = specializedToolPresentation({toolName, phase: 'input', text: '{}'})
    assert.equal(input.fields[0].label, '操作')
    assert.doesNotMatch(JSON.stringify(input), /已保存|已删除|已完成|href|sessionId/)
    const text = '此工具涉及独立的记忆或技能读取权限，请通过记忆与技能入口查看获权正文。'
    assert.equal(specializedToolPresentation({toolName, phase: 'output', text}).text, text)
  }
})
