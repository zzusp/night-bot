import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {MODEL_ROLES,resolveRoleModels} from '../src/role-models.js'
import {taskNotificationRecovery} from '../packages/dingtalk-core/notification-delivery.js'
import {triageSessionId} from '../src/channels/triage.js'
const router=body=>requestEnvelope(body,'Router 请求：')
const isSettleResult=body=>body.messages.at(-1)?.role==='tool'&&body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle'
const settle=(input,outcome='context-only')=>({tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome,sourceQuote:event.source.text,reason:'Synthetic disposition based on this exact message'}))}})
function checked(body){assert.ok(!requestTools(body).includes('channel_triage_submit'),'no first-tier model request');return router(body)}

test('direct Router keeps silent background in the original bounded session, answers, isolates channels and never sends triage acknowledgement',{timeout:nativeTestTimeout(45000)},async t=>{
 const answered=new Set(),seen=[]
 const h=await residentRouterHost(t,body=>{
  const input=checked(body);if(!input)return {text:'No work'}
  if(isSettleResult(body))return {text:'Done'}
  const source=input.events.find(event=>event.source)?.source
  if(!source)return settle(input)
  seen.push({id:source.messageId,session:input.conversationId,text:requestText(body).join('\n')})
  if(source.text.startsWith('ASK')){
   assert.ok(requestText(body).some(text=>text.includes('BACKGROUND violet-42')),'prior silent message is present without a lookup')
   if(!answered.has(source.sourceId)){answered.add(source.sourceId);return {tool:'resident_router_reply',args:{operationId:'answer:'+source.sourceId,sourceId:source.sourceId,messageVersion:source.version,text:'The supplied background says violet-42.'}}}
   return settle(input,'handled-inline')
  }
  if(source.text==='OTHER')assert.ok(!JSON.stringify(body.messages).includes('violet-42'),'other channel cannot see original context')
  return settle(input)
 })
 assert.deepEqual(MODEL_ROLES,['router','task'])
 assert.equal(resolveRoleModels({...h.config,roleModels:{triage:{provider:'retired-missing-provider',model:'retired'}}},{NIGHT_BOT_TRIAGE_MODEL:'ignored'}).triage,undefined)
 const background=channelMessage('background',{text:'BACKGROUND violet-42 is context only, no work requested.'})
 await h.receive(background);await h.service.whenIdle()
 assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
 const conversationId=h.host.ctx.channels.identity(background).sessionId,first=await h.query('router.get',{conversationId})
 await assert.rejects(h.service.retryMessageProcessing({groupId:conversationId,phase:'triage'}),{code:'TOPIC_ROUTING_RETIRED'})
 assert.equal(await h.host.ctx.sessionPersistence.stat(triageSessionId(conversationId)),undefined)
 await h.receive(channelMessage('ask',{text:'ASK what label was supplied? Query only.'}));await h.service.whenIdle()
 assert.equal(h.sent.length,1);assert.equal((await h.query('notification.list'))[0].kind,'router-reply')
 await h.receive(channelMessage('other',{conversationId:'other-room',text:'OTHER'}));await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,first.activeSessionId)
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count)
 await h.receive(background);await h.service.whenIdle();assert.equal(h.requests.length,count);assert.equal(h.sent.length,1)
 assert.equal(await h.query('router.inbox-count',{conversationId}),0)
 assert.ok(!h.requests.some(body=>requestTools(body).includes('channel_triage_submit')))
})

test('direct Router dispatches explicit work but answers an independent message while execution waits',{timeout:nativeTestTimeout(45000)},async t=>{
 let planned=false,answered=false
 const h=await residentRouterHost(t,body=>{
  if(requestTools(body).includes('task_result'))return {tool:'task_result',args:{decision:{action:'wait',summary:'Synthetic execution is waiting for input',evidence:[],limitations:[]}}}
  const input=checked(body);if(!input)return {text:'No work'}
  if(isSettleResult(body))return {text:'Done'}
  const event=input.events.find(event=>event.source)
  if(!event)return settle(input)
  if(event.source.text==='EXPLICIT task'){
   if(!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'plan-explicit',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'direct-work',title:'Synthetic work',objective:'Read-only synthetic work',requirements:['No external changes']}],dependencies:[]}}}
   return settle(input)
  }
  if(!answered){answered=true;return {tool:'resident_router_reply',args:{operationId:'independent-answer',sourceId:event.sourceId,messageVersion:event.messageVersion,text:'Independent query answered without waiting for the task.'}}}
  return settle(input,'handled-inline')
 })
 await h.receive(channelMessage('work',{text:'EXPLICIT task'}));await h.service.whenIdle()
 assert.equal((await h.query('task.list')).length,1)
 await h.receive(channelMessage('independent',{text:'A separate read-only query'}));await h.service.whenIdle()
 assert.equal(h.sent.length,1);assert.equal((await h.query('task.get',{taskId:'direct-work'})).lastDecision.action,'wait')
 assert.ok(!h.requests.some(body=>requestTools(body).includes('channel_triage_submit')))
})

