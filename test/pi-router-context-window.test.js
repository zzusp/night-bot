import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
import {officialConversationContextBudget} from '../src/runtime/pi-official-settings.js'
import {routerContextWindow} from '../packages/web-console/server/router-context-window.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
test('current Router card reads actual official Pi context usage without another request',{timeout:nativeTestTimeout(60000)},async t=>{
 const h=await residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const input=requestEnvelope(body,'Router 请求：')
  if(body.messages.at(-1)?.role==='tool')return {text:'Done'}
  return {tool:'resident_router_settle',args:{operationId:'context-settle',eventIds:input.events.map(event=>event.id)}}
 })
 const message=channelMessage('context-count'),id=h.host.ctx.channels.identity(message).sessionId
 await h.receive(message);await h.service.whenIdle()
 const row=await h.query('router.get',{conversationId:id}),actor=h.host.ctx.agents.get(row.activeSessionId),before=h.requests.length
 const expected=actor.piSession.getContextUsage(),actual=await routerContextWindow(h.service,h.host.ctx.agents,id)
 assert.equal(actual.status,'ready');assert.equal(actual.tokens,expected.tokens);assert.equal(actual.contextWindow,officialConversationContextBudget(actor.piSession.model,'ROUTER').budgetTokens)
 assert.equal(h.requests.length,before,'reading does not wake Pi')
 assert.deepEqual(await routerContextWindow(h.service,h.host.ctx.agents,'other-room'),{status:'unavailable'})
 const web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'context-preview',senderId:'operator',port:0},getApplication:()=>({config:{},tasks:h.service}),getAgents:()=>h.host.ctx.agents})
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
})
