import {bindBusinessNotices,enqueueBusinessNotice} from '../src/runtime/pi-business-notices.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {Context} from '@deepseek-ai/cordis'
import {SettingsManager,ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import NativeAgents from '../src/native-agents.js'
import NativeTools from '../src/native-tools.js'
import NativeJobs from '../src/native-jobs.js'
import NativeSystemPrompt from '../src/native-system-prompt.js'
import {createScope} from '../src/native-scope.js'
import {bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import {apply as authority} from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {admissionAuditKinds,createBusinessAdmission} from '../src/runtime/pi-business-admission.js'
import {createNightOfficialSession} from '../src/runtime/pi-official-session.js'
import {createSingleTaskSessions} from '../src/tasks/single-session.js'

const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
const decision={action:'complete',summary:'Verified',evidence:['scripted tool result'],limitations:[]}
const definition=(name,execute)=>({name,description:name,parameters:{type:'object',properties:{a:{type:'integer'},b:{type:'integer'}},additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute})
async function fixture(t,plan,{effect=async()=>({ok:true}),isCurrent=async()=>true}={}){
 const root=await mkdtemp(join(tmpdir(),'night-single-official-')),agentDir=join(root,'agent');await mkdir(agentDir)
 const ctx=new Context();new NativeAgents(ctx);new NativeSystemPrompt(ctx,{});new NativeTools(ctx);new NativeJobs(ctx);authority(ctx)
 const persistence=new PiPersistence(ctx,{root:join(root,'sessions')}),requests=[],actors=[];let effects=0
 ctx.provide('sandboxPolicy',{resolve:({actor})=>{assert.equal(ctx.agents.get(actor.id),actor);return{mode:'workspace-write',workspaceRoot:root,sessionId:actor.id}}})
 ctx.provide('agentPresets',{async mount(scope,id){assert.equal(id,'night-bot-task');scope.tools.register(definition('write',async(_args,exec)=>{effects++;return effect({ctx,exec})}))}})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false}),model=runtime.getModels().find(m=>m.provider==='openai')??runtime.getModels()[0]
 await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  requests.push(structuredClone(context));const answer=plan(context,requests.length),stream=createAssistantMessageEventStream()
  Promise.resolve(answer).then(answer=>{const calls=answer.calls??[],message={role:'assistant',content:calls.length?calls.map((call,index)=>({type:'toolCall',id:call.id??'call-'+requests.length+'-'+index,name:call.name,arguments:call.arguments??{}})):[{type:'text',text:answer.text??'interrupted before submission'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:calls.length?'toolUse':'stop',usage};stream.push({type:'done',reason:message.stopReason,message});stream.end(message)})
  return stream
 }})
 // This fixture supplies the narrow application factory contract; execution and
 // history are the real public SDK, native durability and NativeTools services.
 async function build(options,resume){
  const id=options.sessionId??options.resumeSessionId,store=resume?await persistence.openNative(id,{auditKinds:{...admissionAuditKinds,...options.auditKinds}}):await persistence.createNative({...options.meta,version:4,id,createdAt:Date.now(),isSeeded:false},{auditKinds:{...admissionAuditKinds,...options.auditKinds}})
  for(const receipt of options.initialReceipts??[])store.appendAudit(receipt)
  let actor,scope,official,detach,unbindDirectory,running=Promise.resolve(),disposed=false,unbindNotices,publishNotice
  const admission=await createBusinessAdmission({store,authorize:packet=>options.authorizeInput(packet,actor),bindInternal:port=>{publishNotice=port}})
  const receipts={append:receipt=>store.appendAudit(receipt),read:()=>store.readAudit(),commit:()=>store.commit()}
  try{
   official=await createNightOfficialSession({ctx,store,agentDir,registry:ctx.tools,maxParallelToolCalls:2,resolved:{modelRuntime:runtime,model,thinkingLevel:'off',requestOptions:{maxRetries:0}},settingsManager:SettingsManager.inMemory({packages:[],compaction:{enabled:false},retry:{enabled:false}}),admission,
    createAudit:()=>({isLive:()=>!disposed&&ctx.agents.get(id)===actor,isTurnOpen:()=>official?.session.isStreaming===true,approvalPolicy:()=> 'never',append(){throw Error('approval not expected')},flush:receipts.commit}),
    context:{systemPrompt:ctx.systemPrompt},beforeRequest:async()=>{await admission.beforeRequest();await options.beforeRequest(actor)},
    prepareActor:async value=>{actor=value;actor.metadata=Object.freeze({...store.header});actor.receipts=receipts;scope=createScope(ctx,actor);actor.ctx=scope.ctx;await options.setup(scope.ctx,actor)},
    beforeStoreClose:async()=>{admission.pause();await options.drainBusiness(actor)},
   })
   actor.piSession=official.session;unbindNotices=bindBusinessNotices(actor,{enqueue:publishNotice,isLive:()=>!disposed,finishTaskRun:()=>admission.finishTaskRun(official.session)});detach=ctx.agents.enter(actor,undefined);actors.push(actor)
   unbindDirectory=bindWorkingDirectoryActor(actor,{initialDirectory:store.header.cwd,isLive:()=>!disposed&&ctx.agents.get(id)===actor,readDirectory:()=>store.header.cwd,appendChange:async()=>{throw Error('not used')},admitNotice:async()=>{throw Error('not used')}})
   actor.input={enqueue:packet=>admission.enqueue(packet),deliver:(id,options)=>{running=official.deliver(id,options);return running}}
   actor.whenIdle=async()=>{await Promise.allSettled([running]);await official.session.agent.waitForIdle()}
   actor.cancel=()=>official.session.abort()
   const dispose=async()=>{if(disposed)return;await official.close();disposed=true;await admission.close();unbindNotices();detach();unbindDirectory();await scope.dispose()}
   return {agent:actor,dispose}
  }catch(error){official?.session.dispose();detach?.();unbindDirectory?.();await scope?.dispose();await store.close();throw error}
 }
 ctx.agents.setFactory({createAgent:(_owner,options)=>build(options,false),resume:(_owner,options)=>build(options,true)})
 const sessions=createSingleTaskSessions({ctx,isCurrent,getWorkspaceDir:async()=>root})
 t.after(async()=>{await sessions.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return{ctx,persistence,sessions,requests,actors,get effects(){return effects},binding:{taskId:'task',sessionId:'single',sessionBound:false,requirementRevision:1,controlRevision:1,contextRevision:0,leaseEpoch:1},input:{task:{objective:'Create proof'},sources:[],materials:[],blockers:[]},provider:model.provider,model:model.id}
}
const run=(f,extra={})=>f.sessions.run({binding:f.binding,input:f.input,provider:f.provider,model:f.model,onSessionBound:async()=>{},submit:async()=>({accepted:true}),...extra})

test('single task uses official SDK directly, cold-resumes one session and never replays a settled effect',async t=>{
 let second=false
 const f=await fixture(t,(context,n)=>{
  if(n===1)return {calls:[{name:'write',arguments:{a:1,b:2}}]}
  if(n===2)return {text:'interruption'}
  assert.ok(context.messages.some(message=>message.role==='toolResult'&&message.toolName==='write'&&!message.isError&&message.content.some(block=>block.type==='text'&&block.text==='{"ok":true}')),'the resumed official context retains the completed effect result')
  return {calls:[{name:'task_result',arguments:{decision}}]}
 })
 await assert.rejects(run(f),{code:'TASK_SESSION_NO_SUBMISSION'})
 assert.equal(f.effects,1);f.binding={...f.binding,sessionBound:true,leaseEpoch:2}
 const result=await run(f,{submit:async()=>{second=true;return{accepted:true}}})
 assert.equal(result.status,'submitted');assert.equal(second,true);assert.equal(f.effects,1)
 assert.equal(f.actors.length,2);assert.ok(f.actors.every(actor=>actor.id==='single'&&actor.session===undefined))
 const stored=await f.persistence.readNative('single')
 assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)
 assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1)
 assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,1)
 assert.equal(stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='write'&&!entry.message.isError).length,1)
 assert.equal((await f.persistence.list()).length,1)
})
test('ordinary tool error after an effect remains unknown and blocks retries, submission and cold replay',async t=>{
 let submissions=0
 const f=await fixture(t,(_context,n)=>({calls:n===1?[{name:'write'},{name:'task_result',arguments:{decision}}]:[{name:'task_result',arguments:{decision:{action:'wait',summary:'Prior effect remains unknown',evidence:[],limitations:['Reconciliation required before new effects']}}}]}),{effect:async()=>{throw Error('failed after external write')}})
 const held=await run(f,{submit:async()=>{submissions++;return{accepted:true}}})
 assert.equal(held.status,'no_submission');assert.equal(held.reason,'TASK_EFFECT_UNCERTAIN_NO_REPLAY');assert.equal(held.effectDisposition,'held');assert.equal(held.failure.code,'TASK_EFFECT_UNCERTAIN_NO_REPLAY')
 assert.equal(f.effects,1);assert.equal(submissions,0);const count=f.requests.length;assert.equal(count,1)
 f.binding={...f.binding,sessionBound:true,leaseEpoch:2}
 // A cold session is intentionally allowed to inspect receipts and report wait,
 // but not replay the unknown write. An endless invalid complete/write script
 // would test provider nontermination rather than the no-replay contract.
 assert.deepEqual(await run(f),{status:'submitted'})
 assert.equal(f.requests.length,count+1);assert.equal(f.effects,1)
 const stored=await f.persistence.readNative('single')
 assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1)
 assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,0)
})
test('single task cancellation joins an active official SDK request before disposing its sole writer',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),f=await fixture(t,async()=>{entered.resolve();await release.promise;return{calls:[{name:'task_result',arguments:{decision}}]}})
 const running=run(f);await entered.promise
 let ended=false
 const cancelling=f.sessions.cancel('task').then(()=>{ended=true});await delay(10)
 assert.equal(ended,false);assert.equal(f.persistence.writers.size,1)
 release.resolve();await cancelling;await running.catch(()=>{})
 assert.equal(f.ctx.agents.list().length,0);assert.equal(f.persistence.writers.size,0)
 assert.equal((await f.persistence.list()).length,1)
})
test('task completion cannot infer a background producer exit and disposal joins the actual producer receipt',async t=>{
 const cancelled=Promise.withResolvers(),producer=Promise.withResolvers();let submissions=0
 const f=await fixture(t,(_context,n)=>n===1?{calls:[{name:'write'}]}:n===2?{calls:[{name:'task_result',arguments:{decision}}]}:{text:'await producer'},
  {effect:async({ctx,exec})=>{const jobId=await ctx.jobs.startDurable({owner:exec.agent.id,kind:'single-fixture',label:'actual controlled producer',run:()=>({done:producer.promise,cancel:()=>cancelled.resolve()})},exec);return{kind:'background',jobId}}})
 f.ctx.jobs.attachController('single-fixture')
 const running=run(f,{submit:async()=>{submissions++;return{accepted:true}}})
 await cancelled.promise
 assert.equal(submissions,0);assert.equal(f.ctx.agents.list().length,1);assert.equal(f.persistence.writers.size,1)
 producer.resolve({status:'killed',detail:'actual producer exit'})
 await assert.rejects(running,{code:'TASK_SESSION_NO_SUBMISSION'})
 const stored=await f.persistence.readNative('single')
 assert.equal(stored.audit.filter(r=>r.domain==='job'&&r.kind==='registered').length,1)
 assert.equal(stored.audit.find(r=>r.domain==='job'&&r.kind==='settled').payload.producerReported,true)
 assert.equal(f.persistence.writers.size,0);assert.equal(f.effects,1)
})

