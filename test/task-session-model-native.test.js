import {nativeLifecycle,nativeLifecycleTimeout,nativeTemporaryDirectory as mkdtemp,nativeRemove as rm} from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {nativeRuntimeHost} from './fixtures/runtime-official-host.js'
import {createSingleTaskSessions} from '../src/tasks/single-session.js'
import {installTaskSessionPersistence} from '../packages/dingtalk-core/task-session-persistence.js'
import {taskWorkspace} from '../packages/dingtalk-core/session-workspaces.js'
const decision={action:'wait',summary:'等待原任务资料',evidence:[],limitations:[]}
const calls=()=>[{name:'task_result',args:{decision}}]

test('single task model selection resolves exact configured IDs and rejects guessed aliases',{timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'task-model-routes-')),h=await nativeRuntimeHost(root,calls,{resident:true,models:['explicit-model']})
 t.after(async()=>{try{await h.close()}finally{await rm(root,{recursive:true,force:true})}})
 const provider=h.ctx.get('nativePiProvider').official,credentials=h.ctx.get('credentials'),resolve=model=>provider.resolve({provider:'native-task-test',model},{credentials})
 assert.equal((await resolve('controlled')).model.id,'controlled');assert.equal((await resolve('explicit-model')).model.id,'explicit-model')
 for(const model of ['astra',' explicit-model ','missing'])await assert.rejects(resolve(model),{code:'UNKNOWN_MODEL'})
 assert.equal(h.requests.length,0)
})

test('single native task create and resume use the current exact model on one original session; invalid routes cannot mutate its journal',{timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
 const root=await mkdtemp(join(tmpdir(),'task-model-native-')),h=await nativeRuntimeHost(root,calls,{resident:true,models:['alternate-a','alternate-b']})
 const workspaceRoot=h.ctx.runtimePaths.workspaces,persistence=await installTaskSessionPersistence(h.ctx,{root:workspaceRoot}),cwd=await taskWorkspace(workspaceRoot,'model-task')
 const sessions=createSingleTaskSessions({ctx:h.ctx,isCurrent:async()=>true,getWorkspaceDir:async({binding})=>{await persistence.register({taskId:'model-task',sessionId:binding.sessionId,cwd});return cwd},withPersistenceWriter:(binding,action)=>persistence.runOwned(binding,action)})
 t.after(async()=>{try{await sessions.close();await h.close()}finally{await rm(root,{recursive:true,force:true})}})
 await t.beginBusiness();let bound=0
 const run=(model,leaseEpoch,sessionBound=true,sessionId='original-model-session',provider='native-task-test',reasoningEffort)=>sessions.run({binding:{taskId:'model-task',sessionId,leaseEpoch,sessionBound,requirementRevision:1,controlRevision:1,contextRevision:0},provider,model,reasoningEffort,input:{task:{title:'原任务',objective:'核对精确模型'},sources:[],materials:[],blockers:[]},onSessionBound:async()=>{bound++},submit:async()=>({accepted:true})})
 for(const [index,model]of ['controlled','alternate-a','alternate-b'].entries())assert.equal((await t.step(()=>run(model,index+1,index!==0))).status,'submitted')
 assert.deepEqual(h.requests.map(r=>r.model),['controlled','alternate-a','alternate-b'])
 const before=await h.ctx.sessionPersistence.readNative('original-model-session')
 assert.equal(before.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1)
 await assert.rejects(run('missing',4),{code:'UNKNOWN_MODEL'})
 await assert.rejects(run('missing',4,false,'never-created'),{code:'UNKNOWN_MODEL'})
 assert.equal(h.ctx.agents.get('never-created'),undefined);assert.equal(h.ctx.sessions.get('never-created'),undefined)
 await assert.rejects(run('controlled',4,true,'original-model-session','missing-provider'),{code:'NO_ADAPTER'})
 await assert.rejects(run('controlled',4,true,'original-model-session','native-task-test','high'),{code:'UNSUPPORTED_REASONING_EFFORT'})
 const after=await h.ctx.sessionPersistence.readNative('original-model-session')
 assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.audit,before.audit);assert.equal(bound,3);assert.equal(h.requests.length,3)
 assert.equal(h.ctx.agents.get('original-model-session'),undefined)
}))

for(const configured of [undefined,'explicit-task'])test(`service uses one configured execution model without an Owner or child session: ${configured??'default'}`,{timeout:nativeLifecycleTimeout(20000)},nativeLifecycle(20000,async t=>{
 const root=await mkdtemp(join(tmpdir(),'task-model-service-'));let h
 t.after(async()=>{try{await h?.close()}finally{await rm(root,{recursive:true,force:true})}})
 h=await nativeRuntimeHost(root,async request=>{
  const names=request.tools.map(tool=>tool.name)
  assert.ok(names.includes('task_result'));assert.ok(!names.includes('task_delegate'));assert.ok(!names.includes('execution_submit'))
  assert.ok(!names.some(name=>name.startsWith('subagent')))
  return[{name:'task_result',args:{decision:{action:'complete',summary:'已核对',evidence:['原任务资料已核验'],limitations:[]}}}]
 },{models:configured?[configured]:[],config:{provider:'native-task-test',model:configured??'controlled'}})
 await t.beginBusiness()
 const created=await h.service.createTask({groupId:'native-group',requestId:'model-selection',objective:'核对唯一执行模型'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId})
 assert.equal(task.status,'completed',JSON.stringify(h.service.listAlerts()));assert.equal(h.requests.length,1)
 assert.equal(h.requests[0].model,configured??'controlled');assert.equal(h.requests[0].provider,'native-task-test')
 assert.deepEqual(await h.query('execution.list',{taskId:created.taskId}),[])
 assert.equal(h.toolResults.filter(row=>row.name==='task_result').length,1)
}))
