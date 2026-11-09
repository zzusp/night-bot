import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm,mkdir,readFile,writeFile,access,readdir} from 'node:fs/promises'
import {setTimeout as permissionTick} from 'node:timers/promises'
import {memoryHost} from './fixtures/memory-host.js'
import {loadConfig} from '../src/config.js'
import {fileURLToPath} from 'node:url'
import {symlink} from './fixtures/filesystem-link.js'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn,spawnSync} from 'node:child_process'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
import {createHost} from '../src/host.js'
let nextInput=0
const say=async(handle,text)=>{const packet={id:'approval-input-'+(++nextInput),source:{kind:'user'},content:text};await handle.enqueue(packet);await handle.deliver(packet.id);await handle.whenIdle()}
async function fixture(t,{root:providedRoot}={}){
 const root=providedRoot??await mkdtemp(join(tmpdir(),'night-approval-wire-')),f={root,requests:[]};let host,handle
 const server=createServer(async(req,res)=>{
  for await(const _ of req){}f.requests.push(req.url);res.writeHead(200,{'content-type':'text/event-stream'})
  const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'approval-proof',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
  if(f.requests.length%2){chunk({role:'assistant',tool_calls:['grant','deny'].map((id,index)=>({index,id:id+'-'+f.requests.length,type:'function',function:{name:'sensitive',arguments:JSON.stringify({id})}}))});chunk({},'tool_calls')}
  else{chunk({role:'assistant',content:'approval verified'});chunk({},'stop')}
  res.end('data: [DONE]\n\n')
 })
 t.after(async()=>{f.release?.();try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 host=f.host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),maxParallelToolCalls:2,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_APPROVAL_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:8192,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_APPROVAL_KEY:'fixture'}}})
 f.persisted=async()=>(await host.ctx.sessionPersistence.readNative('approval-wire',{requireComplete:true})).audit
 let effects=0
 handle=f.handle=await host.ctx.agents.create({sessionId:'approval-wire',agentOptions:{provider:'fixture',model:'m'},authorizeInput:packet=>packet.source.kind==='user',meta:{cwd:join(root,'work')},setup:async(ctx,actor)=>{
  ctx.get('approval').setPolicy(actor,'ask');await actor.audit.flush()
  ctx.get('tools').register({name:'sensitive',description:'Fixture requiring one approval per call',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},isConcurrencySafe:()=>true,execute:async(args,exec)=>{
   const receipts=await f.persisted(),asked=receipts.findLast(receipt=>receipt.domain==='approval'&&receipt.kind==='asked'&&receipt.payload.callId===exec.callId)
   assert.ok(asked);assert.ok(receipts.some(receipt=>receipt.domain==='approval'&&receipt.kind==='decided'&&receipt.payload.id===asked.payload.id&&receipt.payload.outcome==='allowed-once'))
   effects++;return{executed:args.id}
  }})
  ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='sensitive'?{kind:'ask',reason:'fixture exact action'}:next())
 }})
 f.effects=()=>effects
 f.store=host.ctx.get('sessionPersistence').writers.get(handle.actor.id)
 return f
}
test('actual Pi tool grants require durable approval pairs, remain one-call only and fail closed without an answerer',{timeout:20000},async t=>{
 const f=await fixture(t);assert.equal(f.host.ctx.approval.constructor.name,'NativeApproval');assert.equal(f.host.ctx.permissionPresets.constructor.name,'NativePermissionPresets')
 let prompted=0
 const answerer=f.host.ctx.on('approval/request',async req=>{
  prompted++;const receipts=await f.persisted();assert.ok(receipts.some(receipt=>receipt.domain==='approval'&&receipt.kind==='asked'&&receipt.payload.callId===req.callId));assert.equal(req.agent,f.handle.actor)
  return req.callId.startsWith('grant-')?'allowed-once':'rejected'
 })
 await say(f.handle,'First exact call');assert.equal(f.effects(),1);assert.equal(prompted,2)
 assert.equal(f.host.ctx.approval.policyForActor(f.handle.actor),'ask');assert.equal(f.host.ctx.sandboxPolicy.resolve({actor:f.handle.actor}).mode,'workspace-write')
 answerer();await say(f.handle,'A prior one-call grant must not authorize new calls');assert.equal(f.effects(),1)
 const receipts=await f.persisted(),decisions=receipts.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='decided')
 assert.deepEqual(decisions.map(receipt=>receipt.payload.outcome),['allowed-once','rejected','unavailable','unavailable']);assert.equal(receipts.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='asked').length,4)
 assert.equal(f.requests.length,4);assert.equal(f.handle.session.messages.at(-1).stopReason,'stop')
})
test('cancelling a real Pi turn durably seals pending approvals before official tool results',{timeout:20000},async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();f.release=()=>release.resolve()
 f.host.ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'})
 const running=say(f.handle,'Wait for a cancellable approval').catch(error=>error)
 await entered.promise;await f.handle.cancel({kind:'user'});await running;await f.handle.whenIdle()
 assert.equal(f.effects(),0);assert.equal(f.requests.length,1)
 const entries=f.handle.session.sessionManager.getEntries(),decisions=entries.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data.domain==='approval'&&entry.data.kind==='decided')
 assert.ok(decisions.length);assert.ok(decisions.every(entry=>entry.data.payload.outcome==='cancelled'))
 const results=entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult');assert.equal(results.length,2)
 assert.ok(decisions.every(decision=>entries.indexOf(decision)<Math.max(...results.map(result=>entries.indexOf(result)))),'cancelled decisions commit before the official tool-result batch settles')
 assert.equal(f.handle.session.isStreaming,false)
 const persisted=await f.persisted();assert.equal(persisted.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='decided').length,decisions.length)
 release.resolve()
})
async function poisonProof(root){
 // The child intentionally retains the poisoned actor/lease until process exit.
 // No production cleanup gate is bypassed to make an uncertain close look good.
 const f=await fixture({after(){}},{root}),original=f.store.commit,cause=Object.assign(Error('fixture terminal sink failure'),{code:'PI_SESSION_COMMIT_UNCERTAIN'})
 let armed=true
 f.store.commit=function(...args){const terminal=this.manager.getEntries().findLast(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.stopReason==='stop');if(armed&&terminal){armed=false;throw cause}return Reflect.apply(original,this,args)}
 await assert.rejects(say(f.handle,'Fail the terminal sink'),error=>error===cause)
 await assert.rejects(f.handle.whenIdle(),error=>error===cause)
 const before=f.store.manager.getEntries().length
 await assert.rejects(async()=>f.handle.enqueue({id:'must-not-admit',source:{kind:'user'},content:'Must not be admitted after uncertain terminal state'}),error=>error===cause)
 assert.equal(f.store.manager.getEntries().length,before);assert.equal(f.requests.length,2);assert.equal(f.effects(),0)
 await assert.rejects(f.handle.dispose(),error=>error===cause)
 assert.equal(f.host.ctx.agents.get(f.handle.actor.id),f.handle.actor,'failed close retains live ownership')
}
test('idle awaits official terminal commit and terminal storage poison fences future admission',{timeout:20000},async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();f.release=()=>release.resolve()
 const original=f.store.commit;let held=false
 f.store.commit=async function(...args){if(!held&&this.manager.getEntries().some(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.stopReason==='stop')){held=true;entered.resolve();await release.promise}return Reflect.apply(original,this,args)}
 const running=say(f.handle,'Wait for terminal durability');let idle=false
 await entered.promise;const waiting=f.handle.whenIdle().then(()=>idle=true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(idle,false)
 release.resolve();await running;await waiting;f.store.commit=original
 assert.ok((await f.host.ctx.sessionPersistence.readNative(f.handle.actor.id,{requireComplete:true})).context.piMessages.some(message=>message.role==='assistant'&&message.stopReason==='stop'))
 const root=await mkdtemp(join(tmpdir(),'night-approval-poison-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const script=`import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHost} from ${JSON.stringify(new URL('../src/host.js',import.meta.url).href)};let nextInput=0;const say=${say.toString()};const fixture=${fixture.toString()};await (${poisonProof.toString()})(${JSON.stringify(root)});process.send('POISON_FENCE_PROVED');`
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk)
 // Retain the poisoned owner until the parent observes the proof, then terminate
 // that isolated process; process.exit races libuv watcher teardown on Windows.
 const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}))})
 try{await Promise.race([new Promise(resolve=>child.once('message',message=>{assert.equal(message,'POISON_FENCE_PROVED');resolve()})),exited.then(result=>assert.fail(JSON.stringify(result)+output))])}finally{child.kill('SIGTERM');await exited}
})

