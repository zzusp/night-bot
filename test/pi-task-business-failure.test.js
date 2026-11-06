import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {openDynamicTaskStore,pendingTaskHumanReview} from '../packages/dingtalk-core/dynamic-task-store.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-task-business-failure-'));let db=await openDynamicTaskStore({dbPath:join(root,'tasks.sqlite'),instanceId:'business-failure',webActorId:'operator',initialize:true}),n=0;t.after(async()=>{await db.close();await rm(root,{recursive:true,force:true})});const f={command:(kind,args,id=kind+':'+(++n))=>db.command({kind,args,id}),query:(kind,args={})=>db.query({kind,...args}),async cold(){await db.close();db=await openDynamicTaskStore({dbPath:join(root,'tasks.sqlite'),instanceId:'business-failure',webActorId:'operator'})}};await f.command('task.create',{taskId:'task',groupId:'group',ownerActorId:'operator',request:'Original authorized objective'});return f}
const failure={code:'TASK_PI_PROVIDER_ERROR',phase:'decision',stopReason:'error'}
async function claim(f,args={}){return(await f.command('task.claim',{taskId:'task',...args})).result}
async function drain(f,binding){await f.command('task.drained',{binding})}
test('technical failure is durable business wait with ACK, not provider backoff or invented human response',async t=>{
 const f=await fixture(t),{binding,wakeIds}=await claim(f)
 await assert.rejects(f.command('task.wait',{binding,summary:'technical wait',technicalFailure:{...failure,message:'Do not persist raw provider text'}}),{code:'DYNAMIC_ARGUMENT_INVALID'})
 await f.command('task.wait',{binding,action:'wait',summary:'Current input stopped after official retry exhaustion',technicalFailure:failure});await f.command('wake.ack',{binding,wakeIds});await drain(f,binding);await f.cold()
 const task=await f.query('task.get',{taskId:'task'});assert.deepEqual(task.technicalFailure,failure);assert.equal(task.lastDecision.action,'wait');assert.equal(task.lastDecision.question,null);assert.equal(task.humanRequests.length,0);assert.equal(task.providerRecovery,null);assert.equal((await f.query('wake.list',{taskId:'task'})).every(wake=>wake.state==='acked'),true)
})
test('dialogue failure retains its exact text without reply, ACKs atomically, admits only a new message and survives completion/archive',async t=>{
 const f=await fixture(t),base=await claim(f);await f.command('wake.ack',{binding:base.binding,wakeIds:base.wakeIds});await drain(f,base.binding)
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'first',text:'Original unanswered dialogue'})
 const first=await claim(f,{dialogue:true});await f.command('task.dialogue.failed',{binding:first.binding,messageId:'first',failure});await drain(f,first.binding);await f.cold()
 let task=await f.query('task.get',{taskId:'task'});assert.equal(task.dialogue[0].text,'Original unanswered dialogue');assert.equal(task.dialogue[0].reply,null);assert.deepEqual(task.dialogue[0].replyError,failure);assert.equal((await f.query('wake.list',{taskId:'task'})).every(wake=>wake.state==='acked'),true)
 await assert.rejects(claim(f,{dialogue:true}),{code:'DYNAMIC_TASK_NO_WAKE'})
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'second',text:'Actual new dialogue'});const second=await claim(f,{dialogue:true});assert.deepEqual(second.wakes.map(wake=>wake.payload.messageId),['second'])
 await f.command('task.dialogue.reply',{binding:second.binding,messageId:'second',reply:'An actual new model reply'});await drain(f,second.binding)
 const finishing=await claim(f,{force:true});await f.command('task.complete',{binding:finishing.binding,summary:'A later authorized execution completed'});await drain(f,finishing.binding);await f.command('task.archive',{taskId:'task',actorId:'operator'})
 task=await f.query('task.get',{taskId:'task'});assert.equal(task.dialogue[0].reply,null);assert.deepEqual(task.dialogue[0].replyError,failure);assert.equal(task.dialogue[1].reply,'An actual new model reply');assert.ok(task.archivedAt)
})
test('human review failure retains candidate sources and wake receipts but cannot re-review the same batch',async t=>{
 const f=await fixture(t),base=await claim(f)
 await f.command('task.wait',{binding:base.binding,action:'wait',summary:'Need the actual fact',question:'What is the verified value?',humanRequest:{requestId:'question',audience:'requester'}});await f.command('wake.ack',{binding:base.binding,wakeIds:base.wakeIds});await drain(f,base.binding)
 async function add(id,refs){await f.command('source.record',{sourceId:id,groupId:'group',messageId:id,actorId:'business-user',channel:'im',text:'Real accepted business reply '+id,timestamp:new Date().toISOString()});await f.command('task.supplement',{taskId:'task',messageId:id,text:'Accepted new source',sourceRefs:refs,expectedRequirementRevision:1,expectedControlRevision:1})}
 await add('candidate',['candidate']);const review=await claim(f,{humanReview:true});await f.command('task.wait',{binding:review.binding,action:'blocked',summary:'Review stopped without an answer',technicalFailure:failure,reviewFailureCode:failure.code});await drain(f,review.binding)
 let task=await f.query('task.get',{taskId:'task'}),wakes=await f.query('wake.list',{taskId:'task'});assert.equal(task.humanRequests[0].status,'waiting-reply');assert.deepEqual(task.humanRequests[0].reviewFailures[0].sourceIds,['candidate']);assert.equal(wakes.some(wake=>wake.state==='claimed'),true);assert.equal(pendingTaskHumanReview(task,wakes),null);assert.equal(task.providerRecovery,null)
 await add('new-candidate',['candidate','new-candidate']);task=await f.query('task.get',{taskId:'task'});wakes=await f.query('wake.list',{taskId:'task'});assert.deepEqual(pendingTaskHumanReview(task,wakes).sourceIds,['candidate','new-candidate'])
})
test('Night persisted Host retry is held without changing drain and only a new drained input clears the hold',async t=>{
 const f=await fixture(t),base=await claim(f);await f.command('task.provider-failure',{binding:base.binding,failure:{code:'TASK_SESSION_NO_SUBMISSION'}});await f.command('task.provider-retry-disabled',{taskId:'task'})
 let task=await f.query('task.get',{taskId:'task'});assert.equal(task.drained,false);assert.equal(task.providerRecovery.nextAttemptAt,null);assert.equal(task.providerRecovery.hostRetryDisabled,true);assert.equal(task.technicalFailure.code,'TASK_PI_HOST_RETRY_DISABLED')
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'before-drain',text:'Accepted while still unproven'});task=await f.query('task.get',{taskId:'task'});assert.equal(task.providerRecovery.hostRetryDisabled,true)
 await drain(f,base.binding);await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'before-drain',text:'Accepted while still unproven'});task=await f.query('task.get',{taskId:'task'});assert.equal(task.providerRecovery.hostRetryDisabled,true,'duplicate request is not new authority')
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'after-drain',text:'A new explicit input after genuine owner drain'});task=await f.query('task.get',{taskId:'task'});assert.equal(task.providerRecovery,null)
})
test('upgrading old dialogue retry closes the prior failed payload while only a new message is admitted',async t=>{
 const f=await fixture(t),base=await claim(f);await f.command('wake.ack',{binding:base.binding,wakeIds:base.wakeIds});await drain(f,base.binding)
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'old-message',text:'Original failed payload'});const old=await claim(f,{dialogue:true});await f.command('task.provider-failure',{binding:old.binding,failure:{code:'TASK_SESSION_NO_SUBMISSION'}});await drain(f,old.binding);await f.command('task.provider-retry-disabled',{taskId:'task'})
 let task=await f.query('task.get',{taskId:'task'});assert.equal(task.dialogue[0].reply,null);assert.equal(task.dialogue[0].replyError.code,'TASK_PI_HOST_RETRY_DISABLED');assert.equal(task.providerRecovery.attempts,1);assert.deepEqual(task.providerRecovery.failure,{code:'TASK_SESSION_NO_SUBMISSION'});assert.equal((await f.query('wake.list',{taskId:'task'})).every(wake=>wake.state==='acked'),true)
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'old-message',text:'Original failed payload'});task=await f.query('task.get',{taskId:'task'});assert.equal(task.providerRecovery.hostRetryDisabled,true)
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'new-message',text:'New actual message'});const fresh=await claim(f,{dialogue:true});assert.deepEqual(fresh.wakes.map(wake=>wake.payload.messageId),['new-message']);assert.equal((await f.query('task.get',{taskId:'task'})).dialogue[0].reply,null)
})
test('upgrading old human-review retry records its failed batch without consuming the candidate',async t=>{
 const f=await fixture(t),base=await claim(f);await f.command('task.wait',{binding:base.binding,action:'wait',summary:'Need actual reply',question:'Which verified value?',humanRequest:{requestId:'question',audience:'requester'}});await f.command('wake.ack',{binding:base.binding,wakeIds:base.wakeIds});await drain(f,base.binding)
 await f.command('source.record',{sourceId:'candidate',groupId:'group',messageId:'candidate',actorId:'business-user',channel:'im',text:'Actual accepted reply',timestamp:new Date().toISOString()});await f.command('task.supplement',{taskId:'task',messageId:'candidate',text:'Accepted reply',sourceRefs:['candidate'],expectedRequirementRevision:1,expectedControlRevision:1});const review=await claim(f,{humanReview:true})
 await f.command('task.provider-failure',{binding:review.binding,failure:{code:'TASK_SESSION_NO_SUBMISSION'}});await drain(f,review.binding);await f.command('task.provider-retry-disabled',{taskId:'task'})
 let task=await f.query('task.get',{taskId:'task'}),wakes=await f.query('wake.list',{taskId:'task'});assert.equal(task.humanRequests[0].status,'waiting-reply');assert.equal(task.humanRequests[0].reviewFailures[0].code,'TASK_PI_HOST_RETRY_DISABLED');assert.deepEqual(task.humanRequests[0].reviewFailures[0].sourceIds,['candidate']);assert.equal(wakes.some(wake=>wake.state==='claimed'),true);assert.equal(pendingTaskHumanReview(task,wakes),null)
 await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'new-dialogue',text:'A factual dialogue cannot reopen the failed review batch'});task=await f.query('task.get',{taskId:'task'});wakes=await f.query('wake.list',{taskId:'task'});assert.equal(pendingTaskHumanReview(task,wakes),null);assert.deepEqual(task.sourceRefs,['candidate'])
})
test('new business input never clears an existing unknown-effect recovery fence',async t=>{
 const f=await fixture(t),base=await claim(f);await f.command('task.wait',{binding:base.binding,action:'blocked',summary:'Unknown external outcome remains held',limitations:['TASK_EFFECT_UNCERTAIN_NO_REPLAY']});await f.command('task.provider-failure',{binding:base.binding,failure:{code:'TASK_SESSION_NO_SUBMISSION'}});await drain(f,base.binding);await f.command('task.provider-retry-disabled',{taskId:'task'});await f.command('task.dialogue.add',{taskId:'task',actorId:'operator',requestId:'new-but-not-reconciled',text:'This input is not a reconciliation proof'})
 const task=await f.query('task.get',{taskId:'task'});assert.equal(task.providerRecovery.hostRetryDisabled,true);assert.deepEqual(task.lastDecision.limitations,['TASK_EFFECT_UNCERTAIN_NO_REPLAY']);assert.equal(task.drained,true)
})
