import testRunner from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp as makeTemp,rm as remove,readFile,access,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {providerHost,taskRequest,result,latestInput,topicTaskCalls,modelToolValues} from './fixtures/provider-official-host.js'
import {nativeRuntimeHost} from './fixtures/runtime-official-host.js'
import {nativeLifecycle,nativeLifecycleTimeout,nativeTestTimeout,nativeTemporaryDirectory as mkdtemp,nativeRemove as rm} from './fixtures/native-lifecycle.js'
import {lifecycleStages} from './fixtures/lifecycle-stages.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {disabledExecutionSessions} from '../src/tasks/single-session.js'
const test=(name,fn,options={})=>testRunner(name,{timeout:nativeTestTimeout(20000),...options},fn)
const transient='503 Service temporarily unavailable: native retry fixture'
const effect={name:'provider_effect_once',args:{}}
const sawEffect=request=>request.messages.some(message=>message.role==='toolResult'&&!message.isError&&JSON.stringify(message.content).includes('ORIGINAL_PROVIDER_EFFECT_RECEIPT'))
const work=(h,id)=>join(h.ctx.runtimePaths.workspaces,'tasks',id,'work/provider-effect.txt')
async function roots(t){const root=await makeTemp(join(tmpdir(),'provider-recovery-single-')),hosts=[];t.after(async()=>{for(const h of hosts.toReversed())await h.close();await remove(root,{recursive:true,force:true})});return{root,async host(options){const h=await providerHost(t,{root,...options});hosts.push(h);return h}}}

