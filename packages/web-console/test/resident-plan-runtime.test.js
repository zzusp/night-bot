import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from '../../../test/fixtures/resident-router-host.js'
import {nativeTestTimeout} from '../../../test/fixtures/native-lifecycle.js'
import {createWebConsole} from '../server/plugin.js'
import {mergeResidentPlan,planReceipt} from '../src/resident-tool-content.ts'

test('committed native Router plan yields a single readable authenticated receipt with exact dependency endpoints', {timeout:nativeTestTimeout(40000)}, async t=>{
 const tasks=[
  {taskId:'check-setup',title:'核对部署前置条件',objective:'确认环境适用性。',requirements:['先核对部署版本'],handoff:'确认环境适用性后反馈。'},
  {taskId:'review-result',title:'整理执行结论',objective:'汇总核对结果。',requirements:['登记处理结论'],handoff:'等待前置条件确认后汇总。'},
 ]
 const condition='前置条件完成且通过核对'
 let planned=false
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'前置条件已核对',evidence:[],limitations:[]}}}
  if(!tools.includes('resident_router_settle'))return {text:'Ready'}
  const request=requestEnvelope(body,'Router 请求：')
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  if(!planned){
   planned=true
   const source=request.events.find(event=>event.source).source
   return {tool:'resident_task_plan',args:{operationId:'fixture-plan',sourceId:source.sourceId,messageVersion:source.version,tasks,
    dependencies:[{taskId:tasks[1].taskId,prerequisiteTaskId:tasks[0].taskId,condition}]}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+request.events.map(event=>event.id).join(','),eventIds:request.events.map(event=>event.id)}}
 },{strictModelDecisions:true})
 const source=channelMessage('readable-plan')
 await h.receive(source)
 await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(source).sessionId
 const web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'resident-plan-fixture',senderId:'fixture-operator',port:0},
  getApplication:()=>({config:{channelPlugins:[]},tasks:h.service}),getSessionPersistence:()=>h.host.ctx.sessionPersistence})
 try {
  const endpoint=web.origin+'/api/conversations/'+encodeURIComponent(conversationId)+'/session'
  const headers={origin:web.origin}
  assert.equal((await fetch(endpoint+'?stream=1',{headers})).status,401)
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
  assert.equal(login.status,200)
  headers.cookie=login.headers.get('set-cookie').split(';')[0]
  const response=await fetch(endpoint+'?stream=1',{headers})
  assert.equal(response.status,200)
  const page=await response.json()
  const [call,output]=page.items.filter(row=>row.toolName==='resident_task_plan')
  assert.equal(output.isError,false,output.text)
  const receipt=planReceipt(output)
  assert.ok(receipt,'supported projection: '+output.text)
  const plan=mergeResidentPlan(call,output)
  assert.ok(plan,'native result should combine with the same exact public input: '+call.text+' / '+output.text)
  assert.deepEqual(plan.tasks.map(row=>row.title),tasks.map(row=>row.title))
  assert.deepEqual(plan.dependencies.map(dependency=>[dependency.prerequisiteTitle,dependency.taskTitle,dependency.condition]),[[tasks[0].title,tasks[1].title,condition]])
  const settle=page.items.find(row=>row.toolName==='resident_router_settle' && row.kind==='tool-result')
  assert.equal(JSON.parse(settle.text).settled,true,settle.text)
 } finally {await web.close()}
})
