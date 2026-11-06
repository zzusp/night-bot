import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,mkdir,rm,symlink,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import NativePolicy,{setSandboxMode,selectSandboxPermission} from '../src/native-policy.js'
import NativeSessions from '../src/native-sessions.js'
import NativeProjections from '../src/native-projections.js'
async function fixture(t,Impl=NativePolicy){const root=await mkdtemp(join(tmpdir(),'night-policy-')),ctx=new Context();ctx.logger={warn(){}};new NativeSessions(ctx);new NativeProjections(ctx);new Impl(ctx,{mode:'workspace-write',workspaceRoot:root});t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})});return{ctx,root,session:id=>ctx.sessions.create(id,{meta:{cwd:root}})}}
async function contract(t,Impl){const h=await fixture(t,Impl),a=h.session('a'),b=h.session('b'),p=h.ctx.sandboxPolicy;setSandboxMode(a,'read-only');const result={default:p.resolve().mode,a:p.resolve({session:a}).mode,b:p.resolve({session:b}).mode,once:p.resolve({session:a,mode:'danger-full-access'}).mode,after:p.overrideOf(a),records:a.snapshotEvents().map(e=>e.data)};return result}
test('native policy preserves default/session/one-shot precedence and durable mode events',async t=>assert.deepEqual(await contract(t,NativePolicy),{default:'workspace-write',a:'read-only',b:'workspace-write',once:'danger-full-access',after:'read-only',records:[{mode:'read-only'}]}))
test('Night permission selector exhaustively preserves standing and one-time grants without mutation',()=>{
 const modes=['read-only','workspace-write','danger-full-access']
 for(const defaultMode of modes)for(const standingMode of [undefined,...modes])for(const oneTimeMode of [undefined,...modes]){
  const input=Object.freeze({defaultMode,standingMode,oneTimeMode,initialDirectory:'/workspace',sessionId:'task'})
  assert.deepEqual(selectSandboxPermission(input),{mode:oneTimeMode??standingMode??defaultMode,workspaceRoot:'/workspace',sessionId:'task'})
  assert.equal(selectSandboxPermission({...input,oneTimeMode:undefined}).mode,standingMode??defaultMode)
 }
 assert.throws(()=>selectSandboxPermission({initialDirectory:'relative'}),/absolute/)
 assert.throws(()=>selectSandboxPermission({initialDirectory:'/workspace',oneTimeMode:'invented'}),/mode/)
})
test('native policy binds one durable artifact root without mutating immutable session cwd',async t=>{const h=await fixture(t),s=h.session('a'),root=join(h.root,'tasks','owner','outputs');await mkdir(root,{recursive:true});const p=h.ctx.sandboxPolicy,binding=p.bindArtifactRoot(s,{ownerId:'owner',artifactRoot:root});binding.artifactRoot='caller mutation';assert.equal(s.header.cwd,h.root);assert.equal(p.resolve({session:s}).workspaceRoot,root);assert.equal(p.bindArtifactRoot(s,{ownerId:'owner',artifactRoot:root}).artifactRoot,root);assert.equal(s.snapshotEvents().filter(e=>e.type==='sandbox/mode').length,1);setSandboxMode(s,'read-only');assert.equal(p.resolve({session:s}).workspaceRoot,root);assert.equal(p.resolve({session:s}).mode,'read-only');const other=join(h.root,'tasks','other','outputs');await mkdir(other,{recursive:true});assert.throws(()=>p.bindArtifactRoot(s,{ownerId:'other',artifactRoot:other}),/BINDING_CHANGED/)})
test('native policy rechecks artifact ancestors and rejects a replaced root link at every resolution',async t=>{const h=await fixture(t),s=h.session('a'),root=join(h.root,'tasks','owner','outputs'),away=join(h.root,'outside');await mkdir(root,{recursive:true});await mkdir(away);h.ctx.sandboxPolicy.bindArtifactRoot(s,{ownerId:'owner',artifactRoot:root});await rename(root,root+'-original');await symlink(away,root,'dir');assert.throws(()=>h.ctx.sandboxPolicy.resolve({session:s}),/ROOT_LINK/);assert.throws(()=>h.ctx.sandboxPolicy.resolve({session:s,mode:'danger-full-access'}),/ROOT_LINK/)})
test('native policy validates modes, root layout and missing identity before recording permissions',async t=>{const h=await fixture(t),s=h.session('a');assert.throws(()=>setSandboxMode(s,'invented'),/mode/);assert.throws(()=>h.ctx.sandboxPolicy.resolve({session:s,mode:'invented'}),/mode/);assert.throws(()=>h.ctx.sandboxPolicy.bindArtifactRoot(s,{ownerId:'../escape',artifactRoot:h.root}),/BINDING_INVALID/);assert.throws(()=>h.ctx.sandboxPolicy.bindArtifactRoot(s,{ownerId:'owner',artifactRoot:h.root}),/ROOT_INVALID/);assert.equal(s.seq,0)})
