import test from 'node:test'
import assert from 'node:assert/strict'
import {localSubagentProvider} from '../src/native-subagent-providers.js'
for(const name of ['spawn','fork'])test('Pi '+name+' provider keeps a completed parent boundary without borrowing an active turn',async()=>{
 const actual=localSubagentProvider(name,name==='fork')
 assert.deepEqual(actual.capabilities,{agentOptions:true,outputSchema:true,depthLimit:true,toolFilter:true,persona:true})
 assert.equal(actual.inheritsParentContext,name==='fork')
 const completed=[{seq:0,type:'turn/start'},{seq:1,type:'turn/end'}],inflight={seq:2,type:'turn/start'},tool={seq:3,type:'tool/call'}
 for(const [events,expected] of [[[],{}],[[inflight],{}],[[...completed,inflight,tool],name==='fork'?{seed:completed}:{}]]){
  const before=structuredClone(events),result=await actual.prepareContinuable({parent:{session:{snapshotEvents:()=>events}}})
  assert.deepEqual(result,expected);assert.deepEqual(events,before)
 }
})
test('spawn never reads parent history and fork preserves exact immutable event identities with a detached prefix array',async()=>{assert.deepEqual(await localSubagentProvider('spawn').prepareContinuable({parent:{session:{snapshotEvents(){throw new Error('spawn must not inherit history')}}}}),{});const event=Object.freeze({seq:0,type:'turn/end'}),events=Object.freeze([event,Object.freeze({seq:1,type:'turn/start'})]),result=await localSubagentProvider('fork',true).prepareContinuable({parent:{session:{snapshotEvents:()=>events}}});assert.equal(result.seed[0],event);result.seed.push({seq:1});assert.equal(events.length,2)})