test('business request rejection always attempts disposal, while real commit or disposal failures remain unproven',async()=>{
 const refusal=Object.assign(new Error('application refused the request'),{code:'UNRELATED_BUSINESS_REFUSAL'})
 for(const failed of [undefined,'commit','dispose']){
  let disposed=0,commits=0
  const proofFailure=new Error('durable or resource proof failed'),actor={receipts:{async commit(){if(++commits===2&&failed==='commit')throw proofFailure}},input:{async enqueue(){},async deliver(){throw refusal}},async whenIdle(){throw refusal},async cancel(){}}
  const sessions=createSingleTaskSessions({ctx:{sessionPersistence:{async readNative(id){throw Object.assign(new Error('new'),{name:'SessionPersistenceNotFoundError',sessionId:id})}},agents:{async create(){return{agent:actor,async dispose(){disposed++;if(failed==='dispose')throw proofFailure}}}}},isCurrent:async()=>true,getWorkspaceDir:async()=>'/authorized/task'})
  let result
  try{await sessions.run({binding:{taskId:'task',sessionId:'session',sessionBound:false},input:{},onSessionBound:async()=>{},submit:async()=>{}})}catch(cause){result=cause}
  assert.equal(disposed,1,'business policy diagnostics must never skip the real drain capability')
  if(failed){assert.equal(result.code,'TASK_SESSION_DRAIN_FAILED');assert.equal(result.taskSessionDrained,false);assert.equal(result.cause,proofFailure);assert.equal(result.businessFailure,refusal)}
  else{assert.equal(result,refusal);assert.equal(result.taskSessionDrained,undefined)}
  if(failed){await assert.rejects(sessions.cancel('task'),error=>error===result);await assert.rejects(sessions.close(),error=>error===result)}else await sessions.close()
 }
})


