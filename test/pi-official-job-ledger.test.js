import test from 'node:test'
import {createAgentSession} from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import {join,win32} from 'node:path'
import {appendFile,readdir,readFile,truncate} from 'node:fs/promises'
import {currentProcessResourceRecorder} from '../src/process/contracts.js'
import {setImmediate} from 'node:timers/promises'
import {definition,officialToolsFixture} from './fixtures/pi-official-tools.js'
import NativeAgents from '../src/native-agents.js'
import NativeJobs from '../src/native-jobs.js'
import NativePolicy,{bindSandboxPolicyActor} from '../src/native-policy.js'
import {bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {jobReceiptKinds,unresolvedNativeJobReceipts} from '../src/runtime/job-ledger.js'
import {admissionAuditKinds,createBusinessAdmission} from '../src/runtime/pi-business-admission.js'
import {bindBusinessNotices} from '../src/runtime/pi-business-notices.js'
import {apply as applyJobTools,reconcileJobCompletionNotices} from '../src/native-tool-jobs.js'
async function fixture(t,register,{notices=false,maxConcurrentJobsPerOwner}={}){
 let store,backend,starts=0,expectUnknown=false,publish;const settlement=Promise.withResolvers()
 const h=await officialToolsFixture(t,async({ctx,owner,root})=>{
  ctx.logger={warn(){},error(){}};new NativeAgents(ctx);new NativeJobs(ctx,{pumpPollMs:1,...maxConcurrentJobsPerOwner===undefined?{}:{maxConcurrentJobsPerOwner}});new NativePolicy(ctx,{mode:'workspace-write',workspaceRoot:root});authority(ctx)
  backend=new PiPersistence(ctx,{root:join(root,'durable-jobs')});store=await backend.createNative({version:4,id:owner.id,createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{...jobReceiptKinds,...admissionAuditKinds}})
  owner.receipts={append:receipt=>store.appendAudit(receipt),commit:()=>store.commit(),read:()=>store.readAudit(),readEntries:()=>store.readAuditEntries()}
  bindWorkingDirectoryActor(owner,{initialDirectory:root,isLive:()=>ctx.agents.get(owner.id)===owner,readDirectory:()=>root,appendChange(){throw Error('not changing cwd')},admitNotice(){}})
  bindSandboxPolicyActor(owner,{initialDirectory:root,isLive:()=>ctx.agents.get(owner.id)===owner,readPolicy:()=>({mode:'workspace-write',artifactRoot:null}),appendPolicy(){throw Error('not changing policy')}})
  ctx.jobs.attachController('official-test');ctx.jobs.events.subscribe({owners:'scope'},event=>{if(event.type==='settled')settlement.resolve(event)})
  if(notices)applyJobTools(ctx,{completionDelivery:'inject'})
  await register?.({ctx,owner,store,started(){starts++},setPublisher(value){publish=value}})
 })
 const detach=h.ctx.agents.enter(h.owner)
 if(publish)h.deferCleanup(bindBusinessNotices(h.owner,{enqueue:publish,isLive:actor=>h.ctx.agents.get(actor.id)===actor}))
 h.deferCleanup(async()=>{try{await h.ctx.jobs.drainOwner(h.owner)}catch(error){if(!expectUnknown||!(error.code==='NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY'||error instanceof AggregateError&&error.errors.length&&error.errors.every(item=>['NIGHT_JOB_JOURNAL_UNCERTAIN','NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN'].includes(item.code??item.message))))throw error}finally{detach();await store.close()}})
 return {...h,get store(){return store},backend,settlement:settlement.promise,async reopenReceipts(){await store.close();store=await backend.openNative(h.owner.id,{auditKinds:{...jobReceiptKinds,...admissionAuditKinds}})},get starts(){return starts},expectUnknown:()=>{expectUnknown=true}}
}
test('real official SDK starts producer only after native typed registration commit and settles with no Session facade',async t=>{
 const h=await fixture(t,({ctx,owner,store,started})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'official producer',owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed',detail:'real done'}),cancel(){}}}},exec)}))))
 await h.run([{id:'official-job-call',name:'launch'}]);await setImmediate();await setImmediate()
 const receipts=await h.store.readAudit(),registered=receipts.find(receipt=>receipt.kind==='registered'),settled=receipts.find(receipt=>receipt.kind==='settled')
 assert.equal(h.starts,1);assert.equal(registered.payload.toolCall.callId,'official-job-call');assert.equal(settled.payload.producerReported,true);assert.equal(h.owner.session,undefined)
 assert.deepEqual(unresolvedNativeJobReceipts(receipts,h.owner.id),[]);await h.ctx.jobs.assertCanRun(h.owner)
 const cold=await h.backend.readNative(h.owner.id,{auditKinds:{...jobReceiptKinds,...admissionAuditKinds}});assert.deepEqual(unresolvedNativeJobReceipts(cold.audit,h.owner.id),[])
})
test('failed native registration commit never launches producer or falls back to ephemeral execution',async t=>{
 const h=await fixture(t,({ctx,owner,started})=>{
  const original=owner.receipts;owner.receipts={...original,append(){throw Error('receipt append failed')}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'blocked producer',owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed'}),cancel(){}}}},exec)})))
 })
 await h.run([{id:'rejected-registration',name:'launch'}]);assert.equal(h.starts,0);assert.equal(h.results.find(result=>result.toolCallId==='rejected-registration').isError,true);assert.deepEqual(await h.store.readAudit(),[])
})
test('durable running job drain cancels and awaits real producer and terminal commit',async t=>{
 const cancelled=Promise.withResolvers(),release=Promise.withResolvers();let jobId
 const h=await fixture(t,({ctx,owner,started})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'drained producer',owner:owner.id,run(){started();return{done:release.promise,cancel(){cancelled.resolve()}}}},exec)}))))
 await h.run([{id:'running-registration',name:'launch'}]);await h.ctx.jobs.assertCanRun(h.owner)
 let drained=false;const pending=h.ctx.jobs.drainOwner(h.owner).then(()=>{drained=true});await cancelled.promise;assert.equal(drained,false)
 await assert.rejects(h.ctx.jobs.resumeOwner(h.owner),error=>error.code==='NIGHT_JOB_OWNER_NOT_DRAINED')
 assert.throws(()=>h.ctx.agents.withInitiator(h.owner,()=>h.ctx.jobs.start({kind:'fixture',label:'late admission',owner:h.owner.id,run(){throw Error('must remain held')}})),error=>error.code==='NIGHT_JOB_OWNER_DRAINING')
 release.resolve({status:'killed',detail:'producer exited'});await pending
 assert.equal(h.ctx.jobs.list(h.owner.id).length,0);const terminal=(await h.store.readAudit()).find(receipt=>receipt.kind==='settled');assert.equal(terminal.payload.status,'killed');assert.equal(terminal.payload.producerReported,true)
})
test('cold typed job records alone reject unknown starts, duplicate ids and nonproducer settlement without replay',()=>{
 const bound={version:1,jobId:'job-one',owner:'actor-one',kind:'bash',label:'producer',startedAt:1,toolCall:{callId:'call-one',rootCallId:'call-one',toolName:'bash'}},receipt=(kind,payload)=>({version:1,domain:'job',kind,payload:{...bound,...payload}})
 const registered=receipt('registered',{state:'admitted'}),settled=receipt('settled',{status:'completed',cause:'producer',producerReported:true,finishedAt:2})
 assert.equal(unresolvedNativeJobReceipts([registered],bound.owner).length,1)
 assert.equal(unresolvedNativeJobReceipts([registered,registered,settled],bound.owner)[0].uncertain,true)
 assert.equal(unresolvedNativeJobReceipts([registered,receipt('settled',{status:'completed',cause:'teardown',producerReported:false,finishedAt:2})],bound.owner)[0].uncertain,true)
 assert.deepEqual(unresolvedNativeJobReceipts([registered,receipt('not-started',{reason:'cancelled before launch'})],bound.owner),[])
 assert.throws(()=>unresolvedNativeJobReceipts([receipt('settled',{...settled.payload,finishedAt:0})],bound.owner),error=>error.code==='NIGHT_JOB_RECEIPT_INVALID')
})
test('completion only enqueues stable terminal-receipt packet and never invokes actor followup or inject',{timeout:3000},async t=>{
 let release;const queue=[],notified=Promise.withResolvers()
 const h=await fixture(t,async({ctx,owner,store,started,setPublisher})=>{let internal;const outbox=await createBusinessAdmission({store,authorize:async packet=>packet.source.kind==='task-input',bindInternal:value=>{internal=value}});owner.admission=outbox;setPublisher(async packet=>{await internal(packet);queue.push(packet);notified.resolve()});owner.followup=owner.inject=()=>{throw Error('official actor must use durable admission')};ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'notice producer',owner:owner.id,run(){started();return{done:new Promise(resolve=>{release=resolve}),cancel(){}}}},exec)})))},{notices:true})
 await h.run([{id:'background-call',name:'launch'}]);release({status:'completed',detail:'done'});await notified.promise
 assert.equal(queue.length,1);assert.equal(queue[0].source.kind,'job-completion');assert.ok(queue[0].id.includes(queue[0].source.terminalReceiptId));assert.ok(queue[0].id.includes(queue[0].source.jobId));assert.equal(h.starts,1)
 await assert.rejects(h.owner.admission.enqueue({id:'forged-completion',source:{kind:'job-completion'},content:'spoof'}),{code:'PI_BUSINESS_ADMISSION_DENIED'});const packetId=queue[0].id;assert.deepEqual(h.owner.admission.pending(),[packetId]);h.owner.admission.pause();await assert.rejects(h.owner.admission.deliver(h.session,packetId),{code:'PI_BUSINESS_ADMISSION_PAUSED'});assert.deepEqual(h.owner.admission.pending(),[packetId]);const restored=await createBusinessAdmission({store:h.store,authorize:async()=>true});assert.deepEqual(restored.pending(),[packetId]);await restored.close()
})

