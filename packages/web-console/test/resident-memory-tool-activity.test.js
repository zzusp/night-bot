import {test} from 'node:test'
import assert from 'node:assert/strict'
import {residentMemoryToolInput as input,residentMemoryToolOutput as output} from '../server/resident-memory-tool-activity.js'

const identity = {sessionId:'ROUTER_PRIVATE',conversationId:'CHAT_PRIVATE',generation:2}
const secret = 'SECRET_PRIVATE_TOKEN_AND_MEMORY_BODY'
const checks = {
  resident_memory_remember: [{topic:'standing-instructions',key:secret,instruction:{text:secret},sourceQuote:secret,expectedRevision:0}, {operation:'remember',scope:'standing-instructions',expectedRevision:0}],
  resident_memory_forget: [{topic:'experience',key:secret,sourceQuote:secret,expectedRevision:3}, {operation:'forget',scope:'memory',expectedRevision:3}],
  resident_memory_reconcile: [{topic:'experience',key:secret,decision:'update',reason:secret,content:{summary:secret},expectedRevision:7}, {operation:'update',scope:'memory',expectedRevision:7}],
  resident_memory_review: [{topic:secret,key:secret,sourceId:secret}, {operation:'review',scope:'entry'}],
  resident_skill_query: [{key:secret}, {operation:'query',scope:'entry'}],
  resident_skill_mutate: [{key:secret,newKey:secret,action:'upsert',body:secret,expectedRevision:0}, {operation:'upsert',expectedRevision:0}],
}
function checkProjection(value,name,expected) {
  assert.equal(value.toolName,name)
  assert.equal(value.redacted,true)
  assert.deepEqual(JSON.parse(value.text),expected)
  assert.doesNotMatch(JSON.stringify(value),/SECRET_PRIVATE|ROUTER_PRIVATE|CHAT_PRIVATE/)
}
test('collects only typed inputs in an authenticated Router identity for all six tools',()=>{
  for(const [name,[args,expected]] of Object.entries(checks)) {
    checkProjection(input(name,args,identity),name,expected)
    for(const unauth of [{},{...identity,taskId:'other'},{...identity,generation:0},{...identity,conversationId:''}]) {
      assert.equal(input(name,args,unauth),null)
      assert.equal(output(name,{ok:true,persisted:true,entry:{body:secret}},unauth),null)
    }
  }
})
test('count-only reviews and skill queries do not reveal authorized-at-the-time stored contents',()=>{
  for(const [stage,scope] of [['root-index','index'],['filtered-index','topic'],[undefined,'entry']]) {
    const name='resident_memory_review'
    const memory={kind:'night-memory-result',stage,revision:100,entries:[{title:secret,text:secret,key:secret}],markdown:secret}
    checkProjection(output(name,{ok:true,memory,completion:{result:secret},sourceRefs:[{quote:secret}]},identity),name,{operation:'review',ok:true,scope,recordCount:1,revision:100})
  }
  const name='resident_skill_query'
  checkProjection(output(name,{revision:2,entries:[{active:true,body:secret,key:secret},{active:false,steps:[secret]}]},identity),name,{operation:'query',recordCount:2,activeCount:1,revision:2})
  assert.equal(output(name,{entries:[{active:secret}]},identity),null)
})
test('writes distinguish retained, persisted, duplicate and unconfirmed effects',()=>{
  for(const [name,operation] of [['resident_memory_remember','remember'],['resident_memory_forget','forget']]) {
    checkProjection(output(name,{ok:true,persisted:true,revision:8,entry:{text:secret}},identity),name,{operation,ok:true,persisted:true,revision:8})
  }
  const keep='resident_memory_reconcile',mutate='resident_skill_mutate'
  checkProjection(output(keep,{ok:true,persisted:false,decision:'keep',revision:8},identity),keep,{operation:'keep',ok:true,persisted:false,revision:8})
  assert.equal(output(keep,{ok:true,persisted:true,decision:'keep'},identity),null)
  assert.equal(output(keep,{ok:true,persisted:false,decision:'delete'},identity),null)
  checkProjection(output(keep,{ok:false,committed:true,code:secret,decision:'update',entry:{text:secret}},identity),keep,{ok:false,committed:true})
  checkProjection(output(mutate,{ok:true,persisted:true,action:'upsert',active:false,duplicate:true,revision:3,currentRevision:4,generation:{guidance:secret},key:secret},identity),mutate,
    {operation:'upsert',ok:true,persisted:true,duplicate:true,revision:3,currentRevision:4,active:false})
})
