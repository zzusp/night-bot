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
  assert.equal(result.items[0].text, '核对目标')
  assert.equal(result.items[0].kind, 'instruction')
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
  assert.equal(older.items[0].text, '核对目标'); assert.equal(older.nextOffset, null)
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

test('命令失败无分类时安全降级，成功作业和网页结果与独立授权不变', async () => {
  const value = snapshot(); value.context.projection.entries = []
  for (const [index, name] of ['pwsh', 'job_output', 'web_fetch', 'memory_read', 'skill'].entries()) {
    value.context.projection.entries.push(project('call-' + index, {role: 'assistant', content: [{type: 'toolCall', id: String(index), name, arguments: {}}]}),
      project('result-' + index, {role: 'toolResult', toolName: name, toolCallId: String(index), isError: name === 'pwsh',
        content: [{type: 'text', text: name.startsWith('memory') || name === 'skill' ? 'PRIVATE_SCOPE_BODY' : '结果 https://example.test/source /fixture/report.txt Bearer SECRET_AUTH'}], details: {private: 'PRIVATE_DETAILS'}}))
  }
  const page = await taskSessionView({task, persistence: {readNative: async () => value}})
  for (const name of ['job_output', 'web_fetch']) {
    const row = page.items.find(row => row.kind === 'tool-result' && row.toolName === name)
    assert.match(row.text, /https:\/\/example.test\/source \/fixture\/report.txt/)
  }
  assert.equal(page.items.find(row => row.kind === 'tool-result' && row.toolName === 'pwsh').isError, true)
  assert.equal(page.items.find(row => row.kind === 'tool-result' && row.toolName === 'pwsh').text, '未记录失败原因')
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

test('shell credentials are scrubbed before paging inputs, errors and job output', async () => {
  const value = snapshot(), secret = 'REGISTERED_OPAQUE_VALUE'; value.context.projection.entries = []
  const cases = [
    ['bash', 'gh auth login --with-token <<< UNREGISTERED_HERESTRING', 'AWS_SECRET_ACCESS_KEY=UNREGISTERED_AWS_SECRET\nAWS_ACCESS_KEY_ID=UNREGISTERED_AWS_ID'],
    ['pwsh', 'Connect-Service -Password "UNREGISTERED_PS_PASSWORD"', 'CLIENT_PRIVATE_KEY="UNREGISTERED_PRIVATE_VALUE"'],
    ['bash', 'login --api-key UNREGISTERED_FLAG_VALUE', 'GITHUB_TOKEN=UNREGISTERED_TOKEN'],
    ['bash', "login --with-token <<'EOF'\nUNREGISTERED_HEREDOC\nEOF", 'public business output'],
    ['job_output', undefined, 'public line\n'.repeat(1800) + 'AWS_SECRET_ACCESS_KEY=UNREGISTERED_LATE_SECRET\n' + secret + '\nEND_MARKER'],
  ]
  for (const [index, [name, command, output]] of cases.entries()) {
    value.context.projection.entries.push(
      project('call-secure-' + index, {role:'assistant',content:[{type:'toolCall',id:String(index),name,arguments:command ? {command} : {job_id:'example-job'}}]}),
      project('result-secure-' + index, {role:'toolResult',toolName:name,toolCallId:String(index),isError:index<3,content:[{type:'text',text:output}]}),
    )
  }
  const options = {task, persistence:{readNative:async()=>value}, secrets:[secret]}
  const page = await taskSessionView(options), bodies = []
  for (const row of page.items) {
    bodies.push(row.text)
    let offset = row.textNextOffset
    while (offset != null) {
      const next = await taskSessionMessageView({...options,messageId:row.id,revision:page.revision,offset})
      bodies.push(next.text); offset=next.nextOffset
    }
  }
  assert.doesNotMatch(JSON.stringify(page) + bodies.join('\n'), /UNREGISTERED_|REGISTERED_OPAQUE_VALUE/)
  assert.match(bodies.join('\n'), /public business output/)
  assert.match(bodies.join('\n'), /END_MARKER/)
  assert.ok(page.items.filter(row=>row.kind==='tool-result' && row.toolName!=='bash').every(row=>row.redacted))
})

test('credential redaction preserves JSON and public paths but removes escaped secrets and key material', () => {
  const fixtures = [
    'AWS_SECRET_ACCESS_KEY="UNREGISTERED_ESCAPED\\"TAIL"',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nUNREGISTERED_PRIVATE_BODY\n-----END OPENSSH PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----\nUNREGISTERED_UNFINISHED_BODY',
    'ghp_UNREGISTERED_GITHUB_SECRET0123456789',
    'sk-UNREGISTERED_MODEL_SECRET0123456789',
    'https://example.test?access_key=UNREGISTERED_QUERY_VALUE&ok=true',
  ]
  for (const content of fixtures) {
    for (const source of [content, JSON.stringify({content,path:'/public/report.txt'})]) {
      const result = visibleText(source, [], {preservePaths:true})
      assert.doesNotMatch(result.text, /UNREGISTERED_|TAIL/)
      assert.equal(result.redacted,true)
      if (source.startsWith('{')) assert.equal(JSON.parse(result.text).path,'/public/report.txt')
    }
  }
  const value = visibleText(JSON.stringify({AWS_ACCESS_KEY_ID:'UNREGISTERED_ID',AWS_SECRET_ACCESS_KEY:'UNREGISTERED_SECRET',public:'hello'}))
  assert.doesNotMatch(value.text,/UNREGISTERED_/)
  assert.equal(JSON.parse(value.text).public,'hello')
})

test('deeply nested JSON cannot bypass registered-secret redaction on scrub failure', () => {
  const source = '['.repeat(10000) + JSON.stringify('REGISTERED_DEEP_SECRET') + ']'.repeat(10000)
  const result = visibleText(source, ['REGISTERED_DEEP_SECRET'], {maxLength:Infinity})
  assert.doesNotMatch(result.text,/REGISTERED_DEEP_SECRET/)
  assert.equal(result.redacted,true)
})

test('ordinary token budgets and command paths remain readable', () => {
  const command='model --max-tokens 4096 --token-count 20 /public/report.txt'
  assert.equal(visibleText(command, [], {preservePaths:true}).text,command)
})

test('registered secrets straddling the first body window never leak fragments', async () => {
  const value=snapshot(), secret='OPAQUE_CROSS_WINDOW_REGISTERED_SECRET'
  value.context.projection.entries=[project('boundary',{role:'assistant',content:[{type:'text',text:'x'.repeat(15990)+secret+'y'.repeat(200)+'END'}]})]
  const options={task,persistence:{readNative:async()=>value},secrets:[secret]}
  const page=await taskSessionView(options), row=page.items[0]
  const tail=await taskSessionMessageView({...options,messageId:row.id,revision:page.revision,offset:row.textNextOffset})
  assert.doesNotMatch(JSON.stringify([page,tail]),/OPAQUE_CROSS|REGISTERED_SECRET/)
  assert.equal(row.text+tail.text,'x'.repeat(15990)+'[已隐藏]'+'y'.repeat(200)+'END')
})

test('authorization and cookie headers hide their complete multi-part values', () => {
  for (const text of [
    'Authorization: Basic dXNlcjpwYXNz',
    'Proxy-Authorization: Basic dXNlcjpwYXNz',
    'Cookie: session=FIRST_VALUE; auth=SECOND_VALUE',
    'Set-Cookie: session=FIRST_VALUE; extra=SECOND_VALUE; Path=/',
    'curl -H "Authorization: Basic dXNlcjpwYXNz" https://example.test',
    'curl -u user:SECOND_VALUE https://example.test',
    'curl --user=user:SECOND_VALUE https://example.test',
    'curl -uuser:SECOND_VALUE https://example.test',
    "curl -u'user:SECOND_VALUE' https://example.test",
  ]) {
    for (const source of [text,JSON.stringify({command:text})]) {
      const result=visibleText(source,[],{preservePaths:true})
      assert.doesNotMatch(result.text,/dXNlcjpwYXNz|FIRST_VALUE|SECOND_VALUE/)
      assert.equal(result.redacted,true)
    }
  }
  assert.match(visibleText('Cookie: session=FIRST_VALUE\npublic response').text,/public response/)
})

test('retained pre-upgrade Router history only falls back to published same-conversation predecessors', async () => {
  const router = {id: 'conversation-legacy', activeSessionId: 'router-new', generation: 2, phase: 'active'}
  const current = {header: {id: 'router-new', runtimeOwner: 'conversation-router', conversationId: router.id, generation: 2},
    entries: [{id: 'new-commit'}], context: {projection: {entries: []}}}
  const previous = {header: {...current.header, id: 'router-old', generation: 1}, entries: [{id: 'old-commit'}],
    context: {projection: {entries: [project('old-message', {role: 'assistant', content: '已提交的旧安排'})]}}}
  const rotation = {state: 'published', conversationId: router.id, oldGeneration: 1, oldSessionId: 'router-old', oldCommit: 'old-commit'}
  const reads = [], options = {conversationId: router.id, readRouter: async () => router,
    persistence: {readNative: async id => {reads.push(id); return id === 'router-new' ? current : previous}}}
  const page = await routerSessionView({...options, readRotations: async () => [rotation]})
  assert.equal(page.scope, 'previous-committed-router-context'); assert.equal(page.generation, 1); assert.equal(page.activeGeneration, 2)
  assert.equal(page.items[0].text, '已提交的旧安排'); assert.deepEqual(reads, ['router-new', 'router-old'])
  await assert.rejects(routerSessionView({...options, readRotations: async () => [rotation], revision: 'stale'}), {code: 'SESSION_PAGE_STALE'})
  for (const invalid of [{conversationId: 'foreign'}, {state: 'candidate'}, {oldCommit: null}, {oldGeneration: 2}]) {
    reads.length = 0
    const excluded = await routerSessionView({...options, readRotations: async () => [{...rotation, ...invalid}]})
    assert.equal(excluded.scope, 'current-router-session-context'); assert.equal(excluded.items.length, 0)
    assert.deepEqual(reads, ['router-new'], 'unpublished or foreign predecessors must not be read')
  }
})

test('task bubbles show admitted Router request, goal and requirements, not raw source or current task state', async () => {
  const value = snapshot(), entries = value.context.projection.entries
  const message = entries[1].messages[0]
  const input = JSON.parse(message.content[0].text)
  input.task = {request: '先核对失败原因，再修复并验证。', objective: '恢复发布流程', requirements: ['保留数据', '报告验证结果'], metadata: {secret: 'HIDDEN_META'}}
  message.content[0].text = JSON.stringify(input)
  const result = await taskSessionView({task: {...task, request: 'FUTURE_REQUEST', objective: 'FUTURE_GOAL'}, persistence: {readNative: async () => value}})
  assert.equal(result.items[0].text, '先核对失败原因，再修复并验证。\n\n目标：\n恢复发布流程\n\n要求：\n- 保留数据\n- 报告验证结果')
  assert.doesNotMatch(JSON.stringify(result), /用户原始来源|FUTURE_|HIDDEN_META/)
})

test('resume and live supplements keep each admitted instruction even for repeated source or identical requests', async () => {
  const value = snapshot(), make = (id, request, kind = 'task-input') => project(id, {role: 'custom', customType: 'night.business-input',
    details: {source: {kind, taskSession: {taskId: task.taskId, sessionId: 'pi-one'}}}, content: [{type: 'text', text: JSON.stringify({
      task: {request, objective: '持续目标', requirements: []}, sources: [{sourceId: 'same', version: 1, text: '继续'}], supplement: {contextRevision: 2}})}]})
  const request = '初始执行要求\n\n[原消息补充]\n检查构建结果，不重复发布'
  value.context.projection.entries = [make('first', '初始执行要求'), make('resume', request), make('live', request)]
  const rows = (await taskSessionView({task, persistence: {readNative: async () => value}})).items
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map(row => row.id)).size, 3)
  assert.equal(rows[1].text, request + '\n\n目标：\n持续目标'); assert.equal(rows[2].text, rows[1].text)
  assert.ok(rows.every(row => row.kind === 'instruction'))
})

