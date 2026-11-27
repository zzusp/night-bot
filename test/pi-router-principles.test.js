import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'

test('resident Router reads private principles at the next run; execution remains independent',{timeout:nativeTestTimeout(45000)},async t=>{
 const initial='PRIVATE_ROUTER_PRINCIPLES_INITIAL',updated='PRIVATE_ROUTER_PRINCIPLES_UPDATED',execution='PRIVATE_EXECUTION_PRINCIPLES'
 const routerPrompts=new Map(),executionPrompts=[]
 let settings,routerVersion,published
 const system=request=>JSON.stringify(request.messages.filter(message=>['system','developer'].includes(message.role)))
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body),prompt=system(body)
  if(tools.includes('task_result')){
   executionPrompts.push(prompt)
   return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic result',evidence:[],limitations:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No external work'}
  const {events}=requestEnvelope(body,'Router 请求：')
  const id=events.find(event=>event.source)?.source?.messageId
  if(id){
   const seen=routerPrompts.get(id)??[]
   seen.push(prompt);routerPrompts.set(id,seen)
   if(id==='one'&&seen.length===1)published=await settings.saveRouterPrinciples({text:updated,expectedVersion:routerVersion})
  }
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Current batch settled'}
  return {tool:'resident_router_settle',args:{eventIds:events.map(event=>event.id),operationId:'settle:'+events.map(event=>event.id).join(','),
   noTaskDispositions:events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'context-only',reason:'This source is context only and requests no task.',sourceQuote:event.source.text}))}}
 },{strictModelDecisions:true})
 settings=h.host.ctx.get('operatorSettings')
 routerVersion=(await settings.saveRouterPrinciples({text:initial,expectedVersion:(await settings.routerPrinciples()).version})).version
 await settings.saveExecutionPrinciples({text:execution,expectedVersion:(await settings.executionPrinciples()).version})
 const fixtureMessage=id=>channelMessage(id,{text:'Synthetic context only, no task requested. '+id})
 const first=fixtureMessage('one'),conversationId=h.host.ctx.channels.identity(first).sessionId
 await h.receive(first);await h.service.whenIdle()
 const row=await h.query('router.get',{conversationId})
 assert.ok(row.activeSessionId)
 assert.ok(routerPrompts.get('one')?.length>=2,'Router ran another request after a tool in the same run')
 for(const prompt of routerPrompts.get('one')){assert.ok(prompt.includes(initial));assert.ok(!prompt.includes(updated))}
 await h.receive(fixtureMessage('two'));await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
 assert.ok(routerPrompts.get('two')?.length)
 for(const prompt of routerPrompts.get('two')){assert.ok(prompt.includes(updated));assert.ok(!prompt.includes(initial))}
 await settings.saveRouterPrinciples({text:' \n',expectedVersion:published.version})
 await h.receive(fixtureMessage('three'));await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
 assert.ok(routerPrompts.get('three')?.length)
 for(const prompt of routerPrompts.get('three'))assert.ok(!prompt.includes(initial)&&!prompt.includes(updated))
 for(const prompt of [...routerPrompts.values()].flat()){
  assert.ok(!prompt.includes(execution))
  assert.equal(prompt.match(/NIGHT_CONTEXT_RETENTION/g)?.length??0,1,'every Router request carries one copy of the retention policy')
 }
 const task=await h.service.createTask({requestId:'isolated-execution',objective:'Return synthetic result'})
 await eventually(async()=>{const row=await h.query('task.get',{taskId:task.taskId});return row.status==='completed'&&row.drained},'standalone execution')
 assert.ok(executionPrompts.length)
 for(const prompt of executionPrompts){
  assert.ok(prompt.includes(execution)&&!prompt.includes(initial)&&!prompt.includes(updated))
  assert.equal(prompt.match(/NIGHT_CONTEXT_RETENTION/g)?.length??0,1,'execution still carries its one copy')
 }
})
