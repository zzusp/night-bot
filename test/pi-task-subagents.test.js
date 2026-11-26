import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {latestInput,modelToolValues} from './fixtures/routing-official-model.js'
import {nativeTaskHost} from './fixtures/task-session-native-host.js'
import {symlink} from './fixtures/filesystem-link.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

const call=(name,args)=>({name,args})
const conclude=summary=>[call('task_result',{decision:{action:'complete',summary,evidence:[],limitations:[]}})]
const delegate=(args)=>call('task_subagent',args)

test('real Pi execution can start two scoped helpers, work independently, then join only their conclusions', {timeout:nativeTestTimeout(20000)},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-task-subagent-'))
 let h; t.after(async()=>{try{await h?.close()}finally{await rm(root,{recursive:true,force:true})}})
 const both=Promise.withResolvers(),independent=Promise.withResolvers()
 const helperCalls=new Set(),helperIds=new Set();let parentCalls=0
 h=await nativeTaskHost(root,async(request,_,signal)=>{
  const input=latestInput(request)
  if(input.kind==='task-subagent'){
   assert.doesNotMatch(JSON.stringify(request.messages),/PARENT_HIDDEN_OBJECTIVE|sole execution session/)
   assert.doesNotMatch(JSON.stringify(input),/PARENT_HIDDEN_OBJECTIVE/)
   const names=request.tools.map(tool=>tool.name)
   assert.ok(names.includes('find'),JSON.stringify(names))
   for(const name of ['task_subagent','task_result','task_milestone_notify','write','edit','bash','memory_read','memory_write','web_fetch','platform_schedule_list','run_code'])assert.ok(!names.includes(name),JSON.stringify(names))
   const result=request.messages.findLast(row=>row.role==='toolResult')
   if(!result){
    helperCalls.add(input.goal)
    if(helperCalls.size===2)both.resolve()
    await both.promise
    await independent.promise
    return [call('find',{path:'.',pattern:'**/*'})]
   }
   assert.equal(result.isError,false,JSON.stringify(request.messages))
   return {text:'verified '+input.goal}
  }
  if(!request.tools.some(tool=>tool.name==='task_result'))return []
  if(++parentCalls===1)return [delegate({action:'start',assignments:[{goal:'check-1'},{goal:'check-2',context:'inspect task material'}]})]
  if(parentCalls===2){
   const ids=modelToolValues(request).findLast(value=>value.ids)?.ids
   assert.equal(ids.length,2,JSON.stringify(request.messages));ids.forEach(id=>helperIds.add(id))
   await Promise.race([both.promise,delay(5000,undefined,{signal}).then(()=>{throw Error('child models did not start in parallel')})])
   for(const id of ids){const child=h.ctx.agents.get(id);assert.equal(child.metadata.origin,'subagent');assert.equal(h.ctx.agents.ownerOf(child).id,child.metadata.parentSession);assert.ok(h.ctx.sessionPersistence.path(id).startsWith(h.ctx.runtimePaths.temp))}
   return [call('find',{path:'.',pattern:'**/*'})]
  }
  if(parentCalls===3){
   independent.resolve()
   return [delegate({action:'wait',ids:modelToolValues(request).findLast(value=>value.ids).ids})]
  }
  const results=modelToolValues(request).findLast(value=>value.results)?.results
  assert.deepEqual(results?.map(x=>x.summary),['verified check-1','verified check-2'],JSON.stringify(request.messages))
  return conclude('execution owner finished')
 })
 const created=await h.service.createTask({groupId:'native-group',requestId:'subagent-batch',objective:'PARENT_HIDDEN_OBJECTIVE'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId})
 assert.equal(task.status,'completed',JSON.stringify(h.service.listAlerts()))
 assert.equal(parentCalls,4)
 assert.deepEqual(await h.query('execution.list',{taskId:created.taskId}),[])
 const logs=await h.ctx.sessionPersistence.list()
 assert.ok(!logs.some(item=>item.header.parentSession===task.sessionId))
 for(const id of helperIds){assert.equal(h.ctx.agents.get(id),undefined);assert.equal(await h.ctx.sessionPersistence.stat(id),undefined)}
})

