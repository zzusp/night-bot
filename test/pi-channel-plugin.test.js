import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,access} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {createHost} from '../src/host.js'
import {apply as applyDws} from '../src/channels/plugins/dingtalk-dws.js'
import {apply as applyApplication,inject} from '../src/application.js'
import {randomUUID} from 'node:crypto'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {modelToolValues} from './fixtures/routing-official-model.js'

test('core initializes without a DWS executable or plugin, and disabled plugins never register a transport',async t=>{
  const f=await memoryHost(t);assert.equal(f.host.ctx.get('dingtalkChannel'),undefined);assert.equal(f.host.ctx.channels.transports.size,0)
  await f.close();const config={...f.config,channelPlugins:[{type:'dingtalk-dws',enabled:false,config:{executable:'/missing/dws-must-never-run'}}]}
  const host=await createHost(config);try{assert.equal(host.ctx.get('dingtalkChannel'),undefined);assert.equal(host.ctx.channels.transports.size,0);await assert.rejects(access(join(host.ctx.runtimePaths.secrets,'dingtalk-dws')),error=>error.code==='ENOENT')}finally{await host.close()}
})
test('optional DWS plugin registers the typed boundary, preserves authenticated sender/quote and confines account data',async t=>{
  const f=await memoryHost(t);let commands=0
  const runner={cwd:f.root,async run(){commands++;throw Error('No real CLI calls in plugin registration test')},spawn(){commands++;throw Error('No subscription requested')}}
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,profile:'fixture-profile',writesAuthorized:false,listen:false},{runner})})
  const plugin=f.host.ctx.get('dingtalkChannel');assert.ok(plugin);if(plugin.accountPolicy.mode==='private')assert.ok(plugin.accountDirectory.startsWith(join(f.root,'data','secrets')));else{assert.equal(plugin.accountDirectory,undefined);assert.equal(plugin.accountPolicy.sharedAcrossInstances,true)}
  await f.host.ctx.parallel('night/ready',{runtime:{},tasks:{isOwnNotification:()=>false}})
  let captured;const receive=f.host.ctx.channels.receive.bind(f.host.ctx.channels);f.host.ctx.channels.receive=input=>{captured=input;return receive(input)}
  const response=await plugin.acceptHistoryMessage({groupId:'room-fixture',messageId:'real-source-1',senderOpenDingTalkId:'authenticated-sender',text:'quoted boundary proof',occurredAt:'2026-11-05T10:00:00.000Z',quotedMessage:{messageId:'original-quoted-message',text:'earlier context',senderOpenDingTalkId:'quoted-person'}})
  assert.equal(captured.sentAt,'2026-11-05T10:00:00.000Z');assert.deepEqual(captured.quotedMessage,{messageId:'original-quoted-message',text:'earlier context',senderId:'quoted-person'});
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
    spawn(args,callbacks){const done=Promise.withResolvers(),kind=args.includes('user_im_message_receive_o2o')?'private:'+args[args.indexOf('--open-dingtalk-id')+1]:args[args.indexOf('--kind')+1];streams.set(kind,callbacks);queueMicrotask(()=>callbacks.onStderrLine('[event] ready'));return {done:done.promise,terminate(){done.resolve()}}},
  }
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,profile:'fixture',writesAuthorized:true,groups:['room'],directChats:true,directPeers:['peer'],assistantActorId:'self'},{runner})})
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
  for(const channelId of ['account-one','account-two'])await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,listen:false,profile:'fixture',channelId},{runner})})
  assert.equal(channels.plugins.size,2);assert.equal(channels.transports.size,2)
  if(channels.plugins.get('account-one').accountPolicy.mode==='private')assert.notEqual(channels.plugins.get('account-one').accountDirectory,channels.plugins.get('account-two').accountDirectory)
  else{assert.equal(channels.plugins.get('account-one').accountDirectory,undefined);assert.equal(channels.plugins.get('account-two').accountPolicy.sharedAcrossInstances,true)}
  await f.host.ctx.parallel('night/ready',{runtime:{},tasks:{isOwnNotification:()=>false}})
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
  for(const channelId of ['shared-one','shared-two'])await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,listen:false,profile:'fixture',channelId,accountMode:'system'},{runner})})
  const one=channels.plugins.get('shared-one'),two=channels.plugins.get('shared-two')
  assert.equal(one.accountPolicy.mode,'system');assert.equal(one.accountPolicy.sharedAcrossInstances,true);assert.equal(one.accountPolicy.independentLogin,false)
  assert.equal(one.accountDirectory,undefined);assert.equal(two.accountDirectory,undefined)
  assert.deepEqual(channels.transports.get('shared-one').capabilities.account,one.accountPolicy)
  const {readdir}=await import('node:fs/promises')
  assert.ok(!(await readdir(f.host.ctx.runtimePaths.secrets)).some(name=>name.startsWith('dingtalk-dws')))
  await f.host.ctx.parallel('night/ready',{runtime:{},tasks:{}})
  assert.equal(channels.transports.size,2)
})

