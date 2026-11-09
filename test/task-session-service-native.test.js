import * as application from '../src/application.js'
import {getCurrentSystemPrompt} from '@earendil-works/pi-ai'
import {createNativeDwsObserver,nativeDwsCommands,nativeDwsObservation} from '../packages/dingtalk-core/native-dws-send.js'
import {nativeRuntimeHost} from './fixtures/runtime-official-host.js'
import { nativeLifecycle, nativeLifecycleTimeout, nativeTestTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import { lifecycleStages } from './fixtures/lifecycle-stages.js'
import testRunner from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createServer } from 'node:net'
import { get as httpGet } from 'node:http'
import { createHash } from 'node:crypto'
import { available, reason, nativeShell, latestInput, topicTaskCalls, waitUntil } from './fixtures/runtime-official-host.js'
import { openDynamicTaskStore } from '../packages/dingtalk-core/dynamic-task-store.js'
import { openTaskSessionService } from '../packages/dingtalk-core/task-session-service.js'
import { taskNotificationRecovery } from '../packages/dingtalk-core/notification-delivery.js'
import { DatabaseSync } from 'node:sqlite'
import { openTaskResidentRuntime } from '../packages/dingtalk-core/task-resident-runtime.js'

testRunner('official service read-only web errors do not become unknown effects and later reads still complete',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-web-');let h,calls=0
 h=await f.host(()=>calls===0?[call('web_fetch',{url:'https://fixture.invalid/read'})]:calls===1?[call('web_search',{queries:['readonly fixture']})]:[singleResult('complete','Read-only failures were recorded without replay')])
 const web=h.ctx.get('web'),original={fetch:web.fetch,search:web.search};for(const name of ['fetch','search'])web[name]=async()=>{calls++;throw Error('unsupported content type')};t.after(()=>Object.assign(web,original))
 await t.beginBusiness();const task=await h.service.createTask({requestId:'web-readonly',objective:'Read the requested web resources and report failures'})
 await h.service.whenIdle();const row=await h.query('task.get',{taskId:task.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true})
 assert.equal(calls,2);assert.equal(row.status,'completed');assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,0);assert.deepEqual(await h.query('execution.list'),[])
 assert.equal(h.toolResults.filter(r=>['web_fetch','web_search'].includes(r.name)&&r.result.isError).length,2)
}))
import { projectTaskNotification } from '../packages/dingtalk-core/task-message-projections.js'

const call = (name, args) => ({ name, args })
const test = (name, options, run) => testRunner(name, { ...options, ...(!available ? { skip: reason } : {}) }, run)

// Retired: the old split-executor onNativeExecution callback fixture.
// Optional DWS status parsing remains in native-dws-send domain tests and the
// actual service frozen-delivery/early-echo case below. Single does not claim
// automatic tracing of arbitrary DWS shell commands.


test('official service completion freezes files and resumes remaining delivery after the explanation is archived', { ...({ timeout: 20000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  const fixture = await officialCase(t, 'native-final-files-')
  let step=0
  const recipientActorIds=[]
  const h=await fixture.host(async request=>{
    const topic=topicTaskCalls(request);if(topic)return topic
    if(step++===0)return[call('write',{path:'work/acceptance.txt',content:'accepted original bytes'})]
    if(step===2)return[call('read',{path:'work/acceptance.txt'})]
    assert.ok(JSON.stringify(request.messages.filter(m=>m.role==='toolResult')).includes('accepted original bytes'))
    return[singleResult('complete','The local acceptance bytes were read back',{artifacts:['work/acceptance.txt'],deliveryFiles:[{path:'work/acceptance.txt',caption:'本地验收结果'}]})]
  }, { routerReplyRecipients:recipientActorIds,serviceFactory:explicitDwsService,config:{assistantActorId:'native-assistant'},notifications: { send: async () => ({ messageId: 'summary' }), readback: async () => undefined,
    sendFile: async () => assert.fail('Files must wait for the final explanation receipt'), readbackFile: async () => undefined } })
    await t.beginBusiness()

  t.onCancel(async()=>t.diagnostic(JSON.stringify({attachmentFinal:{notices:await h.query('notification.list'),alerts:h.service.listAlerts()}})))
  const channels=h.ctx.get('channels'),envelope={type:'chat-room',channelId:'file-delivery-fixture',conversationId:'native-group',messageId:'final-file',text:'test identity'}
  recipientActorIds.push(channels.identity({...envelope,senderId:'vendor-reviewer'}).principal,channels.identity({...envelope,senderId:'vendor-requester'}).principal)
  await h.residentStore.ingest({groupId:'native-group',messageId:'recipient-reviewer',senderOpenDingTalkId:recipientActorIds[0],text:'我负责接收验收文件。',occurredAt:new Date().toISOString()})
  await t.step(async () => h.service.ingest({ groupId: 'native-group', messageId: 'final-file', actorId: recipientActorIds[1], senderName: '用户',
    text: '测试助手，生成并核验本地文件，随最终结果交付', timestamp: new Date().toISOString() }))
  await t.step(async () => h.service.whenIdle())
  const [created] = await t.step(async () => h.query('task.list'))
  const task = await t.step(async () => h.query('task.get', { taskId: created.taskId }))
  assert.equal(task.status, 'completed', JSON.stringify(h.toolResults.filter(item => item.result.isError)))
  assert.equal(task.completion.result.artifactFiles.length, 1)
  assert.equal(task.completion.result.artifactFiles[0].artifact.taskId, created.taskId)
  assert.equal(task.completion.result.artifactFiles[0].caption, '本地验收结果')
  const notices = await t.step(async () => h.query('notification.list'))
  const explanation = notices.find(n => n.payload.deliveryId === n.id)
  const fileNotice = notices.find(n => n.payload.artifact)
  assert.ok(explanation); assert.equal(fileNotice.state, 'prepared')
  assert.deepEqual(explanation.payload.recipientActorIds,recipientActorIds);assert.equal(explanation.payload.sourceMessageId,undefined);assert.equal(explanation.payload.actorId,undefined)
  assert.deepEqual(fileNotice.payload.recipientActorIds,recipientActorIds)
  const startCommand={id:`notification-start:${fileNotice.id}:0`,kind:'notification.start',args:{notificationId:fileNotice.id}}
  assert.notEqual(explanation.state,'delivered')
  for(let i=0;i<2;i++){const held=await h.service.store.command(startCommand);assert.equal(held.dispatchEligible,false);assert.equal(held.result.notification.state,'prepared');assert.equal(held.result.notification.sendAttemptCount??0,0);assert.ok(!held.result.notification.sendPermit)}
  await t.step(async () => h.service.store.command({ id: 'observe-summary', kind: 'notification.reconcile', args: { notificationId: explanation.id, state: 'delivered',
    evidenceRef: 'exact-original-send', receipt: { messageId: explanation.ack.messageId, conversationId: 'native-group' } } }))
  await t.step(async () => h.service.store.command({ id: 'archive-delivery-task', kind: 'task.archive', args: { taskId: created.taskId, actorId: 'native-user' } }))
  assert.equal((await t.step(async () => h.query('notification.list'))).some(n => n.id === explanation.id), false)
  await t.step(async () => h.close())
  const sent = []
  const recovered = await t.step(async () => fixture.host(() => { throw new Error('Recovery must not re-run task models') }, { initialize: false,serviceFactory:explicitDwsService,config:{assistantActorId:'native-assistant'}, notifications: {
    send: async () => assert.fail('The explanation must not be sent twice'), readback: async n => ({ messageId: n.ack.messageId }),
    sendFile: async (n, file) => { sent.push(n.id); assert.deepEqual(n.payload.recipientActorIds,recipientActorIds); assert.equal(await readFile(file.path, 'utf8'), 'accepted original bytes'); return { openTaskId: 'queued-file-send' } },
    readbackFile: async () => undefined,
    querySendStatus: async id => { assert.equal(id, 'queued-file-send'); return { contractVersion: 'im.message-send-status.v1', success: true, openTaskId: id,
      result: { sendStatus: 'SUCCESS', openConversationId: 'native-group', openMessageId: 'delivered-file' },
      messageRef: { openConversationId: 'native-group', openMessageId: 'delivered-file' } } },
  } }))
  await t.step(async () => recovered.service.whenIdle())
  assert.deepEqual(sent, [fileNotice.id])
  const echo = { groupId: 'native-group', messageId: 'delivered-file', senderOpenDingTalkId: 'native-assistant', text: '[文件] acceptance.txt', timestamp: new Date().toISOString() }
  assert.equal((await t.step(async () => recovered.service.ingest(echo))).reason, 'own-notification')
  const pendingFile = await t.step(async () => recovered.query('notification.get', { notificationId: fileNotice.id }))
  assert.equal(pendingFile.state, 'starting'); assert.equal(pendingFile.ack.openTaskId, 'queued-file-send')
  assert.equal(pendingFile.sendAttemptCount,1);assert.equal((await recovered.service.store.command(startCommand)).dispatchEligible,false)
  const outbound = recovered.residentStore.getGroup('native-group').outbox.find(item => item.outboundId === fileNotice.id)
  assert.equal(outbound.deliveredMessageId, 'delivered-file'); assert.equal(outbound.status, 'pending')
  await t.step(async () => recovered.close())
  const verified = await t.step(async () => fixture.host(() => { throw new Error('Receipt recovery must not re-run models') }, { initialize: false,serviceFactory:explicitDwsService,config:{assistantActorId:'native-assistant'}, notifications: {
    send: async () => assert.fail('The explanation must not be sent twice'), readback: async () => undefined,
    sendFile: async () => assert.fail('An acknowledged file must not be sent twice'),
    readbackFile: async () => ({ messageId: 'delivered-file', conversationId: 'native-group' }),
  } }))
  assert.equal((await t.step(async () => verified.service.ingest(echo))).reason, 'own-notification', 'Early identity proof survives restart')
  const replay=await verified.service.store.command(startCommand);assert.equal(replay.dispatchEligible,false);assert.equal(replay.result.notification.sendAttemptCount,1)
  await t.step(async () => verified.service.whenIdle())
  const awaitingReadback = await t.step(async () => verified.query('notification.get', { notificationId: fileNotice.id }))
  const retry = await t.step(async () => verified.service.retryNotification({ groupId: 'native-group', notificationId: fileNotice.id,
    expectedToken: taskNotificationRecovery(awaitingReadback).expectedToken }))
  assert.equal(retry.action, 'readback')
  assert.equal((await t.step(async () => verified.query('notification.get', { notificationId: fileNotice.id }))).state, 'delivered')
}))

// The Router must classify preserve/replan/cancel explicitly before Host mutation.
for(const mode of ['missing','preserve','replan','cancel'])test(`official Router context actions preserve explicit classification and cancellation: ${mode}`,{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());const f=await officialCase(t,'single-service-context-',false);let h,created,first=true,semanticTurns=0
 h=await f.host(request=>{
  const names=request.tools.map(tool=>tool.name),input=latestInput(request)
  if(names.includes('task_result')){if(first){first=false;entered.resolve();return release.promise.then(()=>[singleResult('wait','Original body released without an external effect')])}return[singleResult('wait','Current exact context was observed')]}
  const source=input.events?.find(event=>event.source?.messageId==='semantic-input')?.source
  if(names.includes('resident_router_settle')&&source&&created){
   if(semanticTurns++===0){const args={operationId:'explicit-context-action',sourceId:source.sourceId,messageVersion:source.version,taskId:created.taskId,expectedRequirementRevision:created.requirementRevision,expectedControlRevision:created.controlRevision,
    ...(mode==='cancel'?{kind:'control',control:'cancelled',reason:source.text}:mode==='replan'?{kind:'revise',objective:source.text,text:source.text}:mode==='preserve'?{kind:'supplement',text:source.text}:{text:source.text})};return[call('resident_task_action',args)]}
   if(semanticTurns===2)return[call('resident_router_settle',{operationId:'settle-context-action',eventIds:input.events.map(event=>event.id)})]
   return[]
  }
  return topicTaskCalls(request)??[]
 })
 try{
 await t.beginBusiness();await h.service.ingest({...message,messageId:'original-context'});await entered.promise;[created]=await h.query('task.list')
 const actor=h.ctx.agents.get(created.sessionId);assert.ok(actor)
 await h.service.ingest({groupId:'native-group',messageId:'semantic-input',senderOpenDingTalkId:'native-user',text:mode==='cancel'?'测试助手，明确取消原任务':mode==='replan'?'测试助手，改为新目标并停止旧目标':'测试助手，先核对正确分支，这不是新授权',timestamp:new Date().toISOString()})
 if(mode==='missing')await waitUntil(()=>h.requests.some(request=>request.messages.some(row=>row.role==='toolResult'&&row.toolName==='resident_task_action'&&row.isError&&JSON.stringify(row.content).includes('kind'))),'missing semantic action explicitly rejected')
 else await waitUntil(async()=>{const row=await h.query('task.get',{taskId:created.taskId});return mode==='cancel'?row.control==='cancelled':mode==='replan'?row.requirementRevision===2:row.contextRevision===1},'explicit context action applied')
 const during=await h.query('task.get',{taskId:created.taskId});assert.equal(during.requirementRevision,mode==='replan'?2:1)
 if(['missing','preserve'].includes(mode)){assert.equal(actor.lifecycle.signal.aborted,false,'ordinary context cannot silently cancel the running body');assert.equal(during.drained,false)}
 else await waitUntil(()=>actor.lifecycle.signal.aborted,'explicit replan/cancel abort reaches the actual actor')
 release.resolve();await h.service.whenIdle();const after=await h.query('task.get',{taskId:created.taskId});assert.equal(after.sessionId,created.sessionId);assert.equal(after.drained,true);assert.deepEqual(await h.query('execution.list'),[])
 if(mode==='cancel')assert.equal(after.status,'cancelled');else assert.equal(after.status,'active')
 }finally{release.resolve()}
}))

