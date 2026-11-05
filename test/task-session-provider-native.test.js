import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {isRetryableAssistantError} from '@earendil-works/pi-ai'
import {providerHost,taskRequest,result,latestInput} from './fixtures/provider-official-host.js'
const transient='503 Service temporarily unavailable: fixture overload'
const effect={name:'provider_effect_once',args:{}}
const sawEffect=request=>request.messages.some(message=>message.role==='toolResult'&&!message.isError&&JSON.stringify(message.content).includes('ORIGINAL_PROVIDER_EFFECT_RECEIPT'))

test('official Pi retry classifier distinguishes transient assistant failures from quota, auth, stop and abort',()=>{
 for(const errorMessage of ['503 Service unavailable','429 rate limit','overloaded'])assert.equal(isRetryableAssistantError({stopReason:'error',errorMessage}),true)
 for(const errorMessage of ['401 invalid account','insufficient_quota','billing quota exceeded'])assert.equal(isRetryableAssistantError({stopReason:'error',errorMessage}),false)
 for(const stopReason of ['stop','aborted','length'])assert.equal(isRetryableAssistantError({stopReason,errorMessage:transient}),false)
})
for(const partial of [false,true])test(`official retry preserves the original signed failure and never executes its partial tools: partial=${partial}`,{timeout:15000},async t=>{
 let failed=false
 const h=await providerHost(t,{intercept:request=>{if(taskRequest(request)&&!failed){failed=true;return {stopReason:'error',errorMessage:transient,responseId:'signed-original-error',content:[{type:'text',text:'partial diagnostic',textSignature:'original-signature'},...partial?[{type:'toolCall',id:'never-execute-partial',name:'provider_effect_once',arguments:{}}]:[]]}}},decide:request=>sawEffect(request)?[result('complete')]:[effect]})
 const id=await h.create();await h.service.whenIdle();const stored=await h.stored(id),error=stored.entries.find(e=>e.type==='message'&&e.message.responseId==='signed-original-error')
 assert.equal(stored.task.status,'completed');assert.equal(h.effects,1);assert.equal(stored.task.leaseEpoch,1);assert.equal(error.message.content[0].textSignature,'original-signature');assert.ok(!stored.entries.some(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolCallId==='never-execute-partial'));assert.equal(stored.context.projection.messages.some(message=>message.role==='assistant'&&message.responseId==='signed-original-error'),false);assert.equal(h.events.filter(e=>e.type==='auto_retry_start').length,1);assert.equal(h.events.find(e=>e.type==='auto_retry_end').success,true)
})
test('stale input drains and resumes the same Single journal without retrying its completed read',{timeout:20000},async t=>{
 let injected=false
 const h=await providerHost(t,{decide:async(request,host)=>{const input=latestInput(request);if(injected)return [result('complete','Read retained evidence under the current supplemented input')];const file=join(host.ctx.runtimePaths.workspaces,'tasks',input.task.taskId,'work/evidence.txt');await writeFile(file,'Retained evidence');const properties=request.tools.find(tool=>tool.name==='read').parameters.properties;return [{name:'read',args:{[Object.hasOwn(properties,'path')?'path':'file_path']:'work/evidence.txt'}}]}})
 h.ctx.on('tools/post-execute',async(exec,value,next)=>{const decision=await next();if(exec.name==='read'&&!value.isError&&!injected){injected=true;const task=(await h.query('task.list'))[0];await h.service.store.command({id:'supplement-after-read',kind:'task.supplement',args:{taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,messageId:'supplement-after-read',text:'Only inspect retained evidence; do not repeat work',request:task.request+'\nInspect retained evidence'}})}return decision})
 const id=await h.create();await h.service.whenIdle();const stored=await h.stored(id);assert.equal(stored.task.status,'completed');assert.equal(stored.task.leaseEpoch,2);assert.equal(h.toolResults.filter(row=>row.name==='read'&&!row.result.isError).length,1);assert.equal(h.events.length,0);const packets=stored.entries.filter(e=>e.type==='custom_message'&&e.customType==='night.business-input'&&e.details.source.kind==='task-input');assert.deepEqual(packets.map(e=>e.details.source.taskSession.leaseEpoch),[1,2]);assert.equal((await h.query('execution.list')).length,0)
})
test('configured provider retries through SDK events within the same task lease instead of a Night owner cooldown',{timeout:15000},async t=>{
 let failed=false
 const h=await providerHost(t,{intercept:request=>{if(taskRequest(request)&&!failed){failed=true;return {stopReason:'error',errorMessage:transient}}},decide:()=>[result('complete')]})
 const id=await h.create();await h.service.whenIdle();const stored=await h.stored(id);assert.equal(stored.task.status,'completed');assert.equal(stored.task.leaseEpoch,1);assert.equal(stored.task.providerRecovery??null,null);assert.equal(stored.task.humanRequests.length,0);assert.equal(h.taskRequests().length,2);assert.equal(h.events.filter(e=>e.type==='auto_retry_start').length,1)
})
for(const restart of [false,true])test(`normal empty SDK completion stays technical and cannot manufacture a task result: restart=${restart}`,{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'provider-empty-'));let first,second;t.after(async()=>{await second?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 first=await providerHost(t,{root,decide:()=>[]});const id=await first.create();await first.service.whenIdle();const stored=await first.stored(id);assert.equal(stored.task.completion??null,null);assert.equal(stored.task.drained,true);assert.equal(stored.task.humanRequests.length,0);assert.equal(first.events.length,0);assert.equal(first.taskRequests().length,1);await first.service.recover();await first.service.whenIdle();assert.equal(first.taskRequests().length,1)
 if(restart){await first.close();second=await providerHost(t,{root,initialize:false,decide:()=>[result('complete')]});await second.service.recover();await second.service.whenIdle();assert.equal(second.taskRequests().length,0);assert.equal((await second.query('task.get',{taskId:id})).sessionId,stored.task.sessionId)}
})
for(const transientFailure of [true,false])test(`native error stays raw evidence without legacy terminal inference: retryable=${transientFailure}`,{timeout:15000},async t=>{
 const message=transientFailure?transient:'401 account configuration invalid',h=await providerHost(t,{retry:{enabled:false},intercept:request=>taskRequest(request)?{stopReason:'error',errorMessage:message}:undefined})
 const id=await h.create();await h.service.whenIdle();const stored=await h.stored(id);assert.ok(stored.entries.some(e=>e.type==='message'&&e.message.stopReason==='error'&&e.message.errorMessage===message));assert.equal(stored.task.completion??null,null);assert.equal(stored.task.humanRequests.length,0);await h.service.recover();await h.service.whenIdle();assert.equal(h.taskRequests().length,1);assert.equal(h.events.length,0)
})
for(const empty of [false,true])test(`SDK retry budget and durable admission hold bound failed runs across restart: empty=${empty}`,{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'provider-budget-'));let first,second;t.after(async()=>{await second?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 const intercept=request=>taskRequest(request)?{stopReason:empty?'stop':'error',errorMessage:empty?undefined:transient}:undefined
 first=await providerHost(t,{root,retry:{enabled:true,maxRetries:2,baseDelayMs:1,maxAgentDelayMs:5,provider:{maxRetries:0}},intercept});const id=await first.create();await first.service.whenIdle();const before=await first.stored(id);assert.equal(first.taskRequests().length,empty?1:3);assert.equal(first.events.filter(e=>e.type==='auto_retry_start').length,empty?0:2);await first.close()
 second=await providerHost(t,{root,initialize:false,decide:()=>[result('complete')]});for(let i=0;i<3;i++){await second.service.recover();await second.service.whenIdle()}assert.equal(second.taskRequests().length,0)
 await second.service.appendTaskContext({taskId:id,requestId:'real-new-input',progressImpact:'replan',context:'The provider is available; continue using the retained native task.'});await second.service.whenIdle();const after=await second.stored(id);assert.equal(after.task.status,'completed');assert.equal(after.task.sessionId,before.task.sessionId);assert.equal(after.task.humanRequests.length,0);assert.equal(second.taskRequests().length,1)
})
for(const newInput of [false,true])test(`unconfigured task provider/model cannot hot-loop or borrow another route: newInput=${newInput}`,{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'provider-route-'));let h,restored;t.after(async()=>{await restored?.close();await h?.close();await rm(root,{recursive:true,force:true})});h=await providerHost(t,{root,config:{provider:newInput?'native-task-test':'unconfigured',model:'later-model'},models:['later-model'],decide:()=>[result('complete')]});h.profile.models=h.profile.models.filter(model=>model.id!=='later-model')
 const id=await h.create();await h.service.whenIdle();assert.equal(h.taskRequests().length,0);assert.equal(h.events.length,0);const before=await h.query('task.get',{taskId:id});assert.equal(before.completion??null,null);assert.equal(before.drained,true)
 for(let i=0;i<3;i++){await h.service.recover();await h.service.whenIdle()}assert.equal(h.taskRequests().length,0)
 if(newInput){await h.close();restored=await providerHost(t,{root,initialize:false,config:{model:'later-model'},models:['later-model'],decide:()=>[result('complete')]});h=restored;await h.service.appendTaskContext({taskId:id,requestId:'model-route-restored',progressImpact:'replan',context:'The explicitly configured model route is restored.'});await h.service.whenIdle();assert.equal((await h.query('task.get',{taskId:id})).status,'completed');assert.equal(h.taskRequests()[0].model,'later-model')}
})

