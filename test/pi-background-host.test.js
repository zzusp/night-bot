import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

test('real resident Router adopts detached native compaction, cold restores it and never replays settled input',{timeout:nativeTestTimeout(120000)},async t=>{
 let summaries=0,settles=0
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){
   const input=requestEnvelope(body,'一级分诊请求：')
   return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(message=>({sourceId:message.sourceId,messageVersion:message.version??message.messageVersion,needsHandling:true,reason:'Forward original source'}))}}
  }
  if(tools.includes('resident_router_settle')){
   if(body.messages.at(-1)?.role==='tool')return {text:'Committed durable disposition. '+('Historical detail retained for compaction. '.repeat(1600))}
   const input=requestEnvelope(body,'Router 请求：');settles++
   return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'bg-settle:'+input.events.map(event=>event.id).join(',')}}
  }
  assert.match(JSON.stringify(body),/NIGHT_ROLE_SUMMARY=router/)
  summaries++
  return {text:'All prior source events were settled through durable receipts. Do not repeat them. Continue with the next new source.'}
 },{hostOptions:{hostConfig:config=>{config.providers.fixture.models[0].contextWindow=131072;return config}}})
 const phases=[]
 h.host.ctx.on('night/agent-observation',(_actor,record)=>{if(record.summary?.phase)phases.push(record.summary.phase)})
 const input=channelMessage('background-0'),conversationId=h.host.ctx.channels.identity(input).sessionId
 let sessionId,entry,prior
 for(let i=0;i<8&&!entry;i++){
  const message=channelMessage('background-'+i)
  await h.receive(message);await h.service.whenIdle()
  const state=await h.query('router.get',{conversationId})
  sessionId??=state.activeSessionId;assert.equal(state.activeSessionId,sessionId)
  const actor=h.host.ctx.agents.get(sessionId)
  await actor.whenIdle()
  await new Promise(resolve=>setTimeout(resolve,100))
  entry=actor.piSession.sessionManager.getEntries().find(e=>e.type==='compaction')
  prior=message
  t.diagnostic(JSON.stringify({round:i,tokens:actor.piSession.getContextUsage()?.tokens,summaries,compacted:!!entry}))
 }
 const actor=h.host.ctx.agents.get(sessionId)
 entry=await eventually(()=>actor.piSession.sessionManager.getEntries().find(e=>e.type==='compaction'),'native compaction published')
 assert.ok(summaries>0)
 await eventually(()=>phases.includes('background-compaction-adopted'),'background adoption observation')
 assert.ok(phases.includes('background-compaction'))
 assert.equal(phases.includes('foreground-compaction'),false,'fixture stays below hard fallback; compaction is truly background')
 assert.match(entry.summary,/prior source events/)
 const stored=await h.host.ctx.sessionPersistence.readNative(sessionId)
 assert.ok(stored.entries.some(e=>e.id===entry.id&&e.type==='compaction'))
 const originalCount=settles,requests=h.requests.length
 await h.restart()
 await h.receive(prior);await h.service.whenIdle()
 assert.equal(settles,originalCount,'cold duplicate does not repeat Router settle effect')
 assert.equal(h.requests.length,requests,'cold duplicate does not re-run triage or router')
 const cold=await h.host.ctx.sessionPersistence.readNative(sessionId)
 assert.ok(cold.entries.some(e=>e.id===entry.id),'native compaction survives strict journal reopening')
 await h.receive(channelMessage('after-background-restart'));await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,sessionId,'same durable Router identity')
 assert.equal(settles,originalCount+1,'new input executes exactly once after restart')
 assert.equal((await h.query('router.inbox',{conversationId})).length,0)
 assert.ok(h.host.ctx.agents.get(sessionId).piSession.sessionManager.getEntries().some(e=>e.id===entry.id))
 assert.deepEqual(h.errors,[])
})
