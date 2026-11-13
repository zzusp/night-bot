import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const mode of ['manual','automatic'])test(`native Pi ${mode} compaction preserves Router identity, journal and subsequent business delivery`,{timeout:nativeTestTimeout(60000)},async t=>{
 let summaries=0
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){
   const input=requestEnvelope(body,'一级分诊请求：')
   return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(s=>({sourceId:s.sourceId,messageVersion:s.version,needsHandling:true,reason:'fixture'}))}}
  }
  if(tools.includes('resident_router_settle')){
   if(body.messages.at(-1)?.role==='tool')return {text:'Settled'}
   const input=requestEnvelope(body,'Router 请求：')
   return {tool:'resident_router_settle',args:{operationId:'compact-settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)}}
  }
  assert.equal(requestEnvelope(body,'Router 交接请求：'),undefined)
  summaries++
  return {text:'# Goal\nContinue the original conversation.\n# Progress\nEarlier input was processed; preserve source references and query current task state when needed.'}
 })
 const message=channelMessage('before-compact',{text:'Original source '+ 'fixture evidence '.repeat(500)}),conversationId=h.host.ctx.channels.identity(message).sessionId
 await h.receive(message);await h.service.whenIdle()
 await h.receive(channelMessage('before-compact-2',{text:'Second source '+ 'more evidence '.repeat(500)}));await h.service.whenIdle()
 const before=await h.query('router.get',{conversationId}),actor=h.host.ctx.agents.get(before.activeSessionId)
 const old=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
 // Exercise Pi's real summarizer/projection, not a substitute compressor.
 // A smaller fixture waterline avoids filling a real 256K model window.
 actor.piSession.settingsManager.applyOverrides({compaction:{modelOverrides:{'fixture/m':{keepRecentTokens:200,...mode==='automatic'?{reserveTokens:262144-2000}:{}}}}})
 if(mode==='manual'){await actor.piSession.compact();await actor.receipts.commit()}
 await h.receive(channelMessage('after-compact'));await h.service.whenIdle()
 assert.ok(summaries>0)
 const after=await h.query('router.get',{conversationId}),native=await h.host.ctx.sessionPersistence.readNative(after.activeSessionId,{requireComplete:true})
 assert.equal(after.activeSessionId,before.activeSessionId);assert.equal(after.generation,before.generation)
 assert.equal(after.cursor,3);assert.deepEqual(await h.query('router.rotations',{conversationId}),[])
 assert.ok(!(await h.query('router.pending-conversations')).includes(conversationId),'settled persistent history is not pending recovery')
 assert.deepEqual(native.entries.slice(0,old.entries.length),old.entries)
 assert.ok(native.entries.some(e=>e.type==='compaction'))
 assert.equal(native.entries.filter(e=>e.customType==='night.business-input').length,3)
 await h.restart();await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,before.activeSessionId)
})

test('a pre-upgrade unprepared handoff cold-recovers the original owner before new input',{timeout:nativeTestTimeout(40000)},async t=>{
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(s=>({sourceId:s.sourceId,messageVersion:s.version,needsHandling:true,reason:'fixture'}))}}}
  if(tools.includes('resident_router_settle')){if(body.messages.at(-1)?.role==='tool')return {text:'Settled'};const input=requestEnvelope(body,'Router 请求：');return {tool:'resident_router_settle',args:{operationId:'legacy-settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)}}}
  throw new Error('No new handoff model request is allowed')
 })
 const message=channelMessage('legacy-before'),conversationId=h.host.ctx.channels.identity(message).sessionId
 await h.receive(message);await h.service.whenIdle()
 const before=await h.query('router.get',{conversationId}),count=h.requests.length
 await h.store.command({id:'legacy-unprepared',kind:'router.handoff.begin',args:{conversationId,generation:before.generation,handoffId:'legacy-unprepared'}})
 assert.equal((await h.query('router.get',{conversationId})).phase,'handoff')
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,count,'recovery is not a replayed summarization/business turn')
 const recovered=await h.query('router.get',{conversationId})
 assert.equal(recovered.phase,'active');assert.equal(recovered.activeSessionId,before.activeSessionId)
 assert.equal((await h.query('router.rotations',{conversationId}))[0].state,'aborted')
 await h.receive(channelMessage('legacy-after'));await h.service.whenIdle()
 const current=await h.query('router.get',{conversationId})
 assert.equal(current.activeSessionId,before.activeSessionId);assert.equal(current.cursor,2)
 assert.equal((await h.query('router.inbox',{conversationId})).length,0)
})
