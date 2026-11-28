import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,eventually,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {memoryHost} from './fixtures/memory-host.js'
import {apply as applyApplication,inject} from '../src/application.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const action of ['complete','detailed','scoped-recovery','end-to-end-recovery','unconfirmed-dependency','blocked','wait','natural-stop','policy-refusal','silent'])test('execution final-only Router delivery: '+action,{timeout:nativeTestTimeout(30000)},async t=>{
 let h,planned=false,replied=false,source,executions=0
 const technical=action==='policy-refusal',privateError='400 litellm.ContentPolicyViolationError: fixture-private-provider-detail'
 const terminal=new Set(),inspections=new Set(),reports=['complete','detailed','scoped-recovery','end-to-end-recovery','unconfirmed-dependency','blocked'].includes(action)||technical
 const multi=action==='blocked',detailed=action==='detailed',investigation=['complete','detailed'].includes(action)
 const clusterOnly=action==='scoped-recovery',endToEnd=action==='end-to-end-recovery',recovery=clusterOnly||endToEnd
 const unconfirmed=action==='unconfirmed-dependency'
 const request=unconfirmed?'UAT 的 db/mongodb-example 还有业务依赖吗？谁维护？先不要缩容。':recovery?(clusterOnly?'UAT6 集群内服务恢复了吗？':'UAT6 外部网关和 Monte Carlo 端到端恢复了吗？'):multi?'这份清单里的 6 份材料都齐了吗？为什么收件方还没确认？请不要改外部系统或发附件。':investigation?'这批任务是怎么中断的？'+(detailed?'把统计范围及两条样本的时间和依据列出来。':''):'请核对这份材料。不要改外部系统或发附件。'
 const summary=unconfirmed?'查过可见的应用配置和连接日志，业务依赖和维护人仍未确认。':recovery?'UAT6 集群内服务已恢复。':multi?'清单上的 6 份材料都已核对。':investigation?'发出中断提示的 9 次，都是最后一次模型请求超时。':'Verified synthetic outcome'
 const evidence=unconfirmed?['检查过就绪节点的日志，短时间内新增连接均来自本机。','可见的应用配置没有直接引用。']:recovery?['集群内就绪和服务端点返回 200。','较早构建和推送成功，但当时要求 v1 的就绪探针收到了 v2 的响应。']:multi?['逐项回读清单，6 份材料均存在。']:investigation?['13:37 和 15:19 的最后一条模型请求日志都记录超时，未返回输出。','这批总共 27 次模型超时，其中 9 次发出中断提示。','已逐项排除排队、工具和投递。']:['Synthetic material checked']
 const limitations=unconfirmed?['既有连接无法归类。','监控无样本，不代表零连接。','维护人未确认。']:recovery?['本次只确认了集群内服务恢复，外部网关和 Monte Carlo 端到端业务未在本次复测中验证。']:multi?['没有收件方的确认记录，尚不能确定未确认的原因。','TASK_EFFECT_UNCERTAIN_NO_REPLAY']:investigation?['缺网关日志，无法定位超时发生在哪一段。','本次只读，未改代码、重启或重跑。']:[]
 const replyText=unconfirmed?'我去查了 UAT 的 `db/mongodb-example`，还不能确认没有业务依赖，维护人也没确认。':clusterOnly?'UAT6 集群内服务已恢复。':endToEnd?'UAT6 集群内已恢复；外部网关和 Monte Carlo 端到端还没确认。下一步从外部入口跑一遍 Monte Carlo。':technical?'模型服务拒绝了这轮请求，核验尚未完成。':multi?'1. 6 份材料都齐了。\n2. 收件方没留确认记录，原因还不清楚。':investigation?(detailed?summary+evidence.slice(0,2).join(''):'这些任务都中断在最后一次模型请求超时。')+'下一步对照网关日志查超时发生在哪一段。':'这份测试材料已核对。'
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(tools.includes('task_result')){
   executions++
   const resultTool=body.tools.find(tool=>tool.function.name==='task_result').function
   if(investigation||recovery||unconfirmed){
    assert.match(resultTool.description,/an internal result, not a human-facing reply/u)
    assert.match(resultTool.description,/Use action=complete when the requested outcome is achieved.*action=blocked/u)
    assert.match(JSON.stringify(body.messages.filter(row=>['system','developer'].includes(row.role))),/an internal result, not a human-facing reply/u)
    const prompt=JSON.stringify(body.messages.filter(row=>['system','developer'].includes(row.role)))
    assert.doesNotMatch(prompt,/默认 ELI5|禁止防御性内容|禁用词句包括/u)
    assert.match(prompt,/交给 Router 的内部 task_result 不适用/u)
    assert.ok(tools.includes('communication_guidance_read'))
   }
   const schema=resultTool.parameters.properties.decision.properties
   assert.equal(schema.question,undefined);assert.equal(schema.audience,undefined)
   if(action==='natural-stop')return {text:'Normal stop with no structured result'}
   if(action==='policy-refusal')return {error:privateError}
   return {tool:'task_result',args:{decision:{action:action==='silent'?'blocked':detailed||recovery||unconfirmed?'complete':action,summary,evidence,limitations}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  source??=input.events.find(event=>event.source)?.source
  if(!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'final-only-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'final-only-task',title:'Synthetic bounded check',objective:'Check provided synthetic material',requirements:['No external changes'],handoff:'Read the test material without making external changes. Do not send an attachment.'}],dependencies:[]}}}
  for(const event of input.events)if(['task.completed','task.blocked','task.waiting'].includes(event.kind))terminal.add(event.id)
  for(const event of input.events)if(event.kind==='task.inspection')inspections.add(event.id)
  const outcome=input.events.find(event=>['task.completed','task.blocked'].includes(event.kind)||technical&&event.kind==='task.inspection')
  if(outcome&&reports&&!replied){
   replied=true
   if(technical){
    assert.equal(outcome.taskEvent.reason,'execution-failed')
    assert.equal(outcome.taskEvent.brief,undefined)
    assert.equal(typeof outcome.taskEvent.sessionId,'string')
    assert.ok(!JSON.stringify(body).includes(privateError))
   }else assert.equal(outcome.taskEvent.result.summary,summary)
   const prompt=body.messages.filter(message=>['system','developer'].includes(message.role)).map(message=>message.content).join('\n')
   assert.match(prompt,/默认 ELI5：先直接回答对方问的事/u)
   assert.match(prompt,/模型末尾写出结果不算发给用户/u)
   assert.match(prompt,/不用为了省字生造的词或生硬的缩写/u)
   assert.match(prompt,/未明确要求明细，只写结论和下一步/u)
   assert.match(prompt,/禁止防御性内容，不只是避开某些词/u)
   assert.doesNotMatch(prompt,/复杂问题把关键依据说透|有帮助的依据不要省/u)
   if(investigation||recovery||unconfirmed){
    assert.match(prompt,/内部结果不走对外回复规则/u)
    const text=body.tools.find(tool=>tool.function.name==='resident_router_reply').function.parameters.properties.text
    assert.match(text.description,/否则只留会改变结论或下一步的关键事实，不复述对方已给的依据、不列排查清单/u)
    assert.match(text.description,/不用为了省字生造的词或生硬的缩写/u)
    assert.match(text.description,/把已核实的范围直接写在结论里/u)
    assert.match(text.description,/未做的检查仅在被问到或会影响判断时说明/u)
    assert.match(prompt,/不要照搬内部摘要或 limitations 字段/u)
    assert.match(prompt,/不在末段罗列未测项/u)
    if(unconfirmed){
     assert.ok(prompt.includes(replyText),'the real Router receives the short answer example')
     assert.match(text.description,/确认不了就直接说哪一项没确认，答完就停/u)
     assert.match(text.description,/不为自证或免责加尾巴/u)
    }
    assert.ok(requestText(body).some(text=>text.includes(request)))
    assert.deepEqual(outcome.taskEvent.result.evidence,evidence)
    assert.deepEqual(outcome.taskEvent.result.limitations,limitations)
   }
   assert.doesNotMatch(prompt,/Host 已确认：本会话的 source\.message/)
   if(multi){
    assert.match(prompt,/按原顺序逐项回答，每项先给结论/u)
    assert.match(prompt,/事实缺口、实际卡点或风险放进对应结论/u)
    assert.match(prompt,/确有下一步就说具体行动；原问题以外的未完成项不主动展开/u)
    assert.ok(requestText(body).some(text=>text.includes(request)),'the outcome model receives both original questions')
    assert.match(prompt,/沿原会话推进；没有新依据不重复唤醒/u)
    assert.match(prompt,/尚未核实的后续条件不写成已确认的卡点/u)
    assert.equal(outcome.kind,'task.completed')
    assert.deepEqual(outcome.taskEvent.result.evidence,evidence)
    assert.deepEqual(outcome.taskEvent.result.limitations,limitations)
   }
   const context=requestText(body).flatMap(text=>text.split('\n')).find(line=>line.startsWith('{"asOf":')&&line.includes('"sourceTaskLinks"'))
   const {taskOutcomeReplies,taskOutcomeQuestions}=JSON.parse(context)
   const reply=taskOutcomeReplies?.[0]
   if(reply){
    assert.deepEqual(reply,{operationId:outcome.taskEventId,sourceId:source.sourceId,messageVersion:source.version,outcomeEventId:outcome.taskEventId})
    assert.deepEqual(taskOutcomeQuestions,[{outcomeEventId:reply.outcomeEventId,sourceId:reply.sourceId,messageVersion:reply.messageVersion,text:request}])
    return {tool:'resident_router_reply',args:{...reply,replyPurpose:'task-update',text:replyText}}
   }
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 },{config:{inspectionIntervalMs:0},transportCapabilities:{quotedReplies:['chat-room'],standaloneMarkdown:true}})
 await h.receive(channelMessage('final-only',{text:request}));await h.service.whenIdle()
 assert.equal(executions,1);assert.equal(terminal.size,technical?0:1);assert.equal(h.sent.length,reports?1:0)
 if(reports){
  assert.equal(h.sent[0].text,replyText)
  assert.equal(h.sent[0].replyToMessageId,'final-only')
  assert.equal(h.sent[0].replyToParticipantId,'alice')
  assert.deepEqual(h.sent[0].recipientIds,['alice'])
  const [notice]=await h.query('notification.list')
  assert.equal(notice.state,'delivered');assert.equal(notice.payload.replyToMessageId,'final-only')
  assert.equal(notice.payload.textFormat,undefined,'不能以独立 Markdown 发送绑定原提问的结论')
 }
 if(unconfirmed)assert.doesNotMatch(h.sent[0].text,/日志|监控|样本|缩容|下一步/u)
 if(recovery){
  assert.equal(h.sent[0].text.includes('Monte Carlo'),endToEnd)
  assert.doesNotMatch(h.sent[0].text,/本次只确认|构建和推送/u)
 }
 if(investigation){
  const [sent]=h.sent
  assert.equal(sent.text.includes('13:37'),detailed)
  assert.equal(sent.text.includes('总共 27 次模型超时'),detailed)
  assert.doesNotMatch(sent.text,/逐项排除|没有修改|未改代码|重启或重跑/u)
 }
 const task=await h.query('task.get',{taskId:'final-only-task'})
 {
  const [event]=await h.query('router.batch-events',{conversationId:task.groupId,eventIds:[...technical?inspections:terminal]})
  assert.equal(event.state,'consumed')
  assert.equal(event.outcomeDisposition.kind,reports?'notification-frozen':'not-reported')
  if(investigation||recovery||unconfirmed){
   const notice=await h.query('notification.get',{notificationId:event.outcomeDisposition.notificationId})
   assert.equal(notice.state,'delivered');assert.equal(notice.payload.text,replyText);assert.ok(notice.receipt)
  }
  if(technical){
   const notice=await h.query('notification.get',{notificationId:event.outcomeDisposition.notificationId})
   assert.equal(notice.state,'delivered');assert.ok(notice.receipt)
   assert.equal(notice.payload.sourceId,source.sourceId);assert.equal(notice.payload.sourceVersion,source.version)
   assert.deepEqual(notice.payload.recipientActorIds,[source.actorId])
  }
 }
 assert.equal(task.drained,true);assert.equal(task.status,technical?'active':'completed');assert.equal(task.humanRequests?.length??0,0)
 if(technical){
  assert.equal(inspections.size,1)
  assert.equal(task.lastDecision.resultSource,undefined)
  assert.equal(task.completion??null,null);assert.equal(task.inspection.pending,true)
  assert.equal(task.technicalFailure.code,'TASK_PI_PROVIDER_ERROR')
  assert.equal(task.technicalFailure.providerReason,'POLICY_REFUSAL')
 }else{
  assert.equal(inspections.size,0)
  assert.equal(task.completion.result.summary,action==='natural-stop'?'Normal stop with no structured result':summary)
  assert.deepEqual(task.completion.result.limitations,limitations)
 }
 assert.equal((await h.query('notification.list')).filter(item=>item.kind==='question').length,0)
 const count=h.requests.length,sent=h.sent.length
 await h.service.recover();await h.service.whenIdle()
 const alerts=(await h.service.listAlertPage({type:'runtime'})).items.filter(item=>item.taskEventId)
 if(!reports){
  const [row]=await h.query('router.batch-events',{conversationId:task.groupId,eventIds:[...terminal]})
  assert.deepEqual(alerts.map(({code,taskEventId,conversationId})=>({code,taskEventId,conversationId})),[{code:'ROUTER_OUTCOME_NOT_REPORTED',taskEventId:row.taskEventId,conversationId:task.groupId}])
 }else assert.deepEqual(alerts,[])
 assert.equal(h.requests.length,count,'巡检没有让模型补跑')
 assert.equal(h.sent.length,sent,'巡检没有补发')
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,count);assert.equal(h.sent.length,sent)
})

