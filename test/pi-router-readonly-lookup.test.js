import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
const call=(tool,args)=>({tool,args})
const input=body=>requestEnvelope(body,'Router 请求：')
const done=body=>body.messages.at(-1)?.role==='tool'&&body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle'

test('real readonly lookup returns asynchronously to same Router after second message; no task execution or direct subagent send',{timeout:nativeTestTimeout(45000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let h,requested=false,lookupCalls=0,secondHandled=false,completion,lookupId
 h=await residentRouterHost(t,async body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){lookupCalls++;assert.deepEqual(requestTools(body),[]);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_OTHER_ROOM|PRIVATE_USER_SOURCE/);entered.resolve();await release.promise;return {text:JSON.stringify({summary:'The retained task is paused; no execution was started.',limitations:[]})}}
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  const result=packet.events.find(event=>event.kind==='router.lookup.completed')
  if(result){assert.equal(secondHandled,true,JSON.stringify(result));assert.equal(result.sourceId,undefined);assert.equal(result.source,undefined);if(!completion){completion=result;return call('resident_router_reply',{operationId:'answer-result',sourceId:result.lookupResult.sourceId,messageVersion:result.lookupResult.messageVersion,text:'The retained task is paused; no execution was started.',replyPurpose:'task-update'})}return call('resident_router_settle',{operationId:'settle-result',eventIds:packet.events.map(event=>event.id)})}
  const event=packet.events.find(event=>event.source)
  if(event?.source.messageId==='lookup'&&!requested){assert.match(JSON.stringify(body),/线上排查、需查\/分析代码/);requested=true;return call('resident_task_lookup_async',{operationId:'lookup-existing',sourceId:event.sourceId,messageVersion:event.messageVersion,taskIds:['existing-task']})}
  if(event?.source.messageId==='lookup'){
   const value=JSON.parse(body.messages.at(-1).content);lookupId=value.lookupId
   return call('resident_router_settle',{operationId:'settle-request',eventIds:packet.events.map(event=>event.id),noTaskDispositions:[{eventId:event.id,outcome:'async-query',lookupId,sourceQuote:event.source.text,reason:'Accepted durable read-only lookup; result follows separately'}]})
  }
  if(event?.source.messageId==='second')secondHandled=true
  return call('resident_router_settle',{operationId:'settle:'+packet.events.map(event=>event.id),eventIds:packet.events.map(event=>event.id)})
 })
 await h.receive(channelMessage('register'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('register')).sessionId
 await h.store.command({id:'seed-existing',kind:'task.create',args:{taskId:'existing-task',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'seed-paused',kind:'task.control',args:{taskId:'existing-task',control:'paused',expectedControlRevision:1}})
 await h.service.whenIdle()
 const before=await h.query('task.get',{taskId:'existing-task'}),executions=(await h.query('execution.list')).length
 await h.receive(channelMessage('lookup',{text:'Please read the existing task status. PRIVATE_USER_SOURCE'}));await entered.promise
 await h.service.whenIdle();assert.equal(lookupCalls,1);assert.equal(h.sent.length,0)
 await h.receive(channelMessage('second',{text:'Unrelated background while the slow lookup is pending.'}));await h.service.whenIdle();assert.equal(secondHandled,true)
 assert.equal(completion,undefined);release.resolve()
 await eventually(()=>completion,'durable lookup result returned without new input');await h.service.whenIdle()
 assert.equal(completion.lookupResult.state,'completed');assert.match(completion.lookupResult.summary,/paused/);assert.equal(completion.lookupResult.snapshots,undefined);const stored=await h.query('router.action',{conversationId,operationId:(await import('../src/channels/resident-router-business.js')).residentOperationId(conversationId,'lookup-existing')});assert.equal(stored.result.lookup.result.snapshots[0].leaseEpoch,before.leaseEpoch)
 assert.equal((await h.query('task.list')).length,1);assert.equal((await h.query('execution.list')).length,executions);assert.deepEqual(await h.query('task.get',{taskId:'existing-task'}),before);assert.equal(h.sent.length,1);assert.equal(h.results.filter(row=>row.name==='resident_router_reply'&&!row.result.isError).length,1)
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count);assert.equal(lookupCalls,1)
})

