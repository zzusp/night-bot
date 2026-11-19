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
    const system=body.messages.filter(message=>message.role==='system').map(message=>message.content).join(String.fromCharCode(10))
    assert.match(system,/沟通规范索引/);assert.match(system,/NIGHT_NATURAL_CHANNEL_REPLY/);assert.doesNotMatch(system,/好，我看看是什么原因/);assert.match(system,/先区分真正受话对象/);assert.match(system,/不承诺代其合并、发布、部署或外部写入/)
    return triageReply(input,message=>({needsHandling:false,...message.text==='你好'?{reply:'你好。'}:{}}))
  })
  const quiet=channelMessage('quiet',{text:'No action and no reply are needed'}),hello=channelMessage('hello',{text:'你好'})
  await h.receive(quiet);await h.receive(hello)
  await eventually(()=>h.sent.length===1,'one greeting reply',t.signal)
  await h.service.whenIdle()
  assert.ok(batches.length>0,'default attached ingress must run the first-tier model')
  for(const tools of toolSets)assert.deepEqual(tools.sort(),['channel_triage_submit','communication_guidance_read'].sort(),'quick triage has no task, filesystem or deep-query tools')
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
  const alice=channelMessage('same',{text:'ROOM_ALICE',senderName:'Alice display',conversationName:'Room display'}),bob=channelMessage('second',{senderId:'bob',text:'ROOM_BOB'})
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
  assert.equal(sources.find(source=>source.text===alice.text).senderName,'Alice display')
  assert.equal(h.service.listObserverGroups().find(group=>group.groupId===identity(alice)).name,'Room display')
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
  const packets=[],reviewed=[]
  const draft='兹请提供具体输入，收到后将开展相关核验工作。',question='Which exact local verification input should be used?'
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
    const answer=input.sources.find(source=>source.channel==='web'&&source.text==='Use the original local-only verification input.')
    if(answer){
      assert.equal(answer.actorId,'owner');assert.ok(answer.sourceId)
      return {tool:'task_result',args:{decision:{action:'complete',summary:'The original local work continued after the precise answer',evidence:['authorized answer read: '+answer.sourceId],limitations:[]}}}
    }
    const audience=input.task.title.slice('audience-'.length)
    const revise=JSON.stringify(body.messages.filter(row=>row.role==='tool')).includes('REPLY_QUALITY_REVISION_REQUIRED')
    assert.match(JSON.stringify(body.messages.filter(row=>row.role==='system')),/NIGHT_NATURAL_CHANNEL_REPLY/)
    return {tool:'task_result',args:{decision:{action:'blocked',summary:'A precise input is required before continuing',question:audience==='requester'&&!revise?draft:question,evidence:['original authenticated objective'],limitations:[],...audience==='default'?{}:{audience}}}}
  },{hostOptions:{replyQuality:async({candidates},body)=>{
    assert.deepEqual(requestTools(body),[]);
    assert.equal(candidates.length,1);
    const [candidate]=candidates;
    assert.equal(candidate.purpose,'task-requester-question');
    assert.equal((await h.query('task.list')).find(task=>task.title==='audience-requester').humanRequests.length,0);
    assert.equal((await h.query('notification.list')).length,0);
    reviewed.push(candidate.text);
    return {text:JSON.stringify({decisions:[{index:0,issues:candidate.text===draft?['bureaucracy']:[]}]})};
  }}})
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
    }else{
      await eventually(()=>h.sent.length===before+1&&h.readbacks.length===before+1,'requester question actually sent and read back by local transport',t.signal)
      assert.deepEqual(reviewed,[draft,question]);assert.equal(request.question,question);
      assert.equal(notices.length,1);assert.equal(notices[0].kind,'question');assert.equal(notices[0].payload.audience,'requester')
      const source=await h.query('source.get',{sourceId:notices[0].payload.sourceId})
      assert.equal(source.actorId,identity.principal);assert.equal(source.messageId,input.messageId);assert.equal(source.groupId,identity.sessionId);assert.equal(notices[0].payload.sourceVersion,source.version)
      assert.equal(h.sent.at(-1).conversationId,input.conversationId);assert.equal(h.sent.at(-1).senderId,input.senderId)
    }
    const args={taskId:task.taskId,humanRequestId:request.requestId,requestId:'precise-local-answer',reply:'Use the original local-only verification input.',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}
    await assert.rejects(h.service.respondHumanRequest({...args,expectedControlRevision:task.controlRevision+1}),{code:'DYNAMIC_HUMAN_REQUEST_STALE'})
    await h.service.respondHumanRequest(args);await h.service.whenIdle()
    const completed=await h.query('task.get',{taskId:task.taskId})
    assert.equal(completed.status,'completed');assert.equal(completed.drained,true);assert.equal(completed.sessionId,task.sessionId);assert.equal(completed.conversationId,task.conversationId);assert.equal(completed.ownerActorId,task.ownerActorId);assert.equal(completed.humanRequests[0].status,'answered')
    const replySource=await h.query('source.get',{sourceId:completed.humanRequests[0].sourceId})
    assert.equal(replySource.actorId,'owner');assert.equal(replySource.groupId,task.groupId)
    const calls=packets.length
    await h.service.respondHumanRequest(args);await h.service.whenIdle()
    assert.equal(packets.length,calls,'repeating the same accepted answer does not restart completed work')
  }
  for(const audience of ['default','operator','requester'])assert.equal(packets.filter(input=>input.task.title==='audience-'+audience).length,audience==='requester'?3:2)
  assert.equal(h.errors.length,0)
  t.diagnostic(JSON.stringify({case:'operator-requester-routing',defaultOperatorWebOnly:true,explicitOperatorWebOnly:true,requesterSourcePreserved:true,requesterWebCasResumeSameSession:true,realVendorExecuted:false}))
})

