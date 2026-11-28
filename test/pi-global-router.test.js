import {routerSessionView,taskSessionView,globalRouterSessionView} from '../packages/web-console/server/session-view.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestText} from './fixtures/resident-router-host.js'
import {STANDALONE_SELF_CHECK_SCOPE} from '../src/channels/router-self-check.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {GLOBAL_ROUTER_SESSION,scopedRouterMessages,freshRouterPacket} from '../src/channels/global-router.js'

const settle=input=>({tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id),
  noTaskDispositions:input.events.filter(event=>event.source).map(({id,source})=>({eventId:id,sourceQuote:source.text,outcome:'context-only',reason:'Only context'}))}})
test('one official Pi Router persists across channels and restart while filtering foreign history',{timeout:nativeTestTimeout(35000)}, async t=>{
  const seen=new Map()
  const h=await residentRouterHost(t,body=>{
    const input=requestEnvelope(body,'Router 请求：')
    if(!input||body.messages.at(-1)?.role==='tool')return {text:'Done'}
    for(const event of input.events)if(event.source)seen.set(event.source.messageId,requestText(body).join('\n'))
    return settle(input)
  },{config:{globalRouter:true},channelIds:['resident-fixture','another']})
  const a=channelMessage('a',{text:'private first marker violet-174',conversationName:'研发一组'}),b=channelMessage('b',{channelId:'another',text:'another blue-176',conversationName:'验证二组'})
  await h.receive(a);await h.service.whenIdle()
  await h.receive(b);await h.service.whenIdle()
  const aid=h.host.ctx.channels.identity(a).sessionId,bid=h.host.ctx.channels.identity(b).sessionId
  assert.equal((await h.query('router.get',{conversationId:aid})).sharedSessionId,GLOBAL_ROUTER_SESSION)
  assert.equal((await h.query('router.get',{conversationId:bid})).sharedSessionId,GLOBAL_ROUTER_SESSION)
  assert.equal(await h.query('router.inbox-count',{conversationId:aid}),0,JSON.stringify({seen:[...seen.keys()],results:h.results,alerts:h.service.listAlerts()}))
  assert.equal(await h.query('router.inbox-count',{conversationId:bid}),0)
  assert.ok(seen.get('b')&&!seen.get('b').includes('violet-174'))
  for(const [key,channelId,scopeId,conversationName,otherName] of [['a','resident-fixture',aid,'研发一组','验证二组'],['b','another',bid,'验证二组','研发一组']]){
    const prompt=seen.get(key)
    for(const [field,value] of Object.entries({channelId,channelName:channelId,scopeId,conversationName,conversationType:'chat-room',conversationId:'shared-room'}))
      assert.ok(prompt.includes(JSON.stringify(field)+':'+JSON.stringify(value)),field+': '+value)
    assert.ok(!prompt.includes(otherName))
  }
  const visible=await routerSessionView({conversationId:aid,executionActivity:true,readRouter:()=>h.query('router.get',{conversationId:aid}),persistence:h.host.ctx.sessionPersistence})
  assert.equal(visible.status,'ready')
  assert.equal(visible.routingMode,'shared')
  assert.match(JSON.stringify(visible.items),/violet-174/)
  assert.doesNotMatch(JSON.stringify(visible.items),/blue-176/)
  assert.equal(visible.live,undefined)
  const combined=await globalRouterSessionView({executionActivity:true,persistence:h.host.ctx.sessionPersistence})
  const text=combined.items.map(item=>item.text).join('\n')
  assert.ok(text.indexOf('violet-174')>=0&&text.indexOf('blue-176')>text.indexOf('violet-174'),text)

  await h.restart()
  await h.receive({...a,messageId:'a-next',text:'go back to first group'});await h.service.whenIdle()
  assert.match(seen.get('a-next'),/violet-174/)
  assert.doesNotMatch(seen.get('a-next'),/blue-176/)
  assert.ok(h.results.filter(x=>x.name==='resident_router_settle').every(x=>x.sessionId===GLOBAL_ROUTER_SESSION))
})

test('cross-channel assistant/tool output and mixed compaction summaries never reach a scoped prompt',()=>{
  const boundary=(conversationId,webOnly=false)=>({role:'custom',customType:'night.business-input',details:{source:{kind:'conversation-router',conversationId,webOnly}}})
  const good={role:'assistant',content:'shown'}
  const rows=[{role:'compactionSummary',summary:'mixed'},boundary('A'),good,boundary('B'),
    {role:'toolResult',content:'foreign'},boundary('A',true),{role:'assistant',content:'operator only'}]
  assert.deepEqual(scopedRouterMessages(rows,'A',false),[rows[1],good])
  assert.deepEqual(scopedRouterMessages(rows,'A',true),rows.slice(-2))
})

const call=(tool,args)=>({tool,args})
const decision=(summary)=>call('task_result',{decision:{action:'complete',summary,evidence:[],limitations:[]}})
const taskInput=body=>requestText(body).flatMap(text=>{try{const v=JSON.parse(text);return v.task?.taskId?[v]:[]}catch{return []}}).at(-1)
const lastCall=body=>body.messages.at(-1)?.role==='tool'?body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name:undefined
const receipt=body=>{try{return JSON.parse(body.messages.at(-1)?.content)}catch{return null}}
const peerSend=(taskId,messageId,text)=>call('task_peer_send',{taskId,messageId,text})

