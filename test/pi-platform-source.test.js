import test from 'node:test'
import assert from 'node:assert/strict'
import {bindPlatformScheduleSource,assertPlatformScheduleSource} from '../src/runtime/pi-platform-source.js'
const denied=actor=>assert.throws(()=>assertPlatformScheduleSource(actor),{code:'PI_PLATFORM_SOURCE_NOT_READY'})
test('reserved platform identities require an exact live guardian, including headers without owner metadata',()=>{
 const historical={id:'session-platform-schedule-original',metadata:{}},marked={id:'another-native-id',metadata:{runtimeOwner:'platform-schedule'}}
 for(const actor of [historical,marked]){
  denied(actor);let ready=false
  const unbind=bindPlatformScheduleSource(actor,{isReady:()=>ready})
  denied(actor);ready=true;assert.doesNotThrow(()=>assertPlatformScheduleSource(actor))
  denied({...actor});unbind();denied(actor)
 }
 assert.doesNotThrow(()=>assertPlatformScheduleSource({id:'ordinary',metadata:{}}))
})
test('guardian callbacks fail closed on errors, non-booleans and async readiness',()=>{
 for(const isReady of [()=>{throw Error('unavailable')},()=>undefined,()=>1,async()=>true,()=>Promise.reject(Error('async failure'))]){
  const actor={id:'session-platform-schedule-callback'};bindPlatformScheduleSource(actor,{isReady});denied(actor)
 }
})
test('actual official factory refuses an unmarked historical platform id before provider dispatch',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js')
 const f=await memoryHost(t),handle=await f.agent('session-platform-schedule-historical',{actorId:'historical-owner'})
 assert.equal(handle.actor.metadata.runtimeOwner,undefined)
 await assert.rejects(f.say(handle.actor,'Do not dispatch without the platform guardian'),{code:'PI_PLATFORM_SOURCE_NOT_READY'})
 assert.equal(f.requests.length,0)
 assert.ok(handle.session.sessionManager.getEntries().some(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'),'official input remains durable context, not source authority')
 const receipts=await handle.actor.receipts.read()
 assert.ok(receipts.some(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'))
})