for(const mode of ['periodic','restart-frozen'])test('Router automatically continues a timed-out task outcome: '+mode,{timeout:nativeTestTimeout(60000)},async t=>{
 const restart=mode==='restart-frozen',taskId='timeout-outcome-task',replyText='测试材料已核对。'
 const resumeReady=Promise.withResolvers(),sent=[]
 let planned=false,source,outcome,executions=0,timeouts=0,resumes=0,replies=0
 const h=await memoryHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   executions++;return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic material checked',evidence:['Fixture verified'],limitations:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  const priorCall=body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function.name
  if(body.messages.at(-1)?.role==='tool'&&priorCall==='resident_router_settle')return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  if(!planned){
   planned=true;source=input.events[0].source
   return {tool:'resident_task_plan',args:{operationId:'timeout-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId,title:'Check fixture',objective:'Check the synthetic material',requirements:[],handoff:'Check only the local fixture.'}],dependencies:[]}}
  }
  outcome??=input.events.find(event=>event.kind==='task.completed')
  if(input.events.some(event=>event.id===outcome?.id)){
   const resumed=requestText(body).includes('继续处理未完成的事项')
   if(resumed){await resumeReady.promise;if(body.messages.at(-1)?.role!=='tool')resumes++}
   if((restart&&!resumed||!restart&&resumed)&&!replies){
    replies++
    const context=requestText(body).flatMap(text=>text.split('\n')).findLast(line=>line.startsWith('{"asOf":')&&line.includes('"sourceTaskLinks"'))
    const reply=JSON.parse(context).taskOutcomeReplies.find(item=>item.outcomeEventId===outcome.taskEventId)
    return {tool:'resident_router_reply',args:{...reply,text:replyText}}
   }
   if(!resumed){timeouts++;return {errorStatus:504,error:'fixture gateway timeout'}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events[0].id,eventIds:input.events.map(event=>event.id)}}
 },{hostConfig:config=>{
  config.providers.fixture.retry={enabled:true,maxRetries:1,baseDelayMs:1,provider:{maxRetries:0}}
  return config
 }})
 const config={...h.config,resident:{port:0,taskSessions:{instanceId:'timeout-outcome-fixture',ownerActorId:'owner',webActorId:'owner',ingressEpoch:'2026-01-01T00:00:00Z',initialize:true,reasoningMode:'inherit',inspectionIntervalMs:0,...restart?{recoveryIntervalMs:60000}:{}}}}
 const start=async()=>{
  const ctx=h.host.ctx
  ctx.channels.registerTransport('resident-fixture',{
   async send(envelope){sent.push(structuredClone(envelope));return {messageId:'timeout-visible'}},
   async readback(){return sent.length?{messageId:'timeout-visible',visible:true}:undefined},
  })
  await ctx.plugin({inject,apply:pluginCtx=>applyApplication(pluginCtx,config)})
  return ctx.get('application').tasks
 }
 let tasks=await start()
 const message=channelMessage('timeout-outcome'),conversationId=h.host.ctx.channels.identity(message).sessionId
 const query=(kind,args={})=>tasks.store.query({kind,conversationId,...args})
 const notification=async()=> (await query('notification.list')).find(notice=>notice.payload?.completionBinding?.eventId===outcome?.taskEventId)
 try{
  await h.host.ctx.channels.receive(message)
  const before=await eventually(async()=>{
   const row=await query('router.get');return row?.timeoutContinuation&&row
  },'the exhausted timeout is durably deferred',t.signal)
  const [pending]=await query('router.batch-events',{eventIds:[outcome.id]})
  assert.equal(pending.state,'pending');assert.ok(before.timeoutContinuation.eventIds.includes(pending.id))
  assert.equal((await query('task.get',{taskId})).status,'completed')
  assert.equal(timeouts,2,'Pi exhausted one native retry before deferring')
  const frozen=await notification()
  if(restart){assert.ok(frozen,'the original reply was frozen before the timeout');await h.close();await h.boot();tasks=await start()}
  else{assert.equal(frozen,undefined);assert.equal(sent.length,0)}
  resumeReady.resolve()
  const delivered=await eventually(async()=>{
   const notice=await notification(),[event]=await query('router.batch-events',{eventIds:[outcome.id]})
   return notice?.state==='delivered'&&event.state==='consumed'&&notice
  },'the original task result is settled and its reply delivered without new input',t.signal).catch(async error=>{
   const [event]=await query('router.batch-events',{eventIds:[outcome.id]}),row=await query('router.get')
   t.diagnostic(JSON.stringify({timeouts,resumes,replies,sends:sent.length,event:event.state,notification:(await notification())?.state,timeoutContinuation:row.timeoutContinuation,alerts:tasks.listAlerts().map(({code,detail})=>({code,detail})),errors:h.errors.map(e=>e.code??e.message),requestTails:h.requests.slice(-6).map(body=>({last:body.messages.at(-1)?.role,tool:body.messages.findLast(m=>m.tool_calls)?.tool_calls?.at(-1)?.function.name,hasResume:requestText(body).includes('继续处理未完成的事项')}))}))
   throw error
  })
  await tasks.whenIdle()
  const after=await query('router.get')
  assert.equal(after.activeSessionId,before.activeSessionId);assert.equal(after.generation,before.generation)
  assert.equal(after.timeoutContinuation,undefined)
  assert.ok(delivered.receipt);if(frozen)assert.equal(delivered.id,frozen.id)
  assert.equal(sent.length,1);assert.equal(sent[0].text,replyText)
  assert.equal(executions,1);assert.equal(resumes,1);assert.equal(replies,1)
  const {entries}=await h.host.ctx.sessionPersistence.readNative(after.activeSessionId,{requireComplete:true})
  assert.equal(entries.filter(entry=>entry.customType==='night.business-input'&&entry.details?.packetId===before.timeoutContinuation.packetId).length,1)
  assert.equal(entries.filter(entry=>entry.customType==='night.router-resume-claim'&&entry.details?.failedEntryId===before.timeoutContinuation.failedEntryId).length,1)
 }finally{resumeReady.resolve()}
})

