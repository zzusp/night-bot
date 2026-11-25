import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,symlink,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {once} from 'node:events'
import {residentRouterHost,channelMessage,requestTools,requestEnvelope,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {piJournalFilename} from '../src/runtime/pi-journal.js'

for(const [label,legacy,scheduleFailure,settlementFailure] of [
 ['new call-bound pre-execution proofs',false,false],
 ['legacy failures remain unknown but scoped',true,false],
 ['failed read-only schedule list stays in the old journal',false,true],
 ['rejected in-batch settlement and failed schedule list stay in the old journal',false,true,'in-batch'],
 ['rejected out-of-batch settlement does not permit isolation',false,true,'out-of-batch'],
])test(`26 -> 20+6 and independent query: ${label}`,{timeout:nativeTestTimeout(90000)},async t=>{
 let h,old,current,root,holdSource,phase='register',step=0,scheduleReads=0,ids=[],replacementIds=[],reply=false,queried=false,attemptedHeld=false
 t.after(async()=>{await current?.close();await current?.host?.close();if(old!==current){await old?.close();await old?.host?.close()}if(root)await rm(root,{recursive:true,force:true})})
 const wrapStore=store=>({...store,query:async q=>{const rows=await store.query(q);return q.kind==='router.rotations'&&holdSource?[...rows,{id:'fixture-prior-unresolved-owner',state:'historical',recovery:{unknownSourceIds:[holdSource]}}]:rows}})
 const decide=async body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：')
  if(phase==='register'&&body.messages.at(-1)?.role==='tool')return {text:'Registered fixture source'}
  if(phase==='register')return {tool:'resident_router_settle',args:{operationId:'register',eventIds:input.events.map(e=>e.id)}}
  const task=await h.query('task.get',{taskId:'old-task'})
  if(phase==='seed'){
   const args={sourceId:holdSource,messageVersion:1,taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,kind:'resume',handoff:'Continue the original paused task.'}
   if(step++===0){ids=input.events.map(e=>e.id);assert.equal(ids.length,26);return {tool:'resident_router_settle',args:{operationId:'twenty',eventIds:ids.slice(0,20)}}}
   if(step<=3)return {tool:'resident_task_action',args:{...args,operationId:'old-blocked-'+step}}
   if(step===4)return {tool:'resident_router_reply',args:{operationId:'old-blocked-reply',sourceId:holdSource,messageVersion:1,text:'Must not send old-source reply'}}
   if(step===5){
    if(!scheduleFailure)return {tool:'resident_task_query',args:{detail:'INVALID_DETAIL'}}
    const resident=h.residentStore, list=resident.listPlatformSchedules
    resident.listPlatformSchedules=(...args)=>{
     if(h.host.ctx.agents.currentInitiator()?.metadata.runtimeOwner!=='conversation-router')return list(...args)
     resident.listPlatformSchedules=list
     scheduleReads++
     throw Error('FIXTURE_SCHEDULE_READ_FAILED')
    }
    return {tool:'platform_schedule_list',args:{}}
   }
   if(step===6&&settlementFailure){
    const id=input.events.find(e=>e.source?.sourceId==='old-unsettled').id
    return {tool:'resident_router_settle',args:{operationId:'rejected-settlement',eventIds:[ids[20],settlementFailure==='out-of-batch'?'not-in-admitted-packet':id],noTaskDispositions:[{eventId:id,outcome:'context-only',sourceQuote:'Wrong frozen quote',reason:'Fixture uses the wrong evidence'}]}}
   }
   return {text:'Stopped with paired rejected calls; no settlement of the remaining six'}
  }
  replacementIds=input.events.map(e=>e.id)
  const fresh=input.events.find(e=>e.source?.sourceId==='independent-query'),source=fresh?.source
  if(!attemptedHeld){attemptedHeld=true;return {tool:'resident_task_action',args:{operationId:'still-held',kind:'resume',handoff:'Continue the original paused task.',taskId:task.taskId,sourceId:holdSource,messageVersion:1,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}}}
  if(!queried){queried=true;return {tool:'resident_task_query',args:{taskId:task.taskId}}}
  if(!reply){reply=true;assert.equal(task.control,'paused');return {tool:'resident_router_reply',args:{operationId:'actual-query-answer',sourceId:source.sourceId,messageVersion:source.version,replyPurpose:'direct-answer',text:'The existing task is paused; no execution has been started.'}}}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Current state checked; events observed without task dispatch'}
  const noTaskDispositions=input.events.filter(e=>e.source).map(e=>({eventId:e.id,outcome:e===fresh?'handled-inline':'context-only',sourceQuote:e.source.text,reason:e===fresh?'Actual current task state was read and replied':'Retain the source as context without repeating an old action'}))
  return {tool:'resident_router_settle',args:{operationId:'settle-seven',eventIds:replacementIds,noTaskDispositions}}
 }
 let make=residentRouterHost,install
 if(legacy){
  root=await mkdtemp(join(tmpdir(),'night-218-old-'));const code=join(root,'old-code');install=join(root,'installation');await mkdir(code)
  const repo=fileURLToPath(new URL('../',import.meta.url)),win=process.platform==='win32',legacyLink='packages/dingtalk-dsh-assistant'
  // Windows tar 无法还原旧目录链接；仅在旧版夹具中用 junction 还原指向。
  const archive=['archive','bf3a1ab730bd552976dd276343e6f752f2b5072f',...(win?['--','.',`:(exclude)${legacyLink}`]:[])]
  const {stdout}=await promisify(execFile)('git',archive,{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
  const tar=spawn('tar',['-xf','-','-C',code],{stdio:['pipe','inherit','inherit']});tar.stdin.end(stdout);assert.equal((await once(tar,'exit'))[0],0)
  if(win)await symlink(join(code,'packages/dingtalk-core'),join(code,legacyLink),'junction')
  await symlink(join(repo,'node_modules'),join(code,'node_modules'),win?'junction':'dir')
  make=(await import(pathToFileURL(join(code,'test/fixtures/resident-router-host.js')))).residentRouterHost
 }
 old=h=await make(t,decide,{wrapStore,...legacy?{hostOptions:{hostConfig:{installRoot:install}}}:{}})
 await h.receive(channelMessage('held-root'));await h.service.whenIdle()
 const source=(await h.query('source.list'))[0];holdSource=source.sourceId;const conversationId=source.groupId
 let n=0;const command=(kind,args)=>h.store.command({id:'seed-'+(++n),kind,args})
 await command('task.create',{taskId:'old-task',conversationId,groupId:conversationId,ownerActorId:source.actorId,request:'Existing paused task',sourceRefs:[holdSource]})
 for(let i=0;i<(settlementFailure?24:25);i++)await command('task.supplement',{taskId:'old-task',messageId:'supp-'+i,text:'Recorded evidence '+i,expectedRequirementRevision:1,expectedControlRevision:1})
 await command('task.control',{taskId:'old-task',control:'paused',expectedControlRevision:1})
 if(settlementFailure){
  await h.residentStore.ingest({groupId:conversationId,messageId:'old-unsettled',text:'Keep this old source as context.',senderOpenDingTalkId:source.actorId,occurredAt:new Date().toISOString(),channelType:'chat-room',channelId:'resident-fixture'})
  await command('source.record-direct',{source:{sourceId:'old-unsettled',groupId:conversationId,messageId:'old-unsettled',actorId:source.actorId,channel:'chat-room',version:1,text:'Keep this old source as context.',resources:[]},conversation:{conversationId},routeDirect:true})
 }
 phase='seed';await h.restart();await h.service.whenIdle()
 assert.equal(await h.query('router.inbox-count',{conversationId}),6)
 const before=await h.query('router.get',{conversationId}),file=join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(before.activeSessionId))
 const snapshot=await h.host.ctx.sessionPersistence.readNative(before.activeSessionId,{requireComplete:true}),proofs=snapshot.entries.filter(e=>e.type==='custom'&&e.customType==='night.audit'&&e.data?.domain==='router-tool'&&e.data.kind==='not-started')
 assert.equal(proofs.length,legacy?0:scheduleFailure?3:4)
 const errors=snapshot.entries.filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.isError);assert.equal(errors.length,settlementFailure?5:4)
 if(settlementFailure){
  assert.equal(errors.at(-1).message.toolName,'resident_router_settle')
  assert.match(JSON.stringify(errors.at(-1).message.content),settlementFailure==='in-batch'?/ROUTER_SOURCE_DISPOSITION_INVALID/:/ROUTER_EVENT_SCOPE/)
  assert.ok(proofs.every(e=>e.data.payload.toolName!=='resident_router_settle'))
  assert.deepEqual((await h.query('router.inbox',{conversationId})).map(e=>e.id),ids.slice(20),'rejected transaction rolls back even the valid first event')
 }
 if(scheduleFailure){
  assert.equal(scheduleReads,1)
  const failure=errors.find(e=>e.message.toolName==='platform_schedule_list')
  assert.match(JSON.stringify(failure?.message.content),/FIXTURE_SCHEDULE_READ_FAILED/)
  assert.ok(proofs.every(e=>e.data.payload.toolName!=='platform_schedule_list'))
  await h.service.recover();await h.service.whenIdle()
  assert.equal((await h.query('router.get',{conversationId})).activeSessionId,before.activeSessionId)
  assert.equal(await h.query('router.inbox-count',{conversationId}),6)
  assert.ok(h.service.listAlerts().some(a=>a.detail==='PI_ROUTER_RESUME_EFFECT_UNRESOLVED'))
 }
 await h.residentStore.ingest({groupId:conversationId,messageId:'new-query',text:'What is the current state? Query only; do not start any task.',senderOpenDingTalkId:source.actorId,occurredAt:new Date().toISOString(),channelType:'chat-room',channelId:'resident-fixture'})
 await command('source.record-direct',{source:{sourceId:'independent-query',groupId:conversationId,messageId:'new-query',actorId:source.actorId,channel:'chat-room',version:1,text:'What is the current state? Query only; do not start any task.',resources:[]},conversation:{conversationId},routeDirect:true})
 await old.close();await old.host.close();const prefix=await readFile(file)
 phase='recover'
 if(legacy)current=h=await residentRouterHost(t,decide,{wrapStore,config:{initialize:false},hostOptions:{hostConfig:{installRoot:install}}})
 else {await old.boot();current=h=old;await h.restart()}
 await h.service.recover();await h.service.whenIdle()
 if(settlementFailure==='out-of-batch'){
  assert.equal((await h.query('router.get',{conversationId})).activeSessionId,before.activeSessionId)
  assert.equal(await h.query('router.inbox-count',{conversationId}),7)
  assert.deepEqual(replacementIds,[]);assert.equal(h.sent.length,0)
  assert.ok(h.service.listAlerts().some(a=>a.detail==='PI_ROUTER_RESUME_EFFECT_UNRESOLVED'))
  assert.deepEqual(await readFile(file),prefix)
  return
 }
 assert.deepEqual(replacementIds.slice(0,6),ids.slice(20));assert.equal(replacementIds.length,7);assert.equal(new Set(replacementIds).size,7)
 assert.equal(await h.query('router.inbox-count',{conversationId}),0);assert.equal((await h.query('task.list')).length,1);assert.equal((await h.query('execution.list',{taskId:'old-task'})).length,0)
 assert.equal((await h.query('task.get',{taskId:'old-task'})).control,'paused')
 assert.ok(h.results.some(r=>r.name==='resident_task_action'&&r.result.isError&&JSON.stringify(r.result).includes('ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN')))
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].text,'The existing task is paused; no execution has been started.')
 assert.deepEqual(await readFile(file),prefix,'old journal is retained byte-for-byte, without replay or fabricated results')
 const rotations=await h.query('router.rotations',{conversationId});const actual=rotations.find(r=>r.recovery?.reason===(legacy||scheduleFailure?'ROUTER_BATCH_ISOLATED':'ROUTER_BATCH_PARTIALLY_SETTLED'))
 assert.ok(actual);assert.ok(!actual.recovery.unknownSourceIds.includes('independent-query'));if(legacy){assert.ok(actual.recovery.unknownSourceIds.includes(holdSource));assert.ok(actual.recovery.unknownTaskIds.includes('old-task'))}
 if(scheduleFailure){
  assert.equal((await h.query('router.get',{conversationId})).generation,before.generation+1)
  assert.equal(h.results.filter(r=>r.name==='platform_schedule_list').length,1)
  assert.ok(!h.service.listAlerts().some(a=>a.detail==='PI_ROUTER_RESUME_EFFECT_UNRESOLVED'))
 }
 const requests=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,requests);assert.equal(h.sent.length,1)
})

