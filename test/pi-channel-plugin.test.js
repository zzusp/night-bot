import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,access} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {createHost} from '../src/host.js'
import {apply as applyDws} from '../src/channels/plugins/dingtalk-dws.js'
import {apply as applyApplication,inject} from '../src/application.js'

test('core initializes without a DWS executable or plugin, and disabled plugins never register a transport',async t=>{
  const f=await memoryHost(t);assert.equal(f.host.ctx.get('dingtalkChannel'),undefined);assert.equal(f.host.ctx.channels.transports.size,0)
  await f.close();const config={...f.config,channelPlugins:[{type:'dingtalk-dws',enabled:false,config:{executable:'/missing/dws-must-never-run'}}]}
  const host=await createHost(config);try{assert.equal(host.ctx.get('dingtalkChannel'),undefined);assert.equal(host.ctx.channels.transports.size,0);await assert.rejects(access(join(host.ctx.runtimePaths.secrets,'dingtalk-dws')),error=>error.code==='ENOENT')}finally{await host.close()}
})
test('optional DWS plugin registers the typed boundary, preserves authenticated sender/quote and confines account data',async t=>{
  const f=await memoryHost(t);let commands=0
  const runner={cwd:f.root,async run(){commands++;throw Error('No real CLI calls in plugin registration test')},spawn(){commands++;throw Error('No subscription requested')}}
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,profile:'fixture-profile',writesAuthorized:false,listen:false},{runner})})
  const plugin=f.host.ctx.get('dingtalkChannel');assert.ok(plugin);assert.ok(plugin.accountDirectory.startsWith(join(f.root,'data','secrets')))
  await f.host.ctx.parallel('night/ready',{runtime:{},tasks:{}})
  let captured;const receive=f.host.ctx.channels.receive.bind(f.host.ctx.channels);f.host.ctx.channels.receive=input=>{captured=input;return receive(input)}
  const response=await plugin.acceptHistoryMessage({groupId:'room-fixture',messageId:'real-source-1',senderOpenDingTalkId:'authenticated-sender',text:'quoted boundary proof',occurredAt:'2026-11-05T10:00:00.000Z',quotedMessage:{messageId:'original-quoted-message',text:'earlier context',senderOpenDingTalkId:'quoted-person'}})
  assert.equal(captured.sentAt,'2026-11-05T10:00:00.000Z');assert.deepEqual(captured.quotedMessage,{messageId:'original-quoted-message',text:'earlier context',senderId:'quoted-person'});
  assert.equal(response.channelType,'chat-room');assert.match(JSON.stringify(f.requests.at(-1)),/authenticated-sender/)
  await assert.rejects(plugin.acceptHistoryMessage({groupId:'room-fixture',messageId:'bad-source',text:'missing sender'}),/AUTHENTICATED_IDENTITY_REQUIRED/)
  assert.equal(commands,0);assert.equal(f.host.ctx.channels.canDeliver({state:'prepared',payload:{conversationId:response.sessionId}}),false)
  const source=(await f.host.ctx.sessionPersistence.list()).find(row=>row.header.id===response.sessionId);assert.ok(source)
  const history=await f.host.ctx.sessionPersistence.open(response.sessionId,'read');try{assert.ok((await history.read()).events.some(event=>event.type==='user/message'&&event.data.source?.senderId==='authenticated-sender'))}finally{await history.close()}
})
test('standard application composition exposes channel-neutral health and single task creation with no channel installed',{timeout:15000},async t=>{
  const f=await memoryHost(t,body=>JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')?{text:'{"lessons":[]}'}:body.tools?.some(t=>t.function.name==='task_result')?{tool:'task_result',args:{decision:{action:'complete',summary:'core application verified',evidence:[],limitations:[]}}}:undefined)
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,{...f.config,resident:{port:0,taskSessions:{instanceId:'neutral-app',ownerActorId:'owner',webActorId:'owner',ingressEpoch:new Date().toISOString(),initialize:true,reasoningMode:'inherit'}}})})
  const app=f.host.ctx.get('application');assert.ok(app);assert.equal(f.host.ctx.get('dingtalkChannel'),undefined)
  const task=await app.tasks.createTask({requestId:'core-only',objective:'Reply with a literal local verification'});await app.tasks.whenIdle();assert.equal((await app.tasks.store.query({kind:'task.get',taskId:task.taskId})).status,'completed')
  assert.equal((await app.tasks.store.query({kind:'execution.list'})).length,0);await app.close()
})
