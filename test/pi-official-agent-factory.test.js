import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ModelRuntime,SettingsManager,AgentSession} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import * as Authority from '../src/pi-authority.js'
import NativeAgents from '../src/native-agents.js'
import NativeTools from '../src/native-tools.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {createScope} from '../src/native-scope.js'
import OfficialAgentFactory from '../src/pi-official-agent-factory.js'
import {officialRetrySettings} from '../src/runtime/pi-official-settings.js'
import {definition} from './fixtures/pi-official-tools.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-official-factory-'));await mkdir(join(root,'agent'))
 const ctx=new Context();await ctx.plugin(Authority);new NativeAgents(ctx)
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0});new NativeTools(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels()[0];await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 let requests=0,effects=0,drains=0,failDrain=false,unknown=false
 const retrySettings=officialRetrySettings({enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:10}).retry
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:()=>{
  requests++;const stream=createAssistantMessageEventStream(),tool=requests===1,error=requests===2
  const message={role:'assistant',content:tool?[{type:'toolCall',id:'once',name:'effect',arguments:{}}]:[{type:'text',text:error?'':'done'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:tool?'toolUse':error?'error':'stop',...error?{errorMessage:'503 service unavailable'}:{},usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  queueMicrotask(()=>{stream.push(error?{type:'error',reason:'error',error:message}:{type:'done',reason:message.stopReason,message});stream.end(message)});return stream
 }})
 ctx.tools.register(definition('effect',async(_args,context)=>{effects++;if(unknown){const actor=ctx.agents.get('unknown');actor.receipts.append({version:1,domain:'effect',kind:'unknown',payload:{callId:'once'}});await actor.receipts.commit()}return{ok:true}}))
 const factory=new OfficialAgentFactory(ctx,{auditKinds:{'effect/unknown':value=>value.callId==='once'},resolveResources:async()=>({resolved:{modelRuntime:runtime,model,retrySettings},agentDir:join(root,'agent'),registry:ctx.tools,maxParallelToolCalls:2,settingsManager:SettingsManager.inMemory({retry:retrySettings}),context:{systemPrompt:{officialSections:()=>({})}}}),authorizeInput:packet=>packet.source.kind==='test',drainBusiness:async actor=>{assert.equal(ctx.agents.get(actor.id),actor);assert.equal(actor.lifecycle.isLive(),true);drains++;if(failDrain)throw Error('unproven');return{processes:0,jobs:0}}})
 ctx.agents.setFactory(factory)
 let handle
 t.after(async()=>{failDrain=false;await handle?.dispose().catch(()=>{});await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {ctx,backend,factory,root,setHandle:h=>handle=h,get requests(){return requests},get effects(){return effects},get drains(){return drains},set failDrain(v){failDrain=v},set unknown(v){unknown=v}}
}
test('official factory publishes real SDK actor, retries without repeating effect, resumes without replay',async t=>{
 const f=await fixture(t);let setup=false
 let h=await f.ctx.agents.create({sessionId:'factory',meta:{cwd:f.root},setup:(_ctx,actor)=>{assert.equal(actor.metadata.id,'factory');assert.equal(actor.piSession,undefined);assert.equal(actor.session,undefined);assert.ok(Object.isFrozen(actor.metadata));setup=true}});f.setHandle(h)
 assert.ok(setup);assert.ok(h.session instanceof AgentSession)
 await assert.rejects(h.enqueue({id:'bad',source:{kind:'untrusted'},content:'no'}))
 await h.enqueue({id:'one',source:{kind:'test'},content:'once'});await h.deliver('one');await h.whenIdle()
 assert.equal(f.effects,1);assert.equal(f.requests,3)
 await h.runMaintenance(async actor=>{assert.equal(actor.admission.paused,true)})
 assert.equal(h.actor.admission.paused,false)
 await h.dispose();f.setHandle(undefined)
 h=await f.ctx.agents.resume({sessionId:'factory'});f.setHandle(h)
 await h.deliver('one');assert.equal(f.effects,1);assert.equal(f.requests,3)
 await h.cancel();assert.equal(h.actor.lifecycle.isLive(),true);await assert.rejects(async()=>h.deliver('one'))
 await h.dispose();f.setHandle(undefined);assert.equal(f.ctx.agents.get('factory'),undefined)
})
test('missing authority and drain capabilities fail before creating a store',async t=>{
 const f=await fixture(t)
 await assert.rejects(new OfficialAgentFactory(f.ctx,{}).createAgent(f.ctx,{sessionId:'denied'}),{code:'PI_OFFICIAL_FACTORY_CAPABILITIES_REQUIRED'})
})

test('unknown effect receipt fences the next request and survives cold persistence',async t=>{
 const f=await fixture(t);f.unknown=true
 const cause=Object.assign(Error('reconciliation required'),{code:'EFFECT_UNKNOWN'})
 const h=await f.ctx.agents.create({sessionId:'unknown',meta:{cwd:f.root},beforeRequest:async actor=>{if((await actor.receipts.read()).some(receipt=>receipt.domain==='effect'))throw cause}});f.setHandle(h)
 await h.enqueue({id:'unknown-input',source:{kind:'test'},content:'do once'})
 await assert.rejects(h.deliver('unknown-input'),error=>error===cause)
 await assert.rejects(h.whenIdle(),error=>error===cause)
 assert.equal(f.effects,1);assert.equal(f.requests,1)
 assert.ok((await f.backend.readNative('unknown')).audit.some(receipt=>receipt.domain==='effect'&&receipt.kind==='unknown'))
 await h.dispose();f.setHandle(undefined)
})
test('overlapping maintenance stays paused until every operation drains',async t=>{
 const f=await fixture(t),h=await f.ctx.agents.create({sessionId:'maintenance',meta:{cwd:f.root}});f.setHandle(h)
 const first=Promise.withResolvers(),entered=Promise.withResolvers()
 const one=h.runMaintenance(async()=>{entered.resolve();await first.promise})
 await entered.promise
 const two=h.runMaintenance(async actor=>{assert.equal(actor.admission.paused,true)})
 first.resolve();await Promise.all([one,two]);assert.equal(h.actor.admission.paused,false)
 f.failDrain=true;await assert.rejects(h.runMaintenance(()=>{}),/unproven/);assert.equal(h.actor.admission.paused,true)
 f.failDrain=false;await h.dispose();f.setHandle(undefined)
})
test('factory close drains published actors, preserves pending input and rejects later startup',async t=>{
 const f=await fixture(t),h=await f.ctx.agents.create({sessionId:'shutdown',meta:{cwd:f.root}});f.setHandle(h)
 await h.enqueue({id:'pending-at-shutdown',source:{kind:'test'},content:'later'})
 const closing=f.factory.close();assert.equal(f.factory.close(),closing);await closing
 assert.equal(f.ctx.agents.get('shutdown'),undefined)
 const cold=await f.backend.readNative('shutdown')
 assert.ok(cold.audit.some(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued'&&receipt.payload.id==='pending-at-shutdown'))
 assert.ok(!cold.audit.some(receipt=>receipt.domain==='admission'&&receipt.kind==='cancelled'))
 await h.dispose();f.setHandle(undefined)
 await assert.rejects(f.ctx.agents.create({sessionId:'too-late',meta:{cwd:f.root}}),{code:'PI_OFFICIAL_FACTORY_CLOSED'})
})
test('factory close aborts in-progress startup and joins its native store cleanup',async t=>{
 const f=await fixture(t),entered=Promise.withResolvers()
 const starting=f.ctx.agents.create({sessionId:'starting',meta:{cwd:f.root},setup:async(_ctx,actor)=>{
  entered.resolve();await new Promise((resolve,reject)=>{const signal=actor.lifecycle.signal;if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})
 }})
 const rejected=assert.rejects(starting,{code:'PI_OFFICIAL_FACTORY_CLOSED'})
 await entered.promise;await f.factory.close();await rejected
 assert.equal(f.ctx.agents.get('starting'),undefined)
 const store=await f.backend.openNative('starting',{auditKinds:{}});await store.close()
})

test('disposing the caller scope joins its exact actor before removing ownership',async t=>{
 const f=await fixture(t),owner=createScope(f.ctx,{})
 const h=await f.factory.createAgent(owner.ctx,{sessionId:'scoped',meta:{cwd:f.root}});f.setHandle(h)
 await owner.dispose()
 assert.equal(f.ctx.agents.get('scoped'),undefined)
 assert.ok(f.drains>0)
 await h.dispose();f.setHandle(undefined)
})
test('shutdown requested from its own startup or maintenance rejects instead of joining itself',async t=>{
 const f=await fixture(t)
 const h=await f.ctx.agents.create({sessionId:'reentrant-close',meta:{cwd:f.root},setup:async()=>{
  await assert.rejects(f.factory.close(),{code:'PI_OFFICIAL_FACTORY_CLOSE_REENTRANT'})
 }});f.setHandle(h)
 await h.runMaintenance(async()=>{
  await assert.rejects(f.factory.close(),{code:'PI_OFFICIAL_FACTORY_CLOSE_REENTRANT'})
  await assert.rejects(h.dispose(),{code:'PI_OFFICIAL_DISPOSE_REENTRANT'})
 })
 await f.factory.close();f.setHandle(undefined)
})