for(const directlyHeld of [false,true])test(`fresh Router scheduling survives a prior hold (${directlyHeld?'task':'source only'})`,{timeout:nativeTestTimeout(90000)},async t=>{
 let h,heldSource,planned=false,step=0,runs=0
 const taskId='handoff-scheduling-fixture'
 const wrapStore=store=>({...store,query:async q=>{
  const rows=await store.query(q)
  return q.kind==='router.rotations'&&heldSource?[...rows,{id:'old-isolated-rotation',state:'published',recovery:{reason:'ROUTER_BATCH_ISOLATED',unknownSourceIds:[heldSource],unknownTaskIds:directlyHeld?[taskId]:[]}}]:rows
 }})
 h=await residentRouterHost(t,async body=>{
  if(requestTools(body).includes('task_result')){
   ++runs
   return {tool:'task_result',args:{decision:{action:'complete',summary:`已完成第 ${runs} 次执行`,evidence:[],limitations:[]}}}
  }
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：'),event=input?.events.find(e=>e.source)
  if(!input||body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Done'}
  const settle=()=>({tool:'resident_router_settle',args:{operationId:'settle-'+input.events[0].id,eventIds:input.events.map(e=>e.id),noTaskDispositions:input.events.filter(e=>e.source?.messageId==='new-instruction'&&directlyHeld).map(e=>({eventId:e.id,outcome:'context-only',sourceQuote:e.source.text,reason:'保留来源；调度已提交给原任务'}))}})
  if(event?.source.messageId==='original-work'){
   if(planned)return settle()
   planned=true
   return {tool:'resident_task_plan',args:{operationId:'plan-original',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId,title:'原任务',objective:'使用原执行会话',requirements:[],handoff:'在原执行会话处理当前任务。'}],dependencies:[]}}
  }
  if(event?.source.messageId!=='new-instruction'||step>=5)return settle()
  const task=await h.query('task.get',{taskId}),attempt=step++
  const provenance=attempt===0?{sourceId:heldSource,messageVersion:1}:attempt===4&&directlyHeld?{}:{sourceId:event.sourceId,messageVersion:attempt===1?2:event.messageVersion}
  return {tool:'resident_task_action',args:{operationId:'action-'+attempt,kind:attempt===3?'arrange':'resume',taskId,...provenance,...(attempt!==3&&provenance.sourceId?{handoff:'继续核对原任务的实际结果。'}:{}),expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision+(attempt===2?1:0),...attempt===3?{expectedArrangementRevision:task.arrangementRevision??1,dependencies:[]}:{} }}
 },{wrapStore})
 await h.receive(channelMessage('original-work'));await h.service.whenIdle()
 const original=await h.query('task.get',{taskId})
 assert.equal(original.status,'completed');assert.equal(original.completion?.result?.summary,'已完成第 1 次执行')
 heldSource=original.sourceRefs[0]
 assert.ok(heldSource)
 await h.receive(channelMessage('new-instruction',{text:'继续原任务核对实际结果'}));await h.service.whenIdle()
 const actions=h.results.filter(r=>r.name==='resident_task_action')
 assert.equal(actions.length,5)
 for(const [i,code] of ['ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN','ROUTER_SOURCE_FORBIDDEN','DYNAMIC_TASK_REVISION_STALE','ROUTER_PRIOR_SESSION_EFFECT_UNKNOWN'].entries()){
  assert.equal(actions[i].result.isError,true)
  assert.match(JSON.stringify(actions[i].result),new RegExp(code),`第 ${i+1} 次调度应拒绝；实际 ${JSON.stringify(actions[i].result)}`)
 }
 assert.equal(actions[4].result.isError,false)
 const resumed=await h.query('task.get',{taskId})
 assert.equal(resumed.sessionId,original.sessionId)
 assert.equal(resumed.status,'completed');assert.equal(resumed.completion?.result?.summary,'已完成第 2 次执行')
 assert.equal(resumed.drained,true)
 const journal=await h.host.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true})
 assert.equal(journal.entries.filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolName==='task_result'&&!e.message.isError).length,2)
 assert.equal(runs,2);assert.equal(h.sent.length,0)
 assert.equal(await h.query('router.inbox-count',{conversationId:resumed.groupId}),0)
})

