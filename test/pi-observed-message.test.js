import test from 'node:test'
import assert from 'node:assert/strict'
import * as messages from '../src/pi-messages.js'
import {nativeExecutionStream} from '../src/pi-native-stream.js'
import {createLiveAttempt} from './fixtures/pi-live-attempt.js'
const request={provider:'fixture',model:'m',signal:new AbortController().signal}
test('observed settlement maps admitted text/reasoning/tools to Pi without consuming a source or invoking an observer',()=>{
 assert.equal('bridgeDshStream' in messages,false)
 const live={start(){throw Error('redispatch')},push(){throw Error('re-observation')}},content=[{type:'text',text:'filtered'},{type:'reasoning',text:'reason'},{type:'tool-call',id:'call',name:'read',arguments:'{"path":"x"}'}],stream=[{type:'chunk',time:1,chunk:{type:'finish',reason:{kind:'tool-calls'}}}]
 const result=messages.observedPiMessage(request,{content,finish:{kind:'tool-calls'},usage:{inputTokens:2,outputTokens:3},stream,live})
 assert.equal(result.stopReason,'toolUse');assert.deepEqual(result.content,[{type:'text',text:'filtered'},{type:'thinking',thinking:'reason'},{type:'toolCall',id:'call',name:'read',arguments:{path:'x'}}]);assert.equal(result.usage.totalTokens,5);assert.equal(result._hostLive,live);assert.equal(result._hostStream,stream)
 content[0].text='changed later';assert.equal(result.content[0].text,'filtered');assert.equal(result._hostMessage.content[0].text,'filtered');assert.ok(Object.isFrozen(result._hostMessage))
})
test('application observation errors settle once as Pi errors and cannot dispatch their partial tools',async()=>{
 let calls=0;const live=createLiveAttempt(),stream=nativeExecutionStream(async function*(){calls++;yield{type:'block-end',index:0,block:{type:'tool-call',id:'x',name:'write',arguments:'{}'}};yield{type:'finish',reason:{kind:'error',failure:{code:'POLICY',message:'blocked'}}}},request,live),events=[]
 for await(const event of stream)events.push(event)
 const result=await stream.result();assert.equal(result.stopReason,'error');assert.equal(result._hostFailure.code,'POLICY');assert.deepEqual(result.content,[]);assert.deepEqual(events.map(event=>event.type),['error']);assert.equal(calls,1);assert.equal(live.count,2);assert.equal(result._hostLive,live)
})
test('provider rejection produces one failed Pi terminal without entering an additional stream',async()=>{
 let calls=0;const stream=nativeExecutionStream(()=>{calls++;throw Error('fixture failure')},request,createLiveAttempt()),events=[]
 for await(const event of stream)events.push(event)
 assert.equal(calls,1);assert.equal((await stream.result()).stopReason,'error');assert.deepEqual(events.map(event=>event.type),['error'])
})
test('aborted observed settlement keeps failure classification and drops partial content',()=>{
 const result=messages.observedPiMessage(request,{content:[{type:'text',text:'partial'}],finish:{kind:'aborted',failure:{code:'ABORTED',message:'cancelled'}}})
 assert.equal(result.stopReason,'aborted');assert.equal(result.errorMessage,'cancelled');assert.deepEqual(result.content,[]);assert.equal(result._hostMessage,undefined)
})
