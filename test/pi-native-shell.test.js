import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import NativeBash from '../src/native-bash-local.js'
import NativePwsh from '../src/native-pwsh-local.js'
import SandboxBash from '../src/native-bash-sandbox.js'
import SandboxPwsh from '../src/native-pwsh-sandbox.js'
import NativeSandbox from '../src/native-sandbox.js'
import {windowsFileRequest,windowsLaunchPolicy} from '../src/process/contracts.js'
import {deadline} from '../src/runtime/deadlines.js'
import {parseExitStatus,ENV_FACT_PREFIX} from '../src/native-shell.js'
const abortOf=s=>s.aborted?Promise.resolve():new Promise(r=>s.addEventListener('abort',r,{once:true}))
function reader(text){return{readFrom:at=>({text:Buffer.from(text).subarray(at).toString(),nextOffset:Buffer.byteLength(text),lossy:false})}}
async function fixture(t,Impl=NativeBash,sandboxPolicy){const ctx=new Context(),state={spawns:[],done:Promise.withResolvers(),out:'stdout text',err:'stderr text',terminated:0};ctx.provide('subprocess',{spawn:spec=>{state.spawns.push(spec);if(state.failure)throw state.failure;return{done:state.done.promise,waitForExit:async()=>{await state.done.promise.catch(()=>{});return true},collected:{stdout:reader(state.out),stderr:reader(state.err)},terminate(){state.terminated++}}}});if(sandboxPolicy){const sandbox=new NativeSandbox(ctx);sandbox.internals={chain:['windows-acl'],windowsAclRunnerArgs:['fixture-windows-runner']};ctx.provide('sandboxPolicy',{defaultMode:sandboxPolicy.mode,resolve:()=>sandboxPolicy})}await ctx.plugin(Impl,{cwd:'/fixture cwd',timeoutMs:50,maxTimeoutMs:200,maxOutputBytes:100,maxSpillBytes:1000,graceMs:5,.../Pwsh/.test(Impl.name)?{pwshPath:'fixture-pwsh'}:{}});t.after(async()=>{state.done.resolve({exitCode:0,signal:null});await ctx.fiber.dispose()});return{ctx,state,shell:ctx.get('shell')}}
test('native bash and pwsh preserve independently specified argv, environment, bounded output and exit contracts',async t=>{
 for(const Impl of [NativeBash,NativePwsh]){
  const h=await fixture(t,Impl),command='literal $source; text',spec=h.shell.resolve({command,timeoutMs:500,env:{CUSTOM:'value'}}),execution=await h.shell.execute(spec)
  assert.equal(spec.timeoutMs,200);assert.equal(spec.workdir,'/fixture cwd')
  const spawn=h.state.spawns[0],preamble='[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); '
  assert.deepEqual(spawn.argv,Impl===NativeBash?['bash','-c',command]:['fixture-pwsh','-NoLogo','-NoProfile','-NonInteractive','-Command',preamble+command])
  assert.equal(spawn.cwd,'/fixture cwd');assert.deepEqual(spawn.env,{NO_COLOR:'1',...Impl===NativeBash?{TERM:'dumb'}:{},PAGER:'cat',GIT_PAGER:'cat',CUSTOM:'value'})
  assert.deepEqual(spawn.stdio,{stdin:'ignore',stdout:{maxBytes:100,spill:{maxBytes:1000}},stderr:{maxBytes:100,spill:{maxBytes:1000}}});assert.equal(spawn.graceMs,5)
  assert.deepEqual(execution.readOutput(),{delta:'stdout text\n[stderr]\nstderr text',lossy:false});assert.deepEqual(execution.readOutput(),{delta:'',lossy:false})
  h.state.done.resolve({exitCode:7,signal:null});assert.deepEqual(await execution.result(),{exitCode:7,signal:null,timedOut:false,aborted:false,timeoutMs:200,stdout:{text:'stdout text',truncated:false},stderr:{text:'stderr text',truncated:false}})
 }
})
test('native shell preparation timeout waits for admitted preparation exit and never spawns late argv',async t=>{for(const Impl of [NativeBash,NativePwsh]){const h=await fixture(t,Impl),entered=Promise.withResolvers(),release=Promise.withResolvers();let signal,returned=false;const pending=h.shell.executeArgv(h.shell.resolve({command:'fixture',timeoutMs:5}),async s=>{signal=s;entered.resolve();await release.promise;return['must-not-spawn']}).then(ex=>{returned=true;return ex});await entered.promise;await abortOf(signal);await new Promise(r=>setImmediate(r));assert.equal(returned,false);assert.equal(h.state.spawns.length,0);release.resolve();const ex=await pending,result=await ex.result();assert.equal(result.timedOut,true);assert.equal(result.aborted,false);assert.equal(h.state.spawns.length,0)}})
test('native shell same-code ancestor deadline keeps caller identity even after owned timer fires',async t=>{for(const Impl of [NativeBash,NativePwsh]){const h=await fixture(t,Impl),outer=deadline(undefined,5,'BASH_TIMEOUT'),entered=Promise.withResolvers(),release=Promise.withResolvers();let settled=false;const pending=h.shell.executeArgv(h.shell.resolve({command:'fixture',timeoutMs:15,signal:outer.signal}),async()=>{entered.resolve();await release.promise;return['must-not-spawn']});const checked=assert.rejects(pending,e=>e===outer.signal.reason).then(()=>{settled=true});await entered.promise;await abortOf(outer.signal);await new Promise(r=>setTimeout(r,25));assert.equal(settled,false);release.resolve();await checked;assert.equal(h.state.spawns.length,0);outer[Symbol.dispose]()}})
test('native shell foreground timeout waits for provider close before final result',async t=>{const h=await fixture(t),ex=await h.shell.execute(h.shell.resolve({command:'fixture',timeoutMs:5}));let returned=false;const result=ex.result().then(r=>{returned=true;return r});await abortOf(h.state.spawns[0].signal);await new Promise(r=>setImmediate(r));assert.equal(returned,false);h.state.done.resolve({exitCode:null,signal:'SIGTERM'});const r=await result;assert.equal(r.timedOut,true);assert.equal(r.aborted,false);assert.equal(r.signal,'SIGTERM')})
test('native shell provider creation failure settles done and preserves one infrastructure rejection without retry',async t=>{const h=await fixture(t);h.state.failure=Error('fixture spawn failure');const ex=await h.shell.execute(h.shell.resolve({command:'fixture'}));await ex.done;assert.equal(ex.status,'killed');await assert.rejects(ex.result(),e=>e===h.state.failure);assert.equal(h.state.spawns.length,1)})
test('execution fact names and trailing-only exit markers have explicit bounded contracts',()=>{assert.equal(ENV_FACT_PREFIX,'NIGHT_BOT_');for(const [text,expected] of [['plain output',{body:'plain output',exitCode:0}],['value\n[exit code: 9]',{body:'value',exitCode:9}],['value\n[killed by signal: SIGTERM]',{body:'value',signal:'SIGTERM'}],['[exit code: 9]',{body:'[exit code: 9]',exitCode:0}],['[exit code: 9]\nmore',{body:'[exit code: 9]\nmore',exitCode:0}]])assert.deepEqual(parseExitStatus(text),expected)})

