import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'

const triageInput = body => requestEnvelope(body,'一级分诊请求：')
const triageReply = (input,select) => ({tool:'channel_triage_submit',args:{dispositions:input.messages.map(message=>({
  sourceId:message.sourceId,messageVersion:message.version??message.messageVersion,
  ...select(message),reason:'Disposition based on the original message and attached quick context',
}))}})

// These tests enter through Channels.receive with the real task service attached.
// A successful generic Channels actor response cannot satisfy these assertions.
test('default first tier keeps silent and reply-only messages out of Router and task execution',{timeout:nativeTestTimeout(30000)},async t=>{
  const batches=[],toolSets=[]
  const h=await residentRouterHost(t,body=>{
    const input=triageInput(body)
    if(!requestTools(body).includes('channel_triage_submit'))return {text:'Unexpected business model turn'}
    batches.push(input)
    toolSets.push(requestTools(body))
    return triageReply(input,message=>({needsHandling:false,...message.text==='你好'?{reply:'你好。'}:{}}))
  })
  const quiet=channelMessage('quiet',{text:'No action and no reply are needed'}),hello=channelMessage('hello',{text:'你好'})
  await h.receive(quiet);await h.receive(hello)
  await eventually(()=>h.sent.length===1,'one greeting reply',t.signal)
  await h.service.whenIdle()
  assert.ok(batches.length>0,'default attached ingress must run the first-tier model')
  for(const tools of toolSets)assert.deepEqual(tools,['channel_triage_submit'],'quick triage has no task, filesystem or deep-query tools')
  assert.deepEqual(h.sent.map(envelope=>({text:envelope.text,replyToMessageId:envelope.replyToMessageId})),[{text:'你好。',replyToMessageId:'hello'}])
  assert.equal((await h.query('task.list')).length,0)
  assert.ok(h.requests.every(body=>!requestTools(body).some(name=>name.startsWith('resident_'))),'no Router model turn for silent/reply-only input')
  const sources=await h.query('source.list')
  for(const input of [quiet,hello])assert.ok(sources.some(source=>source.messageId===input.messageId&&source.text===input.text),'source remains queryable without Router context')
  const calls=h.requests.length,sends=h.sent.length
  await h.receive(quiet);await h.receive(hello);await h.service.whenIdle()
  assert.equal(h.requests.length,calls);assert.equal(h.sent.length,sends,'same source version cannot repeat a reply')
})

test('incomplete first-tier result remains pending instead of becoming a silent completed disposition',{timeout:nativeTestTimeout(30000)},async t=>{
  let submissions=0
  const h=await residentRouterHost(t,body=>{
    if(!requestTools(body).includes('channel_triage_submit'))return {text:'No business action'}
    if(submissions++===0)return {tool:'channel_triage_submit',args:{dispositions:[]}}
    return {text:'No valid decision was submitted'}
  })
  const input=channelMessage('incomplete',{text:'A message requiring further understanding'})
  await h.receive(input)
  await eventually(()=>h.requests.some(body=>body.messages.some(message=>message.role==='tool')),'official schema rejection returned to the model',t.signal)
  const rejection=h.requests.flatMap(body=>body.messages).find(message=>message.role==='tool')
  assert.match(JSON.stringify(rejection),/dispositions|minItems|Too small|Invalid|validation/i)
  await h.service.whenIdle()
  const source=(await h.query('source.list')).find(source=>source.messageId===input.messageId)
  assert.ok(source);assert.notEqual(source.routed,true,'failed triage cannot consume the source')
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
})

test('default ingress shares room arrangements without merging private senders or channel namespaces',{timeout:nativeTestTimeout(30000)},async t=>{
  const h=await residentRouterHost(t,body=>{
    const input=triageInput(body)
    return input?triageReply(input,()=>({needsHandling:false})):{text:'Unexpected model request'}
  })
  const alice=channelMessage('same',{text:'ROOM_ALICE'}),bob=channelMessage('second',{senderId:'bob',text:'ROOM_BOB'})
  const privateAlice=channelMessage('same',{type:'chat',text:'PRIVATE_ALICE'}),privateBob=channelMessage('same',{type:'chat',senderId:'bob',text:'PRIVATE_BOB'})
  const otherChannel=channelMessage('same',{channelId:'other-channel',text:'OTHER_CHANNEL'}),otherRoom=channelMessage('same',{conversationId:'other-room',text:'OTHER_ROOM'})
  const identity=input=>h.host.ctx.channels.identity(input).sessionId
  assert.equal(identity(alice),identity(bob))
  assert.equal(new Set([identity(alice),identity(privateAlice),identity(privateBob),identity(otherChannel),identity(otherRoom)]).size,5)
  for(const input of [alice,bob,privateAlice,privateBob,otherChannel,otherRoom])await h.receive(input)
  await h.service.whenIdle()
  const sources=await h.query('source.list')
  for(const input of [alice,bob,privateAlice,privateBob,otherChannel,otherRoom])
    assert.ok(sources.some(source=>source.text===input.text),'authenticated original survives namespace isolation')
  const sameRoom=sources.filter(source=>[alice.text,bob.text].includes(source.text))
  assert.equal(sameRoom.length,2);assert.notEqual(sameRoom[0].actorId,sameRoom[1].actorId)
  assert.equal(new Set(sameRoom.map(source=>source.groupId)).size,1)
  for(const body of h.requests){const input=triageInput(body);if(!input)continue
    const originalTexts=input.messages.map(message=>message.text)
    const privateMarkers=['PRIVATE_ALICE','PRIVATE_BOB','OTHER_CHANNEL','OTHER_ROOM'].filter(marker=>originalTexts.includes(marker))
    if(privateMarkers.length){assert.equal(privateMarkers.length,1);assert.equal(input.messages.length,1,'isolated conversations cannot share a triage batch')}
  }
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
})