test('a superseded official run cancels without effects and disposes its writer before the next revision',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let current=true
 const f=await fixture(t,async()=>{entered.resolve();await release.promise;return {calls:[{name:'write'}]}},{isCurrent:async()=>current})
 t.after(()=>release.resolve())
 const running=f.sessions.run({...f,binding:f.binding,input:f.input,onSessionBound:async()=>{},submit:async()=>{throw Error('stale submission must not run')}})
 await entered.promise;current=false;release.resolve()
 const result=await running
 assert.equal(result.status,'cancelled');assert.equal(result.reason,'TASK_BINDING_SUPERSEDED')
 assert.equal(f.effects,0);assert.equal(f.requests.length,1);assert.equal(f.ctx.agents.list().length,0)
 const stored=await f.persistence.readNative(f.binding.sessionId,{requireComplete:true})
 assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,0)
})

test('supersession never converts a factory startup cleanup failure into a drained task',async()=>{
 const cleanupFailure=new Error('factory retained startup ownership'),cause=Object.assign(new Error('startup failed'),{cleanupFailure})
 const sessions=createSingleTaskSessions({ctx:{sessionPersistence:{async readNative(id){throw Object.assign(new Error('new'),{name:'SessionPersistenceNotFoundError',sessionId:id})}},agents:{async create(){throw cause}}},isCurrent:async()=>false,getWorkspaceDir:async()=>'/authorized/task'})
 await assert.rejects(sessions.run({binding:{taskId:'task',sessionId:'startup',sessionBound:false},input:{},onSessionBound:async()=>{},submit:async()=>{}}),error=>error.code==='TASK_SESSION_DRAIN_FAILED'&&error.taskSessionDrained===false&&error.cause===cleanupFailure)
 await assert.rejects(sessions.close(),{code:'TASK_SESSION_DRAIN_FAILED',taskSessionDrained:false})
})


