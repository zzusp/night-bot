import test from 'node:test'
import assert from 'node:assert/strict'
import * as native from '../src/native-message-protocol.js'
import * as legacy from './fixtures/legacy-llm-interface.mjs'

test('local immutable message construction preserves role, source and detached content',()=>{
 for(const api of [native,legacy]){
  const content=[{type:'text',text:'hello'}],message=api.createUserMessage({content,source:{kind:'user'}})
  content[0].text='changed'
  assert.equal(message.content[0].text,'hello');assert.equal(message.role,'user');assert.equal(Object.isFrozen(message.content[0]),true)
  assert.match(message.id,/^[a-f0-9-]{36}$/);assert.equal(api.freezeMessage(message).id,message.id)
  assert.equal(api.createSystemMessage('').content.length,0)
  assert.equal(api.createAssistantMessage({content:[],source:{provider:'fixture',model:'fixture'}}).source.kind,'model')
 }
 assert.notEqual(native.createUserMessage,legacy.createUserMessage)
})
test('native loop request ownership is exact-object and cannot be copied or borrowed from legacy markers',()=>{
 const request={};assert.equal(native.markAgentLoopRequest(request),request)
 assert.equal(native.isAgentLoopRequest(request),true)
 assert.equal(native.isAgentLoopRequest({...request}),false)
 assert.equal(legacy.isAgentLoopRequest(request),false)
 const other=legacy.markAgentLoopRequest({});assert.equal(native.isAgentLoopRequest(other),false)
})
test('local assistant stream assembly retains malformed-delta tolerance and finish facts',()=>{
 const chunks=[{type:'text-delta',index:0,text:'hello'},{type:'text-delta',index:0,text:' world'},
 {type:'block-end',index:0,block:{type:'text',text:'hello world'}},{type:'text-delta',index:0,text:'ignored'},
 {type:'finish',reason:{kind:'stop'},replayState:{fixture:true}}]
 const build=api=>{const a=new api.BlockAssembler();for(const chunk of chunks)a.push(chunk);return{blocks:a.blocks(),finish:a.finish}}
 assert.deepEqual(build(native),build(legacy))
 assert.deepEqual(build(native).blocks,[{type:'text',text:'hello world'}])
})
test('compact assistant streams round-trip original timed chunks and reject corrupt durable records',()=>{
 const input=[{time:10,chunk:{type:'text-delta',index:0,text:'中'}},{time:8,chunk:{type:'text-delta',index:0,text:'😀'}},{time:15,chunk:{type:'finish',reason:{kind:'stop'}}}]
 const snapshots=[]
 for(const api of [native,legacy]){
  const a=new api.AssistantStreamAccumulator();for(const value of input)a.push(value)
  const snapshot=a.snapshot();snapshots.push(snapshot)
  assert.deepEqual([...api.expandAssistantStream(snapshot)],input)
  assert.throws(()=>[...api.expandAssistantStream([{type:'text-chunks',time0:10,index:0,dt:[],texts:['a','b']}])])
  assert.throws(()=>a.push({time:NaN,chunk:{type:'text-delta',index:0,text:'bad'}}))
 }
 assert.deepEqual(snapshots[0],snapshots[1])
})