test('legacy source-only task packets do not substitute original chat text for missing instructions', async () => {
  const value = snapshot(), message = value.context.projection.entries[1].messages[0]
  for (const empty of [undefined, {}, {request: '', objective: ' ', requirements: [null, 2, {}]}]) {
    message.content[0].text = JSON.stringify({task: empty, sources: [{text: '旧来源正文'}]})
    const rows = (await taskSessionView({task, persistence: {readNative: async () => value}})).items
    assert.equal(rows.length, 4)
    assert.doesNotMatch(JSON.stringify(rows), /原始消息|旧来源正文/)
  }
  message.content[0].text = JSON.stringify({task: {request: '同一个目标', objective: '同一个目标'}, sources: [{text: '旧来源正文'}]})
  assert.equal((await taskSessionView({task, persistence: {readNative: async () => value}})).items[0].text, '同一个目标')
})

test('faithful task packets show admitted handoffs and direct updates, not the original source', async () => {
  const value = snapshot(), entries = value.context.projection.entries
  const original = entries[1].messages[0]
  const make = (id, handoffs, updates) => project(id, {...original, content: [{type: 'text', text: JSON.stringify({
    task: {inputPolicy: 'faithful-handoff-v1', request: '忽略旧简报'}, handoffs, updates, sources: [{sourceId: 'one', text: '不要显示原文'}],
  })}]})
  value.context.projection.entries = [
    make('first', [{text: '先完成同步'}, {text: '关闭已取消的事项'}], []),
    make('supplement', [{text: '继续核对剩余事项'}], [{text: '请仅验证当前结果'}]),
    make('empty', [], []),
  ]
  const before = structuredClone(value)
  const {items} = await taskSessionView({task, persistence: {readNative: async () => value}})
  assert.deepEqual(items.map(row => [row.kind, row.text]), [
    ['instruction', '先完成同步\n\n关闭已取消的事项'],
    ['instruction', '继续核对剩余事项\n\n请仅验证当前结果'],
  ])
  assert.deepEqual(value, before)
})