test('real Pi Work peers fix and verify directly; only final outcome reaches the channel',{timeout:nativeTestTimeout(50000)},async t=>{
 let planned=false
 const seen=[]
 const answered=new Set()
 const h=await residentRouterHost(t,body=>{
  const input=requestEnvelope(body,'Router 请求：'), last=lastCall(body)
  if(input){
    if(last==='resident_router_settle')return {text:'Router settled'}
    const event=input.events.find(event=>event.source)
    if(event&&!planned){
      planned=true
      return call('resident_task_plan',{operationId:'create-dev-review',sourceId:event.sourceId,messageVersion:event.messageVersion,dependencies:[],
        tasks:[
          {taskId:'work-dev',title:'Develop',objective:'Implement change',requirements:[],handoff:'Implement the sample change.',workRole:'development',reportsFinal:false},
          {taskId:'work-verify',title:'Verify',objective:'Review candidate',requirements:[],handoff:'Verify the sample change.',workRole:'verification',reportsFinal:true},
        ]})
    }
    const done=input.events.find(event=>event.kind==='task.completed')
    if(done&&!answered.has(done.id)){
      answered.add(done.id)
      assert.equal(done.taskId,'work-verify')
      const status=requestText(body).flatMap(text=>text.split('\n')).find(line=>line.startsWith('{"asOf":')&&line.includes('"taskOutcomeQuestions"'))
      assert.deepEqual(JSON.parse(status).taskOutcomeQuestions,[{outcomeEventId:done.taskEventId,sourceId:[...origin][0],messageVersion:1,text:msg.text}])
      return call('resident_router_reply',{operationId:'final-verified',sourceId:[...origin][0],messageVersion:1,text:'验证通过。',outcomeEventId:done.taskEventId,replyPurpose:'task-update'})
    }
    return event?call('resident_router_settle',{operationId:'settle-create',eventIds:input.events.map(event=>event.id)}):settle(input)
  }
  const work=taskInput(body)
  if(!work)return {text:'Idle'}
  const id=work.task.taskId, messages=work.peerMessages??[]
  if(last==='task_peer_send'){
    const accepted=receipt(body)
    assert.equal(accepted?.status,'queued',JSON.stringify(body.messages.at(-1)))
    return call('task_peer_wait',{receiptId:accepted.receiptId})
  }
  if(id==='work-dev'){
    if(messages.some(row=>row.messageId==='fix-first')){seen.push('developer reads verification feedback');return peerSend('work-verify','ready-v2','fixed candidate v2')}
    if(last==='task_peer_list'){
      assert.ok(receipt(body)?.peers?.some(row=>row.taskId==='work-verify'&&row.role==='verification'))
      return peerSend('work-verify','ready-v1','candidate v1')
    }
    return call('task_peer_list',{role:'verification'})
  }
  if(messages.some(row=>row.messageId==='ready-v2')){seen.push('verifier reads repaired candidate');return decision('Verified candidate v2')}
  if(messages.some(row=>row.messageId==='ready-v1')){seen.push('verifier reads original candidate');return peerSend('work-dev','fix-first','failed first check; correct fixture')}
  return peerSend('work-dev','verification-ready','Ready to verify.')
 },{config:{globalRouter:true,maxConcurrentTasks:1},transportCapabilities:{quotedReplies:['chat-room'],standaloneMarkdown:true}})
 const origin=new Set()
 const msg=channelMessage('dev-review',{text:'实现样例并由独立会话审查'})
 const accepted=await h.receive(msg)
 const id=h.host.ctx.channels.identity(msg).sessionId
 const inbox=await h.query('source.list',{groupId:id});origin.add(inbox.find(item=>item.messageId==='dev-review')?.sourceId??accepted.sourceId)
 await h.service.whenIdle()
 const verify=await h.query('task.get',{taskId:'work-verify'}),dev=await h.query('task.get',{taskId:'work-dev'})
 assert.ok(dev&&verify,JSON.stringify(h.results))
 assert.notEqual(dev.sessionId,verify.sessionId)
 assert.equal(verify.completion?.summary,'Verified candidate v2',JSON.stringify({seen,results:h.results.slice(-18)}))
 assert.ok(seen.includes('verifier reads original candidate')&&seen.includes('developer reads verification feedback')&&seen.includes('verifier reads repaired candidate'))
 assert.deepEqual(h.sent.map(row=>[row.channelId,row.text,row.replyToMessageId,row.replyToParticipantId]),[['resident-fixture','验证通过。',msg.messageId,msg.senderId]])
 assert.ok(!h.results.filter(row=>row.name.startsWith('task_peer_')).some(item=>item.sessionId===GLOBAL_ROUTER_SESSION))
})

