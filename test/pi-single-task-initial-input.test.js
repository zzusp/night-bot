import {join} from 'node:path'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {nativeRuntimeHost,latestInput} from './fixtures/runtime-official-host.js'
async function fixture(t,decide){const root=await mkdtemp(join(tmpdir(),'night-single-initial-input-')),h=await nativeRuntimeHost(root,decide);t.after(async()=>{await h.close();await rm(root,{recursive:true,force:true})});return h}
const result=action=>[{name:'task_result',args:{decision:{action,summary:'Verified initial inputs',evidence:['actual admitted sources'],limitations:[],...action==='blocked'?{question:'What remaining fact should be used?',audience:'operator'}:{}}}}]
test('Single create preserves actual initial context/source refs through SQL, materialization and official admission',async t=>{
 let input;const h=await fixture(t,request=>{input=latestInput(request);return result('complete')})
 await h.service.store.command({id:'accepted-existing-source',kind:'source.record',args:{sourceId:'initial-accepted-source',groupId:'native-group',messageId:'accepted-message',actorId:'native-user',channel:'web',text:'EXISTING_ACTUAL_CONTEXT',timestamp:new Date().toISOString()}})
 const created=await h.service.createTask({groupId:'native-group',requestId:'initial-context',objective:'Original exact objective',context:'ORIGINAL_REQUIREMENT: retain this exact source',sourceRefs:['initial-accepted-source']});await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId});assert.equal(task.status,'completed');assert.equal(task.sourceRefs.length,2);assert.equal(input.sources.length,2);assert.ok(input.sources.some(source=>source.text==='ORIGINAL_REQUIREMENT: retain this exact source'));assert.ok(input.sources.some(source=>source.text==='EXISTING_ACTUAL_CONTEXT'))
 const source=await h.query('source.get',{sourceId:task.metadata.authorizationSourceId});assert.equal(source.actorId,'native-user');assert.equal(source.channel,'web');assert.equal(source.groupId,'native-group');assert.equal(source.requestIdentity.singleTaskCreate.context,'ORIGINAL_REQUIREMENT: retain this exact source')
 const native=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),packet=native.audit.find(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='task-input').payload;assert.match(JSON.stringify(packet.content),/ORIGINAL_REQUIREMENT/);assert.equal(task.sourceRefs.every(id=>input.materials.some(material=>material.sourceId===id)),true)
 const replay=await h.service.createTask({groupId:'native-group',requestId:'initial-context',objective:'Original exact objective',context:'ORIGINAL_REQUIREMENT: retain this exact source',sourceRefs:['initial-accepted-source']});assert.equal(replay.taskId,created.taskId)
 await assert.rejects(h.service.createTask({groupId:'native-group',requestId:'initial-context',objective:'Original exact objective',context:'CHANGED_CONTEXT'}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})
})
for(const action of ['complete','blocked'])test('direct Single '+action+' without any topic binding creates no synthetic topic fact or missing-binding alert',async t=>{
 const h=await fixture(t,()=>result(action)),created=await h.service.createTask({requestId:'direct-'+action,objective:'Return the verified business result'});await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId});assert.equal(task.lastDecision?.action??task.completion?.result.action,action);assert.deepEqual(task.topicRefs,[]);assert.deepEqual(task.replyBindings,[])
 assert.equal((await h.service.listAlerts()).some(alert=>alert.detail==='TOPIC_FACT_REPLY_BINDING_MISSING'),false);assert.equal((await h.service.store.exportTaskArchive(task.taskId)).tables.historical_topic_facts.length,0)
 if(action==='blocked')assert.equal(task.humanRequests[0].status,'waiting-reply')
})

test('Single initial sources reject missing or foreign group records before creating a task',async t=>{
 const h=await fixture(t,()=>result('complete'))
 await h.service.store.command({id:'actual-foreign-source',kind:'source.record',args:{sourceId:'foreign-initial',groupId:'foreign-group',messageId:'foreign-message',actorId:'another-user',channel:'web',text:'Foreign actual private context',timestamp:new Date().toISOString()}})
 for(const sourceId of ['missing-source','foreign-initial'])await assert.rejects(h.service.createTask({groupId:'native-group',requestId:'bad-'+sourceId,objective:'Do not admit foreign context',sourceRefs:[sourceId]}),{code:'TASK_INITIAL_SOURCE_SCOPE_INVALID'})
 assert.equal((await h.query('task.list')).length,0)
})
test('concurrent identical Single create requests retain one actual initial source and one execution input',async t=>{
 let turns=0;const h=await fixture(t,()=>{turns++;return result('complete')}),args={requestId:'concurrent-initial',objective:'One accepted initial request',context:'One actual initial context'}
 const [one,two]=await Promise.all([h.service.createTask(args),h.service.createTask(args)]);assert.equal(one.taskId,two.taskId);await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:one.taskId});assert.equal(task.sourceRefs.length,1);assert.equal(turns,1);const source=await h.query('source.get',{sourceId:task.sourceRefs[0]});assert.equal(source.text,args.context)
})