test('committed task result retires queued job notices without another SDK attempt and preserves late receipt idempotency',async t=>{
 let f
 f=await fixture(t,(_context,n)=>{
  assert.equal(n,1,'no model request after result submission')
  return {calls:[{name:'task_result',arguments:{decision}}]}
 })
 const notice=id=>({id,source:{kind:'job-completion',jobId:id,terminalReceiptId:'receipt-'+id},content:'Producer completed'})
 await run(f,{submit:async()=>{
  const actor=f.actors[0]
  // All thirteen completed jobs were durably queued while the task was busy.
  for(let i=0;i<13;i++){const packet=notice('job-'+i);await enqueueBusinessNotice(actor,packet);await actor.input.deliver(packet.id,{deliverAs:'followUp'})}
  assert.equal(actor.piSession.agent.hasQueuedMessages(),true)
  return {accepted:true}
 }})
 assert.equal(f.requests.length,1)
 const stored=await f.persistence.readNative('single',{requireComplete:true})
 assert.equal(stored.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled'&&row.payload.reason==='task-result-committed').length,13)
 assert.equal(stored.entries.filter(row=>row.type==='message'&&row.message.role==='assistant').length,1)
 const store=await f.persistence.openNative('single',{auditKinds:{...admissionAuditKinds,...(await import('../src/tasks/single-session.js')).singleTaskAuditKinds}})
 // A cold admission restores cancellation; it must not reconstruct a follow-up.
 const admission=await createBusinessAdmission({store,authorize:()=>true})
 assert.deepEqual(admission.pending(),[])
 await admission.close();await store.close()
})


test('wait result retires this run notices without preventing the same task from resuming on a new lease',async t=>{
 let action='wait'
 const f=await fixture(t,()=>({calls:[{name:'task_result',arguments:{decision:{...decision,action}}}]}))
 assert.equal((await run(f)).status,'submitted')
 f.binding={...f.binding,sessionBound:true,leaseEpoch:2};action='complete'
 assert.equal((await run(f)).status,'submitted')
 assert.equal(f.requests.length,2)
 assert.equal(f.actors.length,2)
})


test('cold new task lease retains old pending supplement without trace fields and never replays it',async t=>{
 const first=Promise.withResolvers(),cold=Promise.withResolvers()
 const f=await fixture(t,(_context,n)=>n===1?{calls:[{name:'write',arguments:{a:1,b:2}}]}:n===2?first.promise:n===3?cold.promise:{calls:[{name:'task_result',arguments:{decision}}]})
 const source={sourceId:'s',version:1,groupId:'room',messageId:'m',actorId:'user',text:'UNIQUE_SUPPLEMENT_BODY',resources:[]}
 const row={wakeId:'old',leaseEpoch:1,contextRevision:1,state:'pending',messageId:'m',request:'update',sourceRefs:['s'],sourceSnapshots:[source]},task={taskId:'task',objective:'Create proof',liveSupplements:[row]}
 const running=run(f);while(f.requests.length<2)await delay(5)
 const actor=f.actors[0],enqueue=actor.input.enqueue;actor.input.enqueue=packet=>{if(packet.id==='task-supplement:old')delete packet.source.traceSources;return enqueue(packet)}
 const deliver=actor.input.deliver;actor.input.deliver=(id,options)=>id==='task-supplement:old'?Promise.resolve():deliver(id,options)
 await f.sessions.supplement({task,sources:[source],materials:[]});first.resolve({text:'interrupted'});await assert.rejects(running,{code:'TASK_SESSION_NO_SUBMISSION'})
 const stored=await f.persistence.readNative('single',{requireComplete:true}),old=stored.audit.find(r=>r.domain==='admission'&&r.kind==='enqueued'&&r.payload.id==='task-supplement:old').payload
 assert.equal(old.source.traceSources,undefined);assert.equal(f.effects,1)
 f.binding={...f.binding,sessionBound:true,leaseEpoch:2,contextRevision:1};f.input={...f.input,task,sources:[source],wakes:[{kind:'task.created',payload:{sourceRefs:['s']}}]}
 const resumed=run(f);while(f.requests.length<3)await delay(5)
 await f.sessions.supplement({task,sources:[source],materials:[]});assert.equal(f.requests.length,3)
 const current=f.requests[2].messages.at(-1);assert.equal(JSON.stringify(current).split('UNIQUE_SUPPLEMENT_BODY').length-1,1)
 cold.resolve({calls:[{name:'task_result',arguments:{decision}}]});assert.equal((await resumed).status,'submitted');assert.equal(f.effects,1)
 const final=await f.persistence.readNative('single',{requireComplete:true});assert.deepEqual(final.audit.find(r=>r.domain==='admission'&&r.kind==='enqueued'&&r.payload.id===old.id).payload,old);assert.equal(final.audit.filter(r=>r.domain==='admission'&&r.kind==='admitted'&&r.payload.id===old.id).length,0);assert.equal(final.entries.filter(r=>r.type==='custom_message'&&r.details?.packetId===old.id).length,0)
})