test('a busy Work reads a peer handoff at the tool boundary in the same Pi execution', {timeout:nativeTestTimeout(40000)},async t=>{
 let planned=false, actor, firstLease, staleToolRan=false
 const toolStarted=Promise.withResolvers(), releaseTool=Promise.withResolvers()
 const queued=()=>actor?.piSession.agent.peekQueuedMessages().some(msg=>msg.details?.source?.kind==='task-peer-message')
 const marker='please revise before your next tool: peer-while-busy'
 const h=await residentRouterHost(t,async body=>{
   const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(router){
     const source=router.events.find(event=>event.source)
     if(source&&!planned){
       planned=true
       return call('resident_task_plan',{operationId:'busy-peer',sourceId:source.sourceId,messageVersion:source.messageVersion,dependencies:[],tasks:[
         {taskId:'busy-development',title:'Development',objective:'Revise if asked',requirements:[],handoff:'Work on the candidate.',workRole:'development',reportsFinal:true},
         {taskId:'busy-verification',title:'Verification',objective:'Advise development',requirements:[],handoff:'Send a correction.',workRole:'verification',reportsFinal:false},
       ]})
     }
     return last==='resident_router_settle'?{text:'Settled'}:settle(router)
   }
   const input=taskInput(body)
   if(!input)return {text:'Idle'}
   if(input.task.taskId==='busy-verification'){
     if(last==='task_peer_send')return decision('Sent correction')
     await toolStarted.promise
     return peerSend('busy-development','fix-while-busy',marker)
   }
   if(requestText(body).some(text=>text.includes(marker))){
     assert.equal(input.task.leaseEpoch,firstLease)
     return decision('Updated in original execution')
   }
   if(last==='task_peer_list')return decision('Missed correction')
   firstLease=input.task.leaseEpoch
   return {toolBatch:[call('task_peer_list',{role:'verification'}),call('task_peer_list',{role:'development'})]}
 },{config:{globalRouter:true,maxConcurrentTasks:2}})
 h.host.ctx.on('agent/created',({agent})=>{if(agent.piSession)agent.piSession.agent.toolExecution='sequential'})
 h.host.ctx.on('tools/pre-execute',async(exec,next)=>{
   if(exec.name==='task_peer_list'){
     if(actor){staleToolRan=true;return next()}
     actor=exec.agent;toolStarted.resolve();await releaseTool.promise
   }
   return next()
 })
 t.after(()=>releaseTool.resolve())
 await h.receive(channelMessage('steer-during-tool'))
 try{
   for(let n=0;n<180&&!queued();n++)
     await new Promise(resolve=>setTimeout(resolve,20))
   assert.ok(queued(),JSON.stringify(h.results.slice(-5)))
   const pending=(await h.query('wake.list',{taskId:'busy-development'})).find(wake=>wake.kind==='task.peer.message')
   assert.equal(pending?.state,'pending','queued is not proof of delivery')
 }finally{releaseTool.resolve()}
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:'busy-development'})
 assert.equal(task.completion?.summary,'Updated in original execution',JSON.stringify({results:h.results.slice(-10),alerts:h.service.listAlerts()}))
 assert.equal(task.leaseEpoch,firstLease)
 assert.equal(staleToolRan,false,'obsolete tool must be reconsidered after the steer')
 const page=await taskSessionView({task,persistence:h.host.ctx.sessionPersistence,executionActivity:true})
 const peer=page.items.filter(row=>row.kind==='peer-handoff')
 assert.deepEqual(peer.map(row=>({text:row.text,role:row.workRole})),[{text:marker,role:'verification'}])
 assert.ok(!JSON.stringify(peer).includes('fix-while-busy'))

 assert.equal((await h.query('wake.list',{taskId:task.taskId})).find(wake=>wake.kind==='task.peer.message')?.state,'acked')
})

test('a peer correction arriving inside task_result prevents the terminal commit',{timeout:nativeTestTimeout(45000)},async t=>{
 let planned=false,actor,priorLease
 const finishing=Promise.withResolvers(),release=Promise.withResolvers()
 const marker='late peer correction, before completion commit'
 const h=await residentRouterHost(t,async body=>{
   const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(router){
     const source=router.events.find(event=>event.source)
     if(source&&!planned){
       planned=true
       return call('resident_task_plan',{operationId:'late-peer',sourceId:source.sourceId,messageVersion:source.messageVersion,dependencies:[],tasks:[
         {taskId:'late-dev',title:'Development',objective:'Handle correction',requirements:[],handoff:'Work on the candidate.',workRole:'development',reportsFinal:true},
         {taskId:'late-verify',title:'Verification',objective:'Advise development',requirements:[],handoff:'Send a correction.',workRole:'verification',reportsFinal:false},
       ]})
     }
     return last==='resident_router_settle'?{text:'Settled'}:settle(router)
   }
   const input=taskInput(body)
   if(!input)return {text:'Idle'}
   if(input.task.taskId==='late-verify'){
     if(last==='task_peer_send')return decision('Sent correction')
     await finishing.promise
     return peerSend('late-dev','fix-before-commit',marker)
   }
   if(requestText(body).some(text=>text.includes(marker)))return decision('Corrected before completion')
   priorLease=input.task.leaseEpoch
   return decision('Old result without correction')
 },{config:{globalRouter:true,maxConcurrentTasks:2}})
 h.host.ctx.on('tools/pre-execute',async(exec,next)=>{
   if(exec.name==='task_result'&&exec.arguments.decision.summary==='Old result without correction'){
     actor=exec.agent;finishing.resolve();await release.promise
   }
   return next()
 })
 t.after(()=>release.resolve())
 await h.receive(channelMessage('peer-before-finish'))
 try{
   for(let n=0;n<180&&!actor?.piSession.agent.peekQueuedMessages().some(msg=>msg.details?.source?.kind==='task-peer-message');n++)
     await new Promise(resolve=>setTimeout(resolve,20))
   assert.ok(actor?.piSession.agent.peekQueuedMessages().some(msg=>msg.details?.source?.kind==='task-peer-message'))
 }finally{release.resolve()}
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:'late-dev'})
 assert.equal(task.completion?.summary,'Corrected before completion',JSON.stringify({results:h.results.slice(-8),alerts:h.service.listAlerts()}))
 assert.ok(task.leaseEpoch>priorLease)
 assert.equal((await h.query('wake.list',{taskId:task.taskId})).find(wake=>wake.kind==='task.peer.message')?.state,'acked')
})

test('a standalone task completes without requiring or inventing a reply channel',{timeout:nativeTestTimeout(35000)},async t=>{
 const h=await residentRouterHost(t,body=>taskInput(body)?decision('Standalone task complete'):{text:'Idle'},{config:{globalRouter:true}})
 const created=await h.service.createTask({requestId:'no-channel-task',objective:'Verify standalone task scheduling'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId})
 assert.equal(task.groupId??null,null)
 assert.equal(task.conversationId??null,null)
 assert.equal(task.completion?.summary,'Standalone task complete')
 assert.deepEqual(h.sent,[])
})

