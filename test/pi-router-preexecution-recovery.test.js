import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,symlink,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {once} from 'node:events'
import {residentRouterHost,channelMessage,requestTools,requestEnvelope} from './fixtures/resident-router-host.js'
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
   const args={sourceId:holdSource,messageVersion:1,taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,kind:'resume'}
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
  if(!attemptedHeld){attemptedHeld=true;return {tool:'resident_task_action',args:{operationId:'still-held',kind:'resume',taskId:task.taskId,sourceId:source.sourceId,messageVersion:source.version,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}}}
  if(!queried){queried=true;return {tool:'resident_task_query',args:{taskId:task.taskId}}}
  if(!reply){reply=true;assert.equal(task.control,'paused');return {tool:'resident_router_reply',args:{operationId:'actual-query-answer',sourceId:source.sourceId,messageVersion:source.version,replyPurpose:'direct-answer',text:'The existing task is paused; no execution has been started.'}}}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Current state checked; events observed without task dispatch'}
  const noTaskDispositions=input.events.filter(e=>e.source).map(e=>({eventId:e.id,outcome:e===fresh?'handled-inline':'context-only',sourceQuote:e.source.text,reason:e===fresh?'Actual current task state was read and replied':'Retain the source as context without repeating an old action'}))
  return {tool:'resident_router_settle',args:{operationId:'settle-seven',eventIds:replacementIds,noTaskDispositions}}
 }
 let make=residentRouterHost,install
 if(legacy){
  root=await mkdtemp(join(tmpdir(),'night-218-old-'));const code=join(root,'old-code');install=join(root,'installation');await mkdir(code)
  const repo=fileURLToPath(new URL('../',import.meta.url)),{stdout}=await promisify(execFile)('git',['archive','bf3a1ab730bd552976dd276343e6f752f2b5072f'],{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
  const tar=spawn('tar',['-x','-C',code]);tar.stdin.end(stdout);assert.equal((await once(tar,'exit'))[0],0);await symlink(join(repo,'node_modules'),join(code,'node_modules'),'dir')
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
