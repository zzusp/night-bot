import test from 'node:test'
import assert from 'node:assert/strict'
import {hash} from '../src/memory/format.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'

const triage=body=>requestEnvelope(body,'一级分诊请求：')
const router=body=>requestEnvelope(body,'Router 请求：')
function handoff(body) {
  const input=requestEnvelope(body,'Router 交接请求：')
  if(!input||requestTools(body).length)return
  return {text:JSON.stringify({currentIntent:'Retain necessary original source references and consult the current task ledger',
    unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff})}
}
function submit(input,select) {
  return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(message=>({sourceId:message.sourceId,
    messageVersion:message.version??message.messageVersion,...select(message),reason:'Use the directly available original context'}))}}
}
function settle(body,input) {
  if(body.messages.at(-1)?.role==='tool')return {text:'The necessary business disposition is committed.'}
  return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.eventId).join(',')}}
}

test('all four default dispositions keep original handling independent of an unknown short reply and survive cold deduplication',{timeout:nativeTestTimeout(40000)},async t=>{
  const observed=[],handoffs=[];let h
  h=await residentRouterHost(t,body=>{
    const summary=handoff(body)
    if(summary){handoffs.push(body);return summary}
    const first=triage(body)
    if(requestTools(body).includes('channel_triage_submit'))return submit(first,source=>({needsHandling:source.text.includes('HANDLE'),
      ...source.text.includes('REPLY')?{reply:'Concise '+source.messageId}:{}}))
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);observed.push(input);return settle(body,input)}
    return {text:'No other work'}
  },{send:async()=>{throw Error('Simulated lost acknowledgement after external send')},readback:async()=>{throw Error('Readback not yet available')}})
  const originals=[channelMessage('silent',{text:'QUIET'}),channelMessage('reply',{text:'REPLY'}),
    channelMessage('handle',{text:'HANDLE',quotedMessage:{messageId:'prior',senderId:'bob',text:'Quoted source only'}}),
    channelMessage('both',{text:'HANDLE REPLY',senderId:'bob'})]
  for(const input of originals)await h.receive(input)
  await eventually(async()=>(await h.query('source.list')).filter(source=>source.routed).length===4,'all first-tier dispositions durably committed',t.signal)
  await h.service.whenIdle()
  const handled=new Map(observed.flatMap(input=>input.events).filter(event=>event.sourceId).map(event=>[event.source.messageId,event.source]))
  assert.deepEqual([...handled.keys()].sort(),['both','handle'])
  for(const input of originals.filter(input=>input.text.includes('HANDLE'))){const source=handled.get(input.messageId)
    assert.equal(source.text,input.text);assert.equal(source.version,1);assert.ok(source.actorId)
    if(input.quotedMessage){assert.equal(source.quote.messageId,input.quotedMessage.messageId);assert.match(JSON.stringify(source.quote),/Quoted source only/)}
  }
  assert.equal(h.sent.length,2);assert.equal(new Set(h.sent.map(envelope=>envelope.deliveryKey)).size,2)
  const notices=(await h.query('notification.list')).filter(notice=>notice.kind==='triage-reply')
  assert.equal(notices.length,2);assert.ok(notices.every(notice=>notice.state==='unknown'))
  assert.ok(observed.flatMap(input=>input.events).find(event=>event.source?.messageId==='both')?.triageReply,'Router sees the independently prepared short reply')
  assert.equal((await h.query('task.list')).length,0,'handled dialogue can settle without empty task creation')
  assert.ok(handoffs.length>0);assert.ok(handoffs.every(body=>requestTools(body).length===0),'idle handoff must be tool-free')
  assert.equal((await h.query('router.inbox',{conversationId:h.host.ctx.channels.identity(originals[0]).sessionId})).length,0)
  const sendCount=h.sent.length,requestCount=h.requests.length
  await h.restart()
  for(const input of originals)await h.receive(input)
  await h.service.whenIdle()
  assert.equal(h.sent.length,sendCount,'unknown short replies are never resent after cold restart')
  assert.equal(h.requests.length,requestCount,'committed dispositions and Router actions are not replayed after cold restart')
})