for(const restart of [false,true])test(`official retry retains the completed effect and original task journal: restart=${restart}`,async t=>{
 let failed=false
 const f=await roots(t),h=await f.host({intercept:request=>{if(taskRequest(request)&&sawEffect(request)&&!failed){failed=true;return {stopReason:'error',errorMessage:transient}}},decide:request=>sawEffect(request)?[result('complete')]:[effect]})
 const id=await h.create();await h.service.whenIdle();const before=await h.stored(id);assert.equal(before.task.status,'completed');assert.equal(h.effects,1);assert.equal(h.events.filter(e=>e.type==='auto_retry_start').length,1);assert.equal(before.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1);assert.equal(before.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,1);assert.equal(before.task.leaseEpoch,1)
 if(restart){await h.close();const cold=await f.host({initialize:false,decide:()=>[result()]});await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.taskRequests().length,0);assert.equal((await cold.query('task.get',{taskId:id})).sessionId,before.task.sessionId);assert.equal(await readFile(work(cold,id),'utf8'),'one original effect');assert.equal(cold.effects,0)}
})
test('one nonretryable provider failure does not block an unrelated task; removed split backends reject explicitly',async t=>{
 let badTask
 const h=await providerHost(t,{intercept:request=>{if(taskRequest(request)){const id=latestInput(request).task.taskId;badTask??=id;if(id===badTask)return {stopReason:'error',errorMessage:'401 invalid account configuration'}}},decide:request=>sawEffect(request)?[result('complete')]:[effect]})
 const bad=await h.create('bad-provider');await h.service.whenIdle();const good=await h.create('unrelated-task');await h.service.whenIdle();assert.equal((await h.query('task.get',{taskId:good})).status,'completed');assert.equal((await h.query('task.get',{taskId:bad})).completion??null,null);assert.equal(h.effects,1);assert.equal(h.events.length,0)
 for(const backend of ['claude-code','split-dsh'])await assert.rejects(disabledExecutionSessions().run({backend}),{code:'TASK_SPLIT_EXECUTION_REMOVED'})
 assert.ok(h.taskRequests().every(request=>!request.tools.some(tool=>['task_delegate','execution_submit'].includes(tool.name))));assert.equal((await h.query('execution.list')).length,0)
})
for(const restored of [false,true])test(`SDK budget exhaustion stays technical across cold restart; only real new input reopens the Single run: restored=${restored}`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const f=await roots(t),retry={enabled:true,maxRetries:2,baseDelayMs:1,maxAgentDelayMs:5,provider:{maxRetries:0}}
 const failAfterEffect=request=>taskRequest(request)&&sawEffect(request)?{stopReason:'error',errorMessage:transient}:undefined
 const h=await f.host({retry,intercept:failAfterEffect,decide:request=>sawEffect(request)?[result('complete')]:[effect]});const id=await h.create();await h.service.whenIdle();const first=await h.stored(id);assert.equal(h.effects,1);assert.equal(h.events.filter(e=>e.type==='auto_retry_start').length,2);assert.equal(first.task.completion??null,null);assert.equal(first.task.humanRequests.length,0);assert.equal(first.task.providerRecovery??null,null);assert.equal(first.task.technicalFailure.code,'TASK_PI_PROVIDER_ERROR');const beforeCalls=h.taskRequests().length;for(let n=0;n<3;n++){t.mock.timers.setTime(Date.now()+3600000);await h.service.recover();await h.service.whenIdle();assert.equal(h.taskRequests().length,beforeCalls);assert.equal(h.effects,1)}await h.close()
 const cold=await f.host({initialize:false,retry,intercept:restored?undefined:failAfterEffect,decide:request=>{assert.equal(sawEffect(request),true,'the real original effect result is retained');return [result('complete')]}})
 for(let i=0;i<3;i++){await cold.service.recover();await cold.service.whenIdle()}assert.equal(cold.taskRequests().length,0)
 await cold.service.appendTaskContext({taskId:id,requestId:'real-provider-evidence',progressImpact:'replan',context:'Read the retained successful output; do not repeat the original effect.'});await cold.service.whenIdle();const after=await cold.stored(id);assert.equal(after.task.sessionId,first.task.sessionId);assert.equal(after.task.status,restored?'completed':'active');assert.equal(cold.effects,0);assert.equal(after.task.humanRequests.length,0);assert.equal(await readFile(work(cold,id),'utf8'),'one original effect');assert.equal(after.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1)
 if(!restored){assert.equal(cold.taskRequests().length,3);const before=cold.taskRequests().length;await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.taskRequests().length,before)}
})
test('authenticated human answer survives official retry and is read before the original task resumes',async t=>{
 let failed=false,reviewed=false,authenticatedSource
 const h=await providerHost(t,{intercept:request=>{if(taskRequest(request)&&(latestInput(request).humanReview||latestInput(request).task.humanRequests.some(item=>item.status==='answered'))&&!failed){failed=true;return {stopReason:'error',errorMessage:transient}}},decide:request=>{
  const input=latestInput(request)
  if(!sawEffect(request))return [effect]
  if(!input.task.humanRequests.length)return [{name:'task_result',args:{decision:{action:'blocked',summary:'Original effect is retained; target evidence is required',question:'Which exact environment is authorized?',audience:'requester',evidence:['original effect receipt'],limitations:[]}}}]
  if(input.humanReview){const source=input.sources.find(source=>input.humanReview.sourceIds.includes(source.sourceId));assert.ok(source);assert.match(source.text,/Only UAT3; keep all existing limits/);reviewed=true;authenticatedSource=source.sourceId;return [effect,{name:'task_human_resolve',args:{requestId:input.humanReview.requestId,sourceId:source.sourceId,reason:'The actual requester supplied only the bounded UAT3 target',evidence:[source.text]}},result('wait')]}
  assert.equal(input.task.humanRequests[0].status,'answered');const source=input.sources.find(source=>source.text?.includes('Only UAT3; keep all existing limits'));assert.ok(source);authenticatedSource=source.sourceId;reviewed=true;return [result('complete')]
 }})
 const id=await h.create();await h.service.whenIdle();const waiting=await h.query('task.get',{taskId:id});assert.equal(waiting.humanRequests.length,1)
 await h.service.respondHumanRequest({taskId:id,humanRequestId:waiting.humanRequests[0].requestId,requestId:'actual-target',expectedRequirementRevision:waiting.requirementRevision,expectedControlRevision:waiting.controlRevision,reply:'Only UAT3; keep all existing limits'});await h.service.whenIdle();const after=await h.stored(id)
 assert.equal(reviewed,true);assert.equal(after.task.humanRequests[0].status,'answered');assert.equal(h.effects,1);assert.equal(h.events.filter(e=>e.type==='auto_retry_start').length,1);const source=await h.query('source.get',{sourceId:authenticatedSource});assert.equal(source.actorId,'native-user');assert.equal(source.channel,'web');assert.equal(source.text,'Only UAT3; keep all existing limits');assert.equal(await readFile(work(h,id),'utf8'),'one original effect')
})
test('anonymous field error is retained byte-for-byte by Pi and retries without asking a business question or replaying effects',async t=>{
 const {fieldV12Error}=await import('./fixtures/execution-provider-field-sample.js');let failed=false
 const h=await providerHost(t,{intercept:request=>{if(taskRequest(request)&&sawEffect(request)&&!failed){failed=true;return {stopReason:'error',errorMessage:fieldV12Error.message,responseId:'field-native-response',content:[{type:'text',text:'provider diagnostic',textSignature:'field-native-signature'}]}}},decide:request=>sawEffect(request)?[result('complete')]:[effect]})
 const id=await h.create();await h.service.whenIdle();const stored=await h.stored(id),error=stored.entries.find(e=>e.type==='message'&&e.message.responseId==='field-native-response').message
 assert.equal(error.errorMessage,fieldV12Error.message);assert.equal(error.content[0].textSignature,'field-native-signature');assert.equal(stored.task.status,'completed');assert.equal(stored.task.humanRequests.length,0);assert.equal(h.effects,1);assert.equal(h.events.filter(e=>e.type==='auto_retry_start').length,1);assert.equal(await readFile(work(h,id),'utf8'),'one original effect')
})
test('requirement supplement during SDK retry replaces the stale binding before another provider dispatch',async t=>{
 let failed=false,injected=false
 const h=await providerHost(t,{retry:{enabled:true,maxRetries:1,baseDelayMs:200,maxAgentDelayMs:300,provider:{maxRetries:0}},intercept:request=>{if(taskRequest(request)&&sawEffect(request)&&!failed){failed=true;return {stopReason:'error',errorMessage:transient}}},decide:request=>{if(!sawEffect(request))return [effect];assert.equal(injected,true);assert.match(JSON.stringify(latestInput(request).sources),/LATEST_SCOPE_UAT3/);return [result('complete')]}})
 const id=await h.create();await (await import('./fixtures/provider-official-host.js')).waitUntil(()=>h.events.some(event=>event.type==='auto_retry_start'),'actual SDK retry wait');injected=true
 await h.service.appendTaskContext({taskId:id,requestId:'supplement-during-retry',progressImpact:'replan',context:'LATEST_SCOPE_UAT3: preserve the original effect and read current scope only.'});await h.service.whenIdle();const stored=await h.stored(id);assert.equal(stored.task.status,'completed');assert.equal(stored.task.leaseEpoch,2);assert.equal(h.effects,1);assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1);assert.equal(await readFile(work(h,id),'utf8'),'one original effect')
})
test('three explicit bounded reviews survive restart without autonomous retries or effect replay',async t=>{
 const f=await roots(t);let h=await f.host({decide:()=>[result()]});const id=await h.create();await h.service.whenIdle();const first=await h.stored(id)
 for(let review=1;review<=3;review++){await h.close();h=await f.host({initialize:false,decide:()=>[result()]});await h.service.recover();await h.service.whenIdle();assert.equal(h.taskRequests().length,0);await h.service.appendTaskContext({taskId:id,requestId:'real-review-'+review,progressImpact:'replan',context:'Explicit bounded review '+review+'; do not execute any original effect.'});await h.service.whenIdle();assert.equal(h.taskRequests().length,1);assert.equal(h.events.length,0);assert.equal(h.effects,0)}
 const stored=await h.stored(id);assert.equal(stored.task.sessionId,first.task.sessionId);assert.equal(stored.task.completion??null,null);assert.equal(stored.task.humanRequests.length,0);assert.equal(stored.entries.filter(e=>e.type==='custom_message'&&e.customType==='night.business-input'&&e.details.source.kind==='task-input').length,4);const before=h.taskRequests().length;for(let i=0;i<4;i++){await h.service.recover();await h.service.whenIdle()}assert.equal(h.taskRequests().length,before)
})
test('lifecycle timeout drains an acquired native host before removing its workspace', async t => {
  let root, rootReady, opening, h, release, closed = false, continued = false
  const blocked = new Promise(resolve => { release = resolve })
  await assert.rejects(lifecycleStages(t, {
    limits: { business: 20 },
    prepare: async step => {
      root = await step(() => (rootReady = mkdtemp(join(tmpdir(), 'native-stage-abort-'))))
      h = await step(() => (opening = nativeRuntimeHost(root,async()=>[])))
    },
    business: async (_value, step) => { await step(() => blocked); continued = true },
    cleanup: async () => {
      if (rootReady) root = await rootReady
      if (opening) h = await opening
      await h?.close(); closed = true
      release()
      if (root) await rm(root, { recursive: true, force: true })
    },
  }), { code: 'TEST_STAGE_TIMEOUT', phase: 'business' })
  assert.equal(closed, true); assert.equal(continued, false)
  await assert.rejects(access(root), { code: 'ENOENT' })
}, { timeout: 50020 })