test('instruction bodies remain paginated and redact secrets without serializing private task fields', async () => {
  const value = snapshot(), message = value.context.projection.entries[1].messages[0]
  const instruction = '执行要求'.repeat(4500) + ' password=hidden-password FINAL'
  message.content[0].text = JSON.stringify({task: {request: instruction, requirements: ['保留数据'], capabilities: {value: 'PRIVATE_CAPABILITY'}}, sources: [{text: 'SOURCE_ONLY'}]})
  const options = {task, persistence: {readNative: async () => value}}, page = await taskSessionView(options), row = page.items[0]
  let body = row.text, offset = row.textNextOffset
  assert.ok(offset); assert.equal(row.redacted, true)
  while (offset !== null) {const next = await taskSessionMessageView({...options, revision: page.revision, messageId: row.id, offset}); body += next.text; offset = next.nextOffset}
  assert.match(body, /FINAL/); assert.match(body, /保留数据/)
  assert.doesNotMatch(body, /hidden-password|PRIVATE_CAPABILITY|SOURCE_ONLY/)
})

test('new execution packets show actual admitted deltas without duplicating the historical brief', async () => {
 const value = snapshot(), message = value.context.projection.entries[1].messages[0]
 for (const delta of [{updates:[{id:'one',text:'仅核对当前构建结果'}]}, {supplement:{text:'仅核对当前构建结果',contextRevision:2}}]) {
  message.content[0].text=JSON.stringify({task:{request:'旧初始简报',objective:'当前目标',requirements:['不重复发布']},...delta})
  const rows=(await taskSessionView({task,persistence:{readNative:async()=>value}})).items
  assert.equal(rows[0].text,'仅核对当前构建结果\n\n目标：\n当前目标\n\n要求：\n- 不重复发布')
 }
})

