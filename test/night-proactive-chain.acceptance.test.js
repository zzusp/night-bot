import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {piJournalFilename,decodePiJournal} from '../src/runtime/pi-journal.js'
import {residentRouterHost,channelMessage,eventually,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

const original='你自己决定要主动跟进什么事情，你可以固定每30分钟自己醒来看看每个渠道有没有什么需要跟进的事情，另外有什么需要自己醒来的也可以给自己挂即时的定时任务唤醒你。'
const lastCall=body=>body.messages.at(-1)?.role==='tool'?body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name:undefined

test('exact channel instruction through Router, real schedule, official Pi and isolated channel', {timeout:nativeTestTimeout(45000)},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 let h,origin,created=0,dueChecks=0,queryFacts,dueToolNames,attemptedResume,attemptedWake,resumeReply,wakeReply
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body),last=lastCall(body)
  if(tools.includes('resident_router_settle')){
   if(last==='resident_router_settle')return {text:'Settled'}
   const input=requestEnvelope(body,'Router 请求：')
   const event=input?.events.find(e=>e.source),source=event?.source
   if(source?.messageId==='granted-proactive'&&!last){
    assert.ok(requestText(body).join('\n').includes(original))
    origin=source;created++
    return {tool:'platform_schedule_submit',args:{operationId:'monitor-from-exact-input',sourceId:source.sourceId,messageVersion:source.version,title:'主动跟进巡查',prompt:original,every_seconds:1800}}
   }
   return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events[0].id,eventIds:input.events.map(e=>e.id),noTaskDispositions:input.events.filter(e=>e.source).map(e=>({eventId:e.id,outcome:'context-only',sourceQuote:e.source.text,reason:'Fixture source is retained without a channel response.'}))}}
  }
  if(tools.includes('platform_reply_submit')){
   dueToolNames=tools.sort()
   if(!last){
    dueChecks++
    assert.match(requestText(body).join('\n'),/SCHEDULE REMINDER BATCH/u)
    return {tool:'platform_task_query',args:{state:'all'}}
   }
   if(last==='platform_task_query'){
    queryFacts=h.results.findLast(row=>row.name===last).result.value
    return {tool:'platform_task_evidence',args:{taskIds:queryFacts.eligibleEvidenceTaskIds}}
   }
   if(last==='platform_task_evidence'){
    attemptedResume=true
    return {tool:'resident_task_action',args:{operationId:'resume-eligible-fixture',sourceId:origin.sourceId,messageVersion:origin.version,taskId:'proactive-local',kind:'resume',expectedRequirementRevision:1,expectedControlRevision:2}}
   }
   if(last==='resident_task_action'){
    attemptedWake=true
    resumeReply=body.messages.at(-1).content
    return {tool:'platform_schedule_submit',args:{operationId:'periodic-self-wake',sourceId:origin.sourceId,messageVersion:origin.version,title:'即时自唤醒',at:new Date(Date.now()+60000).toISOString(),prompt:'继续复查本次证据。'}}
   }
   if(last==='platform_schedule_submit'){wakeReply=body.messages.at(-1).content;return {tool:'platform_reply_submit',args:{text:null}}}
  }
  return {text:'Done'}
 })
 const first=channelMessage('granted-proactive',{text:original}),other=channelMessage('other-channel-anchor',{conversationId:'other-room',text:'第二渠道测试输入'})
 await h.receive(first);await h.service.whenIdle()
 await h.receive(other);await h.service.whenIdle()
 const sourceById=id=>(h.query('source.list')).then(rows=>rows.find(row=>row.messageId===id))
 const a=await sourceById(first.messageId),b=await sourceById(other.messageId)
 assert.ok(a&&b&&a.groupId!==b.groupId)
 const taskIdA='proactive-local',taskIdB='proactive-other'
 for(const [taskId,src] of [[taskIdA,a],[taskIdB,b]]){
  await h.store.command({id:'seed-'+taskId,kind:'task.create',args:{taskId,groupId:src.groupId,ownerActorId:src.actorId,sourceRefs:[src.sourceId],request:'待跟进的受控事项'}})
  await h.store.command({id:'park-'+taskId,kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:1}})
 }
 const schedule=h.host.ctx.schedule,[record]=await schedule.catalog()
 assert.equal(created,1);assert.equal(record.kind,'every');assert.equal(record.everySeconds,1800)
 const bindings=h.residentStore.listPlatformSchedules(a.groupId)
 assert.equal(bindings.length,1);assert.equal(bindings[0].sourceId,a.sourceId)
 assert.deepEqual(h.residentStore.listPlatformSchedules(b.groupId),[])
 const before=await h.query('task.get',{taskId:taskIdA})
 t.mock.timers.setTime(Date.parse(record.scheduledAt)-1);schedule.start();await schedule.runtime.running
 assert.equal(dueChecks,0)
 t.mock.timers.setTime(Date.parse(record.scheduledAt))
 await eventually(()=>h.residentStore.getPlatformSchedule(record.sessionId).lastOccurrenceAt===record.scheduledAt,'first 30-minute occurrence settles',t.signal)
 assert.equal(dueChecks,1)
 assert.ok(dueToolNames.includes('platform_task_query'));assert.ok(!dueToolNames.includes('resident_task_action'));assert.ok(!dueToolNames.includes('platform_schedule_submit'))
 assert.match(JSON.stringify(resumeReply),/not found|unknown|not available|not registered/u)
 assert.match(JSON.stringify(wakeReply),/not found|unknown|not available|not registered/u)
 assert.deepEqual(queryFacts.items.map(row=>row.taskId),[taskIdA])
 assert.deepEqual(queryFacts.eligibleEvidenceTaskIds,[taskIdA])
 assert.equal(attemptedResume,true);assert.equal(attemptedWake,true)
 const after=await h.query('task.get',{taskId:taskIdA})
 assert.equal(after.control,before.control);assert.equal(after.leaseEpoch,before.leaseEpoch)
 assert.equal((await h.query('task.get',{taskId:taskIdB})).control,'paused')
 assert.equal((await schedule.catalog()).length,1)
 assert.equal(h.sent.length,0)
 const rejected=h.results.filter(row=>row.sessionId===record.sessionId&&row.result.isError).map(row=>row.name)
 t.diagnostic(JSON.stringify({schedules:{kind:record.kind,seconds:record.everySeconds,scheduledAt:record.scheduledAt},dueChecks,visibleTaskIds:queryFacts.items.map(x=>x.taskId),otherChannelPlanCount:0,dueTools:dueToolNames,rejected,resumeReply,wakeReply,taskResumed:false,onDemandWakeCreated:false,questionSent:false}))
})

