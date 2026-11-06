import test from 'node:test'
import assert from 'node:assert/strict'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {taskSessionModelSelection} from '../packages/dingtalk-core/task-model-config.js'

test('task service refuses missing official authority before touching storage or the old runtime',async()=>{
 let touched=0
 const unavailable=new Proxy({},{get(){touched++;throw Error('must not touch legacy state')}})
 for(const mode of ['portable','legacy'])await assert.rejects(openTaskSessionService({ctx:{get:name=>name==='runtimePaths'?{mode}:undefined},config:unavailable,legacy:unavailable,residentStore:unavailable,store:unavailable}),error=>error.code==='TASK_OFFICIAL_FACTORY_REQUIRED')
 assert.equal(touched,0)
})
test('official task service rejects injected split execution drivers before opening storage',async()=>{
 for(const name of ['executionSessions','claudeExecutionSessions'])await assert.rejects(openTaskSessionService({ctx:{get:key=>key==='officialAgentFactory'?{}:undefined},[name]:{},config:{}}),error=>error.code==='TASK_SPLIT_EXECUTION_REMOVED')
})
test('pure task model selection preserves exact ids, trimmed defaults and typed input errors',()=>{
 assert.deepEqual(taskSessionModelSelection({reasoningEffort:'low'},' model-id ',' provider-id '),{reasoningEffort:'low',provider:'provider-id',model:'model-id'})
 assert.deepEqual(taskSessionModelSelection({},'',''),{provider:'openai-codex',model:'gpt-6-astra'})
 assert.throws(()=>taskSessionModelSelection({},12,'provider'),error=>error.code==='TASK_SESSION_MODEL_INVALID')
 assert.throws(()=>taskSessionModelSelection({},'model',12),error=>error.code==='TASK_SESSION_PROVIDER_INVALID')
})

test('Night own retained SQL operation stays held after cold restart without rebuilding history or dispatching',{timeout:20000},async t=>{
 const {providerHost,result,latestInput}=await import('./fixtures/provider-official-host.js'),{mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const root=await mkdtemp(join(tmpdir(),'night-own-operations-'));let first,cold;t.after(async()=>{await cold?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 first=await providerHost(t,{root,decide:()=>[result()]});const id=await first.create('night-own-operation-hold');await first.service.whenIdle();const original=await first.stored(id),originalBytes=await readFile(first.ctx.sessionPersistence.path((await first.query('task.get',{taskId:id})).sessionId)),source=await first.query('source.get',{sourceId:original.task.sourceRefs[0]})
 const command=(kind,args)=>first.service.store.command({id:'prior-night-'+kind,kind,args})
 await command('task.wake',{taskId:id,kind:'prior-business-operation',payload:{reason:'retained Night operation'}})
 const {binding}=(await command('task.claim',{taskId:id})).result
 const operation=(await command('operation.prepare',{binding,key:'original-native-operation',definition:{toolName:'night-business-effect'},resourceKeys:[]})).result.operation
 await command('operation.start',{binding,operationId:operation.operationId});await command('operation.settle',{binding,operationId:operation.operationId,state:'unknown',result:{originalReceipt:'unverified'}});await command('task.drained',{binding});const oldOperation=await first.query('operation.get',{operationId:operation.operationId});await first.close()
 cold=await providerHost(t,{root,initialize:false,decide:request=>{assert.notEqual(latestInput(request).task.taskId,id,'retained operation must not dispatch its model');return [result('complete')]}})
 for(let n=0;n<3;n++){await cold.service.recover();await cold.service.whenIdle()}
 assert.equal(cold.taskRequests().length,0);assert.equal((await cold.query('execution.list')).length,0)
 const retained=await cold.query('operation.get',{operationId:operation.operationId});assert.deepEqual(retained,oldOperation);assert.equal(retained.state,'unknown');assert.deepEqual(retained.dispatchBinding,binding);assert.equal(retained.key,operation.key)
 const after=await cold.stored(id);assert.deepEqual(after.entries,original.entries);assert.deepEqual(await readFile(cold.ctx.sessionPersistence.path(after.task.sessionId)),originalBytes);assert.deepEqual(await cold.query('source.get',{sourceId:source.sourceId}),source);assert.ok((await cold.query('wake.list',{taskId:id})).some(wake=>wake.state!=='acked'))
 assert.ok(cold.service.listAlerts().some(alert=>alert.detail==='TASK_LEGACY_OPERATION_REVIEW_REQUIRED'));assert.equal((await cold.service.taskDetail(id)).taskId,id,'held task remains readable');const unrelated=await cold.create('unrelated-task-without-old-operations');await cold.service.whenIdle();assert.equal((await cold.stored(unrelated)).task.status,'completed');assert.equal(cold.taskRequests().length,1,'hold is scoped to the old operation task');assert.deepEqual((await cold.stored(id)).entries,original.entries);assert.deepEqual(await cold.query('operation.get',{operationId:operation.operationId}),retained)
})
