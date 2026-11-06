import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {OfficialPiModelRuntime} from '../src/pi-official-model-runtime.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {piAuthentication} from '../src/pi-provider-auth.js'
import {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader} from '@earendil-works/pi-coding-agent'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const declaration=baseURL=>({fixture:{api:'openai-completions',baseURL,apiKeyEnv:'FIXTURE_KEY',headers:{'x-profile':'preserved'},streamIdleTimeoutMs:process.platform==='win32'?5000:1000,models:[{id:'m',maxTokens:64,contextWindow:8192,compat:{supportsDeveloperRole:false}}]}})
function fixture(raw,environment={FIXTURE_KEY:'private-fixture-key'}) {
 let profiles=resolvePiProfiles(raw,{deferred:true})
 const auth=piAuthentication({getEnvironment:name=>environment[name],fileExists:async()=>{throw Error('home file access forbidden')}})
 const runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,auth)
 return {runtime,update(value){profiles=resolvePiProfiles(value,{deferred:true})}}
}
async function serverFixture(t,handler) {const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve))});return `http://127.0.0.1:${server.address().port}/v1`}
function respond(res,text='OFFICIAL_DIRECT') {res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'native-stream',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'native-stream',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\ndata: [DONE]\n\n');res.end()}
test('official runtime serves only configured models with explicit controls and no home stores',async()=>{
 const f=fixture(declaration('http://127.0.0.1:1/v1')),resolved=await f.runtime.resolve({provider:'fixture',model:'m'})
 assert.equal(resolved.model.id,'m');assert.equal(resolved.model.compat.supportsDeveloperRole,false);assert.equal(resolved.requestOptions.maxTokens,64);assert.equal(resolved.thinkingLevel,undefined)
 assert.equal(resolved.modelRuntime.getModels('openai').length,0);assert.deepEqual(resolved.modelRuntime.getModels().map(model=>model.provider),['fixture'])
 assert.ok(!JSON.stringify({model:resolved.model,requestOptions:resolved.requestOptions}).includes('private-fixture-key'))
 await assert.rejects(f.runtime.resolve({provider:'fixture',model:'m',maxTokens:65}),{code:'INVALID_MODEL_MAX_TOKENS'})
 await assert.rejects(f.runtime.resolve({provider:'fixture',model:'m',reasoningEffort:'high'}),{code:'UNSUPPORTED_REASONING_EFFORT'})
 await assert.rejects(f.runtime.resolve({provider:'openai',model:'m'}),{code:'NO_ADAPTER'})
 await assert.rejects(f.runtime.resolve({provider:'fixture',model:'m',stop:['unsafe ignored control']}),{code:'UNSUPPORTED_OPTION'})
})
test('official default SDK streams directly through ModelRuntime with scoped auth, compat, headers and output cap',async t=>{
 const received=[],base=await serverFixture(t,async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push({headers:req.headers,body:JSON.parse(body)});respond(res)})
 const f=fixture(declaration(base)),resolved=await f.runtime.resolve({provider:'fixture',model:'m'})
 const root=await mkdtemp(join(tmpdir(),'night-official-runtime-')),agentDir=join(root,'agent');await mkdir(agentDir);t.after(()=>rm(root,{recursive:true,force:true}))
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 const {session}=await createAgentSession({cwd:root,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,settingsManager:settings,resourceLoader:loader,sessionManager:SessionManager.inMemory(root),noTools:'all'})
 t.after(()=>session.dispose());await session.prompt('direct official request')
 assert.equal(session.getLastAssistantText(),'OFFICIAL_DIRECT');assert.equal(received.length,1);assert.equal(received[0].headers.authorization,'Bearer private-fixture-key');assert.equal(received[0].headers['x-profile'],'preserved');assert.ok((received[0].body.max_tokens??received[0].body.max_completion_tokens)>0);assert.ok((received[0].body.max_tokens??received[0].body.max_completion_tokens)<=64)
 await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'direct cap',timestamp:1}]},resolved.requestOptions).result();assert.equal(received.at(-1).body.max_tokens??received.at(-1).body.max_completion_tokens,64,JSON.stringify(received.map(item=>({max_tokens:item.body.max_tokens,max_completion_tokens:item.body.max_completion_tokens}))))
})
test('official registry updates replace or remove declared routes and fence an unresolved old configuration',async()=>{
 const f=fixture(declaration('http://127.0.0.1:1/v1')),first=await f.runtime.resolve({provider:'fixture',model:'m'})
 f.update({fixture:{...declaration('http://127.0.0.1:2/v1').fixture,models:[{id:'new',maxTokens:12}]}})
 const stale=await first.modelRuntime.streamSimple(first.model,{messages:[{role:'user',content:'no dispatch',timestamp:1}]}).result();assert.match(stale.errorMessage,/configuration changed/)
 const next=await f.runtime.resolve({provider:'fixture',model:'new'});assert.equal(next.modelRuntime,first.modelRuntime);assert.equal(next.modelRuntime.getModel('fixture','m'),undefined)
 f.update({});await assert.rejects(f.runtime.resolve({provider:'fixture',model:'new'}),{code:'NO_ADAPTER'});assert.equal(next.modelRuntime.getModels('fixture').length,0)
})
test('credential capabilities isolate actors and keys resolve late without entering model metadata',async t=>{
 const seen=[],base=await serverFixture(t,async(req,res)=>{for await(const _ of req){}seen.push(req.headers.authorization);respond(res)})
 const raw=declaration(base),f=fixture(raw),capability=key=>({resolve:async()=>({value:key}),readRecord:async()=>undefined,listRecords:async()=>[]}),a=capability('actor-a-key'),b=capability('actor-b-key')
 const one=await f.runtime.resolve({provider:'fixture',model:'m'},{credentials:a}),two=await f.runtime.resolve({provider:'fixture',model:'m'},{credentials:b})
 assert.notEqual(one.modelRuntime,two.modelRuntime)
 await one.modelRuntime.streamSimple(one.model,{messages:[{role:'user',content:'one',timestamp:1}]}).result();await two.modelRuntime.streamSimple(two.model,{messages:[{role:'user',content:'two',timestamp:1}]}).result()
 assert.deepEqual(seen,['Bearer actor-a-key','Bearer actor-b-key']);a.resolve=async()=>({value:'actor-a-rotated'})
 await one.modelRuntime.streamSimple(one.model,{messages:[{role:'user',content:'rotated',timestamp:1}]}).result();assert.equal(seen.at(-1),'Bearer actor-a-rotated');assert.ok(!JSON.stringify(one.model).includes('actor-a'))
})
test('official stream idle budget aborts a stalled loopback without Night event conversion',async t=>{
 const base=await serverFixture(t,async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders()})
 const raw=declaration(base);raw.fixture.streamIdleTimeoutMs=30
 const f=fixture(raw),resolved=await f.runtime.resolve({provider:'fixture',model:'m'}),result=await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'stall',timestamp:1}]}).result()
 assert.ok(['aborted','error'].includes(result.stopReason));assert.equal(result.content.length,0)
})

