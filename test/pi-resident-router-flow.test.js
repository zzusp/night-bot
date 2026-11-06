import test from 'node:test'
import assert from 'node:assert/strict'
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

for(const invalid of ['blank-intent','missing-source','utf8-budget'])test(`invalid tool-free handoff retains the current native generation without publishing a candidate: ${invalid}`,{timeout:nativeTestTimeout(40000)},async t=>{
  let summaries=0
  const h=await residentRouterHost(t,body=>{
    const input=requestEnvelope(body,'Router 交接请求：')
    if(input&&!requestTools(body).length){
      summaries++
      const value={currentIntent:'Preserve the original request',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff}
      if(invalid==='blank-intent')value.currentIntent='   '
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
  const current=await h.query('router.get',{conversationId}),rotations=await h.query('router.rotations',{conversationId})
  assert.equal(current.generation,1);assert.equal(current.phase,'active');assert.equal(current.cursor,1);assert.equal(current.lastHandoffCursor,0)
  assert.ok(rotations.length>0);assert.ok(rotations.every(row=>row.state==='aborted'&&!row.candidateSessionId))
  assert.equal((await h.query('router.inbox',{conversationId})).length,0,'committed handling is not replayed when its later summary fails')
  const saved=await h.host.ctx.sessionPersistence.readNative(current.activeSessionId,{requireComplete:true})
  assert.equal(saved.header.generation,1);assert.ok(saved.entries.some(entry=>entry.customType==='night.commit'))
  assert.equal((await h.query('task.list')).length,0)
})
