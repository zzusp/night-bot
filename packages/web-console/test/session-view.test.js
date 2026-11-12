import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleText, taskSessionView, taskSessionMessageView, routerSessionView} from '../server/session-view.js'

const task = {taskId: 'task-one', session: {sessionId: 'pi-one', sessionBound: true}}
const project = (id, message) => ({sourceEntry: {id, type: 'message', timestamp: '2026-11-07T02:00:00Z'}, messages: [message]})
function snapshot() {
  return {header: {id: 'pi-one'}, entries: [{id: 'commit-one'}],
    audit: [{domain: 'task', kind: 'identity', version: 1, payload: {taskId: 'task-one', sessionId: 'pi-one'}}],
    context: {projection: {entries: [
      project('system', {role: 'system', content: 'PRIVATE_SYSTEM_PROMPT'}),
      project('input', {role: 'custom', customType: 'night.business-input', details: {source: {kind: 'task-input', taskSession: {taskId: 'task-one', sessionId: 'pi-one'}}},
        content: [{type: 'text', text: JSON.stringify({task: {request: '核对目标'}, sources: [{sourceId: 'source-one', version: 1, text: '用户原始来源'}], materials: [{path: 'D:\\private\\secret.txt'}], blockers: [{permissionToken: 'PRIVATE_PERMISSION'}]})}]}),
      project('assistant', {role: 'assistant', content: [{type: 'thinking', thinking: '先核对任务材料，再比较实际结果', thinkingSignature: 'PRIVATE_SIGNATURE'}, {type: 'text', text: '正在核对实际执行结果'}, {type: 'toolCall', name: 'read', id: 'call-one', arguments: {apiKey: 'PRIVATE_ARGUMENT', path: 'D:\\private\\file'}}]}),
      project('result', {role: 'toolResult', toolName: 'read', toolCallId: 'call-one', isError: false, details: {secret: 'PRIVATE_DETAILS'}, content: [{type: 'text', text: JSON.stringify({summary: '已有结果', credentials: {value: 'PRIVATE_CREDENTIAL'}, path: 'D:\\private\\file', permissionToken: 'PRIVATE_TOKEN'})}]}),
    ]}},
  }
}

test('执行历史展示业务文字、路径和思考，排除系统、签名、秘密与私有元数据', async () => {
  const value = snapshot(), calls = []
  const persistence = {async readNative(id, options) {calls.push({id, options}); return value}}
  const result = await taskSessionView({task, persistence})
  assert.deepEqual(calls, [{id: 'pi-one', options: {requireComplete: true}}])
  assert.equal(result.status, 'ready'); assert.equal(result.scope, 'current-session-context')
  assert.equal(result.items.length, 5)
  assert.equal(result.items[0].text, '用户原始来源')
  assert.equal(result.items.find(row => row.kind === 'tool-call').toolName, 'read')
  assert.match(result.items.find(row => row.kind === 'tool-result').text, /已有结果/)
  assert.equal(result.items.find(row => row.kind === 'thinking').text, '先核对任务材料，再比较实际结果')
  assert.equal(JSON.parse(result.items.find(row => row.kind === 'tool-call').text).path, 'D:' + String.fromCharCode(92) + 'private' + String.fromCharCode(92) + 'file')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|materials|blockers|arguments|Signature/)
  assert.equal(result.items.find(row => row.kind === 'tool-result').redacted, true)
  assert.deepEqual(value, snapshot(), 'reading does not mutate Pi projection or its journal snapshot')
})

