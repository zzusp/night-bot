import test from 'node:test'
import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {nativeLifecycle,nativeLifecycleTimeout,nativeTemporaryDirectory as mkdtemp,nativeRemove as rm} from './fixtures/native-lifecycle.js'
import {nativeRuntimeHost,modelToolValues,latestInput,waitUntil} from './fixtures/runtime-official-host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {fixedUnitRequestId,platformScheduleOutboundId} from '../packages/dingtalk-core/fixed-topics.js'
import {createPlatformSchedules} from '../packages/dingtalk-core/platform-schedule.js'
import NativeSessionController from '../src/native-session-controller.js'
import NativeSchedule from '../src/native-schedule.js'

// Actual Host, Pi admission/journal, native schedule clock and resident outbox.
// Only the model and task facts are controlled; no real network messages are sent.
async function fixture(t,{beforeReply,replyText}={}) {
  const root=await mkdtemp(join(tmpdir(),'platform-recurring-'))
  t.mock.timers.enable({apis:['Date'],now:Date.now()})
  let h,bridge,task={taskId:'observed-task',groupId:'periodic-room',title:'Deployment progress',status:'active',state:'running',control:'active',requirementRevision:1,controlRevision:1,runSequence:1}
  const reads=[],errors=[],queryResults=[]
  const boot=async()=>{
    h=await nativeRuntimeHost(root,async request=>{
      assert.ok(request.tools.some(tool=>tool.name==='platform_task_query'))
      const last=request.messages.at(-1)
      if(last?.role==='toolResult'&&last.toolName==='platform_task_query'){
        const page=modelToolValues(request).findLast(value=>Array.isArray(value.items)&&value.asOf)
        assert.ok(page,'report must read fresh task facts through the real query tool')
        queryResults.push(page)
        await beforeReply?.(page,queryResults.length)
        return [{name:'platform_reply_submit',args:{recipientActorIds:['original-actor'],text:replyText?replyText(page,queryResults.length):`Progress at ${page.asOf}: ${page.items[0]?.state??'missing'}`}}]
      }
      return [{name:'platform_task_query',args:{state:'all'}}]
    },{resident:true})
    h.ctx.on('agent/error',event=>errors.push(event.error))
    h.residentStore=await openResidentStore(h.ctx.storageDomain)
    bridge=createPlatformSchedules({ctx:h.ctx,store:h.residentStore,root:h.ctx.runtimePaths.workspaces,
      legacy:{getAgentConfig:()=>({agentPreset:'night-bot'})},models:{provider:'native-task-test',model:'controlled'},
      readTasks:async groupId=>{assert.equal(groupId,'periodic-room');reads.push({at:Date.now(),task:structuredClone(task)});return [structuredClone(task)]},
      appendOutbox:args=>h.residentStore.appendOutbox(args)})
    if(!h.ctx.get('sessionController'))await h.ctx.plugin(NativeSessionController)
    if(!h.ctx.get('schedule'))await h.ctx.plugin(NativeSchedule,{})
    await h.ctx.schedule.ready;await h.ctx.fiber.await();h.ctx.schedule.start()
  }
  const close=async()=>{await bridge?.close();bridge=undefined;await h?.close();h=undefined}
  t.after(async()=>{await close();await rm(root,{recursive:true,force:true})})
  await boot()
  await h.residentStore.subscribe({groupId:'periodic-room',timezone:'Asia/Shanghai'})
  await h.residentStore.ingest({groupId:'periodic-room',messageId:'periodic-source',senderOpenDingTalkId:'original-actor',text:'每10分钟检查上线进展，直到任务完成。',occurredAt:new Date().toISOString()})
  await h.residentStore.routeMessages({groupId:'periodic-room',routeId:'periodic-route',routingRevision:0,routes:[{messageId:'periodic-source',messageVersion:1,units:[{unitKey:'periodic',summary:'周期进展检查',sourceRefs:[{quote:'每10分钟检查上线进展，直到任务完成。'}],topics:[],fixedTopic:'agent-platform',reason:'周期检查'}]}]})
  const message=h.residentStore.getGroup('periodic-room').messages[0],unit=message.units[0]
  const source={groupId:'periodic-room',requestId:fixedUnitRequestId('periodic-room',message,unit),unitId:unit.unitId,unitRevision:unit.unitRevision,messageId:'periodic-source',messageVersion:1,timezone:'Asia/Shanghai'}
  return {source,reads,errors,queryResults,get h(){return h},get bridge(){return bridge},setTask:changes=>{task={...task,...changes}},
    outbox:()=>h.residentStore.getGroup(source.groupId).outbox,
    async tick(){t.mock.timers.tick(600001);h.ctx.schedule.start();await h.ctx.schedule.runtime.running},
    async restart(){await close();await boot()},
    async report(count){await waitUntil(()=>h.residentStore.getGroup(source.groupId).outbox.length===count,'recurring report '+count);const [row]=await h.ctx.schedule.catalog();if(row){const found=await h.ctx.sessionController.resolveAgent(row.sessionId);if(found.error)throw found.error;await found.agent.whenIdle()}},
  }
}