for(const edit of ['update','retract'])test('direct versions remain auditable without stale-source batch failure: '+edit,{timeout:nativeTestTimeout(45000)},async t=>{
 const gate=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 let first=true
 const h=await residentRouterHost(t,async body=>{
  const input=checked(body);if(!input)return {text:'No work'}
  if(isSettleResult(body))return {text:'Done'}
  if(first){first=false;gate.resolve();await release.promise;const event=input.events.find(event=>event.source);return {tool:'resident_task_plan',args:{operationId:'must-refuse-stale',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'must-not-create',title:'Stale instruction',objective:'Must not run',requirements:[]}],dependencies:[]}}}
  return settle(input)
 })
 const original=channelMessage('versioned',{text:'v1 background'})
 await h.receive(original);await gate.promise
 await h.receive({...original,messageVersion:2,text:edit==='update'?'v2 background':'[消息已撤回]',...edit==='retract'?{platformFlags:{retracted:true,retractedBy:'moderator',retractedAt:new Date().toISOString()}}:{}})
 release.resolve();await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(original).sessionId
 assert.equal(await h.query('router.inbox-count',{conversationId}),0)
 assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
 assert.equal((await h.query('source.list')).length,2)
 assert.ok(h.results.some(row=>row.name==='resident_task_plan'&&row.result.isError&&JSON.stringify(row.result).includes('ROUTER_SOURCE_STALE')))
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count)
})

test('direct admission packs sixteen queued sources into bounded native Router inputs without losing the tail',{timeout:nativeTestTimeout(45000)},async t=>{
 const ids=[]
 const h=await residentRouterHost(t,body=>{const input=checked(body);if(!input)return {text:'No work'};if(isSettleResult(body))return {text:'Done'};assert.ok(input.events.filter(event=>event.source).length<=15);ids.push(...input.events.map(event=>event.source?.messageId).filter(Boolean));return settle(input)})
 await Promise.all(Array.from({length:16},(_,i)=>h.receive(channelMessage('bounded-'+i,{text:'Synthetic background '+i}))))
 await h.service.whenIdle()
 assert.equal(ids.length,16);assert.equal(new Set(ids).size,16)
 assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
})

test('new explicit history goes directly to Router; existing queued legacy decision is preserved and not resent',{timeout:nativeTestTimeout(45000)},async t=>{
 const observed=[]
 const h=await residentRouterHost(t,body=>{
  const input=checked(body);if(!input)return {text:'No work'};if(isSettleResult(body))return {text:'Done'}
  observed.push(...input.events)
  const value=settle(input);for(const item of value.args.noTaskDispositions)item.outcome='not-assigned'
  return value
 })
 const seed=channelMessage('existing-room',{text:'Synthetic registration only'})
 await h.receive(seed);await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(seed).sessionId,source=(await h.query('source.list'))[0]
 await h.store.command({id:'old-source',kind:'source.record-direct',args:{source:{sourceId:'old-queued',groupId:conversationId,messageId:'old-queued',version:1,actorId:source.actorId,channel:source.channel,text:'Synthetic legacy background',resources:[]},conversation:{conversationId}}})
 await h.store.command({id:'old-triage',kind:'triage.commit',args:{conversationId,dispositions:[{sourceId:'old-queued',messageVersion:1,needsHandling:true,reason:'Legacy committed decision',reply:'Legacy frozen reply.',handoff:{assignment:'uncertain',summary:'Legacy background requiring Router review'}}]}})
 const original=(await h.query('router.inbox',{conversationId}))[0]
 await h.store.command({id:'new-explicit-history',kind:'source.acceptHistory',args:{sourceId:'new-history',groupId:conversationId,messageId:'history',version:1,actorId:source.actorId,channel:source.channel,text:'Synthetic newly accepted historical source',resources:[],timestamp:'2026-11-19T00:00:00Z',authorizationRef:`message-retry:${conversationId}:history:1`}})
 assert.equal((await h.query('router.source-status',{sourceId:'new-history'})).triage,null)
 const before=observed.length;await h.restart();await h.service.whenIdle()
 assert.deepEqual(observed.slice(before).map(event=>event.sourceId),['old-queued','new-history'])
 const legacy=(await h.query('router.batch-events',{conversationId,eventIds:[original.id]}))[0]
 assert.equal(legacy.id,original.id);assert.equal(legacy.triageReplyId,original.triageReplyId);assert.equal(legacy.triageDecisionId,original.triageDecisionId);assert.equal(legacy.triageReply.payload.text,'Legacy frozen reply.');assert.equal(legacy.triageConclusion.assignment,'uncertain')
 assert.equal(await h.query('router.inbox-count',{conversationId}),0);assert.equal(h.sent.length,1,'only the retained legacy frozen reply is delivered')
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count);assert.equal(h.sent.length,1)
})

