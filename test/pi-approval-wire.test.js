import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm,mkdir,readFile,writeFile,access,readdir} from 'node:fs/promises'
import {setTimeout as permissionTick} from 'node:timers/promises'
import {memoryHost} from './fixtures/memory-host.js'
import {symlink} from './fixtures/filesystem-link.js'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
import {createHost} from '../src/host.js'
let nextInput=0
const say=async(handle,text)=>{const packet={id:'approval-input-'+(++nextInput),source:{kind:'user'},content:[{type:'text',text}]};await handle.enqueue(packet);await handle.deliver(packet.id,{deliverAs:'followUp'});await handle.whenIdle()}
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
 host=f.host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),maxParallelToolCalls:2,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_APPROVAL_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',input:['text'],contextWindow:32000,maxTokens:1024}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_APPROVAL_KEY:'fixture'}}})
 f.persisted=async()=>(await host.ctx.sessionPersistence.readNative('approval-wire',{requireComplete:true})).audit
 let effects=0
 handle=f.handle=await host.ctx.agents.create({sessionId:'approval-wire',agentOptions:{provider:'fixture',model:'m'},authorizeInput:packet=>packet.source.kind==='user',meta:{cwd:join(root,'work')},setup:async(ctx,actor)=>{
  ctx.get('tools').register({name:'sensitive',description:'Fixture requiring one approval per call',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},isConcurrencySafe:()=>true,execute:async(args,exec)=>{
   effects++;return{executed:args.id}
  }})
  ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='sensitive'?{kind:'deny',reason:'fixture denied action'}:next())
 }})
 f.effects=()=>effects
 f.store=host.ctx.get('sessionPersistence').writers.get(handle.actor.id)
 return f
}
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

// 走默认 Host/Pi/PrivateFS；本地模型只给真实工具参数。
async function permissionWireFixture(t,{portable=true}={}){
 const releases=[];t.after(()=>{for(const release of releases)release()})
 let action
 const f=await memoryHost(t,()=>{
  const next=action;action=undefined;return next
 },{portable})
 const external=join(f.root,'external-business');await mkdir(external)
 const handle=await f.agent('permission-wire'),agent=handle.agent
 return {f,external,releases,
  get agent(){return agent},
  run(tool,args){assert.equal(action,undefined);action={tool,args};return f.say(agent,'按本次明确意图执行 '+tool+' '+JSON.stringify(args)).then(value=>{t.diagnostic(JSON.stringify({permissionTool:tool,results:permissionResults(agent).slice(-1)}).split(JSON.stringify(f.root).slice(1,-1)).join('<fixture>'));return value})},
 }
}
const permissionAbsent=async path=>assert.rejects(access(path),{code:'ENOENT'})
const permissionStage=(entered,running,message)=>Promise.race([entered,running.then(()=>assert.fail(message))])
const permissionResults=agent=>agent.piSession.sessionManager.getEntries().filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)

