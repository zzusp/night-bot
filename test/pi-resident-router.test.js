import {assertSharedCommunicationGuidance} from './fixtures/communication-guidance.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {restoreLegacyHumanWait} from './fixtures/legacy-human-wait.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'

test('default ingress shares room arrangements without merging private senders or channel namespaces',{timeout:nativeTestTimeout(30000)},async t=>{
  const h=await residentRouterHost(t,body=>{
    const input=requestEnvelope(body,'Router 请求：')
    if(!input||body.messages.at(-1)?.role==='tool')return {text:'No work'}
    return {tool:'resident_router_settle',args:{operationId:'namespace:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'context-only',sourceQuote:event.source.text,reason:'Synthetic namespace background only'}))}}
  })
  const skills=h.host.ctx.get('skills'),warn=skills.warn.bind(skills);skills.warn=message=>{t.diagnostic(message);warn(message)}
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
  for(const body of h.requests){const input=requestEnvelope(body,'Router 请求：');if(!input)continue
    const originals=input.events.filter(event=>event.source).map(event=>event.source)
    const originalTexts=originals.map(message=>message.text)
    const privateMarkers=['PRIVATE_ALICE','PRIVATE_BOB','OTHER_CHANNEL','OTHER_ROOM'].filter(marker=>originalTexts.includes(marker))
    if(privateMarkers.length){assert.equal(privateMarkers.length,1);assert.equal(originals.length,1,'isolated conversations cannot share a Router batch')}
  }
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
})

test('historical conversation task questions reach the original requester and resume the same scoped session',{timeout:nativeTestTimeout(60000)},async t=>{
  const packets=[]
  const legacyWait={question:'Which exact local verification input should be used?',summary:'A precise input is required before continuing',evidence:['original authenticated objective'],limitations:[]}
  const h=await residentRouterHost(t,body=>{
    const tools=requestTools(body)
    assert.ok(!tools.includes('channel_triage_submit'))
    if(tools.includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：')
      if(body.messages.at(-1)?.role==='tool')return {text:'Pending events settled'}
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'questions:'+input.events.map(event=>event.id).join(','),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'context-only',sourceQuote:event.source.text,reason:'Synthetic task question fixture setup only'}))}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff)return {text:JSON.stringify({currentIntent:'Preserve original question and source references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    if(!tools.includes('task_result'))return {text:'No additional work'}
    const input=requestText({...body,messages:body.messages.filter(message=>message.role==='user')}).toReversed().map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.task)
    assert.ok(input);packets.push(input)
    const definition=body.tools.find(tool=>tool.function.name==='task_result').function
    assert.equal(definition.parameters.properties.decision.properties.question,undefined)
    assert.equal(definition.parameters.properties.decision.properties.audience,undefined)
    const answer=input.sources.find(source=>source.channel==='web'&&source.text==='Use the original local-only verification input.')
    if(answer){
      assert.equal(answer.actorId,'owner');assert.ok(answer.sourceId)
      return {tool:'task_result',args:{decision:{action:'complete',summary:'The original local work continued after the precise answer',evidence:['authorized answer read: '+answer.sourceId],limitations:[]}}}
    }
    const {summary,evidence,limitations}=legacyWait
    return {tool:'task_result',args:{decision:{action:'wait',summary,evidence,limitations}}}
  })
  for(const audience of ['default','requester']){
    const input=channelMessage('question-'+audience,{senderId:'requester-'+audience,text:'Verify this local-only objective with the precise input.'}),identity=h.host.ctx.channels.identity(input),before=h.sent.length
    await h.receive(input)
    const created=await h.service.createTask({requestId:'question-'+audience,title:'audience-'+audience,objective:input.text,channel:input})
    await h.service.whenIdle()
    const scaffold=await h.query('task.get',{taskId:created.taskId})
    assert.equal(scaffold.drained,true);assert.equal(scaffold.lastDecision.action,'wait')
    assert.equal(scaffold.humanRequests.length,0,'new execution does not open a question')
    assert.equal(h.sent.length,before,'technical wait sends nothing')
    const dbPath=join(h.host.ctx.runtimePaths.state,'tasks.sqlite')
    // Restore a frozen old requester question after the real execution drains.
    // The current model is never allowed to create a question or choose an audience.
    await h.close()
    restoreLegacyHumanWait(dbPath,created.taskId,audience==='default'?legacyWait:{...legacyWait,audience},{prepareNotice:true})
    await h.restart();await h.service.whenIdle()
    const task=await h.query('task.get',{taskId:created.taskId})
    assert.equal(task.drained,true);assert.equal(task.conversationId,identity.sessionId);assert.equal(task.ownerActorId,identity.principal)
    assert.equal(task.humanRequests.length,1)
    const request=task.humanRequests[0]
    assert.equal(request.audience,'requester');assert.equal(request.status,'waiting-reply')
    const web=(await h.service.listAuthorizationRequests()).find(item=>item.taskId===task.taskId&&item.requestId===request.requestId)
    assert.ok(web);assert.equal(web.audience,request.audience)
    const notices=await h.query('notification.list',{taskId:task.taskId})
      await eventually(()=>h.sent.length===before+1&&h.readbacks.length===before+1,'requester question actually sent and read back by local transport',t.signal)
      assert.equal(request.question,legacyWait.question);
      assert.equal(notices.length,1);assert.equal(notices[0].kind,'question');assert.equal(notices[0].payload.audience,'requester')
      const source=await h.query('source.get',{sourceId:notices[0].payload.sourceId})
      assert.equal(source.actorId,identity.principal);assert.equal(source.messageId,input.messageId);assert.equal(source.groupId,identity.sessionId);assert.equal(notices[0].payload.sourceVersion,source.version)
      assert.equal(h.sent.at(-1).conversationId,input.conversationId);assert.equal(h.sent.at(-1).senderId,input.senderId);assert.deepEqual(h.sent.at(-1).recipientIds,[input.senderId])
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
  for(const audience of ['default','requester'])assert.equal(packets.filter(input=>input.task.title==='audience-'+audience).length,2,'one stopped scaffold and one same-session answer, with no rewrite round')
  assert.equal(h.errors.length,0)
  t.diagnostic(JSON.stringify({case:'legacy-requester-routing',defaultRequester:true,currentQuestionAndAudienceFieldsAbsent:true,requesterSourcePreserved:true,requesterWebCasResumeSameSession:true,realVendorExecuted:false}))
})

test('Router sends directly while rejecting a draft containing credentials',{timeout:nativeTestTimeout(30000)},async t=>{
 let initial;let step=0;const answer='代码里有一处会把缺少值的保存请求拦下来。这次是不是被它拦了，还要看当时的请求和日志。', draft='api_key: synthetic-fixture-only';
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body),input=requestEnvelope(body,'Router 请求：');
  assert.ok(!tools.includes('channel_triage_submit'));
  if(!tools.includes('resident_router_reply'))return {text:'Settled'};
  const prompt=body.messages.filter(row=>row.role==='system').map(row=>row.content).join('\n');
  assert.match(prompt,/沟通规范索引/);assert.match(prompt,/NIGHT_NATURAL_CHANNEL_REPLY/);assert.doesNotMatch(prompt,/NIGHT_TASK_PUBLIC_COMMUNICATION/);
  assert.match(prompt,/默认 ELI5：先说对方关心的结果或下一步，只补影响判断的事实/u)
  assert.match(prompt,/默认只讲重点，不列排查过程和内部状态；用户要求细节再展开/u)
  assert.match(prompt,/问题或正文已说清的范围，不再另起一句重申。只补尚未交代、且会改变读者对结果、风险或下一步判断的限制/u)
  if(step===0){initial=body;step++;return {tool:'communication_guidance_read',args:{}}}
  assertSharedCommunicationGuidance(initial,body)
  assert.match(JSON.stringify(body.messages.filter(row=>row.role==='tool')),/本次事件根因分开/);
  const events=requestEnvelope(body,'Router 请求：').events,source=events.find(event=>event.source)?.source;
  const reply=text=>({tool:'resident_router_reply',args:{operationId:'natural-answer',sourceId:source.sourceId,messageVersion:source.version,text}});
  if(step++===1)return reply(draft);
  if(step===3){assert.match(JSON.stringify(body.messages.filter(row=>row.role==='tool')),/GROUP_REPLY_SENSITIVE_DETAILS/);return reply(answer)}
  if(step===4)return {tool:'resident_router_settle',args:{operationId:'natural-settle',eventIds:events.map(event=>event.id),noTaskDispositions:events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'handled-inline',reason:'Answered the current evidence boundary without claiming repair',sourceQuote:event.source.text}))}};
  return {text:'Settled'};
 });
 const message=channelMessage('natural-scope',{text:'空值误拦路径已核实，但本次UAT输入和日志还没核实。请说明目前能确定什么。'});
 await h.receive(message);await h.service.whenIdle();
 assert.deepEqual(h.sent.map(row=>row.text),[answer]);assert.equal((await h.query('task.list')).length,0);
 const calls=h.requests.length;await h.receive(message);await h.service.whenIdle();assert.equal(h.requests.length,calls);assert.equal(h.sent.length,1);
 assert.equal(h.requests.length,5,'only the original Router tool loop reaches the model');
 const [receipt]=await h.query('notification.list');assert.equal(receipt.state,'delivered');assert.equal(receipt.payload.text,answer);
});

