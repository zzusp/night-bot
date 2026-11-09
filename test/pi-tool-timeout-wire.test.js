import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
const whenAbort=signal=>signal.aborted?Promise.resolve():new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))
const calls=entries=>entries.flatMap(entry=>entry.type==='message'&&entry.message.role==='assistant'?entry.message.content.filter(block=>block.type==='toolCall'):[])
const results=entries=>entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)
async function fixture(t,first,{webTools}={}){
 const root=await mkdtemp(join(tmpdir(),'night-timeout-wire-')),f={requests:[],errors:[],cleanup:[]};let host,handle
 const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);f.requests.push(body)
  res.writeHead(200,{'content-type':'text/event-stream'})
  const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'timeout-fixture',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
  if(f.requests.length===1){send({role:'assistant',tool_calls:[{index:0,id:first.id,type:'function',function:{name:first.name,arguments:JSON.stringify(first.args??{})}}]});send({},'tool_calls')}
  else{send({role:'assistant',content:'timeout observed'});send({},'stop')}
  res.end('data: [DONE]\n\n')
 }catch(error){f.errors.push(error);res.writeHead(500);res.end(JSON.stringify({error:{message:'fixture failed'}}))}})
 t.after(async()=>{for(const cleanup of f.cleanup)cleanup();try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true})}}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 host=f.host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_TIMEOUT_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:8192,maxTokens:128}]}},...webTools?{webTools}:{}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_TIMEOUT_KEY:'fixture'}}})
 f.open=async(id,setup)=>{
  handle=f.handle=await host.ctx.agents.create({sessionId:id,meta:{cwd:join(root,'work'),agentPreset:'night-bot'},agentOptions:{provider:'fixture',model:'m'},authorizeInput:packet=>packet.source.kind==='user',setup:async(ctx,actor)=>{await host.ctx.get('agentPresets').mount(ctx,'night-bot');await setup?.(ctx,actor)}})
  f.history=async()=>(await host.ctx.sessionPersistence.readNative(id,{requireComplete:true})).entries
  f.start=async()=>{const packet={id:'timeout-input',source:{kind:'user'},content:[{type:'text',text:'Run the controlled timeout fixture'}]};await handle.enqueue(packet);return handle.deliver(packet.id,{deliverAs:'steer'})}
  return handle
 }
 return f
}
test('actual Pi declared tool timeout waits for a started body and persists one timeout receipt before model continuation',{timeout:20000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let signal,effects=0,exited=false
 const f=await fixture(t,{id:'budgeted',name:'budgeted_tool'});f.cleanup.push(()=>release.resolve())
 assert.equal(f.host.ctx.get('nativeToolTimeout').owner,'night-native-tool-timeout')
 const handle=await f.open('tool-timeout-wire',ctx=>ctx.get('tools').register({name:'budgeted_tool',description:'Controlled cooperative budget',parameters:{type:'object'},timeoutMs:15,output:{schema:{type:'object'},render:()=>[{type:'text',text:'body exited'}]},execute:async(_args,exec)=>{
  assert.ok(calls(await f.history()).some(call=>call.id==='budgeted'),'the official assistant intent commits before the actual body')
  effects++;signal=exec.signal;entered.resolve();await release.promise;exited=true;return{ok:true}
 }}))
 const running=f.start();await entered.promise;await whenAbort(signal)
 assert.equal(exited,false);assert.equal(handle.session.isStreaming,true);assert.equal(f.requests.length,1);assert.equal(results(await f.history()).length,0)
 let idle=false;const waiting=handle.whenIdle().then(()=>idle=true);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(idle,false)
 release.resolve();await running;await waiting
 assert.equal(exited,true);assert.equal(effects,1);assert.equal(f.requests.length,2);assert.deepEqual(f.errors,[])
 const entries=await f.history(),saved=results(entries)
 assert.equal(calls(entries).length,1);assert.equal(saved.length,1);assert.equal(saved[0].isError,true);assert.equal(saved[0].details.nativeResult.error.info.code,'TOOL_TIMEOUT')
 assert.match(JSON.stringify(f.requests[1]),/tool call timed out after 15ms/);assert.equal(handle.session.isStreaming,false)
})
test('actual Pi web search applies the configured tool budget and drains a provider that ignores cancellation',{timeout:20000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let signal,exited=false,providers=0
 const f=await fixture(t,{id:'search-timeout',name:'web_search',args:{queries:['slow query']}},{webTools:{searchTimeoutMs:20}});f.cleanup.push(()=>release.resolve())
 f.host.ctx.get('web').registerSearchProvider({id:'slow-search',available:()=>true,search:async(_request,current)=>{providers++;signal=current;entered.resolve();await release.promise;exited=true;return{sources:[],truncated:false}}})
 const handle=await f.open('search-timeout-wire'),running=f.start();await entered.promise;await whenAbort(signal)
 assert.equal(exited,false);assert.equal(f.requests.length,1);assert.equal(handle.session.isStreaming,true);assert.equal(results(await f.history()).length,0)
 release.resolve();await running;await handle.whenIdle()
 assert.equal(exited,true);assert.equal(providers,1);assert.equal(f.requests.length,2);assert.deepEqual(f.errors,[])
 assert.match(JSON.stringify(f.requests[1]),/tool call timed out after 20ms/)
 const saved=results(await f.history());assert.equal(saved.length,1);assert.equal(saved[0].isError,true)
})
