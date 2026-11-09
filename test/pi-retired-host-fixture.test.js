import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {nativeTaskHost} from './fixtures/task-session-native-host.js'

test('shared business fixture uses the actual official Single with no legacy Session or model service', {timeout:nativeTestTimeout(15000)}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-retired-host-'))
 let handle
 t.after(async()=>{try{await handle?.close()}finally{await rm(root,{recursive:true,force:true})}})
 handle=await nativeTaskHost(root,request=>{
  const tools=request.tools.map(tool=>tool.name)
  assert.ok(tools.includes('task_result'))
  for(const name of ['task_delegate','execution_submit','subagent_spawn'])assert.ok(!tools.includes(name))
  return[{name:'task_result',args:{decision:{action:'complete',summary:'已核对官方会话',evidence:['真实业务输入'],limitations:[]}}}]
 })
 for(const service of ['sessions','llm','sessionQuery','sessionTitle'])assert.equal(handle.ctx.get(service),undefined)
 const created=await handle.service.createTask({groupId:'native-group',requestId:'official-shared-fixture',objective:'验证同一任务的原生官方会话'})
 await handle.service.whenIdle()
 const task=await handle.query('task.get',{taskId:created.taskId})
 assert.equal(task.status,'completed',JSON.stringify(handle.service.listAlerts()))
 assert.equal(handle.requests.filter(request=>request.tools.some(tool=>tool.name==='task_result')).length,1)
 assert.deepEqual(await handle.query('execution.list',{taskId:created.taskId}),[])
 const router=await handle.query('router.get',{conversationId:'native-group'})
 assert.deepEqual(handle.ctx.agents.list().map(actor=>actor.id),router?[router.activeSessionId]:[])
 assert.ok(!handle.ctx.agents.list().some(actor=>actor.id===task.sessionId))
 const logs=await handle.ctx.sessionPersistence.list()
 assert.ok(logs.some(log=>log.format==='pi-native-v1'))
})