test('session pages keep revision identity and latest-first pages without claiming raw complete history', async () => {
  const value = snapshot(), persistence = {readNative: async () => value}
  const first = await taskSessionView({task, persistence, limit: 2})
  assert.equal(first.items.length, 2); assert.equal(first.nextOffset, 2)
  const older = await taskSessionView({task, persistence, offset: 2, limit: 3, revision: first.revision})
  assert.equal(older.items[0].text, '用户原始来源'); assert.equal(older.nextOffset, null)
  value.entries.push({id: 'next-commit'})
  await assert.rejects(taskSessionView({task, persistence, offset: 2, limit: 3, revision: first.revision}), {code: 'SESSION_PAGE_STALE'})
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


test('长正文按固定 revision 续读完整，跨 session、失效版本及越界不能读取', async () => {
  const text = '原始段落'.repeat(5000) + '😀正文终点', value = snapshot()
  value.context.projection.entries = [project('long', {role: 'assistant', content: [{type: 'text', text}]})]
  const persistence = {readNative: async () => value}, options = {task, persistence}
  const page = await taskSessionView(options), row = page.items[0]
  assert.equal(row.text, text.slice(0, 16000)); assert.equal(row.textTotal, text.length)
  assert.equal(row.textNextOffset, 16000); assert.equal(row.truncated, true)
  const body = {messageId: row.id, revision: page.revision, offset: row.textNextOffset}
  const next = await taskSessionMessageView({...options, ...body})
  assert.equal(row.text + next.text, text); assert.equal(next.nextOffset, null)
  assert.equal(next.source.sessionId, task.session.sessionId)
  for (const invalid of [{offset: text.length + 1}, {offset: -1}, {limit: 16001}, {revision: ''}]) {
    await assert.rejects(taskSessionMessageView({...options, ...body, ...invalid}), {code: 'PAGE_INVALID'})
  }
  const foreign = structuredClone(value)
  foreign.header.id = 'pi-other'; foreign.audit[0].payload = {taskId: 'task-other', sessionId: 'pi-other'}
  await assert.rejects(taskSessionMessageView({task: {taskId: 'task-other', session: {sessionId: 'pi-other'}},
    persistence: {readNative: async () => foreign}, messageId: row.id,
    revision: (await taskSessionView({task: {taskId: 'task-other', session: {sessionId: 'pi-other'}}, persistence: {readNative: async () => foreign}})).revision}), {code: 'SESSION_MESSAGE_NOT_FOUND'})
  value.entries.push({id: 'next-commit'})
  await assert.rejects(taskSessionMessageView({...options, ...body}), {code: 'SESSION_PAGE_STALE'})
})

test('厂商复用 callId 的不同轮次保持精确配对，未配对重复 ID 不猜归属', async () => {
  const value = snapshot()
  const call = id => project(id, {role: 'assistant', content: [{type: 'toolCall', id: 'vendor-reused', name: 'read', arguments: {query: id}}]})
  const result = id => project(id, {role: 'toolResult', toolName: 'read', toolCallId: 'vendor-reused', content: [{type: 'text', text: id}]})
  value.context.projection.entries = [call('call-1'), result('result-1'), call('call-2'), result('result-2'), call('pending-1'), call('pending-2'), result('ambiguous')]
  const rows = (await taskSessionView({task, persistence: {readNative: async () => value}})).items
  assert.equal(rows.length, 7)
  assert.equal(rows[0].callId, rows[1].callId); assert.equal(rows[2].callId, rows[3].callId)
  assert.notEqual(rows[0].callId, rows[2].callId)
  assert.notEqual(rows[6].callId, rows[4].callId); assert.notEqual(rows[6].callId, rows[5].callId)
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.callId) && row.source.callId === row.callId))
})

