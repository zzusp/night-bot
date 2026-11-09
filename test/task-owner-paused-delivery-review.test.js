import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openExecutionStore} from '../packages/dingtalk-core/execution-store.js'
import {openExecutionArtifacts} from '../packages/dingtalk-core/execution-artifacts.js'
import {createExecutionController} from '../packages/dingtalk-core/execution-controller.js'

import {taskOwnerQueryControlAllowed} from '../packages/dingtalk-core/agent-query-tools.js'

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'paused-owner-review-')),dbPath=join(dir,'control.sqlite')
 let store=await openExecutionStore({dbPath,instanceId:'review',initialize:true})
 t.after(async()=>{await controller?.close();await store.close()})
 const taskRoot=join(dir,'tasks'),directories={logicalTaskId:'task',...Object.fromEntries(['work','tmp','outputs'].map(area=>[area,join(taskRoot,'task',area)]))}
 for(const area of ['work','tmp','outputs'])await mkdir(directories[area],{recursive:true})
 const artifacts=await openExecutionArtifacts({directory:join(dir,'artifacts'),initialize:true,taskWorkspaceRoot:taskRoot,getTaskDirectories:async()=>directories})
 let executions=0
 const workflow={id:'development',version:'1',nodes:[{id:'develop',version:'1',executor:'code',allowedEffects:['pure'],inputSchema:{type:'object'},outputSchema:{type:'object'},mapInput:()=>({}),execute:async()=>{executions++;return {}}}]}
 const controller=createExecutionController({store,artifacts,workflows:[workflow]})
 const requirement={request:'Review already-delivered Draft; keep engineering paused',acceptanceCriteria:['Correct change and tests','Draft PR delivered']}
 await controller.createTaskPlan({commandId:'create',taskId:'task',stages:[{stageId:'development',workflowId:'development',input:requirement}]})
 const initialized=(await store.command({id:'init-review',kind:'task.owner.init',args:{taskId:'task',sessionId:'historical-review-session',sourceKey:'source',criteria:requirement.acceptanceCriteria}})).result.owner,originalSession=initialized.sessionId
 await store.command({id:'requirement',kind:'task.requirement.bind-legacy',args:{taskId:'task',expectedRequirementRevision:1,requirementRef:(await artifacts.put(requirement,{taskId:'task'})).ref,sessionId:originalSession,criteria:requirement.acceptanceCriteria,sourceKey:'source',eventKey:'bind'}})
 await store.command({id:'initial-claim',kind:'task.owner.claim',args:{taskId:'task',turnId:'original-turn',expectedLeaseEpoch:0}})
 await store.command({id:'initial-bound',kind:'task.owner.sessionBound',args:{taskId:'task',turnId:'original-turn',leaseEpoch:1,sessionId:originalSession}})
 await store.command({id:'initial-candidate',kind:'task.owner.candidate',args:{taskId:'task',turnId:'original-turn',leaseEpoch:1,decision:{action:'wait',summary:'Original Owner already assessed',evidenceRefs:[],condition:{kind:'capability',missing:'external facts',responsibleParty:'execution host',resumeWhen:'facts available',evidenceRefs:[]}}}})
 await store.command({id:'initial-accept',kind:'task.owner.accept',args:{taskId:'task',turnId:'original-turn',leaseEpoch:1}})
 await store.command({id:'initial-applied',kind:'task.owner.applied',args:{taskId:'task',turnId:'original-turn',leaseEpoch:1}})
 await store.command({id:'pause',kind:'task.control.pause',args:{taskId:'task',expectedControlRevision:1}})
 const factsRef=(await artifacts.put({kind:'verified-delivered-engineering-facts',taskId:'task',pr:{isDraft:true}},{taskId:'task'})).ref
 const review=()=>store.command({id:'owner-delivery-review:requested',kind:'task.owner.delivery-review',args:{taskId:'task',eventKey:'requested',payloadRef:factsRef,expectedRequirementRevision:1,expectedControlRevision:2,actorId:'authorized-web-actor',reason:'Assess delivered facts only'}})
 return {review,controller,artifacts,get store(){return store},query:q=>store.query(q),originalSession,factsRef,counts:()=>({executions}),restart:async()=>{await store.close();store=await openExecutionStore({dbPath,instanceId:'review'});return store.query({kind:'task.owner',taskId:'task'})}}
}
// 仅核历史Store事务，不模拟已退休的Owner会话、阅证或业务审核回调。
async function acceptHistoricalReview(f,action,{candidateAcceptance=false,stale=false,changedRequirement=false,forgedReference=false}={}){
 const send=async(kind,args)=>(await f.store.command({id:kind+':review-test',kind,args})).result
 const original=await f.query({kind:'task.owner',taskId:'task'})
 const claim=await send('task.owner.claim',{taskId:'task',turnId:'review-turn',expectedLeaseEpoch:original.leaseEpoch})
 const turn={taskId:'task',turnId:claim.turnId,leaseEpoch:claim.leaseEpoch}
 await send('task.owner.sessionBound',{...turn,sessionId:claim.sessionId})
 const evidenceRefs=[f.factsRef],items=await f.query({kind:'task.owner.acceptance',taskId:'task'})
 const decision={action,summary:'Historical reviewed facts',evidenceRefs,...(action==='complete'?{assessments:items.map(item=>({itemId:item.itemId,status:'satisfied',evidenceRefs}))}:action==='advance'?{}:{condition:{kind:'capability',missing:'real browser evidence',responsibleParty:'execution host',resumeWhen:'browser capability available',evidenceRefs}})}
 if(candidateAcceptance)decision.candidateAcceptance={scenarioIds:['seven-ui'],evidenceRefs}
 await send('task.owner.candidate',{...turn,decision})
 if(stale)await send('task.owner.event',{taskId:'task',eventKey:'later-input',eventType:'intent.received'})
 if(changedRequirement)await send('task.requirement.update',{taskId:'task',expectedRequirementRevision:1,requirementRef:(await f.artifacts.put({request:'新的要求'},{taskId:'task'})).ref,eventKey:'new-requirement'})
 return send('task.owner.accept',{...turn,...(candidateAcceptance||forgedReference?{candidateAcceptanceRef:f.factsRef}:{})})
}

