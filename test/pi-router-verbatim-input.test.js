import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {executionContext} from '../src/tasks/execution-context.js'

test('real Router create and live supplements pass only a faithful handoff and attachment evidence', {timeout:nativeTestTimeout(60000)}, async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),seen=Promise.withResolvers();t.after(()=>release.resolve())
 const raw='RAW_USER_SENTINEL '+ '本轮只查日志，五分钟范围，不改配置。'.repeat(80)
 const rawQuote='RAW_QUOTE_SENTINEL 原任务仅只读。'
 const rawDelta1='RAW_DELTA_ONE 仍在原任务继续，输出覆盖范围并脱敏。'
 const rawDelta2='RAW_DELTA_TWO 保持只读限制，不新增方法。'
 const handoffs=['只读核对工单里的五分钟日志，不改配置，参考随附材料。','在原任务继续，只给脱敏结果并列出实际覆盖范围。','继续沿用只读范围，不另加排查方法。']
 const materialBody='SYNTHETIC ATTACHMENT EVIDENCE'
 const acted=new Set(),calls=[];let execution=0,h,sourceId,attachmentPath
 h=await residentRouterHost(t,async body=>{
  if(requestTools(body).includes('resident_task_plan')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
   if(source&&!acted.has(source.messageId)){
    acted.add(source.messageId)
    if(source.messageId==='create'){
     sourceId=source.sourceId
     return {tool:'resident_task_plan',args:{operationId:'create-faithful',sourceId,messageVersion:source.version,
       tasks:[{taskId:'faithful',title:'ROUTER_GUESS',objective:'ROUTER_GUESS',request:'ROUTER_GUESS',requirements:['ROUTER_GUESS'],handoff:handoffs[0]}],dependencies:[]}}
    }
    const task=await h.query('task.get',{taskId:'faithful'})
    return {tool:'resident_task_action',args:{operationId:'delta-'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,kind:'supplement',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,text:'ROUTER_GUESS: enlarge the time window and try invented methods',handoff:handoffs[source.messageId==='delta-one'?1:2]}}
   }
   if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Done'}
   return {tool:'resident_router_settle',args:{operationId:'settle-'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)}}
  }
  if(requestTools(body).includes('task_result')){
   const all=requestText(body).join('\n')
   calls.push(structuredClone(body))
   assert.doesNotMatch(all,/ROUTER_GUESS|RAW_(?:USER|QUOTE|DELTA)/)
   assert.ok(all.includes(handoffs[0]))
   if(execution++===0){
    const envelope=requestText(body).filter(text=>text.startsWith('{')).map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.handoffs?.some(row=>row.text===handoffs[0]))
    assert.equal(envelope.sources[0].sourceId,sourceId)
    assert.equal(envelope.materials[0].resources[0].resource.resourceId,'res-one')
    attachmentPath=envelope.materials[0].resources[0].path
    entered.resolve();await release.promise
   }
   if(!handoffs.every(handoff=>all.includes(handoff)))return {tool:'read',args:{path:'work/synthetic-missing.txt'}}
   seen.resolve()
   return {tool:'task_result',args:{decision:{action:'wait',summary:'Synthetic handoff verification complete',evidence:['Source identity and attachment retained'],limitations:['No external investigation performed']}}}
  }
  return {text:'No work'}
 },{strictModelDecisions:true,readResource:async()=>({text:materialBody,complete:true})})
 await h.receive(channelMessage('create',{text:raw,quotedMessage:{messageId:'earlier',senderId:'alice',text:rawQuote},
   resourceRefs:[{type:'file',resourceId:'res-one',fileName:'evidence.txt'}]}))
 await entered.promise
 await h.receive(channelMessage('delta-one',{text:rawDelta1}))
 await eventually(async()=> (await h.query('task.get',{taskId:'faithful'})).contextRevision===1,'first live supplement')
 await h.receive(channelMessage('delta-two',{text:rawDelta2}))
 await eventually(async()=> (await h.query('task.get',{taskId:'faithful'})).contextRevision===2,'second live supplement')
 await eventually(()=>h.results.filter(row=>row.name==='resident_task_action'&&!row.result.isError).length===2,'both Router supplement calls committed');release.resolve();await seen.promise;await h.service.whenIdle()
 const tasks=await h.query('task.list');assert.ok(calls.length>=2);assert.equal(tasks.length,1)
 const [task]=tasks;assert.equal(task.sourceRefs.length,3);assert.equal(task.metadata.routerInputPolicy,'faithful-handoff-v1')
 assert.deepEqual(task.metadata.routerHandoffs.map(row=>row.text),handoffs)
 const source=await h.query('source.get',{sourceId});assert.equal(source.text,raw);assert.equal(source.quote.text,rawQuote)
 assert.equal(await readFile(attachmentPath,'utf8'),materialBody)
 const directory=join(h.host.ctx.runtimePaths.workspaces,'tasks','faithful','materials')
 const snapshots=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>entry.name)
 assert.equal(snapshots.filter(name=>name.endsWith('.json')).length,3)
 for(const name of snapshots)assert.doesNotMatch(await readFile(join(directory,name),'utf8'),/RAW_(?:USER|QUOTE|DELTA)/)
})

