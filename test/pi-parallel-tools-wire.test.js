import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),gate=()=>Promise.withResolvers()
const call=(id,name,args={})=>({id,name,args})
const output={schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]}
const results=entries=>entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)
const callsIn=entries=>entries.flatMap(entry=>entry.type==='message'&&entry.message.role==='assistant'?entry.message.content.filter(block=>block.type==='toolCall'):[])
async function fixture(t,calls,setup){
 const root=await mkdtemp(join(tmpdir(),'night-parallel-wire-')),f={requests:[],errors:[],settled:[],root};let host,handle
 const server=createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);f.requests.push(body);if(f.requests.length>1)await f.inspectNext?.(body);res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'parallel-proof',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');if(f.requests.length===1){chunk({role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))});chunk({},'tool_calls')}else{chunk({role:'assistant',content:'parallel verified'});chunk({},'stop')}res.end('data: [DONE]\n\n')}catch(error){f.errors.push(error);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture assertion failed'}}))}})
 t.after(async()=>{f.cleanup?.();try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));host=f.host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),maxParallelToolCalls:2,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_PARALLEL_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:8192,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_PARALLEL_KEY:'fixture'}}})
 handle=f.handle=await host.ctx.agents.create({sessionId:'parallel-wire',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:join(root,'work')},authorizeInput:packet=>packet.source.kind==='user',setup:async(ctx,agent)=>setup(ctx,agent,f)})
 handle.session.subscribe(event=>{if(event.type==='agent_settled')f.settled.push(event)})
 f.start=async()=>{const packet={id:'parallel-batch',source:{kind:'user'},content:[{type:'text',text:'Execute this fixture batch'}]};await handle.enqueue(packet);return handle.deliver(packet.id,{deliverAs:'steer'})}
 f.entries=()=>handle.session.sessionManager.getEntries();f.persisted=async()=>(await host.ctx.sessionPersistence.readNative('parallel-wire',{requireComplete:true})).entries
 return f
}
test('Pi parallel batches retain bounded safe concurrency, exclusive barriers, permission guards and model-order receipts',{timeout:20000},async t=>{
 const calls=[call('p1','probe',{n:1}),call('p2','probe',{n:2}),call('p3','probe',{n:3}),call('denied','denied'),call('hidden','hidden'),call('barrier','barrier'),call('p4','probe',{n:4}),call('p5','probe',{n:5})],firstPair=gate(),secondCompleted=gate(),completed=[];let active=0,peak=0,barrierDone=false,deniedEffects=0
 const f=await fixture(t,calls,(ctx,_agent,f)=>{const registry=f.host.ctx.get('tools');f.cleanup=()=>{firstPair.resolve();secondCompleted.resolve()};registry.register({name:'probe',description:'Read-only concurrent probe',parameters:{type:'object',properties:{n:{type:'integer'}},required:['n']},output,isConcurrencySafe:()=>true,execute:async({n},exec)=>{active++;peak=Math.max(peak,active);if(n<=2&&active===2)firstPair.resolve();try{const entries=await f.persisted();assert.ok(callsIn(entries).some(call=>call.id===exec.callId),'official assistant call must be durable before effects');if(n<=2)await Promise.race([firstPair.promise,sleep(1000)]);if(n===1)await Promise.race([secondCompleted.promise,sleep(1000)]);if(n>=4)assert.equal(barrierDone,true);await sleep(n===1?35:n===2?5:1);completed.push(n);if(n===2)secondCompleted.resolve();return{n}}finally{active--}}});registry.register({name:'barrier',description:'Exclusive checkpoint',parameters:{type:'object'},output,execute:async()=>{assert.equal(active,0);barrierDone=true;return{barrier:true}}});for(const name of ['denied','hidden'])registry.register({name,description:'Must never execute',parameters:{type:'object'},output,isConcurrencySafe:()=>true,execute:async()=>{deniedEffects++;return{bad:true}}});ctx.get('tools').guard(exec=>exec.name==='denied'?'fixture denied':undefined);ctx.get('tools').restrict({allow:['probe','barrier','denied']})})
 f.inspectNext=async()=>assert.deepEqual(results(await f.persisted()).map(result=>result.toolCallId),calls.map(call=>call.id))
 await f.start();await f.handle.whenIdle();assert.deepEqual(f.errors,[]);assert.equal(peak,2);assert.equal(deniedEffects,0);assert.ok(completed.indexOf(2)<completed.indexOf(1));assert.equal(f.requests.length,2);assert.equal(f.settled.at(-1).aborted,false);assert.equal(f.handle.session.isStreaming,false)
 assert.deepEqual(f.requests[1].messages.filter(message=>message.role==='tool').map(message=>message.tool_call_id),calls.map(call=>call.id));assert.ok(!f.requests[0].tools.some(tool=>tool.function.name==='hidden'));assert.ok(!f.requests[1].tools.some(tool=>tool.function.name==='hidden'))
 const saved=results(f.entries());assert.ok(saved.find(result=>result.toolCallId==='denied').isError);assert.ok(saved.find(result=>result.toolCallId==='hidden').isError)
})
test('cancelling a Pi parallel batch stops replenishment and drains started effects before idle',{timeout:20000},async t=>{
 const entered=gate(),release=gate();let started=0,settled=0;const calls=Array.from({length:5},(_,i)=>call('slow-'+i,'slow',{n:i}))
 const f=await fixture(t,calls,(ctx,_agent,f)=>{f.cleanup=()=>release.resolve();ctx.get('tools').register({name:'slow',description:'Controlled concurrent effect',parameters:{type:'object',properties:{n:{type:'integer'}}},output,isConcurrencySafe:()=>true,execute:async({n})=>{if(++started===2)entered.resolve();await release.promise;settled++;return{n}}})})
 const running=f.start(),delivery=running.catch(error=>assert.equal(error.code,'PI_OFFICIAL_ACTOR_NOT_LIVE','delivery may report request revocation, never a different failure'))
 await entered.promise;const cancelling=f.handle.cancel({kind:'user'});let idle=false;const pending=f.handle.whenIdle().then(()=>idle=true)
 await sleep(20);assert.equal(idle,false);release.resolve();await Promise.all([delivery,cancelling,pending]);assert.equal(started,2);assert.equal(settled,2);assert.equal(f.requests.length,1);assert.equal(f.settled.at(-1).aborted,true)
 const saved=results(await f.persisted());assert.equal(saved.length,5);assert.ok(saved.every(result=>result.isError));assert.equal(f.handle.session.isStreaming,false)
})
test('one concluding tool ends a Pi parallel batch after all admitted sibling receipts commit',{timeout:20000},async t=>{
 let effects=0;const f=await fixture(t,[call('complete','complete'),call('sibling','sibling')],ctx=>{for(const name of ['complete','sibling'])ctx.get('tools').register({name,description:'Concluding fixture',parameters:{type:'object'},output,isConcurrencySafe:()=>true,execute:async(_args,exec)=>{effects++;if(name==='complete')exec.concludeTurn();await sleep(name==='complete'?5:15);return{name}}})})
 await f.start();await f.handle.whenIdle();assert.equal(effects,2);assert.equal(f.requests.length,1);assert.equal(f.settled.at(-1).aborted,false)
 const saved=results(await f.persisted());assert.equal(saved.length,2);assert.ok(saved.every(result=>result.isError===false));assert.equal(saved.find(result=>result.toolCallId==='complete').details.nativeResult.concludesTurn,true)
})
test('a later tool reclassified as exclusive waits for the running safe pool to drain',{timeout:20000},async t=>{
 const both=gate();let active=0,parallel=true,exclusiveRan=false
 const f=await fixture(t,[call('first','safe',{n:1}),call('second','safe',{n:2}),call('changed','changed')],(ctx,_agent,f)=>{f.cleanup=()=>both.resolve();ctx.get('tools').register({name:'safe',description:'Safe pool member',parameters:{type:'object',properties:{n:{type:'integer'}}},output,isConcurrencySafe:()=>true,execute:async({n})=>{if(++active===2){parallel=false;both.resolve()}try{await Promise.race([both.promise,sleep(1000)]);await sleep(n===1?5:30);return{n}}finally{active--}}});ctx.get('tools').register({name:'changed',description:'Dynamically exclusive',parameters:{type:'object'},output,isConcurrencySafe:()=>parallel,execute:async()=>{assert.equal(active,0);exclusiveRan=true;return{exclusive:true}}})})
 await f.start();await f.handle.whenIdle();assert.equal(exclusiveRan,true);assert.equal(f.requests.length,2);assert.equal(f.settled.at(-1).aborted,false);assert.ok(!results(await f.persisted()).some(result=>result.isError))
})
test('malformed repeated call ids preserve no-effect recovery and conservative unstarted receipts',{timeout:20000},async t=>{
 const effects=[];const f=await fixture(t,[call('shared-id','probe',{n:1}),call('shared-id','probe',{n:2})],ctx=>ctx.get('tools').register({name:'probe',description:'Repeated-id fixture',parameters:{type:'object',properties:{n:{type:'integer'}}},output,isConcurrencySafe:()=>true,execute:async({n})=>{effects.push(n);return{n}}}))
 await f.start();await f.handle.whenIdle();assert.deepEqual(effects,[]);assert.equal(f.requests.length,2);assert.equal(f.settled.at(-1).aborted,false)
 const saved=results(await f.persisted());assert.equal(saved.length,1);assert.equal(saved[0].isError,true);assert.match(saved[0].content.map(part=>part.text??'').join('\n'),/Invalid arguments[\s\S]*Received arguments:/)
})
