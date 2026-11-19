import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {once} from 'node:events'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
const contextOf=body=>{for(const text of requestText(body))for(const line of text.split('\n'))if(line.startsWith('{"asOf":')&&line.includes('"sourceTaskLinks"'))return JSON.parse(line)}
const taskOf=body=>requestText(body).map(text=>{try{return JSON.parse(text).task}catch{return null}}).findLast(Boolean)
const call=(tool,args)=>({tool,args})
const settled=(h,body)=>body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError

test('controlled old/new Host: exact continuation and completion avoid directory rounds; same warm owner, safe reply identity and queued work',{timeout:nativeTestTimeout(120000)},async t=>{
 const comparisons=[]
 for(const baseline of [true,false]){
  let make=residentRouterHost,root
  if(baseline){
   root=await mkdtemp(join(tmpdir(),'router-fast-baseline-'));t.after(()=>rm(root,{recursive:true,force:true}));const code=join(root,'code');await mkdir(code)
   const repo=fileURLToPath(new URL('../',import.meta.url)),{stdout}=await promisify(execFile)('git',['archive','decb628411ea0a75e0dea626f5f1c9e90f9d6a34'],{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
   const tar=spawn('tar',['-x','-C',code]);tar.stdin.end(stdout);assert.equal((await once(tar,'exit'))[0],0);await symlink(join(repo,'node_modules'),join(code,'node_modules'),'dir')
   make=(await import(pathToFileURL(join(code,'test/fixtures/resident-router-host.js')))).residentRouterHost
  }
  const taskEntered=Promise.withResolvers(),taskRelease=Promise.withResolvers(),reviewEntered=Promise.withResolvers(),reviewRelease=Promise.withResolvers()
  t.after(()=>{taskRelease.resolve();reviewRelease.resolve()})
  let h,planned=false,reopenStep=0,completionStep=0,reopenTask,source,completedEvent,queued=false,followAt,dispatchAt,arrangedAt,completeAt,sendAt,queueAt,queueStartedAt,followRequests=0,completionRequests=0,followToAction,completionToReply,reviewCount=0
  const observations=[],opens={create:0,resume:0}
  h=await make(t,async body=>{
   const names=requestTools(body)
   if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
   if(names.includes('task_result')){const task=taskOf(body);if(task.requirementRevision>1){dispatchAt=Date.now();taskEntered.resolve();await taskRelease.promise}return call('task_result',{decision:{action:'complete',summary:'Synthetic read-only verification completed',evidence:['fixture:verified'],limitations:['No live system accessed']}})}
   if(!names.includes('resident_router_settle'))return {text:'No work'}
   const input=requestEnvelope(body,'Router 请求：'),ctx=contextOf(body),event=input.events.find(e=>e.source)
   if(event?.source.messageId==='continue')followRequests++
   const done=input.events.find(e=>e.kind==='task.completed'&&e.taskEvent.requirementRevision>1)
   if(done)completionRequests++
   if(settled(h,body))return {text:'Settled'}
   if(event?.source.messageId==='start'&&!planned){planned=true;return call('resident_task_plan',{operationId:'start',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'original',title:'Read-only verification',objective:'Check synthetic evidence',requirements:['Read only; do not modify or deploy']}],dependencies:[]})}
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
     return call('resident_task_action',{operationId:'continue-original',kind:'reopen',sameGoal:true,taskId:reopenTask.taskId,sourceId:event.sourceId,messageVersion:event.messageVersion,expectedRequirementRevision:reopenTask.requirementRevision,expectedControlRevision:reopenTask.controlRevision})
    }
   }
   if(done){
    completedEvent=done
    const completion=ctx?.completionContexts?.find(row=>row.completion?.eventId===done.taskEventId)?.completion
    if(!completion&&completionStep===0){completionStep=1;return call('resident_task_query',{taskId:'original',detail:'full'})}
    if(!completion&&completionStep===1){completionStep=2;return call('resident_reply_query',{sourceId:source.sourceId})}
    if(completionStep<3){
     completionToReply=completionRequests;completionStep=3
     if(completion){assert.equal(completion.status,'current');assert.deepEqual(completion.result.limitations,['No live system accessed']);assert.equal(completion.sources.find(row=>row.sourceId===source.sourceId).completionReply.replies.length,0)}
     return call('resident_router_reply',{operationId:'completion-result',sourceId:source.sourceId,messageVersion:source.version,...completion?{completionEventId:done.taskEventId}:{},replyPurpose:'task-update',text:'Synthetic verification is complete. The evidence checked out; no live system was accessed.'})
    }
   }
   if(event?.source.messageId==='queued'){queued=true;queueStartedAt=Date.now()}
   return call('resident_router_settle',{operationId:'settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)})
  },{
   wrapStore:store=>({...store,command:async command=>{
    const value=await store.command(command)
    if(command.kind==='task.complete'&&command.args.binding.requirementRevision>1)completeAt=Date.now()
    if(command.kind==='router.task-action'&&command.args.kind==='task.reopen')arrangedAt=Date.now()
    return value
   }}),
   send:()=>{sendAt=Date.now();return {messageId:'synthetic-visible'}},
   hostOptions:{replyQuality:async({candidates})=>{
    reviewCount++;reviewEntered.resolve();await reviewRelease.promise
    return {text:JSON.stringify({decisions:candidates.map(({index})=>({index,issues:[]}))})}
   }}
  })
  const watch=()=>{const agents=h.host.ctx.agents;for(const kind of ['create','resume']){const original=agents[kind].bind(agents);agents[kind]=(...args)=>{if(args[0]?.meta?.runtimeOwner==='conversation-router'||args[0]?.resumeSessionId?.startsWith('router-'))opens[kind]++;return original(...args)}};h.host.ctx.on('night/agent-observation',(actor,record)=>{if(actor.metadata.runtimeOwner==='conversation-router')observations.push(record)})}
  watch()
  const first=channelMessage('start',{text:'Please do the synthetic read-only verification. Do not modify or deploy.'})
  await h.receive(first);await h.service.whenIdle();const conversationId=h.host.ctx.channels.identity(first).sessionId,row=await h.query('router.get',{conversationId}),owner=h.host.ctx.agents.get(row.activeSessionId)
  const initialTask=await h.query('task.get',{taskId:'original'})
  followAt=Date.now();const following=h.receive(channelMessage('continue',{text:'Continue the same verification, with the original read-only restrictions.',quotedMessage:{messageId:'start',senderId:first.senderId,text:first.text}}));await taskEntered.promise
  await eventually(async()=>!(await h.query('router.inbox',{conversationId})).some(e=>e.source?.messageId==='continue'),'dispatch source settles while original task runs',t.signal)
  assert.equal(h.host.ctx.agents.get(row.activeSessionId),owner,'warm follow-up retains actual SDK actor')
  assert.equal((await h.query('task.get',{taskId:'original'})).sessionId,initialTask.sessionId)
  taskRelease.resolve();await reviewEntered.promise
  queueAt=Date.now();const queuedReceive=h.receive(channelMessage('queued',{text:'Independent context only; no new task.'}));await eventually(async()=>(await h.query('router.inbox',{conversationId})).some(e=>e.source?.messageId==='queued'),'next source is durably queued during reply review',t.signal);assert.equal(queued,false,'mandatory reply review remains serialized')
  reviewRelease.resolve();await following;await queuedReceive;await h.service.whenIdle();assert.equal(queued,true)
  assert.equal(h.sent.length,1);assert.equal(reviewCount,1);assert.equal((await h.query('task.list')).length,1)
  assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
  assert.equal(await h.query('router.inbox-count',{conversationId}),0)
  if(!baseline){
   const stored=(await h.query('notification.list'))[0];assert.equal(stored.payload.completionBinding.eventId,completedEvent.taskEventId);assert.equal(stored.payload.sourceId,source.sourceId)
   for(const phase of ['router-reply-lookup','router-reply-review','router-reply-register'])assert.ok(observations.some(o=>o.summary.phase===phase),phase)
   const requests=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,requests,'empty idle performs no model keepalive')
  }
  await h.restart();watch();await h.receive(channelMessage('after-restart',{text:'Background after restart; no action.'}));await h.service.whenIdle();assert.equal(h.sent.length,1)
  assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
  const sources=await h.query('source.list'),continued=sources.find(row=>row.messageId==='continue'),queuedSource=sources.find(row=>row.messageId==='queued')
  const notification=(await h.query('notification.list'))[0];assert.equal(notification.state,'delivered')
  const queueStart=queuedSource.stages?.filter(stage=>stage.stage==='router'&&!stage.phase).map(stage=>Date.parse(stage.startedAt)).find(Number.isFinite)
  assert.ok(Number.isFinite(queueStart),'queue start is the observed Host preparation boundary')
  const phaseNames=['session-sdk-create','session-create','session-resume','input-enqueue','before-run','skills','system-prompt','request-prepare','context-projection','router-reply-review','router-reply-register']
  const phaseStats=Object.fromEntries(phaseNames.flatMap(phase=>{const values=observations.filter(o=>o.kind==='phase-completed'&&o.summary.phase===phase).map(o=>o.summary.elapsedMs);return values.length?[[phase,{count:values.length,minMs:Math.min(...values),maxMs:Math.max(...values)}]]:[]}))
  const firstOutputs=observations.filter(o=>o.kind==='model-first-token').map(o=>{const start=observations.find(v=>v.kind==='model-started'&&v.spanId===o.spanId);return start?o.timestamp-start.timestamp:null}).filter(v=>v!==null)
  comparisons.push({baseline,receivedToOriginalDispatchMs:dispatchAt-Date.parse(continued.receivedAt),receivedToArrangementReceiptMs:arrangedAt-Date.parse(continued.receivedAt),completionToDeliveredMs:Date.parse(notification.deliveredAt)-Date.parse(completedEvent.taskEvent.recordedAt),queuedToStartedMs:queueStart-Date.parse(queuedSource.receivedAt),queuedToModelRequestMs:queueStartedAt-Date.parse(queuedSource.receivedAt),requestsToDispatch:followToAction,requestsToCompletionReply:completionToReply,dispatchBatchRouterRequests:followRequests,completionBatchRouterRequests:completionRequests,reviewRequests:reviewCount,opens,coldWarm:'initial-create; warm-same-actor; restart-resume',phaseStats,modelFirstOutputMs:firstOutputs})
  await h.close();await h.host.close()
 }
 assert.equal(comparisons[0].requestsToDispatch,4);assert.equal(comparisons[1].requestsToDispatch,1)
 assert.equal(comparisons[0].requestsToCompletionReply,3);assert.equal(comparisons[1].requestsToCompletionReply,1)
 assert.equal(comparisons[0].dispatchBatchRouterRequests,6);assert.equal(comparisons[1].dispatchBatchRouterRequests,3)
 assert.equal(comparisons[0].completionBatchRouterRequests,5);assert.equal(comparisons[1].completionBatchRouterRequests,3)
 t.diagnostic(JSON.stringify({syntheticOnly:true,comparisons,realVendorLatencyMeasured:false}))
})

