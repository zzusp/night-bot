import assert from 'node:assert/strict'
import test from 'node:test'
import {channelMessage,eventually,requestEnvelope,requestTools,residentRouterHost} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

test('live channel status check uses Router readback and cannot supplement or conclude the existing execution',{timeout:nativeTestTimeout(45000)},async t=>{
 const running=Promise.withResolvers(),release=Promise.withResolvers()
 t.after(()=>release.resolve())
 const steps=new Map(),taskId='progress-original-task',answer='The task is still running. No intermediate result has been verified.'
 let h,executionCalls=0,progressPrompt
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   executionCalls++
   return {tool:'task_result',args:{decision:{action:'complete',summary:'The original work was finished.',evidence:['Fixture run ended'],limitations:[]}},beforeFinish:async()=>{running.resolve();await release.promise}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No action'}
  const packet=requestEnvelope(body,'Router 请求：'),event=packet.events.find(e=>e.source)
  const key=event?.source.messageId??packet.events[0].id,step=steps.get(key)??0
  steps.set(key,step+1)
  const settle=dispositions=>({tool:'resident_router_settle',args:{operationId:'settle-'+key,eventIds:packet.events.map(e=>e.id),...dispositions?{noTaskDispositions:dispositions}:{}}})
  if(key==='work'&&step===0)return {tool:'resident_task_plan',args:{operationId:'start-work',sourceId:event.sourceId,messageVersion:event.messageVersion,
   tasks:[{taskId,title:'Original fixture work',objective:'Finish original work',handoff:'Finish the original fixture work, then tell the requester.',requirements:[]}],dependencies:[]}}
  if(key==='ask'){
   const source={sourceId:event.sourceId,messageVersion:event.messageVersion}
   if(step===0){
    progressPrompt=JSON.stringify(body.messages.filter(row=>row.role==='system'))
    return {tool:'resident_task_query',args:{...source,taskId,detail:'progress'}}
   }
   if(step===1){
    // Deliberately simulate the former routing error after the query was admitted
    // read-only, to verify rejection below at the real tool/Host boundary.
    const task=await h.query('task.get',{taskId})
    return {tool:'resident_task_action',args:{...source,operationId:'incorrect-supplement',kind:'supplement',taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,handoff:'Report the status back to the channel.'}}
   }
   if(step===2)return {tool:'resident_router_reply',args:{...source,operationId:'status-answer',text:answer,replyPurpose:'task-update'}}
   if(step===3)return settle([{eventId:event.id,outcome:'handled-inline',sourceQuote:event.source.text,reason:'Answered a read-only progress question from the current Router snapshot'}])
   return {text:'Status question settled.'}
  }
  if(step<2)return settle()
  return {text:'Settled.'}
 },{strictModelDecisions:true})
 try{
  await h.receive(channelMessage('work',{text:'Please finish this work.'}))
  await eventually(()=>executionCalls===1,'the original execution model is running',t.signal)
  await running.promise
  const before=await h.query('task.get',{taskId})
  assert.equal(before.status,'active')
  assert.equal(before.drained,false)
  await h.receive(channelMessage('ask',{text:'How is this going?'}))
  await eventually(()=>h.sent.some(row=>row.text===answer),'Router channels the read-only answer',t.signal)
  assert.match(progressPrompt,/绝不为补证据把问题转交执行会话/u)
  assert.match(progressPrompt,/明确要求执行、requiresFullRead=false/u)
  const query=h.results.find(row=>row.name==='resident_task_query')
  assert.equal(query.result.isError,false)
  const error=h.results.find(row=>row.name==='resident_task_action')
  assert.equal(error.result.isError,true)
  assert.match(JSON.stringify(error.result),/ROUTER_PROGRESS_SOURCE_READ_ONLY/u)
  const currentSource=(await h.query('source.list')).find(row=>row.messageId==='ask')
  const conversation=await h.query('router.get',{conversationId:currentSource.groupId})
  await assert.rejects(h.store.command({id:'attempt-bypass-progress-guard',kind:'router.task-action',args:{
    conversationId:currentSource.groupId,generation:conversation.generation,operationId:'attempt-bypass-progress-guard',kind:'task.supplement',
    sourceId:currentSource.sourceId,messageVersion:currentSource.version,handoff:'Report status.',action:{taskId,expectedRequirementRevision:before.requirementRevision,expectedControlRevision:before.controlRevision},
  }}),{code:'ROUTER_PROGRESS_SOURCE_READ_ONLY'})
  const after=await h.query('task.get',{taskId})
  assert.deepEqual(after,before,'a progress question adds no requirement, wake, revision, or completion')
  assert.equal(executionCalls,1)
 } finally { release.resolve() }
 await eventually(async()=> (await h.query('task.get',{taskId}))?.status==='completed','only original work completes the task',t.signal)
})

