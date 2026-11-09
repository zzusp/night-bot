import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,appendFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader,ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {isRetryableAssistantError} from '@earendil-works/pi-ai/compat'
import {retryDelayMs} from '@earendil-works/pi-ai/utils/retry'
import {officialRetrySettings} from '../src/runtime/pi-official-settings.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
async function fixture(t,retry,produce,tools=[]) {
 const root=await mkdtemp(join(tmpdir(),'night-official-retry-')),agentDir=join(root,'agent');await mkdir(agentDir);t.after(()=>rm(root,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 let calls=0
 runtime.registerProvider('retry-fixture',{api:'openai-completions',baseUrl:'http://127.0.0.1:1/no-network',apiKey:'local-script-only',models:[{id:'m',name:'fixture',input:['text'],reasoning:false,contextWindow:8192,maxTokens:64,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model){const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const outcome=produce(++calls),message={role:'assistant',content:outcome.error?[]:outcome.toolCall?[{type:'toolCall',...outcome.toolCall}]:[{type:'text',text:outcome.text??'recovered'}],timestamp:Date.now(),provider:model.provider,model:model.id,api:model.api,usage,stopReason:outcome.error?'error':outcome.toolCall?'toolUse':'stop',...outcome.error?{errorMessage:outcome.error}:{}};stream.push(outcome.error?{type:'error',reason:'error',error:message}:{type:'done',reason:message.stopReason,message});stream.end(message)});return stream}})
 const settings=SettingsManager.inMemory({retry,compaction:{enabled:false},cacheWarming:'off'}),loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 const manager=SessionManager.inMemory(root),{session}=await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,model:runtime.getModel('retry-fixture','m'),sessionManager:manager,settingsManager:settings,resourceLoader:loader,noTools:tools.length?'builtin':'all',tools:tools.map(tool=>tool.name),customTools:tools}),events=[]
 session.subscribe(event=>events.push(event));t.after(()=>session.dispose())
 return {root,session,manager,settings,events,get calls(){return calls}}
}
test('factory helper reads Pi defaults, accepts finite native settings and rejects legacy policy fields',()=>{
 const defaults=SettingsManager.inMemory(),mapped=officialRetrySettings()
 assert.deepEqual(defaults.getRetrySettings(),Object.fromEntries(Object.entries(mapped.retry).filter(([key])=>key!=='provider')))
 const disabled=officialRetrySettings({enabled:false,maxRetries:0,provider:{maxRetries:0}});assert.equal(disabled.retry.enabled,false);assert.equal(disabled.retry.provider.maxRetries,0)
 assert.throws(()=>{disabled.retry.enabled=true},TypeError)
 for(const input of [{mode:'normal'},{mode:'always'},{retryableCodes:['SERVER']},{backoff:{jitterRatio:0}},{maxDelayMs:5}])assert.throws(()=>officialRetrySettings(input),{code:'PI_RETRY_SETTINGS_MIGRATION_REQUIRED'})
 for(const input of [null,[],{enabled:'true'},{maxRetries:-1},{maxRetries:Infinity},{baseDelayMs:0},{maxAgentDelayMs:2147483648},{provider:{maxRetries:-1}},{provider:{unknown:1}}])assert.throws(()=>officialRetrySettings(input),{code:'PI_OFFICIAL_RETRY_SETTINGS_INVALID'})
})
test('explicit helper disables both official agent retries and underlying SDK retries',async t=>{
 const mapped=officialRetrySettings({enabled:false,maxRetries:0,provider:{maxRetries:0}}),f=await fixture(t,mapped.retry,()=>({error:'503 service temporarily unavailable'}))
 await f.session.prompt('no retry');assert.equal(f.calls,1);assert.equal(f.events.some(event=>event.type==='auto_retry_start'),false);assert.equal(f.settings.getProviderRetrySettings().maxRetries,0)
})
test('official native retry settings use finite budget and capped exponential delay, without claiming Night policy equivalence',async t=>{
 const f=await fixture(t,{enabled:true,maxRetries:2,baseDelayMs:1,maxAgentDelayMs:2,provider:{maxRetries:0}},()=>({error:'503 service temporarily unavailable'}))
 await f.session.prompt('official finite retries');assert.equal(f.calls,3)
 assert.deepEqual(f.events.filter(event=>event.type==='auto_retry_start').map(event=>({attempt:event.attempt,delayMs:event.delayMs})),[{attempt:1,delayMs:1},{attempt:2,delayMs:2}])
 assert.equal(f.manager.getEntries().filter(entry=>entry.type==='context_edit'&&entry.replacement===null).length,2)
 assert.equal(retryDelayMs({baseDelayMs:4,maxAgentDelayMs:5},1),4);assert.equal(retryDelayMs({baseDelayMs:4,maxAgentDelayMs:5},2),5)
})
test('official classification rejects generic empty response and quota despite supporting transient failures',async t=>{
 for(const error of ['Model returned a completed response with no content','insufficient_quota 429','401 authentication failed']) {
  assert.equal(isRetryableAssistantError({stopReason:'error',errorMessage:error}),false)
  const f=await fixture(t,{enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:1,provider:{maxRetries:0}},()=>({error}))
  await f.session.prompt('no retry by official classifier');assert.equal(f.calls,1)
 }
})
test('official retry recovery preserves raw failed history while omitting it from subsequent context',async t=>{
 const f=await fixture(t,{enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:1,provider:{maxRetries:0}},attempt=>attempt===1?{error:'503 server error'}:{text:'official recovered'})
 const receipt=f.manager.appendCustomEntry('native.effect.receipt',{operationId:'no-replay',state:'unknown'}),before=JSON.stringify(f.manager.getEntry(receipt))
 await f.session.prompt('recover once');assert.equal(f.calls,2);assert.equal(f.session.getLastAssistantText(),'official recovered');assert.ok(f.manager.getEntries().some(entry=>entry.type==='message'&&entry.message.stopReason==='error'));assert.ok(!f.manager.buildSessionProjection().messages.some(message=>message.stopReason==='error'));assert.equal(JSON.stringify(f.manager.getEntry(receipt)),before)
})
test('official retry backoff is cancelled by public session.abort without another model attempt',async t=>{
 const f=await fixture(t,{enabled:true,maxRetries:2,baseDelayMs:10000,maxAgentDelayMs:10000,provider:{maxRetries:0}},()=>({error:'503 server error'})),entered=Promise.withResolvers()
 f.session.subscribe(event=>{if(event.type==='auto_retry_start')entered.resolve()})
 const prompt=f.session.prompt('cancel retry');await entered.promise;await f.session.abort();await prompt;assert.equal(f.calls,1);assert.equal(f.session.isRetrying,false)
})