for(const change of ['source-version','task-revision','duplicate-id'])test('completion reply rechecks '+change+' after required review, before any freeze/send',{timeout:nativeTestTimeout(30000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let h,planned=false,attempted=false,duplicateAttempt=false,completionSource
 h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(names.includes('task_result'))return call('task_result',{decision:{action:'complete',summary:'Fixture verified',evidence:['fixture'],limitations:[]}})
  if(!names.includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：')
  if(settled(h,body))return {text:'Settled'}
  if(!planned){planned=true;completionSource=input.events[0].source;return call('resident_task_plan',{operationId:'plan',sourceId:completionSource.sourceId,messageVersion:completionSource.version,tasks:[{taskId:'review-task',title:'Synthetic check',objective:'Read only',requirements:[]}],dependencies:[]})}
  const done=input.events.find(e=>e.kind==='task.completed')
  if(done&&!attempted){attempted=true;return call('resident_router_reply',{operationId:'reply',sourceId:completionSource.sourceId,messageVersion:completionSource.version,completionEventId:done.taskEventId,text:'The fixture check is complete.',replyPurpose:'task-update'})}
  if(done&&change==='duplicate-id'&&!duplicateAttempt){duplicateAttempt=true;return call('resident_router_reply',{operationId:'changed-id',sourceId:completionSource.sourceId,messageVersion:completionSource.version,text:'Changed duplicate must not send.',replyPurpose:'task-update'})}
  if(done&&change!=='duplicate-id')return {text:'Review finished after scope changed; keep the event pending without sending.'}
  return call('resident_router_settle',{operationId:'settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)})
 },{hostOptions:{replyQuality:async({candidates})=>{
  entered.resolve();await release.promise
  return {text:JSON.stringify({decisions:candidates.map(({index})=>({index,issues:[]}))})}
 }}})
 const receiving=h.receive(channelMessage('review-source',{text:'Read-only synthetic verification.'}));await entered.promise
 if(change==='task-revision'){await eventually(async()=>(await h.query('task.get',{taskId:'review-task'})).drained,'completed task drained before concurrent reopen',t.signal);await h.store.command({id:'operator-reopen',kind:'task.reopen',args:{taskId:'review-task',expectedRequirementRevision:1,expectedControlRevision:1,request:'New revision: still read only'}})}
 else if(change==='source-version')await h.store.command({id:'new-source-version',kind:'source.record-direct',args:{source:{...completionSource,groupId:completionSource.conversationId,sourceId:completionSource.sourceId+'-v2',version:2,text:'Changed request; no old completion reply'},conversation:{conversationId:completionSource.conversationId},routeDirect:true}})
 release.resolve();await receiving;await h.service.whenIdle().catch(error=>assert.equal(error.code,'ROUTER_BATCH_UNSETTLED'))
 assert.equal(h.sent.length,change==='duplicate-id'?1:0);assert.equal((await h.query('notification.list')).length,change==='duplicate-id'?1:0)
 assert.ok(h.results.some(row=>row.name==='resident_router_reply'&&row.result.isError))
})