// 走默认 Host/Pi/PrivateFS；本地模型只给真实工具参数和无工具审查响应。
async function permissionWireFixture(t,{review=()=>({text:'{"decision":"allow"}'}),portable=true}={}){
 const releases=[];t.after(()=>{for(const release of releases)release()})
 let action
 const reviews=[],f=await memoryHost(t,body=>{
  if(body.messages.some(message=>typeof message.content==='string'&&message.content.includes('你仅审查当前用户动作的权限'))){reviews.push(body);return review(body)}
  const next=action;action=undefined;return next
 },{portable})
 const configFile=join(f.root,'data','config','config.json'),external=join(f.root,'external-business')
 await mkdir(external);await mkdir(join(f.root,'data','config'),{recursive:true});await writeFile(configFile,JSON.stringify(f.config,null,2)+String.fromCharCode(10))
 const handle=await f.agent('permission-wire');let agent=handle.agent
 return {f,external,configFile,reviews,releases,
  get agent(){return agent},
  async reopen(){await f.close();Object.assign(f.config,await loadConfig(configFile));await f.boot();const restored=await f.host.ctx.agents.resume({resumeSessionId:agent.id,agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup:ctx=>f.host.ctx.agentPresets.mount(ctx,'night-bot')});agent=restored.agent;assert.ok(agent)},
  get permissions(){return f.host.ctx.get('toolPermissions')},
  run(tool,args){assert.equal(action,undefined);action={tool,args};return f.say(agent,'按本次明确意图执行 '+tool+' '+JSON.stringify(args)).then(value=>{t.diagnostic(JSON.stringify({permissionTool:tool,results:permissionResults(agent).slice(-1),reviewCalls:reviews.length}).split(JSON.stringify(f.root).slice(1,-1)).join('<fixture>'));return value})},
 }
}
async function pendingPermission(f,running,ready=()=>true){
 let done=false,failure
 running.then(()=>{done=true},error=>{failure=error;done=true})
 for(;;){
  const row=f.permissions.view().requests.find(row=>row.status==='pending'&&row.revocable&&ready(row))
  if(row)return row
  if(done)throw failure??new Error('Actual Pi turn settled without a live permission request')
  await permissionTick(10)
 }
}
const permissionStage=(stage,running,label)=>Promise.race([stage,running.then(()=>{throw new Error('Actual Pi turn settled before '+label)})])
const permissionAbsent=async path=>assert.rejects(access(path),{code:'ENOENT'})
const permissionResults=agent=>agent.piSession.sessionManager.getEntries().filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)