test('official scripted provider preserves native signatures and requires no file model/auth stores',async()=>{
 const {ModelRuntime}=await import('@earendil-works/pi-coding-agent'),{InMemoryModelsStore,createAssistantMessageEventStream}=await import('@earendil-works/pi-ai')
 const profiles=resolvePiProfiles(declaration('http://127.0.0.1:1/v1')),profile=profiles.get('fixture'),model=profile.models[0]
 delete profile.api
 const final={role:'assistant',provider:'fixture',api:model.api,model:'m',responseId:'opaque-native-response',content:[{type:'text',text:'SCRIPTED_NATIVE',textSignature:'opaque-native-signature'}],stopReason:'stop',timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
 profile.baseProvider={id:'fixture',auth:{},getModels:()=>[model],streamSimple(){const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'done',reason:'stop',message:final});stream.end(final)});return stream}}
 let options
 const service=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=> 'script-only-key'}),{createRuntime:async input=>{options=input;return ModelRuntime.create(input)}})
 const resolved=await service.resolve({provider:'fixture',model:'m'}),events=[]
 const stream=resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'script',timestamp:1}]})
 for await(const event of stream)events.push(event)
 const result=await stream.result();assert.equal(result,final);assert.equal(events.at(-1).message,final);assert.equal(result.content[0].textSignature,'opaque-native-signature')
 assert.equal(options.modelsPath,null);assert.ok(options.modelsStore instanceof InMemoryModelsStore);assert.equal(options.allowModelNetwork,false);assert.equal(options.refreshOnCreate,false);assert.ok(options.credentials)
})
test('dynamic replacement with the same model id cannot dispatch a stale endpoint descriptor',async()=>{
 const f=fixture(declaration('http://127.0.0.1:1/v1')),old=await f.runtime.resolve({provider:'fixture',model:'m'})
 f.update(declaration('http://127.0.0.1:2/v1'));const fresh=await f.runtime.resolve({provider:'fixture',model:'m'})
 const result=await fresh.modelRuntime.streamSimple(old.model,{messages:[{role:'user',content:'blocked',timestamp:1}]}).result()
 assert.match(result.errorMessage,/configuration changed/);assert.equal(fresh.model.baseUrl,'http://127.0.0.1:2/v1')
})
test('missing actor credentials fail without borrowing a global configured key',async t=>{
 let requests=0;const base=await serverFixture(t,async(req,res)=>{requests++;for await(const _ of req){}respond(res)})
 const f=fixture(declaration(base)),resolved=await f.runtime.resolve({provider:'fixture',model:'m'},{credentials:{resolve:async()=>undefined,readRecord:async()=>undefined,listRecords:async()=>[]}})
 const result=await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'denied',timestamp:1}]}).result()
 assert.equal(result.stopReason,'error');assert.equal(requests,0);assert.ok(!JSON.stringify(result).includes('private-fixture-key'))
})

