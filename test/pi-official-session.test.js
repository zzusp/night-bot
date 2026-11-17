import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ModelRuntime,SettingsManager} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import NativeTools from '../src/native-tools.js'
import NativeAgents from '../src/native-agents.js'
import sharp from 'sharp'
import {bindPiAgentObservation} from '../src/runtime/pi-agent-observation.js'
import {createNightOfficialSession} from '../src/runtime/pi-official-session.js'
import {definition} from './fixtures/pi-official-tools.js'
import {createBusinessAdmission,admissionAuditKinds} from '../src/runtime/pi-business-admission.js'

test('real official components execute, commit, cold-read and reopen with no Host session facade',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-official-session-')),agentDir=join(root,'agent');await mkdir(agentDir)
 const ctx=new Context();new NativeAgents(ctx);await ctx.plugin(Authority)
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0})
 new NativeTools(ctx)
 let active,live=true,effects=0,policyFailure,resourceFailure,resourceReads=0
 t.after(async()=>{await active?.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai')??runtime.getModels()[0];await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 let dispatches=0
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context,options)=>{
  assert.equal(options.maxTokens,31);dispatches++
  const stream=createAssistantMessageEventStream(),calls=dispatches===1
  const message={role:'assistant',content:calls?[{type:'toolCall',id:'effect-one',name:'effect',arguments:{}}]:[{type:'text',text:'done'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:calls?'toolUse':'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 ctx.tools.register(definition('effect',async()=>{effects++;return{ok:true}}))
 const options={auditKinds:{...admissionAuditKinds,'effect/receipt':v=>v.callId==='effect-one'&&v.state==='settled'}}
 let store=await backend.createNative({version:4,id:'official',createdAt:Date.now(),isSeeded:false,cwd:root},options)
 let admission=await createBusinessAdmission({store,authorize:packet=>packet.source.kind==='coordinator'})
 ctx.on('tools/execute',async(exec,next)=>{const result=await next();store.appendAudit({version:1,domain:'effect',kind:'receipt',payload:{callId:exec.callId,state:'settled'}});await exec.agent.audit.flush();return result})
 const settings=()=>SettingsManager.inMemory({packages:[],compaction:{enabled:false},retry:{enabled:false}})
 const create=()=>createNightOfficialSession({ctx,store,agentDir,registry:ctx.tools,maxParallelToolCalls:2,resolved:{modelRuntime:runtime,model,thinkingLevel:'off',requestOptions:{maxTokens:31,maxRetries:0}},settingsManager:settings(),admission,beforeRequest:()=>admission.beforeRequest(),context:{instructions:async()=>{resourceReads++;if(resourceFailure)throw resourceFailure;return []},systemPrompt:{officialSections(){if(policyFailure)throw policyFailure;return{}}}},createAudit:()=>({isLive:()=>live,isTurnOpen:()=>true,approvalPolicy:()=> 'never',append(){throw Error('no approval expected')},flush:()=>store.commit()})})
 active=await create();assert.equal(active.actor.session,undefined);assert.equal(resourceReads,1)
 assert.throws(()=>ctx.agents.enter(active.actor,undefined),/metadata/)
 active.actor.metadata=Object.freeze({id:store.id})
 const detach=ctx.agents.enter(active.actor,undefined)
 assert.equal(ctx.agents.get('official'),active.actor)
 assert.throws(()=>ctx.agents.enter({id:'forged',piSession:{sessionId:'forged'}},undefined),/identity/)
 detach()
 await admission.enqueue({id:'one',source:{kind:'coordinator'},content:'run once'})
 await active.deliver('one');assert.deepEqual(admission.pending(),[])
 assert.equal(effects,1);assert.equal(dispatches,2)
 assert.equal(resourceReads,4,'create + before-run + two turn boundaries, without duplicate custom-delivery read')
 const cold=await backend.readNative('official');assert.equal(cold.audit.length,3);assert.equal(cold.context.piMessages.filter(m=>m.role==='toolResult').length,1)
 await active.close();active=undefined
 store=await backend.openNative('official',options);admission=await createBusinessAdmission({store,authorize:()=>true});active=await create()
 const beforeDuplicate=resourceReads
 assert.deepEqual(await active.deliver('one'),{id:'one',duplicate:true})
 assert.equal(resourceReads,beforeDuplicate,'duplicate business input must not rescan resources')
 assert.equal(effects,1);assert.equal(dispatches,2,'reopening never replays a tool or dispatches the model')
 assert.ok(active.session.messages.some(m=>m.role==='toolResult'&&m.toolCallId==='effect-one'))
 resourceFailure=Object.assign(new Error('Current instruction permission revoked'),{code:'FIXTURE_RESOURCE_REVOKED'})
 await admission.enqueue({id:'revoked-resource',source:{kind:'coordinator'},content:'must not use stale authorized resources'})
 await assert.rejects(active.deliver('revoked-resource'),error=>error===resourceFailure)
 assert.equal(dispatches,2,'before-run revalidates resources and prevents a model request after revocation')
 resourceFailure=undefined
 policyFailure=Object.assign(new Error('Signed content cannot be rewritten'),{code:'MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT'})
 await assert.rejects(active.prompt('clearly report refusal'),error=>error===policyFailure)
 assert.equal(dispatches,2);assert.equal(effects,1)
 await active.close();active=undefined;live=false
})

async function conversationFixture(t,{sections={},getLimits}={}){
 const root=await mkdtemp(join(tmpdir(),'night-compaction-review-')),agentDir=join(root,'agent');await mkdir(agentDir)
 const ctx=new Context();new NativeAgents(ctx);await ctx.plugin(Authority)
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0});new NativeTools(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')}),controller=new AbortController()
 const store=await backend.createNative({version:4,id:'review-router',createdAt:Date.now(),isSeeded:false,cwd:root,runtimeOwner:'conversation-router',conversationId:'review-room',generation:1},{auditKinds:admissionAuditKinds})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const base=runtime.getModels().find(m=>m.provider==='openai'&&m.input.includes('image')),model={...base,contextWindow:131072}
 await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 const requests=[];let failRequest=false
 runtime.registerProvider(model.provider,{api:model.api,models:[model],streamSimple:(_model,context)=>{
  requests.push(context)
  const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:failRequest?'':'Preserved facts and next action.'}],api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:failRequest?'error':'stop',...failRequest?{errorMessage:'Synthetic checkpoint failure'}:{},usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  queueMicrotask(()=>{stream.push(failRequest?{type:'error',reason:'error',error:message}:{type:'done',reason:'stop',message});stream.end(message)});return stream
 }})
 const admission=await createBusinessAdmission({store,authorize:()=>true}),settingsManager=SettingsManager.inMemory({packages:[],cacheWarming:'off',compaction:{keepRecentTokens:100},retry:{enabled:false}})
 const official=await createNightOfficialSession({ctx,store,agentDir,admission,registry:ctx.tools,maxParallelToolCalls:1,settingsManager,resolved:{modelRuntime:runtime,model,thinkingLevel:'off',...getLimits?{requestImageLimitsFor:getLimits}:{}},
  prepareActor:actor=>{actor.metadata=Object.freeze({...store.header});actor.lifecycle=Object.freeze({signal:controller.signal,isLive:()=>!controller.signal.aborted})},
  context:{systemPrompt:{officialSections:()=>sections}},beforeRequest:()=>admission.beforeRequest(),
  createAudit:()=>({isLive:()=>true,isTurnOpen:()=>true,approvalPolicy:()=> 'never',append(){assert.fail('no approval expected')},flush:()=>store.commit()})})
 const detach=ctx.agents.enter(official.actor,undefined)
 t.after(async()=>{await official.close();detach();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const seed=async()=>{
  for(let i=0;i<12;i++){
   store.manager.appendMessage({role:'user',content:'historical work '.repeat(2500),timestamp:Date.now()})
   store.manager.appendMessage({role:'assistant',content:[{type:'text',text:'Existing work concluded.'}],api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:'stop',usage:{input:110000,output:10,cacheRead:0,cacheWrite:0,totalTokens:110010,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
  }
  await store.commit();official.session.refreshContext()
 }
 return {official,store,admission,controller,requests,seed,setFail:value=>{failRequest=value}}
}
const reviewPacket=(id,content='ordinary new business')=>({id,source:{kind:'conversation-router',conversationId:'review-room',generation:1,eventIds:[id]},content})

test('conversation accepts a new text packet after the previous request image policy is corrected',async t=>{
 let imageBytes=1
 const f=await conversationFixture(t,{getLimits:()=>({requestImagePixelBudget:1000000,requestImageMaxBytes:1000000,maxRequestImageBytes:imageBytes})})
 const image={type:'image',mimeType:'image/png',data:(await sharp({create:{width:2,height:2,channels:3,background:'#4488cc'}}).png().toBuffer()).toString('base64')}
 await f.admission.enqueue(reviewPacket('image',[image]))
 await assert.rejects(f.official.deliver('image'),{code:'IMAGE_OFFLOAD_REQUIRED'});assert.equal(f.requests.length,0)
 imageBytes=1000000
 await f.admission.enqueue(reviewPacket('text'))
 await f.official.deliver('text');assert.equal(f.requests.length,1);assert.equal(f.official.requestImageFailure,undefined)
 assert.equal(f.admission.status('text'),'admitted')
 assert.ok(f.store.manager.getEntries().some(entry=>entry.type==='custom_message'&&entry.details?.packetId==='image'))
})

test('first conversation input budgets application system sections before admitting business text',async t=>{
 const f=await conversationFixture(t,{sections:{night_review:'s'.repeat(80000)}})
 await f.admission.enqueue(reviewPacket('large','x'.repeat(452000)))
 await assert.rejects(f.official.deliver('large'),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.deepEqual(f.admission.pending(),['large']);assert.equal(f.requests.length,0)
 assert.equal(f.store.manager.getEntries().some(entry=>entry.type==='custom_message'&&entry.details?.packetId==='large'),false)
})

test('duplicate and cancelled conversation inputs never invoke preflight compaction',async t=>{
 const f=await conversationFixture(t)
 await f.admission.enqueue(reviewPacket('original'));await f.official.deliver('original');await f.seed()
 const requests=f.requests.length,compactions=f.store.manager.getEntries().filter(entry=>entry.type==='compaction').length
 assert.deepEqual(await f.official.deliver('original'),{id:'original',duplicate:true})
 await f.admission.enqueue(reviewPacket('cancelled'));await f.admission.cancelPending()
 await assert.rejects(f.official.deliver('cancelled'),{code:'PI_BUSINESS_INPUT_CANCELLED'})
 assert.equal(f.requests.length,requests);assert.equal(f.store.manager.getEntries().filter(entry=>entry.type==='compaction').length,compactions)
})

test('Router resume rejects oversized supplements before claiming checkpoint or appending input',async t=>{
 const f=await conversationFixture(t),original=reviewPacket('original');f.setFail(true)
 await f.admission.enqueue(original);await f.official.deliver(original.id);f.setFail(false)
 let claims=0
 await assert.rejects(f.official.resumeRouterBatch(original,()=>{claims++;return {}},()=>{},[reviewPacket('oversized','x'.repeat(480000))]),{code:'PI_CONTEXT_INPUT_TOO_LARGE'})
 assert.equal(claims,0);assert.equal(f.admission.has('oversized'),false)
 assert.equal(f.store.manager.getEntries().some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-claim'),false)
 assert.equal(f.admission.status(original.id),'admitted');assert.equal(f.requests.length,1)
})

test('immediate owner cancellation stops native preflight before any summary dispatch',async t=>{
 const f=await conversationFixture(t);await f.seed()
 const compact=f.official.session.compact.bind(f.official.session),reason=new Error('review owner cancelled')
 f.official.session.compact=(...args)=>{const pending=compact(...args);f.controller.abort(reason);return pending}
 await f.admission.enqueue(reviewPacket('pending'))
 await assert.rejects(f.official.deliver('pending'),error=>error===reason)
 assert.equal(f.requests.length,0);assert.deepEqual(f.admission.pending(),['pending'])
 assert.equal(f.store.manager.getEntries().some(entry=>entry.type==='compaction'),false)
})

test('native preflight summaries never acquire or retain the previous business observation runId',async t=>{
 const f=await conversationFixture(t)
 await f.admission.enqueue(reviewPacket('previous'));await f.official.deliver('previous');await f.seed()
 const records=[],errors=[],observer=bindPiAgentObservation({actor:f.official.actor,emit:(_actor,record)=>records.push(record),onError:error=>errors.push(error)})
 t.after(()=>observer.close())
 await f.admission.enqueue(reviewPacket('next'));await f.official.deliver('next')
 assert.ok(f.store.manager.getEntries().some(entry=>entry.type==='compaction'))
 assert.ok(records.some(record=>record.kind==='model-started'));assert.ok(records.some(record=>record.kind==='run-settled'))
 assert.deepEqual([...new Set(records.map(record=>record.runId))],['next'])
 assert.equal(records.filter(record=>record.kind==='model-started').length,1);assert.deepEqual(errors,[])
})


test('native system section patches are counted once for a legal near-window input',async t=>{
 const f=await conversationFixture(t,{sections:{night_review:'s'.repeat(80000)}})
 await f.admission.enqueue(reviewPacket('first'));await f.official.deliver('first')
 await f.admission.enqueue(reviewPacket('near-window','x'.repeat(320000)))
 await f.official.deliver('near-window')
 assert.equal(f.admission.status('near-window'),'admitted');assert.deepEqual(f.admission.pending(),[])
 assert.equal(f.requests.length,2)
})

test('close during native preflight token installation aborts summary and drains pending input',async t=>{
 const f=await conversationFixture(t);await f.seed()
 const compact=f.official.session.compact.bind(f.official.session);let closing
 f.official.session.compact=(...args)=>{const pending=compact(...args);closing=f.official.close();return pending}
 await f.admission.enqueue(reviewPacket('pending-close'))
 await assert.rejects(f.official.deliver('pending-close'))
 await closing
 assert.equal(f.requests.length,0);assert.deepEqual(f.admission.pending(),['pending-close'])
 assert.equal(f.store.manager.getEntries().some(entry=>entry.type==='compaction'),false)
})
