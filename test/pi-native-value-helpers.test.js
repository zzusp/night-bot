import test from 'node:test'
import assert from 'node:assert/strict'
import {runInNewContext} from 'node:vm'
import {snapshotJsonValue,isJsonValue,deepFreeze} from '../src/native-values.js'
import {foldConsumedWork} from '../src/native-consumed-work.js'
const event=(type,data)=>({type,data})
const begin=n=>event('turn/start',{turn:n}),step=n=>event('step/start',{turn:n}),end=(n,kind)=>event('turn/end',{turn:n,reason:{kind}}),splice=(outcome,inserted=[])=>event('agent/inbox/spliced',{removedCount:1,outcome,inserted})
test('native consumed-work accounting preserves source cancellation, claim and suffix semantics',()=>{
 for(const reason of ['completed','blocked','aborted','interrupted','error','backend-added'])for(const stepped of [false,true]){
  const events=[begin(1),splice('claimed'),...stepped?[step(1)]:[],end(1,reason),splice('canceled')]
  const actual=foldConsumedWork(events),accounted=stepped||reason!=='completed'
  assert.deepEqual(actual,accounted?{end:events.at(-2),droppedUnrun:true}:{droppedUnrun:true});if(accounted)assert.equal(actual.end,events.at(-2),'accounting borrows the original end event')
 }
 for(const events of [[],[begin(1),end(1,'completed')],[splice('canceled',[{id:'replacement'}])]])assert.deepEqual(foldConsumedWork(events),{droppedUnrun:false})
 assert.deepEqual(foldConsumedWork([splice('canceled')]),{droppedUnrun:true})
 const events=[begin(1),step(1),end(1,'completed'),splice('canceled'),begin(2),step(2),end(2,'completed')]
 assert.deepEqual(foldConsumedWork(events),{end:events.at(-1),droppedUnrun:false});assert.equal(foldConsumedWork(events.slice(4)).end,events.at(-1))
})
test('native JSON snapshots preserve duplicate-realm and lossless rejection contracts',()=>{
 const realm=runInNewContext('({a:[1,2,{b:"realm"}]})'),nullRecord=Object.assign(Object.create(null),{a:'null prototype'})
 for(const [value,expected] of [[null,null],[true,true],['text','text'],[0,0],[realm,{a:[1,2,{b:'realm'}]}],[nullRecord,{a:'null prototype'}]]){assert.equal(isJsonValue(value),true);const copy=snapshotJsonValue(value);assert.deepEqual(copy,expected);if(value&&typeof value==='object')assert.notEqual(copy,value)}
 const cycle={};cycle.self=cycle
 for(const value of [-0,NaN,Infinity,undefined,BigInt(1),new Date(),new Array(2),cycle,{[Symbol('hidden')]:'discarded'},Object.create({inherited:true})]){assert.equal(isJsonValue(value),false);assert.equal(snapshotJsonValue(value),undefined)}
})
test('native snapshots read each property once, detach nested values and preserve literal proto keys',()=>{let reads=0;const input={get data(){reads++;return{nested:[1,2]}}},snapshot=snapshotJsonValue(input);assert.equal(reads,1);assert.deepEqual(snapshot,{data:{nested:[1,2]}});const raw=JSON.parse('{"__proto__":{"polluted":true},"array":[{"n":1}]}'),copy=snapshotJsonValue(raw);raw.array[0].n=2;assert.equal(copy.array[0].n,1);assert.equal(Object.getPrototypeOf(copy),Object.prototype);assert.deepEqual(Object.getOwnPropertyDescriptor(copy,'__proto__').value,{polluted:true});assert.equal(Object.prototype.polluted,undefined)})
test('native immutable graphs retain mutable abort signals and handle cycles without disabling cancellation',()=>{const c=new AbortController(),object={signal:c.signal,child:{value:1}};object.self=object;assert.equal(deepFreeze(object),object);assert.equal(Object.isFrozen(object),true);assert.equal(Object.isFrozen(object.child),true);assert.equal(Object.isFrozen(c.signal),false);let notified=false;c.signal.addEventListener('abort',()=>{notified=true});c.abort('fixture cancel');assert.equal(notified,true);assert.equal(c.signal.reason,'fixture cancel')})
