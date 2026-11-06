import {join} from 'node:path'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createTopicCoordinator} from '../packages/dingtalk-core/topic-runtime.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'

test('actual official Host missing credentials retain the original error while coordination resumes and health stays clear',{timeout:15000},async t=>{
 const {createHost}=await import('../src/host.js')
 const {mkdtemp,rm}=await import('node:fs/promises')
 const {createServer}=await import('node:http')
 const {handleRequest}=await import('../packages/dingtalk-core/http.js')
 const root=await mkdtemp(join(tmpdir(),'topic-real-missing-credentials-'))
 let host,handle,store,coordinator,server
 t.after(async()=>{
  await coordinator?.close();await handle?.dispose();await store?.close();await host?.close()
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  await rm(root,{recursive:true,force:true})
 })
 host=await createHost({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/no-network',apiKeyEnv:'MISSING_TOPIC_REGRESSION_KEY',retry:{enabled:false,maxRetries:0,provider:{maxRetries:0}},models:[{id:'m',maxTokens:64,contextWindow:8192}]}},memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false},{environmentOptions:{inherited:{}}})
 handle=await host.ctx.agents.create({sessionId:'missing-topic-credentials',meta:{cwd:host.ctx.runtimePaths.workspaces,agentPreset:'night-bot'},authorizeInput:packet=>packet.source.kind==='coordinator'})
 store=await openResidentStore(host.ctx.storageDomain)
 await store.subscribe({groupId:'g',responsibility:'isolated missing credentials regression'});await store.setAgentNames(['助理'])
 const errors=[],sent=[],resumed=Promise.withResolvers()
 coordinator=createTopicCoordinator({store,reviewCandidates:()=>[],getAgent:()=>handle.actor,assertSession(){},serializeTasks:fn=>fn(),isClosing:()=>false,retryDelayMs:1,maxRequestAttempts:2,
  onError:(_group,error)=>{errors.push(error);resumed.reject(error)},
  async dispatchRequest(_request,message){
   sent.push(message)
   await handle.enqueue({id:message.id,source:message.source,content:message.content})
   if(sent.length===1){await handle.deliver(message.id);await handle.whenIdle()}
   else resumed.resolve(message)
   return handle.actor
  }
 })
 await store.ingest({groupId:'g',messageId:'missing-key-input',text:'@助理 核对请求',senderOpenDingTalkId:'fixture-user',occurredAt:'2026-11-06T00:00:00Z'})
 await coordinator.schedule('g')
 const reminder=await resumed.promise
 await coordinator.close()
 assert.match(reminder.content[0].text,/^\[COORDINATION_RESUME\]/)
 const messages=handle.session.sessionManager.buildSessionProjection().messages
 assert.ok(messages.some(message=>message.role==='system'&&typeof message.content==='string'))
 const failure=messages.findLast(message=>message.role==='assistant'&&message.stopReason==='error')
 assert.match(failure.errorMessage,/No credential is available for provider fixture/)
 assert.doesNotMatch(failure.errorMessage,/\.some|TypeError/)
 assert.deepEqual(errors,[])
 const state=store.getCoordinationRequest('g',JSON.parse(sent[0].content[0].text.split('\n').find(line=>line.startsWith('Topic 请求：')).slice('Topic 请求：'.length)).requestId)
 assert.equal(state.attempt,1);assert.notEqual(state.failureCode,'COORDINATION_DISPATCH_FAILED')
 // Exercise the production health handler against the coordinator's recovery
 // issue feed, without starting transport/vendor integrations.
 server=createServer((request,response)=>{void handleRequest(request,response,{listRecoveryIssues:()=>errors.map(error=>({code:error.code??error.message}))}).catch(error=>{response.writeHead(500);response.end(String(error))})})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const health=await(await fetch(`http://127.0.0.1:${server.address().port}/health`)).json()
 assert.equal(health.status,'ok');assert.equal(health.recoveryIssueCount,0)
})
