import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleBusinessInputs,pendingBusinessInputs} from '../src/runtime/pi-business-inputs.js'
import {visibilityFixture,appendVisible} from './fixtures/pi-coordination-visibility.js'

const packet={id:'exact-retry-body',role:'user',source:{kind:'coordinator'},content:[{type:'text',text:'Original authenticated body'}]}

test('official content shapes preserve exact admitted body authority without treating ordinary prompts as business input',async t=>{
 for(const shape of ['system-string-only','system-then-user-string','system-then-user-blocks','pending'])await t.test(shape,async t=>{
  const f=await visibilityFixture(t)
  f.manager.appendMessage({role:'system',content:shape==='system-string-only'?packet.content[0].text:'official system instructions',timestamp:1})
  if(shape==='system-then-user-string')f.manager.appendMessage({role:'user',content:packet.content[0].text,timestamp:2})
  if(shape==='system-then-user-blocks')f.manager.appendMessage({role:'user',content:packet.content,timestamp:2})
  assert.deepEqual(visibleBusinessInputs(f.actor),[],'same text does not confer application admission')
  if(shape==='pending'){
   const {role,...admitted}=packet
   f.packets.set(packet.id,admitted);f.pendingIds.push(packet.id)
   assert.deepEqual(pendingBusinessInputs(f.actor),[admitted])
   assert.deepEqual(visibleBusinessInputs(f.actor),[])
  }else{
   appendVisible(f,packet)
   const visible=visibleBusinessInputs(f.actor)
   assert.equal(visible.length,1);assert.equal(visible[0].packetId,packet.id)
   assert.deepEqual(visible[0].content,packet.content);assert.deepEqual(visible[0].source,packet.source)
  }
 })
})

test('unrelated system strings and malformed content cannot masquerade as an admitted original body',async t=>{
 for(const content of ['unrelated system prompt',null,42,{some:true},[null,{},'text',{type:'image',text:'wrong'},{type:'text',text:42}]])await t.test(JSON.stringify(content),async t=>{
  const f=await visibilityFixture(t)
  f.manager.appendMessage({role:'system',content,timestamp:1})
  assert.deepEqual(visibleBusinessInputs(f.actor),[])
  assert.deepEqual(pendingBusinessInputs(f.actor),[])
  appendVisible(f,packet)
  assert.deepEqual(visibleBusinessInputs(f.actor).map(input=>({packetId:input.packetId,source:input.source,content:input.content})),[{packetId:packet.id,source:packet.source,content:packet.content}])
 })
})
