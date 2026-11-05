import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {memoryHost} from './fixtures/memory-host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function until(fn){for(let n=0;n<400;n++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('effect reconciliation timeout')}
async function open(f,{initialize=true,failProjection=false}={}){
 const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'effect-e2e',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit'},residentStore=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore({...config,initialize})
 let trip=failProjection
 const port={...store,command:async command=>{if(trip===true&&command.kind==='task.effect-reconciliation.commit'){trip=false;throw Object.assign(Error('injected SQL projection interruption'),{code:'FIXTURE_PROJECTION_INTERRUPTED'})}const result=await store.command(command);if(trip==='prepared-only'&&command.kind==='task.effect-reconciliation.prepare'){trip=false;throw Object.assign(Error('injected interruption after SQL prepare'),{code:'FIXTURE_PREPARE_INTERRUPTED'})}return result}}
 const service=await openTaskSessionService({ctx,config,store:port,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external sends')},readback:async()=>{throw Error('no external readback')}}})
 let closed=false;return {service,store,async close(){if(closed)return;closed=true;await service.close();await store.close()}}
}
async function proposal(service,inspection){
 const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Trusted operator read back work/uncertain.txt. It exists; the failed attempt may have partial effects.',outcome:'partial-or-unknown',noReplay:true}
 const bytes=Buffer.from(JSON.stringify(doc)),sha256=createHash('sha256').update(bytes).digest('hex'),path='materials/runtime-evidence/effects/'+sha256+'.json'
 await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,path),bytes)
 return {...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'operator-close',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'I inspected the actual output and close this failed attempt with possible partial effects. Do not replay or continue.'}
}
for(const crash of [false,true,'prepared-only'])test('real Host unknown effect '+(crash==='prepared-only'?'keeps prepare without native receipt held across restart':crash?'recovers committed native receipt after interrupted SQL projection':'closes only with real drain and explicit operator evidence') ,{timeout:20000},async t=>{
 let effects=0,continuing=false,attemptedAgain=false
 const f=await memoryHost(t,body=>{if(!body.tools?.some(tool=>tool.function.name==='partial_write'))return;if(continuing&&attemptedAgain)return {tool:'task_result',args:{decision:{action:'wait',summary:'The prior attempt is closed with possible partial effects; replay was refused.',evidence:['original native call and retained operator evidence'],limitations:['no replay']}}};if(continuing)attemptedAgain=true;return {tool:'partial_write',args:{}}})
 function register(){f.host.ctx.get('tools').register({name:'partial_write',description:'Test fixture writes then loses its response.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'one actual effect');throw Error('response lost after write')}})}
 register();let h=await open(f,{failProjection:crash});t.after(()=>h.close())
 const task=await h.service.createTask({requestId:'uncertain',objective:'Perform exactly the authorized local effect once'})
 await until(async()=>!!(await h.service.taskDialogue(task.taskId)).error);await h.service.whenIdle()
 const row=await h.store.query({kind:'task.get',taskId:task.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-intent')
 assert.equal(effects,1);assert.equal(await readFile(join(stored.header.cwd,'work/uncertain.txt'),'utf8'),'one actual effect');assert.equal(row.drained,true);assert.equal(f.host.ctx.agents.get(row.sessionId),undefined)
 const drains=stored.audit.filter(r=>r.domain==='task'&&r.kind==='owner-drained');assert.equal(drains.length,1);assert.equal(drains[0].payload.proof.scope,'registered-owned-provider-ranges');assert.equal(drains[0].payload.proof.modelIdle,true);assert.equal(drains[0].payload.proof.toolsIdle,true)
 const inspection=await h.service.inspectTaskEffect({taskId:row.taskId,intentEntryId:intent.entryId}),request=await proposal(h.service,inspection),requests=f.requests.length
 await assert.rejects(h.service.reconcileTaskEffect({...request,currentBinding:{...request.currentBinding,leaseEpoch:999}}),{code:'TASK_EFFECT_PROPOSAL_STALE'})
 // The stale request used the same source identity but never entered prepare;
 // use a distinct request for the subsequent valid operator action.
 request.requestId='operator-close-valid'
 if(crash){
  await assert.rejects(h.service.reconcileTaskEffect(request),{code:crash==='prepared-only'?'FIXTURE_PREPARE_INTERRUPTED':'FIXTURE_PROJECTION_INTERRUPTED'})
  const pending=await h.store.query({kind:'task.get',taskId:row.taskId});assert.equal(pending.effectReconciliations[0].state,'prepared')
  await assert.rejects(h.store.command({id:'illegal-claim',kind:'task.claim',args:{taskId:row.taskId,force:true}}),{code:'TASK_EFFECT_RECONCILIATION_PENDING'})
  await assert.rejects(h.store.command({id:'illegal-resume',kind:'task.control',args:{taskId:row.taskId,control:'active'}}),{code:'TASK_EFFECT_RECONCILIATION_PENDING'})
  await h.close();await f.close();await f.boot();register();h=await open(f,{initialize:false});await h.service.recover();await h.service.whenIdle();if(crash==='prepared-only'){const held=await h.store.query({kind:'task.get',taskId:row.taskId});assert.equal(held.effectReconciliations[0].state,'prepared');assert.equal(effects,1);assert.equal(f.requests.length,requests);await h.service.reconcileTaskEffect(request)}
 }else{const result=await h.service.reconcileTaskEffect(request);assert.equal(result.state,'committed');assert.equal(result.noReplay,true)}
 const closed=await h.store.query({kind:'task.get',taskId:row.taskId});assert.equal(closed.status,'active');assert.equal(closed.control,'paused');assert.equal(closed.effectReconciliations[0].state,'committed');assert.equal(closed.lastDecision.effectDisposition,'closed-with-possible-partial-effects');assert.equal(closed.completion??null,null)
 const final=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(final.audit.filter(r=>r.domain==='task'&&r.kind==='effect-reconciled').length,1);assert.equal(final.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,0);assert.deepEqual(final.entries.find(e=>e.id===inspection.callEntryId),stored.entries.find(e=>e.id===inspection.callEntryId))
 assert.equal(effects,1);assert.equal(f.requests.length,requests,'reconciliation and recovery never invoke the model');const replay=await h.service.reconcileTaskEffect(request);assert.equal(replay.state,'committed');assert.equal(effects,1)
 if(!crash){continuing=true;await h.store.command({id:'explicit-trusted-host-resume',kind:'task.control',args:{taskId:row.taskId,control:'active',expectedControlRevision:closed.controlRevision}});await h.service.recover();await h.service.whenIdle();assert.equal(effects,1,'a control-only continuation is not authorization for a new independent action');assert.equal(attemptedAgain,true);assert.match(JSON.stringify(f.requests),/TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED/);const resumed=await h.store.query({kind:'task.get',taskId:row.taskId});assert.equal(resumed.drained,true);assert.equal(resumed.lastDecision.action,'wait')}
})
