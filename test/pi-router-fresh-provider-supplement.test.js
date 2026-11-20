import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {writeFile} from 'node:fs/promises'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

test('fresh Router handoff resumes the same Pi task despite retired retry and old unknown-effect evidence',{timeout:nativeTestTimeout(45000)},async t=>{
 const taskId='fresh-provider-supplement',receipt='independent local check verified',oldCode='TASK_EFFECT_UNCERTAIN_NO_REPLAY'
 const handled=new Set();let h,modelCalls=0,readCalls=0
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body),texts=requestText(body).join('\n')
  if(texts.includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
  if(tools.includes('task_result')){
   modelCalls++
   if(modelCalls===1)return {tool:'task_result',args:{decision:{action:'wait',summary:'Initial round finished',evidence:[],limitations:[]}}}
   assert.match(texts,/Read only the local receipt file/)
   if(!readCalls++)return {tool:'read',args:{path:'work/readback.txt'}}
   assert.match(JSON.stringify(body),new RegExp(receipt))
   return {tool:'task_result',args:{decision:{action:'complete',summary:receipt,evidence:[receipt],limitations:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle'&&!h.results.at(-1)?.result.isError)return {text:'Settled'}
  const events=requestEnvelope(body,'Router 请求：').events
  const source=events.find(event=>event.source&&!handled.has(event.source.messageId))?.source
  if(source){
   handled.add(source.messageId)
   if(source.messageId==='original')return {tool:'resident_task_plan',args:{operationId:'plan-provider-supplement',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId,title:'Read local receipts',objective:'Check local receipts',requirements:[],handoff:'Prepare to check a local receipt.'}],dependencies:[]}}
   const task=await h.query('task.get',{taskId})
   return {tool:'resident_task_action',args:{operationId:'fresh-provider-supplement',sourceId:source.sourceId,messageVersion:source.version,kind:'supplement',taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,handoff:'Read only the local receipt file; leave earlier work untouched.'}}
  }
  return {tool:'resident_router_settle',args:{operationId:'settle:'+events.map(event=>event.id).join(','),eventIds:events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('original',{text:'Check the receipt when available.'}));await h.service.whenIdle()
 const before=await h.query('task.get',{taskId});assert.equal(before.drained,true);assert.equal(modelCalls,1)
 await writeFile(join(h.host.ctx.runtimePaths.workspaces,'tasks',taskId,'work','readback.txt'),receipt)
 const seed=(kind,args)=>h.store.command({id:'retired-'+kind,kind,args})
 await seed('task.wake',{taskId,kind:'task.provider-recovery'})
 const {binding}=(await seed('task.claim',{taskId})).result
 const oldDecision={action:'blocked',summary:'Original effect is not verified',evidence:['Original receipt left unchanged'],limitations:[oldCode]}
 await seed('task.wait',{binding,...oldDecision})
 await seed('task.provider-failure',{binding,failure:{code:'TASK_SESSION_NO_SUBMISSION',phase:'decision'}})
 await seed('task.drained',{binding})
 await h.restart();await h.service.whenIdle()
 const held=await h.query('task.get',{taskId})
 assert.equal(held.providerRecovery.hostRetryDisabled,true)
 assert.equal(held.providerRecovery.nextAttemptAt,null)
 assert.equal(held.lastDecision.summary,oldDecision.summary);assert.deepEqual(held.lastDecision.limitations,[oldCode])
 assert.equal(modelCalls,1,'restart must not replay the old wake')
 await h.receive(channelMessage('fresh',{text:'Try checking the new local receipt; do not alter the earlier operation.'}))
 const finished=await eventually(async()=>{const task=await h.query('task.get',{taskId});return task.status==='completed'&&task.drained&&task},'fresh supplement actually completed')
 await h.service.whenIdle()
 assert.equal(finished.sessionId,before.sessionId)
 assert.equal(finished.requirementRevision,before.requirementRevision,'plain supplement must not introduce a new task objective')
 assert.equal(finished.providerRecovery,null);assert.equal(readCalls,2);assert.equal(modelCalls,3)
 const oldReceipt=(await h.query('task.decisions',{taskId})).decisions.find(row=>row.id==='retired-task.wait')
 assert.deepEqual(oldReceipt.decision.limitations,[oldCode]);assert.equal(oldReceipt.decision.summary,oldDecision.summary)
})
