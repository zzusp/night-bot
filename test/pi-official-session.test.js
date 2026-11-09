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
import {createNightOfficialSession} from '../src/runtime/pi-official-session.js'
import {definition} from './fixtures/pi-official-tools.js'
import {createBusinessAdmission,admissionAuditKinds} from '../src/runtime/pi-business-admission.js'

test('real official components execute, commit, cold-read and reopen with no Host session facade',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-official-session-')),agentDir=join(root,'agent');await mkdir(agentDir)
 const ctx=new Context();new NativeAgents(ctx);await ctx.plugin(Authority)
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0})
 new NativeTools(ctx)
 let active,live=true,effects=0,policyFailure
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
 const create=()=>createNightOfficialSession({ctx,store,agentDir,registry:ctx.tools,maxParallelToolCalls:2,resolved:{modelRuntime:runtime,model,thinkingLevel:'off',requestOptions:{maxTokens:31,maxRetries:0}},settingsManager:settings(),admission,beforeRequest:()=>admission.beforeRequest(),context:{systemPrompt:{officialSections(){if(policyFailure)throw policyFailure;return{}}}},createAudit:()=>({isLive:()=>live,isTurnOpen:()=>true,approvalPolicy:()=> 'never',append(){throw Error('no approval expected')},flush:()=>store.commit()})})
 active=await create();assert.equal(active.actor.session,undefined)
 assert.throws(()=>ctx.agents.enter(active.actor,undefined),/metadata/)
 active.actor.metadata=Object.freeze({id:store.id})
 const detach=ctx.agents.enter(active.actor,undefined)
 assert.equal(ctx.agents.get('official'),active.actor)
 assert.throws(()=>ctx.agents.enter({id:'forged',piSession:{sessionId:'forged'}},undefined),/identity/)
 detach()
 await admission.enqueue({id:'one',source:{kind:'coordinator'},content:'run once'})
 await active.deliver('one');assert.deepEqual(admission.pending(),[])
 assert.equal(effects,1);assert.equal(dispatches,2)
 const cold=await backend.readNative('official');assert.equal(cold.audit.length,3);assert.equal(cold.context.piMessages.filter(m=>m.role==='toolResult').length,1)
 await active.close();active=undefined
 store=await backend.openNative('official',options);admission=await createBusinessAdmission({store,authorize:()=>true});active=await create()
 assert.deepEqual(await active.deliver('one'),{id:'one',duplicate:true})
 assert.equal(effects,1);assert.equal(dispatches,2,'reopening never replays a tool or dispatches the model')
 assert.ok(active.session.messages.some(m=>m.role==='toolResult'&&m.toolCallId==='effect-one'))
 policyFailure=Object.assign(new Error('Signed content cannot be rewritten'),{code:'MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT'})
 await assert.rejects(active.prompt('clearly report refusal'),error=>error===policyFailure)
 assert.equal(dispatches,2);assert.equal(effects,1)
 await active.close();active=undefined;live=false
})
