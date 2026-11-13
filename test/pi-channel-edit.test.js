import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
import {dingtalkChannelPaths} from '../src/channels/plugins/dingtalk-storage.js'

const channelId='edit-room'
const binding={version:1,profile:'edit-corp:edit-user',corpId:'edit-corp',userId:'edit-user',actorId:'edit-self',conversationType:'chat-room',conversationId:'old-room'}
const row=()=>({type:'dingtalk-dws',channelId,enabled:true,config:{dingtalk_profile:binding.profile,dingtalk_conversation_type:'chat-room',dingtalk_group_id:'old-room',dingtalk_name:'原渠道',dingtalk_prompt:'第一行\n第二行',dingtalk_account_mode:'system',dingtalk_writes_authorized:true,dingtalk_listen:false}})
const draft=detail=>({expectedVersion:detail.version,name:detail.name,prompt:detail.prompt,conversationType:detail.conversationType,targetKind:detail.targetKind,target:detail.target})
const put=async(file,value)=>{await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value)+'\n')}

// 使用真实 Host 配置锁、受控文件和 HTTP 认证；只有厂商 IO 被替换。
test('Web编辑白名单、CAS与unknown回查不改原账号、绑定、水位和deferred',{timeout:nativeTestTimeout(30000)},async t=>{
 let vendorCalls=0
 const f=await memoryHost(t,undefined,{dingtalkProfileRunner:{async run(){vendorCalls++;throw Error('Metadata must not query DWS')}}})
 const paths=f.host.ctx.runtimePaths,file=join(paths.config,'config.json'),port=f.host.ctx.get('channelConfiguration')
 const original=row(),other={type:'untouched',channelId:'other-disabled',enabled:false,config:{private:'PRIVATE_UNRELATED'}}
 f.config.channelPlugins=[original,other]
 await writeFile(file,JSON.stringify(f.config))
 const storage=dingtalkChannelPaths(paths,channelId)
 const ingress={paused:false,firstStartedAt:'2026-01-01T00:00:00.000Z',recoveryFromAt:'2026-01-02T00:00:00.000Z',backfillThroughAt:'2026-01-03T00:00:00.000Z',consumedAt:'2026-01-03T00:00:00.000Z',consumedMessageId:'consumed-old',deferredMessages:[{messageId:'deferred-old',occurredAt:'2026-01-02T10:00:00.000Z'}]}
 await put(storage.bindingFile,binding);await put(storage.ingressFile,ingress)
 const bindingBytes=await readFile(storage.bindingFile,'utf8'),ingressBytes=await readFile(storage.ingressFile,'utf8')
 let edits=0,loseResponse=false
 const web=await createWebConsole({channels:f.host.ctx.channels,paths,config:{channelId:'edit-web',senderId:'edit-operator',port:0},getApplication:()=>({config:f.config}),getChannelConfiguration:()=>({read:()=>port.read(),getDingtalk:id=>port.getDingtalk(id),async editDingtalk(id,input){edits++;const result=await port.editDingtalk(id,input);if(loseResponse)throw Error('PRIVATE_EDIT_POST_COMMIT');return result}})})
 let cookie,csrf
 const api=async(path,{method='GET',body,headers={}}={})=>{
  const response=await fetch(web.origin+path,{method,headers:{origin:web.origin,...cookie?{cookie}:{},...csrf?{'x-csrf-token':csrf}:{},...body!==undefined?{'content-type':'application/json'}:{},...headers},...body!==undefined?{body:JSON.stringify(body)}:{}})
  return {status:response.status,body:await response.json(),headers:response.headers}
 }
 const url='/api/channels/dingtalk/'+encodeURIComponent(channelId)
 try{
  assert.equal((await api(url)).status,401)
  const login=await api('/api/login',{method:'POST',body:{token:(await readFile(web.credentialPath,'utf8')).trim()}})
  cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrfToken
  const loaded=await api(url);assert.equal(loaded.status,200)
  const first=loaded.body
  assert.deepEqual(Object.keys(first).sort(),['channelId','version','name','prompt','conversationType','targetKind','target','writesAuthorized'].sort())
  assert.match(first.version,/^[a-f0-9]{64}$/);assert.equal(first.target,'old-room');assert.equal(first.prompt,'第一行\n第二行')
  assert.equal((await api(url,{method:'PATCH',body:draft(first),headers:{'x-csrf-token':''}})).status,403)
  for(const forbidden of [{profile:'foreign-account'},{channelId:'replacement'},{binding:{}},{writesAuthorized:'true'},{writesAuthorized:null},{writesAuthorized:1},{dingtalk_writes_authorized:true},{enabled:false}]){
   assert.equal((await api(url,{method:'PATCH',body:{...draft(first),...forbidden}})).status,400)
  }
  const same=await api(url,{method:'PATCH',body:draft(first)})
  assert.equal(same.status,200);assert.equal(same.body.changed,false);assert.equal(same.body.detail.version,first.version)
  const changed=await api(url,{method:'PATCH',body:{...draft(first),name:'  新名称  ',prompt:'新职责\n  保留缩进'}})
  assert.equal(changed.status,200);assert.equal(changed.body.changed,true);assert.equal(changed.body.restartRequired,true);assert.equal(changed.body.liveApplied,false)
  assert.equal(changed.body.detail.name,'新名称');assert.equal(changed.body.detail.prompt,'新职责\n  保留缩进')
  assert.equal(changed.body.channel.savedVersion,changed.body.detail.version);assert.equal(changed.body.channel.runningVersion,first.version)
  assert.equal(changed.body.channel.connectionState,'pending-restart')
  assert.deepEqual((await api(url)).body,changed.body.detail)
  const stable=await readFile(file,'utf8')
  const stale=await api(url,{method:'PATCH',body:{...draft(first),name:'旧版本不能覆盖'}})
  assert.equal(stale.status,409);assert.equal(stale.body.error,'DINGTALK_CHANNEL_VERSION_CONFLICT');assert.equal(await readFile(file,'utf8'),stable)
  loseResponse=true
  const unknown=await api(url,{method:'PATCH',body:{...draft(changed.body.detail),name:''}})
  assert.equal(unknown.status,500);assert.equal(unknown.body.error,'WEB_REQUEST_FAILED')
  const count=edits,readback=await api(url)
  assert.equal(edits,count);assert.equal(readback.status,200);assert.equal(readback.body.name,'');assert.notEqual(readback.body.version,changed.body.detail.version)
  const saved=JSON.parse(await readFile(file,'utf8'))
  assert.deepEqual(saved.channelPlugins[1],other)
  assert.equal(saved.channelPlugins[0].config.dingtalk_profile,binding.profile);assert.equal(saved.channelPlugins[0].config.dingtalk_writes_authorized,true)
  assert.equal(saved.channelPlugins[0].config.dingtalk_listen,false)
  assert.equal(await readFile(storage.bindingFile,'utf8'),bindingBytes);assert.equal(await readFile(storage.ingressFile,'utf8'),ingressBytes)
  loseResponse=false
  for(const writesAuthorized of [false,true]){
   const current=(await api(url)).body
   const updated=await api(url,{method:'PATCH',body:{...draft(current),writesAuthorized}})
   assert.equal(updated.status,200);assert.equal(updated.body.detail.writesAuthorized,writesAuthorized)
   assert.equal(updated.body.channel.writesAuthorized,writesAuthorized);assert.equal(updated.body.restartRequired,true)
   assert.equal(JSON.parse(await readFile(file,'utf8')).channelPlugins[0].config.dingtalk_writes_authorized,writesAuthorized)
   assert.equal(f.config.channelPlugins[0].config.dingtalk_writes_authorized,true,'saving cannot change the running snapshot')
  }
  const current=(await api(url)).body,stableAuthorization=await readFile(file,'utf8')
  assert.equal((await api(url,{method:'PATCH',body:{...draft(current),target:'new-room',writesAuthorized:true}})).status,400)
  assert.equal(await readFile(file,'utf8'),stableAuthorization)
  await f.agent('channel-authorization-model')
  await assert.rejects(async()=>f.host.ctx.agents.withInitiator(f.host.ctx.agents.get('channel-authorization-model'),()=>port.editDingtalk(channelId,{...draft(current),writesAuthorized:true})),{code:'CHANNEL_CONFIGURATION_OPERATOR_REQUIRED'})
  assert.equal(await readFile(storage.bindingFile,'utf8'),bindingBytes);assert.equal(await readFile(storage.ingressFile,'utf8'),ingressBytes)
  assert.equal(vendorCalls,0);assert.equal(f.requests.length,0)
  assert.equal((await api('/api/channels/dingtalk/missing')).status,404)
  assert.doesNotMatch(JSON.stringify((await api('/api/channels')).body),/edit-corp|edit-user|old-room|PRIVATE_UNRELATED|dingtalk_binding|dingtalk_profile/)
 }finally{await web.close()}
})