test('official cancellation during registration commits not-started and invokes no producer',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let registration=false
 const h=await fixture(t,({ctx,owner,started})=>{
  const original=owner.receipts;owner.receipts={...original,append(receipt){if(receipt.kind==='registered')registration=true;return original.append(receipt)},async commit(){if(registration){registration=false;entered.resolve();await release.promise}return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'cancel before launch',owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed'}),cancel(){}}}},exec)})))
 })
 const running=h.run([{id:'cancelled-registration',name:'launch'}]);await entered.promise;const aborted=h.session.abort();release.resolve();await aborted;await running
 assert.equal(h.starts,0);const receipts=await h.store.readAudit();assert.ok(receipts.some(receipt=>receipt.kind==='not-started'));assert.deepEqual(unresolvedNativeJobReceipts(receipts,h.owner.id),[])
})
test('same-id foreign exec and a missing trusted initiator cannot start an official producer',async t=>{
 const h=await fixture(t,({ctx,owner,started})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'forged owner',owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed'}),cancel(){}}}},{...exec,agent:{...owner}})}))))
 await h.run([{id:'forged-registration',name:'launch'}]);assert.equal(h.starts,0);assert.deepEqual(await h.store.readAudit(),[])
 assert.throws(()=>h.ctx.jobs.start({kind:'fixture',label:'outside initiator',owner:h.owner.id,run(){throw Error('must not start')}}),error=>error.code==='NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
})

test('an official producer startup throw persists unknown effects and fences cold/live continuation without restart',async t=>{
 const h=await fixture(t,({ctx,owner,started})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'uncertain startup',owner:owner.id,run(){started();throw Error('producer may have started before throwing')}},exec)}))))
 h.expectUnknown();await h.run([{id:'uncertain-startup',name:'launch'}]);assert.equal(h.starts,1)
 const receipts=await h.store.readAudit();assert.ok(receipts.some(receipt=>receipt.kind==='start-uncertain'&&receipt.payload.externalEffectsPossible===true));assert.equal(unresolvedNativeJobReceipts(receipts,h.owner.id)[0].uncertain,true)
 await assert.rejects(h.ctx.jobs.assertCanRun(h.owner),error=>error.code==='NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY')
 await assert.rejects(h.ctx.jobs.drainOwner(h.owner),error=>error.code==='NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY');assert.equal(h.starts,1)
})

