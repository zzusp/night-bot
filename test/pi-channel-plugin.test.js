import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,access,writeFile,readdir,lstat,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {createHost} from '../src/host.js'
import {loadConfig} from '../src/config.js'
import {withLock,acquireLock} from '../src/runtime/files.js'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
import {createNodeDwsRunner} from '../packages/dingtalk-core/dws-runner.js'
import {apply as applyDws} from '../src/channels/plugins/dingtalk-dws.js'
import {apply as applyApplication,inject} from '../src/application.js'
import {randomUUID} from 'node:crypto'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {modelToolValues} from './fixtures/routing-official-model.js'
import {validateConfig as validateDingtalkConfig} from '../src/channels/plugins/dingtalk-config.js'
import {runDingtalkCli} from '../src/channels/plugins/dingtalk-cli.js'
import {dingtalkChannelPaths,openDingtalkIngress} from '../src/channels/plugins/dingtalk-storage.js'
import {dingtalkIngressAdapter} from '../src/channels/plugins/dingtalk-ingress.js'
import {selectDwsProfile,resolveDingtalkBinding} from '../src/channels/plugins/dingtalk-binding.js'


test('core initializes without a DWS executable or plugin, and disabled plugins never register a transport',async t=>{
  const f=await memoryHost(t);assert.equal(f.host.ctx.get('dingtalkChannel'),undefined);assert.equal(f.host.ctx.channels.transports.size,0)
  await f.close();const config={...f.config,channelPlugins:[{type:'dingtalk-dws',enabled:false,config:{executable:'/missing/dws-must-never-run'}}]}
  const host=await createHost(config);try{assert.equal(host.ctx.get('dingtalkChannel'),undefined);assert.equal(host.ctx.channels.transports.size,0);await assert.rejects(access(join(host.ctx.runtimePaths.secrets,'dingtalk-dws')),error=>error.code==='ENOENT')}finally{await host.close()}
})
test('optional DWS plugin registers the typed boundary, preserves authenticated sender/quote and confines account data',async t=>{
  const f=await memoryHost(t);let commands=0
  const runner={cwd:f.root,async run(){commands++;throw Error('No real CLI calls in plugin registration test')},spawn(){commands++;throw Error('No subscription requested')}}
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('dingtalk-dws',{dingtalk_group_id:'room-fixture'}),pluginDependencies(f,runner))})
  const plugin=f.host.ctx.channels.plugins.get('dingtalk-dws');assert.ok(plugin);if(plugin.accountPolicy.mode==='private')assert.ok(plugin.accountDirectory.startsWith(join(f.root,'data','secrets')));else{assert.equal(plugin.accountDirectory,undefined);assert.equal(plugin.accountPolicy.sharedAcrossInstances,true)}
  const historical=await f.host.ctx.channels.registerConversation({type:'chat-room',channelId:'dingtalk-dws',conversationId:'room-fixture',senderId:'authenticated-sender',messageId:'historical',text:'retained'})
  await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{},tasks:{isOwnNotification:()=>false}})
  assert.equal(f.host.ctx.channels.groupContext(historical.sessionId).conversationName,'Verified room title')
  let captured;const receive=f.host.ctx.channels.receive.bind(f.host.ctx.channels);f.host.ctx.channels.receive=input=>{captured=input;return receive(input)}
  const response=await plugin.acceptHistoryMessage({groupId:'room-fixture',messageId:'real-source-1',senderOpenDingTalkId:'authenticated-sender',senderName:'Verified sender name',text:'quoted boundary proof',occurredAt:'2026-11-05T10:00:00.000Z',quotedMessage:{messageId:'original-quoted-message',text:'earlier context',senderOpenDingTalkId:'quoted-person'}})
  assert.equal(captured.conversationName,'Verified room title');assert.equal(captured.senderName,'Verified sender name');assert.equal(captured.senderId,'authenticated-sender');assert.equal(captured.sentAt,'2026-11-05T10:00:00.000Z');assert.deepEqual(captured.quotedMessage,{messageId:'original-quoted-message',text:'earlier context',senderId:'quoted-person'});
  assert.equal(response.channelType,'chat-room');assert.match(JSON.stringify(f.requests.at(-1)),/authenticated-sender/)
  await assert.rejects(plugin.acceptHistoryMessage({groupId:'room-fixture',messageId:'bad-source',text:'missing sender'}),/AUTHENTICATED_IDENTITY_REQUIRED/)
  assert.equal(commands,0);assert.equal(f.host.ctx.channels.canDeliver({state:'prepared',payload:{conversationId:response.sessionId}}),false)
  const source=(await f.host.ctx.sessionPersistence.list()).find(row=>row.header.id===response.sessionId);assert.ok(source)
  const history=await f.host.ctx.get('sessionPersistence').readNative(response.sessionId,{requireComplete:true})
  assert.equal(history.format,'pi-native-v1');assert.equal('events' in history,false)
  const nativeInput=history.context.projection.entries.find(({sourceEntry})=>sourceEntry.type==='custom_message'&&sourceEntry.customType==='night.business-input'&&sourceEntry.details.source?.senderId==='authenticated-sender')?.sourceEntry
  assert.ok(nativeInput)
  assert.equal(nativeInput.details.source.principal,f.host.ctx.channels.identity(captured).principal)
  assert.deepEqual(nativeInput.details.source.quotedMessage,captured.quotedMessage)
  assert.equal(nativeInput.content[0].text,'quoted boundary proof')
  await plugin.acceptHistoryMessage({groupId:'room-fixture',messageId:'missing-name',senderOpenDingTalkId:'authenticated-sender',senderName:'authenticated-sender',text:'No display name supplied'})
  assert.equal(captured.senderName,undefined)
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
    spawn(args,callbacks){const done=Promise.withResolvers(),kind=args.includes('user_im_message_receive_o2o')||args.includes('sender')?'private:'+args[args.indexOf('--open-dingtalk-id')+1]:args[args.indexOf('--kind')+1];streams.set(kind,callbacks);queueMicrotask(()=>callbacks.onStderrLine('[event] ready'));return {done:done.promise,terminate(){done.resolve()}}},
  }
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('dingtalk-dws',{dingtalk_group_id:'room',dingtalk_writes_authorized:true,dingtalk_listen:true}),pluginDependencies(f,runner))})
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('private-dws',{dingtalk_conversation_type:'chat',dingtalk_group_id:undefined,dingtalk_user_id:'peer-user',dingtalk_writes_authorized:true,dingtalk_listen:true}),pluginDependencies(f,runner))})
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,{...f.config,resident:{port:0,taskSessions:{instanceId:'bridge',ownerActorId:'owner',webActorId:'owner',initialize:true,reasoningMode:'inherit',ingressEpoch:'2026-01-01T00:00:00Z'}}})})
  const app=f.host.ctx.get('application'),channels=f.host.ctx.channels
  t.after(()=>app.close())
  const event={conversation_id:'room',message_id:'bridge-message',content:'source body',sender_open_dingtalk_id:'peer',event_time:Date.now(),is_in_at_list:true,at_open_dingtalk_ids:['self'],message_ai_send_flag:'DWS',quoted_message:{message_id:'quoted',sender_open_dingtalk_id:'original-author',content:'original body',create_time:'2026-11-05 10:00:00'}}
  const input={type:'chat-room',channelId:'dingtalk-dws',conversationId:'room',senderId:'peer',messageId:'bridge-message',text:'source body'},groupId=channels.identity(input).sessionId
  const until=async predicate=>{for(let i=0;i<200;i++){const value=predicate();if(value)return value;await new Promise(r=>setTimeout(r,10))}throw Error('bridge projection timeout')}
  await until(()=>streams.has('group')&&streams.has('private:peer'))
  streams.get('group').onStdoutLine(JSON.stringify({...event,conversation_id:'foreign-room',message_id:'foreign-room-message'}))
  await new Promise(r=>setTimeout(r,20));assert.ok(![...channels.contexts.values()].some(context=>context.conversationId==='foreign-room'))
  streams.get('group').onStdoutLine(JSON.stringify(event))
  const message=await until(()=>app.store.getGroup(groupId)?.messages.find(m=>m.messageId==='bridge-message'))
  assert.equal(message.sourceKind,'channel');assert.equal(message.channelType,'chat-room');assert.equal(message.channelId,'dingtalk-dws');assert.equal(message.automated,true);assert.equal(message.mentionedAgent,true)
  assert.equal(message.quotedMessage.content,'original body')
  assert.equal(message.quotedMessage.senderOpenDingTalkId,channels.identity({...input,senderId:'original-author'}).principal)
  assert.deepEqual(message.mentions,[channels.identity({...input,senderId:'self'}).principal])
  streams.get('group').onStdoutLine(JSON.stringify(event));await new Promise(r=>setTimeout(r,40));assert.equal(app.store.getGroup(groupId).messages.length,1)
  streams.get('private:peer').onStdoutLine(JSON.stringify({...event,sender_open_dingtalk_id:'outsider',conversation_id:'foreign-private',message_id:'foreign-message'}))
  await new Promise(r=>setTimeout(r,25));assert.ok(![...channels.contexts.values()].some(context=>context.conversationId==='foreign-private'))
  assert.ok([...streams.keys()].every(key=>key!=='all-direct'))
  streams.get('private:peer').onStdoutLine(JSON.stringify({...event,conversation_id:'private',message_id:'private-message'}))
  const directId=channels.identity({...input,type:'chat',channelId:'private-dws',conversationId:'private',messageId:'private-message'}).sessionId
  await until(()=>app.store.getGroup(directId)?.messages.length)
  assert.notEqual(directId,groupId)
  const notification={id:'private-send-key',payload:{conversationId:directId,actorId:channels.identity({...input,channelId:'private-dws'}).principal,text:'private answer',sourceMessageId:'private-message'}}
  const ack=await channels.transportCall('send',notification)
  const send=calls.find(args=>args.includes('+messages-reply'));assert.ok(send,'actual quoted direct send must exist independently of private history reads');assert.equal(send[send.indexOf('--open-dingtalk-id')+1],'peer');assert.ok(!send.includes('--group'));assert.ok(send.includes('+messages-reply'));assert.equal(send[send.indexOf('--conversation-id')+1],'private');assert.equal(send[send.indexOf('--message-id')+1],'private-message')
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
  await assert.rejects(channelPluginRows({channelPlugins:[{type:'dingtalk-dws',channelId:'duplicate',enabled:true,config:dingtalkPublic()},{type:'dingtalk-dws',channelId:'duplicate',enabled:true,config:dingtalkPublic()}]},paths),/ID_INVALID_OR_DUPLICATE/)
  assert.deepEqual(await channelPluginRows({channelPlugins:[{type:'absent',enabled:false}]},paths),[])
})

test('generic message readers use neutral identities and enforce conversation scope',async t=>{
  const f=await memoryHost(t),channels=f.host.ctx.channels,input={type:'chat-room',channelId:'generic',conversationId:'room',senderId:'alice',messageId:'source',text:'hello'}
  const identity=await channels.registerConversation(input)
  let remote='room'
  channels.registerTransport('generic',{send:async()=>{},readback:async()=>{},readMessage:async()=>({messageId:'source',conversationId:remote,senderId:'alice',text:'hello',quotedMessage:{messageId:'quoted',senderId:'bob',text:'quoted body'}})})
  const message=await channels.readResource('readMessage',identity.sessionId,'source')
  assert.equal(message.actorId,identity.principal);assert.equal(message.conversationId,identity.sessionId);assert.equal(Object.hasOwn(message,'senderOpenDingTalkId'),false)
  assert.equal(message.quotedMessage.actorId,channels.identity({...input,senderId:'bob'}).principal);assert.equal(Object.hasOwn(message.quotedMessage,'senderOpenDingTalkId'),false)
  assert.equal(message.quotedMessage.text,'quoted body');assert.equal(message.quotedMessage.conversationId,identity.sessionId)
  remote='other';await assert.rejects(channels.readResource('readMessage',identity.sessionId,'source'),/SCOPE_MISMATCH/)
  const direct=await channels.registerConversation({...input,type:'chat',messageId:'direct-alice'}),other=await channels.registerConversation({...input,type:'chat',senderId:'bob',messageId:'direct-bob'})
  const notice={id:'direct-scope',payload:{conversationId:direct.sessionId,text:'Direct bounded response',recipientActorIds:[direct.principal]}}
  assert.deepEqual(channels.deliveryEnvelope(notice).recipientIds,[])
  for(const actorId of ['unknown-actor',other.principal])assert.throws(()=>channels.deliveryEnvelope({...notice,payload:{...notice.payload,recipientActorIds:[actorId]}}),{code:'CHANNEL_RECIPIENT_NOT_IN_CONVERSATION'})
})

