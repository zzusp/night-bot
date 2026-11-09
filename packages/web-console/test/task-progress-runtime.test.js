import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {memoryHost} from '../../../test/fixtures/memory-host.js'
import {eventually} from '../../../test/fixtures/resident-router-host.js'
import {apply as applyApplication,inject} from '../../../src/application.js'
import {createWebConsole} from '../server/plugin.js'

test('real task HTTP exposes running, actual tool receipt, completion and blocked question', {timeout:45000},async t=>{
 let release,entered=false,toolReturned=false,releaseResult
 const gate=new Promise(resolve=>release=resolve),resultGate=new Promise(resolve=>releaseResult=resolve)
 const f=await memoryHost(t,async body=>{
  if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
  if(!body.tools?.some(tool=>tool.function.name==='task_result'))return {text:'No extra work'}
  if(JSON.stringify(body.messages).includes('BLOCKED_RUNTIME'))return {tool:'task_result',args:{decision:{action:'blocked',summary:'缺少指定的核对输入',question:'请选择待核对的文件',evidence:['原始任务未指定文件'],limitations:[]}}}
  if(!entered){entered=true;await gate;return {tool:'memory_status',args:{}}}
  if(!toolReturned){toolReturned=true;await resultGate;return {tool:'task_result',args:{decision:{action:'complete',summary:'已读取当前授权记忆状态',evidence:['实际 memory_status 返回'],limitations:['仅本地隔离验证']}}}}
  return {text:'已完成'}
 })
 const config={...f.config,resident:{port:0,taskSessions:{instanceId:'task-progress',ownerActorId:'owner',webActorId:'owner',ingressEpoch:'2026-01-01T00:00:00Z',initialize:true,reasoningMode:'inherit'}}}
 let web
 try{
  await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,config)});const app=f.host.ctx.get('application')
  web=await createWebConsole({channels:f.host.ctx.channels,paths:f.host.ctx.runtimePaths,config:{channelId:'task-progress',senderId:'operator',port:0},getApplication:()=>app,getSessionPersistence:()=>f.host.ctx.sessionPersistence})
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0]
  const api=async path=>{const r=await fetch(web.origin+path,{headers:{origin:web.origin,cookie}});return {status:r.status,body:await r.json()}}
  const created=await app.tasks.createTask({requestId:'live-progress',title:'隔离实时状态验证',objective:'读取当前授权记忆状态，不执行外部请求'})
  await eventually(()=>entered,'task actually entered local HTTP model')
  const endpoint='/api/tasks/'+created.taskId
  const running=await api(endpoint);assert.equal(running.status,200);assert.equal(running.body.state,'running');assert.equal(running.body.session.status,'running');assert.equal(running.body.result,undefined)
  const live=await api(endpoint+'/session');assert.equal(live.status,200);assert.ok(['ready','pending'].includes(live.body.status));if(live.body.status==='pending')assert.equal(live.body.reason,'SESSION_COMMIT_PENDING')
  release();await eventually(()=>toolReturned,'real memory_status returned and next inference began')
  const afterTool=await api(endpoint+'/session');assert.equal(afterTool.status,200)
  if(afterTool.body.status==='ready')assert.ok(afterTool.body.items.some(row=>row.toolName==='memory_status'&&row.kind==='tool-result'))
  releaseResult();await app.tasks.whenIdle()
  const completed=await api(endpoint);assert.equal(completed.body.state,'completed');assert.equal(completed.body.session.status,'idle');assert.equal(completed.body.result.summary,'已读取当前授权记忆状态');assert.deepEqual(completed.body.blockers,[])
  const done=await api(endpoint+'/session');assert.equal(done.body.status,'ready');assert.ok(done.body.items.some(row=>row.kind==='tool-result'&&row.toolName==='memory_status'&&row.status==='completed'));assert.ok(done.body.items.some(row=>row.toolName==='task_result'&&row.text.includes('已读取当前授权记忆状态')))
  const count=f.requests.length;await api(endpoint);await api(endpoint+'/session');assert.equal(f.requests.length,count,'HTTP projections never run inference')
  const blocked=await app.tasks.createTask({requestId:'blocked-progress',title:'需要明确输入',objective:'BLOCKED_RUNTIME：未指定文件前不可继续'})
  await app.tasks.whenIdle();const blockedView=await api('/api/tasks/'+blocked.taskId);assert.ok(['blocked','waiting'].includes(blockedView.body.state),JSON.stringify(blockedView.body));assert.equal(blockedView.body.result.question,'请选择待核对的文件');assert.equal(blockedView.body.result.action,'blocked')
  t.diagnostic(JSON.stringify({running:running.body.state,liveSession:live.body.status,afterTool:afterTool.body.status,completed:completed.body.state,blocked:blockedView.body.state,publicRecords:done.body.total}))
 }finally{release();releaseResult();await web?.close()}
})