test('consecutive zero-progress batches never starve independent messages', {timeout:nativeTestTimeout(90000)},async t=>{
 const failures=new Set(['stalled-a','stalled-b']), deliveries=[]
 const h=await residentRouterHost(t,async body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const batch=requestEnvelope(body,'Router 请求：').events, messages=batch.flatMap(event=>event.source?[event.source.messageId]:[])
  if(body.messages.at(-1)?.role==='tool')return {text:'Turn finished'}
  deliveries.push(messages)
  const bad=messages.some(id=>failures.has(id))
  return {tool:'resident_router_settle',args:{operationId:batch[0].id,eventIds:batch.map(event=>event.id),noTaskDispositions:batch.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'context-only',sourceQuote:bad?'wrong original quote':event.source.text,reason:'Fixture records a source without dispatch'}))}}
 })
 const drain=async()=>{try{await h.service.whenIdle()}catch(error){if(error.code!=='ROUTER_BATCH_UNSETTLED')throw error}}
 await h.receive(channelMessage('stalled-a'));await drain()
 const source=(await h.query('source.list'))[0],conversationId=source.groupId
 const before=await h.query('router.get',{conversationId}),archive=join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(before.activeSessionId))
 const bytes=await readFile(archive)
 assert.deepEqual(deliveries,[['stalled-a']]);assert.equal(await h.query('router.inbox-count',{conversationId}),1)
 await h.receive(channelMessage('stalled-b'));await drain()
 await h.receive(channelMessage('independent-one'));await drain()
 assert.deepEqual(deliveries,[['stalled-a'],['stalled-b'],['independent-one']])
 assert.equal((await h.query('router.get',{conversationId})).generation,before.generation+2)
 await h.restart();await h.receive(channelMessage('independent-two'));await drain()
 assert.deepEqual(deliveries,[['stalled-a'],['stalled-b'],['independent-one'],['independent-two']])
 const pending=await h.query('router.inbox',{conversationId})
 assert.deepEqual(pending.map(event=>event.source.messageId),['stalled-a','stalled-b'])
 assert.ok(pending.every(event=>event.state==='pending'&&event.deliveryHold?.reason==='ROUTER_BATCH_NO_PROGRESS'))
 assert.deepEqual(await h.query('router.inbox',{conversationId,deliverable:true}),[])
 assert.deepEqual(await readFile(archive),bytes)
 assert.equal(h.sent.length,0)
})