test('two-hour self-check persists cadence and delegates an asynchronous read-only audit',{timeout:nativeTestTimeout(45000)},async t=>{
 let planned=false,review=false
 let observed=0
 const h=await residentRouterHost(t,body=>{
   const text=requestText(body).join('\n')
   if(text.includes('NIGHT_ROUTER_SELF_CHECK_REVIEW')){observed++;return {text:'{"summary":"已核对样例，先不改变任务。","limitations":[]}'}}
   const input=requestEnvelope(body,'Router 请求：'), last=lastCall(body)
   if(input){
     if(last==='resident_router_settle')return {text:'Settled'}
     const event=input.events[0]
     if(event.source&&!planned){planned=true;return call('resident_task_plan',{operationId:'audit-plan',sourceId:event.sourceId,messageVersion:1,dependencies:[],tasks:[{taskId:'audit-task',title:'Fixture',objective:'test',requirements:[],handoff:'Read the fixture and record the result.'}]})}
     if(event.kind==='router.self-check'&&!review){review=true;return call('resident_self_check_review',{eventId:event.id,taskIds:['audit-task']})}
     return event.source?call('resident_router_settle',{operationId:'settle-audit-input',eventIds:input.events.map(event=>event.id)}):settle(input)
   }
   if(taskInput(body))return decision('Audit fixture checked.')
   return {text:'Idle'}
 },{config:{globalRouter:true}})
 await h.receive(channelMessage('audit-source'));await h.service.whenIdle()
 assert.equal(observed,0)
 const end=Date.parse((await h.query('task.get',{taskId:'audit-task'})).completion.at)
 await h.service.routerSelfCheck(end-10)
 const before=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(before.nextAt-1)
 assert.equal(observed,0)
 await h.service.routerSelfCheck(before.nextAt)
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>observed===1,'readonly self-check model'))
 await h.service.whenIdle()
 assert.ok(h.results.some(row=>row.name==='resident_self_check_review'&&!row.result.isError))
 const scope=h.host.ctx.channels.identity(channelMessage('audit-source')).sessionId
 const records=await routerSessionView({conversationId:scope,executionActivity:true,readRouter:()=>h.query('router.get',{conversationId:scope}),persistence:h.host.ctx.sessionPersistence})
 assert.ok(records.items.some(row=>row.kind==='router-trigger'&&row.text==='定时自检'))

 const after=await h.query('router.self-check.clock')
 assert.equal(after.nextAt-before.nextAt,7200000)
 await h.restart()
 await h.service.routerSelfCheck(after.nextAt-1)
 assert.equal((await h.query('router.self-check.clock')).nextAt,after.nextAt)
 assert.equal(observed,1)
})

test('an unavailable peer wakes Router to add a session to the original work group',{timeout:nativeTestTimeout(50000)},async t=>{
 let created=false,assigned=false,asked=false,receivedAssignment=false
 const h=await residentRouterHost(t,body=>{
   const input=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(input){
     if(last==='resident_router_settle')return {text:'Settled'}
     const source=input.events.find(row=>row.source)?.source
     if(source&&!created){
       created=true
       return call('resident_task_plan',{operationId:'original-developer',sourceId:source.sourceId,messageVersion:1,dependencies:[],tasks:[{taskId:'solo-dev',title:'Prepare fixture',objective:'Prepare and verify',requirements:[],handoff:'Prepare fixture and arrange independent verification.',workRole:'development',reportsFinal:true}]})
     }
     const x=input.events.find(event=>event.kind==='task.peer.request')
     if(x&&!assigned){
       assigned=true
       const original=x.taskEvent.request
       assert.equal(original.role,'verification')
       return call('resident_task_plan',{operationId:'requested-verifier',peerRequestEventId:x.id,sourceId:original.sourceId,messageVersion:original.messageVersion,dependencies:[],tasks:[{taskId:'added-review',title:'Check fixture',objective:'Verify independently',requirements:[],handoff:'Verify only and send result to solo-dev.',workRole:'verification',reportsFinal:false}]})
     }
     return call('resident_router_settle',{operationId:'settle:'+input.events.map(x=>x.id).join(','),eventIds:input.events.map(x=>x.id)})
   }
   const inputTask=taskInput(body)
   if(!inputTask)return {text:'No work'}
   if(last==='task_peer_request'||last==='task_peer_send')return call('task_peer_wait',{receiptId:receipt(body).receiptId})
   if(inputTask.task.taskId==='added-review')return peerSend('solo-dev','verification-passed','Verified the fixture.')
   if(inputTask.peerMessages?.some(m=>m.senderTaskId==='added-review')){
     receivedAssignment=true
     if(inputTask.peerMessages.some(m=>m.messageId==='verification-passed'))return decision('Independent verification received')
     return peerSend('added-review','ready-new-review','Fixture is ready for the check.')
   }
   if(last==='task_peer_list'){
     assert.deepEqual(receipt(body)?.peers,[]);asked=true
     return call('task_peer_request',{role:'verification',requestId:'need-reviewer',text:'Need independent verification for this fixture.'})
   }
   return call('task_peer_list',{role:'verification'})
 },{config:{globalRouter:true,maxConcurrentTasks:1}})
 await h.receive(channelMessage('needs-peer'));await h.service.whenIdle()
 const dev=await h.query('task.get',{taskId:'solo-dev'}),review=await h.query('task.get',{taskId:'added-review'})
 assert.equal(dev?.metadata.work.id,review?.metadata.work.id,JSON.stringify(h.results.slice(-12)))
 assert.ok(asked&&assigned&&receivedAssignment)
 assert.equal(dev.completion?.summary,'Independent verification received')
 assert.equal(h.sent.length,0)
})

test('a failed admitted batch does not block later sources in the same or another channel',{timeout:nativeTestTimeout(40000)},async t=>{
 const h=await residentRouterHost(t,body=>{
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Done'}
   if(input.events.some(row=>row.source?.text==='STOP WITHOUT SETTLE'))return {text:'Intentionally no settlement'}
   return settle(input)
 },{config:{globalRouter:true},channelIds:['resident-fixture','another']})
 const a=channelMessage('bad',{text:'STOP WITHOUT SETTLE'})
 await h.receive(a);await h.service.whenIdle()
 const scope=h.host.ctx.channels.identity(a).sessionId
 const [held]=await h.query('router.inbox',{conversationId:scope})
 assert.equal(held.sharedHold.code,'ROUTER_ADMITTED_BATCH_REVIEW_REQUIRED')
 await h.restart()
 await Promise.all([h.receive({...a,text:'fresh after failure',messageId:'new'}),h.receive(channelMessage('other',{channelId:'another'}))])
 await h.service.whenIdle()
 const remaining=await h.query('router.inbox',{conversationId:scope})
 assert.deepEqual(remaining.map(event=>event.id),[held.id])
 assert.equal(await h.query('router.inbox-count',{conversationId:scope,deliverable:true}),0)
})

