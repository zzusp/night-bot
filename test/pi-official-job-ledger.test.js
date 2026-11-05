import test from 'node:test'
import {createAgentSession} from '@earendil-works/pi-coding-agent'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {setImmediate} from 'node:timers/promises'
import {definition,officialToolsFixture} from './fixtures/pi-official-tools.js'
import NativeSessions from '../src/native-sessions.js'
import NativeProjections from '../src/native-projections.js'
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
async function fixture(t,register,{notices=false}={}){
 let store,backend,starts=0,expectUnknown=false,publish;const settlement=Promise.withResolvers()
 const h=await officialToolsFixture(t,async({ctx,owner,root})=>{
  ctx.logger={warn(){},error(){}};new NativeSessions(ctx);new NativeProjections(ctx);new NativeAgents(ctx);new NativeJobs(ctx,{pumpPollMs:1});new NativePolicy(ctx,{mode:'workspace-write',workspaceRoot:root});authority(ctx)
  backend=new PiPersistence(ctx,{root:join(root,'durable-jobs')});store=await backend.createNative(ctx.sessions.prepare(owner.id,{meta:{cwd:root}}).header,{auditKinds:{...jobReceiptKinds,...admissionAuditKinds}})
  owner.receipts={append:receipt=>store.appendAudit(receipt),commit:()=>store.commit(),read:()=>store.readAudit(),readEntries:()=>store.readAuditEntries()}
  bindWorkingDirectoryActor(owner,{initialDirectory:root,isLive:()=>ctx.agents.get(owner.id)===owner,readDirectory:()=>root,appendChange(){throw Error('not changing cwd')},admitNotice(){}})
  bindSandboxPolicyActor(owner,{initialDirectory:root,isLive:()=>ctx.agents.get(owner.id)===owner,readPolicy:()=>({mode:'workspace-write',artifactRoot:null}),appendPolicy(){throw Error('not changing policy')}})
  ctx.jobs.attachController('official-test');ctx.jobs.events.subscribe({owners:'scope'},event=>{if(event.type==='settled')settlement.resolve(event)})
  if(notices)applyJobTools(ctx,{completionDelivery:'inject'})
  await register?.({ctx,owner,store,started(){starts++},setPublisher(value){publish=value}})
 })
 const detach=h.ctx.agents.enter(h.owner)
 if(publish)h.deferCleanup(bindBusinessNotices(h.owner,{enqueue:publish,isLive:actor=>h.ctx.agents.get(actor.id)===actor}))
 h.deferCleanup(async()=>{try{await h.ctx.jobs.drainOwner(h.owner)}catch(error){if(!expectUnknown||error.code!=='NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY')throw error}finally{detach();await store.close()}})
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