test('durable receipt echoes tolerate later DWS flags without replacing existing message facts',{timeout:nativeTestTimeout(40000)},async t=>{
  const {readFile}=await import('node:fs/promises'),{join}=await import('node:path'),{hash}=await import('../src/memory/format.js'),{apply:applyDws,validateConfig:validateDws}=await import('../src/channels/plugins/dingtalk-dws.js')
  const sent=[],readbacks=[],at=new Date().toISOString(),flag=(args,key)=>args[args.indexOf(key)+1]
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),source=>({needsHandling:false,...source.text==='Original request receipt-original'?{reply:'Bounded synthetic reply'}:{}}))
    return {text:'No additional business work'}
  })
  const runner={async run(args){
    let value
    if(args[0]==='profile')value={success:true,profiles:[{profile:'synthetic-corp:synthetic-user',corpId:'synthetic-corp',userId:'synthetic-user',userName:'Synthetic Self',isOrgCurrent:true}]}
    else if(args.includes('get-self'))value={result:[{orgEmployeeModel:{corpId:'synthetic-corp',userId:'synthetic-user',orgUserName:'Synthetic Self'}}]}
    else if(args.includes('+search-user'))value={ok:true,outcome:'success',data:{count:1,users:[{userId:'synthetic-user',openDingTalkId:'same-account'}]}}
    else if(args.includes('conversation-info'))value={success:true,result:{conversationInfo:{openConversationId:flag(args,'--group'),singleChat:false},friendlyHint:'',retryable:false}}
    else if(args.includes('+messages-send')||args[1]==='message'&&args[2]==='reply'){
      const message={messageId:'synthetic-visible-'+(sent.length+1),conversationId:flag(args,'--group'),text:flag(args,args.includes('--content')?'--content':'--markdown'),senderOpenDingTalkId:'same-account',openTaskId:'synthetic-send-'+(sent.length+1)}
      sent.push(message);value={sendReceipt:{openTaskId:message.openTaskId}}
    }else if(args.includes('+messages-query-send-status')){
      const message=sent.find(row=>row.openTaskId===flag(args,'--open-task-id'));value={result:{sendStatus:'SUCCESS',openConversationId:message.conversationId,openMessageId:message.messageId}}
    }else if(args.includes('+messages-mget')){
      const message=sent.find(row=>row.messageId===flag(args,'--msg-ids'));readbacks.push(message);value={complete:true,hasMore:false,failedCount:0,failures:[],foundCount:1,notFoundMessageIds:[],messages:[message]}
    }else throw Error('Unexpected synthetic DWS command: '+args.slice(0,3).join(' '))
    return {exitCode:0,stdout:JSON.stringify(value),stderr:''}
  },spawn(){throw Error('No listener in the local receipt regression')}}
  async function mount(channelId='dingtalk-dws',groupId='shared-room'){
    const ctx=h.host.ctx,config={...validateDws({dingtalk_profile:'synthetic-corp:synthetic-user',dingtalk_conversation_type:'chat-room',dingtalk_group_id:groupId,dingtalk_listen:false,dingtalk_writes_authorized:true}),enabled:true,channelId}
    await ctx.plugin({inject:['channels','runtimePaths'],apply:child=>applyDws(child,config,{runner,environment:{USERPROFILE:h.root,HOME:h.root,DWS_CONFIG_DIR:h.root,DWS_KEYCHAIN_DIR:h.root}})})
    await ctx.parallel('night/ready',{config:{resident:{taskSessions:{ingressEpoch:'2026-01-01T00:00:00Z'}}},runtime:{},tasks:h.service})
    const plugin=ctx.channels.plugins.get(channelId);assert.equal(plugin.health.state,'ready',JSON.stringify(plugin.health));return plugin
  }
  let plugin=await mount()
  const receive=(input,target=plugin)=>target.acceptHistoryMessage({groupId:input.conversationId,messageId:input.messageId,senderOpenDingTalkId:input.senderId,text:input.text,occurredAt:at,...input.platformFlags?.messageAiSendFlag?{messageAiSendFlag:input.platformFlags.messageAiSendFlag}:{}})
  const original=channelMessage('receipt-original',{channelId:'dingtalk-dws'}),channels=h.host.ctx.channels,identity=channels.identity(original)
  await receive(original);await h.service.whenIdle()
  const notices=await h.query('notification.list'),notice=notices.find(row=>row.state==='delivered')
  assert.ok(notice);assert.equal(sent.length,1);assert.equal(readbacks.length,1)
  const echo=channelMessage(notice.receipt.messageId,{channelId:'dingtalk-dws',senderId:'same-account',text:sent[0].text})
  // 复现原部署在精确回声过滤前已持久登记的事实，必须保留七字段摘要。
  await channels.registerConversation(echo)
  const file=join(h.host.ctx.runtimePaths.state,'channels','contexts.json'),saved=JSON.parse(await readFile(file,'utf8'))
  for(const input of [original,echo])assert.equal(saved[identity.sessionId].messageFacts[input.messageId].payloadHash,hash(JSON.stringify([channels.identity(input).principal,input.text,[],null,null,[],{}])))
  const beforeFacts=structuredClone(saved[identity.sessionId].messageFacts),requests=h.requests.length,sends=sent.length
  await h.restart();plugin=await mount()
  await receive(original)
  assert.equal((await receive({...echo,platformFlags:{messageAiSendFlag:'DWS',automated:true}})).reason,'own-notification')
  await h.service.whenIdle()
  assert.equal(h.requests.length,requests);assert.equal(sent.length,sends)
  assert.equal((await h.query('source.list')).length,1);assert.equal((await h.query('task.list')).length,0)
  assert.deepEqual(JSON.parse(await readFile(file,'utf8'))[identity.sessionId].messageFacts,beforeFacts,'cold replay and receipt echo preserve existing facts')
  for(const change of [{text:'Changed actual content'},{senderId:'foreign-actor'},{platformFlags:{messageAiSendFlag:'DWS',automated:true}}])await assert.rejects(receive({...original,...change}),error=>error.code==='CHANNEL_MESSAGE_ID_CONFLICT')
  const fresh={...echo,messageId:'fresh-same-account',platformFlags:{messageAiSendFlag:'DWS',automated:true}}
  assert.notEqual((await receive(fresh)).reason,'own-notification')
  const otherRoom=await mount('other-room-dws','other-room')
  assert.equal(h.service.isOwnNotification({groupId:h.host.ctx.channels.identity({...echo,conversationId:'other-room'}).sessionId,messageId:echo.messageId}),false)
  assert.notEqual((await receive({...echo,conversationId:'other-room'},otherRoom)).reason,'own-notification')
  const other=await mount('other-dws')
  assert.notEqual((await receive(echo,other)).reason,'own-notification')
  await h.service.whenIdle()
  assert.equal((await h.query('source.list')).length,4,'only exact conversation/message receipts are echoes; account, flags and text alone are insufficient')
  assert.equal(sent.length,sends);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'existing-fact-dws-echo',coldFactsUnchanged:true,preciseEchoIgnored:true,changedContentActorFlagsRejected:true,crossChannelAndConversationKept:true,receiptlessSameAccountKept:true,realDwsExecuted:false}))
})

test('in-flight first tier steers at most 15 original messages and leaves the sixteenth durably queued',{timeout:nativeTestTimeout(45000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),batches=[],business=[];let paused=false
  t.after(()=>release.resolve())
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit')){
      if(!paused){paused=true;entered.resolve();await release.promise}
      const input=triage(body);batches.push(input.messages.map(source=>source.sourceId));return submit(input,()=>({needsHandling:true}))
    }
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);business.push(input);return settle(body,input)}
    return {text:'No other work'}
  })
  await h.receive(channelMessage('1'));await entered.promise
  await Promise.all(Array.from({length:15},(_,index)=>h.receive(channelMessage(String(index+2)))))
  const sources=await h.query('source.list')
  assert.equal(sources.length,16,'overflow must be durable before the original model turn is released')
  assert.equal((await h.query('triage.pending',{conversationId:h.host.ctx.channels.identity(channelMessage('1')).sessionId})).length,15)
  release.resolve()
  await h.service.whenIdle()
  const committed=(await h.query('source.list')).filter(source=>source.routed)
  assert.equal(committed.length,16)
  assert.ok(batches.every(batch=>batch.length<=15))
  assert.ok(batches.some(batch=>batch.length===15),'arrivals must use the active batch rather than 16 unrelated one-item sessions')
  for(const input of business)assert.ok(input.events.filter(event=>event.sourceId).length<=15)
  // Each official turn asks again after its tool result; dedup request snapshots.
  const sets=new Set(business.map(input=>input.events.map(event=>event.id).join(',')))
  const unique=business.filter((input,index,array)=>array.findIndex(other=>other.events.map(event=>event.id).join(',')===input.events.map(event=>event.id).join(','))===index)
  assert.equal(new Set(unique.flatMap(input=>input.events.map(event=>event.sourceId))).size,16)
  assert.equal(unique.reduce((sum,input)=>sum+input.events.filter(event=>event.sourceId).length,0),16)
  assert.ok(sets.size>=2);assert.equal(h.sent.length,0)
})

