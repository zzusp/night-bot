import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {Context} from '@deepseek-ai/cordis'
import NativeSessions from '../src/native-sessions.js'
import NativeAgents from '../src/native-agents.js'
import NativeTools from '../src/native-tools.js'
import NativeJobs from '../src/native-jobs.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {createScope} from '../src/native-scope.js'
import {decodePiJournal} from '../src/runtime/pi-journal.js'
import {JOB_REGISTERED,JOB_SETTLED,JOB_NOT_STARTED} from '../src/runtime/job-ledger.js'

const tick=()=>new Promise(r=>setImmediate(r))
async function fixture(t,{max=2}={}){
 const root=await mkdtemp('/tmp/night-job-ledger-'),ctx=new Context(),warnings=[]
 ctx.logger={warn:error=>warnings.push(String(error))};ctx.provide('systemPrompt',{tools(){},section(){},getSectionOrder(){return 0}})
 new NativeSessions(ctx);new NativeAgents(ctx);new NativeTools(ctx);new NativeJobs(ctx,{maxConcurrentJobsPerOwner:max,pumpPollMs:1});authority(ctx)
 const backend=new PiPersistence(ctx,{root:root+'/sessions'}),session=ctx.sessions.create('owned',{meta:{cwd:root}})
 const writer=await backend.create(session.header);await writer.flush()
 const agent={id:session.id,session,status:'idle'},scope=createScope(ctx,agent);agent.ctx=scope.ctx
 const detach=ctx.agents.enter(agent);ctx.jobs.attachController('unit')
 const f={ctx,root,agent,writer,warnings,expectedCleanup:false,path:ctx.piAuthority.describe(agent.id).path}
 f.snapshot=()=>decodePiJournal(readFileSync(f.path),agent.id,{requireComplete:true}).events
 f.register=execute=>ctx.tools.register({name:'launch',description:'launch test producer',parameters:{type:'object'},output:{schema:{type:'string'},render:(_,id)=>[{type:'text',text:id}]},execute})
 let call=0;f.run=(signal=new AbortController().signal)=>agent.ctx.tools.execute({name:'launch',callId:'launch-'+ ++call,arguments:{},signal,agent})
 t.after(async()=>{const errors=[];try{await scope.dispose()}catch(e){errors.push(e)}detach();try{await ctx.fiber.dispose()}catch(e){errors.push(e)}await rm(root,{recursive:true,force:true});if(f.expectedCleanup)assert.ok(errors.length,'uncertain journal must reject cleanup');else if(errors.length)throw new AggregateError(errors,'fixture close')})
 return f
}
test('owned job admission is physically committed before producer startup and binds the actual tool call',async t=>{
 const f=await fixture(t),done=Promise.withResolvers();let starts=0,registration
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'durable owned job',owner:f.agent.id,run(){starts++;registration=f.snapshot().find(e=>e.type===JOB_REGISTERED);assert.equal(registration.data.toolCall.callId,exec.callId);return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec))
 const result=await f.run();assert.equal(result.isError,false,JSON.stringify(result));assert.equal(starts,1);assert.match(result.value,/^fixture-[a-f0-9-]{36}$/)
 const wait=f.ctx.jobs.wait(result.value,1000,f.agent.id);done.resolve({status:'completed',detail:'producer finished'});await wait
 const events=f.snapshot(),settled=events.find(e=>e.type===JOB_SETTLED)
 assert.ok(settled.seq>registration.seq);assert.equal(settled.data.producerReported,true);assert.equal(settled.data.toolCall.rootCallId,registration.data.toolCall.callId)
 assert.equal(settled.data.owner,f.agent.id);assert.equal(settled.data.jobId,result.value)
})
test('a failed registration flush cannot launch or fall back to an unjournaled producer',async t=>{
 const f=await fixture(t);let starts=0,failed=false
 f.ctx.on('session/flush',session=>{if(!failed&&session.snapshotEvents().some(e=>e.type===JOB_REGISTERED)){failed=true;throw Error('registration sink failure')}})
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'must not launch',owner:f.agent.id,run(){starts++;return{done:Promise.resolve({status:'completed'}),cancel(){}}}},exec))
 const result=await f.run();assert.equal(result.isError,true);assert.match(result.error.message,/NIGHT_JOB_JOURNAL_UNCERTAIN/);assert.equal(result.error.info.code,'NIGHT_JOB_JOURNAL_UNCERTAIN');assert.equal(starts,0);assert.deepEqual(f.ctx.jobs.list(f.agent.id),[])
 assert.equal(f.snapshot().filter(e=>e.type===JOB_SETTLED).length,0)
})
test('cancellation during registration waits for the barrier and journals no producer invocation',async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers(),control=new AbortController();let held=false,starts=0
 f.ctx.on('session/flush',async session=>{if(!held&&session.snapshotEvents().some(e=>e.type===JOB_REGISTERED)){held=true;entered.resolve();await release.promise}})
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'cancel before start',owner:f.agent.id,run(){starts++;return{done:Promise.resolve({status:'completed'}),cancel(){}}}},exec))
 const pending=f.run(control.signal);await entered.promise;control.abort();release.resolve();const result=await pending
 assert.equal(result.isError,true);assert.equal(starts,0);assert.equal(f.snapshot().filter(e=>e.type===JOB_NOT_STARTED).length,1);assert.deepEqual(f.ctx.jobs.list(f.agent.id),[])
})
test('uncertain terminal persistence never emits a completed receipt or releases a successful wait',async t=>{
 const f=await fixture(t),done=Promise.withResolvers();let fail=false,starts=0;const settled=[]
 f.ctx.jobs.events.subscribe({owner:f.agent.id},event=>{if(event.type==='settled')settled.push(event)})
 f.ctx.on('session/flush',session=>{if(!fail&&session.snapshotEvents().some(e=>e.type===JOB_SETTLED)){fail=true;throw Error('terminal sink failure')}})
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'uncertain terminal',owner:f.agent.id,run(){starts++;return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec))
 const result=await f.run();assert.equal(result.isError,false);const wait=f.ctx.jobs.wait(result.value,1000,f.agent.id),rejected=assert.rejects(wait,/NIGHT_JOB_JOURNAL_UNCERTAIN/)
 done.resolve({status:'completed'});await rejected;await tick();assert.equal(starts,1);assert.equal(settled.length,0);assert.equal(f.ctx.jobs.get(result.value,f.agent.id).status,'stopping');f.expectedCleanup=true
})
test('copied execution objects cannot borrow owned producer admission',async t=>{
 const f=await fixture(t);let starts=0
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'forged execution',owner:f.agent.id,run(){starts++;return{done:Promise.resolve({status:'completed'}),cancel(){}}}},{...exec}))
 const result=await f.run();assert.equal(result.isError,true);assert.match(result.error.message,/NIGHT_JOB_CALL_OWNERSHIP_REQUIRED/);assert.equal(starts,0);assert.equal(f.snapshot().filter(e=>e.type===JOB_REGISTERED).length,0)
})
test('asynchronous job admission reserves capacity until its journal barrier finishes',async t=>{
 const f=await fixture(t,{max:1}),entered=Promise.withResolvers(),release=Promise.withResolvers(),done=Promise.withResolvers();let held=false,starts=0
 f.ctx.on('session/flush',async session=>{if(!held&&session.snapshotEvents().some(e=>e.type===JOB_REGISTERED)){held=true;entered.resolve();await release.promise}})
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'reserved capacity',owner:f.agent.id,run(){starts++;return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec))
 const first=f.run();await entered.promise;const second=await f.run();assert.equal(second.isError,true);assert.match(second.error.message,/limit/);assert.equal(starts,0)
 release.resolve();const result=await first;assert.equal(result.isError,false);assert.equal(starts,1);const wait=f.ctx.jobs.wait(result.value,1000,f.agent.id);done.resolve({status:'completed'});await wait
})

