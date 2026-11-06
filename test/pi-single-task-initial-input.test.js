import {join} from 'node:path'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
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
 assert.equal((await h.service.listAlerts()).some(alert=>alert.detail==='TOPIC_FACT_REPLY_BINDING_MISSING'),false);assert.equal((await h.service.store.exportTaskArchive(task.taskId)).tables.topic_facts.length,0)
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
