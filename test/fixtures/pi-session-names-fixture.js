import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ModelRuntime,SettingsManager} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import * as Authority from '../../src/pi-authority.js'
import NativeAgents from '../../src/native-agents.js'
import NativeTools from '../../src/native-tools.js'
import PiPersistence from '../../src/pi-session-persistence.js'
import OfficialAgentFactory from '../../src/pi-official-agent-factory.js'
import PiSessionNames,{sessionNameAuditKinds} from '../../src/pi-session-names.js'
export async function namesFixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-session-names-'));await mkdir(join(root,'agent'))
 const ctx=new Context();await ctx.plugin(Authority);new NativeAgents(ctx)
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0});new NativeTools(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels()[0];await runtime.setRuntimeApiKey(model.provider,'scripted-only')
 const requests=[];let respond=()=> 'Approved name'
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context,options)=>{
  requests.push({context:structuredClone(context),options});assert.equal(context.tools,undefined)
  const stream=createAssistantMessageEventStream()
  Promise.resolve().then(()=>respond(options)).then(text=>{
   const message={role:'assistant',content:[{type:'text',text}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
   stream.push({type:'done',reason:'stop',message});stream.end(message)
  });return stream
 }})
 const names=new PiSessionNames({readCommitted:actor=>backend.readNative(actor.id,{requireComplete:true})})
 const factory=new OfficialAgentFactory(ctx,{auditKinds:sessionNameAuditKinds,resolveResources:async()=>({resolved:{modelRuntime:runtime,model},agentDir:join(root,'agent'),registry:ctx.tools,maxParallelToolCalls:2,settingsManager:SettingsManager.inMemory(),context:{systemPrompt:{officialSections:()=>({})}}}),authorizeInput:()=>true,drainBusiness:async()=>({processes:0,jobs:0})})
 ctx.agents.setFactory(factory);let handle=await ctx.agents.create({sessionId:'names',meta:{cwd:root}})
 const bind=options=>names.bind(handle.actor,{resolveModel:async()=>({modelRuntime:runtime,model}),readPublicSubject:async()=>({id:'public-subject',text:'Approved public label'}),...options})
 t.after(async()=>{await names.close().catch(()=>{});await handle.dispose().catch(()=>{});await factory.close().catch(()=>{});await ctx.fiber.dispose().catch(()=>{});await rm(root,{recursive:true,force:true})})
 return {ctx,backend,names,runtime,model,requests,bind,get handle(){return handle},set respond(value){respond=value},async reopen(){await names.closeActor(handle.actor);await handle.dispose();handle=await ctx.agents.resume({sessionId:'names'});return handle}}
}
