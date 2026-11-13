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

for(const phase of ['model','preflight','before-run','validation','foreign-abort','prepared'])test(`completion preempts only an unprepared handoff: ${phase}`,{timeout:nativeTestTimeout(60000)},async t=>{
  const taskEntered=Promise.withResolvers(),taskRelease=Promise.withResolvers(),handoffEntered=Promise.withResolvers(),handoffRelease=Promise.withResolvers()
  t.after(()=>{taskRelease.resolve();handoffRelease.resolve()})
  const foreignError=Object.assign(new Error('Unrelated policy preparation failure'),{name:'AbortError',code:20})
  let h,planned=false,held=false,completion,hideActive=true,inHandoff=false,caughtHandoffError,handoffSignal
  h=await residentRouterHost(t,async body=>{
    const names=requestTools(body)
    if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
    if(names.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Synthetic work'}))}}}
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(!names.length&&handoff){if(phase==='model'&&!held){held=true;handoffEntered.resolve();await handoffRelease.promise}return {text:JSON.stringify({currentIntent:'Retain intent',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}}
    if(names.includes('task_result')){taskEntered.resolve();await taskRelease.promise;return {tool:'task_result',args:{decision:{action:'complete',summary:'Done',evidence:['fixture'],limitations:[]}}}}
    if(names.includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：')
      if(!planned){planned=true;const source=input.events.find(event=>event.source).source;return {tool:'resident_task_plan',args:{operationId:'plan-preempt',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'preempt-task',title:'Fixture',objective:'Fixture work',requirements:['local evidence']}],dependencies:[]}}}
      if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Settled'}
      if(input.events.some(event=>event.taskEvent?.kind==='task.completed'))completion=input
      return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.id).join(',')}}
    }
    return {text:'No work'}
  },{wrapStore:store=>({...store,query:async q=>{const result=await store.query(q);return q.kind==='task.list'&&q.groupId&&q.archived===undefined&&hideActive?[]:result}})})
  if(phase!=='model'){
    const agents=h.host.ctx.get('agents'),create=agents.create.bind(agents)
    agents.create=async(...args)=>{
      const handle=await create(...args)
      if(handle.agent.metadata.runtimeOwner!=='conversation-router')return handle
      if(phase==='preflight'){
        const skills=h.host.ctx.agentPresets.serviceFor(handle.agent,'skills')??handle.agent.ctx.get('skills'),snapshot=skills.snapshot.bind(skills)
        // 只冻结本 Router 的资源预检，不能把并发任务的准备也锁住。
        skills.snapshot=async(...values)=>{if(!held&&inHandoff&&values[0]?.scope===handle.agent){held=true;handoffEntered.resolve();await handoffRelease.promise}return snapshot(...values)}
      }
      const run=handle.runToolFreeHandoff.bind(handle)
      handle.runToolFreeHandoff=async(packet,validate,options)=>{
        inHandoff=true;handoffSignal=options.signal
        if(phase==='before-run'&&!held){held=true;handoffEntered.resolve();await handoffRelease.promise}
        const result=await run(packet,async text=>{
          const value=await validate(text)
          if(['validation','foreign-abort'].includes(phase)&&!held){held=true;handoffEntered.resolve();await handoffRelease.promise;if(phase==='foreign-abort')throw foreignError}
          return value
        },options).catch(error=>{caughtHandoffError=error;throw error})
        if(phase==='prepared'&&!held){held=true;handoffEntered.resolve();await handoffRelease.promise}
        return result
      }
      return handle
    }
  }
  const message=channelMessage('preempt-'+phase);await h.receive(message);await taskEntered.promise;await handoffEntered.promise
  const conversationIdAtHandoff=h.host.ctx.channels.identity(message).sessionId
  const ownerId=(await h.query('router.get',{conversationId:conversationIdAtHandoff})).activeSessionId,originalOwner=h.host.ctx.get('agents').get(ownerId)
  hideActive=false;taskRelease.resolve()
  if(phase==='prepared'){
    await eventually(async()=>(await h.query('task.get',{taskId:'preempt-task'})).status==='completed','task complete',t.signal)
    assert.equal(completion,undefined,'prepared summary is never cancelled')
    handoffRelease.resolve()
  }else{
    // Preflight gate must release to let official abort join; no model handoff is required.
    if(['preflight','before-run','validation','foreign-abort'].includes(phase)){await eventually(async()=>h.query('router.pending-completion',{conversationId:h.host.ctx.channels.identity(message).sessionId}),'durable completion before preflight releases',t.signal);await eventually(()=>handoffSignal?.aborted,'handoff cancellation observed before releasing gate',t.signal);handoffRelease.resolve()}
    await eventually(()=>completion,'completion evaluated before blocked model returns',t.signal)
    assert.equal(completion.generation,1)
    if(phase==='foreign-abort'){assert.equal(caughtHandoffError,foreignError,'unrelated AbortError identity is not rewritten to preemption');assert.equal(caughtHandoffError.routerHandoffRecoveryRequired,undefined)}
    if(phase==='preflight'){assert.notEqual(h.host.ctx.get('agents').get(ownerId),originalOwner,'exact native preflight cancellation strictly reopens the same journal');assert.equal(originalOwner.lifecycle.signal.aborted,true);const aborted=(await h.query('router.rotations',{conversationId:conversationIdAtHandoff})).find(row=>row.state==='aborted');assert.equal(aborted?.error,'ROUTER_HANDOFF_PREEMPTED','explicit preemption recovery, not a later interrupted-handoff drain, reopens the owner')}
    handoffRelease.resolve()
  }
  await h.service.whenIdle()
  assert.ok(completion)
  const conversationId=h.host.ctx.channels.identity(message).sessionId
  assert.equal((await h.query('router.inbox',{conversationId})).length,0)
  const row=await h.query('router.get',{conversationId}),cursor=row.cursor
  await h.restart();await h.service.whenIdle()
  assert.equal((await h.query('router.get',{conversationId})).cursor,cursor,'cold recovery never replays the settled completion')
})