test('long committed histories yield to unrelated requests and retain every row', async () => {
  const value = snapshot()
  value.context.projection.entries = Array.from({length: 256}, (_, i) => project('history-' + i, {role:'assistant',content:[{type:'text',text:'进展 ' + i}]}))
  let serviced = false
  const turn = new Promise(resolve => setImmediate(() => {serviced = true; resolve()}))
  const result = await taskSessionView({task,persistence:{readNative:async()=>value},stream:true,limit:500})
  assert.equal(serviced,true,'an unrelated I/O turn must run before the full projection finishes')
  assert.equal(result.items.length,256)
  assert.equal(result.items[255].text,'进展 255')
  await turn
})

test('light live proof rechecks exact bytes, current scope and secrets without rebuilding history', async () => {
 const value=snapshot();value.journalDigest='bytes-one'
 let reads=0, disk='bytes-one', checks=0, active=true
 const persistence={readNative:async()=>{reads++;return value},readNativeDigest:async()=>disk,readLive:async()=>({sessionId:'pi-one',active,revision:'live-one',assistant:{id:'new-text',message:{role:'assistant',content:[{type:'text',text:'正在读取。',complete:true}]}},tools:[]})}
 const options={task,persistence,proofScope:'browser-one:task-one',guard:async()=>{checks++}}
 const full=await taskSessionView(options);assert.ok(full.liveProof)
 const light=await taskSessionView({...options,liveProof:full.liveProof})
 assert.equal(reads,1);assert.equal(light.historyChanged,false);assert.equal(light.live.active,true);assert.match(light.live.items[0].text,/正在读取/);assert.deepEqual(light.items,[])
 const other=await taskSessionView({...options,proofScope:'browser-two:task-one',liveProof:full.liveProof});assert.equal(other.historyChanged,true);assert.equal(other.live.active,false)
 await assert.rejects(taskSessionView({...options,secrets:['new-secret'],liveProof:full.liveProof}),{code:'SESSION_REDACTION_CHANGED'})
 disk='bytes-two';assert.equal((await taskSessionView({...options,liveProof:full.liveProof})).historyChanged,true);assert.equal(reads,1)
 disk='bytes-one';active=false;assert.equal((await taskSessionView({...options,liveProof:full.liveProof})).live.active,false)
 await assert.rejects(taskSessionView({...options,liveProof:full.liveProof,guard:async()=>{throw Object.assign(Error(),{code:'AUTH_REQUIRED'})}}),{code:'AUTH_REQUIRED'})
 assert.ok(checks>=4)
})

