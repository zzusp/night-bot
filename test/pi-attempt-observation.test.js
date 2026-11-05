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
