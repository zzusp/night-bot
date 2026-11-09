import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {memoryHost} from './fixtures/memory-host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {makeAgentObservation} from '../src/runtime/pi-agent-observation.js'
import {createHash} from 'node:crypto'
const hash=value=>createHash('sha256').update(value).digest('hex')

test('actual default Host TaskService records SDK model/tool progress privately and rejects foreign or expired owners', {timeout:15000}, async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await memoryHost(t,async()=>{entered.resolve();await release.promise;return{tool:'task_result',args:{decision:{action:'wait',summary:'SECRET_RESULT_SUMMARY',evidence:[],limitations:[]}}}})
 const ctx=f.host.ctx,paths=ctx.get('runtimePaths'),resident=await openResidentStore(ctx.get('storageDomain'))
 let service,owner;const errors=[],recordObservation=resident.recordAgentObservation.bind(resident)
 resident.recordAgentObservation=input=>recordObservation(input).catch(error=>{errors.push(error.issues??error.code??error.message);throw error})
 t.after(async()=>{release.resolve();await service?.close();await resident.close()})
 const config={dbPath:join(paths.state,'observation-tasks.sqlite'),workspaceDir:paths.workspaces,instanceId:'observation-fixture',initialize:true,webActorId:'fixture-owner',ownerActorId:'fixture-owner',provider:'fixture',model:'m',reasoningMode:'model-default',maxConcurrentTasks:1}
 const legacy={getAgentConfig:()=>({...config,agentNames:['Fixture bot'],replySignature:''})}
 service=await openTaskSessionService({ctx,config,legacy,residentStore:resident,notifications:{send:async()=>({messageId:'fixture-only-notice'}),readback:async()=>({status:'sent'})},readMessage:async()=>null,readResource:async()=>null,readMentioned:async()=>[]})
 const off=ctx.on('night/agent-observation',(actor)=>{owner=actor});t.after(off)
 const task=await service.createTask({requestId:'observe-once',objective:'SECRET_USER_OBJECTIVE'})
 await entered.promise
 const forged=makeAgentObservation({ownerId:task.sessionId,runId:'foreign-run',entryId:'not-authoritative',spanId:hash('foreign'),kind:'model-completed',timestamp:Date.now(),summary:{usage:{input:123}}})
 assert.equal(ctx.get('agents').get(task.sessionId),owner)
 ctx.emit('night/agent-observation',{id:task.sessionId,metadata:Object.freeze({id:task.sessionId})},forged)
 await delay(10);assert.equal(service.listPerformance({taskId:task.taskId}).rows.reduce((sum,row)=>sum+row.modelCalls,0),0)
 release.resolve();await service.whenIdle()
 let performance
 for(let count=0;count<100;count++){
  performance=service.listPerformance({taskId:task.taskId})
  if(performance.rows.some(row=>row.modelCalls===1&&row.toolCalls===1&&row.toolResults===1))break
  await delay(5)
 }
 assert.equal(f.requests.length,1,JSON.stringify(service.listAlerts()))
 assert.equal(performance.rows.length,1,JSON.stringify({alerts:service.listAlerts(),errors}))
 assert.equal(performance.rows[0].modelCalls,1);assert.equal(performance.rows[0].toolCalls,1);assert.equal(performance.rows[0].toolResults,1)
 const activities=service.listActivities(task.taskId)
 assert.ok(activities.some(row=>row.type==='model-completed'));assert.ok(activities.some(row=>row.type==='tool-completed'))
 assert.ok(activities.every(row=>row.taskId===task.taskId&&row.sessionId===task.sessionId&&!Object.hasOwn(row,'seq')))
 assert.equal(JSON.stringify({performance,activities}).includes('SECRET_'),false)
 const before=JSON.stringify(service.listPerformance({taskId:task.taskId}))
 const record=makeAgentObservation({ownerId:task.sessionId,runId:'forged',entryId:'not-authoritative',spanId:hash('private'),kind:'model-completed',timestamp:Date.now(),summary:{usage:{input:123}}})
 ctx.emit('night/agent-observation',{id:task.sessionId,metadata:Object.freeze({id:task.sessionId})},record)
 ctx.emit('night/agent-observation',owner,record)
 await delay(10)
 assert.equal(JSON.stringify(service.listPerformance({taskId:task.taskId})),before)
 await service.close();service=undefined
 assert.equal(resident.listPerformance({taskId:task.taskId}).rows[0].modelCalls,1)
})

test('TaskService shutdown retains final SDK cancellation measurements before closing its metadata queue', {timeout:15000}, async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await memoryHost(t,async()=>{entered.resolve();await release.promise;return{text:'interrupted response'}})
 const ctx=f.host.ctx,paths=ctx.get('runtimePaths'),resident=await openResidentStore(ctx.get('storageDomain'))
 let service
 t.after(async()=>{release.resolve();await service?.close();await resident.close()})
 const config={dbPath:join(paths.state,'closing-observation.sqlite'),workspaceDir:paths.workspaces,instanceId:'closing-observation',initialize:true,webActorId:'fixture-owner',provider:'fixture',model:'m',reasoningMode:'model-default',maxConcurrentTasks:1}
 service=await openTaskSessionService({ctx,config,legacy:{getAgentConfig:()=>config},residentStore:resident,notifications:{send:async()=>({messageId:'local-notice'}),readback:async()=>({status:'sent'})},readMessage:async()=>null,readResource:async()=>null,readMentioned:async()=>[]})
 const task=await service.createTask({requestId:'cancel-source',objective:'Controlled pending model'})
 await entered.promise
 const closing=service.close();await delay(10);release.resolve();await closing;service=undefined
 const rows=resident.listPerformance({taskId:task.taskId}).rows
 assert.equal(rows.reduce((sum,row)=>sum+row.modelCalls,0),1)
 assert.equal(rows.reduce((sum,row)=>sum+row.interrupted,0),1)
})