test('light proof does not trust unchanged last entry ID after historical bytes change', async () => {
 const value=snapshot();value.journalDigest='old-bytes'
 const persistence={readNative:async()=>value,readNativeDigest:async()=> 'rewritten-bytes',readLive:async()=>null}
 const options={task,persistence,proofScope:'operator:task'}
 const full=await taskSessionView(options)
 persistence.readLive=async()=>{throw Error('must not read live from stale proof')}
 assert.equal((await taskSessionView({...options,liveProof:full.liveProof})).historyChanged,true)
 assert.equal((await taskSessionView({...options,persistence:{...persistence},liveProof:full.liveProof})).historyChanged,true,'proof cannot cross persistence authority')
})

test('live proof expiring during asynchronous validation returns no live body', async () => {
 const value=snapshot();value.journalDigest='bytes-one'
 const realNow=Date.now;let now=realNow();Date.now=()=>now
 try {
  const persistence={readNative:async()=>value,readNativeDigest:async()=>{now+=11000;return 'bytes-one'},readLive:async()=>({sessionId:'pi-one',active:true,revision:'live-one',assistant:{id:'new-text',message:{role:'assistant',content:[{type:'text',text:'不应显示。',complete:true}]}},tools:[]})}
  const options={task,persistence,proofScope:'operator:task'},full=await taskSessionView(options)
  const light=await taskSessionView({...options,liveProof:full.liveProof})
  assert.equal(light.historyChanged,true);assert.equal(light.live.active,false);assert.deepEqual(light.live.items,[])
 } finally {Date.now=realNow}
})

test('proof expires while final response guard awaits without publishing live content', async () => {
 const value=snapshot();value.journalDigest='bytes-one'
 const realNow=Date.now;let now=realNow();Date.now=()=>now
 try {
  const persistence={readNative:async()=>value,readNativeDigest:async()=> 'bytes-one',readLive:async()=>({sessionId:'pi-one',active:true,revision:'live-one',assistant:{id:'new-text',message:{role:'assistant',content:[{type:'text',text:'不应显示。',complete:true}]}},tools:[]})}
  const options={task,persistence,proofScope:'operator:task'},full=await taskSessionView(options)
  const light=await taskSessionView({...options,liveProof:full.liveProof,guard:async()=>{now+=11000}})
  assert.equal(light.historyChanged,true);assert.deepEqual(light.live.items,[])
 } finally {Date.now=realNow}
})

test('Router 定时输入按真实来源右侧展示提醒，批量独立，普通文本不冒充定时消息', async () => {
  const router = {id: 'room', activeSessionId: 'router', generation: 1, phase: 'active'}
  const occurrence = {id: 'schedule-a', occurrenceAt: '2026-11-14T01:00:00Z'}
  const single = '[SCHEDULE REMINDER]\nInternal framing\nschedule_id_json: "schedule-a"\noccurrence_at: 2026-11-14T01:00:00Z\nreminder_prompt_json: "汇报今天工作；apiKey=secret-value"'
  const packet = (text, occurrences = [occurrence]) => ({role: 'custom', customType: 'night.business-input',
    details: {source: {kind: 'schedule', occurrences}}, content: [{type: 'text', text}]})
  const value = {header: {id: 'router', runtimeOwner: 'conversation-router', conversationId: 'room', generation: 1},
    entries: [{id: 'commit'}], context: {projection: {entries: [
      project('scheduled', packet(single)),
      project('batch', packet('[SCHEDULE REMINDER BATCH]\nInternal framing\nreminders_json: ' + JSON.stringify([
        {schedule_id: 'schedule-a', occurrence_at: occurrence.occurrenceAt, reminder_prompt: '检查发布'},
        {schedule_id: 'schedule-b', occurrence_at: occurrence.occurrenceAt, reminder_prompt: '汇报进度'},
      ]), [occurrence, {...occurrence, id: 'schedule-b'}])),
      project('human', {role: 'user', content: single}),
      project('unknown', packet('新版定时输入格式：核对服务')),
    ]}}}
  const page = await routerSessionView({conversationId: 'room', readRouter: async () => router, persistence: {readNative: async () => value}})
  assert.deepEqual(page.items.map(item => item.kind), ['scheduled-trigger', 'scheduled-trigger', 'scheduled-trigger', 'source', 'scheduled-trigger'])
  assert.ok(page.items.every(item => item.role === 'user'))
  assert.match(page.items[0].text, /汇报今天工作/)
  assert.doesNotMatch(page.items[0].text, /Internal framing|schedule-a|secret-value/)
  assert.equal(page.items[1].text, '检查发布'); assert.equal(page.items[2].text, '汇报进度')
  assert.match(page.items[3].text, /SCHEDULE REMINDER/)
  assert.equal(page.items[4].text, '新版定时输入格式：核对服务')
})

