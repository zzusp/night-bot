import {createOperatorSettings} from '../../../src/settings/operator.js'
import {runtimePaths,prepareRuntimePaths} from '../../../src/runtime/paths.js'
import {createFeedbackService} from '../../../src/feedback/service.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, writeFile, rm, link, readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {acquireLock} from '../../../src/runtime/files.js'
import {request as httpRequest} from 'node:http'
import {MarkdownMemoryStore} from '../../../src/memory/store.js'
import {memoryScope} from '../../../src/memory/scope.js'
import Channels from '../../../src/channels/service.js'
import {createWebConsole, apply} from '../server/plugin.js'
import {openWebLedger} from '../server/ledger.js'
import {accessCredential, browserSessions} from '../server/security.js'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'night-web-console-'))
  const paths = {secrets: join(root, 'secrets'), state: join(root, 'state'), cache: join(root, 'cache')}
  const dist = join(root, 'dist')
  for (const path of [...Object.values(paths), dist]) await mkdir(path)
  await writeFile(join(dist, 'index.html'), '<!doctype html><html lang="zh"><title>Night Bot</title></html>')
  await writeFile(join(dist, 'app.js'), 'export const ready = true')
  const received = [], transports = new Map(), plugins = new Map()
  const channels = {
    transports, plugins,
    identity: envelope => {
      options.onIdentity?.(envelope)
      if (options.validateIdentity) Channels.prototype.identity.call({host: {runtimePaths: {workspaces: root}}}, envelope)
      return {sessionId: 'conversation-' + envelope.channelId + '-' + envelope.conversationId, binding: options.identityBinding?.() ?? {actorId: 'verified-web-operator'}}
    },
    groupContext: id => id === 'room-one' ? {channelId: 'team-chat', type: 'chat-room', conversationId: 'team'} : undefined,
    registerTransport(id, value) {assert.equal(transports.has(id), false); transports.set(id, value); return () => transports.delete(id)},
    registerPlugin(id, value) {plugins.set(id, value); return () => plugins.delete(id)},
    async receive(envelope) {
      received.push(envelope)
      if (options.receive) return options.receive(envelope)
      return {accepted: true}
    },
  }
  const rows = [{taskId: 'task-one', title: '核对任务证据', state: 'running', objective: '保留既有执行会话', groupId: 'room-one', updatedAt: '2026-11-07T01:00:00Z',
    ...(options.blockers ? {blockers: options.blockers} : {}),
    session: {role: 'execution', sessionId: 'pi-one', status: 'running', workspaceDir: '/private/work', logPath: '/private/journal'},
    result: {summary: '进行中', path: '/private/artifact'}, timeline: {version: 1, task: {state: 'running'}, executions: [], human: {segments: []}}}]
  const app = {
    config: {channelPlugins: [{type: 'test-chat', channelId: 'team-chat', enabled: true, config: {apiKey: 'DO_NOT_EXPOSE'}}, {type: 'web-console', channelId: 'web', enabled: true}]},
    tasks: {
      async boardTasks(query) {if (options.taskError?.(query)) throw new Error('PRIVATE_INTERNAL_ERROR'); const items = rows.filter(row => !query.state || row.state === query.state); return {items, total: items.length, offset: 0, limit: query.limit, revision: 'r1', nextOffset: null}},
      listObserverGroups() {return [{groupId: 'room-one', name: '项目讨论'}]},
      async taskDetail(id) {return rows.find(row => row.taskId === id)},
      async taskDialogue(id) {return {taskId: id, sessionId: 'pi-one', messages: [{id: 'm1', role: 'user', text: '原消息'}], writable: true, error: null}},
      async taskExecutions() {return {executions: [], total: 0, nextOffset: null}},
      async observerGroupPage(id, query) {
        if (id !== 'room-one') return null
        const items = query.collection === 'messages' ? [{messageId: 'in-1', text: '<script>untrusted</script>', senderName: '成员', occurredAt: '2026-11-07T01:00:00Z', processingState: 'processed', taskSessionRefs: ['task-one']}]
          : [{outboundId: 'out-1', text: '正在核对', notificationState: 'unknown', sendStartedAt: '2026-11-07T01:00:01Z', taskIds: ['task-one']}]
        return {items, total: 1, nextOffset: null, revision: 'messages-r1'}
      },
    },
  }
  const config = {channelId: 'web', senderId: 'configured-operator', operatorName: Object.hasOwn(options, 'operatorName') ? options.operatorName : '操作者', port: 0}
  if (options.history) {
    const directory = join(paths.state, 'web-console-' + createHash('sha256').update(config.channelId).digest('hex').slice(0, 16))
    await mkdir(directory, {mode: 0o700})
    const old = await openWebLedger(directory)
    for (const conversationId of ['canonical-old', 'retained-old']) {
      old.reserve({requestId: 'seed-' + conversationId, conversationId, groupId: 'conversation-web-' + conversationId, text: conversationId, senderId: config.senderId, channelId: config.channelId})
    }
    old.close()
  }
  let web = await createWebConsole({channels, paths, config, getApplication: () => app, getRedactionSecrets: options.redactionSecrets, getSchedule: () => options.schedule, getSessionPersistence: () => options.persistence, getMemory: () => options.memory, getChannelConfiguration: () => options.channelConfiguration, getOperatorSettings: () => options.settings, getFeedback: () => options.feedback, dist})
  t.after(async () => {await web.close(); await rm(root, {recursive: true, force: true})})
  let cookie, csrfToken
  const fetchApi = async (path, {method = 'GET', body, headers = {}} = {}) => {
    const response = await fetch(web.origin + path, {method, headers: {origin: web.origin, ...(cookie ? {cookie} : {}), ...(csrfToken ? {'x-csrf-token': csrfToken} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})})
    const value = await response.json()
    return {response, status: response.status, body: value}
  }
  const login = async () => {
    const token = (await readFile(web.credentialPath, 'utf8')).trim()
    const result = await fetchApi('/api/login', {method: 'POST', body: {token}})
    assert.equal(result.status, 200)
    cookie = result.response.headers.get('set-cookie').split(';')[0]
    csrfToken = result.body.csrfToken
    assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
    assert.equal(JSON.stringify(result.body).includes(token), false)
    return result
  }
  return {root, paths, dist, channels, received, app, fetchApi, login, get web() {return web},
    async restart() {await web.close(); web = await createWebConsole({channels, paths, config, getApplication: () => app, getRedactionSecrets: options.redactionSecrets, getSchedule: () => options.schedule, getSessionPersistence: () => options.persistence, getMemory: () => options.memory, getChannelConfiguration: () => options.channelConfiguration, getOperatorSettings: () => options.settings, getFeedback: () => options.feedback, dist}); cookie = undefined; csrfToken = undefined},
  }
}

test('optional plugin disabled does not register lifecycle or open storage', async () => {
  await apply(new Proxy({}, {get() {assert.fail('disabled adapter must be inert')}}), {enabled: false})
})

test('model catalog HTTP uses authenticated reads and same-origin strict mutations with safe errors',async t=>{
 const calls=[],view={version:'1'.repeat(64),providers:[{provider:'fixture',name:'Fixture',models:[{id:'initial',name:'Initial',reasoningEfforts:['off'],references:['default']}]}]}
 const settings={modelCatalog:async()=>view,saveModelEntry:async body=>{calls.push(body);if(body.id==='used')throw Object.assign(Error('PRIVATE_MODEL_FAILURE'),{code:'SETTINGS_MODEL_IN_USE'});return {ok:true,changed:true,version:'2'.repeat(64),restartRequired:true,liveApplied:false}}}
 const f=await fixture(t,{settings}),path='/api/settings/model-catalog',body={action:'add',provider:'fixture',model:'second',input:['text','image'],reasoningEfforts:{off:null,low:'low',high:'high'},expectedVersion:view.version}
 assert.equal((await f.fetchApi(path)).status,401)
 assert.equal((await f.fetchApi(path,{method:'PUT',body})).status,401)
 await f.login();assert.deepEqual((await f.fetchApi(path)).body,view)
 assert.equal((await f.fetchApi(path,{method:'PUT',body,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal((await f.fetchApi(path,{method:'PUT',body,headers:{origin:'https://evil.invalid'}})).status,403)
 assert.equal((await f.fetchApi(path,{method:'PUT',body:{...body,headers:{authorization:'PRIVATE'}}})).status,400)
 assert.equal((await f.fetchApi(path,{method:'PUT',body})).status,200);assert.deepEqual(calls,[body])
 const rejected=await f.fetchApi(path,{method:'PUT',body:{action:'remove',provider:'fixture',id:'used',expectedVersion:view.version,confirm:true}})
 assert.equal(rejected.status,409);assert.deepEqual(rejected.body,{error:'SETTINGS_MODEL_IN_USE'})
})

test('execution principles HTTP protects the fixed file and rejects overriding newer versions',async t=>{
 const settings={},f=await fixture(t,{settings}),paths=runtimePaths({installRoot:f.root,dataDir:'data'}),file=join(paths.config,'execution','AGENTS.md')
 await prepareRuntimePaths(paths);Object.assign(settings,createOperatorSettings({paths,getCredentials:()=>undefined}))
 const path='/api/settings/execution-principles'
 assert.equal((await f.fetchApi(path)).status,401);await f.login()
 const current=await f.fetchApi(path);assert.equal(current.status,200);assert.equal(current.body.text,'')
 await assert.rejects(readFile(file),{code:'ENOENT'})
 const body={text:'# 工作原则\n完成后核验。',expectedVersion:current.body.version}
 const put=(payload,headers)=>f.fetchApi(path,{method:'PUT',body:payload,headers})
 assert.equal((await put(body,{'x-csrf-token':'forged'})).status,403)
 assert.equal((await put(body,{origin:'https://untrusted.invalid'})).status,403)
 assert.equal((await put({...body,path:'invalid'})).status,400)
 assert.equal((await put({...body,text:'验'.repeat(22_000)})).status,400)
 const results=await Promise.all([put(body),put({...body,text:'other tab'})]);assert.deepEqual(results.map(row=>row.status).sort(),[200,409])
 const saved=results.find(row=>row.status===200).body
 assert.deepEqual((await f.fetchApi(path)).body,saved);assert.equal(await readFile(file,'utf8'),saved.text)
 const outside=join(f.root,'unrelated.md');await writeFile(outside,'untouched');await rm(file);await link(outside,file)
 assert.notEqual((await f.fetchApi(path)).status,200)
 assert.notEqual((await put({...body,expectedVersion:saved.version})).status,200)
 assert.equal(await readFile(outside,'utf8'),'untouched')
})

test('execution principles HTTP writes remain usable during continuous context reads',async t=>{
 const settings={},f=await fixture(t,{settings}),paths=runtimePaths({installRoot:f.root,dataDir:'data'});
 await prepareRuntimePaths(paths);Object.assign(settings,createOperatorSettings({paths,getCredentials:()=>undefined}));await f.login();
 const path='/api/settings/execution-principles',texts=Array.from({length:13},(_,i)=>'# Revision '+i+'\n'+String(i).repeat(10_000));
 const put=(text,expectedVersion)=>f.fetchApi(path,{method:'PUT',body:{text,expectedVersion}});
 let snapshot=(await f.fetchApi(path)).body;
 const initial=await put(texts[0],snapshot.version);assert.equal(initial.status,200);snapshot=initial.body;
 const seen=new Map([[snapshot.version,snapshot.text]]),writes=new Map(seen);
 let done=false,reads=0;const failures=[];
 const readers=Array.from({length:6},async()=>{while(!done){
  try{const {text,version}=await settings.executionPrinciples();reads++;seen.set(version,text)}catch(error){failures.push(error.code??error.message)}
 }});
 try{for(const text of texts.slice(1)){
  const result=await put(text,snapshot.version);assert.equal(result.status,200,JSON.stringify(result.body));
  snapshot=result.body;assert.equal(snapshot.text,text);writes.set(snapshot.version,text);
 }}finally{done=true;await Promise.all(readers)}
 assert(reads>0);assert.deepEqual(failures,[]);
 for(const [version,text] of seen)assert.equal(text,writes.get(version));
 assert.deepEqual(await settings.executionPrinciples(),snapshot);
})

test('real HTTP requires token login, same-origin mutation and CSRF; logout revokes the session', async t => {
  const f = await fixture(t)
  assert.equal((await f.fetchApi('/api/tasks')).status, 401)
  assert.equal((await f.fetchApi('/api/login', {method: 'POST', body: {token: 'wrong'}})).status, 401)
  await f.login()
  assert.equal((await f.fetchApi('/api/session')).body.operator.name, '操作者')
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: {requestId: 'one', text: '你好'}, headers: {'x-csrf-token': 'forged'}})).status, 403)
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: {requestId: 'one', text: '你好'}, headers: {origin: 'https://evil.example'}})).status, 403)
  assert.equal((await f.fetchApi('/api/logout', {method: 'POST', body: {}})).status, 200)
  assert.equal((await f.fetchApi('/api/session')).status, 401)
  assert.equal(f.received.length, 0)
})

test('channel ingress mutation requires browser auth and CSRF, strict body and bounded response',async t=>{
 const calls=[],row={type:'fixture-chat',channelId:'team-chat',enabled:true,receivePaused:true,config:{token:'PRIVATE_INGRESS_SECRET'}},body={expectedVersion:'1'.repeat(64),paused:true,confirm:true}
 const f=await fixture(t,{channelConfiguration:{async setIngressPaused(id,input){calls.push({id,input});return {changed:true,restartRequired:false,liveApplied:true,channel:row}}}})
 const path='/api/channels/team-chat/ingress'
 assert.equal((await f.fetchApi(path,{method:'POST',body})).status,401)
 await f.login()
 for(const headers of [{'x-csrf-token':'forged'},{origin:'https://evil.example'}])assert.equal((await f.fetchApi(path,{method:'POST',body,headers})).status,403)
 assert.equal((await f.fetchApi(path,{method:'POST',body:{...body,actor:'forged'}})).status,400)
 assert.equal((await f.fetchApi(path+'?unexpected=1',{method:'POST',body})).status,400)
 assert.equal(calls.length,0)
 const result=await f.fetchApi(path,{method:'POST',body})
 assert.equal(result.status,200);assert.equal(result.body.channel.ingress.requestedPaused,true)
 assert.deepEqual(calls,[{id:'team-chat',input:body}]);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_|token|config/)
 assert.equal(f.received.length,0)
})

test('DNS rebinding, cross-site fetch and request identity injection are rejected', async t => {
  const f = await fixture(t); await f.login()
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.web.origin + '/api/session', {headers: {host: 'evil.example'}}, response => {response.resume(); resolve(response.statusCode)})
    request.on('error', reject); request.end()
  })
  assert.equal(reboundStatus, 403)
  assert.equal((await f.fetchApi('/api/session', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403)
  for (const field of ['senderId', 'channelId', 'type', 'sessionId']) {
    const result = await f.fetchApi('/api/chat', {method: 'POST', body: {requestId: 'forged', text: 'hello', [field]: 'someone-else'}})
    assert.equal(result.status, 400)
  }
  assert.equal(f.received.length, 0)
})

