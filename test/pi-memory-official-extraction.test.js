import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {ModelRuntime,SessionManager,SettingsManager,createAgentSession} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {memoryHost} from './fixtures/memory-host.js'
import {createNightOfficialContext} from '../src/runtime/pi-official-context.js'
import {officialCandidateText} from '../src/memory/extraction.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
async function fixture(t,{extract,grant=()=>true,binding={actorId:'alice'},mainStop='stop'}={}){
 const host=await memoryHost(t,()=>{throw Error('legacy llm must not be called')},{background:true}),service=host.host.ctx.memory,agentDir=join(host.root,'official-agent');await mkdir(agentDir)
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels().find(m=>m.provider==='openai')??runtime.getModels()[0];await runtime.setRuntimeApiKey(model.provider,'script-only')
 const auxiliary=[],main=[]
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context,options)=>{
  const isAux=context.messages.some(message=>message.role==='system'&&JSON.stringify(message).includes('NIGHT_BOT_MEMORY_CANDIDATES'))
  ;(isAux?auxiliary:main).push({context,options})
  const stream=createAssistantMessageEventStream()
  queueMicrotask(async()=>{
   let value
   try{value=isAux?await Promise.race([Promise.resolve(extract?.(context,options)),new Promise(resolve=>{if(options.signal?.aborted)resolve({stopReason:'aborted'});else options.signal?.addEventListener('abort',()=>resolve({stopReason:'aborted'}),{once:true})})]):{text:'main response',stopReason:mainStop}}catch{value={stopReason:'error'}}
   const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:value?.stopReason??'stop',content:value?.content??[{type:'text',text:value?.text??JSON.stringify({candidates:[]})}]}
   for(const delta of value?.deltas??[])stream.push({type:'text_delta',contentIndex:0,delta,partial:message})
   stream.push({type:['error','aborted'].includes(message.stopReason)?'error':'done',reason:message.stopReason,message,error:message});stream.end(message)
  });return stream
 }})
 const resolved={modelRuntime:runtime,model,thinkingLevel:'off',requestOptions:{maxTokens:31,maxRetries:0}},port=service.official({authorizeWrite:grant,isLive:actor=>live&&actor===current,resolveExtractionModel:async()=>resolved})
 let current,live=true,admitted={id:'run-one',messages:[{id:'message-one',source:{kind:'user',channelMessageKey:'opaque-channel',principal:'PRIVATE_PRINCIPAL'},content:'我长期偏好文字说明'}]}
 const settings=SettingsManager.inMemory({packages:[],compaction:{enabled:false},retry:{enabled:false}}),bridge=createNightOfficialContext({cwd:host.root,agentDir,getActor:()=>current,settingsManager:settings,memory:port});await bridge.resourceLoader.reload()
 const {session}=await createAgentSession({cwd:host.root,agentDir,modelRuntime:runtime,model,resourceLoader:bridge.resourceLoader,settingsManager:settings,sessionManager:SessionManager.inMemory(host.root),noTools:'all'})
 current={id:'official-memory',ctx:host.host.ctx,piSession:session,admission:{current:()=>admitted}}
 await service.bindSession(current.id,binding)
 t.after(()=>session.dispose())
 return {host,service,session,actor:current,auxiliary,main,port,resolved,get admitted(){return admitted},set admitted(value){admitted=value},retire(){live=false}}
}
const candidate=(context,quote='我长期偏好文字说明')=>({text:JSON.stringify({candidates:[{topic:'preferences',key:'format',messageId:JSON.parse(context.messages.find(m=>m.role==='user').content)[0].messageId,quote}]})})
test('real AgentSession settled hook extracts using official native runtime, keeps privacy and deduplicates source candidates',async t=>{
 const f=await fixture(t,{extract:context=>candidate(context)})
 await f.session.prompt('ordinary model prompt');await f.service.whenIdle()
 assert.equal(f.auxiliary.length,1);assert.equal(f.auxiliary[0].options.maxTokens,31)
 assert.equal(f.auxiliary[0].context.messages.length,2);assert.ok(!JSON.stringify(f.auxiliary[0].context).includes('PRIVATE_PRINCIPAL'))
 assert.equal((await f.service.read(f.actor,{topic:'preferences'})).entries.length,0)
 const pending=await f.service.read(f.actor,{candidates:true});assert.equal(pending.entries.length,1);assert.equal(pending.entries[0].source.messageId,'message-one');assert.equal(pending.entries[0].source.sessionId,f.actor.id)
 f.admitted={...f.admitted,id:'run-two'};await f.session.prompt('same admitted provenance again');await f.service.whenIdle()
 assert.equal((await f.service.read(f.actor,{candidates:true})).entries.length,1)
 assert.equal(f.actor.session,undefined);assert.equal(f.host.requests.length,0)
})
test('official background extraction cannot write without current explicit write grant or group permission',async t=>{
 const f=await fixture(t,{grant:()=>false,extract:context=>candidate(context)})
 await f.session.prompt('no grant');await f.service.whenIdle();assert.equal(f.auxiliary.length,0);assert.equal((await f.service.status(f.actor)).maintenanceCode,'MEMORY_READ_ONLY')
 const group=await fixture(t,{binding:{actorId:'alice',groupId:'group',groupWrite:false},extract:context=>candidate(context)})
 await group.session.prompt('group cannot write');await group.service.whenIdle();assert.equal(group.auxiliary.length,0)
})
test('revoked authority while official native inference is in flight prevents candidate persistence',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let writable=true
 t.after(()=>release.resolve())
 const f=await fixture(t,{grant:()=>writable,extract:async context=>{entered.resolve();await release.promise;return candidate(context)}})
 await f.session.prompt('ordinary');await entered.promise;writable=false;release.resolve();await f.service.whenIdle()
 assert.equal((await f.service.read(f.actor,{candidates:true})).entries.length,0);assert.equal((await f.service.status(f.actor)).maintenanceCode,'MEMORY_READ_ONLY')
})
test('forget during official inference invalidates its generation and cannot resurrect the fact',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await fixture(t,{extract:async context=>{entered.resolve();await release.promise;return candidate(context)}})
 await f.session.prompt('ordinary');await entered.promise
 f.admitted={id:'forget-run',messages:[{id:'forget-source',source:{kind:'user'},content:'忘记 preferences/format'}]}
 await f.session.prompt('forget');release.resolve();await f.service.whenIdle()
 assert.equal((await f.service.read(f.actor,{candidates:true})).entries.length,0);assert.equal((await f.service.status(f.actor)).maintenanceCode,'MEMORY_SCOPE_CHANGED')
})
test('native error/aborted/tool-use/incomplete and oversized extraction output never becomes memory',async t=>{
 const f=await fixture(t,{extract:()=>({stopReason:'error',text:'{"candidates":[]}'})})
 for(const stopReason of ['error','aborted','toolUse','length'])await assert.rejects(officialCandidateText({...f.resolved,modelRuntime:new Proxy(f.resolved.modelRuntime,{get(target,name){if(name==='streamSimple')return()=>{const stream=createAssistantMessageEventStream(),message={role:'assistant',stopReason,content:[{type:'text',text:'{"candidates":[]}'}]};queueMicrotask(()=>{stream.end(message)});return stream};const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value}})},[],{}),{code:'MEMORY_EXTRACTION_FAILED'})
 const oversized=await fixture(t,{extract:()=>({text:'x'.repeat(8193)})});await oversized.session.prompt('ordinary');await oversized.service.whenIdle();assert.equal((await oversized.service.status(oversized.actor)).maintenanceCode,'MEMORY_EXTRACTION_TOO_LARGE');assert.equal((await oversized.service.read(oversized.actor,{candidates:true})).entries.length,0)
 await f.session.prompt('ordinary');await f.service.whenIdle();assert.equal((await f.service.status(f.actor)).maintenanceCode,'MEMORY_EXTRACTION_FAILED')
})
test('service cancellation aborts and drains official extraction without writing candidates',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await fixture(t,{extract:async()=>{entered.resolve();await release.promise;return{text:'{"candidates":[]}'}}})
 await f.session.prompt('ordinary');await entered.promise
 const scope=await f.service.scope(f.actor);await f.host.close()
 assert.equal(f.service.background.size,0)
 const {MarkdownMemoryStore}=await import('../src/memory/store.js'),reopened=new MarkdownMemoryStore(f.service.root)
 try{assert.equal((await reopened.read(scope,{candidates:true})).entries.length,0)}finally{await reopened.close()}
 assert.equal(f.auxiliary[0].options.signal.aborted,true)
})