test('default Host ask creates one exact external file per actual Pi approval and preserves observed edit',async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'exact.txt'),other=join(f.external,'neighbor.txt')
 assert.equal(f.permissions.mode,'ask')
 let running=f.run('write',{path,content:'original'}),row=await pendingPermission(f,running)
 assert.equal(row.actorId,f.agent.id);assert.equal(row.toolName,'write');assert.equal(row.display.target,path)
 await permissionAbsent(path);await permissionAbsent(other)
 await f.permissions.respond(row.id,'allow');await running
 assert.equal(await readFile(path,'utf8'),'original');await permissionAbsent(other)
 assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).revocable,false)
 await assert.rejects(f.permissions.respond(row.id,'allow'),{code:'PERMISSION_REQUEST_EXPIRED'})
 await f.run('read',{path})
 running=f.run('edit',{path,edits:[{oldText:'original',newText:'approved-edit'}]})
 const edit=await pendingPermission(f,running);assert.notEqual(edit.id,row.id);assert.notEqual(edit.callId,row.callId)
 assert.equal(await readFile(path,'utf8'),'original');await f.permissions.respond(edit.id,'allow');await running
 assert.equal(await readFile(path,'utf8'),'approved-edit')
 running=f.run('write',{path:other,content:'must-not-inherit'});const neighbor=await pendingPermission(f,running)
 await f.permissions.respond(neighbor.id,'reject');await running;await permissionAbsent(other)
 assert.deepEqual(f.permissions.view().requests.map(item=>item.status),['allowed-once','allowed-once','rejected'])
 assert.ok(permissionResults(f.agent).some(result=>result.isError&&JSON.stringify(result).includes('PERMISSION_REJECTED')))
 const commandTarget=join(f.external,'command-target.txt');await writeFile(commandTarget,'untouched')
 const shell=f.agent.ctx.get('shell'),original=shell.execute;let executions=0
 shell.execute=function(spec){executions++;return Reflect.apply(original,this,[spec])}
 try{for(const decision of ['reject','cancel']){
  const command='[IO.File]::WriteAllText('+permissionPsQuote(commandTarget)+",'must-not-commit')",args={description:'验证命令未批准无效果',command,permission_scope:{readPaths:[],writePaths:[commandTarget]}}
  const pending=f.run('pwsh',args).catch(error=>{assert.equal(decision,'cancel');assert.equal(error.code,'PI_OFFICIAL_ACTOR_NOT_LIVE');return error}),request=await pendingPermission(f,pending)
  assert.equal(request.actorId,f.agent.id);assert.equal(request.toolName,'pwsh');assert.equal(request.display.command,command);assert.notEqual(request.callId,row.callId)
  await permissionTick(20);assert.equal(executions,0);assert.equal(await readFile(commandTarget,'utf8'),'untouched')
  if(decision==='reject')await f.permissions.respond(request.id,'reject');else await f.agent.cancel({kind:'user'})
  await pending;assert.equal(executions,0);assert.equal(await readFile(commandTarget,'utf8'),'untouched')
  assert.equal(f.permissions.view().requests.find(item=>item.id===request.id).status,decision==='reject'?'rejected':'cancelled')
 }}finally{shell.execute=original}

})

