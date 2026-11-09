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
  const native=await f.host.ctx.get('sessionPersistence').readNative(room.sessionId,{requireComplete:true})
  assert.equal(native.format,'pi-native-v1');assert.equal('events' in native,false)
  const sources=native.context.projection.entries.filter(row=>row.sourceEntry.type==='custom_message'&&row.sourceEntry.customType==='night.business-input').map(row=>row.sourceEntry.details.source)
  assert.deepEqual(sources.map(source=>source.senderId),['alice','bob'])
  assert.ok(native.audit.some(receipt=>receipt.domain==='channel'&&receipt.kind==='delivery'&&receipt.payload.ok))
  await f.close();await f.boot()
  const coldBefore=f.requests.length,cold=await f.host.ctx.channels.receive(message('chat-room','room-one','bob','2','read the group context'))
  assert.equal(cold.duplicate,true);assert.equal(cold.ok,true);assert.equal(f.requests.length,coldBefore)
})

test('an ordinary channel actor cannot forge another sender, body or conversation through native input',async t=>{
 const f=await memoryHost(t),api=f.host.ctx.channels,input=message('chat-room','authorized-room','alice','one','authorized body')
 const response=await api.receive(input),actor=f.host.ctx.get('agents').get(response.sessionId),packet=actor.admission.current().messages[0]
 const mallory=api.identity({...input,senderId:'mallory'})
 for(const forged of [
  {...packet,source:{...packet.source,senderId:'mallory',principal:mallory.principal}},
  {...packet,content:[{type:'text',text:'changed body'}]},
  {...packet,source:{...packet.source,conversationId:'foreign-room'}},
  {...packet,content:[...packet.content,{type:'text',text:'unregistered extra context'}]},
 ])await assert.rejects(actor.input.enqueue(forged),/ADMISSION_DENIED|MESSAGE_ID_CONFLICT|ID_CONFLICT/)
 assert.equal(f.requests.length,1)
})

test('channel delivery with a durable input but no completion receipt stays uncertain after cold restart without replay',async t=>{
 const f=await memoryHost(t),api=f.host.ctx.channels,first=message('chat','dm','alice','one','first input')
 const response=await api.receive(first),actor=f.host.ctx.get('agents').get(response.sessionId),next=message('chat','dm','alice','two','second input')
 await api.registerConversation(next)
 const {hash}=await import('../src/memory/format.js'),identity=api.identity(next),messageKey=hash(JSON.stringify([next.channelId,next.conversationId,next.messageId,next.messageVersion??1]))
 const source={kind:'user',channelType:next.type,channelId:next.channelId,conversationId:next.conversationId,senderId:next.senderId,channelMessageId:next.messageId,messageVersion:next.messageVersion??1,principal:identity.principal,channelMessageKey:messageKey}
 await actor.input.enqueue({id:'channel:'+messageKey,source,content:[{type:'text',text:next.text}]})
 const requests=f.requests.length;await f.close();await f.boot()
 const result=await f.host.ctx.channels.receive(next)
 assert.equal(result.duplicate,true);assert.equal(result.ok,false);assert.equal(result.code,'CHANNEL_DELIVERY_UNCERTAIN');assert.equal(f.requests.length,requests)
})