const message = { groupId: 'native-group', messageId: 'native-message-1', senderOpenDingTalkId: 'native-user', senderName: '真实用户', text: '测试助手，分别生成 alpha 和 beta 的文件并用终端验证，再汇总结论。', occurredAt: '2026-10-13T10:00:00Z', timestamp: '2026-10-13T10:00:00Z' }

test('official service preserves one authenticated source identity across the SQL request, native admission and Host material',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-authority-'),body='AUTHORIZATION_CORRECTION: analyze only; no implementation permission.\n'+Array.from({length:100},(_,i)=>'boundary evidence '+i).join('\n');let read=false,materialPath
 const h=await f.host(request=>{const input=singleInput(request);assert.equal(input.task.objective,body);assert.ok(input.sources.some(source=>source.text===body),'current authorized original source must be present without a reconstructed Host projection');const source=input.sources.find(source=>source.text===body);assert.equal(source.actorId,'native-user');assert.equal(source.requestIdentity.singleTaskCreate.context,body);const material=input.materials.find(value=>value.sourceId===source.sourceId);assert.ok(material?.textPath);materialPath=material.textPath;if(!read){read=true;return[call('read',{path:materialPath})]}assert.ok(request.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content??[]).some(part=>part.type==='text'&&part.text.includes(body)));return[singleResult('complete','Only the authorized analysis was performed')]})
 await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'source-identity',objective:body,context:body});await h.service.whenIdle()
 const row=await h.query('task.get',{taskId:created.taskId}),sources=await h.query('source.list');assert.equal(sources.filter(source=>source.sourceId===row.metadata.authorizationSourceId).length,1);const source=sources.find(source=>source.sourceId===row.metadata.authorizationSourceId);assert.equal(source.text,body);assert.equal(source.requestIdentity.singleTaskCreate.context,body);assert.equal(row.status,'completed');assert.equal(await readFile(materialPath,'utf8'),body)
 const saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),packets=saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued');assert.equal(packets.length,1);const packet=JSON.parse(packets[0].payload.content[0].text);assert.equal(packet.sources.find(value=>value.sourceId===source.sourceId).text,body);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,0);assert.deepEqual(await h.query('execution.list'),[])
}))

test('Router rejects another sender reopening completed work; the original author can reopen the same execution session',{timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
 const f=await officialCase(t,'task-source-auth-',false);let h,original,turns=new Map()
 h=await f.host(request=>{
  const input=latestInput(request),names=request.tools.map(tool=>tool.name)
  const source=input.events?.find(event=>event.source?.messageId.startsWith('reopen-'))?.source
  if(names.includes('resident_router_settle')&&source){
   const step=turns.get(source.sourceId)??0;turns.set(source.sourceId,step+1)
   if(step<(source.actorId==='colleague'?2:1))return[call('resident_task_action',{operationId:'reopen:'+source.sourceId,sourceId:source.sourceId,messageVersion:source.version,kind:'reopen',taskId:original.taskId,expectedRequirementRevision:1,expectedControlRevision:1,objective:'沿原修复在既有授权范围复核',text:source.text})]
   if(step===(source.actorId==='colleague'?2:1))return[call('resident_router_settle',{operationId:'settle:'+source.sourceId,eventIds:input.events.map(event=>event.id)})]
   return[]
  }
  const calls=topicTaskCalls(request);if(calls)return calls
  if(original){assert.equal(input.task.sessionId,original.sessionId);assert.ok(input.sources.some(source=>source.messageId==='reopen-author'))}
  return[singleResult('complete',original?'原作者明确授权的续办已完成':'原目标已经完成')]
 })
 await t.beginBusiness();await h.service.ingest(message);await h.service.whenIdle();[original]=await h.query('task.list')
 await h.service.ingest({...message,messageId:'reopen-colleague',senderOpenDingTalkId:'colleague',text:'测试助手，重新打开原任务'});await h.service.whenIdle()
 const denied=h.toolResults.filter(row=>row.name==='resident_task_action'&&row.result.isError)
 assert.equal(denied.length,2);assert.ok(denied.every(row=>JSON.stringify(row.result).includes('FORBIDDEN')||JSON.stringify(row.result).includes('PERMISSION')))
 assert.equal((await h.query('task.get',{taskId:original.taskId})).requirementRevision,1)
 await h.service.ingest({...message,messageId:'reopen-author',text:'测试助手，在既有授权范围重开原任务复核'});await h.service.whenIdle()
 const [current]=await h.query('task.list');assert.equal((await h.query('task.list')).length,1)
 assert.equal(current.taskId,original.taskId);assert.equal(current.sessionId,original.sessionId);assert.equal(current.ownerActorId,'native-user');assert.equal(current.requirementRevision,2);assert.equal(current.status,'completed')
 const count=h.requests.length;await h.service.ingest({...message,messageId:'reopen-author',text:'测试助手，在既有授权范围重开原任务复核'});await h.service.whenIdle()
 assert.equal(h.requests.length,count);assert.equal((await h.query('task.get',{taskId:original.taskId})).requirementRevision,2)
}))

for(const [ownEcho,actor]of [[true,'native-user'],[true,'colleague'],[false,'native-user']])test(`Router supplements only the admitted source; historical context is not authority: echo=${ownEcho}, actor=${actor}`,{timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
 const f=await officialCase(t,'task-direct-source-',false);let h,original,taskTurns=0
 h=await f.host(request=>{
  const routed=topicTaskCalls(request,{task:original});if(routed)return routed
  const input=latestInput(request);taskTurns++
  if(!original)return[singleResult('blocked','原问题仍待明确答复',{audience:'requester',question:'是否批准原范围内的例外？',attemptedActions:['核对原始交办']})]
  assert.ok(input.humanReview);assert.equal(input.task.sessionId,original.sessionId)
  assert.ok(input.sources.some(source=>source.messageId==='manual-followup'&&source.actorId===actor&&source.text==='先核对分支，不是批准例外'))
  assert.ok(input.sources.every(source=>!['native-notification-1','unadmitted-history'].includes(source.messageId)))
  return[singleResult('wait','定位补充不代表批准，保留原待答问题')]
 })
 await t.beginBusiness();await h.service.ingest(message);await h.service.whenIdle();[original]=await h.query('task.list')
 assert.ok(original.humanRequests.length===1)
 const historical={...message,messageId:ownEcho?'native-notification-1':'unadmitted-history',text:ownEcho?h.sent[0].payload.text:'未准入的历史正文不是当前动作授权'}
 if(ownEcho)assert.equal((await h.service.ingest(historical)).reason,'own-notification')
 else await h.residentStore.ingest(historical)
 const input={...message,messageId:'manual-followup',senderOpenDingTalkId:actor,text:'先核对分支，不是批准例外',occurredAt:new Date().toISOString(),timestamp:new Date().toISOString()}
 await h.service.ingest(input);await h.service.whenIdle()
 const [current]=await h.query('task.list');assert.equal((await h.query('task.list')).length,1)
 assert.equal(current.sessionId,original.sessionId);assert.equal(current.requirementRevision,1);assert.equal(current.humanRequests[0].status,'waiting-reply');assert.equal(current.humanRequests[0].requestId,original.humanRequests[0].requestId)
 assert.equal(taskTurns,2);assert.ok(!(await h.query('source.list')).some(source=>source.messageId===historical.messageId))
 const count=h.requests.length;await h.service.ingest(input);await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
 assert.deepEqual(await h.query('execution.list'),[])
}))