test('default Host revokes a granted but unconsumed real Pi write without side effects',async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'revoked.txt'),entered=Promise.withResolvers(),release=Promise.withResolvers()
 f.releases.push(()=>release.resolve())
 const off=f.f.host.ctx.on('tools/execute',async(exec,next)=>{if(exec.agent===f.agent&&exec.name==='write'){entered.resolve();await release.promise}return next()})
 try{
  const running=f.run('write',{path,content:'must-not-commit'}),row=await pendingPermission(f,running)
  await f.permissions.respond(row.id,'allow');await permissionStage(entered.promise,running,'the controlled execution stage')
  assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).revocable,true)
  await permissionAbsent(path);await f.permissions.respond(row.id,'revoke');release.resolve();await running
  await permissionAbsent(path);assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).status,'cancelled')
  await assert.rejects(f.permissions.respond(row.id,'revoke'),{code:'PERMISSION_REQUEST_EXPIRED'})
  assert.ok(permissionResults(f.agent).some(result=>result.isError))
 }finally{release.resolve();off()}
})

for(const boundary of ['cancel','mode-epoch'])test('default Host pending external write has no effect after '+boundary,async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,boundary+'.txt'),running=f.run('write',{path,content:'must-not-commit'}).catch(error=>error)
 const row=await pendingPermission(f,running)
 if(boundary==='cancel')await f.agent.cancel({kind:'user'})
 else await f.permissions.setMode('auto')
 await running;await permissionAbsent(path)
 assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).status,'cancelled')
 await assert.rejects(f.permissions.respond(row.id,'allow'),{code:'PERMISSION_REQUEST_EXPIRED'})
})

test('default Host auto uses the configured Pi model with zero tools and only strict allow grants the exact write',async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'auto-allowed.txt')
 await f.permissions.setMode('auto');await f.run('write',{path,content:'auto-approved'})
 assert.equal(await readFile(path,'utf8'),'auto-approved');assert.equal(f.reviews.length,1)
 assert.deepEqual(f.reviews[0].tools??[],[])
 const input=JSON.parse(f.reviews[0].messages.find(message=>message.role==='user').content)
 assert.equal(input.request.actorId,f.agent.id);assert.equal(input.canonicalScope.path,path);assert.equal(input.arguments.content,'auto-approved')
 assert.equal(f.permissions.view().requests[0].status,'allowed-once')
})
for(const [label,review]of [['uncertain',()=>({text:'{"decision":"ask"}'})],['extra-fields',()=>({text:'{"decision":"allow","unexpected":true}'})],['model-error',()=>({error:'fixture reviewer unavailable'})]])test('default Host auto '+label+' falls back to a real pending human decision',async t=>{
 const f=await permissionWireFixture(t,{review}),path=join(f.external,label+'.txt')
 await f.permissions.setMode('auto');const running=f.run('write',{path,content:'must-await-human'}),row=await pendingPermission(f,running,row=>row.display.summary.includes('人工批准'))
 t.diagnostic(JSON.stringify({autoState:row.display.summary,reviewCalls:f.reviews.length,modelRequests:f.f.requests.length}));assert.equal(f.reviews.length,1);assert.deepEqual(f.reviews[0].tools??[],[]);assert.match(row.display.summary,/人工批准/)
 await permissionAbsent(path);await f.permissions.respond(row.id,'reject');await running;await permissionAbsent(path)
 assert.equal(f.permissions.view().requests[0].status,'rejected')
})

test('operator full persists across cold Host reopen while task actors cannot change mode and old decisions cannot replay',async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'full.txt'),pendingPath=join(f.external,'cold-pending.txt')
 const pending=f.run('write',{path:pendingPath,content:'must-not-replay'}).catch(error=>error),row=await pendingPermission(f,pending)
 await f.permissions.setMode('full');await pending;await permissionAbsent(pendingPath)
 assert.equal(f.permissions.view().protection.status,'unconfined')
 await assert.rejects(f.f.host.ctx.agents.withInitiator(f.agent,()=>f.permissions.setMode('ask')),{code:'PERMISSION_OPERATOR_REQUIRED'})
 await f.run('write',{path,content:'full-external'});assert.equal(await readFile(path,'utf8'),'full-external')
 assert.equal(f.permissions.view().requests.length,1)
 const disk=await loadConfig(f.configFile);assert.equal(disk.permissionMode,'full')
 await f.reopen()
 assert.equal(f.permissions.mode,'full');await permissionAbsent(pendingPath)
 assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).revocable,false)
 await assert.rejects(f.permissions.respond(row.id,'allow'),{code:'PERMISSION_REQUEST_EXPIRED'})
 assert.equal(await readFile(path,'utf8'),'full-external')
})

