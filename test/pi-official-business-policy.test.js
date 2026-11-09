import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {posix,join} from 'node:path'
const {resolve}=posix
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {setImmediate} from 'node:timers/promises'
import NativeSystemPrompt from '../src/native-system-prompt.js'
import NativeWorkingDirectory,{bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import NativePolicy,{bindSandboxPolicyActor,setSandboxMode} from '../src/native-policy.js'
function fixture(t){
 const ctx=new Context(),directories=new Set(['/project','/project/sub','/other']),notices=[],facts=[]
 new NativeSystemPrompt(ctx,{includeHarnessIdentity:false})
 ctx.provide('fs',{resolve:async(path,{cwd='/project',signal}={})=>{signal?.throwIfAborted();return resolve(cwd,path)},stat:async path=>directories.has(path)?{type:'directory'}:undefined,processPath:path=>path})
 new NativeWorkingDirectory(ctx,{defaultDirectory:'/project'});new NativePolicy(ctx,{mode:'read-only',workspaceRoot:'/project'})
 t.after(()=>ctx.fiber.dispose())
 const actor={id:'official-a',ctx,piSession:{}},foreign={...actor};let cwd=null,policy={mode:null,artifactRoot:null},live=true
 const directoryPort={initialDirectory:'/project',readDirectory:()=>cwd,appendChange:async value=>{facts.push(value);cwd=value.cwd},admitNotice:async value=>notices.push(value),isLive:()=>live}
 const policyPort={initialDirectory:'/project',readPolicy:()=>policy,appendPolicy:async value=>{policy={...policy,...value}},isLive:()=>live}
 const unbindDirectory=bindWorkingDirectoryActor(actor,directoryPort),unbindPolicy=bindSandboxPolicyActor(actor,policyPort)
 return {ctx,actor,foreign,directories,notices,facts,directoryPort,policyPort,unbindDirectory,unbindPolicy,get cwd(){return cwd},get policy(){return policy},retire(){live=false}}
}
test('actual officialSections includes required cwd and sandbox business text without Session facade',async t=>{
 const f=fixture(t);await setImmediate();const sections=await f.ctx.systemPrompt.officialSections(f.actor),text=JSON.stringify(sections)
 assert.match(text,/Current working directory/);assert.match(text,/read-only/);assert.equal(f.actor.session,undefined);assert.equal(f.cwd,'/project')
 await f.ctx.workingDirectory.set(f.actor,'sub');assert.equal(f.cwd,'/project/sub')
 await setSandboxMode(f.actor,'workspace-write')
 assert.equal(f.ctx.sandboxPolicy.resolve({actor:f.actor,mode:'danger-full-access'}).mode,'workspace-write','request overrides are not authority')
 assert.equal(f.ctx.sandboxPolicy.resolve({agent:f.actor}).workspaceRoot,'/project','cwd changes never widen sandbox workspace')
})
test('equal ids and options cannot inherit private official business capabilities',async t=>{
 const f=fixture(t);f.foreign.options={sandboxMode:'danger-full-access',cwd:'/other'}
 assert.throws(()=>f.ctx.workingDirectory.get(f.foreign),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
 assert.throws(()=>f.ctx.sandboxPolicy.resolve({actor:f.foreign}),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
 await assert.rejects(f.ctx.systemPrompt.officialSections(f.foreign),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
 assert.throws(()=>bindSandboxPolicyActor(f.actor,{...f.policyPort}),/already bound/)
 f.retire();assert.throws(()=>f.ctx.sandboxPolicy.resolve({agent:f.actor}),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
})
test('directory waits for durable append before notices or return and failures leave old state',async t=>{
 const f=fixture(t);f.unbindDirectory();const entered=Promise.withResolvers(),release=Promise.withResolvers();let cwd='/project',finished=false
 bindWorkingDirectoryActor(f.actor,{...f.directoryPort,readDirectory:()=>cwd,appendChange:async value=>{entered.resolve();await release.promise;cwd=value.cwd}})
 const pending=f.ctx.workingDirectory.set(f.actor,'sub').then(value=>{finished=true;return value});await entered.promise
 assert.equal(finished,false);assert.equal(f.notices.length,0);assert.equal(cwd,'/project');release.resolve();assert.equal(await pending,'/project/sub');assert.equal(f.notices.length,1)
 const other={id:'failure',ctx:f.ctx,piSession:{}};bindWorkingDirectoryActor(other,{...f.directoryPort,readDirectory:()=>'/project',appendChange:async()=>{throw Error('append failed')}})
 await assert.rejects(f.ctx.workingDirectory.set(other,'sub'),/append failed/);assert.equal(f.notices.length,1);assert.equal(f.ctx.workingDirectory.get(other),'/project')
})
test('official directory recovery uses immutable initial directory and scoped filesystem rejection is preserved',async t=>{
 const f=fixture(t);await f.ctx.workingDirectory.set(f.actor,'sub');f.directories.delete('/project/sub');f.directoryPort.initialDirectory='/other'
 assert.equal(await f.ctx.workingDirectory.ensure(f.actor),'/project');assert.equal(f.notices.at(-1).recovered,true)
 const prior=f.cwd;f.ctx.fs.resolve=async()=>{throw Error('filesystem denied')}
 await assert.rejects(f.ctx.workingDirectory.set(f.actor,'/other'),/filesystem denied/);assert.equal(f.cwd,prior)
})
test('artifact business binding awaits durable policy and rechecks real filesystem links and immutable origin',async t=>{
 const f=fixture(t),root=await mkdtemp(join(tmpdir(),'night-official-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));const outputs=join(root,'tasks','owner','outputs');await mkdir(outputs,{recursive:true})
 const result=await f.ctx.sandboxPolicy.bindArtifactRoot(f.actor,{ownerId:'owner',artifactRoot:outputs});assert.equal(result.sessionCwd,'/project');assert.equal(f.ctx.sandboxPolicy.resolve({actor:f.actor}).workspaceRoot,outputs)
 f.policyPort.initialDirectory='/other';assert.equal(f.ctx.sandboxPolicy.resolve({actor:f.actor}).workspaceRoot,outputs)
 await rename(outputs,outputs+'-saved');const away=join(root,'away');await mkdir(away);await symlink(away,outputs,'dir')
 assert.throws(()=>f.ctx.sandboxPolicy.resolve({actor:f.actor}),/ROOT_LINK/)
})
test('sandbox append failure does not announce a committed mode or artifact binding',async t=>{
 const f=fixture(t);f.unbindPolicy();bindSandboxPolicyActor(f.actor,{...f.policyPort,appendPolicy:async()=>{throw Error('policy disk failed')}})
 await assert.rejects(setSandboxMode(f.actor,'danger-full-access'),/policy disk failed/)
 assert.equal(f.ctx.sandboxPolicy.resolve({actor:f.actor}).mode,'read-only')
})
