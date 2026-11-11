import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {atomicWrite} from '../src/runtime/files.js'
import {memoryScope} from '../src/memory/scope.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'

test('retrospective skill publication during Router assessment preserves one admitted batch and drains four later messages',{timeout:nativeTestTimeout(90000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 let armed=false,raced=false,taskTurns=0,reviewTurns=0,completionEvent,routerSessionId
 const queried=new Set(),batches=new Map()
 const h=await residentRouterHost(t,async body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION'))){
   reviewTurns++
   return {text:JSON.stringify({lessons:[{key:'verify',summary:'Verify the current local result.',why:'The completed task supplies direct evidence.',howToApply:'Read current task evidence before assessment.',evidenceIds:[completionEvent.id],skill:{steps:['Read the completed task evidence before assessment'],reason:'Retain current completion evidence',applicability:'Assessment of completed local tasks',evidenceBacked:true}}]})}
  }
  const names=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：')
  if(names.includes('channel_triage_submit'))return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Handle the authenticated request'}))}}
  const handoff=requestEnvelope(body,'Router 交接请求：')
  if(!names.length&&handoff)return {text:JSON.stringify({currentIntent:'Retain original task and later message references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(names.includes('task_result')){taskTurns++;return {tool:'task_result',args:{decision:{action:'complete',summary:'Local verification completed',evidence:['fixture:verified'],limitations:[]}}}}
  if(names.includes('resident_router_settle')){
   assert.ok(!h.results.at(-1)?.result.isError,JSON.stringify(h.results.at(-1)))
   const input=requestEnvelope(body,'Router 请求：');assert.ok(input);const key=input.events.map(event=>event.id).join(',')
   batches.set(key,input)
   const task=await h.query('task.get',{taskId:'skill-race-task'})
   if(!task){const source=input.events.find(event=>event.source)?.source;return {tool:'resident_task_plan',args:{operationId:'skill-race-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'skill-race-task',title:'Verify local evidence',objective:'Verify the local synthetic evidence',requirements:['Verify current evidence']}],dependencies:[]}}}
   const completed=input.events.find(event=>event.taskEvent?.kind==='task.completed')
   if(completed&&!queried.has(completed.id)){
    queried.add(completed.id);completionEvent=completed.taskEvent;armed=true
    routerSessionId=(await h.query('router.get',{conversationId:input.conversationId})).activeSessionId
    return {tool:'resident_task_query',args:{taskId:task.taskId}}
   }
   if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Batch disposition committed'}
   return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'skill-race-settle:'+key}}
  }
  return {text:'No additional work'}
 },{hostOptions:{hostConfig:{reflection:{enabled:false}}}})
 const reflection=h.host.ctx.reflection,scope=memoryScope({actorId:'fixture'}),store=h.host.ctx.memory.store
 await store.remember(scope,{topic:'experience',key:'seed',text:'Initial local verification evidence',source:{sessionId:'seed-session',messageId:'seed-message'}})
 await atomicWrite(join(reflection.directory(scope),'state.json'),JSON.stringify({version:1,reviews:{},skills:{verify:{active:true,supports:[{taskId:'seed',memoryKey:'seed'}],taskIds:['seed'],memoryKeys:['seed'],steps:['Read local evidence'],applicability:'Local verification',revision:1}}}))
 h.host.ctx.skills.invalidateCache()
 const original=reflection.skill.bind(reflection)
 reflection.skill=async(candidate,actor)=>{
  const value=await original(candidate,actor)
  if(armed&&!raced&&actor?.metadata.runtimeOwner==='conversation-router'){
   raced=true;entered.resolve();await release.promise
   await h.host.ctx.agents.withoutInitiator(()=>reflection.review({store:h.store,ownerActorId:'owner',model:h.config.model},completionEvent))
   assert.equal(reflection.lastError,null,'the real retrospective must publish successfully')
  }
  return value
 }
 const first=channelMessage('skill-race-original'),conversationId=h.host.ctx.channels.identity(first).sessionId
 await h.receive(first)
 await Promise.race([entered.promise,h.service.whenIdle().then(()=>assert.fail('Router finished before the deterministic resource race'))])
 try{
  for(let index=0;index<4;index++)await h.receive(channelMessage('skill-race-later-'+index))
  await eventually(async()=> (await h.query('router.inbox',{conversationId})).filter(event=>event.source?.messageId.startsWith('skill-race-later-')).length===4,'all four later messages queued behind the admitted assessment',t.signal)
 }finally{release.resolve()}
 await h.service.whenIdle()
 assert.equal(raced,true);assert.equal(taskTurns,1);assert.equal(reviewTurns,1)
 assert.equal((await h.query('task.get',{taskId:'skill-race-task'})).status,'completed')
 assert.equal((await h.query('router.inbox',{conversationId})).length,0)
 assert.equal(h.results.filter(result=>result.name==='resident_task_query'&&!result.result.isError).length,1,'the completed query tool must not be replayed')
 const journal=await h.host.ctx.sessionPersistence.readNative(routerSessionId,{requireComplete:true})
 const inputs=journal.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.source.kind==='conversation-router')
 assert.ok(inputs.length>=2,'the assessment and queued later inputs use separate original admissions')
 for(const input of inputs){
  const id=input.details.packetId
  assert.equal(inputs.filter(entry=>entry.details.packetId===id).length,1)
  assert.equal(journal.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted'&&row.payload.id===id).length,1)
 }
 assert.ok(!journal.entries.some(entry=>entry.type==='message'&&entry.message.role==='assistant'&&['aborted','error'].includes(entry.message.stopReason)))
 assert.ok(!journal.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-claim'),'resource refresh does not create another business turn')
 assert.equal((await reflection.state(scope)).skills.verify.revision,2,'the raced retrospective actually published a new learned skill revision')
 assert.ok([...batches.values()].some(batch=>batch.events.some(event=>event.source?.messageId==='skill-race-later-3')))
 assert.equal(h.sent.length,0);assert.ok(!h.service.listAlerts().some(alert=>alert.detail==='ROUTER_BATCH_UNSETTLED'))
 const requests=h.requests.length
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,requests,'cold recovery must not replay completed task, review or Router effects')
})