test('multiple DWS instances isolate transports and describe credential sharing; direct peers require authorization',async t=>{
  const f=await memoryHost(t),channels=f.host.ctx.channels,runner={run(){throw Error('unexpected CLI')},spawn(){throw Error('unexpected listener')}}
  for(const channelId of ['account-one','account-two'])await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig(channelId,{dingtalk_group_id:'shared'}),pluginDependencies(f,runner))})
  assert.equal(channels.plugins.size,2);assert.equal(channels.transports.size,2)
  if(channels.plugins.get('account-one').accountPolicy.mode==='private')assert.notEqual(channels.plugins.get('account-one').accountDirectory,channels.plugins.get('account-two').accountDirectory)
  else{assert.equal(channels.plugins.get('account-one').accountDirectory,undefined);assert.equal(channels.plugins.get('account-two').accountPolicy.sharedAcrossInstances,true)}
  await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{},tasks:{isOwnNotification:()=>false}})
  await assert.rejects(channels.plugins.get('account-one').acceptHistoryMessage({groupId:'private',messageId:'m',senderOpenDingTalkId:'peer',text:'private'},{type:'chat'}),/CHAT_NOT_AUTHORIZED/)
  const raw={groupId:'shared',messageId:'same-message',senderOpenDingTalkId:'same-peer',text:'isolated account message',quotedMessage:{messageId:'quote-without-author',content:'unknown identity'}}
  const one=await channels.plugins.get('account-one').acceptHistoryMessage(raw),two=await channels.plugins.get('account-two').acceptHistoryMessage(raw)
  assert.notEqual(one.sessionId,two.sessionId)
  await f.close();assert.equal(channels.plugins.size,0);assert.equal(channels.transports.size,0)
})

test('DWS private credentials use supported roots; Windows defaults to the protected current-user login',async()=>{
  const {dwsEnvironment,dwsAccountPolicy}=await import('../src/channels/plugins/dws-environment.js')
  const options={platform:'linux',inherited:{PATH:'/fixture/bin',DWS_CONFIG_DIR:'/foreign',DWS_KEYCHAIN_DIR:'/foreign-keychain',DWS_CLIENT_SECRET:'fixture-secret',DWS_DISABLE_KEYCHAIN:'1',DWS_KEYCHAIN_TEST_NAMESPACE:'forbidden-production-namespace'}}
  const environment=dwsEnvironment({temp:'/fixture/temp'},'/fixture/private','/fixture/cache',options)
  assert.equal(environment.DWS_CONFIG_DIR,join('/fixture/private','config'));assert.equal(environment.DWS_KEYCHAIN_DIR,join('/fixture/private','keychain'));assert.equal(environment.PATH,'/fixture/bin')
  for(const key of ['DWS_CLIENT_SECRET','DWS_DISABLE_KEYCHAIN','DWS_KEYCHAIN_TEST_NAMESPACE'])assert.equal(environment[key],undefined)
  const inherited={...options.inherited,HOME:'C:/Users/current',USERPROFILE:'C:/Users/current',LOCALAPPDATA:'C:/Users/current/AppData/Local'}
  const windows=dwsEnvironment({temp:'/fixture/temp'},'/fixture/private','/fixture/cache',{platform:'win32',inherited})
  assert.equal(windows.HOME,inherited.HOME);assert.equal(windows.USERPROFILE,inherited.USERPROFILE);assert.equal(windows.LOCALAPPDATA,inherited.LOCALAPPDATA)
  assert.equal(windows.DWS_CONFIG_DIR,inherited.DWS_CONFIG_DIR);assert.equal(windows.DWS_KEYCHAIN_DIR,inherited.DWS_KEYCHAIN_DIR)
  assert.equal(windows.DWS_CLIENT_SECRET,undefined);assert.equal(windows.DWS_DISABLE_KEYCHAIN,undefined);assert.equal(windows.DWS_KEYCHAIN_TEST_NAMESPACE,undefined)
  assert.deepEqual(dwsAccountPolicy(undefined,{platform:'win32'}),{mode:'system',credentialScope:'os-user',sharedAcrossInstances:true,independentLogin:false,configurationOwner:'external-cli'})
  assert.throws(()=>dwsEnvironment({temp:'/fixture/temp'},'/fixture/private','/fixture/cache',{platform:'win32',accountMode:'private',inherited}),/PRIVATE_ACCOUNT_UNSUPPORTED_ON_WINDOWS/)
  assert.throws(()=>dwsAccountPolicy('unknown'),/ACCOUNT_MODE_INVALID/)
})


test('system-account plugins use the existing CLI context and describe shared login without creating a private vault',async t=>{
  const f=await memoryHost(t),channels=f.host.ctx.channels,runner={run(){throw Error('unexpected CLI')},spawn(){throw Error('unexpected listener')}}
  for(const channelId of ['shared-one','shared-two'])await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig(channelId,{dingtalk_account_mode:'system'}),pluginDependencies(f,runner))})
  const one=channels.plugins.get('shared-one'),two=channels.plugins.get('shared-two')
  assert.equal(one.accountPolicy.mode,'system');assert.equal(one.accountPolicy.sharedAcrossInstances,true);assert.equal(one.accountPolicy.independentLogin,false)
  assert.equal(one.accountDirectory,undefined);assert.equal(two.accountDirectory,undefined)
  assert.deepEqual(channels.transports.get('shared-one').capabilities.account,one.accountPolicy)
  const {readdir}=await import('node:fs/promises')
  assert.ok(!(await readdir(f.host.ctx.runtimePaths.secrets)).some(name=>name.startsWith('dingtalk-dws')))
  await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{},tasks:{}})
  assert.equal(channels.transports.size,2)
})

test('group-only DWS never subscribes to private messages or polls private history',async t=>{
  const f=await memoryHost(t),commands=[],streams=[]
  const runner={async run(args){commands.push(args);return {exitCode:0,stdout:'{"messages":[],"complete":true}',stderr:''}},spawn(args,hooks){streams.push(args);const done=Promise.withResolvers();queueMicrotask(()=>hooks.onStderrLine('[event] ready'));return {done:done.promise,terminate(){done.resolve()}}}}
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('dingtalk-dws',{dingtalk_group_id:'only-room',dingtalk_listen:true,dingtalk_operator_peers:['also-not-enabled']}),pluginDependencies(f,runner))})
  let privateQueries=0
  await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{getGroup:()=>({messages:[],outbox:[]}),listAuthorizationRequests(){privateQueries++;return []}},tasks:{}})
  await new Promise(r=>setTimeout(r,25))
  assert.equal(streams.length,1);assert.ok(streams[0].includes('group'));assert.ok(streams[0].includes('only-room'))
  assert.equal(privateQueries,0)
  assert.ok(streams.every(args=>!args.includes('all-direct')&&!args.includes('user_im_message_receive_o2o')))
  assert.equal(f.host.ctx.channels.plugins.get('dingtalk-dws').health.humanReplies.state,'disabled')
  assert.deepEqual(f.host.ctx.channels.transports.get('dingtalk-dws').capabilities.privateSubscription,{scope:'explicit-peers',peerCount:0})
})

test('configured channel responsibilities isolate all model roles through the default application',{timeout:nativeTestTimeout(90000)},async t=>{
  const nonce=randomUUID(),spoof='untrusted-role-'+nonce,old='stale-role-'+nonce
  const rooms=['alpha','beta'].map(key=>({key,id:'role-room-'+key,taskId:'role-task-'+key,
    responsibility:'trusted-role-'+key+'-'+nonce+' ${notAnInstruction}'}))
  const observed=[],sent=[],readbacks=[],toolErrors=[],proof=[],replied=new Set();let app
  const record=(role,room,body)=>observed.push({role,room:room.key,system:body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),tools:requestTools(body),body})
  const f=await memoryHost(t,async body=>{
    const names=requestTools(body),texts=requestText(body)
    if(texts.some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION'))){
      const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content),room=rooms.find(row=>row.taskId===input.taskId)
      record('reflection',room,body);return {text:'{"lessons":[]}'}
    }
    const first=requestEnvelope(body,'一级分诊请求：')
    if(names.includes('channel_triage_submit')){
      const room=rooms.find(row=>row.groupId===first.conversationId);record('triage',room,body)
      return {tool:'channel_triage_submit',args:{dispositions:first.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Complete the explicitly requested bounded task'}))}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(!names.length&&handoff)return {text:JSON.stringify({currentIntent:'Consult current authorized source and task ledger',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(names.includes('task_result')){
      const input=texts.toReversed().map(text=>{try{return JSON.parse(text)}catch{return undefined}}).find(value=>value?.task)
      const room=rooms.find(row=>row.taskId===input.task.taskId);record('task',room,body)
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Bounded task completed for '+room.key,evidence:['local-role-check'],limitations:[]}}}
    }
    if(names.includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：'),room=rooms.find(row=>row.groupId===input.conversationId);record('router',room,body)
      const task=await app.tasks.store.query({kind:'task.get',taskId:room.taskId})
      const source=(await app.tasks.store.query({kind:'source.list'})).find(row=>row.messageId==='order-'+room.key)
      if(!task)return {tool:'resident_task_plan',args:{operationId:'role-plan-'+room.key,sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:room.taskId,title:'Bounded task '+room.key,objective:'Complete the bounded local verification for '+room.key,requirements:['Report a verified bounded result']}],dependencies:[]}}
      if(task.status==='completed'&&input.events.some(event=>event.taskEvent?.kind==='task.completed')&&!replied.has(room.key)){
        replied.add(room.key)
        return {tool:'resident_router_reply',args:{operationId:'role-result-'+room.key,sourceId:source.sourceId,messageVersion:source.version,text:'Bounded verification completed.',recipientActorIds:[]}}
      }
      const lastCall=body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name
      if(body.messages.at(-1)?.role==='tool'&&lastCall==='resident_router_settle')return {text:'The current batch is settled.'}
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'role-settle:'+input.events.map(event=>event.eventId).join(',')}}
    }
    record('channel',rooms[0],body);return {text:'The configured channel context is available.'}
  })
  const flag=(args,key)=>args[args.indexOf(key)+1]
  const runner={
    async run(args){
      let value
      if(args.includes('+messages-send')||args[1]==='message'&&args[2]==='reply'){
        const message={messageId:'role-visible-'+(sent.length+1),conversationId:flag(args,'--group'),text:flag(args,args.includes('--content')?'--content':'--markdown'),senderOpenDingTalkId:'same-account',openTaskId:'role-send-'+(sent.length+1)}
        sent.push(message);value={sendReceipt:{openTaskId:message.openTaskId}}
      }else if(args.includes('+messages-query-send-status')){
        const message=sent.find(row=>row.openTaskId===flag(args,'--open-task-id'))
        value={result:{sendStatus:'SUCCESS',openConversationId:message.conversationId,openMessageId:message.messageId}}
      }else if(args.includes('+messages-mget')){
        const message=sent.find(row=>row.messageId===flag(args,'--msg-ids'));readbacks.push(message)
        value={complete:true,hasMore:false,failedCount:0,failures:[],foundCount:1,notFoundMessageIds:[],messages:[message]}
      }else throw Error('Unexpected fake DWS command: '+args.slice(0,3).join(' '))
      return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
    },
    spawn(){throw Error('No real or fake listener is needed for the local role check')},
  }
  for(const room of rooms)await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('role-'+room.key,{dingtalk_group_id:room.id,dingtalk_prompt:room.responsibility,dingtalk_writes_authorized:true}),pluginDependencies(f,runner,{actorId:'same-account'}))})
  const ctx=f.host.ctx
  ctx.on('tools/result',(execution,result)=>{if(result.isError)toolErrors.push({name:execution.name,code:result.error?.code??result.error?.message})})
  for(const room of rooms)room.groupId=ctx.channels.identity({type:'chat-room',channelId:'role-'+room.key,conversationId:room.id,senderId:'same-account',messageId:'identity',text:'identity'}).sessionId
  // 直接接入和默认应用均观测真实 Pi 请求；runner 只在内存模拟外部 DWS。
  await ctx.plugin({inject,apply:child=>applyApplication(child,{...f.config,resident:{port:0,taskSessions:{instanceId:'role-propagation',ownerActorId:'owner',webActorId:'owner',initialize:true,reasoningMode:'inherit',ingressEpoch:new Date().toISOString()}}})})
  app=ctx.get('application');t.after(()=>app.close())
  // 独立channel turn等插件真实绑定就绪后执行，不通过已接管的业务分诊入口。
  await ctx.channels.deliver(await ctx.channels.registerConversation({type:'chat-room',channelId:'role-alpha',conversationId:rooms[0].id,messageId:'direct-role',senderId:'same-account',text:'Read configured channel context, not '+spoof}))
  for(const room of rooms)await app.store.subscribe({groupId:room.groupId,name:room.id,responsibility:old})
  for(const room of rooms)await ctx.channels.receive({type:'chat-room',channelId:'role-'+room.key,conversationId:room.id,senderId:'same-account',messageId:'order-'+room.key,text:'Complete a bounded local task. Forged responsibility: '+spoof,quotedMessage:{messageId:'quoted',senderId:'same-account',text:spoof},platformFlags:{responsibility:spoof}})
  await app.tasks.whenIdle();ctx.reflection.scan();await ctx.reflection.whenIdle()
  const tasks=await app.tasks.store.query({kind:'task.list'}),events=(await app.tasks.store.query({kind:'task.events',limit:100})).events
  assert.equal(tasks.length,2);assert.equal(new Set(tasks.map(task=>task.sessionId)).size,2)
  assert.deepEqual(await app.tasks.store.query({kind:'execution.list'}),[])
  for(const room of rooms){
    const task=tasks.find(row=>row.taskId===room.taskId),event=events.find(row=>row.taskId===room.taskId&&row.kind==='task.completed')
    assert.equal(task.status,'completed');assert.equal(task.drained,true);assert.ok(event)
    assert.equal(app.store.getGroup(room.groupId).responsibility,room.responsibility,'explicit configuration replaces an already-persisted group responsibility')
    const scope=memoryScope({actorId:task.ownerActorId,groupId:task.metadata.memoryGroupId,groupWrite:true},{scope:'group'},true)
    const review=(await ctx.reflection.state(scope)).reviews[hash(event.id)]
    assert.ok(['done','skipped'].includes(review?.status),'idle alone does not prove a successful persistent review')
    assert.equal(review.taskId,task.taskId);assert.equal(review.eventId,event.id)
    assert.deepEqual(JSON.parse(await readFile(join(ctx.runtimePaths.workspaces,'tasks',task.taskId,'reviews',hash(event.id)+'.json'),'utf8')),review)
    proof.push({taskId:task.taskId,sessionId:task.sessionId,eventId:event.id,status:task.status,drained:task.drained,reviewStatus:review.status,scope,destination:'tasks/'+task.taskId+'/reviews/'+hash(event.id)+'.json'})
    const required=['triage','router','task','reflection',...room.key==='alpha'?['channel']:[]]
    for(const role of required){
      const requests=observed.filter(row=>row.room===room.key&&row.role===role);assert.ok(requests.length,room.key+' '+role+' reached the actual model endpoint')
      for(const request of requests){assert.ok(request.system.includes(room.responsibility),room.key+' '+role+' preserves the complete literal responsibility');assert.ok(!request.system.includes(rooms.find(other=>other!==room).responsibility));assert.ok(!request.system.includes(spoof));assert.ok(!request.system.includes(old))}
      if(role==='reflection')for(const request of requests){assert.deepEqual(request.tools,[]);assert.equal(request.body.messages.length,2);const input=JSON.parse(request.body.messages[1].content);assert.equal(input.taskId,task.taskId);assert.equal(input.eventId,event.id);assert.deepEqual(Object.keys(input).sort(),['eventId','facts','taskId'])}
    }
  }
  const notices=await app.tasks.store.query({kind:'notification.list'})
  assert.equal(notices.length,2);assert.ok(notices.every(row=>row.state==='delivered'))
  assert.equal(sent.length,2);assert.equal(readbacks.length,2)
  assert.deepEqual(sent.map(row=>row.conversationId).sort(),rooms.map(room=>room.id).sort())
  for(const notice of notices){const destination=ctx.channels.groupContext(notice.payload.conversationId).conversationId;assert.ok(sent.some(row=>row.conversationId===destination&&row.messageId===notice.receipt.messageId))}
  assert.deepEqual(toolErrors,[]);assert.deepEqual(f.errors,[])
  await app.close()
  t.diagnostic(JSON.stringify({case:'sg8-configured-channel-roles',tasks:proof,roles:rooms.map(room=>({room:room.key,requests:Object.fromEntries(['channel','triage','router','task','reflection'].map(role=>[role,observed.filter(row=>row.room===room.key&&row.role===role).length]))})),notifications:notices.map(row=>({id:row.id,state:row.state,messageId:row.receipt.messageId})),fakeSends:sent.length,fakeReadbacks:readbacks.length,modelRequests:f.requests.length,listenerStarted:false,realDwsExecuted:false}))
})