for(const race of ['cas','symlink-swap'])test('default Host exact file grant preserves '+race+' rejection without approval',async t=>{
 const f=await permissionWireFixture(t),a=join(f.external,'original'),b=join(f.external,'replacement'),alias=join(f.external,'alias')
 await mkdir(a);await mkdir(b);await writeFile(join(a,'document.txt'),'original');await writeFile(join(b,'document.txt'),'neighbor')
 if(race==='symlink-swap')await symlink(a,alias)
 const path=join(race==='symlink-swap'?alias:a,'document.txt')
 await f.run('read',{path})
 const entered=Promise.withResolvers(),release=Promise.withResolvers();f.releases.push(()=>release.resolve())
 const off=f.f.host.ctx.on('tools/execute',async(exec,next)=>{if(exec.agent===f.agent&&exec.name==='edit'){entered.resolve();await release.promise}return next()})
 try{
  const running=f.run('edit',{path,edits:[{oldText:'original',newText:'must-not-publish'}]})
  await permissionStage(entered.promise,running,'the controlled execution stage')
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

test('authenticated web no longer offers permission modes or individual approval decisions',async t=>{
 const f=await permissionWireFixture(t)
 const web=await createWebConsole({channels:f.f.host.ctx.channels,paths:f.f.host.ctx.runtimePaths,config:{channelId:'permission-web',senderId:'isolated-operator',port:0}})
 t.after(()=>web.close())
 const token=(await readFile(web.credentialPath,'utf8')).trim()
 const headers={origin:web.origin,'content-type':'application/json'}
 const login=await fetch(web.origin+'/api/login',{method:'POST',headers,body:JSON.stringify({token})})
 assert.equal(login.status,200)
 headers.cookie=login.headers.get('set-cookie').split(';')[0];headers['x-csrf-token']=(await login.json()).csrfToken
 for(const [path,method,body] of [
  ['/api/permissions','GET'],['/api/permissions','PUT',{mode:'ask'}],
  ['/api/permissions/requests/historical','POST',{decision:'allow'}]
 ]){
  const response=await fetch(web.origin+path,{method,headers,...body&&{body:JSON.stringify(body)}})
  assert.equal(response.status,404,path)
  await response.arrayBuffer()
 }
})

test('nonportable Host writes directly without a per-call approval',async t=>{
 const f=await permissionWireFixture(t,{portable:false}),path=join(f.external,'nonportable.txt')
 await f.run('write',{path,content:'DIRECT_WRITE'})
 assert.equal(await readFile(path,'utf8'),'DIRECT_WRITE')
 assert.equal(f.f.host.ctx.get('approval'),undefined)
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
  await permissionStage(entered.promise,running,'the shared writer final target check')
  await rm(alias,{recursive:true});await symlink(b,alias);release.resolve();await running
  assert.equal(await readFile(join(a,'document.txt'),'utf8'),'original');assert.equal(await readFile(join(b,'document.txt'),'utf8'),'neighbor')
  const result=permissionResults(f.agent).at(-1);assert.equal(result.isError,true);assert.match(JSON.stringify(result),/PERMISSION_SCOPE_CHANGED/)
 }finally{release.resolve();fs.checkedTarget=original;fs.writeText=write;await running.catch(()=>{})}
})

// 使用真实task service/SQLite/目录初始化与Pi工具；只替换模型传输，不替换文件或进程执行器。
test('operator full default task preserves Host-owned materials while work tmp and external writes complete', {skip:process.platform!=='win32'?'Windows production task path':false}, async t=>{
 const {nativeTaskHost,latestInput}=await import('./fixtures/routing-official-host.js')
 const root=await mkdtemp(join(tmpdir(),'night-full-task-'));let h,taskRoot,foreignRoot,external,step=0,phase='foreign'
 t.after(async()=>{await h?.close();await rm(root,{recursive:true,force:true})})
 const complete={name:'task_result',args:{decision:{action:'complete',summary:'Verified full task files and Host-owned protection',evidence:['physical fixture files and native results'],limitations:[]}}}
 h=await nativeTaskHost(root,async(request,host)=>{
  if(!request.tools.some(tool=>tool.name==='task_result'))return []
  if(phase==='foreign')return [complete]
  if(!taskRoot){
   taskRoot=join(host.ctx.runtimePaths.workspaces,'tasks',latestInput(request).task.taskId);external=join(root,'external-business')
   await mkdir(external);await writeFile(join(taskRoot,'materials','owned.txt'),'HOST_OWNED_ORIGINAL')
   await symlink(join(taskRoot,'materials'),join(taskRoot,'work','own-materials-alias'),'dir')
   await symlink(join(foreignRoot,'materials'),join(taskRoot,'work','foreign-materials-alias'),'dir')
  }
  const calls=[
   {name:'write',args:{path:'work/full-task-work.txt',content:'FULL_TASK_WORK'}},
   {name:'write',args:{path:'tmp/full-task-tmp.txt',content:'FULL_TASK_TMP'}},
   {name:'write',args:{path:join(external,'full-task-external.txt'),content:'FULL_TASK_EXTERNAL'}},
   {name:'read',args:{path:'materials/owned.txt'}},
   {name:'edit',args:{path:'materials/owned.txt',edits:[{oldText:'HOST_OWNED_ORIGINAL',newText:'ILLEGAL_EDIT'}]}},
   {name:'read',args:{path:'materials/owned.txt'}},
   {name:'write',args:{path:'materials/owned.txt',content:'ILLEGAL_WRITE'}},
   {name:'write',args:{path:'work/own-materials-alias/owned.txt',content:'ILLEGAL_ALIAS'}},
   {name:'write',args:{path:join(foreignRoot,'materials','owned.txt'),content:'ILLEGAL_FOREIGN'}},
   {name:'write',args:{path:'work/foreign-materials-alias/owned.txt',content:'ILLEGAL_FOREIGN_ALIAS'}},
   {name:'working_directory',args:{cd:external}},
   {name:'write',args:{path:'relative-full.txt',content:'FULL_CWD_PHYSICAL'}},
   {name:'grep',args:{pattern:'FULL_CWD_PHYSICAL',path:'.'}},
   {name:'pwsh',args:{description:'Read actual child cwd after full task external cd',command:'[Environment]::CurrentDirectory'}},
   {name:'working_directory',args:{cd:taskRoot}},
  ]
  return [calls[step++]??complete]
 },{permissionMode:'full',config:{dbPath:join(root,'data','state','tasks.sqlite')}})
 assert.equal(h.ctx.get('toolPermissions').mode,'full')
 const foreign=await h.service.createTask({requestId:'full-protected-neighbor',objective:'Complete a separate isolated task archive'});await h.service.whenIdle()
 foreignRoot=join(h.ctx.runtimePaths.workspaces,'tasks',foreign.taskId);await writeFile(join(foreignRoot,'materials','owned.txt'),'FOREIGN_HOST_ORIGINAL');phase='main'
 const created=await h.service.createTask({requestId:'full-default-task-files',objective:'Verify full task work/tmp and external cd with relative tools; preserve own and neighboring Host-owned materials'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId}),results=h.toolResults.filter(row=>row.sessionId===task.sessionId),writes=results.filter(row=>row.name==='write')
 const physical=taskRoot?await readFile(join(taskRoot,'materials','owned.txt'),'utf8'):null
 t.diagnostic(JSON.stringify({case:'full-default-task-files',workspaceInitialization:task.workspaceInitialization?.state,status:task.status,drained:task.drained,modelSteps:step,tools:results.map(row=>({name:row.name,isError:row.result.isError,message:row.result.error?.message})),hostMaterialUnchanged:physical==='HOST_OWNED_ORIGINAL',alerts:h.service.listAlerts().map(row=>({id:row.id,code:row.code}))}).split(JSON.stringify(root).slice(1,-1)).join('<fixture>'))
 assert.equal(task.workspaceInitialization?.state,'ready')
 assert.equal(await readFile(join(taskRoot,'work','full-task-work.txt'),'utf8'),'FULL_TASK_WORK')
 assert.equal(await readFile(join(taskRoot,'tmp','full-task-tmp.txt'),'utf8'),'FULL_TASK_TMP')
 assert.equal(await readFile(join(external,'full-task-external.txt'),'utf8'),'FULL_TASK_EXTERNAL')
 assert.equal(results.find(row=>row.name==='edit')?.result.isError,true)
 assert.equal(writes.length,8);assert.ok(writes.slice(3,7).every(row=>row.result.isError),'own/foreign canonical and alias Host-owned writes must be refused')
 assert.equal(physical,'HOST_OWNED_ORIGINAL');assert.equal(await readFile(join(foreignRoot,'materials','owned.txt'),'utf8'),'FOREIGN_HOST_ORIGINAL')
 assert.equal(await readFile(join(external,'relative-full.txt'),'utf8'),'FULL_CWD_PHYSICAL')
 const directories=results.filter(row=>row.name==='working_directory');assert.equal(directories.length,2);assert.ok(directories.every(row=>!row.result.isError))
 const grep=results.find(row=>row.name==='grep');assert.equal(grep?.result.isError,false);assert.match(grep.result.value.text,/Found 1 matches/)
 const shell=results.find(row=>row.name==='pwsh');assert.equal(shell?.result.isError,false);assert.equal(shell.result.value.stdout.text.trim().toLowerCase(),external.toLowerCase())
 assert.equal(task.status,'completed');assert.equal(task.drained,true)
 const native=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 assert.ok(native.entries.some(row=>row.type==='message'&&row.message.role==='toolResult'&&row.message.toolName==='task_result'&&!row.message.isError))
})

// 凭据仅进可信启动快照；真实子进程只输出匹配布尔值，不记录原值。
test('operator full native task child inherits trusted business credentials without durable disclosure',async t=>{
 const {nativeTaskHost}=await import('./fixtures/routing-official-host.js'),{createHash}=await import('node:crypto')
 const root=await mkdtemp(join(tmpdir(),'night-full-task-env-')),values=Object.fromEntries(['GITHUB_TOKEN','OSS_ACCESS_KEY','OSS_SECRET_KEY','UNRELATED_FIXTURE_SECRET','NIGHT_BOT_FIXTURE_SECRET'].map((key,index)=>[key,'fixture-only-'+Date.now()+'-'+index]));let h,step=0
 t.after(async()=>{await h?.close();await rm(root,{recursive:true,force:true})})
 const expected=Object.fromEntries(Object.entries(values).filter(([key])=>!key.startsWith('NIGHT_BOT_')).map(([key,value])=>[key,createHash('sha256').update(value).digest('hex')]))
 const program=`const expected=${JSON.stringify(expected)},crypto=require("node:crypto"),matches=Object.fromEntries(Object.entries(expected).map(([key,hash])=>[key,crypto.createHash("sha256").update(process.env[key]??"").digest("hex")===hash]));process.stdout.write(JSON.stringify({matches,privateAbsent:process.env.NIGHT_BOT_FIXTURE_SECRET===undefined}))`
 const tool=process.platform==='win32'?'pwsh':'bash',command=(process.platform==='win32'?'& ':'')+`'${process.execPath}' -e '${program}'`
 h=await nativeTaskHost(root,request=>!request.tools.some(item=>item.name==='task_result')?[]:[step++===0?{name:tool,args:{description:'Verify fixture-only child environment without printing credentials',command}}:{name:'task_result',args:{decision:{action:'complete',summary:'Checked isolated child environment',evidence:['boolean child output'],limitations:[]}}}],{permissionMode:'full',inheritedEnvironment:values,config:{dbPath:join(root,'data','state','tasks.sqlite')}})
 const created=await h.service.createTask({requestId:'full-task-env-fixture',objective:'Verify only boolean environment facts in the isolated native child'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId}),result=h.toolResults.find(row=>row.sessionId===task.sessionId&&row.name===tool)?.result
 assert.ok(result);assert.equal(result.isError,false,JSON.stringify(result))
 const observed=JSON.parse(result.value.stdout.text)
 t.diagnostic(JSON.stringify({case:'full-native-task-env',...observed,status:task.status,drained:task.drained}))
 const native=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),recorded=JSON.stringify({entries:native.entries,requests:h.requests,tools:h.toolResults,jobs:h.ctx.get('jobs').list(task.sessionId)})
 for(const value of Object.values(values))assert.equal(recorded.includes(value),false)
 assert.deepEqual(observed.matches,Object.fromEntries(Object.keys(expected).map(key=>[key,true])));assert.equal(observed.privateAbsent,true)
 assert.equal(task.status,'completed');assert.equal(task.drained,true)
})

// ready文件只证明真实进程已启动；取消完成还需Job耐久终态和所有后代PID消失。
test('operator full default task cancellation drains real running descendants and cold recovery never restarts them',{skip:process.platform!=='win32'?'Windows real process tree':false},async t=>{
 const {nativeTaskHost,latestInput}=await import('./fixtures/routing-official-host.js')
 const root=await mkdtemp(join(tmpdir(),'night-full-task-cancel-')),hold=Promise.withResolvers(),modelPending=Promise.withResolvers();let h,cold,taskRoot,modelSignal,step=0
 t.after(async()=>{hold.resolve([]);await cold?.close();await h?.close();await rm(root,{recursive:true,force:true})})
 h=await nativeTaskHost(root,async(request,host,signal)=>{
  if(!request.tools.some(tool=>tool.name==='task_result'))return []
  if(step++){
   modelSignal=signal;modelPending.resolve()
   await Promise.race([hold.promise,new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true})})])
   signal.throwIfAborted();return []
  }
  taskRoot=join(host.ctx.runtimePaths.workspaces,'tasks',latestInput(request).task.taskId)
  const script=join(taskRoot,'work','process-tree.mjs')
  return [{name:'pwsh',args:{description:'Keep a real isolated process tree running until task cancellation',command:'& '+permissionPsQuote(process.execPath)+' '+permissionPsQuote(script),run_in_background:true}}]
 },{permissionMode:'full',config:{dbPath:join(root,'data','state','tasks.sqlite')}})
 const created=await h.service.createTask({requestId:'full-real-process-tree',objective:'Run one isolated real process tree and cancel it before the finish signal'}),tree=[]
 for(const role of ['parent','child','grandchild'])for(;;){
  if(!taskRoot){await permissionTick(10);continue}
  try{tree.push(JSON.parse(await readFile(join(taskRoot,'work',role+'.json'),'utf8')));break}catch(error){if(error.code!=='ENOENT')throw error;const task=await h.query('task.get',{taskId:created.taskId});assert.notEqual(task.drained,true,'producer must reach physical ready before task drain');await permissionTick(10)}
 }
 assert.equal(tree[1].ppid,tree[0].pid);assert.equal(tree[2].ppid,tree[1].pid)
 const before=await h.query('task.get',{taskId:created.taskId}),active=h.ctx.get('jobs').list(before.sessionId);assert.equal(active.filter(job=>job.kind==='pwsh'&&job.status==='running').length,1)
 await modelPending.promise;assert.equal(modelSignal.aborted,false)
 const cancelling=h.service.cancelTask({taskId:created.taskId,requestId:'full-real-process-tree-cancel'});await cancelling;assert.equal(modelSignal.aborted,true);await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId}),saved=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),registered=saved.audit.filter(row=>row.domain==='job'&&row.kind==='registered'),settled=saved.audit.filter(row=>row.domain==='job'&&row.kind==='settled')
 assert.equal(task.control,'cancelled');assert.equal(task.drained,true);assert.equal(registered.length,1);assert.equal(settled.length,1);assert.equal(settled[0].payload.producerReported,true)
 for(const item of tree)assert.throws(()=>process.kill(item.pid,0),{code:'ESRCH'})
 await writeFile(join(taskRoot,'work','finish.signal'),'after proven drain');await permissionAbsent(join(taskRoot,'work','late-effect.txt'))
 t.diagnostic(JSON.stringify({case:'full-real-running-task-cancel',descendants:tree.length,allPidsAbsent:true,pendingModelAborted:true,control:task.control,drained:task.drained,producerReported:true,registeredJobs:registered.length,settledJobs:settled.length}))
 await h.close();cold=await nativeTaskHost(root,request=>request.tools.some(tool=>tool.name==='task_result')?assert.fail('cold cancelled task must never call the model or restart its producer'):[],{permissionMode:'full',initialize:false,config:{dbPath:join(root,'data','state','tasks.sqlite')}})
 await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.requests.filter(request=>request.tools.some(tool=>tool.name==='task_result')).length,0)
 const restored=await cold.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true});assert.equal(restored.audit.filter(row=>row.domain==='job'&&row.kind==='registered').length,1);assert.equal(restored.audit.filter(row=>row.domain==='job'&&row.kind==='settled').length,1)
 await permissionAbsent(join(taskRoot,'work','late-effect.txt'));for(const item of tree)assert.throws(()=>process.kill(item.pid,0),{code:'ESRCH'})
})

