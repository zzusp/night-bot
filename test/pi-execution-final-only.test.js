import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const action of ['complete','blocked','wait','runtime-failure','silent'])test('execution final-only Router delivery: '+action,{timeout:nativeTestTimeout(30000)},async t=>{
 let h,planned=false,replied=false,source,executions=0
 const terminal=new Set(),inspections=new Set(),reports=action==='complete'||action==='blocked',hasOutcome=reports||action==='silent'
 const summary=action==='blocked'?'Stopped: no trusted target was supplied':'Verified synthetic outcome'
 const evidence=['Synthetic material checked'],limitations=action==='blocked'?['Target unavailable; no side effects performed','TASK_EFFECT_UNCERTAIN_NO_REPLAY']:[]
 const replyText=action==='blocked'?'材料已核对，但还没在测试环境验证：目前没有已获准的测试入口。没有改动外部系统。':'这份测试材料已核对，没有改动外部系统。'
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(tools.includes('task_result')){
   executions++
   const schema=body.tools.find(tool=>tool.function.name==='task_result').function.parameters.properties.decision.properties
   assert.equal(schema.question,undefined);assert.equal(schema.audience,undefined)
   if(action==='runtime-failure')return {text:'No decision submitted'}
   return {tool:'task_result',args:{decision:{action:action==='silent'?'blocked':action,summary,evidence,limitations}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  source??=input.events.find(event=>event.source)?.source
  if(!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'final-only-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'final-only-task',title:'Synthetic bounded check',objective:'Check provided synthetic material',requirements:['No external changes'],handoff:'Read the test material without making external changes. Do not send an attachment.'}],dependencies:[]}}}
  for(const event of input.events)if(['task.completed','task.blocked','task.waiting'].includes(event.kind))terminal.add(event.id)
  for(const event of input.events)if(event.kind==='task.inspection')inspections.add(event.id)
  const outcome=input.events.find(event=>event.kind==='task.completed'||event.kind==='task.blocked')
  if(outcome&&reports&&!replied){
   replied=true
   assert.equal(outcome.taskEvent.result.summary,summary)
   const prompt=body.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
   assert.match(prompt,/默认只讲重点/u)
   if(action==='blocked'){
    assert.match(prompt,/沿原会话推进；没有新依据不重复唤醒/u)
    assert.match(prompt,/尚未核实的后续条件不写成已确认的卡点/u)
    assert.equal(outcome.taskEvent.resultSource,'pi-task-result')
    assert.deepEqual(outcome.taskEvent.result.evidence,evidence)
    assert.deepEqual(outcome.taskEvent.result.limitations,limitations)
   }
   const context=requestText(body).flatMap(text=>text.split('\n')).find(line=>line.startsWith('{"asOf":')&&line.includes('"sourceTaskLinks"'))
   const [reply]=JSON.parse(context).taskOutcomeReplies
   assert.deepEqual(reply,{operationId:outcome.taskEventId,sourceId:source.sourceId,messageVersion:source.version,outcomeEventId:outcome.taskEventId})
   return {tool:'resident_router_reply',args:{...reply,text:replyText}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('final-only',{text:'Assistant, check this synthetic material. Do not modify external systems or send an attachment.'}));await h.service.whenIdle()
 assert.equal(executions,1);assert.equal(terminal.size,hasOutcome?1:0);assert.equal(h.sent.length,reports?1:0)
 if(reports)assert.equal(h.sent[0].text,replyText)
 const task=await h.query('task.get',{taskId:'final-only-task'})
 if(hasOutcome){
  const [event]=await h.query('router.batch-events',{conversationId:task.groupId,eventIds:[...terminal]})
  assert.equal(event.state,'consumed')
  assert.equal(event.outcomeDisposition.kind,reports?'notification-frozen':'not-reported')
 }
 assert.equal(task.drained,true);assert.equal(task.status,action==='complete'?'completed':'active');assert.equal(task.humanRequests?.length??0,0)
 if(action==='runtime-failure'){
  assert.equal(inspections.size,1)
  assert.equal(task.lastDecision.resultSource,undefined)
  assert.equal(task.technicalFailure.code,'TASK_SESSION_NO_SUBMISSION')
 }else if(action!=='complete')assert.equal(task.lastDecision.resultSource,'pi-task-result')
 assert.equal((await h.query('notification.list')).filter(item=>item.kind==='question').length,0)
 const count=h.requests.length,sent=h.sent.length
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,count);assert.equal(h.sent.length,sent)
})

test('a fresh blocked result reaches the original recipient without replaying a held source', {timeout:nativeTestTimeout(45000)},async t=>{
 const taskId='continued-blocked-task',summary='Independent checks ran; one required verification is still blocked.'
 let h,original,fresh,held=false,runs=0,replies=0
 const wrapStore=store=>({...store,query:async q=>{
  const rows=await store.query(q)
  return q.kind==='router.rotations'&&held?[...rows,{state:'published',recovery:{unknownSourceIds:[original.sourceId],unknownTaskIds:[taskId]}}]:rows
 }})
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:++runs===1?'wait':'blocked',summary,evidence:['Checked isolated fixture'],limitations:[]}}}
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
  if(source?.messageId==='original'&&!original){
   original=source
   return {tool:'resident_task_plan',args:{operationId:'plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId,title:'Isolated check',objective:'Check the isolated fixture',requirements:[],handoff:'Check the isolated fixture.'}],dependencies:[]}}
  }
  if(source?.messageId==='continue'&&!fresh){
   fresh=source
   const task=await h.query('task.get',{taskId})
   return {tool:'resident_task_action',args:{operationId:'resume',kind:'resume',taskId,sourceId:source.sourceId,messageVersion:source.version,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,handoff:'Continue the same isolated check.'}}
  }
  const outcome=input.events.find(event=>event.kind==='task.blocked')
  if(outcome&&replies<3){
   const attempt=replies++
   return {tool:'resident_router_reply',args:{operationId:'reply-'+attempt,sourceId:original.sourceId,messageVersion:original.version,...attempt?{outcomeEventId:outcome.taskEventId}:{replyPurpose:'direct-answer'},recipientActorIds:[original.actorId],text:summary}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 },{wrapStore})
 await h.receive(channelMessage('original'));await h.service.whenIdle()
 const initial=await h.query('task.get',{taskId})
 held=true
 await h.receive(channelMessage('continue',{senderId:'bob'}));await h.service.whenIdle()
 const results=h.results.filter(row=>row.name==='resident_router_reply')
 assert.equal(results.length,3)
 assert.match(JSON.stringify(results[0].result),/ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN/)
 assert.equal(results[1].result.isError,false);assert.equal(results[2].result.isError,false)
 const notices=(await h.query('notification.list')).filter(item=>item.kind==='router-reply')
 assert.equal(notices.length,1);assert.equal(notices[0].state,'delivered');assert.equal(h.sent.length,1)
 assert.equal(notices[0].payload.sourceId,original.sourceId);assert.equal(notices[0].payload.replyToMessageId,undefined)
 assert.ok(notices[0].payload.blockedBinding.eventId)
 assert.deepEqual(notices[0].payload.recipientActorIds,[original.actorId]);assert.notEqual(fresh.actorId,original.actorId)
 const current=await h.query('task.get',{taskId})
 assert.equal(current.sessionId,initial.sessionId);assert.equal(current.lastDecision.action,'blocked');assert.equal(runs,2)
 assert.equal(await h.query('router.inbox-count',{conversationId:current.groupId}),0)
 assert.equal(h.sent[0].text,summary)
 await h.restart();await h.service.whenIdle();assert.equal(h.sent.length,1)
})

test('a new completion after Web continuation reports to the original channel despite an older hold',{timeout:nativeTestTimeout(60000)},async t=>{
 const taskId='held-completion',summary='The synthetic check finished after continuation.'
 let h,original,runs=0,attempt=0,outcome
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:++runs===1?'wait':'complete',summary,evidence:[],limitations:[]}}}
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  const {events}=requestEnvelope(body,'Router 请求：'),last=h.results.at(-1)
  if(body.messages.at(-1)?.role==='tool'&&last?.name==='resident_router_settle'&&!last.result.isError)return {text:'Settled'}
  const intake=events.find(row=>row.source?.messageId==='held-original')
  if(intake){
   if(original)return {text:'Previous owner stopped before settlement'}
   original=intake.source
   return {tool:'resident_task_plan',args:{operationId:'plan',sourceId:original.sourceId,messageVersion:original.version,tasks:[{taskId,title:'Isolated check',objective:'Check the isolated fixture',requirements:[],handoff:'Check the isolated fixture.'}],dependencies:[]}}
  }
  outcome??=events.find(row=>row.kind==='task.completed')
  if(events.some(row=>row.id===outcome?.id)&&attempt<4){
   const i=attempt++
   return {tool:'resident_router_reply',args:{operationId:'result-'+i,sourceId:original.sourceId,messageVersion:original.version,replyPurpose:i===0?'direct-answer':'task-update',...i?{completionEventId:outcome.taskEventId}:{},recipientActorIds:[i===1?'unrelated-actor':original.actorId],text:summary}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+events.map(row=>row.id).join(','),eventIds:events.map(row=>row.id),noTaskDispositions:events.filter(row=>row.source).map(row=>({eventId:row.id,sourceQuote:row.source.text,outcome:'context-only',reason:'Independent background context'}))}}
 })
 await h.receive(channelMessage('held-original'))
 await assert.rejects(h.service.whenIdle(),{code:'ROUTER_BATCH_UNSETTLED'})
 const first=await h.query('task.get',{taskId}),conversationId=first.groupId
 const before=await h.query('router.get',{conversationId})
 await h.receive(channelMessage('independent',{senderId:'bob'}));await h.service.whenIdle()
 assert.ok((await h.query('router.rotations',{conversationId})).some(row=>row.state==='published'&&row.oldGeneration===before.generation&&row.recovery.unknownSourceIds.includes(original.sourceId)))
 await h.service.appendTaskContext({taskId,requestId:'web-context',context:'Continue the same synthetic check.',progressImpact:'preserve',authorizationChange:'none',expectedRequirementRevision:first.requirementRevision,expectedControlRevision:first.controlRevision})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId})
 assert.equal(task.sessionId,first.sessionId);assert.equal(task.status,'completed');assert.equal(runs,2)
 assert.equal((await h.query('source.get',{sourceId:task.currentInput.sourceId})).channel,'web')
 const replies=h.results.filter(row=>row.name==='resident_router_reply')
 assert.equal(replies.length,4)
 for(const row of replies.slice(0,2))assert.match(JSON.stringify(row.result),/ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN/)
 assert.ok(replies.slice(2).every(row=>!row.result.isError))
 const notices=(await h.query('notification.list')).filter(row=>row.kind==='router-reply')
 assert.equal(notices.length,1);assert.equal(notices[0].state,'delivered');assert.equal(notices[0].payload.sourceId,original.sourceId)
 assert.equal(notices[0].payload.completionBinding.eventId,outcome.taskEventId);assert.equal(notices[0].payload.replyToMessageId,undefined)
 assert.deepEqual(notices[0].payload.recipientActorIds,[original.actorId]);assert.equal(h.sent.length,1)
 await h.restart();await h.service.whenIdle();assert.equal(h.sent.length,1)
})