function editVendor(){
 const calls=[]
 return {calls,runner:{async run(args){
  calls.push([...args]);const flag=name=>args[args.indexOf(name)+1];let value
  if(args[0]==='profile')value={success:true,profiles:[{profile:binding.profile,corpId:binding.corpId,userId:binding.userId,userName:'Fixture Self',isOrgCurrent:true},{profile:'foreign:current',corpId:'foreign',userId:'current',isCurrent:true,isOrgCurrent:true}]}
  else if(args.includes('get-self'))value={result:[{orgEmployeeModel:{corpId:binding.corpId,userId:binding.userId,orgUserName:'Fixture Self'}}]}
  else if(args.includes('+search-user'))value={ok:true,outcome:'success',data:{count:1,users:[{userId:flag('--query')==='Fixture Self'?binding.userId:'peer-user',openDingTalkId:flag('--query')==='Fixture Self'?binding.actorId:'peer-open'}]}}
  else if(args[0]==='contact'&&args.includes('get'))value={result:[{orgEmployeeModel:{corpId:binding.corpId,userId:flag('--ids'),orgUserName:'Fixture Peer'}}]}
  else if(args.includes('+chat-search'))value={complete:true,hasMore:false,count:1,chats:[{openConversationId:flag('--query')==='Old Room'?'old-room':'new-room'}]}
  else if(args.includes('conversation-info')&&flag('--group')==='missing-old-target')throw Error('Old invalid target must not be queried')
  else if(args.includes('conversation-info'))value={success:true,result:{conversationInfo:{openConversationId:args.includes('--group')?flag('--group'):'direct-room',singleChat:!args.includes('--group')}}}
  else throw Error('Unexpected vendor call '+args.slice(0,2).join(' '))
  return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
 },spawn(){throw Error('No real or fake subscription requested')}}}
}
const scopeInput=(conversationId='old-room')=>({type:'chat-room',channelId,conversationId,senderId:'old-sender',messageId:'scope-only',text:'Scope fixture only'})
async function mountEditApp(f,rows){
 const {apply,inject}=await import('../src/application.js')
 await f.host.ctx.plugin({inject,apply:ctx=>apply(ctx,{...f.config,channelPlugins:rows,resident:{port:0,taskSessions:{instanceId:'edit-app',ownerActorId:'owner',webActorId:'owner',initialize:true,reasoningMode:'inherit',ingressEpoch:'2026-01-01T00:00:00.000Z'}}})})
 return f.host.ctx.get('application')
}
async function mountEditPlugin(f,saved,vendor){
 const {apply}=await import('../src/channels/plugins/dingtalk-dws.js'),{validateConfig}=await import('../src/channels/plugins/dingtalk-config.js')
 await f.host.ctx.plugin({inject:['channels','runtimePaths'],apply:ctx=>apply(ctx,{...validateConfig(saved.config),channelId:saved.channelId,enabled:saved.enabled},{runner:vendor.runner,environment:{USERPROFILE:f.root,HOME:f.root,DWS_CONFIG_DIR:f.root},observeLogin:async()=>async()=>{}})})
}

