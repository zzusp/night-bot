import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from '../../../test/fixtures/resident-router-host.js'
import {routerSessionView} from '../server/session-view.js'

test('real idle Router rotation retains previous committed business history',async t=>{
 const h=await residentRouterHost(t,body=>{
  const handoff=requestEnvelope(body,'Router 交接请求：')
  if(handoff&&!requestTools(body).length)return {text:JSON.stringify({currentIntent:'Keep source references',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(requestTools(body).includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(message=>({sourceId:message.sourceId,messageVersion:message.version??message.messageVersion,needsHandling:true,reason:'real Router execution projection'}))}}}
  if(requestTools(body).includes('resident_router_settle')){const input=requestEnvelope(body,'Router 请求：');if(body.messages.at(-1)?.role==='tool')return {text:'安排已提交'};return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'settle:'+input.events.map(event=>event.eventId).join(',')}}}
  return {text:'No task requested'}
 })
 const input=channelMessage('router-web-runtime',{text:'请处理真实隔离运行的安排记录'});await h.receive(input);await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(input).sessionId,router=await h.query('router.get',{conversationId}),rotations=await h.query('router.rotations',{conversationId})
 const options={conversationId,readRouter:()=>h.query('router.get',{conversationId}),readRotations:()=>h.query('router.rotations',{conversationId}),persistence:h.host.ctx.sessionPersistence}
 const page=await routerSessionView(options)
 const previous=rotations.find(row=>row.state==='published'),snapshot=await h.host.ctx.sessionPersistence.readNative(previous.oldSessionId,{requireComplete:true})
 t.diagnostic(JSON.stringify({activeGeneration:router.generation,currentRows:page.items.length,oldGeneration:previous.oldGeneration,oldProjectionEntries:snapshot.context.projection.entries.length,oldMessageRoles:snapshot.context.projection.entries.flatMap(row=>row.messages.map(message=>message.role))}))
 assert.equal(page.scope,'previous-committed-router-context');assert.equal(page.generation,previous.oldGeneration);assert.equal(page.activeGeneration,router.generation);
 await assert.rejects(routerSessionView({...options,revision:'wrong'}),{code:'SESSION_PAGE_STALE'});
 const excluded=await routerSessionView({...options,readRotations:async()=>rotations.map(row=>({...row,conversationId:'foreign'}))});assert.equal(excluded.items.length,0);
 assert.ok(router.generation>1);assert.ok(snapshot.context.projection.entries.length>0);assert.ok(page.items.length>0,'Web must not lose committed arrangements when idle Router publishes an empty generation')
})