test('proactive recurring timer hands work to each authorized Router and creates an on-demand wake with a concrete question', {timeout:nativeTestTimeout(55000)},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 let h,phase=0,primary,seen=[],onceAt,firstRun=0,resumed=0
 const taskId='proactive-original-task',question='复查需要补一项：目标环境是 UAT 还是生产？'
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body),last=lastCall(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(tools.includes('task_result')){
   if(++firstRun===1)return {tool:'task_result',args:{decision:{action:'blocked',summary:'目标尚不可确认。',evidence:['已有记录缺环境'],limitations:['缺目标环境']}}}
   return {tool:'task_result',args:{decision:{action:'blocked',summary:'复查后仍需要目标环境。',evidence:['已复查最近记录'],limitations:['需明确 UAT 或生产']}}}
  }
  if(!tools.includes('resident_router_settle')||last==='resident_router_settle')return {text:'Done'}
  const input=requestEnvelope(body,'Router 请求：'),ev=input.events[0],src=ev.source
  const settle=()=>({tool:'resident_router_settle',args:{operationId:'settle:'+ev.id,eventIds:input.events.map(e=>e.id),
   noTaskDispositions:input.events.filter(e=>e.source).map(e=>({eventId:e.id,outcome:'context-only',sourceQuote:e.source.text,reason:'Fixture channel source recorded.'}))}})
  if(src?.messageId==='proactive-seed'&&!last)return {tool:'resident_task_plan',args:{operationId:'proactive-seed',sourceId:src.sourceId,messageVersion:src.version,tasks:[{taskId,title:'核实目标',objective:'核对原事项',requirements:[],handoff:'核对原事项，不猜环境。'}],dependencies:[]}}
  if(src?.messageId==='proactive-exact'&&src.version===1&&!last){
   primary=input.conversationId
   assert.ok(requestText(body).join('\n').includes(original))
   const prompt=body.messages.filter(row=>row.role==='system').map(row=>row.content).join('\n')
   const scheduleTool=body.tools.find(row=>row.function.name==='platform_schedule_submit').function.description
   for(const text of [prompt,scheduleTool]){
    assert.match(text,/不传 stopWhen 或 report_every_occurrence/u)
    assert.match(text,/主动跟进不支持按任务完成自动停止/u)
   }
   return {tool:'platform_schedule_submit',args:{operationId:'route-exact-trigger',sourceId:src.sourceId,messageVersion:src.version,title:'主动跟进定时唤醒',prompt:original,every_seconds:1800,router_follow_up:'authorized'}}
  }
  if(ev.kind==='router.follow-up'){
   const wake=ev.followUp
   if(!last){seen.push({group:input.conversationId,id:ev.id,at:wake.occurrenceAt})
    if(input.conversationId!==primary){assert.ok(!JSON.stringify(ev).includes(original));return settle()}
    if(phase===0){phase=1;return {tool:'resident_task_action',args:{operationId:'reuse-existing',taskId,kind:'reopen',sameGoal:true,expectedRequirementRevision:1,expectedControlRevision:1}}}
    if(phase===2){phase=3;return {tool:'resident_router_reply',args:{operationId:'concrete-question',sourceId:wake.sourceId,messageVersion:wake.sourceVersion,text:question}}}
    return settle()
   }
   if(last==='resident_task_action'){
    const result=h.results.findLast(row=>row.name===last).result
    assert.equal(result.isError,false,JSON.stringify(result));resumed++
    onceAt=new Date(Date.now()+60000).toISOString();phase=2
    return {tool:'platform_schedule_submit',args:{operationId:'later-check',sourceId:wake.sourceId,messageVersion:wake.sourceVersion,title:'到点复查剩余缺项',at:onceAt,router_follow_up:'local',prompt:'复查剩余卡点，需要时向原发起人提问。'}}
   }
   if(last==='platform_schedule_submit'){
    const result=h.results.findLast(row=>row.name===last).result
    assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.value.status,'scheduled')
   }
  }
  return settle()
 })
 for(const message of [
  channelMessage('proactive-seed',{text:'核对目标，不修改环境。'}),
  channelMessage('authorized-anchor',{conversationId:'authorized-room',text:'授权账户在另一个会话的原始消息。'}),
  channelMessage('unauthorized-anchor',{conversationId:'other-room',senderId:'bob',text:'没有原发起人身份的另一渠道。'}),
  channelMessage('proactive-exact',{text:original}),
 ]){await h.receive(message);await h.service.whenIdle()}
 const originalTask=await h.query('task.get',{taskId})
 let schedule=h.host.ctx.schedule
 const [periodic]=await schedule.catalog()
 assert.equal(periodic.everySeconds,1800);assert.equal(firstRun,1)
 async function due(at){
  t.mock.timers.setTime(Date.parse(at)-1);schedule.start();await schedule.runtime.running;t.mock.timers.setTime(Date.parse(at))
 }
 await due(periodic.scheduledAt)
 await eventually(async()=>resumed===1&&seen.length===2&&onceAt&&(await schedule.catalog()).find(row=>row.kind==='at'),'two authorized Router wakes and one follow-up timer',t.signal)
 await h.service.whenIdle()
 assert.equal(firstRun,2);assert.equal((await h.query('task.get',{taskId})).sessionId,originalTask.sessionId)
 const source=(await h.query('source.list')).find(row=>row.messageId==='unauthorized-anchor')
 assert.ok(seen.every(row=>row.group!==source.groupId))
 await h.restart();schedule=h.host.ctx.schedule
 assert.equal(seen.length,2,'restart does not replay the committed periodic occurrence')
 await due(onceAt)
 const notice=await eventually(async()=>(await h.query('notification.list')).find(row=>row.state==='delivered'&&row.payload.text===question),'one-shot Router wake delivers blocker question',t.signal)
 assert.equal(notice.payload.sourceRef.messageId,'proactive-exact')
 assert.equal(seen.length,3);assert.equal(h.sent.filter(row=>row.text===question).length,1)
 const onceRecord=(await schedule.catalog()).find(row=>row.kind==='at')
 assert.equal(h.residentStore.getPlatformSchedule(onceRecord.sessionId).outcome,'routed','routing receipt does not claim a channel delivery')
 // Editing the original grant invalidates even the next timer callback.
 await h.receive(channelMessage('proactive-exact',{messageVersion:2,text:'取消此前的主动跟进。'}));await h.service.whenIdle()
 const next=(await schedule.catalog()).find(row=>row.id===periodic.id)
 if(next){
  await due(next.scheduledAt)
  await eventually(()=>h.residentStore.getPlatformSchedule(periodic.sessionId).outcome==='superseded','modified original grant is not reused',t.signal)
 }
 assert.equal(seen.length,3)
 t.diagnostic(JSON.stringify({routerWakes:seen.length,firstRoundChannels:2,unauthorizedChannelWakes:0,taskResumed:resumed,oneShotAt:onceAt,questionReceipt:notice.receipt.messageId}))
})