test('外发授权保存不热改，冷启动后按保存值控制实际transport且不发送消息',{timeout:nativeTestTimeout(45000)},async t=>{
 const vendor=editVendor(),f=await memoryHost(t,undefined,{dingtalkProfileRunner:vendor.runner})
 const file=join(f.host.ctx.runtimePaths.config,'config.json'),original=row()
 await put(file,{...f.config,channelPlugins:[original]})
 await put(dingtalkChannelPaths(f.host.ctx.runtimePaths,channelId).bindingFile,binding)
 for(const writesAuthorized of [false,true]){
  const port=f.host.ctx.get('channelConfiguration'),detail=await port.getDingtalk(channelId)
  const result=await port.editDingtalk(channelId,{...draft(detail),writesAuthorized})
  assert.equal(result.detail.writesAuthorized,writesAuthorized)
  await f.close();await f.boot()
  const saved=JSON.parse(await readFile(file,'utf8')).channelPlugins[0]
  assert.equal((await f.host.ctx.get('channelConfiguration').getDingtalk(channelId)).writesAuthorized,writesAuthorized)
  await mountEditPlugin(f,saved,vendor);await mountEditApp(f,[saved])
  assert.equal(f.host.ctx.channels.transports.get(channelId).canSend(),writesAuthorized)
 }
 assert.equal(f.requests.length,0)
 assert.equal(vendor.calls.some(args=>args.some(arg=>/send/i.test(arg))),false)
})

