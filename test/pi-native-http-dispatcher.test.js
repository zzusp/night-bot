import test from 'node:test'
import assert from 'node:assert/strict'
import {installHttpDispatcher} from '../src/runtime/http-dispatcher.js'

test('dispatcher construction failure leaves routing unpublished',async()=>{
 let published=false
 const failure=new Error('construction failure')
 await assert.rejects(installHttpDispatcher({create:async()=>{throw failure},publish(){published=true}}),e=>e===failure)
 assert.equal(published,false)
})

test('dispatcher publication failure closes the constructed dispatcher and preserves the cause',async()=>{
 let closed=0
 const failure=new Error('publication failure')
 await assert.rejects(installHttpDispatcher({create:()=>({async close(){closed++;throw new Error('cleanup failure')}}),publish(){throw failure}}),e=>e===failure)
 assert.equal(closed,1)
})

test('dispatcher release restores synchronously once and shares one drain promise',async()=>{
 const drained=Promise.withResolvers(),entered=Promise.withResolvers();let restored=0,closed=0,release,reentrant
 release=await installHttpDispatcher({create:()=>({async close(){closed++;entered.resolve();await drained.promise}}),publish:()=>()=>{restored++;reentrant=release()}})
 // Restore may reenter release before this outer call can assign its return value.
 const first=release()
 assert.equal(reentrant,first)
 assert.equal(restored,1)
 assert.equal(first,release())
 await entered.promise
 assert.equal(closed,1)
 drained.resolve()
 await first
 assert.equal(first,release())
 assert.equal(restored,1)
})

test('dispatcher release still drains when restoration fails and preserves that failure',async()=>{
 let closed=0
 const failure=new Error('restore failure')
 const release=await installHttpDispatcher({create:()=>({async close(){closed++;throw new Error('drain failure')}}),publish:()=>()=>{throw failure}})
 const first=release()
 assert.equal(first,release())
 await assert.rejects(first,e=>e===failure)
 assert.equal(closed,1)
})
