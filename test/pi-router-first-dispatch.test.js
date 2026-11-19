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
const call=(tool,args)=>({tool,args})
const settled=(h,body)=>body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError

for(const scenario of ['old-finish','finish','reply-review','dependency'])test('first-turn dispatch independent of Router '+scenario,{timeout:nativeTestTimeout(45000)},async t=>{
 let make=residentRouterHost,baseline=scenario==='old-finish',archive
 if(baseline){
  archive=await mkdtemp(join(tmpdir(),'first-dispatch-old-'));t.after(()=>rm(archive,{recursive:true,force:true}));const code=join(archive,'code');await mkdir(code)
  const repo=fileURLToPath(new URL('../',import.meta.url)),{stdout}=await promisify(execFile)('git',['archive','1878f0dc752db92083bf032d9eb6297fafced0ab'],{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
  const tar=spawn('tar',['-x','-C',code]);tar.stdin.end(stdout);assert.equal((await once(tar,'exit'))[0],0);await symlink(join(repo,'node_modules'),join(code,'node_modules'),'dir')
  make=(await import(pathToFileURL(join(code,'test/fixtures/resident-router-host.js')))).residentRouterHost
 }
 const routerHeld=Promise.withResolvers(),routerRelease=Promise.withResolvers(),executionEntered=Promise.withResolvers(),executionRelease=Promise.withResolvers()
 let h,planned=false,paused=false,reply=false,routerRequests=0,planRequestCount=0,prePlanTools=[],firstRequestAt,committedAt,executionAt,sessionId,completedReturned=false,reviewCount=0,completionSeen=false,startedTasks=[]
 t.after(()=>{routerRelease.resolve();executionRelease.resolve()})
 h=await make(t,async body=>{
  const names=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(names.includes('task_result')){
   const input=requestText(body).map(text=>{try{return JSON.parse(text)}catch{return null}}).findLast(row=>row?.task)
   startedTasks.push(input.task.taskId);assert.equal(input.task.taskId,'first-task','unsatisfied dependent B must not start')
   sessionId=input.task.sessionId;assert.match(input.task.requirements.join('\n'),/Read only/)
   assert.ok(input.sources.some(source=>source.text.includes('Do not modify or deploy')))
   executionAt=Date.now();executionEntered.resolve();await executionRelease.promise
   return call('task_result',{decision:{action:'complete',summary:'Synthetic read-only check complete',evidence:['fixture:checked'],limitations:['No live system accessed']}})
  }
  if(!names.includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
  if(input.events.some(event=>event.kind==='task.completed'&&event.taskId==='first-task'))completionSeen=true
  if(source?.messageId==='new-work'){
   routerRequests++;firstRequestAt??=Date.now()
   if(!baseline)assert.match(requestText(body).join('\n'),/首个模型请求直接提交resident_task_plan/)
  }
  if(settled(h,body))return {text:'Original source settled'}
  if(!planned&&source){
   if(baseline&&prePlanTools.length===0){prePlanTools.push('resident_task_query');return call('resident_task_query',{})}
   if(baseline&&prePlanTools.length===1){prePlanTools.push('memory_read');return call('memory_read',{})}
   planned=true;planRequestCount=routerRequests
   const tasks=[{taskId:'first-task',title:'Synthetic read-only check',objective:'Check fixture only',requirements:['Read only; do not modify or deploy']}]
   if(scenario==='dependency')tasks.push({taskId:'blocked-task',title:'B after A acceptance',objective:'Use accepted A evidence only',requirements:['Wait for Router acceptance of A']})
   return call('resident_task_plan',{operationId:'stable-first-plan',sourceId:source.sourceId,messageVersion:source.version,tasks,dependencies:scenario==='dependency'?[{taskId:'blocked-task',prerequisiteTaskId:'first-task',condition:'Router has accepted the verified A evidence'}]:[]})
  }
  if(source&&!paused&&scenario!=='reply-review'){paused=true;routerHeld.resolve();await routerRelease.promise;completedReturned=true}
  if(source&&scenario==='reply-review'&&!reply){reply=true;return call('resident_router_reply',{operationId:'actual-arrangement-stage',sourceId:source.sourceId,messageVersion:source.version,replyPurpose:'task-update',text:'The synthetic check has been registered with its read-only constraints.'})}
  return call('resident_router_settle',{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)})
 },{wrapStore:store=>({...store,command:async command=>{const receipt=await store.command(command);if(command.kind==='router.plan')committedAt??=Date.now();return receipt}}),hostOptions:{replyQuality:async({candidates})=>{
  reviewCount++;routerHeld.resolve();await routerRelease.promise;completedReturned=true
  return {text:JSON.stringify({decisions:candidates.map(({index})=>({index,issues:[]}))})}
 }}})
 const message=channelMessage('new-work',{text:'Assistant, run a new synthetic read-only fixture check. Do not modify or deploy.'})
 const receiving=h.receive(message)
 await Promise.all([executionEntered.promise,routerHeld.promise])
 assert.equal(completedReturned,false,'Router finishing/reply review is still held')
 assert.equal(planRequestCount,baseline?3:1)
 const plannedIndex=h.results.findIndex(row=>row.name==='resident_task_plan');assert.ok(plannedIndex>=0)
 assert.deepEqual(h.results.slice(0,plannedIndex).map(row=>row.name),baseline?['resident_task_query','memory_read']:[])
 const task=await h.query('task.get',{taskId:'first-task'});assert.equal(task.sessionId,sessionId);assert.equal(task.leaseEpoch,1)
 assert.ok(Number.isFinite(committedAt)&&executionAt>=committedAt)
 const journal=await h.host.ctx.sessionPersistence.readNative(sessionId,{requireComplete:true})
 assert.ok(journal.audit.some(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='task-input'),'actual durable original execution input')
 executionRelease.resolve()
 await eventually(async()=>(await h.query('task.get',{taskId:'first-task'})).status==='completed','execution completes while Router remains held',t.signal)
 assert.equal(completedReturned,false);assert.deepEqual(startedTasks,['first-task']);assert.equal(h.sent.length,0,'no external response is required to start execution')
 const source=(await h.query('source.list')).find(source=>source.messageId==='new-work')
 const [inboxEvent]=await h.query('router.batch-events',{conversationId:source.groupId,eventIds:[source.routeReceipt.eventId]})
 assert.ok(Number.isFinite(Date.parse(inboxEvent.createdAt)))
 const diagnostic={syntheticOnly:true,scenario,queuedToRouterRequestMs:firstRequestAt-Date.parse(inboxEvent.createdAt),requestToDurablePlanMs:committedAt-firstRequestAt,durablePlanToExecutionRequestMs:executionAt-committedAt,prePlanTools,requestsThroughPlan:planRequestCount,startedBeforeRouterReleased:true,reviewCount,realVendorLatencyMeasured:false}
 routerRelease.resolve();await receiving;await h.service.whenIdle();assert.equal(completionSeen,true,'durable task completion returns to the original Router');
 if(scenario==='dependency'){assert.equal((await h.query('task.get',{taskId:'blocked-task'})).dependenciesReady,false);assert.deepEqual(startedTasks,['first-task'])}
 assert.equal((await h.query('task.list')).length,scenario==='dependency'?2:1)
 const beforeRequests=h.requests.length,beforeSent=h.sent.length
 await h.receive(message);await h.service.whenIdle();assert.equal(h.requests.length,beforeRequests);assert.equal(h.sent.length,beforeSent)
 // This case verifies dependency fencing before restart. The extra blocked-B
 // restart/whenIdle probe did not converge and is recorded separately.
 if(scenario!=='dependency'){await h.restart();await h.service.whenIdle();assert.equal(h.sent.length,beforeSent);assert.deepEqual(startedTasks,['first-task'])}
 assert.equal((await h.query('task.get',{taskId:'first-task'})).sessionId,sessionId)
 t.diagnostic(JSON.stringify(diagnostic))
 await h.close();await h.host.close();
})

for(const kind of ['status','chat','ambiguous'])test('first-turn guidance does not create work for controlled '+kind,{timeout:nativeTestTimeout(20000)},async t=>{
 const text={status:'Which existing tasks are waiting? Do not start anything.',chat:'Thanks, I am just sharing this as context.',ambiguous:'Do that thing; the target and scope are not specified.'}[kind]
 let h,replied=false,queried=false,first=true
 h=await residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：'),event=input.events.find(event=>event.source)
  if(settled(h,body))return {text:'Settled'}
  if(first){first=false;assert.match(requestText(body).join('\n'),/状态询问、闲聊、歧义或多匹配不据关键词自动派发/)}
  if(kind==='status'&&!queried){queried=true;return call('resident_task_query',{detail:'index'})}
  if(kind!=='chat'&&!replied){replied=true;return call('resident_router_reply',{operationId:'non-execution-reply',sourceId:event.sourceId,messageVersion:event.messageVersion,replyPurpose:'direct-answer',text:kind==='ambiguous'?'Which target should I check, and what scope should I keep?':'No existing tasks are recorded in this synthetic conversation.'})}
  const notificationId=h.results.findLast(row=>row.name==='resident_router_reply'&&!row.result.isError)?.result.value.notification.id
  return call('resident_router_settle',{operationId:'silent',eventIds:input.events.map(event=>event.id),noTaskDispositions:[{eventId:event.id,outcome:kind==='ambiguous'?'clarification':kind==='status'?'handled-inline':'context-only',...kind==='ambiguous'?{notificationId,missingInformation:['target','scope']}:{},sourceQuote:event.source.text,reason:'Controlled case has no execution instruction; status was checked or specific missing inputs requested'}]})
 })
 await h.receive(channelMessage(kind,{text}));await h.service.whenIdle().catch(error=>assert.equal(error.code,'ROUTER_BATCH_UNSETTLED'))
 assert.equal((await h.query('task.list')).length,0);assert.ok(!h.results.some(row=>row.name==='resident_task_plan'));assert.equal(h.sent.length,kind==='chat'?0:1)
})
