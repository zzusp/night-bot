import {Context} from '@deepseek-ai/cordis'
import {bindPiLiveOutput,readPiLiveOutput,setPiLiveToolValidation} from '../src/runtime/pi-live-output.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {officialToolsFixture,definition} from './fixtures/pi-official-tools.js'
import {applyShellTool} from '../src/native-tool-bash.js'
import {OutputCollector} from '../src/process/output.js'
import {registerPartialCompatiblePostPolicy,partialPoliciesCompatible} from '../src/runtime/tool-partial-policy.js'
import {startShellLivePreview} from '../src/runtime/shell-live-preview.js'

test('actual process emits real shell SDK update before completion with compatible post policy once',async t=>{
 let child,finished=false,postCount=0,spawnCount=0
 const entered=Promise.withResolvers()
 const f=await officialToolsFixture(t,({ctx})=>{
  ctx.provide('workingDirectory',{ensure:async()=>process.cwd()});ctx.provide('shellEnv',{collect:()=>({})})
  ctx.provide('shell',{sandboxMode:undefined,resolve:r=>({...r,workdir:r.workdir??process.cwd(),timeoutMs:5000}),async execute(spec){
   spawnCount++;child=spawn(process.execPath,['-e',"process.stdout.write('first real line\\n');process.stdin.once('data',()=>{process.stdout.write('last real line\\n');process.exit(0)})"],{stdio:['pipe','pipe','pipe']})
   const stdout=new OutputCollector(65536,'stdout'),stderr=new OutputCollector(65536,'stderr')
   child.stdout.on('data',b=>stdout.push(b));child.stderr.on('data',b=>stderr.push(b))
   const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>{finished=true;resolve({stdout:stdout.finalize(),stderr:stderr.finalize(),exitCode,signal,timedOut:false,aborted:false,timeoutMs:5000})})})
   return{observed:{stdout,stderr},result:()=>done}
  }})
  registerPartialCompatiblePostPolicy(ctx,async(exec,result,next)=>{postCount++;return next()},exec=>exec.name==='bash')
  applyShellTool(ctx,{enableRunInBackground:false})
 })
 t.after(()=>child?.kill())
 const events=[];f.session.subscribe(event=>{if(event.type==='tool_execution_update'){events.push(event);entered.resolve()}})
 const running=f.run([{id:'shell-live',name:'bash',args:{command:'fixture',description:'real process preview'}}])
 await Promise.race([entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('No actual shell partial')),5000))])
 assert.equal(finished,false);assert.match(events[0].partialResult.content[0].text,/first real line/);assert.equal(postCount,0)
 child.stdin.write('finish');await running
 assert.equal(spawnCount,1);assert.equal(postCount,1);assert.match(f.results[0].result.content[0].text,/last real line/)
})

test('partial contract rejects unknown final policies, finalizers, absent opt-in and revoked guards',async t=>{
 for(const mode of ['unknown','finalizer','absent','revoked','allowed']){
  let allowed=true,accepted,postCount=0
  const f=await officialToolsFixture(t,({ctx})=>{
   ctx.tools.guard(()=>allowed?undefined:'revoked')
   if(mode==='unknown')ctx.on('tools/post-execute',async(exec,result,next)=>{postCount++;return next()})
   ctx.tools.register(definition('preview',async(args,exec)=>{if(mode==='revoked')allowed=false;accepted=await exec.publishPartial({content:[{type:'text',text:'preview'}]});return{ok:true}}, {
    ...(mode==='absent'?{}:{partialResult:{version:1,project:v=>v.content}}),...(mode==='finalizer'?{finalizeContent:()=>[{type:'text',text:'final'}]}:{})
   }))
  })
  let count=0;f.session.subscribe(e=>{if(e.type==='tool_execution_update')count++});await f.run([{id:'p',name:'preview'}])
  assert.equal(accepted,mode==='allowed',mode);assert.equal(count,mode==='allowed'?1:0);assert.equal(postCount,mode==='unknown'?1:0)
 }
})

test('shell ring preview is non-consuming, bounded and withdraws on eviction',async()=>{
 const controller=new AbortController(),out=new OutputCollector(20,'stdout'),err=new OutputCollector(20,'stderr'),updates=[]
 const preview=startShellLivePreview({signal:controller.signal,publishPartial:async v=>updates.push(v)},()=>({observed:{stdout:out,stderr:err}}))
 out.push(Buffer.from('first\n'));await preview.sample();assert.equal(updates[0].content[0].text,'first\n');assert.equal(out.readFrom(0).text,'first\n')
 out.push(Buffer.from('x'.repeat(40)));await preview.sample();assert.deepEqual(updates[1].content,[])
 out.push(Buffer.from('after'));await preview.sample();assert.equal(updates.length,2);controller.abort();preview.close()
})