test('official runtime close aborts and joins an admitted direct stream and refuses later resolve',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve)
 const base=await serverFixture(t,async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();entered()})
 const f=fixture(declaration(base)),resolved=await f.runtime.resolve({provider:'fixture',model:'m'})
 const result=resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'close',timestamp:1}]}).result()
 await started;await f.runtime.close();assert.ok(['error','aborted'].includes((await result).stopReason))
 await assert.rejects(f.runtime.resolve({provider:'fixture',model:'m'}),{code:'OFFICIAL_MODEL_RUNTIME_CLOSED'})
})
test('actual Host exposes only the official runtime plus metadata routes',async t=>{
 const {createHost}=await import('../src/host.js')
 const base=await serverFixture(t,async(req,res)=>{for await(const _ of req){}respond(res,'HOST_OFFICIAL_RUNTIME')})
 const root=await mkdtemp(join(tmpdir(),'night-official-host-'));let host
 t.after(async()=>{await host?.close();await rm(root,{recursive:true,force:true})})
 host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),model:{provider:'fixture',model:'m'},providers:declaration(base)},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_KEY:'host-scoped-fixture-key'}}})
 const api=host.ctx.nativePiProvider;assert.equal(host.ctx.get('llm'),undefined);assert.equal(host.ctx.get('llmRetry'),undefined);assert.equal(api.adapter,undefined);assert.equal(host.ctx.nativeModelRoutes.stream,undefined);assert.ok(api.profiles);assert.ok(api.official instanceof OfficialPiModelRuntime)
 const resolved=await api.official.resolve({provider:'fixture',model:'m'}),message=await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'host-direct',timestamp:1}]}).result()
 assert.equal(message.content[0].text,'HOST_OFFICIAL_RUNTIME')
})