for(const replyToSource of [undefined,true])test('default application neutral Router tools enforce recipient/source ACL and deliver material-backed frozen files'+(replyToSource?' with explicit source quote':''),{timeout:nativeTestTimeout(90000)},async t=>{
  const steps=new Map(),taskPackets=[],calls=[],resourceReads=[],sent=[],results=[],materialText='MATERIAL='+randomUUID(),fileReadback=Promise.withResolvers();let fileReadbackStarted=false
  t.signal.addEventListener('abort',()=>fileReadback.resolve(),{once:true})
  const taskId='neutral-material-task';let app,channels,sourceIdentity,bob,foreign,originalSource
  const progress={phase:'setup',models:0,tools:{}}
  t.signal.addEventListener('abort',()=>t.diagnostic(JSON.stringify({case:'default-neutral-tools-interrupted',progress})),{once:true})
  const f=await memoryHost(t,async body=>{
    progress.models++;progress.phase='model-request'
    const tools=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：')
    if(tools.includes('channel_triage_submit'))return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(message=>({sourceId:message.sourceId,messageVersion:message.version??message.messageVersion,needsHandling:message.messageId==='neutral-request',reason:'Only the exact material request needs work'}))}}
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff)return {text:JSON.stringify({currentIntent:'Keep original source and frozen delivery references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(tools.includes('task_result')){
      const input=requestText({...body,messages:body.messages.filter(message=>message.role==='user')}).toReversed().map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.task)
      assert.ok(input);taskPackets.push(input)
      const key='execution:'+input.task.taskId,step=steps.get(key)??0;steps.set(key,step+1)
      progress.lastModel={kind:'execution',step,taskId:input.task.taskId}
      const resource=input.materials.flatMap(material=>material.resources??[]).find(resource=>resource.status==='read')
      assert.ok(resource,'default task composition must read/materialize the original generic resource')
      if(step===0)return {tool:'read',args:{path:resource.path}}
      if(step===1){assert.ok(requestText(body).some(text=>text.includes(materialText)),'actual model tool response must contain the fetched resource bytes');return {tool:'write',args:{path:'work/result.txt',content:materialText}}}
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Read the original material and verified the result file',evidence:['work/result.txt'],limitations:[],artifacts:['work/result.txt'],deliveryFiles:[{path:'work/result.txt',caption:'Verified material result'}]}}}
    }
    if(!tools.includes('resident_router_reply'))return {text:'No additional work'}
    const input=requestEnvelope(body,'Router 请求：'),key=input.events.map(event=>event.id).join(','),step=steps.get(key)??0;steps.set(key,step+1)
    progress.lastModel={kind:'router',step,events:input.events.map(event=>({kind:event.kind,taskId:event.taskId,sourceId:event.sourceId}))}
    const source=input.events.find(event=>event.source?.messageId==='neutral-request')?.source
    const settle=()=>({tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'neutral-settle:'+key}})
    const definition=body.tools.find(tool=>tool.function.name==='resident_router_reply').function
    assert.ok(definition.parameters.properties.recipientActorIds);assert.deepEqual(definition.parameters.properties.replyToSource.enum,[true]);assert.equal(Object.hasOwn(definition.parameters.properties,'atOpenDingTalkIds'),false)
    if(source){
      originalSource=source
      assert.equal(Object.hasOwn(source,'groupId'),false);assert.equal(source.conversationId,sourceIdentity.sessionId);assert.equal(source.actorId,sourceIdentity.principal)
      assert.equal(source.quote.actorId,bob);assert.equal(source.quote.text,'Keep this original quote');assert.equal(Object.hasOwn(source.quote,'senderOpenDingTalkId'),false)
      assert.ok(source.text.includes('DingTalk'),'literal user vendor names must be preserved')
      const reply={operationId:'neutral-acl-'+step,sourceId:source.sourceId,messageVersion:source.version,text:'A bounded local response'}
      if(step===0)return {tool:'resident_source_get',args:{sourceId:source.sourceId}}
      if(step===1)return {tool:'resident_router_reply',args:{...reply,recipientActorIds:['unknown-actor']}}
      if(step===2)return {tool:'resident_router_reply',args:{...reply,recipientActorIds:[foreign]}}
      if(step===3)return {tool:'resident_router_reply',args:{...reply,atOpenDingTalkIds:[bob]}}
      if(step===4)return {tool:'resident_router_reply',args:{...reply,messageVersion:source.version+1,recipientActorIds:[bob]}}
      if(step===5)return {tool:'resident_task_plan',args:{operationId:'neutral-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId,title:'Material verification',objective:'Read the original material, create a local result file and report the frozen output.',requirements:['Result bytes match the material']}],dependencies:[]}}
      if(step===6)return settle()
      return {text:'Original source disposition committed'}
    }
    if(input.events.some(event=>event.taskEvent?.kind==='task.completed'&&event.taskEvent.taskId===taskId)){
      if(step===0)return {tool:'resident_task_query',args:{taskId}}
      if(step>0){
        const task=modelToolValues(body).toReversed().find(value=>value.task?.taskId===taskId)?.task
        assert.ok(task?.completion?.result?.artifactFiles?.length)
        const delivery={operationId:'neutral-delivery',sourceId:originalSource.sourceId,messageVersion:originalSource.version,text:'The verified DingTalk material result is attached.',recipientActorIds:replyToSource?[sourceIdentity.principal,bob]:[bob],...(replyToSource?{replyToSource}:{}),taskDelivery:{taskId,requirementRevision:task.requirementRevision,artifactIds:task.completion.result.artifactFiles.map(file=>file.artifact.artifactId)}}
        if(replyToSource){
          if(step<=6){assert.equal((await app.tasks.store.query({kind:'notification.list'})).length,0,'invalid quote requests must not prepare any notification');assert.equal(sent.length,0)}
          if(step<=3)return {tool:'resident_router_reply',args:{...delivery,operationId:'neutral-quote-audience-'+step,recipientActorIds:[undefined,[],[bob]][step-1]}}
          if(step===4||step===5)return {tool:'resident_router_reply',args:{...delivery,operationId:'neutral-quote-schema-'+step,replyToSource:step===4?false:'true'}}
          if(step===6||step===7)return {tool:'resident_router_reply',args:delivery}
          if(step===8){const {replyToSource,...withoutQuote}=delivery;return {tool:'resident_router_reply',args:withoutQuote}}
          if(step===9)return {tool:'resident_router_reply',args:{...delivery,recipientActorIds:[sourceIdentity.principal]}}
          if(step===10)return settle()
        }else{
          if(step===1)return {tool:'resident_router_reply',args:{...delivery,text:'Verified task '+taskId+' is complete.'}}
          if(step===2){
            assert.equal((await app.tasks.store.query({kind:'notification.list'})).length,0,'internal task ID must fail before freezing the delivery')
            assert.equal(sent.length,0)
            return {tool:'resident_router_reply',args:delivery}
          }
          if(step===3)return settle()
        }
      }
      return {text:'Frozen delivery has a durable disposition'}
    }
    if(step===0)return settle()
    return {text:'Non-business event settled'}
  })
  channels=f.host.ctx.channels
  const message={type:'chat-room',channelId:'neutral-channel',conversationId:'local-room',senderId:'alice',messageId:'neutral-request',text:'DingTalk request: read the attached local material and deliver the verified file.'+(replyToSource?' Quote this original message and notify me and bob.':''),mentions:['bob'],quotedMessage:{messageId:'bob-original',senderId:'bob',text:'Keep this original quote'},resourceRefs:[{type:'file',resourceId:'local-material',fileName:'request.txt'}]}
  sourceIdentity=channels.identity(message);bob=channels.identity({...message,senderId:'bob'}).principal;foreign=channels.identity({...message,senderId:'foreign-person',conversationId:'other-room'}).principal
  channels.registerTransport('neutral-channel',{
    async send(envelope){calls.push('text-send');sent.push(structuredClone(envelope));return {messageId:'local-text'}} ,
    async readback(envelope){calls.push('text-readback');return {messageId:'local-text',visible:true}},
    async sendFile(envelope,notification,file){calls.push('file-send');sent.push(structuredClone(envelope));assert.equal(await readFile(join(file.directory,file.fileName),'utf8'),materialText);return {messageId:'local-file'}},
    async readbackFile(){calls.push('file-readback');if(replyToSource){fileReadbackStarted=true;await fileReadback.promise}return {messageId:'local-file',visible:true}},
    async readResource(envelope){resourceReads.push(structuredClone(envelope));return {text:materialText,complete:true,hasMore:false,failures:[]}},
  })
  f.host.ctx.on('tools/result',(execution,result)=>{results.push({name:execution.name,result,sessionId:execution.agent?.id});progress.tools[execution.name]=(progress.tools[execution.name]??0)+1;progress.lastTool={name:execution.name,isError:!!result.isError,code:result.error?.code};if(execution.name==='task_result'&&result.isError&&!progress.firstTaskResultError){const text=(result.content??[]).filter(part=>part.type==='text').map(part=>part.text).join(String.fromCharCode(10));progress.firstTaskResultError={codes:[...new Set(text.match(/[A-Z][A-Z0-9_]{5,}/g)??[])],digest:hash(text)}}progress.phase='tool-result'})
  const appConfig={...f.config,resident:{host:'127.0.0.1',port:0,taskSessions:{instanceId:'neutral-tools',ownerActorId:'owner',webActorId:'owner',ingressEpoch:new Date().toISOString(),initialize:true,reasoningMode:'inherit'}}}
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,appConfig)})
  app=f.host.ctx.get('application')
  await channels.receive({...message,messageId:'bob-original',senderId:'bob',text:'Participant only',quotedMessage:undefined,resourceRefs:[],mentions:[]})
  await channels.receive({...message,messageId:'foreign-original',senderId:'foreign-person',conversationId:'other-room',text:'Different conversation participant',quotedMessage:undefined,resourceRefs:[],mentions:[]})
  await channels.receive(message);progress.phase='business-drain'
  if(replyToSource){
    try{
      await eventually(()=>fileReadbackStarted,'frozen file readback has actually started',t.signal)
      const pending=await app.tasks.store.query({kind:'notification.list'})
      assert.equal(pending.find(notice=>!notice.payload.artifact).state,'delivered')
      assert.notEqual(pending.find(notice=>notice.payload.artifact).state,'delivered','exact send identity does not replace frozen file readback')
    }finally{fileReadback.resolve()}
  }
  await app.tasks.whenIdle();progress.phase='delivery-wait'
  await eventually(async()=>{const notices=await app.tasks.store.query({kind:'notification.list'});return notices.length===2&&notices.every(notice=>notice.state==='delivered')},'default Router text and frozen file both visibly delivered',t.signal)
  await app.tasks.whenIdle()
  const task=await app.tasks.store.query({kind:'task.get',taskId}),notices=await app.tasks.store.query({kind:'notification.list'})
  assert.equal(task.status,'completed');assert.equal(task.drained,true);assert.equal(task.ownerActorId,sourceIdentity.principal);assert.equal(task.conversationId,sourceIdentity.sessionId)
  assert.deepEqual(calls,['text-send','text-readback','file-send','file-readback']);assert.equal(sent.length,2)
  for(const [index,envelope] of sent.entries()){assert.equal(envelope.conversationId,message.conversationId);assert.equal(envelope.channelId,message.channelId);assert.deepEqual(envelope.recipientIds,replyToSource?['alice','bob']:['bob']);assert.equal(envelope.replyToMessageId,replyToSource&&index===0?message.messageId:undefined);assert.equal(envelope.replyToParticipantId,replyToSource&&index===0?'alice':undefined)}
  assert.ok(resourceReads.length>=1);assert.ok(resourceReads.every(value=>value.channelId===message.channelId&&value.conversationId===message.conversationId&&value.messageId===message.messageId));assert.deepEqual(resourceReads[0].resource,message.resourceRefs[0])
  const child=notices.find(notice=>notice.payload.artifact),parent=notices.find(notice=>!notice.payload.artifact)
  assert.equal(child.payload.afterNotificationId,parent.id);assert.deepEqual(child.payload.recipientActorIds,replyToSource?[sourceIdentity.principal,bob]:[bob]);assert.equal(child.payload.replyToActorId,undefined)
  assert.equal(parent.payload.sourceMessageId,replyToSource?message.messageId:undefined);assert.equal(parent.payload.replyToActorId,replyToSource?sourceIdentity.principal:undefined)
  assert.equal(parent.payload.replyRequest.replyToMessageId,parent.payload.sourceMessageId);assert.equal(parent.payload.replyRequest.replyToActorId,parent.payload.replyToActorId)
  assert.equal(parent.payload.taskDelivery.taskId,taskId);assert.equal(parent.payload.taskDelivery.requirementRevision,task.requirementRevision)
  assert.deepEqual(parent.payload.taskDelivery.artifactIds,task.completion.result.artifactFiles.map(file=>file.artifact.artifactId))
  assert.ok(taskPackets.length>=3)
  for(const input of taskPackets){for(const source of input.sources){assert.equal(Object.hasOwn(source,'groupId'),false);if(source.quote){assert.equal(source.quote.actorId,bob);assert.equal(source.quote.text,message.quotedMessage.text);assert.equal(Object.hasOwn(source.quote,'senderOpenDingTalkId'),false)}}for(const material of input.materials){assert.equal(Object.hasOwn(material,'groupId'),false);if(material.quote)assert.equal(material.quote.actorId,bob)}}
  const rejected=results.filter(row=>row.name==='resident_router_reply'&&row.result.isError)
  assert.equal(rejected.length,replyToSource?8:4,'source/recipient ACL, quote author and operation semantic conflicts fail inside the registered tool')
  if(!replyToSource)assert.equal(rejected.filter(row=>JSON.stringify(row.result).includes('GROUP_REPLY_INTERNAL_DETAILS')).length,1)
  if(replyToSource){assert.equal(rejected.filter(row=>JSON.stringify(row.result).includes('group_reply_quote_author_not_in_recipients')).length,3);assert.equal(rejected.filter(row=>JSON.stringify(row.result).includes('DYNAMIC_COMMAND_ID_CONFLICT')).length,2)}
  const schemaRejected=new Map(f.requests.flatMap(body=>body.messages).filter(message=>message.role==='tool'&&/atOpenDingTalkIds|replyToSource/.test(String(message.content))&&/unexpected|unrecognized|additional|schema|invalid|validation/i.test(String(message.content))).map(message=>[message.tool_call_id,message]))
  assert.equal(schemaRejected.size,replyToSource?3:1,'legacy field and non-true quote options are rejected by official schema before tools/result')
  assert.equal(rejected.length+schemaRejected.size,replyToSource?11:5,'all unauthorized variants fail without additional deliveries')
  assert.ok(results.some(row=>row.name==='resident_source_get'&&!row.result.isError));assert.ok(results.some(row=>row.name==='resident_task_plan'&&!row.result.isError));assert.equal(f.errors.length,0)
  const taskNative=await f.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
  await f.close();f.config.reflection={enabled:false};await f.boot()
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,appConfig)});app=f.host.ctx.get('application')
  await app.tasks.whenIdle()
  assert.equal(f.host.ctx.channels.transports.size,0)
  assert.deepEqual(await app.tasks.store.query({kind:'notification.list'}),notices,'delivered payloads, digests and attempts remain unchanged with no channel installed')
  assert.ok(!app.tasks.listAlerts().some(row=>row.detail==='CHANNEL_TRANSPORT_UNAVAILABLE'),'terminal delivered notifications do not require a disabled transport')
  assert.deepEqual((await f.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})).entries,taskNative.entries)
  const pendingId='neutral-pending-disabled-channel'
  await app.tasks.store.command({id:'fixture-pending-disabled-channel',kind:'notification.prepare',args:{notificationId:pendingId,taskId:parent.taskId,requirementRevision:parent.requirementRevision,kind:parent.kind,payload:parent.payload}})
  await app.tasks.recover();await app.tasks.whenIdle()
  const disabledPending=await app.tasks.store.query({kind:'notification.get',notificationId:pendingId})
  assert.equal(disabledPending.state,'prepared');assert.equal(disabledPending.sendAttemptCount??0,0)
  assert.ok(app.tasks.listAlerts().some(row=>row.alertId==='failure:'+pendingId&&row.detail==='CHANNEL_TRANSPORT_UNAVAILABLE'),'unfinished delivery still reports its missing transport')
  assert.deepEqual(calls,['text-send','text-readback','file-send','file-readback'])
  t.diagnostic(JSON.stringify({case:'default-neutral-tools',replyToSource:replyToSource??'omitted',disabledColdTerminalUnchanged:true,pendingTransportFailureRetained:true,taskStatus:task.status,drained:task.drained,sourceAclRejections:rejected.length+schemaRejected.size,resourceReads:resourceReads.length,visibleText:1,visibleFrozenFile:1,recipientNativeIds:sent.map(value=>value.recipientIds),literalUserVendorTextPreserved:true,realVendorExecuted:false}))
})

