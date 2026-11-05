import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
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

test('closed partial effects cannot become completed through bare unpause and a tool-free completion',{timeout:20000},async t=>{
 let phase='unknown',effects=0
 const f=await memoryHost(t,body=>{if(!body.tools?.some(tool=>tool.function.name==='partial_write'))return;if(phase==='unknown')return {tool:'partial_write',args:{}};const action=phase==='wait'?'wait':'complete';phase='wait';return {tool:'task_result',args:{decision:{action,summary:action==='wait'?'Prior attempt remains closed with possible partial effects':'Claim completion without a new authorized objective',evidence:['retained original evidence'],limitations:[]}}}})
 f.host.ctx.get('tools').register({name:'partial_write',description:'A real local effect with an unknown result',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/uncertain.txt'),'actual partial effect');throw Error('response lost')}})
 const h=await open(f);t.after(()=>h.close())
 const created=await h.service.createTask({requestId:'initial',objective:'Perform one original bounded effect'});await until(async()=>!!(await h.service.taskDialogue(created.taskId)).error);await h.service.whenIdle()
 const original=await h.store.query({kind:'task.get',taskId:created.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(row=>row.data.kind==='effect-intent'),inspection=await h.service.inspectTaskEffect({taskId:created.taskId,intentEntryId:intent.entryId})
 await h.service.reconcileTaskEffect(await proposal(h.service,inspection))
 phase='complete';await h.store.command({id:'bare-complete-unpause',kind:'task.control',args:{taskId:created.taskId,control:'active'}});await h.service.recover();await h.service.whenIdle()
 const held=await h.store.query({kind:'task.get',taskId:created.taskId});assert.notEqual(held.status,'completed');assert.equal(held.completion??null,null);assert.equal(effects,1);assert.match(JSON.stringify(f.requests),/TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED/)
 const after=await f.host.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true});assert.equal(after.audit.filter(row=>row.kind==='effect-intent').length,1);assert.equal(after.audit.filter(row=>row.kind==='effect-reconciled').length,1)
 phase='wait';await h.store.command({id:'explicit-wait-wake',kind:'task.wake',args:{taskId:created.taskId,kind:'operator.continue',payload:{requestId:'read-only-explanation'}}});await h.service.recover();await h.service.whenIdle()
 const waiting=await h.store.query({kind:'task.get',taskId:created.taskId});assert.notEqual(waiting.status,'completed');assert.equal(waiting.lastDecision.action,'wait');assert.equal(effects,1)
})