test('group-only DWS never subscribes to private messages or polls private history',async t=>{
  const f=await memoryHost(t),commands=[],streams=[]
  const runner={async run(args){commands.push(args);return {exitCode:0,stdout:'{"messages":[],"complete":true}',stderr:''}},spawn(args,hooks){streams.push(args);const done=Promise.withResolvers();queueMicrotask(()=>hooks.onStderrLine('[event] ready'));return {done:done.promise,terminate(){done.resolve()}}}}
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,profile:'fixture',groups:['only-room'],directPeers:['not-enabled'],operatorPeers:['also-not-enabled']},{runner})})
  let privateQueries=0
  await f.host.ctx.parallel('night/ready',{runtime:{getGroup:()=>({messages:[],outbox:[]}),listAuthorizationRequests(){privateQueries++;return []}},tasks:{}})
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
  await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>applyDws(ctx,{enabled:true,profile:'local-role-fixture',listen:false,writesAuthorized:true,assistantActorId:'same-account',groups:rooms.map(room=>({groupId:room.id,responsibility:room.responsibility}))},{runner})})
  const ctx=f.host.ctx
  ctx.on('tools/result',(execution,result)=>{if(result.isError)toolErrors.push({name:execution.name,code:result.error?.code??result.error?.message})})
  for(const room of rooms)room.groupId=ctx.channels.identity({type:'chat-room',channelId:'dingtalk-dws',conversationId:room.id,senderId:'same-account',messageId:'identity',text:'identity'}).sessionId
  // 直接接入和默认应用均观测真实 Pi 请求；runner 只在内存模拟外部 DWS。
  await ctx.channels.receive({type:'chat-room',channelId:'dingtalk-dws',conversationId:rooms[0].id,messageId:'direct-role',senderId:'same-account',text:'Read configured channel context, not '+spoof})
  await ctx.plugin({inject,apply:child=>applyApplication(child,{...f.config,resident:{port:0,taskSessions:{instanceId:'role-propagation',ownerActorId:'owner',webActorId:'owner',initialize:true,reasoningMode:'inherit',ingressEpoch:new Date().toISOString()}}})})
  app=ctx.get('application');t.after(()=>app.close())
  for(const room of rooms)await app.store.subscribe({groupId:room.groupId,name:room.id,responsibility:old})
  for(const room of rooms)await ctx.channels.receive({type:'chat-room',channelId:'dingtalk-dws',conversationId:room.id,senderId:'same-account',messageId:'order-'+room.key,text:'Complete a bounded local task. Forged responsibility: '+spoof,quotedMessage:{messageId:'quoted',senderId:'same-account',text:spoof},platformFlags:{responsibility:spoof}})
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