test('native text deltas are budget signals only and overflow aborts despite a small final result',async t=>{
 const f=await fixture(t,{extract:()=>({text:'{"candidates":[]}',deltas:['x'.repeat(8193)]})})
 await f.session.prompt('ordinary');await f.service.whenIdle()
 assert.equal((await f.service.status(f.actor)).maintenanceCode,'MEMORY_EXTRACTION_TOO_LARGE');assert.equal(f.auxiliary[0].options.signal.aborted,true)
 assert.equal((await f.service.read(f.actor,{candidates:true})).entries.length,0)
})
test('secrets never reach auxiliary provider and aborted primary turns never start extraction',async t=>{
 const secret=await fixture(t,{extract:context=>candidate(context)})
 secret.admitted={id:'secret-run',messages:[{id:'secret-source',source:{kind:'user'},content:'password=DO_NOT_SEND_THIS'}]}
 await secret.session.prompt('ordinary');await secret.service.whenIdle();assert.equal(secret.auxiliary.length,0);assert.equal((await secret.service.status(secret.actor)).maintenanceCode,'MEMORY_SECRET_REFUSED')
 const aborted=await fixture(t,{mainStop:'aborted',extract:context=>candidate(context)})
 await aborted.session.prompt('cancelled primary').catch(()=>{});await aborted.service.whenIdle();assert.equal(aborted.auxiliary.length,0)
})