// 仅令真实提交后的renderer失败一次；原生write/definition身份和effect-intent链不替换。
test('operator full native task committed write with render failure remains unknown through same archive cold recovery',{skip:process.platform!=='win32'?'Windows default task boundary':false},async t=>{
 const {nativeTaskHost}=await import('./fixtures/routing-official-host.js'),{stat}=await import('node:fs/promises')
 const root=await mkdtemp(join(tmpdir(),'night-full-task-unknown-')),external=join(root,'external-business'),target=join(external,'committed-once.txt');let h,cold,off,renderFailures=0
 t.after(async()=>{off?.();await cold?.close();await h?.close()})
 await mkdir(external)
 h=await nativeTaskHost(root,request=>!request.tools.some(tool=>tool.name==='task_result')||renderFailures?[]:[{name:'write',args:{path:target,content:'FULL_UNKNOWN_ORIGINAL'}}],{permissionMode:'full',config:{dbPath:join(root,'data','state','tasks.sqlite')}})
 off=h.ctx.on('tools/execute',async(exec,next)=>{
  if(exec.name!=='write'||exec.arguments.path!==target)return next()
  const definition=h.ctx.get('tools').get(exec.name,exec.agent),render=definition.output.render
  definition.output.render=(...args)=>{if(renderFailures++===0)throw Error('Fixture renderer failed after actual native commit');return render(...args)}
  try{return await next()}finally{definition.output.render=render}
 })
 const created=await h.service.createTask({requestId:'full-unknown-real-commit',objective:'Perform one native external write; never repeat a commit whose presentation failed'})
 await h.service.whenIdle();off();off=undefined
 const task=await h.query('task.get',{taskId:created.taskId}),before=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),physical=await stat(target)
 assert.equal(await readFile(target,'utf8'),'FULL_UNKNOWN_ORIGINAL');assert.equal(renderFailures,1);assert.equal(task.drained,true);assert.ok(task.lastDecision.limitations.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY'))
 const effects=audit=>audit.filter(row=>row.domain==='task'&&row.kind.startsWith('effect-'))
 assert.equal(effects(before.audit).filter(row=>row.kind==='effect-intent').length,1);assert.equal(effects(before.audit).filter(row=>row.kind==='effect-result').length,0)
 await h.close();cold=await nativeTaskHost(root,request=>request.tools.some(tool=>tool.name==='task_result')?assert.fail('unresolved committed effect must fence cold model and tool replay'):[],{permissionMode:'full',initialize:false,config:{dbPath:join(root,'data','state','tasks.sqlite')}})
 await cold.service.recover();await cold.service.whenIdle()
 const after=await cold.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),restored=await cold.query('task.get',{taskId:task.taskId})
 assert.equal(cold.requests.filter(request=>request.tools.some(tool=>tool.name==='task_result')).length,0);assert.deepEqual(effects(after.audit),effects(before.audit));assert.equal(restored.drained,true)
 assert.equal(await readFile(target,'utf8'),'FULL_UNKNOWN_ORIGINAL');assert.equal((await stat(target)).mtimeMs,physical.mtimeMs)
 t.diagnostic(JSON.stringify({case:'full-committed-effect-unknown-cold',renderFailures,committedFileUnchanged:true,unknownIntents:1,successResults:0,coldModelCalls:0,unknownPreserved:true,isolatedArchive:root}))
})