test('Windows prepared metadata survives both real sandbox shell adapters and local spawnSpec copies',async t=>{
 const workspaceRoot=String.raw`C:\night-fixture\data\workspaces\sandbox`
 for(const Impl of [SandboxBash,SandboxPwsh]){
  const h=await fixture(t,Impl,{mode:'workspace-write',workspaceRoot}),command='literal $value; -- argument',execution=await h.shell.execute(h.shell.resolve({command,workdir:workspaceRoot}))
  const spawn=h.state.spawns[0],file=windowsFileRequest(spawn)
  assert.ok(file,'sandbox prepared metadata must reach the actual subprocess boundary')
  assert.equal(file.mode,'workspace-write');assert.equal(file.workspaceRoot,workspaceRoot)
  assert.deepEqual(file.argv,Impl===SandboxBash?['bash','-c',command]:h.shell.argv(h.shell.resolve({command})))
  assert.equal(spawn.argv[0],'fixture-windows-runner');assert.deepEqual(spawn.argv.slice(-file.argv.length),file.argv)
  assert.equal(windowsLaunchPolicy(spawn),undefined);assert.equal(Object.hasOwn(spawn,'lpac'),false)
  h.state.done.resolve({exitCode:0,signal:null});assert.equal((await execution.result()).exitCode,0)
 }
})