test('chat admission preserves configured identity and exact text; retries read the original receipt', async t => {
  const f = await fixture(t); await f.login()
  const input = {requestId: 'request-one', text: '  请核对这项任务。\n保留原话。  '}
  const first = await f.fetchApi('/api/chat', {method: 'POST', body: input})
  assert.equal(first.status, 202); assert.equal(first.body.status, 'accepted')
  assert.equal(f.received.length, 1)
  assert.deepEqual(f.received[0], {type: 'chat', channelId: 'web', senderId: 'configured-operator', senderName: '操作者', conversationId: first.body.conversationId, messageId: input.requestId, text: input.text})
  const duplicate = await f.fetchApi('/api/chat', {method: 'POST', body: input})
  assert.equal(duplicate.body.conversationId, first.body.conversationId); assert.equal(f.received.length, 1)
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: {...input, text: 'changed'}})).status, 409)
  const detail = await f.fetchApi('/api/chat/' + first.body.conversationId)
  assert.equal(detail.body.messages[0].text, input.text)
  assert.equal((await f.fetchApi('/api/requests/request-one')).body.status, 'accepted')
  assert.equal((await f.fetchApi('/api/chat')).body.total, 1)
})

test('uncertain admission is durable and never automatically replayed, including after restart', async t => {
  const f = await fixture(t, {receive() {throw new Error('private internal failure')}}); await f.login()
  const body = {conversationId: 'uncertain-chat', requestId: 'uncertain-request', text: '请处理'}
  const first = await f.fetchApi('/api/chat', {method: 'POST', body})
  assert.equal(first.status, 409); assert.equal(first.body.status, 'unknown')
  assert.equal(JSON.stringify(first.body).includes('private internal'), false)
  await f.restart(); await f.login()
  assert.equal((await f.fetchApi('/api/requests/uncertain-request')).body.status, 'unknown')
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body})).status, 409)
  assert.equal(f.received.length, 1)
})

test('resolved Host refusal is rejected and never presented as admitted or replayed', async t => {
  const f = await fixture(t, {receive() {return {accepted: false, processing: 'quarantined', reason: 'PRIVATE_REASON'}}}); await f.login()
  const body = {conversationId: 'rejected-chat', requestId: 'rejected-request', text: '请处理'}
  const result = await f.fetchApi('/api/chat', {method: 'POST', body})
  assert.equal(result.status, 422); assert.equal(result.body.accepted, false); assert.equal(result.body.status, 'rejected')
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_REASON/)
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body})).status, 422)
  assert.equal((await f.fetchApi('/api/requests/rejected-request')).body.status, 'rejected')
  assert.equal(f.received.length, 1)
})

test('transport delivery uses durable exact receipts, supports readback after restart and refuses conflict', async t => {
  const f = await fixture(t); await f.login()
  await f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: 'reply-chat', requestId: 'reply-request', text: '你好'}})
  const envelope = {type: 'chat', channelId: 'web', senderId: 'configured-operator', conversationId: 'reply-chat', deliveryKey: 'reply-one', text: '你好，我在。', replyToMessageId: 'reply-request'}
  const transport = f.channels.transports.get('web')
  const [first, duplicate] = await Promise.all([transport.send(envelope), transport.send(envelope)])
  assert.equal(first.messageId, duplicate.messageId)
  await assert.rejects(transport.send({...envelope, text: 'changed'}), {code: 'WEB_DELIVERY_CONFLICT'})
  await assert.rejects(transport.send({...envelope, senderId: 'forged'}), {code: 'WEB_DELIVERY_SCOPE_INVALID'})
  assert.equal(await transport.readback({...envelope, deliveryKey: 'missing'}), undefined)
  await f.restart(); await f.login()
  assert.equal(f.channels.transports.get('web').readback(envelope).messageId, first.messageId)
  const detail = await f.fetchApi('/api/chat/reply-chat')
  assert.equal(detail.body.messages.length, 2)
  assert.equal(detail.body.messages.find(row => row.role === 'assistant').status, 'delivered')
})

test('task/channel views only project existing facts and never return configuration secrets or private paths', async t => {
  const f = await fixture(t); await f.login()
  const overview = await f.fetchApi('/api/overview')
  assert.equal(overview.body.running.total, 1); assert.equal(overview.body.interrupted.total, 0)
  assert.equal(overview.body.channels[0].connected, undefined, 'configured is not proof of live connection')
  const task = await f.fetchApi('/api/tasks/task-one')
  assert.equal(task.body.session.sessionId, 'pi-one'); assert.deepEqual(task.body.timeline.executions, [])
  assert.doesNotMatch(JSON.stringify([overview.body, task.body]), /DO_NOT_EXPOSE|workspaceDir|logPath|\/private\//)
  assert.equal((await f.fetchApi('/api/tasks/task-one/dialogue')).body.writable, false)
  assert.equal((await f.fetchApi('/api/tasks?state=fake')).status, 400)
  assert.equal((await f.fetchApi('/api/tasks?limit=101')).status, 400)
  const messages = (await f.fetchApi('/api/conversations/room-one/messages')).body
  assert.equal(messages.items[0].status, 'processed')
  assert.equal(messages.items[1].status, 'unknown', 'processed input cannot manufacture delivered output')
  assert.equal((await f.fetchApi('/api/conversations')).body.items[0].type, 'chat-room')
})

test('渠道连接阶段只用真实 health 白名单，启用状态和私有错误不能冒充连接', async t => {
  const f = await fixture(t); await f.login()
  const stages = ['starting', 'waiting-auth', 'ready', 'paused', 'recovering', 'listening', 'error', 'stopped', 'PRIVATE_UNKNOWN_STATE']
  const expected = []
  f.app.config.channelPlugins = stages.map((state, index) => {
    const channelId = 'health-' + index, healthy = index % 2 === 0
    const health = {state, healthy, credentials: 'PRIVATE_HEALTH_CREDENTIAL', path: '/private/health'}
    Object.defineProperty(health, 'lastError', {get() {assert.fail('raw adapter error must not be read')}})
    f.channels.plugins.set(channelId, {health})
    expected.push({channelId, type: 'fixture-chat', enabled: false, connectionState: index === 8 ? 'unknown' : state, restartRequired: false, liveApplied: false,
      errorCode: state === 'waiting-auth' ? 'CHANNEL_AUTH_REQUIRED' : state === 'error' ? 'CHANNEL_ADAPTER_ERROR' : null, connected: healthy && !['waiting-auth', 'error', 'stopped'].includes(state)})
    return {type: 'fixture-chat', channelId, enabled: false, config: {token: 'PRIVATE_CONFIG_CREDENTIAL'}}
  })
  for (const [channelId, health] of [['absent', undefined], ['invalid', {state: 'ready', healthy: 'PRIVATE_NOT_BOOLEAN'}]]) {
    f.app.config.channelPlugins.push({type: 'fixture-chat', channelId, enabled: true})
    if (health) f.channels.plugins.set(channelId, {health})
    expected.push({channelId, type: 'fixture-chat', enabled: true, connectionState: health ? 'ready' : 'unknown', errorCode: null, restartRequired: false, liveApplied: !!health})
  }
  for (const writesAuthorized of [true, false, undefined]) {
    const channelId = 'dws-authorization-' + String(writesAuthorized)
    f.app.config.channelPlugins.push({type: 'dingtalk-dws', channelId, enabled: true,
      config: {dingtalk_profile: 'PRIVATE_PROFILE', dingtalk_conversation_type: 'chat-room', dingtalk_writes_authorized: writesAuthorized}})
    f.channels.plugins.set(channelId, {bindingActive:writesAuthorized!==undefined,health: {state: 'ready', healthy: true}})
    expected.push({channelId, type: 'dingtalk-dws', enabled: true, connectionState: 'ready', errorCode: null,
      restartRequired: false, liveApplied: writesAuthorized!==undefined, name: channelId, conversationType: 'chat-room', promptConfigured: false,
      writesAuthorized: writesAuthorized === true, connected: true})
  }
  for(const item of expected){
    const row=f.app.config.channelPlugins.find(row=>row.channelId===item.channelId)
    const version=createHash('sha256').update(JSON.stringify(row)).digest('hex')
    Object.assign(item,{savedVersion:version,runningVersion:version,runningConnectionState:item.connectionState,runningErrorCode:item.errorCode,
      ingress:{supported:false,available:false,backfill:null,requestedPaused:false,state:'unavailable',errorCode:null}})
    if(typeof item.connected==='boolean')item.runningConnected=item.connected
    if(row.type==='dingtalk-dws')Object.assign(item,{runningName:item.name,runningConversationType:item.conversationType})
  }
  const result = await f.fetchApi('/api/channels')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.items, expected)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|lastError|credentials|token|\/private\//)
  assert.equal(f.received.length, 0, 'reading connection state cannot admit or replay business work')
})

test('task details preserve a cancellation reason without exposing secrets', async t => {
  const f = await fixture(t); await f.login()
  f.app.tasks.taskDetail = async taskId => ({taskId, state: 'cancelled', cancellationReason: '用户取消，关联 token=SYNTHETIC_PRIVATE_TOKEN'})
  const result = await f.fetchApi('/api/tasks/task-one')
  assert.equal(result.status, 200); assert.equal(result.body.state, 'cancelled')
  assert.match(result.body.cancellationReason, /用户取消/)
  assert.doesNotMatch(result.body.cancellationReason, /SYNTHETIC_PRIVATE_TOKEN/)
})

test('partial overview failure preserves other sections without reflecting internal errors', async t => {
  const f = await fixture(t, {taskError: query => query.state === 'interrupted'}); await f.login()
  const result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200); assert.equal(result.body.interrupted, null)
  assert.equal(result.body.sectionErrors.interrupted, 'SECTION_UNAVAILABLE'); assert.equal(result.body.running.total, 1)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_INTERNAL_ERROR/)
})

test('overview isolates throwing channel health and conversation reads from healthy task sections', async t => {
  const f = await fixture(t); await f.login()
  f.channels.plugins.set('team-chat', {get health() {throw new Error('PRIVATE_CHANNEL_FAILURE')}})
  let result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200)
  assert.equal(result.body.channels, null)
  assert.deepEqual(result.body.sectionErrors, {channels: 'SECTION_UNAVAILABLE'})
  assert.equal(result.body.conversations.length, 1)
  assert.equal(result.body.running.total, 1)
  f.app.tasks.listObserverGroups = () => {throw new Error('PRIVATE_CONVERSATION_FAILURE')}
  result = await f.fetchApi('/api/overview')
  assert.equal(result.status, 200)
  assert.equal(result.body.conversations, null)
  assert.deepEqual(result.body.sectionErrors, {channels: 'SECTION_UNAVAILABLE', conversations: 'SECTION_UNAVAILABLE'})
  assert.equal(result.body.tasks.total, 1)
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_/)
})

test('任务详情保留业务路径，同时按字段隔离私有元数据和凭据', async t => {
  const f = await fixture(t); await f.login()
  const token = (await readFile(f.web.credentialPath, 'utf8')).trim()
  const task = await f.app.tasks.taskDetail('task-one')
  task.objective = '业务原话'.repeat(5000) + '保留末尾'
  task.result = {action: 'complete', summary: '结果可见 ' + token, question: '需要确认吗？', evidence: ['已核对 /private/evidence.txt', {text: 'PRIVATE_NESTED_EVIDENCE'}],
    limitations: ['尚未线上验收'], artifactFiles: [{artifact: {logicalPath: 'PRIVATE_ARTIFACT', localPath: 'PRIVATE_LOCAL'}}],
    arguments: {command: 'PRIVATE_COMMAND'}, credential: 'PRIVATE_CREDENTIAL', unknownFutureField: 'PRIVATE_FUTURE'}
  task.timeline = {version: 1, privateFuture: 'PRIVATE_TIMELINE', task: {status: 'active', complete: true,
    events: [{kind: 'created', at: '2026-11-07T01:00:00Z', sequence: 1, authorization: 'PRIVATE_EVENT'}]},
    executions: [{id: 'run-one', title: '执行记录', status: 'completed', privateFuture: 'PRIVATE_TRACK',
      milestones: [{id: 'm1', summary: '构建已完成', at: '2026-11-07T01:00:01Z', input: {password: 'PRIVATE_INPUT'}}],
      conclusions: [{id: 'c1', summary: '已核对', evidence: ['确认成功'], artifacts: ['PRIVATE_ARTIFACT_PATH']}]}],
    human: {segments: [{id: 'h1', status: 'waiting-reply', description: '请确认下一步 token=PRIVATE_INLINE', startedAt: '2026-11-07T01:00:01Z', permission: 'PRIVATE_PERMISSION'}]}}
  f.app.tasks.taskDialogue = async () => ({taskId: task.taskId, sessionId: 'pi-one', writable: true, error: 'PRIVATE_ERROR', messages: [{
    id: 'd1', text: '确认继续', actorId: 'PRIVATE_ACTOR', receivedAt: '2026-11-07T01:00:00Z', reply: '已收到',
    replyError: {message: 'PRIVATE_STACK', token}, internal: 'PRIVATE_DIALOGUE',
  }]})
  const original = JSON.stringify(task)
  const detail = await f.fetchApi('/api/tasks/task-one')
  assert.equal(detail.status, 200)
  assert.equal(detail.body.objective, task.objective, 'business fields are not silently truncated using the execution-log limit')
  assert.equal(detail.body.result.action, 'complete')
  assert.equal(detail.body.result.question, '需要确认吗？')
  assert.deepEqual(detail.body.result.limitations, ['尚未线上验收'])
  assert.deepEqual(detail.body.result.evidence, ['已核对 /private/evidence.txt'])
  assert.deepEqual(detail.body.timeline.task.events, [{kind: 'created', sequence: 1, at: '2026-11-07T01:00:00Z'}])
  assert.equal(detail.body.timeline.executions[0].milestones[0].summary, '构建已完成')
  assert.match(detail.body.timeline.human.segments[0].description, /请确认下一步/)
  const dialogue = await f.fetchApi('/api/tasks/task-one/dialogue')
  assert.deepEqual(dialogue.body.messages, [{id: 'd1', text: '确认继续', receivedAt: '2026-11-07T01:00:00Z', reply: '已收到'}])
  assert.equal(dialogue.body.error, 'TASK_DIALOGUE_UNAVAILABLE'); assert.equal(dialogue.body.writable, false)
  const serialized = JSON.stringify([detail.body, dialogue.body, (await f.fetchApi('/api/tasks')).body])
  assert.doesNotMatch(serialized, /PRIVATE_|artifactFiles|arguments|credential|unknownFutureField|actorId|replyError/)
  assert.equal(serialized.includes(token), false)
  assert.equal(JSON.stringify(task), original, 'read projection never alters the authoritative task')
})