test('a message arriving during tool-free handoff is delivered exactly once to the next generation',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),observed=[];let held=false
  t.after(()=>release.resolve())
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body)
    if(summary){if(!held){held=true;entered.resolve();await release.promise}return summary}
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);observed.push(input);return settle(body,input)}
    return {text:'No other work'}
  })
  const first=channelMessage('before-handoff'),late=channelMessage('during-handoff')
  const id=h.host.ctx.channels.identity(first).sessionId
  await h.receive(first);await entered.promise
  const old=await h.query('router.get',{conversationId:id})
  assert.equal(old.phase,'handoff')
  await h.receive(late)
  await eventually(async()=>(await h.query('router.inbox',{conversationId:id})).some(event=>event.source?.messageId===late.messageId),'late source durably queues during handoff',t.signal)
  assert.ok(observed.every(input=>input.events.every(event=>event.source?.messageId!==late.messageId)),'old actor does not receive a cutoff-late message')
  release.resolve();await h.service.whenIdle()
  const firstTurn=observed.find(input=>input.events.some(event=>event.source?.messageId===first.messageId))
  const lateTurn=observed.find(input=>input.events.some(event=>event.source?.messageId===late.messageId))
  assert.equal(lateTurn.generation,firstTurn.generation+1)
  const current=await h.query('router.get',{conversationId:id})
  assert.equal(current.phase,'active');assert.equal(current.cursor,2);assert.equal(current.generation,3)
  const native=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.ok(native.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff'))
  assert.equal((await h.query('router.inbox',{conversationId:id})).length,0)
})

for(const failureStage of ['router.candidate.commit','router.publish'])test('cold recovery completes the uniquely committed next generation after '+failureStage+' fails',{timeout:nativeTestTimeout(40000)},async t=>{
  let injected=false,crashArmed=true;const business=[]
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){const input=router(body);business.push(input);return settle(body,input)}
    return {text:'No other work'}
  },{wrapStore:store=>({...store,command:async command=>{
    if(crashArmed&&command.kind===failureStage){injected=true;throw Object.assign(Error('Injected crash window'),{code:'TEST_CRASH_WINDOW'})}
    return store.command(command)
  }})})
  const input=channelMessage('crash-window'),id=h.host.ctx.channels.identity(input).sessionId
  await h.receive(input)
  await eventually(()=>injected,'native next-generation commit before injected failure',t.signal)
  await h.service.whenIdle().catch(error=>assert.match(error.message,/TEST_CRASH_WINDOW|Injected crash/))
  const before=await h.query('router.get',{conversationId:id})
  assert.equal(before.generation,1);assert.equal(before.phase,'handoff');assert.equal(before.cursor,1)
  const rotation=(await h.query('router.rotations',{conversationId:id}))[0]
  assert.equal(rotation.state,failureStage==='router.publish'?'candidate-committed':'summarized')
  const requestCount=h.requests.length
  await h.close().catch(error=>assert.match(error.message,/Router shutdown failed|TEST_CRASH_WINDOW/))
  crashArmed=false;await h.restart();await h.service.whenIdle()
  const after=await h.query('router.get',{conversationId:id})
  assert.equal(after.generation,2);assert.equal(after.phase,'active');assert.equal(after.cursor,1)
  assert.equal(h.requests.length,requestCount,'recovery publishes the committed seed, not a replayed model/business turn')
  const native=await h.host.ctx.sessionPersistence.readNative(after.activeSessionId,{requireComplete:true})
  assert.ok(native.entries.some(entry=>entry.customType==='night.router-handoff'))
  assert.ok(native.entries.some(entry=>entry.customType==='night.commit'))
  assert.equal((await h.query('router.rotations',{conversationId:id}))[0].state,'published')
})

test('successive idle cycles retain the short handoff without reloading old payloads or self-triggering empty rotations',{timeout:nativeTestTimeout(60000)},async t=>{
  const initialTurns=[],summaries=[]
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary){summaries.push(body);return summary}
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body)
      if(body.messages.at(-1)?.role!=='tool')initialTurns.push(body)
      return settle(body,input)
    }
    return {text:'No other work'}
  })
  for(let round=0;round<4;round++){
    await h.receive(channelMessage('cycle-'+round,{text:'PAYLOAD_ROUND_'+round+':'+String(round).repeat(3000)}))
    await h.service.whenIdle()
  }
  assert.equal(initialTurns.length,4);assert.equal(summaries.length,4)
  for(let round=1;round<initialTurns.length;round++){
    const context=JSON.stringify(initialTurns[round].messages)
    assert.match(context,/Retain necessary original source references/)
    for(let old=0;old<round;old++)assert.ok(!context.includes('PAYLOAD_ROUND_'+old+':'),'new generation does not reload the old source payload')
    assert.ok(context.length<JSON.stringify(initialTurns[0].messages).length+8000,'context growth is not proportional to all historical payloads')
  }
  const current=await h.query('router.get',{conversationId:h.host.ctx.channels.identity(channelMessage('cycle-0')).sessionId})
  assert.equal(current.generation,5);assert.equal(current.cursor,4);assert.equal(current.lastHandoffCursor,4)
  const count=h.requests.length;await h.service.whenIdle();assert.equal(h.requests.length,count,'seed creation and settled summary cannot recursively trigger another handoff')
})

for(const invalid of ['blank-intent','missing-source','utf8-budget','referents-object'])test(`invalid tool-free handoff retains the current native generation without publishing a candidate: ${invalid}`,{timeout:nativeTestTimeout(40000)},async t=>{
  let summaries=0
  const h=await residentRouterHost(t,body=>{
    const input=requestEnvelope(body,'Router 交接请求：')
    if(input&&!requestTools(body).length){
      summaries++
      const value={currentIntent:'Preserve the original request',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff}
      if(invalid==='blank-intent')value.currentIntent='   '
      if(invalid==='referents-object')value.referents=[{name:'A',meaning:'Object elements remain forbidden'}]
      if(invalid==='missing-source')value.evidenceRefs=[]
      if(invalid==='utf8-budget')value.assumptions=Array(16).fill('中'.repeat(800))
      return {text:JSON.stringify(value)}
    }
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle'))return settle(body,router(body))
    return {text:'No other work'}
  })
  const message=channelMessage('invalid-'+invalid),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message)
  await eventually(async()=>summaries>0&&(await h.query('router.rotations',{conversationId})).some(row=>row.state==='aborted'),'invalid summary abort is durably committed',t.signal)
  // Triage commit and triage completion may both enqueue a router drain.
  // An aborted earlier rotation does not mean the queued retry is already idle.
  await eventually(async()=>{
    try{await h.service.whenIdle();return true}
    catch(error){assert.equal(error.routerSafeToResume,true);return false}
  },'all queued invalid handoffs have settled',t.signal)
  const current=await h.query('router.get',{conversationId}),rotations=await h.query('router.rotations',{conversationId})
  assert.equal(current.generation,1);assert.equal(current.phase,'active');assert.equal(current.cursor,1);assert.equal(current.lastHandoffCursor,0)
  assert.ok(rotations.length>0);assert.ok(rotations.every(row=>row.state==='aborted'&&!row.candidateSessionId))
  assert.equal((await h.query('router.inbox',{conversationId})).length,0,'committed handling is not replayed when its later summary fails')
  const saved=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.equal(saved.header.generation,1);assert.ok(saved.entries.some(entry=>entry.customType==='night.commit'))
  assert.equal((await h.query('task.list')).length,0)
})

