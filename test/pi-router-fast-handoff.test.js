import {runArchivedRouterTest,unpackArchivedRouterCheckout} from './fixtures/archived-router-checkout.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
const contextOf=body=>{for(const text of requestText(body))for(const line of text.split('\n'))if(line.startsWith('{"asOf":')&&line.includes('"sourceTaskLinks"'))return JSON.parse(line)}
const taskOf=body=>requestText(body).map(text=>{try{return JSON.parse(text).task}catch{return null}}).findLast(Boolean)
const call=(tool,args)=>({tool,args})
const settled=(h,body)=>body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError
async function waitForHost(h,t,read,description){
 try{return await eventually(read,description,t.signal)}
 catch(error){
  t.diagnostic(JSON.stringify({description,errors:h.errors.map(row=>row.message),tools:h.results.map(({name,result})=>({name,error:result.isError?result.content:undefined}))}))
  throw error
 }
}

async function runHandoff(t,baseline){
  let make=residentRouterHost,root
  if(baseline){
   root=await mkdtemp(join(tmpdir(),'router-fast-baseline-'));t.after(()=>rm(root,{recursive:true,force:true}));const code=join(root,'code');await mkdir(code)
   await unpackArchivedRouterCheckout('decb628411ea0a75e0dea626f5f1c9e90f9d6a34',code)
   make=(await import(pathToFileURL(join(code,'test/fixtures/resident-router-host.js')))).residentRouterHost
  }
  const taskRelease=Promise.withResolvers(),freezeRelease=Promise.withResolvers()
  t.after(()=>{taskRelease.resolve();freezeRelease.resolve()})
  let h,planned=false,reopenStep=0,completionStep=0,reopenTask,source,completedEvent,queued=false,dispatchAt,arrangedAt,completeAt,sendAt,queueAt,queueStartedAt,followRequests=0,completionRequests=0,followToAction,completionToReply,freezeCount=0
  const observations=[],opens={create:0,resume:0}
  h=await make(t,async body=>{
   const names=requestTools(body)
   if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
   if(names.includes('task_result')){const task=taskOf(body);if(task.requirementRevision>1){dispatchAt=Date.now();await taskRelease.promise}return call('task_result',{decision:{action:'complete',summary:'Synthetic read-only verification completed',evidence:['fixture:verified'],limitations:['No live system accessed']}})}
   if(!names.includes('resident_router_settle'))return {text:'No work'}
   const input=requestEnvelope(body,'Router 请求：'),ctx=contextOf(body),event=input.events.find(e=>e.source)
   if(event?.source.messageId==='continue')followRequests++
   const done=input.events.find(e=>e.kind==='task.completed'&&e.taskEvent.requirementRevision>1)
   if(done)completionRequests++
   if(settled(h,body))return {text:'Settled'}
   if(event?.source.messageId==='start'&&!planned){planned=true;return call('resident_task_plan',{operationId:'start',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'original',title:'Read-only verification',objective:'Check synthetic evidence',requirements:['Read only; do not modify or deploy'],...baseline?{}:{handoff:'Verify the synthetic evidence without modifying or deploying anything.'}}],dependencies:[]})}
   if(event?.source.messageId==='continue'){
    source=event.source
    const handoff=ctx?.taskHandoffs?.find(row=>row.task.taskId==='original')
    if(!handoff&&reopenStep++===0)return call('resident_task_query',{})
    if(!handoff&&reopenStep===2)return call('memory_read',{})
    if(!handoff&&reopenStep===3)return call('resident_task_query',{taskId:'original',detail:'full'})
    if(!reopenTask){
     reopenTask=handoff?.task??JSON.parse(body.messages.at(-1).content).task
     if(handoff){assert.equal(handoff.requiresFullRead,false);assert.match(handoff.task.requirements.join(' '),/Read only/)}
     followToAction=followRequests
     return call('resident_task_action',{operationId:'continue-original',kind:'reopen',sameGoal:true,taskId:reopenTask.taskId,sourceId:event.sourceId,messageVersion:event.messageVersion,expectedRequirementRevision:reopenTask.requirementRevision,expectedControlRevision:reopenTask.controlRevision,...baseline?{}:{handoff:'Continue the same synthetic verification without modifying or deploying anything.'}})
    }
   }
   if(done){
    completedEvent=done
    const completion=ctx?.completionContexts?.find(row=>row.completion?.eventId===done.taskEventId)?.completion
    if(!completion&&completionStep===0){completionStep=1;return call('resident_task_query',{taskId:'original',detail:'full'})}
    if(!completion&&completionStep===1){completionStep=2;return call('resident_reply_query',{sourceId:source.sourceId})}
    if(completionStep<3){
     completionToReply=completionRequests;completionStep=3
     if(completion){
      assert.equal(completion.status,'current');assert.deepEqual(completion.result.limitations,['No live system accessed']);assert.equal(completion.sources.find(row=>row.sourceId===source.sourceId).completionReply.replies.length,0)
      const scope=ctx.taskOutcomeQuestions.find(row=>row.outcomeEventId===done.taskEventId)
      assert.equal(scope.text,'Please do the synthetic read-only verification. Do not modify or deploy.')
      assert.deepEqual(scope.updates,[{sourceId:source.sourceId,messageVersion:source.version,text:source.text}],'the reply scope carries the exact admitted follow-up even though quote/dedup still use the original')
     }
     return call('resident_router_reply',{operationId:'completion-result',sourceId:source.sourceId,messageVersion:source.version,...completion?{completionEventId:done.taskEventId}:{},replyPurpose:'task-update',text:'Synthetic verification is complete. The evidence checked out; no live system was accessed.'})
    }
   }
   if(event?.source.messageId==='queued'){queued=true;queueStartedAt=Date.now()}
   return call('resident_router_settle',{operationId:'settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)})
  },{
   wrapStore:store=>({...store,command:async command=>{
    if(!baseline&&command.kind==='notification.prepare'&&command.args.kind==='router-reply'){freezeCount++;await freezeRelease.promise}
    const value=await store.command(command)
    if(command.kind==='task.complete'&&command.args.binding.requirementRevision>1)completeAt=Date.now()
    if(command.kind==='router.task-action'&&command.args.kind==='task.reopen')arrangedAt=Date.now()
    return value
   }}),
   send:()=>{sendAt=Date.now();return {messageId:'synthetic-visible'}},
   ...baseline?{hostOptions:{replyQuality:async({candidates})=>{
    freezeCount++;await freezeRelease.promise
    return {text:JSON.stringify({decisions:candidates.map(({index})=>({index,issues:[]}))})}
   }}}:{}
  })
  const watch=()=>{const agents=h.host.ctx.agents;for(const kind of ['create','resume']){const original=agents[kind].bind(agents);agents[kind]=(...args)=>{if(args[0]?.meta?.runtimeOwner==='conversation-router'||args[0]?.resumeSessionId?.startsWith('router-'))opens[kind]++;return original(...args)}};h.host.ctx.on('night/agent-observation',(actor,record)=>{if(actor.metadata.runtimeOwner==='conversation-router')observations.push(record)})}
  watch()
  if(!baseline)h.host.ctx.channels.transports.get('resident-fixture').capabilities={quotedReplies:['chat-room']}
  const first=channelMessage('start',{text:'Please do the synthetic read-only verification. Do not modify or deploy.'})
  await h.receive(first);await h.service.whenIdle();const conversationId=h.host.ctx.channels.identity(first).sessionId,row=await h.query('router.get',{conversationId}),owner=h.host.ctx.agents.get(row.activeSessionId)
  const initialTask=await h.query('task.get',{taskId:'original'})
  assert.equal(initialTask.status,'completed',JSON.stringify(initialTask.workspaceInitialization))
  const following=h.receive(channelMessage('continue',{senderId:baseline?'alice':'bob',text:'Continue the same verification, with the original read-only restrictions.',quotedMessage:{messageId:'start',senderId:first.senderId,text:first.text}}));await waitForHost(h,t,()=>dispatchAt,`reopened task enters its existing session (baseline=${baseline})`)
  await eventually(async()=>!(await h.query('router.inbox',{conversationId})).some(e=>e.source?.messageId==='continue'),'dispatch source settles while original task runs',t.signal)
  assert.equal(h.host.ctx.agents.get(row.activeSessionId),owner,'warm follow-up retains actual SDK actor')
  assert.equal((await h.query('task.get',{taskId:'original'})).sessionId,initialTask.sessionId)
  taskRelease.resolve();await waitForHost(h,t,()=>freezeCount,`the completion reaches its send boundary (baseline=${baseline})`)
  queueAt=Date.now();const queuedReceive=h.receive(channelMessage('queued',{text:'Independent context only; no new task.'}));await eventually(async()=>(await h.query('router.inbox',{conversationId})).some(e=>e.source?.messageId==='queued'),'next source is durably queued before reply freeze',t.signal);assert.equal(queued,false,'the pending freeze remains serialized')
  freezeRelease.resolve();await following;await queuedReceive;await h.service.whenIdle();assert.equal(queued,true)
  assert.equal(h.sent.length,1);assert.equal(freezeCount,1);assert.equal((await h.query('task.list')).length,1)
  assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
  assert.equal(await h.query('router.inbox-count',{conversationId}),0)
  if(!baseline){
   const stored=(await h.query('notification.list'))[0];assert.equal(stored.payload.completionBinding.eventId,completedEvent.taskEventId);assert.equal(stored.payload.sourceId,source.sourceId)
   assert.deepEqual(h.sent[0].recipientIds,[first.senderId]);assert.equal(h.sent[0].replyToMessageId,undefined,'completion mentions the original owner rather than quoting the other author');
   assert.ok(!h.requests.some(body=>body.messages.some(row=>row.role==='system'&&row.content.startsWith('NIGHT_BOT_REPLY_QUALITY_REVIEW'))));
   for(const phase of ['router-reply-lookup','router-reply-register'])assert.ok(observations.some(o=>o.summary.phase===phase),phase)
   const requests=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,requests,'empty idle performs no model keepalive')
  }
  await h.restart();watch();await h.receive(channelMessage('after-restart',{text:'Background after restart; no action.'}));await h.service.whenIdle();assert.equal(h.sent.length,1)
  assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
  const sources=await h.query('source.list'),continued=sources.find(row=>row.messageId==='continue'),queuedSource=sources.find(row=>row.messageId==='queued')
  const notification=(await h.query('notification.list'))[0];assert.equal(notification.state,'delivered')
  const queueStart=queuedSource.stages?.filter(stage=>stage.stage==='router'&&!stage.phase).map(stage=>Date.parse(stage.startedAt)).find(Number.isFinite)
  assert.ok(Number.isFinite(queueStart),'queue start is the observed Host preparation boundary')
  const phaseNames=['session-sdk-create','session-create','session-resume','input-enqueue','before-run','skills','system-prompt','request-prepare','context-projection','router-reply-register']
  const phaseStats=Object.fromEntries(phaseNames.flatMap(phase=>{const values=observations.filter(o=>o.kind==='phase-completed'&&o.summary.phase===phase).map(o=>o.summary.elapsedMs);return values.length?[[phase,{count:values.length,minMs:Math.min(...values),maxMs:Math.max(...values)}]]:[]}))
  const firstOutputs=observations.filter(o=>o.kind==='model-first-token').map(o=>{const start=observations.find(v=>v.kind==='model-started'&&v.spanId===o.spanId);return start?o.timestamp-start.timestamp:null}).filter(v=>v!==null)
  const comparison={baseline,receivedToOriginalDispatchMs:dispatchAt-Date.parse(continued.receivedAt),receivedToArrangementReceiptMs:arrangedAt-Date.parse(continued.receivedAt),completionToDeliveredMs:Date.parse(notification.deliveredAt)-Date.parse(completedEvent.taskEvent.recordedAt),queuedToStartedMs:queueStart-Date.parse(queuedSource.receivedAt),queuedToModelRequestMs:queueStartedAt-Date.parse(queuedSource.receivedAt),requestsToDispatch:followToAction,requestsToCompletionReply:completionToReply,dispatchBatchRouterRequests:followRequests,completionBatchRouterRequests:completionRequests,freezeCalls:freezeCount,opens,coldWarm:'initial-create; warm-same-actor; restart-resume',phaseStats,modelFirstOutputMs:firstOutputs}
  await h.close();await h.host.close()
  return comparison
}
const archivedOnly=process.argv[2]==='--archived-baseline'
if(archivedOnly)test('archived Host handoff',{timeout:nativeTestTimeout(60000)},async t=>{
 t.diagnostic('archived comparison: '+JSON.stringify(await runHandoff(t,true)))
})
else test('controlled old/new Host: exact continuation and completion avoid directory rounds; same warm owner, safe reply identity and queued work',{timeout:nativeTestTimeout(120000)},async t=>{
 const stdout=await runArchivedRouterTest(t,import.meta.url)
 const report=stdout.split(String.fromCharCode(10)).find(line=>line.startsWith('# archived comparison: '))
 assert.ok(report,stdout)
 const comparisons=[JSON.parse(report.slice('# archived comparison: '.length)),await runHandoff(t,false)]
 assert.equal(comparisons[0].requestsToDispatch,4);assert.equal(comparisons[1].requestsToDispatch,1)
 assert.equal(comparisons[0].requestsToCompletionReply,3);assert.equal(comparisons[1].requestsToCompletionReply,1)
 assert.equal(comparisons[0].dispatchBatchRouterRequests,6);assert.equal(comparisons[1].dispatchBatchRouterRequests,3)
 assert.equal(comparisons[0].completionBatchRouterRequests,5);assert.equal(comparisons[1].completionBatchRouterRequests,3)
 t.diagnostic(JSON.stringify({syntheticOnly:true,comparisons,realVendorLatencyMeasured:false}))
})