async function defaultDwsEcho(t,statusMode='success'){
  const stages=new Map(),sent=[],triaged=[],historyReads=[],streams=new Map(),statusGate=Promise.withResolvers(),contentGate=Promise.withResolvers()
  let app,plugin,otherPlugin,channels,ready=statusMode==='success',contentStarted=false,statusStarted=false,history=[]
  t.signal.addEventListener('abort',()=>{statusGate.resolve();contentGate.resolve()},{once:true})
  t.after(()=>{statusGate.resolve();contentGate.resolve()})
  const f=await memoryHost(t,body=>{
    const tools=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：'),handoff=requestEnvelope(body,'Router 交接请求：')
    if(tools.includes('channel_triage_submit')){triaged.push(...triage.messages.map(message=>message.messageId));return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(message=>({sourceId:message.sourceId,messageVersion:message.version??message.messageVersion,needsHandling:message.messageId==='race-request',reason:'Only the original request needs a reply'}))}}}
    if(handoff)return {text:JSON.stringify({currentIntent:'Preserve exact delivery identity',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(!tools.includes('resident_router_reply'))return {text:'No further action'}
    const input=requestEnvelope(body,'Router 请求：'),key=input.events.map(event=>event.id).join(','),step=stages.get(key)??0;stages.set(key,step+1)
    const source=input.events.find(event=>event.source?.messageId==='race-request')?.source
    if(source&&step===0)return {tool:'resident_router_reply',args:{operationId:'race-reply',sourceId:source.sourceId,messageVersion:source.version,text:'Exactly one visible reply',recipientActorIds:[]}}
    if(step===(source?1:0))return {tool:'resident_router_settle',args:{operationId:'race-settle:'+key,eventIds:input.events.map(event=>event.id)}}
    return {text:'Settled'}
  })
  const flag=(args,name)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1]}
  const page=messages=>({complete:true,hasMore:false,failedCount:0,failures:[],foundCount:messages.length,notFoundMessageIds:[],messages})
  const runner={async run(args){
    assert.equal(flag(args,'--profile'),'fixture-corp:fixture-user');assert.equal(flag(args,'--format'),'json')
    let value
    if(args.includes('+messages-send')||args.includes('+messages-reply')){
      assert.equal(sent.length,0,'uncertain delivery must never be resent')
      sent.push({messageId:'race-visible',conversationId:flag(args,'--group')??flag(args,'--conversation-id'),text:flag(args,'--markdown')??flag(args,'--text')??flag(args,'--content'),senderOpenDingTalkId:'same-account',createTime:new Date().toISOString()})
      value={sendReceipt:{openTaskId:'fixture-send'}}
    }else if(args.includes('+messages-query-send-status')){
      assert.equal(flag(args,'--open-task-id'),'fixture-send');statusStarted=true
      if(!ready&&statusMode==='timeout')await statusGate.promise
      if(!ready&&statusMode==='error')return {exitCode:1,stdout:'',stderr:'fixture status unavailable'}
      value={contractVersion:'im.message-send-status.v1',success:true,openTaskId:'fixture-send',result:{sendStatus:ready?'SUCCESS':'PROCESSING',...(ready?{openConversationId:'race-room',openMessageId:'race-visible'}:{})},...(ready?{messageRef:{openConversationId:'race-room',openMessageId:'race-visible'}}:{})}
    }else if(args.includes('+messages-mget')){
      assert.equal(flag(args,'--msg-ids'),'race-visible');contentStarted=true;await contentGate.promise;value=page(sent)
    }else if(args.includes('+chat-messages')){
      const range={conversationId:flag(args,'--group'),start:flag(args,'--start'),end:flag(args,'--end')};historyReads.push(range)
      value=page(history.filter(message=>message.groupId===range.conversationId&&Date.parse(message.occurredAt)>=Date.parse(range.start)&&Date.parse(message.occurredAt)<=Date.parse(range.end)).map(message=>({...message,conversationId:message.groupId,createTime:message.occurredAt})))
    }else throw Error('Unexpected fixture DWS command: '+args.slice(0,3).join(' '))
    return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
  },spawn(args,callbacks){
    const group=flag(args,'--chat-id')??flag(args,'--group'),done=Promise.withResolvers();assert.ok(group)
    streams.set(group,callbacks);queueMicrotask(()=>callbacks.onStderrLine('[event] ready'))
    return {done:done.promise,terminate(){done.resolve({exitCode:0})}}
  }}
  async function mount({recovering=false}={}){
    const ctx=f.host.ctx;channels=ctx.channels
    for(const channelId of ['dingtalk-dws','other-dws','other-room-dws'])await ctx.plugin({inject:['channels','runtimePaths'],apply:child=>applyDws(child,pluginConfig(channelId,{dingtalk_group_id:channelId==='other-room-dws'?'other-room':'race-room',dingtalk_account_mode:'system',dingtalk_writes_authorized:true,dingtalk_listen:channelId==='dingtalk-dws'}),pluginDependencies(f,runner,{actorId:'same-account'}))})
    await ctx.plugin({inject,apply:child=>applyApplication(child,{...f.config,resident:{host:'127.0.0.1',port:0,taskSessions:{instanceId:'default-echo',ownerActorId:'owner',webActorId:'owner',initialize:true,reasoningMode:'inherit',ingressEpoch:'2026-01-01T00:00:00Z'}}})})
    app=ctx.get('application');plugin=channels.plugins.get('dingtalk-dws');otherPlugin=channels.plugins.get('other-dws')
    assert.equal(channels.operatorNotifications,undefined)
    await eventually(()=>plugin.health.conversations?.length===1&&plugin.health.conversations.every(group=>group.listener?.state==='ready'&&(recovering||group.backfill?.state==='ok')),'real optional bridge ready with initial history',t.signal)
  }
  await mount()
  const raw={groupId:'race-room',messageId:'race-request',senderOpenDingTalkId:'alice',text:'Please send one bounded reply',occurredAt:new Date().toISOString()}
  const input=message=>({type:'chat-room',channelId:'dingtalk-dws',conversationId:message.groupId,senderId:message.senderOpenDingTalkId,messageId:message.messageId,text:message.text})
  const identity=channels.identity(input(raw));assert.notEqual(identity.sessionId,raw.groupId)
  const ingressFile=dingtalkChannelPaths(f.host.ctx.runtimePaths,'dingtalk-dws').ingressFile
  async function absent(message){
    assert.equal(channels.groupContext(channels.identity(input(message)).sessionId)?.messageFacts?.[message.messageId],undefined,'no channel fact may precede identity resolution')
    assert.equal((await app.tasks.store.query({kind:'source.list'})).filter(source=>source.messageId===message.messageId&&source.groupId===identity.sessionId).length,0)
    assert.equal(triaged.filter(id=>id===message.messageId).length,0)
  }
  return {f,sent,triaged,historyReads,raw,identity,ingressFile,input,absent,
    get app(){return app},get plugin(){return plugin},get otherPlugin(){return otherPlugin},get channels(){return channels},
    get statusStarted(){return statusStarted},get contentStarted(){return contentStarted},
    receive:message=>plugin.acceptHistoryMessage(message),
    emit(message){streams.get(message.groupId).onStdoutLine(JSON.stringify({conversation_id:message.groupId,message_id:message.messageId,sender_open_dingtalk_id:message.senderOpenDingTalkId,content:message.text,event_time:Date.parse(message.occurredAt)}))},
    release(){ready=true;statusGate.resolve();contentGate.resolve()},
    async restart(messages){history=messages;await f.close();streams.clear();await f.boot();await mount({recovering:true})},
  }
}