test('personal Web wait resumes in its original session with task-scoped replay, reopen and cancellation',async t=>{
 const steps=new Map(),inputs=[]
 const h=await fixture(t,request=>{
  const input=latestInput(request),task=input.task,key=task.taskId+':'+task.leaseEpoch,n=steps.get(key)??0
  steps.set(key,n+1);inputs.push(input)
  const initial=!task.contextRevision&&task.requirementRevision===1
  if(initial&&n===0)return [{name:'write',args:{path:'work/personal.txt',content:'BASE='+task.title}}]
  if(n===(initial?1:0))return [{name:'read',args:{path:'work/personal.txt'}}]
  return result(initial||task.title==='Personal B'?'wait':'complete')
 })
 const first=await h.service.createTask({requestId:'personal-a',title:'Personal A',objective:'Write, read and wait for authenticated Web input'})
 const second=await h.service.createTask({requestId:'personal-b',title:'Personal B',objective:'Independent personal task with the same followup request id'})
 await h.service.whenIdle()
 const a=await h.query('task.get',{taskId:first.taskId}),b=await h.query('task.get',{taskId:second.taskId})
 for(const task of [a,b]){assert.equal(task.groupId,null);assert.equal(task.drained,true);assert.equal(task.lastDecision.action,'wait');assert.equal((await h.service.taskDialogue(task.taskId)).writable,true)}
 const args=task=>({taskId:task.taskId,requestId:'shared-personal-followup',context:'Authenticated exact continuation for '+task.title,progressImpact:'preserve',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision})
 await assert.rejects(h.service.appendTaskContext({...args(a),requestId:'stale-personal-followup',expectedRequirementRevision:99}),{code:'DYNAMIC_TASK_REVISION_STALE'})
 await h.service.appendTaskContext(args(a));await h.service.appendTaskContext(args(b));await h.service.whenIdle()
 const afterA=await h.query('task.get',{taskId:a.taskId}),afterB=await h.query('task.get',{taskId:b.taskId})
 assert.equal(afterA.status,'completed');assert.equal(afterB.lastDecision.action,'wait')
 for(const [before,after] of [[a,afterA],[b,afterB]]){
  assert.equal(after.sessionId,before.sessionId);assert.equal(after.requirementRevision,1);assert.equal(after.contextRevision,1);assert.equal(after.drained,true);assert.equal(after.leaseEpoch,before.leaseEpoch+1)
  const sources=await Promise.all(after.sourceRefs.map(sourceId=>h.query('source.get',{sourceId}))),added=sources.find(source=>source.text===args(before).context)
  assert.ok(added);assert.equal(added.channel,'web');assert.equal(added.actorId,'native-user');assert.equal(added.groupId,'task:'+before.taskId);assert.equal(added.version,1)
  assert.ok(inputs.some(input=>input.task.taskId===before.taskId&&input.sources.some(source=>source.sourceId===added.sourceId&&source.text===args(before).context)))
  const journal=await h.ctx.sessionPersistence.readNative(after.sessionId,{requireComplete:true})
  assert.equal(await readFile(join(journal.header.cwd,'work/personal.txt'),'utf8'),'BASE='+before.title)
  assert.equal(journal.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='write'&&!entry.message.isError).length,1)
 }
 assert.equal(afterA.sourceRefs.some(id=>afterB.sourceRefs.includes(id)),false)
 const beforeReplay=h.requests.length
 for(const task of [a,b]){await h.service.appendTaskContext(args(task));await assert.rejects(h.service.appendTaskContext({...args(task),context:'Different content with the same request id'}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})}
 await h.service.whenIdle();assert.equal(h.requests.length,beforeReplay)
 const reopen={taskId:a.taskId,requestId:'personal-reopen',reason:'Recheck the original file after completion',expectedRequirementRevision:1,expectedControlRevision:1}
 await h.service.reopenTask(reopen);await h.service.whenIdle()
 const reopened=await h.query('task.get',{taskId:a.taskId});assert.equal(reopened.status,'completed');assert.equal(reopened.sessionId,a.sessionId);assert.equal(reopened.requirementRevision,2)
 const replayCount=h.requests.length;await h.service.reopenTask(reopen);await h.service.whenIdle();assert.equal(h.requests.length,replayCount)
 await h.service.cancelTask({taskId:b.taskId,requestId:'personal-cancel',expectedControlRevision:afterB.controlRevision});await h.service.whenIdle()
 const cancelled=await h.query('task.get',{taskId:b.taskId});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.drained,true);assert.equal((await h.service.taskDialogue(b.taskId)).writable,false)
 assert.equal(h.sent.length,0);assert.equal(h.readbacks.length,0);assert.deepEqual(await h.query('notification.list'),[]);assert.deepEqual(await h.query('execution.list'),[])
 const groupTask=await h.service.createTask({groupId:'unsubscribed-personal-guard',requestId:'unsubscribed-task',objective:'Group guard negative control'});await h.service.whenIdle()
 await assert.rejects(h.service.appendTaskContext({taskId:groupTask.taskId,requestId:'group-still-requires-subscription',progressImpact:'preserve',context:'Must not bypass the real group subscription'}),/group_not_subscribed/)
})