test('triage sees bounded read-only background and Router can recover a previously ignored source without replay',{timeout:nativeTestTimeout(60000)},async t=>{
 let queried=false,read=false,steps=0,background
 const h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(names.includes('channel_triage_submit')){
   const input=triageInput(body)
   if(input.messages.some(source=>source.messageId==='followup')){
    assert.equal(input.messages.length,1)
    assert.equal(input.background.backgroundOnly,true)
    background=input.background.sources.find(source=>source.messageId==='background')
    assert.ok(background);assert.match(background.text,/VERSION B/)
    assert.ok(!JSON.stringify(input.background).includes('FOREIGN_SECRET'))
   }
   return triageReply(input,source=>({needsHandling:source.messageId==='followup'}))
  }
  const handoff=requestEnvelope(body,'Router 交接请求：')
  if(handoff&&!names.length)return {text:JSON.stringify({currentIntent:'Current request checked against prior same-room background',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(names.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：')
   assert.ok(input.events.every(event=>event.source?.messageId!=='background'),'background does not enter the actionable inbox')
   if(steps++===0)return {tool:'resident_source_query',args:{keyword:'VERSION B',limit:5}}
   if(!queried){
    const value=JSON.parse(body.messages.at(-1).content);assert.equal(value.sources.length,1);assert.equal(value.sources[0].sourceId,background.sourceId);queried=true
    return {tool:'resident_source_get',args:{sourceId:background.sourceId}}
   }
   if(!read){const value=JSON.parse(body.messages.at(-1).content);assert.equal(value.version,background.messageVersion);assert.match(value.text,/VERSION B/);read=true
    return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'history-settle'}}}
   return {text:'Current source assessed using background; no new work is requested.'}
  }
  return {text:'No task work'}
 })
 await h.receive(channelMessage('foreign',{conversationId:'other-room',text:'FOREIGN_SECRET VERSION B'}));await h.service.whenIdle()
 await h.receive(channelMessage('background',{text:'VERSION B is the current file; this is background only.'}));await h.service.whenIdle()
 assert.equal(h.requests.filter(body=>requestTools(body).includes('resident_router_settle')).length,0)
 await h.receive(channelMessage('followup',{text:'Which version did I mention earlier?'}));await h.service.whenIdle()
 assert.equal(queried,true);assert.equal(read,true);assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
 assert.equal((await h.query('router.inbox',{conversationId:(await h.query('source.list')).find(s=>s.messageId==='followup').groupId})).length,0)
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count,'background cannot be replayed after restart')
})

test('optional history read failure does not block first-tier handling',{timeout:nativeTestTimeout(30000)},async t=>{
 let observed=false
 const h=await residentRouterHost(t,body=>{
  const input=triageInput(body);assert.ok(input);assert.equal(input.background.status,'unavailable');assert.deepEqual(input.background.sources,[]);observed=true
  return triageReply(input,()=>({needsHandling:false}))
 },{wrapStore:store=>({...store,query:q=>q.kind==='router.source-history'?Promise.reject(Error('simulated history failure')):store.query(q)})})
 await h.receive(channelMessage('background-failure'));await h.service.whenIdle();assert.equal(observed,true)
 const source=(await h.query('source.list'))[0];assert.equal(source.routed,true)
})

