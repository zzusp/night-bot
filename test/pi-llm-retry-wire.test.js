import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
test('official native model retry emits SDK retry events and never repeats the preceding completed tool',{timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-retry-wire-')),requests=[],errors=[],retryEvents=[];let host,handle,effects=0
 const server=createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw))
   if(requests.length===2){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture transient failure',type:'server_error'}}));return}
   if(requests.length===3){assert.equal(retryEvents.filter(e=>e.type==='auto_retry_start').length,1);const saved=await host.ctx.sessionPersistence.readNative('retry-wire');assert.equal(saved.entries.filter(e=>e.type==='message'&&e.message.role==='toolResult').length,1)}
   res.writeHead(200,{'content-type':'text/event-stream'});const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'retry-proof',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
   if(requests.length===1){chunk({role:'assistant',tool_calls:[{index:0,id:'effect-once',type:'function',function:{name:'fixture_effect',arguments:'{}'}}]});chunk({},'tool_calls')}else{chunk({role:'assistant',content:'recovered'});chunk({},'stop')}
   res.end('data: [DONE]\n\n')
  }catch(error){errors.push(error);res.writeHead(500);res.end()}
 })
 t.after(async()=>{try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_RETRY_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:true,maxRetries:1,baseDelayMs:1,maxAgentDelayMs:5,provider:{maxRetries:0}},models:[{id:'m',contextWindow:4096,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_RETRY_KEY:'fixture-key'}}})
 assert.equal(host.ctx.get('llmRetry'),undefined)
 handle=await host.ctx.agents.create({sessionId:'retry-wire',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:join(root,'work')},authorizeInput:(p,a)=>a.id==='retry-wire'&&p.id==='retry-input'&&p.source.kind==='fixture-user',setup:async ctx=>{ctx.get('tools').register({name:'fixture_effect',description:'Fixture effect once',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'fixture receipt'}]},execute:async()=>{effects++;return{done:true}}})}})
 handle.session.subscribe(event=>{if(event.type==='auto_retry_start'||event.type==='auto_retry_end')retryEvents.push(event)})
 await handle.enqueue({id:'retry-input',source:{kind:'fixture-user'},content:'Run fixture effect once and report'});await handle.deliver('retry-input');await handle.whenIdle()
 assert.deepEqual(errors,[]);const saved=await host.ctx.sessionPersistence.readNative(handle.agent.id),messages=saved.entries.filter(e=>e.type==='message').map(e=>e.message)
 assert.equal(handle.session.getLastAssistantText(),'recovered');assert.equal(requests.length,3);assert.equal(effects,1);assert.equal(messages.filter(m=>m.role==='toolResult').length,1);assert.equal(retryEvents.filter(e=>e.type==='auto_retry_start').length,1);assert.equal(retryEvents.filter(e=>e.type==='auto_retry_end').length,1);assert.equal(retryEvents.find(e=>e.type==='auto_retry_end').success,true)
 assert.ok(messages.some(m=>m.role==='assistant'&&m.stopReason==='error'));assert.equal(saved.context.projection.messages.some(m=>m.role==='assistant'&&m.stopReason==='error'),false)
 assert.ok(requests[2].messages.some(m=>m.role==='tool'&&m.content.includes('fixture receipt')));assert.equal(handle.agent.session,undefined)
})