// Retired: 180-message DSH Host event/projection retirement and compacted
// surface replay. This new project imports no DSH journals; Pi alone owns the
// current history. Actual native compaction/physical evidence is tested below.


test('official service preserves task identity and exact source revisions through three generations in the original Pi session',{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const f=await officialCase(t,'single-service-generations-'),inputs=[],h=await f.host(request=>{inputs.push(singleInput(request));return[singleResult('wait','Continue only after the next exact input')]});await t.beginBusiness()
 const created=await h.service.createTask({groupId:'native-group',requestId:'generation-original',objective:'Retain the exact original task objective'});await h.service.whenIdle()
 for(let i=1;i<=2;i++){await h.service.appendTaskContext({taskId:created.taskId,requestId:'generation-'+i,progressImpact:'replan',context:'GENERATION_'+i+': current authorized source'});await h.service.whenIdle()}
 const row=await h.query('task.get',{taskId:created.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(row.sessionId,created.session.sessionId);assert.equal(row.requirementRevision,3);assert.equal(inputs.length,3);assert.ok(inputs[2].sources.some(source=>source.text.includes('GENERATION_2:')));assert.deepEqual(await h.query('execution.list'),[])
 assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1);assert.deepEqual(saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').map(r=>r.payload.source.taskSession.requirementRevision),[1,2,3]);assert.ok(!saved.entries.some(e=>e.type==='custom_message'&&e.details?.source?.taskContextHistory),'no retired Host history projection is installed')
}))

// Exercise actual official SDK auto-compaction across 32 source-authorized leases.
const continuationBudget=process.platform==='win32'?300000:120000
test('official service retains 32 source-authorized continuations in Pi history without replaying the completed effect',{timeout:nativeLifecycleTimeout(continuationBudget)},nativeLifecycle(continuationBudget,async t=>{
 const f=await officialCase(t,'single-service-32-');let wrote=false,modelCalls=0;const compactionSummary='The task has one original execution session. work/one-effect.txt was written successfully exactly once. Later sources ask for inspection only. Do not replay the original effect. Obtain current authority from the current admitted task input, never from this summary.'
 const h=await f.host(request=>{assert.ok(!request.tools.some(tool=>tool.name.startsWith('group_')),'Single catalogue must not acquire global coordinator tools');assert.ok(++modelCalls<=64,'Unexpected repeated task turn: '+JSON.stringify({task:singleInput(request).task?.taskId,last:request.messages.filter(m=>m.role==='toolResult').at(-1)}));return !wrote?(wrote=true,[call('write',{path:'work/one-effect.txt',content:'exactly-once'})]):[singleResult('wait','Wait for the next authenticated continuation')]},{compactionSummary,estimateUsage:true});await t.beginBusiness()
 const created=await h.service.createTask({groupId:'native-group',requestId:'continuation-original',objective:'Retain one completed effect and accept exact later inputs'});await h.service.whenIdle()
 // Web 来源没有入站计时；保存 Host 观测后核对后续会话投影始终排除遥测。
 const sourceId=(await h.query('task.get',{taskId:created.taskId})).sourceRefs[0],observedAt=new Date().toISOString()
 await h.service.store.command({id:'continuation-original-observed',kind:'source.stage',args:{sourceId,stage:{spanId:'continuation-original-observed',stage:'host',phase:'task-commit',requestId:'continuation-original',attempt:0,startedAt:observedAt,completedAt:observedAt}}})
 for(let i=1;i<32;i++){const iterationStarted=performance.now();if(process.env.NIGHT_BOT_TEST_DEBUG)console.error('SERVICE_CONTINUATION',i);await h.service.appendTaskContext({taskId:created.taskId,requestId:'continuation-'+i,progressImpact:'preserve',context:'Continuation '+i+': observe the existing result; do not repeat it.'});await h.service.whenIdle();assert.equal((await h.query('task.get',{taskId:created.taskId})).lastDecision?.action,'wait',JSON.stringify(h.service.listAlerts()));const snapshot=await h.ctx.sessionPersistence.readNative(created.session.sessionId,{requireComplete:true}),latest=snapshot.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').at(-1);assert.ok(JSON.parse(latest.payload.content[0].text).sources.every(source=>!Object.hasOwn(source,'stages')),'Night telemetry is not conversational source content');const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count,'idle recovery must not manufacture a model wake');if(process.env.NIGHT_BOT_TEST_DEBUG)t.diagnostic(JSON.stringify({continuation:i,elapsedMs:Math.round(performance.now()-iterationStarted),summaryCalls:h.auxiliaryRequests.length}))}
 const row=await h.query('task.get',{taskId:created.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),packets=saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued')
 assert.equal(row.sessionId,created.session.sessionId);assert.equal(packets.length,32);assert.ok((await h.query('source.list')).some(source=>source.stages?.length>0),'SQL retains the diagnostic stages outside the native conversational packet');assert.equal(new Set(packets.map(r=>r.payload.source.taskSession.leaseEpoch)).size,32);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)
 assert.equal(h.toolResults.filter(r=>r.name==='write').length,1);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,1);assert.equal(await readFile(join(saved.header.cwd,'work/one-effect.txt'),'utf8'),'exactly-once');assert.deepEqual(await h.query('execution.list'),[])
 // Pi alone owns history/context and optional compaction. This does not assert
 // the cancelled Owner/execution-read shadow formatter's byte/copy policy.
 assert.equal(saved.format,'pi-native-v1');assert.equal('events' in saved,false);assert.ok(h.auxiliaryRequests.some(request=>request.purpose==='compaction'),'the real public SDK must invoke its summary provider');assert.ok(saved.entries.some(entry=>entry.type==='compaction'&&entry.summary.includes(compactionSummary)),'Pi itself persists the native compaction entry');assert.ok(saved.entries.some(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.content.some(block=>block.type==='toolCall'&&block.name==='write')),'physical original journal evidence remains after compaction');assert.equal((await h.ctx.sessionPersistence.list()).filter(item=>item.header.agentPreset==='night-bot-task').length,1)
 t.diagnostic(JSON.stringify({leases:packets.length,businessCalls:modelCalls,officialSummaryCalls:h.auxiliaryRequests.filter(request=>request.purpose==='compaction').length,nativeCompactionEntries:saved.entries.filter(entry=>entry.type==='compaction').length}))
}))

test('official service group responsibility reaches the actual Pi system prompt and reply signatures survive formatting',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-group-scope-',false),responsibility='GROUP_REPLY_SCOPE_PROOF: reply with the configured group signature.';let currentSystem='',groupRequests=0,taskRequests=0,taskPrompt
 const signature='- configured group signature'
 const h=await f.host(request=>{const routed=topicTaskCalls(request,{signature:String.fromCharCode(10,10)+signature});if(routed){groupRequests++;if(request.tools.some(tool=>tool.name==='resident_router_settle'))assert.ok(currentSystem.includes(responsibility),'actual Router system prompt retains configured responsibility');return routed}taskRequests++;taskPrompt=currentSystem;return[singleResult('complete','Current objective verified')]},{agentConfig:{replySignature:signature},serviceFactory:async options=>{const profile=options.ctx.get('nativePiProvider').profiles().get('native-task-test'),stream=profile.baseProvider.streamSimple;profile.baseProvider.streamSimple=function(model,context,...args){currentSystem=getCurrentSystemPrompt(context.messages);return Reflect.apply(stream,this,[model,context,...args])};return openTaskSessionService(options)}})
 await t.beginBusiness();await h.residentStore.updateGroup({groupId:'native-group',responsibility});await h.service.ingest(message);await h.service.whenIdle()
 assert.ok(groupRequests>=2);assert.equal(taskRequests,1);assert.ok(taskPrompt?.includes(responsibility),'actual sole execution prompt inherits the configured group responsibility')
 assert.ok(h.sent.find(notification=>notification.kind==='router-reply').payload.text.endsWith(String.fromCharCode(10,10)+signature))
}))

test('official service reads and copies an existing authorized file byte-for-byte in one execution session',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-copy-'),contents='existing template, unchanged bytes\n';let source,step=0
 const h=await f.host(request=>{if(step++===0){const material=singleInput(request).materials.flatMap(value=>value.resources??[]).find(resource=>resource.complete&&resource.path);assert.ok(material,'existing bytes must first be imported as this task Host-owned material');return[call('read',{path:material.path})]};if(step===2){assert.ok(request.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content??[]).some(part=>part.type==='text'&&part.text.includes(contents)));return[call('write',{path:'work/delivered-template.txt',content:contents})]}if(step===3)return[call('read',{path:'work/delivered-template.txt'})];return[singleResult('complete','The located existing bytes were copied and read back',{artifacts:['work/delivered-template.txt']})]},{serviceFactory:options=>openTaskSessionService({...options,readResource:async(groupId,messageId,resource)=>{assert.equal(groupId,'native-group');assert.equal(resource.resourceId,'existing-template');return{text:await readFile(source,'utf8')}}})})
 source=join(h.ctx.runtimePaths.workspaces,'existing-template.txt');await writeFile(source,contents);await t.beginBusiness();await h.service.ingest({...message,messageId:'existing-copy',text:'测试助手，将明确附带的既有模板原样复制并读回，不修改其内容。',resourceRefs:[{type:'file',resourceId:'existing-template'}]});await h.service.whenIdle();const[created]=await h.query('task.list')
 const row=await h.query('task.get',{taskId:created.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(row.status,'completed');assert.equal(await readFile(source,'utf8'),contents);assert.equal(await readFile(join(saved.header.cwd,'work/delivered-template.txt'),'utf8'),contents)
 assert.equal(h.toolResults.filter(r=>r.name==='write').length,1);assert.equal(h.toolResults.filter(r=>r.name==='read'&&!r.result.isError).length,2);assert.equal(new Set(h.toolResults.filter(r=>['read','write'].includes(r.name)).map(r=>r.sessionId)).size,1);assert.deepEqual(await h.query('execution.list'),[])
 const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
}))

