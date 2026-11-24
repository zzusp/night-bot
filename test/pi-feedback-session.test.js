import {investigationBudget,diagnosticCompactionSettings,diagnosticOutputTokens} from '../src/feedback/investigation-budget.js'
import {formatDiagnosticReport} from '../src/feedback/pi-session.js'
import {createChainEvidence} from '../src/feedback/chain-evidence.js'
import {hostFeedback} from '../src/feedback/service.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
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
 assert.match(result.body,/分析完成/);assert.match(result.evidence,/已采集证据/);assert.match(result.evidence,/v24/);assert.equal(evidenceCalls,1);assert.equal(calls,2)
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
 assert.equal(reads,investigationBudget.calls);assert.ok(calls<=investigationBudget.calls+3);assert.match(result.body,/调查未完成/);assert.ok((result.body.length+result.evidence.length)<48000)
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
 assert.equal(calls,4);assert.doesNotMatch(result.evidence,/FEEDBACK_ALIAS_INVALID/);assert.match(result.body,/每小时循环/);assert.match(result.evidence,/"everySeconds":3600/)
 assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_SCHEDULE|PRIVATE_SESSION|PRIVATE_PROMPT/)
})

test('diagnostic context uses real window with sufficient output reserve',()=>{
 for(const contextWindow of [1000,4096,8192,32000,128000,500000]){const model={contextWindow,maxTokens:32768},settings=diagnosticCompactionSettings(model);assert.equal(settings.enabled,true);assert.ok(settings.reserveTokens>=diagnosticOutputTokens(model));assert.ok(settings.keepRecentTokens< contextWindow-settings.reserveTokens)}
 assert.throws(()=>diagnosticCompactionSettings({contextWindow:0}),/CONTEXT_WINDOW_INVALID/)
})
test('cited evidence is retained whole in the preview, outside the Issue body',()=>{
 const rows=Array.from({length:80},(_,i)=>({ref:'E'+(i+1),section:'runtime',text:'value '+i+' '+ 'x'.repeat(5000)}))
 const output=formatDiagnosticReport('结论引用 E2。',rows)
 assert.equal(output.body,'结论引用 E2。');assert.match(output.evidence,/### E2 ·/);assert.doesNotMatch(output.evidence,/### E1 ·/);assert.ok(output.evidence.includes('x'.repeat(5000)));assert.ok(output.evidence.length<46000)
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
 assert.equal(reads,5);assert.equal(calls,7);assert.match(result.body,/核对完成/);assert.doesNotMatch(result.body,/调查未完成/);assert.match(result.evidence,/### E5/)
})

test('native Pi compaction runs using model window and preserves final diagnosis',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-large-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model={...runtime.getModels().find(m=>m.provider==='openai'),contextWindow:8192};await runtime.setRuntimeApiKey(model.provider,'test-only')
 let calls=0,reads=0,compactions=0,compactedDuringInvestigation=false
 const authenticate=runtime.getAuth.bind(runtime)
 runtime.getAuth=(selected,options)=>{assert.equal(options?.apiKey,undefined,'runtime credential must not be reinterpreted as an explicit API key');return authenticate(selected,options)}
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  if(JSON.stringify(context).includes('You are a context summarization assistant')){compactions++;if(reads<5)compactedDuringInvestigation=true;const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage,stopReason:'stop',content:[{type:'text',text:'调查记录：E1 至 E5 已核对，可用 evidence 工具重读。'}]};queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message});stream.end(message)});return stream}
  const step=calls++,args=step<5?{section:'runtime'}:step===5?{section:'evidence',alias:'E1'}:null
  if(step===6){const result=context.messages.filter(row=>row.role==='toolResult').at(-1);assert.match(result.content[0].text,/E1/);assert.match(result.content[0].text,/page-1/)}
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage:{...usage,input:7000,totalTokens:7000},stopReason:args?'toolUse':'stop',content:args?[{type:'toolCall',id:'large-'+step,name:'diagnosis_evidence',arguments:args}]:[{type:'text',text:'核对完成，证据 E1、E5。'}]}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'排查',signal:AbortSignal.timeout(10000),evidence:async()=>({page:'page-'+(++reads),data:'x'.repeat(9000)})})
 assert.ok(compactedDuringInvestigation,'native Pi compacts before the next tool investigation response');assert.ok(compactions>0,'native Pi compaction called model');assert.equal(reads,5);assert.equal(calls,7);assert.match(result.body,/核对完成/);assert.doesNotMatch(result.body,/调查未完成/);assert.match(result.evidence,/### E5/)
})