test('official idle budget resets on native event progress rather than becoming a total deadline',async t=>{
 const base=await serverFixture(t,async(req,res)=>{
  for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'})
  let count=0
  const timer=setInterval(()=>{if(count++<6)res.write('data: '+JSON.stringify({id:'progress',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{content:'x'},finish_reason:null}]})+'\n\n');else {clearInterval(timer);res.end('data: '+JSON.stringify({id:'progress',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')}},200)
  res.on('close',()=>clearInterval(timer))
 })
 const raw=declaration(base);raw.fixture.streamIdleTimeoutMs=1000
 const f=fixture(raw),resolved=await f.runtime.resolve({provider:'fixture',model:'m'}),started=Date.now()
 const result=await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'progress',timestamp:1}]}).result()
 assert.equal(result.stopReason,'stop');assert.equal(result.content[0].text,'xxxxxx');assert.ok(Date.now()-started>1000)
})
test('caller cancellation terminates an official stream without converting it to a Night finish event',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve),base=await serverFixture(t,async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();entered()})
 const f=fixture(declaration(base)),resolved=await f.runtime.resolve({provider:'fixture',model:'m'}),abort=new AbortController(),stream=resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'cancel',timestamp:1}]},{signal:abort.signal})
 const done=stream.result();await started;abort.abort(new Error('caller cancelled'))
 const result=await done;assert.ok(['error','aborted'].includes(result.stopReason));assert.equal(result.role,'assistant');await f.runtime.close()
})

test('official caller header suppression stays null rather than becoming a secret-bearing literal header',async t=>{
 const seen=[],base=await serverFixture(t,async(req,res)=>{for await(const _ of req){}seen.push(req.headers);respond(res)})
 const f=fixture(declaration(base)),resolved=await f.runtime.resolve({provider:'fixture',model:'m'})
 await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'headers',timestamp:1}]},{headers:{'x-profile':null}}).result()
 assert.equal(seen[0]['x-profile'],undefined);assert.equal(seen[0].authorization,'Bearer private-fixture-key');await f.runtime.close()
})

test('official runtime shutdown drains an admitted uncooperative credential read before any provider effect',async t=>{
 let blocked=false,entered;const reading=new Promise(resolve=>entered=resolve),release=Promise.withResolvers();let requests=0
 const base=await serverFixture(t,async(req,res)=>{requests++;for await(const _ of req){}respond(res)})
 const profiles=resolvePiProfiles(declaration(base)),authentication=piAuthentication({getEnvironment:async()=>{if(blocked){entered();await release.promise}return 'late-secret-never-dispatched'}}),service=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,authentication)
 const resolved=await service.resolve({provider:'fixture',model:'m'});blocked=true
 const result=resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'auth drain',timestamp:1}]}).result()
 await reading;let closed=false;const closing=service.close().then(()=>closed=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false)
 release.resolve();await closing;assert.equal((await result).stopReason,'error');assert.equal(requests,0)
})

test('unspecified reasoning delegates to official SDK initialization for a high-only model',async t=>{
 const {getSupportedThinkingLevels}=await import('@earendil-works/pi-ai')
 const raw=declaration('http://127.0.0.1:1/never-dispatch');raw.fixture.models[0].reasoningEfforts={high:'enabled'}
 const f=fixture(raw),resolved=await f.runtime.resolve({provider:'fixture',model:'m'})
 assert.equal(resolved.thinkingLevel,undefined);assert.deepEqual(getSupportedThinkingLevels(resolved.model),['high'])
 await assert.rejects(f.runtime.resolve({provider:'fixture',model:'m',reasoningEffort:'medium'}),{code:'UNSUPPORTED_REASONING_EFFORT'})
 assert.equal((await f.runtime.resolve({provider:'fixture',model:'m',reasoningEffort:'high'})).thinkingLevel,'high')
 const root=await mkdtemp(join(tmpdir(),'night-official-thinking-')),agentDir=join(root,'agent');await mkdir(agentDir);t.after(()=>rm(root,{recursive:true,force:true}))
 const settings=SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off'}),loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 const {session}=await createAgentSession({cwd:root,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,thinkingLevel:resolved.thinkingLevel,sessionManager:SessionManager.inMemory(root),settingsManager:settings,resourceLoader:loader,noTools:'all'});t.after(()=>session.dispose())
 assert.equal(session.thinkingLevel,'high');assert.ok(getSupportedThinkingLevels(resolved.model).includes(session.thinkingLevel))
})
