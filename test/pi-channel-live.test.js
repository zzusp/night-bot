import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
import {loadConfig,updateConfig} from '../src/config.js'
import {apply as application,inject} from '../src/application.js'
import {configuredChannels} from '../packages/web-console/server/views.js'
import {dingtalkConfigVersion} from '../src/channels/plugins/dingtalk-config.js'
import {createWebConsole} from '../packages/web-console/server/plugin.js'

const draft=detail=>({expectedVersion:detail.version,name:detail.name,prompt:detail.prompt,conversationType:detail.conversationType,targetKind:detail.targetKind,target:detail.target,writesAuthorized:detail.writesAuthorized})
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-live-channel-')),file=join(root,'data/config/config.json'),calls=[],streams=[],controls={failRoom:null,auth:true}
 const runner={async run(args){
  calls.push([...args]);const flag=name=>args[args.indexOf(name)+1];let value
  if(args[0]==='profile')value={success:true,profiles:[{profile:'corp:user',corpId:'corp',userId:'user',userName:'Self',isOrgCurrent:true,isCurrent:true}]}
  else if(args.includes('get-self')){if(!controls.auth)return {exitCode:2,stdout:'',stderr:''};value={result:[{orgEmployeeModel:{corpId:'corp',userId:'user',orgUserName:'Self'}}]}}
  else if(args.includes('+search-user'))value={ok:true,outcome:'success',data:{count:1,users:[{userId:'user',openDingTalkId:'self'}]}}
  else if(args.includes('conversation-info')){if(flag('--group')===controls.failRoom)throw Error('fixture binding failure');value={success:true,result:{conversationInfo:{openConversationId:flag('--group'),singleChat:false,title:'Fixture '+flag('--group')}}}}
  else if(args.includes('+chat-messages'))value={messages:[],complete:true,hasMore:false,partial:false,failedCount:0,failures:[]}
  else if(args.includes('+search-msg'))value={messages:[],complete:true,hasMore:false,partial:false,failedCount:0,failures:[]}
  else if(args.includes('+messages-query-send-status'))value={result:{sendStatus:'UNKNOWN'}}
  else if(args.some(value=>/messages-send|messages-reply/.test(value)))value={sendReceipt:{openTaskId:'fake-send'}}
  else throw Error('Unexpected fixture command '+args.join(' '))
  return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
 },spawn(args,callbacks){const done=Promise.withResolvers(),entry={args,stopped:false};streams.push(entry);queueMicrotask(()=>callbacks.onStderrLine('[event] ready'));return {done:done.promise,terminate(){entry.stopped=true;done.resolve()}}}}
 const config={installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'TEST_KEY',models:[{id:'m'}]}},skillWatch:false,credentialsWatch:false,memory:{background:false},channelPlugins:[],resident:{port:0,taskSessions:{instanceId:'live-channel-test',ownerActorId:'owner',webActorId:'owner',initialize:true,ingressEpoch:'2026-01-01T00:00:00.000Z',recoveryIntervalMs:600000}}}
 await mkdir(join(root,'data/config'),{recursive:true});await writeFile(file,JSON.stringify(config))
 const running=await loadConfig(file),host=await createHost(running,{environmentOptions:{inherited:{}},dingtalkProfileRunner:runner,dingtalkPluginDependencies:{environment:{HOME:root,USERPROFILE:root,DWS_CONFIG_DIR:root},observeLogin:async()=>async()=>{}}})
 await host.ctx.plugin({inject,apply:ctx=>application(ctx,running)})
 t.after(async()=>{try{await host.close()}finally{await rm(root,{recursive:true,force:true})}})
 return {root,file,host,app:host.ctx.get('application'),running,calls,streams,controls,port:host.ctx.get('channelConfiguration'),add:(channelId='live-room',target='room')=>host.ctx.get('channelConfiguration').addDingtalk({channelId,conversationType:'chat-room',targetKind:'id',target,name:'Fixture',prompt:'Original',writesAuthorized:false})}
}

