import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {memoryHost} from './fixtures/memory-host.js'

async function create(f,id,{permission='workspace-write'}={}){
 return f.host.ctx.agents.create({sessionId:id,meta:{cwd:f.host.ctx.runtimePaths.workspaces,agentPreset:'night-bot-task'},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='test-input'&&packet.source.principal==='authorized-fixture',setup:async(ctx,actor)=>{await ctx.get('agentPresets').mount(ctx,'night-bot-task');await ctx.get('permissionPresets').set(actor,permission)}})
}
test('default Host publishes a real official SDK, scoped resources and durable input without legacy Session',async t=>{
 const f=await memoryHost(t),h=await create(f,'official-default')
 t.after(()=>h.dispose())
 assert.ok(h.session instanceof AgentSession);assert.equal(h.agent.session,undefined)
 assert.equal(f.host.ctx.get('agentLoop'),undefined)
 assert.equal(typeof h.agent.admission.deliver,'undefined','raw queue cannot send to a caller-selected SDK session')
 await h.enqueue({id:'host-input',source:{kind:'test-input',principal:'authorized-fixture'},content:'NIGHT_OFFICIAL_HOST_SMOKE'})
 await h.deliver('host-input');await h.whenIdle()
 assert.equal(f.requests.length,1)
 assert.equal(h.agent.admission.status('host-input'),'admitted')
 assert.ok(h.session.messages.some(message=>message.role==='assistant'))
 const stored=await f.host.ctx.sessionPersistence.readNative(h.agent.id,{requireComplete:true})
 assert.equal(stored.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted').length,1)
 assert.equal(stored.context.projection.model.provider,'fixture')
 assert.equal(stored.context.projection.model.modelId,'m')
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const first=h.runMaintenance(async actor=>{assert.equal(actor.admission.paused,true);entered.resolve();await release.promise})
 await entered.promise;const second=h.runMaintenance(async actor=>{assert.equal(actor.admission.paused,true)})
 release.resolve();await Promise.all([first,second]);assert.equal(h.agent.admission.paused,false)
})
test('default read-only file tool cannot inherit the deployment write policy',async t=>{
 let calls=0
 const f=await memoryHost(t,()=>++calls===1?{tool:'write',args:{path:'forbidden.txt',content:'must not write'}}:{text:'verified denial'})
 const h=await create(f,'official-read-only',{permission:'read-only'});t.after(()=>h.dispose())
 await h.enqueue({id:'readonly-input',source:{kind:'test-input',principal:'authorized-fixture'},content:'Exercise the read-only boundary'})
 await h.deliver('readonly-input');await h.whenIdle()
 assert.ok(h.session.messages.some(message=>message.role==='toolResult'&&message.isError))
 assert.equal(h.agent.ctx.get('sandboxPolicy').resolve({actor:h.agent}).mode,'read-only')
 await assert.rejects(readFile(join(f.host.ctx.runtimePaths.workspaces,'forbidden.txt')),{code:'ENOENT'})
})

function shutdownFixtureConfig(root){return {installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',apiKeyEnv:'SHUTDOWN_FIXTURE_KEY',models:[{id:'m',input:['text'],contextWindow:4096,maxTokens:128}]}},memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false}}
async function shutdownFailureChild(kind,root,urls,config){
 const assert=(await import('node:assert/strict')).default,{createHost}=await import(urls.host),application=await import(urls.application),{readFile}=await import('node:fs/promises'),{join}=await import('node:path'),{createServer}=await import('node:http')
 const options={environmentOptions:{inherited:{SHUTDOWN_FIXTURE_KEY:'synthetic-local-only'}}},trace=[],prior=Error('SHUTDOWN_FAILURE_'+kind),startupError=Error('SHUTDOWN_STARTUP_FAILURE'),original={},targets={},closeFailures={},done=Promise.withResolvers(),contains=(value,target)=>value===target||value?.errors?.some(error=>contains(error,target))
 let host,ctx,app,port,jobId,producerActor,modelServer,modelRequests=0,runtimeClosed=false,fault
 const wrap=(target,key,label,action)=>{const raw=target[key].bind(target);original[label]=raw;targets[label]=target;target[key]=async(...args)=>{trace.push(label);try{return await(action?action(raw,args):raw(...args))}catch(error){closeFailures[label]=error;throw error}}}
 async function install(current){
  ctx=current
  wrap(ctx.get('officialAgentFactory'),'close','factory',kind==='factory'||kind==='startup'?async raw=>{await raw();throw prior}:undefined)
  wrap(ctx.get('jobs'),'disposeAll','jobs')
  wrap(ctx.get('subprocess'),'disposeManagedProcesses','process')
 }
 try{
  if(kind==='startup'){
   globalThis.__nightShutdownStartup=async child=>{
    await install(child.root);const service=child.get('agentPresets'),raw=service.resolve.bind(service);original.resolve=raw;service.resolve=async(...args)=>{if(args[0]==='night-bot')throw startupError;return raw(...args)}
   }
   const source="export default {inject:['agentPresets','officialAgentFactory','jobs','subprocess'],apply(child){return globalThis.__nightShutdownStartup(child)}}"
   await assert.rejects(createHost(config,{...options,extraPlugins:[{name:'data:text/javascript,'+encodeURIComponent(source)}]}),error=>{fault=error;return contains(error,startupError)&&contains(error,prior)})
  }else{
   if(kind==='jobs'){
    modelServer=createServer(async(req,res)=>{
     for await(const _chunk of req){}
     const first=++modelRequests===1
     res.writeHead(200,{'content-type':'text/event-stream'})
     const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'shutdown-model',object:'chat.completion.chunk',created:1,model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
     chunk(first?{role:'assistant',tool_calls:[{index:0,id:'shutdown-durable-call',type:'function',function:{name:'shutdown_launch',arguments:'{}'}}]}:{role:'assistant',content:'producer registered'})
     chunk({},first?'tool_calls':'stop');res.end('data: [DONE]\n\n')
    })
    await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve))
    config.providers.fixture.baseURL='http://127.0.0.1:'+modelServer.address().port+'/v1'
   }
   host=await createHost(config,options);await install(host.ctx)
   const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve))
   await ctx.plugin(application,{...config,resident:{host:'127.0.0.1',port,taskSessions:{initialize:true,instanceId:'close-'+kind,ownerActorId:'fixture-owner',webActorId:'fixture-owner',ingressEpoch:new Date().toISOString()}}})
   app=ctx.get('application');assert.ok(app)
   wrap(app.tasks,'close','tasks',kind==='tasks'?async()=>{throw prior}:undefined)
   wrap(app.runtime,'close','runtime',async raw=>{await raw();runtimeClosed=true})
   if(kind==='stopping')ctx.on('night/stopping',()=>{trace.push('stopping');throw prior})
   if(kind==='jobs'){
    ctx.jobs.attachController('shutdown-failure-fixture')
    ctx.tools.register({name:'shutdown_launch',description:'Start isolated in-process shutdown fixture',parameters:{type:'object'},output:{schema:{type:'object'},render:()=>[{type:'text',text:'fixture registered'}]},execute:async(_args,exec)=>{
     jobId=await ctx.jobs.startDurable({kind:'shutdown-fixture',label:'durable in-process producer with uncertain cancellation',owner:exec.agent.id,run:()=>({done:done.promise,cancel(){trace.push('producer-cancel');throw prior}})},exec)
     return {id:jobId}
    }})
    const actor=await ctx.agents.create({sessionId:'shutdown-producer',meta:{cwd:ctx.runtimePaths.workspaces,agentPreset:'night-bot-task'},agentOptions:config.model,authorizeInput:packet=>packet.source.kind==='shutdown-fixture',setup:async child=>{await child.get('agentPresets').mount(child,'night-bot-task')}})
    producerActor=actor.agent
    await actor.enqueue({id:'shutdown-input',source:{kind:'shutdown-fixture'},content:'Start the isolated fixture producer once.'});await actor.deliver('shutdown-input');await actor.whenIdle()
    assert.equal(modelRequests,2);assert.equal(typeof jobId,'string')
    const registered=(await producerActor.receipts.read()).filter(row=>row.domain==='job'&&row.kind==='registered')
    assert.equal(registered.length,1);assert.equal(registered[0].payload.jobId,jobId);assert.equal(registered[0].payload.toolCall.callId,'shutdown-durable-call')
   }
   if(kind==='ephemeral'){
    ctx.jobs.attachController('shutdown-ephemeral-fixture')
    jobId=ctx.jobs.start({kind:'shutdown-fixture',label:'ephemeral pending producer',run:()=>({done:done.promise,cancel(){trace.push('producer-cancel');throw prior}})})
   }
   if(kind==='early-remove'){
    ctx.jobs.attachController('shutdown-early-fixture')
    jobId=ctx.jobs.start({kind:'shutdown-fixture',label:'early cancellation cannot erase unknown producer',run({id}){ctx.jobs.kill(id,undefined,'during startup');return{done:done.promise,cancel(){trace.push('producer-cancel');throw prior}}}})
    assert.equal(ctx.jobs.records.get(jobId).drainUncertain,true)
    assert.throws(()=>ctx.jobs.remove(jobId),error=>error.code==='NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN')
    assert.equal(ctx.jobs.records.has(jobId),true)
   }
   const closing=host.close();assert.equal(host.close(),closing)
   await assert.rejects(closing,error=>{fault=error;return ['jobs','ephemeral','early-remove'].includes(kind)?JSON.stringify(error,(key,value)=>value instanceof Error?{message:value.message,errors:value.errors}:value).includes('NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN'):contains(error,prior)})
   assert.ok(trace.indexOf('process')>trace.indexOf('jobs'));assert.ok(trace.includes('factory'))
   await assert.rejects(fetch('http://127.0.0.1:'+port+'/tasks'),error=>error.cause?.code==='ECONNREFUSED')
   if(kind==='tasks'){
    assert.equal(runtimeClosed,false);assert.doesNotThrow(()=>app.store.getGroup('unseen-fixture-group'));assert.ok(Array.isArray(app.runtime.listRecoveryIssues()))
   }else assert.equal(runtimeClosed,true)
   if(['ephemeral','early-remove'].includes(kind)){assert.ok(contains(fault,closeFailures.jobs));assert.equal(ctx.jobs.records.get(jobId).drainUncertain,true);assert.equal(ctx.jobs.get(jobId).status,'failed')}
   if(kind==='jobs'){
    assert.ok(contains(fault,closeFailures.factory));assert.ok(contains(fault,closeFailures.jobs));assert.equal(ctx.jobs.records.get(jobId).drainUncertain,true);assert.equal(ctx.jobs.get(jobId,producerActor.id).status,'failed')
    const settled=(await producerActor.receipts.read()).filter(row=>row.domain==='job'&&row.kind==='settled')
    assert.equal(settled.length,1);assert.equal(settled[0].payload.producerReported,false);assert.equal(settled[0].payload.toolCall.callId,'shutdown-durable-call')
   }
  }
  assert.ok(fault);ctx.fiber.assertActive();assert.ok(ctx.get('sessionPersistence'));assert.ok(trace.includes('jobs')&&trace.includes('process'))
  const ownerFile=join(root,'data','runtime','.host.lock','owner.json'),owner=await readFile(ownerFile,'utf8');assert.equal(JSON.parse(owner).pid,process.pid)
  await assert.rejects(createHost(config,options),{code:'NIGHT_DATA_IN_USE'})
  assert.equal(await readFile(ownerFile,'utf8'),owner);ctx.fiber.assertActive()
  console.log('HOST_CLOSE_PROBE:'+JSON.stringify({kind,trace,originalErrorsPreserved:['jobs','ephemeral','early-remove'].includes(kind)?'real producer drain uncertainty':true,runtimeRetained:kind==='tasks',httpStopped:kind!=='startup',rootRetained:true,secondHostRejected:true,ownerPid:process.pid}))
 }catch(error){console.error('HOST_CLOSE_FAILURE:'+JSON.stringify({kind,root,trace,error:String(error),stack:error.stack}));throw error}finally{
  // 只在合成producer终态后卸载故障夹具；不重试失败Host.close或手删活锁。
  done.resolve({status:'killed'});await done.promise;await new Promise(setImmediate)
  delete globalThis.__nightShutdownStartup
  if(ctx){
   if(original.resolve)ctx.get('agentPresets').resolve=original.resolve
   for(const [key,label] of [['close','factory'],['disposeAll','jobs'],['disposeManagedProcesses','process']])if(original[label])targets[label][key]=original[label]
   if(app){app.tasks.close=original.tasks;app.runtime.close=original.runtime;await original.tasks();await original.runtime()}
   // 已失败的memoized关闭不重试；原异常仍在fault，合成producer已真实结束，无外部OS资源。
   for(const label of ['factory','jobs'])if(!closeFailures[label])await original[label]?.()
   await original.process?.();await ctx.fiber.dispose()
  }
  if(modelServer)await new Promise((resolve,reject)=>modelServer.close(error=>error?reject(error):resolve()))
 }
}
async function runShutdownFailure(t,kind){
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{spawn}=await import('node:child_process'),{createHost}=await import('../src/host.js')
 const root=await mkdtemp(join(tmpdir(),'night-host-close-'+kind+'-')),config=shutdownFixtureConfig(root),urls={host:new URL('../src/host.js',import.meta.url).href,application:new URL('../src/application.js',import.meta.url).href}
 const script='await ('+shutdownFailureChild.toString()+')('+JSON.stringify(kind)+','+JSON.stringify(root)+','+JSON.stringify(urls)+','+JSON.stringify(config)+')'
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']}),output=[],errors=[];child.stdout.on('data',chunk=>output.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk))
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});assert.equal(code,0,Buffer.concat(output).toString()+Buffer.concat(errors).toString())
 t.after(()=>rm(root,{recursive:true,force:true}))
 const lines=Buffer.concat(output).toString().split('\n').filter(line=>line.startsWith('HOST_CLOSE_PROBE:'));assert.equal(lines.length,1);const observed=JSON.parse(lines[0].slice('HOST_CLOSE_PROBE:'.length));assert.equal(observed.kind,kind);assert.equal(observed.ownerPid,child.pid);assert.equal(observed.secondHostRejected,true)
 const owner=JSON.parse(await readFile(join(root,'data','runtime','.host.lock','owner.json'),'utf8'));assert.equal(owner.pid,child.pid)
 const reopened=await createHost(config,{environmentOptions:{inherited:{SHUTDOWN_FIXTURE_KEY:'synthetic-local-only'}}});await reopened.close();await assert.rejects(readFile(join(root,'data','runtime','.host.lock','owner.json')),{code:'ENOENT'})
 t.diagnostic(JSON.stringify({...observed,childNaturalExit:code,deadOwnerRecoveredByOfficialHost:true}))
}
test('Host close memoizes its promise and retains the installation lease until an actual producer joins',async t=>{
 const f=await memoryHost(t),ctx=f.host.ctx,done=Promise.withResolvers(),cancelled=Promise.withResolvers();ctx.jobs.attachController('shutdown-normal-fixture')
 ctx.jobs.start({kind:'shutdown-fixture',label:'normal producer join gate',run:()=>({done:done.promise,cancel(){cancelled.resolve()}})})
 const closing=f.host.close();assert.equal(f.host.close(),closing)
 try{
 await cancelled.promise
 const {createHost}=await import('../src/host.js');await assert.rejects(createHost(f.config,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}}),{code:'NIGHT_DATA_IN_USE'})
 done.resolve({status:'killed'});await closing;await f.close();await f.boot();await f.close();assert.equal(f.requests.length,0)
 }finally{done.resolve({status:'killed'});await closing}
})
test('Application stopping and task close errors still stop HTTP and preserve the required runtime and Host ownership',async t=>{
 for(const kind of ['stopping','tasks'])await runShutdownFailure(t,kind)
})
test('Host factory and real Job drain errors still attempt process join and retain the live installation lease',async t=>{
 for(const kind of ['factory','jobs','ephemeral','early-remove'])await runShutdownFailure(t,kind)
})
test('Host startup failure uses the same ownership retention gate and preserves startup and cleanup errors',async t=>{
 await runShutdownFailure(t,'startup')
})