test('permission CLI check is side-effect free and real Web requires operator session Origin and CSRF for the same Host mode',async t=>{
 const f=await permissionWireFixture(t),before=await readFile(f.configFile),directory=join(f.f.root,'data','config'),entries=await readdir(directory)
 const cli=fileURLToPath(new URL('../bin/night-bot-config.js',import.meta.url))
 const check=spawnSync(process.execPath,[cli,f.configFile,'permissions','--permission-mode','auto','--check'],{encoding:'utf8'})
 assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).checkOnly,true)
 assert.deepEqual(await readFile(f.configFile),before);assert.deepEqual(await readdir(directory),entries)
 const apply=spawnSync(process.execPath,[cli,f.configFile,'permissions','--permission-mode','auto'],{encoding:'utf8'})
 assert.equal(apply.status,0,apply.stderr);assert.equal((await loadConfig(f.configFile)).permissionMode,'auto');assert.equal(f.permissions.mode,'ask')
 await f.reopen();assert.equal(f.permissions.mode,'auto')
 const web=await createWebConsole({channels:f.f.host.ctx.channels,paths:f.f.host.ctx.runtimePaths,config:{channelId:'permission-web',senderId:'isolated-operator',port:0},getPermissions:()=>f.permissions})
 try{
  let cookie,csrf
  const api=async(path,{method='GET',body,headers={}}={})=>{const response=await fetch(web.origin+path,{method,headers:{origin:web.origin,...cookie?{cookie}:{},...csrf?{'x-csrf-token':csrf}:{},...body?{'content-type':'application/json'}:{},...headers},...body?{body:JSON.stringify(body)}:{}});return{status:response.status,headers:response.headers,body:await response.json()}}
  assert.equal((await api('/api/permissions')).status,401)
  assert.equal((await api('/api/login',{method:'POST',body:{token:'incorrect-fixture-token'}})).status,401)
  const token=(await readFile(web.credentialPath,'utf8')).trim(),login=await api('/api/login',{method:'POST',body:{token}})
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrfToken
  assert.equal((await api('/api/permissions')).body.mode,'auto')
  assert.equal((await api('/api/permissions',{method:'PUT',body:{mode:'full'},headers:{'x-csrf-token':''}})).status,403)
  assert.equal((await api('/api/permissions',{method:'PUT',body:{mode:'full'},headers:{origin:'http://invalid.example'}})).status,403)
  assert.equal(f.permissions.mode,'auto')
  const saved=await api('/api/permissions',{method:'PUT',body:{mode:'full'}})
  assert.equal(saved.status,200);assert.equal(saved.body.mode,'full');assert.equal(saved.body.protection.status,'unconfined');assert.equal((await loadConfig(f.configFile)).permissionMode,'full')
  await api('/api/permissions',{method:'PUT',body:{mode:'ask'}})
  const path=join(f.external,'http-approved.txt'),running=f.run('write',{path,content:'HTTP-approved'}),row=await pendingPermission(f,running)
  const view=await api('/api/permissions'),item=view.body.requests.find(item=>item.id===row.id)
  assert.equal(item.display.target,path);assert.equal(item.revocable,true);assert.equal(JSON.stringify(view.body).includes(token),false)
  assert.equal((await api('/api/permissions/requests/'+row.id,{method:'POST',body:{decision:'allow'}})).status,200)
  await running;assert.equal(await readFile(path,'utf8'),'HTTP-approved')
  assert.equal((await api('/api/permissions/requests/'+row.id,{method:'POST',body:{decision:'allow'}})).status,409)
  assert.equal((await api('/api/logout',{method:'POST',body:{}})).status,200)
  assert.equal((await api('/api/permissions')).status,401)
 }finally{await web.close()}
})

for(const race of ['cas','symlink-swap'])test('default Host exact file grant preserves '+race+' rejection after approval',async t=>{
 const f=await permissionWireFixture(t),a=join(f.external,'original'),b=join(f.external,'replacement'),alias=join(f.external,'alias')
 await mkdir(a);await mkdir(b);await writeFile(join(a,'document.txt'),'original');await writeFile(join(b,'document.txt'),'neighbor')
 if(race==='symlink-swap')await symlink(a,alias)
 const path=join(race==='symlink-swap'?alias:a,'document.txt')
 await f.run('read',{path})
 const entered=Promise.withResolvers(),release=Promise.withResolvers();f.releases.push(()=>release.resolve())
 const off=f.f.host.ctx.on('tools/execute',async(exec,next)=>{if(exec.agent===f.agent&&exec.name==='edit'){entered.resolve();await release.promise}return next()})
 try{
  const running=f.run('edit',{path,edits:[{oldText:'original',newText:'must-not-publish'}]}),row=await pendingPermission(f,running)
  await f.permissions.respond(row.id,'allow');await permissionStage(entered.promise,running,'the controlled execution stage')
  if(race==='cas')await writeFile(join(a,'document.txt'),'external-update')
  else{await rm(alias,{recursive:true});await symlink(b,alias)}
  release.resolve();await running
  assert.equal(await readFile(join(a,'document.txt'),'utf8'),race==='cas'?'external-update':'original')
  assert.equal(await readFile(join(b,'document.txt'),'utf8'),'neighbor')
  const result=permissionResults(f.agent).at(-1);assert.equal(result.isError,true)
  assert.match(JSON.stringify(result),race==='cas'?/FS_STALE_VERSION/:/FS_STALE_VERSION|PERMISSION_SCOPE_CHANGED/)
 }finally{release.resolve();off()}
})