test('default optional DWS filters exact echo before registration while content readback is pending',{timeout:nativeTestTimeout(45000)},async t=>{
  const h=await defaultDwsEcho(t)
  try{
    await h.receive(h.raw);await eventually(()=>h.contentStarted,'real adapter content mget is in flight',t.signal)
    const notice=(await h.app.tasks.store.query({kind:'notification.list'}))[0]
    assert.equal(notice.ack.sendReceipt.openTaskId,'fixture-send');assert.equal(notice.ack.messageId,undefined);assert.notEqual(notice.state,'delivered')
    const echo={...h.raw,messageId:'race-visible',senderOpenDingTalkId:'same-account',text:h.sent[0].text,messageAiSendFlag:'DWS'}
    assert.equal((await h.receive(echo)).reason,'own-notification');await h.absent(echo)
    const current=await h.app.tasks.store.query({kind:'notification.get',notificationId:notice.id});assert.notEqual(current.state,'delivered');assert.equal(current.receipt?.messageId,undefined);assert.equal(current.receipt?.observedAt,undefined)
    const fresh={...echo,messageId:'same-account-real-message'}
    assert.notEqual((await h.receive(fresh)).reason,'own-notification')
    await assert.rejects(h.receive({...echo,groupId:'other-room'}),/AUTHENTICATED_IDENTITY_REQUIRED/)
    assert.notEqual((await h.channels.plugins.get('other-room-dws').acceptHistoryMessage({...echo,groupId:'other-room'})).reason,'own-notification')
    assert.notEqual((await h.otherPlugin.acceptHistoryMessage(echo)).reason,'own-notification')
    await eventually(async()=>{const sources=await h.app.tasks.store.query({kind:'source.list'});return sources.length===4&&h.triaged.includes(fresh.messageId)},'three non-echo messages reach formal source and triage',t.signal)
  }finally{h.release()}
  await h.app.tasks.whenIdle()
  await eventually(async()=>(await h.app.tasks.store.query({kind:'notification.list'}))[0]?.state==='delivered','original content readback completes delivery',t.signal)
  assert.equal(h.sent.length,1);assert.equal((await h.app.tasks.store.query({kind:'task.list'})).length,0)
  t.diagnostic(JSON.stringify({case:'default-optional-dws-echo',internalNativeScopesDiffer:true,operatorNotifications:false,echoFactsSourcesTriage:0,sendCount:1,contentReadbackRequired:true,realVendorExecuted:false}))
})

for(const mode of ['timeout','error'])test('default optional DWS defers unresolved '+mode+' identity and cold backfills the original older message once',{timeout:nativeTestTimeout(45000)},async t=>{
  const h=await defaultDwsEcho(t,mode)
  let phase='status',deferred
  try{
    await h.receive(h.raw);await eventually(()=>h.statusStarted,'original notification status query started',t.signal)
    phase='typed-deferral'
    deferred={...h.raw,messageId:'older-real-message',text:'A separate genuine request',occurredAt:new Date(Date.parse(h.raw.occurredAt)-120000).toISOString()}
    h.emit(deferred)
    const checkpoint=await eventually(async()=>{try{const state=JSON.parse(await readFile(h.ingressFile,'utf8'));return state.recoveryFromAt&&state}catch(error){if(error.code!=='ENOENT')throw error}},'typed deferral persists its original lower bound',t.signal).catch(async error=>{t.diagnostic(JSON.stringify({mode,health:h.plugin.health,notifications:(await h.app.tasks.store.query({kind:'notification.list'})).map(n=>({id:n.id,state:n.state,hasAck:!!n.ack,receipt:n.receipt})),triaged:h.triaged,errors:h.f.errors.map(value=>({code:value.code,message:value.message}))}));throw error})
    assert.ok(Date.parse(checkpoint.recoveryFromAt)<=Date.parse(deferred.occurredAt));assert.ok(Date.parse(deferred.occurredAt)<Date.parse(h.raw.occurredAt)-30000)
    await eventually(()=>h.plugin.health.conversations.some(group=>group.listener?.lastEventError==='CHANNEL_NOTIFICATION_IDENTITY_PENDING'),'typed deferral reaches bridge health after persistence',t.signal)
    await h.absent(deferred);assert.equal(h.plugin.health.healthy,false)
    const other={...deferred,groupId:'other-room',messageId:'other-scope-real-message'}
    assert.notEqual((await h.channels.plugins.get('other-room-dws').acceptHistoryMessage(other)).reason,'own-notification')
    await eventually(()=>h.triaged.includes(other.messageId),'another scope remains available during the unresolved send',t.signal)
    phase='cold-admission'
    h.release();await h.restart([deferred])
    await eventually(async()=>{const sources=await h.app.tasks.store.query({kind:'source.list'});return sources.some(source=>source.messageId===deferred.messageId)&&h.triaged.includes(deferred.messageId)},'cold complete history formally admits the same deferred message',t.signal)
    phase='cold-drain'
    await h.app.tasks.whenIdle()
    const sources=(await h.app.tasks.store.query({kind:'source.list'})).filter(source=>source.messageId===deferred.messageId)
    assert.equal(sources.length,1);assert.equal(sources[0].version,1);assert.equal(h.triaged.filter(id=>id===deferred.messageId).length,1)
    assert.ok(h.historyReads.some(range=>range.conversationId===deferred.groupId&&Date.parse(range.start)<=Date.parse(deferred.occurredAt)))
    await eventually(async()=>JSON.parse(await readFile(h.ingressFile,'utf8')).recoveryFromAt===undefined,'only successful complete recovery clears the durable lower bound',t.signal)
    assert.equal(h.sent.length,1);assert.equal((await h.app.tasks.store.query({kind:'task.list'})).length,0)
    t.diagnostic(JSON.stringify({case:'default-optional-dws-deferred-'+mode,sourceCount:1,triageCount:1,oldTimestampRecovered:true,sendCount:1,realVendorExecuted:false}))
  }catch(error){
    const describe=(value,seen=new Set())=>{
      if(value===null||typeof value!=='object')return value
      if(seen.has(value))return '[circular]'
      seen.add(value)
      return {name:value.name,code:value.code,message:value.message,stack:value.stack,...value.cause!==undefined?{cause:describe(value.cause,seen)}:{},...Array.isArray(value.errors)?{errors:value.errors.map(item=>describe(item,seen))}:{}}
    }
    let ingress,sources
    try{ingress=JSON.parse(await readFile(h.ingressFile,'utf8'))}catch(value){ingress={readError:describe(value)}}
    try{sources=(await h.app.tasks.store.query({kind:'source.list'})).filter(source=>source.messageId===deferred?.messageId)}catch(value){sources={queryError:describe(value)}}
    t.diagnostic(JSON.stringify({case:'default-optional-dws-deferred-diagnostic',mode,phase,error:describe(error),health:h.plugin.health,ingress,historyReads:h.historyReads.map(range=>({...range,coversDeferred:range.conversationId===deferred?.groupId&&Date.parse(range.start)<=Date.parse(deferred?.occurredAt)&&Date.parse(range.end)>=Date.parse(deferred?.occurredAt)})),deferred,sources,triageCount:h.triaged.filter(id=>id===deferred?.messageId).length,triaged:h.triaged,errors:h.f.errors.map(value=>describe(value)),rawBridgeErrorUnavailable:true,realVendorExecuted:false}))
    throw error
  }finally{h.release()}
})

test('default optional DWS keeps permanently unknown identity degraded and retains its cold recovery bound',{timeout:nativeTestTimeout(45000)},async t=>{
  const h=await defaultDwsEcho(t,'processing')
  try{
    await h.receive(h.raw);await eventually(()=>h.statusStarted,'original status remains PROCESSING',t.signal)
    const deferred={...h.raw,messageId:'still-unconfirmed-real-message',text:'Await exact identity before admission',occurredAt:new Date(Date.parse(h.raw.occurredAt)-120000).toISOString()}
    h.emit(deferred)
    const checkpoint=await eventually(async()=>{try{const state=JSON.parse(await readFile(h.ingressFile,'utf8'));return state.recoveryFromAt&&state}catch(error){if(error.code!=='ENOENT')throw error}},'unknown identity pins durable recovery',t.signal).catch(async error=>{
      let ingress,notifications
      try{ingress=JSON.parse(await readFile(h.ingressFile,'utf8'))}catch(value){ingress={readError:{code:value.code,message:value.message}}}
      try{notifications=(await h.app.tasks.store.query({kind:'notification.list'})).map(value=>({id:value.id,state:value.state,hasAck:!!value.ack}))}catch(value){notifications={queryError:{code:value.code,message:value.message}}}
      t.diagnostic(JSON.stringify({case:'default-optional-dws-unknown-checkpoint',health:h.plugin.health,ingress,notifications,historyReads:h.historyReads,triaged:h.triaged,errors:h.f.errors.map(value=>({code:value.code,message:value.message})),realVendorExecuted:false}))
      throw error
    })
    await h.absent(deferred);await h.restart([deferred])
    await eventually(()=>h.plugin.health.conversations.some(group=>group.backfill?.lastError==='CHANNEL_NOTIFICATION_IDENTITY_PENDING'),'cold history exposes unresolved identity rather than pretending success',t.signal)
    await h.absent(deferred)
    const current=JSON.parse(await readFile(h.ingressFile,'utf8'))
    assert.ok(Date.parse(current.recoveryFromAt)<=Date.parse(checkpoint.recoveryFromAt));assert.equal(h.plugin.health.healthy,false)
    assert.equal(h.sent.length,1);assert.notEqual((await h.app.tasks.store.query({kind:'notification.list'}))[0].state,'delivered')
  }finally{h.release()}
})

const pluginConfig=(channelId,extra={})=>({...validateDingtalkConfig(dingtalkPublic(extra)),enabled:true,channelId})
function pluginDependencies(f,runner,{actorId='self',peerId='peer'}={}){
 const bindingRunner={...runner,async run(args){
  const flag=name=>args[args.indexOf(name)+1]
  let value
  if(args[0]==='profile')value={success:true,profiles:[{profile:'fixture-corp:fixture-user',corpId:'fixture-corp',userId:'fixture-user',userName:'Fixture Self',isOrgCurrent:true}]}
  else if(args.includes('get-self'))value={result:[{orgEmployeeModel:{corpId:'fixture-corp',userId:'fixture-user',orgUserName:'Fixture Self'}}]}
  else if(args[0]==='contact'&&args.includes('get'))value={result:[{orgEmployeeModel:{corpId:'fixture-corp',userId:flag('--ids'),orgUserName:'Fixture Peer'}}]}
  else if(args.includes('+search-user'))value={ok:true,outcome:'success',data:{count:1,users:[{userId:flag('--query')==='Fixture Self'?'fixture-user':'peer-user',openDingTalkId:flag('--query')==='Fixture Self'?actorId:peerId}]}}
  else if(args.includes('conversation-info'))value={success:true,result:{conversationInfo:{openConversationId:args.includes('--group')?flag('--group'):'private',singleChat:!args.includes('--group'),title:'Verified room title'},friendlyHint:'',retryable:false}}
  else return runner.run(args)
  return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
 }}
 return {runner:bindingRunner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:f.root,DWS_KEYCHAIN_DIR:f.root}}
}
const dingtalkPublic=(extra={})=>({dingtalk_profile:'fixture-corp:fixture-user',dingtalk_conversation_type:'chat-room',dingtalk_group_id:'fixture-room',dingtalk_listen:false,...extra})
const completeHistory=messages=>({messages,complete:true,hasMore:false,partial:false,failedCount:0,failures:[]})
function boundDwsFixture(){
 const calls=[],streams=new Map(),state={authenticated:true,exitCode:0,messages:[]}
 const profile={profile:'fixture-corp:fixture-user',corpId:'fixture-corp',userId:'fixture-user',userName:'Fixture Self',isOrgCurrent:true,isCurrent:true}
 const runner={
  async run(args){
   calls.push([...args]);let value
   if(args[0]==='profile')return {exitCode:state.exitCode,stdout:JSON.stringify({success:true,profiles:state.authenticated?[profile]:[]}),stderr:''}
   assert.equal(args[args.indexOf('--profile')+1],profile.profile)
   if(args.includes('get-self'))value={result:[{orgEmployeeModel:{corpId:profile.corpId,userId:profile.userId,orgUserName:'Fixture Self'}}]}
   else if(args[0]==='contact'&&args.includes('get'))value={result:[{orgEmployeeModel:{corpId:profile.corpId,userId:args[args.indexOf('--ids')+1],orgUserName:'Fixture Peer'}}]}
   else if(args.includes('+search-user')){const self=args[args.indexOf('--query')+1]==='Fixture Self';value={ok:true,outcome:'success',data:{count:1,users:[{userId:self?profile.userId:'peer-user',openDingTalkId:self?'self-open':'peer-open'}]}}}
   else if(args.includes('conversation-info'))value={success:true,result:{conversationInfo:{openConversationId:args.includes('--group')?args[args.indexOf('--group')+1]:'fixture-direct',singleChat:!args.includes('--group')},friendlyHint:'',retryable:false}}
   else if(args.includes('+chat-messages'))value=completeHistory(state.messages)
   else assert.fail('Unexpected isolated DWS command: '+args.slice(0,2).join(' '))
   return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
  },
  spawn(args,callbacks){
   assert.ok(args.includes('+listen-im'));assert.equal(args[args.indexOf('--kind')+1],'group')
   const done=Promise.withResolvers();streams.set('group',callbacks)
   queueMicrotask(()=>callbacks.onStderrLine('[event] ready'))
   return {done:done.promise,terminate(){done.resolve()}}
  },
 }
 return {runner,calls,streams,state,profile}
}
async function dingtalkTree(root){
 const rows=[]
 async function visit(path,name){
  const info=await lstat(path)
  rows.push({name,mode:info.mode,ino:info.ino,nlink:info.nlink,mtimeMs:info.mtimeMs,...info.isFile()?{body:(await readFile(path)).toString('base64')}: {}})
  if(info.isDirectory())for(const child of (await readdir(path)).sort())await visit(join(path,child),name+'/'+child)
 }
 await visit(root,'.');return rows
}

