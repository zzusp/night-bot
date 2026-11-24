import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'
import {routerCompactionTimes} from '../packages/web-console/server/router-compaction-times.js'
import {routerSessionView} from '../packages/web-console/server/session-view.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {getCurrentSystemMessage} from '@earendil-works/pi-ai'

test('real resident Router adopts detached native compaction, cold restores it and never replays settled input',{timeout:nativeTestTimeout(120000)},async t=>{
 let summaries=0,settles=0,shortReply=false
 const gate=Promise.withResolvers()
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('resident_router_settle')){
   if(body.messages.at(-1)?.role==='tool')return {text:shortReply?'Concurrent result retained after summary.':'Committed durable disposition. '+('Historical detail retained for compaction. '.repeat(1600))}
   const input=requestEnvelope(body,'Router 请求：');settles++
   return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'bg-settle:'+input.events.map(event=>event.id).join(',')}}
  }
  assert.match(JSON.stringify(body),/NIGHT_ROLE_SUMMARY=router/)
  if(++summaries===1)await gate.promise
  return {text:'All prior source events were settled through durable receipts. Do not repeat them. Continue with the next new source.'}
 },{hostOptions:{hostConfig:config=>{config.providers.fixture.models[0].contextWindow=131072;return config}}})
 const phases=[]
 h.host.ctx.on('night/agent-observation',(_actor,record)=>{if(record.summary?.phase)phases.push(record.summary.phase)})
 const input=channelMessage('background-0'),conversationId=h.host.ctx.channels.identity(input).sessionId
 let sessionId,entry,prior,systemBefore,tailEntries
 try{
  for(let i=0;i<8&&!summaries;i++){
   const message=channelMessage('background-'+i)
   await h.receive(message);await h.service.whenIdle()
   const state=await h.query('router.get',{conversationId})
   sessionId??=state.activeSessionId;assert.equal(state.activeSessionId,sessionId)
   const actor=h.host.ctx.agents.get(sessionId)
   await actor.whenIdle()
   await new Promise(resolve=>setTimeout(resolve,100))
   t.diagnostic(JSON.stringify({round:i,tokens:actor.piSession.getContextUsage()?.tokens,summaries}))
  }
  await eventually(()=>summaries===1,'first Router summary is in progress')
  const manager=h.host.ctx.agents.get(sessionId).piSession.sessionManager
  const before=manager.getEntryCount()
  shortReply=true
  prior=channelMessage('during-background-summary')
  await h.receive(prior);await h.service.whenIdle()
  assert.equal((await h.query('router.inbox',{conversationId})).length,0,'new input settles before the summary returns')
  const newIds=new Set(manager.getEntries().slice(before).map(e=>e.id))
  tailEntries=manager.buildSessionProjection().entries.filter(({sourceEntry,messages})=>newIds.has(sourceEntry.id)&&messages.some(message=>message.role!=='system'))
  assert.ok(tailEntries.some(({messages})=>messages.some(message=>message.role==='toolResult')))
  systemBefore=getCurrentSystemMessage(manager.buildSessionProjection().messages)
  assert.equal(summaries,1)
  assert.equal(phases.includes('background-compaction-cancelled'),false)
 }finally{gate.resolve()}
 const actor=h.host.ctx.agents.get(sessionId)
 entry=await eventually(()=>actor.piSession.sessionManager.getEntries().find(e=>e.type==='compaction'),'native compaction published')
 assert.ok(summaries>0)
 await eventually(()=>phases.includes('background-compaction-adopted'),'background adoption observation')
 assert.ok(phases.includes('background-compaction'))
 const timing=await eventually(async()=>{const value=await routerCompactionTimes(h.service,conversationId,8);return value.items.some(item=>item.compaction.status==='recorded')&&value},'real adopted compaction timing projection')
 assert.ok(timing.items.every(item=>Number.isFinite(item.compaction.durationMs)&&item.compaction.durationMs>=0))
 assert.equal(timing.items.filter(item=>item.compaction.status==='recorded').length,phases.filter(phase=>phase==='background-compaction-adopted').length,'each adopted compaction appears once')
 assert.doesNotMatch(JSON.stringify(timing),/sourceId|spanId|summary|prior source events/)
 const noInputRequests=h.requests.length
 assert.deepEqual(await routerCompactionTimes(h.service,conversationId,8),timing,'same retained compaction is independently readable without any new input')
 assert.equal(h.requests.length,noInputRequests)
 assert.equal(phases.includes('foreground-compaction'),false,'fixture stays below hard fallback; compaction is truly background')
 assert.match(entry.summary,/prior source events/)
 const projected=actor.piSession.sessionManager.buildSessionProjection()
 for(const prior of tailEntries)assert.deepEqual(projected.entries.find(row=>row.sourceEntry.id===prior.sourceEntry.id),prior,'new input, assistant and tool result retain their original native entries')
 const systemAfter=getCurrentSystemMessage(projected.messages)
 assert.ok(systemBefore.sections['night_'+Buffer.from('conversation-state').toString('hex')])
 assert.deepEqual({...systemAfter,timestamp:systemBefore.timestamp},systemBefore,'Pi checkpoints the latest effective prompt and tool declarations')
 const stored=await h.host.ctx.sessionPersistence.readNative(sessionId)
 assert.ok(stored.entries.some(e=>e.id===entry.id&&e.type==='compaction'))
 const history=()=>routerSessionView({conversationId,readRouter:()=>h.query('router.get',{conversationId}),persistence:h.host.ctx.sessionPersistence,
  executionActivity:true,stream:true,readExecutionTiming:scope=>h.service.executionHistoryTiming(scope)})
 const completed=await eventually(async()=>(await history()).items.find(row=>row.kind==='compaction'&&row.compaction.mode==='background'),'same committed background compaction duration in history')
 assert.ok(completed.compaction.summaryHidden)
 const observed=h.service.executionHistoryTiming({sessionId,conversationId,generation:(await h.query('router.get',{conversationId})).generation}).compaction(entry.id)
 assert.ok(Number.isFinite(observed?.durationMs)&&observed.durationMs>=0)
 assert.equal(completed.timing.durationMs,observed.durationMs)
 const originalCount=settles,requests=h.requests.length
 await h.restart()
 await h.receive(prior);await h.service.whenIdle()
 assert.equal(settles,originalCount,'cold duplicate does not repeat Router settle effect')
 assert.equal(h.requests.length,requests,'cold duplicate does not re-run Router')
 const cold=await h.host.ctx.sessionPersistence.readNative(sessionId)
 assert.ok(cold.entries.some(e=>e.id===entry.id),'native compaction survives strict journal reopening')
 const restored=(await history()).items.find(row=>row.id===completed.id)
 assert.deepEqual(restored?.timing,completed.timing)
 assert.deepEqual(restored?.compaction,completed.compaction)
 await h.receive(channelMessage('after-background-restart'));await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,sessionId,'same durable Router identity')
 assert.equal(settles,originalCount+1,'new input executes exactly once after restart')
 assert.equal((await h.query('router.inbox',{conversationId})).length,0)
 assert.ok(h.host.ctx.agents.get(sessionId).piSession.sessionManager.getEntries().some(e=>e.id===entry.id))
 assert.deepEqual(h.errors,[])
})