test('Router progress quotes the original source without changing an old frozen plain reply',{timeout:nativeTestTimeout(30000)},async t=>{
 let step=0,oldReply
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
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
 })
 const original=channelMessage('progress-origin',{text:'请说一下实际核对进度。'})
 await h.receive(original);await h.service.whenIdle()
 const delivered=await h.query('notification.list')
 assert.equal(delivered.length,2);assert.ok(delivered.every(row=>row.state==='delivered'&&row.sendAttemptCount===1))
 const retained=delivered.find(row=>row.id===oldReply.id)
 assert.deepEqual(retained.payload,oldReply.payload);assert.equal(retained.payloadDigest,oldReply.payloadDigest)
 assert.equal(h.results.filter(row=>row.name==='resident_router_reply'&&!row.result.isError).length,4)
 assert.deepEqual(h.sent.map(row=>[row.text,row.replyToMessageId,row.replyToParticipantId,row.recipientIds]),[
  ['已读取材料。',undefined,undefined,['alice']],['已完成数据核对。',original.messageId,'alice',['alice']],
 ])
})

test('an edited source cannot freeze or send a direct Router reply generated from the superseded version',{timeout:nativeTestTimeout(60000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());const attempted=new Set()
 const h=await residentRouterHost(t,async body=>{
  const input=requestEnvelope(body,'Router 请求：');if(!input)return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Done'}
  const source=input.events.find(event=>event.source)?.source
  if(!source)return {text:'Done'}
  if(!attempted.has(source.sourceId)){
   attempted.add(source.sourceId)
   if(source.version===1){entered.resolve();await release.promise}
   return {tool:'resident_router_reply',args:{operationId:'edited:'+source.sourceId,sourceId:source.sourceId,messageVersion:source.version,text:source.version===1?'我先核对。':'按更正后的范围核对。'}}
  }
  return {tool:'resident_router_settle',args:{operationId:'edited-settle:'+source.sourceId,eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.map(event=>({eventId:event.id,outcome:source.version===1?'context-only':'handled-inline',sourceQuote:event.source.text,reason:'Use only the latest authenticated source version'}))}}
 });
 const original=channelMessage('edited-during-router',{text:'请核对东区'});
 await h.receive(original);await entered.promise;
 await h.receive({...original,messageVersion:2,text:'更正：请核对西区'});
 release.resolve();await h.service.whenIdle();
 assert.deepEqual(h.sent.map(row=>row.text),['按更正后的范围核对。']);
 const [receipt,...rest]=await h.query('notification.list');assert.equal(rest.length,0);
 assert.equal(receipt.payload.sourceRef.messageVersion,2);assert.equal(receipt.state,'delivered');
});

