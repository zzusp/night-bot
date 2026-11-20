import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const action of ['complete','blocked','wait','runtime-failure'])test('execution final-only Router delivery: '+action,{timeout:nativeTestTimeout(30000)},async t=>{
 let h,planned=false,replied=false,source,executions=0
 const terminal=new Set(),inspections=new Set(),reports=action==='complete'||action==='blocked'
 const summary=action==='blocked'?'Stopped: no trusted target was supplied':'Verified synthetic outcome'
 const evidence=['Synthetic material checked'],limitations=action==='blocked'?['Target unavailable; no side effects performed','TASK_EFFECT_UNCERTAIN_NO_REPLAY']:[]
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(tools.includes('task_result')){
   executions++
   const schema=body.tools.find(tool=>tool.function.name==='task_result').function.parameters.properties.decision.properties
   assert.equal(schema.question,undefined);assert.equal(schema.audience,undefined)
   if(action==='runtime-failure')return {text:'No decision submitted'}
   return {tool:'task_result',args:{decision:{action,summary,evidence,limitations}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  source??=input.events.find(event=>event.source)?.source
  if(!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'final-only-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'final-only-task',title:'Synthetic bounded check',objective:'Check provided synthetic material',requirements:['No external changes'],handoff:'Read the test material without making external changes. Do not send an attachment.'}],dependencies:[]}}}
  for(const event of input.events)if(['task.completed','task.blocked','task.waiting'].includes(event.kind))terminal.add(event.id)
  for(const event of input.events)if(event.kind==='task.inspection')inspections.add(event.id)
  const outcome=input.events.find(event=>event.kind==='task.completed'||event.kind==='task.blocked')
  if(outcome&&!replied){
   replied=true
   assert.equal(outcome.taskEvent.result.summary,summary)
   if(action==='blocked'){
    assert.equal(outcome.taskEvent.resultSource,'pi-task-result')
    assert.deepEqual(outcome.taskEvent.result.evidence,evidence)
    assert.deepEqual(outcome.taskEvent.result.limitations,limitations)
   }
   return {tool:'resident_router_reply',args:{operationId:'final-only-reply',sourceId:source.sourceId,messageVersion:source.version,replyPurpose:'task-update',text:outcome.taskEvent.result.summary}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('final-only',{text:'Assistant, check this synthetic material. Do not modify external systems or send an attachment.'}));await h.service.whenIdle()
 assert.equal(executions,1);assert.equal(terminal.size,reports?1:0);assert.equal(h.sent.length,reports?1:0)
 if(reports)assert.equal(h.sent[0].text,summary)
 const task=await h.query('task.get',{taskId:'final-only-task'})
 assert.equal(task.drained,true);assert.equal(task.status,action==='complete'?'completed':'active');assert.equal(task.humanRequests?.length??0,0)
 if(action==='runtime-failure'){
  assert.equal(inspections.size,1)
  assert.equal(task.lastDecision.resultSource,undefined)
  assert.equal(task.technicalFailure.code,'TASK_SESSION_NO_SUBMISSION')
 }else if(action!=='complete')assert.equal(task.lastDecision.resultSource,'pi-task-result')
 assert.equal((await h.query('notification.list')).filter(item=>item.kind==='question').length,0)
 const count=h.requests.length,sent=h.sent.length
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,count);assert.equal(h.sent.length,sent)
})