test('legacy prepared replyRequest and cold unknown retain original payload bytes while neutral retries stay idempotent',{timeout:nativeTestTimeout(60000)},async t=>{
  const steps=new Map();let h,original,frozen,notificationId
  h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(!requestTools(body).includes('resident_router_reply'))return {text:'No additional work'}
    const input=router(body),key=input.events.map(event=>event.id).join(','),step=steps.get(key)??0;steps.set(key,step+1)
    if(!original){
      original=input.events.find(event=>event.source)?.source
      assert.ok(original)
      notificationId='router-operation:'+hash(JSON.stringify([original.conversationId,'legacy-frozen-reply']))
      const request={kind:'router-reply',sourceId:original.sourceId,sourceVersion:original.version,text:'Frozen legacy response',atOpenDingTalkIds:[original.actorId],artifactFiles:[]}
      await h.store.command({id:'fixture-old-producer',kind:'notification.prepare',args:{notificationId,taskId:null,requirementRevision:1,kind:'router-reply',payload:{text:request.text,conversationId:original.conversationId,sourceId:original.sourceId,sourceVersion:original.version,sourceRef:{messageId:original.messageId,messageVersion:original.version,actorId:original.actorId},atOpenDingTalkIds:[original.actorId],replyKind:'substantive',taskIds:[],topicRefs:[],replyRequest:request}}})
      frozen=await h.query('notification.get',{notificationId})
    }
    const args={operationId:'legacy-frozen-reply',sourceId:original.sourceId,messageVersion:original.version,text:'Frozen legacy response',recipientActorIds:[original.actorId]}
    if(step===0)return {tool:'resident_router_reply',args}
    if(step===1)return {tool:'resident_router_reply',args:{...args,text:'Changed frozen content'}}
    if(step===2)return {tool:'resident_router_reply',args:{...args,recipientActorIds:[]}}
    if(step===3)return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'legacy-settle:'+key}}
    return {text:'Original frozen notification reused without preparing another send'}
  },{readback:async()=>{throw Error('Synthetic unknown readback remains unavailable')}})
  h.host.ctx.channels.transports.get('resident-fixture').canSend=()=>false
  const input=channelMessage('legacy-original',{text:'Preserve this existing bounded response'})
  await h.receive(input);await h.service.whenIdle()
  assert.match(frozen.payloadDigest,/^[a-f0-9]{64}$/);assert.equal(frozen.state,'prepared');assert.deepEqual(await h.query('notification.get',{notificationId}),frozen);assert.equal(h.sent.length,0)
  assert.ok(Object.hasOwn(frozen.payload,'atOpenDingTalkIds'));assert.ok(Object.hasOwn(frozen.payload.replyRequest,'atOpenDingTalkIds'));assert.equal(Object.hasOwn(frozen.payload,'recipientActorIds'),false)
  const preparedResult=h.results.find(row=>row.name==='resident_router_reply'&&!row.result.isError)
  assert.ok(preparedResult);assert.deepEqual(preparedResult.result.value.notification.payload.recipientActorIds,[original.actorId])
  await h.store.command({id:'fixture-old-send-start',kind:'notification.start',args:{notificationId}})
  await h.restart()
  const cold=await h.query('notification.get',{notificationId})
  assert.equal(cold.sendAttemptCount,1);assert.equal(cold.state,'unknown');assert.deepEqual(cold.payload,frozen.payload);assert.equal(cold.payloadDigest,frozen.payloadDigest);assert.equal(h.sent.length,0)
  await h.receive(channelMessage('legacy-neutral-retry',{text:'Review the existing frozen response without changing its audience or content'}));await h.service.whenIdle()
  const current=await h.query('notification.get',{notificationId})
  assert.equal(current.state,'unknown');assert.deepEqual(current.payload,frozen.payload);assert.equal(current.payloadDigest,frozen.payloadDigest);assert.equal(current.sendAttemptCount,cold.sendAttemptCount);assert.equal(h.sent.length,0)
  const replays=h.results.filter(row=>row.name==='resident_router_reply'&&!row.result.isError),conflicts=h.results.filter(row=>row.name==='resident_router_reply'&&row.result.isError)
  assert.equal(replays.length,2);assert.equal(conflicts.length,4);assert.ok(conflicts.every(row=>JSON.stringify(row.result).includes('DYNAMIC_COMMAND_ID_CONFLICT')))
  assert.equal((await h.query('notification.list')).length,1)
  t.diagnostic(JSON.stringify({case:'legacy-reply-request-neutral-retry',preparedReused:true,coldState:current.state,originalPayloadAndDigestPreserved:true,semanticParameterConflicts:conflicts.length,additionalSends:h.sent.length,realVendorExecuted:false}))
})