test('native platform checks repeat at the accepted interval, survive restart, and stop only on current completed evidence',
 {timeout:nativeLifecycleTimeout(40000)},nativeLifecycle(40000,async t=>{
  await t.beginBusiness()
  const f=await fixture(t)
  const input={title:'Deployment progress',prompt:'每10分钟核查这项任务进展，全部完成后停止。',every_seconds:600,stopWhen:{taskIds:['observed-task']}}
  const result=await f.bridge.submit(f.source,input)
  assert.equal(result.status,'scheduled')
  const [first]=await f.h.ctx.schedule.catalog();assert.equal(first.kind,'every');assert.equal(first.everySeconds,600)
  assert.deepEqual(await f.bridge.submit(f.source,input),result,'retry must reuse one schedule')
  assert.equal((await f.h.ctx.schedule.catalog()).length,1)
  await f.tick();await f.report(1)
  assert.equal((await f.h.ctx.schedule.catalog())[0].status,'active','first reply must not end periodic checks')
  assert.equal(f.h.residentStore.getPlatformSchedule(first.sessionId).outcome,undefined)
  const firstOutbound=f.outbox()[0].outboundId
  await f.restart();await f.h.ctx.schedule.runtime.running
  assert.equal(f.outbox().length,1,'cold restart must not send the same occurrence twice')
  f.setTask({state:'waiting'});await f.tick();await f.report(2)
  assert.equal((await f.h.ctx.schedule.catalog())[0].status,'active','waiting is not completion')
  f.setTask({state:'completed',status:'completed',technicalFailure:{code:'BUILD_FAILED'},completion:{requirementRevision:1,controlRevision:1,runSequence:1}})
  await f.tick();await f.report(3)
  assert.equal((await f.h.ctx.schedule.catalog())[0].status,'active','a failed outcome is not verified completion')
  f.setTask({technicalFailure:null,completion:{requirementRevision:0,controlRevision:1,runSequence:1}})
  await f.tick();await f.report(4)
  assert.equal((await f.h.ctx.schedule.catalog())[0].status,'active','stale completion cannot satisfy current requirements')
  f.setTask({completion:{requirementRevision:1,controlRevision:1,runSequence:1,summary:'Verified deployment complete',at:new Date().toISOString()}})
  await f.tick();await f.report(5)
  await waitUntil(async()=>(await f.h.ctx.schedule.catalog()).length===0,'completed monitor deleted')
  assert.equal(f.h.residentStore.getPlatformSchedule(first.sessionId).outcome,'completed')
  assert.equal(new Set(f.outbox().map(row=>row.outboundId)).size,5)
  assert.equal(f.outbox()[0].outboundId,firstOutbound)
  assert.ok(f.outbox().every(row=>row.sourceRef.messageId==='periodic-source'&&row.sourceRef.actorId==='original-actor'))
  assert.ok(new Set(f.queryResults.map(page=>page.asOf)).size===5,'each occurrence must refresh the task snapshot')
  const requests=f.h.requests.length
  await f.tick();assert.equal(f.h.requests.length,requests);assert.equal(f.outbox().length,5)
  await f.restart();await f.tick();assert.equal(f.outbox().length,5,'completed monitor cannot resurrect on restart')
  assert.deepEqual(f.errors,[])
}))