test('Router 执行记录绑定真实会话与 generation，异步读取中换代或跨会话来源失败关闭', async () => {
  const router = {id: 'conversation-one', activeSessionId: 'pi-router', generation: 2, phase: 'active'}
  const value = {header: {id: 'pi-router', runtimeOwner: 'conversation-router', conversationId: router.id, generation: 2},
    entries: [{id: 'router-commit'}], context: {projection: {entries: [project('router-source', {role: 'custom', customType: 'night.business-input',
      details: {source: {kind: 'conversation-router', conversationId: router.id, generation: 2}},
      content: [{type: 'text', text: 'Router 请求：' + JSON.stringify({conversationId: router.id, generation: 2, events: [
        {source: {sourceId: 'actual-source', version: 1, conversationId: router.id, text: '同一会话原始来源'}}]})}]})]}}}
  const options = {conversationId: router.id, readRouter: async () => router, persistence: {readNative: async () => value}}
  const page = await routerSessionView(options)
  assert.equal(page.scope, 'current-router-session-context'); assert.equal(page.items[0].text, '同一会话原始来源')
  let reads = 0
  await assert.rejects(routerSessionView({...options, readRouter: async () => ++reads === 1 ? router : {...router, generation: 3}}), {code: 'SESSION_PAGE_STALE'})
  const foreign = structuredClone(value); foreign.header.conversationId = 'foreign-conversation'
  await assert.rejects(routerSessionView({...options, persistence: {readNative: async () => foreign}}), {code: 'SESSION_IDENTITY_INVALID'})
  value.context.projection.entries[0].messages[0].details.source.conversationId = 'foreign-conversation'
  await assert.rejects(routerSessionView(options), {code: 'SESSION_SOURCE_IDENTITY_INVALID'})
})

test('全部工具名称可见，业务命令和结果公开，未知字段、秘密与孤立结果不泄漏',async()=>{
 const value=snapshot(),call=(id,name,args)=>project('call-'+id,{role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]}),result=(id,name,text)=>project('result-'+id,{role:'toolResult',toolName:name,toolCallId:id,isError:false,content:[{type:'text',text}]})
 const denied=['marble-6148','spruce-8432','harbor-5638','saffron-2417','canopy-7309','PRIVATE_ENV','QUOTED SECRET','ungated-9476']
 value.context.projection.entries=[
  call('unknown','plugin_business_tool',{payload:'x'.repeat(17000)+denied[0],nested:{value:denied[1]}}),result('unknown','plugin_business_tool',denied[2]),
  call('grep','grep',{pattern:'public-needle',include:'**/*.js',future:denied[3],nested:{value:denied[4]}}),result('grep','grep',JSON.stringify({ordinary:'GREP_RESULT_VALUE'})),
  call('shell','bash',{description:'已授权业务核对',timeoutMs:1000,command:'printf business-command; password="QUOTED SECRET"',env:{VALUE:denied[5]},workdir:'/fixture/business'}),result('shell','bash','BUSINESS_SHELL_RESULT'),
  call('search','web_search',{queries:['公开检索主题'],future:{value:denied[4]}}),result('missing-call','read',denied[7]),
  call('conflict','read',{offset:0}),result('conflict','task_result',JSON.stringify({received:true,future:denied[7]})),
 ]
 const options={task,persistence:{readNative:async()=>value}},parts=[],records=[]
 let offset=0,revision
 do{
  const page=await taskSessionView({...options,limit:2,offset,...revision?{revision}:{}});revision=page.revision
  parts.push(JSON.stringify(page));records.push(...page.items)
  for(const row of page.items){
   let bodyOffset=row.textNextOffset
   while(bodyOffset!=null){
    const body=await taskSessionMessageView({...options,messageId:row.id,revision,offset:bodyOffset})
    parts.push(JSON.stringify(body));bodyOffset=body.nextOffset
   }
  }
  offset=page.nextOffset
 }while(offset!=null)
 const visible=parts.join('\n')
 for(const text of denied)assert.equal(visible.includes(text),false,text)
 const conflicted=records.find(row=>row.kind==='tool-call'&&row.toolName==='read');assert.ok(conflicted);assert.ok(records.filter(row=>row.kind==='tool-result').every(row=>row.callId!==conflicted.callId))
 for(const text of ['public-needle','公开检索主题','已授权业务核对','GREP_RESULT_VALUE','plugin_business_tool','business-command','/fixture/business','BUSINESS_SHELL_RESULT'])assert.ok(visible.includes(text),text)
})

