import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {createTopicCoordinator} from '../packages/dingtalk-core/topic-runtime.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {mkdtemp,rm} from 'node:fs/promises'
import {openNativeDomains} from '../src/native-domain.js'
import {visibilityFixture} from './fixtures/pi-coordination-visibility.js'

async function retryFixture(t,{history,pending=false}){
 const root=await mkdtemp('/tmp/topic-shape-regression-')
 const domains=await openNativeDomains({root}),store=await openResidentStore(domains)
 await store.subscribe({groupId:'g',responsibility:'isolated retry regression'});await store.setAgentNames(['助理'])
 const sent=[],errors=[],resumed=Promise.withResolvers()
 let idle=0,coordinator
 const visibility=await visibilityFixture(t),agent=visibility.actor
 agent.whenIdle=()=>++idle===1?Promise.resolve():new Promise(()=>{})
 coordinator=createTopicCoordinator({store,reviewCandidates:()=>[],getAgent:()=>agent,assertSession(){},serializeTasks:fn=>fn(),isClosing:()=>false,retryDelayMs:1,maxRequestAttempts:2,onError:(_group,error)=>{errors.push(error);resumed.reject(error)},async dispatchRequest(_request,message){
  sent.push(message)
  if(sent.length===1){for(const entry of history(message))if(entry&&typeof entry==='object'&&!Array.isArray(entry))visibility.manager.appendMessage({...entry,timestamp:1});if(pending){visibility.packets.set(message.id,message);visibility.pendingIds.push(message.id)}}else resumed.resolve(message)
  return agent
 }})
 t.after(async()=>{await coordinator.close();await store.close();await domains.closeAll();await rm(root,{recursive:true,force:true})})
 await store.ingest({groupId:'g',messageId:'input',text:'@助理 核对原请求',senderOpenDingTalkId:'fixture-user',occurredAt:'2026-11-06T00:00:00Z'})
 await coordinator.schedule('g')
 return {sent,errors,resume:resumed.promise,store}
}

test('coordination retry accepts official string and block content without losing exact-body visibility',{timeout:10000},async t=>{
 for(const shape of ['system-string-only','system-then-user-string','system-then-user-blocks','pending'])await t.test(shape,async t=>{
  const manager=SessionManager.inMemory('/tmp')
  const h=await retryFixture(t,{pending:shape==='pending',history:original=>{
   manager.appendMessage({role:'system',content:shape==='system-string-only'?original.content[0].text:'official system instructions',timestamp:1})
   if(shape==='system-then-user-string')manager.appendMessage({role:'user',content:original.content[0].text,timestamp:2})
   if(shape==='system-then-user-blocks')manager.appendMessage({role:'user',content:original.content,timestamp:2})
   return manager.buildSessionProjection().messages
  }})
  const reminder=await h.resume
  assert.match(reminder.content[0].text,/^\[COORDINATION_RESUME\]/)
  assert.ok(reminder.content[0].text.length<h.sent[0].content[0].text.length)
  assert.deepEqual(h.errors,[])
 })
})

test('unrelated system strings and malformed content cannot masquerade as the original retry body',{timeout:10000},async t=>{
 for(const content of ['unrelated system prompt',null,42,{some:true},[null,{},'text',{type:'image',text:'wrong'},{type:'text',text:42}]])await t.test(JSON.stringify(content),async t=>{
  const h=await retryFixture(t,{history:()=>[null,{role:'system',content},[]]})
  const restored=await h.resume
  assert.equal(restored.content[0].text,h.sent[0].content[0].text)
  assert.doesNotMatch(restored.content[0].text,/^\[COORDINATION_RESUME\]/)
  assert.deepEqual(h.errors,[])
 })
})