test('cancelling a staged native file write leaves no published or temporary files',async t=>{
 const f=await permissionWireFixture(t),path=join(f.external,'full-staged.txt'),fs=f.agent.ctx.get('agentPresets').serviceFor(f.agent,'fs'),entered=Promise.withResolvers(),release=Promise.withResolvers(),original=fs.internals
 f.releases.push(()=>release.resolve());fs.internals={...original,inspectTemp:async()=>{entered.resolve();await release.promise}}
 const running=f.run('write',{path,content:'MUST_NOT_PUBLISH'}).catch(error=>error)
 try{
  await permissionStage(entered.promise,running,'the actual full fsynced staging file');await permissionAbsent(path)
  const cancelling=f.agent.cancel({kind:'user'});release.resolve();await cancelling;await running
  await permissionAbsent(path);assert.deepEqual(await readdir(f.external),[])
 }finally{release.resolve();fs.internals=original;await running}
})

// 安装内路径可以迁移；external-absolute只保留业务cwd原地址，不能扩展到其它审计领域。
test('operator full external cwd survives cold backup relocation without rewriting its absolute business path',async t=>{
 const {backupData,restoreData}=await import('../src/runtime/backup.js'),{validateAuditPathBindings}=await import('../src/runtime/pi-business-path-bindings.js')
 let target,resumed;t.after(async()=>{await resumed?.dispose();await target?.close()})
 const f=await permissionWireFixture(t);await writeFile(join(f.external,'original.txt'),'EXTERNAL_LOCATION_UNCHANGED')
 await f.run('working_directory',{cd:f.external});assert.equal(permissionResults(f.agent).at(-1).isError,false)
 const id=f.agent.id,before=await f.f.host.ctx.sessionPersistence.readNative(id,{requireComplete:true}),receipt=before.audit.findLast(row=>row.domain==='directory'&&row.kind==='changed')
 assert.equal(receipt.pathBindings.kind,'external-absolute');assert.equal(receipt.payload.cwd,f.external)
 const invalid={...structuredClone(receipt),domain:'sandbox',kind:'permissions',payload:{preset:'danger-full-access'}}
 assert.throws(()=>validateAuditPathBindings(invalid),{code:'PI_SESSION_AUDIT_PATH_BINDING_INVALID'})
 const bytes=await readFile(f.f.host.ctx.sessionPersistence.path(id));await f.f.close()
 const backup=join(f.f.root,'backups','external-cwd'),installRoot=join(f.f.root,'relocated-installation'),config={...f.f.config,installRoot}
 await backupData(f.f.config,backup);await restoreData(config,backup)
 target=await createHost(config,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}})
 const stored=await target.ctx.sessionPersistence.readNative(id,{requireComplete:true}),current=stored.audit.findLast(row=>row.domain==='directory'&&row.kind==='changed')
 assert.equal(current.pathBindings.kind,'external-absolute');assert.equal(current.payload.cwd,f.external);assert.deepEqual(stored.entries,before.entries);assert.deepEqual(await readFile(target.ctx.sessionPersistence.path(id)),bytes)
 resumed=await target.ctx.agents.resume({resumeSessionId:id,agentOptions:config.model,authorizeInput:packet=>packet.source.kind==='user',setup:ctx=>target.ctx.agentPresets.mount(ctx,'night-bot')})
 assert.equal(resumed.agent.ctx.get('workingDirectory').get(resumed.agent),f.external);assert.equal(await readFile(join(f.external,'original.txt'),'utf8'),'EXTERNAL_LOCATION_UNCHANGED')
 t.diagnostic(JSON.stringify({case:'full-external-cwd-backup-cold',externalAbsolutePreserved:true,piBytesUnchanged:true,otherDomainExternalBindingRefused:true}))
})
