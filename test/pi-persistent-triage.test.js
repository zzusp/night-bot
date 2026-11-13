import test from 'node:test'
import assert from 'node:assert/strict'
import {SettingsManager,shouldCompact} from '@earendil-works/pi-coding-agent'
import {officialTriageCompactionSettings} from '../src/runtime/pi-official-settings.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

const input=body=>requestEnvelope(body,'一级分诊请求：')
const submit=body=>({tool:'channel_triage_submit',args:{dispositions:input(body).messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:false,reason:'Current batch only',reply:'Received '+source.messageId}))}})
const sessions=h=>h.host.ctx.agents.list().filter(actor=>actor.metadata.runtimeOwner==='channel-triage')

test('triage 64K budget uses actual model window with native compaction and leaves Router policy separate',()=>{
 for(const window of [32768,65536,262144,1000000]){
  const model=Object.freeze({provider:'fixture',id:'m',contextWindow:window}),settings=SettingsManager.inMemory({compaction:officialTriageCompactionSettings(model)}).getCompactionSettings(model)
  const threshold=Math.min(window,65536)-16384
  assert.equal(shouldCompact(threshold,window,settings),false);assert.equal(shouldCompact(threshold+1,window,settings),true)
  assert.ok(settings.keepRecentTokens<threshold);assert.equal(model.contextWindow,window)
 }
 assert.throws(()=>officialTriageCompactionSettings({provider:'fixture',id:'m',contextWindow:16384}),{code:'PI_TRIAGE_CONTEXT_WINDOW_INVALID'})
})

test('triage reuses history between batches and cold resumes without replaying replies; conversations remain isolated',{timeout:nativeTestTimeout(60000)},async t=>{
 const h=await residentRouterHost(t,body=>{assert.ok(requestTools(body).includes('channel_triage_submit'));return submit(body)})
 await h.receive(channelMessage('one',{text:'Original first context'}));await h.service.whenIdle()
 const first=sessions(h)[0];assert.ok(first)
 await h.receive(channelMessage('two'));await h.service.whenIdle()
 assert.equal(sessions(h)[0],first)
 assert.match(JSON.stringify(h.requests.at(-1)),/Original first context/)
 assert.equal(h.sent.length,2)
 await h.receive(channelMessage('other',{conversationId:'other-room'}));await h.service.whenIdle()
 assert.equal(sessions(h).length,2);assert.doesNotMatch(JSON.stringify(h.requests.at(-1)),/Original first context/)
 const before=await h.host.ctx.sessionPersistence.readNative(first.id,{requireComplete:true})
 await h.restart();await h.service.whenIdle();assert.equal(h.sent.length,3)
 await h.receive(channelMessage('three'));await h.service.whenIdle()
 assert.equal(sessions(h)[0].id,first.id);assert.equal(h.sent.length,4)
 assert.ok(h.service.listPerformance({sessionId:first.id}).rows.some(row=>row.phaseMs['session-resume']?.count>0),'cold resume preparation phase is retained')
 const after=await h.host.ctx.sessionPersistence.readNative(first.id,{requireComplete:true})
 assert.deepEqual(after.entries.slice(0,before.entries.length),before.entries)
 assert.equal(after.entries.filter(e=>e.customType==='night.business-input').length,3)
 assert.match(JSON.stringify(h.requests.at(-1)),/Original first context/)
 await h.receive(channelMessage('one',{text:'Original first context'}));await h.service.whenIdle();assert.equal(h.sent.length,4)
})

for(const mode of ['manual','automatic'])test(`persistent triage ${mode} Pi compaction keeps session and accepts only the new batch`,{timeout:nativeTestTimeout(60000)},async t=>{
 let summaries=0
 const h=await residentRouterHost(t,body=>{
  if(requestTools(body).includes('channel_triage_submit'))return submit(body)
  summaries++;return {text:'# Goal\nClassify only new messages.\n# Progress\nPrevious batches already received replies.\n# Critical Context\nOld input is background, never resubmit it.'}
 })
 await h.receive(channelMessage('long-1',{text:'context '.repeat(1200)}));await h.service.whenIdle()
 await h.receive(channelMessage('long-2',{text:'second '.repeat(1200)}));await h.service.whenIdle()
 const actor=sessions(h)[0],old=await h.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
 actor.piSession.settingsManager.applyOverrides({compaction:{modelOverrides:{'fixture/m':{keepRecentTokens:200,...mode==='automatic'?{reserveTokens:262144-2000}:{}}}}})
 if(mode==='manual'){await actor.piSession.compact();await actor.receipts.commit()}
 await h.receive(channelMessage('after-compaction'));await h.service.whenIdle()
 assert.ok(summaries>0);assert.equal(sessions(h)[0],actor);assert.equal(h.sent.length,3)
 const native=await h.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
 assert.ok(native.entries.some(e=>e.type==='compaction'));assert.deepEqual(native.entries.slice(0,old.entries.length),old.entries)
 assert.equal(native.entries.filter(e=>e.customType==='night.business-input').length,3)
 assert.equal(h.sent.at(-1).replyToMessageId,'after-compaction')
})

