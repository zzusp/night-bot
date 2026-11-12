import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
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
async function open(f){
 const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'effect-completion-e2e',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit'},residentStore=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore({...config,initialize:true})
 const service=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external sends')},readback:async()=>{throw Error('no external readback')}}})
 return {service,store,async close(){await service.close();await store.close();await residentStore.close()}}
}
async function proposal(service,inspection){
 const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Trusted operator read back work/uncertain.txt. It exists; the failed attempt may have partial effects.',outcome:'partial-or-unknown',noReplay:true}
 const bytes=Buffer.from(JSON.stringify(doc)),sha256=createHash('sha256').update(bytes).digest('hex'),path='materials/runtime-evidence/effects/'+sha256+'.json'
 await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,path),bytes)
 return {...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'operator-close',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'I inspected the actual output and close this failed attempt with possible partial effects. Do not replay or continue.'}
}

test('closed partial effects do not require a separate operator grant for a later tool-free completion',{timeout:nativeTestTimeout(20000)},async t=>{
 let phase='unknown',effects=0,h
 t.after(()=>h?.close())
 const f=await memoryHost(t,body=>{if(!body.tools?.some(tool=>tool.function.name==='partial_write'))return;if(phase==='unknown')return {tool:'partial_write',args:{}};const action=phase==='wait'?'wait':'complete';phase='wait';return {tool:'task_result',args:{decision:{action,summary:action==='wait'?'Prior attempt remains closed with possible partial effects':'Completed the current evidence review; the prior attempt remains closed with possible partial effects',evidence:['retained original evidence'],limitations:[]}}}})
 f.host.ctx.get('tools').register({name:'partial_write',description:'A real local effect with an unknown result',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'actual partial effect');throw Error('response lost')}})
 h=await open(f)
 const created=await h.service.createTask({requestId:'initial',objective:'Perform one original bounded effect'});await until(async()=>!!(await h.service.taskDialogue(created.taskId)).error);await h.service.whenIdle()
 const original=await h.store.query({kind:'task.get',taskId:created.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(row=>row.data.kind==='effect-intent'),inspection=await h.service.inspectTaskEffect({taskId:created.taskId,intentEntryId:intent.entryId})
 await h.service.reconcileTaskEffect(await proposal(h.service,inspection))
 phase='complete';await h.store.command({id:'bare-complete-unpause',kind:'task.control',args:{taskId:created.taskId,control:'active'}});await h.service.recover();await h.service.whenIdle()
 const held=await h.store.query({kind:'task.get',taskId:created.taskId});assert.equal(held.status,'completed');assert.match(held.completion.summary,/prior attempt remains closed with possible partial effects/);assert.equal(effects,1);assert.doesNotMatch(JSON.stringify(f.requests),/TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED/)
 const after=await f.host.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true});assert.equal(after.audit.filter(row=>row.kind==='effect-intent').length,1);assert.equal(after.audit.filter(row=>row.kind==='effect-reconciled').length,1)

})