test('Router can retry the same interrupted session and then cancel with a durable reason',{timeout:nativeTestTimeout(45000)},async t=>{
 const taskId='interrupted-fixture',doneId='normal-fixture',reason='两次执行均被模型服务拒绝，停止本轮核对。'
 let h,planned=false,runs=0
 const inspected=new Map()
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   if(requestText(body).some(text=>text.includes('Read the normal fixture only.')))return {text:'本轮已结束，尚未核对附件。'}
   runs++;return {error:'400 litellm.ContentPolicyViolationError: fixture content policy'}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  if(!planned){
   planned=true;const source=input.events.find(event=>event.source).source
   return {tool:'resident_task_plan',args:{operationId:'plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[
    {taskId,title:'Interrupted check',objective:'Check the interrupted fixture',requirements:[],handoff:'Check the interrupted fixture only.'},
    {taskId:doneId,title:'Normal check',objective:'Read the normal fixture',requirements:[],handoff:'Read the normal fixture only.'}],dependencies:[]}}
  }
  const event=input.events.find(event=>event.kind==='task.inspection'&&!inspected.has(event.taskEventId))
  if(event){
   const pending=await h.query('task.get',{taskId}),proof=event.taskEvent
   assert.equal(pending.drained,true);assert.equal(pending.status,'active');assert.equal(proof.sessionId,pending.sessionId)
   assert.equal(proof.brief,undefined);assert.equal(pending.inspection.pending,true)
   inspected.set(event.taskEventId,pending.sessionId)
   const second=inspected.size===2
   return {tool:'resident_task_action',args:{operationId:'resolve-'+event.id,kind:'control',taskId,expectedRequirementRevision:pending.requirementRevision,expectedControlRevision:pending.controlRevision,
    control:second?'cancelled':'active',reason:second?reason:'Retry once from the original session.'}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('interrupted'));await h.service.whenIdle()
 const cancelled=await h.query('task.get',{taskId}),completed=await h.query('task.get',{taskId:doneId})
 assert.equal(runs,2);assert.equal(inspected.size,2);assert.deepEqual([...new Set(inspected.values())],[cancelled.sessionId])
 assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cancellationReason,reason);assert.equal(cancelled.drained,true)
 assert.equal(completed.status,'completed');assert.equal(completed.completion.summary,'本轮已结束，尚未核对附件。')
 assert.deepEqual((await h.service.boardTasks({state:'completed'})).items.map(row=>row.taskId),[doneId])
 assert.deepEqual((await h.service.boardTasks({state:'cancelled'})).items.map(row=>row.taskId),[taskId])
 await h.restart();await h.service.whenIdle()
 assert.equal((await h.query('task.get',{taskId})).cancellationReason,reason);assert.equal(runs,2);assert.equal(inspected.size,2);assert.equal(h.sent.length,0)
})