test('official service routes authenticated sources into one effect-fenced task and delivers exact completion readback once',{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const f=await officialCase(t,'single-service-source-delivery-');let step=0
 const h=await f.host(request=>{assert.ok(!request.tools.some(tool=>/^(group_|task_delegate|execution_submit|subagent)/.test(tool.name)));if(step++===0)return[call('write',{path:'outputs/forged.txt',content:'must not alter Host output'}),...['alpha','beta'].map(key=>call('write',{path:'work/'+key+'.txt',content:key+'-native-proof'}))];if(step===2)return['alpha','beta'].map(key=>call('read',{path:'work/'+key+'.txt'}));for(const key of ['alpha','beta'])assert.ok(request.messages.filter(m=>m.role==='toolResult').flatMap(m=>m.content??[]).some(part=>part.type==='text'&&part.text.includes(key+'-native-proof')));return[singleResult('complete','Both authorized local results were read back',{artifacts:['work/alpha.txt','work/beta.txt']})]},{config:{assistantActorId:'native-assistant'}})
 await t.beginBusiness();await assert.rejects(h.service.ingest({...message,messageId:'no-identity',senderOpenDingTalkId:undefined}),/TASK_SESSION_AUTHENTICATED_SOURCE_REQUIRED/)
 const accepted=await h.service.ingest({...message,messageId:'source-delivery'});await h.service.whenIdle();const[task]=await h.query('task.list'),source=await h.query('source.get',{sourceId:accepted.sourceId}),saved=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
 assert.equal(task.status,'completed',JSON.stringify(h.service.listAlerts()));assert.equal(task.ownerActorId,'native-user');assert.ok(task.sourceRefs.includes(source.sourceId));assert.equal(source.text,message.text);assert.equal(source.routed,true);assert.deepEqual(await h.query('execution.list'),[])
 assert.equal(h.toolResults.filter(r=>r.name==='write'&&!r.result.isError).length,2);const deniedWrites=h.toolResults.filter(r=>r.name==='write'&&r.result.isError);assert.equal(deniedWrites.length,1);assert.match(JSON.stringify(deniedWrites[0].result),/PERMISSION_PRIVATE_PATH_DENIED|FS_SANDBOX_DENIED/);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,2);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,2)
 for(const key of ['alpha','beta'])assert.equal(await readFile(join(saved.header.cwd,'work',key+'.txt'),'utf8'),key+'-native-proof');await assert.rejects(readFile(join(saved.header.cwd,'outputs/forged.txt')),{code:'ENOENT'})
 const events=(await h.query('task.events')).events;assert.equal(events.filter(event=>event.kind==='task.completed').length,1);const notices=await h.query('notification.list'),final=notices.find(n=>n.kind==='router-reply'&&n.payload.text===task.completion.summary&&n.state==='delivered');assert.ok(final,'completion explanation needs actual readback');assert.equal(final.payload.sourceId,source.sourceId);assert.ok(h.requests.some(request=>latestInput(request).events?.some(event=>event.taskEvent?.commandId===events.find(item=>item.kind==='task.completed').commandId)),'Router must observe the exact authoritative completion event');assert.ok(h.toolResults.some(row=>row.name==='resident_task_query'&&row.result.value?.task?.completion?.commandId===task.completion.commandId),'reply must read the actual current task completion');assert.equal(h.sent.length,2);assert.equal(h.readbacks.length,2)
 const counts={requests:h.requests.length,sent:h.sent.length};assert.equal((await h.service.ingest({...message,messageId:'source-delivery'})).sourceId,accepted.sourceId);await h.service.whenIdle();await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,counts.requests);assert.equal(h.sent.length,counts.sent);assert.equal((await h.query('task.list')).length,1);assert.equal(h.ctx.agents.get(task.sessionId),undefined)
}))

test('official service same-session readback freezes immutable Host output without claiming an independent agent review',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-freeze-');let step=0
 const h=await f.host(request=>step++===0?[call('write',{path:'work/candidate.txt',content:'candidate-proof:7'})]:step===2?[call('read',{path:'work/candidate.txt'})]:[singleResult('complete','Actual native readback verified the requested candidate',{artifacts:['work/candidate.txt'],deliveryFiles:[{path:'work/candidate.txt',caption:'Candidate bytes verified'}]})]);await t.beginBusiness()
 const created=await h.service.createTask({groupId:'native-group',requestId:'freeze-candidate',objective:'Produce the candidate and read back its actual bytes'});await h.service.whenIdle();const row=await h.query('task.get',{taskId:created.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(row.status,'completed');assert.equal(row.completion.result.artifactFiles.length,1);assert.deepEqual(await h.query('execution.list'),[])
 const {createTaskArtifactFiles}=await import('../packages/dingtalk-core/task-artifact-files.js'),files=createTaskArtifactFiles({root:join(saved.header.cwd,'outputs'),getTaskDirectories:taskId=>{assert.equal(taskId,created.taskId);return{outputs:join(saved.header.cwd,'outputs')}}}),artifact=row.completion.result.artifactFiles[0].artifact,resolved=await files.resolve(artifact)
 assert.equal(await readFile(resolved.path,'utf8'),'candidate-proof:7');await writeFile(join(saved.header.cwd,'work/candidate.txt'),'changed mutable working bytes');assert.equal(await readFile(resolved.path,'utf8'),'candidate-proof:7','Host freeze remains immutable after the producer working file changes');assert.equal(new Set(h.toolResults.filter(r=>['write','read','task_result'].includes(r.name)).map(r=>r.sessionId)).size,1)
 assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1);assert.equal((await h.query('task.events')).events.length,1)
}))

test('official service fulfils eleven independent outputs in one task session without a cancelled member team',{timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
 const f=await officialCase(t,'single-service-eleven-');let step=0
 const h=await f.host(request=>{assert.ok(!request.tools.some(tool=>['task_delegate','execution_submit'].includes(tool.name)));if(step++===0)return Array.from({length:11},(_,i)=>call('write',{path:'work/output-'+i+'.txt',content:'independent-output-'+i}));if(step===2)return Array.from({length:11},(_,i)=>call('read',{path:'work/output-'+i+'.txt'}));for(let i=0;i<11;i++)assert.ok(JSON.stringify(request.messages.filter(m=>m.role==='toolResult')).includes('independent-output-'+i));return[singleResult('complete','All eleven requested outputs were read back')]})
 await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'eleven',objective:'Produce and verify all eleven independent outputs without creating a team'});await h.service.whenIdle()
 const row=await h.query('task.get',{taskId:created.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(row.status,'completed');assert.equal(row.drained,true);assert.deepEqual(await h.query('execution.list'),[])
 for(let i=0;i<11;i++)assert.equal(await readFile(join(saved.header.cwd,'work/output-'+i+'.txt'),'utf8'),'independent-output-'+i)
 assert.equal(h.toolResults.filter(r=>r.name==='write'&&!r.result.isError).length,11);assert.equal(h.toolResults.filter(r=>r.name==='read'&&!r.result.isError).length,11);assert.deepEqual([...new Set(h.toolResults.filter(r=>['write','read','task_result'].includes(r.name)).map(r=>r.sessionId))],[row.sessionId]);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,11)
 const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
}))

test('official service cold continuation resumes the same titled workspace and reads its retained completed effect without replay',{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const f=await officialCase(t,'single-service-cold-cwd-');let first=true
 const h=await f.host(()=>first?(first=false,[call('write',{path:'work/retained.txt',content:'retained native bytes'})]):[singleResult('wait','Waiting for the exact next input')]);await t.beginBusiness()
 const created=await h.service.createTask({groupId:'native-group',requestId:'cold-original',title:'恢复目录核对',objective:'Retain the original task workspace'});await h.service.whenIdle();const original=await h.query('task.get',{taskId:created.taskId}),before=await h.ctx.sessionPersistence.readNative(original.sessionId,{requireComplete:true});await h.close()
 let read=false;const next=await f.host(()=>!read?(read=true,[call('read',{path:'work/retained.txt'})]):[singleResult('complete','The retained original bytes were read back')],{initialize:false});assert.equal(next.requests.length,0)
 await next.service.appendTaskContext({taskId:created.taskId,requestId:'cold-context',progressImpact:'preserve',context:'Read the retained original result without executing it again.'});await next.service.whenIdle()
 const row=await next.query('task.get',{taskId:created.taskId}),saved=await next.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(row.status,'completed');assert.equal(row.sessionId,original.sessionId);assert.equal(saved.header.cwd,before.header.cwd);assert.equal(await readFile(join(saved.header.cwd,'work/retained.txt'),'utf8'),'retained native bytes')
 assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1);assert.equal(next.toolResults.filter(r=>r.name==='write').length,0);assert.ok(next.toolResults.some(r=>r.name==='read'&&!r.result.isError));assert.deepEqual(await next.query('execution.list'),[])
 const workspace=next.ctx.get('workspaceRegistry').list().find(item=>item.path===saved.header.cwd);assert.equal(workspace.title,'恢复目录核对');assert.ok(workspace.sessionIds.includes(row.sessionId));assert.equal(next.ctx.get('workspaceRegistry').list().filter(item=>item.path===saved.header.cwd).length,1)
}))