for(const cold of [false,true])test(`closed effects permit independent actual effects without new-action (${cold?'cold':'live'})`,{timeout:nativeTestTimeout(40000)},async t=>{
 let phase='unknown',effects=0,step=0,h
 t.after(()=>h?.close())
 const f=await memoryHost(t,body=>{
  if(!body.tools?.some(tool=>tool.function.name==='partial_write'))return
  if(phase==='unknown')return {tool:'partial_write',args:{}}
  if(step++===0)return {tool:'write',args:{path:'work/new-objective.txt',content:'independent current work'}}
  if(step===2)return {tool:'partial_write',args:{}}
  return {tool:'task_result',args:{decision:{action:'complete',summary:'Current independent work completed; prior partial effects remain closed, not replayed.',evidence:['work/new-objective.txt'],limitations:['Earlier partial effects retained']}}}
 },{hostConfig:{permissionMode:'full'}})
 f.host.ctx.get('tools').register({name:'partial_write',description:'A real effect; first response is lost',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'actual effect '+effects);if(effects===1)throw Error('response lost');return {ok:true}}})
 h=await open(f)
 const created=await h.service.createTask({requestId:'original',objective:'Perform the bounded current work'})
 await until(async()=>!!(await h.service.taskDialogue(created.taskId)).error);await h.service.whenIdle()
 const before=await h.store.query({kind:'task.get',taskId:created.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(before.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(row=>row.data.kind==='effect-intent')
 const inspection=await h.service.inspectTaskEffect({taskId:created.taskId,intentEntryId:intent.entryId})
 await h.service.reconcileTaskEffect(await proposal(h.service,inspection))
 if(cold){await h.close();h=await open(f)}
 phase='new'
 await h.store.command({id:'ordinary-resume',kind:'task.control',args:{taskId:created.taskId,control:'active'}})
 await h.service.recover();await h.service.whenIdle()
 const task=await h.store.query({kind:'task.get',taskId:created.taskId}),native=await f.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 assert.equal(task.status,'completed',JSON.stringify({task,alerts:h.service.listAlerts()}));assert.equal(task.sessionId,before.sessionId);assert.equal(task.requirementRevision,before.requirementRevision)
 assert.equal(effects,2,'Identical arguments in a genuinely distinct native invocation are allowed')
 assert.equal(await readFile(join(inspection.scope.taskRoot,'work/new-objective.txt'),'utf8'),'independent current work')
 assert.equal(native.audit.filter(row=>row.kind==='effect-intent').length,3)
 assert.equal(native.audit.filter(row=>row.kind==='effect-intent'&&row.payload.key===intent.data.payload.key).length,1,'The original native invocation is never re-executed')
 assert.equal(native.audit.filter(row=>row.kind==='effect-reconciled').length,1);assert.equal(task.effectReconciliations[0].receipt.payload.noReplay,true)
 assert.ok(!(await h.store.query({kind:'source.list'})).some(row=>row.requestIdentity?.effectAuthorization),'No hidden operator new-action source')
 assert.doesNotMatch(JSON.stringify(f.requests),/TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED/)
 await h.service.recover();await h.service.whenIdle();assert.equal(effects,2,'Acknowledged work is not replayed on recovery')
})

test('an unsettled effect does not prevent the original session from waking to read and report evidence',{timeout:nativeTestTimeout(30000)},async t=>{
 let phase='unknown',effects=0,step=0,h
 t.after(()=>h?.close())
 const f=await memoryHost(t,body=>{
  if(!body.tools?.some(tool=>tool.function.name==='partial_write'))return
  if(phase==='unknown')return {tool:'partial_write',args:{}}
  if(step++===0)return {tool:'read',args:{path:'work/uncertain.txt'}}
  assert.match(JSON.stringify(body),/actual partial effect/)
  return {tool:'task_result',args:{decision:{action:'wait',summary:'Read the original file; the effect is still unknown and not replayed.',evidence:['work/uncertain.txt'],limitations:['Unknown effect not reconciled']}}}
 })
 f.host.ctx.get('tools').register({name:'partial_write',description:'A real partial effect',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'actual partial effect');throw Error('response lost')}})
 h=await open(f)
 const created=await h.service.createTask({requestId:'original',objective:'Read back retained evidence without replay'})
 await until(async()=>!!(await h.service.taskDialogue(created.taskId)).error);await h.service.whenIdle()
 const before=await h.store.query({kind:'task.get',taskId:created.taskId}),nativeBefore=await f.host.ctx.sessionPersistence.readNative(before.sessionId,{requireComplete:true})
 phase='inspect'
 await h.store.command({id:'readback-wake',kind:'task.control',args:{taskId:created.taskId,control:'active'}})
 await h.service.recover();await h.service.whenIdle()
 const task=await h.store.query({kind:'task.get',taskId:created.taskId}),native=await f.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 assert.equal(task.sessionId,before.sessionId);assert.equal(task.lastDecision.action,'wait');assert.match(task.lastDecision.summary,/Read the original file/);assert.equal(task.drained,true)
 assert.equal(effects,1);assert.equal(native.audit.filter(row=>row.kind==='effect-intent').length,1);assert.equal(native.audit.filter(row=>row.kind==='effect-reconciled').length,0)
 assert.deepEqual(native.audit.filter(row=>row.kind==='owner-drained'),nativeBefore.audit.filter(row=>row.kind==='owner-drained'),'Readback retains the exact old owner proof')
})