test('cutover leaves admitted legacy inputs as evidence while new work uses the global Router',{timeout:nativeTestTimeout(36000)},async t=>{
 const h=await residentRouterHost(t,body=>{
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Done'}
   if(input.events.some(event=>event.source?.text==='legacy unfinished'))return {text:'Leave old input open'}
   return settle(input)
 })
 const old=channelMessage('legacy-pending',{text:'legacy unfinished'})
 await h.receive(old).catch(()=>{})
 // The legacy driver's explicit failure is expected and is not replayed by the new owner.
 await h.service.whenIdle().catch(()=>{})
 const id=h.host.ctx.channels.identity(old).sessionId
 const legacy=(await h.query('router.get',{conversationId:id})).activeSessionId
 await h.restart({restoreIdleRouters:true},{globalRouter:true})
 await h.receive({...old,text:'after cutover',messageId:'new-scope'})
 await h.service.whenIdle()
 const row=await h.query('router.get',{conversationId:id})
 assert.equal(row.sharedSessionId,GLOBAL_ROUTER_SESSION)
 assert.notEqual(row.sharedSessionId,legacy)
 assert.equal(await h.host.ctx.sessionPersistence.stat(legacy).then(Boolean),true)
 assert.equal(h.host.ctx.agents.get(legacy),undefined)
 const [held]=await h.query('router.inbox',{conversationId:id})
 assert.equal(held.sharedHold.code,'ROUTER_LEGACY_BATCH_REVIEW_REQUIRED')
 assert.equal((await h.query('router.inbox',{conversationId:id,deliverable:true})).length,0)
})

test('cutover reviews old per-channel inputs using the previous owner journal',{timeout:nativeTestTimeout(45000)},async t=>{
 let phase='legacy',review
 const h=await residentRouterHost(t,body=>{
   const texts=requestText(body).join('\n')
   const held=texts.lastIndexOf('Router 挂起来源复查：')>texts.lastIndexOf('Router 请求：')&&requestEnvelope(body,'Router 挂起来源复查：')
   if(held){
     review=held
     return lastCall(body)==='resident_review_held_source'?{text:'Reviewed'}:call('resident_review_held_source',{eventId:held.eventId,decision:held.noEffect?'continue':'defer'})
   }
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Settled'}
   if(phase==='legacy')return {text:'Legacy input, no tool ran'}
   return settle(input)
 })
 const a=channelMessage('migrate-recovery')
 await h.receive(a);await h.service.whenIdle().catch(()=>{})
 const id=h.host.ctx.channels.identity(a).sessionId
 const [held]=await h.query('router.inbox',{conversationId:id})
 assert.ok(held)
 phase='global'
 await h.restart({restoreIdleRouters:true},{globalRouter:true})
 await h.service.whenIdle()
 assert.equal(review?.eventId,held.id)
 assert.equal(review?.noEffect,true)
 assert.equal((await h.query('router.batch-events',{conversationId:id,eventIds:[held.id]}))[0].state,'consumed')
})

test('a cancelled router delivery gets a fresh identity without changing the business batch',()=>{
 const packet={id:'router-input:fixed',source:{eventIds:['original-source']},content:['original text']}
 const cancelled=new Set([packet.id])
 const once=freshRouterPacket(packet,id=>cancelled.has(id)?'cancelled':'pending')
 assert.notEqual(once.id,packet.id)
 assert.deepEqual({...once,id:packet.id},packet)
 assert.equal(freshRouterPacket(packet,id=>cancelled.has(id)?'cancelled':'admitted').id,once.id)
 cancelled.add(once.id)
 assert.notEqual(freshRouterPacket(packet,id=>cancelled.has(id)?'cancelled':undefined).id,once.id)
})

test('the Router can deliver the original event after its first native packet is cancelled',{timeout:nativeTestTimeout(45000)},async t=>{
 let injected=false,handled=0,originalId
 const text='retry the same durable source'
 const h=await residentRouterHost(t,body=>{
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Settled'}
   if(input.events.some(event=>event.source?.text===text))handled++
   return settle(input)
 },{config:{globalRouter:true}})
 h.host.ctx.on('agent/created',({agent})=>{
   if(agent.id!==GLOBAL_ROUTER_SESSION)return
   const original=agent.piSession.sendCustomMessage.bind(agent.piSession)
   agent.piSession.sendCustomMessage=async(message,options)=>{
     if(!injected&&JSON.stringify(message.content).includes(text)){
       originalId=message.details.packetId
       injected=true
       throw Object.assign(new Error('Synthetic failure before admission'),{code:'TEST_PI_BEFORE_ADMISSION'})
     }
     return original(message,options)
   }
 })
 const msg=channelMessage('retry-cancelled',{text})
 await h.receive(msg);await h.service.whenIdle().catch(()=>{})
 const id=h.host.ctx.channels.identity(msg).sessionId
 assert.ok(injected)
 const [earlier]=await h.query('router.inbox',{conversationId:id})
 assert.ok(earlier)
 assert.equal(handled,0)
 await h.restart({restoreIdleRouters:true})
 await h.service.whenIdle()
 const [event]=await h.query('router.batch-events',{conversationId:id,eventIds:[earlier.id]})
 assert.equal(handled,1)
 assert.equal(event.state,'consumed')
 const native=await h.host.ctx.sessionPersistence.readNative(GLOBAL_ROUTER_SESSION,{requireComplete:true})
 assert.ok(native.audit.some(item=>item.kind==='cancelled'&&item.payload.id===originalId))
 assert.ok(native.entries.some(entry=>entry.details?.source?.eventIds?.includes(earlier.id)&&entry.details.packetId!==originalId))
})

