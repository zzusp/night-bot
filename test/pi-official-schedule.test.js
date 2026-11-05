import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ModelRuntime,SettingsManager,AgentSession} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import * as Authority from '../src/pi-authority.js'
import NativeAgents from '../src/native-agents.js'
import NativeTools from '../src/native-tools.js'
import NativeSchedule from '../src/native-schedule.js'
import NativeSessionController from '../src/native-session-controller.js'
import PiPersistence from '../src/pi-session-persistence.js'
import OfficialAgentFactory from '../src/pi-official-agent-factory.js'
import {openNativeDomains} from '../src/native-domain.js'
import {officialRetrySettings} from '../src/runtime/pi-official-settings.js'
import {createEveryScheduleRecord,scheduleDomain} from '../src/native-schedule-protocol.js'

async function fixture(t){
 const root=await mkdtemp('/tmp/night-official-schedule-');await mkdir(join(root,'agent'))
 const ctx=new Context();await ctx.plugin(Authority);new NativeAgents(ctx)
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{},getSectionOrder:()=>0,context:()=>()=>{},getContextOrder:()=>0});new NativeTools(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')}),domains=await openNativeDomains({root:join(root,'domains')});ctx.provide('storageDomain',domains)
 ctx.provide('workspaceRegistry',{archivedSessionIds:[]});ctx.provide('agentPresets',{mount:async()=>{}})
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels()[0];await runtime.setRuntimeApiKey(model.provider,'scripted-only');const requests=[]
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context)=>{requests.push({model:_model,context});const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:'done'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};queueMicrotask(()=>stream.end(message));return stream}})
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:model.provider,model:model.id})})
 const selected=[],retrySettings=officialRetrySettings({enabled:false}).retry
 const factory=new OfficialAgentFactory(ctx,{resolveResources:async({options})=>{selected.push(options.agentOptions);return{resolved:{modelRuntime:runtime,model,thinkingLevel:options.agentOptions?.reasoningEffort,retrySettings},agentDir:join(root,'agent'),registry:ctx.tools,maxParallelToolCalls:2,settingsManager:SettingsManager.inMemory({retry:retrySettings}),context:{systemPrompt:{officialSections:()=>({})}}}},authorizeInput:(packet,actor)=>ctx.schedule.authorizeInput(packet,actor),drainBusiness:async()=>({processes:0,jobs:0})})
 ctx.agents.setFactory(factory);new NativeSessionController(ctx);const schedule=new NativeSchedule(ctx,{});await schedule.initialized
 const handles=[]
 t.after(async()=>{await schedule.runtime.dispose();for(const h of handles)await h.dispose();await ctx.fiber.dispose();await domains.closeAll();await rm(root,{recursive:true,force:true})})
 return{ctx,schedule,backend,requests,selected,root,async create(id,meta={}){const h=await ctx.agents.create({sessionId:id,meta:{cwd:root,agentPreset:'night-bot',...meta},agentOptions:{provider:model.provider,model:model.id}});handles.push(h);return h},async due(id='ordinary'){const r=await schedule.create(id,{title:'reminder',prompt:'REMINDER_PROOF',at:new Date(Date.now()+40).toISOString()});await new Promise(resolve=>setTimeout(resolve,55));schedule.runtime.requestDrive();await schedule.runtime.running;await ctx.agents.get(id)?.whenIdle();return r}}
}
test('schedule persists accepted batch and official input before SDK delivery, and denies forged or foreign packets',async t=>{
 const f=await fixture(t),h=await f.create('ordinary');assert.ok(h.session instanceof AgentSession);assert.equal(h.actor.session,undefined)
 const row=await f.due();assert.equal(f.requests.length,1)
 const domain=await f.schedule.ready,delivery=[...domain.table('deliveries').entries()][0][1]
 assert.equal(delivery.queued,true);assert.equal((await f.schedule.catalog())[0].lastDelivery.messageId,delivery.packet.id)
 const saved=await f.backend.readNative('ordinary');assert.ok(saved.audit.some(r=>r.domain==='admission'&&r.kind==='admitted'));assert.equal(saved.entries.filter(e=>e.type==='custom_message'&&e.customType==='night.business-input').length,1)
 await assert.rejects(h.enqueue({...delivery.packet,content:[{type:'text',text:'forged'}]}),{code:'PI_BUSINESS_ADMISSION_DENIED'})
 const other=await f.create('foreign');await assert.rejects(other.enqueue(delivery.packet),{code:'PI_BUSINESS_ADMISSION_DENIED'})
 await f.schedule.delete({sessionId:'ordinary',id:row.id});await h.enqueue(delivery.packet);await h.deliver(delivery.packet.id);assert.equal(f.requests.length,1)
 f.schedule.runtime.requestDrive();await f.schedule.runtime.running;assert.equal(f.requests.length,1)
})
test('accepted ledger survives receipt failure and frozen recurring batch recovers once',async t=>{
 const f=await fixture(t);await f.create('batch');const domain=await f.schedule.ready
 for(const id of ['one','two'])await domain.table('tasks').put(id,{sessionId:'batch',record:createEveryScheduleRecord(id,id,60,Date.now()-120000,'batch'),status:'active',deliveryHistory:{records:[],earlierRecordsUnavailable:false}})
 const commit=f.schedule.runtime.commit;let count=0;f.schedule.runtime.commit=async row=>{if(++count===2)throw Error('second row failure');return commit(row)}
 f.schedule.runtime.requestDrive();await f.schedule.runtime.running;assert.equal(f.requests.length,0);assert.equal(domain.table('deliveries').size,1)
 f.schedule.runtime.commit=commit;f.schedule.runtime.requestDrive();await f.schedule.runtime.running;await f.ctx.agents.get('batch').whenIdle()
 assert.equal(f.requests.length,1);const rows=await f.schedule.catalog();assert.equal(rows[0].lastDelivery.messageId,rows[1].lastDelivery.messageId)
 f.schedule.runtime.requestDrive();await f.schedule.runtime.running;assert.equal(f.requests.length,1)
})
test('cold controller resumes official saved model state and refuses delegated, task and archived ownership',async t=>{
 const f=await fixture(t),h=await f.create('cold');h.session.setThinkingLevel('off');await h.actor.receipts.commit();await h.dispose()
 const found=await f.ctx.sessionController.resolveAgent('cold');if(found.error)throw found.error
 assert.ok(found.agent.piSession instanceof AgentSession);assert.equal(found.agent.session,undefined);assert.equal(f.selected.at(-1).reasoningEffort,'off')
 for(const [id,meta]of [['child',{origin:'subagent',delegationDepth:1}],['task',{agentPreset:'night-bot-task'}],['archived',{}]]){const other=await f.create(id,meta);await other.dispose();if(id==='archived')f.ctx.workspaceRegistry.archivedSessionIds.push(id);const result=await f.ctx.sessionController.resolveAgent(id);assert.ok(result.error);assert.equal(f.ctx.agents.get(id),undefined)}
 assert.equal(f.requests.length,0)
})