async function withWeb(f,work){
 const web=await createWebConsole({channels:f.host.ctx.channels,paths:f.host.ctx.runtimePaths,config:{channelId:'delete-console',senderId:'owner',port:0},getApplication:()=>f.app,getChannelConfiguration:()=>f.port})
 try{
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})}),session=await login.json()
  assert.equal(login.status,200)
  const headers={origin:web.origin,'content-type':'application/json',cookie:login.headers.get('set-cookie').split(';')[0],'x-csrf-token':session.csrfToken}
  const request=async(path,options={})=>{const response=await fetch(web.origin+path,{...options,headers});return {status:response.status,body:await response.json()}}
  return await work(request)
 }finally{await web.close()}
}

test('running Host adds a channel immediately; metadata and authorization do not reconnect; CAS serializes edits',async t=>{
 const f=await fixture(t),core=f.host.ctx.get('application'),added=await f.add()
 assert.equal(added.restartRequired,false);assert.equal(added.liveApplied,true)
 const plugin=f.host.ctx.channels.plugins.get('live-room'),streamCount=f.streams.length
 assert.equal(plugin.bindingActive,true);assert.ok(streamCount>0)
 let detail=await f.port.getDingtalk('live-room')
 const input=draft(detail),results=await Promise.allSettled([f.port.editDingtalk('live-room',{...input,name:'New name',prompt:'New responsibility',writesAuthorized:true}),f.port.editDingtalk('live-room',{...input,name:'New name',prompt:'Concurrent responsibility',writesAuthorized:true})])
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.code,'DINGTALK_CHANNEL_VERSION_CONFLICT')
 assert.equal(f.host.ctx.get('application'),core);assert.equal(f.host.ctx.channels.plugins.get('live-room'),plugin);assert.equal(f.streams.length,streamCount)
 assert.equal(plugin.prompt,results[0].status==='fulfilled'?'New responsibility':'Concurrent responsibility');assert.equal(f.host.ctx.channels.transports.get('live-room').canSend(),true)
 detail=await f.port.getDingtalk('live-room');await f.port.editDingtalk('live-room',{...draft(detail),writesAuthorized:false})
 assert.equal(f.host.ctx.channels.transports.get('live-room').canSend(),false)
 assert.equal(configuredChannels(f.app,f.host.ctx.channels).items[0].restartRequired,false)
 assert.equal(f.calls.some(args=>args.some(value=>/messages-send|messages-reply/.test(value))),false)
 assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')).channelPlugins,f.running.channelPlugins)
})