test('new Router action without an explicit handoff does not fall back to forwarding user text',{timeout:nativeTestTimeout(45000)},async t=>{
 let attempts=0,executions=0
 const h=await residentRouterHost(t,body=>{
  if(requestTools(body).includes('task_result')){executions++;return {text:'Unexpected task'}}
  const input=requestEnvelope(body,'Router 请求：'),event=input?.events[0],source=event?.source
  if(!source)return {text:'No source'}
  if(attempts++===0)return {tool:'resident_task_plan',args:{operationId:'missing-handoff',sourceId:source.sourceId,messageVersion:source.version,
    tasks:[{taskId:'never-starts',title:'Invalid',objective:'Invalid',requirements:[]}],dependencies:[]}}
  if(attempts===2)return {tool:'resident_router_settle',args:{operationId:'invalid-handoff-synthetic-no-task',eventIds:[event.id],
    noTaskDispositions:[{eventId:event.id,outcome:'context-only',reason:'Synthetic verification only',sourceQuote:source.text}]}}
  return {text:'No task'}
 })
 await h.receive(channelMessage('missing-handoff',{text:'RAW never enters execution'}))
 await eventually(()=>attempts>=2,'model receives the invalid tool result')
 await h.service.whenIdle()
 assert.equal(executions,0)
 assert.deepEqual(await h.query('task.list'),[])
})


test('cold and live packet views honor revision and admitted handoff identity',()=>{
 const initial={id:'initial',sourceId:'first',messageVersion:1,requirementRevision:1,contextRevision:0,text:'old goal'}
 const first={id:'new-goal',sourceId:'second',messageVersion:1,requirementRevision:2,contextRevision:1,text:'Changed goal'}
 const second={id:'next-in-turn',sourceId:'third',messageVersion:1,requirementRevision:2,contextRevision:2,text:'Additional limit'}
 const task={taskId:'faithful',requirementRevision:2,contextRevision:2,metadata:{routerInputPolicy:'faithful-handoff-v1',routerHandoffs:[initial,first,second]}}
 const result=executionContext({task})
 assert.deepEqual(result.handoffs,[first,second])
 const enqueued={domain:'admission',kind:'enqueued',payload:{id:'earlier',source:{kind:'task-input'},content:[{text:JSON.stringify({...result,handoffs:[first]})}]}}
 const admitted={domain:'admission',kind:'admitted',payload:{id:'earlier'}}
 assert.deepEqual(executionContext({task:{...task,contextRevision:1}},[enqueued]).handoffs,[first])
 assert.deepEqual(executionContext({task},[enqueued,admitted]).handoffs,[second])
})