test('maintenance hold remains through the host action and explicit verified resume allows future jobs',async t=>{
 const h=await fixture(t,({ctx,owner,started})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'after maintenance',owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed'}),cancel(){}}}},exec)}))))
 await h.ctx.jobs.drainOwner(h.owner)
 assert.throws(()=>h.ctx.agents.withInitiator(h.owner,()=>h.ctx.jobs.start({kind:'fixture',label:'during maintenance',owner:h.owner.id,run(){throw Error('held')}})),error=>error.code==='NIGHT_JOB_OWNER_DRAINING')
 await assert.rejects(h.ctx.jobs.resumeOwner({...h.owner}),error=>error.code==='NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 await h.ctx.jobs.resumeOwner(h.owner)
 await h.run([{id:'after-maintenance',name:'launch'}]);assert.equal(h.starts,1)
})

test('cold agent creation repairs terminal-commit enqueue crash gap through private publisher exactly once',async t=>{
 let internal
 const h=await fixture(t,async({ctx,owner,store,started,setPublisher})=>{
  owner.admission=await createBusinessAdmission({store,authorize:async packet=>packet.source.kind==='task-input',bindInternal:value=>{internal=value}});setPublisher(packet=>internal(packet))
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'long notice label '.repeat(30),outputLimitBytes:80,owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed',detail:'producer exited'}),cancel(){}}}},exec)})))
 })
 await h.run([{id:'crash-gap-job',name:'launch'}]);await h.settlement
 assert.deepEqual(h.owner.admission.pending(),[]);assert.equal((await h.store.readAudit()).find(receipt=>receipt.kind==='settled').payload.completionNotice,'pending')
 await h.reopenReceipts();h.owner.admission=await createBusinessAdmission({store:h.store,authorize:async packet=>packet.source.kind==='task-input',bindInternal:value=>{internal=value}})
 const requests=h.requests.length;applyJobTools(h.ctx,{completionDelivery:'inject'});await h.ctx.agents.announce(h.owner,'resume')
 const ids=h.owner.admission.pending();assert.equal(ids.length,1);const packet=h.owner.admission.lookupPacket(ids[0]);assert.equal(packet.source.kind,'job-completion');assert.ok(Buffer.byteLength(packet.content[0].text)<=80)
 await reconcileJobCompletionNotices(h.ctx,h.owner);await reconcileJobCompletionNotices(h.ctx,h.owner)
 assert.deepEqual(h.owner.admission.pending(),ids);assert.equal((await h.store.readAudit()).filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued-internal').length,1);assert.equal(h.requests.length,requests);assert.equal(h.starts,1)
 await assert.rejects(reconcileJobCompletionNotices(h.ctx,{...h.owner}),error=>error.code==='NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 const restored=await createBusinessAdmission({store:h.store,authorize:async()=>false})
 const {session:recipient}=await createAgentSession({cwd:h.root,agentDir:h.agentDir,modelRuntime:h.runtime,model:h.model,resourceLoader:h.loader,settingsManager:h.settings,sessionManager:h.store.manager,noTools:'all'})
 t.after(()=>recipient.dispose())
 await restored.deliver(recipient,ids[0],{deliverAs:'followUp'});assert.deepEqual(restored.pending(),[])
 assert.ok(h.store.manager.getEntries().some(entry=>entry.type==='custom_message'&&entry.details?.packetId===ids[0]))
 await assert.rejects(restored.enqueue({id:'fake-private-source',source:{kind:'job-completion'},content:'spoof'}),{code:'PI_BUSINESS_ADMISSION_DENIED'});await restored.close()
})
for(const mode of ['awaited','kill','teardown'])test('cold recovery never queues the committed '+mode+' completion suppression',async t=>{
 let release,internal,jobId
 const h=await fixture(t,async({ctx,owner,store,started,setPublisher})=>{
  owner.admission=await createBusinessAdmission({store,authorize:async()=>false,bindInternal:value=>{internal=value}});setPublisher(packet=>internal(packet))
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'suppressed completion',owner:owner.id,run(){started();return{done:new Promise(resolve=>{release=resolve}),cancel(){release({status:'killed'})}}}},exec)})))
 })
 await h.run([{id:'suppressed-'+mode,name:'launch'}])
 if(mode==='awaited'){const waiting=h.ctx.jobs.wait(jobId,10000,h.owner.id);release({status:'completed'});await waiting}
 if(mode==='kill')h.ctx.jobs.kill(jobId,h.owner.id)
 if(mode==='teardown')await h.ctx.jobs.drainOwner(h.owner)
 await h.settlement;assert.equal((await h.store.readAudit()).find(receipt=>receipt.kind==='settled').payload.completionNotice,'suppressed')
 await h.reopenReceipts();h.owner.admission=await createBusinessAdmission({store:h.store,authorize:async()=>false,bindInternal:value=>{internal=value}})
 const requests=h.requests.length;applyJobTools(h.ctx,{});await h.ctx.agents.announce(h.owner,'resume');assert.deepEqual(h.owner.admission.pending(),[]);assert.equal(h.requests.length,requests);assert.equal(h.starts,1)
})
test('notice recovery requires strict entry identity and treats older native missing choice as unknown',async t=>{
 const h=await fixture(t),bound={version:1,jobId:'older-native-job',owner:h.owner.id,kind:'fixture',label:'old native fact',startedAt:1,toolCall:{callId:'call-one',rootCallId:'call-one',toolName:'fixture'}}
 h.store.appendAudit({version:1,domain:'job',kind:'registered',payload:{...bound,state:'admitted'}});h.store.appendAudit({version:1,domain:'job',kind:'settled',payload:{...bound,status:'completed',cause:'producer',producerReported:true,finishedAt:2}});await h.store.commit()
 assert.deepEqual(await reconcileJobCompletionNotices(h.ctx,h.owner),{enqueued:0,unknown:1})
 const original=h.owner.receipts;h.owner.receipts={...original,readEntries:undefined};await assert.rejects(reconcileJobCompletionNotices(h.ctx,h.owner),{code:'NIGHT_JOB_COMPLETION_RECEIPTS_REQUIRED'})
 h.owner.receipts={...original,readEntries:async()=>[{entryId:'duplicate',parentId:null,receipt:{version:1,domain:'job',kind:'registered',payload:{...bound,state:'admitted'}}},{entryId:'duplicate',parentId:null,receipt:{version:1,domain:'job',kind:'registered',payload:{...bound,state:'admitted'}}}]};await assert.rejects(reconcileJobCompletionNotices(h.ctx,h.owner),{code:'NIGHT_JOB_COMPLETION_ENTRY_INVALID'});h.owner.receipts=original
 const fresh={...bound,jobId:'private-port-required'};h.store.appendAudit({version:1,domain:'job',kind:'registered',payload:{...fresh,state:'admitted'}});h.store.appendAudit({version:1,domain:'job',kind:'settled',payload:{...fresh,status:'completed',cause:'producer',producerReported:true,finishedAt:2,completionNotice:'pending'}});await h.store.commit()
 await assert.rejects(reconcileJobCompletionNotices(h.ctx,h.owner),{code:'PI_BUSINESS_NOTICE_CAPABILITY_REQUIRED'})
})