test('unified lifecycle construction cancellation closes the late real service before deleting its root', async t => {
  const parent = new AbortController(), reason = Error('cancel native construction after service open')
  const outerSignal = AbortSignal.any([t.signal, parent.signal])
  const context = new Proxy(t, { get(target, key) {
    if (key === 'signal') return outerSignal
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  let root, closed = 0, business = false
  await assert.rejects(nativeLifecycle(1000, async n => {
    root = await mkdtemp(join(tmpdir(), 'native-construction-cancel-'))
    await nativeRuntimeHost(root, async () => [], { serviceFactory: async options => {
      const service = await openTaskSessionService(options)
      parent.abort(reason)
      await Promise.resolve()
      return { ...service, async close() { closed++; await service.close() } }
    } })
    await n.beginBusiness()
    business = true
  })(context), error => error === reason)
  assert.equal(business, false); assert.equal(closed, 1)
  await assert.rejects(access(root), { code: 'ENOENT' })
}, { timeout: 41000 })

test('cancelling an actual SDK retry joins the delay and never dispatches another provider attempt',async t=>{
 const h=await providerHost(t,{retry:{enabled:true,maxRetries:3,baseDelayMs:10000,maxAgentDelayMs:10000,provider:{maxRetries:0}},intercept:request=>taskRequest(request)&&sawEffect(request)?{stopReason:'error',errorMessage:transient}:undefined,decide:request=>sawEffect(request)?[result('complete')]:[effect]})
 const id=await h.create();await (await import('./fixtures/provider-official-host.js')).waitUntil(()=>h.events.some(event=>event.type==='auto_retry_start'),'SDK entered its real retry delay');const requests=h.taskRequests().length;assert.equal(requests,2)
 await h.service.cancelTask({taskId:id,requestId:'cancel-sdk-delay',reason:'Stop the owned SDK provider retry'});await h.service.whenIdle();const stored=await h.stored(id)
 assert.equal(h.taskRequests().length,requests);assert.equal(h.effects,1);assert.equal(stored.task.drained,true);assert.equal(stored.task.completion??null,null);assert.equal(h.ctx.agents.get(stored.task.sessionId),undefined);assert.ok(h.events.some(event=>event.type==='auto_retry_end'&&event.success===false&&event.finalError==='Retry cancelled'));assert.equal(await readFile(work(h,id),'utf8'),'one original effect')
})

for(const backend of ['claude-code','dsh'])test(`actual Single service rejects removed backend before task storage or model admission: ${backend}`,async t=>{
 const root=await makeTemp(join(tmpdir(),'single-backend-reject-'));let h;t.after(async()=>{await h?.close();await remove(root,{recursive:true,force:true})})
 h=await nativeRuntimeHost(root,async()=>[],{resident:true});h.residentStore=await openResidentStore(h.ctx.storageDomain)
 const before=(await readdir(h.ctx.runtimePaths.state,{recursive:true})).sort(),dbPath=join(h.ctx.runtimePaths.state,'unsupported-backend.sqlite'),config={provider:'native-task-test',model:'controlled',workspaceDir:h.ctx.runtimePaths.workspaces,dbPath,instanceId:'single-backend',ownerActorId:'native-user',webActorId:'native-user',initialize:true,executionBackend:backend}
 await assert.rejects(openTaskSessionService({ctx:h.ctx,config,residentStore:h.residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>h.residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external send')},readback:async()=>{throw Error('no external readback')}}}),{code:'TASK_EXECUTION_BACKEND_UNSUPPORTED'})
 assert.equal(h.requests.length,0);assert.equal(h.ctx.agents.list().length,0);assert.deepEqual((await readdir(h.ctx.runtimePaths.state,{recursive:true})).sort(),before);await assert.rejects(access(dbPath),{code:'ENOENT'});await assert.rejects(access(dbPath+'.initialized'),{code:'ENOENT'})
})
test('explicit Pi backend accepts derived legacy read-only labels without selecting a split executor',async t=>{
 const root=await makeTemp(join(tmpdir(),'single-backend-pi-'));let h;t.after(async()=>{await h?.close();await remove(root,{recursive:true,force:true})})
 h=await nativeRuntimeHost(root,async()=>[],{resident:true});h.residentStore=await openResidentStore(h.ctx.storageDomain)
 const config={provider:'native-task-test',model:'controlled',workspaceDir:h.ctx.runtimePaths.workspaces,dbPath:join(h.ctx.runtimePaths.state,'pi-backend.sqlite'),instanceId:'single-pi',ownerActorId:'native-user',webActorId:'native-user',initialize:true,executionBackend:'pi'}
 h.service=await openTaskSessionService({ctx:h.ctx,config,residentStore:h.residentStore,legacy:{getAgentConfig:()=>({...config,executionBackend:'dsh',agentNames:[]}),getGroup:id=>h.residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external send')},readback:async()=>{throw Error('no external readback')}}})
 assert.equal(h.requests.length,0);assert.equal(h.ctx.agents.list().length,0);assert.deepEqual(await h.service.store.query({kind:'execution.list'}),[])
})

for(const mode of ['provider-error','successful-text-without-task-result'])test(`failed task dialogue preserves its real source and never becomes a model retry or fabricated reply: ${mode}`,async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 const f=await roots(t),bad='FIRST_DIALOGUE_SOURCE '+mode
 const decide=request=>{const input=latestInput(request);if(input.dialogue){assert.equal(input.dialogue.text,'SECOND_GENUINE_DIALOGUE');return [result('wait','Read the retained evidence for the second genuine dialogue source')]}return [result()]}
 const h=await f.host({decide,intercept:request=>taskRequest(request)&&latestInput(request).dialogue?.text===bad?mode==='provider-error'?{stopReason:'error',errorMessage:transient}:{stopReason:'stop',content:[{type:'text',text:'An assistant response without the required dialogue result'}]}:undefined})
 const id=await h.create('dialogue-failure');await h.service.whenIdle();await h.service.sendTaskDialogue({taskId:id,requestId:'first-dialogue',text:bad});await h.service.whenIdle();const before=await h.stored(id),failed=before.task.dialogue.find(message=>message.id==='first-dialogue'),code=mode==='provider-error'?'TASK_PI_PROVIDER_ERROR':'TASK_SESSION_NO_SUBMISSION'
 assert.equal(failed.text,bad);assert.equal(failed.reply,null);assert.equal(failed.replyError.code,code);assert.equal(failed.replyError.stopReason,mode==='provider-error'?'error':'stop');assert.ok(failed.replyFailedAt);assert.equal(before.task.providerRecovery??null,null);const count=h.taskRequests().length
 for(let n=0;n<3;n++){t.mock.timers.setTime(Date.now()+3600000);await h.service.recover();await h.service.whenIdle()}assert.equal(h.taskRequests().length,count);await h.close()
 const cold=await f.host({initialize:false,decide});await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.taskRequests().length,0);assert.deepEqual((await cold.query('task.get',{taskId:id})).dialogue[0],failed)
 await cold.service.sendTaskDialogue({taskId:id,requestId:'second-dialogue',text:'SECOND_GENUINE_DIALOGUE'});await cold.service.whenIdle();const after=await cold.stored(id),reply=after.task.dialogue.find(message=>message.id==='second-dialogue');assert.match(reply.reply,/second genuine dialogue source/);assert.equal(reply.replyError??null,null);assert.equal(after.task.dialogue[0].reply,null);assert.equal(after.task.sessionId,before.task.sessionId);assert.equal(cold.effects,0);assert.equal(cold.taskRequests().length,1)
})

test('provider failure during actual group human review retains the source batch, holds across time and cold restore, then admits a new real answer',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 let task,failReview=true,reviewed=[]
 const route=request=>{
  const input=latestInput(request),routed=topicTaskCalls(request),names=request.tools.map(tool=>tool.name)
  if(input.trigger==='task-facts')return routed
  if(names.includes('group_topic_route_submit')&&task)for(const route of routed[0].args.routes)for(const unit of route.units)unit.topics=[{topicId:task.topicRefs[0].topicId,reason:'The exact original business question and answer'}]
  if(names.includes('group_decision_submit')&&task){const review=modelToolValues(request).find(value=>Array.isArray(value.candidates));if(!review)return [{name:'group_reply_review_get',args:{requestIds:[input.requestId]}}];const args=routed[0].args;args.decision.actions=[{kind:'task-context',taskId:task.taskId,inputVersion:task.requirementRevision,runSequence:task.runSequence??1,context:'Read the actual complete business reply without widening scope',progressImpact:'preserve',topicRefs:[{topicId:args.topicId,revision:args.revision}],basisUnitRefs:args.decision.basisUnitRefs}];args.decision.reply='已记录同一事项的完整来源，保持原授权边界。';args.decision.replyReview={kind:'substantive',reviewedOutboundIds:review.candidates.map(row=>row.outboundId),sameMatterOutboundIds:review.candidates.map(row=>row.outboundId),replaceOutboundIds:[]}}
  return routed
 }
 const decide=request=>{const input=latestInput(request);if(!input.task.humanRequests.length)return [{name:'task_result',args:{decision:{action:'blocked',summary:'The business target must be confirmed',question:'请业务负责人确认原事项的只读目标。',audience:'requester',evidence:[],limitations:[]}}}];if(input.humanReview){const source=input.sources.find(source=>input.humanReview.sourceIds.includes(source.sourceId)&&source.text.includes('SECOND_REAL_ANSWER'));assert.ok(source);reviewed.push(source.sourceId);return [{name:'task_human_resolve',args:{requestId:input.humanReview.requestId,sourceId:source.sourceId,reason:'The actual business answer confirms only the bounded read-only target',evidence:[source.text]}},result()]}return [result()]}
 const intercept=request=>taskRequest(request)&&latestInput(request).humanReview&&failReview?{stopReason:'error',errorMessage:transient}:undefined
 const f=await roots(t),h=await f.host({route,decide,intercept});await h.service.ingest({groupId:'native-group',messageId:'review-origin',senderOpenDingTalkId:'native-user',text:'测试助手，等业务负责人确认原事项的UAT3只读目标，不要实施变更。',occurredAt:new Date().toISOString()});await h.service.whenIdle();task=(await h.query('task.list'))[0]
 await h.service.ingest({groupId:'native-group',messageId:'first-review-source',senderOpenDingTalkId:'business-responsible',text:'测试助手，FIRST_REAL_ANSWER：先保留原限制，只核对目标事实。',occurredAt:new Date().toISOString()});await h.service.whenIdle();const before=await h.stored(task.taskId),question=before.task.humanRequests[0],failure=question.reviewFailures.at(-1);assert.equal(question.status,'waiting-reply');assert.equal(failure.code,'TASK_PI_PROVIDER_ERROR');assert.ok(failure.sourceIds.length);const sources=await Promise.all(failure.sourceIds.map(sourceId=>h.query('source.get',{sourceId})));assert.ok(sources.some(source=>source.text.includes('FIRST_REAL_ANSWER')));const count=h.taskRequests().length
 for(let n=0;n<3;n++){t.mock.timers.setTime(Date.now()+3600000);await h.service.recover();await h.service.whenIdle()}assert.equal(h.taskRequests().length,count);await h.close();failReview=false
 const cold=await f.host({initialize:false,route,decide,intercept});await cold.service.recover();await cold.service.whenIdle();assert.equal(cold.taskRequests().length,0);task=await cold.query('task.get',{taskId:task.taskId});for(const source of sources)assert.deepEqual(await cold.query('source.get',{sourceId:source.sourceId}),source)
 await cold.service.ingest({groupId:'native-group',messageId:'second-review-source',senderOpenDingTalkId:'business-responsible',text:'测试助手，SECOND_REAL_ANSWER：仅确认UAT3只读目标，原有禁止实施的限制全部保留。',occurredAt:new Date().toISOString()});await cold.service.whenIdle();const after=await cold.stored(task.taskId);assert.equal(after.task.humanRequests[0].status,'answered');assert.equal(after.task.humanRequests[0].reviewFailures.length,1);assert.equal(reviewed.length,1);assert.equal(cold.effects,0);assert.equal(after.task.sessionId,before.task.sessionId)
},{timeout:nativeTestTimeout(30000)})