test('direct Router cannot quietly consume an unanswered query as handled-inline or omit its disposition',{timeout:nativeTestTimeout(30000)},async t=>{
 let step=0
 const h=await residentRouterHost(t,body=>{
  const input=checked(body);if(!input)return {text:'No work'};if(isSettleResult(body)&&step>2)return {text:'Done'}
  const value=settle(input)
  if(step++===0)delete value.args.noTaskDispositions
  else if(step===2)value.args.noTaskDispositions.forEach(item=>item.outcome='handled-inline')
  return value
 },{strictModelDecisions:true})
 await h.receive(channelMessage('needs-disposition',{text:'Synthetic source without a task'}));await h.service.whenIdle()
 for(const code of ['ROUTER_SOURCE_DISPOSITION_REQUIRED','ROUTER_DIRECT_REPLY_REQUIRED'])assert.ok(h.results.some(row=>row.name==='resident_router_settle'&&row.result.isError&&JSON.stringify(row.result).includes(code)))
 assert.equal(h.sent.length,0)
})

test('direct reply lost receipt is read back on restart without repeating the original send or source',{timeout:nativeTestTimeout(45000)},async t=>{
 let replied=false,readable=false
 const h=await residentRouterHost(t,body=>{
  const input=checked(body);if(!input)return {text:'No work'};if(isSettleResult(body))return {text:'Done'}
  const event=input.events.find(event=>event.source)
  if(!replied){replied=true;return {tool:'resident_router_reply',args:{operationId:'reply-once',sourceId:event.sourceId,messageVersion:event.messageVersion,text:'Synthetic direct answer'}}}
  return settle(input,'handled-inline')
 },{send:async()=>{throw Error('Synthetic lost send response')},readback:async()=>{if(!readable)throw Error('Synthetic readback unavailable');return {messageId:'synthetic-visible',visible:true}}})
 const original=channelMessage('unknown-reply',{text:'Synthetic question'})
 await h.receive(original);await h.service.whenIdle()
 const [unknown]=await h.query('notification.list');assert.equal(unknown.kind,'router-reply');assert.equal(unknown.state,'unknown');assert.equal(h.sent.length,1)
 readable=true;await h.restart()
 const current=await h.query('notification.get',{notificationId:unknown.id})
 if(current.state!=='delivered')await h.service.retryNotification({groupId:current.payload.conversationId,notificationId:current.id,expectedToken:taskNotificationRecovery(current).expectedToken})
 await h.service.whenIdle();assert.equal((await h.query('notification.get',{notificationId:unknown.id})).state,'delivered')
 await h.receive(original);await h.service.whenIdle();assert.equal(h.sent.length,1);assert.equal((await h.query('source.list')).length,1)
})

test('an explicit Router acknowledgement alone cannot settle direct handling as an actual answer',{timeout:nativeTestTimeout(30000)},async t=>{
 let step=0
 const h=await residentRouterHost(t,body=>{
  const input=checked(body);if(!input)return {text:'No work'}
  if(isSettleResult(body)&&step>=4)return {text:'Done'}
  const event=input.events.find(event=>event.source)
  if(step++===0)return {tool:'resident_router_reply',args:{operationId:'explicit-ack',sourceId:event.sourceId,messageVersion:event.messageVersion,replyPurpose:'acknowledgement',text:'Synthetic acknowledgement only'}}
  if(step===2)return settle(input,'handled-inline')
  if(step===3)return {tool:'resident_router_reply',args:{operationId:'actual-answer',sourceId:event.sourceId,messageVersion:event.messageVersion,replyPurpose:'direct-answer',text:'Synthetic actual answer'}}
  return settle(input,'handled-inline')
 })
 await h.receive(channelMessage('ack-is-not-answer',{text:'Synthetic query requiring an actual answer'}));await h.service.whenIdle()
 assert.ok(h.results.some(row=>row.name==='resident_router_settle'&&row.result.isError&&JSON.stringify(row.result).includes('ROUTER_DIRECT_REPLY_REQUIRED')))
 assert.ok(h.results.some(row=>row.name==='resident_router_settle'&&!row.result.isError));assert.equal(h.sent.length,2)
})