test('an unresolved old Router resume does not block new same-task action from another source', {timeout:nativeTestTimeout(60000)}, async t=>{
 let h,oldSource,firstSession,oldCallId,executionRuns=0
 const steps=new Map()
 const taskId='same-task-new-source',oldOperation='old-resume-do-not-replay',freshOperation='genuine-new-resume'
 const oldHandoff='Resume the first check.',freshHandoff='Check the newer time range, only read logs.'
 h=await residentRouterHost(t,async body=>{
  if(requestTools(body).includes('task_result')){
   executionRuns++
   if(executionRuns>1)assert.ok(requestText(body).some(text=>text.includes(freshHandoff)))
   return {tool:'task_result',args:{decision:{action:'wait',summary:'Verified with local fixture only',evidence:['Local check'],limitations:['No external actions']}}}
  }
  const input=requestEnvelope(body,'Router 请求：')
  if(!input)return {text:'No work'}
  const source=input.events.find(event=>event.source)?.source
  const key=input.events.map(event=>event.id).join(',')
  const step=steps.get(key)??0;steps.set(key,step+1)
  const settle={tool:'resident_router_settle',args:{operationId:'settle-'+key,eventIds:input.events.map(event=>event.id)}}
  if(!source)return step===0?settle:{text:'Settled internal event'}
  if(source.messageId==='create-before-unknown'){
   if(step===1)return settle
   if(step>1)return {text:'Initial task is tracked'}
   oldSource=source
   return {tool:'resident_task_plan',args:{operationId:'create-before-unknown',sourceId:source.sourceId,messageVersion:source.version,
    tasks:[{taskId,title:'Original log check',objective:'Read logs',requirements:['Only read'],handoff:'Read the initial logs only.'}],dependencies:[]}}
  }
  if(source.messageId!=='new-after-unknown')return {text:'Unexpected'}
  if(step===2)return settle
  if(step>2)return {text:'Fresh action tracked'}
  const task=await h.query('task.get',{taskId})
  const args={kind:'resume',taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision}
  if(step===0){
   const active=await h.query('router.get',{conversationId:input.conversationId})
   const actor=h.host.ctx.agents.get(active.activeSessionId)
   oldCallId='synthetic-unpaired-old-resume'
   actor.piSession.sessionManager.appendMessage({role:'assistant',content:[{type:'toolCall',id:oldCallId,name:'resident_task_action',
    arguments:{...args,operationId:oldOperation,sourceId:oldSource.sourceId,messageVersion:oldSource.version,handoff:oldHandoff}}],
    api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:1})
  }
  return {tool:'resident_task_action',args:{...args,operationId:step===0?oldOperation:freshOperation,sourceId:source.sourceId,messageVersion:source.version,handoff:freshHandoff}}
 },{strictModelDecisions:true})
 await h.receive(channelMessage('create-before-unknown'))
 await eventually(async()=>{const task=await h.query('task.get',{taskId});return task?.sessionBound&&task.drained&&task.lastDecision?.action==='wait'&&task},'first execution completed')
 firstSession=(await h.query('task.get',{taskId})).sessionId
 await h.receive(channelMessage('new-after-unknown',{senderId:'bob',text:'Read logs for the newer time range.'}))
 await eventually(()=>executionRuns===2,'genuinely new continuation starts')
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId})
 assert.equal(task.sessionId,firstSession)
 assert.deepEqual(task.metadata.routerHandoffs.map(row=>row.text),['Read the initial logs only.',freshHandoff])
 const decisions=h.results.filter(row=>row.name==='resident_task_action')
 assert.deepEqual(decisions.map(row=>Boolean(row.result.isError)),[true,false])
 assert.match(JSON.stringify(decisions[0].result),/ROUTER_PRIOR_EFFECT_UNRESOLVED/)
 const router=(await h.query('router.list'))[0],native=await h.host.ctx.sessionPersistence.readNative(router.activeSessionId,{requireComplete:true})
 assert.ok(native.entries.some(row=>row.type==='message'&&row.message.role==='assistant'&&row.message.content.some(block=>block.id===oldCallId)))
 assert.ok(!native.entries.some(row=>row.type==='message'&&row.message.role==='toolResult'&&row.message.toolCallId===oldCallId))
 assert.equal(h.sent.length,0)
})