test('official service reopens an unknown notification for readback without resending completed business work', { ...({ timeout: 15000 }), timeout: nativeLifecycleTimeout(15000) }, nativeLifecycle(15000, async (t) => {
  t.mock.timers.enable({apis:['Date'],now:Date.now()})
  const fixture = await officialCase(t, 'task-service-notification-')
  let sends = 0, canRead = false, readbacks = 0
  const notifications = {
    async send(notification) { sends++; return { messageId: notification.payload.text==='可用的已有证据已核验。' ? 'durable-delivery-id' : 'durable-confirmation-id' } },
    async readback(notification) {
      readbacks++
      const id = notification.payload.text==='可用的已有证据已核验。' ? 'durable-delivery-id' : 'durable-confirmation-id'
      assert.equal(notification.ack.messageId, id)
      return notification.payload.text!=='可用的已有证据已核验。' || canRead ? { messageId: id, verified: true } : null
    },
  }
  const first = await fixture.host(async request => {
    return topicTaskCalls(request) ?? [singleResult('complete', '可用的已有证据已核验。')]
  }, { notifications })
  await t.beginBusiness()

  try {
    await t.step(async () => first.service.ingest({ ...message, messageId: 'notification-request', text: '测试助手，核对已有记录并给出结论。' }))
    await t.step(async () => first.service.whenIdle())
    assert.equal((await t.step(async () => first.query('task.list')))[0].status, 'completed')
    const pending = (await t.step(async () => first.query('notification.list'))).find(notification => notification.payload.text==='可用的已有证据已核验。')
    assert.equal(pending.state, 'starting', 'Router 通知将 ACK 与送达回查分开记录')
    assert.equal(pending.ack.messageId, 'durable-delivery-id')
    assert.equal(pending.readbackAttemptCount, 1)
    assert.ok(Date.parse(pending.nextAttemptAt) > Date.now())
    assert.equal(sends, 2)
  } finally { await t.step(async () => first.close()) }
  const readsBeforeRecovery = readbacks
  canRead = true
  const second = await t.step(async () => fixture.host(() => { throw new Error('Completed task must not invoke the model during receipt recovery') }, { notifications, initialize: false }))
  assert.equal((await t.step(async () => second.query('notification.list'))).find(notification => notification.payload.text==='可用的已有证据已核验。').state, 'unknown')
  await t.step(async () => second.service.recover()); await t.step(async () => second.service.whenIdle())
  assert.equal(readbacks, readsBeforeRecovery, 'Restart must preserve the persisted observation cooldown')
  const retryAt = Math.max(...(await t.step(async () => second.query('notification.list'))).filter(notification => notification.state === 'unknown').map(notification => Date.parse(notification.nextAttemptAt)))
  t.mock.timers.setTime(retryAt+20)
  await t.step(async () => second.service.recover()); await t.step(async () => second.service.whenIdle())
  assert.ok((await t.step(async () => second.query('notification.list'))).every(notification => notification.state === 'delivered'))
  assert.equal((await t.step(async () => second.query('task.list'))).length, 1)
  assert.equal(sends, 2); assert.equal(readbacks, readsBeforeRecovery + 1)
  assert.equal(second.requests.length, 0)
}))

test('official service cancellation stops the actual owned process, drains its original session and fences late success',{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const f=await officialCase(t,'single-service-cancel-');let rounds=0
 const script='const f=require("node:fs");f.writeFileSync("work/process-started.txt",String(process.pid));setTimeout(()=>{f.writeFileSync("work/process-late.txt","late");process.stdout.write("LATE_SUCCESS")},30000)'
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
 const h=await f.host(()=>++rounds===1?[call(nativeShell,{command:nativeShell==='pwsh'?`& ${quote(process.execPath)} -e ${quote(script)}`:[process.execPath,'-e',script].map(quote).join(' '),description:'Run the cancellable local process',timeoutMs:60000})]:[singleResult('complete','Late result must never complete a cancelled task')])
 const processService=h.ctx.get('subprocess'),spawn=processService.spawn,ranges=[];processService.spawn=function(...args){const handle=Reflect.apply(spawn,this,args);if(JSON.stringify(args).includes('process-started.txt')){const range={handle,settled:false};ranges.push(range);Promise.resolve(handle.done).then(()=>range.settled=true,()=>range.settled=true)}return handle};t.after(()=>{processService.spawn=spawn})
 await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'cancel-actual',objective:'Run a cancellable local process'})
 const task=await waitUntil(async()=>{const row=await h.query('task.get',{taskId:created.taskId});if(!row.sessionId)return;try{const saved=await h.ctx.sessionPersistence.readNative(row.sessionId);return{row,cwd:saved.header.cwd,pid:Number(await readFile(join(saved.header.cwd,'work/process-started.txt'),'utf8'))}}catch(e){if(e.code!=='ENOENT'&&e.name!=='SessionPersistenceNotFoundError')throw e}},'actual process started')
 assert.ok(Number.isSafeInteger(task.pid)&&task.pid>0);const cancelled=await h.service.cancelTask({taskId:created.taskId,requestId:'cancel-once',reason:'Stop the original process'});await h.service.whenIdle()
 const row=await h.query('task.get',{taskId:created.taskId});assert.equal(cancelled.control,'cancelled');assert.equal(row.status,'cancelled');assert.equal(row.drained,true)
 assert.equal(h.ctx.agents.get(row.sessionId),undefined);assert.equal(h.ctx.piAuthority.describe(row.sessionId),undefined);await assert.rejects(readFile(join(task.cwd,'work/process-late.txt')),{code:'ENOENT'})
 assert.ok(ranges.length>0,'the actual application process provider must launch');assert.ok(ranges.every(range=>range.settled),'cancel must await actual owned direct settlement');for(const range of ranges)assert.equal(await range.handle.waitForExit(),true,'cancel must join the owned provider range; namespace PIDs are not Host PIDs');processService.spawn=spawn
 const saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.ok(saved.context.piMessages.some(m=>m.role==='assistant'&&m.content.some(b=>b.type==='toolCall'&&b.name===nativeShell)));assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,0)
 const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count);assert.equal((await h.query('task.events')).events.some(e=>e.kind==='task.completed'),false);assert.deepEqual(await h.query('execution.list'),[])
}))

test('official service requirement changes fence old provider results and resume the original session with exact new sources',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());const f=await officialCase(t,'single-service-requirement-');let old=true
 const inputs=[],h=await f.host(async request=>{const input=singleInput(request);inputs.push(structuredClone(input));if(old){old=false;entered.resolve();await release.promise;return[singleResult('complete','Stale completion must not commit')]}return[singleResult('wait','The revised objective needs explicit confirmation')]})
 try{
 await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'revise-original',objective:'Original exact objective',context:'ORIGINAL_REQUIREMENT: retain this exact original source'});await entered.promise
 const before=await h.query('task.get',{taskId:created.taskId}),changing=h.service.appendTaskContext({taskId:created.taskId,requestId:'revise-once',progressImpact:'replan',expectedRequirementRevision:1,expectedControlRevision:1,context:'NEW_REQUIREMENT: analyze only; do not treat the old result as completion.'})
 await waitUntil(async()=>(await h.query('task.get',{taskId:created.taskId})).requirementRevision===2,'new revision committed before old provider releases');release.resolve();await changing;await h.service.whenIdle()
 const after=await h.query('task.get',{taskId:created.taskId});assert.equal(after.sessionId,before.sessionId);assert.equal(after.requirementRevision,2);assert.equal(after.status,'active');assert.equal(after.drained,true);assert.equal(after.lastDecision.action,'wait');assert.equal(inputs.length,2)
 assert.ok(inputs[1].sources.some(source=>source.text.includes('NEW_REQUIREMENT: analyze only')));assert.ok(inputs[1].sources.every(source=>source.actorId==='native-user'));assert.equal(inputs[1].sources.length,2)
 const results=h.toolResults.filter(r=>r.name==='task_result');assert.equal(results.filter(r=>!r.result.isError).length,1,'only the new current binding may commit a result');assert.ok(results.filter(r=>r.result.isError).every(r=>JSON.stringify(r.result).includes('TASK_SESSION_STALE')),'a late old official response may be journaled only as a rejected stale result');const events=(await h.query('task.events')).events;assert.equal(events.some(event=>event.kind==='task.completed'),false);for(const kind of ['task.changed','task.waiting'])assert.ok(events.some(event=>event.kind===kind&&event.requirementRevision===2))
 const saved=await h.ctx.sessionPersistence.readNative(after.sessionId,{requireComplete:true});assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1);assert.deepEqual(saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').map(r=>r.payload.source.taskSession.requirementRevision),[1,2]);assert.deepEqual(await h.query('execution.list'),[])
 const count=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(h.requests.length,count)
 }finally{release.resolve()}
}))

for(const [maxConcurrentTasks,maxConcurrentExecutions]of [[1,1],[1,2],[2,1],[2,3]])test(`official service capacity promotes sole task sessions without child slots: tasks=${maxConcurrentTasks}, legacyExecutions=${maxConcurrentExecutions}`,{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const gate=Promise.withResolvers();t.after(()=>gate.resolve());const f=await officialCase(t,'single-service-capacity-');let entered=0,active=0,peak=0
 const h=await f.host(async request=>{const input=singleInput(request);assert.ok(!request.tools.some(tool=>['task_delegate','execution_submit'].includes(tool.name)));entered++;active++;peak=Math.max(peak,active);try{await gate.promise;return[singleResult('complete','Completed '+input.task.objective)]}finally{active--}},{config:{maxConcurrentTasks,maxConcurrentExecutions}})
 await t.beginBusiness();for(let i=0;i<4;i++)await h.service.createTask({requestId:'capacity-'+i,objective:'Independent capacity task '+i})
 try{await waitUntil(()=>entered===maxConcurrentTasks,'available task slots admitted');assert.equal((await h.query('task.list')).filter(row=>!row.drained).length,maxConcurrentTasks);assert.equal(peak,maxConcurrentTasks)}finally{gate.resolve()}
 await h.service.whenIdle();const rows=await h.query('task.list');assert.equal(entered,4);assert.ok(peak<=maxConcurrentTasks);assert.ok(rows.every(row=>row.status==='completed'&&row.drained));assert.equal(new Set(rows.map(row=>row.sessionId)).size,4);assert.deepEqual(await h.query('execution.list'),[])
 for(const row of rows){const saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)}
}))

// Retired with the cancelled task_delegate/execution architecture: named
// resource acquisition and its member-slot queue have no independent current
// Single product entry. This suite does not claim Single supports named-resource
// orchestration. Task admission capacity remains covered separately below.


test('official service task request identities reject changed replay bodies and keep one session for exact duplicate admission',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-request-id-'),h=await f.host(()=>[singleResult('wait','Waiting for the exact next instruction')]);await t.beginBusiness()
 const args={groupId:'native-group',requestId:'immutable-create',objective:'Original exact authorized objective'},first=await h.service.createTask(args);await h.service.whenIdle();const count=h.requests.length
 const duplicate=await h.service.createTask(args);await h.service.whenIdle();assert.equal(duplicate.taskId,first.taskId);assert.equal(duplicate.session.sessionId,first.session.sessionId);assert.equal(h.requests.length,count)
 await assert.rejects(h.service.createTask({...args,objective:'Changed objective using the same identity'}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})
 const row=await h.query('task.get',{taskId:first.taskId});assert.equal(row.objective,args.objective);assert.equal((await h.query('task.list')).length,1);assert.deepEqual(await h.query('execution.list'),[])
 const saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true});assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)
}))