test('related investigation starts independently; explicit replacement alone changes the running goal',{timeout:nativeTestTimeout(45000)},async t=>{
 const initial=Promise.withResolvers(),release=Promise.withResolvers()
 t.after(()=>release.resolve())
 const originalId='original-feature',investigationId='independent-test-investigation'
 const steps=new Map()
 let h,originalTurns=0,investigationTurns=0,prompt
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   const task=body.messages.flatMap(row=>typeof row.content==='string'?[row.content]:Array.isArray(row.content)?row.content.map(part=>part.text??''):[]).map(text=>{
    try{return JSON.parse(text)?.task}catch{return null}
   }).findLast(Boolean)
   const decision={action:'complete',summary:task?.taskId===investigationId?'Independent investigation finished.':'Original execution finished.',evidence:['Fixture result'],limitations:[]}
   if(task?.taskId===originalId&&originalTurns++===0)return {tool:'task_result',args:{decision},beforeFinish:async()=>{initial.resolve();await release.promise}}
   if(task?.taskId===investigationId)investigationTurns++
   return {tool:'task_result',args:{decision}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No action'}
  const packet=requestEnvelope(body,'Router 请求：'),event=packet.events.find(e=>e.source)
  const key=event?.source.messageId??packet.events[0].id,step=steps.get(key)??0
  steps.set(key,step+1)
  const source=event?{sourceId:event.sourceId,messageVersion:event.messageVersion}:{}
  const plan=(taskId,title,refs=[])=>({tool:'resident_task_plan',args:{...source,operationId:'plan-'+key,tasks:[{taskId,title,objective:title,handoff:title,requirements:[],sourceRefs:refs}],dependencies:[]}})
  const revise=(task,quote)=>({tool:'resident_task_action',args:{...source,operationId:'revise-'+key,kind:'revise',taskId:task.taskId,
   expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,objective:'Investigate the dependency instead.',handoff:'Investigate the dependency instead.',...quote?{replaceActiveGoalQuote:quote}:{}}})
  if(key==='deploy'&&step===0)return plan(originalId,'Develop the original feature.')
  if(key==='investigate'&&step===0){
   prompt=JSON.stringify(body.messages.filter(row=>row.role==='system'))
   return revise(await h.query('task.get',{taskId:originalId}))
  }
  if(key==='investigate'&&step===1){
   const linked=(await h.query('task.get',{taskId:originalId})).sourceRefs[0]
   return plan(investigationId,'Investigate the unrelated test-environment failures.',[linked])
  }
  if(key==='replace'&&step===0)return revise(await h.query('task.get',{taskId:originalId}),event.source.text)
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled.'}
  if(step<4)return {tool:'resident_router_settle',args:{operationId:'settle-'+key,eventIds:packet.events.map(e=>e.id)}}
  return {text:'Done.'}
 },{strictModelDecisions:true})
 try{
  await h.receive(channelMessage('deploy',{text:'Develop the original feature.'}))
  await eventually(()=>originalTurns===1,'the original task starts',t.signal)
  await initial.promise
  const before=await h.query('task.get',{taskId:originalId}),actor=h.host.ctx.agents.get(before.sessionId)
  await h.receive(channelMessage('investigate',{text:'先排查一下测试环境为什么 502，比较急。',quotedMessage:{messageId:'deploy',senderId:'alice',text:'Develop the original feature.'}}))
  await eventually(async()=> (await h.query('task.get',{taskId:investigationId}))?.status==='completed','the second investigation completes while the original is still running',t.signal)
  assert.match(prompt,/相同对象或引用旧任务都不表示改变原目标/u)
  assert.match(prompt,/“先”或“较急”只表示优先级/u)
  assert.match(JSON.stringify(h.results.find(row=>row.name==='resident_task_action').result),/ROUTER_ACTIVE_GOAL_REPLACEMENT_REQUIRED/u)
  assert.deepEqual(await h.query('task.get',{taskId:originalId}),before)
  assert.equal(actor.lifecycle.signal.aborted,false)
  assert.equal(investigationTurns,1)
  await h.receive(channelMessage('replace',{text:'原开发任务先停止，改做依赖问题排查。'}))
  const changed=await eventually(async()=>{const value=await h.query('task.get',{taskId:originalId});return value.requirementRevision===before.requirementRevision+1&&value},'explicit replacement updates the original task',t.signal)
  assert.equal(changed.objective,'Investigate the dependency instead.')
  assert.equal(changed.sessionId,before.sessionId)
  await eventually(()=>actor.lifecycle.signal.aborted,'explicit replacement cancels the old execution',t.signal)
 }finally{release.resolve()}
 await eventually(async()=> (await h.query('task.get',{taskId:originalId}))?.status==='completed','revised task continues in the same original session',t.signal)
 assert.equal(originalTurns,2)
})
