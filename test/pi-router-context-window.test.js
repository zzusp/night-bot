import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
import {officialConversationContextBudget} from '../src/runtime/pi-official-settings.js'
import {routerContextWindow} from '../packages/web-console/server/router-context-window.js'
import {channelMessage,eventually,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {memoryHost} from './fixtures/memory-host.js'
import {apply as applyApplication,inject} from '../src/application.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
test('current Router card reads actual official Pi context usage without another request',{timeout:nativeTestTimeout(60000)},async t=>{
 const h=await memoryHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：')
  if(body.messages.at(-1)?.role==='tool')return {text:'Done'}
  return {tool:'resident_router_settle',args:{operationId:input.events[0].id,eventIds:input.events.map(event=>event.id)}}
 },{hostConfig:config=>{config.providers.fixture.models[0].contextWindow=262144;return config}})
 const config={...h.config,resident:{port:0,taskSessions:{instanceId:'router-restore-fixture',ownerActorId:'operator',webActorId:'operator',ingressEpoch:'2026-01-01T00:00:00Z',initialize:true,reasoningMode:'inherit'}}}
 const start=async()=>{
  await h.host.ctx.plugin({inject,apply:ctx=>applyApplication(ctx,config)})
  return h.host.ctx.get('application').tasks
 }
 let tasks=await start()
 const message=channelMessage('context-count'),id=h.host.ctx.channels.identity(message).sessionId
 const query=(conversationId=id)=>tasks.store.query({kind:'router.get',conversationId})
 await h.host.ctx.channels.receive(message);await tasks.whenIdle()
 const row=await query(),actor=h.host.ctx.agents.get(row.activeSessionId),before=h.requests.length
 const expected=actor.piSession.getContextUsage(),actual=await routerContextWindow(tasks,h.host.ctx.agents,id)
 assert.equal(actual.status,'ready');assert.equal(actual.tokens,expected.tokens);assert.equal(actual.contextWindow,officialConversationContextBudget(actor.piSession.model,'ROUTER').budgetTokens)
 for(const key of ['messages','systemTools','system','tools'])assert.ok(actual.categories.some(c=>c.key===key),key)
 assert.equal(actual.categories.reduce((n,c)=>n+c.tokens,0),actual.tokens)
 assert.ok(actual.categories.every(c=>Number.isSafeInteger(c.tokens)&&Object.keys(c).length===2),'only typed numeric detail leaves live Pi')
 assert.equal(h.requests.length,before,'reading does not wake Pi')
 assert.deepEqual(await routerContextWindow(tasks,h.host.ctx.agents,'other-room'),{status:'unavailable',reason:'not-started'})
 const web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'context-preview',senderId:'operator',port:0},getApplication:()=>({config:{},tasks}),getAgents:()=>h.host.ctx.agents})
 t.after(()=>web.close())
 const path='/api/conversations/'+encodeURIComponent(id)+'/stage-times?contextWindow=1'
 assert.equal((await fetch(web.origin+path)).status,401)
 const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
 assert.equal(login.status,200)
 const headers={origin:web.origin,cookie:login.headers.get('set-cookie').split(';')[0]}
 const response=await fetch(web.origin+path,{headers});assert.equal(response.status,200)
 const body=await response.json();assert.deepEqual(body.contextWindow,actual);assert.equal(Object.hasOwn(body,'compactions'),false)
 assert.equal((await fetch(web.origin+'/api/conversations/foreign/stage-times?contextWindow=1',{headers})).status,404)
 assert.equal(h.requests.length,before,'authenticated HTTP projection also performs no model request')
 await web.close()
 await h.close();await h.boot();tasks=await start()
 await eventually(()=>h.host.ctx.agents.get(row.activeSessionId),'startup restores the idle Router',t.signal)
 await tasks.whenIdle()
 const restored=await query()
 assert.equal(restored.activeSessionId,row.activeSessionId,'restart retains the original Router identity')
 assert.equal(restored.generation,row.generation)
 assert.deepEqual(await routerContextWindow(tasks,h.host.ctx.agents,id),actual)
 assert.equal(h.requests.length,before,'loading and reading an idle Router cause no model request')
 await h.host.ctx.channels.receive(channelMessage('context-count-new'));await tasks.whenIdle()
 assert.ok(h.requests.length>before)
 assert.equal((await query()).activeSessionId,row.activeSessionId)
 assert.equal(await tasks.store.query({kind:'router.inbox',conversationId:id,deliverable:true}).then(rows=>rows.length),0)
})