test('target replacement reconnects only its channel and remove retains history and binding files',async t=>{
 const f=await fixture(t);await f.add();await f.add('other-room','other')
 const channels=f.host.ctx.channels,old=channels.plugins.get('live-room'),other=channels.plugins.get('other-room')
 const identity=await channels.registerConversation({type:'chat-room',channelId:'live-room',conversationId:'room',senderId:'peer',messageId:'scope',text:'History only'})
 const detail=await f.port.getDingtalk('live-room'),result=await f.port.editDingtalk('live-room',{...draft(detail),target:'new-room',writesAuthorized:false})
 assert.equal(result.restartRequired,false);assert.equal(result.liveApplied,true);assert.notEqual(channels.plugins.get('live-room'),old);assert.equal(channels.plugins.get('other-room'),other)
 assert.equal(channels.plugins.get('live-room').bindingIdentity.conversationId,'new-room');assert.equal(channels.transports.get('live-room').canSend(),false)
 assert.throws(()=>channels.assertGroupTarget(identity.sessionId),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.ok(channels.groupContext(identity.sessionId));assert.ok(f.streams.some(stream=>stream.stopped));assert.ok(f.streams.some(stream=>!stream.stopped&&stream.args.includes('other')))
 const bytes=await readFile(join(f.root,'data/state/channels/contexts.json'),'utf8')
 await f.port.remove('live-room',{expectedVersion:result.detail.version})
 assert.equal(channels.plugins.has('live-room'),false);assert.equal(channels.transports.has('live-room'),false);assert.equal(channels.activeTargets.has('live-room'),false)
 assert.equal(await readFile(join(f.root,'data/state/channels/contexts.json'),'utf8'),bytes)
 assert.equal(f.running.channelPlugins.length,1)
})

test('unknown delivery survives permission edits; target switch and deletion are refused without a resend',async t=>{
 const f=await fixture(t);await f.add();const channels=f.host.ctx.channels
 const identity=await channels.registerConversation({type:'chat-room',channelId:'live-room',conversationId:'room',senderId:'peer',messageId:'scope',text:'History only'}),groupId=identity.sessionId
 await f.app.store.subscribe({groupId,name:'History',responsibility:'fixture'})
 const command=(id,kind,args)=>f.app.tasks.store.command({id,kind,args})
 await command('create','task.create',{taskId:'history-task',groupId,ownerActorId:'owner',request:'Retained task'})
 await command('cancel','task.control',{taskId:'history-task',control:'cancelled',expectedControlRevision:1});await f.app.tasks.recover();await f.app.tasks.whenIdle()
 await command('notice','notification.prepare',{notificationId:'unknown-notice',taskId:'history-task',requirementRevision:1,kind:'status',payload:{conversationId:groupId,text:'Do not resend'}})
 const started=await command('start','notification.start',{notificationId:'unknown-notice'})
 await command('uncertain','notification.receipt',{notificationId:'unknown-notice',dispatchToken:started.result.notification.dispatchToken,state:'unknown'})
 const before=await f.app.tasks.store.query({kind:'notification.get',notificationId:'unknown-notice'}),detail=await f.port.getDingtalk('live-room')
 await f.port.editDingtalk('live-room',{...draft(detail),prompt:'Still the same original scope'})
 const next=await f.port.getDingtalk('live-room'),bytes=await readFile(f.file,'utf8'),plugin=channels.plugins.get('live-room')
 await assert.rejects(f.port.editDingtalk('live-room',{...draft(next),target:'new-room'}),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 await withWeb(f,async request=>{
  const result=await request('/api/channels/live-room',{method:'DELETE',body:JSON.stringify({expectedVersion:next.version,confirm:true})})
  assert.equal(result.status,409);assert.deepEqual(result.body,{error:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 })
 assert.equal(await readFile(f.file,'utf8'),bytes);assert.equal(channels.plugins.get('live-room'),plugin)
 const after=await f.app.tasks.store.query({kind:'notification.get',notificationId:'unknown-notice'})
 assert.equal(after.state,'unknown');assert.equal(after.sendAttemptCount,before.sendAttemptCount);assert.deepEqual(after.payload,before.payload)
 assert.equal(f.calls.some(args=>args.some(value=>/messages-send|messages-reply/.test(value))),false)
})

test('failed activation rolls back file and instance, waiting-auth is loaded without pretending connected',async t=>{
 const f=await fixture(t),bytes=await readFile(f.file,'utf8');f.controls.failRoom='broken'
 await assert.rejects(f.add('broken-channel','broken'),{code:'CHANNEL_ACTIVATION_FAILED'})
 assert.equal(await readFile(f.file,'utf8'),bytes);assert.equal(f.host.ctx.channels.plugins.has('broken-channel'),false);assert.equal(f.host.ctx.channels.lifecycleHolds.has('broken-channel'),false)
 f.controls.auth=false
 const result=await f.add('auth-channel','room');assert.equal(result.restartRequired,false);assert.equal(result.liveApplied,false)
 const view=configuredChannels(f.app,f.host.ctx.channels).items[0];assert.equal(view.connectionState,'waiting-auth');assert.equal(view.connected,false);assert.equal(view.restartRequired,false)
})

test('live disable preserves readback transport and enable resumes the same instance without replay',async t=>{
 const f=await fixture(t);await f.add();const channels=f.host.ctx.channels,plugin=channels.plugins.get('live-room'),detail=await f.port.getDingtalk('live-room')
 const identity=await channels.registerConversation({type:'chat-room',channelId:'live-room',conversationId:'room',senderId:'peer',messageId:'readback',text:'Retained'})
 await f.port.setEnabled('live-room',{expectedVersion:detail.version,enabled:false})
 assert.equal(channels.plugins.get('live-room'),plugin);assert.equal(plugin.enabled,false)
 const notice={id:'unknown-only',state:'unknown',payload:{conversationId:identity.sessionId,text:'Retained reply'}}
 assert.equal(channels.canDeliver(notice),true)
 await channels.transportCall('readback',notice)
 const paused=await f.port.getDingtalk('live-room');await f.port.setEnabled('live-room',{expectedVersion:paused.version,enabled:true})
 assert.equal(plugin.enabled,true);assert.equal(channels.plugins.get('live-room'),plugin)
 assert.equal(notice.state,'unknown');assert.equal(f.calls.some(args=>args.some(value=>/messages-send|messages-reply/.test(value))),false)
})

test('commit failure restores the old instance and target without publishing new configuration',async t=>{
 const f=await fixture(t);await f.add();const manager=f.host.ctx.channelLifecycle,channels=f.host.ctx.channels
 const current=JSON.parse(await readFile(f.file,'utf8')),next=structuredClone(current),row=next.channelPlugins[0]
 row.config.dingtalk_listen=false
 const before=await readFile(f.file,'utf8'),old=channels.plugins.get('live-room')
 await assert.rejects(manager.apply({current,next,commit:async()=>{throw Error('fixture disk failure')}},'live-room'),/fixture disk failure/)
 assert.equal(await readFile(f.file,'utf8'),before);assert.notEqual(channels.plugins.get('live-room'),old);assert.equal(channels.plugins.get('live-room').bindingActive,true)
 assert.deepEqual(f.running.channelPlugins,current.channelPlugins);assert.equal(channels.lifecycleHolds.has('live-room'),false)
})

test('a failed stop keeps its owner and blocks publication of a competing adapter',async t=>{
 const f=await fixture(t);await f.add();const manager=f.host.ctx.channelLifecycle,channels=f.host.ctx.channels,plugin=channels.plugins.get('live-room'),stop=plugin.stopAndDrain
 const current=JSON.parse(await readFile(f.file,'utf8')),next=structuredClone(current);next.channelPlugins[0].config.dingtalk_listen=false
 let commits=0;plugin.stopAndDrain=async()=>{throw Error('fixture drain not proven')}
 try{
  await assert.rejects(manager.apply({current,next,commit:async()=>{commits++}},'live-room'),/fixture drain not proven/)
  assert.equal(commits,0);assert.equal(channels.plugins.get('live-room'),plugin);assert.equal(manager.instances.get('live-room').row.config.dingtalk_listen,true)
  assert.equal(channels.lifecycleHolds.has('live-room'),true)
 }finally{plugin.stopAndDrain=stop;channels.lifecycleHolds.delete('live-room')}
})

test('uncertain atomic commit never rolls back to a conflicting runtime or automatically retries',async t=>{
 const f=await fixture(t);await f.add();const manager=f.host.ctx.channelLifecycle,channels=f.host.ctx.channels,current=JSON.parse(await readFile(f.file,'utf8')),next=structuredClone(current)
 next.channelPlugins[0].config.dingtalk_prompt='Possibly committed'
 let commits=0
 try{
  await assert.rejects(manager.apply({current,next,commit:async()=>{commits++;throw Object.assign(Error('NIGHT_WRITE_COMMIT_UNCERTAIN'),{committed:true})}},'live-room'),/COMMIT_UNCERTAIN/)
  assert.equal(commits,1);assert.equal(channels.plugins.get('live-room').prompt,'Possibly committed');assert.equal(channels.lifecycleHolds.has('live-room'),true)
  assert.equal(channels.configurationErrors.get('live-room'),'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN')
  const view=configuredChannels(f.app,channels).items[0];assert.equal(view.liveApplied,false);assert.equal(view.connected,false);assert.equal(view.errorCode,'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN')
 }finally{channels.lifecycleHolds.delete('live-room')}
})

test('a same-target binding normalization cannot conceal a subsequent listener change',async t=>{
 const f=await fixture(t);await f.add();const manager=f.host.ctx.channelLifecycle,channels=f.host.ctx.channels
 const current=JSON.parse(await readFile(f.file,'utf8')),normalized=structuredClone(current)
 normalized.channelPlugins[0].config.dingtalk_binding=channels.plugins.get('live-room').bindingIdentity
 const old=channels.plugins.get('live-room')
 await manager.apply({current,next:normalized,commit:async()=>{}},'live-room')
 assert.equal(channels.plugins.get('live-room'),old)
 const next=structuredClone(normalized);next.channelPlugins[0].config.dingtalk_listen=false
 await manager.apply({current:normalized,next,commit:async()=>{}},'live-room')
 assert.notEqual(channels.plugins.get('live-room'),old);assert.equal(channels.plugins.get('live-room').health.listening,false)
})

test('partial builtin apply cleanup never broadcasts shutdown to another channel',async t=>{
 const f=await fixture(t);await f.add();const channels=f.host.ctx.channels,other=channels.plugins.get('live-room')
 let globalStops=0;const off=f.host.ctx.on('night/stopping',()=>{globalStops++},{global:true})
 const existing={send:async()=>({}),readback:async()=>undefined},remove=channels.registerTransport('conflicting-channel',existing)
 try{
  await assert.rejects(f.add('conflicting-channel'),{code:'CHANNEL_TRANSPORT_INVALID'})
  assert.equal(globalStops,0);assert.equal(channels.plugins.get('live-room'),other);assert.equal(other.bindingActive,true)
  assert.equal(channels.transports.get('conflicting-channel'),existing);assert.equal(channels.plugins.has('conflicting-channel'),false)
 }finally{off();remove()}
})

test('an installed opt-in adapter is hot-created, replaced and disabled through the shared operator form API',async t=>{
 const f=await fixture(t),directory=join(f.root,'plugins/example')
 await mkdir(directory,{recursive:true})
 await writeFile(join(directory,'night-channel.json'),JSON.stringify({apiVersion:1,type:'example',entry:'index.mjs',webConfig:{fields:[{name:'room',label:'Room',type:'string',required:true}]}}))
 await writeFile(join(directory,'index.mjs'),`export const inject=['channels'];export const channelLifecycle=1;export const validateConfig=value=>{if(!value.room)throw Error('missing room');return value};export function apply(ctx,config){let stopped=false;const plugin={room:config.room,starts:0,health:{state:'ready',healthy:true},async start(){this.starts++},async stopAndDrain(){if(stopped)return;stopped=true;offTransport();offPlugin()}};const offTransport=ctx.channels.registerTransport(config.channelId,{send:async()=>({}),readback:async()=>undefined});const offPlugin=ctx.channels.registerPlugin(config.channelId,plugin);ctx.effect(()=>()=>plugin.stopAndDrain());ctx.on('night/ready',()=>plugin.start());ctx.on('night/stopping',()=>plugin.stopAndDrain())}`)
 await updateConfig(f.file,config=>({...config,channelPluginDirs:['plugins']}))
 const settings=f.host.ctx.operatorSettings
 let view=await settings.plugins(),result=await settings.saveChannel({type:'example',channelId:'custom-live',enabled:true,config:{room:'one'},createOnly:true,expectedVersion:view.version})
 assert.equal(result.restartRequired,false);assert.equal(result.liveApplied,true)
 const first=f.host.ctx.channels.plugins.get('custom-live');assert.equal(first.room,'one');assert.equal(first.starts,1)
 view=await settings.plugins();assert.equal(view.channels.find(row=>row.channelId==='custom-live').editable,true)
 result=await settings.saveChannel({type:'example',channelId:'custom-live',enabled:true,config:{room:'two'},expectedVersion:view.version})
 assert.equal(result.restartRequired,false);const second=f.host.ctx.channels.plugins.get('custom-live');assert.notEqual(second,first);assert.equal(second.room,'two')
 view=await settings.plugins();await settings.saveChannel({type:'example',channelId:'custom-live',enabled:false,config:{room:'two'},expectedVersion:view.version})
 assert.equal(f.host.ctx.channels.plugins.has('custom-live'),false);assert.equal(f.host.ctx.channels.transports.has('custom-live'),false)
})

test('confirmed HTTP deletion uses row CAS, drains old calls and preserves history without stopping other channels',async t=>{
 const f=await fixture(t);await f.add();await f.add('other-room','other')
 const channels=f.host.ctx.channels,other=channels.plugins.get('other-room'),identity=await channels.registerConversation({type:'chat-room',channelId:'live-room',conversationId:'room',senderId:'peer',messageId:'history',text:'Retained history'}),before=await readFile(join(f.root,'data/state/channels/contexts.json'),'utf8')
 await withWeb(f,async request=>{
  const row=(await request('/api/channels')).body.items.find(row=>row.channelId==='live-room')
  const stale=await request('/api/channels/live-room',{method:'DELETE',body:JSON.stringify({expectedVersion:'0'.repeat(64),confirm:true})})
  assert.equal(stale.status,409);assert.equal(stale.body.error,'DINGTALK_CHANNEL_VERSION_CONFLICT');assert.equal(channels.plugins.has('live-room'),true)
  const release=Promise.withResolvers(),call=channels.trackChannelCall('live-room',()=>release.promise)
  let completed=false
  const deleting=request('/api/channels/live-room',{method:'DELETE',body:JSON.stringify({expectedVersion:row.savedVersion,confirm:true})}).then(result=>{completed=true;return result})
  try{
   for(let count=0;count<100&&!channels.lifecycleHolds?.has('live-room');count++)await new Promise(resolve=>setTimeout(resolve,5))
   assert.equal(channels.lifecycleHolds.has('live-room'),true);assert.equal(completed,false);assert.equal(channels.plugins.has('live-room'),true)
  }finally{release.resolve();await call}
  const result=await deleting
  assert.equal(result.status,200);assert.deepEqual(result.body,{ok:true,channelId:'live-room',changed:true,restartRequired:false,liveApplied:false})
  assert.equal((await request('/api/channels')).body.items.some(row=>row.channelId==='live-room'),false)
 })
 assert.equal(channels.plugins.has('live-room'),false);assert.equal(channels.plugins.get('other-room'),other);assert.ok(channels.groupContext(identity.sessionId))
 assert.equal(await readFile(join(f.root,'data/state/channels/contexts.json'),'utf8'),before)
 assert.equal(f.calls.some(args=>args.some(value=>/messages-send|messages-reply/.test(value))),false)
})

test('HTTP deletion retains the owner and reports failed drain without claiming removal',async t=>{
 const f=await fixture(t);await f.add();const channels=f.host.ctx.channels,plugin=channels.plugins.get('live-room'),stop=plugin.stopAndDrain,detail=await f.port.getDingtalk('live-room'),before=await readFile(f.file,'utf8')
 plugin.stopAndDrain=async()=>{throw Error('fixture stop failure')}
 try{
  await withWeb(f,async request=>{
   const result=await request('/api/channels/live-room',{method:'DELETE',body:JSON.stringify({expectedVersion:detail.version,confirm:true})})
   assert.equal(result.status,503);assert.deepEqual(result.body,{error:'CHANNEL_DRAIN_FAILED'})
  })
  assert.equal(await readFile(f.file,'utf8'),before);assert.equal(channels.plugins.get('live-room'),plugin);assert.equal(channels.lifecycleHolds.has('live-room'),true)
 }finally{plugin.stopAndDrain=stop;channels.lifecycleHolds.delete('live-room')}
})

test('failed deletion commit restores the original channel without erasing history or changing version',async t=>{
 const f=await fixture(t);await f.add();const manager=f.host.ctx.channelLifecycle,channels=f.host.ctx.channels,current=JSON.parse(await readFile(f.file,'utf8')),next=structuredClone(current),before=await readFile(f.file,'utf8')
 next.channelPlugins=[]
 await assert.rejects(manager.apply({current,next,commit:async()=>{throw Error('fixture deletion commit failure')}},'live-room',{removing:true}),/deletion commit failure/)
 assert.equal(await readFile(f.file,'utf8'),before);assert.equal(channels.plugins.get('live-room').bindingActive,true);assert.deepEqual(f.running.channelPlugins,current.channelPlugins);assert.equal(channels.lifecycleHolds.has('live-room'),false)
})

test('an unmanaged active channel cannot be deleted by a file-only fallback',async t=>{
 const f=await fixture(t);await f.add();const manager=f.host.ctx.channelLifecycle,current=JSON.parse(await readFile(f.file,'utf8')),next=structuredClone(current),entry=manager.instances.get('live-room')
 next.channelPlugins=[];manager.instances.delete('live-room');let commits=0
 try{await assert.rejects(manager.apply({current,next,commit:async()=>{commits++}},'live-room',{removing:true}),{code:'CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED'});assert.equal(commits,0)}finally{manager.instances.set('live-room',entry)}
})

test('headless operator transport preserves unknown-delivery channel guards without Web',async t=>{
 const {createServer}=await import('node:http'),{createSettingsOperatorAuth}=await import('../src/settings/auth.js'),{createSettingsHttp}=await import('../src/settings/http.js'),{requestLiveSettings}=await import('../src/settings/cli.js')
 const f=await fixture(t);await f.add();const channels=f.host.ctx.channels
 const identity=await channels.registerConversation({type:'chat-room',channelId:'live-room',conversationId:'room',senderId:'peer',messageId:'headless-scope',text:'History only'}),groupId=identity.sessionId
 await f.app.store.subscribe({groupId,name:'History',responsibility:'fixture'})
 const command=(id,kind,args)=>f.app.tasks.store.command({id,kind,args})
 await command('headless-create','task.create',{taskId:'headless-history',groupId,ownerActorId:'owner',request:'Retained task'})
 await command('headless-cancel','task.control',{taskId:'headless-history',control:'cancelled',expectedControlRevision:1});await f.app.tasks.recover();await f.app.tasks.whenIdle()
 await command('headless-notice','notification.prepare',{notificationId:'headless-unknown',taskId:'headless-history',requirementRevision:1,kind:'status',payload:{conversationId:groupId,text:'Do not resend'}})
 const started=await command('headless-start','notification.start',{notificationId:'headless-unknown'})
 await command('headless-uncertain','notification.receipt',{notificationId:'headless-unknown',dispatchToken:started.result.notification.dispatchToken,state:'unknown'})
 const auth=await createSettingsOperatorAuth(f.host.ctx.runtimePaths),handler=createSettingsHttp({auth,getSettings:()=>f.host.ctx.operatorSettings,getChannels:()=>f.port,getPermissions:()=>f.host.ctx.toolPermissions})
 const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const config={...f.running,resident:{...f.running.resident,port:server.address().port}},call=input=>requestLiveSettings(config,f.file,input),detail=await call({action:'dingtalk-get',body:{channelId:'live-room'}}),before=await readFile(f.file,'utf8'),plugin=channels.plugins.get('live-room')
 await assert.rejects(call({action:'channel-remove',body:{channelId:'live-room',expectedVersion:detail.version,confirm:true}}),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 await assert.rejects(call({action:'dingtalk-edit',body:{channelId:'live-room',...draft(detail),target:'new-room'}}),{code:'DINGTALK_CHANNEL_SWITCH_BLOCKED'})
 assert.equal(await readFile(f.file,'utf8'),before);assert.equal(channels.plugins.get('live-room'),plugin)
 const after=await f.app.tasks.store.query({kind:'notification.get',notificationId:'headless-unknown'});assert.equal(after.state,'unknown');assert.equal(after.sendAttemptCount,1)
 assert.equal(f.calls.some(args=>args.some(value=>/messages-send|messages-reply/.test(value))),false)
})
