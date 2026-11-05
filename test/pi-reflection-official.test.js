import test from 'node:test'
import assert from 'node:assert/strict'
import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryCredentialStore,InMemoryModelsStore,createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {officialReflectionText} from '../src/memory/reflection-inference.js'

async function fixture(reply){
 const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsStore:new InMemoryModelsStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false})
 const model=runtime.getModels()[0],requests=[];await runtime.setRuntimeApiKey(model.provider,'local-only')
 runtime.registerProvider(model.provider,{api:model.api,streamSimple:(_model,context,options)=>{
  requests.push({context,options});const stream=createAssistantMessageEventStream()
  queueMicrotask(async()=>{const value=await reply({context,options,stream});const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:value.stopReason??'stop',content:value.content??[{type:'text',text:value.text??'{"lessons":[]}'}]};stream.end(message)})
  return stream
 }})
 return{resolved:{modelRuntime:runtime,model,requestOptions:{maxTokens:17,maxRetries:0}},requests}
}
test('official reflection uses one native tool-free request with explicit route options',async()=>{
 const f=await fixture(async()=>({})),input={taskId:'task',eventId:'event',facts:[{id:'event',summary:'verified'}]}
 assert.equal(await officialReflectionText(f.resolved,input),'{"lessons":[]}');assert.equal(f.requests.length,1)
 const {context,options}=f.requests[0];assert.equal(context.tools,undefined);assert.equal(context.messages.length,2);assert.equal(context.messages[0].role,'system');assert.deepEqual(JSON.parse(context.messages[1].content),input);assert.equal(options.maxTokens,17);assert.equal(options.reasoning,undefined);assert.equal(options.maxRetries,0)
})
test('official reflection rejects nonfinal, tool calls and oversized final/delta output',async t=>{
 for(const stopReason of ['error','aborted','length','toolUse'])await t.test(stopReason,async()=>{const f=await fixture(async()=>({stopReason}));await assert.rejects(officialReflectionText(f.resolved,{}),{code:'REFLECTION_INCOMPLETE'});assert.equal(f.requests.length,1)})
 const call=await fixture(async()=>({content:[{type:'toolCall',id:'x',name:'no',arguments:{}}]}));await assert.rejects(officialReflectionText(call.resolved,{}),{code:'REFLECTION_INCOMPLETE'})
 const final=await fixture(async()=>({text:'x'.repeat(12001)}));await assert.rejects(officialReflectionText(final.resolved,{}),{code:'REFLECTION_TOO_LARGE'})
 const delta=await fixture(async({stream})=>{stream.push({type:'text_delta',contentIndex:0,delta:'x'.repeat(12001)});return{}});await assert.rejects(officialReflectionText(delta.resolved,{}),{code:'REFLECTION_TOO_LARGE'});assert.equal(delta.requests[0].options.signal.aborted,true)
})
test('official reflection abort waits for native stream settlement before returning',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),abort=new AbortController()
 const f=await fixture(async({options})=>{entered.resolve();await release.promise;assert.equal(options.signal.aborted,true);return{stopReason:'aborted'}})
 let settled=false;const job=officialReflectionText(f.resolved,{},{signal:abort.signal}).finally(()=>{settled=true});await entered.promise;abort.abort();await Promise.resolve();assert.equal(settled,false);release.resolve();await assert.rejects(job,{name:'AbortError'});assert.equal(settled,true)
})

test('background review uses explicit configured resolution, refuses secrets and fences changed memory scopes',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),{openDynamicTaskStore}=await import('../packages/dingtalk-core/dynamic-task-store.js'),{memoryScope}=await import('../src/memory/scope.js'),{join}=await import('node:path')
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await memoryHost(t,async body=>{if(!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return;entered.resolve();await release.promise;const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content);return{text:JSON.stringify({lessons:[{key:'bounded',observation:'Verified local result',hypothesis:'limited',shortcut:'Inspect first',evidenceIds:[input.eventId]}]})}})
 const ctx=f.host.ctx,official=ctx.nativePiProvider.official,original=official.resolve.bind(official),resolved=[]
 official.resolve=async(config,scope)=>{resolved.push({config,scope});return original(config,scope)}
 ctx.llm.stream=()=>{throw Error('legacy reflection path forbidden')}
 const store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'reflection-contract.sqlite'),instanceId:'reflection-contract',initialize:true});t.after(()=>store.close())
 async function complete(id,summary){let seq=0;const command=(kind,args)=>store.command({id:id+'-'+(++seq),kind,args});await command('task.create',{taskId:id,request:'bounded request',ownerActorId:'PRIVATE_OWNER_NEVER_PROVIDER'});const binding=(await command('task.claim',{taskId:id})).result.binding;await command('task.complete',{binding,summary,result:{summary}})}
 await complete('one','verified local result');const detach=ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});t.after(detach);await entered.promise
 const scope=memoryScope({actorId:'PRIVATE_OWNER_NEVER_PROVIDER'},{scope:'personal'},true)
 await ctx.memory.store.forget(scope,{topic:'experience',key:'bounded',source:{sessionId:'forget',messageId:'forget'}});release.resolve();await ctx.reflection.whenIdle()
 assert.equal(resolved.length,1);assert.equal(resolved[0].config.provider,'fixture');assert.equal(resolved[0].scope,undefined);assert.ok(resolved[0].config.signal instanceof AbortSignal)
 assert.doesNotMatch(JSON.stringify(f.requests),/PRIVATE_OWNER_NEVER_PROVIDER/);assert.equal((await ctx.memory.store.read(scope,{topic:'experience'})).entries.length,0)
 assert.equal(Object.values((await ctx.reflection.state(scope)).reviews)[0].code,'MEMORY_SCOPE_CHANGED')
 await complete('secret','password=DO_NOT_SEND_REFLECTION');ctx.reflection.scan();await ctx.reflection.whenIdle()
 assert.equal(resolved.length,1);assert.doesNotMatch(JSON.stringify(f.requests),/DO_NOT_SEND_REFLECTION/)
 assert.equal(Object.values((await ctx.reflection.state(scope)).reviews).find(review=>review.taskId==='secret').code,'MEMORY_SECRET_REFUSED')
})
