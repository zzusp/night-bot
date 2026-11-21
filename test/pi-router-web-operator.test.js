import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {routerSessionView} from '../packages/web-console/server/session-view.js'

test('Web operator shares the channel Router but cannot borrow its writes or external reply authority',{timeout:nativeTestTimeout(45000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),steps=new Map(),batches=[];t.after(()=>release.resolve())
 let originalSource
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit'))return {tool:'channel_triage_submit',args:{dispositions:requestEnvelope(body,'一级分诊请求：').messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Synthetic explicit source'}))}}
  if(!tools.includes('resident_router_settle'))return {text:'No other work'}
  const input=requestEnvelope(body,'Router 请求：'),web=input.events[0].kind==='operator.message'
  assert.ok(input.events.every(event=>(event.kind==='operator.message')===web),'never mix Web and channel events')
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  if(!web){originalSource=input.events.find(event=>event.source)?.source??originalSource;return {tool:'resident_router_settle',args:{operationId:'channel:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}}
  const event=input.events[0],step=steps.get(event.id)??0;steps.set(event.id,step+1)
  if(step===4)assert.ok(body.messages.some(message=>message.role==='system'&&String(message.content).includes('默认只讲重点')))
  if(step===0){batches.push(input.events);if(event.operator.requestId==='web-one'){entered.resolve();await release.promise}return {tool:'resident_router_reply',args:{operationId:'must-not-send',sourceId:originalSource.sourceId,messageVersion:originalSource.version,text:'Must remain local'}}}
  if(step===1)return {tool:'resident_task_action',args:{operationId:'must-not-control',kind:'control',taskId:'unrelated',expectedRequirementRevision:1,expectedControlRevision:1,control:'cancelled'}}
  if(step===2)return {tool:'resident_operator_reply',args:{eventId:'foreign-event',text:'Must be refused'}}
  if(step===3)return {tool:'resident_task_query',args:{detail:'index'}}
  if(step===4||step===5)return {tool:'resident_operator_reply',args:{eventId:event.id,text:step===5?'Attempted alternate text must not replace canonical reply':'Synthetic Web-only answer: '+event.operator.text}}
  return {tool:'resident_router_settle',args:{operationId:'web:'+event.id,eventIds:[event.id]}}
 })
 await h.receive(channelMessage('seed'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('seed')).sessionId,row=await h.query('router.get',{conversationId}),before=h.requests.length
 const first=await h.service.sendRouterOperatorMessage({conversationId,requestId:'web-one',text:'Synthetic operator question'})
 await entered.promise
 const duplicate=await h.service.sendRouterOperatorMessage({conversationId,requestId:'web-one',text:'Synthetic operator question'});assert.deepEqual(duplicate,first)
 await assert.rejects(h.service.sendRouterOperatorMessage({conversationId,requestId:'web-one',text:'Changed request'}),{code:'ROUTER_OPERATOR_REQUEST_CONFLICT'})
 await h.receive(channelMessage('between'))
 await h.service.sendRouterOperatorMessage({conversationId,requestId:'web-two',text:'Second synthetic question'})
 release.resolve();await h.service.whenIdle()
 assert.equal((await h.query('router.get',{conversationId})).activeSessionId,row.activeSessionId)
 assert.equal((await h.query('router.inbox',{conversationId})).length,0)
 assert.equal((await h.query('task.list')).length,0);assert.equal((await h.query('notification.list')).length,0);assert.equal(h.sent.length,0)
 assert.equal(batches.flat().length,2);assert.equal(batches[0][0].operator.actorId,'owner');assert.equal(batches[0][0].operator.destination,'web')
 const triages=h.requests.slice(before).filter(body=>requestTools(body).includes('channel_triage_submit'));assert.equal(triages.length,0,'channel message enters Router directly')
 const history=JSON.stringify(h.requests.slice(before));assert.match(history,/ROUTER_OPERATOR_READ_ONLY/);assert.match(history,/ROUTER_OPERATOR_EVENT_FORBIDDEN/)
 assert.equal((await h.service.routerOperatorRequest({conversationId,requestId:'web-one'})).status,'accepted')
 await assert.rejects(h.service.sendRouterOperatorMessage({conversationId:'foreign',requestId:'bad',text:'No access'}))
 const read=()=>h.query('router.get',{conversationId})
 const view=await routerSessionView({conversationId,readRouter:read,readRotations:()=>h.query('router.rotations',{conversationId}),persistence:h.host.ctx.sessionPersistence,secrets:[],proofScope:'synthetic',guard:async()=>{},offset:0,limit:50})
 assert.match(JSON.stringify(view),/Synthetic operator question/);assert.match(JSON.stringify(view),/Synthetic Web-only answer/);assert.equal(view.items.filter(item=>item.role==='assistant'&&item.text?.startsWith('Synthetic Web-only answer')).length,2,'idempotent tool retries do not duplicate visible replies')
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count,'cold restart never repeats accepted Web replies')
})

test('cold Web continuation keeps queued real channel messages in a separate authorized batch',{timeout:nativeTestTimeout(30000)},async t=>{
 const entered=Promise.withResolvers(),hold=Promise.withResolvers();t.after(()=>hold.resolve())
 let cold=false,original=true
 const h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit'))return {tool:'channel_triage_submit',args:{dispositions:requestEnvelope(body,'一级分诊请求：').messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:source.messageId!=='seed',reason:'Synthetic lane verification'}))}}
  if(!tools.includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：'),web=input.events[0].kind==='operator.message'
  assert.ok(input.events.every(event=>(event.kind==='operator.message')===web))
  if(!cold&&web){entered.resolve();await hold.promise;return {text:'Old request cancelled'}}
  if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(message=>message.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  if(web&&original){original=false;return {tool:'resident_operator_reply',args:{eventId:input.events[0].id,text:'Synthetic recovered local reply'}}}
  return {tool:'resident_router_settle',args:{operationId:'lane:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 })
 await h.receive(channelMessage('seed'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('seed')).sessionId
 await h.service.sendRouterOperatorMessage({conversationId,requestId:'cold-web',text:'Synthetic interrupted operator question'});await entered.promise
 await h.receive(channelMessage('later-real'))
 await eventually(async()=>await h.query('router.inbox-count',{conversationId})===2,'both lanes persisted')
 await h.close();cold=true;hold.resolve();await h.restart();await h.service.whenIdle()
 assert.equal((await h.query('router.inbox',{conversationId})).length,0)
 assert.equal(h.sent.length,0);assert.equal((await h.query('notification.list')).length,0)
})
