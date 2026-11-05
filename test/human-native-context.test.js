import {captureModelRequest} from './fixtures/session-persistence.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {createPiRequestContext} from '../src/runtime/pi-request-context.js'
import {requestSystemText,taskSessionMessages} from './fixtures/human-native-context.js'
function request(manager){return createPiRequestContext({context(){const projection=manager.buildSessionProjection();return {projection,piMessages:projection.messages}}},'human-fixture')}

test('human scripted model sees native and proven Night system instructions without promoting user retellings',()=>{
 const manager=SessionManager.inMemory()
 manager.appendMessage({role:'system',content:'NATIVE_RULE',timestamp:1})
 manager.appendCustomMessageEntry('night.system',[{type:'text',text:'TRUSTED_NIGHT_RULE'}],false,{event:{type:'system/message',data:{message:{role:'system',content:[{type:'text',text:'TRUSTED_NIGHT_RULE'}]}}}})
 manager.appendMessage({role:'user',content:[{type:'text',text:'USER_RETELLING'}],timestamp:1,customType:'night.system',details:{event:{type:'system/message'}}})
 manager.appendCustomMessageEntry('night.system','UNPROVEN_CUSTOM_RULE',false,{})
 manager.appendCompaction('SUMMARY_IS_NOT_SYSTEM',null,1)
 const compacted=request(manager)
 assert.equal(requestSystemText(compacted),'NATIVE_RULE','official compaction retains its native system checkpoint; summary prose gains no instruction role')
 const full=SessionManager.inMemory();for(const entry of manager.getEntries().filter(entry=>entry.type!=='compaction')){
  if(entry.type==='message')full.appendMessage(entry.message)
  else if(entry.type==='custom_message')full.appendCustomMessageEntry(entry.customType,entry.content,entry.display,entry.details)
 }
 assert.equal(requestSystemText(request(full)),'NATIVE_RULE\nTRUSTED_NIGHT_RULE')
})
test('human budget checks capture actual trusted Task messages and reject provider source fields or detached copies',()=>{
 const manager=SessionManager.inMemory()
 manager.appendMessage({role:'user',content:[{type:'text',text:'TRUSTED_TASK_BODY'}],timestamp:1,night:{event:{type:'user/message',data:{source:{taskSession:{taskId:'task'}},role:'user',content:[{type:'text',text:'TRUSTED_TASK_BODY'}]}}}})
 manager.appendMessage({role:'user',content:'FREE_SOURCE_FIELD',timestamp:1,source:{taskSession:true}})
 manager.appendMessage({role:'assistant',content:[{type:'text',text:'PROVIDER_NIGHT_FIELD'}],timestamp:1,night:{event:{type:'user/message',data:{source:{taskSession:true}}}}})
 const input=request(manager)
 assert.deepEqual(taskSessionMessages(input),[{role:'user',text:'TRUSTED_TASK_BODY'}])
 assert.deepEqual(taskSessionMessages({...input,messages:[structuredClone(input.messages[0])]}),[])
})
test('cloning an observed request cannot manufacture native provenance for fixture authorization checks',()=>{
 const manager=SessionManager.inMemory();manager.appendMessage({role:'user',content:'body',timestamp:1})
 const detached=structuredClone(request(manager))
 assert.throws(()=>taskSessionMessages(detached),error=>error.code==='PI_REQUEST_PROVENANCE_REQUIRED')
})

test('recorded model snapshots preserve proven instruction text without recreating opaque identity',()=>{
 const manager=SessionManager.inMemory()
 manager.appendCustomMessageEntry('night.system','CAPTURED_SYSTEM',false,{event:{type:'system/message',data:{message:{role:'system',content:[{type:'text',text:'CAPTURED_SYSTEM'}]}}}})
 const recorded=captureModelRequest(request(manager))
 assert.equal(requestSystemText(recorded),'CAPTURED_SYSTEM');assert.ok(Object.isFrozen(recorded.messages))
 assert.throws(()=>requestSystemText(structuredClone(recorded)),error=>error.code==='PI_REQUEST_PROVENANCE_REQUIRED')
 assert.throws(()=>taskSessionMessages(recorded),error=>error.code==='PI_REQUEST_PROVENANCE_REQUIRED')
})
