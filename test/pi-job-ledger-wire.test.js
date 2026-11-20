import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
import {decodePiJournal} from '../src/runtime/pi-journal.js'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'
async function parentOf(f,id){const h=await f.host.ctx.agents.create({sessionId:id,meta:{cwd:join(f.root,'work')},agentOptions:{provider:'fixture',model:'m'},authorizeInput:(p,a)=>a.id===id&&p.source.kind==='fixture-user',setup:async ctx=>{await ctx.get('agentPresets').mount(ctx,'night-bot')}});f.handles.push(h);return h.actor}
async function prompt(actor,text){const p={id:'job-ledger-input',source:{kind:'fixture-user'},content:text};await actor.input.enqueue(p);await actor.input.deliver(p.id);await actor.whenIdle()}

test('real Pi call owns a committed job receipt and cold inspection never relaunches its producer',async t=>{
 const done=Promise.withResolvers();let starts=0,parent,path,atLaunch
 const f=await subagentFixture(t,(_,f)=>f.requests.length===1?{tools:[{id:'durable-call',name:'launch_durable_fixture',args:{}}]}:{text:'job admitted'})
 f.cleanup.push(()=>done.resolve({status:'killed'}))
 f.host.ctx.tools.register({name:'launch_durable_fixture',description:'Start an isolated test producer',parameters:{type:'object'},output:{schema:{type:'object'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_,exec){
  const id=await f.host.ctx.jobs.startDurable({kind:'fixture',label:'one real Pi call',owner:exec.agent.id,run(){starts++;atLaunch=decodePiJournal(readFileSync(path),parent.id,{requireComplete:true});return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec)
  return{jobId:id}
 }})
 parent=await parentOf(f,'durable-job-owner');path=f.host.ctx.sessionPersistence.path(parent.id)
 await prompt(parent,'Admit one owned fixture job')
 assert.equal(starts,1)
 const callIndex=atLaunch.entries.findIndex(e=>e.type==='message'&&e.message.role==='assistant'&&e.message.content.some(b=>b.type==='toolCall'&&b.id==='durable-call')),registeredIndex=atLaunch.entries.findIndex(e=>e.type==='custom'&&e.customType==='night.audit'&&e.data.domain==='job'&&e.data.kind==='registered'),registered=atLaunch.audit.find(r=>r.domain==='job'&&r.kind==='registered').payload
 assert.ok(callIndex>=0);assert.ok(registeredIndex>callIndex);assert.equal(registered.toolCall.callId,'durable-call')
 const wait=f.host.ctx.jobs.wait(registered.jobId,1000,parent.id);done.resolve({status:'completed',detail:'exit code: 0'});await wait
 const saved=await f.host.ctx.sessionPersistence.readNative(parent.id),settled=saved.audit.find(r=>r.domain==='job'&&r.kind==='settled')
 assert.equal(settled.payload.producerReported,true);assert.equal(settled.payload.toolCall.callId,'durable-call')
 for(const handle of f.handles.splice(0))await handle.dispose();await f.host.close()
 const bytes=await readFile(path),requests=f.requests.length
 const resumed=await createHost({stateDir:join(f.root,'state'),workspaceDir:join(f.root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m'}]}}})
 try{assert.deepEqual(resumed.ctx.jobs.list(parent.id),[]);const cold=await resumed.ctx.sessionPersistence.readNative(parent.id);assert.deepEqual(cold.audit,saved.audit);assert.deepEqual(cold.entries,saved.entries);assert.equal(starts,1);assert.equal(f.requests.length,requests);assert.deepEqual(await readFile(path),bytes)}finally{await resumed.close()}
})

test('cold Pi receives new input without polling, closing or restarting an unresolved producer',async t=>{
 const {mkdir,copyFile}=await import('node:fs/promises'),{basename}=await import('node:path')
 const done=Promise.withResolvers();let parent,starts=0
 const f=await subagentFixture(t,(_,f)=>f.requests.length===1?{tools:[{id:'unresolved-call',name:'leave_owned_job',args:{}}]}:{text:'job remains owned'})
 f.cleanup.push(()=>done.resolve({status:'killed'}))
 f.host.ctx.tools.register({name:'leave_owned_job',description:'Admit a test-only pending producer',parameters:{type:'object'},output:{schema:{type:'string'},render:(_,id)=>[{type:'text',text:id}]},execute:(_,exec)=>f.host.ctx.jobs.startDurable({kind:'fixture',label:'unresolved crash fixture',owner:exec.agent.id,run(){starts++;return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec)})
 parent=await parentOf(f,'cold-unresolved-job');await prompt(parent,'Leave one pending fixture producer')
 const original=f.host.ctx.sessionPersistence.path(parent.id),coldState=join(f.root,'cold-state');await mkdir(join(coldState,'sessions'),{recursive:true});await copyFile(original,join(coldState,'sessions',basename(original)))
 const config={stateDir:coldState,workspaceDir:join(f.root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'COLD_JOB_FIXTURE_KEY',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m',maxTokens:256,contextWindow:16384}]}}}
 const script=`
  import assert from 'node:assert/strict';
  import {createHost} from './src/host.js';
  import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
  const cold=await createHost(${JSON.stringify(config)},{environmentOptions:{inherited:{COLD_JOB_FIXTURE_KEY:'fixture-only'}}});
  let modelCalls=0;
  const official=cold.ctx.nativePiProvider.official,resolve=official.resolve.bind(official);
  official.resolve=async(...args)=>{const result=await resolve(...args);result.modelRuntime.streamSimple=(model,context)=>{
   modelCalls++;assert.match(JSON.stringify(context.messages),/Do not replay unresolved effects/);
   const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[{type:'text',text:'New input read; old producer not replayed'}],timestamp:Date.now(),stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   stream.push({type:'done',reason:'stop',message});stream.end(message);return stream;
  };return result};
  const handle=await cold.ctx.agents.resume({resumeSessionId:${JSON.stringify(parent.id)},authorizeInput:(p,a)=>a.id===${JSON.stringify(parent.id)}&&p.id==='cold-input'&&p.source.kind==='fixture-user'});
  await handle.enqueue({id:'cold-input',source:{kind:'fixture-user'},content:'Do not replay unresolved effects'});
  await handle.deliver('cold-input');await handle.whenIdle();
  assert.equal(modelCalls,1);assert.deepEqual(cold.ctx.jobs.list(handle.actor.id),[]);
  await handle.dispose();assert.equal(cold.ctx.agents.get(handle.actor.id),undefined);
  const saved=await cold.ctx.sessionPersistence.readNative(handle.actor.id,{requireComplete:true});
  assert.match(JSON.stringify(saved.entries),/New input read; old producer not replayed/);
  assert.deepEqual(saved.audit.filter(row=>row.domain==='job').map(row=>row.kind),['registered']);
  await cold.close();process.send({modelCalls,producerRecords:0});
 `
 const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','pipe','pipe','ipc']});let output=''
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output+=chunk)
 const exited=once(child,'close'),signal=AbortSignal.any([t.signal,AbortSignal.timeout(nativeTestTimeout(10000))])
 try{
  const [proof]=await Promise.race([once(child,'message',{signal}),exited.then(result=>assert.fail(JSON.stringify(result)+output))])
  assert.deepEqual(proof,{modelCalls:1,producerRecords:0});assert.equal(starts,1)
 }catch(error){throw new Error('Cold unresolved-job proof did not complete: '+output,{cause:error})}
 finally{child.kill('SIGTERM');await exited}
})
