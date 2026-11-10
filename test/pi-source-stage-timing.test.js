import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createChannelTriage} from '../src/channels/resident-router-business.js'
import {sameRouterPacket} from '../src/channels/router-lifecycle.js'
import {sourceStageTiming} from '../src/channels/source-stage-timing.js'

const source=(id,version=1)=>({sourceId:`source-${id}-v${version}`,messageId:id,version})
const iso=n=>new Date(n).toISOString()
function fixture(extra={}){
  const records=[];let now=1000,listener
  const observed=sourceStageTiming({stage:'triage',sessionId:'session',requestId:'request',groupId:'group',clock:()=>iso(now),recordStage:(ref,stage)=>records.push({ref,stage}),...extra})
  const stop=observed.observe({subscribe:fn=>{listener=fn;return()=>{listener=undefined}}})
  return {observed,records,stop,tick:n=>{now=n},event:type=>listener?.({type})}
}

test('source timing captures immutable exact versions and never backdates appended membership',async()=>{
  const f=fixture(),a=source('a'),b=source('b')
  f.observed.start([a]);a.version=9
  f.tick(2000);f.observed.start([source('a'),b])
  f.tick(3000);await f.observed.finish()
  assert.equal(f.records.length,6)
  const starts=f.records.filter(row=>row.stage.completedAt===null)
  assert.deepEqual(starts.map(row=>[row.ref.sourceId,row.ref.version,row.ref.groupId,row.stage.startedAt]),[['source-a-v1',1,'group',iso(1000)],['source-a-v1',1,'group',iso(2000)],['source-b-v1',1,'group',iso(2000)]])
  for(const start of starts){const end=f.records.find(row=>row.stage.spanId===start.stage.spanId&&row.stage.completedAt);assert.deepEqual(end,{ref:start.ref,stage:{...start.stage,completedAt:start.stage.startedAt===iso(1000)?iso(2000):iso(3000)}})}
  await f.observed.finish();f.observed.start([source('c')]);assert.equal(f.records.length,6);f.stop()
})

test('retry agent_end does not close work, but settled failure has an observed endpoint',async()=>{
  const f=fixture();f.observed.start([source('a')]);f.event('agent_start')
  f.tick(2000);f.event('agent_end');await f.observed.finishIfSettled()
  assert.equal(f.records.length,1);assert.equal(f.records[0].stage.completedAt,null)
  f.tick(3000);f.event('agent_start');f.tick(4000);f.event('agent_settled')
  f.tick(5000);await f.observed.finishIfSettled()
  assert.equal(f.records[1].stage.completedAt,iso(4000));f.stop()
})

test('explicit retries and source revisions cannot collide, and diagnostic errors never escape',async()=>{
  const first=fixture(),retry=fixture({attempt:1}),next=fixture()
  first.observed.start([source('a')]);retry.observed.start([source('a')]);next.observed.start([source('a',2)])
  await Promise.all([first.observed.finish(),retry.observed.finish(),next.observed.finish()])
  assert.equal(new Set([first,retry,next].map(f=>f.records[0].stage.spanId)).size,3)
  assert.equal(retry.records[0].stage.attempt,1)
  const errors=[],broken=fixture({recordStage:()=>{throw Error('diagnostic only')},onError:error=>errors.push(error.message)})
  broken.observed.start([source('a')]);await broken.observed.finish();assert.deepEqual(errors,['diagnostic only','diagnostic only'])
  for(const f of [first,retry,next,broken])f.stop()
})


test('legacy Router packets tolerate only mutable timing and retain their original bytes',()=>{
  const packet=stage=>({id:'packet',source:{kind:'conversation-router',generation:1,eventIds:['event']},content:[{type:'text',text:'Router 请求：'+JSON.stringify({events:[{id:'event',source:{sourceId:'source',messageId:'message',version:1,text:'original',stages:stage}}]})}]})
  const old=packet([{spanId:'old',completedAt:null}]),updated=packet([{spanId:'old',completedAt:iso(3000)},{spanId:'new'}]),before=structuredClone(old)
  assert.ok(sameRouterPacket(old,updated));assert.deepEqual(old,before)
  const without=packet(undefined);assert.ok(sameRouterPacket(old,without))
  for(const [key,value]of [['text','changed'],['version',2],['sourceId','foreign'],['messageId','foreign']]){
    const changed=structuredClone(updated),body=JSON.parse(changed.content[0].text.slice('Router 请求：'.length));body.events[0].source[key]=value;changed.content[0].text='Router 请求：'+JSON.stringify(body)
    assert.equal(sameRouterPacket(old,changed),false,key+' remains part of business identity')
  }
  const generation=structuredClone(updated);generation.source.generation=2;assert.equal(sameRouterPacket(old,generation),false)
})

test('an unjoined operation stays open; a later run start clears a prior settled marker',async()=>{
  const f=fixture();f.observed.start([source('a')]);await f.observed.finishIfSettled();assert.equal(f.records.length,1)
  f.tick(2000);f.event('agent_settled');f.tick(3000);f.event('agent_start');await f.observed.finishIfSettled();assert.equal(f.records.length,1)
  f.stop()
})


for(const disposalFails of [false,true])test(`triage failure ${disposalFails?'without a confirmed disposal stays open':'with a successful disposal closes its observed work'}`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'source-stage-timing-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const records=[],deliveryError=Error('delivery failed'),disposeError=Error('dispose failed')
  const handle={session:{subscribe:()=>()=>{}},enqueue:async()=>{},deliver:async()=>{throw deliveryError},whenIdle:async()=>{},dispose:async()=>{if(disposalFails)throw disposeError}}
  const triage=createChannelTriage({root,ctx:{get:()=>({create:async()=>handle})},legacy:{getAgentConfig:()=>({agentPreset:'test'})},models:{},responsibilityFor:()=>'',commit:async()=>{},recordStage:(ref,stage)=>records.push({ref,stage})})
  await assert.rejects(triage.run('group',[source('a')]),error=>error===(disposalFails?disposeError:deliveryError))
  assert.equal(records.length,disposalFails?1:2);assert.equal(records[0].stage.completedAt,null)
  if(!disposalFails)assert.ok(records[1].stage.completedAt)
})


test('late append invalidates a preceding settled proof instead of ending its new cohort in the past',async()=>{
  const f=fixture();f.observed.start([source('a')]);f.tick(2000);f.event('agent_settled')
  f.tick(3000);f.observed.start([source('b')]);await f.observed.finishIfSettled()
  const appended=f.records.filter(row=>row.ref.sourceId==='source-b-v1')
  assert.equal(appended.length,1);assert.equal(appended[0].stage.startedAt,iso(3000));assert.equal(appended[0].stage.completedAt,null)
  f.tick(4000);f.event('agent_settled');await f.observed.finishIfSettled()
  assert.equal(f.records.find(row=>row.ref.sourceId==='source-b-v1'&&row.stage.completedAt)?.stage.completedAt,iso(4000));f.stop()
})
