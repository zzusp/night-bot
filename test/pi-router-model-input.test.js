import test from 'node:test'
import assert from 'node:assert/strict'
import {routerModelEvent,routerModelBody,routerModelBatch} from '../src/channels/router-model-input.js'
import {sameRouterPacket,routerPacketViews} from '../src/channels/router-lifecycle.js'

const row={id:'room',generation:2}
const event=(n=1,text='请分析完整指令，不得省略最后一步。')=>({id:`event-${n}`,kind:'source.message',sourceId:`source-${n}`,messageVersion:3,conversationId:'room',eventId:`source:source-${n}`,state:'pending',createdAt:'2026-01-01',
 source:{id:`source-${n}`,sourceId:`source-${n}`,groupId:'room',messageId:`message-${n}`,version:3,actorId:'actor',senderName:'小明',channel:'chat-room',text,quote:{messageId:'q',senderOpenDingTalkId:'author',content:'不要更改来源内容'},resources:[{id:'attachment',name:'file.txt'}],timestamp:'2026-01-01',routed:true,routeReceipt:{decisionId:'triage-1'},stages:{router:{start:'now'}}},
 triageReply:{id:'reply',notificationId:'reply',kind:'triage-reply',state:'unknown',payload:{outboundId:'reply',sourceMessageId:`message-${n}`,text:'我先核对一下。',sourceRef:{messageId:`message-${n}`,actorId:'actor'}},payloadDigest:'digest',receipt:{opaque:'x'.repeat(4000)},sendPermit:'private-permit',dispatchToken:'private-token',sendAttemptCount:1}})

test('Router model view keeps exact business source, quote and reply state, not ledger internals',()=>{
 const original=event(),frozen=structuredClone(original),view=routerModelEvent(original)
 assert.equal(view.source.text,original.source.text)
 assert.equal(view.source.sourceId,original.sourceId);assert.equal(view.messageVersion,3)
 assert.equal(view.source.actorId,'actor');assert.equal(view.source.senderName,'小明')
 assert.deepEqual(view.source.quote,{messageId:'q',actorId:'author',text:'不要更改来源内容'})
 assert.deepEqual(view.source.resources,original.source.resources)
 assert.deepEqual(view.triageReply,{id:'reply',kind:'triage-reply',state:'unknown',payload:{text:'我先核对一下。'}})
 for(const forbidden of ['dispatchToken','sendPermit','receipt','routeReceipt','stages','notificationId','outboundId'])assert.equal(JSON.stringify(view).includes(`"${forbidden}"`),false)
 assert.deepEqual(original,frozen)
 assert.ok(Buffer.byteLength(JSON.stringify(view))<Buffer.byteLength(JSON.stringify(original))*.3)
})

test('retraction and held source flags and task evidence remain visible',()=>{
 const original=event();Object.assign(original.source,{retracted:true,authorizationRevoked:true,triageHold:true,archiveRestoreHold:true})
 const view=routerModelEvent(original)
 for(const flag of ['retracted','authorizationRevoked','triageHold','archiveRestoreHold'])assert.equal(view.source[flag],true)
 const task={id:'event',kind:'task.completed',taskId:'task',taskEventId:'completion',taskEvent:{evidence:'exact result',unknownEffect:true}}
 assert.deepEqual(routerModelEvent(task),task)
})

test('packing counts model bytes and admits no more than fifteen user sources',()=>{
 const events=Array.from({length:16},(_,i)=>event(i))
 assert.equal(routerModelBatch(row,events).length,15)
 const large=[event(1,'中'.repeat(30000)),event(2,'中'.repeat(30000))]
 assert.equal(routerModelBatch(row,large).length,1)
 assert.ok(Buffer.byteLength(JSON.stringify(routerModelBody(row,large.slice(0,1))))<=131072)
 const huge=event(1,'中'.repeat(50000)+'最后不可丢弃的指令')
 const batch=routerModelBatch(row,[huge,event(2)])
 assert.deepEqual(batch,[huge]);assert.ok(routerModelBody(row,batch).events[0].source.text.endsWith('最后不可丢弃的指令'))
})

test('compact packet comparison tolerates only delivery progress, not business identity edits',()=>{
 const packet={id:'input',source:{kind:'conversation-router',modelViewVersion:1,ledgerIdentity:'bound-ledger',eventIds:['event-1']},content:[{type:'text',text:'Router 请求：'+JSON.stringify(routerModelBody(row,[event()]))}]}
 const changed=structuredClone(packet),body=JSON.parse(changed.content[0].text.slice('Router 请求：'.length))
 body.events[0].triageReply.state='delivered';changed.content[0].text='Router 请求：'+JSON.stringify(body)
 assert.equal(sameRouterPacket(packet,changed),true)
 body.events[0].source.actorId='different';changed.content[0].text='Router 请求：'+JSON.stringify(body)
 assert.equal(sameRouterPacket(packet,changed),false)
 const changedLedger=structuredClone(packet);changedLedger.source.ledgerIdentity='different'
 assert.equal(sameRouterPacket(packet,changedLedger),false)
})


test('ledger binding rejects omitted-field and source-version tampering while delivery progress stays recoverable',()=>{
 const original=event(),packet=routerPacketViews(row,[original])[0]
 assert.equal(packet.source.modelViewVersion,1)
 const progress=structuredClone(original);Object.assign(progress.triageReply,{state:'delivered',receipt:{messageId:'sent'},sendAttemptCount:2});progress.source.stages={router:{start:'later'}}
 assert.equal(sameRouterPacket(packet,routerPacketViews(row,[progress])[0]),true)
 for(const mutate of [e=>e.source.version++,e=>e.source.actorId='other',e=>e.source.routeReceipt.decisionId='forged',e=>e.triageReply.payload.sourceRef.actorId='other',e=>e.source.authorizationRevoked=true]){
  const changed=structuredClone(original);mutate(changed)
  assert.equal(sameRouterPacket(packet,routerPacketViews(row,[changed])[0]),false)
 }
 assert.equal(routerPacketViews(row,[original]).length,3)
})