test('official service idle sessions release task capacity and recovery does not create a model wake',{timeout:nativeLifecycleTimeout(15000)},nativeLifecycle(15000,async t=>{
 const f=await officialCase(t,'single-service-idle-');let rounds=0
 const h=await f.host(()=>{rounds++;return[singleResult('wait','Waiting for a specific new user input')]},{config:{maxConcurrentTasks:1}})
 await t.beginBusiness();for(const requestId of ['idle-a','idle-b']){await h.service.createTask({requestId,objective:'Wait for user material'});await h.service.whenIdle();await h.service.recover();await h.service.whenIdle()}
 assert.equal(rounds,2);const rows=await h.query('task.list');assert.equal(rows.length,2);assert.ok(rows.every(row=>row.sessionBound&&row.drained));assert.equal(new Set(rows.map(row=>row.sessionId)).size,2)
 assert.deepEqual(await h.query('execution.list'),[])
}))

for (const persistent of [false, true]) test(`official service session creation failure has bounded recovery retries: persistent=${persistent}`, { ...({ timeout: 10000 }), timeout: nativeLifecycleTimeout(10000) }, nativeLifecycle(10000, async (t) => {
  const fixture = await officialCase(t, 'task-service-retry-')
  const h = await fixture.host(async () => [singleResult('complete', 'native session recovered')], { config: { retryIntervalMs: 2000 } })
  await t.beginBusiness()

  const registry = h.ctx.agents, create = registry.create
  let attempts = 0
  h.ctx.agents.create = async function (options) {
    if (options.meta?.agentPreset==='night-bot-task' && (++attempts === 1 || persistent))
      throw Object.assign(new Error('NATIVE_SETUP_INJECTED_FAILURE'), { code: 'NATIVE_SETUP_INJECTED_FAILURE' })
    return create.call(this, options)
  }
  t.after(() => { registry.create = create })
  const task = await t.step(async () => h.service.createTask({ groupId: 'native-group', requestId: 'setup-failure', objective: 'test native setup failure' }))
  await t.step(async () => h.service.whenIdle())
  assert.equal(attempts, 1)
  const failure = (await t.step(async () => h.service.recover())).failures.find(value => value.id === task.taskId)
  assert.ok(failure.retryAfter - Date.parse(failure.at) >= 2000, 'Persisted failure must retain the full configured retry delay')
  for (let i = 0; i < 3; i++) { await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle()) }
  assert.equal(attempts, 1, 'Explicit recovery cannot busy-loop inside the retry window')
  await t.step(async () => new Promise(resolve => setTimeout(resolve, Math.max(0, failure.retryAfter - Date.now()) + 10)))
  await t.step(async () => h.service.recover()); await t.step(async () => h.service.whenIdle())
  assert.equal(attempts, 2)
  const stored = await t.step(async () => h.query('task.get', { taskId: task.taskId }))
  assert.equal(stored.drained, true)
  assert.equal(stored.status, persistent ? 'active' : 'completed')
  if (!persistent) assert.equal((await t.step(async () => h.service.recover())).failures.some(value => value.id === task.taskId), false)
}))

for(const persistent of [false,true])test(`official service model failure is held without a spin until explicit new context: persistent=${persistent}`,{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-model-failure-');let rounds=0
 const h=await f.host(()=>{rounds++;return[singleResult('complete','The same task recovered after explicit new context')]},{providerError:request=>request.tools.some(tool=>tool.name==='task_result')&&(rounds===1||persistent)?Error('CONTROLLED_MODEL_FAILURE'):undefined})
 await t.beginBusiness();const task=await h.service.createTask({groupId:'native-group',requestId:'failure',objective:'Handle an actual official provider error'})
 await h.service.whenIdle();for(let i=0;i<3;i++){await h.service.recover();await h.service.whenIdle()}
 assert.equal(rounds,1);const before=await h.query('task.get',{taskId:task.taskId});assert.equal(before.drained,true);assert.equal(before.status,'active');assert.equal(before.technicalFailure?.code,'TASK_PI_PROVIDER_ERROR','The official provider failure remains durable after recovery clears transient alerts');assert.equal(before.lastDecision?.technicalFailure?.code,'TASK_PI_PROVIDER_ERROR');assert.equal(before.providerRecovery??null,null,'No Host provider retry timer is installed')
 await h.service.appendTaskContext({taskId:task.taskId,requestId:'new-context',progressImpact:'replan',context:'Explicit new information permits retrying the same task.'});await h.service.whenIdle()
 const after=await h.query('task.get',{taskId:task.taskId});assert.equal(rounds,2);assert.equal(after.sessionId,before.sessionId);assert.equal(after.drained,true);assert.equal(after.status,persistent?'active':'completed')
 const snapshot=await h.ctx.sessionPersistence.readNative(after.sessionId,{requireComplete:true});assert.equal(snapshot.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1);assert.equal(snapshot.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,0)
}))

test('official service no-submission holds the exact completed effect until explicit Host wake and never adds a retry timer',{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const f=await officialCase(t,'single-service-eof-');let stage=0
 const h=await f.host(()=>stage++===0?[call('write',{path:'work/one-effect.txt',content:'once'})]:[]);await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'eof-original',objective:'Write exactly once and retain the result before any continuation'});await h.service.whenIdle()
 const held=await h.query('task.get',{taskId:created.taskId});assert.equal(held.drained,true);assert.equal(held.status,'active');assert.equal(held.providerRecovery??null,null,'a valid final stop without task_result is not a provider retry permission');assert.equal(held.lastDecision.action,'wait');assert.ok(held.lastDecision.limitations.includes('TASK_SESSION_NO_SUBMISSION'));const count=h.requests.length
 for(let i=0;i<3;i++){await h.service.recover();await h.service.whenIdle()}assert.equal(h.requests.length,count);await h.close()
 let resumed=0;const next=await f.host(request=>{assert.ok(request.messages.some(message=>message.role==='assistant'&&message.content?.some(part=>part.type==='toolCall'&&part.name==='write'&&part.arguments.path==='work/one-effect.txt')),'The original official write remains in the resumed Pi history');if(++resumed===1)return[call('read',{path:'work/one-effect.txt'})];assert.ok(request.messages.some(message=>message.role==='toolResult'&&message.toolName==='read'&&!message.isError&&message.content?.some(part=>part.type==='text'&&part.text.includes('once'))),'Completion must follow the actual successful official read');return[singleResult('complete','The original completed effect was read without replay')]},{initialize:false});await next.service.recover();await next.service.whenIdle();assert.equal(next.requests.length,0,'cold recovery does not manufacture an EOF retry')
 await next.service.store.command({id:'explicit-host-eof-wake',kind:'task.wake',args:{taskId:created.taskId,kind:'host.explicit-continuation',payload:{reason:'Trusted Host explicitly requested evidence inspection; no new user authority is claimed.'}}});await next.service.recover();await next.service.whenIdle()
 const completed=await next.query('task.get',{taskId:created.taskId}),saved=await next.ctx.sessionPersistence.readNative(completed.sessionId,{requireComplete:true});assert.equal(completed.status,'completed');assert.equal(completed.sessionId,held.sessionId);assert.equal(completed.requirementRevision,held.requirementRevision);assert.equal(completed.contextRevision,held.contextRevision);assert.equal(await readFile(join(saved.header.cwd,'work/one-effect.txt'),'utf8'),'once')
 assert.equal(next.toolResults.filter(r=>r.name==='write').length,0,'Evidence inspection must not request another write');assert.ok(saved.entries.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='read'&&!entry.message.isError&&entry.message.content.some(part=>part.type==='text'&&part.text.includes('once'))),'Native journal retains the successful read evidence');assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,1);assert.equal((await next.query('task.events')).events.filter(e=>e.kind==='task.completed').length,1);assert.deepEqual(await next.query('execution.list'),[])
}))

for(const correctOnce of [false,true])test(`official service invalid summaries cannot complete and provider correction remains native: correctOnce=${correctOnce}`,{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-invalid-summary-');let rounds=0
 const h=await f.host(()=>{rounds++;assert.ok(rounds<=4,'Invalid task results must not spin');return rounds>1&&!correctOnce?[]:[singleResult('complete',correctOnce&&rounds>1?'Corrected summary':'  ')]})
 await t.beginBusiness();const task=await h.service.createTask({requestId:'summary',objective:'Return only an evidence-backed task result'});await h.service.whenIdle()
 const row=await h.query('task.get',{taskId:task.taskId});assert.equal(rounds,2);assert.equal(row.drained,true);assert.equal(row.status,correctOnce?'completed':'active')
 const results=h.toolResults.filter(r=>r.name==='task_result');assert.equal(results.filter(r=>r.result.isError).length,1);assert.match(JSON.stringify(results[0].result),/TASK_SESSION_DECISION_INVALID/)
 const events=(await h.query('task.events')).events;assert.equal(events.length,correctOnce?1:0)
 if(correctOnce){const receipt=await h.query('receipt.get',{id:events[0].taskDecisionReceiptId});assert.deepEqual(receipt.completionEvent,events[0])}
 await h.service.recover();await h.service.whenIdle();assert.equal(rounds,2);assert.equal(h.ctx.agents.get(row.sessionId),undefined)
}))

test('official first tier rejects incomplete source coverage and accepts correction in the same real Pi session',{timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
 const f=await officialCase(t,'triage-correction-',false);let requests=0
 const h=await f.host(request=>{
  if(request.tools.some(tool=>tool.name==='channel_triage_submit')&&++requests===1)return[call('channel_triage_submit',{dispositions:[]})]
  return topicTaskCalls(request)??[singleResult('complete','完整处置原来源后完成任务')]
 })
 await t.beginBusiness();const input=await h.service.ingest({...message,messageId:'invalid-source-coverage'});await h.service.whenIdle()
 assert.equal(requests,2);assert.equal((await h.query('source.get',{sourceId:input.sourceId})).routed,true)
 const tasks=await h.query('task.list');assert.equal(tasks.length,1);assert.equal(tasks[0].status,'completed');assert.deepEqual(h.residentStore.listTopics(message.groupId),[])
 const results=h.toolResults.filter(row=>row.name==='channel_triage_submit');assert.equal(results.length,1);assert.equal(results[0].result.isError,false)
 const saved=await h.ctx.sessionPersistence.readNative(results[0].sessionId,{requireComplete:true})
 assert.equal(saved.entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').flatMap(entry=>entry.message.content).filter(block=>block.type==='toolCall'&&block.name==='channel_triage_submit').length,2);assert.ok(saved.entries.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.isError),'Pi schema validation failure stays in the same actual session before the valid tool executes')
}))