test('SG12 钉钉CLI check完整零写，disabled跨日启用保留实际首次下界且查询不被午夜替代',async t=>{
 const f=await memoryHost(t),paths=f.host.ctx.runtimePaths;await f.close()
 const file=join(paths.config,'config.json'),epoch='2026-01-02T03:04:05.000Z'
 const existing={type:'dingtalk-dws',channelId:'preinstalled',enabled:false,config:dingtalkPublic()}
 await writeFile(file,JSON.stringify({...f.config,resident:{taskSessions:{ingressEpoch:epoch}},channelPlugins:[existing]}))
 const invoke=async(args,environment={})=>{let output;await runDingtalkCli([file,...args],{environment,write:text=>{output=JSON.parse(text)}});return output}
 const before=await dingtalkTree(f.root)
 for(const args of [
  ['add','--channel-id','new-disabled','--enabled','false','--json',JSON.stringify(dingtalkPublic()),'--check'],
  ['disable','--channel-id','preinstalled','--check'],['enable','--channel-id','preinstalled','--check'],
 ]){const result=await invoke(args);assert.equal(result.checkOnly,true);assert.equal(result.liveApplied,false);assert.equal(result.changed,true)}
 const env={DINGTALK_CHANNELS_JSON:JSON.stringify([{...existing,channelId:'env-group'},{...existing,channelId:'env-private',config:dingtalkPublic({dingtalk_conversation_type:'chat',dingtalk_group_id:undefined,dingtalk_user_id:'peer-user'})}])}
 assert.equal((await invoke(['env','--check'],env)).changed,true)
 assert.deepEqual(await dingtalkTree(f.root),before)
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-01T15:00:00.000Z')})
 const created=await invoke(['add','--channel-id','new-disabled','--enabled','false','--json',JSON.stringify(dingtalkPublic())])
 assert.equal(created.ok,true);assert.equal(created.liveApplied,false);assert.equal(created.restartRequired,true)
 const ingressFile=dingtalkChannelPaths(paths,'new-disabled').ingressFile
 const first=JSON.parse(await readFile(ingressFile,'utf8'))
 assert.equal(first.firstStartedAt,'2026-10-01T15:00:00.000Z');assert.equal(first.paused,true)
 t.mock.timers.setTime(Date.parse('2026-10-03T16:00:00.000Z'))
 await invoke(['enable','--channel-id','new-disabled'])
 const next=JSON.parse(await readFile(ingressFile,'utf8'))
 assert.equal(next.firstStartedAt,first.firstStartedAt);assert.equal(next.pausedAt,first.pausedAt);assert.equal(next.recoveryFromAt,first.firstStartedAt)
 await invoke(['enable','--channel-id','preinstalled'])
 assert.equal(JSON.parse(await readFile(dingtalkChannelPaths(paths,'preinstalled').ingressFile,'utf8')).firstStartedAt,epoch)
 const ingress=await openDingtalkIngress(paths,'new-disabled'),ranges=[],config={...validateDingtalkConfig(dingtalkPublic()),binding:{conversationId:'fixture-room',actorId:'self-open'}}
 const adapter=dingtalkIngressAdapter({async readGroupRange(id,range){assert.equal(id,'fixture-room');ranges.push(range);return completeHistory([])}},config,{getFromAt:()=>ingress.snapshot().recoveryFromAt})
 await adapter.readGroupRange('fixture-room',{start:'2026-10-01T00:00:00.000Z',end:'2026-10-03T16:00:00.000Z'})
 assert.equal(ranges[0].start,first.firstStartedAt)
 await ingress.saveBridgeState({...ingress.snapshot(),recoveryFromAt:epoch})
 await adapter.readGroupRange('fixture-room',{start:epoch,end:'2026-10-03T16:00:00.000Z'})
 assert.equal(ranges[1].start,epoch)
 await ingress.drain();t.mock.timers.reset()
 const stable=await dingtalkTree(f.root)
 await assert.rejects(invoke(['add','--channel-id','bad','--json','{}','--check']),/DINGTALK_CONFIG_INVALID/)
 assert.deepEqual(await dingtalkTree(f.root),stable)
 await assert.rejects(openDingtalkIngress(paths,'missing-start'),{code:'DINGTALK_INGRESS_START_REQUIRED'})
 assert.deepEqual(await dingtalkTree(f.root),stable)
})

test('SG12 默认真实登录文件观察从待认证接绑定，恢复context安全且普通使用不触发重试',async t=>{
 const f=await memoryHost(t),channels=f.host.ctx.channels,paths=f.host.ctx.runtimePaths,auth=join(f.root,'isolated-dws-metadata'),wire=boundDwsFixture()
 await mkdir(auth);wire.state.authenticated=false
 const profileFile=join(auth,'profiles.json'),metadata={profiles:[{corpId:'fixture-corp',userId:'fixture-user',lastLoginAt:'2026-10-01T00:00:00Z',lastUsedAt:'2026-10-01T00:00:00Z'}]}
 await writeFile(profileFile,JSON.stringify(metadata))
 // Observe this isolated system config explicitly; Linux otherwise defaults to a separate private account directory.
 const config={...validateDingtalkConfig(dingtalkPublic({dingtalk_prompt:'隔离职责',dingtalk_account_mode:'system'})),enabled:true,channelId:'auth-observed'}
 const input={type:'chat-room',channelId:config.channelId,conversationId:'fixture-room',senderId:'self-open',messageId:'restored',text:'历史上下文'}
 const context=await channels.registerConversation(input)
 await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,config,{runner:wire.runner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:auth}})})
 const plugin=channels.plugins.get(config.channelId),epoch='2026-01-02T03:04:05.000Z'
 await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:epoch}}},runtime:{},tasks:{isOwnNotification:()=>false}})
 assert.equal(plugin.health.state,'waiting-auth');assert.equal(channels.groupContext(context.sessionId).responsibility,undefined);assert.equal(channels.responsibility(context.sessionId),undefined)
 const ingressFile=dingtalkChannelPaths(paths,config.channelId).ingressFile
 assert.equal(JSON.parse(await readFile(ingressFile,'utf8')).firstStartedAt,epoch)
 const attempts=()=>wire.calls.filter(args=>args[0]==='profile').length
 assert.equal(attempts(),1)
 metadata.profiles[0].lastUsedAt='2026-10-02T00:00:00Z';await writeFile(profileFile,JSON.stringify(metadata))
 await new Promise(resolve=>setTimeout(resolve,350));assert.equal(attempts(),1);assert.equal(plugin.health.state,'waiting-auth')
 wire.state.authenticated=true;metadata.profiles[0].lastLoginAt='2026-10-03T00:00:00Z';await writeFile(profileFile,JSON.stringify(metadata))
 await eventually(()=>plugin.health.state==='ready','default login observer bound exact channel')
 assert.equal(attempts(),2);assert.equal(channels.responsibility(context.sessionId),'隔离职责')
 assert.equal(plugin.responsibility({...channels.groupContext(context.sessionId),conversationId:'foreign-room'}),undefined)
 assert.equal(JSON.parse(await readFile(ingressFile,'utf8')).firstStartedAt,epoch)
 assert.equal(JSON.parse(await readFile(dingtalkChannelPaths(paths,config.channelId).bindingFile,'utf8')).profile,'fixture-corp:fixture-user')
 assert.equal(f.requests.length,0)
})

test('SG12 账号歧义、目标漂移与非认证错误失败关闭，不从首项或文件变化猜测重试',async t=>{
 const profile={profile:'a:u',corpId:'a',userId:'u',corpName:'Org',isOrgCurrent:false}
 assert.throws(()=>selectDwsProfile({success:true,profiles:[profile,{...profile,profile:'b:v',corpId:'b',userId:'v'}]},'Org'),{code:'DINGTALK_PROFILE_AMBIGUOUS'})
 assert.throws(()=>selectDwsProfile({success:true,profiles:[profile]},'a'),{code:'DINGTALK_PROFILE_NOT_FOUND'})
 const wire=boundDwsFixture(),config=validateDingtalkConfig(dingtalkPublic({dingtalk_account_mode:'system'}))
 const binding=await resolveDingtalkBinding(config,{runner:wire.runner})
 await assert.rejects(resolveDingtalkBinding({...config,binding:{...binding,conversationId:'other-room'}},{runner:wire.runner}),{code:'DINGTALK_BINDING_CHANGED'})
 for(const exitCode of [1,4]){
  const f=await memoryHost(t),auth=join(f.root,'isolated-dws-metadata');await mkdir(auth)
  const file=join(auth,'profiles.json');await writeFile(file,JSON.stringify({profiles:[]}))
  const fixture=boundDwsFixture();fixture.state.exitCode=exitCode
  const normalized={...config,enabled:true,channelId:'terminal-'+exitCode}
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,normalized,{runner:fixture.runner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:auth}})})
  await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{},tasks:{isOwnNotification:()=>false}})
  const plugin=f.host.ctx.channels.plugins.get(normalized.channelId)
  assert.equal(plugin.health.state,'error');assert.equal(plugin.health.lastError,'DINGTALK_QUERY_FAILED')
  await writeFile(file,JSON.stringify({profiles:[{corpId:'fixture-corp',userId:'fixture-user',lastLoginAt:'2026-10-03T00:00:00Z'}]}))
  await new Promise(resolve=>setTimeout(resolve,350))
  assert.equal(fixture.calls.length,1);assert.equal(plugin.health.state,'error');await f.close()
 }
})

test('DWS通讯录快捷查询按当前CLI成功封装解析账号和私聊，失败与不完整结果拒绝',async()=>{
 const wire=boundDwsFixture(),config=validateDingtalkConfig(dingtalkPublic())
 const binding=await resolveDingtalkBinding(config,{runner:wire.runner})
 assert.equal(binding.actorId,'self-open');assert.equal(binding.conversationId,'fixture-room')
 for(const target of [{dingtalk_user_id:'peer-user'},{dingtalk_user_name:'Fixture Peer'}]){
  const direct=await resolveDingtalkBinding(validateDingtalkConfig(dingtalkPublic({dingtalk_conversation_type:'chat',dingtalk_group_id:undefined,...target})),{runner:wire.runner})
  assert.equal(direct.actorId,'self-open');assert.equal(direct.peerId,'peer-open');assert.equal(direct.peerUserId,'peer-user');assert.equal(direct.conversationId,'fixture-direct')
 }
 const data={count:1,users:[{userId:wire.profile.userId,openDingTalkId:'self-open'}]},success={ok:true,outcome:'success',data}
 const invalid=[
  ['bare response',data,'DINGTALK_USER_RESPONSE_INCOMPLETE'],
  ['failed envelope',{...success,ok:false},'DINGTALK_USER_RESPONSE_INCOMPLETE'],
  ['failed outcome',{...success,outcome:'failure'},'DINGTALK_USER_RESPONSE_INCOMPLETE'],
  ['missing data',{ok:true,outcome:'success'},'DINGTALK_USER_RESPONSE_INCOMPLETE'],
  ['outer partial',{...success,partial:true},'DINGTALK_QUERY_INCOMPLETE'],
  ...[{partial:true},{hasMore:true},{complete:false},{truncatedByPageLimit:true},{failedCount:1},{failures:['fixture failure']}].map(flags=>['incomplete data',{...success,data:{...data,...flags}},'DINGTALK_USER_RESPONSE_INCOMPLETE']),
  ['count mismatch',{...success,data:{...data,count:2}},'DINGTALK_USER_RESPONSE_INVALID'],
  ['invalid collection',{...success,data:{count:1,users:[null]}},'DINGTALK_USER_RESPONSE_INVALID'],
  ['missing actor identity',{...success,data:{count:1,users:[{userId:wire.profile.userId}]}},'DINGTALK_USER_RESPONSE_INVALID'],
  ['no matching account',{...success,data:{count:0,users:[]}},'DINGTALK_ACCOUNT_ACTOR_NOT_FOUND'],
  ['ambiguous account',{...success,data:{count:2,users:[data.users[0],data.users[0]]}},'DINGTALK_ACCOUNT_ACTOR_AMBIGUOUS'],
 ]
 for(const [scenario,value,code] of invalid){
  const calls=[],runner={async run(args){calls.push(args);return args.includes('+search-user')?{exitCode:0,stdout:JSON.stringify(value),stderr:''}:wire.runner.run(args)}}
  await assert.rejects(resolveDingtalkBinding(config,{runner}),{code},scenario)
  assert.equal(calls.some(args=>args[0]==='chat'),false,scenario+' must stop before target resolution')
 }
})