test('task blocker HTTP projection flattens all three real collections and excludes their private payloads', async t => {
  const blockers = {
    executions: [{executionId: 'execution-one', status: 'running', drained: false, recovering: true,
      input: {title: '核对构建结果', objective: 'PRIVATE_OBJECTIVE', context: 'PRIVATE_CONTEXT'}, result: {token: 'PRIVATE_EXECUTION_RESULT'}, resources: {keys: ['PRIVATE_RESOURCE']}}],
    operations: [{operationId: 'operation-one', state: 'unknown', definition: {toolName: 'pwsh', arguments: {command: 'PRIVATE_COMMAND', apiKey: 'PRIVATE_KEY'}},
      dispatchBinding: {token: 'PRIVATE_DISPATCH'}, resourceKeys: ['PRIVATE_RESOURCE'], result: {stdout: 'PRIVATE_RESULT'}}],
    legacy: [{id: 'legacy-one', kind: 'external-operation', state: 'unknown', source: 'D:\\PRIVATE_SOURCE\\token', resourceKeys: ['PRIVATE_LEGACY_RESOURCE'], evidenceRef: 'PRIVATE_EVIDENCE', resolved: false}],
  }
  const f = await fixture(t, {blockers}); await f.login()
  const result = await f.fetchApi('/api/tasks/task-one')
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.blockers.map(row => row.kind), ['execution', 'operation', 'legacy'])
  assert.deepEqual(result.body.blockers.map(row => row.title), ['核对构建结果', '待核实操作：pwsh', '历史阻断待核实'])
  assert.deepEqual(result.body.blockers.map(row => row.status), ['running', 'unknown', 'unknown'])
  assert.equal(result.body.blockers[0].drained, false); assert.equal(result.body.blockers[0].recovering, true)
  assert.equal(result.body.blockers[1].toolName, 'pwsh')
  assert.equal(new Set(result.body.blockers.map(row => row.id)).size, 3)
  assert.ok(result.body.blockers.every(row => /^[a-f0-9]{64}$/.test(row.id)))
  assert.doesNotMatch(JSON.stringify(result.body.blockers), /PRIVATE_|arguments|definition|resources|source|result|token|binding/i)
  assert.deepEqual((await f.fetchApi('/api/tasks/task-one')).body.blockers, result.body.blockers)
  assert.equal(blockers.operations[0].definition.arguments.command, 'PRIVATE_COMMAND', 'the core object remains untouched')
})

test('assets use security headers; missing assets do not stop APIs', async t => {
  const f = await fixture(t); await f.login()
  const html = await fetch(f.web.origin)
  assert.equal(html.status, 200); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await fetch(f.web.origin + '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal((await fetch(f.web.origin + '/%2eenv')).status, 400)
  assert.equal((await fetch(f.web.origin + '/secrets%5caccess-token')).status, 400)
  await rm(join(f.dist, 'index.html'))
  assert.equal((await fetch(f.web.origin)).status, 503)
  assert.equal((await f.fetchApi('/api/tasks')).status, 200)
})

test('closing a browser request does not abort already admitted channel work', async t => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers()
  const f = await fixture(t, {async receive() {started.resolve(); await gate.promise; return {accepted: true}}})
  const login = await f.login(), cookie = login.response.headers.get('set-cookie').split(';')[0]
  const req = httpRequest(f.web.origin + '/api/chat', {method: 'POST', headers: {origin: f.web.origin, cookie, 'x-csrf-token': login.body.csrfToken, 'content-type': 'application/json'}}, () => {})
  req.on('error', () => {})
  req.end(JSON.stringify({conversationId: 'disconnect-chat', requestId: 'disconnect-request', text: '断线后继续'}))
  await started.promise; req.destroy(); gate.resolve()
  let receipt
  for (let attempt = 0; attempt < 20; attempt++) {
    receipt = await f.fetchApi('/api/requests/disconnect-request')
    if (receipt.body.status === 'accepted') break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(receipt.body.status, 'accepted'); assert.equal(f.received.length, 1)
})

test('pending ledger admission becomes unknown after reopening', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-ledger-')); t.after(() => rm(root, {recursive: true, force: true}))
  let ledger = await openWebLedger(root)
  ledger.reserve({requestId: 'pending', conversationId: 'chat', groupId: 'group', text: 'hello', senderId: 'operator', channelId: 'web'})
  ledger.close(); ledger = await openWebLedger(root)
  try {assert.equal(ledger.request('pending').status, 'unknown')} finally {ledger.close()}
})

test('conversation title and admission state follow durable insertion order across equal timestamps and clock rollback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-ledger-order-'))
  let ledger = await openWebLedger(root)
  t.after(async () => {ledger.close(); await rm(root, {recursive: true, force: true})})
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-11-07T01:00:00Z')})
  const reserve = (requestId, text) => ledger.reserve({requestId, conversationId: 'chat', groupId: 'group', text, senderId: 'operator', channelId: 'web'})
  reserve('z-first', '第一条消息'); ledger.settle('z-first', 'accepted')
  await ledger.transport('web', 'operator').send({type: 'chat', channelId: 'web', senderId: 'operator', conversationId: 'chat',
    deliveryKey: 'first-reply', replyToMessageId: 'z-first', text: '第一条回复'})
  reserve('a-second', '第二条消息'); ledger.settle('a-second', 'rejected')
  assert.equal(ledger.chats().items[0].title, '第一条消息')
  assert.equal(ledger.chats().items[0].status, 'rejected')
  assert.equal(ledger.chat('chat').status, 'rejected')
  assert.deepEqual(ledger.chat('chat').messages.map(message => message.text), ['第一条消息', '第二条消息', '第一条回复'])
  assert.ok(ledger.chat('chat').messages.every(message => !Object.hasOwn(message, 'sequence')))
  t.mock.timers.setTime(Date.parse('2026-11-07T00:59:59Z'))
  reserve('m-last', '回拨后的第三条消息')
  assert.equal(ledger.chats().items[0].title, '第一条消息')
  assert.equal(ledger.chat('chat').status, 'pending')
  ledger.close(); ledger = await openWebLedger(root)
  assert.equal(ledger.chat('chat').status, 'unknown')
  assert.equal(ledger.chats().items[0].status, 'unknown')
})

test('credential reads reject hard links and malformed oversized files without replacing them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-secret-')); t.after(() => rm(root, {recursive: true, force: true}))
  const prior = join(root, 'existing-secret'), directory = join(root, 'web')
  await mkdir(directory, {mode: 0o700}); await writeFile(prior, 'A'.repeat(43) + '\n', {mode: 0o600})
  const credential = join(directory, 'access-token')
  await link(prior, credential)
  await assert.rejects(accessCredential(directory), {code: 'WEB_ACCESS_TOKEN_UNSAFE'})
  assert.equal(await readFile(prior, 'utf8'), 'A'.repeat(43) + '\n')
  await rm(credential); await writeFile(credential, 'B'.repeat(1000), {mode: 0o600})
  await assert.rejects(accessCredential(directory), {code: 'WEB_ACCESS_TOKEN_UNSAFE'})
  assert.equal((await readFile(credential)).length, 1000)
})

test('expired sessions fail closed and login attempts are bounded', () => {
  let now = 0
  const sessions = browserSessions({token: 'secret', channelId: 'test', now: () => now}), headers = new Map(), response = {setHeader: (key, value) => headers.set(key, value)}
  const session = sessions.login('secret', response), request = {headers: {cookie: headers.get('set-cookie').split(';')[0], 'x-csrf-token': session.csrfToken}}
  assert.equal(sessions.require(request, true), session)
  now = 12 * 60 * 60 * 1000 - 1
  assert.equal(sessions.require(request, true), session)
  assert.match(headers.get('set-cookie'), /Max-Age=43200/)
  now += 1
  assert.throws(() => sessions.require(request), {code: 'AUTH_REQUIRED'})
  for (let i = 0; i < 5; i++) assert.throws(() => sessions.login('wrong', response), {code: 'AUTH_INVALID'})
  assert.throws(() => sessions.login('secret', response), {code: 'AUTH_RATE_LIMITED'})
  now += 30_000; assert.ok(sessions.login('secret', response))
})


test('evolution endpoint authenticates, validates pagination and reads inventory without core counters', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-evolution-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(join(root, 'memory')), calls = []
  await store.remember(memoryScope({actorId: 'writer'}), {topic: 'facts', key: 'record', text: 'Readable index summary\n\nPRIVATE_BODY', source: {sessionId: 'task', messageId: 'source'}, provenance: {channelId: '/private/secret.txt'}})
  const f = await fixture(t, {onIdentity: value => calls.push(value), memory: {store, inspectEvolution() {throw Error('must not call dedicated usage projection')}}})
  assert.equal((await f.fetchApi('/api/evolution')).status, 401)
  await f.login()
  const previousIdentities = calls.filter(row => row.conversationId === 'evolution-view').length
  const result = await f.fetchApi('/api/evolution?kind=memory&offset=0&limit=10')
  assert.equal(result.status, 200)
  assert.equal(result.body.items[0].name, 'Readable index summary')
  assert.equal(result.body.memory.readCount, null)
  assert.equal(result.body.items[0].memoryUse, null)
  assert.equal(result.body.usageCoverage.status, 'partial')
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_BODY|private\/secret/)
  assert.ok(calls.filter(row => row.conversationId === 'evolution-view').length > previousIdentities)
  for (const query of ['kind=other', 'limit=51', 'offset=-1', 'actorId=other', 'refresh=2']) assert.equal((await f.fetchApi('/api/evolution?' + query)).status, 400)
  const page = await f.fetchApi('/api/evolution?kind=skill&offset=2&limit=10')
  assert.equal(page.status, 200); assert.equal(page.body.offset, 2); assert.equal(page.body.limit, 10); assert.deepEqual(page.body.items, [])
})

test('evolution unavailable service and failed reads never become zero counts', async t => {
  const f = await fixture(t)
  await f.login()
  assert.deepEqual((await f.fetchApi('/api/evolution')).body, {status: 'unavailable', reason: 'EVOLUTION_UNAVAILABLE'})
  const root = await mkdtemp(join(tmpdir(), 'night-web-evolution-invalid-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(root), directory = store.directory(memoryScope({actorId: 'reader'}))
  await mkdir(directory, {recursive: true}); await writeFile(join(directory, 'scope.json'), '/private/body')
  const failed = await fixture(t, {memory: {store}})
  await failed.login()
  const result = await failed.fetchApi('/api/evolution')
  assert.equal(result.status, 503)
  assert.deepEqual(result.body, {error: 'EVOLUTION_UNAVAILABLE'})
})

test('evolution HTTP distinguishes temporary contention from unreadable data and recovers on explicit refresh', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-evolution-busy-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(root), scope = memoryScope({actorId: 'writer'})
  await store.remember(scope, {topic: 'facts', key: 'record', text: 'Readable index summary\n\nPRIVATE_BODY', source: {sessionId: 'task', messageId: 'source'}})
  const release = await acquireLock(join(store.directory(scope), 'evolution', '.lock'))
  const f = await fixture(t, {memory: {store}})
  await f.login()
  try {
    const result = await f.fetchApi('/api/evolution?kind=memory')
    assert.equal(result.status, 503)
    assert.deepEqual(result.body, {error: 'EVOLUTION_BUSY'})
  } finally {await release()}
  const result = await f.fetchApi('/api/evolution?kind=memory&refresh=1')
  assert.equal(result.status, 200)
  assert.equal(result.body.items[0].name, 'Readable index summary')
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_BODY/)
})

test('evolution caches sanitized indexed inventory in a Web-owned file, supports refresh/restart and retains stale data on failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-evolution-cache-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(root), scope = memoryScope({actorId: 'writer'})
  const remember = key => store.remember(scope, {topic: 'facts', key, text: 'Readable summary\n\nPRIVATE_MEMORY_BODY', source: {sessionId: 'task', messageId: key}})
  await remember('one')
  const f = await fixture(t, {memory: {store}})
  await f.login()
  const first = await f.fetchApi('/api/evolution?kind=memory&limit=1')
  assert.equal(first.status, 200)
  assert.equal(first.body.total, 1)
  assert.equal(first.body.cache.stale, false)
  const directory = join(f.paths.cache, (await readdir(f.paths.cache))[0])
  const files = await readdir(directory)
  assert.equal(files.length, 2)
  assert.equal(files.filter(name => /^evolution-usage-[a-f0-9]{64}\.sqlite$/.test(name)).length, 1)
  const cacheFile = join(directory, files.find(name => name.endsWith('.pages')))
  assert.doesNotMatch(await readFile(cacheFile, 'utf8'), /PRIVATE_MEMORY_BODY|memoryResources|skillResources|storageId|scopeToken|\.sqlite/)
  await remember('two')
  assert.equal((await f.fetchApi('/api/evolution?kind=memory')).body.total, 1, 'ordinary reads serve the saved snapshot')
  const refreshed = await f.fetchApi('/api/evolution?kind=memory&limit=1&refresh=1')
  assert.equal(refreshed.body.total, 2); assert.equal(refreshed.body.items.length, 1)
  const secondPage = await f.fetchApi('/api/evolution?kind=memory&offset=1&limit=1')
  assert.equal(secondPage.body.items.length, 1); assert.equal(secondPage.body.revision, refreshed.body.revision)
  const saved = await readFile(cacheFile, 'utf8')
  await writeFile(join(store.directory(scope), 'scope.json'), 'corrupt source must not replace cache')
  const stale = await f.fetchApi('/api/evolution?kind=memory&refresh=1')
  assert.equal(stale.status, 200); assert.equal(stale.body.total, 2)
  assert.equal(stale.body.cache.stale, true); assert.equal(stale.body.cache.updatedAt, refreshed.body.cache.updatedAt)
  assert.equal(await readFile(cacheFile, 'utf8'), saved)
  await f.restart(); await f.login()
  const restored = await f.fetchApi('/api/evolution?kind=memory')
  assert.equal(restored.status, 200); assert.equal(restored.body.total, 2)
  assert.equal(restored.body.cache.updatedAt, refreshed.body.cache.updatedAt)
})

test('evolution validates current reader identity even when a fresh file cache exists', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-evolution-identity-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(root)
  let actorId = 'verified-web-operator'
  const f = await fixture(t, {memory: {store}, identityBinding: () => ({actorId})})
  await f.login()
  assert.equal((await f.fetchApi('/api/evolution')).status, 200)
  actorId = 'different-reader'
  const rejected = await f.fetchApi('/api/evolution')
  assert.equal(rejected.status, 403); assert.deepEqual(rejected.body, {error: 'EVOLUTION_FORBIDDEN'})
})