test('official service application boots and disposes with declared channel-neutral dependencies only',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-app-'),h=await f.host(()=>assert.fail('Startup cannot invoke a model'),{resident:true});await t.beginBusiness()
 for(const name of application.inject)assert.ok(h.ctx.get(name),'Declared dependency available: '+name)
 for(const name of ['subagents','goal','workflow','execution'])assert.equal(h.ctx.get(name),undefined,'Cancelled architecture is not an application dependency')
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 const config={model:{provider:'native-task-test',model:'controlled'},resident:{host:'127.0.0.1',port,taskSessions:{instanceId:'app-native',ownerActorId:'native-user',webActorId:'native-user',ingressEpoch:new Date().toISOString(),initialize:true,recoveryIntervalMs:60000}}}
 await application.apply(h.ctx,config);const app=h.ctx.get('application'),read=path=>new Promise((resolve,reject)=>httpGet(`http://127.0.0.1:${port}${path}`,{agent:false},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(body)}))}).on('error',reject))
 assert.equal((await read('/health')).body.status,'ok');assert.equal((await read('/state/agent-config')).body.workspaceDir,h.ctx.runtimePaths.workspaces);assert.equal(h.ctx.get('dingtalkChannel'),undefined);assert.equal(h.requests.length,0)
 await app.close();await assert.rejects(read('/health'),{code:'ECONNREFUSED'})
}))

test('official service listener startup failure releases resources so the same task database can reopen',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-app-failure-'),occupied=createServer();t.after(()=>occupied.listening?new Promise(resolve=>occupied.close(resolve)):undefined);await t.beginBusiness()
 await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));const port=occupied.address().port,config={model:{provider:'native-task-test',model:'controlled'},resident:{host:'127.0.0.1',port,taskSessions:{instanceId:'startup-failure',ownerActorId:'native-user',webActorId:'native-user',ingressEpoch:new Date().toISOString(),initialize:true}}}
 const failed=await f.host(()=>assert.fail('Startup failure cannot invoke a model'),{resident:true});await assert.rejects(application.apply(failed.ctx,config),{code:'EADDRINUSE'});await failed.close();await new Promise(resolve=>occupied.close(resolve))
 const next=await f.host(()=>assert.fail('Reopening cannot invoke a model'),{resident:true});await application.apply(next.ctx,{...config,resident:{...config.resident,taskSessions:{...config.resident.taskSessions,initialize:false}}})
 const health=await new Promise((resolve,reject)=>httpGet(`http://127.0.0.1:${port}/health`,{agent:false},response=>{let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(raw)}))}).on('error',reject));assert.equal(health.status,200);assert.equal(health.body.status,'ok');assert.equal(next.requests.length,0)
}))


test('official service board reports the one live execution session as running until its actual body drains',{timeout:nativeLifecycleTimeout(15000)},nativeLifecycle(15000,async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());const f=await officialCase(t,'single-service-board-')
 const h=await f.host(async()=>{entered.resolve();await release.promise;return[singleResult('wait','Actual execution released')]})
 try{
 await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'board-live',objective:'Wait for the actual local model'});await entered.promise
 const active=await h.query('task.get',{taskId:created.taskId});assert.equal(active.drained,false);assert.ok(h.ctx.agents.get(active.sessionId));assert.deepEqual(await h.query('execution.list'),[])
 const board=await h.service.boardTasks();assert.ok(JSON.stringify(board).includes(created.taskId));assert.ok(JSON.stringify(board).includes('running'))
 release.resolve();await h.service.whenIdle();const drained=await h.query('task.get',{taskId:created.taskId});assert.equal(drained.drained,true);assert.equal(h.ctx.agents.get(drained.sessionId),undefined)
 }finally{release.resolve()}
}))

test('official service unknown post-write effects remain held and release only the physically drained writer',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const f=await officialCase(t,'single-service-unknown-');let writes=0
 const h=await f.host(()=>[call('uncertain_native_write',{})])
 h.ctx.tools.register({name:'uncertain_native_write',description:'Local write then response loss',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){writes++;await writeFile(join(exec.agent.metadata.cwd,'work','uncertain.txt'),'once');throw Error('response lost after write')}})
 await t.beginBusiness();const task=await h.service.createTask({requestId:'unknown',objective:'Perform the one authorized local write'})
 await h.service.whenIdle();const row=await h.query('task.get',{taskId:task.taskId}),saved=await h.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true})
 assert.equal(writes,1);assert.equal(await readFile(join(saved.header.cwd,'work/uncertain.txt'),'utf8'),'once');assert.equal(row.status,'active');assert.equal(row.drained,true);assert.equal(row.lastDecision.action,'blocked')
 assert.match(JSON.stringify(row.lastDecision),/TASK_EFFECT_UNCERTAIN_NO_REPLAY/);assert.equal(h.ctx.agents.get(row.sessionId),undefined);assert.equal(h.ctx.piAuthority.describe(row.sessionId),undefined)
 assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,1);assert.equal(saved.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,0)
 const requests=h.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(writes,1);assert.equal(h.requests.length,requests);assert.equal((await h.query('task.events')).events.length,0);assert.deepEqual(await h.query('execution.list'),[])
}))


test('official service recovery no-op preserves an undrained task writer conflict alert', { ...({ timeout: 10000 }), timeout: nativeLifecycleTimeout(10000) }, nativeLifecycle(10000, async (t) => {
  const fixture = await officialCase(t, 'task-live-conflict-alert-')
  const h = await fixture.host(async () => [singleResult('complete', '不应执行')], { config: { retryIntervalMs: 100 } })
  await t.beginBusiness()

  const registry = h.ctx.agents, create = registry.create
  h.ctx.agents.create = async function (options) {
    if (options.meta?.agentPreset==='night-bot-task') throw Object.assign(new Error('TASK_SESSION_ALREADY_LIVE'), { code: 'TASK_SESSION_ALREADY_LIVE', taskSessionDrained: false })
    return create.call(this, options)
  }
  t.after(() => { registry.create = create })
  const task = await t.step(async () => h.service.createTask({ groupId: 'native-group', requestId: 'live-conflict', objective: '保留原写者冲突诊断' }))
  await t.step(async () => h.service.whenIdle())
  assert.equal((await t.step(async () => h.query('task.get', { taskId: task.taskId }))).drained, false)
  const original = (await t.step(async () => h.service.recover())).failures.find(item => item.id === task.taskId)
  assert.equal(original.code, 'TASK_SESSION_ALREADY_LIVE')
  await t.step(async () => new Promise(resolve => setTimeout(resolve, 150)))
  const recovered = await t.step(async () => h.service.recover())
  assert.equal(recovered.failures.find(item => item.id === task.taskId)?.code, original.code)
  assert.equal((await t.step(async () => h.query('task.get', { taskId: task.taskId }))).drained, false)
}))

test('official service Host material publication failure after a committed claim drains it and exposes an alert before model dispatch',{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 let backing;const f=await officialCase(t,'single-service-material-failure-',true,async()=>backing?.close());backing=await openDynamicTaskStore({dbPath:join(f.root,'dynamic.db'),instanceId:'native-test',initialize:true});let poisoned=false,claimed
 const store={...backing,async command(command){const receipt=await backing.command(command);if(command.kind==='task.claim'&&!poisoned){claimed=receipt.result.task;assert.equal(claimed.drained,false);assert.ok(claimed.sourceRefs.length);const source=claimed.sourceRefs[0],digest=createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0,32),directory=join(f.root,'data/workspaces/tasks',claimed.taskId,'materials');await mkdir(directory,{recursive:true});await mkdir(join(directory,'source-'+digest+'.json'));poisoned=true}return receipt}}
 const h=await f.host(()=>assert.fail('A malformed Host material cannot enter the model'),{store});await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'material-failure',objective:'Read the exact authoritative material',context:'HOST_MATERIAL_AUTHORITY'})
 await h.service.whenIdle();const row=await h.query('task.get',{taskId:created.taskId});assert.equal(poisoned,true);assert.equal(row.leaseEpoch,claimed.leaseEpoch);assert.equal(row.drained,true);assert.equal(row.sessionBound,false);assert.equal(row.status,'active');assert.equal(h.requests.length,0);assert.deepEqual(await h.query('execution.list'),[])
 assert.ok(h.service.listAlerts().some(alert=>alert.detail==='TASK_MATERIAL_PATH_INVALID'),JSON.stringify(h.service.listAlerts()));assert.equal(h.ctx.agents.get(row.sessionId),undefined);assert.equal(h.ctx.piAuthority.describe(row.sessionId),undefined)
}))

