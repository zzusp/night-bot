import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {pendingBusinessInputs} from '../src/runtime/pi-business-inputs.js'
const packet={id:'exact-topic-source-v1',source:{kind:'user'},content:[{type:'text',text:'Original authenticated Topic request, version 1.'}]}
async function reopen(f,id){return f.host.ctx.agents.resume({sessionId:id,authorizeInput:p=>p.source.kind==='user'})}
async function stored(f,id){return f.host.ctx.sessionPersistence.readNative(id,{requireComplete:true})}
const inputs=s=>s.entries.filter(e=>e.type==='custom_message'&&e.customType==='night.business-input')

test('official durable input stays pending across cold Host reopen and exact duplicate cannot change source or body',async t=>{
 const f=await memoryHost(t),h=await f.agent('topic-pending');await h.enqueue(packet)
 assert.equal(h.actor.session,undefined);assert.equal(h.actor.inbox,undefined)
 assert.deepEqual(pendingBusinessInputs(h.actor),[packet])
 await h.dispose();await f.close();await f.boot();const next=await reopen(f,'topic-pending')
 assert.deepEqual(pendingBusinessInputs(next.actor),[packet])
 assert.equal((await next.enqueue(packet)).duplicate,true)
 await assert.rejects(next.enqueue({...packet,content:'changed'}),{code:'PI_BUSINESS_ADMISSION_ID_CONFLICT'})
 assert.equal((await stored(f,next.actor.id)).audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').length,1)
 assert.equal(inputs(await stored(f,next.actor.id)).length,0);assert.equal(f.requests.length,0)
 await next.dispose()
})

test('a committed official SDK input repairs a missing acknowledgment without redelivery or inference after cold reopen',async t=>{
 const f=await memoryHost(t),h=await f.agent('topic-ack-gap');await h.enqueue(packet)
 await h.actor.piSession.sendCustomMessage({customType:'night.business-input',content:packet.content,display:false,details:{packetId:packet.id,source:packet.source}},{triggerTurn:false})
 await h.dispose();await f.close();await f.boot();const next=await reopen(f,'topic-ack-gap')
 await next.deliver(packet.id)
 assert.deepEqual(pendingBusinessInputs(next.actor),[])
 const saved=await stored(f,next.actor.id);assert.equal(inputs(saved).length,1)
 assert.deepEqual(inputs(saved)[0].content,packet.content)
 assert.equal(saved.audit.filter(r=>r.domain==='admission'&&r.kind==='admitted').length,1)
 await next.deliver(packet.id);assert.equal(f.requests.length,0)
 assert.equal(inputs(await stored(f,next.actor.id)).length,1);await next.dispose()
})

test('cancelling an unadmitted packet preserves its source history but cannot authorize requeue or consumption',async t=>{
 const f=await memoryHost(t),h=await f.agent('topic-cancel');await h.enqueue(packet);await h.cancel();await h.dispose()
 await f.close();await f.boot();const next=await reopen(f,'topic-cancel')
 assert.equal(next.actor.admission.status(packet.id),'cancelled');assert.deepEqual(pendingBusinessInputs(next.actor),[])
 assert.equal((await next.enqueue(packet)).duplicate,true)
 await assert.rejects(next.deliver(packet.id),{code:'PI_BUSINESS_INPUT_CANCELLED'})
 const saved=await stored(f,next.actor.id);assert.equal(inputs(saved).length,0)
 assert.equal(saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').length,1)
 assert.equal(f.requests.length,0);await next.dispose()
})

test('an SDK entry with matching packet id but different content cannot become an admission receipt',async t=>{
 const f=await memoryHost(t),h=await f.agent('topic-conflict');await h.enqueue(packet)
 await h.actor.piSession.sendCustomMessage({customType:'night.business-input',content:'Conflicting body',display:false,details:{packetId:packet.id,source:packet.source}},{triggerTurn:false})
 await assert.rejects(h.deliver(packet.id),{code:'PI_BUSINESS_ADMISSION_ENTRY_CONFLICT'})
 assert.equal(h.actor.admission.status(packet.id),'pending')
 assert.equal((await stored(f,h.actor.id)).audit.filter(r=>r.domain==='admission'&&r.kind==='admitted').length,0)
 assert.equal(f.requests.length,0);await h.dispose()
})