test('task_result长业务输入保真分页，正式回执只选Host标量且孤立结果不猜策略',async()=>{
 const value=snapshot(),summary='请求完成核验 '+('业务原文'.repeat(4500))+' SUMMARY_TAIL',call=(id,name,args)=>project('call-'+id,{role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]}),result=(id,name,text)=>project('result-'+id,{role:'toolResult',toolName:name,toolCallId:id,isError:false,content:[{type:'text',text}]})
 value.context.projection.entries=[
  call('finish','task_result',{decision:{action:'complete',summary,limitations:[],evidence:['已核实业务证据'],future:'violet-3721'},future:'cedar-4126'}),
  result('finish','task_result',JSON.stringify({received:true,accepted:true,future:'sorrel-2837'})),
  result('orphan','read','unpaired-3718'),
 ]
 const options={task,persistence:{readNative:async()=>value}},page=await taskSessionView(options)
 const rebuild=async row=>{
  let text=row.text,offset=row.textNextOffset
  while(offset!=null){const body=await taskSessionMessageView({...options,messageId:row.id,revision:page.revision,offset});text+=body.text;offset=body.nextOffset}
  return text
 }
 const input=page.items.find(row=>row.kind==='tool-call'&&row.toolName==='task_result');assert.ok(input)
 assert.ok(input.textNextOffset>0);assert.equal(JSON.parse(await rebuild(input)).decision.summary,summary)
 const receipt=page.items.find(row=>row.kind==='tool-result'&&row.toolName==='task_result');assert.ok(receipt)
 assert.deepEqual(JSON.parse(await rebuild(receipt)),{received:true,accepted:true})
 const all=JSON.stringify(page)+(await Promise.all(page.items.map(rebuild))).join(String.fromCharCode(10))
 for(const text of ['violet-3721','cedar-4126','sorrel-2837','unpaired-3718'])assert.equal(all.includes(text),false,text)
 assert.ok(all.includes('SUMMARY_TAIL'));assert.ok(all.includes('已核实业务证据'))
})

test('安装操作者已获准任务read的JSON样式业务原文不改写，所有正文页无损回拼',async()=>{
 const value=snapshot(),text=JSON.stringify({summary:'真实业务正文',items:['业务核验'.repeat(4500)],ordinary:'正文终点'},null,3)
 value.context.projection.entries=[
  project('json-call',{role:'assistant',content:[{type:'toolCall',id:'json-read',name:'read',arguments:{path:'/fixture/body.json',offset:1,limit:5000}}]}),
  project('json-result',{role:'toolResult',toolName:'read',toolCallId:'json-read',isError:false,content:[{type:'text',text}]}),
 ]
 const options={task,persistence:{readNative:async()=>value}},page=await taskSessionView(options),row=page.items.find(row=>row.kind==='tool-result')
 assert.ok(row);assert.equal(row.toolName,'read');assert.ok(row.textNextOffset>0)
 let rebuilt=row.text,offset=row.textNextOffset
 while(offset!=null){const body=await taskSessionMessageView({...options,messageId:row.id,revision:page.revision,offset});rebuilt+=body.text;offset=body.nextOffset}
 assert.equal(rebuilt,text)
 assert.equal(page.items.find(row=>row.kind==='tool-call').text.includes('/fixture/body.json'),true)
})

