import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
test('real Router create and live supplements forward original user input, not Router diagnoses or invented steps',{timeout:nativeTestTimeout(60000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),seen=Promise.withResolvers();t.after(()=>release.resolve())
 const acted=new Set(),calls=[];let execution=0,h
 h=await residentRouterHost(t,async body=>{
  if(requestTools(body).includes('resident_task_plan')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
   if(source&&!acted.has(source.messageId)){
    acted.add(source.messageId)
    if(source.messageId==='create')return {tool:'resident_task_plan',args:{operationId:'create-verbatim',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'faithful',title:'ROUTER_GUESS',objective:'ROUTER_GUESS',request:'ROUTER_GUESS',requirements:['ROUTER_GUESS']}],dependencies:[]}}
    const task=await h.query('task.get',{taskId:'faithful'})
    return {tool:'resident_task_action',args:{operationId:'delta-'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,kind:'supplement',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,text:'ROUTER_GUESS: enlarge the time window and try invented methods'}}
   }
   if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Done'}
   return {tool:'resident_router_settle',args:{operationId:'settle-'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)}}
  }
  if(requestTools(body).includes('task_result')){
   calls.push(structuredClone(body));assert.doesNotMatch(JSON.stringify(body),/ROUTER_GUESS/)
   if(execution++===0){entered.resolve();await release.promise;return {tool:'read',args:{path:'work/synthetic-missing.txt'}}}
   const all=requestText(body).join('\n');assert.match(all,/只读查看原来的五分钟日志/);assert.match(all,/仍在原任务继续，输出覆盖范围并脱敏/);if(!all.includes('保持刚才的只读限制，不新增方法'))return {tool:'read',args:{path:'work/synthetic-missing.txt'}};seen.resolve()
   return {tool:'task_result',args:{decision:{action:'wait',summary:'Synthetic input verification complete',evidence:['Original messages retained'],limitations:['No external investigation performed']}}}
  }
  return {text:'No work'}
 })
 await h.receive(channelMessage('create',{text:'只读查看原来的五分钟日志'}));await entered.promise
 await h.receive(channelMessage('delta-one',{text:'仍在原任务继续，输出覆盖范围并脱敏'}))
 await eventually(async()=> (await h.query('task.get',{taskId:'faithful'})).contextRevision===1,'first live supplement')
 await h.receive(channelMessage('delta-two',{text:'保持刚才的只读限制，不新增方法'}))
 await eventually(async()=> (await h.query('task.get',{taskId:'faithful'})).contextRevision===2,'second live supplement')
 await eventually(()=>h.results.filter(row=>row.name==='resident_task_action'&&!row.result.isError).length===2,'both Router supplement calls committed');release.resolve();await seen.promise;await h.service.whenIdle()
 assert.ok(calls.length>=2);assert.equal((await h.query('task.list')).length,1)
 const task=await h.query('task.get',{taskId:'faithful'});assert.equal(task.sourceRefs.length,3);assert.equal(task.metadata.routerInputPolicy,'source-only-v1')
})
