import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {routerContextWindow} from '../packages/web-console/server/router-context-window.js'
import {officialConversationContextBudget} from '../src/runtime/pi-official-settings.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
test('undeclared private Router window is 472k on create and resume, card and compaction agree without changing execution',{timeout:nativeTestTimeout(60000)},async t=>{
 const h=await residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：')
  if(body.messages.at(-1)?.role==='tool')return {text:'Done'}
  return {tool:'resident_router_settle',args:{operationId:'settle-'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 },{hostOptions:{hostConfig:config=>{delete config.providers.fixture.models[0].contextWindow;return {}}}})
 const source=channelMessage('window-create'),id=h.host.ctx.channels.identity(source).sessionId
 await h.receive(source);await h.service.whenIdle()
 const original=await h.query('router.get',{conversationId:id})
 for(const round of ['create','resume']){
  if(round==='resume'){await h.restart();await h.receive(channelMessage('window-resume'));await h.service.whenIdle()}
  const row=await h.query('router.get',{conversationId:id}),session=h.host.ctx.agents.get(row.activeSessionId).piSession
  assert.equal(row.activeSessionId,original.activeSessionId)
  assert.equal(session.model.contextWindow,472000);assert.equal(session.getContextUsage().contextWindow,472000)
  const policy=officialConversationContextBudget(session.model,'ROUTER')
  assert.equal(policy.budgetTokens,472000);assert.equal(policy.backgroundTokens,283200);assert.equal(policy.foregroundTokens,377600)
  assert.equal(session.settingsManager.getCompactionSettings(session.model).reserveTokens,94400)
  const card=await routerContextWindow(h.service,h.host.ctx.agents,id)
  assert.equal(card.status,'ready');assert.equal(card.contextWindow,472000);assert.equal(card.modelWindow,472000)
  const execution=await h.host.ctx.agents.create({sessionId:'synthetic-execution-'+round,agentOptions:h.config.model,meta:{cwd:h.host.ctx.runtimePaths.workspaces}})
  assert.equal(execution.session.model.contextWindow,262144)
  await execution.dispose()
  assert.equal(h.host.ctx.get('nativePiProvider').profiles().get('fixture').models[0].contextWindow,262144)
 }
 assert.equal(await h.query('router.inbox-count',{conversationId:id}),0);assert.equal(h.sent.length,0)
})
