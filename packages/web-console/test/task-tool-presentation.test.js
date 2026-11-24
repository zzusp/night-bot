import {test} from 'node:test'
import assert from 'node:assert/strict'
import {taskToolPresentation as project} from '../src/task-tool-presentation.ts'

test('todo_write uses provided order, exact titles and counts from the disclosed list', () => {
  const todos = [{content:'核对主版本',status:'pending'},{content:'校验结果',status:'in_progress'},{content:'整理说明',status:'completed'}]
  assert.deepEqual(project('todo_write',JSON.stringify({todos,counts:{pending:999}})),
    {kind:'todos',todos,counts:{pending:1,in_progress:1,completed:1}})
  assert.deepEqual(project('todo_write','{"todos":[]}'), {kind:'todos',todos:[],counts:{pending:0,in_progress:0,completed:0}})
  assert.equal(project('todo_write','{"todos":[{"content":"步骤","status":"failed"}]}'),null)
  assert.equal(project('todo_write','{"todos":[{"status":"completed"}]}'),null)
})
test('task_result presents requested action and allowlisted text without implying successful execution', () => {
  const text = JSON.stringify({decision:{action:'complete',summary:'待复核结论',question:'确认吗？',evidence:['测试通过'],limitations:['未上线'],
    deliveryFiles:[{caption:'验证报告',path:'/private/artifact',token:'PRIVATE'}],secret:'PRIVATE'},status:'failed',ok:false})
  const result = project('task_result',text)
  assert.deepEqual(result,{kind:'task-result',action:'complete',summary:'待复核结论',question:'确认吗？',evidence:['测试通过'],limitations:['未上线'],files:['验证报告']})
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|failed|\/private/)
})
test('malformed, unrelated and undisclosed inputs preserve ordinary tool fallback', () => {
  assert.equal(project('task_result','{"decision":'),null)
  assert.equal(project('task_result','{"decision":{"artifactIds":["private"]}}'),null)
  assert.equal(project('read','{"decision":{"summary":"不解析"}}'),null)
})