test('committed pending decision is not suppressed by a waiter arriving during terminal persistence',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),notified=Promise.withResolvers();let internal,jobId,terminal=false
 t.after(()=>release.resolve())
 const h=await fixture(t,async({ctx,owner,store,started,setPublisher})=>{
  owner.admission=await createBusinessAdmission({store,authorize:async()=>false,bindInternal:value=>{internal=value}});setPublisher(async packet=>{await internal(packet);notified.resolve()})
  const original=owner.receipts;owner.receipts={...original,append(receipt){if(receipt.kind==='settled'){terminal=true;entered.resolve()}return original.append(receipt)},async commit(){if(terminal)await release.promise;return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'choice persistence',owner:owner.id,run(){started();return{done:Promise.resolve({status:'completed'}),cancel(){}}}},exec)})))
 },{notices:true})
 await h.run([{id:'frozen-choice',name:'launch'}]);await entered.promise
 const waiting=h.ctx.jobs.wait(jobId,10000,h.owner.id);release.resolve();await waiting;await notified.promise
 assert.equal((await h.store.readAudit()).find(receipt=>receipt.kind==='settled').payload.completionNotice,'pending');assert.equal(h.owner.admission.pending().length,1)
})

test('official job terminal commit failure keeps outcome uncertain and never publishes success',async t=>{
 const done=Promise.withResolvers();let jobId,terminal=false
 const h=await fixture(t,({ctx,owner,started})=>{
  const original=owner.receipts
  owner.receipts={...original,append(receipt){if(receipt.kind==='settled')terminal=true;return original.append(receipt)},async commit(){if(terminal)throw Error('terminal commit failed');return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'uncertain terminal',owner:owner.id,run(){started();return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec)})))
 })
 h.expectUnknown()
 const published=[];h.ctx.jobs.events.subscribe({owner:h.owner.id},event=>{if(event.type==='settled')published.push(event)})
 await h.run([{id:'uncertain-terminal',name:'launch'}])
 const waiting=h.ctx.jobs.wait(jobId,undefined,h.owner.id),rejected=assert.rejects(waiting,/NIGHT_JOB_JOURNAL_UNCERTAIN/)
 done.resolve({status:'completed'});await rejected
 assert.equal(h.starts,1);assert.deepEqual(published,[])
 assert.equal(h.ctx.jobs.get(jobId,h.owner.id).status,'stopping')
 await assert.rejects(h.ctx.jobs.wait(jobId,undefined,h.owner.id),/NIGHT_JOB_JOURNAL_UNCERTAIN/);assert.throws(()=>h.ctx.jobs.remove(jobId,h.owner.id),/NIGHT_JOB_JOURNAL_UNCERTAIN/)
})