test('official retry after a completed external tool effect never executes that effect again',async t=>{
 let effects=0,receipt;let f
 const tool={name:'external_effect',label:'Effect',description:'one original effect',parameters:{type:'object',properties:{}},async execute(){effects++;await appendFile(join(f.root,'effect-once.txt'),'original effect\n');receipt=f.manager.appendCustomEntry('native.effect.receipt',{operationId:'original-effect',state:'completed',executions:effects});return{content:[{type:'text',text:'original effect receipt'}],details:{operationId:'original-effect'}}}}
 f=await fixture(t,officialRetrySettings({maxRetries:1,baseDelayMs:1,maxAgentDelayMs:1,provider:{maxRetries:0}}).retry,attempt=>attempt===1?{toolCall:{id:'effect-call',name:'external_effect',arguments:{}}}:attempt===2?{error:'503 transient server error'}:{text:'observed original effect'},[tool])
 await f.session.prompt('execute once then recover model failure')
 assert.equal(f.calls,3);assert.equal(effects,1);assert.equal(f.manager.getEntry(receipt).data.executions,1);assert.equal(await readFile(join(f.root,'effect-once.txt'),'utf8'),'original effect\n')
 assert.equal(f.manager.getEntries().filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolCallId==='effect-call').length,1)
 assert.equal(f.session.getLastAssistantText(),'observed original effect')
})
test('unknown effect remains fenced across official retries and later prompts without provider or effect replay',async t=>{
 let unknown=false,effects=0,receipt;let f
 const tool={name:'uncertain_effect',label:'Uncertain',description:'unknown effect',parameters:{type:'object',properties:{}},async execute(){effects++;await appendFile(join(f.root,'uncertain-effect.txt'),'uncertain write\n');unknown=true;receipt=f.manager.appendCustomEntry('native.effect.receipt',{operationId:'uncertain-effect',state:'unknown',replayAllowed:false});return{content:[{type:'text',text:'effect uncertain; reconciliation required'}],details:{state:'unknown'},isError:true}}}
 f=await fixture(t,officialRetrySettings({maxRetries:2,baseDelayMs:1,maxAgentDelayMs:1,provider:{maxRetries:0}}).retry,()=>({toolCall:{id:'uncertain-call',name:'uncertain_effect',arguments:{}}}),[tool])
 const previous=f.session.agent.prepareRequest
 f.session.agent.prepareRequest=async(...args)=>{if(unknown)throw new Error('503 UNKNOWN_EFFECT_FENCE: reconcile the original receipt');return previous?.(...args)}
 await f.session.prompt('uncertain original effect')
 const original=JSON.stringify(f.manager.getEntry(receipt));assert.equal(effects,1);assert.equal(f.calls,1);assert.equal(f.manager.getEntry(receipt).data.state,'unknown')
 assert.ok(f.events.some(event=>event.type==='auto_retry_start'))
 await f.session.prompt('later request remains fenced')
 assert.equal(effects,1);assert.equal(f.calls,1);assert.equal(JSON.stringify(f.manager.getEntry(receipt)),original);assert.equal(await readFile(join(f.root,'uncertain-effect.txt'),'utf8'),'uncertain write\n')
})