test('crash after queue persistence repairs queued marker on cold actor without duplicate input or inference',async t=>{
 const f=await fixture(t),h=await f.create('queue-gap'),runtime=f.schedule.runtime,save=runtime.saveDelivery
 runtime.saveDelivery=async row=>{if(row.queued)throw Error('queued marker failure');return save(row)}
 await f.due('queue-gap');assert.equal(f.requests.length,0)
 const queued=await f.backend.readNative('queue-gap');assert.equal(queued.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').length,1)
 await h.dispose();runtime.saveDelivery=save;runtime.requestDrive();await runtime.running;await f.ctx.agents.get('queue-gap').whenIdle();assert.equal(f.requests.length,1)
 const saved=await f.backend.readNative('queue-gap');assert.equal(saved.audit.filter(r=>r.domain==='admission'&&r.kind==='enqueued').length,1);assert.equal(saved.entries.filter(e=>e.type==='custom_message'&&e.customType==='night.business-input').length,1)
 const copy=join(f.root,'cold-domain');await mkdir(copy);await writeFile(join(copy,'schedule.json'),await readFile(join(f.root,'domains','schedule.json')))
 const storage=await openNativeDomains({root:copy});try{const domain=await storage.open(scheduleDomain);assert.equal(domain.table('deliveries').size,1);assert.equal([...domain.table('deliveries').entries()][0][1].queued,true)}finally{await storage.closeAll()}
 runtime.requestDrive();await runtime.running;await f.ctx.agents.get('queue-gap').whenIdle();assert.equal(f.requests.length,1)
})

test('explicit schedule cancellation revokes accepted-but-not-delivered packets while shutdown alone retains them',async t=>{
 const f=await fixture(t),h=await f.create('cancel-gap'),runtime=f.schedule.runtime,commit=runtime.commit
 runtime.commit=async()=>{throw Error('hold before queue')}
 await f.due('cancel-gap');assert.equal(f.requests.length,0);assert.equal(h.actor.admission.pending().length,0)
 await f.schedule.cancelAccepted(h.actor);const domain=await f.schedule.ready,row=[...domain.table('deliveries').entries()][0][1];assert.equal(row.cancelled,true)
 await assert.rejects(h.enqueue(row.packet),{code:'PI_BUSINESS_ADMISSION_DENIED'})
 await h.dispose();runtime.commit=commit;runtime.requestDrive();await runtime.running
 assert.equal(f.requests.length,0);assert.equal(f.ctx.agents.get('cancel-gap'),undefined)
})