test('the shared Router can recover a no-effect message after a different channel advances Pi',{timeout:nativeTestTimeout(45000)},async t=>{
 let calls=0,reviewed,other=false,heldId
 const h=await residentRouterHost(t,body=>{
   const texts=requestText(body).join('\n')
   const review=texts.lastIndexOf('Router 挂起来源复查：')>texts.lastIndexOf('Router 请求：')&&requestEnvelope(body,'Router 挂起来源复查：')
   if(review){
     reviewed={other,eventId:review.eventId,noEffect:review.noEffect}
     if(lastCall(body)==='resident_review_held_source')return {text:'Reviewed'}
     return call('resident_review_held_source',{eventId:review.eventId,decision:review.noEffect?'continue':'defer'})
   }
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Settled'}
   if(input.events.some(event=>event.source?.text==='needs recovery')&&calls++===0)return {text:'Stop without effect'}
   if(input.events.some(event=>event.source?.text==='fresh second channel'))other=true
   return settle(input)
 },{config:{globalRouter:true},channelIds:['resident-fixture','another']})
 const a=channelMessage('recover-me',{text:'needs recovery'})
 await h.receive(a);await h.service.whenIdle()
 const id=h.host.ctx.channels.identity(a).sessionId
 const [held]=await h.query('router.inbox',{conversationId:id})
 heldId=held.id
 assert.ok(held.sharedHold)
 await h.receive(channelMessage('move-checkpoint',{channelId:'another',text:'fresh second channel'}));await h.service.whenIdle()
 assert.equal(other,true)
 assert.deepEqual(reviewed,{other:true,eventId:heldId,noEffect:true})
 assert.equal(calls,2)
 assert.equal(await h.query('router.inbox-count',{conversationId:id}),0)
 const [recovered]=await h.query('router.batch-events',{conversationId:id,eventIds:[heldId]})
 assert.equal(recovered.state,'consumed')
 assert.deepEqual(recovered.reviewedPacketIds,[held.sharedHold.packetId])
})

test('operator may explicitly resume the exact committed global checkpoint, not replay another batch',{timeout:nativeTestTimeout(35000)},async t=>{
 let resume=false
 const h=await residentRouterHost(t,body=>{
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Done'}
   if(!resume)return {text:'Intentionally stop without settlement'}
   assert.match(requestText(body).join('\n'),/继续处理未完成的事项/)
   return settle(input)
 },{config:{globalRouter:true}})
 const msg=channelMessage('operator-resume',{text:'Fixture checkpoint'})
 await h.receive(msg);await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(msg).sessionId
 const value=await h.service.inspectRouterBatch({conversationId})
 assert.equal(value.proposal.sessionId,GLOBAL_ROUTER_SESSION)
 await h.service.checkRouterBatch(value.proposal)
 resume=true
 const restarted=await h.service.resumeRouterBatch(value.proposal)
 assert.equal(restarted.settled,true)
 assert.equal(await h.query('router.inbox-count',{conversationId}),0)
})

test('two-hour self-check reviews standalone tasks without adding a channel or sending a reply',{timeout:nativeTestTimeout(45000)},async t=>{
 let taskId,observed=0
 const events=[]
 const h=await residentRouterHost(t,body=>{
   if(requestText(body).join('\n').includes('NIGHT_ROUTER_SELF_CHECK_REVIEW')){
     observed++
     return {text:'{"summary":"Checked the standalone task.","limitations":[]}'}
   }
   const input=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(input){
     if(last==='resident_router_settle')return {text:'Settled'}
     const event=input.events[0]
     if(last===undefined)events.push(event)
     if(event.kind==='router.self-check'&&last!=='resident_self_check_review')
       return call('resident_self_check_review',{eventId:event.id,taskIds:[taskId]})
     return settle(input)
   }
   return taskInput(body)?decision('Standalone task complete'):{text:'Idle'}
 },{config:{globalRouter:true}})
 const created=await h.service.createTask({requestId:'audit-standalone-fixture',objective:'Check a channel-independent task'})
 taskId=created.taskId
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId})
 assert.equal(task.groupId??null,null)
 assert.equal(task.conversationId??null,null)
 assert.equal(task.completion?.summary,'Standalone task complete')
 const end=Date.parse(task.completion.at)
 await h.service.routerSelfCheck(end-10)
 const before=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(before.nextAt)
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>observed===1,'standalone self-check model'))
 await h.service.whenIdle()
 assert.ok(h.results.some(row=>row.name==='resident_self_check_review'&&!row.result.isError))
 assert.ok(events.some(e=>e.kind==='router.self-check.completed'&&e.lookupResult?.state==='completed'),JSON.stringify(events))
 assert.equal((await h.query('router.self-check.completion',{conversationId:STANDALONE_SELF_CHECK_SCOPE,taskId}))?.commandId,task.completion.commandId)
 assert.equal(await h.query('router.self-check.completion',{conversationId:'foreign-room',taskId}),null)
 assert.equal((await h.query('task.get',{taskId})).groupId??null,null)
 assert.deepEqual(h.sent,[])
})