test('scheduled Router pages authorized tasks and cannot settle a new user message outside its wake', {timeout:nativeTestTimeout(45000)},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 let h,pageOne,pageTwo,lateEvent,laterHandled=false
 const scopedTaskIds=Array.from({length:27},(_,i)=>'review-task-'+i)
 const lateText='请执行一项新任务。'
 h=await residentRouterHost(t,async body=>{
  if(!requestTools(body).includes('resident_router_settle')||lastCall(body)==='resident_router_settle'&&!body.messages.at(-1).content.includes('ROUTER_FOLLOW_UP_BATCH_SCOPE'))return {text:'Done'}
  const input=requestEnvelope(body,'Router 请求：'),ev=input.events[0],src=ev.source,last=lastCall(body)
  if(ev.kind==='router.follow-up'){
   if(!last){
    const state=requestText(body).find(text=>text.includes('下面是第一页'))
    assert.ok(state)
    const start=state.indexOf('{"tasks":')
    pageOne=JSON.parse(state.slice(start,state.indexOf('}',state.lastIndexOf('"hasMore":'))+1))
    return {tool:'resident_task_query',args:{detail:'index',offset:pageOne.nextOffset}}
   }
   if(last==='resident_task_query'){
    const result=h.results.findLast(row=>row.name===last).result
    assert.equal(result.isError,false,JSON.stringify(result));pageTwo=result.value
    await h.store.command({id:'late-source',kind:'source.record-direct',args:{routeDirect:true,source:{sourceId:'late-source',groupId:input.conversationId,messageId:'late-source',version:1,actorId:ev.followUp.actorId,channel:'im',text:lateText,resources:[]},conversation:{conversationId:input.conversationId}}})
    const {event}=await h.query('router.source-status',{sourceId:'late-source'})
    assert.equal(event.state,'pending');assert.ok(!input.events.some(row=>row.id===event.id));lateEvent=event.id
    return {tool:'resident_router_settle',args:{operationId:'wrong-batch',eventIds:[ev.id,lateEvent],noTaskDispositions:[{eventId:lateEvent,sourceQuote:lateText,outcome:'context-only',reason:'Do not let a scheduled wake decide a new request.'}]}}
   }
   const rejected=h.results.findLast(row=>row.name===last).result
   assert.equal(rejected.isError,true);assert.match(JSON.stringify(rejected),/ROUTER_FOLLOW_UP_BATCH_SCOPE/u)
   assert.equal((await h.query('router.source-status',{sourceId:'late-source'})).event.state,'pending')
   return {tool:'resident_router_settle',args:{operationId:'real-wake',eventIds:[ev.id]}}
  }
  if(src?.messageId==='page-proactive'&&!last)return {tool:'platform_schedule_submit',args:{operationId:'page-trigger',sourceId:src.sourceId,messageVersion:src.version,title:'巡检任务',prompt:original,every_seconds:1800,router_follow_up:'local'}}
  if(src?.messageId==='late-source')laterHandled=true
  return {tool:'resident_router_settle',args:{operationId:'settle:'+ev.id,eventIds:input.events.map(row=>row.id),noTaskDispositions:input.events.filter(row=>row.source).map(row=>({eventId:row.id,sourceQuote:row.source.text,outcome:'context-only',reason:'Processed in its own fixture turn.'}))}}
 })
 await h.receive(channelMessage('page-proactive',{text:original}));await h.service.whenIdle()
 const src=(await h.query('source.list')).find(row=>row.messageId==='page-proactive')
 for(const taskId of [...scopedTaskIds,'different-owner','paused-task']){
  await h.store.command({id:'create-'+taskId,kind:'task.create',args:{taskId,groupId:src.groupId,ownerActorId:taskId==='different-owner'?'different-actor':src.actorId,sourceRefs:[src.sourceId],request:'分页测试'}})
 }
 await h.store.command({id:'pause-one',kind:'task.control',args:{taskId:'paused-task',control:'paused',expectedControlRevision:1}})
 const schedule=h.host.ctx.schedule,[record]=await schedule.catalog()
 t.mock.timers.setTime(Date.parse(record.scheduledAt)-1);schedule.start();await schedule.runtime.running
 t.mock.timers.setTime(Date.parse(record.scheduledAt))
 await eventually(async()=>laterHandled&&(await h.query('router.source-status',{sourceId:'late-source'})).event?.state==='consumed','late user message gets a separate Router turn',t.signal)
 assert.equal(pageOne.tasks.length,25);assert.equal(pageOne.total,27);assert.equal(pageOne.hasMore,true)
 assert.equal(pageTwo.tasks.length,2);assert.equal(pageTwo.total,27);assert.equal(pageTwo.hasMore,false)
 assert.deepEqual([...pageOne.tasks,...pageTwo.tasks].map(row=>row.taskId).sort(),[...scopedTaskIds].sort())
})