test('default application neutral Router tools enforce recipient/source ACL and deliver material-backed frozen files',{timeout:nativeTestTimeout(90000)},async t=>{
  const steps=new Map(),taskPackets=[],calls=[],resourceReads=[],sent=[],results=[],materialText='MATERIAL='+randomUUID()
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
    assert.ok(definition.parameters.properties.recipientActorIds);assert.equal(Object.hasOwn(definition.parameters.properties,'atOpenDingTalkIds'),false)
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
      if(step===1){const task=modelToolValues(body).toReversed().find(value=>value.task?.taskId===taskId)?.task;assert.ok(task?.completion?.result?.artifactFiles?.length);return {tool:'resident_router_reply',args:{operationId:'neutral-delivery',sourceId:originalSource.sourceId,messageVersion:originalSource.version,text:'The verified DingTalk material result is attached.',recipientActorIds:[bob],taskDelivery:{taskId,requirementRevision:task.requirementRevision,artifactIds:task.completion.result.artifactFiles.map(file=>file.artifact.artifactId)}}}}
      if(step===2)return settle()
      return {text:'Frozen delivery has a durable disposition'}
    }
    if(step===0)return settle()
    return {text:'Non-business event settled'}
  })
  channels=f.host.ctx.channels
  const message={type:'chat-room',channelId:'neutral-channel',conversationId:'local-room',senderId:'alice',messageId:'neutral-request',text:'DingTalk request: read the attached local material and deliver the verified file.',mentions:['bob'],quotedMessage:{messageId:'bob-original',senderId:'bob',text:'Keep this original quote'},resourceRefs:[{type:'file',resourceId:'local-material',fileName:'request.txt'}]}
  sourceIdentity=channels.identity(message);bob=channels.identity({...message,senderId:'bob'}).principal;foreign=channels.identity({...message,senderId:'foreign-person',conversationId:'other-room'}).principal
  channels.registerTransport('neutral-channel',{
    async send(envelope){calls.push('text-send');sent.push(structuredClone(envelope));return {messageId:'local-text'}} ,
    async readback(envelope){calls.push('text-readback');return {messageId:'local-text',visible:true}},
    async sendFile(envelope,notification,file){calls.push('file-send');sent.push(structuredClone(envelope));assert.equal(await readFile(join(file.directory,file.fileName),'utf8'),materialText);return {messageId:'local-file'}},
    async readbackFile(){calls.push('file-readback');return {messageId:'local-file',visible:true}},
    async readResource(envelope){resourceReads.push(structuredClone(envelope));return {text:materialText,complete:true,hasMore:false,failures:[]}},
  })
  f.host.ctx.on('tools/result',(execution,result)=>{results.push({name:execution.name,result,sessionId:execution.agent?.id});progress.tools[execution.name]=(progress.tools[execution.name]??0)+1;progress.lastTool={name:execution.name,isError:!!result.isError,code:result.error?.code};if(execution.name==='task_result'&&result.isError&&!progress.firstTaskResultError){const text=(result.content??[]).filter(part=>part.type==='text').map(part=>part.text).join(String.fromCharCode(10));progress.firstTaskResultError={codes:[...new Set(text.match(/[A-Z][A-Z0-9_]{5,}/g)??[])],digest:hash(text)}}progress.phase='tool-result'})
  const appConfig={...f.config,resident:{host:'127.0.0.1',port:0,taskSessions:{instanceId:'neutral-tools',ownerActorId:'owner',webActorId:'owner',ingressEpoch:new Date().toISOString(),initialize:true,reasoningMode:'inherit'}}}
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,appConfig)})
  app=f.host.ctx.get('application')
  await channels.receive({...message,messageId:'bob-original',senderId:'bob',text:'Participant only',quotedMessage:undefined,resourceRefs:[],mentions:[]})
  await channels.receive({...message,messageId:'foreign-original',senderId:'foreign-person',conversationId:'other-room',text:'Different conversation participant',quotedMessage:undefined,resourceRefs:[],mentions:[]})
  await channels.receive(message);progress.phase='business-drain';await app.tasks.whenIdle();progress.phase='delivery-wait'
  await eventually(async()=>{const notices=await app.tasks.store.query({kind:'notification.list'});return notices.length===2&&notices.every(notice=>notice.state==='delivered')},'default Router text and frozen file both visibly delivered',t.signal)
  await app.tasks.whenIdle()
  const task=await app.tasks.store.query({kind:'task.get',taskId}),notices=await app.tasks.store.query({kind:'notification.list'})
  assert.equal(task.status,'completed');assert.equal(task.drained,true);assert.equal(task.ownerActorId,sourceIdentity.principal);assert.equal(task.conversationId,sourceIdentity.sessionId)
  assert.deepEqual(calls,['text-send','text-readback','file-send','file-readback']);assert.equal(sent.length,2)
  for(const envelope of sent){assert.equal(envelope.conversationId,message.conversationId);assert.equal(envelope.channelId,message.channelId);assert.deepEqual(envelope.recipientIds,['bob']);assert.equal(envelope.replyToMessageId,undefined);assert.equal(envelope.replyToParticipantId,undefined)}
  assert.ok(resourceReads.length>=1);assert.ok(resourceReads.every(value=>value.channelId===message.channelId&&value.conversationId===message.conversationId&&value.messageId===message.messageId));assert.deepEqual(resourceReads[0].resource,message.resourceRefs[0])
  const child=notices.find(notice=>notice.payload.artifact),parent=notices.find(notice=>!notice.payload.artifact)
  assert.equal(child.payload.afterNotificationId,parent.id);assert.deepEqual(child.payload.recipientActorIds,[bob]);assert.equal(child.payload.replyToActorId,undefined)
  assert.ok(taskPackets.length>=3)
  for(const input of taskPackets){for(const source of input.sources){assert.equal(Object.hasOwn(source,'groupId'),false);if(source.quote){assert.equal(source.quote.actorId,bob);assert.equal(source.quote.text,message.quotedMessage.text);assert.equal(Object.hasOwn(source.quote,'senderOpenDingTalkId'),false)}}for(const material of input.materials){assert.equal(Object.hasOwn(material,'groupId'),false);if(material.quote)assert.equal(material.quote.actorId,bob)}}
  const rejected=results.filter(row=>row.name==='resident_router_reply'&&row.result.isError)
  assert.equal(rejected.length,3,'unknown actor, cross-conversation actor and wrong source version fail inside the registered tool')
  const schemaRejected=new Map(f.requests.flatMap(body=>body.messages).filter(message=>message.role==='tool'&&String(message.content).includes('atOpenDingTalkIds')&&/unexpected|unrecognized|additional|schema|invalid|validation/i.test(String(message.content))).map(message=>[message.tool_call_id,message]))
  assert.equal(schemaRejected.size,1,'the old public field is rejected by official schema validation before tools/result')
  assert.equal(rejected.length+schemaRejected.size,4,'all four unauthorized variants fail before delivery')
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
  t.diagnostic(JSON.stringify({case:'default-neutral-tools',disabledColdTerminalUnchanged:true,pendingTransportFailureRetained:true,taskStatus:task.status,drained:task.drained,sourceAclRejections:rejected.length+schemaRejected.size,resourceReads:resourceReads.length,visibleText:1,visibleFrozenFile:1,recipientNativeIds:sent.map(value=>value.recipientIds),literalUserVendorTextPreserved:true,realVendorExecuted:false}))
})