test('old batch dispositions cannot close a later batch; correction remains in the same session',{timeout:nativeTestTimeout(60000)},async t=>{
 let prior,bad=false
 const h=await residentRouterHost(t,body=>{
  const value=submit(body)
  if(input(body).messages[0].messageId==='later'&&!bad){bad=true;return prior}
  prior??=value
  return value
 })
 await h.receive(channelMessage('earlier'));await h.service.whenIdle()
 const actor=sessions(h)[0]
 await h.receive(channelMessage('later'));await h.service.whenIdle()
 assert.equal(sessions(h)[0],actor);assert.equal(h.sent.length,2)
 assert.equal((await h.query('source.list')).filter(source=>source.routed).length,2)
 assert.ok(h.results.some(row=>row.name==='channel_triage_submit'&&JSON.stringify(row.result).includes('TRIAGE_')),'stale old-batch submission is rejected before the model corrects it')
})

test('in-flight replaced source drains and resumes the same journal; later batches do not replay the old version',{timeout:nativeTestTimeout(60000)},async t=>{
 let held=false;const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const h=await residentRouterHost(t,async body=>{
  if(!held){held=true;entered.resolve();await release.promise}
  return submit(body)
 })
 const original=channelMessage('edited',{text:'old version'})
 await h.receive(original);await entered.promise
 const actor=sessions(h)[0]
 await h.receive({...original,messageVersion:2,text:'corrected version'})
 release.resolve();await h.service.whenIdle()
 assert.equal(sessions(h)[0].id,actor.id);assert.equal(h.sent.length,1)
 assert.equal((await h.query('notification.list'))[0].payload.sourceRef.messageVersion,2)
 await h.receive(channelMessage('next'));await h.service.whenIdle()
 assert.equal(sessions(h)[0].id,actor.id);assert.equal(h.sent.length,2)
 assert.ok((await h.query('source.list')).filter(source=>source.messageId==='edited'&&source.version===2).every(source=>source.routed))
})

test('cold recovery retires an enqueued but unadmitted triage packet and classifies only ledger pending sources',{timeout:nativeTestTimeout(60000)},async t=>{
 const h=await residentRouterHost(t,submit)
 const factory=h.host.ctx.agents.factory,create=factory.createAgent
 let sessionId,packetId
 t.mock.method(factory,'createAgent',async function(ctx,options){
  const handle=await create.call(this,ctx,options)
  if(options.meta?.runtimeOwner==='channel-triage'){
   sessionId=handle.agent.id;const enqueue=handle.enqueue
   handle.enqueue=async packet=>{await enqueue(packet);packetId=packet.id;throw Error('fixture stops after durable enqueue before admission')}
  }
  return handle
 })
 await h.receive(channelMessage('pending-crash'));await h.service.whenIdle()
 assert.equal(h.requests.length,0);assert.equal(h.sent.length,0)
 const before=await h.host.ctx.sessionPersistence.readNative(sessionId,{requireComplete:true})
 assert.ok(before.entries.some(e=>e.data?.domain==='admission'&&e.data.kind==='enqueued'&&e.data.payload.id===packetId))
 assert.ok(!before.entries.some(e=>e.customType==='night.business-input'))
 await h.restart();await h.service.whenIdle()
 assert.equal(sessions(h)[0].id,sessionId);assert.equal(h.sent.length,1);assert.equal(h.requests.length,1)
 const after=await h.host.ctx.sessionPersistence.readNative(sessionId,{requireComplete:true})
 assert.ok(after.entries.some(e=>e.data?.domain==='admission'&&e.data.kind==='cancelled'&&e.data.payload.id===packetId))
 assert.equal(after.entries.filter(e=>e.customType==='night.business-input').length,1)
 assert.deepEqual(after.entries.slice(0,before.entries.length),before.entries)
})

test('model failure drains the owner and later input resumes the same triage session',{timeout:nativeTestTimeout(60000)},async t=>{
 let fail=true
 const h=await residentRouterHost(t,body=>fail?{error:'invalid fixture request'}:submit(body))
 const original=channelMessage('failed-model')
 await h.receive(original);await h.service.whenIdle()
 const sources=await h.query('source.list');assert.notEqual(sources[0].routed,true)
 const firstSpan=sources[0].stages.find(stage=>stage.stage==='triage');assert.ok(firstSpan)
 fail=false
 await h.receive(channelMessage('after-model-failure'));await h.service.whenIdle()
 assert.equal(sessions(h)[0].id,firstSpan.sessionId)
 assert.equal((await h.query('source.list')).filter(source=>source.routed).length,2)
 assert.equal(h.sent.length,2)
})

test('close during session creation drains the late owner and never delivers the batch',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {createChannelTriage}=await import('../src/channels/resident-router-business.js')
 const root=await mkdtemp(join(tmpdir(),'triage-close-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let disposed=0,delivered=0
 const handle={dispose:async()=>{disposed++},deliver:async()=>{delivered++}}
 const ctx={get:name=>name==='sessionPersistence'?{stat:async()=>undefined}:{create:async()=>{entered.resolve();await release.promise;return handle}}}
 const triage=createChannelTriage({ctx,root,models:{},legacy:{getAgentConfig:()=>({agentPreset:'fixture'})},responsibilityFor:()=>'',commit:async()=>{throw Error('must not commit')}})
 const running=triage.run('room',[{sourceId:'s',messageId:'m',version:1}]);await entered.promise
 await triage.close();release.resolve()
 await assert.rejects(running,{code:'TRIAGE_CLOSED'});assert.equal(disposed,1);assert.equal(delivered,0)
})
