import test from 'node:test'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {createAttemptObservation} from '../src/runtime/attempt-observation.js'
import {expandAssistantStream,createUserMessage} from '../src/native-message-protocol.js'
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
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:[{id:'observed-read',name:'read',args:{file_path:'observation.txt'}}]}:{text:'observation complete'}),parent=await f.parent('observation-owner');let frames=0
 f.host.ctx.on('agent/assistant-stream',()=>frames++)
 await writeFile(join(f.root,'work','observation.txt'),'OWNED_OBSERVATION_PROOF')
 parent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Read the fixture once'}]}));await parent.whenIdle()
 const events=await f.events(parent.id),assistants=events.filter(event=>event.type==='assistant/message');assert.equal(f.requests.length,2);assert.equal(frames,0);assert.equal(assistants.length,2);const results=events.filter(event=>event.type==='tool/result'&&event.data.message.toolCallId==='observed-read');assert.equal(results.length,1);assert.equal(results[0].data.message.isError,false);assert.match(JSON.stringify(f.requests[1]),/OWNED_OBSERVATION_PROOF/);assert.match(JSON.stringify(assistants),/observation complete/);assert.equal(parent.providerStreamProtocol,'pi-native')
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
test('production observation preserves the native terminal response and signatures',async()=>{
 const {AssistantMessageEventStream}=await import('@earendil-works/pi-ai')
 const {nativeExecutionStream,nativePiEventSink}=await import('../src/pi-native-stream.js')
 const {observePiEvents}=await import('../src/pi-provider-events.js')
 const message={role:'assistant',provider:'fixture',model:'model',api:'openai-responses',responseId:'production-observation-response',timestamp:1,
  content:[{type:'text',text:'native',textSignature:'pi-signature'}],usage:{input:2,output:3,totalTokens:5,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}},stopReason:'stop'}
 const observation=createAttemptObservation()
 const stream=nativeExecutionStream(async function*(){
  const sink=nativePiEventSink(),chunks=[],upstream=new AssistantMessageEventStream()
  upstream.push({type:'text_delta',contentIndex:0,delta:'native',partial:message})
  upstream.push({type:'done',reason:'stop',message});upstream.end(message)
  for await(const event of observePiEvents(upstream,{provider:'fixture',model:'model',onChunk:chunk=>{sink.chunk(chunk);chunks.push(chunk)}})){
   sink(event);while(chunks.length)yield chunks.shift()
  }
 },{provider:'fixture',model:'model',signal:new AbortController().signal},observation)
 const result=await stream.result()
 assert.equal(result._hostNative,true);assert.equal(result.responseId,message.responseId)
 assert.equal(result.content[0].textSignature,'pi-signature');assert.equal(result._hostLive,observation)
 assert.equal(result._hostMessage.source.replayState.response.responseId,message.responseId)
})
test('native error and abort retain diagnostic tools and signatures without granting executable output',async()=>{
 const {AssistantMessageEventStream}=await import('@earendil-works/pi-ai')
 const {nativeExecutionStream,nativePiEventSink}=await import('../src/pi-native-stream.js')
 const {observePiEvents}=await import('../src/pi-provider-events.js')
 for(const reason of ['error','aborted'])for(const mutate of [false,true]){
  const call={type:'toolCall',id:'diagnostic-tool',name:'write',arguments:{path:'never-written'},thoughtSignature:'tool-signature'}
  const message={role:'assistant',provider:'fixture',model:'model',api:'openai-responses',responseId:'failure-response',timestamp:1,
   content:[call],usage:{input:2,output:3,totalTokens:5,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}},stopReason:reason,errorMessage:reason==='error'?'500 server failure':'cancelled'}
  const observation=createAttemptObservation()
  const stream=nativeExecutionStream(async function*(){
   const sink=nativePiEventSink(),chunks=[],upstream=new AssistantMessageEventStream()
   upstream.push({type:'toolcall_start',contentIndex:0,partial:message})
   upstream.push({type:'toolcall_end',contentIndex:0,toolCall:call,partial:message})
   upstream.push({type:'error',reason,error:message});upstream.end(message)
   for await(const event of observePiEvents(upstream,{provider:'fixture',model:'model',onChunk:chunk=>{sink.chunk(chunk);chunks.push(chunk)}})){
    sink(event);while(chunks.length){const chunk=chunks.shift();yield mutate&&chunk.type==='block-end'?{...chunk,block:{...chunk.block,name:'changed'}}:chunk}
   }
  },{provider:'fixture',model:'model',signal:new AbortController().signal},observation)
  const events=[];for await(const event of stream)events.push(event)
  const result=await stream.result()
  assert.equal(result.stopReason,reason);assert.equal(events.at(-1).type,'error');assert.equal(observation.replayState,undefined)
  if(mutate){assert.equal(result._hostNative,undefined);assert.equal(result.responseId,undefined);assert.deepEqual(result.content,[])}
  else{
   assert.equal(result._hostNative,true);assert.equal(result.responseId,'failure-response');assert.equal(result.content[0].thoughtSignature,'tool-signature');assert.equal(result._hostFailure.code,reason==='error'?'SERVER':'ABORTED')
   const {agentLoop}=await import('@earendil-works/pi-agent-core')
   let executions=0
   const loop=agentLoop([{role:'user',content:[{type:'text',text:'test failure'}],timestamp:1}],
    {messages:[],tools:[{name:'write',label:'Write',description:'Must not execute',parameters:{type:'object',properties:{}},execute:async()=>{executions++;throw Error('executed failed tool')}}]},
    {model:{provider:'fixture'},convertToLlm:messages=>messages},new AbortController().signal,
    ()=>{const failed=new AssistantMessageEventStream();failed.push({type:'error',reason,error:result});failed.end(result);return failed})
   const loopEvents=[];for await(const event of loop)loopEvents.push(event)
   assert.equal(executions,0);assert.equal(loopEvents.some(event=>event.type==='tool_execution_start'),false)
   assert.equal(loopEvents.at(-1).type,'agent_end')
  }
 }
})
