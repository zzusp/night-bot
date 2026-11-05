import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import NativePresets,{bindPermissionPresetActor} from '../src/native-permission-presets.js'
import NativeApproval,{bindApprovalAudit} from '../src/native-approval.js'
import NativePolicy,{bindSandboxPolicyActor} from '../src/native-policy.js'
import NativeSessions from '../src/native-sessions.js'
import NativeProjections from '../src/native-projections.js'
import NativeSystemPrompt from '../src/native-system-prompt.js'
import {memoryWriteAuthorization} from '../src/memory/tools.js'
const table={read:{sandbox:'read-only',approval:'ask'},write:{sandbox:'workspace-write',approval:'ask'},wide:{sandbox:'danger-full-access',approval:'never'}}
async function fixture(t,{commit}={}){
 const ctx=new Context(),commands=[];new NativeSessions(ctx);new NativeProjections(ctx);new NativeSystemPrompt(ctx,{includeHarnessIdentity:false});new NativeApproval(ctx,{policy:'ask'});new NativePolicy(ctx,{mode:'read-only',workspaceRoot:'/workspace/one'});ctx.provide('shell',{sandboxMode:'read-only'});ctx.provide('commands',{register:command=>commands.push(command)});new NativePresets(ctx,{presets:table,defaultPreset:'read'});t.after(()=>ctx.fiber.dispose());await ctx.fiber.await()
 const actor={id:'official-permissions',ctx,piSession:{}},foreign={...actor};let live=true,state={preset:'read',sandbox:'read-only',approval:'ask',seeded:false},calls=0
 bindApprovalAudit(actor,{isLive:()=>live,isTurnOpen:()=>true,approvalPolicy:()=>state.approval,append(){throw Error('preset must use one composite commit')},flush:async()=>{}})
 bindSandboxPolicyActor(actor,{initialDirectory:'/workspace/one',isLive:()=>live,readPolicy:()=>({mode:state.sandbox,artifactRoot:null}),appendPolicy(){throw Error('preset must use one composite commit')}})
 const port={isLive:()=>live,readPermissions:()=>({...state}),commitPermissions:async value=>{calls++;await commit?.(value);state={...state,...value}}};const unbind=bindPermissionPresetActor(actor,port)
 return {ctx,actor,foreign,commands,port,unbind,get state(){return state},get calls(){return calls},retire(){live=false}}
}
test('official preset current/set/select and command await one durable composite sandbox+approval selection',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let blocked=true
 const f=await fixture(t,{commit:async()=>{if(blocked){entered.resolve();await release.promise}}})
 assert.equal(f.ctx.permissionPresets.current(f.actor),'read')
 const pending=f.ctx.permissionPresets.set(f.actor,'wide');await entered.promise
 assert.equal(f.ctx.permissionPresets.current(f.actor),'read');assert.equal(f.ctx.approval.policyForActor(f.actor),'ask');release.resolve();await pending;blocked=false
 assert.equal(f.ctx.permissionPresets.current(f.actor),'wide');assert.equal(f.ctx.approval.policyForActor(f.actor),'never');assert.equal(f.ctx.sandboxPolicy.resolve({actor:f.actor}).mode,'danger-full-access');assert.equal(f.calls,1)
 await f.ctx.permissionPresets.select(f.actor,'write');assert.equal(f.ctx.permissionPresets.current(f.actor),'write')
 const command=f.commands.find(command=>command.name==='permission');assert.equal((await command.handler({agent:f.actor,rawInput:'read'})).kind,'success');assert.equal(f.ctx.permissionPresets.current(f.actor),'read')
 assert.equal(f.actor.session,undefined)
})
test('memory authorization uses actual privately bound sandbox permission, rejects foreign actor and ignores options',async t=>{
 const f=await fixture(t),authorize=memoryWriteAuthorization(f.ctx)
 f.actor.options={sandboxMode:'danger-full-access',permissionPreset:'wide'};assert.equal(await authorize(f.actor),false)
 await f.ctx.permissionPresets.set(f.actor,'write');assert.equal(await authorize(f.actor),true)
 assert.throws(()=>authorize(f.foreign),{code:'PI_PERMISSION_ACTOR_UNBOUND'});assert.throws(()=>bindPermissionPresetActor(f.actor,{...f.port}),/already bound/)
 f.retire();assert.throws(()=>authorize(f.actor),{code:'PI_PERMISSION_ACTOR_UNBOUND'})
})
test('failed composite selection fences permission reads and cannot claim new effective authority',async t=>{
 const failure=Error('durable permission append failed'),f=await fixture(t,{commit:async()=>{throw failure}})
 await assert.rejects(f.ctx.permissionPresets.set(f.actor,'wide'),error=>error===failure)
 assert.equal(f.state.sandbox,'read-only');assert.equal(f.ctx.sandboxPolicy.resolve({actor:f.actor}).mode,'read-only')
 assert.throws(()=>f.ctx.permissionPresets.current(f.actor),error=>error===failure);assert.throws(()=>memoryWriteAuthorization(f.ctx)(f.actor),error=>error===failure)
})
test('permission snapshot inconsistent with actual sandbox or approval is rejected',async t=>{
 const f=await fixture(t);f.unbind();bindPermissionPresetActor(f.actor,{...f.port,readPermissions:()=>({...f.state,sandbox:'danger-full-access'})})
 assert.throws(()=>f.ctx.permissionPresets.current(f.actor),{code:'PI_PERMISSION_STATE_MISMATCH'});assert.throws(()=>memoryWriteAuthorization(f.ctx)(f.actor),{code:'PI_PERMISSION_STATE_MISMATCH'})
})
test('official Auto still requires live synchronous admission before composite permission publication',async t=>{
 const f=await fixture(t);let remove;remove=f.ctx.permissionPresets.registerAuto(()=>remove())
 await assert.rejects(f.ctx.permissionPresets.set(f.actor,'auto'),/revoked/);assert.equal(f.calls,0)
 const second=f.ctx.permissionPresets.registerAuto(async()=>{});await assert.rejects(f.ctx.permissionPresets.set(f.actor,'auto'),/synchronous/);second();assert.equal(f.calls,0)
})