const permissionPsQuote=value=>"'"+value.replaceAll("'","''")+"'"
for(const background of [false,true])test('operator full real pwsh '+(background?'background ready and late completion':'foreground external write'),{skip:process.platform!=='win32'?'PowerShell production path is Windows-specific':false},async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'process-result.txt'),started=join(f.external,'process-started.txt'),finish=join(f.external,'finish.signal')
 await f.permissions.setMode('full')
 const shell=f.agent.ctx.get('shell'),original=shell.execute,entered=Promise.withResolvers(),release=Promise.withResolvers()
 let delayed=false,ended=false
 f.releases.push(()=>release.resolve())
 if(background)shell.execute=async function(spec){delayed=true;entered.resolve();await release.promise;spec.signal?.throwIfAborted();return Reflect.apply(original,this,[spec])}
 const command=background?"[IO.File]::WriteAllText("+permissionPsQuote(started)+",'started'); while (!(Test-Path -LiteralPath "+permissionPsQuote(finish)+")) { Start-Sleep -Milliseconds 20 }; [IO.File]::WriteAllText("+permissionPsQuote(path)+",'FULL_PROCESS_DONE')":"[IO.File]::WriteAllText("+permissionPsQuote(path)+",'FULL_PROCESS_DONE')"
 const captured=[],off=f.agent.ctx.on('tools/result',(exec,result)=>{if(exec.agent===f.agent&&exec.name==='pwsh')captured.push(result)})
 const running=f.run('pwsh',{description:'验证隔离测试目录的显式完全访问',command,run_in_background:background}).finally(()=>{ended=true})
 try{
  if(background){await permissionStage(entered.promise,running,'the controlled execution stage');await permissionTick(20);assert.equal(ended,false);assert.equal(permissionResults(f.agent).length,0);await permissionAbsent(path);release.resolve()}
  await running
  const tool=permissionResults(f.agent).at(-1);assert.equal(tool.toolName,'pwsh');assert.equal(tool.isError,false,JSON.stringify(tool))
  assert.equal(captured.length,1);const value=captured[0].value;assert.equal(value.kind,background?'background':'foreground');assert.equal(Object.hasOwn(value,'exit_code'),false);assert.equal(Object.hasOwn(value,'wall_time'),false)
  if(background){assert.equal(typeof value.jobId,'string');assert.equal(Object.hasOwn(value,'exitCode'),false)}else{assert.equal(value.exitCode,0);assert.deepEqual(value.piOutput,{text:'(no output)',truncated:false})}
  if(background){
   assert.equal(delayed,true)
   const jobs=f.f.host.ctx.get('jobs'),job=jobs.list(f.agent.id).find(job=>job.kind==='pwsh');assert.ok(job)
   assert.equal(job.status,'running','finishing the tool call does not kill its background producer')
   for(;;){try{assert.equal(await readFile(started,'utf8'),'started');break}catch(error){if(error.code!=='ENOENT')throw error;assert.equal(jobs.get(job.id,f.agent.id).status,'running');await permissionTick(10)}}
   await writeFile(finish,'finish')
   let terminal;do{terminal=await jobs.wait(job.id,1000,f.agent.id)}while(!['completed','failed','killed'].includes(terminal.status))
   assert.equal(terminal.status,'completed',JSON.stringify(terminal))
  }
  assert.equal(await readFile(path,'utf8'),'FULL_PROCESS_DONE')
  assert.deepEqual(f.permissions.view().requests,[])
  if(background){
   const gate=join(f.external,'promoted-finish.signal'),effect=join(f.external,'promoted-once.txt'),jobs=f.f.host.ctx.jobs
   shell.execute=original
   const promotedCommand='while (!(Test-Path -LiteralPath '+permissionPsQuote(gate)+')) { Start-Sleep -Milliseconds 20 }; [IO.File]::AppendAllText('+permissionPsQuote(effect)+",'PROMOTED_ONCE'); [Console]::Write('PROMOTED_OUTPUT')"
   const promotedRun=f.run('pwsh',{description:'验证真实超时转后台后只执行一次',command:promotedCommand,timeoutMs:3000})
   try{
    await promotedRun;const promoted=captured.at(-1).value
    assert.equal(promoted.kind,'promoted');assert.equal(Object.hasOwn(promoted,'exit_code'),false);assert.equal(Object.hasOwn(promoted,'exitCode'),false)
    assert.equal(jobs.get(promoted.jobId,f.agent.id).status,'running');await permissionAbsent(effect)
    const terminal=jobs.wait(promoted.jobId,undefined,f.agent.id);await writeFile(gate,'finish');assert.equal((await terminal).status,'completed')
    await f.run('job_output',{job_id:promoted.jobId,wait:true})
    const first=permissionResults(f.agent).at(-1);assert.equal(first.isError,false);assert.match(JSON.stringify(first),/PROMOTED_OUTPUT/)
    await f.run('job_output',{job_id:promoted.jobId,wait:true})
    const second=permissionResults(f.agent).at(-1);assert.equal(second.isError,false);assert.match(JSON.stringify(second),/no new output/)
    assert.equal(await readFile(effect,'utf8'),'PROMOTED_ONCE')
    const receipts=(await f.agent.receipts.read()).filter(receipt=>receipt.domain==='job'&&receipt.payload.jobId===promoted.jobId)
    assert.equal(receipts.filter(receipt=>receipt.kind==='registered').length,1);assert.equal(receipts.filter(receipt=>receipt.kind==='settled').length,1)
   }finally{await writeFile(gate,'cleanup-finish');await promotedRun.catch(()=>{})}
  }

 }finally{release.resolve();shell.execute=original;await writeFile(finish,'cleanup-finish');await running.catch(()=>{});off()}
})