test('official parallel job admission reserves capacity while registration commit is pending',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),done=Promise.withResolvers();let registration=false
 t.after(()=>release.resolve())
 const h=await fixture(t,({ctx,owner,started})=>{
  const original=owner.receipts
  owner.receipts={...original,append(receipt){if(receipt.kind==='registered')registration=true;return original.append(receipt)},async commit(){if(registration){registration=false;entered.resolve();await release.promise}return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'reserved slot',owner:owner.id,run(){started();return{done:done.promise,cancel(){done.resolve({status:'killed'})}}}},exec)}),{isConcurrencySafe:()=>true}))
 },{maxConcurrentJobsPerOwner:1})
 const running=h.run([{id:'first-slot',name:'launch'},{id:'excess-slot',name:'launch'}])
 await entered.promise
 for(let tick=0;tick<50&&!h.results.some(result=>result.toolCallId==='excess-slot');tick++)await setImmediate()
 assert.equal(h.starts,0)
 assert.equal(h.results.find(result=>result.toolCallId==='excess-slot').isError,true)
 release.resolve();await running;assert.equal(h.starts,1)
 done.resolve({status:'completed'});await h.settlement
})

test('official teardown cancellation failure is not a producer exit or successful terminal proof',async t=>{
 const h=await fixture(t,({ctx,owner,started})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'uncertain cancel',owner:owner.id,run(){started();return{done:new Promise(()=>{}),cancel(){throw Error('cancel proof unavailable')}}}},exec)}))))
 h.expectUnknown()
 await h.run([{id:'uncertain-cancel',name:'launch'}])
 await assert.rejects(h.ctx.jobs.disposeAll(),/Job drain proof is uncertain/)
 const settled=(await h.store.readAudit()).filter(receipt=>receipt.kind==='settled')
 assert.equal(settled.length,1);assert.equal(settled[0].payload.producerReported,false)
 assert.equal(settled[0].payload.cause,'teardown');assert.equal(settled[0].payload.status,'failed')
})

const plannedResource=(digit='1')=>({kind:'windows-lpac',version:1,status:'planned',profileName:'nightbot-'+digit.repeat(32),profileSid:null,scopeCount:2,scopeEffects:0,retainedHandles:0,retainedAllocations:0,preparationPending:true,threadRestored:false,childSettled:false,jobEmpty:false,nativeHandlesClosed:false,scopeReleased:false,profileAbsent:false})
const releasedResource=planned=>({...planned,status:'released',profileSid:'S-1-15-2-1-2-3-4-5-6-7',preparationPending:false,threadRestored:true,childSettled:true,jobEmpty:true,nativeHandlesClosed:true,scopeReleased:true,profileAbsent:true})

test('official resource audit commits planned identity before the scripted native boundary and releases only with a durable receipt',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let pending=false,effects=0,record
 const planned=plannedResource(),released=releasedResource(planned)
 const h=await fixture(t,({ctx,owner})=>{
  const original=owner.receipts
  owner.receipts={...original,append(receipt){if(receipt.kind==='resource-ownership'&&receipt.payload.resource.status==='planned')pending=true;return original.append(receipt)},async commit(){if(pending){pending=false;entered.resolve();await release.promise}return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'resource commit gate',owner:owner.id,run(){record=currentProcessResourceRecorder();return{done:(async()=>{const entryId=await record(planned);assert.equal(typeof entryId,'string');effects++;await record(released);return{status:'completed'}})(),cancel(){release.resolve()}}}},exec)})))
 })
 await h.run([{id:'resource-before-effect',name:'launch'}]);await entered.promise;assert.equal(effects,0)
 release.resolve();await h.settlement;assert.equal(effects,1)
 const cold=await h.backend.readNative(h.owner.id,{auditKinds:{...jobReceiptKinds,...admissionAuditKinds}}),resources=cold.audit.filter(receipt=>receipt.kind==='resource-ownership')
 assert.deepEqual(resources.map(receipt=>receipt.payload.seq),[1,2]);assert.deepEqual(resources.map(receipt=>receipt.payload.resource.status),['planned','released'])
 assert.ok(resources.every(receipt=>receipt.payload.toolCall.callId==='resource-before-effect'&&receipt.payload.owner===h.owner.id));assert.deepEqual(unresolvedNativeJobReceipts(cold.audit,h.owner.id),[])
 await assert.rejects(record(released),{code:'NIGHT_JOB_JOURNAL_TERMINAL_DUPLICATE'});assert.equal(currentProcessResourceRecorder(),undefined)
})