test('real Host scoped permission service resolves actual sandbox/approval capabilities for an official SDK actor',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),{officialToolsFixture}=await import('./fixtures/pi-official-tools.js'),{createScope}=await import('../src/native-scope.js'),{bindWorkingDirectoryActor}=await import('../src/native-working-directory.js')
 const host=await memoryHost(t),sdk=await officialToolsFixture(t,async()=>{}),ctx=host.host.ctx,actor={id:sdk.owner.id,piSession:sdk.session};const scope=createScope(ctx,actor);actor.ctx=scope.ctx
 const detach=ctx.agents.enter(actor);t.after(async()=>{detach();await scope.dispose()})
 const initial=ctx.permissionPresets.resolve('workspace-write');let state={preset:'workspace-write',sandbox:initial.sandbox,approval:initial.approval,seeded:false}
 const live=()=>ctx.agents.get(actor.id)===actor,origin=ctx.runtimePaths.workspaces
 bindWorkingDirectoryActor(actor,{initialDirectory:origin,isLive:live,readDirectory:()=>origin,appendChange(){throw Error('unused')},admitNotice(){}})
 bindSandboxPolicyActor(actor,{initialDirectory:origin,isLive:live,readPolicy:()=>({mode:state.sandbox,artifactRoot:null}),appendPolicy(){throw Error('composite only')}})
 bindApprovalAudit(actor,{isLive:live,isTurnOpen:()=>true,approvalPolicy:()=>state.approval,append(){throw Error('composite only')},flush:async()=>{}})
 bindPermissionPresetActor(actor,{isLive:live,readPermissions:()=>state,commitPermissions:async value=>{state={...state,...value}}})
 const permissions=actor.ctx.get('permissionPresets');assert.equal(permissions.current(actor),'workspace-write')
 await permissions.select(actor,'danger-full-access');assert.equal(actor.ctx.get('sandboxPolicy').resolve({actor}).mode,'danger-full-access');assert.equal(actor.ctx.get('approval').policyForActor(actor),'never');assert.equal(memoryWriteAuthorization(actor.ctx)(actor),true)
 await permissions.select(actor,'read-only');assert.equal(permissions.current(actor),'read-only');assert.equal(memoryWriteAuthorization(actor.ctx)(actor),false)
})