test('DWS会话详情按当前MCP嵌套身份解析，失败与目标漂移拒绝',async()=>{
 const wire=boundDwsFixture(),config=validateDingtalkConfig(dingtalkPublic()),info={openConversationId:config.groupId,singleChat:false}
 const success={success:true,result:{conversationInfo:info,friendlyHint:'',retryable:false}}
 assert.equal((await resolveDingtalkBinding(config,{runner:wire.runner})).conversationId,config.groupId)
 const invalid=[
  ['bare identity',{success:true,result:info},'DINGTALK_CONVERSATION_RESPONSE_INVALID'],
  ['wrong envelope',{ok:true,outcome:'success',data:info},'DINGTALK_CONVERSATION_RESPONSE_INVALID'],
  ['missing success',{result:success.result},'DINGTALK_CONVERSATION_RESPONSE_INVALID'],
  ['failed MCP response',{...success,success:false},'DINGTALK_QUERY_INCOMPLETE'],
  ['outer partial',{...success,partial:true},'DINGTALK_QUERY_INCOMPLETE'],
  ['missing result',{success:true},'DINGTALK_CONVERSATION_RESPONSE_INVALID'],
  ['missing nested identity',{success:true,result:{friendlyHint:'unavailable',retryable:true}},'DINGTALK_CONVERSATION_RESPONSE_INVALID'],
  ['partial nested result',{success:true,result:{...success.result,partial:true}},'DINGTALK_CONVERSATION_RESPONSE_INCOMPLETE'],
  ['missing conversation id',{success:true,result:{conversationInfo:{singleChat:false}}},'DINGTALK_CONVERSATION_RESPONSE_INVALID'],
  ['different target',{success:true,result:{conversationInfo:{...info,openConversationId:'foreign-room'}}},'DINGTALK_GROUP_IDENTITY_MISMATCH'],
  ['wrong conversation kind',{success:true,result:{conversationInfo:{...info,singleChat:true}}},'DINGTALK_GROUP_IDENTITY_MISMATCH'],
 ]
 for(const [scenario,value,code] of invalid){
  const runner={async run(args){return args.includes('conversation-info')?{exitCode:0,stdout:JSON.stringify(value),stderr:''}:wire.runner.run(args)}}
  await assert.rejects(resolveDingtalkBinding(config,{runner}),{code},scenario)
 }
 const runner={async run(args){return args.includes('conversation-info')?{exitCode:0,stdout:JSON.stringify(success),stderr:''}:wire.runner.run(args)}}
 const direct=validateDingtalkConfig(dingtalkPublic({dingtalk_conversation_type:'chat',dingtalk_group_id:undefined,dingtalk_user_id:'peer-user'}))
 await assert.rejects(resolveDingtalkBinding(direct,{runner}),{code:'DINGTALK_PEER_CONVERSATION_MISMATCH'})
})

test('DWS durable ingress pins survive stale bridge snapshots and complete pages missing known messages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-dws-ingress-')),paths={mode:'portable',installRoot:root,config:join(root,'data','config'),state:join(root,'data','state'),secrets:join(root,'data','secrets'),workspaces:join(root,'data','workspaces'),cache:join(root,'data','cache')},channelId='pin-fixture'
 t.after(()=>rm(root,{recursive:true,force:true}))
 const ingress=await openDingtalkIngress(paths,channelId,{fromAt:'2026-10-01T00:00:00.000Z'}),stale=ingress.snapshot(),deferred={messageId:'known-deferred',occurredAt:'2026-10-02T01:00:00.000Z',text:'must not persist a body copy'},newer={messageId:'new-consumed',occurredAt:'2026-10-02T02:00:00.000Z'}
 await ingress.deferred(deferred);await ingress.consumed(newer)
 await ingress.saveBridgeState({...stale,recoveryFromAt:undefined})
 await ingress.completedRange({end:'2026-10-03T00:00:00.000Z'});await ingress.drain()
 const file=dingtalkChannelPaths(paths,channelId).ingressFile,persisted=JSON.parse(await readFile(file,'utf8'))
 assert.deepEqual(persisted.deferredMessages,[{messageId:deferred.messageId,occurredAt:deferred.occurredAt}]);assert.equal(persisted.consumedMessageId,newer.messageId);assert.equal(persisted.firstStartedAt,stale.firstStartedAt)
 assert.equal(persisted.backfillThroughAt,undefined);assert.ok(Date.parse(persisted.recoveryFromAt)<=Date.parse(deferred.occurredAt))
 const cold=await openDingtalkIngress(paths,channelId),config={...validateDingtalkConfig(dingtalkPublic()),binding:{conversationId:'fixture-room',actorId:'self-open'}},ranges=[]
 const adapter=dingtalkIngressAdapter({async readGroupRange(id,range){ranges.push(range);return completeHistory([])}},config,{getFromAt:()=>stale.firstStartedAt,getDeferredMessages:()=>cold.snapshot().deferredMessages??[]})
 await assert.rejects(adapter.readGroupRange('fixture-room',{start:newer.occurredAt,end:'2026-10-03T00:00:00.000Z'}),{code:'DINGTALK_DEFERRED_HISTORY_INCOMPLETE'})
 assert.ok(Date.parse(ranges[0].start)<=Date.parse(deferred.occurredAt));assert.deepEqual(cold.snapshot().deferredMessages,persisted.deferredMessages)
 const pinned=cold.snapshot();await cold.consumed(deferred);await cold.saveBridgeState({...pinned,recoveryFromAt:undefined});await cold.completedRange({end:'2026-10-03T00:00:00.000Z'});await cold.drain()
 const resolved=JSON.parse(await readFile(file,'utf8'))
 assert.equal(resolved.deferredMessages,undefined);assert.equal(resolved.consumedMessageId,newer.messageId);assert.equal(resolved.backfillThroughAt,'2026-10-03T00:00:00.000Z')
})

test('DWS lifecycle retains one observer across serial and concurrent ready and never recreates after stop',async t=>{
 const f=await memoryHost(t),wire=boundDwsFixture(),app={config:{resident:{taskSessions:{ingressEpoch:'2026-01-02T03:04:05.000Z'}}},runtime:{},tasks:{isOwnNotification:()=>false}}
 let opened=0,closed=0
 await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('lifecycle-single'),{runner:wire.runner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:f.root},observeLogin:async()=>{opened++;return async()=>{closed++}}})})
 const ready=()=>f.host.ctx.parallel('night/ready',app)
 await ready();await ready();await Promise.all([ready(),ready(),ready()]);assert.equal(opened,1)
 await f.host.ctx.parallel('night/stopping');assert.equal(closed,1)
 await ready();assert.equal(opened,1);await f.close();assert.equal(closed,1);assert.equal(f.requests.length,0)
})

test('DWS lifecycle stop joins in-flight observer creation and its exact asynchronous close tail',async t=>{
 const creating=Promise.withResolvers(),createRelease=Promise.withResolvers(),closing=Promise.withResolvers(),closeRelease=Promise.withResolvers()
 t.after(()=>{createRelease.resolve();closeRelease.resolve()})
 const f=await memoryHost(t),wire=boundDwsFixture(),app={config:{resident:{taskSessions:{ingressEpoch:'2026-01-02T03:04:05.000Z'}}},runtime:{},tasks:{isOwnNotification:()=>false}}
 let opened=0,closed=0,stopSettled=false
 await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,pluginConfig('lifecycle-inflight'),{runner:wire.runner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:f.root},observeLogin:async()=>{opened++;creating.resolve();await createRelease.promise;return async()=>{closed++;closing.resolve();await closeRelease.promise}}})})
 const ready=f.host.ctx.parallel('night/ready',app)
 await Promise.race([creating.promise,ready.then(()=>assert.fail('ready settled before observer creation'))])
 const stopping=f.host.ctx.parallel('night/stopping').finally(()=>{stopSettled=true})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(stopSettled,false);assert.equal(closed,0)
 createRelease.resolve();await Promise.race([closing.promise,stopping.then(()=>assert.fail('stop settled before closing its observer'))])
 assert.equal(stopSettled,false);assert.equal(opened,1);assert.equal(closed,1)
 closeRelease.resolve();await Promise.all([ready,stopping]);assert.equal(stopSettled,true)
 await f.host.ctx.parallel('night/ready',app);assert.equal(opened,1);await f.close();assert.equal(closed,1);assert.equal(f.requests.length,0)
})