async function scriptedDiagnosis(t,reply,{contextWindow=4096}={}){
 const root=await mkdtemp(join(tmpdir(),'feedback-terminal-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model={...runtime.getModels().find(m=>m.provider==='openai'),contextWindow};await runtime.setRuntimeApiKey(model.provider,'test-only')
 let step=0,reads=0
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{
  const response=reply(step++,context),stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage,...response}
  queueMicrotask(()=>{if(message.stopReason==='error')stream.push({type:'error',reason:'error',error:message});else stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const result=await diagnoseWithPi({resolved:{modelRuntime:runtime,model},paths:{installRoot:root,runtime:join(root,'runtime')},title:'故障',description:'排查',signal:AbortSignal.timeout(10000),evidence:async()=>{reads++;return {marker:'RETAINED_EVIDENCE'}}})
 return {result,reads}
}
const runtimeCall=step=>({stopReason:'toolUse',content:[{type:'toolCall',id:'fixture-'+step,name:'diagnosis_evidence',arguments:{section:'runtime'}}]})
test('a 4096-window diagnostic runs and an output-token terminal is explicitly partial',async t=>{
 const {result,reads}=await scriptedDiagnosis(t,step=>step===0?runtimeCall(step):{stopReason:'length',content:[{type:'text',text:'部分分析，证据 E1。'}]})
 assert.equal(reads,1);assert.match(result.body,/模型输出达到 token 上限/);assert.match(result.evidence,/RETAINED_EVIDENCE/)
})
test('summary failure after the investigation budget retains collected evidence',async t=>{
 const {result,reads}=await scriptedDiagnosis(t,step=>step<=investigationBudget.calls?runtimeCall(step):{stopReason:'error',errorMessage:'fixture-network-failure',content:[]},{contextWindow:128000})
 assert.equal(reads,investigationBudget.calls);assert.match(result.body,/调查未完成/);assert.match(result.body,/未能生成部分诊断/);assert.match(result.evidence,/RETAINED_EVIDENCE/);assert.match(result.evidence,/### E1 ·/);assert.ok((result.body.length+result.evidence.length)<=investigationBudget.reportCharacters)
})
test('evidence tails are preserved and every dropped or unknown citation is explicitly accounted for',()=>{
 const observations=Array.from({length:12},(_,i)=>({ref:'E'+(i+1),section:'trace',text:'x'.repeat(3000)+' DECISIVE_TAIL_'+(i+1)}))
 const text='结论引用 '+observations.map(row=>row.ref).join('、')+'、E999。',result=formatDiagnosticReport(text,observations,[],{maxCharacters:30000})
 assert.match(result.evidence,/DECISIVE_TAIL_1/);assert.match(result.evidence,/## 未附证据/);assert.ok((result.body.length+result.evidence.length)<=30000)
 const missing=result.evidence.split('## 未附证据')[1]
 for(const row of observations)assert.ok(result.evidence.includes('### '+row.ref+' ·')||missing.includes(row.ref),'citation must be attached or listed missing: '+row.ref)
 assert.match(missing,/E999/)
})
async function hostDiagnosis(t,reply){
 const root=await mkdtemp(join(tmpdir(),'feedback-host-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai');await runtime.setRuntimeApiKey(model.provider,'test-only')
 let attempts=0,tokenReads=0;const warnings=[]
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context,options)=>{
  const stream=createAssistantMessageEventStream(),message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),usage,...reply(attempts++,context,options)}
  queueMicrotask(()=>{stream.push(message.stopReason==='error'?{type:'error',reason:'error',error:message}:{type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 const profile={models:[model]},services={nativePiProvider:{profiles:()=>new Map([[model.provider,profile]]),official:{resolve:async()=>({modelRuntime:runtime,model,requestOptions:{maxRetries:5}})}},credentials:{redactionValues:async()=>['PRIVATE_INPUT'],resolveCurrent:()=>{tokenReads++;throw Error('unexpected GitHub credential access')}},launchEnvironment:{redactionValues:()=>[]}}
 const service=hostFeedback({get:key=>services[key],logger:{warn:value=>warnings.push(value)}},{model:{provider:model.provider,model:model.id}},{installRoot:root,runtime:join(root,'runtime')})
 t.after(()=>service.close())
 const {revision,model:selection}=service.metadata(),{id}=service.collect('browser',{title:'页面报错',description:'PRIVATE_INPUT',model:selection,revision})
 let view
 for(let i=0;i<250;i++){view=service.read('browser',id);if(view.state!=='collecting')break;await delay(20)}
 assert.notEqual(view.state,'collecting')
 return {view,warnings,attempts,tokenReads:()=>tokenReads,service}
}
const timedOut={stopReason:'error',errorMessage:'Request timed out.',content:[]}
test('real Pi recovers consecutive timeouts in one diagnosis without replaying its tool',async t=>{
 const requests=[]
 const {view,warnings,attempts,tokenReads}=await hostDiagnosis(t,(step,context,options)=>{
  requests.push({maxRetries:options.maxRetries,messages:context.messages.map(row=>row.role)})
  if(step===2)return runtimeCall(step)
  if(step===5)return {stopReason:'stop',content:[{type:'text',text:'恢复完成，证据 E1。'}]}
  return timedOut
 })
 assert.equal(attempts,6);assert.equal(view.state,'ready');assert.match(view.body,/恢复完成/);assert.match(view.evidence,/### E1 ·/)
 assert.ok(requests.every(row=>row.maxRetries===0),'no nested provider retry budget')
 assert.deepEqual(requests.map(row=>row.messages.filter(role=>role==='toolResult').length),[0,0,0,1,1,1])
 assert.ok(requests.every(row=>row.messages.filter(role=>role==='user').length===1),'no new prompt or session per retry')
 assert.deepEqual(warnings,[]);assert.equal(tokenReads(),0)
})
test('three consecutive model timeouts fail collection and leave one safe Host warning',async t=>{
 const {view,warnings,attempts,service,tokenReads}=await hostDiagnosis(t,()=>timedOut)
 assert.equal(attempts,3);assert.equal(view.state,'failed');assert.equal(view.error,'FEEDBACK_MODEL_TIMEOUT')
 assert.equal(warnings.length,1);assert.match(warnings[0],/^feedback collection failed /)
 const {elapsedMs,...context}=JSON.parse(warnings[0].slice('feedback collection failed '.length))
 assert.ok(Number.isSafeInteger(elapsedMs)&&elapsedMs>=0)
 assert.deepEqual(context,{reportId:view.id,stage:'diagnose',code:'FEEDBACK_MODEL_TIMEOUT'})
 await assert.rejects(service.submit('browser',view.id,{confirm:true,title:view.title,body:view.body}),{code:'FEEDBACK_NOT_READY'});assert.equal(tokenReads(),0)
})
test('model timeout after collection retains the actual evidence in an editable partial preview',async t=>{
 const {view,attempts,tokenReads}=await hostDiagnosis(t,step=>step===0?runtimeCall(step):timedOut)
 assert.equal(attempts,4);assert.equal(view.state,'ready');assert.match(view.body,/调查未完成.*FEEDBACK_MODEL_TIMEOUT/)
 assert.match(view.body,/尚不能判断根因/);assert.match(view.evidence,/### E1 · runtime/);assert.match(view.evidence,/"node":"v24/)
 assert.doesNotMatch(view.body,/PRIVATE_INPUT|Request timed out/);assert.equal(tokenReads(),0)
})
test('a diagnosis without verifiable citations is marked and keeps the already collected pages',async t=>{
 const {result}=await scriptedDiagnosis(t,step=>step===0?runtimeCall(step):{stopReason:'stop',content:[{type:'text',text:'我认为这是服务故障，参考 E999。'}]})
 assert.match(result.body,/分析未附可核对的证据引用/);assert.match(result.body,/E999/)
 assert.match(result.evidence,/### E1 · runtime/);assert.match(result.evidence,/RETAINED_EVIDENCE/)
})
test('permanent model error is not retried and its raw response is not logged',async t=>{
 const {view,warnings,attempts}=await hostDiagnosis(t,()=>({stopReason:'error',errorMessage:'Unauthorized: PRIVATE_VENDOR_RESPONSE',content:[]}))
 assert.equal(attempts,1);assert.equal(view.state,'failed');assert.equal(warnings.length,1)
 assert.match(warnings[0],/FEEDBACK_MODEL_FAILED/);assert.doesNotMatch(warnings[0],/PRIVATE_|Unauthorized/)
})
