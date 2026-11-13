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