test('cold Router resumes an exact legacy pending packet before a later event without changing its body or replaying either batch',{timeout:nativeTestTimeout(60000)},async t=>{
  const batches=[];let injected=false,legacyPacket
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      const input=router(body)
      if(body.messages.at(-1)?.role!=='tool')batches.push(structuredClone(input))
      return settle(body,input)
    }
    return {text:'No other work'}
  })
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){
    const handle=await create.call(this,options)
    if(options.meta?.runtimeOwner==='conversation-router'&&!injected){
      const enqueue=handle.enqueue.bind(handle)
      handle.enqueue=async packet=>{
        if(injected)throw Object.assign(Error('TEST_ROUTER_ENQUEUE_INTERRUPTED'),{code:'TEST_ROUTER_ENQUEUE_INTERRUPTED'})
        if(!injected){
          const input=JSON.parse(packet.content[0].text.slice('Router 请求：'.length))
          for(const event of input.events)if(event.source)event.source=await h.query('source.get',{sourceId:event.source.sourceId})
          // 模拟旧Host编码，在正式enqueue提交后、SDK接纳前中断；不改journal或SQLite。
          packet.content[0].text='Router 请求：'+JSON.stringify(input)
          legacyPacket=structuredClone(packet)
          await enqueue(packet);injected=true
          throw Object.assign(Error('TEST_ROUTER_ENQUEUE_INTERRUPTED'),{code:'TEST_ROUTER_ENQUEUE_INTERRUPTED'})
        }
        return enqueue(packet)
      }
    }
    return handle
  }
  t.after(()=>{registry.create=create})
  const input=channelMessage('legacy-pending',{text:'Original pending business input',quotedMessage:{messageId:'quoted',senderId:'bob',text:'Preserve this original context'}}),conversationId=h.host.ctx.channels.identity(input).sessionId
  await h.receive(input)
  await eventually(()=>injected,'legacy packet durably enqueued before SDK admission',t.signal)
  await h.service.whenIdle().catch(error=>assert.match(error.message,/TEST_ROUTER_ENQUEUE_INTERRUPTED/))
  const before=await h.query('router.get',{conversationId}),stored=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  const original=stored.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued')
  assert.equal(original.length,1);assert.deepEqual(original[0].payload,legacyPacket)
  assert.equal(stored.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted').length,0)
  assert.equal(stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').length,0);assert.equal(batches.length,0)
  assert.equal((await h.query('router.inbox',{conversationId})).length,1)
  const originalBody=JSON.parse(legacyPacket.content[0].text.slice('Router 请求：'.length)),source=originalBody.events[0].source
  assert.equal(source.groupId,conversationId);assert.equal(Object.hasOwn(source,'conversationId'),false)
  await h.store.command({id:'fixture-later-source',kind:'source.record-direct',args:{source:{sourceId:'late-router-source',groupId:conversationId,messageId:'late-router-message',actorId:source.actorId,channel:source.channel,version:1,text:'LATE_EVENT_NOT_IN_COMMITTED_PACKET',resources:[]},conversation:{conversationId}}})
  await h.store.command({id:'fixture-later-triage',kind:'triage.commit',args:{dispositions:[{sourceId:'late-router-source',messageVersion:1,needsHandling:true,reason:'A later independently recorded event'}]}})
  const pending=await h.query('router.inbox',{conversationId});assert.equal(pending.length,2)
  assert.ok(!legacyPacket.content[0].text.includes('LATE_EVENT_NOT_IN_COMMITTED_PACKET'))
  await h.close()
  const closed=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  assert.deepEqual(closed.audit,stored.audit);assert.equal(closed.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled').length,0)
  await h.restart();await h.service.whenIdle()
  const after=await h.query('router.get',{conversationId}),recovered=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  const enqueued=recovered.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='conversation-router'),ids=new Set(enqueued.map(row=>row.payload.id)),admitted=recovered.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted'&&ids.has(row.payload.id))
  assert.ok(recovered.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued'&&!ids.has(row.payload.id)).every(row=>row.payload.source.kind==='router-handoff'),'only the separate tool-free handoff may add another input')
  assert.equal(enqueued.length,2);assert.equal(admitted.length,2);assert.deepEqual(enqueued[0].payload,legacyPacket)
  assert.deepEqual(recovered.entries.slice(0,stored.entries.length),stored.entries)
  const originalEntries=recovered.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===legacyPacket.id)
  assert.equal(originalEntries.length,1);assert.deepEqual(originalEntries[0].content,legacyPacket.content);assert.deepEqual(originalEntries[0].details.source,legacyPacket.source)
  assert.equal(batches.length,2);assert.equal(batches[0].generation,before.generation);assert.deepEqual(batches[0],originalBody)
  assert.equal(batches[1].events.length,1);assert.equal(batches[1].events[0].source.sourceId,'late-router-source');assert.notEqual(enqueued[1].payload.id,legacyPacket.id)
  assert.deepEqual(batches[1].events.map(event=>event.id),[pending.find(event=>event.sourceId==='late-router-source').id])
  assert.equal((await h.query('router.inbox',{conversationId})).length,0);assert.equal(after.cursor,2)
  assert.equal(h.results.filter(row=>row.name==='resident_router_settle'&&!row.result.isError&&row.sessionId===before.activeSessionId).length,2);assert.equal(h.sent.length,0)
  const requests=h.requests.length
  await h.restart();await h.service.whenIdle()
  assert.equal(h.requests.length,requests);assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})).entries,recovered.entries)
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'legacy-router-pending-before-later-event',originalGeneration:before.generation,originalPacketPreserved:true,originalAdmissions:originalEntries.length,laterEventHandledSeparately:true,restartModelReplay:false,realVendorExecuted:false}))
})


