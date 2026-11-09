import test from 'node:test'
import assert from 'node:assert/strict'
import * as native from '../src/native-message-protocol.js'
import {createAttemptObservation} from '../src/runtime/attempt-observation.js'
import {createAssistantAudit} from '../src/runtime/assistant-audit.js'

test('local immutable message construction preserves role, source and detached content',()=>{
 for(const api of [native]){
  const content=[{type:'text',text:'hello'}],message=api.createUserMessage({content,source:{kind:'user'}})
  content[0].text='changed'
  assert.equal(message.content[0].text,'hello');assert.equal(message.role,'user');assert.equal(Object.isFrozen(message.content[0]),true)
  assert.match(message.id,/^[a-f0-9-]{36}$/);assert.equal(api.freezeMessage(message).id,message.id)
  assert.equal(api.createSystemMessage('').content.length,0)
  assert.equal(api.createAssistantMessage({content:[],source:{provider:'fixture',model:'fixture'}}).source.kind,'model')
 }
})
test('loop request ownership is exact-object and cannot be copied, inherited or proxied',()=>{
 const request={};assert.equal(native.markAgentLoopRequest(request),request)
 assert.equal(native.isAgentLoopRequest(request),true)
 assert.equal(native.isAgentLoopRequest({...request}),false)
 assert.equal(native.isAgentLoopRequest(Object.create(request)),false)
 assert.equal(native.isAgentLoopRequest(new Proxy(request,{})),false)
 assert.equal(native.isAgentLoopRequest(structuredClone(request)),false)
})
test('application observation retains closed-block tolerance and finish facts',()=>{
 const chunks=[{type:'text-delta',index:0,text:'hello'},{type:'text-delta',index:0,text:' world'},
 {type:'block-end',index:0,block:{type:'text',text:'hello world'}},{type:'text-delta',index:0,text:'ignored'},
 {type:'finish',reason:{kind:'stop'},replayState:{fixture:true}}]
 const build=()=>{const a=createAttemptObservation();for(const chunk of chunks)a.push(chunk);return{blocks:a.blocks(),finish:a.finish}}
 assert.deepEqual(build().finish,{kind:'stop'})
 assert.deepEqual(build().blocks,[{type:'text',text:'hello world'}])
})
test('compact assistant streams round-trip original timed chunks and reject corrupt durable records',()=>{
 const input=[{time:10,chunk:{type:'text-delta',index:0,text:'中'}},{time:8,chunk:{type:'text-delta',index:0,text:'😀'}},{time:15,chunk:{type:'finish',reason:{kind:'stop'}}}]
 for(const api of [native]){
  const a=createAssistantAudit();for(const value of input)a.append(value.time,Object.freeze(value.chunk))
  const snapshot=a.snapshot();assert.ok(snapshot.length<input.length)
  assert.deepEqual([...api.expandAssistantStream(snapshot)],input)
  assert.throws(()=>[...api.expandAssistantStream([{type:'text-chunks',time0:10,index:0,dt:[],texts:['a','b']}])])
  assert.throws(()=>createAttemptObservation().push({type:'text-delta',index:NaN,text:'bad'}))
 }
})
test('application compact producer keeps delta boundaries, identities and detached snapshots',()=>{
 const input=[
  {time:5,chunk:{type:'reasoning-delta',index:3,text:'why'}},
  {time:3,chunk:{type:'reasoning-delta',index:3,text:' now'}},
  {time:4,chunk:{type:'tool-call-delta',index:2,id:'call',name:'read',argumentsDelta:'{"path":'}},
  {time:4,chunk:{type:'tool-call-delta',index:2,id:'call',name:'read',argumentsDelta:'"a"}'}},
  {time:7,chunk:{type:'tool-call-delta',index:2,id:'call',argumentsDelta:''}},
  {time:8,chunk:{type:'tool-call-delta',index:2,id:'',name:'',argumentsDelta:'diagnostic'}},
  {time:Number.MAX_SAFE_INTEGER,chunk:{type:'text-delta',index:0,text:'a'}},
  {time:-Number.MAX_SAFE_INTEGER,chunk:{type:'text-delta',index:0,text:'b'}},
 ]
 const audit=createAssistantAudit()
 for(const value of input)audit.append(value.time,Object.freeze(value.chunk))
 const prior=audit.snapshot()
 assert.deepEqual(native.expandAssistantStream(prior),input)
 assert.equal(prior.length,6);assert.deepEqual(prior[0].dt,[-2]);assert.deepEqual(prior[1].args,['{"path":','"a"}'])
 audit.append(-Number.MAX_SAFE_INTEGER,Object.freeze({type:'text-delta',index:0,text:'c'}))
 assert.deepEqual(native.expandAssistantStream(prior),input)
 assert.ok(Object.isFrozen(prior[1].args));assert.ok(Object.isFrozen(prior[0].dt))
})
test('compact application writer keeps the existing linear packed audit storage bound',()=>{
 const audit=createAssistantAudit()
 for(let i=0;i<10000;i++)audit.append(1700000000000+i,Object.freeze({type:'text-delta',index:0,text:'x'}))
 const packed=audit.snapshot()
 assert.equal(packed.length,1);assert.equal(packed[0].texts.length,10000)
 assert.equal(Buffer.byteLength(JSON.stringify(packed)),60071)
 assert.equal(native.expandAssistantStream(packed).length,10000)
})
