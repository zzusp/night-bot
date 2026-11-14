// 未决作业故意保留 owner；独立进程承载故障，不能伪造终态来完成测试清理。
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {memoryHost} from './memory-host.js'
import {apply as applyApplication,inject} from '../../src/application.js'
import {createWebConsole} from '../../packages/web-console/server/plugin.js'
let web
try{
 let calls=0,owner
 const f=await memoryHost({after(){}},body=>{
  if(body.tools?.some(tool=>tool.function.name==='task_result')){calls++;return {tool:'drain_failure_probe',args:{}}}
  return {text:'fixture'}
 })
 process.send({root:f.root})
 f.host.ctx.get('tools').register({name:'drain_failure_probe',description:'Fixture crash after durable registration, before any producer launch',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){
  owner=exec.agent
  const identity=f.host.ctx.get('tools').executionIdentity(exec)
  owner.receipts.append({version:1,domain:'job',kind:'registered',payload:{version:1,jobId:'fixture-unresolved-job',owner:owner.id,kind:'fixture',label:'PRIVATE_FAULT_DETAILS',startedAt:Date.now(),toolCall:{callId:identity.callId,rootCallId:identity.rootCallId,toolName:identity.name},state:'admitted'}})
  await owner.receipts.commit()
  return {registered:true}
 }})
 const config={...f.config,resident:{port:0,taskSessions:{instanceId:'drain-state-fixture',ownerActorId:'operator',webActorId:'operator',ingressEpoch:'2026-01-01T00:00:00Z',initialize:true,reasoningMode:'inherit'}}}
 await f.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,config)})
 const app=f.host.ctx.get('application')
 web=await createWebConsole({channels:f.host.ctx.channels,paths:f.host.ctx.runtimePaths,config:{channelId:'drain-state-fixture',senderId:'operator',port:0},getApplication:()=>app,getSessionPersistence:()=>f.host.ctx.sessionPersistence})
 const created=await app.tasks.createTask({requestId:'drain-failure',title:'排空故障隔离验收',objective:'Run the fixture probe exactly once; never launch a producer.'})
 await app.tasks.whenIdle()
 const task=await app.tasks.taskDetail(created.taskId)
 assert.equal(task.state,'waiting');assert.equal(task.session.status,'failed');assert.equal(task.drained,false)
 assert.equal(task.sessionFailure.code,'TASK_SESSION_DRAIN_FAILED');assert.equal(task.lastDecision??null,null)
 const journal=await f.host.ctx.sessionPersistence.readNative(task.session.sessionId,{requireComplete:true})
 assert.equal(journal.audit.filter(r=>r.domain==='job'&&r.kind==='registered').length,1)
 assert.equal(journal.audit.filter(r=>r.domain==='job'&&r.kind==='settled').length,0)
 assert.match(JSON.stringify(journal.entries),/NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY/)
 await assert.rejects(f.host.ctx.jobs.assertCanRun(owner),{code:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY'})
 const before=calls;await app.tasks.recover();await app.tasks.whenIdle();assert.equal(calls,before)
 const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
 assert.equal(login.status,200)
 const cookie=login.headers.get('set-cookie').split(';')[0],api=async path=>{const response=await fetch(web.origin+path,{headers:{origin:web.origin,cookie}});assert.equal(response.status,200);return response.json()}
 const detail=await api('/api/tasks/'+created.taskId),waiting=await api('/api/tasks?state=waiting'),running=await api('/api/tasks?state=running')
 assert.equal(detail.state,'waiting');assert.equal(detail.session.status,'failed')
 assert.equal(detail.blockers.find(b=>b.kind==='session').status,'failed');assert.match(detail.blockers[0].title,/排空失败/)
 assert.doesNotMatch(JSON.stringify(detail),/PRIVATE_FAULT_DETAILS|fixture-unresolved-job/)
 assert.ok(waiting.items.some(t=>t.taskId===created.taskId));assert.ok(!running.items.some(t=>t.taskId===created.taskId))
 const wakes=await app.tasks.store.query({kind:'wake.list',taskId:created.taskId});assert.ok(wakes.some(w=>w.state==='claimed'))
 let browserVerified=false
 if(process.argv.includes('--browser')){
  const {createRequire}=await import('node:module'),{chromium}=createRequire(new URL('../../packages/web-console/package.json',import.meta.url))('@playwright/test')
  const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{})
  try{
   const page=await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN'})
   await page.goto(web.origin+'/#/tasks/'+created.taskId)
   await page.getByLabel('访问令牌',{exact:true}).fill((await readFile(web.credentialPath,'utf8')).trim())
   await page.getByRole('button',{name:'连接工作空间',exact:true}).click()
   await page.goto(web.origin+'/#/tasks/'+created.taskId)
   await page.locator('.blockers').getByText(/执行会话排空失败/).waitFor()
   assert.equal(await page.locator('.task-facts').getByText('等待中',{exact:true}).count(),1)
   assert.equal(await page.locator('.agent-progress.is-running').count(),0)
   await page.getByRole('navigation',{name:'任务信息分类'}).getByRole('link',{name:'执行',exact:true}).click()
   await page.locator('.task-execution-states').getByText('失败',{exact:true}).waitFor()
   await page.screenshot({path:'docs/acceptance/task-recovery-state/browser-final.png',fullPage:true})
   browserVerified=true
  }finally{await browser.close()}
 }
 process.send({passed:true,browserVerified,modelCalls:calls,state:detail.state,session:detail.session.status,drained:task.drained,noReplay:true,unacked:true})
 await web.close();process.exit(0)
}catch(error){console.error(error);await web?.close();process.exit(1)}