test('finishing a task cancels and physically drains an unused helper before committing the sole result', {timeout:nativeTestTimeout(20000)},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-task-subagent-drain-'))
 let h; t.after(async()=>{try{await h?.close()}finally{await rm(root,{recursive:true,force:true})}})
 const started=Promise.withResolvers(),stopped=Promise.withResolvers()
 h=await nativeTaskHost(root,async(request,_,signal)=>{
  const input=latestInput(request)
  if(input.kind==='task-subagent'){
   started.resolve()
   try{await delay(10000,undefined,{signal})}
   finally{stopped.resolve()}
   return {text:'unused report'}
  }
  if(!request.tools.some(tool=>tool.name==='task_result'))return []
  if(!modelToolValues(request).findLast(value=>value.ids))return [delegate({action:'start',assignments:[{goal:'hold until cancellation'}]})]
  await Promise.race([started.promise,delay(5000,undefined,{signal}).then(()=>{throw Error('helper never started')})])
  return conclude('unused helper not needed')
 })
 const created=await h.service.createTask({groupId:'native-group',requestId:'subagent-drain',objective:'Verify the final result is not delegated'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId})
 assert.equal(task.status,'completed',JSON.stringify(h.service.listAlerts()))
 assert.equal(await Promise.race([stopped.promise.then(()=>true),delay(0,false)]),true)
 assert.ok(!h.ctx.agents.list().some(actor=>actor.metadata.parentSession===task.sessionId))
})

test('foreground helper reads assigned task files but cannot read a sibling, a symlink escape or the parent journal', {timeout:nativeTestTimeout(20000)},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-task-subagent-fence-'))
 let h; t.after(async()=>{try{await h?.close()}finally{await rm(root,{recursive:true,force:true})}})
 const secret=join(root,'outside.txt')
 await writeFile(secret,'OUTSIDE_RAW_SECRET')
 h=await nativeTaskHost(root,async(request)=>{
  const input=latestInput(request)
  if(input.kind==='task-subagent'){
   const results=request.messages.filter(row=>row.role==='toolResult')
   if(!results.length){assert.ok(request.tools.some(tool=>tool.name==='read'));return [
    call('read',{path:'work/visible.txt'}),call('read',{path:'task.json'}),call('read',{path:'work/escape/outside.txt'}),
    call('read',{path:secret}),call('find',{pattern:'**/*',path:'.'}),
   ]}
   assert.deepEqual(results.map(result=>result.isError),[false,true,true,true,false],JSON.stringify(results))
   assert.match(JSON.stringify(results[0]),/LOCAL_PROOF/)
   assert.match(JSON.stringify(results[4]),/work\/visible.txt/)
   assert.doesNotMatch(JSON.stringify(results),/OUTSIDE_RAW_SECRET/)
   assert.doesNotMatch(JSON.stringify(results[4]),/task\.json|sessions\/|work\/escape|reviews\//)
   return {text:'Found LOCAL_PROOF in work/visible.txt'}
  }
  if(!request.tools.some(tool=>tool.name==='task_result')){assert.ok(!request.tools.some(tool=>tool.name==='task_subagent'));return []}
  const returned=modelToolValues(request).findLast(value=>value.results)?.results
  if(returned){assert.equal(returned[0].summary,'Found LOCAL_PROOF in work/visible.txt');return conclude('verified local proof')}
  const actor=h.ctx.agents.list().find(actor=>actor.metadata.agentPreset==='night-bot-task')
  await writeFile(join(actor.metadata.cwd,'work/visible.txt'),'LOCAL_PROOF')
  await symlink(root,join(actor.metadata.cwd,'work/escape'),process.platform==='win32'?'junction':'dir')
  return [delegate({action:'run',assignments:[{goal:'Review visible files'}]})]
 })
 const created=await h.service.createTask({groupId:'native-group',requestId:'subagent-fence',objective:'Check task access boundary'})
 await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId})
 assert.equal(task.status,'completed',JSON.stringify(h.service.listAlerts()))
})
