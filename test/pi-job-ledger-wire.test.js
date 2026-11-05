import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createUserMessage} from '../src/native-message-protocol.js'
import {createHost} from '../src/host.js'
import {decodePiJournal} from '../src/runtime/pi-journal.js'
import {JOB_REGISTERED,JOB_SETTLED} from '../src/runtime/job-ledger.js'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'

test('real Pi call owns a committed job receipt and cold inspection never relaunches its producer',async t=>{
 const done=Promise.withResolvers();let starts=0,parent,path,atLaunch
 const f=await subagentFixture(t,(_,f)=>f.requests.length===1?{tools:[{id:'durable-call',name:'launch_durable_fixture',args:{}}]}:{text:'job admitted'})
 f.cleanup.push(()=>done.resolve({status:'killed'}))
 f.host.ctx.tools.register({name:'launch_durable_fixture',description:'Start an isolated test producer',parameters:{type:'object'},output:{schema:{type:'object'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_,exec){
  const id=await f.host.ctx.jobs.startDurable({kind:'fixture',label:'one real Pi call',owner:exec.agent.id,run(){starts++;atLaunch=decodePiJournal(readFileSync(path),parent.id,{requireComplete:true}).events;return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec)
  return{jobId:id}
 }})
 parent=await f.parent('durable-job-owner');path=f.host.ctx.piAuthority.describe(parent.id).path
 parent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Admit one owned fixture job'}]}));await parent.whenIdle()
 assert.equal(starts,1);const call=atLaunch.find(e=>e.type==='tool/call'&&e.data.callId==='durable-call'),registered=atLaunch.find(e=>e.type===JOB_REGISTERED)
 assert.ok(call);assert.ok(registered.seq>call.seq);assert.equal(registered.data.toolCall.callId,call.data.callId)
 const wait=f.host.ctx.jobs.wait(registered.data.jobId,1000,parent.id);done.resolve({status:'completed',detail:'exit code: 0'});await wait
 const events=await f.events(parent.id),settled=events.find(e=>e.type===JOB_SETTLED)
 assert.equal(settled.data.producerReported,true);assert.equal(settled.data.toolCall.callId,'durable-call')
 for(const handle of f.handles.splice(0))await handle.dispose();await f.host.close()
 const bytes=await readFile(path),requests=f.requests.length
 const resumed=await createHost({stateDir:join(f.root,'state'),workspaceDir:join(f.root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m'}]}}})
 try{assert.deepEqual(resumed.ctx.jobs.list(parent.id),[]);const reader=await resumed.ctx.sessionPersistence.open(parent.id,'read');try{assert.deepEqual((await reader.read()).events,events)}finally{await reader.close()};assert.equal(starts,1);assert.equal(f.requests.length,requests);assert.deepEqual(await readFile(path),bytes)}finally{await resumed.close()}
})

test('cold Pi activation refuses an unresolved job journal instead of polling or restarting its producer',async t=>{
 const {mkdir,copyFile}=await import('node:fs/promises'),{basename}=await import('node:path'),{LlmAdapter}=await import('../src/native-llm-protocol.js')
 const done=Promise.withResolvers();let parent,starts=0
 const f=await subagentFixture(t,(_,f)=>f.requests.length===1?{tools:[{id:'unresolved-call',name:'leave_owned_job',args:{}}]}:{text:'job remains owned'})
 f.cleanup.push(()=>done.resolve({status:'killed'}))
 f.host.ctx.tools.register({name:'leave_owned_job',description:'Admit a test-only pending producer',parameters:{type:'object'},output:{schema:{type:'string'},render:(_,id)=>[{type:'text',text:id}]},execute:(_,exec)=>f.host.ctx.jobs.startDurable({kind:'fixture',label:'unresolved crash fixture',owner:exec.agent.id,run(){starts++;return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec)})
 parent=await f.parent('cold-unresolved-job');parent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Leave one pending fixture producer'}]}));await parent.whenIdle()
 const original=f.host.ctx.piAuthority.describe(parent.id).path,coldState=join(f.root,'cold-state');await mkdir(join(coldState,'sessions'),{recursive:true});await copyFile(original,join(coldState,'sessions',basename(original)))
 const cold=await createHost({stateDir:coldState,workspaceDir:join(f.root,'work'),model:{provider:'cold-fixture',model:'m'},providers:{}});let handle,modelCalls=0
 class ColdModel extends LlmAdapter{async *stream(){modelCalls++;throw Error('unresolved jobs must block model activation')}}
 cold.ctx.llm.registerAdapter(['cold-fixture'],new ColdModel())
 try{handle=await cold.ctx.agents.resume({resumeSessionId:parent.id,agentOptions:{provider:'cold-fixture',model:'m'}});handle.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Do not replay unresolved effects'}]}));await handle.agent.whenIdle();assert.equal(modelCalls,0);assert.equal(starts,1);assert.deepEqual(cold.ctx.jobs.list(parent.id),[])}finally{await handle?.dispose();await cold.close()}
})