test('Router returns review feedback to its author and freezes only its revised text',{timeout:nativeTestTimeout(30000)},async t=>{
 let step=0;const answer='确认有一条空值误拦路径，但还不能证明是这次失败的根因。', draft='这次 UAT 失败的根因是空值误拦，已经修好了。', reviewed=[];
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body),input=triageInput(body);
  if(tools.includes('channel_triage_submit'))return triageReply(input,()=>({needsHandling:true}));
  if(!tools.includes('resident_router_reply'))return {text:'Settled'};
  const prompt=body.messages.filter(row=>row.role==='system').map(row=>row.content).join('\n');
  assert.match(prompt,/沟通规范索引/);assert.match(prompt,/NIGHT_NATURAL_CHANNEL_REPLY/);assert.doesNotMatch(prompt,/NIGHT_TASK_PUBLIC_COMMUNICATION/);
  if(step===0){step++;return {tool:'communication_guidance_read',args:{}}}
  assert.match(JSON.stringify(body.messages.filter(row=>row.role==='tool')),/本次事件根因分开/);
  const events=requestEnvelope(body,'Router 请求：').events,source=events.find(event=>event.source)?.source;
  const reply=text=>({tool:'resident_router_reply',args:{operationId:'natural-answer',sourceId:source.sourceId,messageVersion:source.version,text}});
  if(step++===1)return reply(draft);
  if(step===3){assert.match(JSON.stringify(body.messages.filter(row=>row.role==='tool')),/REPLY_QUALITY_REVISION_REQUIRED.*按实际证据/);return reply(answer)}
  if(step===4)return {tool:'resident_router_settle',args:{operationId:'natural-settle',eventIds:events.map(event=>event.id),noTaskDispositions:events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'handled-inline',reason:'Answered the current evidence boundary without claiming repair',sourceQuote:event.source.text}))}};
  return {text:'Settled'};
 },{hostOptions:{replyQuality:async({candidates},body)=>{
   assert.deepEqual(requestTools(body),[]);assert.equal(body.messages.length,2);
   assert.equal((await h.query('notification.list')).length,0);
   assert.equal(candidates.length,1);assert.match(candidates[0].sourceText,/本次UAT输入和日志还没核实/);
   const [{index,text}]=candidates;reviewed.push(text);
   return {text:JSON.stringify({decisions:[{index,issues:text===draft?['overclaim']:[]}]})};
 }}});
 const message=channelMessage('natural-scope',{text:'空值误拦路径已核实，但本次UAT输入和日志还没核实。请说明目前能确定什么。'});
 await h.receive(message);await h.service.whenIdle();
 assert.deepEqual(h.sent.map(row=>row.text),[answer]);assert.equal((await h.query('task.list')).length,0);
 const calls=h.requests.length;await h.receive(message);await h.service.whenIdle();assert.equal(h.requests.length,calls);assert.equal(h.sent.length,1);
 assert.deepEqual(reviewed,[draft,answer]);
 const [receipt]=await h.query('notification.list');assert.equal(receipt.state,'delivered');assert.equal(receipt.payload.text,answer);
});

test('Router progress quotes the original source without changing an old frozen plain reply',{timeout:nativeTestTimeout(30000)},async t=>{
 let step=0,oldReply;const reviewed=[]
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit'))return triageReply(triageInput(body),()=>({needsHandling:true}))
  if(!tools.includes('resident_router_reply'))return {text:'No additional work'}
  const events=requestEnvelope(body,'Router 请求：').events,source=events.find(event=>event.source).source
  const args={sourceId:source.sourceId,messageVersion:source.version,recipientActorIds:[source.actorId]}
  switch(step++){
   case 0:return {tool:'resident_router_reply',args:{...args,operationId:'old-progress',text:'已读取材料。'}}
   case 1:
    oldReply=(await h.query('notification.list')).find(row=>row.payload.text==='已读取材料。')
    assert.ok(oldReply);assert.equal(oldReply.payload.sourceMessageId,undefined)
    h.host.ctx.channels.transports.get('resident-fixture').capabilities={quotedReplies:['chat-room']}
    return {tool:'resident_router_reply',args:{...args,operationId:'old-progress',text:'已读取材料。'}}
   case 2:case 3:return {tool:'resident_router_reply',args:{...args,operationId:'new-progress',text:'已完成数据核对。'}}
   case 4:return {tool:'resident_router_settle',args:{operationId:'progress-settle',eventIds:events.map(event=>event.id),noTaskDispositions:events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'handled-inline',reason:'Answered the original progress request',sourceQuote:event.source.text}))}}
   default:return {text:'No additional work'}
  }
 },{hostOptions:{replyQuality:({candidates})=>{reviewed.push(...candidates.map(item=>item.text));return {text:JSON.stringify({decisions:candidates.map(({index})=>({index,issues:[]}))})}}}})
 const original=channelMessage('progress-origin',{text:'请说一下实际核对进度。'})
 await h.receive(original);await h.service.whenIdle()
 assert.deepEqual(reviewed,['已读取材料。','已完成数据核对。']);
 const delivered=await h.query('notification.list')
 assert.equal(delivered.length,2);assert.ok(delivered.every(row=>row.state==='delivered'&&row.sendAttemptCount===1))
 const retained=delivered.find(row=>row.id===oldReply.id)
 assert.deepEqual(retained.payload,oldReply.payload);assert.equal(retained.payloadDigest,oldReply.payloadDigest)
 assert.equal(h.results.filter(row=>row.name==='resident_router_reply'&&!row.result.isError).length,4)
 assert.deepEqual(h.sent.map(row=>[row.text,row.replyToMessageId,row.replyToParticipantId,row.recipientIds]),[
  ['已读取材料。',undefined,undefined,['alice']],['已完成数据核对。',original.messageId,'alice',['alice']],
 ])
})

