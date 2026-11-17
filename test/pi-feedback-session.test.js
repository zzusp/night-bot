import {investigationBudget,diagnosticCompactionSettings,diagnosticOutputTokens} from '../src/feedback/investigation-budget.js'
import {formatDiagnosticReport} from '../src/feedback/pi-session.js'
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
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:tool?'toolUse':'stop',content:tool?[{type:'toolCall',id:'diag-1',name:'diagnosis_evidence',arguments:{section:'runtime'}}]:[{type:'text',text:'分析完成，证据 E1'}]}
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
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  if(calls>investigationBudget.calls){calls++;const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:'stop',content:[{type:'text',text:'已确认运行环境，尚缺链路证据，引用 E1。'}]};queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message)});return stream}
  calls++;const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:'toolUse',content:[{type:'toolCall',id:'budget-'+calls,name:'diagnosis_evidence',arguments:{section:'runtime'}}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'排查',signal:AbortSignal.timeout(10000),evidence:async()=>{reads++;return{node:'v24'}}})
 assert.equal(reads,investigationBudget.calls);assert.ok(calls<=investigationBudget.calls+3);assert.match(result,/调查未完成/);assert.ok(result.length<48000)
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
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:args?'toolUse':'stop',content:args?[{type:'toolCall',id:'recover-'+step,name:'diagnosis_evidence',arguments:args}]:[{type:'text',text:'已核实保存为每小时循环，指令中的停止条件尚未核实。证据 E3。'}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'核对测试事项',description:'预期循环，停止条件待核实',signal:AbortSignal.timeout(10000),evidence:collect})
 assert.equal(calls,4);assert.doesNotMatch(result,/FEEDBACK_ALIAS_INVALID/);assert.match(result,/每小时循环/);assert.match(result,/"everySeconds":3600/)
 assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_SCHEDULE|PRIVATE_SESSION|PRIVATE_PROMPT/)
})

test('diagnostic context uses real window with sufficient output reserve',()=>{
 for(const contextWindow of [8192,32000,128000,500000]){const model={contextWindow,maxTokens:32768},settings=diagnosticCompactionSettings(model);assert.equal(settings.enabled,true);assert.ok(settings.reserveTokens>=diagnosticOutputTokens(model));assert.ok(settings.keepRecentTokens< contextWindow-settings.reserveTokens)}
 assert.throws(()=>diagnosticCompactionSettings({contextWindow:1000}),/CONTEXT_WINDOW_INVALID/)
})
test('published report contains only cited evidence and stays within preview size',()=>{
 const rows=Array.from({length:80},(_,i)=>({ref:'E'+(i+1),section:'runtime',text:'value '+i+' '+ 'x'.repeat(5000)}))
 const output=formatDiagnosticReport('结论引用 E2。',rows)
 assert.match(output,/### E2 ·/);assert.doesNotMatch(output,/### E1 ·/);assert.match(output,/证据节选/);assert.ok(output.length<46000)
})

test('real Pi investigation can exceed former evidence cap and reread retained evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-large-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai');await runtime.setRuntimeApiKey(model.provider,'test-only')
 let calls=0,reads=0
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  const step=calls++,args=step<5?{section:'runtime'}:step===5?{section:'evidence',alias:'E1'}:null
  if(step===6){const result=context.messages.filter(row=>row.role==='toolResult').at(-1);assert.match(result.content[0].text,/E1/);assert.match(result.content[0].text,/page-1/)}
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:args?'toolUse':'stop',content:args?[{type:'toolCall',id:'large-'+step,name:'diagnosis_evidence',arguments:args}]:[{type:'text',text:'核对完成，证据 E1、E5。'}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'排查',signal:AbortSignal.timeout(10000),evidence:async()=>({page:'page-'+(++reads),data:'x'.repeat(9000)})})
 assert.equal(reads,5);assert.equal(calls,7);assert.match(result,/核对完成/);assert.doesNotMatch(result,/调查未完成/);assert.match(result,/### E5/)
})

test('native Pi compaction runs using model window and preserves final diagnosis',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-large-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model={...runtime.getModels().find(m=>m.provider==='openai'),contextWindow:8192};await runtime.setRuntimeApiKey(model.provider,'test-only')
 let calls=0,reads=0,compactions=0
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  if(JSON.stringify(context).includes('You are a context summarization assistant')){compactions++;const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage,stopReason:'stop',content:[{type:'text',text:'调查记录：E1 至 E5 已核对，可用 evidence 工具重读。'}]};queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message)});return stream}
  const step=calls++,args=step<5?{section:'runtime'}:step===5?{section:'evidence',alias:'E1'}:null
  if(step===6){const result=context.messages.filter(row=>row.role==='toolResult').at(-1);assert.match(result.content[0].text,/E1/);assert.match(result.content[0].text,/page-1/)}
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage:args?usage:{...usage,input:7000,totalTokens:7000},stopReason:args?'toolUse':'stop',content:args?[{type:'toolCall',id:'large-'+step,name:'diagnosis_evidence',arguments:args}]:[{type:'text',text:'核对完成，证据 E1、E5。'}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'排查',signal:AbortSignal.timeout(10000),evidence:async()=>({page:'page-'+(++reads),data:'x'.repeat(9000)})})
 assert.ok(compactions>0,'native Pi compaction called model');assert.equal(reads,5);assert.equal(calls,7);assert.match(result,/核对完成/);assert.doesNotMatch(result,/调查未完成/);assert.match(result,/### E5/)
})