test('real Router tool preserves periodic user intent as an every schedule bound to the actual task',
 {timeout:nativeLifecycleTimeout(40000)},nativeLifecycle(40000,async t=>{
  const root=await mkdtemp(join(tmpdir(),'router-periodic-'));let h,scheduled=false,settled=false
  t.mock.timers.enable({apis:['Date'],now:Date.now()})
  t.after(async()=>{await h?.close();await rm(root,{recursive:true,force:true})})
  await t.beginBusiness()
  h=await nativeRuntimeHost(root,async request=>{
    const names=request.tools.map(tool=>tool.name),input=latestInput(request)
    if(names.includes('channel_triage_submit'))return [{name:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'明确交办工作并要求周期进展检查'}))}}]
    if(names.includes('task_result'))return [{name:'task_result',args:{decision:{action:'wait',summary:'Synthetic deployment is waiting for an external build',evidence:['fixture:build-pending'],limitations:['Build not complete']}}}]
    if(names.includes('resident_router_settle')){
      const source=input.events.find(event=>event.source)?.source
      if(!source)return []
      const task=await h.query('task.get',{taskId:'router-observed-task'})
      if(!task)return [{name:'resident_task_plan',args:{operationId:'deployment-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'router-observed-task',title:'Synthetic deployment',objective:'Observe synthetic build progress',requirements:['Do not claim complete until build and service are verified']}],dependencies:[]}}]
      if(!scheduled){scheduled=true;return [{name:'platform_schedule_submit',args:{operationId:'periodic-progress',sourceId:source.sourceId,messageVersion:source.version,title:'Deployment progress',prompt:'每10分钟检查部署进展，直到任务完成。',every_seconds:600,stopWhen:{taskIds:[task.taskId]}}}]}
      if(!settled){settled=true;return [{name:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle-periodic-request'}}]}
    }
    if(names.includes('platform_reply_submit')){
      if(request.messages.at(-1)?.toolName==='platform_task_query')return [{name:'platform_reply_submit',args:{recipientActorIds:['native-user'],text:'当前部署仍在等待构建完成，尚未完成上线。'}}]
      return [{name:'platform_task_query',args:{state:'all'}}]
    }
    return []
  })
  await h.service.ingest({groupId:'native-group',messageId:'periodic-deploy',senderOpenDingTalkId:'native-user',text:'上线包括合并、构建镜像、验证服务。每10分钟检查一次进展，直到任务完成。',occurredAt:new Date().toISOString(),mentionedAgent:true})
  await h.service.whenIdle()
  const result=h.toolResults.find(row=>row.name==='platform_schedule_submit')
  assert.ok(result);assert.equal(result.result.isError,false,JSON.stringify(result))
  const [record]=await h.ctx.schedule.catalog()
  assert.equal(record.kind,'every');assert.equal(record.everySeconds,600);assert.equal(record.status,'active')
  const binding=h.residentStore.getPlatformSchedule(record.sessionId)
  assert.deepEqual(binding.stopWhen,{taskIds:['router-observed-task']})
  assert.equal(binding.sourceMode,'direct');assert.equal(binding.messageId,'periodic-deploy')
  const task=await h.query('task.get',{taskId:'router-observed-task'});assert.ok(task);assert.notEqual(task.status,'completed')
  assert.equal(h.sent.length,0,'creation alone must not send a report or claim deployment complete')
  t.mock.timers.tick(600001);h.ctx.schedule.start()
  await waitUntil(()=>h.sent.length===1,'direct-source periodic report reaches real notification ledger')
  assert.equal(h.sent[0].payload.sourceRef.messageId,'periodic-deploy')
  assert.match(h.sent[0].payload.text,/尚未完成/)
  assert.equal((await h.ctx.schedule.catalog())[0].status,'active')
}))

test('superseding the original source ends its recurring schedule without another report',
 {timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
  await t.beginBusiness();const f=await fixture(t)
  await f.bridge.submit(f.source,{title:'Progress',prompt:'Keep checking original work',every_seconds:600,stopWhen:{taskIds:['observed-task']}})
  const [record]=await f.h.ctx.schedule.catalog()
  await f.tick();await f.report(1)
  await f.h.residentStore.ingest({groupId:f.source.groupId,messageId:f.source.messageId,messageVersion:2,senderOpenDingTalkId:'original-actor',text:'撤回之前的周期检查要求',occurredAt:new Date().toISOString()})
  await f.tick()
  await waitUntil(()=>f.h.residentStore.getPlatformSchedule(record.sessionId).outcome==='superseded','superseded periodic source')
  await waitUntil(async()=>(await f.h.ctx.schedule.catalog()).length===0,'superseded periodic schedule retired')
  assert.equal(f.outbox().length,1)
  await f.restart();await f.tick();assert.equal(f.outbox().length,1)
}))


test('an in-flight occurrence retains its admission and snapshot while the next tick is durably queued',
 {timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
  await t.beginBusiness()
  let release
  const barrier=new Promise(resolve=>{release=resolve})
  const f=await fixture(t,{beforeReply:async(_page,index)=>{if(index===1)await barrier}})
  t.after(()=>release())
  await f.bridge.submit(f.source,{title:'Progress',prompt:'Check every ten minutes',every_seconds:600,stopWhen:{taskIds:['observed-task']}})
  const [initial]=await f.h.ctx.schedule.catalog()
  await f.tick()
  await waitUntil(()=>f.queryResults.length===1,'first occurrence reaches blocked report')
  const {agent}=await f.h.ctx.sessionController.resolveAgent(initial.sessionId)
  const firstAdmission=await agent.admission.current()
  const occurrenceAt=firstAdmission.messages[0].source.occurrences[0].occurrenceAt
  f.setTask({state:'waiting'})
  await f.tick()
  const [advanced]=await f.h.ctx.schedule.catalog()
  assert.notEqual(advanced.lastDelivery.messageId,firstAdmission.messages[0].id,'next occurrence must be durably accepted without waiting for the model')
  // Drain ordinary I/O so an incorrectly dispatched follow-up has time to replace current.
  await new Promise(resolve=>setTimeout(resolve,100))
  try {
    assert.deepEqual(await agent.admission.current(),firstAdmission,'queued next occurrence must not steal the running occurrence admission')
    assert.equal(f.outbox().length,0)
  } finally { release() }
  await f.report(2)
  const [first,second]=f.outbox()
  assert.equal(first.outboundId,platformScheduleOutboundId(f.source.requestId+':'+occurrenceAt))
  assert.match(first.text,/running/)
  assert.match(second.text,/waiting/)
  assert.notEqual(first.outboundId,second.outboundId)
  assert.equal(f.queryResults.length,2)
  assert.notEqual(f.queryResults[0].asOf,f.queryResults[1].asOf)
  assert.equal(f.h.residentStore.getPlatformSchedule(initial.sessionId).outcome,undefined)
  assert.deepEqual(f.errors,[])
}))