test('旧 Router 交接 JSON 可读化但不误标为定时输入，保留意图、疑问、关联与假设', async () => {
  const router = {id: 'room', activeSessionId: 'router', generation: 1, phase: 'active'}
  const summary = {currentIntent: '明早汇报工作', unresolvedQuestions: ['是否包含阻塞？'], referents: ['今天指北京时间11月13日'], assumptions: ['沿用原渠道'],
    evidenceRefs: [{sourceId: 'internal-id'}], cutoff: 1}
  const value = {header: {id: 'router', runtimeOwner: 'conversation-router', conversationId: 'room', generation: 1},
    entries: [{id: 'commit'}], context: {projection: {entries: [
      project('summary', {role: 'assistant', content: JSON.stringify(summary)}),
      project('ordinary-json', {role: 'assistant', content: JSON.stringify({...summary, extra: '其他业务字段'})}),
    ]}}}
  const page = await routerSessionView({conversationId: 'room', readRouter: async () => router, persistence: {readNative: async () => value}})
  assert.equal(page.items[0].kind, 'context-summary'); assert.equal(page.items[0].role, 'assistant')
  for (const text of ['明早汇报工作', '是否包含阻塞', '北京时间11月13日', '沿用原渠道']) assert.ok(page.items[0].text.includes(text))
  assert.doesNotMatch(page.items[0].text, /internal-id|cutoff|evidenceRefs/)
  assert.equal(page.items[1].kind, 'message'); assert.match(page.items[1].text, /其他业务字段/)
})

test('每轮成功 task_result 独立保留相同正文、问题及分页，失败/孤立/歧义回执不生成消息', async () => {
 const value = snapshot();
 const call = (id, summary = '相同结果', question = '') => project('call-' + id, {role:'assistant', content:[{type:'toolCall', id:'reused', name:'task_result', arguments:{decision:{action:'wait', summary, question, evidence:['PRIVATE_EVIDENCE'], limitations:[]}}}]});
 const result = (id, extra = {}, isError = false) => project('result-' + id, {role:'toolResult', toolName:'task_result', toolCallId:'reused', isError, content:[{type:'text', text:JSON.stringify({received:true, ...extra})}]});
 const long = '分页结果'.repeat(5000) + ' apiKey=PRIVATE_RESULT_KEY';
 value.context.projection.entries = [call('one'),result('one'),call('two'),result('two'),call('long',long,'继续核对？'),result('long'),call('error'),result('error',{},true),call('rejected'),result('rejected',{accepted:false}),result('orphan'),call('ambiguous-one'),call('ambiguous-two'),result('ambiguous'),call('pending')];
 const options = {task, persistence:{readNative:async()=>value}};
 const page = await taskSessionView({...options, limit:50});
 const rows = page.items.filter(row=>row.kind==='task-result');
 assert.equal(rows.length,3);assert.equal(rows[0].text,rows[1].text);assert.notEqual(rows[0].id,rows[1].id);assert.notEqual(rows[0].callId,rows[1].callId);
 assert.ok(rows[2].truncated);
 const tail = await taskSessionMessageView({...options,messageId:rows[2].id,revision:page.revision,offset:rows[2].textNextOffset});
 assert.equal(rows[2].text+tail.text,long.replace('PRIVATE_RESULT_KEY','[已隐藏]')+'\n\n继续核对？');
 assert.doesNotMatch(rows.map(row=>row.text).join('')+tail.text,/PRIVATE_|evidence|limitations/);
 let stream = await taskSessionView({...options,stream:true,limit:1}), collected=[...stream.items];
 const checkpoint=stream.checkpoint;
 while(stream.before){stream=await taskSessionView({...options,stream:true,limit:1,checkpoint,before:stream.before});collected.unshift(...stream.items)}
 assert.deepEqual(collected.map(row=>row.id),page.items.map(row=>row.id));
 assert.equal(new Set(collected.map(row=>row.id)).size,collected.length);
 value.entries.push({id:'next'});
 await assert.rejects(taskSessionMessageView({...options,messageId:rows[2].id,revision:page.revision,offset:16000}),{code:'SESSION_PAGE_STALE'});
});