test('recent history exposes channel routes alongside Web chats and preserves verified operator name', async t => {
  const f=await fixture(t);await f.login()
  const initial=await f.fetchApi('/api/recent-conversations?offset=0&limit=20')
  assert.equal(initial.status,200)
  assert.deepEqual(initial.body.items.map(item=>({id:item.id,title:item.title,kind:item.kind})),[{id:'room-one',title:'项目讨论',kind:'channel'}])
  const sent=await f.fetchApi('/api/chat',{method:'POST',body:{conversationId:'recent-web',requestId:'recent-input',text:'Recent Web input'}})
  assert.equal(sent.status,202)
  assert.equal(f.received.at(-1).senderName,'操作者')
  const combined=await f.fetchApi('/api/recent-conversations?offset=0&limit=1')
  assert.equal(combined.body.total,2);assert.equal(combined.body.items[0].kind,'web');assert.equal(combined.body.nextOffset,1)
  const next=await f.fetchApi('/api/recent-conversations?offset=1&limit=1')
  assert.equal(next.body.items[0].id,'room-one');assert.equal(next.body.nextOffset,null)
})

test('singleton Web HTTP blocks arbitrary extra chats, concurrent creation and survives restart', async t => {
  const f = await fixture(t); await f.login()
  const current = (await f.fetchApi('/api/chat-current')).body.conversationId
  assert.equal((await f.fetchApi(`/api/chat/${current}`)).body.canonicalConversationId, current)
  const results = await Promise.all(Array.from({length: 8}, (_, i) => f.fetchApi('/api/chat', {method: 'POST', body: {requestId: `parallel-${i}`, text: `hello ${i}`}})))
  assert.ok(results.every(result => result.status === 202 && result.body.conversationId === current))
  assert.equal((await f.fetchApi('/api/chat')).body.total, 1)
  const denied = await f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: 'attempt-extra', requestId: 'extra', text: 'no new chat'}})
  assert.equal(denied.status, 409); assert.equal(denied.body.error, 'WEB_CHAT_SINGLETON')
  assert.equal((await f.fetchApi('/api/requests/extra')).status, 404)
  assert.equal((await f.fetchApi('/api/chat/attempt-extra')).status, 404)
  assert.equal(f.received.length, 8)
  await f.restart(); await f.login()
  assert.equal((await f.fetchApi('/api/chat-current')).body.conversationId, current)
  assert.equal((await f.fetchApi('/api/recent-conversations')).body.items.filter(item => item.kind === 'channel').length, 1)
})

test('singleton ledger pins earliest scope history, keeps histories and unknown receipts without replay', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-singleton-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  let ledger = await openWebLedger(root)
  const input = (id, conversationId, senderId = 'operator', channelId = 'custom-web') => ({requestId: id, conversationId, senderId, channelId, groupId: 'group-' + conversationId, text: id})
  const foreign = input('foreign-request', 'foreign-chat', 'other-operator')
  const first = input('first', 'first-chat'), old = input('old-unknown', 'old-chat')
  ledger.reserve(foreign); ledger.reserve(first); ledger.settle(first.requestId, 'accepted'); ledger.reserve(old)
  ledger.close()
  ledger = await openWebLedger(root, {channelId: 'custom-web', senderId: 'operator'})
  assert.equal(ledger.canonical(), 'first-chat')
  assert.equal(ledger.chat('old-chat').canonicalConversationId, 'first-chat')
  assert.equal(ledger.chat('foreign-chat').canonicalConversationId, 'first-chat')
  assert.equal(ledger.chat('first-chat').canonicalConversationId, 'first-chat')
  assert.equal(ledger.reserve(old).status, 'unknown')
  assert.equal(ledger.reserve(old).duplicate, true)
  assert.throws(() => ledger.reserve({...old, text: 'changed'}), {code: 'CHAT_REQUEST_CONFLICT'})
  assert.throws(() => ledger.reserve(input('extra', 'old-chat')), {code: 'WEB_CHAT_SINGLETON'})
  assert.throws(() => ledger.reserve(input('extra-new', 'new-chat')), {code: 'WEB_CHAT_SINGLETON'})
  assert.equal(ledger.chats().total, 3)
  // Already-authorized old deliveries may finish; singleton pinning must not erase them.
  await ledger.transport('custom-web', 'operator').send({type: 'chat', channelId: 'custom-web', senderId: 'operator', conversationId: 'old-chat', deliveryKey: 'old-delivery', text: 'retained reply'})
  assert.equal(ledger.chat('old-chat').messages.at(-1).text, 'retained reply')
  ledger.close()
  ledger = await openWebLedger(root, {channelId: 'custom-web', senderId: 'operator'})
  assert.equal(ledger.canonical(), 'first-chat'); assert.equal(ledger.request('old-unknown').status, 'unknown')
  ledger.close()
})


test('historical Web routes stay normal entry points but new requests continue only canonical history', async t => {
  const f = await fixture(t, {history: true}); await f.login()
  const before = (await f.fetchApi('/api/chat/retained-old')).body
  assert.equal(before.canonicalConversationId, 'canonical-old')
  assert.equal('readOnly' in before, false)
  const input = {conversationId: 'retained-old', requestId: 'normal-old-entry', text: 'continue normally'}
  const accepted = await f.fetchApi('/api/chat', {method: 'POST', body: input})
  assert.equal(accepted.status, 202); assert.equal(accepted.body.conversationId, 'canonical-old')
  assert.equal(f.received[0].conversationId, 'canonical-old')
  assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: input})).body.duplicate, true)
  assert.equal(f.received.length, 1)
  const after = (await f.fetchApi('/api/chat/retained-old')).body
  assert.deepEqual(after.messages, before.messages)
  const recovered = await f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: 'retained-old', requestId: 'seed-retained-old', text: 'retained-old'}})
  assert.equal(recovered.status, 409); assert.equal(recovered.body.status, 'unknown'); assert.equal(recovered.body.duplicate, true)
  assert.equal(f.received.length, 1)
  assert.equal((await f.fetchApi('/api/chat')).body.total, 2)
})

test('concurrent first explicit Web IDs admit one conversation, not two', async t => {
  const f = await fixture(t); await f.login()
  const results = await Promise.all(['first-a', 'first-b'].map(id => f.fetchApi('/api/chat', {method: 'POST', body: {conversationId: id, requestId: id, text: id}})))
  assert.deepEqual(results.map(row => row.status).sort(), [202, 409])
  assert.equal(f.received.length, 1)
  assert.equal((await f.fetchApi('/api/chat-current')).body.conversationId, f.received[0].conversationId)
  assert.equal((await f.fetchApi('/api/chat')).body.total, 1)
})


test('Web operator names normalize before real channel schema validation and receipt reservation', async t => {
  for (const [operatorName, expected] of [['', '本机操作者'], ['   ', '本机操作者'], ['x'.repeat(257), 'x'.repeat(256)], ['  显示名  ', '显示名'], [42, '本机操作者']]) {
    await t.test(JSON.stringify(operatorName).slice(0, 40), async t => {
      const f = await fixture(t, {operatorName, validateIdentity: true}); await f.login()
      assert.equal((await f.fetchApi('/api/session')).body.operator.name, expected)
      const input = {requestId: 'name-check', text: 'hello'}
      const result = await f.fetchApi('/api/chat', {method: 'POST', body: input})
      assert.equal(result.status, 202); assert.equal(result.body.accepted, true)
      assert.equal(f.received[0].senderName, expected)
      assert.equal((await f.fetchApi('/api/requests/name-check')).body.status, 'accepted')
      assert.equal((await f.fetchApi('/api/chat', {method: 'POST', body: input})).body.duplicate, true)
      assert.equal(f.received.length, 1)
    })
  }
})


test('渠道执行接口按可见会话与真实任务归属读取，归档任务不依赖当前消息页', async t => {
  const f = await fixture(t); await f.login()
  const calls = []
  f.app.tasks.store = {async query(query) {
    calls.push(query)
    if (query.kind === 'task.list') return [{taskId: 'archived-task', groupId: 'room-one'}, {taskId: 'foreign-task', groupId: 'other-room'}]
    if (query.kind === 'task.get') return {taskId: query.taskId, groupId: query.taskId === 'foreign-task' ? 'other-room' : 'room-one', sessionId: null, sessionBound: false}
    if (query.kind === 'router.get') return null
  }}
  assert.deepEqual((await f.fetchApi('/api/conversations/room-one/tasks')).body, {taskIds: ['archived-task'], taskSummaries: [{taskId: 'archived-task', state: 'inactive'}], taskHistoryStatus: 'ready'})
  assert.deepEqual(calls[0], {kind: 'task.list', groupId: 'room-one', archived: 'all'})
  assert.equal((await f.fetchApi('/api/conversations/room-one/session')).body.status, 'pending')
  assert.equal((await f.fetchApi('/api/conversations/room-one/tasks/archived-task/session')).body.status, 'unavailable')
  assert.equal((await f.fetchApi('/api/conversations/room-one/tasks/foreign-task/session')).status, 404)
  assert.equal((await f.fetchApi('/api/conversations/room-one/tasks/foreign-task/session/messages/body?revision=r1')).status, 404)
  const before = calls.length
  for (const path of ['/tasks', '/session', '/tasks/archived-task/session']) assert.equal((await f.fetchApi('/api/conversations/hidden-room' + path)).status, 404)
  assert.equal(calls.length, before, '不可见会话不能探测持久历史')
  delete f.app.tasks.store
  assert.deepEqual((await f.fetchApi('/api/conversations/room-one/tasks')).body, {taskIds: null, taskSummaries: null, taskHistoryStatus: 'unavailable'})
  assert.equal((await f.fetchApi('/api/conversations/room-one/session')).status, 503)
  assert.equal(f.received.length, 0)
})

test('服务重启撤销浏览器会话但不轮换访问令牌，原令牌仍可显式重连', async t => {
  const f = await fixture(t), token = (await readFile(f.web.credentialPath, 'utf8')).trim()
  const login = await f.login(), oldCookie = login.response.headers.get('set-cookie').split(';')[0]
  await f.restart()
  assert.equal((await readFile(f.web.credentialPath, 'utf8')).trim(), token)
  assert.equal((await f.fetchApi('/api/session', {headers: {cookie: oldCookie}})).status, 401)
  assert.equal((await f.fetchApi('/api/login', {method: 'POST', body: {token}})).status, 200)
  assert.equal(f.received.length, 0)
})


test('设置API沿用浏览器鉴权、同源和CSRF，拒绝注入且异常不反射凭据',async t=>{
 const calls=[],settings={appearance:async()=>({name:'测试助手',icon:'robot'}),view:async()=>({appearance:{name:'测试助手',icon:'robot'},secrets:{github:{configured:true}}}),saveSecret:async(kind,body)=>{calls.push({kind,action:body.action});if(body.value==='FAIL_TEST_SECRET')throw Error('FAIL_TEST_SECRET');return {ok:true}},saveAppearance:async()=>({ok:true})}
 const f=await fixture(t,{settings})
 assert.deepEqual((await f.fetchApi('/api/appearance')).body,{name:'测试助手',icon:'robot'})
 assert.equal((await f.fetchApi('/api/settings')).status,401)
 await f.login()
 assert.equal((await f.fetchApi('/api/settings')).body.appearance.name,'测试助手')
 const secret={action:'replace',value:'TEST_ONLY_SECRET',confirm:true,expectedVersion:'version'}
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:secret,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:secret,headers:{origin:'https://evil.invalid'}})).status,403)
 assert.equal(calls.length,0)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:{...secret,path:'/private/secret'}})).status,400)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:secret})).status,200)
 const failed=await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:{...secret,value:'FAIL_TEST_SECRET'}})
 assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.body),/FAIL_TEST_SECRET/)
 assert.equal((await f.fetchApi('/api/settings/secrets/github',{method:'PUT',body:{...secret,value:'x'.repeat(17000)}})).status,413)
 assert.equal(f.received.length,0)
})


test('Web transport binds retained delivery and message reads to stored channel and sender ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-transport-scope-'))
  const ledger = await openWebLedger(root)
  t.after(async () => {ledger.close(); await rm(root, {recursive: true, force: true})})
  for (const [conversationId, senderId, channelId] of [
    ['own-history', 'operator', 'web'],
    ['foreign-sender', 'other-operator', 'web'],
    ['foreign-channel', 'operator', 'other-web'],
  ]) ledger.reserve({requestId: 'message-' + conversationId, conversationId, senderId, channelId, groupId: 'group-' + conversationId, text: conversationId})
  const transport = ledger.transport('web', 'operator')
  const envelope = conversationId => ({type: 'chat', channelId: 'web', senderId: 'operator', conversationId,
    deliveryKey: 'delivery-' + conversationId, messageId: 'message-' + conversationId, text: 'reply'})
  for (const conversationId of ['foreign-sender', 'foreign-channel']) {
    await assert.rejects(transport.send(envelope(conversationId)), {code: 'WEB_DELIVERY_SCOPE_INVALID'})
    assert.throws(() => transport.readback(envelope(conversationId)), {code: 'WEB_DELIVERY_SCOPE_INVALID'})
    await assert.rejects(transport.readMessage(envelope(conversationId)), {code: 'WEB_MESSAGE_NOT_FOUND'})
    assert.equal(ledger.chat(conversationId).messages.length, 1)
  }
  assert.equal((await transport.send(envelope('own-history'))).visible, true)
  assert.equal((await transport.readMessage(envelope('own-history'))).senderId, 'operator')
})

test('DingTalk create HTTP reports actual loaded health, not fixed restart flags', async t => {
  for (const state of ['listening', 'waiting-auth']) {
    let f
    const channelConfiguration = {async addDingtalk(input) {
      const row = {type: 'dingtalk-dws', channelId: input.channelId, enabled: true, config: {}}
      f.app.config.channelPlugins.push(row)
      f.channels.plugins.set(input.channelId, {bindingActive: state === 'listening', health: {state, healthy: true}})
      return {changed: true, channel: row}
    }}
    f = await fixture(t, {channelConfiguration}); await f.login()
    const result = await f.fetchApi('/api/channels/dingtalk', {method: 'POST', body: {channelId: 'live-'+state, conversationType: 'chat-room', targetKind: 'id', target: 'room'}})
    assert.equal(result.status, 200)
    assert.equal(result.body.restartRequired, false)
    assert.equal(result.body.liveApplied, state === 'listening')
    assert.equal(result.body.channel.connected, state === 'listening')
    assert.equal(result.body.channel.connectionState, state)
  }
})

test('channel lifecycle errors preserve safe HTTP codes', async t => {
  let code
  const reject = async () => {throw Object.assign(Error(code), {code})}
  const f = await fixture(t, {channelConfiguration: {addDingtalk: reject, editDingtalk: reject}, settings: {saveChannel: reject}})
  await f.login()
  for (const [error, status] of [['CHANNEL_ACTIVATION_FAILED', 503], ['CHANNEL_RECONFIGURING', 409], ['CHANNEL_RUNTIME_VERSION_CONFLICT', 409], ['CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED', 409]]) {
    code = error
    for (const [path, method] of [['/api/channels/dingtalk', 'POST'], ['/api/channels/dingtalk/test', 'PATCH'], ['/api/settings/channels', 'POST']]) {
      const result = await f.fetchApi(path, {method, body: {}})
      assert.equal(result.status, status)
      assert.equal(result.body.error, error)
    }
  }
})

