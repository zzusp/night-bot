import {createChainEvidence} from '../src/feedback/chain-evidence.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {diagnoseWithPi} from '../src/feedback/pi-session.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
test('real official Pi diagnostic session has only scoped tool, no home context and redacts before model',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-pi-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai');await runtime.setRuntimeApiKey(model.provider,'test-only')
 let calls=0,evidenceCalls=0;const requests=[]
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  requests.push(context);const tool=calls++===0
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:tool?'toolUse':'stop',content:tool?[{type:'toolCall',id:'diag-1',name:'diagnosis_evidence',arguments:{section:'runtime'}}]:[{type:'text',text:'分析完成'}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model,requestOptions:{maxTokens:100,maxRetries:0}},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'secretvalue',secrets:['secretvalue'],signal:AbortSignal.timeout(10000),evidence:async section=>{evidenceCalls++;assert.equal(section,'runtime');return{node:'v24'}}})
 assert.match(result,/分析完成/);assert.match(result,/已采集证据/);assert.match(result,/v24/);assert.equal(evidenceCalls,1);assert.equal(calls,2)
 assert.ok(!JSON.stringify(requests).includes('secretvalue'))
 assert.ok(JSON.stringify(requests).includes('diagnosis_evidence'));assert.ok(!JSON.stringify(requests).includes('Execute a bash command'))
 assert.ok(!JSON.stringify(requests).includes(root),'private working path not sent to model')
})
test('investigation budget stops repeated tools and preserves a partial editable report',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-budget-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai');await runtime.setRuntimeApiKey(model.provider,'test-only')
 let calls=0,reads=0
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:()=>{
  calls++;const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:'toolUse',content:[{type:'toolCall',id:'budget-'+calls,name:'diagnosis_evidence',arguments:{section:'runtime'}}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'排查',signal:AbortSignal.timeout(10000),evidence:async()=>{reads++;return{node:'v24'}}})
 assert.equal(reads,24);assert.ok(calls<=26);assert.match(result,/调查未完成/);assert.match(result,/call-budget-exhausted/);assert.match(result,/v24/);assert.ok(result.length<48000)
})

test('real Pi can recover from an invalid task alias and inspect a schedule without message matches',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-recover-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai');await runtime.setRuntimeApiKey(model.provider,'test-only')
 const collect=createChainEvidence({application:{tasks:{store:{query:async()=>[]},listObserverGroups:()=>[]}},title:'核对测试事项',description:'预期循环，停止条件待核实',getSchedule:()=>({catalog:async()=>[{id:'PRIVATE_SCHEDULE',sessionId:'PRIVATE_SESSION',title:'核对测试事项',prompt:'PRIVATE_PROMPT',kind:'every',everySeconds:3600,scheduledAt:'2026-11-14T01:00:00.000Z',status:'active'}]})})
 let calls=0;const requests=[]
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  requests.push(context);const step=calls++,last=context.messages.filter(row=>row.role==='toolResult').at(-1)
  const evidence=last?JSON.parse(JSON.parse(last.content[0].text).evidence):null
  let args
  if(step===0)args={section:'task',alias:'guessed-task'}
  if(step===1){assert.equal(evidence.reason,'FEEDBACK_ALIAS_INVALID');assert.match(evidence.correction,/discover/);args={section:'discover',query:'测试'}}
  if(step===2){assert.equal(evidence.candidates.length,0);assert.equal(evidence.scheduleCandidates.length,1);args={section:'schedule',alias:evidence.scheduleCandidates[0].alias}}
  if(step===3){assert.equal(evidence.recurring,true);assert.equal(evidence.timing.everySeconds,3600);assert.equal(evidence.stopCondition,'not-a-structured-schedule-field')}
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:args?'toolUse':'stop',content:args?[{type:'toolCall',id:'recover-'+step,name:'diagnosis_evidence',arguments:args}]:[{type:'text',text:'已核实保存为每小时循环，指令中的停止条件尚未核实。'}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'核对测试事项',description:'预期循环，停止条件待核实',signal:AbortSignal.timeout(10000),evidence:collect})
 assert.equal(calls,4);assert.match(result,/FEEDBACK_ALIAS_INVALID/);assert.match(result,/每小时循环/);assert.match(result,/"everySeconds":3600/)
 assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_SCHEDULE|PRIVATE_SESSION|PRIVATE_PROMPT/)
})
