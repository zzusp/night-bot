import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {symbols} from '@deepseek-ai/cordis'
import {createHost} from '../src/host.js'
import {scopeParentOf} from '../src/native-scope.js'
let inputId=0
async function prompt(handle){const id='preset-input-'+(++inputId);await handle.enqueue({id,source:{kind:'preset-fixture'},content:'verify preset'});await handle.deliver(id);await handle.whenIdle()}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-preset-')),f={root,handles:[],unregister:[],requests:[]};let host
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;f.requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason]of [[{role:'assistant',content:'preset verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'preset-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')});t.after(async()=>{try{for(const h of f.handles.toReversed())await h.dispose();for(const off of f.unregister.toReversed())await off()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}});await new Promise(r=>server.listen(0,'127.0.0.1',r))
 host=f.host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_PRESET_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:8192,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_PRESET_KEY:'fixture'}}});f.registry=host.ctx.agentPresets;f.raw=f.registry[symbols.original]??f.registry
 f.definition=async(id,version)=>{const path=join(root,id+'-'+version+'.mjs');await writeFile(path,`export const inject=['systemPrompt','tools'];export function apply(ctx){ctx.tools.register({name:'cap_${version}',description:'Revision capability',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},execute:async()=>({})});ctx.provide('fixtureCapability',{version:${JSON.stringify(version)}});ctx.systemPrompt.section({name:'fixture-preset',order:1,text:${JSON.stringify('PRESET_'+version)}})}`);return{id,plugins:[{name:'cordis:group',group:true,isolate:{fixtureCapability:true},config:[{name:pathToFileURL(path).href}]}]}}
 f.register=async(id,version)=>{const definition=await f.definition(id,version),off=await f.registry.register(definition);f.unregister.push(off);return{definition,off}}
 f.agent=async(id,preset,parent,extra={})=>{const h=await host.ctx.agents.create({sessionId:id,agentOptions:{provider:'fixture',model:'m'},meta:{cwd:join(root,'work'),...preset===undefined?{}:{agentPreset:preset}},...parent?{parentAgent:parent.actor}:{},authorizeInput:packet=>packet.source.kind==='preset-fixture',...extra});f.handles.push(h);return h}
 f.saved=id=>host.ctx.sessionPersistence.readNative(id,{requireComplete:true})
 f.setDefault=async id=>{const entry=f.raw.ctx.fiber.entry;await entry.update({config:{...entry.options.config,selectedDefault:id}});await host.ctx.loader.await()};return f
}

