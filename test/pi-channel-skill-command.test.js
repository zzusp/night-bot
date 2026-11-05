import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
import {visibleBusinessInputs} from '../src/runtime/pi-business-inputs.js'
const message=(type,id,text)=>({type,channelId:'skill-command-channel',conversationId:type==='chat'?'direct':'room',senderId:'alice',messageId:id,text})
const definition={name:'channel-command',description:'CHANNEL_COMMAND_SUMMARY',content:'CHANNEL_COMMAND_BODY: skill text is not user authorization',source:'fixture',invocation:{modelInvocable:true,userInvocable:true}}

test('authenticated direct channel command uses official expansion; exact original packet remains sole source across cold recovery',async t=>{
 const f=await memoryHost(t);f.host.ctx.skills.register(definition)
 const input=message('chat','one','/skill:channel-command verify this'),result=await f.host.ctx.channels.receive(input)
 assert.equal(result.ok,true);assert.match(JSON.stringify(f.requests[0]),/CHANNEL_COMMAND_BODY/)
 const actor=f.host.ctx.agents.get(result.sessionId),visible=visibleBusinessInputs(actor)
 assert.equal(visible.length,1);assert.deepEqual(visible[0].content,[{type:'text',text:input.text}]);assert.doesNotMatch(JSON.stringify(visible),/CHANNEL_COMMAND_BODY/)
 const saved=await f.host.ctx.sessionPersistence.readNative(result.sessionId),ack=saved.audit.find(r=>r.domain==='admission'&&r.kind==='command-admitted')
 assert.ok(ack);assert.equal(saved.entries.find(e=>e.id===ack.payload.entryId).message.role,'user')
 for(const content of [[{type:'text',text:input.text+' changed'}],[{type:'text',text:input.text},{type:'image',mimeType:'image/png',data:'AAAA'}]])await assert.rejects(actor.input.enqueue({...actor.admission.lookupPacket(visible[0].packetId),content}),/ADMISSION_DENIED|ID_CONFLICT/)
 await f.close();await f.boot();const before=f.requests.length,cold=await f.host.ctx.channels.receive(input)
 assert.equal(cold.duplicate,true);assert.equal(cold.ok,true);assert.equal(f.requests.length,before)
})

test('chat-room source cannot obtain the direct-user command capability and revoked skill cannot reach provider',async t=>{
 const f=await memoryHost(t),remove=f.host.ctx.skills.register(definition)
 await assert.rejects(f.host.ctx.channels.receive(message('chat-room','room-command','/skill:channel-command verify this')),/PI_SKILL_COMMAND_DENIED/)
 assert.equal(f.requests.length,0)
 const ok=await f.host.ctx.channels.receive(message('chat','first','/skill:channel-command verify this'));assert.equal(ok.ok,true)
 await remove();const before=f.requests.length
 await assert.rejects(f.host.ctx.channels.receive(message('chat','revoked','/skill:channel-command verify this')),/PI_SKILL_COMMAND_DENIED/)
 assert.equal(f.requests.length,before)
})
