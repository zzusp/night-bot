import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from '../../../test/fixtures/resident-router-host.js'
import {readFile} from 'node:fs/promises'
import {createWebConsole} from '../server/plugin.js'
import {routerSessionView} from '../server/session-view.js'

test('persistent idle Router retains committed business history across messages',async t=>{
 let releaseTask,taskEntered=false;const taskGate=new Promise(resolve=>releaseTask=resolve)
 const h=await residentRouterHost(t,async body=>{
  if(requestTools(body).includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(message=>({sourceId:message.sourceId,messageVersion:message.version??message.messageVersion,needsHandling:true,reason:'real Router execution projection'}))}}}
  if(requestTools(body).includes('resident_router_settle')){const input=requestEnvelope(body,'Router 请求：');if(body.messages.at(-1)?.role==='tool')return {text:'安排已提交'};return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.eventId).join(',')}}}
  if(requestTools(body).includes('task_result')){taskEntered=true;await taskGate;return {tool:'task_result',args:{decision:{action:'complete',summary:'真实渠道任务已核对',evidence:['隔离实例完成回执'],limitations:[]}}}}
  return {text:'No task requested'}
 })
 const input=channelMessage('router-web-runtime',{text:'请处理真实隔离运行的安排记录'});await h.receive(input);await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(input).sessionId,router=await h.query('router.get',{conversationId}),rotations=await h.query('router.rotations',{conversationId})
 const options={conversationId,readRouter:()=>h.query('router.get',{conversationId}),readRotations:()=>h.query('router.rotations',{conversationId}),persistence:h.host.ctx.sessionPersistence}
 const page=await routerSessionView(options)
 assert.deepEqual(rotations,[]);assert.equal(router.generation,1)
 const snapshot=await h.host.ctx.sessionPersistence.readNative(router.activeSessionId,{requireComplete:true})
 assert.equal(page.scope,'current-router-session-context');assert.equal(page.sessionId,router.activeSessionId);assert.equal(page.generation,router.generation)
 assert.ok(page.items.some(row=>row.text===input.text),'current Router exposes the first source')
 await assert.rejects(routerSessionView({...options,revision:'wrong'}),{code:'SESSION_PAGE_STALE'})
 await assert.rejects(routerSessionView({...options,readRouter:async()=>({...router,id:'foreign'})}),{code:'SESSION_IDENTITY_INVALID'})
 const followup=channelMessage('router-web-runtime-next',{text:'继续核对刚才的安排记录'})
 await h.receive(followup);await h.service.whenIdle()
 const continued=await h.query('router.get',{conversationId}),nextPage=await routerSessionView(options)
 assert.equal(continued.activeSessionId,router.activeSessionId);assert.equal(continued.generation,router.generation)
 assert.deepEqual(await h.query('router.rotations',{conversationId}),[])
 for(const source of [input,followup])assert.ok(nextPage.items.some(row=>row.text===source.text),'same session retains both source messages')
 await assert.rejects(routerSessionView({...options,revision:page.revision}),{code:'SESSION_PAGE_STALE'})
 const web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'web-runtime',senderId:'operator',port:0},getApplication:()=>({config:{channelPlugins:[]},tasks:h.service}),getSessionPersistence:()=>h.host.ctx.sessionPersistence})
 try {
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0]
  const api=async path=>{const r=await fetch(web.origin+path,{headers:{origin:web.origin,cookie}});return {status:r.status,body:await r.json()}}
  const root='/api/conversations/'+conversationId
  const actual=await api(root+'/session');assert.equal(actual.status,200);assert.equal(actual.body.scope,'current-router-session-context');assert.ok(actual.body.items.length>0)
  const created=await h.service.createTask({requestId:'scoped-runtime-task',title:'真实渠道任务',objective:'只核对本地输入',channel:input})
  await eventually(()=>taskEntered,'scoped task entered real model')
  const running=await api(root+'/tasks/'+created.taskId);assert.equal(running.status,200);assert.equal(running.body.state,'running');assert.equal(running.body.session.status,'running')
  const live=await api(root+'/tasks/'+created.taskId+'/session');assert.equal(live.status,200);assert.ok(['ready','pending'].includes(live.body.status))
  releaseTask();await h.service.whenIdle()
  const summary=await api(root+'/tasks/'+created.taskId);assert.equal(summary.status,200);assert.equal(summary.body.state,'completed');assert.equal(summary.body.result.summary,'真实渠道任务已核对')
  const history=await api(root+'/tasks/'+created.taskId+'/session');assert.equal(history.status,200);assert.equal(history.body.status,'ready');assert.ok(history.body.items.some(row=>row.toolName==='task_result'))
  const list=await api(root+'/tasks');assert.ok(list.body.taskIds.includes(created.taskId))
  assert.equal((await api('/api/conversations/foreign/tasks/'+created.taskId)).status,404)
  assert.equal((await api(root+'/tasks/foreign')).status,404)
 } finally {releaseTask();await web.close()}
 assert.ok(snapshot.context.projection.entries.length>0);assert.ok(page.items.length>0,'Web must retain committed arrangements in the persistent Router session')
})
