import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {definition,officialToolsFixture as fixture} from './fixtures/pi-official-tools.js'

test('official SDK customTools use strict inputs, native isError and structured values with awaited receipts',async t=>{
 let effects=0,release
 const barrier=Promise.withResolvers(),entered=Promise.withResolvers()
 const h=await fixture(t,({ctx,businessAudit})=>{
  ctx.tools.register(definition('typed',async args=>{effects++;return args},{parameters:{type:'object',properties:{n:{type:'number'}},required:['n'],additionalProperties:false}}))
  ctx.tools.register(definition('bad',async()=>{throw new Error('original body failure')}))
  businessAudit.flush=async()=>{if(release){entered.resolve();await barrier.promise}}
 })
 await h.run([{id:'typed-invalid',name:'typed',args:{n:'2'}}]);assert.equal(effects,0)
 assert.equal(h.session.messages.find(message=>message.role==='toolResult'&&message.toolCallId==='typed-invalid').isError,true)
 release=true;const pending=h.run([{id:'typed-valid',name:'typed',args:{n:2}}]);await entered.promise;assert.equal(effects,0);barrier.resolve();await pending
 assert.equal(effects,1);assert.ok(h.receipts.includes('typed-valid'))
 const good=h.results.find(result=>result.toolCallId==='typed-valid');assert.deepEqual(good.result.structuredContent,{n:2});assert.equal(good.result.details.nativeResult.isError,false)
 await h.run([{id:'original-failure',name:'bad'}]);assert.equal(h.results.find(result=>result.toolCallId==='original-failure').isError,true)
 assert.ok(h.manager.getEntries().some(entry=>entry.type==='custom'&&entry.data.callId==='typed-valid'&&entry.data.state==='settled'))
})

test('FIFO business leases bound safe concurrency, serialize exclusive calls, and end through the public finishTurn latch',async t=>{
 let active=0,peak=0,exclusiveOverlap=false,later=0
 const order=[]
 const h=await fixture(t,({ctx})=>{
  ctx.tools.register(definition('safe',async()=>{active++;peak=Math.max(peak,active);order.push('safe-start');await delay(8);active--;order.push('safe-end');return{safe:true}},{isConcurrencySafe:()=>true}))
  ctx.tools.register(definition('exclusive',async()=>{exclusiveOverlap ||= active!==0;active++;order.push('writer');await delay(1);active--;return{exclusive:true}}))
  ctx.tools.register(definition('conclude',async(_args,exec)=>{exec.concludeTurn();return{done:true}}))
  ctx.tools.register(definition('later',async()=>{later++;return{unexpected:true}}))
 })
 await h.run(Array.from({length:4},(_,index)=>({name:'safe',id:'safe-'+index})));assert.equal(peak,2)
 order.length=0;await h.run([{name:'safe',id:'before-a'},{name:'safe',id:'before-b'},{name:'exclusive',id:'writer'},{name:'safe',id:'after'}])
 assert.equal(exclusiveOverlap,false);assert.ok(order.indexOf('writer')>order.indexOf('safe-end'));assert.equal(order.at(-1),'safe-end')
 const count=h.requests.length
 await h.run([{name:'safe',id:'drained-peer'},{name:'conclude',id:'conclude'},{name:'later',id:'unstarted-write'}]);assert.equal(later,0);assert.equal(h.requests.length,count+1)
 assert.equal(h.results.find(result=>result.toolCallId==='conclude').result.terminate,true)
 assert.equal(h.results.find(result=>result.toolCallId==='unstarted-write').isError,true)
 assert.ok(h.receipts.includes('drained-peer'),'the latch does not discard admitted sibling receipts')
 assert.deepEqual(h.adapter.finishTurn(),{action:'end'})
})

test('official abort removes queued leases and retains an active body until its effect receipt drains',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let effects=0,later=0
 const h=await fixture(t,({ctx})=>{
  ctx.tools.register(definition('slow',async()=>{effects++;entered.resolve();await release.promise;return{drained:true}}))
  ctx.tools.register(definition('later',async()=>{later++;return{unexpected:true}}))
 })
 const running=h.run([{name:'slow',id:'active-body'},{name:'later',id:'queued-body'}]);await entered.promise
 let ended=false;const aborted=h.session.abort().then(()=>{ended=true});await delay(10);assert.equal(ended,false);assert.equal(later,0)
 release.resolve();await aborted;await running
 assert.equal(effects,1);assert.equal(later,0);assert.ok(h.receipts.includes('active-body'))
 assert.equal(h.results.find(result=>result.toolCallId==='active-body').isError,true)
 assert.ok(h.manager.getEntries().some(entry=>entry.type==='custom'&&entry.data.callId==='active-body'&&entry.data.state==='unknown'))
 await h.adapter.drain()
})
test('a factory-fenced receipt failure blocks same-batch later effects and ends through finishTurn',async t=>{
 let effects=0,later=0,flushes=0
 const h=await fixture(t,({ctx})=>{
  ctx.tools.register(definition('first',async()=>{effects++;return{written:true}}))
  ctx.tools.register(definition('later',async()=>{later++;return{unexpected:true}}))
 })
 h.businessAudit.flush=async()=>{if(++flushes===2){const error=new Error('business receipt commit uncertain');h.adapter.fence(error);throw error}}
 await h.run([{name:'first',id:'uncertain-first'},{name:'later',id:'must-not-start'}])
 assert.equal(effects,1);assert.equal(later,0);assert.equal(h.requests.length,1)
 assert.equal(h.results.find(result=>result.toolCallId==='uncertain-first').isError,true)
 assert.equal(h.results.find(result=>result.toolCallId==='must-not-start').isError,true)
 assert.equal(h.receipts.includes('uncertain-first'),false)
 assert.deepEqual(h.adapter.finishTurn(),{action:'end'})
})