test('operator full real pwsh background cancelled during preparation never spawns or publishes an external result',{skip:process.platform!=='win32'?'PowerShell production path is Windows-specific':false},async t=>{
 const observations=[]
 for(const mode of ['background-abort','foreground-abort','preparation-timeout','background-prepare-error']){
  const f=await permissionWireFixture(t),path=join(f.external,'must-not-spawn.txt'),timeoutMs=40
  await f.permissions.setMode('full')
  const shell=f.agent.ctx.get('shell'),original=shell.execute,entered=Promise.withResolvers(),release=Promise.withResolvers(),aborted=Promise.withResolvers();f.releases.push(()=>release.resolve())
  let starts=0,bodySettled=false,turnSettled=false,cancelSettled=false,cancellation
  const receiptSource=f.agent.receipts,terminalEntered=Promise.withResolvers(),terminalRelease=Promise.withResolvers();let terminalSeen=false
  if(mode==='background-prepare-error')f.agent.receipts={...receiptSource,append(receipt){if(receipt.domain==='job'&&receipt.kind==='settled')terminalSeen=true;return receiptSource.append(receipt)},async commit(){if(terminalSeen){terminalEntered.resolve();await terminalRelease.promise}return receiptSource.commit()}}
  const off=f.agent.ctx.on('tools/execute',async(exec,next)=>{if(exec.agent!==f.agent||exec.name!=='pwsh')return next();try{return await next()}finally{bodySettled=true}})
  shell.execute=async function(spec){const stop=()=>aborted.resolve();spec.signal.addEventListener('abort',stop,{once:true});try{entered.resolve();await release.promise;if(mode==='background-prepare-error')throw Error('fixture preparation failed');spec.signal.throwIfAborted();starts++;return Reflect.apply(original,this,[spec])}finally{spec.signal.removeEventListener('abort',stop)}}
  const running=f.run('pwsh',{description:'验证准备期间取消与排空不提前结算',command:'[IO.File]::WriteAllText('+permissionPsQuote(path)+",'must-not-commit')",run_in_background:mode.startsWith('background-'),timeoutMs}).catch(error=>error).finally(()=>{turnSettled=true})
  try{
   await permissionStage(entered.promise,running,'the controlled execution stage')
   if(mode==='background-prepare-error'){release.resolve();await permissionStage(terminalEntered.promise,running,'the real Job terminal commit')}
   else{if(mode!=='preparation-timeout')cancellation=f.agent.cancel({kind:'user'}).finally(()=>{cancelSettled=true});await permissionStage(aborted.promise,running,'preparation abort propagation')}
   await permissionTick(timeoutMs*3)
   const statuses=f.f.host.ctx.jobs.list(f.agent.id).map(job=>job.status)
   observations.push({mode,bodySettled,turnSettled,cancelSettled,statuses})
   t.diagnostic(JSON.stringify({heldPreparation:observations.at(-1)}))
   assert.equal(starts,0);await permissionAbsent(path)
  }finally{
   release.resolve();terminalRelease.resolve();await cancellation;await running
   const jobs=f.f.host.ctx.jobs
   for(const job of jobs.list(f.agent.id)){let terminal;do{terminal=await jobs.wait(job.id,1000,f.agent.id)}while(['running','stopping'].includes(terminal.status))}
   shell.execute=original;f.agent.receipts=receiptSource;off()
  }
  assert.equal(starts,0);await permissionAbsent(path)
  if(mode==='background-prepare-error'){const result=permissionResults(f.agent).at(-1);assert.equal(result.isError,true);assert.match(JSON.stringify(result),/fixture preparation failed/);assert.deepEqual(f.f.host.ctx.jobs.list(f.agent.id),[])}
  assert.ok(f.f.host.ctx.jobs.list(f.agent.id).every(job=>['completed','failed','killed'].includes(job.status)))
 }
 assert.ok(observations.every(row=>!row.bodySettled&&!row.turnSettled&&!row.cancelSettled),'Tool body, turn and cancellation must stay pending while admitted preparation is held: '+JSON.stringify(observations))
})