test('模型思考按块顺序展示并可分页，厂商签名与不可读思考不透传', async () => {
  const value = snapshot(), thought = '先核对 /fixture/report.txt，再核对差异。'.repeat(700) + ' password="SECRET WORDS" THINKING_END'
  value.context.projection.entries = [project('reasoning', {role: 'assistant', content: [
    {type: 'text', text: '准备核对'},
    {type: 'thinking', thinking: thought, thinkingSignature: 'PRIVATE_SIGNATURE'},
    {type: 'thinking', thinking: 'PRIVATE_REDACTED', redacted: true},
    {type: 'text', text: '开始读取'},
    {type: 'toolCall', id: 'read', name: 'read', arguments: {path: '/fixture/report.txt'}},
  ]})]
  const options = {task, persistence: {readNative: async () => value}}, page = await taskSessionView(options)
  assert.deepEqual(page.items.map(row => row.kind), ['message', 'thinking', 'message', 'tool-call'])
  const row = page.items[1]; let text = row.text, offset = row.textNextOffset
  while (offset != null) {const next = await taskSessionMessageView({...options, messageId: row.id, revision: page.revision, offset}); text += next.text; offset = next.nextOffset}
  assert.ok(text.includes('/fixture/report.txt')); assert.ok(text.endsWith('THINKING_END'))
  assert.doesNotMatch(JSON.stringify(page) + text, /PRIVATE_|SECRET WORDS/)
})

test('待办只取同会话最新已提交回执，独立于历史页且不采纳待执行调用或猜测完成', async () => {
  const value = snapshot(), entry = {id: 'todo-receipt', type: 'custom', customType: 'night.audit', timestamp: '2026-11-12T01:00:00Z',
    data: {version: 1, domain: 'planning', kind: 'todos', payload: {todos: [
      {content: '核对 /fixture/report.txt', status: 'completed'},
      {content: '比较差异 apiKey=PRIVATE_TODO_KEY', status: 'in_progress'},
      {content: '整理结果', status: 'pending'},
    ]}}}
  value.entries = [entry, {id: 'last-commit'}]
  value.context.projection.entries.push(project('pending-todos', {role: 'assistant', content: [
    {type: 'toolCall', id: 'pending-todos', name: 'todo_write', arguments: {todos: [{content: '尚未成功提交的清单', status: 'completed'}]}},
  ]}))
  const options = {task: {...task, state: 'completed'}, persistence: {readNative: async () => value}}
  const latest = await taskSessionView({...options, limit: 1}), older = await taskSessionView({...options, offset: 1, limit: 1, revision: latest.revision})
  assert.deepEqual(latest.todos, older.todos)
  assert.deepEqual(latest.todos.items.map(row => row.status), ['completed', 'in_progress', 'pending'])
  assert.equal(latest.todos.items[0].text, '核对 /fixture/report.txt')
  assert.equal(latest.todos.source.sessionId, task.session.sessionId)
  assert.equal(latest.todos.updatedAt, '2026-11-12T01:00:00.000Z')
  assert.doesNotMatch(JSON.stringify(latest.todos), /PRIVATE_TODO_KEY|尚未成功/)
  const stream = await taskSessionView({...options, stream: true})
  const updatedEntry = {...entry, id: 'updated-todos', data: {...entry.data, payload: {todos: []}}}
  value.entries.push(updatedEntry, {id: 'updated-commit'})
  const update = await taskSessionView({...options, stream: true, checkpoint: stream.checkpoint})
  assert.deepEqual(update.items, [])
  assert.deepEqual(update.todos.items, [], '连续流没有新增消息时仍返回最新已提交清单')
  value.entries.splice(-2)
  value.context.projection.entries = []
  assert.deepEqual((await taskSessionView(options)).todos, latest.todos, '压缩不丢失独立的业务待办回执')
  entry.data.payload.todos = []
  assert.deepEqual((await taskSessionView(options)).todos.items, [])
  value.entries = [{id: 'last-commit'}]
  assert.equal((await taskSessionView(options)).todos, null, '从未提交与已清空是不同状态')
  value.entries = [entry, {id: 'last-commit'}]; entry.data.payload.todos = [{content: '不接受未知状态', status: 'guessed'}]
  await assert.rejects(taskSessionView(options), {code: 'SESSION_TODOS_INVALID'})
})