test('completion after the reported snapshot waits for the next explicitly completed report',
 {timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
  await t.beginBusiness()
  let f
  f=await fixture(t,{beforeReply:async(_page,index)=>{
    if(index===1)f.setTask({status:'completed',state:'completed',completion:{requirementRevision:1,controlRevision:1,runSequence:1}})
  }})
  await f.bridge.submit(f.source,{title:'Progress',prompt:'Report until complete',every_seconds:600,stopWhen:{taskIds:['observed-task']}})
  const [initial]=await f.h.ctx.schedule.catalog()
  await f.tick();await f.report(1)
  assert.equal(f.queryResults[0].stopConditionMet,false)
  assert.match(f.outbox()[0].text,/running/)
  assert.equal((await f.h.ctx.schedule.catalog())[0].status,'active','live completion cannot retire a monitor whose delivered snapshot was still running')
  assert.equal(f.h.residentStore.getPlatformSchedule(initial.sessionId).outcome,undefined)
  await f.tick();await f.report(2)
  assert.equal(f.queryResults[1].stopConditionMet,true)
  assert.match(f.outbox()[1].text,/completed/)
  await waitUntil(async()=>(await f.h.ctx.schedule.catalog()).length===0,'completed report retires monitor')
  assert.equal(f.h.residentStore.getPlatformSchedule(initial.sessionId).outcome,'completed')
}))