for(const outcome of ['stage','clarification','blocker'])test('Router rejects explicit acknowledgement and sends '+outcome+' without a review stage',{timeout:nativeTestTimeout(40000)},async t=>{
 const answers={stage:'当前任务索引是空的，没有等待事项。',clarification:'需要核对哪个环境？现有资料没有指定目标。',blocker:'目标环境现在不可用，暂时无法核对结果。'}
 let h,step=0
 h=await residentRouterHost(t,async body=>{
  const input=requestEnvelope(body,'Router 请求：')
  if(!requestTools(body).includes('resident_router_settle')||!input)return {text:'No work'}
  const event=input.events.find(event=>event.source),args={sourceId:event.sourceId,messageVersion:event.messageVersion}
  if(step===0){
   // Exercise the Host port as well as the model schema: new explicit ACKs
   // cannot freeze even if a caller bypasses the model's enum validation.
   const actor=h.host.ctx.agents.get((await h.query('router.get',{conversationId:input.conversationId})).activeSessionId)
   const definition=h.host.ctx.tools.get('resident_router_reply',actor)
   await assert.rejects(definition.execute({...args,operationId:'host-ack',replyPurpose:'acknowledgement',text:'Synthetic acknowledgement'}, {agent:actor,signal:actor.lifecycle.signal}),{code:'ROUTER_REPLY_REQUIRES_RESULT'})
   assert.equal((await h.query('notification.list')).length,0)
   assert.ok(!body.tools.find(tool=>tool.function.name==='resident_router_reply').function.parameters.properties.replyPurpose.enum.includes('acknowledgement'))
  }
  if(step++===0)return {tool:'resident_task_query',args:{detail:'index'}}
  if(step===2)return {tool:'resident_router_reply',args:{...args,operationId:'verified-outcome',replyPurpose:outcome==='stage'?'task-update':'direct-answer',text:answers[outcome]}}
  if(step===3)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle-result',noTaskDispositions:[{eventId:event.id,outcome:'handled-inline',reason:'Answered with the available result or necessary missing information',sourceQuote:event.source.text}]}}
  return {text:'Done'}
 })
 await h.receive(channelMessage('result-'+outcome,{text:'查询当前状态。目标、证据和环境状态均以可取得资料为准。'}));await h.service.whenIdle()
 assert.deepEqual(h.sent.map(row=>row.text),[answers[outcome]])
 const records=await h.query('notification.list');assert.equal(records.length,1);assert.equal(records[0].state,'delivered')
 assert.ok(h.requests.every(body=>!requestTools(body).includes('channel_triage_submit')))
 const original=structuredClone(records[0]),count=h.requests.length;await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,count);assert.deepEqual(await h.query('notification.get',{notificationId:original.id}),original);assert.equal(h.sent.length,1)
})