test('Router 多轮回复正文独立、顺序稳定、不按正文去重，错误回执不冒充回复', async () => {
 const router={id:'conversation-one',activeSessionId:'pi-router',generation:2,phase:'active'};
 const call=id=>project('call-'+id,{role:'assistant',content:[{type:'toolCall',id,name:'resident_router_reply',arguments:{text:'同样回复 apiKey=PRIVATE_REPLY_KEY',operationId:'PRIVATE_OPERATION',sourceId:'PRIVATE_SOURCE'}}]});
 const result=(id,isError=false,receipt={notification:{id:'PRIVATE_NOTIFICATION'}})=>project('result-'+id,{role:'toolResult',toolName:'resident_router_reply',toolCallId:id,isError,content:[{type:'text',text:JSON.stringify(receipt)}]});
 const value={header:{id:'pi-router',runtimeOwner:'conversation-router',conversationId:router.id,generation:2},entries:[{id:'commit'}],context:{projection:{entries:[call('one'),result('one'),call('two'),result('two'),call('failed'),result('failed',true),call('rejected'),result('rejected',false,{accepted:false}),call('pending')]}}};
 const page=await routerSessionView({readRouter:async()=>router,conversationId:router.id,persistence:{readNative:async()=>value}});
 const rows=page.items.filter(row=>row.kind==='router-reply');
 assert.equal(rows.length,2);assert.equal(rows[0].text,'同样回复 apiKey=[已隐藏]');assert.equal(rows[1].text,rows[0].text);assert.notEqual(rows[0].id,rows[1].id);
 assert.deepEqual(page.items.filter(row=>row.kind==='tool-call').slice(0,2).map(row=>row.callId),rows.map(row=>row.callId));
 assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_|notification|已送达/);
 assert.equal(page.items.at(-1).status,'result-unrecorded');
});


test('paired Host error classification exposes fixed reason/code only across task and Router', async () => {
  const {toolTimeoutResult} = await import('../../../src/native-tool-timeout.js')
  const native = toolTimeoutResult(1)
  native.error.message = 'PRIVATE_EXCEPTION'; native.error.info.stack = 'PRIVATE_STACK'
  for (const kind of ['task','router']) {
    const value=snapshot(), conversationId='fixture-conversation', sessionId=kind==='router'?'pi-router':'pi-one'
    value.header={id:sessionId,...kind==='router'?{runtimeOwner:'conversation-router',conversationId,generation:1}:{}}
    value.context.projection.entries=[
      project('call',{role:'assistant',content:[{type:'toolCall',name:'resident_reply_query',id:'failed-call',arguments:{private:'PRIVATE_ARGS'}}]}),
      project('result',{role:'toolResult',toolName:'resident_reply_query',toolCallId:'failed-call',isError:true,details:{nativeResult:native,private:'PRIVATE_DETAILS'},content:[{type:'text',text:'PRIVATE_BODY with /private/path'}]}),
    ]
    const persistence={readNative:async()=>value}
    const options={conversationId,persistence}
    const page=kind==='task'?await taskSessionView({task,persistence}):await routerSessionView({...options,readRouter:async()=>({id:conversationId,activeSessionId:sessionId,generation:1,phase:'active'})})
    const result=page.items.find(row=>row.kind==='tool-result')
    assert.deepEqual(result.failure,{reason:'调用超时，请先核对执行状态，避免重复操作。',code:'TOOL_TIMEOUT'})
    assert.equal(result.text,'调用超时，请先核对执行状态，避免重复操作。\n错误码：TOOL_TIMEOUT')
    assert.doesNotMatch(JSON.stringify(page),/PRIVATE_|private\/path|nativeResult|stack/)
    if(kind==='task')assert.equal((await taskSessionMessageView({task,persistence,messageId:result.id,revision:page.revision})).text,result.text)
  }
})

