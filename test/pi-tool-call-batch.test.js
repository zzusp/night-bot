import test from 'node:test'
import assert from 'node:assert/strict'
import {Agent} from '@earendil-works/pi-agent-core'
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {createPiToolCallBatchGuard,inspectPiToolCallBatch} from '../src/runtime/pi-tool-call-batch.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
const model={id:'fixture',name:'fixture',provider:'fixture',api:'openai-completions',input:['text'],contextWindow:4096,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
const call=id=>({type:'toolCall',id,name:'effect',arguments:{}})
for(const mode of ['parallel','sequential'])for(const ids of [['duplicate','duplicate'],['valid',''],['valid','   '],['valid',undefined],['valid',42]])test(`official ${mode} malformed IDs ${JSON.stringify(ids)} block whole batch`,async()=>{
 let effects=0,previous=0,requests=0,callbacks=0
 const message={role:'assistant',provider:'fixture',api:'openai-completions',model:'fixture',responseId:'opaque-response',thinkingLevel:'off',content:[{type:'text',text:'signed',textSignature:'opaque-signature'},...ids.map(call)],stopReason:'toolUse',timestamp:1,usage},before=JSON.stringify(message)
 const guard=createPiToolCallBatchGuard(async()=>{previous++}),agent=new Agent({initialState:{model,tools:[{name:'effect',label:'effect',description:'fixture',parameters:{type:'object',properties:{}},async execute(){effects++;return {content:[{type:'text',text:'effect'}]}}}]},toolExecution:mode,streamFn(){requests++;const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message)});return stream},beforeToolCall:async(...args)=>{callbacks++;const result=await guard(...args);assert.equal(result.block,true);return result}})
 await agent.prompt('test');assert.equal(effects,0);assert.equal(previous,0);assert.equal(requests,1);assert.equal(callbacks,2);assert.equal(JSON.stringify(message),before)
 const results=agent.state.messages.filter(m=>m.role==='toolResult');assert.equal(results.length,2);assert.ok(results.every(m=>m.isError))
})
test('valid native batch preserves existing official hook and normal effects',async()=>{
 let effects=0,previous=0,requests=0
 const agent=new Agent({initialState:{model,tools:[{name:'effect',label:'effect',description:'fixture',parameters:{type:'object',properties:{}},async execute(){effects++;return {content:[{type:'text',text:'effect'}]}}}]},streamFn(){const message={role:'assistant',provider:'fixture',api:'openai-completions',model:'fixture',content:requests++?[]:[call('one'),call('two')],stopReason:requests===1?'toolUse':'stop',timestamp:1,usage},stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream},beforeToolCall:createPiToolCallBatchGuard(async()=>{previous++})})
 await agent.prompt('test');assert.equal(effects,2);assert.equal(previous,2)
 const foreign=call('one');assert.equal(inspectPiToolCallBatch({assistantMessage:{role:'assistant',content:[call('one')]},toolCall:foreign}),'PI_TOOL_BATCH_CALL_MISMATCH')
})

test('actual AgentSession composes and restores public hook with duplicate IDs and zero effects',async t=>{
 const {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader}=await import('@earendil-works/pi-coding-agent'),{mkdtemp,mkdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{OfficialPiModelRuntime}=await import('../src/pi-official-model-runtime.js'),{resolvePiProfiles}=await import('../src/pi-provider-catalog.js'),{piAuthentication}=await import('../src/pi-provider-auth.js'),{bindPiToolCallBatchGuard}=await import('../src/runtime/pi-tool-call-batch.js')
 const root=await mkdtemp(join(tmpdir(),'night-batch-')),agentDir=join(root,'agent');await mkdir(agentDir);t.after(()=>rm(root,{recursive:true,force:true}))
 const profiles=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',apiKeyEnv:'KEY',models:[{id:'fixture',maxTokens:64}]}},{deferred:true}),runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=> 'fixture'})),resolved=await runtime.resolve({provider:'fixture',model:'fixture'})
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 let effects=0,prior=0,callbacks=0
 const {session}=await createAgentSession({cwd:root,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(root),noTools:true,tools:['effect'],customTools:[{name:'effect',label:'effect',description:'fixture',parameters:{type:'object',properties:{}},async execute(){effects++;return {content:[{type:'text',text:'effect'}]}}}]});t.after(()=>session.dispose())
 const message={role:'assistant',provider:'fixture',api:'openai-completions',model:'fixture',thinkingLevel:'off',responseId:'signed-batch',content:[{type:'text',text:'signed',textSignature:'native-signature'},call('same'),call('same')],stopReason:'toolUse',timestamp:1,usage},original=JSON.stringify(message)
 session.agent.streamFunction=()=>{const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'done',reason:'toolUse',message});stream.end(message)});return stream}
 const previous=async()=>{prior++};session.agent.beforeToolCall=previous;const binding=bindPiToolCallBatchGuard(session),guard=session.agent.beforeToolCall
 session.agent.beforeToolCall=async(...args)=>{callbacks++;return guard(...args)}
 await session.prompt('test');assert.equal(effects,0);assert.equal(prior,0);assert.equal(callbacks,2);assert.equal(JSON.stringify(message),original)
 session.agent.beforeToolCall=guard;binding.close();assert.equal(session.agent.beforeToolCall,previous)
})