testRunner('resource read retries preserve image facts and duplicate ingress reuses the source', { ...({ skip: !available ? reason : false, timeout: 20000 }), timeout: nativeLifecycleTimeout(30000) }, nativeLifecycle(30000, async (t) => {
  await t.beginBusiness()
  const { openResidentStore } = await t.step(async () => import('../packages/dingtalk-core/store.js'))
  const { openTaskSessionService } = await t.step(async () => import('../packages/dingtalk-core/task-session-service.js'))
  const root = await t.step(async () => mkdtemp(join(tmpdir(), 'native-ingress-phases-')))
  let h, reads = 0
  t.after(async () => { await h?.close(); await rm(root, { recursive: true, force: true }) })
  h = await t.step(async () => nativeRuntimeHost(root, request => {
    const input = latestInput(request)
    return request.tools.some(tool=>tool.name==='channel_triage_submit')?[call('channel_triage_submit',{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:false,reason:'隔离入站时钟验证，无业务执行'}))})]:[]
  }, { resident: true }))
  h.residentStore = await t.step(async () => openResidentStore(h.ctx.storageDomain))
  await t.step(async () => h.residentStore.subscribe({ groupId: 'phase-group', name: '隔离计时群' }))
  h.service = await t.step(async () => openTaskSessionService({ ctx: h.ctx, residentStore: h.residentStore,
    legacy: { getGroup: id => h.residentStore.getGroup(id), getAgentConfig: () => ({ workspaceDir: h.ctx.runtimePaths.workspaces, provider: 'native-task-test', model: 'controlled', agentPreset: 'night-bot', agentNames: ['测试助手'] }) },
    config: { workspaceDir: h.ctx.runtimePaths.workspaces, dbPath: join(root, 'dynamic.db'), instanceId: 'native-ingress', initialize: true, ownerActorId: 'native-user', webActorId: 'native-user', provider: 'native-task-test' },
    readResource: async () => {
      if (++reads === 1) throw Object.assign(new Error('offline'), { code: 'OFFLINE' })
      return { image: { mediaType: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQy7vzHwAEfgJodQLI1QAAAABJRU5ErkJggg==', 'base64') } }
    }, notifications: { send: () => assert.fail('不得发送消息'), readback: () => assert.fail('不得读取渠道回执') } }))
  const message = { groupId: 'phase-group', messageId: 'image-message', occurredAt: '2026-10-27T05:30:27.636Z', senderOpenDingTalkId: 'native-user', text: '图片入站计时', resourceRefs: [{ type: 'mediaId', resourceId: 'private-media' }] }
  t.onCancel(async()=>t.diagnostic(JSON.stringify({mediaFinal:{requests:h.requests.length,results:h.toolResults.slice(-4),alerts:h.service.listAlerts(),sources:(await h.service.store.query({kind:'source.list'})).map(source=>({sourceId:source.sourceId,version:source.version,routed:source.routed})),pending:await h.service.store.query({kind:'triage.pending',conversationId:'phase-group'})}})))
  const first = await t.step(async () => h.service.ingest(message))
  const failed = await t.step(async () => h.service.store.query({ kind: 'source.get', sourceId: first.sourceId }))
  const retry = await t.step(async () => h.service.ingest(message))
  await t.step(async () => h.service.whenIdle()) // Settle legitimate queue/router spans before checking duplicate-ingress stability.
  const success = await t.step(async () => h.service.store.query({ kind: 'source.get', sourceId: retry.sourceId }))
  assert.notEqual(retry.sourceId, first.sourceId)
  assert.equal(h.residentStore.getGroup('phase-group').messages[0].imageRefs.length, 1)
  assert.equal(JSON.stringify(success.stages).includes('private-media'), false)
  const repeated = await t.step(async () => h.service.ingest({ ...message, imageRefs: h.residentStore.getGroup('phase-group').messages[0].imageRefs }))
  assert.equal(repeated.sourceId, retry.sourceId)
  assert.equal(h.residentStore.getGroup('phase-group').messages.filter(item => item.messageId === message.messageId).length, 1)
  assert.equal(reads, 2)
}))


testRunner('周期恢复与调度跨过百条已排空历史，不展开执行正文也不启动模型', { skip: !available ? reason : false, timeout: nativeLifecycleTimeout(20000) }, nativeLifecycle(20000, async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-background-scan-'))
  let host, modelCalls = 0, forbiddenReads = 0
  t.after(async () => { await host?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  host = await t.step(async () => nativeRuntimeHost(root, () => { modelCalls++; throw new Error('history must not start a model') }))
  const db = new DatabaseSync(join(root, 'dynamic.db'))
  const marker = 'TERMINAL_EXECUTION_BODY_MUST_NOT_REACH_BACKGROUND_JS'
  try {
    const insert = db.prepare('INSERT INTO dynamic_executions(id,body) VALUES (?,?)')
    for (let i = 0; i < 103; i++) {
      const execution = { id: `history-${i}`, executionId: `history-${i}`, taskId: 'historical-task', status: i % 2 ? 'succeeded' : 'stale',
        drained: true, sessionBound: false, definition: { executionBackend: i % 2 ? 'claude-code' : 'dsh' }, input: { objective: marker } }
      insert.run(execution.id, JSON.stringify(execution))
    }
  } finally { db.close() }
  const parse = JSON.parse
  t.mock.method(JSON, 'parse', function (text, ...args) {
    if (String(text).includes(marker)) { forbiddenReads++; throw new Error('terminal history body expanded') }
    return parse(text, ...args)
  })
  try {
    const result = await t.step(async () => host.service.recover())
    await t.step(async () => host.service.whenIdle())
    assert.equal(forbiddenReads, 0, '包括调度异常被记录的情况，不允许静默吞掉历史展开')
    assert.equal(modelCalls, 0)
    assert.deepEqual(result.failures, [])
  } finally { t.mock.restoreAll() }
}))


testRunner('群身份与入站校验不展开展示消息，展示层仍实时过滤通知', { skip: !available ? reason : false, timeout: nativeLifecycleTimeout(20000) }, nativeLifecycle(20000, async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-group-identity-'))
  let host, facade, visits = 0, models = 0
  const history = Array.from({ length: 1000 }, (_, i) => ({ messageId: `history-${i}`, text: 'synthetic history' }))
  t.after(async () => { await host?.close(); await rm(root, { recursive: true, force: true }) })
  await t.beginBusiness()
  host = await t.step(async () => nativeRuntimeHost(root, () => { models++; throw Error('identity check must not start a model') }, {
    serviceFactory: async options => {
      facade = await openTaskResidentRuntime(options.ctx, { ...options.residentStore,
        getGroup: id => { const group = options.residentStore.getGroup(id); return group && { ...group, messages: history } },
      }, options.ctx.runtimePaths.workspaces)
      facade.getAgentConfig = options.legacy.getAgentConfig
      facade.isOwnNotification = message => { visits++; return message.messageId === 'history-0' }
      return openTaskSessionService({ ...options, legacy: facade })
    },
  }))
  assert.equal(facade.getGroup('native-group').messages.length, 999)
  assert.equal(visits, 1000, '夹具确实走真实展示过滤器')
  visits = 0
  for (let i = 0; i < 100; i++) assert.equal(host.service.isGroup('native-group'), true)
  assert.equal(host.service.isGroup('absent'), false)
  await assert.rejects(host.service.ingest({ groupId: 'native-group', messageId: 'unauthenticated' }), /TASK_SESSION_AUTHENTICATED_SOURCE_REQUIRED/)
  await assert.rejects(host.service.ingest({ groupId: 'absent', messageId: 'outside', senderOpenDingTalkId: 'native-user' }), /group_not_subscribed/)
  assert.equal(visits, 0, '身份校验不得为每次入站重新过滤整个历史')
  facade.isOwnNotification = message => { visits++; return message.messageId === 'history-1' }
  const visible = facade.getGroup('native-group').messages
  assert.equal(visible.length, 999)
  assert.equal(visible.some(message => message.messageId === 'history-0'), true)
  assert.equal(visible.some(message => message.messageId === 'history-1'), false, '通知身份变化不缓存旧展示')
  await host.residentStore.removeGroup({ groupId: 'native-group' })
  assert.equal(host.service.isGroup('native-group'), false, '群删除后身份即时失效')
  assert.equal(models, 0)
}))

// Actual installed single-session Host. Legacy cases below remain explicitly
// pending migration; this helper never synthesizes Owner/member protocols.
async function officialCase(t,prefix,autoTopics=true,closeOwned=async()=>{}){
 const root=await mkdtemp(join(tmpdir(),prefix)),hosts=[]
 t.after(async()=>{for(const h of hosts.toReversed())await h.close();await closeOwned();await rm(root,{recursive:true,force:true})})
 return {root,async host(decide,options={}){const h=await nativeRuntimeHost(root,(request,host)=>autoTopics?(topicTaskCalls(request)??decide(request,host)):decide(request,host),options);hosts.push(h);return h}}
}
const singleResult=(action,summary,extra={})=>({name:'task_result',args:{decision:{action,summary,evidence:['actual native journal and local result'],limitations:[],...extra}}})
const singleInput=request=>latestInput(request)

// DWS status identity is an explicitly installed optional channel component,
// never an implicit dependency of the channel-neutral Host fixture.
async function explicitDwsService(options){
 const stop=options.ctx.get('channels').registerOperationObserver('explicit-dws-fixture',{commands:nativeDwsCommands,observation:nativeDwsObservation,createObserver:createNativeDwsObserver})
 options.ctx.effect(()=>stop,'optional DWS observer fixture ownership')
 return openTaskSessionService(options)
}

test('service close drains the real task, observers and owned SQLite after an early subscription cleanup fails',{timeout:nativeLifecycleTimeout(25000)},nativeLifecycle(25000,async t=>{
 const root=await mkdtemp(join(tmpdir(),'service-close-failure-')),gate=Promise.withResolvers(),entered=Promise.withResolvers(),trace=[]
 let h,detached=false,pageClosed=false
 const fault=Object.assign(new Error('fixture reflection detach failure'),{code:'FIXTURE_REFLECTION_DETACH'})
 const leaves=error=>error?.errors?error.errors.flatMap(leaves):[error]
 t.onCancel(()=>gate.resolve())
 t.after(async()=>{gate.resolve();try{await h?.close()}finally{await rm(root,{recursive:true,force:true})}})
 h=await nativeRuntimeHost(root,async()=>{entered.resolve();await gate.promise;return[singleResult('wait','Actual closing task released without another business effect')]},{serviceFactory:async options=>{
  const reflection=options.ctx.get('reflection');assert.ok(reflection?.attachStore)
  const attach=reflection.attachStore
  reflection.attachStore=function(...args){const stop=Reflect.apply(attach,this,args);return()=>{stop?.();detached=true;gate.resolve();throw fault}}
  try{return await openTaskSessionService({...options,closeObserver:event=>trace.push(event)})}finally{reflection.attachStore=attach}
 }})
 const closeHost=h.close;let fixtureClosing
 h.close=()=>fixtureClosing??=closeHost().catch(error=>{const errors=leaves(error);assert.ok(errors.length>0&&errors.every(value=>value===fault),String(error))})
 const closePage=h.service.observerGroupPage.close.bind(h.service.observerGroupPage)
 h.service.observerGroupPage.close=async()=>{await closePage();pageClosed=true}
 await t.beginBusiness();const created=await h.service.createTask({groupId:'native-group',requestId:'close-drain',objective:'Retain one real in-flight task during cleanup failure'})
 await entered.promise
 await assert.rejects(h.service.close(),error=>error instanceof AggregateError&&leaves(error).some(value=>value===fault))
 assert.equal(detached,true);assert.equal(pageClosed,true);assert.equal(h.ctx.agents.get(created.sessionId),undefined)
 for(const stage of ['service.topic.close','service.owner.close','service.inflight-settled','service.observation-tail','service.observer-page.close','service.store.close'])assert.ok(trace.some(event=>event.stage===stage&&event.closeEvent==='settled'),stage)
 const final=trace.findLast(event=>event.stage==='service.store.close'&&event.closeEvent==='settled')
 assert.equal(final.counts.tasks,0);assert.equal(final.counts.notifications,0);assert.equal(final.counts.observationPending,0)
 await assert.rejects(h.service.store.query({kind:'task.list'}),/closed|not open|DYNAMIC_STORE_CLOSED/i)
}))