test('cold Router reconciles a committed follow-up settlement without replaying the timer or losing the next message',{timeout:nativeTestTimeout(60000)},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()})
 let h,attempts=0,wakeCalls=0,lateHandled=0
 h=await residentRouterHost(t,async body=>{
  if(!requestTools(body).includes('resident_router_settle')||lastCall(body)==='resident_router_settle')return {text:'Done'}
  const input=requestEnvelope(body,'Router 请求：'),ev=input.events[0],src=ev.source
  if(ev.kind==='router.follow-up'){
   wakeCalls++
   return {tool:'resident_router_settle',args:{operationId:'recover-wake',eventIds:[ev.id],noTaskDispositions:[]}}
  }
  if(src?.messageId==='follow-up-recovery'&&!lastCall(body))return {tool:'platform_schedule_submit',args:{operationId:'recover-trigger',sourceId:src.sourceId,messageVersion:src.version,title:'恢复测试',prompt:original,every_seconds:1800,router_follow_up:'local'}}
  if(src?.messageId==='recover-late')lateHandled++
  return {tool:'resident_router_settle',args:{operationId:'settle:'+ev.id,eventIds:input.events.map(row=>row.id),noTaskDispositions:input.events.filter(row=>row.source).map(row=>({eventId:row.id,outcome:'context-only',sourceQuote:row.source.text,reason:'Recovered fixture.'}))}}
 },{wrapStore:store=>({...store,command:async command=>{
  if(command.kind==='router.settle'&&command.args.followUpEventId&&++attempts===1){
   await store.command(command)
   throw Object.assign(Error('Interrupted after ledger commit'),{code:'TEST_SETTLE_CRASH'})
  }
  return store.command(command)
 }})})
 await h.receive(channelMessage('follow-up-recovery',{text:original}));await h.service.whenIdle()
 const source=(await h.query('source.list')).find(row=>row.messageId==='follow-up-recovery')
 const before=await h.query('router.get',{conversationId:source.groupId})
 const schedule=h.host.ctx.schedule,[record]=await schedule.catalog()
 t.mock.timers.setTime(Date.parse(record.scheduledAt)-1);schedule.start();await schedule.runtime.running
 t.mock.timers.setTime(Date.parse(record.scheduledAt))
 await eventually(()=>attempts===1,'wake settlement committed before interruption',t.signal)
 await h.service.whenIdle().catch(()=>{})
 // Record, but do not dispatch, the next independent message before stopping.
 await h.store.command({id:'recover-late-source',kind:'source.record-direct',args:{routeDirect:true,source:{sourceId:'recover-late',groupId:source.groupId,messageId:'recover-late',version:1,actorId:source.actorId,channel:'im',text:'新消息',resources:[]},conversation:{conversationId:source.groupId}}})
 const file=join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(before.activeSessionId))
 await h.close();await h.host.close()
 const full=await readFile(file);let offset=0,call,cutAt
 for(const line of full.toString().split(/(?<=\n)/)){
  if(!line.endsWith('\n'))break
  offset+=Buffer.byteLength(line);const entry=JSON.parse(line)
  if(entry.type==='message'&&entry.message.role==='assistant')call??=entry.message.content.find(b=>b.type==='toolCall'&&b.name==='resident_router_settle'&&b.arguments.operationId==='recover-wake')
  if(call&&entry.type==='custom'&&entry.customType==='night.commit'){cutAt=offset;break}
 }
 assert.ok(call&&cutAt)
 const prefix=full.subarray(0,cutAt);decodePiJournal(prefix,before.activeSessionId,{requireComplete:true});await writeFile(file,prefix)
 await h.restart();await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId:source.groupId})).activeSessionId,before.activeSessionId)
 assert.equal(attempts,2);assert.equal(wakeCalls,1);assert.equal(lateHandled,1)
 assert.equal((await h.query('router.source-status',{sourceId:'recover-late'})).event.state,'consumed')
 const stored=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true})
 const results=stored.entries.filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolCallId===call.id)
 assert.equal(results.length,1);assert.equal(results[0].message.isError,false)
})
