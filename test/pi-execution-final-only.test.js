import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const action of ['complete','blocked','wait'])test('execution final-only Router delivery: '+action,{timeout:nativeTestTimeout(30000)},async t=>{
 let h,planned=false,replied=false,source,executions=0
 const terminal=new Set(),summary=action==='blocked'?'Stopped: no trusted target was supplied':'Verified synthetic outcome'
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(requestText(body).some(text=>text.includes('NIGHT_BOT_TASK_REFLECTION')))return {text:'{"lessons":[]}'}
  if(tools.includes('task_result')){
   executions++
   const schema=body.tools.find(tool=>tool.function.name==='task_result').function.parameters.properties.decision.properties
   assert.equal(schema.question,undefined);assert.equal(schema.audience,undefined)
   return {tool:'task_result',args:{decision:{action,summary,evidence:['Synthetic material checked'],limitations:action==='blocked'?['Target unavailable; no side effects performed']:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const input=requestEnvelope(body,'Router 请求：')
  source??=input.events.find(event=>event.source)?.source
  if(!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'final-only-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'final-only-task',title:'Synthetic bounded check',objective:'Check provided synthetic material',requirements:['No external changes']}],dependencies:[]}}}
  for(const event of input.events)if(['task.completed','task.blocked','task.waiting'].includes(event.kind))terminal.add(event.id)
  if(terminal.size&&!replied){replied=true;return {tool:'resident_router_reply',args:{operationId:'final-only-reply',sourceId:source.sourceId,messageVersion:source.version,replyPurpose:'task-update',text:summary}}}
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('final-only',{text:'Assistant, check this synthetic material. Do not modify external systems.'}));await h.service.whenIdle()
 assert.equal(executions,1);assert.equal(terminal.size,action==='wait'?0:1);assert.equal(h.sent.length,action==='wait'?0:1)
 const task=await h.query('task.get',{taskId:'final-only-task'})
 assert.equal(task.drained,true);assert.equal(task.status,action==='complete'?'completed':'active');assert.equal(task.humanRequests?.length??0,0)
 assert.equal((await h.query('notification.list')).filter(item=>item.kind==='question').length,0)
 const count=h.requests.length,sent=h.sent.length
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,count);assert.equal(h.sent.length,sent)
})
