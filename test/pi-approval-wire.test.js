import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {createHost} from '../src/host.js'
let nextInput=0
const say=async(handle,text)=>{const packet={id:'approval-input-'+(++nextInput),source:{kind:'user'},content:text};await handle.enqueue(packet);await handle.deliver(packet.id);await handle.whenIdle()}
async function fixture(t,{root:providedRoot}={}){
 const root=providedRoot??await mkdtemp(join(tmpdir(),'night-approval-wire-')),f={root,requests:[]};let host,handle
 const server=createServer(async(req,res)=>{
  for await(const _ of req){}f.requests.push(req.url);res.writeHead(200,{'content-type':'text/event-stream'})
  const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'approval-proof',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
  if(f.requests.length%2){chunk({role:'assistant',tool_calls:['grant','deny'].map((id,index)=>({index,id:id+'-'+f.requests.length,type:'function',function:{name:'sensitive',arguments:JSON.stringify({id})}}))});chunk({},'tool_calls')}
  else{chunk({role:'assistant',content:'approval verified'});chunk({},'stop')}
  res.end('data: [DONE]\n\n')
 })
 t.after(async()=>{f.release?.();try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 host=f.host=await createHost({stateDir:join(root,'state'),workspaceDir:join(root,'work'),maxParallelToolCalls:2,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_APPROVAL_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:8192,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_APPROVAL_KEY:'fixture'}}})
 f.persisted=async()=>(await host.ctx.sessionPersistence.readNative('approval-wire',{requireComplete:true})).audit
 let effects=0
 handle=f.handle=await host.ctx.agents.create({sessionId:'approval-wire',agentOptions:{provider:'fixture',model:'m'},authorizeInput:packet=>packet.source.kind==='user',meta:{cwd:join(root,'work')},setup:async(ctx,actor)=>{
  ctx.get('approval').setPolicy(actor,'ask');await actor.audit.flush()
  ctx.get('tools').register({name:'sensitive',description:'Fixture requiring one approval per call',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},isConcurrencySafe:()=>true,execute:async(args,exec)=>{
   const receipts=await f.persisted(),asked=receipts.findLast(receipt=>receipt.domain==='approval'&&receipt.kind==='asked'&&receipt.payload.callId===exec.callId)
   assert.ok(asked);assert.ok(receipts.some(receipt=>receipt.domain==='approval'&&receipt.kind==='decided'&&receipt.payload.id===asked.payload.id&&receipt.payload.outcome==='allowed-once'))
   effects++;return{executed:args.id}
  }})
  ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='sensitive'?{kind:'ask',reason:'fixture exact action'}:next())
 }})
 f.effects=()=>effects
 f.store=host.ctx.get('sessionPersistence').writers.get(handle.actor.id)
 return f
}
test('actual Pi tool grants require durable approval pairs, remain one-call only and fail closed without an answerer',{timeout:20000},async t=>{
 const f=await fixture(t);assert.equal(f.host.ctx.approval.constructor.name,'NativeApproval');assert.equal(f.host.ctx.permissionPresets.constructor.name,'NativePermissionPresets')
 let prompted=0
 const answerer=f.host.ctx.on('approval/request',async req=>{
  prompted++;const receipts=await f.persisted();assert.ok(receipts.some(receipt=>receipt.domain==='approval'&&receipt.kind==='asked'&&receipt.payload.callId===req.callId));assert.equal(req.agent,f.handle.actor)
  return req.callId.startsWith('grant-')?'allowed-once':'rejected'
 })
 await say(f.handle,'First exact call');assert.equal(f.effects(),1);assert.equal(prompted,2)
 assert.equal(f.host.ctx.approval.policyForActor(f.handle.actor),'ask');assert.equal(f.host.ctx.sandboxPolicy.resolve({actor:f.handle.actor}).mode,'workspace-write')
 answerer();await say(f.handle,'A prior one-call grant must not authorize new calls');assert.equal(f.effects(),1)
 const receipts=await f.persisted(),decisions=receipts.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='decided')
 assert.deepEqual(decisions.map(receipt=>receipt.payload.outcome),['allowed-once','rejected','unavailable','unavailable']);assert.equal(receipts.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='asked').length,4)
 assert.equal(f.requests.length,4);assert.equal(f.handle.session.messages.at(-1).stopReason,'stop')
})
test('cancelling a real Pi turn durably seals pending approvals before official tool results',{timeout:20000},async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();f.release=()=>release.resolve()
 f.host.ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'})
 const running=say(f.handle,'Wait for a cancellable approval').catch(error=>error)
 await entered.promise;await f.handle.cancel({kind:'user'});await running;await f.handle.whenIdle()
 assert.equal(f.effects(),0);assert.equal(f.requests.length,1)
 const entries=f.handle.session.sessionManager.getEntries(),decisions=entries.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data.domain==='approval'&&entry.data.kind==='decided')
 assert.ok(decisions.length);assert.ok(decisions.every(entry=>entry.data.payload.outcome==='cancelled'))
 const results=entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult');assert.equal(results.length,2)
 assert.ok(decisions.every(decision=>entries.indexOf(decision)<Math.max(...results.map(result=>entries.indexOf(result)))),'cancelled decisions commit before the official tool-result batch settles')
 assert.equal(f.handle.session.isStreaming,false)
 const persisted=await f.persisted();assert.equal(persisted.filter(receipt=>receipt.domain==='approval'&&receipt.kind==='decided').length,decisions.length)
 release.resolve()
})
async function poisonProof(root){
 // The child intentionally retains the poisoned actor/lease until process exit.
 // No production cleanup gate is bypassed to make an uncertain close look good.
 const f=await fixture({after(){}},{root}),original=f.store.commit,cause=Object.assign(Error('fixture terminal sink failure'),{code:'PI_SESSION_COMMIT_UNCERTAIN'})
 let armed=true
 f.store.commit=function(...args){const terminal=this.manager.getEntries().findLast(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.stopReason==='stop');if(armed&&terminal){armed=false;throw cause}return Reflect.apply(original,this,args)}
 await assert.rejects(say(f.handle,'Fail the terminal sink'),error=>error===cause)
 await assert.rejects(f.handle.whenIdle(),error=>error===cause)
 const before=f.store.manager.getEntries().length
 await assert.rejects(async()=>f.handle.enqueue({id:'must-not-admit',source:{kind:'user'},content:'Must not be admitted after uncertain terminal state'}),error=>error===cause)
 assert.equal(f.store.manager.getEntries().length,before);assert.equal(f.requests.length,2);assert.equal(f.effects(),0)
 await assert.rejects(f.handle.dispose(),error=>error===cause)
 assert.equal(f.host.ctx.agents.get(f.handle.actor.id),f.handle.actor,'failed close retains live ownership')
}
test('idle awaits official terminal commit and terminal storage poison fences future admission',{timeout:20000},async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();f.release=()=>release.resolve()
 const original=f.store.commit;let held=false
 f.store.commit=async function(...args){if(!held&&this.manager.getEntries().some(entry=>entry.type==='message'&&entry.message.role==='assistant'&&entry.message.stopReason==='stop')){held=true;entered.resolve();await release.promise}return Reflect.apply(original,this,args)}
 const running=say(f.handle,'Wait for terminal durability');let idle=false
 await entered.promise;const waiting=f.handle.whenIdle().then(()=>idle=true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(idle,false)
 release.resolve();await running;await waiting;f.store.commit=original
 assert.ok((await f.host.ctx.sessionPersistence.readNative(f.handle.actor.id,{requireComplete:true})).context.piMessages.some(message=>message.role==='assistant'&&message.stopReason==='stop'))
 const root=await mkdtemp(join(tmpdir(),'night-approval-poison-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const script=`import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHost} from ${JSON.stringify(new URL('../src/host.js',import.meta.url).href)};let nextInput=0;const say=${say.toString()};const fixture=${fixture.toString()};await (${poisonProof.toString()})(${JSON.stringify(root)});process.send('POISON_FENCE_PROVED');`
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk)
 // Retain the poisoned owner until the parent observes the proof, then terminate
 // that isolated process; process.exit races libuv watcher teardown on Windows.
 const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}))})
 try{await Promise.race([new Promise(resolve=>child.once('message',message=>{assert.equal(message,'POISON_FENCE_PROVED');resolve()})),exited.then(result=>assert.fail(JSON.stringify(result)+output))])}finally{child.kill('SIGTERM');await exited}
})