test('completion mentions the authenticated task owner instead of quoting the latest contributor',{timeout:nativeTestTimeout(30000)},async t=>{
 let contributor,replied=false
 const resultText='核对已完成，未访问线上环境。'
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:resultText,evidence:['synthetic read-only check'],limitations:['no live access']}}}
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：'),done=input.events.find(event=>event.kind==='task.completed')
  if(done&&!replied){
   replied=true
   return {tool:'resident_router_reply',args:{operationId:'owner-receipt',sourceId:contributor.sourceId,messageVersion:contributor.version,completionEventId:done.taskEventId,replyPurpose:'task-update',text:resultText}}
  }
  return {tool:'resident_router_settle',args:{operationId:'audience:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 h.host.ctx.channels.transports.get('resident-fixture').capabilities={quotedReplies:['chat-room']}
 const original=channelMessage('owner-request',{text:'请核对现有资料。'}),latest=channelMessage('other-person',{senderId:'bob',text:'补充一份材料。'})
 await h.receive(original);await h.receive(latest);await h.service.whenIdle()
 contributor=(await h.query('source.list')).find(source=>source.messageId===latest.messageId)
 assert.ok(contributor)
 const task=await h.service.createTask({requestId:'owner-task',channel:original,objective:original.text,sourceRefs:[contributor.sourceId]})
 await h.service.whenIdle()
 const [notice]=await h.query('notification.list')
 assert.equal(notice.state,'delivered');assert.equal(notice.payload.completionBinding.taskId,task.taskId)
 assert.equal(notice.payload.sourceRef.actorId,contributor.actorId)
 assert.deepEqual(h.sent.map(({text,recipientIds,replyToMessageId})=>({text,recipientIds,replyToMessageId})),[{text:resultText,recipientIds:[original.senderId],replyToMessageId:undefined}])
 assert.equal(h.readbacks.length,1)
})