test('命令错误正文、作业和网页结果可读，私有记忆与技能保持独立授权', async () => {
  const value = snapshot(); value.context.projection.entries = []
  for (const [index, name] of ['pwsh', 'job_output', 'web_fetch', 'memory_read', 'skill'].entries()) {
    value.context.projection.entries.push(project('call-' + index, {role: 'assistant', content: [{type: 'toolCall', id: String(index), name, arguments: {}}]}),
      project('result-' + index, {role: 'toolResult', toolName: name, toolCallId: String(index), isError: name === 'pwsh',
        content: [{type: 'text', text: name.startsWith('memory') || name === 'skill' ? 'PRIVATE_SCOPE_BODY' : '结果 https://example.test/source /fixture/report.txt Bearer SECRET_AUTH'}], details: {private: 'PRIVATE_DETAILS'}}))
  }
  const page = await taskSessionView({task, persistence: {readNative: async () => value}})
  for (const name of ['pwsh', 'job_output', 'web_fetch']) {
    const row = page.items.find(row => row.kind === 'tool-result' && row.toolName === name)
    assert.match(row.text, /https:\/\/example.test\/source \/fixture\/report.txt/)
  }
  assert.equal(page.items.find(row => row.kind === 'tool-result' && row.toolName === 'pwsh').isError, true)
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|SECRET_AUTH/)
})

test('路径公开只作用于显式获权视图，默认 Windows/UNC/Unix 隐藏及 JSON 秘密保护不退化', () => {
  const slash = String.fromCharCode(92)
  for (const path of [['C:', 'private', 'file.txt'].join(slash), slash + slash + ['host', 'private', 'file.txt'].join(slash), '/private/file.txt']) {
    assert.equal(visibleText('文件 ' + path).text, '文件 [路径已隐藏]')
    assert.equal(visibleText('文件 ' + path, [], {preservePaths: true}).text, '文件 ' + path)
  }
  const value = {path: '/fixture/report.txt', command: 'curl https://user:pass@example.test/file password="WITH SPACES"', credentials: {token: 'PRIVATE_TOKEN'}}
  const visible = visibleText(JSON.stringify(value), [], {preservePaths: true})
  const parsed = JSON.parse(visible.text)
  assert.equal(parsed.path, value.path); assert.equal(parsed.credentials, '[已隐藏]')
  assert.doesNotMatch(visible.text, /user:pass|WITH SPACES|PRIVATE_TOKEN/)
  assert.doesNotMatch(visibleText(JSON.stringify({'known-access-value': 'public'}), ['known-access-value'], {preservePaths: true}).text, /known-access-value/)
})

test('job_output exposes paired task text with redaction and pagination, never hidden job metadata or unpaired output', async () => {
  const value = snapshot();
  const text = '作业业务输出\n'.repeat(3000) + 'REGISTERED_JOB_SECRET /private/work/file.txt\n结果终点';
  const call = id => project(`call-${id}`, { role: 'assistant', content: [{ type: 'toolCall', id, name: 'job_output', arguments: { job_id: 'fixture-job-id', wait: true } }] });
  const result = (id, content = text) => project(`result-${id}`, { role: 'toolResult', toolName: 'job_output', toolCallId: id, details: { producerLog: 'PRIVATE_JOB_LOG' }, content: [{ type: 'text', text: content }] });
  value.context.projection.entries = [call('job'), result('job'), result('unpaired', 'PRIVATE_UNPAIRED_OUTPUT')];
  const options = { task, persistence: { readNative: async () => value }, secrets: ['REGISTERED_JOB_SECRET'] };
  const page = await taskSessionView(options);
  const output = page.items.find(row => row.kind === 'tool-result' && row.toolName === 'job_output');
  assert.ok(output);
  assert.match(output.text, /作业业务输出/);
  assert.equal(output.textNextOffset, 16000);
  const tail = await taskSessionMessageView({ ...options, messageId: output.id, revision: page.revision, offset: output.textNextOffset });
  assert.match(tail.text, /结果终点/);
  assert.doesNotMatch(JSON.stringify([page, tail]), /REGISTERED_JOB_SECRET|PRIVATE_JOB_LOG|PRIVATE_UNPAIRED_OUTPUT/);
  assert.match(tail.text, /\/private\/work\/file.txt/);
  assert.equal(page.items.at(-1).toolName, 'job_output');
});

