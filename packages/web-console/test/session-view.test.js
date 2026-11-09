import test from 'node:test'
import assert from 'node:assert/strict'
import {taskSessionView, taskSessionMessageView, routerSessionView} from '../server/session-view.js'

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

test('工具公开字段逐项准入，未知工具、嵌套扩展与孤立结果不能通过任何分页泄漏',async()=>{
 const value=snapshot(),call=(id,name,args)=>project('call-'+id,{role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]}),result=(id,name,text)=>project('result-'+id,{role:'toolResult',toolName:name,toolCallId:id,isError:false,content:[{type:'text',text}]})
 const denied=['orion-5820','marble-6148','spruce-8432','harbor-5638','saffron-2417','canopy-7309','ochre-8231','sienna-3758','ungated-9476']
 value.context.projection.entries=[
  call('unknown',denied[0],{payload:'x'.repeat(17000)+denied[1],nested:{value:denied[2]}}),result('unknown',denied[0],denied[3]),
  call('grep','grep',{pattern:'public-needle',include:'**/*.js',future:denied[4],nested:{value:denied[5]}}),result('grep','grep',JSON.stringify({ordinary:'GREP_RESULT_VALUE'})),
  call('shell','bash',{description:'已授权业务核对',timeoutMs:1000,command:'printf '+denied[6],env:{VALUE:denied[7]},workdir:'/fixture/'+denied[7]}),result('shell','bash',denied[7]),
  call('search','web_search',{queries:['公开检索主题'],future:{value:denied[5]}}),result('missing-call','read',denied[8]),
  call('conflict','read',{offset:0}),result('conflict','task_result',JSON.stringify({received:true,future:denied[8]})),
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
 for(const text of ['public-needle','公开检索主题','已授权业务核对','GREP_RESULT_VALUE'])assert.ok(visible.includes(text),text)
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
 assert.equal(page.items.find(row=>row.kind==='tool-call').text.includes('/fixture/body.json'),false)
})