test('official resource audit failed commit never acknowledges the scripted native boundary or publishes a terminal success',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let pending=false,effects=0,jobId
 const h=await fixture(t,({ctx,owner})=>{
  const original=owner.receipts
  owner.receipts={...original,append(receipt){if(receipt.kind==='resource-ownership')pending=true;return original.append(receipt)},async commit(){if(pending){entered.resolve();await release.promise;throw Error('resource commit unavailable')}return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'resource commit failure',owner:owner.id,run(){const record=currentProcessResourceRecorder();return{done:(async()=>{await record(plannedResource());effects++;return{status:'completed'}})(),cancel(){release.resolve()}}}},exec)})))
 })
 h.expectUnknown();const published=[];h.ctx.jobs.events.subscribe({owner:h.owner.id},event=>{if(event.type==='settled')published.push(event)})
 await h.run([{id:'resource-no-ack',name:'launch'}]);await entered.promise;assert.equal(effects,0)
 const rejected=assert.rejects(h.ctx.jobs.wait(jobId,10000,h.owner.id),{code:'NIGHT_JOB_JOURNAL_UNCERTAIN'});release.resolve();await rejected
 assert.equal(effects,0);assert.deepEqual(published,[]);assert.equal(h.ctx.jobs.get(jobId,h.owner.id).status,'stopping')
 await assert.rejects(h.ctx.jobs.assertCanRun(h.owner),{code:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY'})
})

test('official resource audit unknown survives producer failure and cold reopen while altered sequence binding or release proof cannot clear it',async t=>{
 const planned=plannedResource(),unknown={...planned,status:'unknown-retained',profileSid:'S-1-15-2-1-2-3-4-5-6-7',preparationPending:false,retainedHandles:1,childSettled:true,jobEmpty:true,threadRestored:true};let starts=0
 const h=await fixture(t,({ctx,owner})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'unknown resource retained',owner:owner.id,run(){starts++;const record=currentProcessResourceRecorder();return{done:(async()=>{await record(planned);await record(unknown);return{status:'failed',detail:'producer exited; owned resource remains unknown'}})(),cancel(){}}}},exec)}))))
 h.expectUnknown();await h.run([{id:'resource-unknown-cold',name:'launch'}]);await h.settlement
 await assert.rejects(h.ctx.jobs.assertCanRun(h.owner),{code:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY'});await h.reopenReceipts()
 const receipts=await h.store.readAudit(),pending=unresolvedNativeJobReceipts(receipts,h.owner.id);assert.equal(pending.length,1);assert.equal(pending[0].resourceOwnership.status,'unknown-retained');assert.equal(pending[0].uncertain,true);assert.equal(starts,1)
 await assert.rejects(h.ctx.jobs.drainOwner(h.owner),/Job drain proof is uncertain/);assert.equal(starts,1)
 const registered=receipts.find(receipt=>receipt.kind==='registered'),resource=receipts.find(receipt=>receipt.kind==='resource-ownership'),terminal=receipts.find(receipt=>receipt.kind==='settled'),base={...resource.payload,seq:2,resource:releasedResource(planned)}
 for(const mutation of [{seq:3},{toolCall:{...base.toolCall,callId:'foreign-call'}},{resource:{...base.resource,profileName:'nightbot-'+'2'.repeat(32)}},{resource:{...base.resource,scopeCount:3}}]){
  const altered={...resource,payload:{...base,...mutation}};assert.equal(unresolvedNativeJobReceipts([registered,resource,altered,terminal],h.owner.id)[0].uncertain,true)
 }
 assert.throws(()=>unresolvedNativeJobReceipts([registered,resource,{...resource,payload:{...base,resource:{...base.resource,profileAbsent:false}}},terminal],h.owner.id),{code:'NIGHT_JOB_RECEIPT_INVALID'})
 const wrongSid={...resource,payload:{...base,seq:3,resource:{...base.resource,profileSid:'S-1-15-2-7-6-5-4-3-2-1'}}}
 assert.equal(unresolvedNativeJobReceipts([...receipts.slice(0,-1),wrongSid,terminal],h.owner.id)[0].uncertain,true)
})

test('official resource audit isolates parallel call recorders and clears inherited ownership for ephemeral jobs',async t=>{
 const seen=new Map(),recorders=new Map();let ephemeral=0
 const h=await fixture(t,({ctx,owner})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:exec.callId,owner:owner.id,run(){
  const record=currentProcessResourceRecorder(),digit=exec.callId==='resource-parallel-a'?'1':'2',planned=plannedResource(digit);recorders.set(exec.callId,record)
  ctx.jobs.start({kind:'ephemeral',label:'no inherited resource owner',owner:owner.id,run(){assert.equal(currentProcessResourceRecorder(),undefined);ephemeral++;return{done:Promise.resolve({status:'completed'}),cancel(){}}}})
  assert.equal(currentProcessResourceRecorder(),record)
  return{done:(async()=>{await setImmediate();assert.equal(currentProcessResourceRecorder(),record);await record(planned);seen.set(exec.callId,planned.profileName);await record(releasedResource(planned));return{status:'completed'}})(),cancel(){}}
 }},exec)}),{isConcurrencySafe:()=>true})))
 await h.run([{id:'resource-parallel-a',name:'launch'},{id:'resource-parallel-b',name:'launch'}]);await h.ctx.jobs.drainOwner(h.owner)
 assert.equal(ephemeral,2);assert.equal(recorders.size,2);assert.notEqual(recorders.get('resource-parallel-a'),recorders.get('resource-parallel-b'))
 const cold=await h.backend.readNative(h.owner.id,{auditKinds:{...jobReceiptKinds,...admissionAuditKinds}}),resources=cold.audit.filter(receipt=>receipt.kind==='resource-ownership')
 assert.equal(resources.length,4);for(const receipt of resources)assert.equal(receipt.payload.resource.profileName,seen.get(receipt.payload.toolCall.callId))
 assert.deepEqual(unresolvedNativeJobReceipts(cold.audit,h.owner.id),[]);assert.equal(currentProcessResourceRecorder(),undefined)
})