test('preview close drains one in-flight delivery without queueing or publishing later samples',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),controller=new AbortController();let count=0
 const preview=startShellLivePreview({signal:controller.signal,publishPartial:async()=>{count++;entered.resolve();await release.promise}},()=>({observed:{stdout:{readFrom:()=>({text:'live',lossy:false})},stderr:{readFrom:()=>({text:'',lossy:false})}}}))
 const first=preview.sample();await entered.promise;preview.sample();let closed=false;const close=preview.close().then(()=>{closed=true});await Promise.resolve();assert.equal(closed,false);assert.equal(count,1)
 release.resolve();await Promise.all([first,close]);await preview.sample();assert.equal(count,1)
})

test('already cached preview is withdrawn on guard or terminal policy revocation without another output chunk',async t=>{
 for(const mode of ['guard','policy']){
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let valid=true
  const f=await officialToolsFixture(t,({ctx})=>{
   ctx.tools.guard(()=>valid?undefined:'revoked')
   ctx.tools.register(definition('bash',async(_args,exec)=>{await exec.publishPartial({content:[{type:'text',text:'cached preview'}]});entered.resolve();await release.promise;return{}},{partialResult:{version:1,project:v=>v.content}}))
  })
  const binding=bindPiLiveOutput(f.owner);t.after(()=>{release.resolve();binding.close()})
  const running=f.run([{id:'revoked',name:'bash'}]);await entered.promise
  assert.equal(readPiLiveOutput(f.owner).tools[0].content[0].text,'cached preview')
  if(mode==='guard')valid=false;else f.ctx.on('tools/post-execute',async(_exec,_result,next)=>next())
  assert.deepEqual(readPiLiveOutput(f.owner).tools,[])
  release.resolve();await running
 }
})

test('sampling failure withdraws and permanently disables the preview',async()=>{
 let reads=0,withdraws=0;const preview=startShellLivePreview({signal:new AbortController().signal,publishPartial:async()=>{},withdrawPartial:()=>withdraws++},()=>{reads++;throw Error('unavailable')})
 await preview.sample();await preview.sample();await preview.close();assert.equal(reads,1);assert.equal(withdraws,1)
})

test('same-name tool replacement invalidates original execution preview and cannot lend a new projector',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let remove,secondAccepted,newProjection=0
 const f=await officialToolsFixture(t,({ctx})=>{
  remove=ctx.tools.register(definition('bash',async(_args,exec)=>{assert.equal(await exec.publishPartial({content:[{type:'text',text:'before replacement'}]}),true);entered.resolve();await release.promise;secondAccepted=await exec.publishPartial({content:[{type:'text',text:'must not publish'}]});return{}},{partialResult:{version:1,project:v=>v.content}}))
 })
 const binding=bindPiLiveOutput(f.owner);t.after(()=>{release.resolve();binding.close()})
 const running=f.run([{id:'replace',name:'bash'}]);await entered.promise;assert.equal(readPiLiveOutput(f.owner).tools.length,1)
 remove();f.ctx.tools.register(definition('bash',async()=>({}),{partialResult:{version:1,project:v=>{newProjection++;return v.content}}}))
 assert.deepEqual(readPiLiveOutput(f.owner).tools,[]);release.resolve();await running;assert.equal(secondAccepted,false);assert.equal(newProjection,0)
})

test('validator registration failure disables publication',async t=>{
 let accepted,sinks=0
 const f=await officialToolsFixture(t,({ctx})=>ctx.tools.register(definition('bash',async(_args,exec)=>{accepted=await exec.publishPartial({content:[{type:'text',text:'must not publish'}]});return{}},{partialResult:{version:1,project:v=>v.content}})))
 await f.ctx.tools.execute({agent:f.owner,name:'bash',callId:'capacity',arguments:{},signal:new AbortController().signal,onPartialValidator:()=>false,onPartial:()=>sinks++})
 assert.equal(accepted,false);assert.equal(sinks,0)
})


test('live validator capacity fails closed and close removes registrations',async t=>{
 const f=await officialToolsFixture(t,()=>{}),binding=bindPiLiveOutput(f.owner)
 for(let n=0;n<64;n++)assert.equal(setPiLiveToolValidation(f.owner,String(n),()=>true),true)
 assert.equal(setPiLiveToolValidation(f.owner,'overflow',()=>true),false)
 binding.close();assert.equal(readPiLiveOutput(f.owner),null)
 const fresh=bindPiLiveOutput(f.owner);assert.equal(setPiLiveToolValidation(f.owner,'fresh',()=>true),true);fresh.close()
})


test('exact post-policy registrations cannot borrow compatibility from the same callback',async()=>{
 const ctx=new Context(),callback=async(_exec,_result,next)=>next()
 const deny=registerPartialCompatiblePostPolicy(ctx,callback,()=>false)
 const allow=registerPartialCompatiblePostPolicy(ctx,callback,()=>true)
 assert.equal(partialPoliciesCompatible(ctx,undefined,{}),false)
 deny();assert.equal(partialPoliciesCompatible(ctx,undefined,{}),true)
 const unknown=ctx.on('tools/post-execute',callback);assert.equal(partialPoliciesCompatible(ctx,undefined,{}),false)
 unknown();allow();await ctx.fiber.dispose()
})