test('accepted-but-not-launched lookup becomes one interrupted event on restart without new input or model work',{timeout:nativeTestTimeout(30000)},async t=>{
 let lookupCalls=0,result
 const h=await residentRouterHost(t,body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){lookupCalls++;return {text:'Should not run'}}
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  result??=packet.events.find(event=>event.kind==='router.lookup.completed')
  return call('resident_router_settle',{operationId:'settle:'+packet.events.map(event=>event.id).join(','),eventIds:packet.events.map(event=>event.id)})
 })
 await h.receive(channelMessage('orphan'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('orphan')).sessionId,source=(await h.query('source.list')).find(source=>source.messageId==='orphan'),row=await h.query('router.get',{conversationId})
 await h.store.command({id:'orphan-task',kind:'task.create',args:{taskId:'retained-orphan',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'orphan-task-paused',kind:'task.control',args:{taskId:'retained-orphan',control:'paused',expectedControlRevision:1}})
 await h.store.command({id:'accepted-before-crash',kind:'router.lookup.submit',args:{conversationId,generation:row.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'orphan-lookup',taskIds:['retained-orphan']}})
 await h.restart();await h.service.whenIdle()
 assert.equal(result.lookupResult.state,'interrupted');assert.equal(lookupCalls,0);assert.equal(h.sent.length,0)
 const requests=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,requests)
})

test('lookup timeout cancels its isolated provider, returns a durable result and ignores a late response',{timeout:nativeTestTimeout(30000)},async t=>{
 const {createRouterReadonlyLookups}=await import('../src/channels/router-readonly-lookup.js')
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let fire,queryTurns=0
 const h=await residentRouterHost(t,async body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){queryTurns++;entered.resolve();await release.promise;return {text:JSON.stringify({summary:'Must not replace timeout',limitations:[]})}}
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  return call('resident_router_settle',{operationId:'settle:'+packet.events.map(event=>event.id),eventIds:packet.events.map(event=>event.id)})
 })
 await h.receive(channelMessage('timeout-source'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('timeout-source')).sessionId,source=(await h.query('source.list')).find(row=>row.messageId==='timeout-source'),row=await h.query('router.get',{conversationId})
 await h.store.command({id:'timeout-task',kind:'task.create',args:{taskId:'timeout-existing',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'timeout-paused',kind:'task.control',args:{taskId:'timeout-existing',control:'paused',expectedControlRevision:1}})
 const query=(kind,args={})=>h.query(kind,args),command=(kind,args,id)=>h.store.command({kind,args,id})
 let notices=0
 const worker=createRouterReadonlyLookups({ctx:h.host.ctx,query,command,models:()=>h.config.model,schedule:()=>{notices++;return Promise.resolve()},setTimer:fn=>{fire=fn;return {unref(){}}},clearTimer:()=>{}})
 t.after(()=>worker.close())
 const receipt=await worker.submit({conversationId,generation:row.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'timeout-operation',taskIds:['timeout-existing']})
 await entered.promise;fire()
 await eventually(async()=> (await h.query('router.action',{conversationId,operationId:'timeout-operation'})).result.lookup.state==='timed-out','fixed timeout completion')
 const retry=await worker.submit({conversationId,generation:row.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'timeout-operation',taskIds:['timeout-existing']});assert.equal(retry.status,'timed-out')
 await worker.close();release.resolve()
 assert.equal(queryTurns,1);assert.equal(notices,1)
 const action=await h.query('router.action',{conversationId,operationId:'timeout-operation'});assert.equal(action.result.lookup.result,undefined);assert.equal(action.result.lookup.id,receipt.lookupId)
 assert.equal(h.sent.length,0)
})