// 名称表达变化先解析实际身份；同身份保留完整水位，真正换身份拒绝旧 deferred。
test('同实际身份保水位与授权，异身份保存隔离并在冷启重新检查旧依赖',{timeout:nativeTestTimeout(45000)},async t=>{
 const vendor=editVendor(),f=await memoryHost(t,undefined,{dingtalkProfileRunner:vendor.runner})
 const paths=f.host.ctx.runtimePaths,file=join(paths.config,'config.json'),port=f.host.ctx.get('channelConfiguration'),original=row()
 await put(file,{...f.config,channelPlugins:[original]})
 const legacy=dingtalkChannelPaths(paths,channelId),state={paused:true,pausedAt:'2026-01-04T00:00:00.000Z',firstStartedAt:'2026-01-01T00:00:00.000Z',consumedAt:'2026-01-02T00:00:00.000Z',consumedMessageId:'kept',backfillThroughAt:'2026-01-03T00:00:00.000Z',recoveryFromAt:'2026-01-02T00:00:00.000Z',deferredMessages:[{messageId:'deferred',occurredAt:'2026-01-02T00:00:00.000Z'}]}
 await put(legacy.bindingFile,binding);await put(legacy.ingressFile,state)
 const before=await readFile(legacy.ingressFile,'utf8'),bound=await readFile(legacy.bindingFile,'utf8')
 let detail=await port.getDingtalk(channelId)
 const same=await port.editDingtalk(channelId,{...draft(detail),targetKind:'name',target:'Old Room'})
 assert.equal(same.channel.config.dingtalk_storage_key,'legacy');assert.equal(same.channel.config.dingtalk_writes_authorized,true)
 assert.equal(same.detail.targetKind,'name');assert.equal(same.detail.target,'Old Room')
 assert.equal(await readFile(legacy.ingressFile,'utf8'),before);assert.equal(await readFile(legacy.bindingFile,'utf8'),bound)
 assert.ok(vendor.calls.filter(args=>args[0]!=='profile').every(args=>args[args.indexOf('--profile')+1]===binding.profile))
 const app=await mountEditApp(f,[same.channel]),channels=f.host.ctx.channels
 const context=await channels.registerConversation(scopeInput());await app.store.subscribe({groupId:context.sessionId,name:'Old scope',responsibility:'Scope only'})
 detail=same.detail
 await assert.rejects(port.editDingtalk(channelId,{...draft(detail),targetKind:'id',target:'new-room'}),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.equal((await port.getDingtalk(channelId)).version,detail.version)
 const {openDingtalkIngress}=await import('../src/channels/plugins/dingtalk-storage.js')
 const ingress=await openDingtalkIngress(paths,channelId);await ingress.consumed({messageId:'deferred',occurredAt:'2026-01-02T00:00:00.000Z'});await ingress.drain()
 const oldBytes=await readFile(legacy.ingressFile,'utf8')
 const changed=await port.editDingtalk(channelId,{...draft(detail),targetKind:'id',target:'new-room'})
 assert.equal(changed.channel.config.dingtalk_writes_authorized,false);assert.match(changed.channel.config.dingtalk_storage_key,/^[a-f0-9]{64}$/)
 assert.equal(await readFile(legacy.ingressFile,'utf8'),oldBytes);assert.equal(await readFile(legacy.bindingFile,'utf8'),bound)
 const newPaths=dingtalkChannelPaths(paths,channelId,changed.channel.config.dingtalk_storage_key)
 assert.notEqual(newPaths.ingressFile,legacy.ingressFile);assert.equal(newPaths.privateHome,legacy.privateHome)
 const fresh=JSON.parse(await readFile(newPaths.ingressFile,'utf8'));assert.equal(fresh.consumedAt,undefined);assert.equal(fresh.deferredMessages,undefined)
 // 保存成功后才出现旧身份延迟消息；冷启不得把“版本已加载”当作新身份激活。
 const durable=await openDingtalkIngress(paths,channelId);await durable.deferred({messageId:'late-deferred',occurredAt:'2026-01-02T01:00:00.000Z'});await durable.drain()
 await f.close();await f.boot();await mountEditPlugin(f,changed.channel,vendor)
 const cold=await mountEditApp(f,[changed.channel]),plugin=f.host.ctx.channels.plugins.get(channelId)
 assert.equal(plugin.bindingActive,false);assert.equal(plugin.health.state,'error');assert.equal(plugin.health.lastError,'DINGTALK_CHANNEL_SWITCH_BLOCKED')
 const {configuredChannels}=await import('../packages/web-console/server/views.js')
 const view=configuredChannels(cold,f.host.ctx.channels,[changed.channel]).items[0]
 assert.equal(view.restartRequired,false);assert.equal(view.liveApplied,false);assert.equal(view.errorCode,'DINGTALK_CHANNEL_SWITCH_BLOCKED')
 assert.equal((await cold.tasks.store.query({kind:'task.list',archived:'all'})).length,0)
 assert.equal(f.requests.length,0);assert.ok(f.host.ctx.channels.groupContext(context.sessionId))
 // 旧依赖真实结清后再冷启才能激活；原历史仍留在旧scope，不映射到新目标。
 const oldIngress=await openDingtalkIngress(f.host.ctx.runtimePaths,channelId)
 await oldIngress.consumed({messageId:'late-deferred',occurredAt:'2026-01-02T01:00:00.000Z'});await oldIngress.drain()
 await f.close();await f.boot();await mountEditPlugin(f,changed.channel,vendor)
 const active=await mountEditApp(f,[changed.channel]),activePlugin=f.host.ctx.channels.plugins.get(channelId)
 assert.equal(activePlugin.bindingActive,true);assert.equal(activePlugin.health.state,'ready')
 assert.equal(configuredChannels(active,f.host.ctx.channels,[changed.channel]).items[0].liveApplied,true)
 assert.throws(()=>f.host.ctx.channels.assertGroupTarget(context.sessionId),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.doesNotThrow(()=>f.host.ctx.channels.assertInputTarget(scopeInput('new-room')))
 const privateEdit=await f.host.ctx.get('channelConfiguration').editDingtalk(channelId,{...draft(changed.detail),conversationType:'chat',targetKind:'name',target:'Fixture Peer'})
 assert.equal(privateEdit.detail.conversationType,'chat');assert.equal(privateEdit.detail.targetKind,'name');assert.equal(privateEdit.detail.target,'Fixture Peer')
 assert.equal(privateEdit.channel.config.dingtalk_binding.peerId,'peer-open');assert.equal(privateEdit.channel.config.dingtalk_profile,binding.profile)
 assert.equal(privateEdit.channel.config.dingtalk_writes_authorized,false)
 assert.notEqual(privateEdit.channel.config.dingtalk_storage_key,changed.channel.config.dingtalk_storage_key)
 assert.equal(JSON.parse(await readFile(legacy.ingressFile,'utf8')).consumedMessageId,'late-deferred')
 await f.close();await f.boot();await mountEditPlugin(f,privateEdit.channel,vendor)
 const directApp=await mountEditApp(f,[privateEdit.channel]),directPlugin=f.host.ctx.channels.plugins.get(channelId)
 assert.equal(directPlugin.bindingActive,true);assert.equal(configuredChannels(directApp,f.host.ctx.channels,[privateEdit.channel]).items[0].liveApplied,true)
 assert.doesNotThrow(()=>f.host.ctx.channels.assertInputTarget({type:'chat',channelId,conversationId:'direct-room',senderId:'peer-open'}))
 assert.throws(()=>f.host.ctx.channels.assertInputTarget({type:'chat',channelId,conversationId:'direct-room',senderId:'foreign-peer'}),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.equal(f.requests.length,0)
})

async function editModel(body){
 const {requestEnvelope,requestTools}=await import('./fixtures/resident-router-host.js'),tools=requestTools(body)
 const handoff=requestEnvelope(body,'Router 交接请求：')
 if(handoff&&!tools.length)return {text:JSON.stringify({currentIntent:'Retain original task history',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
 if(tools.includes('resident_router_settle')){
  if(body.messages.at(-1)?.role==='tool')return {text:'Committed'}
  const input=requestEnvelope(body,'Router 请求：')
  return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'edit-settle:'+input.events.map(event=>event.eventId).join(',')}}
 }
 if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Local edit fixture completed',evidence:[],limitations:[]}}}
 return {text:'verified'}
}

async function mountEditService(f){
 const {openResidentStore}=await import('../packages/dingtalk-core/store.js'),{openDynamicTaskStore}=await import('../packages/dingtalk-core/dynamic-task-store.js'),{openTaskSessionService}=await import('../packages/dingtalk-core/task-session-service.js')
 const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'edit-race',ownerActorId:'owner',webActorId:'owner',initialize:true,agentPreset:'night-bot',reasoningMode:'inherit'}
 const residentStore=await openResidentStore(ctx.storageDomain),raw=await openDynamicTaskStore(config)
 let intercept
 const store={...raw,async query(q){await intercept?.(q);return raw.query(q)}}
 const tasks=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:['assistant']}),getGroup:id=>residentStore.getGroup(id)},notifications:{canDisclose:()=>false,async send(){throw Error('No vendor send')},async readback(){throw Error('No vendor readback')}}})
 const app={tasks,store:residentStore,async close(){await tasks.close();await raw.close();await residentStore.close()}}
 ctx.provide('application',app)
 return {app,originalQuery:q=>raw.query(q),intercept:fn=>{intercept=fn}}
}