test('standalone self-check cannot reopen a conclusively completed task', {timeout:nativeTestTimeout(45000)}, async t=>{
 let task,checked=0,attempted=false
 const h=await residentRouterHost(t,body=>{
   if(requestText(body).join('\n').includes('NIGHT_ROUTER_SELF_CHECK_REVIEW')){
     checked++;return {text:'{"summary":"The standalone task needs one more pass to complete its existing goal.","limitations":[]}'}
   }
   const input=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(input){
     if(last==='resident_router_settle')return {text:'Settled'}
     const ev=input.events[0]
     if(ev.kind==='router.self-check'&&!last)return call('resident_self_check_review',{eventId:ev.id,taskIds:[task.taskId]})
     if(ev.kind==='router.self-check.completed'&&!last){
       attempted=true
       return call('resident_task_action',{operationId:'audit-confirmed-resume',kind:'reopen',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,sameGoal:true})
     }
     return settle(input)
   }
   return taskInput(body)?decision('Standalone task complete'):{text:'Idle'}
 },{config:{globalRouter:true}})
 const created=await h.service.createTask({requestId:'standalone-action-review',objective:'Verify the unchanged standalone goal'})
 await h.service.whenIdle()
 task=await h.query('task.get',{taskId:created.taskId})
 const end=Date.parse(task.completion.at)
 await h.service.routerSelfCheck(end-10)
 const before=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(before.nextAt)
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>checked===1&&attempted,'standalone review and action'))
 await h.service.whenIdle()
 const action=h.results.find(row=>row.name==='resident_task_action')
 assert.ok(action?.result?.isError,JSON.stringify(action))
 const reopened=await h.query('task.get',{taskId:created.taskId})
 assert.equal(reopened.status,'completed')
 assert.equal(reopened.completion.commandId,task.completion.commandId)
 assert.equal(reopened.requirementRevision,task.requirementRevision)
 assert.equal(reopened.objective,task.objective)
 assert.equal(reopened.groupId??null,null)
 assert.equal(reopened.conversationId??null,null)
 assert.deepEqual(h.sent,[])
})

for(const shouldResume of [true,false])test('Host reports a standalone mismatch and Router '+(shouldResume?'can resume it':'can leave it stopped'),{timeout:nativeTestTimeout(40000)},async t=>{
 let turns=0,seen=0,originalSession
 const h=await residentRouterHost(t,async body=>{
   const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(router){
     if(last==='resident_router_settle')return {text:'Settled'}
     const incident=router.events.find(e=>e.kind==='task.inspection')
     if(incident&&!last){
       seen++
       assert.equal(incident.taskEvent.reason,'execution-failed')
       const current=await h.query('task.get',{taskId:incident.taskId})
       assert.ok(current.inspection.pending)
       if(shouldResume)return call('resident_task_action',{operationId:'continue-inspected-standalone',kind:'resume',taskId:current.taskId,expectedRequirementRevision:current.requirementRevision,expectedControlRevision:current.controlRevision})
     }
     return settle(router)
   }
   const input=taskInput(body)
   if(!input)return {text:'Idle'}
   originalSession??=input.task.sessionId
   assert.equal(input.task.sessionId,originalSession)
   if(++turns===1)return {error:'Synthetic standalone task model failure'}
   return decision('Original standalone task resumed by Router')
 },{config:{globalRouter:true}})
 const created=await h.service.createTask({requestId:'standalone-host-inspection',objective:'Verify the existing task'})
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>seen===1,'inspection routed without waiting for the periodic wake'))
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId})
 assert.equal(task.status,shouldResume?'completed':'active')
 assert.equal(task.inspection.pending,!shouldResume)
 assert.equal(turns,shouldResume?2:1)
 assert.equal(task.groupId??null,null)
 assert.deepEqual(h.sent,[])
})

test('the two-hour background clock wakes Router even when there are no tasks',{timeout:nativeTestTimeout(30000)},async t=>{
 let seen=0
 const h=await residentRouterHost(t,body=>{
   const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(!router||last==='resident_router_settle')return {text:'Settled'}
   const check=router.events.find(e=>e.kind==='router.self-check')
   if(check){seen++;assert.deepEqual(check.selfCheck.taskIds,[])}
   return settle(router)
 },{config:{globalRouter:true}})
 await h.service.routerSelfCheck(Date.now())
 const clock=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(clock.nextAt-1)
 assert.equal(seen,0)
 await h.service.routerSelfCheck(clock.nextAt)
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>seen===1,'empty two-hour Router wake'))
 await h.service.whenIdle()
 assert.deepEqual(h.sent,[])
})

test('slow Work attachment preparation does not keep the shared Router from later input',{timeout:nativeTestTimeout(40000)},async t=>{
 const readEntered=Promise.withResolvers(),releaseRead=Promise.withResolvers()
 let accepted=false,laterHandled=false,ran=false
 const h=await residentRouterHost(t,body=>{
   const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
   if(router){
     if(last==='resident_router_settle')return {text:'Settled'}
     const event=router.events.find(row=>row.source?.messageId==='slow-work')
     if(event&&!accepted){
       accepted=true
       return call('resident_task_plan',{operationId:'slow-work-plan',sourceId:event.sourceId,messageVersion:event.messageVersion,
         tasks:[{taskId:'slow-work-task',title:'Read the file',objective:'Verify file',requirements:[],handoff:'Read the attached fixture file.'}],dependencies:[]})
     }
     if(router.events.some(row=>row.source?.messageId==='next-channel'))laterHandled=true
     if(event)return call('resident_router_settle',{operationId:'settle-planned',eventIds:router.events.map(row=>row.id)})
     return settle(router)
   }
   if(taskInput(body)){ran=true;return decision('File verified')}
   return {text:'Idle'}
 },{config:{globalRouter:true},channelIds:['resident-fixture','other'],readResource:async()=>{
   readEntered.resolve();await releaseRead.promise;return {text:'Only synthetic fixture bytes',complete:true}
 }})
 const first=h.receive(channelMessage('slow-work',{resourceRefs:[{type:'file',resourceId:'slow-fixture',fileName:'fixture.txt'}]}))
 void first.catch(()=>{})
 try{
   const {eventually}=await import('./fixtures/resident-router-host.js')
   await Promise.race([readEntered.promise,new Promise((_,reject)=>AbortSignal.timeout(10000).addEventListener('abort',()=>reject(Error('Work attachment read did not start')),{once:true}))])
   const latter=h.receive(channelMessage('next-channel',{channelId:'other'}));void latter.catch(()=>{})
   await eventually(()=>laterHandled,'Router handles a later channel before the file resolves')
   assert.equal(ran,false)
   releaseRead.resolve()
   await Promise.all([first,latter])
   await h.service.whenIdle()
   assert.equal((await h.query('task.get',{taskId:'slow-work-task'})).completion?.summary,'File verified')
 }finally{releaseRead.resolve()}
})