// 仅检验真实 Pi 提交/查询边界；这些脚本化 SD 字节不构成原生 ACL 证明。
function privateResourceProof(resource,{fileIds=['a'.repeat(48),'b'.repeat(48)],borrowedFrom=null}={}){
 const descriptor=Buffer.alloc(20);descriptor[0]=1;descriptor.writeUInt16LE(0x8000,2)
 const label=Buffer.alloc(8);label[0]=2;label.writeUInt16LE(8,2)
 const roots=fileIds.map((fileId,index)=>({path:win32.join('C:/','night-job-proof-fixture','scope-'+index),fileId,access:'write'}))
 return {kind:'windows-lpac-private-proof',version:1,profileName:resource.profileName,profileSid:resource.profileSid,scopeCount:resource.scopeCount,phase:'scope-frozen',profile:{moniker:'00',classesLink:'00',registryRoot:null},roots,
  objects:roots.map((root,index)=>({kind:1,role:'scope',name:root.path,fileId:root.fileId,directory:true,parent:null,original:descriptor.toString('hex'),candidate:descriptor.toString('hex'),addedAces:[],label:index===0&&borrowedFrom?{before:null,after:label.toString('hex'),borrowedFrom}:null}))}
}
const ownedResource=planned=>({...planned,status:'unknown-retained',profileSid:'S-1-15-2-1-2-3-4-5-6-7'})

test('official private resource proof shares the durable resource sequence and never acknowledges before commit',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let record,pending=false,ack,effects=0,jobId
 const planned=plannedResource(),owned=ownedResource(planned),proof=privateResourceProof(owned)
 const h=await fixture(t,({ctx,owner})=>{
  const original=owner.receipts
  owner.receipts={...original,append(receipt){if(receipt.payload?.privateProof)pending=true;return original.append(receipt)},async commit(){if(pending){pending=false;entered.resolve();await release.promise}return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'private resource commit gate',owner:owner.id,run(){record=currentProcessResourceRecorder();return{done:(async()=>{await record(planned);ack=await record.withProof(owned,proof);effects++;await record(releasedResource(planned));return{status:'completed'}})(),cancel(){release.resolve()}}}},exec)})))
 })
 await h.run([{id:'private-resource-gate',name:'launch'}]);await entered.promise;assert.equal(effects,0);assert.equal(ack,undefined)
 let queryFinished=false;const waiting=record.readScopeProofs(['a'.repeat(48)]).then(value=>{queryFinished=true;return value});await setImmediate();assert.equal(queryFinished,false)
 release.resolve();await h.settlement;await waiting;assert.equal(effects,1)
 const entries=await h.store.readAuditEntries(),resources=entries.filter(entry=>entry.receipt.kind==='resource-ownership');assert.deepEqual(resources.map(entry=>entry.receipt.payload.seq),[1,2,3]);assert.equal(ack,resources[1].entryId)
 const live=await record.readScopeProofs(['a'.repeat(48)]);assert.equal(live.length,1);assert.equal(live[0].entryId,ack);assert.equal(live[0].jobId,jobId);assert.equal(live[0].resource.status,'released');assert.deepEqual(live[0].privateProof,proof)
 const publicView=JSON.stringify({jobs:h.ctx.jobs.list(h.owner.id),results:h.results,requests:h.requests});for(const secret of ['privateProof','windows-lpac-private-proof','night-job-proof-fixture'])assert.equal(publicView.includes(secret),false)
 await h.store.close();assert.deepEqual(await record.readScopeProofs(['a'.repeat(48)]),live);await h.reopenReceipts()
})

