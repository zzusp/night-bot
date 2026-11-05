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

test('discovered third-party plugins load only enabled instances and release transports on host close',async t=>{
  const {mkdir,writeFile}=await import('node:fs/promises')
  const f=await memoryHost(t);await f.close()
  const directory=join(f.root,'plugins'),plugin=join(directory,'local')
  await mkdir(plugin,{recursive:true})
  await writeFile(join(plugin,'night-channel.json'),JSON.stringify({apiVersion:1,type:'local',entry:'index.mjs'}))
  await writeFile(join(plugin,'index.mjs'),`export const inject=['channels'];export function apply(ctx,config){const stop=ctx.channels.registerTransport(config.channelId,{send:async()=>({}),readback:async()=>({})});ctx.effect(()=>stop)}`)
  const host=await createHost({...f.config,channelPluginDirs:['plugins'],channelPlugins:[{type:'local',enabled:true,channelId:'one'},{type:'local',enabled:true,channelId:'two'},{type:'missing-disabled',enabled:false}]})
  const channels=host.ctx.channels
  try{assert.deepEqual([...channels.transports.keys()],['one','two'])}finally{await host.close()}
  assert.equal(channels.transports.size,0)
  await assert.rejects(createHost({...f.config,channelPlugins:[{type:'missing-enabled',enabled:true}]}),/PLUGIN_UNKNOWN/)
})

test('real DWS runner -> adapter -> bridge -> plugin -> unified application -> durable store preserves quoted identity and metadata',{timeout:20000},async t=>{
  const f=await memoryHost(t)
  const streams=new Map(),calls=[]
  const runner={
    async run(args){calls.push(args);return {exitCode:0,stdout:JSON.stringify(args.includes('+messages-query-send-status')?{result:{sendStatus:'SUCCESS',openConversationId:'private',openMessageId:'sent-private'}}:(args.includes('+messages-send')||args.includes('+messages-reply'))?{sendReceipt:{openTaskId:'send-task'}}:{messages:[],complete:true}),stderr:''}},
    spawn(args,callbacks){const done=Promise.withResolvers(),kind=args[args.indexOf('--kind')+1];streams.set(kind,callbacks);queueMicrotask(()=>callbacks.onStderrLine('[event] ready'));return {done:done.promise,terminate(){done.resolve()}}},
  }
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,profile:'fixture',writesAuthorized:true,groups:['room'],directChats:true,directPeers:['peer'],assistantActorId:'self'},{runner})})
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,{...f.config,resident:{port:0,taskSessions:{instanceId:'bridge',ownerActorId:'owner',webActorId:'owner',initialize:true,reasoningMode:'inherit',ingressEpoch:'2026-01-01T00:00:00Z'}}})})
  const app=f.host.ctx.get('application'),channels=f.host.ctx.channels
  t.after(()=>app.close())
  const event={conversation_id:'room',message_id:'bridge-message',content:'source body',sender_open_dingtalk_id:'peer',event_time:Date.now(),is_in_at_list:true,at_open_dingtalk_ids:['self'],message_ai_send_flag:'DWS',quoted_message:{message_id:'quoted',sender_open_dingtalk_id:'original-author',content:'original body',create_time:'2026-11-05 10:00:00'}}
  const input={type:'chat-room',channelId:'dingtalk-dws',conversationId:'room',senderId:'peer',messageId:'bridge-message',text:'source body'},groupId=channels.identity(input).sessionId
  const until=async predicate=>{for(let i=0;i<200;i++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,10))}throw Error('bridge projection timeout')}
  await until(()=>streams.has('group')&&streams.has('all-direct'))
  streams.get('group').onStdoutLine(JSON.stringify(event))
  const message=await until(()=>app.store.getGroup(groupId)?.messages.find(m=>m.messageId==='bridge-message'))
  assert.equal(message.sourceKind,'channel');assert.equal(message.channelType,'chat-room');assert.equal(message.channelId,'dingtalk-dws');assert.equal(message.automated,true);assert.equal(message.mentionedAgent,true)
  assert.equal(message.quotedMessage.content,'original body')
  assert.equal(message.quotedMessage.senderOpenDingTalkId,channels.identity({...input,senderId:'original-author'}).principal)
  assert.deepEqual(message.mentions,[channels.identity({...input,senderId:'self'}).principal])
  streams.get('group').onStdoutLine(JSON.stringify(event));await new Promise(r=>setTimeout(r,40));assert.equal(app.store.getGroup(groupId).messages.length,1)
  streams.get('all-direct').onStdoutLine(JSON.stringify({...event,conversation_id:'private',message_id:'private-message'}))
  const directId=channels.identity({...input,type:'chat',conversationId:'private',messageId:'private-message'}).sessionId
  await until(()=>app.store.getGroup(directId)?.messages.length)
  assert.notEqual(directId,groupId)
  const notification={id:'private-send-key',payload:{conversationId:directId,actorId:channels.identity(input).principal,text:'private answer',sourceMessageId:'private-message'}}
  const ack=await channels.transportCall('send',notification)
  const send=calls.find(args=>args.includes('--open-dingtalk-id'));assert.equal(send[send.indexOf('--open-dingtalk-id')+1],'peer');assert.ok(!send.includes('--group'));assert.ok(send.includes('+messages-reply'));assert.equal(send[send.indexOf('--conversation-id')+1],'private');assert.equal(send[send.indexOf('--message-id')+1],'private-message')
  assert.equal((await channels.transportCall('readback',{...notification,ack})).messageId,'sent-private')
  assert.equal(await channels.transportCall('readback',notification),undefined)
  assert.equal(channels.canDeliver({...notification,payload:{...notification.payload,artifact:{}}}),false)
  await app.close()
  // The store schema and persisted projection retain the quote sender and automation flags.
  const {openResidentStore}=await import('../packages/dingtalk-core/store.js')
  const reopened=await openResidentStore(f.host.ctx.storageDomain)
  assert.deepEqual(reopened.getGroup(groupId).messages[0].quotedMessage,message.quotedMessage)
  assert.equal(reopened.getGroup(groupId).messages[0].automated,true)
})