test('a throwing producer startup records possible effects and never supplies a terminal success proof',async t=>{
 const {JOB_START_UNCERTAIN}=await import('../src/runtime/job-ledger.js'),f=await fixture(t);let starts=0
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'startup may have effects',owner:f.agent.id,run(){starts++;throw Error('producer startup interrupted')}},exec))
 const result=await f.run();assert.equal(result.isError,true);assert.equal(result.error.info.code,'NIGHT_JOB_START_UNCERTAIN');assert.equal(starts,1)
 const events=f.snapshot();assert.equal(events.filter(e=>e.type===JOB_REGISTERED).length,1);assert.equal(events.filter(e=>e.type===JOB_SETTLED).length,0)
 assert.equal(events.find(e=>e.type===JOB_START_UNCERTAIN).data.externalEffectsPossible,true)
})
test('teardown cancellation failure is durable uncertainty rather than a producer-reported exit',async t=>{
 const f=await fixture(t),done=Promise.withResolvers();let starts=0
 f.register((_,exec)=>f.ctx.jobs.startDurable({kind:'fixture',label:'unproven cancellation',owner:f.agent.id,run(){starts++;return{done:done.promise,cancel(){throw Error('cannot confirm exit')}}}},exec))
 assert.equal((await f.run()).isError,false);f.expectedCleanup=true
 await assert.rejects(f.ctx.jobs.disposeAll(),/Job drain proof is uncertain/)
 const settled=f.snapshot().filter(e=>e.type===JOB_SETTLED);assert.equal(settled.length,1);assert.equal(settled[0].data.producerReported,false);assert.equal(settled[0].data.cause,'teardown');assert.equal(settled[0].data.status,'failed')
 done.resolve({status:'completed'});await tick();assert.equal(starts,1);assert.equal(f.snapshot().filter(e=>e.type===JOB_SETTLED).length,1)
})

test('cold job receipt projection refuses mismatched, duplicate and unsupported terminal facts',async()=>{
 const {unresolvedJobReceipts}=await import('../src/runtime/job-ledger.js')
 const registered={type:JOB_REGISTERED,data:{version:1,jobId:'job-1',owner:'session',kind:'bash',label:'command',startedAt:100,toolCall:{callId:'call',rootCallId:'call',toolName:'bash'}}}
 const settled={type:JOB_SETTLED,data:{...registered.data,producerReported:true,status:'completed',finishedAt:101}}
 assert.deepEqual(unresolvedJobReceipts([registered,settled],'session'),[])
 assert.equal(unresolvedJobReceipts([registered],'session').length,1)
 for(const change of [s=>s.data.version=99,s=>s.data.producerReported=false,s=>s.data.startedAt++,s=>s.data.finishedAt=99,s=>s.data.toolCall={...s.data.toolCall,callId:'other'}]){
  const altered=structuredClone(settled);change(altered);assert.equal(unresolvedJobReceipts([registered,altered],'session').length,1)
 }
 assert.equal(unresolvedJobReceipts([registered,settled,registered],'session').length,1)
 assert.equal(unresolvedJobReceipts([settled,registered],'session').length,1)
})
