import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as wait} from 'node:timers/promises'
import * as clocks from '../src/runtime/deadlines.js'
test('owned clocks expire with exact classification while foreign reason objects cannot impersonate them',async()=>{
 const clock=clocks.deadline(undefined,10,'OWN_CLOCK');try{await new Promise(resolve=>clock.signal.addEventListener('abort',resolve,{once:true}));const reason=clocks.timeoutOf(clock.signal,'OWN_CLOCK');assert.ok(reason);assert.equal(reason.timeoutMs,10);assert.equal(reason.name,'TimeoutReason');assert.equal(clocks.timeoutOf(clock.signal,'OTHER'),undefined);assert.equal(clocks.timeoutOf({reason:{name:'TimeoutReason',code:'OWN_CLOCK',timeoutMs:10}}),undefined);assert.equal(clocks.timeoutOf({reason:new reason.constructor('OWN_CLOCK',10)}),undefined)}finally{clock[Symbol.dispose]()}
 assert.equal('TimeoutReason' in clocks,false);assert.equal('idleWatchdog' in clocks,false)
})
test('disposing an armed clock does not abort its public or caller signal after the original deadline',async()=>{
 const upstream=new AbortController(),clock=clocks.deadline(upstream.signal,10,'OWN_CLOCK');clock[Symbol.dispose]();clock[Symbol.dispose]();await wait(30);assert.equal(clock.signal.aborted,false);assert.equal(upstream.signal.aborted,false)
 const reason=Error('caller');upstream.abort(reason);assert.equal(clock.signal.reason,reason);assert.equal(clocks.timeoutOf(clock.signal),undefined)
})
test('nested clocks distinguish capability codes and cancellation preserves the exact upstream reason',async()=>{
 const outer=clocks.deadline(undefined,10,'OUTER'),inner=clocks.deadline(outer.signal,500,'INNER');try{await new Promise(resolve=>inner.signal.addEventListener('abort',resolve,{once:true}));assert.equal(inner.signal.reason,outer.signal.reason);assert.equal(clocks.timeoutOf(inner.signal,'INNER'),undefined);assert.equal(clocks.timeoutOf(inner.signal,'OUTER').code,'OUTER')}finally{inner[Symbol.dispose]();outer[Symbol.dispose]()}
})
test('internal no-clock sentinel, Node timer bounds and public hint clamping stay explicit',()=>{
 for(const value of [0,-1]){const clock=clocks.deadline(undefined,value,'DISABLED');assert.equal(clock.signal.aborted,false);clock[Symbol.dispose]()}
 for(const value of [NaN,Infinity,clocks.MAX_TIMER_DELAY_MS+1])assert.throws(()=>clocks.deadline(undefined,value,'INVALID'),/positive finite/)
 for(const value of [0,-1,NaN,Infinity])assert.throws(()=>clocks.clampTimeout(value,10,20),/positive finite/)
 assert.equal(clocks.clampTimeout(undefined,10,20),10);assert.equal(clocks.clampTimeout(50,10,20),20);assert.equal(clocks.clampTimeout(1.5,10,20),1.5)
})