test('official finite retry budgets reset for later prompts and are isolated between sessions',async t=>{
 const settings={enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:1,provider:{maxRetries:0}}
 const first=await fixture(t,settings,()=>({error:'503 server error'})),second=await fixture(t,settings,()=>({error:'503 server error'}))
 await first.session.prompt('first exhausted budget')
 assert.equal(first.calls,2);assert.equal(second.calls,0)
 await second.session.prompt('independent session budget')
 assert.equal(second.calls,2)
 await first.session.prompt('fresh prompt has its own finite budget')
 assert.equal(first.calls,4)
 assert.deepEqual(first.events.filter(event=>event.type==='auto_retry_start').map(event=>event.attempt),[1,1])
 assert.equal(first.session.retryAttempt,0);assert.equal(second.session.retryAttempt,0)
})

test('aborting official backoff drains it and leaves a later prompt usable without stale retry work',async t=>{
 let recovered=false
 const f=await fixture(t,{enabled:true,maxRetries:2,baseDelayMs:10000,maxAgentDelayMs:10000,provider:{maxRetries:0}},()=>recovered?{text:'fresh prompt completed'}:{error:'503 server error'})
 const entered=Promise.withResolvers()
 const off=f.session.subscribe(event=>{if(event.type==='auto_retry_start')entered.resolve()})
 const prompt=f.session.prompt('cancel this backoff')
 await entered.promise;await f.session.abort();await prompt;off()
 assert.equal(f.calls,1);assert.equal(f.session.isRetrying,false);assert.equal(f.session.retryAttempt,0)
 recovered=true
 await f.session.prompt('new prompt after cancellation')
 assert.equal(f.calls,2);assert.equal(f.session.getLastAssistantText(),'fresh prompt completed')
 assert.equal(f.events.filter(event=>event.type==='auto_retry_start').length,1)
})