for(const outcome of ['complete','newer-input','fails-again','unrelated-error'])test(outcome==='unrelated-error'?'an unsettled Router cannot mask an unrelated conversation recovery failure':outcome==='newer-input'?'an admitted failed Router checkpoint refuses a newer pending business input before inference':outcome==='fails-again'?'a second failed Router continuation retains its checkpoint history and cannot replay the consumed proof':'an admitted failed Router batch resumes only through an explicit Host checkpoint after strict cold recovery',{timeout:nativeTestTimeout(60000)},async t=>{
  const continuationAdmissions=[]
  let failModel=true,resumeEntered,releaseResume,holdResume=false,fatalConversation,continuationPacket,continuationSessionId,observeHandoffRecovery
  const entered=new Promise(resolve=>resumeEntered=resolve),released=new Promise(resolve=>releaseResume=resolve)
  const handoffEntered=Promise.withResolvers(),handoffReleased=Promise.withResolvers(),recoveryListed=Promise.withResolvers()
  t.after(()=>{releaseResume();handoffReleased.resolve()})
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary){if(outcome==='complete'){handoffEntered.resolve();await handoffReleased.promise}return summary}
    if(requestTools(body).includes('channel_triage_submit')){
      if(outcome==='newer-input'){
        const conversationId=h.host.ctx.channels.identity(channelMessage('explicit-failed-batch')).sessionId,taskId='paused-inbox-fixture'
        await h.store.command({id:'fixture-paused-task',kind:'task.create',args:{taskId,conversationId,groupId:conversationId,ownerActorId:'owner',request:'A paused task used only to produce real internal ledger events'}})
        // 29个正式内部变更加本次用户来源构成30项原批次，不放宽15条用户输入上限。
        for(let index=0;index<29;index++)await h.store.command({id:'fixture-paused-control-'+index,kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:index+1}})
      }
      return submit(triage(body),()=>({needsHandling:true}))
    }
    if(requestTools(body).includes('resident_router_settle')){
      if(continuationPacket)continuationAdmissions.push(await h.host.ctx.agents.get(continuationSessionId).admission.current())
      if(failModel)return {error:'TEST_ROUTER_MODEL_CHECKPOINT_FAILURE'}
      if(holdResume&&body.messages.at(-1)?.role!=='tool'){holdResume=false;resumeEntered();await released}
      return settle(body,router(body))
    }
    return {text:'No other work'}
  },{wrapStore:store=>({...store,query:q=>{
    if(fatalConversation&&q.kind==='router.inbox'&&q.conversationId===fatalConversation)throw Object.assign(Error('TEST_UNRELATED_ROUTER_STORE_FAILURE'),{code:'EACCES'})
    const result=store.query(q)
    if(observeHandoffRecovery&&q.kind==='router.list'){observeHandoffRecovery=false;recoveryListed.resolve()}
    return result
  }})})
  const message=channelMessage('explicit-failed-batch'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message)
  await assert.rejects(h.service.whenIdle(),{code:'ROUTER_BATCH_UNSETTLED'})
  const row=await h.query('router.get',{conversationId}),failed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  const business=failed.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.source.kind==='conversation-router')
  assert.equal(business.length,1)
  const assistant=failed.entries.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
  assert.equal(assistant.message.stopReason,'error');assert.match(assistant.message.errorMessage,/TEST_ROUTER_MODEL_CHECKPOINT_FAILURE/)
  const packetId=business[0].details.packetId
  assert.equal(failed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId).length,1)
  assert.equal(failed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packetId).length,1)
  const inbox=await h.query('router.inbox',{conversationId});assert.equal(inbox.length,outcome==='newer-input'?30:1);assert.equal(row.cursor,0)
  await h.close()
  const closed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true}),requests=h.requests.length
  await h.restart()
  assert.ok(h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'),'an unsettled batch remains an explicit degraded recovery issue')
  await h.service.recover()
  assert.equal(h.requests.length,requests,'cold and ordinary recovery must not replay an already admitted model turn')
  assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries.slice(0,closed.entries.length),closed.entries)
  const proof={conversationId,generation:row.generation,sessionId:row.activeSessionId,packetId,failedEntryId:assistant.id}
  async function rejectedWithoutInference(candidate){
    const count=h.requests.length
    await assert.rejects(h.service.resumeRouterBatch(candidate),error=>typeof error.code==='string'&&/^(?:PI_)?ROUTER_/.test(error.code))
    assert.equal(h.requests.length,count,'a refused continuation must not call the model')
  }
  for(const candidate of [{...proof,conversationId:'foreign-conversation'},{...proof,generation:row.generation+1},{...proof,sessionId:'foreign-router-session'},{...proof,packetId:packetId+':foreign'},{...proof,failedEntryId:business[0].id}])await rejectedWithoutInference(candidate)
  if(outcome==='unrelated-error'){
    const source=await h.query('source.get',{sourceId:inbox.find(event=>event.sourceId).sourceId}),other='unrelated-failed-conversation'
    await h.store.command({id:'fixture-unrelated-source',kind:'source.record-direct',args:{source:{sourceId:'unrelated-recovery-source',groupId:other,messageId:'unrelated-recovery-message',actorId:source.actorId,channel:source.channel,version:1,text:'A separate recovery scope must still be inspected',resources:[]},conversation:{conversationId:other}}})
    await h.store.command({id:'fixture-unrelated-triage',kind:'triage.commit',args:{dispositions:[{sourceId:'unrelated-recovery-source',messageVersion:1,needsHandling:true,reason:'A distinct pending recovery scope'}]}})
    const count=h.requests.length;fatalConversation=other
    try{await assert.rejects(h.service.recover(),{code:'EACCES'})}finally{fatalConversation=undefined}
    assert.equal(h.requests.length,count)
    assert.ok(h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'))
    assert.equal((await h.query('router.inbox',{conversationId:other})).length,1)
    assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries.slice(0,closed.entries.length),closed.entries)
    t.diagnostic(JSON.stringify({case:'unsettled-router-does-not-mask-other-recovery-error',originalUnsettledRetained:true,unrelatedStoreFailurePropagated:true,modelRequestsUnchanged:true,realVendorExecuted:false}))
    return
  }
  if(outcome==='newer-input'){
    const source=await h.query('source.get',{sourceId:inbox.find(event=>event.sourceId).sourceId})
    await h.store.command({id:'fixture-resume-later-source',kind:'source.record-direct',args:{source:{sourceId:'resume-later-source',groupId:conversationId,messageId:'resume-later-message',actorId:source.actorId,channel:source.channel,version:1,text:'A later input must not be bypassed by the old checkpoint',resources:[]},conversation:{conversationId}}})
    await h.store.command({id:'fixture-resume-later-triage',kind:'triage.commit',args:{dispositions:[{sourceId:'resume-later-source',messageVersion:1,needsHandling:true,reason:'The original failed batch is no longer the complete current inbox'}]}})
    await rejectedWithoutInference(proof)
    assert.equal((await h.query('router.inbox-count',{conversationId})),31)
    assert.deepEqual((await h.query('router.inbox',{conversationId})).map(event=>event.id),inbox.map(event=>event.id),'the later 31st event stays outside the default 30-item projection')
    assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries.slice(0,closed.entries.length),closed.entries)
    assert.equal(h.sent.length,0)
    t.diagnostic(JSON.stringify({case:'failed-router-newer-pending-refusal',originalBatch:30,pendingTotal:31,pagedOverflowInvisible:true,originalPrefixUnchanged:true,newerEventRetained:true,modelRequestsUnchanged:true,realVendorExecuted:false}))
    return
  }
  continuationPacket=failed.audit.find(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId).payload
  continuationSessionId=row.activeSessionId
  const priorCurrent=await h.host.ctx.agents.get(continuationSessionId).admission.current()
  assert.equal(priorCurrent,undefined,'cold recovery must not invent a current business turn')
  const assertOriginalAdmission=()=>{
    assert.ok(continuationAdmissions.length>0,'the actual model endpoint must observe the continuation')
    for(const admitted of continuationAdmissions)assert.deepEqual(admitted,{id:packetId,messages:[continuationPacket]},'memory must see only the exact original business packet, not the Host control message')
  }
  if(outcome==='fails-again'){
    await assert.rejects(h.service.resumeRouterBatch(proof),error=>typeof error.code==='string'&&/^(?:PI_)?ROUTER_/.test(error.code))
    assertOriginalAdmission()
    assert.equal(await h.host.ctx.agents.get(continuationSessionId).admission.current(),priorCurrent,'a failed continuation must restore the original current delegate')
    const again=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true}),latest=again.entries.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
    assert.equal(latest.message.stopReason,'error');assert.notEqual(latest.id,assistant.id)
    assert.deepEqual(again.entries.slice(0,closed.entries.length),closed.entries)
    assert.equal(again.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===packetId).length,1)
    assert.equal((await h.query('router.inbox',{conversationId})).length,1)
    assert.ok(h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'))
    const failedRequests=h.requests.length
    await h.restart();await rejectedWithoutInference(proof)
    assert.equal(h.requests.length,failedRequests);assert.equal((await h.query('router.get',{conversationId})).cursor,0)
    t.diagnostic(JSON.stringify({case:'router-continuation-fails-again',originalMemoryAdmissionBound:true,currentRestoredAfterFailure:true,newNativeFailureRetained:true,originalInputUnique:true,consumedCheckpointRefusedAfterCold:true,modelRequestsUnchangedAfterCold:true,realVendorExecuted:false}))
    return
  }
  failModel=false;holdResume=true
  const resumed=h.service.resumeRouterBatch(proof)
  try{await Promise.race([entered,resumed.then(()=>assert.fail('continuation completed before its model gate'))]);await rejectedWithoutInference(proof)}finally{releaseResume()}
  await Promise.race([handoffEntered.promise,resumed.then(()=>assert.fail('continuation completed before its handoff gate'))])
  observeHandoffRecovery=true
  const recovery=h.service.recover();void recovery.catch(()=>{})
  try{
    await recoveryListed.promise
    assert.equal((await h.query('router.get',{conversationId})).phase,'handoff')
    assert.equal(h.host.ctx.agents.get(continuationSessionId).lifecycle.signal.aborted,false,'ordinary recovery must not dispose the live handoff owner')
  }finally{handoffReleased.resolve()}
  await Promise.all([resumed,recovery]);await h.service.whenIdle();assertOriginalAdmission()
  const completed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true}),current=await h.query('router.get',{conversationId})
  assert.deepEqual(completed.entries.slice(0,closed.entries.length),closed.entries)
  assert.equal(completed.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===packetId).length,1)
  assert.equal(completed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packetId).length,1)
  assert.equal(completed.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packetId).length,1)
  assert.equal(h.results.filter(result=>result.name==='resident_router_settle'&&!result.result.isError&&result.sessionId===row.activeSessionId).length,1)
  assert.equal((await h.query('router.inbox',{conversationId})).length,0);assert.equal(current.cursor,1);assert.equal(current.generation,row.generation+1)
  const candidate=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.equal(candidate.header.conversationId,conversationId);assert.equal(candidate.header.generation,current.generation)
  const rotation=(await h.query('router.rotations',{conversationId})).find(item=>item.oldSessionId===row.activeSessionId&&item.state==='published')
  assert.equal(rotation?.candidateSessionId,current.activeSessionId)
  assert.ok(candidate.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff'&&entry.details.handoffId===rotation.id&&entry.details.conversationId===conversationId))
  await rejectedWithoutInference(proof)
  const finishedRequests=h.requests.length
  await h.restart();await h.service.whenIdle()
  assert.equal(h.requests.length,finishedRequests);assert.deepEqual((await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})).entries,completed.entries)
  await rejectedWithoutInference(proof)
  assert.ok(!h.service.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'),'only a settled batch clears its recovery issue')
  assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
  t.diagnostic(JSON.stringify({case:'explicit-failed-router-batch-continuation',originalMemoryAdmissionBound:true,liveHandoffRecoverySerialized:true,strictCold:true,originalPacketUnique:true,originalAdmissionUnique:true,originalPrefixUnchanged:true,concurrentAndStaleRejectedBeforeInference:true,settled:true,legalHandoff:true,coldReplay:false,realVendorExecuted:false}))
})