test('历史暂停账不派发，保留review事件不能由generic event伪造',async t=>{
 const f=await fixture(t)
 await assert.rejects(f.store.command({id:'paused-claim',kind:'task.owner.claim',args:{taskId:'task',turnId:'forged',expectedLeaseEpoch:1}}),{code:'TASK_OWNER_NOT_CLAIMABLE'})
 assert.equal((await f.query({kind:'task.owners.pending'})).length,0)
 await assert.rejects(f.store.command({id:'forged',kind:'task.owner.event',args:{taskId:'task',eventKey:'forged',eventType:'delivery.review.requested',payloadRef:f.factsRef}}),{code:'TASK_OWNER_DELIVERY_REVIEW_EVENT_RESERVED'})
 assert.equal(f.counts().executions,0)
})
for(const action of ['complete','wait','block'])test(`历史暂停review持久决定${action}保留工程计划且重启不执行`,async t=>{
 const f=await fixture(t),before=await f.controller.taskPlan('task');await f.review()
 assert.equal((await f.query({kind:'task.owners.pending'})).length,1)
 const accepted=await acceptHistoricalReview(f,action);assert.equal(accepted.status,'accepted')
 await f.store.command({id:'historical-applied',kind:'task.owner.applied',args:{taskId:'task',turnId:accepted.turnId}})
 assert.deepEqual(await f.controller.taskPlan('task'),before)
 const read=await f.restart();assert.equal(read.sessionId,f.originalSession);assert.equal(read.decision.action,action);assert.equal(read.applicationStatus,'applied');assert.ok(read.deliveryReview)
 assert.equal(f.counts().executions,0)
})
test('历史暂停review在持久边界拒绝advance',async t=>{
 const f=await fixture(t);await f.review();await assert.rejects(acceptHistoricalReview(f,'advance'),{code:'TASK_OWNER_DELIVERY_REVIEW_READ_ONLY'});assert.equal(f.counts().executions,0)
})
test('后到输入使历史review与候选在接纳时失效',async t=>{
 const f=await fixture(t);await f.review();await assert.rejects(acceptHistoricalReview(f,'complete',{stale:true}),{code:'TASK_OWNER_CANDIDATE_STALE'})
 assert.equal((await f.query({kind:'task.owner',taskId:'task'})).deliveryReview,null);assert.equal(f.counts().executions,0)
})
test('历史候选引用持久化但不完成任务、不执行工程或改要求',async t=>{
 const f=await fixture(t),before=await f.controller.taskPlan('task');await f.review()
 const accepted=await acceptHistoricalReview(f,'wait',{candidateAcceptance:true});assert.ok(accepted.candidateAcceptanceRef);assert.equal(accepted.deliveryManifestRef,undefined)
 assert.deepEqual(await f.controller.taskPlan('task'),before);assert.equal(await f.query({kind:'task.owner.delivery-manifest',taskId:'task'}),null)
 const binding=await f.query({kind:'task.owner.candidate-acceptance',taskId:'task'});assert.equal(binding.ref,accepted.candidateAcceptanceRef)
 await f.restart();assert.deepEqual(await f.query({kind:'task.owner.candidate-acceptance',taskId:'task'}),binding);assert.equal(f.counts().executions,0)
})
test('普通wait不能伪造历史候选引用',async t=>{
 const f=await fixture(t);await f.review();await assert.rejects(acceptHistoricalReview(f,'wait',{forgedReference:true}),{code:'TASK_OWNER_CANDIDATE_ACCEPTANCE_INVALID'})
 assert.equal(await f.query({kind:'task.owner.candidate-acceptance',taskId:'task'}),null)
})
test('历史候选引用受新要求栅栏约束且不能伴随block',async t=>{
 const f=await fixture(t);await f.review();await assert.rejects(acceptHistoricalReview(f,'wait',{candidateAcceptance:true,changedRequirement:true}),{code:'TASK_OWNER_CANDIDATE_STALE'})
 assert.equal(await f.query({kind:'task.owner.candidate-acceptance',taskId:'task'}),null)
 const blocked=await fixture(t);await blocked.review();await assert.rejects(acceptHistoricalReview(blocked,'block',{candidateAcceptance:true}),{code:'TASK_OWNER_CANDIDATE_ACCEPTANCE_INVALID'})
})
test('历史暂停review查询权限只接受当前任务和控制版本',async t=>{
 const f=await fixture(t);await f.review()
 const owner=await f.query({kind:'task.owner',taskId:'task'}),plan=await f.controller.taskPlan('task'),binding={taskId:'task',requirementRevision:plan.task.requirementRevision}
 assert.equal(taskOwnerQueryControlAllowed(owner,plan,binding),true)
 assert.equal(taskOwnerQueryControlAllowed({...owner,deliveryReview:null},plan,binding),false)
 assert.equal(taskOwnerQueryControlAllowed(owner,plan,{...binding,taskId:'other'}),false)
 assert.equal(taskOwnerQueryControlAllowed(owner,plan,{...binding,requirementRevision:binding.requirementRevision+1}),false)
 assert.equal(taskOwnerQueryControlAllowed(owner,{...plan,task:{...plan.task,controlRevision:plan.task.controlRevision+1}},binding),false)
 assert.equal(f.counts().executions,0)
})
