import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createAgentSession,ModelRuntime,SessionManager,SettingsManager,DefaultResourceLoader,createCodemodeExtension} from '@earendil-works/pi-coding-agent'
import {InMemoryModelsStore,InMemoryCredentialStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {memoryHost} from './fixtures/memory-host.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
const ordinary={type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false}
const union={anyOf:[{type:'object',required:['kind','rows'],properties:{kind:{const:'tuple'},rows:{type:'array',prefixItems:[{type:'string',minLength:1}],minItems:1,maxItems:1}},additionalProperties:false},{type:'object',required:['kind','values'],properties:{kind:{const:'record'},values:{type:'object',additionalProperties:{type:'number',exclusiveMinimum:0}}},additionalProperties:false}]}
async function fixture(t,mode){
 const root=await mkdtemp(join(tmpdir(),'night-official-codemode-'));await mkdir(join(root,'agent'));await mkdir(join(root,'sessions'))
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),hostEnd=Promise.withResolvers(),childEnd=Promise.withResolvers();let session,prompt,requests=0,hostFinished=false,hostSignal
 t.after(async()=>{release.resolve();await prompt?.catch(()=>{});await session?.abort();session?.dispose();await rm(root,{recursive:true,force:true})})
 const runtime=await ModelRuntime.create({modelsPath:null,modelsStore:new InMemoryModelsStore(),credentials:new InMemoryCredentialStore(),refreshOnCreate:false,allowModelNetwork:false}),model=runtime.getModels()[0];await runtime.setRuntimeApiKey(model.provider,'script-only')
 const manager=SessionManager.create(root,join(root,'sessions')),before=[],events=[]
 const code=mode==='union'?'const failures=[];for(const args of [{kind:"tuple",rows:[]},{kind:"tuple",rows:["ok","extra"]},{kind:"record",values:{x:0}}]){try{await tools.echo(args)}catch(error){failures.push(String(error))}}const value=await tools.echo({kind:"record",values:{x:2}});return {failures,value,process:typeof process,require:typeof require,fetch:typeof fetch}':mode==='large'?'return await tools.echo({text:"x".repeat(9000)})':'return await tools.echo({text:"NESTED_PROOF"})'
 const parentCall={type:'toolCall',id:'parent-'+mode,name:'codemode',arguments:{code},thoughtSignature:'opaque-scripted-signature'}
 runtime.registerProvider(model.provider,{api:model.api,streamSimple(){const stream=createAssistantMessageEventStream(),first=++requests===1,message={role:'assistant',api:model.api,provider:model.provider,model:model.id,usage,timestamp:Date.now(),stopReason:first?'toolUse':'stop',content:first?[structuredClone(parentCall)]:[{type:'text',text:'done'}]};queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream}})
 const custom=pi=>{pi.registerTool({name:'echo',label:'echo',description:'Pure fixture echo, no filesystem or external effects',parameters:mode==='union'?union:ordinary,async execute(id,args,signal){
  const disk=(await readFile(manager.getSessionFile(),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  before.push({id,args:structuredClone(args),assistantCalls:disk.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').flatMap(entry=>entry.message.content).filter(block=>block.type==='toolCall')})
  hostSignal=signal;entered.resolve();if(mode==='cancel')await release.promise;hostFinished=true;hostEnd.resolve();return {content:[{type:'text',text:args.text??JSON.stringify(args)}],details:{pure:true}}
 }});pi.on('tool_call',event=>events.push({type:event.type,id:event.toolCallId,parent:event.parentToolCallId}))}
 const settings=SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off'}),loader=new DefaultResourceLoader({cwd:root,agentDir:join(root,'agent'),settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[createCodemodeExtension({models:false}),custom]});await loader.reload()
 ;({session}=await createAgentSession({cwd:root,agentDir:join(root,'agent'),modelRuntime:runtime,model,sessionManager:manager,settingsManager:settings,resourceLoader:loader,noTools:'builtin',tools:['codemode','echo']}))
 session.subscribe(event=>{if(event.type.startsWith('tool_execution')){events.push({type:event.type,id:event.toolCallId,parent:event.parentToolCallId});if(event.type==='tool_execution_end'&&event.parentToolCallId)childEnd.resolve()}})
 let promptDone=false;prompt=session.prompt('Run the pure fixture').then(()=>{promptDone=true})
 return {session,manager,events,before,parentCall,entered,release,hostEnd,childEnd,get hostFinished(){return hostFinished},get hostSignal(){return hostSignal},get promptDone(){return promptDone},async finish(){await prompt;return manager.getEntries()},cold(){return SessionManager.open(manager.getSessionFile(),join(root,'sessions')).getEntries()}}
}
const messages=entries=>entries.filter(entry=>entry.type==='message').map(entry=>entry.message)
const parentResult=entries=>messages(entries).find(message=>message.role==='toolResult')
function preserved(f,entries){assert.deepEqual(messages(entries).find(message=>message.role==='assistant').content,[f.parentCall]);assert.deepEqual(f.cold(),JSON.parse(JSON.stringify(entries)))}

test('official SDK codemode persists parent signatures and bounded nested evidence without fabricating child assistant calls',{timeout:15000},async t=>{
 const f=await fixture(t,'normal'),entries=await f.finish();preserved(f,entries)
 assert.equal(f.before[0].id,'parent-normal/1');assert.deepEqual(f.before[0].assistantCalls,[f.parentCall],'before nested body only the unchanged parent call is durably present')
 const nested=parentResult(entries).nestedCalls;assert.equal(nested.complete,true);assert.equal(nested.calls[0].id,'parent-normal/1');assert.equal(nested.calls[0].name,'echo');assert.deepEqual(nested.calls[0].arguments,{text:'NESTED_PROOF'})
 assert.equal(messages(entries).filter(message=>message.role==='toolResult').length,1);assert.ok(f.events.some(event=>event.type==='tool_call'&&event.parent==='parent-normal'&&event.id==='parent-normal/1'))
})
test('official nested journal omits 9000-byte arguments and marks the evidence incomplete',{timeout:15000},async t=>{
 const f=await fixture(t,'large'),entries=await f.finish();preserved(f,entries)
 assert.equal(f.before[0].args.text.length,9000);const nested=parentResult(entries).nestedCalls;assert.equal(nested.complete,false);assert.equal(nested.calls[0].arguments,undefined);assert.equal(nested.calls[0].argumentsBytes,9011)
})
test('official codemode validates exact union arguments before pure host calls and exposes no Node globals',{timeout:15000},async t=>{
 const f=await fixture(t,'union'),entries=await f.finish();preserved(f,entries)
 assert.equal(f.before.length,1);assert.deepEqual(f.before[0].args,{kind:'record',values:{x:2}})
 const nested=parentResult(entries).nestedCalls;assert.equal(nested.calls.length,4);assert.deepEqual(nested.calls.map(call=>call.status),['error','error','error','ok'])
 const text=parentResult(entries).content.map(block=>block.text??'').join('\n');for(const name of ['process','require','fetch'])assert.match(text,new RegExp('"'+name+'":\\s*"undefined"'))
})
test('official extension abort and idle are not host-tool join or complete nested evidence',{timeout:15000},async t=>{
 const f=await fixture(t,'cancel');await f.entered.promise
 await f.session.abort();await f.session.waitForIdle();assert.equal(f.promptDone,true);assert.equal(f.hostFinished,false);assert.equal(f.hostSignal.aborted,true)
 const before=await f.finish();assert.equal(parentResult(before).nestedCalls.complete,false);assert.equal(parentResult(before).nestedCalls.calls[0].status,'unfinished')
 f.release.resolve();await f.hostEnd.promise;await f.childEnd.promise;preserved(f,f.manager.getEntries());assert.equal(f.hostFinished,true)
 assert.ok(f.events.findIndex(event=>event.type==='tool_execution_end'&&!event.parent)<f.events.findIndex(event=>event.type==='tool_execution_end'&&event.parent))
})
test('actual default Host keeps codemode and run_code off and refuses the retired DSH Node plugin before evaluation',{timeout:15000},async t=>{
 const f=await memoryHost(t);await f.close();const directory=join(f.root,'retired-plugin');await mkdir(directory)
 const marker=join(directory,'evaluated'),entry=join(directory,'index.js');await writeFile(join(directory,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-ptc-runtime-node',version:'0.2.1-alpha.2',type:'module'}));await writeFile(entry,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'must not run');export function apply(){throw Error('retired plugin must not load')}`)
 f.config.plugins=[{name:pathToFileURL(entry).href}];await f.boot();const handle=await f.agent('default-no-code');t.after(()=>handle.dispose())
 assert.equal(f.host.ctx.get('ptcRuntime'),undefined);for(const name of ['codemode','run_code']){assert.equal(handle.session.getActiveToolNames().includes(name),false);assert.equal(f.host.ctx.get('tools').get(name,handle.agent),undefined)}
 await assert.rejects(readFile(marker),{code:'ENOENT'});assert.equal(f.requests.length,0)
})
