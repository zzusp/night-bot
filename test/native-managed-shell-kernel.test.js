import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
async function until(fn){for(let n=0;n<500;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10))}throw Error('shell kernel evidence timeout')}
function resolved(f,command,extra={}){const cwd=f.host.ctx.runtimePaths.workspaces;return f.host.ctx.get('shell').resolve({command,workdir:cwd,sandboxPolicy:{mode:'workspace-write',workspaceRoot:cwd,artifactRoot:cwd},...extra})}
test('real Linux confined shell joins cancellation of a process that refuses TERM',{timeout:20000,skip:process.platform!=='linux'},async t=>{
 const f=await memoryHost(t),marker=join(f.host.ctx.runtimePaths.workspaces,'descendant-ready')
 const child='require("node:fs").writeFileSync('+JSON.stringify(marker)+',"ready");process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'
 const execution=await f.host.ctx.get('shell').execute(resolved(f,quote(process.execPath)+' -e '+quote(child),{onExpiry:'none'}));t.after(async()=>{execution.kill();await execution.done})
 await until(()=>readFile(marker,'utf8').catch(error=>{if(error.code==='ENOENT')return;throw error}));let done=false;execution.done.then(()=>{done=true});await new Promise(r=>setTimeout(r,50));assert.equal(done,false);assert.equal(execution.status,'running')
 assert.equal(execution.kill(),true);await execution.done;assert.equal(execution.status,'killed');assert.equal(f.host.ctx.get('subprocess').live.size,0)
})
test('real Linux confined shell enforces output and spill caps without losing the explicit exit outcome',{timeout:20000,skip:process.platform!=='linux'},async t=>{
 const f=await memoryHost(t),execution=await f.host.ctx.get('shell').execute(resolved(f,quote(process.execPath)+' -e '+quote('process.stdout.write("x".repeat(300000));process.stderr.write("stderr-proof");process.exitCode=7'),{stdoutMaxBytes:128}))
 const result=await execution.result();assert.equal(result.exitCode,7);assert.equal(result.stdout.truncated,true);assert.ok(Buffer.byteLength(result.stdout.text)<=128);assert.ok(result.stdout.spillPath);assert.ok((await stat(result.stdout.spillPath)).size>=300000);assert.equal(result.stderr.text,'stderr-proof');assert.equal(f.requests.length,0)
})

test('Linux owned subprocess direct exit cannot settle shell completion while a descendant remains',{timeout:15000,skip:process.platform!=='linux'},async t=>{
 const {Context}=await import('@deepseek-ai/cordis'),{default:ProcessRuntime}=await import('../src/process/index.js'),{runManagedShell}=await import('../src/runtime/managed-shell-execution.js')
 const ctx=new Context();ctx.logger={warn(){},error(){}};const runtime=new ProcessRuntime(ctx);t.after(()=>ctx.fiber.dispose())
 let processHandle
 const child='process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'
 const parent='require("node:child_process").spawn(process.execPath,["-e",'+JSON.stringify(child)+'],{stdio:"ignore"});process.exit(0)'
 const execution=await runManagedShell({spec:{onExpiry:'none',timeoutMs:10000},prepare:[process.execPath,'-e',parent],spawn(argv){return processHandle=runtime.spawn({argv,cwd:process.cwd(),stdio:{stdin:'ignore',stdout:{maxBytes:64},stderr:{maxBytes:64}},graceMs:100})}})
 t.after(async()=>{execution.kill();await execution.done})
 assert.equal((await processHandle.done).exitCode,0);let done=false;execution.done.then(()=>{done=true});await new Promise(r=>setTimeout(r,40));assert.equal(done,false);assert.equal(await processHandle.waitForExit(AbortSignal.timeout(20)),false)
 execution.kill();await execution.done;assert.equal(await processHandle.waitForExit(),true);assert.equal(runtime.live.size,0)
})
for(const promote of [false,true])test('real confined SDK shell keeps one effect and durable job through '+(promote?'timeout promotion':'explicit background'),{timeout:20000,skip:process.platform!=='linux'},async t=>{
 let actor,command;const captured=[]
 const f=await memoryHost(t,()=>{
  if(f.requests.length===1)return {tool:'bash',args:{description:'One isolated managed effect',command,...promote?{timeoutMs:20}:{run_in_background:true}}}
  if(f.requests.length===2){const job=f.host.ctx.jobs.list(actor.id)[0];assert.ok(job);return {tool:'job_output',args:{job_id:job.id,wait:true}}}
  return {text:'managed job verified'}
 })
 const effect=join(f.host.ctx.runtimePaths.workspaces,'job-'+promote+'.txt'),script='setTimeout(()=>{require("node:fs").appendFileSync('+JSON.stringify(effect)+',"effect\\n");process.stdout.write("MANAGED_JOB_PROOF")},300)'
 command=quote(process.execPath)+' -e '+quote(script)
 const handle=await f.host.ctx.agents.create({sessionId:'managed-job-'+promote,meta:{cwd:f.host.ctx.runtimePaths.workspaces},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='fixture-user',setup:async(ctx,owner)=>{await ctx.get('permissionPresets').set(owner,'workspace-write')}});actor=handle.agent;t.after(()=>handle.dispose())
 f.host.ctx.on('tools/result',(exec,result)=>{if(exec.agent===actor&&exec.name==='bash')captured.push(result)})
 await handle.enqueue({id:'managed-job-input',source:{kind:'fixture-user'},content:'Run and collect exactly one managed effect'});await handle.deliver('managed-job-input');await handle.whenIdle()
 assert.equal(f.requests.length,3);assert.equal(await readFile(effect,'utf8'),'effect\n');assert.equal(captured[0].value.kind,promote?'promoted':'background');assert.match(JSON.stringify(f.requests[2]),/MANAGED_JOB_PROOF/)
 const saved=await f.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true}),registered=saved.audit.filter(receipt=>receipt.domain==='job'&&receipt.kind==='registered'),settled=saved.audit.filter(receipt=>receipt.domain==='job'&&receipt.kind==='settled')
 assert.equal(registered.length,1);assert.equal(settled.length,1);assert.equal(settled[0].payload.jobId,registered[0].payload.jobId);assert.equal(settled[0].payload.producerReported,true);assert.equal(settled[0].payload.status,'completed');assert.equal(f.host.ctx.get('shell').processFacts.size,0)
})