test('Web新增钉钉复用真实Host配置事务，鉴权拒绝无写、四目标映射与未知结果只读回查', {timeout:nativeTestTimeout(30000)}, async t=>{
 const profileWire=boundDwsFixture();let profileResponse,profileFailure,profileLookups=0
 const dingtalkProfileRunner={async run(args){profileLookups++;assert.deepEqual(args,['profile','list','--format','json']);if(profileFailure)throw profileFailure;return profileResponse??profileWire.runner.run(args)}}
 const f=await memoryHost(t,undefined,{dingtalkProfileRunner}),paths=f.host.ctx.runtimePaths,file=join(paths.config,'config.json'),port=f.host.ctx.get('channelConfiguration')
 const existing={type:'fixture-channel',channelId:'existing-disabled',enabled:false,config:{privateValue:'PRIVATE_CONFIG_DO_NOT_EXPOSE'}}
 f.config.channelPlugins=[existing]
 await writeFile(file,JSON.stringify(f.config))
 const body={channelId:'web-room-id',conversationType:'chat-room',targetKind:'id',target:'fixture-room',name:'隔离群聊',prompt:'只核对本次隔离证据'}
 let saves=0,unknownAfterCommit=false
 const web=await createWebConsole({channels:f.host.ctx.channels,paths,config:{channelId:'web-create-test',senderId:'fixture-operator',port:0},
  getApplication:()=>({config:f.config}),getChannelConfiguration:()=>({read:()=>port.read(),async addDingtalk(input){
   saves++;const result=await port.addDingtalk(input)
   if(unknownAfterCommit)throw Error('PRIVATE_POST_COMMIT_FAILURE')
   return result
  }}),
 })
 let cookie,csrf
 const api=async(path,{method='GET',body,headers={}}={})=>{
  const response=await fetch(web.origin+path,{method,headers:{origin:web.origin,...cookie?{cookie}:{},...csrf?{'x-csrf-token':csrf}:{},...body!==undefined?{'content-type':'application/json'}:{},...headers},...body!==undefined?{body:JSON.stringify(body)}:{}})
  return {status:response.status,body:await response.json(),headers:response.headers}
 }
 try{
  assert.equal((await api('/api/channels/dingtalk',{method:'POST',body})).status,401)
  const login=await api('/api/login',{method:'POST',body:{token:(await readFile(web.credentialPath,'utf8')).trim()}})
  cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrfToken
  assert.equal(profileLookups,0,'Host startup and unauthenticated requests never probe DWS')
  assert.equal((await api('/api/channels')).status,200);assert.equal(profileLookups,0,'GET never probes the vendor')
  assert.equal((await api('/api/channels/dingtalk',{method:'POST',body,headers:{'x-csrf-token':''}})).status,403)
  assert.equal((await api('/api/channels/dingtalk',{method:'POST',body,headers:{origin:'http://foreign.invalid'}})).status,403)
  for(const extra of [{profile:'browser-account'},{env:{DWS_PROFILE:'browser-account'}},{binding:{}},{dingtalk_binding:{}},{enabled:false},{dingtalk_writes_authorized:true},{executable:'untrusted'},{accountMode:'private'},{configFile:'/untrusted'}]){
   const result=await api('/api/channels/dingtalk',{method:'POST',body:{...body,...extra}})
   assert.equal(result.status,400);assert.equal(result.body.error,'REQUEST_INVALID')
  }
  assert.equal(profileLookups,0,'forbidden browser profile/env fields are rejected before querying DWS')
  for(const extra of [{targetKind:'any'},{conversationType:'group'},{target:''},{name:null},{prompt:12},{writesAuthorized:'true'},{writesAuthorized:null},{writesAuthorized:1}]){
   assert.equal((await api('/api/channels/dingtalk',{method:'POST',body:{...body,...extra}})).status,400)
  }
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),f.config)
  await assert.rejects(access(dingtalkChannelPaths(paths,body.channelId).ingressFile),{code:'ENOENT'})
  const current=profileWire.profile,otherOrg={...current,profile:'other-corp:other-user',corpId:'other-corp',userId:'other-user',isCurrent:false}
  const responseFor=profiles=>({exitCode:0,stdout:JSON.stringify({success:true,profiles}),stderr:''})
  const failures=[
   [responseFor([]),undefined,409,'DINGTALK_AUTH_REQUIRED'],
   [responseFor([{...current,isCurrent:false}]),undefined,409,'DINGTALK_CURRENT_PROFILE_NOT_FOUND'],
   [responseFor([current,{...otherOrg,isCurrent:true}]),undefined,409,'DINGTALK_CURRENT_PROFILE_AMBIGUOUS'],
   [responseFor([{...current,isOrgCurrent:false}]),undefined,409,'DINGTALK_CURRENT_PROFILE_NOT_FOUND'],
   [responseFor([current,{...current,profile:'fixture-corp:another-user',userId:'another-user',isCurrent:false}]),undefined,409,'DINGTALK_CURRENT_PROFILE_AMBIGUOUS'],
   [{exitCode:0,stdout:'{"success":true,"profiles":{}}'},undefined,502,'DINGTALK_PROFILE_RESPONSE_INVALID'],
   [{exitCode:0,stdout:'invalid-json'},undefined,502,'DINGTALK_QUERY_INVALID_JSON'],
   [{exitCode:0,stdout:'{"success":false}'},undefined,502,'DINGTALK_QUERY_INCOMPLETE'],
   [{exitCode:1,stdout:''},undefined,502,'DINGTALK_QUERY_FAILED'],
   [{exitCode:2,stdout:''},undefined,409,'DINGTALK_AUTH_REQUIRED'],
   [undefined,Object.assign(Error('PRIVATE_MISSING_COMMAND'),{code:'ENOENT'}),503,'DINGTALK_CLI_UNAVAILABLE'],
   [undefined,Error('PRIVATE_LOOKUP_TIMEOUT'),503,'DINGTALK_PROFILE_LOOKUP_FAILED'],
  ]
  for(const [response,failure,status,code]of failures){
   profileResponse=response;profileFailure=failure
   const result=await api('/api/channels/dingtalk',{method:'POST',body})
   assert.equal(result.status,status,JSON.stringify(result.body));assert.equal(result.body.error,code)
   assert.deepEqual(JSON.parse(await readFile(file,'utf8')),f.config)
   await assert.rejects(access(dingtalkChannelPaths(paths,body.channelId).ingressFile),{code:'ENOENT'})
   assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_|fixture-corp|fixture-user/)
  }
  profileFailure=undefined;profileResponse=responseFor([otherOrg,current])
  assert.equal((await api('/api/session')).status,200,'vendor authentication failures must not revoke Web login')
  await f.agent('channel-config-model')
  await assert.rejects(async()=>f.host.ctx.agents.withInitiator(f.host.ctx.agents.get('channel-config-model'),()=>port.addDingtalk(body)),{code:'CHANNEL_CONFIGURATION_OPERATOR_REQUIRED'})
  const liveConflict=await api('/api/channels/dingtalk',{method:'POST',body:{...body,channelId:'web-create-test'}})
  assert.equal(liveConflict.status,409,'a currently registered adapter ID cannot be shadowed by saved configuration')
  const prior='2026-01-02T03:04:05.000Z',preexistingIngress=await openDingtalkIngress(paths,'web-chat-name',{fromAt:prior})
  await preexistingIngress.drain()
  const requests=[body,{...body,channelId:'web-room-name',targetKind:'name',target:'Fixture Room',writesAuthorized:true},
   {...body,channelId:'web-chat-id',conversationType:'chat',target:'fixture-peer',writesAuthorized:true},
   {...body,channelId:'web-chat-name',conversationType:'chat',targetKind:'name',target:'Fixture Peer'}]
  const before=new Date().toISOString()
  const created=await Promise.all(requests.map(body=>api('/api/channels/dingtalk',{method:'POST',body})))
  const after=new Date().toISOString()
  for(const [index,result] of created.entries()){
   assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.ok,true);assert.equal(result.body.changed,true)
   assert.equal(result.body.restartRequired,true);assert.equal(result.body.liveApplied,false)
   assert.equal(result.body.channel.connectionState,'pending-restart');assert.equal(result.body.channel.connected,false)
   assert.equal(result.body.channel.writesAuthorized,requests[index].writesAuthorized===true)
   assert.doesNotMatch(JSON.stringify(result.body),/fixture-corp|fixture-user|fixture-room|fixture-peer|dingtalk_|PRIVATE_/)
  }
  const saved=await loadConfig(file)
  assert.deepEqual(saved.channelPlugins[0],existing)
  assert.deepEqual(f.config.channelPlugins,[existing],'saving must not mutate the running application configuration')
  for(const request of requests){
   const row=saved.channelPlugins.find(row=>row.channelId===request.channelId),target='dingtalk_'+(request.conversationType==='chat-room'?'group':'user')+'_'+request.targetKind
   assert.deepEqual(row,{type:'dingtalk-dws',channelId:request.channelId,enabled:true,config:{dingtalk_profile:profileWire.profile.profile,dingtalk_conversation_type:request.conversationType,[target]:request.target,dingtalk_account_mode:'system',dingtalk_writes_authorized:request.writesAuthorized===true,dingtalk_listen:true,dingtalk_name:request.name,dingtalk_prompt:request.prompt}})
   const ingress=JSON.parse(await readFile(dingtalkChannelPaths(paths,request.channelId).ingressFile,'utf8'))
   assert.equal(ingress.paused,true)
   if(request.channelId==='web-chat-name')assert.equal(ingress.firstStartedAt,prior)
   else assert.ok(ingress.firstStartedAt>=before&&ingress.firstStartedAt<=after)
   assert.equal(ingress.recoveryFromAt,ingress.firstStartedAt)
   assert.equal(f.host.ctx.channels.plugins.has(request.channelId),false,'no live plugin mounting is permitted')
   await assert.rejects(access(dingtalkChannelPaths(paths,request.channelId).bindingFile),{code:'ENOENT'})
  }
  const stable=await readFile(file,'utf8'),firstIngress=await readFile(dingtalkChannelPaths(paths,body.channelId).ingressFile,'utf8'),lookupCount=profileLookups
  assert.equal((await api('/api/channels/dingtalk',{method:'POST',body:{...body,target:'must-not-replace'}})).status,409)
  assert.equal((await api('/api/channels/dingtalk',{method:'POST',body:{...body,channelId:existing.channelId}})).status,409)
  assert.equal(await readFile(file,'utf8'),stable);assert.equal(await readFile(dingtalkChannelPaths(paths,body.channelId).ingressFile,'utf8'),firstIngress)
  assert.equal(profileLookups,lookupCount,'duplicate IDs are rejected before DWS queries')
  const listed=await api('/api/channels')
  for(const result of created)assert.deepEqual(listed.body.items.find(row=>row.channelId===result.body.channel.channelId),result.body.channel)
  assert.doesNotMatch(JSON.stringify(listed.body),/PRIVATE_|fixture-corp|dingtalk_binding|dingtalk_profile/)
  unknownAfterCommit=true
  const uncertainBody={...body,channelId:'web-save-unknown'},uncertain=await api('/api/channels/dingtalk',{method:'POST',body:uncertainBody})
  assert.equal(uncertain.status,500);assert.equal(uncertain.body.error,'WEB_REQUEST_FAILED')
  const calls=saves,recovered=await api('/api/channels')
  assert.equal(saves,calls,'readback cannot replay a save whose response was unknown')
  assert.equal(recovered.body.items.find(row=>row.channelId===uncertainBody.channelId).restartRequired,true)
  assert.ok((await loadConfig(file)).channelPlugins.some(row=>row.channelId===uncertainBody.channelId))
  assert.equal(f.requests.length,0,'configuration cannot invoke the task model')
  await web.close();await f.close()
  const coldConfig=await loadConfig(file),cold=await createHost(coldConfig)
  try{
   for(const request of [...requests,uncertainBody])assert.equal(cold.ctx.channels.plugins.get(request.channelId).health.state,'starting')
   assert.deepEqual((await cold.ctx.get('channelConfiguration').read()).map(row=>row.channelId),coldConfig.channelPlugins.map(row=>row.channelId))
   assert.equal(JSON.parse(await readFile(dingtalkChannelPaths(paths,body.channelId).ingressFile,'utf8')).firstStartedAt,JSON.parse(firstIngress).firstStartedAt)
  }finally{await cold.close()}
  // 冷配置已由默认加载器实际注册；另用原有假 DWS 跑正常启动绑定，不接触真实厂商。
  await f.boot()
  const wire=boundDwsFixture(),row=coldConfig.channelPlugins.find(row=>row.channelId===body.channelId)
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{...validateDingtalkConfig(row.config),enabled:true,channelId:row.channelId},{runner:wire.runner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:f.root}})})
  await f.host.ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:prior}}},runtime:{getGroup:()=>({messages:[],outbox:[]})},tasks:{isOwnNotification:()=>false}})
  await eventually(()=>wire.streams.has('group'),'saved group starts a fake DWS subscription')
  assert.ok(wire.calls.some(args=>args[0]==='profile'))
  assert.equal(f.host.ctx.channels.plugins.get(row.channelId).notifications.canDisclose(),false)
  assert.equal(JSON.parse(await readFile(dingtalkChannelPaths(paths,row.channelId).ingressFile,'utf8')).firstStartedAt,JSON.parse(firstIngress).firstStartedAt)
 }finally{await web.close()}
})

test('Host关闭等待已接纳渠道配置提交且保留安装锁，后续调用拒绝', {timeout:nativeTestTimeout(30000)}, async t=>{
 const profileWire=boundDwsFixture(),f=await memoryHost(t,undefined,{dingtalkProfileRunner:profileWire.runner}),paths=f.host.ctx.runtimePaths,file=join(paths.config,'config.json'),port=f.host.ctx.get('channelConfiguration')
 await writeFile(file,JSON.stringify(f.config))
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),held=withLock(join(paths.config,'.configuration.lock'),async()=>{entered.resolve();await release.promise})
 await entered.promise
 const save=port.addDingtalk({channelId:'close-pending-channel',conversationType:'chat',targetKind:'id',target:'fixture-peer'})
 let closed=false
 const closing=f.close().then(()=>{closed=true})
 try{
  assert.equal(closed,false)
  assert.throws(()=>port.read(),{code:'CHANNEL_CONFIGURATION_UNAVAILABLE'})
  await assert.rejects(acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0}),{code:'NIGHT_DATA_IN_USE'})
 }finally{release.resolve()}
 await Promise.all([held,save,closing])
 assert.equal(closed,true)
 assert.ok((await loadConfig(file)).channelPlugins.some(row=>row.channelId==='close-pending-channel'))
 await assert.rejects(access(join(paths.runtime,'.host.lock')),{code:'ENOENT'})
})

test('profile查询真实超时后等待进程退出，Host关闭期间保留安装锁', {timeout:nativeTestTimeout(30000)}, async t=>{
 const ready=Promise.withResolvers(),termination=Promise.withResolvers(),signals=[]
 const runner=createNodeDwsRunner({executable:process.execPath,runTimeoutMs:1000})
 const nativeSpawn=runner.spawn,nativeRun=runner.run
 let running,pid,queryError,settled=false,closed=false,closing
 runner.spawn=function(args,hooks){
  assert.deepEqual(args,['profile','list','--format','json'])
  running=nativeSpawn.call(this,['-e','process.stdout.write("fixture-pid:"+process.pid+String.fromCharCode(10));setInterval(()=>{},1000)'],{...hooks,onStdoutLine(line){
   if(line.startsWith('fixture-pid:')){pid=Number(line.slice('fixture-pid:'.length));ready.resolve()}
   hooks.onStdoutLine(line)
  }})
  // 真实子进程保持运行；受控包装器延迟实际信号投递，不能把返回true当退出。
  return {...running,terminate(signal){signals.push(signal);termination.resolve();return true}}
 }
 runner.run=async function(args){try{return await nativeRun.call(this,args)}catch(error){queryError=error;throw error}}
 const f=await memoryHost(t,undefined,{dingtalkProfileRunner:runner}),paths=f.host.ctx.runtimePaths,file=join(paths.config,'config.json'),port=f.host.ctx.get('channelConfiguration')
 await writeFile(file,JSON.stringify(f.config));const before=await readFile(file,'utf8')
 const save=port.addDingtalk({channelId:'timeout-profile-channel',conversationType:'chat-room',targetKind:'name',target:'Isolated Fixture'})
 save.then(()=>{settled=true},()=>{settled=true})
 const outcome=save.then(value=>({value}),error=>({error}))
 const prematureExit=outcome.then(({error})=>{throw error??new Error('profile query settled before its live-child assertion')})
 try{
  await Promise.race([ready.promise,prematureExit]);await Promise.race([termination.promise,prematureExit]);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(settled,false,'the timed-out query cannot settle while its actual child is alive')
  assert.equal(process.kill(pid,0),true)
  closing=f.close().then(()=>{closed=true})
  await assert.rejects(acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0}),{code:'NIGHT_DATA_IN_USE'})
  assert.equal(closed,false);assert.equal(process.kill(pid,0),true)
  assert.equal(await readFile(file,'utf8'),before)
  await assert.rejects(access(dingtalkChannelPaths(paths,'timeout-profile-channel').ingressFile),{code:'ENOENT'})
 }finally{
  running?.terminate('SIGKILL')
  await running?.waitForExit()
 }
 const result=await outcome;assert.equal(result.error?.code,'DINGTALK_PROFILE_LOOKUP_FAILED');await closing
 assert.equal(queryError.message,'dws_command_timeout:1000','runner preserves the original timeout after joining')
 assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(settled,true);assert.equal(closed,true)
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'})
 await assert.rejects(access(join(paths.runtime,'.host.lock')),{code:'ENOENT'})
 assert.equal(await readFile(file,'utf8'),before)
 const completed=await createNodeDwsRunner({executable:process.execPath,cwd:f.root}).run(['-e','process.stdout.write("final-line-without-newline")'])
 assert.equal(completed.exitCode,0);assert.equal(completed.stdout,'final-line-without-newline')
 await assert.rejects(createNodeDwsRunner({executable:join(f.root,'missing-dws-executable'),cwd:f.root}).run(['profile','list']),{code:'ENOENT'})
 t.diagnostic('真实PID存活时查询与Host关闭均未结算；实际退出后PID消失、锁释放、配置/水位未写；原超时保留，正常输出与spawn失败均排空。')
})