test('cold Router isolates a persisted zero-progress event and actually dispatches fresh independent work', {timeout:nativeTestTimeout(90000)},async t=>{
 const deliveries=[],taskId='fresh-cold-dispatch-task';let oldAttempts=0,plans=0,runs=0
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   assert.match(JSON.stringify(body.messages),/Complete the separate bounded work after restart/)
   runs++
   return {tool:'task_result',args:{decision:{action:'complete',summary:'Fresh work was actually admitted',evidence:[],limitations:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  const {events}=requestEnvelope(body,'Router 请求：'),messageIds=events.flatMap(event=>event.source?[event.source.messageId]:[])
  const lastTool=body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name
  if(body.messages.at(-1)?.role==='tool'&&lastTool==='resident_router_settle')return {text:'Turn finished'}
  const old=events.find(event=>event.source?.messageId==='cold-zero-progress')
  if(old){
   deliveries.push(...messageIds);oldAttempts++
   return {tool:'resident_router_settle',args:{operationId:'stable-old-settle',eventIds:events.map(event=>event.id),noTaskDispositions:[{eventId:old.id,outcome:'context-only',sourceQuote:'deliberately wrong quote',reason:'Synthetic refused settlement'}]}}
  }
  const fresh=events.find(event=>event.source?.messageId==='cold-fresh-work')
  if(fresh&&!plans){
   deliveries.push(...messageIds);plans++
   return {tool:'resident_task_plan',args:{operationId:'independent-new-plan',sourceId:fresh.sourceId,messageVersion:fresh.messageVersion,tasks:[{taskId,title:'Independent cold work',objective:'Fresh bounded task after restart',requirements:[],handoff:'Complete the separate bounded work after restart.'}],dependencies:[]}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle-'+events[0].id,eventIds:events.map(event=>event.id)}}
 })
 const drain=async()=>{try{await h.service.whenIdle()}catch(error){if(error.code!=='ROUTER_BATCH_UNSETTLED')throw error}}
 await h.receive(channelMessage('cold-zero-progress'));await drain()
 const source=(await h.query('source.list'))[0],conversationId=source.groupId,before=await h.query('router.get',{conversationId})
 const archive=join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(before.activeSessionId)),original=await readFile(archive)
 assert.equal(oldAttempts,1);assert.equal((await h.query('router.inbox',{conversationId}))[0]?.source?.sourceId,source.sourceId)
 await h.restart()
 await h.receive(channelMessage('cold-fresh-work',{text:'Fresh bounded task after restart'}));await drain()
 assert.deepEqual(deliveries,['cold-zero-progress','cold-fresh-work'])
 assert.equal(oldAttempts,1);assert.equal(plans,1);assert.equal(runs,1)
 const task=await h.query('task.get',{taskId})
 assert.equal(task.drained,true);assert.equal(task.status,'completed');assert.equal(task.completion?.result?.summary,'Fresh work was actually admitted')
 assert.ok((await h.query('wake.list',{taskId})).every(wake=>wake.state==='acked'))
 const journal=await h.host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 assert.equal(journal.entries.filter(entry=>entry.type==='message'&&entry.message.toolName==='task_result'&&!entry.message.isError).length,1)
 const pending=await h.query('router.inbox',{conversationId})
 assert.equal(pending.length,1);assert.equal(pending[0].source.sourceId,source.sourceId);assert.equal(pending[0].deliveryHold?.reason,'ROUTER_BATCH_NO_PROGRESS')
 assert.deepEqual(await h.query('router.inbox',{conversationId,deliverable:true}),[])
 assert.equal((await h.query('router.get',{conversationId})).generation,before.generation+1)
 assert.deepEqual(await readFile(archive),original)
 assert.equal(h.sent.length,0)
})

for(const decision of ['continue','processed','defer','progress','late'])test(`recovered Router actively reviews a held source: ${decision}`,{timeout:nativeTestTimeout(90000)},async t=>{
 const cold=decision==='processed'||decision==='progress',late=decision==='late'
 const ordinary=[],reviews=[];let attempts=0,notificationId,reviewTried=false,reviewReady=!cold,visible=!late
 const id='held-for-'+decision
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body),last=body.messages.at(-1)
  if(tools.includes('resident_review_held_source')&&!tools.includes('resident_router_settle')){
   assert.deepEqual(tools,['resident_review_held_source'])
   const input=requestEnvelope(body,'Router 挂起来源复查：')
   assert.equal(input.source.messageId,id)
   if(last.role==='tool'){
    if(decision==='progress')return {tool:'resident_review_held_source',args:{eventId:input.eventId,decision:'defer'}}
    if(decision==='defer'&&reviewTried&&reviews.length===1){reviews.push('rejected');return {tool:'resident_router_reply',args:{operationId:'review-must-not-reply',sourceId:input.source.sourceId,messageVersion:input.source.version,replyPurpose:'direct-answer',text:'This must not be sent'}}}
    if(decision==='defer'&&reviews.length===2){reviews.push('forbidden');return {tool:'resident_review_held_source',args:{eventId:input.eventId,decision:'defer'}}}
    return {text:'Review complete'}
   }
   reviews.push(input)
   if(late){
    const reply=input.evidence.replies[0]
    assert.equal(reply?.eligible,reviews.length===2)
    assert.equal(reply?.state,reviews.length===2?'delivered':'starting')
    if(reviews.length===2)assert.equal(reply.notificationId,reviews[0].evidence.replies[0].notificationId)
    return {tool:'resident_review_held_source',args:{eventId:input.eventId,...reply.eligible
      ?{decision:'processed',evidenceId:reply.notificationId,coverage:'The visible original answer covers the requested result.'}:{decision:'defer'}}}
   }
   if(cold){
    const reply=input.evidence.replies[0]
    notificationId=reply?.notificationId
    assert.equal(reply?.state,'delivered')
    assert.equal(reply?.text,decision==='progress'?'Only finished the first check':'Existing answer')
    assert.equal(reply?.eligible,decision==='processed')
   }
   if(decision==='defer'){reviewTried=true;assert.equal(input.noEffect,false)}
   if(decision==='continue')assert.equal(input.noEffect,true)
   return {tool:'resident_review_held_source',args:{eventId:input.eventId,decision:decision==='defer'?'continue':decision==='progress'?'processed':decision,...notificationId?{evidenceId:notificationId,coverage:'The cited reply covers the original request.'}:{}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  const events=requestEnvelope(body,'Router 请求：').events
  const original=events.find(event=>event.source?.messageId===id)
  if(last.role==='tool'){
   const tool=body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name
   if(decision==='continue'&&original&&tool==='resident_router_reply')return {tool:'resident_router_settle',args:{operationId:'settle-continued',eventIds:[original.id],noTaskDispositions:[{eventId:original.id,outcome:'handled-inline',sourceQuote:original.source.text,reason:'Original answered after proven safe continuation'}]}}
   return {text:'End turn'}
  }
  ordinary.push(...events.map(event=>event.source?.messageId))
  if(original&&++attempts===1){
   if(decision==='continue')return {text:'Original round ended before any action'}
   if(cold||late)return {tool:'resident_router_reply',args:{operationId:'old-reply',sourceId:original.sourceId,messageVersion:original.messageVersion,replyPurpose:decision==='progress'?'task-update':'direct-answer',text:decision==='progress'?'Only finished the first check':'Existing answer'}}
   return {tool:'resident_router_settle',args:{operationId:'refused-first',eventIds:[original.id],noTaskDispositions:[{eventId:original.id,outcome:'context-only',sourceQuote:'incorrect quote',reason:'Leave the input unhandled'}]}}
  }
  if(original&&decision==='continue')return {tool:'resident_router_reply',args:{operationId:'continued-reply',sourceId:original.sourceId,messageVersion:original.messageVersion,replyPurpose:'direct-answer',text:'Answer from the safely continued source'}}
  return {tool:'resident_router_settle',args:{operationId:'settle-'+events[0].id,eventIds:events.map(event=>event.id),noTaskDispositions:events.map(event=>({eventId:event.id,outcome:'context-only',sourceQuote:event.source.text,reason:'Fixture has no further external work'}))}}
 },{...late?{readback:()=>visible?{messageId:'visible-1',visible:true}:null}:{},
  wrapStore:store=>({...store,query:q=>!reviewReady&&q.kind==='router.held-review.next'?Promise.resolve(null):store.query(q)})})
 await h.receive(channelMessage(id))
 await assert.rejects(h.service.whenIdle(),{code:'ROUTER_BATCH_UNSETTLED'})
 const original=(await h.query('source.list')).find(source=>source.messageId===id),conversationId=original.groupId
 if(cold)await eventually(async()=>{
  const result=await h.query('router.reply-history',{conversationId,sourceId:original.sourceId})
  return result.replies.some(reply=>reply.state==='delivered')
 },'original fake transport reply received')
 const previous=await h.query('router.get',{conversationId})
 await h.receive(channelMessage('fresh-after-'+decision));await h.service.whenIdle()
 if(cold){
  // 模拟发布恢复代际后停止，旧留置已经落盘，但尚未进入复查。
  assert.equal(reviews.length,0)
  const [held]=await h.query('router.inbox',{conversationId})
  assert.equal(held?.sourceId,original.sourceId);assert.ok(held.deliveryHold)
  assert.deepEqual(await h.query('router.inbox',{conversationId,deliverable:true}),[])
  reviewReady=true
  await h.restart({waitForRouter:false,restoreIdleRouters:true});await h.service.whenIdle()
 }
 const next=await h.query('router.get',{conversationId})
 assert.ok(h.results.some(r=>r.name==="resident_review_held_source"&&!r.result.isError),JSON.stringify(h.results.filter(r=>r.name==="resident_review_held_source")))
 assert.ok(next.generation>previous.generation)
 assert.deepEqual(ordinary,[id,'fresh-after-'+decision,...decision==='continue'?[id]:[]])
 assert.equal(reviews.filter(input=>input.eventId).length,1)
 assert.deepEqual(await h.query('router.inbox',{conversationId,deliverable:true}),[])
 const eventId=original.routeReceipt.eventId
 const [final]=await h.query('router.batch-events',{conversationId,eventIds:[eventId]})
 assert.equal(final.heldReviews.at(-1).decision,['progress','late'].includes(decision)?'defer':decision)
 if(decision==='progress')assert.ok(h.results.some(r=>r.name==='resident_review_held_source'&&r.result.error?.message==='ROUTER_HELD_REVIEW_EVIDENCE_REQUIRED'))
 assert.equal(final.state,['defer','progress','late'].includes(decision)?'pending':'consumed')
 const expectedSends=decision==='defer'?0:1
 if(expectedSends)await eventually(()=>h.sent.length===expectedSends,'one reply through the fake transport')
 if(decision==='defer'){
  assert.ok(h.results.some(r=>r.name==='resident_review_held_source'&&r.result.error?.message==='ROUTER_HELD_REVIEW_EFFECT_UNKNOWN'))
  assert.ok(reviews.includes('forbidden'))
 }
 if(late){
  const replyId=reviews[0].evidence.replies[0].notificationId
  const notice=()=>h.query('notification.get',{notificationId:replyId})
  assert.notEqual((await notice()).state,'delivered')
  assert.ok(h.readbacks.length>0)
  visible=true
  await eventually(async()=>{
   await h.service.whenIdle()
   return (await notice()).state==='delivered'
  },'existing reply confirmed after defer',t.signal)
  await h.service.recover({waitForRouter:false});await h.service.whenIdle()
  assert.equal(reviews.length,1,'ordinary recovery polling does not revisit prior decisions')
  await h.restart({waitForRouter:false,restoreIdleRouters:true});await h.service.whenIdle()
  const current=await h.query('router.get',{conversationId})
  const [settled]=await h.query('router.batch-events',{conversationId,eventIds:[eventId]})
  assert.equal(current.activeSessionId,next.activeSessionId)
  assert.equal(current.generation,next.generation)
  assert.equal(settled.state,'consumed')
  assert.deepEqual(settled.heldReviews.map(review=>review.decision),['defer','processed'])
  assert.equal(settled.heldReviews[1].evidenceId,replyId)
  assert.equal(reviews.length,2)
  assert.equal(h.sent.length,1)
  return
 }
 await h.restart();await h.service.whenIdle()
 assert.equal(reviews.filter(input=>input.eventId).length,1)
 assert.equal(h.sent.length,expectedSends)
})