test('channel DELETE requires authenticated same-origin CSRF, exact version and explicit second confirmation',async t=>{
  const calls=[],version='a'.repeat(64),f=await fixture(t,{channelConfiguration:{async remove(id,body){calls.push({id,body});return {changed:true,restartRequired:false,liveApplied:false}}}})
  const body={expectedVersion:version,confirm:true},remove=(value=body,headers={})=>f.fetchApi('/api/channels/team-chat',{method:'DELETE',body:value,headers})
  assert.equal((await remove()).status,401);await f.login()
  assert.equal((await remove(body,{'x-csrf-token':'wrong'})).status,403)
  assert.equal((await remove(body,{origin:'https://evil.example'})).status,403)
  for(const confirm of [undefined,false,'true',1]){
    const result=await remove({expectedVersion:version,confirm});assert.equal(result.status,400);assert.equal(result.body.error,'CHANNEL_DELETE_CONFIRMATION_REQUIRED')
  }
  for(const expectedVersion of [undefined,'old',0])assert.equal((await remove({expectedVersion,confirm:true})).body.error,'CHANNEL_DELETE_REQUEST_INVALID')
  assert.equal((await remove({...body,force:true})).status,400)
  assert.equal((await f.fetchApi('/api/channels/bad%00id',{method:'DELETE',body})).status,400)
  assert.equal(calls.length,0)
  assert.deepEqual((await remove()).body,{ok:true,channelId:'team-chat',changed:true,restartRequired:false,liveApplied:false})
  assert.deepEqual(calls,[{id:'team-chat',body:{expectedVersion:version}}])
})

test('channel DELETE uses the existing channel ID contract rather than the Web chat ID regex',async t=>{
  const calls=[],version='a'.repeat(64),f=await fixture(t,{channelConfiguration:{async remove(id){calls.push(id);return {changed:true,restartRequired:false,liveApplied:false}}}})
  await f.login()
  for(const id of ['团队渠道','team.chat','team/chat','team chat']){
    const result=await f.fetchApi('/api/channels/'+encodeURIComponent(id),{method:'DELETE',body:{expectedVersion:version,confirm:true}})
    assert.equal(result.status,200);assert.equal(result.body.channelId,id)
  }
  assert.deepEqual(calls,['团队渠道','team.chat','team/chat','team chat'])
  for(const id of ['  ',' leading','trailing ','x'.repeat(129)])assert.equal((await f.fetchApi('/api/channels/'+encodeURIComponent(id),{method:'DELETE',body:{expectedVersion:version,confirm:true}})).status,400)
  assert.equal(calls.length,4)
})

test('dot-only channel IDs use a protected query fallback without URL path normalization',async t=>{
  const calls=[],version='a'.repeat(64),f=await fixture(t,{channelConfiguration:{async remove(id){calls.push(['remove',id]);return {changed:true,restartRequired:false,liveApplied:false}},async getDingtalk(id){calls.push(['read',id]);return {channelId:id}}}})
  await f.login()
  for(const id of ['.','..']){
    const removed=await f.fetchApi('/api/channels?channelId='+encodeURIComponent(id),{method:'DELETE',body:{expectedVersion:version,confirm:true}})
    assert.equal(removed.status,200);assert.equal(removed.body.channelId,id)
    assert.equal((await f.fetchApi('/api/channels/dingtalk?channelId='+encodeURIComponent(id))).body.channelId,id)
  }
  assert.deepEqual(calls,[['remove','.'],['read','.'],['remove','..'],['read','..']])
  assert.equal((await f.fetchApi('/api/channels?channelId=.&channelId=..',{method:'DELETE',body:{expectedVersion:version,confirm:true}})).status,400)
  assert.equal((await f.fetchApi('/api/channels?channelId=.&force=true',{method:'DELETE',body:{expectedVersion:version,confirm:true}})).status,400)
  assert.equal((await f.fetchApi('/api/channels?channelId=.',{method:'DELETE',body:{expectedVersion:version,confirm:true},headers:{'x-csrf-token':'bad'}})).status,403)
  assert.equal(calls.length,4)
})

test('channel DELETE preserves typed lifecycle conflicts and never retries rejected or uncertain outcomes',async t=>{
  let errorCode='DINGTALK_CHANNEL_VERSION_CONFLICT',committed=false,calls=0
  const f=await fixture(t,{channelConfiguration:{async remove(){calls++;throw Object.assign(Error('private fixture details'),{code:errorCode,...committed?{committed:true}:{}})}}})
  await f.login()
  for(const [code,status]of [['DINGTALK_CHANNEL_VERSION_CONFLICT',409],['DINGTALK_CHANNEL_SWITCH_BLOCKED',409],['DINGTALK_CHANNEL_NOT_FOUND',404],['CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED',409],['CHANNEL_RECONFIGURING',409],['CHANNEL_CONFIGURATION_OPERATOR_REQUIRED',403]]){
    errorCode=code
    const result=await f.fetchApi('/api/channels/team-chat',{method:'DELETE',body:{expectedVersion:'a'.repeat(64),confirm:true}})
    assert.equal(result.status,status);assert.deepEqual(result.body,{error:code})
  }
  committed=true;errorCode='NIGHT_WRITE_COMMIT_UNCERTAIN'
  const uncertain=await f.fetchApi('/api/channels/team-chat',{method:'DELETE',body:{expectedVersion:'a'.repeat(64),confirm:true}})
  assert.equal(uncertain.status,503);assert.deepEqual(uncertain.body,{error:'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN'});assert.equal(calls,7)
})

test('channel DELETE fails closed if this Host does not expose safe removal',async t=>{
  const f=await fixture(t,{channelConfiguration:{}});await f.login()
  const result=await f.fetchApi('/api/channels/team-chat',{method:'DELETE',body:{expectedVersion:'a'.repeat(64),confirm:true}})
  assert.equal(result.status,503);assert.deepEqual(result.body,{error:'CHANNEL_CONFIGURATION_UNAVAILABLE'})
})

test('会话任务摘要只用列表白名单，隔离会话并脱敏，不读取每项详情', async t => {
  const f = await fixture(t); await f.login()
  const token = (await readFile(f.web.credentialPath, 'utf8')).trim(), calls = []
  f.app.tasks.taskDetail = () => {throw new Error('N_PLUS_ONE_FORBIDDEN')}
  f.app.tasks.store = {async query(query) {
    calls.push(query); assert.equal(query.kind, 'task.list')
    return [{taskId: 'safe-task', groupId: query.groupId, title: '任务 ' + token, status: 'active', updatedAt: '2026-11-10T00:00:00Z', objective: 'private', sessionId: 'private'},
      {taskId: 'foreign-task', groupId: 'foreign', title: 'foreign title'}]
  }}
  const current = (await f.fetchApi('/api/chat-current')).body.conversationId
  for (const path of ['/api/conversations/room-one/tasks', '/api/chat/' + current]) {
    const value = (await f.fetchApi(path)).body
    assert.deepEqual(value.taskIds, ['safe-task'])
    assert.equal(value.taskSummaries.length, 1)
    assert.deepEqual(Object.keys(value.taskSummaries[0]).sort(), ['state', 'taskId', 'title', 'updatedAt'])
    assert.equal(value.taskSummaries[0].state, 'inactive')
    assert.doesNotMatch(JSON.stringify(value.taskSummaries), new RegExp(token + '|private|foreign'))
  }
  assert.equal(calls.length, 2)
})

test('evolution bodies require authentication and exact version, redact both sides and preserve failure status',async t=>{
 const id='a'.repeat(64),seen=[]
 const memory={inspectEvolutionItem:async(binding,options)=>{seen.push({binding,options});if(options.revision==='1')throw Object.assign(Error(),{code:'EVOLUTION_VERSION_STALE'});if(options.revision==='3')throw Object.assign(Error(),{code:'EVOLUTION_BODY_FORBIDDEN'});return {id,name:'facts/entry',kind:'memory',revision:2,current:{text:'keep\nsecret=PRIVATE_VALUE',revision:2},previous:{text:'keep\nsecret=OLDER_VALUE',revision:1},comparison:{basis:'saved'},redacted:false}}}
 const f=await fixture(t,{memory}),path=`/api/evolution/items/${id}`
 assert.equal((await f.fetchApi(path+'?revision=2')).status,401);await f.login()
 assert.equal((await f.fetchApi(path+'?revision=2&path=/private')).status,400)
 assert.equal((await f.fetchApi(path+'?revision=1')).status,409)
 assert.equal((await f.fetchApi(path+'?revision=3')).status,403)
 const result=await f.fetchApi(path+'?revision=2');assert.equal(result.status,200);assert.equal(result.body.redacted,true);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_VALUE|OLDER_VALUE/);assert.equal(result.body.comparison.added,0)
 assert.equal(seen.at(-1).binding.actorId,'verified-web-operator');assert.deepEqual(seen.at(-1).options,{id,revision:'2'})
})

