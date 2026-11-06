import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,symlink,rename} from 'node:fs/promises'
import {join} from 'node:path'
import NativePolicy,{setSandboxMode,selectSandboxPermission} from '../src/native-policy.js'
import {nativeBusinessPolicyFixture} from './fixtures/native-business-policy.js'
async function fixture(t){const h=await nativeBusinessPolicyFixture(t);new NativePolicy(h.ctx,{mode:'workspace-write',workspaceRoot:h.root});return {...h,policy:h.ctx.get('sandboxPolicy'),agent:id=>h.actor(id,{cwd:h.root})}}
test('native policy keeps deployment default separate from bound actor; request fields cannot elevate standing permission',async t=>{
 const h=await fixture(t),a=await h.agent('a'),b=await h.agent('b'),p=h.policy;await setSandboxMode(a.actor,'read-only')
 assert.deepEqual({default:p.resolve().mode,a:p.resolve({actor:a.actor}).mode,b:p.resolve({actor:b.actor}).mode,untrustedOverride:p.resolve({actor:a.actor,mode:'danger-full-access'}).mode},{default:'workspace-write',a:'read-only',b:'workspace-write',untrustedOverride:'read-only'})
 assert.deepEqual(await a.facts(),[{version:1,domain:'sandbox',kind:'policy',payload:{mode:'read-only'}}]);assert.throws(()=>p.resolve({session:{header:{cwd:h.root},append(){assert.fail()}}}),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
})
test('Night permission selector exhaustively preserves standing and explicit trusted one-time grants without mutation',()=>{
 const modes=['read-only','workspace-write','danger-full-access']
 for(const defaultMode of modes)for(const standingMode of [undefined,...modes])for(const oneTimeMode of [undefined,...modes]){const input=Object.freeze({defaultMode,standingMode,oneTimeMode,initialDirectory:'/workspace',sessionId:'task'});assert.deepEqual(selectSandboxPermission(input),{mode:oneTimeMode??standingMode??defaultMode,workspaceRoot:'/workspace',sessionId:'task'});assert.equal(selectSandboxPermission({...input,oneTimeMode:undefined}).mode,standingMode??defaultMode)}
 assert.throws(()=>selectSandboxPermission({initialDirectory:'relative'}),/absolute/);assert.throws(()=>selectSandboxPermission({initialDirectory:'/workspace',oneTimeMode:'invented'}),/mode/)
})
test('native policy binds one durable artifact root without mutating immutable native origin',async t=>{
 const h=await fixture(t),a=await h.agent('a'),root=join(h.root,'tasks','owner','outputs');await mkdir(root,{recursive:true});const p=h.policy,binding=await p.bindArtifactRoot(a.actor,{ownerId:'owner',artifactRoot:root});binding.artifactRoot='caller mutation'
 assert.equal(a.store.header.cwd,h.root);assert.equal(p.resolve({actor:a.actor}).workspaceRoot,root);assert.equal((await p.bindArtifactRoot(a.actor,{ownerId:'owner',artifactRoot:root})).artifactRoot,root);assert.equal((await a.facts()).length,1)
 await setSandboxMode(a.actor,'read-only');assert.equal(p.resolve({actor:a.actor}).workspaceRoot,root);assert.equal(p.resolve({actor:a.actor}).mode,'read-only');const other=join(h.root,'tasks','other','outputs');await mkdir(other,{recursive:true});await assert.rejects(async()=>p.bindArtifactRoot(a.actor,{ownerId:'other',artifactRoot:other}),/BINDING_CHANGED/)
})
test('native policy rechecks artifact ancestors and rejects replaced root links at every resolution',async t=>{
 const h=await fixture(t),a=await h.agent('a'),root=join(h.root,'tasks','owner','outputs'),away=join(h.root,'outside');await mkdir(root,{recursive:true});await mkdir(away);await h.policy.bindArtifactRoot(a.actor,{ownerId:'owner',artifactRoot:root});await rename(root,root+'-original');await symlink(away,root,'dir');assert.throws(()=>h.policy.resolve({actor:a.actor}),/ROOT_LINK/);assert.throws(()=>h.policy.resolve({actor:a.actor,mode:'danger-full-access'}),/ROOT_LINK/)
})
test('native policy validates modes, root layout and actual binding before recording permissions',async t=>{
 const h=await fixture(t),a=await h.agent('a');assert.throws(()=>setSandboxMode(a.actor,'invented'),/mode/);assert.throws(()=>selectSandboxPermission({initialDirectory:h.root,oneTimeMode:'invented'}),/mode/);assert.throws(()=>h.policy.bindArtifactRoot(a.actor,{ownerId:'../escape',artifactRoot:h.root}),/BINDING_INVALID/);assert.throws(()=>h.policy.bindArtifactRoot(a.actor,{ownerId:'owner',artifactRoot:h.root}),/ROOT_INVALID/);assert.throws(()=>h.policy.resolve({actor:{...a.actor}}),{code:'PI_SANDBOX_ACTOR_UNBOUND'});assert.deepEqual(await a.facts(),[])
})