test('triage always sees the writing rules and reads examples through a bounded native tool',{timeout:nativeTestTimeout(30000)},async t=>{
 let reads=0;
 const h=await residentRouterHost(t,body=>{
  const input=triageInput(body),prompt=JSON.stringify(body.messages.filter(row=>row.role==='system'));
  assert.match(prompt,/沟通规范索引/);assert.match(prompt,/NIGHT_NATURAL_CHANNEL_REPLY/);assert.doesNotMatch(prompt,/好，我看看是什么原因/);
  if(reads++===0)return {tool:'communication_guidance_read',args:{}};
  assert.match(JSON.stringify(body.messages.filter(row=>row.role==='tool')),/NIGHT_NATURAL_CHANNEL_REPLY/);
  return triageReply(input,()=>({needsHandling:false,reply:'你好。'}));
 });
 await h.receive(channelMessage('indexed-greeting',{text:'你好'}));await h.service.whenIdle();
 assert.equal(reads,2);assert.deepEqual(h.sent.map(row=>row.text),['你好。']);assert.equal((await h.query('task.list')).length,0);
});


test('triage keeps new replies unfrozen when the reviewer is unavailable or returns an invalid batch',{timeout:nativeTestTimeout(30000)},async t=>{
 let attempts=0,reviews=0;
 const good='好，我先核对一下。', bad='已收到您的需求，将开展排查并持续跟进。';
 const h=await residentRouterHost(t,body=>{
  const input=triageInput(body);
  if(!requestTools(body).includes('channel_triage_submit'))return {text:'No task created'};
  const journal=JSON.stringify(body.messages.filter(row=>row.role==='tool'));
  if(attempts>0)assert.match(journal,/REPLY_QUALITY_UNAVAILABLE/);
  const reply=attempts++<2?bad:good;
  return triageReply(input,()=>({needsHandling:false,reply}));
 },{hostOptions:{replyQuality:async({candidates},body)=>{
  assert.deepEqual(requestTools(body),[]);
  assert.equal((await h.query('triage.pending')).length,1);
  assert.deepEqual(await h.query('notification.list'),[]);
  assert.deepEqual(h.sent,[]);
  assert.equal(candidates[0].purpose,'triage-first-reply');
  if(++reviews===1)return {error:'fixture unavailable'};
  if(reviews===2)return {text:'{"decisions":[{"index":1,"issues":[]}]}' };
  assert.equal(candidates[0].text,good);
  return {text:'{"decisions":[{"index":0,"issues":[]}]}' };
 }}});
 await h.receive(channelMessage('triage-review',{text:'刚才查的是不是另一个实例？'}));await h.service.whenIdle();
 assert.equal(reviews,3);assert.deepEqual(h.sent.map(row=>row.text),[good]);
 const [receipt]=await h.query('notification.list');assert.equal(receipt.state,'delivered');assert.equal(receipt.payload.text,good);
 assert.deepEqual(await h.query('triage.pending'),[]);
});


test('an edited source cannot freeze or send a draft whose review was in flight',{timeout:nativeTestTimeout(60000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());
 const h=await residentRouterHost(t,body=>triageReply(triageInput(body),source=>({needsHandling:false,reply:source.version===1?'我先核对。':'按更正后的范围核对。'})),
 {hostOptions:{replyQuality:async({candidates})=>{
   if(candidates[0].sourceText==='请核对东区'){entered.resolve();await release.promise}
   return {text:'{"decisions":[{"index":0,"issues":[]}]}' };
 }}});
 const original=channelMessage('edited-in-review',{text:'请核对东区'});
 await h.receive(original);await entered.promise;
 await h.receive({...original,messageVersion:2,text:'更正：请核对西区'});
 release.resolve();await h.service.whenIdle();
 assert.deepEqual(h.sent.map(row=>row.text),['按更正后的范围核对。']);
 const [receipt,...rest]=await h.query('notification.list');assert.equal(rest.length,0);
 assert.equal(receipt.payload.sourceRef.messageVersion,2);assert.equal(receipt.state,'delivered');
});