test('角色模型设置只允许认证同源带版本的白名单请求，错误不泄露配置',async t=>{
 const calls=[],settings={saveRoleModel:async body=>{calls.push(body);if(body.model==='unsupported')throw Object.assign(Error('PRIVATE_MODEL_FAILURE'),{code:'UNSUPPORTED_REASONING_EFFORT'});return {ok:true,version:'next',changed:true}}}
 const f=await fixture(t,{settings}),body={role:'router',provider:'fixture',model:'thinking',reasoningEffort:'high',expectedVersion:'version'}
 assert.equal((await f.fetchApi('/api/settings/role-model',{method:'PUT',body})).status,401)
 await f.login()
 assert.equal((await f.fetchApi('/api/settings/role-model',{method:'PUT',body,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal((await f.fetchApi('/api/settings/role-model',{method:'PUT',body,headers:{origin:'https://evil.invalid'}})).status,403)
 assert.equal((await f.fetchApi('/api/settings/role-model',{method:'PUT',body:{...body,headers:{authorization:'PRIVATE'}}})).status,400)
 assert.equal((await f.fetchApi('/api/settings/role-model',{method:'PUT',body})).status,200)
 assert.deepEqual(calls,[body])
 const failed=await f.fetchApi('/api/settings/role-model',{method:'PUT',body:{...body,model:'unsupported'}})
 assert.equal(failed.status,400);assert.deepEqual(failed.body,{error:'SETTINGS_INPUT_INVALID'})
})

test('daily log settings require authenticated same-origin CSRF and reject extra fields without leaking errors',async t=>{
 const calls=[],settings={saveWorkLog:async body=>{calls.push(body);if(body.time==='bad')throw Object.assign(Error('PRIVATE_FAILURE'),{code:'NIGHT_BOT_WORK_LOG_TIME_INVALID'});return {ok:true,version:'next',changed:true}}}
 const f=await fixture(t,{settings}),body={enabled:true,time:'23:59',timezone:'local',expectedVersion:'version'},path='/api/settings/work-log'
 assert.equal((await f.fetchApi(path,{method:'PUT',body})).status,401);await f.login()
 assert.equal((await f.fetchApi(path,{method:'PUT',body,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal((await f.fetchApi(path,{method:'PUT',body,headers:{origin:'https://evil.invalid'}})).status,403)
 assert.equal((await f.fetchApi(path,{method:'PUT',body:{...body,outputPath:'/tmp/private'}})).status,400)
 assert.equal((await f.fetchApi(path,{method:'PUT',body})).status,200);assert.deepEqual(calls,[body])
 const failed=await f.fetchApi(path,{method:'PUT',body:{...body,time:'bad'}});assert.equal(failed.status,400);assert.deepEqual(failed.body,{error:'SETTINGS_INPUT_INVALID'})
})

test('provider API and scoped secrets require authenticated CSRF, strict DTO and retain provider binding',async t=>{
 const calls=[],settings={saveProvider:async body=>{calls.push(body);if(body.expectedVersion==='stale')throw Object.assign(Error('PRIVATE_DETAIL'),{code:'SETTINGS_VERSION_CONFLICT'});return {ok:true}},saveSecret:async(kind,body)=>{calls.push({kind,...body});return {ok:true}}}
 const f=await fixture(t,{settings}),path='/api/settings/provider',body={provider:'second',api:'openai-responses',baseURL:'https://fixture.invalid/v1',expectedVersion:'version'}
 assert.equal((await f.fetchApi(path,{method:'PUT',body})).status,401)
 await f.login()
 assert.equal((await f.fetchApi(path,{method:'PUT',body,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal((await f.fetchApi(path,{method:'PUT',body,headers:{origin:'https://evil.invalid'}})).status,403)
 assert.equal((await f.fetchApi(path,{method:'PUT',body:{...body,apiKeyEnv:'UNEXPECTED'}})).status,400)
 assert.equal((await f.fetchApi(path,{method:'PUT',body})).status,200);assert.deepEqual(calls,[body])
 const stale=await f.fetchApi(path,{method:'PUT',body:{...body,expectedVersion:'stale'}});assert.equal(stale.status,409);assert.deepEqual(stale.body,{error:'SETTINGS_VERSION_CONFLICT'})
 const secret={provider:'second',action:'replace',value:'TEST_SECRET',confirm:true,expectedVersion:'version'}
 assert.equal((await f.fetchApi('/api/settings/secrets/model',{method:'PUT',body:secret})).status,200)
 assert.deepEqual(calls.at(-1),{kind:'model',...secret})
})

test('schedule listing authenticates, projects native data, paginates and never mutates', async t => {
  let reads = 0
  const records = [
    {id: 'schedule-b', title: '每日报告', kind: 'daily', time: '09:00:00.000', timeZone: 'Asia/Shanghai', scheduledAt: '2030-01-02T01:00:00.000Z', status: 'active'},
    {id: 'schedule-a', title: '一次提醒', kind: 'at', scheduledAt: '2030-01-02T01:00:00.000Z', status: 'active'},
    {id: 'schedule-ended', title: '已到期提醒', kind: 'after', afterSeconds: 60, scheduledAt: '2020-01-02T01:00:00.000Z', status: 'inactive'},
  ].map(row => ({...row, prompt: 'PRIVATE_PROMPT', sessionId: 'PRIVATE_SESSION', credentials: 'PRIVATE_CREDENTIALS', lastDelivery: {messageId: 'PRIVATE_MESSAGE'}}))
  const schedule = {async catalog() {reads++; return records}, create() {assert.fail('read must not create')}, update() {assert.fail('read must not update')}}
  const f = await fixture(t, {schedule})
  assert.equal((await f.fetchApi('/api/schedules')).status, 401)
  assert.equal(reads, 0)
  await f.login()
  const first = await f.fetchApi('/api/schedules?state=active&offset=0&limit=1')
  assert.equal(first.status, 200)
  assert.deepEqual(first.body, {items: [{id: 'schedule-a', title: '一次提醒', state: 'active', kind: 'at', scheduledAt: records[1].scheduledAt, scheduleSummary: '单次'}], total: 2, offset: 0, limit: 1, nextOffset: 1})
  const second = await f.fetchApi('/api/schedules?state=active&offset=1&limit=1')
  assert.equal(second.body.items[0].id, 'schedule-b')
  assert.equal(second.body.nextOffset, null)
  assert.match(second.body.items[0].scheduleSummary, /Asia\/Shanghai/)
  assert.doesNotMatch(JSON.stringify([first.body, second.body]), /PRIVATE_|prompt|sessionId|credentials|lastDelivery/)
  const ended = (await f.fetchApi('/api/schedules?state=inactive')).body
  assert.equal(ended.items[0].id, 'schedule-ended')
  assert.equal(ended.items[0].state, 'inactive')
  const clamped = (await f.fetchApi('/api/schedules?offset=999&limit=1')).body
  assert.equal(clamped.offset, 1)
  assert.equal(clamped.items[0].id, 'schedule-b')
  assert.equal(clamped.nextOffset, null)
  const before = reads
  for (const query of ['state=paused', 'state=running', 'state=ended', 'state=unknown', 'state=', 'offset=-1', 'offset=1.5', 'limit=0', 'limit=101', 'limit=2&limit=3', 'sessionId=private']) {
    assert.equal((await f.fetchApi('/api/schedules?' + query)).status, 400, query)
  }
  assert.equal(reads, before)
  assert.equal((await f.fetchApi('/api/schedules', {method: 'POST', body: {}})).status, 404)
  assert.equal(reads, before)
})

test('schedule unavailability and native errors never look like an empty successful catalog', async t => {
  const absent = await fixture(t)
  await absent.login()
  const unavailable = await absent.fetchApi('/api/schedules')
  assert.equal(unavailable.status, 503)
  assert.deepEqual(unavailable.body, {error: 'SCHEDULES_UNAVAILABLE'})
  const broken = await fixture(t, {schedule: {catalog() {throw Object.assign(new Error('PRIVATE_SCHEDULE_FAILURE'), {status: 418, code: 'PRIVATE_ERROR_CODE'})}}})
  await broken.login()
  const failure = await broken.fetchApi('/api/schedules')
  assert.equal(failure.status, 503)
  assert.deepEqual(failure.body, {error: 'SCHEDULES_READ_FAILED'})
})

test('evolution HTTP defaults to ten records and serves disjoint current pages from the saved index', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-evolution-pages-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(root), scope = memoryScope({actorId: 'writer'})
  for (let i=0;i<23;i++) await store.remember(scope,{topic:'facts',key:`record-${i}`,text:'Readable index summary\n\nPRIVATE_BODY',source:{sessionId:'task',messageId:`source-${i}`}})
  const f=await fixture(t,{memory:{store}})
  await f.login()
  const first=await f.fetchApi('/api/evolution?kind=memory')
  assert.equal(first.status,200); assert.equal(first.body.limit,10); assert.equal(first.body.items.length,10)
  assert.equal(first.body.total,23); assert.equal(first.body.nextOffset,10)
  const second=await f.fetchApi('/api/evolution?kind=memory&offset=10')
  const last=await f.fetchApi('/api/evolution?kind=memory&offset=20')
  assert.equal(second.body.items.length,10); assert.equal(last.body.items.length,3)
  assert.equal(last.body.nextOffset,null); assert.equal(last.body.hasMore,false)
  const ids=[...first.body.items,...second.body.items,...last.body.items].map(row=>row.id)
  assert.equal(new Set(ids).size,23)
  assert.deepEqual(second.body.memory,first.body.memory); assert.equal(last.body.revision,first.body.revision)
  assert.doesNotMatch(JSON.stringify([first.body,second.body,last.body]),/PRIVATE_BODY/)
  const skills=await f.fetchApi('/api/evolution?kind=skill')
  assert.equal(skills.body.total,0); assert.deepEqual(skills.body.items,[])
})

test('feedback HTTP starts explicit diagnosis and preserves publish consent, exact preview, owner and CSRF boundaries',async t=>{
 let collected=0,sent=0,payload
 const feedback=createFeedbackService({model:()=>({provider:'test',model:'model'}),resolveModel:async()=>({}),getToken:async()=>'fake',diagnose:async()=>{collected++;return {body:'诊断摘要',evidence:'仅本地展开的合成证据'}},fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);sent++;return{ok:true,json:async()=>({html_url:'https://github.com/zzusp/night-bot/issues/123'})}}})
 t.after(()=>feedback.close());const f=await fixture(t,{feedback})
 const input={title:'异常',description:'操作步骤',model:'test/model',revision:'default'}
 assert.equal((await f.fetchApi('/api/feedback')).status,401);await f.login()
 assert.equal((await f.fetchApi('/api/feedback')).status,200)
 assert.equal((await f.fetchApi('/api/feedback/collect',{method:'POST',body:input,headers:{'x-csrf-token':'forged'}})).status,403)
 assert.equal(collected,0)
 const created=await f.fetchApi('/api/feedback/collect',{method:'POST',body:input});assert.equal(created.status,202)
 const path='/api/feedback/'+created.body.id;let r
 for(let i=0;i<20;i++){r=await f.fetchApi(path);if(r.body.state==='ready')break;await new Promise(r=>setTimeout(r,2))}
 assert.equal(r.body.state,'ready');assert.equal(collected,1)
 assert.equal(r.body.evidence,'仅本地展开的合成证据');assert.doesNotMatch(r.body.body,/合成证据/)
 assert.equal(r.body.body,`## AI 诊断
诊断摘要

## 问题描述
操作步骤`)
 assert.equal((await f.fetchApi(path+'/submit',{method:'POST',body:{title:r.body.title,body:r.body.body}})).status,403)
 const edited=await f.fetchApi(path,{method:'PATCH',body:{title:'修改标题',body:'用户调整'}});assert.equal(edited.status,200)
 assert.equal((await f.fetchApi(path+'/submit',{method:'POST',body:{confirm:true,title:r.body.title,body:r.body.body}})).status,409)
 assert.equal((await f.fetchApi(path+'/submit',{method:'POST',body:{confirm:true,title:edited.body.title,body:edited.body.body}})).status,200);assert.equal(sent,1)
 assert.equal(edited.body.evidence,r.body.evidence);assert.deepEqual(payload,{title:'修改标题',body:'用户调整'})
 await f.login();assert.equal((await f.fetchApi(path)).status,404)
})
test('feedback HTTP manual path needs no model or local data and still requires publish consent',async t=>{
 let sent=0;const forbidden=()=>{assert.fail('manual HTTP accessed diagnostic dependency')}
 const feedback=createFeedbackService({model:forbidden,modelConsent:forbidden,resolveModel:forbidden,getSecrets:forbidden,evidence:forbidden,diagnose:forbidden,getToken:async()=>'fake',fetchImpl:async()=>{sent++;return{ok:true,json:async()=>({html_url:'https://github.com/zzusp/night-bot/issues/123'})}}})
 t.after(()=>feedback.close());const f=await fixture(t,{feedback});const input={title:'异常',description:'只提交填写的内容'}
 assert.equal((await f.fetchApi('/api/feedback/draft',{method:'POST',body:input})).status,401);await f.login()
 assert.equal((await f.fetchApi('/api/feedback')).body.model,null)
 assert.equal((await f.fetchApi('/api/feedback/draft',{method:'POST',body:input,headers:{'x-csrf-token':'forged'}})).status,403)
 const created=await f.fetchApi('/api/feedback/draft',{method:'POST',body:input});assert.equal(created.status,200);assert.equal(created.body.state,'ready');assert.equal(created.body.body,input.description)
 const path='/api/feedback/'+created.body.id
 assert.equal((await f.fetchApi(path+'/submit',{method:'POST',body:{title:created.body.title,body:created.body.body}})).status,403);assert.equal(sent,0)
 const edited=await f.fetchApi(path,{method:'PATCH',body:{title:'修改标题',body:'修改正文'}});assert.equal(edited.status,200)
 assert.equal((await f.fetchApi(path+'/submit',{method:'POST',body:{title:edited.body.title,body:edited.body.body,confirm:true}})).status,200);assert.equal(sent,1)
})

test('execution reads refresh Host secret values and fail closed when the provider fails', async t => {
  let secret = 'opaque-vendor-value-one', unavailable = false, calls = 0
  const snapshot = () => ({header:{id:'pi-one'}, entries:[{id:'commit-one'}],
    audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-one',sessionId:'pi-one'}}],
    context:{projection:{entries:[{sourceEntry:{id:'body',timestamp:'2026-11-12T00:00:00Z'},messages:[{role:'assistant',content:[{type:'text',text:('public text '.repeat(1600)) + secret}]}]}]}}})
  const f = await fixture(t,{persistence:{readNative:async()=>snapshot()},redactionSecrets:async()=>{calls++;if(unavailable)throw new Error('PRIVATE_PROVIDER_ERROR');return [secret]}})
  await f.login()
  const page = await f.fetchApi('/api/tasks/task-one/session')
  assert.equal(page.status,200)
  assert.equal(page.body.items[0].redacted,true)
  let body = await f.fetchApi(`/api/tasks/task-one/session/messages/${page.body.items[0].id}?offset=16000&revision=${page.body.revision}`)
  assert.equal(body.status,200);assert.doesNotMatch(JSON.stringify(body.body),/opaque-vendor-value-one/)
  secret='opaque-vendor-value-two'
  body = await f.fetchApi(`/api/tasks/task-one/session/messages/${page.body.items[0].id}?offset=16000&revision=${page.body.revision}`)
  assert.equal(body.status,200);assert.doesNotMatch(JSON.stringify(body.body),/opaque-vendor-value-two/)
  assert.equal(calls,6, 'each response refreshes secrets before projection and at its final guard')
  unavailable=true
  const denied = await f.fetchApi('/api/tasks/task-one/session')
  assert.equal(denied.status,503)
  assert.doesNotMatch(JSON.stringify(denied.body),/opaque-vendor|PRIVATE_PROVIDER_ERROR/)
})


test('evolution index labels are redacted before response and file caching', async t => {
  const root = await mkdtemp(join(tmpdir(), 'night-web-index-labels-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const store = new MarkdownMemoryStore(root), scope = memoryScope({actorId: 'writer'})
  await store.remember(scope, {topic: 'facts', key: 'safe-key', text: 'Public summary', source: {sessionId: 'task', messageId: 'source'}})
  const f = await fixture(t, {memory: {store}})
  const token = (await readFile(f.web.credentialPath, 'utf8')).trim()
  const indexPath = join(store.directory(scope), 'index.md')
  const index = await readFile(indexPath, 'utf8')
  await writeFile(indexPath, index.replace('[safe-key]', '[标题 ' + token + ']').replace('Public summary', '摘要 ' + token))
  await f.login()
  const result = await f.fetchApi('/api/evolution?kind=memory&refresh=1')
  assert.equal(result.status, 200)
  assert.ok(result.body.items[0].name.startsWith('标题 '))
  assert.ok(result.body.items[0].summary.startsWith('摘要 '))
  assert.ok(!JSON.stringify(result.body).includes(token))
  const directory = join(f.paths.cache, (await readdir(f.paths.cache))[0])
  const cachePath = join(directory, (await readdir(directory)).find(name => name.endsWith('.pages')))
  assert.ok(!(await readFile(cachePath, 'utf8')).includes(token))
})

test('light execution HTTP binds login and endpoint, uses identity-only task reads and rechecks secret rotation', async t=>{
 let secret=[],rotate=false,nativeReads=0
 const snapshot={journalDigest:'safe-bytes',header:{id:'pi-one'},entries:[{id:'commit-one'}],audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-one',sessionId:'pi-one'}}],context:{projection:{entries:[]}}}
 const persistence={readNative:async()=>{nativeReads++;return snapshot},readNativeDigest:async()=>{if(rotate)secret=['rotated-secret'];return 'safe-bytes'},readLive:async()=>({sessionId:'pi-one',active:true,revision:'r1',assistant:{id:'stream',message:{role:'assistant',content:[{type:'text',text:'正在核对。',complete:true}]}},tools:[]})}
 const f=await fixture(t,{persistence,redactionSecrets:async()=>secret})
 f.app.tasks.store={query:async q=>q.kind==='task.get'&&q.taskId==='task-one'?{taskId:'task-one',groupId:'room-one',sessionId:'pi-one',sessionBound:true}:null}
 f.app.tasks.taskDetail=async()=>{assert.fail('execution polling must not assemble the complete task-detail DTO')}
 await f.login()
 const full=await f.fetchApi('/api/tasks/task-one/session?stream=1');assert.equal(full.status,200);assert.ok(full.body.liveProof)
 const endpoint='/api/tasks/task-one/session?live='+full.body.liveProof
 const light=await f.fetchApi(endpoint);assert.equal(light.status,200);assert.equal(light.body.historyChanged,false);assert.equal(nativeReads,1)
 rotate=true
 const denied=await f.fetchApi(endpoint);assert.equal(denied.status,409);assert.doesNotMatch(JSON.stringify(denied.body),/正在核对/)
 rotate=false;secret=[]
 await f.login()
 assert.equal((await f.fetchApi(endpoint)).body.historyChanged,true,'a new login cannot reuse the old login proof')
 await f.fetchApi('/api/logout',{method:'POST',body:{}})
 assert.equal((await f.fetchApi(endpoint)).status,401)
})

test('drain failure summary and blocker expose only fixed facts, never arbitrary exception details',async()=>{
 const {taskView,taskSummaryView}=await import('../server/views.js')
 const task={taskId:'t',status:'active',control:'active',sessionFailure:{code:'TASK_SESSION_DRAIN_FAILED',message:'SECRET_EXCEPTION',path:'C:\private\fault.txt'},blockers:{executions:[],operations:[],legacy:[]}}
 assert.equal(taskSummaryView(task).state,'interrupted')
 assert.equal(taskSummaryView({...task,status:'completed'}).state,'completed')
 assert.equal(taskSummaryView({...task,control:'cancelled'}).state,'cancelled')
 const view=taskView(task);assert.equal(view.blockers.length,1);assert.equal(view.blockers[0].status,'failed');assert.match(view.blockers[0].title,/排空失败/)
 assert.doesNotMatch(JSON.stringify(view),/SECRET_EXCEPTION|private|sessionFailure|message/)
 assert.deepEqual(taskView({...task,sessionFailure:{code:'UNKNOWN_ERROR',message:'SECRET_EXCEPTION'}}).blockers,[])
})

test('default HTTP refresh reuses SQLite per-file statistics and keeps stale pages if the database is damaged', async t => {
  const {Context} = await import('@deepseek-ai/cordis')
  const {default: PiPersistence} = await import('../../../src/pi-session-persistence.js')
  const Authority = await import('../../../src/pi-authority.js')
  const root = await mkdtemp(join(tmpdir(), 'night-web-usage-default-')), ctx = new Context()
  await ctx.plugin(Authority)
  const persistence = new PiPersistence(ctx, {root: join(root, 'sessions')})
  const store = new MarkdownMemoryStore(join(root, 'memory')), scope = memoryScope({actorId: 'writer'})
  const remembered = await store.remember(scope, {topic: 'facts', key: 'one', text: 'Public summary\n\nPRIVATE_HTTP_MEMORY_BODY', source: {sessionId: 'one', messageId: 'one'}})
  const writer = await persistence.createNative({version: 4, id: 'one', createdAt: Date.now(), isSeeded: false, cwd: root}, {auditKinds: {'task/identity': () => true}})
  writer.appendAudit({version: 1, domain: 'task', kind: 'identity', payload: {taskId: 'task-one', sessionId: 'one'}})
  writer.manager.appendMessage({role: 'assistant', content: [{type: 'toolCall', id: 'read-one', name: 'memory_read', arguments: {}}], timestamp: Date.now()})
  const value = {kind: 'night-memory-result', scopeToken: scope.kind + '/' + scope.id, revision: remembered.revision, entries: [{id: remembered.entry.id}]}
  writer.manager.appendMessage({role: 'toolResult', toolName: 'memory_read', toolCallId: 'read-one', isError: false, timestamp: Date.now(), content: [], details: {nativeResult: {value}}})
  await writer.close()
  let f, reads = 0
  const nativeRead = persistence.readNative.bind(persistence)
  persistence.readNative = async (...args) => {reads++; return nativeRead(...args)}
  t.after(async () => {await f?.web.close(); await ctx.fiber.dispose(); await rm(root, {recursive: true, force: true})})
  f = await fixture(t, {memory: {store}, persistence})
  f.app.tasks.store = {query: async q => q.kind === 'observer.page' ? {items: [{taskId: 'task-one', sessionId: 'one'}], total: 1, nextOffset: null} : []}
  await f.login()
  const first = await f.fetchApi('/api/evolution?refresh=1')
  assert.equal(first.status, 200); assert.equal(first.body.memory.readCount, 1); assert.equal(first.body.cache.stale, false)
  const coldReads = reads
  const second = await f.fetchApi('/api/evolution?refresh=1')
  assert.equal(second.body.memory.readCount, 1); assert.equal(second.body.usageCoverage.sessionsReused, 1); assert.equal(reads, coldReads)
  const directory = join(f.paths.cache, (await readdir(f.paths.cache))[0])
  const database = join(directory, (await readdir(directory)).find(name => name.endsWith('.sqlite')))
  assert.doesNotMatch((await readFile(database)).toString(), /PRIVATE_HTTP_MEMORY_BODY|scopeToken|storageId/)
  await f.restart(); await f.login()
  const restored = await f.fetchApi('/api/evolution?refresh=1')
  assert.equal(restored.body.usageCoverage.sessionsReused, 1); assert.equal(reads, coldReads)
  await f.web.close(); await writeFile(database, 'broken cache, not business data')
  await f.restart(); await f.login()
  const stale = await f.fetchApi('/api/evolution?refresh=1')
  assert.equal(stale.status, 200); assert.equal(stale.body.memory.readCount, 1); assert.equal(stale.body.cache.stale, true)
  assert.equal(stale.body.cache.updatedAt, restored.body.cache.updatedAt)
})

test('task list HTTP defaults to ten rows and preserves explicit page limits',async t=>{
 const f=await fixture(t);await f.login()
 const calls=[]
 f.app.tasks.boardTasks=async options=>{calls.push(options);return {items:[],total:0,offset:options.offset,limit:options.limit,nextOffset:null}}
 assert.equal((await f.fetchApi('/api/tasks')).status,200)
 assert.equal(calls[0].limit,10)
 assert.equal((await f.fetchApi('/api/tasks?offset=20&limit=25')).status,200)
 assert.equal(calls[1].limit,25);assert.equal(calls[1].offset,20)
 assert.equal((await f.fetchApi('/api/tasks?state=not-running&offset=10')).status,200)
 assert.equal(calls[2].state,'not-running');assert.equal(calls[2].offset,10)
 assert.equal((await f.fetchApi('/api/tasks?limit=101')).status,400)
})

test('channel Router operator messages require authenticated CSRF scope and never enter channel receive',async t=>{
 const f=await fixture(t),calls=[]
 f.app.tasks.sendRouterOperatorMessage=async args=>{calls.push(args);return {requestId:args.requestId,status:'accepted',webOnly:true}}
 f.app.tasks.routerOperatorRequest=async args=>args.requestId==='known'?{status:'accepted',webOnly:true}:null
 const path='/api/conversations/room-one/router/messages',body={requestId:'known',text:'Synthetic question'}
 assert.equal((await f.fetchApi(path,{method:'POST',body})).status,401)
 await f.login()
 assert.equal((await f.fetchApi(path,{method:'POST',body,headers:{'x-csrf-token':'wrong'}})).status,403)
 assert.equal((await f.fetchApi('/api/conversations/foreign/router/messages',{method:'POST',body})).status,404)
 assert.equal((await f.fetchApi(path,{method:'POST',body:{...body,actorId:'impersonated'}})).status,400)
 assert.equal((await f.fetchApi(path,{method:'POST',body:{...body,text:' '}})).status,400)
 assert.equal(calls.length,0)
 const result=await f.fetchApi(path,{method:'POST',body});assert.equal(result.status,202)
 assert.deepEqual(calls,[{conversationId:'room-one',requestId:'known',text:'Synthetic question'}]);assert.equal(f.received.length,0)
 assert.equal((await f.fetchApi('/api/conversations/room-one/router/requests/known')).status,200)
 assert.equal((await f.fetchApi('/api/conversations/room-one/router/requests/missing')).status,404)
})

test('compaction chart uses authenticated current Router events even with zero messages; old triage APIs are gone',async t=>{
 let reads=0
 const f=await fixture(t,{persistence:{readNative:async()=>{reads++;throw Error('old journal must not be opened')}}})
 const router={id:'room-one',activeSessionId:'router-one',generation:1}
 f.app.tasks.store={query:async q=>q.kind==='router.get'?router:{sources:[],notifications:[]}}
 f.app.tasks.observerGroupPage=async()=>({items:[],total:0,nextOffset:null})
 const calls=[]
 f.app.tasks.listExecutionTrace=async filter=>{calls.push(filter);return {items:[{groupId:'room-one',sessionId:'router-one',runtimeOwner:'conversation-router',kind:'phase',phase:'foreground-compaction',spanId:'one',runId:'run',startedAt:1000,endedAt:4000,status:'observed',outcome:'completed'}],nextOffset:null}}
 assert.equal((await f.fetchApi('/api/conversations/room-one/stage-times')).status,401)
 await f.login()
 for(const path of ['/api/conversations/room-one/triage/session','/api/conversations/room-one/triage/session/messages/old','/api/chat/old/triage/session'])assert.equal((await f.fetchApi(path)).status,404)
 assert.equal(reads,0,'removed endpoints never read old journals')
 const page=await f.fetchApi('/api/conversations/room-one/stage-times')
 assert.equal(page.status,200);assert.deepEqual(page.body.items,[]);assert.equal(page.body.compactions.items.length,1)
 assert.equal(page.body.compactions.items[0].receivedAt,new Date(4000).toISOString());assert.equal(page.body.compactions.items[0].compaction.durationMs,3000)
 assert.doesNotMatch(JSON.stringify(page.body),/triage|sourceId|spanId|router-one/)
 const count=calls.length
 const contextOnly=await f.fetchApi('/api/conversations/room-one/stage-times?contextWindow=1')
 assert.equal(contextOnly.status,200);assert.deepEqual(contextOnly.body.contextWindow,{status:'unavailable'});assert.equal(Object.hasOwn(contextOnly.body,'compactions'),false)
 assert.equal(calls.length,count,'context card must not scan retained compaction traces')
 assert.equal((await f.fetchApi('/api/conversations/room-one/stage-times?contextWindow=invalid')).status,400)
 assert.equal((await f.fetchApi('/api/conversations/foreign/stage-times?contextWindow=1')).status,404);assert.equal(calls.length,count)
})

test('channel activity scopes every count and page before querying, rejects foreign targets and keeps global overview',async t=>{
 const identity=input=>Channels.prototype.identity.call({host:{runtimePaths:{workspaces:'/tmp/synthetic-conversations'}}},input).sessionId
 const message={type:'chat-room',channelId:'same-plugin',conversationId:'room-one',senderId:'actor',messageId:'synthetic',text:'Synthetic',conversationName:'Same display name'}
 assert.equal(new Set([identity(message),identity({...message,conversationId:'room-two'}),identity({...message,channelId:'other-plugin'}),identity({...message,type:'chat'})]).size,4)
 assert.equal(identity(message),identity({...message,senderId:'other-member'}),'group members share one stable room scope')
 const f=await fixture(t),calls=[],groups=['room-one','room-two','room-empty']
 f.app.tasks.listObserverGroups=()=>groups.map(groupId=>({groupId,name:'Same display name'}))
 const rows=[...Array.from({length:12},(_,i)=>({taskId:'b-'+i,groupId:'room-two',title:'B synthetic '+i,state:'running'})),{taskId:'a-run',groupId:'room-one',title:'A synthetic running',state:'running'},{taskId:'a-interrupted',groupId:'room-one',title:'A synthetic interrupted',state:'interrupted'},{taskId:'global',title:'Standalone synthetic',state:'running'}]
 f.app.tasks.boardTasks=async q=>{calls.push(q);const selected=rows.filter(row=>(!q.groupId||row.groupId===q.groupId)&&(!q.state||row.state===q.state));return {items:selected.slice(q.offset,q.offset+q.limit),total:selected.length,nextOffset:null,limit:q.limit,offset:q.offset}}
 assert.equal((await f.fetchApi('/api/conversations/room-one/activity')).status,401);assert.equal(calls.length,0)
 await f.login();assert.equal((await f.fetchApi('/api/conversations/foreign/activity')).status,404);assert.equal(calls.length,0)
 const a=(await f.fetchApi('/api/conversations/room-one/activity')).body
 assert.deepEqual(a.scope,{conversationId:'room-one'});assert.equal(a.running.total,1);assert.equal(a.interrupted.total,1);assert.equal(a.tasks.total,2)
 assert.ok(calls.every(q=>q.groupId==='room-one'&&q.offset===0&&q.limit===5&&q.archived===false));assert.ok(a.tasks.items.every(row=>row.groupId==='room-one'))
 const b=(await f.fetchApi('/api/conversations/room-two/activity')).body;assert.equal(b.running.total,12);assert.equal(b.running.items.length,5)
 const empty=(await f.fetchApi('/api/conversations/room-empty/activity')).body;assert.equal(empty.tasks.total,0);assert.equal(empty.running.total,0);assert.equal(empty.interrupted.total,0)
 const count=calls.length;assert.equal((await f.fetchApi('/api/conversations/room-one/activity?groupId=room-two')).status,400);assert.equal(calls.length,count)
 const global=(await f.fetchApi('/api/overview')).body;assert.equal(global.running.total,14)
 const board=f.app.tasks.boardTasks;f.app.tasks.boardTasks=async q=>{if(q.state==='running')throw Error('PRIVATE_ERROR');return board(q)}
 const partial=(await f.fetchApi('/api/conversations/room-one/activity')).body;assert.equal(partial.running,null);assert.equal(partial.interrupted.total,1);assert.equal(partial.sectionErrors.running,'SECTION_UNAVAILABLE');assert.ok(!JSON.stringify(partial).includes('PRIVATE_ERROR'))
})

test('direct task input endpoint requires authenticated exact session and scopes receipts to the task',async t=>{
 const f=await fixture(t),path='/api/tasks/task-one/input',calls=[]
 const body={sessionId:'pi-one',requestId:'new-direct-1',text:'直接补充执行事项'}
 let recorded
 f.app.tasks.sendTaskInput=async args=>{calls.push(args);if(args.text!=='直接补充执行事项')throw Object.assign(new Error('private details'),{code:'DYNAMIC_COMMAND_ID_CONFLICT'});return recorded={taskId:args.taskId,sessionId:args.sessionId,requestId:args.requestId,status:'accepted'}}
 f.app.tasks.taskInputReceipt=async({taskId,requestId})=>recorded?.taskId===taskId&&recorded?.requestId===requestId?recorded:null
 const post=(input,headers)=>f.fetchApi(path,{method:'POST',body:input,headers})
 assert.equal((await post(body)).status,401)
 assert.equal((await f.fetchApi(path+'/'+body.requestId)).status,401)
 await f.login()
 assert.equal((await post(body,{'x-csrf-token':'forged'})).status,403)
 assert.equal((await post({...body,sessionId:'pi-other'})).status,409)
 assert.equal((await post({...body,actorId:'forged'})).status,400)
 assert.equal(calls.length,0)
 assert.equal((await post(body)).status,202)
 assert.deepEqual((await f.fetchApi(path+'/'+body.requestId)).body,recorded)
 assert.equal((await f.fetchApi('/api/tasks/unrelated/input/'+body.requestId)).status,404)
 assert.deepEqual((await post({...body,text:'changed'})).body,{error:'DYNAMIC_COMMAND_ID_CONFLICT'})
 assert.equal(f.received.length,0,'operator action does not use channel receive')
})

test('Router principles HTTP uses an independent authenticated file and version',async t=>{
 const settings={},f=await fixture(t,{settings}),paths=runtimePaths({installRoot:f.root,dataDir:'data'})
 await prepareRuntimePaths(paths);Object.assign(settings,createOperatorSettings({paths,getCredentials:()=>undefined}))
 const router='/api/settings/router-principles',execution='/api/settings/execution-principles'
 const get=path=>f.fetchApi(path)
 const put=(path,text,expectedVersion,headers,extra)=>f.fetchApi(path,{method:'PUT',body:{text,expectedVersion,...extra},headers})
 assert.equal((await get(router)).status,401)
 assert.equal((await put(router,'private','0'.repeat(64))).status,401)
 await f.login()
 const prior=(await get(router)).body,beforeExecution=(await get(execution)).body
 assert.equal(prior.text,'')
 assert.notEqual(prior.version,beforeExecution.version)
 assert.equal((await put(router,'private',beforeExecution.version)).status,409)
 assert.equal((await put(router,'private',prior.version,{'x-csrf-token':'forged'})).status,403)
 assert.equal((await put(router,'private',prior.version,{origin:'https://untrusted.invalid'})).status,403)
 assert.equal((await put(router,'private',prior.version,undefined,{path:'execution/AGENTS.md'})).status,400)
 const attempts=await Promise.all([put(router,'# Router work',prior.version),put(router,'# other tab',prior.version)])
 assert.deepEqual(attempts.map(row=>row.status).sort(),[200,409])
 const saved=attempts.find(row=>row.status===200).body
 assert.deepEqual((await get(router)).body,saved)
 assert.equal(await readFile(join(paths.config,'router','AGENTS.md'),'utf8'),saved.text)
 assert.deepEqual((await get(execution)).body,beforeExecution)
 const executionEdit=await put(execution,'# Execution work',beforeExecution.version)
 assert.equal(executionEdit.status,200)
 assert.deepEqual((await get(router)).body,saved)
 assert.equal((await put(router,'',saved.version)).body.text,'')
 assert.deepEqual((await get(execution)).body,executionEdit.body)
})

test('execution HTTP independently authorizes exact resource bodies and revokes continuations after edits', async t => {
  const {Context} = await import('@deepseek-ai/cordis')
  const {default: PiPersistence} = await import('../../../src/pi-session-persistence.js')
  const Authority = await import('../../../src/pi-authority.js')
  const {renderMemoryIndex} = await import('../../../src/memory/tools.js')
  const {renderSkillContent} = await import('../../../src/native-skill-protocol.js')
  const root = await mkdtemp(join(tmpdir(), 'night-web-resource-tools-')), ctx = new Context()
  t.after(async () => {await ctx.fiber.dispose(); await rm(root, {recursive: true, force: true})})
  await ctx.plugin(Authority)
  const paths = runtimePaths({installRoot: root, dataDir: 'data'})
  await prepareRuntimePaths(paths)
  const store = new MarkdownMemoryStore(paths.memory), scope = memoryScope({actorId:'writer'})
  const persistence = new PiPersistence(ctx,{root:join(root,'journals')})
  const fact = 'Authoritative memory body; retained compatibility.'
  await store.remember(scope,{topic:'facts',key:'one',text:fact,source:{sessionId:'PRIVATE_ORIGIN',messageId:'PRIVATE_MESSAGE'}})
  const scopeToken = scope.kind+'/'+scope.id
  const value = {kind:'night-memory-result',scopeToken,...await store.read(scope,{topic:'facts',key:'one',includeSources:false})}
  const index = {kind:'night-memory-result',scopeToken,stage:'filtered-index',...await store.index(scope,{topic:'facts'})}
  index.entries[0].applicability = {status:'reference-only',sourceMessageIds:['PRIVATE_SUBJECT']}
  index.markdown = renderMemoryIndex(index)

  const body = 'Section one\n'+'x'.repeat(15980)+'ROTATINGPRIVATEVALUE'+'\ncontinue here\n'+'y'.repeat(600)
  const dir = join(paths.skills,'public-check'), file = join(dir,'SKILL.md')
  const skillDoc = (name, text, extra='') => '---\nname: '+name+'\ndescription: Public shared instructions\n'+extra+'---\n\n'+text+'\n'
  await mkdir(dir,{recursive:true})
  await writeFile(file,skillDoc('public-check',body))
  const skill = {name:'public-check',provider:'filesystem',resourceBase:{kind:'directory',path:dir},content:body}
  const privateDir = join(paths.workspaces,'task-private','.agents','skills','public-check')
  await mkdir(privateDir,{recursive:true})
  await writeFile(join(privateDir,'SKILL.md'),skillDoc('public-check','PRIVATE_LOCAL_BODY'))
  const privateSkill = {...skill,resourceBase:{kind:'directory',path:privateDir},content:'PRIVATE_LOCAL_BODY'}
  const writer = await persistence.createNative({version:4,id:'pi-one',createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{'task/identity':()=>true}})
  writer.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:'task-one',sessionId:'pi-one'}})
  const append = (id,name,args,value,rendered,{orphan=false,receipt=true}={}) => {
    if (!orphan) writer.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id,name,arguments:args}],timestamp:Date.now()})
    const content=[{type:'text',text:rendered}]
    writer.manager.appendMessage({role:'toolResult',toolName:name,toolCallId:id,isError:false,content,timestamp:Date.now(),
      ...receipt?{details:{nativeResult:{value,content,isError:false}}}:{}})
  }
  const args = {topic:'facts',key:'one'}
  append('memory-fact','memory_read',args,value,JSON.stringify(value))
  append('memory-path','memory_read',{path:index.entries[0].path,includeSources:true},value,JSON.stringify(value))
  append('memory-index','memory_read',{topic:'facts'},index,index.markdown)
  const foreign = {...value,scopeToken:'personal/foreign'}
  append('foreign-memory','memory_read',args,foreign,JSON.stringify(foreign))
  append('missing-native-receipt','memory_read',args,value,JSON.stringify(value),{receipt:false})
  append('skill','skill',{name:skill.name},skill,renderSkillContent(skill))
  append('private-skill','skill',{name:skill.name},privateSkill,renderSkillContent(privateSkill))
  append('orphan-skill','skill',{name:skill.name},skill,renderSkillContent(skill),{orphan:true})
  await writer.close()

  let actorId='operator', redactionSecrets=['ROTATINGPRIVATEVALUE']
  const memory={store,host:{runtimePaths:paths, get:()=>undefined}}
  const f=await fixture(t,{persistence,memory,identityBinding:()=>({actorId}),redactionSecrets:async()=>redactionSecrets})
  const endpoint='/api/tasks/task-one/session'
  assert.equal((await f.fetchApi(endpoint)).status,401)
  await f.login()
  const page=await f.fetchApi(endpoint+'?stream=1')
  assert.equal(page.status,200)
  assert.equal(page.body.liveProof,undefined)
  const rows=page.body.items.filter(row=>row.kind==='tool-result')
  assert.deepEqual(rows.map(row=>[Boolean(row.resourceContent),row.toolName]),[[true,'memory_read'],[true,'memory_read'],[true,'memory_read'],[false,'memory_read'],[false,'memory_read'],[true,'skill'],[false,'skill'],[false,'skill']])
  assert.equal(rows[0].text,fact)
  assert.equal(rows[1].text,fact)
  assert.match(rows[2].text,/^# Memory index[\s\S]+categories\/facts\/entries\/one.md/)
  assert.doesNotMatch(rows[2].text,/仅供参考/)
  assert.ok(rows[5].redacted)
  assert.equal(rows[5].textNextOffset,16000)
  assert.deepEqual(rows.map(row=>row.skillName),[undefined,undefined,undefined,undefined,undefined,skill.name,undefined,undefined])
  assert.ok(page.body.items.filter(row=>row.kind==='tool-call').every(row=>row.skillName===undefined))
  assert.doesNotMatch(JSON.stringify(page.body),/PRIVATE_ORIGIN|PRIVATE_MESSAGE|PRIVATE_SUBJECT|PRIVATE_LOCAL|ROTATINGPRIVATE|resourceBase/)
  const continuation=(row,offset)=>endpoint+'/messages/'+row.id+'?revision='+page.body.revision+'&offset='+offset
  const next=await f.fetchApi(continuation(rows[5],16000))
  assert.equal(next.status,200);assert.equal(next.body.resourceContent,true)
  assert.equal(rows[5].text+next.body.text,body.replace('ROTATINGPRIVATEVALUE','[已隐藏]'))
  redactionSecrets=[...redactionSecrets,skill.name]
  const hiddenName=await f.fetchApi(endpoint+'?stream=1')
  const sameBody=hiddenName.body.items.find(row=>row.id===rows[5].id)
  assert.equal(sameBody.text,rows[5].text)
  assert.equal(sameBody.resourceContent,true)
  assert.equal(sameBody.skillName,undefined)
  assert.doesNotMatch(JSON.stringify(hiddenName.body),/public-check/)
  assert.equal((await f.fetchApi(continuation(rows[5],16000))).status,409)
  assert.equal((await f.fetchApi(endpoint+'?stream=1&checkpoint='+page.body.checkpoint)).status,409)
  redactionSecrets=['ROTATINGPRIVATEVALUE']
  actorId='different-operator'
  assert.equal((await f.fetchApi(continuation(rows[5],16000))).status,409)
  assert.ok((await f.fetchApi(endpoint+'?stream=1')).body.items.every(row=>!row.resourceContent))
  actorId='operator'
  await writeFile(file,skillDoc('public-check','Only current text is authorized.','disable-model-invocation: true\n'))
  assert.equal((await f.fetchApi(continuation(rows[5],16000))).status,409)
  assert.equal((await f.fetchApi(endpoint+'?stream=1&checkpoint='+page.body.checkpoint)).status,409)
  await store.forget(scope,{topic:'facts',key:'one',source:{sessionId:'writer',messageId:'forget-one'}})
  const after=await f.fetchApi(endpoint+'?stream=1')
  assert.equal(after.status,200)
  assert.ok(after.body.items.every(row=>!row.resourceContent&&row.skillName===undefined))
  assert.doesNotMatch(JSON.stringify(after.body),/Authoritative memory body|continue here/)
  assert.equal((await f.fetchApi(continuation(rows[0],0))).status,409)
})

test('task zero-new polls time six facts, six learned and two file skills separately', async t => {
  const {Context}=await import('@deepseek-ai/cordis')
  const {default:PiPersistence}=await import('../../../src/pi-session-persistence.js')
  const Authority=await import('../../../src/pi-authority.js')
  const {default:Reflection}=await import('../../../src/memory/reflection.js')
  const {renderSkillContent}=await import('../../../src/native-skill-protocol.js')
  const root=await mkdtemp(join(tmpdir(),'night-web-poll-stages-')),ctx=new Context()
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
  await ctx.plugin(Authority)
  const paths=runtimePaths({installRoot:root,dataDir:'data'})
  await prepareRuntimePaths(paths)
  const store=new MarkdownMemoryStore(paths.memory),scope=memoryScope({actorId:'fixture-writer'})
  const reflection=Object.assign(Object.create(Reflection.prototype),{host:{memory:{store}}})
  const persistence=new PiPersistence(ctx,{root:join(root,'journals')})
  const writer=await persistence.createNative({version:4,id:'pi-one',createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{'task/identity':()=>true}})
  writer.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:'task-one',sessionId:'pi-one'}})
  const source=key=>({sessionId:'fixture-source',messageId:key})
  const append=(id,name,args,value,text)=>{
    writer.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id,name,arguments:args}],timestamp:Date.now()})
    const content=[{type:'text',text}]
    writer.manager.appendMessage({role:'toolResult',toolName:name,toolCallId:id,isError:false,content,timestamp:Date.now(),details:{nativeResult:{value,content,isError:false}}})
  }
  const pad=i=>writer.manager.appendMessage({role:'user',content:[{type:'text',text:`Fixture row ${i}`}],timestamp:Date.now()})
  for(let i=0;i<187;i++)pad(i)
  await store.remember(scope,{topic:'experience',key:'verified-support',text:'Verified evidence supporting the fixture skills.',source:source('support')})
  const skills={}
  for(let i=0;i<6;i++){
    const key=`fact-${i}`,args={topic:'facts',key}
    await store.remember(scope,{...args,text:`Independently verified fact ${i}.`,source:source(key)})
    const result={kind:'night-memory-result',scopeToken:`bot/${scope.id}`,...await store.read(scope,{...args,includeSources:false})}
    append(key,'memory_read',args,result,JSON.stringify(result))
    const skillKey=`verified-${i}`,name=`learned-${skillKey}`
    skills[skillKey]={revision:1,active:true,origin:'task-reflection',applicability:'Check evidence',body:`Approved steps ${i}.`,supports:[{memoryKey:'verified-support'}]}
    const skill={name,provider:'learned',content:reflection.renderSkill(scope,skillKey,skills[skillKey])}
    append(name,'skill',{name},skill,renderSkillContent(skill))
  }
  await mkdir(reflection.directory(scope),{recursive:true})
  await writeFile(join(reflection.directory(scope),'state.json'),JSON.stringify({skills}))
  for(let i=0;i<2;i++){
    const name=`ordinary-${i}`,path=join(paths.skills,name),content=`Current ordinary skill ${i}.`
    await mkdir(path,{recursive:true})
    await writeFile(join(path,'SKILL.md'),`---\nname: ${name}\ndescription: Fixture skill\n---\n\n${content}\n`)
    const skill={name,provider:'filesystem',resourceBase:{kind:'directory',path},content}
    append(name,'skill',{name},skill,renderSkillContent(skill))
  }
  pad(187)
  await writer.close()
  const f=await fixture(t,{persistence,memory:{store,host:{runtimePaths:paths,get:key=>key==='reflection'?reflection:undefined}}})
  const endpoint='/api/tasks/task-one/session?stream=1'
  const denied=await f.fetchApi(endpoint)
  assert.equal(denied.status,401)
  assert.equal(denied.response.headers.get('server-timing'),null)
  await f.login()
  const wide=await f.fetchApi(endpoint+'&limit=200'),narrow=await f.fetchApi(endpoint+'&limit=1')
  assert.equal(wide.status,200);assert.equal(narrow.status,200)
  assert.equal(wide.body.total,216);assert.equal(wide.body.items.length,200)
  const rows=wide.body.items.filter(row=>row.resourceContent)
  assert.equal(rows.filter(row=>row.toolName==='memory_read').length,6)
  assert.equal(rows.filter(row=>row.skillName?.startsWith('learned-')).length,6)
  assert.equal(rows.filter(row=>row.skillName?.startsWith('ordinary-')).length,2)
  assert.equal(wide.body.checkpoint,narrow.body.checkpoint+'.r')
  assert.ok(wide.body.resourceProof);assert.equal(narrow.body.resourceProof,undefined)
  const poll=async (page,loaded)=>{
    const response=await f.fetchApi(endpoint+'&'+new URLSearchParams({limit:'1',checkpoint:page.checkpoint,...(loaded?{resources:page.resourceProof}:{})}))
    assert.equal(response.status,200)
    assert.equal(response.body.sessionId,wide.body.sessionId);assert.equal(response.body.total,216)
    assert.equal(response.body.checkpoint,page.checkpoint);assert.deepEqual(response.body.items,[])
    assert.equal(Boolean(response.body.resourceProof),loaded)
    const header=response.response.headers.get('server-timing')
    assert.match(header,/^[a-z_]+;dur=\d+\.\d(?:, [a-z_]+;dur=\d+\.\d)*$/)
    return {page:response.body,timing:Object.fromEntries([...header.matchAll(/([a-z_]+);dur=([\d.]+)/g)].map(([,key,ms])=>[key,Number(ms)]))}
  }
  const expected=['resource_skill_scan','resource_memory_batch','resource_learned_batch','resource_memory_recheck','memory_wait','memory_lock_write','memory_lock_release']
  const readings=[]
  let page=wide.body
  for(let i=0;i<4;i++){
    const empty=await poll(narrow.body,false)
    assert.equal(empty.timing.permissions,undefined)
    assert.ok(expected.every(key=>empty.timing[key]===undefined))
    const full=await poll(page,true);page=full.page
    assert.ok(expected.every(key=>Number.isFinite(full.timing[key])))
    assert.ok(full.timing.permissions>=full.timing.memory_wait)
    readings.push({withoutProof:empty.timing.request,...Object.fromEntries(['request','permissions',...expected].map(key=>[key,full.timing[key]]))})
  }
  t.diagnostic(JSON.stringify(readings))
})