for(const mode of ['provider-error','successful-text-without-task-result'])test(`Single ${mode} never creates a Host retry window, including after a one-hour clock advance and cold restore`,{timeout:20000},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 const root=await mkdtemp(join(tmpdir(),'single-no-host-retry-'));let first,cold;t.after(async()=>{await cold?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 const retry={enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:5,provider:{maxRetries:0}},failure=request=>taskRequest(request)?mode==='provider-error'?{stopReason:'error',errorMessage:transient}:{stopReason:'stop',content:[{type:'text',text:'Successful final answer without the required task_result'}]}:undefined,expectedCode=mode==='provider-error'?'TASK_PI_PROVIDER_ERROR':'TASK_SESSION_NO_SUBMISSION'
 first=await providerHost(t,{root,retry,intercept:failure});const id=await first.create('no-host-retry');await first.service.whenIdle();const before=await first.stored(id),count=first.taskRequests().length
 assert.equal(count,mode==='provider-error'?2:1);assert.equal(before.task.providerRecovery??null,null);assert.equal(before.task.technicalFailure.code,expectedCode);assert.equal(before.task.technicalFailure.stopReason,mode==='provider-error'?'error':'stop');assert.equal(before.task.lastDecision.action,'wait');assert.equal(before.task.completion??null,null);assert.equal(before.task.humanRequests.length,0);assert.ok((await first.query('wake.list',{taskId:id})).every(wake=>wake.state==='acked'))
 for(let n=0;n<3;n++){t.mock.timers.setTime(Date.now()+3600000);await first.service.recover();await first.service.whenIdle();assert.equal(first.taskRequests().length,count)}
 await first.close();cold=await providerHost(t,{root,initialize:false,retry,intercept:failure});for(let n=0;n<3;n++){t.mock.timers.setTime(Date.now()+3600000);await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.taskRequests().length,0)}
 assert.equal(cold.events.length,0);assert.equal((await cold.query('task.get',{taskId:id})).sessionId,before.task.sessionId)
})