test('official private resource proof rejects altered bindings and failed commit without an ACK or native effect',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let pending=false,record,effects=0,ack,jobId
 const planned=plannedResource(),owned=ownedResource(planned),proof=privateResourceProof(owned)
 const h=await fixture(t,({ctx,owner})=>{
  const original=owner.receipts
  owner.receipts={...original,append(receipt){if(receipt.payload?.privateProof)pending=true;return original.append(receipt)},async commit(){if(pending){entered.resolve();await release.promise;throw Error('private proof commit unavailable')}return original.commit()}}
  ctx.tools.register(definition('launch',async(_args,exec)=>({id:jobId=await ctx.jobs.startDurable({kind:'fixture',label:'private proof rejection',owner:owner.id,run(){record=currentProcessResourceRecorder();return{done:(async()=>{
   await record(planned)
   for(const invalid of [{...proof,extra:true},{...proof,profileName:'nightbot-'+'2'.repeat(32)},{...proof,profileSid:'S-1-15-2-7-6-5-4-3-2-1'},privateResourceProof({...owned,scopeCount:3},{fileIds:['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)]})])await assert.rejects(record.withProof(owned,invalid),{code:'NIGHT_JOB_RECEIPT_INVALID'})
   ack=await record.withProof(owned,proof);effects++;return{status:'completed'}
  })(),cancel(){release.resolve()}}}},exec)})))
 })
 h.expectUnknown();await h.run([{id:'private-proof-no-ack',name:'launch'}]);await entered.promise;assert.equal(effects,0)
 const rejected=assert.rejects(h.ctx.jobs.wait(jobId,10000,h.owner.id),{code:'NIGHT_JOB_JOURNAL_UNCERTAIN'});release.resolve();await rejected
 assert.equal(effects,0);assert.equal(ack,undefined);assert.equal(h.ctx.jobs.get(jobId,h.owner.id).status,'stopping');await assert.rejects(record.readScopeProofs(['a'.repeat(48)]),{code:'NIGHT_JOB_JOURNAL_UNCERTAIN'})
 await assert.rejects(h.ctx.jobs.assertCanRun(h.owner),{code:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY'})
})

test('official private resource proof retains the released source anchor and borrow closure across live and cold Pi reads',async t=>{
 let record,sourceRef,sourceAck,launches=0;const ids=[]
 const h=await fixture(t,({ctx,owner})=>ctx.tools.register(definition('launch',async(_args,exec)=>{
  const index=launches++,planned=plannedResource(String(index+1)),owned=ownedResource(planned),proof=privateResourceProof(owned,index?{fileIds:['a'.repeat(48),'c'.repeat(48)],borrowedFrom:sourceRef}:{})
  const id=await ctx.jobs.startDurable({kind:'fixture',label:'private source or borrower',owner:owner.id,run(){record=currentProcessResourceRecorder();return{done:(async()=>{await record(planned);const ack=await record.withProof(owned,proof);if(index===0)sourceAck=ack;await record(releasedResource(planned));return{status:'completed'}})(),cancel(){}}}},exec);ids.push(id);return{id}
 })))
 await h.run([{id:'private-source',name:'launch'}]);await h.ctx.jobs.wait(ids[0],10000,h.owner.id);sourceRef={owner:h.owner.id,jobId:ids[0],entryId:sourceAck,fileId:'a'.repeat(48)}
 await h.run([{id:'private-borrower',name:'launch'}]);await h.ctx.jobs.wait(ids[1],10000,h.owner.id)
 const live=await record.readScopeProofs(['a'.repeat(48)]);assert.equal(live.length,2);assert.deepEqual(live.map(row=>row.jobId),ids);assert.equal(live[0].entryId,sourceAck);assert.ok(live.every(row=>row.resource.status==='released'));assert.deepEqual(live[1].privateProof.objects[0].label.borrowedFrom,sourceRef)
 await h.store.close();assert.deepEqual(await record.readScopeProofs(['a'.repeat(48)]),live);await h.reopenReceipts()
})

test('official private resource proof refuses missing or mismatched borrow anchors from actual committed Pi receipts',async t=>{
 for(const kind of ['missing-entry','wrong-file-id'])await t.test(kind,async sub=>{
  let record;const planned=plannedResource(),owned=ownedResource(planned)
  const h=await fixture(sub,({ctx,owner})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:kind,owner:owner.id,run(){record=currentProcessResourceRecorder();return{done:(async()=>{await record(planned);let anchor={owner:owner.id,jobId:'missing-original-job',entryId:'missing-original-entry',fileId:'a'.repeat(48)};if(kind==='wrong-file-id'){const entryId=await record.withProof(owned,privateResourceProof(owned)),entry=(await owner.receipts.readEntries()).find(row=>row.entryId===entryId);anchor={owner:owner.id,jobId:entry.receipt.payload.jobId,entryId,fileId:'b'.repeat(48)}}const proof=privateResourceProof(owned,{borrowedFrom:anchor});await record.withProof(owned,proof);await record(releasedResource(planned));return{status:'completed'}})(),cancel(){}}}},exec)}))))
  await h.run([{id:'private-'+kind,name:'launch'}]);await h.settlement;await assert.rejects(record.readScopeProofs(['a'.repeat(48)]),{code:'NIGHT_JOB_JOURNAL_UNCERTAIN'})
 })
})

test('official private resource proof cold query rejects an actual uncommitted Pi tail without changing the file',async t=>{
 let record;const planned=plannedResource(),owned=ownedResource(planned)
 const h=await fixture(t,({ctx,owner})=>ctx.tools.register(definition('launch',async(_args,exec)=>({id:await ctx.jobs.startDurable({kind:'fixture',label:'strict cold proof',owner:owner.id,run(){record=currentProcessResourceRecorder();return{done:(async()=>{await record(planned);await record.withProof(owned,privateResourceProof(owned));await record(releasedResource(planned));return{status:'completed'}})(),cancel(){}}}},exec)}))))
 await h.run([{id:'private-cold-tail',name:'launch'}]);await h.settlement;await h.store.close()
 const files=await readdir(join(h.root,'durable-jobs')),file=join(h.root,'durable-jobs',files.find(name=>name.endsWith('.pi.jsonl'))),before=await readFile(file)
 const extra='{"uncommitted":';await appendFile(file,extra)
 try{await assert.rejects(record.readScopeProofs(['a'.repeat(48)]),{code:'NIGHT_JOB_JOURNAL_UNCERTAIN'});assert.deepEqual(await readFile(file),Buffer.concat([before,Buffer.from(extra)]))}finally{await truncate(file,before.length);await h.reopenReceipts()}
})