// 等待真实模型请求，关停必须先取消 SDK；放行模型夹具不能成为关闭条件。
test('Router close interrupts an active official Pi request before joining its tail without replaying the settled tool',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
  let requests=0,aborts=0,handle
  const h=await residentRouterHost(t,async body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){
      if(++requests===2){entered.resolve();await release.promise}
      return {tool:'resident_router_settle',args:{eventIds:router(body).events.map(event=>event.id),operationId:'shutdown-original-settle'}}
    }
    return {text:'No other work'}
  })
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'){
    handle=value;const abort=value.session.abort.bind(value.session);value.session.abort=async(...args)=>{aborts++;assert.equal(value.agent.lifecycle.signal.aborted,true);return abort(...args)}
  }return value}
  t.after(()=>{registry.create=create})
  const message=channelMessage('active-router-close'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message);await entered.promise
  assert.equal(handle.session.isStreaming,true);assert.equal(handle.agent.lifecycle.signal.aborted,false)
  const before=await h.query('router.get',{conversationId});assert.equal(before.cursor,1);assert.equal(before.generation,1)
  await h.close();assert.ok(aborts>0);assert.equal(handle.session.isStreaming,false);assert.equal(registry.get(before.activeSessionId),undefined)
  const cold=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  assert.equal(cold.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled').length,0)
  assert.equal(cold.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='resident_router_settle'&&!entry.message.isError).length,1)
  release.resolve();await h.restart();await h.service.whenIdle()
  assert.equal(requests,2,'cold recovery cannot issue the admitted business batch or repeat its settled tool')
  assert.equal((await h.query('router.get',{conversationId})).cursor,1);assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
})

