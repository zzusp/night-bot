import test from 'node:test'
import assert from 'node:assert/strict'
import {memoryHost} from './fixtures/memory-host.js'
const message=(type,conversationId,senderId,messageId,text)=>({type,channelId:'adapter-fixture',conversationId,senderId,messageId,text})
test('chat and chat-room preserve sender identity, isolate context/memory and deduplicate across cold restart',async t=>{
  const f=await memoryHost(t),api=f.host.ctx.channels
  const personal=await api.receive(message('chat','dm','alice','1','记住 facts/private：ALICE_PRIVATE'))
  const room=await api.receive(message('chat-room','room-one','alice','1','记住 本群 facts/shared：ROOM_ONE_ONLY'))
  const bob=await api.receive(message('chat-room','room-one','bob','2','read the group context'))
  assert.equal(room.sessionId,bob.sessionId);assert.notEqual(personal.sessionId,room.sessionId)
  const request=JSON.stringify(f.requests.at(-1));assert.match(request,/alice/);assert.match(request,/bob/);assert.doesNotMatch(request,/ALICE_PRIVATE/)
  const roomAgent=f.host.ctx.agents.get(room.sessionId);assert.equal((await f.host.ctx.memory.read(roomAgent,{topic:'facts'})).entries[0].text,'ROOM_ONE_ONLY')
  await assert.rejects(f.host.ctx.memory.read(roomAgent,{scope:'personal',topic:'facts'}),/PERSONAL_IN_GROUP/)
  const separate=await api.receive(message('chat-room','room-two','alice','1','look at this room')),other=await api.receive(message('chat','dm','bob','1','read my memory'))
  for(const id of [separate.sessionId,other.sessionId])assert.equal((await f.host.ctx.memory.read(f.host.ctx.agents.get(id),{topic:'facts'})).entries.length,0)
  const before=f.requests.length;assert.equal((await api.receive(message('chat-room','room-one','alice','1','记住 本群 facts/shared：ROOM_ONE_ONLY'))).duplicate,true);assert.equal(f.requests.length,before)
  await assert.rejects(api.receive(message('chat-room','room-one','mallory','1','changed')),/MESSAGE_ID_CONFLICT/)
  assert.throws(()=>api.identity({...message('chat','x','a','x','hi'),type:'unsupported'}))
  await f.close();await f.boot();assert.equal((await f.host.ctx.channels.receive(message('chat-room','room-one','bob','2','read the group context'))).duplicate,true)
})