for(const action of ['complete','blocked','runtime-failure'])test('silent Web supplement does not send a channel outcome: '+action,{timeout:nativeTestTimeout(45000)},async t=>{
 let h,original,runs=0,outcome,attempts=0
 const taskId='silent-web-result'
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   if(++runs===1||action==='runtime-failure')return {error:'400 litellm.ContentPolicyViolationError: fixture content policy'}
   return {tool:'task_result',args:{decision:{action,summary:'Synthetic result',evidence:[],limitations:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  if(!original){
   original=input.events.find(event=>event.source).source
   return {tool:'resident_task_plan',args:{operationId:'plan',sourceId:original.sourceId,messageVersion:original.version,tasks:[{taskId,title:'Isolated check',objective:'Check the fixture',requirements:[],handoff:'Check the fixture.'}],dependencies:[]}}
  }
  const event=input.events.find(row=>['task.completed','task.blocked'].includes(row.kind)||row.kind==='task.inspection'&&row.taskEvent.reason==='execution-failed')
  if(runs>1&&event?.suppressChannelOutcome&&attempts<2){
   outcome=event
   const i=attempts++
   return {tool:'resident_router_reply',args:{operationId:'attempt-'+i,sourceId:original.sourceId,messageVersion:original.version,text:'Synthetic result',...i===0?{outcomeEventId:event.taskEventId}:{}}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('silent-original'));await h.service.whenIdle()
 const before=await h.query('task.get',{taskId})
 await h.service.appendTaskContext({taskId,requestId:'silent-context',context:'Continue a synthetic check.',progressImpact:'preserve',suppressChannelOutcome:true,expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId})
 assert.equal(task.sessionId,before.sessionId);assert.equal(task.requirementRevision,before.requirementRevision);assert.equal(task.drained,true);assert.equal(runs,2)
 assert.equal(task.status,action==='runtime-failure'?'active':'completed');assert.equal(attempts,2)
 assert.equal(h.sent.length,0,'a silent outcome must not enter the channel sender')
 assert.equal(outcome.suppressChannelOutcome,true)
 for(const row of h.results.filter(row=>row.name==='resident_router_reply'))assert.match(JSON.stringify(row.result),/ROUTER_CHANNEL_OUTCOME_SUPPRESSED/)
 const [event]=await h.query('router.batch-events',{conversationId:task.groupId,eventIds:[outcome.id]})
 assert.equal(event.state,'consumed');assert.equal(event.outcomeDisposition.kind,'channel-delivery-suppressed')
 assert.equal((await h.query('notification.list')).length,0)
 await h.restart();await h.service.whenIdle();assert.equal(h.sent.length,0)
 assert.deepEqual(h.service.listAlerts().filter(item=>item.taskEventId===outcome.taskEventId),[])
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
  if(tools.includes('task_result')){
   if(++runs===1)return {error:'400 litellm.ContentPolicyViolationError: fixture content policy'}
   return {tool:'task_result',args:{decision:{action:'blocked',summary,evidence:['Checked isolated fixture'],limitations:[]}}}
  }
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
  const outcome=input.events.find(event=>event.kind==='task.completed')
  if(outcome&&replies<3){
   const attempt=replies++
   return {tool:'resident_router_reply',args:{operationId:'reply-'+attempt,sourceId:original.sourceId,messageVersion:original.version,...attempt?{completionEventId:outcome.taskEventId,replyPurpose:'task-update'}:{replyPurpose:'direct-answer'},recipientActorIds:[original.actorId],text:summary}}
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
 assert.ok(notices[0].payload.completionBinding.eventId)
 assert.deepEqual(notices[0].payload.recipientActorIds,[original.actorId]);assert.notEqual(fresh.actorId,original.actorId)
 const current=await h.query('task.get',{taskId})
 assert.equal(current.sessionId,initial.sessionId);assert.equal(current.completion.result.action,'blocked');assert.equal(runs,2)
 assert.equal(await h.query('router.inbox-count',{conversationId:current.groupId}),0)
 assert.equal(h.sent[0].text,summary)
 await h.restart();await h.service.whenIdle();assert.equal(h.sent.length,1)
})

test('a new completion after Web continuation reports to the original channel despite an older hold',{timeout:nativeTestTimeout(60000)},async t=>{
 const taskId='held-completion',summary='The synthetic check finished after continuation.'
 let h,original,runs=0,attempt=0,outcome
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   if(++runs===1)return {error:'400 litellm.ContentPolicyViolationError: fixture content policy'}
   return {tool:'task_result',args:{decision:{action:'complete',summary,evidence:[],limitations:[]}}}
  }
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