test('a Host inspection read failure does not suppress the two-hour Router wake',{timeout:nativeTestTimeout(30000)},async t=>{
 let awake=false,failInspection=false
 const h=await residentRouterHost(t,body=>{
   const input=requestEnvelope(body,'Router 请求：')
   if(!input||lastCall(body)==='resident_router_settle')return {text:'Settled'}
   if(input.events.some(event=>event.kind==='router.self-check'))awake=true
   return settle(input)
 },{config:{globalRouter:true},wrapStore:store=>({...store,query:args=>{
   if(failInspection&&args.kind==='router.outcome-inspection')throw Error('Synthetic inspection failure')
   return store.query(args)
 }})})
 await h.service.routerSelfCheck(Date.now()-2*60*60*1000-1000)
 failInspection=true
 await assert.rejects(h.service.recover(),/Synthetic inspection failure/)
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>awake,'independent scheduled Router wake'))
 await h.service.whenIdle()
})

test('two-hour self-check sends a missed final result to its original channel once', {timeout:nativeTestTimeout(45000)}, async t=>{
 let original,firstOutcome,catchUp,submitted=false
 const h=await residentRouterHost(t, body=>{
  const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
  if(!router)return taskInput(body)?decision('The fixture was verified.'):{text:'Idle'}
  if(last==='resident_router_settle')return {text:'Settled'}
  const source=router.events.find(row=>row.source)
  if(source&&!original){
   original=source
   return call('resident_task_plan',{operationId:'catch-up-plan',sourceId:source.sourceId,messageVersion:source.messageVersion,dependencies:[],
    tasks:[{taskId:'catch-up-task',title:'Verify fixture',objective:'Verify fixture',requirements:[],handoff:'Verify the fixture and report the result.'}]})
  }
  if(source)return call('resident_router_settle',{operationId:'catch-up-source',eventIds:[source.id]})
  const outcome=router.events.find(row=>row.kind==='task.completed')
  if(outcome&&!firstOutcome)firstOutcome=outcome
  if(outcome&&outcome.id!==firstOutcome.id&&!submitted){
   catchUp=outcome;submitted=true
   return call('resident_router_reply',{operationId:'catch-up-reply',sourceId:original.sourceId,messageVersion:original.messageVersion,
    text:'样例验证通过。',outcomeEventId:outcome.taskEventId,replyPurpose:'task-update'})
  }
  return settle(router)
 },{config:{globalRouter:true}})
 await h.receive(channelMessage('missed-result'))
 await h.service.whenIdle()
 assert.ok(firstOutcome)
 assert.equal(h.sent.length,0)
 const now=Date.now()
 await h.service.routerSelfCheck(now)
 const clock=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(clock.nextAt)
 await h.service.whenIdle()
 assert.equal(catchUp?.taskEventId,firstOutcome.taskEventId)
 assert.equal(h.sent.length,1)
 assert.match(JSON.stringify(h.sent[0]),/样例验证通过/)
 await h.service.routerSelfCheck(clock.nextAt+7200000)
 await h.service.whenIdle()
 assert.equal(h.sent.length,1)
})

test('scheduled self-check wakes the original idle execution without changing its goal', {timeout:nativeTestTimeout(45000)}, async t=>{
 let taskId,workTurns=0,resumeAsked=false
 const sessions=new Set()
 const h=await residentRouterHost(t, async body=>{
  if(requestText(body).join('\n').includes('NIGHT_ROUTER_SELF_CHECK_REVIEW'))
   return {text:'{"summary":"The alternative fixture is now available; verify it in the same task.","limitations":[]}'}
  const router=requestEnvelope(body,'Router 请求：'),last=lastCall(body)
  if(router){
   if(last==='resident_router_settle')return {text:'Settled'}
   const row=router.events[0]
   if(row.kind==='router.self-check'&&!last&&row.selfCheck.taskIds.includes(taskId))
    return call('resident_self_check_review',{eventId:row.id,taskIds:[taskId]})
   if(row.kind==='router.self-check.completed'&&!last&&!resumeAsked){
    resumeAsked=true
    const [snap]=row.lookupResult.snapshots
    return call('resident_task_action',{operationId:'single-audit-wake',kind:'resume',taskId,
      expectedRequirementRevision:snap.requirementRevision,expectedControlRevision:snap.controlRevision})
   }
   return settle(router)
  }
  const input=taskInput(body)
  if(!input||last==='task_result')return {text:'Idle'}
  sessions.add(input.task.sessionId)
  return ++workTurns===1?call('task_result',{decision:{action:'blocked',summary:'Primary fixture unavailable.',evidence:[],limitations:[]}})
   :decision('Verified alternative fixture.')
 },{config:{globalRouter:true},wrapStore(store){
  return Object.create(store,{command:{value(action){
   // Keep the first result in the historical idle representation. Current
   // ordinary Work rounds already close automatically, even when blocked.
   if(action.kind==='task.complete'&&workTurns===1){
    const {binding,result}=action.args
    return store.command({id:'first-idle-result',kind:'task.wait',args:{binding,...result,resultSource:'pi-task-result'}})
   }
   return store.command(action)
  }}})
 }})
 const created=await h.service.createTask({requestId:'idle-goal-review',objective:'Verify a fixture'})
 taskId=created.taskId
 await h.service.whenIdle()
 const initial=await h.query('task.get',{taskId})
 assert.equal(initial.status,'active')
 assert.equal(workTurns,1)
 await h.service.routerSelfCheck(Date.now())
 const clock=await h.query('router.self-check.clock')
 await h.service.routerSelfCheck(clock.nextAt)
 await import('./fixtures/resident-router-host.js').then(x=>x.eventually(()=>workTurns===2,'scheduled wake of existing Work'))
 await h.service.whenIdle()
 const done=await h.query('task.get',{taskId})
 assert.equal(done.status,'completed')
 assert.equal(done.objective,initial.objective)
 assert.equal(done.controlRevision,initial.controlRevision)
 assert.equal(sessions.size,1)
 assert.deepEqual(h.sent,[])
})