test('untrusted text/details, unknown codes/tools, mismatched and duplicate calls cannot authorize error details',async()=>{
 const info={name:'ToolArgsError',code:'INVALID_ARGS'}
 const cases=[{}, {details:{code:'INVALID_ARGS',error:{info}}}, {details:{nativeResult:{isError:false,error:{info}}}}, {details:{nativeResult:{isError:true,error:{info:{...info,code:'PRIVATE_CODE'}}}}}, {details:{nativeResult:{isError:true,error:{info:{...info,name:'UntrustedClass'}}}}}, {toolName:'custom_tool',details:{nativeResult:{isError:true,error:{info}}}}, {orphan:true,details:{nativeResult:{isError:true,error:{info}}}}, {duplicate:true,details:{nativeResult:{isError:true,error:{info}}}}, {mismatch:true,details:{nativeResult:{isError:true,error:{info}}}}]
 for(const item of cases){
  const value=snapshot(),name=item.toolName??'resident_reply_query',call=project('call',{role:'assistant',content:[{type:'toolCall',name:item.mismatch?'resident_task_query':name,id:'call',arguments:{}}]})
  value.context.projection.entries=[...item.orphan?[]:[call],...item.duplicate?[{...call,sourceEntry:{id:'duplicate'}}]:[],project('result',{role:'toolResult',toolName:name,toolCallId:'call',isError:true,details:item.details,content:[{type:'text',text:'INVALID_ARGS PRIVATE_TEXT /private/path'}]})]
  const page=await taskSessionView({task,persistence:{readNative:async()=>value}}),row=page.items.at(-1)
  assert.equal(row.text,'未记录失败原因');assert.deepEqual(row.failure,{reason:'未记录失败原因'});assert.doesNotMatch(JSON.stringify(page),/PRIVATE_|private\/path|nativeResult/)
 }
})

test('operator request IDs join exact admitted task updates, never raw packet IDs or unrelated text', async () => {
  const value = snapshot()
  const binding = {taskId:task.taskId,sessionId:'pi-one',requirementRevision:4,controlRevision:3,contextRevision:9}
  const packet = (id, body, taskSession = binding) => project(id, {role:'custom',customType:'night.business-input',
    details:{source:{kind:'task-input',taskSession}},content:[{type:'text',text:JSON.stringify(body)}]})
  const body = {task:{inputPolicy:'faithful-handoff-v1'}}
  const rows = [
    {inputId:'operation-a',sourceId:'source-a',messageVersion:1,requestId:'operator-request-a',requirementRevision:4,controlRevision:3,contextRevision:8},
    {inputId:'operation-b',sourceId:'source-b',messageVersion:2,requestId:'operator-request-b',requirementRevision:4,controlRevision:3,contextRevision:9},
  ]
  const a = {id:'operation-a',sourceId:'source-a',messageVersion:1,text:'相同正文'}
  const b = {id:'operation-b',sourceId:'source-b',messageVersion:2,text:'相同正文'}
  value.context.projection.entries = [
    packet('before',{...body, updates:[a]}, {...binding,contextRevision:7}),
    packet('foreign',{...body, updates:[{...b,sourceId:'other-source',requestId:'fake-request'}]}),
    packet('both',{...body, updates:[a,b,{id:'unmatched',text:'常规说明',requestId:'fake-request'}]}),
    packet('duplicate',{...body, updates:[a,b]}),
  ]
  const options = {task,persistence:{readNative:async()=>value},readTaskInputIds:async id=>{assert.equal(id,'pi-one');return rows}}
  const page = await taskSessionView({...options,stream:true,limit:2})
  assert.deepEqual(page.items.map(item=>[item.requestId,item.text]),[['operator-request-a','相同正文'],['operator-request-b','相同正文']])
  const more = await taskSessionView({...options,stream:true,checkpoint:page.checkpoint,limit:2})
  assert.deepEqual(more.items,[])
  const item = await taskSessionMessageView({...options,revision:page.revision,messageId:page.items[0].id})
  assert.equal(item.text,'相同正文')
  const unattributed = await taskSessionView({task,persistence:options.persistence})
  assert.ok(unattributed.items.every(item=>item.requestId===undefined))
  assert.doesNotMatch(JSON.stringify(page),/fake-request|source-a|operation-a/)
})
