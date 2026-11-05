import test from 'node:test'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {createAttemptObservation} from '../src/runtime/attempt-observation.js'
import {expandAssistantStream} from '../src/native-message-protocol.js'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {officialToolsFixture,definition} from './fixtures/pi-official-tools.js'
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'
test('application observation preserves immutable Night audit and has no framing or commit API',()=>{
 const observer=createAttemptObservation(),chunk={type:'text-delta',index:0,text:'first'};observer.push(chunk);chunk.text='mutated'
 const prior=observer.stream;observer.push({type:'text-delta',index:0,text:' second'});observer.push({type:'usage',usage:{inputTokens:2,outputTokens:3}});observer.push({type:'finish',reason:{kind:'stop'}})
 assert.deepEqual(observer.blocks(),[{type:'text',text:'first second'}]);assert.equal(observer.usage.outputTokens,3);assert.equal(observer.finish.kind,'stop');assert.ok(Object.isFrozen(prior));assert.equal([...expandAssistantStream(prior)][0].chunk.text,'first');assert.equal([...expandAssistantStream(observer.stream)].length,4)
 for(const key of ['start','settle','abandon','ended','attemptId','interruptedBlocks'])assert.equal(key in observer,false)
})
test('max-token observation cannot publish a partial tool call or misalign replay metadata',()=>{
 const observer=createAttemptObservation();observer.push({type:'block-end',index:0,block:{type:'text',text:'safe'}});observer.push({type:'tool-call-delta',index:1,id:'call',name:'write',argumentsDelta:'{"path":'})
 observer.push({type:'finish',reason:{kind:'max-tokens'},replayState:{response:{responseId:'fixture'},blocks:[{kind:'text'},{kind:'tool'}]}})
 assert.deepEqual(observer.blocks(),[{type:'text',text:'safe'}]);assert.deepEqual(observer.replayState,{response:{responseId:'fixture'},blocks:[{kind:'text'}]})
})
test('actual Pi tool continuation persists one assistant result per step without obsolete assistant frames',async t=>{
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:[{id:'observed-read',name:'read',args:{file_path:'observation.txt'}}]}:{text:'observation complete'})
 const handle=await f.host.ctx.agents.create({sessionId:'observation-owner',meta:{cwd:join(f.root,'work')},agentOptions:{provider:'fixture',model:'m'},authorizeInput:(packet,actor)=>actor.id==='observation-owner'&&packet.id==='observation-input'&&packet.source.kind==='fixture-user',setup:async ctx=>{await ctx.get('agentPresets').mount(ctx,'night-bot')}});f.handles.push(handle)
 let frames=0;f.host.ctx.on('agent/assistant-stream',()=>frames++)
 await writeFile(join(f.root,'work','observation.txt'),'OWNED_OBSERVATION_PROOF')
 await handle.enqueue({id:'observation-input',source:{kind:'fixture-user'},content:'Read the fixture once'});await handle.deliver('observation-input');await handle.whenIdle()
 assert.ok(handle.session instanceof AgentSession);assert.equal(handle.agent.session,undefined)
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id),messages=saved.entries.filter(entry=>entry.type==='message').map(entry=>entry.message),assistants=messages.filter(message=>message.role==='assistant'),results=messages.filter(message=>message.role==='toolResult'&&message.toolCallId==='observed-read')
 assert.equal(f.requests.length,2);assert.equal(frames,0);assert.equal(assistants.length,2);assert.equal(results.length,1);assert.equal(results[0].isError,false)
 const calls=assistants.flatMap(message=>message.content.filter(block=>block.type==='toolCall'));assert.equal(calls.length,1);assert.equal(calls[0].id,results[0].toolCallId);assert.equal(calls[0].name,results[0].toolName)
 assert.match(JSON.stringify(f.requests[1]),/OWNED_OBSERVATION_PROOF/);assert.match(JSON.stringify(assistants),/observation complete/)
 assert.equal(saved.entries.some(entry=>entry.type==='custom'&&entry.customType==='night.legacy-event'&&/assistant|tool\/result/.test(entry.data?.type??'')),false)
 assert.deepEqual(saved.context.projection.messages.filter(message=>message.role==='assistant'||message.role==='toolResult'),messages.filter(message=>message.role==='assistant'||message.role==='toolResult'))

})
test('Pi observation writes compact audit records accepted by Night durable readers',()=>{
 const observer=createAttemptObservation()
 const chunks=[{type:'block-start',index:8,blockType:'reasoning'},{type:'reasoning-delta',index:8,text:'think'},
  {type:'block-end',index:8,block:{type:'reasoning',text:'complete'}},{type:'reasoning-delta',index:8,text:'ignored'},
  {type:'tool-call-delta',index:2,id:'call-2',name:'read',argumentsDelta:'{"file":'},
  {type:'tool-call-delta',index:2,id:'call-2',argumentsDelta:'"a"}'},
  {type:'finish',reason:{kind:'tool-calls'},replayState:{response:{responseId:'pi-response'},blocks:[{thinkingSignature:'signed'},{id:'call-2'}]}}]
 for(const chunk of chunks)observer.push(chunk)
 assert.deepEqual(expandAssistantStream(observer.stream).map(value=>value.chunk),chunks)
 assert.ok(observer.stream.some(record=>record.type==='tool-call-chunks'))
 assert.deepEqual(observer.blocks(),[{type:'reasoning',text:'complete'},{type:'tool-call',id:'call-2',name:'read',arguments:'{"file":"a"}'}])
 assert.deepEqual(observer.replayState,chunks.at(-1).replayState)
 assert.ok(Object.isFrozen(observer.blocks()[1]));assert.ok(Object.isFrozen(observer.replayState.blocks[0]))
})
test('Pi observation keeps failed diagnostic tools and suppresses max-token tools with aligned replay',()=>{
 for(const kind of ['error','aborted','max-tokens']){
  const observer=createAttemptObservation()
  observer.push({type:'block-end',index:0,block:{type:'text',text:'retained'}})
  observer.push({type:'block-end',index:1,block:{type:'tool-call',id:'unsafe',name:'write',arguments:'{}'}})
  observer.push({type:'finish',reason:{kind},replayState:{response:{responseId:'identity'},blocks:[{signature:'text'},{signature:'tool'}]}})
  assert.deepEqual(observer.blocks(),kind==='max-tokens'?[{type:'text',text:'retained'}]:[{type:'text',text:'retained'},{type:'tool-call',id:'unsafe',name:'write',arguments:'{}'}])
  assert.deepEqual(observer.replayState,{response:{responseId:'identity'},blocks:kind==='max-tokens'?[{signature:'text'}]:[{signature:'text'},{signature:'tool'}]})
 }
 const observer=createAttemptObservation()
 observer.push({type:'text-delta',index:0,text:'a'})
 observer.push({type:'finish',reason:{kind:'stop'},replayState:{response:{responseId:'identity'},blocks:[]}})
 assert.equal(observer.replayState,undefined)
})
test('Pi observation rejects lossy JSON without mutating content or audit',()=>{
 const observer=createAttemptObservation()
 for(const chunk of [{type:'text-delta',index:0,text:'bad',extra:undefined},{type:'text-delta',index:NaN,text:'bad'},
  {type:'text-delta',index:-0,text:'bad'},{type:'tool-call-delta',index:0,id:'x',argumentsDelta:1},
  {type:'text-delta',index:0,text:1},{type:'unknown'}]){
  assert.throws(()=>observer.push(chunk),TypeError)
  assert.deepEqual(observer.blocks(),[]);assert.deepEqual(observer.stream,[])
 }
 const block={type:'tool-call',id:'safe',name:'read',arguments:'{}'},replay={response:{responseId:'pi-id'},blocks:[{signature:'original'}]}
 observer.push({type:'block-end',index:0,block});observer.push({type:'finish',reason:{kind:'tool-calls'},replayState:replay})
 block.name='changed';replay.blocks[0].signature='changed'
 assert.equal(observer.blocks()[0].name,'read');assert.equal(observer.replayState.blocks[0].signature,'original')
})
test('official native runtime preserves terminal response identity and signatures',async t=>{
 const h=await officialToolsFixture(t,()=>{}),message={role:'assistant',provider:h.model.provider,model:h.model.id,api:h.model.api,responseId:'production-observation-response',timestamp:1,
  content:[{type:'text',text:'native',textSignature:'pi-signature'}],usage:{input:2,output:3,totalTokens:5,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}},stopReason:'stop'}
 h.runtime.registerProvider(h.model.provider,{api:h.model.api,streamSimple:()=>{const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'text_delta',contentIndex:0,delta:'native',partial:message});stream.push({type:'done',reason:'stop',message});stream.end(message)});return stream}})
 const stream=h.runtime.streamSimple(h.model,{messages:[{role:'user',content:'inspect native signature',timestamp:1}]},{maxTokens:31,maxRetries:0}),events=[]
 for await(const event of stream)events.push(event)
 const result=await stream.result();assert.equal(result.responseId,message.responseId);assert.equal(result.content[0].textSignature,'pi-signature');assert.equal(result.stopReason,'stop');assert.equal(events.at(-1).message.responseId,message.responseId)
 assert.equal(Object.keys(result).some(key=>key.startsWith('_host')),false)
})
test('official SDK retains failed diagnostic tool signatures and never executes them',async t=>{
 for(const reason of ['error','aborted'])await t.test(reason,async t=>{
  let executions=0
  const h=await officialToolsFixture(t,({ctx})=>ctx.tools.register(definition('unsafe',async()=>{executions++;return{unexpected:true}})))
  const call={type:'toolCall',id:'diagnostic-tool',name:'unsafe',arguments:{},thoughtSignature:'tool-signature'},message={role:'assistant',provider:h.model.provider,model:h.model.id,api:h.model.api,responseId:'failure-response',timestamp:1,content:[call],usage:{input:0,output:0,totalTokens:0,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}},stopReason:reason,errorMessage:reason==='error'?'permanent fixture error':'cancelled'}
  h.runtime.registerProvider(h.model.provider,{api:h.model.api,streamSimple:()=>{const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'toolcall_start',contentIndex:0,partial:message});stream.push({type:'toolcall_end',contentIndex:0,toolCall:call,partial:message});stream.push({type:'error',reason,error:message});stream.end(message)});return stream}})
  await h.run([])
  assert.equal(executions,0);assert.equal(h.results.length,0)
  const assistants=h.manager.getEntries().filter(entry=>entry.type==='message'&&entry.message.role==='assistant').map(entry=>entry.message)
  assert.equal(assistants.length,1);assert.equal(assistants[0].stopReason,reason);assert.equal(assistants[0].content[0].thoughtSignature,'tool-signature');assert.equal(assistants[0].responseId,'failure-response')
  assert.equal(h.manager.getEntries().some(entry=>entry.type==='message'&&entry.message.role==='toolResult'),false)
 })
})
