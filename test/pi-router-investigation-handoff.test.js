import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'

const taskInput=body=>requestText(body).map(text=>{try{return JSON.parse(text)}catch{return null}}).findLast(input=>input?.task)
for(const progress of ['prepared','delivered'])test(`explicit read-only investigation reaches real execution with ${progress} first-reply snapshot`,{timeout:nativeTestTimeout(60000)},async t=>{
  let h,attemptedBareSettle=false,executionInput,systemChecked=false,executionSessions=[]
  h=await residentRouterHost(t,async body=>{
    const names=requestTools(body)
    if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
    if(names.includes('channel_triage_submit')){
      const input=requestEnvelope(body,'一级分诊请求：')
      return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Direct read-only investigation request',reply:'我会排查测试环境的服务状态和网关日志。'}))}}
    }
    if(names.includes('task_result')){
      executionInput=taskInput(body);executionSessions.push(executionInput.task.sessionId)
      assert.ok(executionInput.sources.some(source=>source.text.includes('只排查，不修改或部署')))
      assert.match(executionInput.task.requirements.join('\n'),/只读/)
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic read-only investigation complete',evidence:['fixture:status-and-gateway'],limitations:[]}}}
    }
    if(names.includes('resident_router_settle')){
      const allText=requestText(body).join('\n')
      assert.match(allText,/prepared与delivered只说明投递进度/)
      assert.match(allText,/未明确交办先询问/)
      assert.match(allText,/不自动扩展为修改代码/);systemChecked=true
      const input=requestEnvelope(body,'Router 请求：'),event=input.events.find(event=>event.source)
      if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled with actual action receipt'}
      if(event){
        assert.equal(event.triageReply.state,progress)
        assert.match(event.triageReply.payload.text,/服务状态和网关日志/)
        if(!attemptedBareSettle){attemptedBareSettle=true;return {tool:'resident_router_settle',args:{eventIds:[event.id],operationId:'premature-settle'}}}
        const task=await h.query('task.get',{taskId:'investigate-502'}).catch(()=>null)
        if(!task)return {tool:'resident_task_plan',args:{operationId:'investigate',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'investigate-502',title:'排查测试环境 502',objective:'只读定位测试环境服务和网关异常',requirements:['仅只读排查，不修改代码、数据，不部署或发布']}],dependencies:[]}}
        const links=await h.query('router.source-links',{sourceId:event.sourceId})
        if(!links.length)return {tool:'resident_task_action',args:{operationId:'continue:'+event.sourceId,kind:'reopen',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,sameGoal:true,sourceId:event.sourceId,messageVersion:event.messageVersion}}
      }
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.id).join(',')}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff)return {text:JSON.stringify({currentIntent:'Investigation arranged',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
    return {text:'Done'}
  },{wrapStore:store=>({...store,query:async q=>{const value=await store.query(q);return q.kind==='router.inbox'?value.map(event=>event.triageReply?{...event,triageReply:{...event.triageReply,state:progress}}:event):value}})})
  await h.receive(channelMessage('investigation',{text:'助手，请查一下测试环境为什么全是 502。只排查，不修改或部署。'}))
  await h.service.whenIdle()
  assert.ok(systemChecked)
  assert.ok(h.results.some(row=>row.name==='resident_router_settle'&&row.result.isError),'old reply/settle-only path cannot silently consume the request')
  assert.ok(h.results.some(row=>row.name==='resident_task_plan'&&!row.result.isError))
  const tasks=await h.query('task.list');assert.equal(tasks.length,1);assert.equal(tasks[0].status,'completed')
  assert.equal(executionInput.task.sessionId,tasks[0].sessionId)
  const stored=await h.host.ctx.sessionPersistence.readNative(tasks[0].sessionId,{requireComplete:true})
  assert.ok(stored.audit.some(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='task-input'),'actual official execution admission, not just consumed inbox')
  assert.equal(h.sent.length,1,'first acknowledgement only, no duplicate acceptance question')
  await h.receive(channelMessage('investigation-followup',{text:'请继续刚才的排查，仍然只排查，不修改或部署。'}));await h.service.whenIdle()
  assert.equal((await h.query('task.list')).length,1);assert.deepEqual(executionSessions,[tasks[0].sessionId,tasks[0].sessionId],'follow-up uses the original execution session')
  assert.ok(h.results.some(row=>row.name==='resident_task_action'&&!row.result.isError))
  await h.restart();await h.service.whenIdle()
  assert.equal((await h.query('task.list')).length,1);assert.equal(h.sent.length,2,'cold recovery does not resend or create another task')
})
