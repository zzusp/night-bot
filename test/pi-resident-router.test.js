import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'

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

test('conversation task questions default to operator Web intake and explicit requester preserves the original scope/session',{timeout:nativeTestTimeout(60000)},async t=>{
  const packets=[]
  const h=await residentRouterHost(t,body=>{
    const tools=requestTools(body)
    if(tools.includes('channel_triage_submit'))return triageReply(triageInput(body),()=>({needsHandling:false}))
    if(tools.includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：')
      if(body.messages.at(-1)?.role==='tool')return {text:'Pending events settled'}
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'questions:'+input.events.map(event=>event.id).join(',')}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff)return {text:JSON.stringify({currentIntent:'Preserve original question and source references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(!tools.includes('task_result'))return {text:'No additional work'}
    const input=requestText({...body,messages:body.messages.filter(message=>message.role==='user')}).toReversed().map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.task)
    assert.ok(input);packets.push(input)
    const definition=body.tools.find(tool=>tool.function.name==='task_result').function
    assert.deepEqual(definition.parameters.properties.decision.properties.audience.enum,['operator','requester'])
    if(input.task.humanRequests?.some(request=>request.status==='answered'))return {tool:'task_result',args:{decision:{action:'complete',summary:'The original local work continued after the precise answer',evidence:['authorized answer read'],limitations:[]}}}
    const audience=input.task.title.slice('audience-'.length)
    return {tool:'task_result',args:{decision:{action:'blocked',summary:'A precise input is required before continuing',question:'Which exact local verification input should be used?',evidence:['original authenticated objective'],limitations:[],...audience==='default'?{}:{audience}}}}
  })
  for(const audience of ['default','operator','requester']){
    const input=channelMessage('question-'+audience,{senderId:'requester-'+audience,text:'Verify this local-only objective and ask for missing input explicitly.'}),identity=h.host.ctx.channels.identity(input),before=h.sent.length
    await h.receive(input)
    const created=await h.service.createTask({requestId:'question-'+audience,title:'audience-'+audience,objective:input.text,channel:input})
    await h.service.whenIdle()
    let task=await h.query('task.get',{taskId:created.taskId})
    assert.equal(task.drained,true);assert.equal(task.conversationId,identity.sessionId);assert.equal(task.ownerActorId,identity.principal)
    assert.equal(task.humanRequests.length,1)
    const request=task.humanRequests[0]
    assert.equal(request.audience,audience==='requester'?'requester':'operator');assert.equal(request.status,'waiting-reply')
    const web=(await h.service.listAuthorizationRequests()).find(item=>item.taskId===task.taskId&&item.requestId===request.requestId)
    assert.ok(web);assert.equal(web.audience,request.audience)
    const notices=await h.query('notification.list',{taskId:task.taskId})
    if(audience!=='requester'){
      assert.equal(h.sent.length,before,'missing operator transport never redirects a technical question to a business conversation');assert.equal(notices.length,0)
      continue
    }
    await eventually(()=>h.sent.length===before+1&&h.readbacks.length===before+1,'requester question actually sent and read back by local transport',t.signal)
    assert.equal(notices.length,1);assert.equal(notices[0].kind,'question');assert.equal(notices[0].payload.audience,'requester')
    const source=await h.query('source.get',{sourceId:notices[0].payload.sourceId})
    assert.equal(source.actorId,identity.principal);assert.equal(source.messageId,input.messageId);assert.equal(source.groupId,identity.sessionId);assert.equal(notices[0].payload.sourceVersion,source.version)
    assert.equal(h.sent.at(-1).conversationId,input.conversationId);assert.equal(h.sent.at(-1).senderId,input.senderId)
    const args={taskId:task.taskId,humanRequestId:request.requestId,requestId:'precise-local-answer',reply:'Use the original local-only verification input.',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}
    await assert.rejects(h.service.respondHumanRequest({...args,expectedControlRevision:task.controlRevision+1}),{code:'DYNAMIC_HUMAN_REQUEST_STALE'})
    await h.service.respondHumanRequest(args);await h.service.whenIdle()
    const completed=await h.query('task.get',{taskId:task.taskId})
    assert.equal(completed.status,'completed');assert.equal(completed.drained,true);assert.equal(completed.sessionId,task.sessionId);assert.equal(completed.conversationId,task.conversationId);assert.equal(completed.ownerActorId,task.ownerActorId);assert.equal(completed.humanRequests[0].status,'answered')
  }
  assert.equal(packets.filter(input=>input.task.title==='audience-default').length,1);assert.equal(h.errors.length,0)
  t.diagnostic(JSON.stringify({case:'operator-requester-routing',defaultOperatorWebOnly:true,explicitOperatorWebOnly:true,requesterSourcePreserved:true,requesterWebCasResumeSameSession:true,realVendorExecuted:false}))
})