test('a silent occurrence does not silently terminate a completed-work monitor',
 {timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
  await t.beginBusiness()
  const f=await fixture(t,{replyText:(_page,index)=>index===1?null:'Work complete'})
  f.setTask({status:'completed',state:'completed',completion:{requirementRevision:1,controlRevision:1,runSequence:1}})
  await f.bridge.submit(f.source,{title:'Progress',prompt:'Report until complete',every_seconds:600,stopWhen:{taskIds:['observed-task']}})
  const [initial]=await f.h.ctx.schedule.catalog()
  await f.tick();await waitUntil(()=>!!f.h.residentStore.getPlatformSchedule(initial.sessionId).lastOccurrenceAt,'silent occurrence settled')
  assert.equal(f.outbox().length,0);assert.equal(f.h.residentStore.getPlatformSchedule(initial.sessionId).outcome,undefined)
  assert.equal((await f.h.ctx.schedule.catalog())[0].status,'active')
  await f.tick();await f.report(1)
  await waitUntil(async()=>(await f.h.ctx.schedule.catalog()).length===0,'final visible report stops monitor')
  assert.equal(f.h.residentStore.getPlatformSchedule(initial.sessionId).outcome,'completed')
}))

async function editSource(f, id='edit-source') {
  const store=f.h.residentStore,groupId=f.source.groupId
  await store.ingest({groupId,messageId:id,senderOpenDingTalkId:'original-actor',text:'修改原排期',occurredAt:new Date().toISOString()})
  await store.routeMessages({groupId,routeId:id,routingRevision:store.getGroup(groupId).routingRevision,routes:[{messageId:id,messageVersion:1,units:[{unitKey:id,summary:'修改排期',sourceRefs:[{quote:'修改原排期'}],topics:[],fixedTopic:'agent-platform',reason:'修改排期'}]}]})
  const message=store.getGroup(groupId).messages.find(row=>row.messageId===id),unit=message.units[0]
  return {groupId,requestId:fixedUnitRequestId(groupId,message,unit),unitId:unit.unitId,unitRevision:unit.unitRevision,messageId:id,messageVersion:1,timezone:'Asia/Shanghai'}
}

test('native managed replacement and cancellation survive restart without firing the old target',
 {timeout:nativeLifecycleTimeout(40000)},nativeLifecycle(40000,async t=>{
  await t.beginBusiness()
  const f=await fixture(t)
  const original=await f.bridge.submit(f.source,{title:'Progress',prompt:'Report progress',every_seconds:600})
  const replacement=await f.bridge.update(await editSource(f),{scheduleId:original.scheduleId,change:{every_seconds:1200}})
  assert.equal(replacement.status,'scheduled');assert.notEqual(replacement.scheduleId,original.scheduleId)
  await f.tick();await new Promise(resolve=>setTimeout(resolve,40))
  assert.equal(f.outbox().length,0,'old 10-minute occurrence must not fire')
  await f.restart();await f.tick();await f.report(1)
  assert.equal((await f.h.ctx.schedule.catalog()).length,1)
  assert.equal((await f.bridge.delete(await editSource(f,'delete-source'),{scheduleId:replacement.scheduleId})).status,'cancelled')
  assert.equal((await f.h.ctx.schedule.catalog()).length,0)
  await f.restart();await f.tick();await new Promise(resolve=>setTimeout(resolve,40))
  assert.equal(f.outbox().length,1,'cancelled periodic timer cannot emit after restart')
}))

test('native cold startup completes committed replacement after interrupted create without Router retry',
 {timeout:nativeLifecycleTimeout(40000)},nativeLifecycle(40000,async t=>{
  await t.beginBusiness()
  const f=await fixture(t)
  const original=await f.bridge.submit(f.source,{title:'Progress',prompt:'Report progress',every_seconds:600})
  const source=await editSource(f),create=f.h.ctx.schedule.create.bind(f.h.ctx.schedule)
  f.h.ctx.schedule.create=async()=>{throw Error('interrupted replacement create')}
  await assert.rejects(f.bridge.update(source,{scheduleId:original.scheduleId,change:{every_seconds:1200}}),/interrupted/)
  assert.equal((await f.h.ctx.schedule.catalog()).length,0)
  f.h.ctx.schedule.create=create
  await f.restart()
  await waitUntil(async()=> (await f.h.ctx.schedule.catalog()).length===1,'replacement recovery')
  const [replacement]=await f.h.ctx.schedule.catalog()
  assert.notEqual(replacement.id,original.scheduleId);assert.equal(replacement.everySeconds,1200)
  await f.tick();await f.tick();await f.report(1)
  assert.equal((await f.h.ctx.schedule.catalog()).length,1)
}))