test('Router close joins the exact native Pi cancellation during request preparation without replaying its committed tool',{timeout:nativeTestTimeout(40000)},async t=>{
 const entered=Promise.withResolvers();let handle,nativeSignal,prepares=0,requests=0,interrupted=false
 const h=await residentRouterHost(t,body=>{
  const summary=handoff(body);if(summary)return summary
  if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
  if(requestTools(body).includes('resident_router_settle')){requests++;return settle(body,router(body))}
  return {text:'No other work'}
 })
 const registry=h.host.ctx.agents,create=registry.create
 registry.create=async function(options){
  if(options.meta?.runtimeOwner==='conversation-router'){
   const beforeRequest=options.beforeRequest
   options={...options,beforeRequest:async(actor,...args)=>{
    await beforeRequest?.(actor,...args)
    if(++prepares!==2)return
    nativeSignal=actor.piSession.agent.signal;entered.resolve()
    await new Promise((resolve,reject)=>nativeSignal.addEventListener('abort',()=>reject(nativeSignal.reason),{once:true}))
   }}
  }
  const value=await create.call(this,options)
  if(options.meta?.runtimeOwner==='conversation-router'){
   handle=value;const interrupt=value.interrupt.bind(value)
   value.interrupt=(...args)=>{const result=interrupt(...args);void result.then(()=>{interrupted=true},()=>{});return result}
  }
  return value
 }
 t.after(()=>{registry.create=create})
 const message=channelMessage('native-prepare-cancel'),conversationId=h.host.ctx.channels.identity(message).sessionId
 await h.receive(message);await entered.promise
 const before=await h.query('router.get',{conversationId});assert.equal(before.cursor,1);assert.equal(requests,1)
 try{await h.close()}catch(error){
  const contains=value=>value===nativeSignal.reason||value?.errors?.some(contains)
  t.diagnostic(JSON.stringify({case:'native-prepare-cancel',interrupted,nativeAborted:nativeSignal.aborted,aggregateContainsExactNativeReason:!!contains(error)}))
  throw error
 }
 assert.equal(interrupted,true);assert.equal(nativeSignal.aborted,true);assert.equal(handle.session.isStreaming,false);assert.equal(registry.get(before.activeSessionId),undefined)
 const cold=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
 assert.equal(cold.audit.filter(row=>row.domain==='admission'&&row.kind==='cancelled').length,0)
 assert.equal(cold.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='resident_router_settle'&&!entry.message.isError).length,1)
 await h.restart();await h.service.whenIdle();assert.equal(requests,1);assert.equal((await h.query('router.get',{conversationId})).cursor,1)
})

test('Router close preserves an actually committed undelivered packet and cold recovery admits it only once',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers();let held=false,packet,handle,modelBatches=0
  const h=await residentRouterHost(t,body=>{
    const summary=handoff(body);if(summary)return summary
    if(requestTools(body).includes('channel_triage_submit'))return submit(triage(body),()=>({needsHandling:true}))
    if(requestTools(body).includes('resident_router_settle')){if(body.messages.at(-1)?.role!=='tool')modelBatches++;return settle(body,router(body))}
    return {text:'No other work'}
  })
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'&&!held){
    handle=value;const enqueue=value.enqueue.bind(value);value.enqueue=async input=>{const result=await enqueue(input);packet=structuredClone(input);held=true;entered.resolve();await new Promise((resolve,reject)=>{const signal=value.agent.lifecycle.signal;if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})});return result}
  }return value}
  t.after(()=>{registry.create=create})
  const message=channelMessage('pending-router-close'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message);await entered.promise
  const row=await h.query('router.get',{conversationId}),before=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  assert.equal(handle.agent.admission.status(packet.id),'pending');assert.equal(modelBatches,0)
  assert.deepEqual(before.audit.filter(receipt=>receipt.domain==='admission').map(receipt=>receipt.kind),['enqueued'])
  await h.close()
  const closed=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  assert.deepEqual(closed.audit,before.audit);assert.deepEqual(closed.audit.find(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued').payload,packet)
  await h.restart();await h.service.whenIdle()
  const cold=await h.host.ctx.sessionPersistence.readNative(row.activeSessionId,{requireComplete:true})
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id===packet.id).length,1)
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packet.id).length,1)
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='cancelled').length,0);assert.equal(modelBatches,1)
  const requests=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,requests)
  assert.equal((await h.query('router.inbox',{conversationId})).length,0)
})

test('Router close joins and disposes an actual late-created official handle without admitting a batch or rotating generation',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let handle
  const h=await residentRouterHost(t,body=>requestTools(body).includes('channel_triage_submit')?submit(triage(body),()=>({needsHandling:true})):{text:'No Router dispatch expected'})
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'){handle=value;entered.resolve();await release.promise}return value}
  t.after(()=>{registry.create=create})
  const message=channelMessage('opening-router-close'),conversationId=h.host.ctx.channels.identity(message).sessionId
  await h.receive(message);await entered.promise;const before=await h.query('router.get',{conversationId});assert.equal(registry.get(before.activeSessionId),handle.agent)
  let finished=false;const closing=h.close().then(()=>{finished=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false)
  release.resolve();await closing
  assert.equal(handle.agent.lifecycle.signal.aborted,true);assert.equal(registry.get(before.activeSessionId),undefined)
  const cold=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
  assert.equal(cold.audit.filter(receipt=>receipt.domain==='admission').length,0);assert.equal(cold.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff').length,0)
  assert.equal(cold.header.generation,before.generation);assert.equal(before.cursor,0);assert.equal(h.requests.length,1)
})

test('Router close cannot swallow an admission PAUSED failure produced before its own interruption',{timeout:nativeTestTimeout(40000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),aborted=Promise.withResolvers();t.after(()=>release.resolve());let prior;const trace=[]
  const h=await residentRouterHost(t,body=>requestTools(body).includes('channel_triage_submit')?submit(triage(body),()=>({needsHandling:true})):{text:'No Router dispatch expected'})
  const registry=h.host.ctx.agents,create=registry.create
  registry.create=async function(options){const value=await create.call(this,options);if(options.meta?.runtimeOwner==='conversation-router'){
    const interrupt=value.interrupt.bind(value),dispose=value.dispose.bind(value)
    value.interrupt=(...args)=>{trace.push({at:'interrupt',priorCode:prior?.code,sameReason:prior===value.agent.lifecycle.signal.reason});return interrupt(...args)}
    value.dispose=(...args)=>{trace.push({at:'dispose',aborted:value.agent.lifecycle.signal.aborted});return dispose(...args)}
    value.agent.lifecycle.signal.addEventListener('abort',()=>{trace.push({at:'abort',code:value.agent.lifecycle.signal.reason?.code});aborted.resolve()},{once:true})
    const maintenance=Error('maintenance failed before shutdown');await assert.rejects(value.runMaintenance(()=>{throw maintenance}),error=>error===maintenance)
    const deliver=value.deliver.bind(value);value.deliver=async(...args)=>{try{return await deliver(...args)}catch(error){prior=error;entered.resolve();await release.promise;throw error}}
  }return value}
  t.after(()=>{registry.create=create})
  await h.receive(channelMessage('paused-router-close'));await entered.promise;assert.equal(prior.code,'PI_BUSINESS_ADMISSION_PAUSED')
  const closing=h.close(),rejected=assert.rejects(closing,error=>{const contains=value=>value===prior||value?.errors?.some(contains);return contains(error)})
  await aborted.promise;trace.push({at:'release',code:prior.code,safe:prior.routerSafeToResume});t.diagnostic(JSON.stringify({pausedCloseTrace:trace}));release.resolve();await rejected;assert.equal(h.requests.length,1)
})
