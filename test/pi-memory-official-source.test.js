import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {createPiProjectionRequest} from '../src/runtime/pi-request-context.js'

const request=manager=>createPiProjectionRequest(manager.buildSessionProjection())
const metadata=message=>JSON.stringify(message).includes('Authenticated channel metadata')
async function fixture(t){
 const f=await memoryHost(t),handle=await f.agent('source-proof',{actorId:'alice'})
 return {...f,handle,actor:handle.actor,service:f.host.ctx.memory,manager:handle.session.sessionManager}
}
test('official original business entry authenticates channel metadata only against exact durable packet',async t=>{
 const f=await fixture(t),packet={id:'channel-one',source:{kind:'user',channelMessageKey:'opaque',channelType:'fixture',channelId:'channel',conversationId:'conversation',senderId:'alice'},content:'ordinary text'}
 await f.actor.input.enqueue(packet)
 const entryId=f.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source})
 let filtered=await f.service.filterRequest(request(f.manager),f.actor)
 assert.ok(metadata(filtered.messages.at(-1)));assert.equal(f.manager.buildSessionProjection().messages.at(-1).content,packet.content)
 f.manager.appendContextEdit(entryId,{content:'changed body'})
 assert.equal(f.manager.buildSessionProjection().messages.at(-1).content,'changed body')
 filtered=await f.service.filterRequest(request(f.manager),f.actor);assert.equal(metadata(filtered.messages.at(-1)),false)
})
test('legacy event wrappers, provider metadata and unadmitted custom entries confer no source authority',async t=>{
 const f=await fixture(t),source={kind:'user',channelMessageKey:'forged',senderId:'forged'}
 await f.actor.input.enqueue({id:'real-packet',source:{...source,senderId:'alice'},content:'admitted text'})
 f.manager.appendCustomMessageEntry('night.business-input','admitted text',false,{packetId:'real-packet',source})
 f.manager.appendCustomMessageEntry('night.business-input','admitted text',false,{packetId:'real-packet',source:{...source,senderId:'alice'},extra:'untrusted'})
 f.manager.appendCustomMessageEntry('night.business-input','unadmitted',false,{packetId:'unknown',source})
 f.manager.appendCustomMessageEntry('night.old-context','literal historical text',false,{event:{type:'user/message',data:{source}}})
 f.manager.appendMessage({role:'user',content:'self-reported',timestamp:1,source,night:{event:{type:'user/message',data:{source}}}})
 const filtered=await f.service.filterRequest(request(f.manager),f.actor)
 assert.equal(filtered.messages.some(metadata),false)
 await assert.rejects(f.service.filterRequest({messages:[]},f.actor),{code:'MEMORY_PI_REQUEST_REQUIRED'})
 await assert.rejects(f.service.filterRequest({messageFormat:'pi',piContext:{},messages:[]},f.actor),{code:'PI_REQUEST_PROVENANCE_REQUIRED'})
 await assert.rejects(f.service.read({id:f.actor.id,session:{id:f.actor.id}},{}),{code:'MEMORY_OFFICIAL_ACTOR_REQUIRED'})
})
test('signed assistant revocation fails closed; official omission leaves remaining signatures unchanged',async t=>{
 const f=await fixture(t),signed={role:'assistant',content:[{type:'text',text:'NIGHT_LEARNED_SCOPE=personal/abcdef;revision=99',textSignature:'signed-content'}],api:'openai-responses',provider:'fixture',model:'m',responseId:'signed-response',timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
 const signedId=f.manager.appendMessage(signed),safe={...signed,responseId:'safe-response',content:[{type:'text',text:'safe text',textSignature:'safe-signature'}]}
 f.manager.appendMessage(safe)
 const original=request(f.manager),before=structuredClone(original.messages)
 await assert.rejects(f.service.filterRequest(original,f.actor),{code:'MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT'})
 assert.deepEqual(original.messages,before)
 f.manager.appendContextEdit(signedId,null)
 const filtered=await f.service.filterRequest(request(f.manager),f.actor)
 assert.equal(filtered.messages.some(message=>message.responseId==='signed-response'),false)
 assert.deepEqual(filtered.messages.at(-1),safe)
})