test('cold Single holds Night own persisted Host providerRecovery without deleting original Pi effects or sources',{timeout:20000},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 const root=await mkdtemp(join(tmpdir(),'night-own-recovery-upgrade-'));let first,cold;t.after(async()=>{await cold?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 first=await providerHost(t,{root,decide:request=>sawEffect(request)?[result()]:[effect]});const id=await first.create('prior-night-business-state');await first.service.whenIdle();const original=await first.stored(id),source=await first.query('source.get',{sourceId:original.task.sourceRefs[0]})
 await first.service.store.command({id:'prior-night-pending-wake',kind:'task.wake',args:{taskId:id,kind:'task.provider-recovery',payload:{reason:'previous Night Host retry'}}})
 const claimed=await first.service.store.command({id:'prior-night-claim',kind:'task.claim',args:{taskId:id}}),binding=claimed.result.binding
 await first.service.store.command({id:'prior-night-provider-failure',kind:'task.provider-failure',args:{binding,failure:{code:'TASK_SESSION_NO_SUBMISSION',phase:'decision'}}})
 await first.service.store.command({id:'prior-night-drained',kind:'task.drained',args:{binding}})
 const prior=await first.query('task.get',{taskId:id});assert.ok(prior.providerRecovery.nextAttemptAt);assert.equal(first.effects,1);await first.close()
 t.mock.timers.setTime(Date.parse(prior.providerRecovery.nextAttemptAt)+1)
 cold=await providerHost(t,{root,initialize:false,decide:request=>{assert.equal(sawEffect(request),true);return [result('complete')]}})
 for(let n=0;n<3;n++){await cold.service.recover();await cold.service.whenIdle();t.mock.timers.setTime(Date.now()+3600000)}
 assert.equal(cold.taskRequests().length,0);const held=await cold.stored(id);assert.equal(held.task.providerRecovery.hostRetryDisabled,true);assert.equal(held.task.providerRecovery.nextAttemptAt,null);assert.equal(held.task.providerRecovery.attempts,prior.providerRecovery.attempts);assert.deepEqual(held.task.providerRecovery.failure,prior.providerRecovery.failure);assert.deepEqual(held.entries,original.entries);assert.deepEqual(await cold.query('source.get',{sourceId:source.sourceId}),source);assert.equal(await (await import('node:fs/promises')).readFile(join(cold.ctx.runtimePaths.workspaces,'tasks',id,'work/provider-effect.txt'),'utf8'),'one original effect')
 await cold.service.appendTaskContext({taskId:id,requestId:'actual-new-business-input',progressImpact:'replan',context:'Read the original successful receipt under current scope; never repeat its effect.'});await cold.service.whenIdle();const after=await cold.stored(id);assert.equal(after.task.status,'completed');assert.equal(after.task.sessionId,original.task.sessionId);assert.equal(cold.effects,0);assert.equal(cold.taskRequests().length,1);assert.equal(after.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,1)
})