test('stream initial window, older prepends and burst catch-up are bounded, ordered and append-safe', async () => {
  const value = snapshot()
  value.context.projection.entries = Array.from({length: 450}, (_, i) => project(`entry-${i}`, {role: 'assistant', content: [{type: 'text', text: `记录 ${i}`}]}))
  const persistence = {readNative: async () => value}, options = {task, persistence, stream: true, limit: 200}
  const first = await taskSessionView(options)
  assert.equal(first.items.length, 200); assert.equal(first.items[0].text, '记录 250'); assert.equal(first.items.at(-1).text, '记录 449')
  assert.equal(first.before, first.items[0].id); assert.equal(first.hasNewer, false)
  // Append well over one transport window while the reader is in history.
  value.context.projection.entries.push(...Array.from({length: 530}, (_, i) => project(`entry-${450 + i}`, {role: 'assistant', content: [{type: 'text', text: `记录 ${450 + i}`}]})))
  value.entries.push({id: 'append-commit'})
  const older = await taskSessionView({...options, checkpoint: first.checkpoint, before: first.before})
  assert.equal(older.items[0].text, '记录 50'); assert.equal(older.items.at(-1).text, '记录 249')
  assert.equal(older.checkpoint, first.checkpoint)
  const oldest = await taskSessionView({...options, checkpoint: older.checkpoint, before: older.before})
  assert.equal(oldest.items.length, 50); assert.equal(oldest.before, null)
  const rows = [...oldest.items, ...older.items, ...first.items]
  let current = first
  do {
    current = await taskSessionView({...options, checkpoint: current.checkpoint})
    rows.push(...current.items)
  } while (current.hasNewer)
  assert.equal(rows.length, 980); assert.equal(new Set(rows.map(row => row.id)).size, 980)
  assert.deepEqual(rows.map(row => row.text), Array.from({length: 980}, (_, i) => `记录 ${i}`))
  assert.equal((await taskSessionView({...options, checkpoint: current.checkpoint})).items.length, 0)
})

test('stream checkpoint rejects rewritten, compacted, revoked and foreign history instead of retaining mixed snapshots', async () => {
  for (const mutate of [
    value => {value.context.projection.entries[2].messages[0].content[1].text = '替换后的正文'},
    value => {value.context.projection.entries.splice(1, 1)},
    value => {value.context.projection.entries.reverse()},
  ]) {
    const value = snapshot(), options = {task, persistence: {readNative: async () => value}, stream: true}
    const first = await taskSessionView(options)
    mutate(value)
    await assert.rejects(taskSessionView({...options, checkpoint: first.checkpoint}), {code: 'SESSION_PAGE_STALE'})
  }
  const value = snapshot(), options = {task, persistence: {readNative: async () => value}, stream: true}
  const first = await taskSessionView(options)
  for (const extra of [{checkpoint: 'invalid'}, {before: first.items[0].id}, {checkpoint: first.checkpoint, before: 'invalid'}, {offset: 1}, {revision: first.revision}, {limit: 501}]) {
    await assert.rejects(taskSessionView({...options, ...extra}), {code: 'PAGE_INVALID'})
  }
  await assert.rejects(taskSessionView({...options, checkpoint: first.checkpoint, before: '0'.repeat(64)}), {code: 'SESSION_PAGE_STALE'})
  value.audit[0].payload.taskId = 'foreign'
  await assert.rejects(taskSessionView({...options, checkpoint: first.checkpoint}), {code: 'SESSION_IDENTITY_INVALID'})
})