test('native preset revisions retain immutable declarations, old leases and exact official parent composition',{timeout:20000},async t=>{
 const f=await fixture(t);assert.equal(f.raw.constructor.name,'NativeAgentPresets')
 const first=await f.register('fixture','v1'),parent=await f.agent('preset-parent','fixture'),lease=await f.registry.acquireScope('fixture')
 first.definition.plugins.length=0;assert.match((await f.registry.readDocument('fixture')).content,/fixture-v1/)
 await first.off();assert.equal(f.registry.serviceFor(parent.actor,'fixtureCapability').version,'v1');assert.ok(f.raw.generations.has(lease.key))
 await f.register('fixture','v2')
 const second=await f.agent('preset-second','fixture'),child=await f.agent('preset-child','fixture',parent)
 assert.equal(f.host.ctx.agents.isOwnedBy(child.actor.id,parent.actor),true)
 assert.equal(scopeParentOf(child.actor),parent.actor,'preset binding preserves actual parent event ancestry')
 parent.actor.ctx.get('tools').guard(exec=>exec.agent===child.actor&&exec.name==='cap_v1'?'PARENT_GUARD_RETAINED':undefined)
 const denied=await f.host.ctx.agents.withInitiator(child.actor,()=>f.host.ctx.get('tools').execute({agent:child.actor,name:'cap_v1',arguments:{},callId:'parent-guard-proof',businessAudit:child.actor.audit,signal:new AbortController().signal}))
 assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/PARENT_GUARD_RETAINED/)
 assert.equal(f.registry.serviceFor(second.actor,'fixtureCapability').version,'v2');assert.equal(f.registry.serviceFor(child.actor,'fixtureCapability').version,'v1')
 await Promise.all([prompt(parent),prompt(child),prompt(second)])
 assert.equal(f.requests.filter(request=>JSON.stringify(request).includes('PRESET_v1')).length,2);assert.equal(f.requests.filter(request=>JSON.stringify(request).includes('PRESET_v2')).length,1)
 await assert.rejects(f.registry.mount(parent.actor.ctx,'fixture'),error=>error.code==='agent-preset/locked')
 await assert.rejects(f.registry.mount(child.actor.ctx,'fixture'),error=>error.code==='agent-preset/locked')
 assert.ok(parent.session.getActiveToolNames().includes('cap_v1'));assert.ok(!parent.session.getActiveToolNames().includes('cap_v2'))
 await parent.dispose();assert.equal(f.registry.serviceFor(child.actor,'fixtureCapability').version,'v1');await child.dispose();assert.ok(f.raw.generations.has(lease.key));await lease[Symbol.asyncDispose]();await lease[Symbol.asyncDispose]();assert.equal(f.raw.generations.has(lease.key),false)
 assert.ok(f.registry.inspectCompositions(second.actor.ctx)[0].modules.length);assert.deepEqual(f.registry.inspectCompositions(second.actor.ctx)[0].leakedServices,[])
})
test('official creation commits the configurable default preset and rejects subsequent live selection',{timeout:20000},async t=>{
 const f=await fixture(t);await f.register('selected','v2');await f.setDefault('selected')
 assert.equal(f.registry.defaultId,'selected')
 const h=await f.agent('preset-selection')
 assert.equal(h.actor.metadata.agentPreset,'selected');assert.equal((await f.saved(h.actor.id)).header.agentPreset,'selected')
 assert.equal(f.registry.composedPreset(h.actor.ctx),'selected')
 await assert.rejects(f.registry.select(h.actor,'night-bot'),error=>error.code==='agent-preset/locked')
 await assert.rejects(f.registry.mount(h.actor.ctx,'night-bot'),error=>error.code==='agent-preset/locked')
 await prompt(h);assert.equal(f.requests.length,1);assert.match(JSON.stringify(f.requests[0]),/PRESET_v2/)
 assert.equal(f.registry.composedPreset(h.actor.ctx),'selected');assert.equal(h.actor.session,undefined)
})
test('concurrent startup lookup stays unpublished and resolves one current immutable revision',{timeout:20000},async t=>{
 const f=await fixture(t),first=await f.register('pending','v2'),entered=Promise.withResolvers(),release=Promise.withResolvers(),original=f.raw.retain
 f.raw.retain=async function(id){if(id==='pending'){entered.resolve();await release.promise}return original.call(this,id)}
 t.after(()=>release.resolve())
 let returned=false
 const startup=f.agent('preset-pending','pending').then(handle=>{returned=true;return handle})
 await entered.promise;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(returned,false);assert.equal(f.host.ctx.agents.get('preset-pending'),undefined);assert.equal(f.requests.length,0)
 await first.off();await f.register('pending','v3');release.resolve();const handle=await startup
 assert.equal(f.registry.serviceFor(handle.actor,'fixtureCapability').version,'v3');assert.equal((await f.saved(handle.actor.id)).header.agentPreset,'pending')
 await prompt(handle);assert.equal(f.requests.length,1);assert.match(JSON.stringify(f.requests[0]),/PRESET_v3/);assert.doesNotMatch(JSON.stringify(f.requests[0]),/PRESET_v2/)
})
test('prepared composition is sealed before SDK capture and startup commit failure grants no actor',{timeout:20000},async t=>{
 const f=await fixture(t);await f.register('chosen','v2');await f.register('other','v3')
 const factory=f.host.ctx.get('officialAgentFactory'),resources=factory.ports.resolveResources,entered=Promise.withResolvers(),release=Promise.withResolvers();let candidate
 factory.ports.resolveResources=async descriptor=>{if(descriptor.actor.id==='preset-failure'){candidate=descriptor.actor;entered.resolve();await release.promise}return resources(descriptor)}
 t.after(()=>release.resolve())
 const backend=f.host.ctx.get('sessionPersistence'),create=backend.createNative
 let failOnce=true
 const cause=Object.assign(new Error('fixture startup commit failed'),{code:'PRESET_STARTUP_COMMIT_FAILED'})
 backend.createNative=async function(...args){const store=await Reflect.apply(create,this,args),commit=store.commit;store.commit=function(...parameters){if(this.id==='preset-failure'&&candidate?.piSession&&failOnce){failOnce=false;throw cause}return Reflect.apply(commit,this,parameters)};return store}
 const startup=f.agent('preset-failure','chosen'),rejected=assert.rejects(startup,error=>error===cause)
 await entered.promise;assert.equal(candidate.piSession,undefined);assert.equal(f.host.ctx.agents.get('preset-failure'),undefined)
 await assert.rejects(f.registry.mount(candidate.ctx,'other'),error=>error.code==='agent-preset/locked')
 release.resolve();await rejected;factory.ports.resolveResources=resources;backend.createNative=create
 assert.equal(f.host.ctx.agents.get('preset-failure'),undefined);assert.equal(f.requests.length,0);assert.equal(candidate.lifecycle.isLive(),false)
 assert.equal((await f.saved('preset-failure')).header.agentPreset,'chosen')
 const resumed=await f.host.ctx.agents.resume({resumeSessionId:'preset-failure',authorizeInput:packet=>packet.source.kind==='preset-fixture'});f.handles.push(resumed)
 await prompt(resumed);assert.equal(f.requests.length,1);assert.match(JSON.stringify(f.requests[0]),/PRESET_v2/)
})
test('declared header and actual startup preset must agree; impostor parents grant no composition',{timeout:20000},async t=>{
 const f=await fixture(t);await f.register('declared','v1');await f.register('different','v2')
 await assert.rejects(f.agent('preset-mismatch','declared',undefined,{setup:ctx=>ctx.get('agentPresets').mount(ctx,'different')}),{code:'NATIVE_PRESET_HEADER_MISMATCH'})
 assert.equal(f.host.ctx.agents.get('preset-mismatch'),undefined);assert.equal(f.requests.length,0);assert.equal((await f.saved('preset-mismatch')).header.agentPreset,'declared')
 const parent=await f.agent('actual-parent','declared')
 await assert.rejects(f.agent('impostor-child','declared',{actor:{...parent.actor}}))
 assert.equal(f.host.ctx.agents.get('impostor-child'),undefined)
})
test('preset roster exposes failed imports, missing services and root service leaks without admitting them',{timeout:20000},async t=>{
 const f=await fixture(t),leak=join(f.root,'leak.mjs'),missing=join(f.root,'missing.mjs');await writeFile(leak,"export function apply(ctx){ctx.provide('leakedFixture',{})}");await writeFile(missing,"export const inject=['missingFixture'];export function apply(){}");for(const [id,name]of [['leak',pathToFileURL(leak).href],['missing',pathToFileURL(missing).href],['broken',pathToFileURL(join(f.root,'absent.mjs')).href]])f.unregister.push(await f.registry.register({id,plugins:[{name}]}));const rows=await f.registry.list();assert.match(rows.find(r=>r.id==='leak').broken,/isolate realms/);assert.match(rows.find(r=>r.id==='missing').broken,/waiting for missingFixture/);assert.ok(rows.find(r=>r.id==='broken').broken);assert.equal(f.host.ctx.get('leakedFixture'),undefined);for(const id of ['leak','missing','broken'])await assert.rejects(f.registry.acquireScope(id));assert.ok((await f.registry.compositionInventory()).find(r=>r.id==='broken').broken);await assert.rejects(f.registry.register({id:'night-bot',plugins:[]}),/Duplicate/)
})