test('manifest validation rejects duplicate types, escaped entries and duplicate enabled channel identities',async t=>{
  const {mkdir,writeFile}=await import('node:fs/promises'),{channelPluginRows}=await import('../src/channels/loader.js')
  const f=await memoryHost(t),paths=f.host.ctx.runtimePaths,base=join(f.root,'plugins','bad')
  await mkdir(base,{recursive:true});await writeFile(join(f.root,'outside.mjs'),'throw Error("must not execute")')
  const manifest=async value=>writeFile(join(base,'night-channel.json'),JSON.stringify(value))
  await manifest({apiVersion:1,type:'dingtalk-dws',entry:'index.mjs'})
  await assert.rejects(channelPluginRows({channelPluginDirs:['plugins']},paths),/TYPE_DUPLICATE/)
  await manifest({apiVersion:1,type:'external',entry:'../../outside.mjs'})
  await assert.rejects(channelPluginRows({channelPluginDirs:['plugins']},paths),/ENTRY_OUTSIDE_PACKAGE/)
  await assert.rejects(channelPluginRows({channelPlugins:[{type:'dingtalk-dws',enabled:true},{type:'dingtalk-dws',enabled:true}]},paths),/ID_INVALID_OR_DUPLICATE/)
  assert.deepEqual(await channelPluginRows({channelPlugins:[{type:'absent',enabled:false}]},paths),[])
})

test('generic message readers use neutral identities and enforce conversation scope',async t=>{
  const f=await memoryHost(t),channels=f.host.ctx.channels,input={type:'chat-room',channelId:'generic',conversationId:'room',senderId:'alice',messageId:'source',text:'hello'}
  const identity=await channels.registerConversation(input)
  let remote='room'
  channels.registerTransport('generic',{send:async()=>{},readback:async()=>{},readMessage:async()=>({messageId:'source',conversationId:remote,senderId:'alice',text:'hello',quotedMessage:{messageId:'quoted',senderId:'bob',text:'quoted body'}})})
  const message=await channels.readResource('readMessage',identity.sessionId,'source')
  assert.equal(message.senderOpenDingTalkId,identity.principal)
  assert.equal(message.quotedMessage.senderOpenDingTalkId,channels.identity({...input,senderId:'bob'}).principal)
  assert.equal(message.quotedMessage.content,'quoted body')
  remote='other';await assert.rejects(channels.readResource('readMessage',identity.sessionId,'source'),/SCOPE_MISMATCH/)
})

test('multiple DWS accounts have isolated paths and transports; direct peers require explicit authorization',async t=>{
  const f=await memoryHost(t),channels=f.host.ctx.channels,runner={run(){throw Error('unexpected CLI')},spawn(){throw Error('unexpected listener')}}
  for(const channelId of ['account-one','account-two'])await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,listen:false,profile:'fixture',channelId},{runner})})
  assert.equal(channels.plugins.size,2);assert.equal(channels.transports.size,2)
  assert.notEqual(channels.plugins.get('account-one').accountDirectory,channels.plugins.get('account-two').accountDirectory)
  await f.host.ctx.parallel('night/ready',{runtime:{},tasks:{}})
  await assert.rejects(channels.plugins.get('account-one').acceptHistoryMessage({groupId:'private',messageId:'m',senderOpenDingTalkId:'peer',text:'private'},{type:'chat'}),/CHAT_NOT_AUTHORIZED/)
  const raw={groupId:'shared',messageId:'same-message',senderOpenDingTalkId:'same-peer',text:'isolated account message',quotedMessage:{messageId:'quote-without-author',content:'unknown identity'}}
  const one=await channels.plugins.get('account-one').acceptHistoryMessage(raw),two=await channels.plugins.get('account-two').acceptHistoryMessage(raw)
  assert.notEqual(one.sessionId,two.sessionId)
  await f.close();assert.equal(channels.plugins.size,0);assert.equal(channels.transports.size,0)
})

test('DWS credentials use supported config/keychain roots and Windows fails before CLI access',async()=>{
  const {dwsEnvironment}=await import('../src/channels/plugins/dws-environment.js')
  const options={platform:'linux',inherited:{PATH:'/fixture/bin',DWS_CONFIG_DIR:'/foreign',DWS_KEYCHAIN_DIR:'/foreign-keychain',DWS_CLIENT_SECRET:'fixture-secret',DWS_DISABLE_KEYCHAIN:'1',DWS_KEYCHAIN_TEST_NAMESPACE:'forbidden-production-namespace'}}
  const environment=dwsEnvironment({temp:'/fixture/temp'},'/fixture/private','/fixture/cache',options)
  assert.equal(environment.DWS_CONFIG_DIR,'/fixture/private/config');assert.equal(environment.DWS_KEYCHAIN_DIR,'/fixture/private/keychain');assert.equal(environment.PATH,'/fixture/bin')
  for(const key of ['DWS_CLIENT_SECRET','DWS_DISABLE_KEYCHAIN','DWS_KEYCHAIN_TEST_NAMESPACE'])assert.equal(environment[key],undefined)
  assert.throws(()=>dwsEnvironment({temp:'/fixture/temp'},'/fixture/private','/fixture/cache',{...options,platform:'win32'}),/WINDOWS_ACCOUNT_ISOLATION_UNAVAILABLE/)
})