test('default Host nonportable shared writer consumes the actual one-call file grant',async t=>{
 const f=await permissionWireFixture(t,{portable:false}),path=join(f.external,'nonportable.txt')
 const running=f.run('write',{path,content:'NONPORTABLE_ONCE'}),row=await pendingPermission(f,running)
 await f.permissions.respond(row.id,'allow');await running
 assert.equal(await readFile(path,'utf8'),'NONPORTABLE_ONCE');assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).revocable,false)
 await assert.rejects(f.permissions.respond(row.id,'allow'),{code:'PERMISSION_REQUEST_EXPIRED'})
})

for(const portable of [true,false])test('default Host exact shared writer refuses a last-await alias swap in '+(portable?'portable':'nonportable')+' mode',async t=>{
 const f=await permissionWireFixture(t,{portable}),a=join(f.external,'before'),b=join(f.external,'after'),alias=join(f.external,'last-alias')
 await mkdir(a);await mkdir(b);await writeFile(join(a,'document.txt'),'original');await writeFile(join(b,'document.txt'),'neighbor');await symlink(a,alias)
 const path=join(alias,'document.txt');await f.run('read',{path})
 const fs=f.agent.ctx.get('agentPresets').serviceFor(f.agent,'fs'),original=fs.checkedTarget,write=fs.writeText,entered=Promise.withResolvers(),release=Promise.withResolvers();f.releases.push(()=>release.resolve())
 let writing=false
 fs.writeText=async function(...args){writing=true;try{return await Reflect.apply(write,this,args)}finally{writing=false}}
 fs.checkedTarget=async function(...args){const target=await Reflect.apply(original,this,args);if(writing&&target.displayPath===path){t.diagnostic(JSON.stringify({stage:'shared-writer-final-await',portable}));entered.resolve();await release.promise}return target}
 const running=f.run('edit',{path,edits:[{oldText:'original',newText:'UNAPPROVED_ALIAS_EFFECT'}]})
 try{
  const row=await pendingPermission(f,running);await f.permissions.respond(row.id,'allow');await permissionStage(entered.promise,running,'the shared writer final target check')
  await rm(alias,{recursive:true});await symlink(b,alias);release.resolve();await running
  assert.equal(await readFile(join(a,'document.txt'),'utf8'),'original');assert.equal(await readFile(join(b,'document.txt'),'utf8'),'neighbor')
  const result=permissionResults(f.agent).at(-1);assert.equal(result.isError,true);assert.match(JSON.stringify(result),/PERMISSION_SCOPE_CHANGED/)
 }finally{release.resolve();fs.checkedTarget=original;fs.writeText=write;await running.catch(()=>{})}
})

for(const boundary of ['cancel','mode-epoch'])test('default Host actual staged file commit aborts after '+boundary+' without publishing or retaining temp files',async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'staged-result.txt'),fs=f.agent.ctx.get('agentPresets').serviceFor(f.agent,'fs'),entered=Promise.withResolvers(),release=Promise.withResolvers(),original=fs.internals
 f.releases.push(()=>release.resolve());fs.internals={...original,inspectTemp:async()=>{entered.resolve();await release.promise}}
 const running=f.run('write',{path,content:'MUST_NOT_PUBLISH'}).catch(error=>error)
 try{
  const row=await pendingPermission(f,running);await f.permissions.respond(row.id,'allow');await permissionStage(entered.promise,running,'the real fsynced staging file')
  await permissionAbsent(path);assert.equal(f.permissions.view().requests.find(item=>item.id===row.id).revocable,false)
  if(boundary==='mode-epoch')await f.permissions.setMode('auto')
  const cancelled=boundary==='cancel'?f.agent.cancel({kind:'user'}):Promise.resolve();release.resolve();await cancelled;await running
  await permissionAbsent(path);assert.deepEqual(await readdir(f.external),[])
  await assert.rejects(f.permissions.respond(row.id,'allow'),{code:'PERMISSION_REQUEST_EXPIRED'})
 }finally{release.resolve();fs.internals=original;await running}
})