if(!archivedOnly)for(const change of ['source-version','task-revision','duplicate-id'])test('completion reply rechecks '+change+' inside the freeze transaction before any send',{timeout:nativeTestTimeout(30000)},async t=>{
 const release=Promise.withResolvers();t.after(()=>release.resolve());let entered=false,h,planned=false,attempted=false,duplicateAttempt=false,completionSource
 h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(names.includes('task_result'))return call('task_result',{decision:{action:'complete',summary:'Fixture verified',evidence:['fixture'],limitations:[]}})
  if(!names.includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：')
  if(settled(h,body))return {text:'Settled'}
  if(!planned){planned=true;completionSource=input.events[0].source;return call('resident_task_plan',{operationId:'plan',sourceId:completionSource.sourceId,messageVersion:completionSource.version,tasks:[{taskId:'review-task',title:'Synthetic check',objective:'Read only',requirements:[],handoff:'Verify the synthetic evidence without changing it.'}],dependencies:[]})}
  const done=input.events.find(e=>e.kind==='task.completed')
  if(done&&!attempted){attempted=true;return call('resident_router_reply',{operationId:'reply',sourceId:completionSource.sourceId,messageVersion:completionSource.version,completionEventId:done.taskEventId,text:'The fixture check is complete.',replyPurpose:'task-update'})}
  if(done&&change==='duplicate-id'&&!duplicateAttempt){duplicateAttempt=true;return call('resident_router_reply',{operationId:'changed-id',sourceId:completionSource.sourceId,messageVersion:completionSource.version,text:'Changed duplicate must not send.',replyPurpose:'task-update'})}
  if(done&&change!=='duplicate-id')return {text:'Reply failed after scope changed; keep the event pending without sending.'}
  return call('resident_router_settle',{operationId:'settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)})
 },{wrapStore:store=>({...store,command:async command=>{
  if(command.kind==='notification.prepare'&&command.args.kind==='router-reply'){entered=true;await release.promise}
  return store.command(command)
 }})})
 const receiving=h.receive(channelMessage('review-source',{text:'Read-only synthetic verification.'}));await waitForHost(h,t,()=>entered,`reply reaches the freeze boundary before ${change}`)
 if(change==='task-revision'){await eventually(async()=>(await h.query('task.get',{taskId:'review-task'})).drained,'completed task drained before concurrent reopen',t.signal);await h.store.command({id:'operator-reopen',kind:'task.reopen',args:{taskId:'review-task',expectedRequirementRevision:1,expectedControlRevision:1,request:'New revision: still read only'}})}
 else if(change==='source-version')await h.store.command({id:'new-source-version',kind:'source.record-direct',args:{source:{...completionSource,groupId:completionSource.conversationId,sourceId:completionSource.sourceId+'-v2',version:2,text:'Changed request; no old completion reply'},conversation:{conversationId:completionSource.conversationId},routeDirect:true}})
 release.resolve();await receiving;await h.service.whenIdle().catch(error=>assert.equal(error.code,'ROUTER_BATCH_UNSETTLED'))
 assert.equal(h.sent.length,change==='duplicate-id'?1:0);assert.equal((await h.query('notification.list')).length,change==='duplicate-id'?1:0)
 assert.ok(h.results.some(row=>row.name==='resident_router_reply'&&row.result.isError))
})