test('已接纳未落SQL的create/reopen阻止切换，跨await旧请求在激活后拒绝且可切回原身份',{timeout:nativeTestTimeout(60000)},async t=>{
 const vendor=editVendor(),f=await memoryHost(t,editModel,{dingtalkProfileRunner:vendor.runner}),paths=f.host.ctx.runtimePaths,original=row(),file=join(paths.config,'config.json')
 await put(file,{...f.config,channelPlugins:[original]});const legacy=dingtalkChannelPaths(paths,channelId)
 await put(legacy.bindingFile,binding);await put(legacy.ingressFile,{paused:false,firstStartedAt:'2026-01-01T00:00:00.000Z'})
 const controlled=await mountEditService(f),app=controlled.app,service=app.tasks,channels=f.host.ctx.channels,port=f.host.ctx.get('channelConfiguration')
 const context=await channels.registerConversation(scopeInput()),groupId=context.sessionId
 await app.store.subscribe({groupId,name:'Old scope',responsibility:'Test only'})
 const detail=await port.getDingtalk(channelId),next={...draft(detail),target:'new-room'},originalQuery=controlled.originalQuery
 let block,entered,release;const pending=[]
 const pause=predicate=>{
  entered=Promise.withResolvers();release=Promise.withResolvers();block=predicate
  controlled.intercept(async q=>{if(block?.(q)){block=undefined;entered.resolve();await release.promise}})
 }
 try{
 pause(q=>q.kind==='source.get'&&q.sourceId.startsWith('single-task-source:'))
 const creating=service.createTask({requestId:'edit-inflight-create',groupId,objective:'Finish a local verification task'});pending.push(creating)
 await entered.promise
 assert.equal((await originalQuery({kind:'task.list',groupId})).length,0)
 await assert.rejects(port.editDingtalk(channelId,next),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.equal(channels.targetHolds.size,0);assert.equal(channels.activeTargets.size,0)
 release.resolve();const created=await creating;controlled.intercept(undefined)
 await service.whenIdle()
 const done=await originalQuery({kind:'task.get',taskId:created.taskId});assert.equal(done.status,'completed');assert.equal(done.drained,true)
 pause(q=>q.kind==='source.get'&&q.sourceId.startsWith('web:'))
 const reopening=service.reopenTask({taskId:created.taskId,requestId:'edit-inflight-reopen',context:'Run one more local verification'});pending.push(reopening)
 await entered.promise
 assert.equal((await originalQuery({kind:'task.get',taskId:created.taskId})).status,'completed')
 await assert.rejects(port.editDingtalk(channelId,next),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 release.resolve();await reopening;controlled.intercept(undefined);await service.whenIdle()
 assert.equal((await originalQuery({kind:'task.get',taskId:created.taskId})).status,'completed')
 // 这个请求已进入HTTP背后的真实服务，但尚未进入admission；发布后的原入口必须重查。
 pause(q=>q.kind==='task.get'&&q.taskId===created.taskId)
 const stale=service.reopenTask({taskId:created.taskId,requestId:'edit-before-activation',context:'Must not cross target activation'});pending.push(stale)
 await entered.promise
 const persistentRouter=await originalQuery({kind:'router.get',conversationId:groupId})
 assert.ok(persistentRouter.cursor>persistentRouter.lastHandoffCursor,'idle persistent history is not unprocessed work')
 const nextTarget={type:'chat-room',conversationId:'new-room'}
 await service.withChannelTargetSwitch({channelId,nextTarget},async()=>{}, {activate:true})
 assert.equal(channels.activeTargets.get(channelId).conversationId,'new-room');assert.equal(channels.targetHolds.size,0)
 release.resolve();await assert.rejects(stale,{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'});controlled.intercept(undefined)
 assert.ok(await originalQuery({kind:'task.get',taskId:created.taskId}),'历史查询仍可读')
 assert.throws(()=>channels.assertGroupTarget(groupId),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.doesNotThrow(()=>channels.assertInputTarget(scopeInput('new-room')))
 const unmanaged=await channels.registerConversation({...scopeInput(),channelId:'ordinary-third-party'})
 assert.doesNotThrow(()=>channels.assertGroupTarget(unmanaged.sessionId))
 // 真实历史重试API也会在source.list后await；激活后不能留下新旧scope搁置输入。
 await service.withChannelTargetSwitch({channelId,nextTarget:{type:'chat-room',conversationId:'old-room'}},async()=>{}, {activate:true})
 await app.store.ingest({groupId,messageId:'history-not-in-sql',text:'Historical input awaiting explicit retry',occurredAt:'2026-01-02T00:00:00.000Z',senderOpenDingTalkId:'owner',senderName:'Fixture operator'})
 pause(q=>q.kind==='source.list'&&q.groupId===groupId)
 const retrying=service.retryMessage({groupId,messageId:'history-not-in-sql'});pending.push(retrying)
 await entered.promise
 await service.withChannelTargetSwitch({channelId,nextTarget},async()=>{}, {activate:true})
 release.resolve();await assert.rejects(retrying,{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'});controlled.intercept(undefined)
 assert.equal((await originalQuery({kind:'source.list',groupId})).some(source=>source.messageId==='history-not-in-sql'),false)
 // 临时门禁失败不能误删已发布身份；随后显式切回同一实际身份恢复准入。
 await assert.rejects(service.withChannelTargetSwitch({channelId,nextTarget:{type:'chat-room',conversationId:'old-room'}},async()=>{throw Error('SAVE_FAILED')}),/SAVE_FAILED/)
 assert.equal(channels.activeTargets.get(channelId).conversationId,'new-room');assert.equal(channels.targetHolds.size,0)
 await service.withChannelTargetSwitch({channelId,nextTarget:{type:'chat-room',conversationId:'old-room'}},async()=>{}, {activate:true})
 assert.doesNotThrow(()=>channels.assertGroupTarget(groupId))
 assert.equal((await port.getDingtalk(channelId)).version,detail.version)
 }finally{release?.resolve();controlled.intercept(undefined);await Promise.allSettled(pending)}
})

test('未来与半提交的平台定时绑定阻止旧目标切换，结清后才放行',{timeout:nativeTestTimeout(30000)},async t=>{
 const vendor=editVendor(),f=await memoryHost(t,editModel,{dingtalkProfileRunner:vendor.runner}),paths=f.host.ctx.runtimePaths,original=row()
 await put(join(paths.config,'config.json'),{...f.config,channelPlugins:[original]});await put(dingtalkChannelPaths(paths,channelId).bindingFile,binding)
 const app=await mountEditApp(f,[original]),context=await f.host.ctx.channels.registerConversation(scopeInput()),groupId=context.sessionId
 await app.store.subscribe({groupId,name:'Old scope',responsibility:'Test only'})
 const scheduled={sourceMode:'direct',sourceId:'accepted-source',actorId:'owner',sessionId:'pending-platform-fixture',requestId:'future-request',groupId,messageId:'original-message',messageVersion:1,timezone:'UTC',title:'Future authorized reminder',prompt:'Report only original scope',at:'2099-01-01T00:00:00.000Z'}
 await app.store.preparePlatformSchedule(scheduled)
 assert.equal((await f.host.ctx.get('schedule').catalog()).some(record=>record.sessionId===scheduled.sessionId),false)
 const port=f.host.ctx.get('channelConfiguration'),detail=await port.getDingtalk(channelId)
 await assert.rejects(port.editDingtalk(channelId,{...draft(detail),target:'new-room'}),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.deepEqual(app.store.listPlatformSchedules(groupId),[scheduled])
 await app.store.updatePlatformSchedule(scheduled.sessionId,{outcome:'expired',completedAt:new Date().toISOString()})
 const saved=await port.editDingtalk(channelId,{...draft(detail),target:'new-room'})
 assert.equal(saved.changed,true);assert.equal(saved.channel.config.dingtalk_writes_authorized,false)
 // 新增后从未绑定的错误目标也可纠正；不查询旧错目标，不猜同身份或继承旧水位。
 const unboundId='unbound-fix',unbound={...row(),channelId:unboundId,config:{...row().config,dingtalk_group_id:'missing-old-target',dingtalk_writes_authorized:false}}
 const file=join(paths.config,'config.json'),config=JSON.parse(await readFile(file,'utf8'));config.channelPlugins.push(unbound);await put(file,config)
 const unboundPaths=dingtalkChannelPaths(paths,unboundId),unboundIngress={paused:true,firstStartedAt:'2026-01-01T00:00:00.000Z',recoveryFromAt:'2026-01-01T00:00:00.000Z'}
 await put(unboundPaths.ingressFile,unboundIngress);const unboundBytes=await readFile(unboundPaths.ingressFile,'utf8')
 const unknownContext=await f.host.ctx.channels.registerConversation({...scopeInput('new-room'),channelId:unboundId})
 await app.store.subscribe({groupId:unknownContext.sessionId,name:'Unknown binding scope',responsibility:'Test only'})
 const unfinished=async(taskId)=>{
  await app.tasks.store.command({id:taskId,kind:'task.create',args:{taskId,groupId:unknownContext.sessionId,ownerActorId:'owner',request:'Keep unknown old ownership pending'}})
  await app.tasks.store.command({id:taskId+':pause',kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:1}})
 }
 await unfinished('unbound-old-pending')
 const incorrect=await port.getDingtalk(unboundId),correction={...draft(incorrect),target:'new-room'}
 // 文件存在却不是合法 binding 时不能当缺席，更不能查询厂商或覆盖坏文件。
 for(const invalid of [null,false,0,[],{}]){
  await put(unboundPaths.bindingFile,invalid)
  const bytes=await readFile(unboundPaths.bindingFile,'utf8'),calls=vendor.calls.length
  await assert.rejects(port.editDingtalk(unboundId,correction),{code:'DINGTALK_BINDING_INVALID'})
  assert.equal(await readFile(unboundPaths.bindingFile,'utf8'),bytes)
  assert.equal(vendor.calls.length,calls);assert.deepEqual(await port.getDingtalk(unboundId),incorrect)
 }
 await unlink(unboundPaths.bindingFile)
 await assert.rejects(port.editDingtalk(unboundId,correction),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 await app.tasks.store.command({id:'unbound-old-cancel',kind:'task.control',args:{taskId:'unbound-old-pending',control:'cancelled',expectedControlRevision:2}})
 await app.tasks.recover();await app.tasks.whenIdle()
 const corrected=await port.editDingtalk(unboundId,correction)
 assert.equal(corrected.detail.target,'new-room');assert.equal(corrected.channel.config.dingtalk_profile,binding.profile);assert.equal(corrected.channel.config.dingtalk_writes_authorized,false)
 assert.match(corrected.channel.config.dingtalk_storage_key,/^[a-f0-9]{64}$/)
 assert.equal(await readFile(unboundPaths.ingressFile,'utf8'),unboundBytes)
 assert.ok(vendor.calls.every(args=>!args.includes('missing-old-target')))
 // 保存后新增的未知scope依赖即使native ID碰巧等于新目标，第一次冷启仍须阻断。
 await unfinished('unbound-late-pending')
 await f.close();await f.boot();await mountEditPlugin(f,corrected.channel,vendor)
 const blocked=await mountEditApp(f,[corrected.channel]),blockedPlugin=f.host.ctx.channels.plugins.get(unboundId)
 assert.equal(blockedPlugin.bindingActive,false);assert.equal(blockedPlugin.health.lastError,'DINGTALK_CHANNEL_SWITCH_BLOCKED')
 const managed=dingtalkChannelPaths(f.host.ctx.runtimePaths,unboundId,corrected.channel.config.dingtalk_storage_key)
 await assert.rejects(readFile(managed.bindingFile),{code:'ENOENT'})
 // null 或与 inline 不同的有效文件都不能作为已知身份跳过首次全面门禁。
 let rejecting=blocked
 for(const [invalid,code] of [[null,'DINGTALK_BINDING_INVALID'],[{...corrected.channel.config.dingtalk_binding,conversationId:'different-room'},'DINGTALK_BINDING_CHANGED']]){
  await put(managed.bindingFile,invalid);const bytes=await readFile(managed.bindingFile,'utf8')
  await f.close();await f.boot();await mountEditPlugin(f,corrected.channel,vendor)
  rejecting=await mountEditApp(f,[corrected.channel])
  const plugin=f.host.ctx.channels.plugins.get(unboundId)
  assert.equal(plugin.bindingActive,false);assert.equal(plugin.health.lastError,code)
  assert.equal(await readFile(managed.bindingFile,'utf8'),bytes)
  assert.equal((await rejecting.tasks.store.query({kind:'task.get',taskId:'unbound-late-pending'})).control,'paused')
 }
 await rejecting.tasks.store.command({id:'unbound-late-cancel',kind:'task.control',args:{taskId:'unbound-late-pending',control:'cancelled',expectedControlRevision:2}})
 await rejecting.tasks.recover();await rejecting.tasks.whenIdle()
 await f.close();await unlink(managed.bindingFile);await f.boot();await mountEditPlugin(f,corrected.channel,vendor)
 const ready=await mountEditApp(f,[corrected.channel]),readyPlugin=f.host.ctx.channels.plugins.get(unboundId)
 assert.equal(readyPlugin.bindingActive,true);assert.equal(readyPlugin.health.state,'ready')
 assert.equal((await f.host.ctx.get('channelConfiguration').getDingtalk(unboundId)).target,'new-room')
 assert.equal(JSON.parse(await readFile(managed.bindingFile,'utf8')).profile,binding.profile)
 assert.equal(await readFile(unboundPaths.ingressFile,'utf8'),unboundBytes)
 assert.equal((await ready.tasks.store.query({kind:'task.get',taskId:'unbound-late-pending'})).control,'cancelled')
})
