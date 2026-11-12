import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'

test('active task completion stays on the current Router instead of waiting behind per-batch handoff',{timeout:nativeTestTimeout(60000)},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),batches=[],handoffs=[]
  t.after(()=>release.resolve())
  let h,planned=false
  h=await residentRouterHost(t,async body=>{
    const names=requestTools(body)
    if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
    if(names.includes('channel_triage_submit')){
      const input=requestEnvelope(body,'一级分诊请求：')
      return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Explicit synthetic work'}))}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(!names.length&&handoff){handoffs.push(handoff);return {text:JSON.stringify({currentIntent:'Retain original intent',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}}
    if(names.includes('task_result')){entered.resolve();await release.promise;return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic work done',evidence:['local fixture'],limitations:[]}}}}
    if(names.includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：')
      const definitions=new Map(body.tools.map(tool=>[tool.function.name,tool.function]))
      assert.match(definitions.get('resident_source_get').description,/sourceId.*messageId/)
      assert.deepEqual(definitions.get('resident_source_get').parameters.required,['sourceId'])
      assert.match(definitions.get('resident_task_action').description,/sameGoal=true仅限reopen/)
      if(!planned){planned=true;const source=input.events.find(event=>event.source).source;return {tool:'resident_task_plan',args:{operationId:'performance-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'running-performance-task',title:'Synthetic work',objective:'Verify local fixture',requirements:['local evidence']}],dependencies:[]}}}
      if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Settled'}
      batches.push(input)
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.id).join(',')}}
    }
    return {text:'No additional work'}
  })
  const message=channelMessage('performance-task')
  await h.receive(message);await entered.promise
  const conversationId=h.host.ctx.channels.identity(message).sessionId
  await eventually(async()=>!(await h.query('router.inbox',{conversationId})).length,'arrangement batch settles while task runs',t.signal)
  const before=await h.query('router.get',{conversationId})
  assert.equal(before.generation,1);assert.equal(before.phase,'active');assert.equal(handoffs.length,0)
  release.resolve();await h.service.whenIdle()
  const completion=batches.find(batch=>batch.events.some(event=>event.taskEvent?.kind==='task.completed'))
  assert.ok(completion,'actual durable completion is routed');assert.equal(completion.generation,1)
  const rotations=await h.query('router.rotations',{conversationId})
  assert.ok(rotations.some(rotation=>rotation.state==='published'),'quiescent completed work can still safely rotate')
  assert.equal((await h.query('router.inbox',{conversationId})).length,0)
  assert.equal((await h.query('task.get',{taskId:'running-performance-task'})).status,'completed')
})
