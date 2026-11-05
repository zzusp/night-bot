import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {SessionStore} from '../packages/capability-compat/session/index.js'
import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import NativePolicy,{setSandboxMode} from '../src/native-policy.js'
import {createNativeBusinessState,nativeBusinessAuditKinds} from '../src/runtime/pi-business-state.js'

test('business policy facts commit and restore independently of official conversation history',async t=>{
 const root=await mkdtemp('/tmp/night-business-state-'),ctx=new Context();new SessionStore(ctx);await ctx.plugin(Authority)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const config={auditKinds:nativeBusinessAuditKinds},header=ctx.sessions.prepare('state',{meta:{cwd:root}}).header
 let store=await backend.createNative(header,config),state=await createNativeBusinessState(store)
 const actor={id:'state',piSession:{},ctx},policy=Object.create(NativePolicy.prototype);policy.defaultMode='read-only'
 let live=true,notices=0
 const unbind=state.bindActor(actor,{isLive:()=>live,admitNotice:async()=>{notices++}})
 const audit=state.audit({isLive:()=>live,isTurnOpen:()=>true})
 audit.append('approval/policy',{policy:'never'});await audit.flush()
 await setSandboxMode(actor,'workspace-write')
 assert.equal(policy.resolve({actor,mode:'danger-full-access'}).mode,'workspace-write')
 assert.throws(()=>audit.append('user/message',{text:'not business state'}),{code:'PI_BUSINESS_FACT_UNSUPPORTED'})
 assert.throws(()=>policy.resolve({actor:{...actor}}),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
 assert.equal(notices,0);unbind();await store.close()
 store=await backend.openNative('state',config);state=await createNativeBusinessState(store)
 const actor2={id:'state',piSession:{},ctx},detach=state.bindActor(actor2,{isLive:()=>live,admitNotice:async()=>{notices++}})
 assert.equal(state.audit({isLive:()=>live,isTurnOpen:()=>true}).approvalPolicy(),'never')
 assert.equal(policy.resolve({actor:actor2}).mode,'workspace-write')
 assert.deepEqual(store.manager.buildSessionProjection().messages,[],'business facts are never invented model messages')
 live=false;assert.throws(()=>policy.resolve({actor:actor2}),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
 detach();await store.close()
})
test('an uncertain policy commit grants no new capability and poisons business state',async()=>{
 const uncertain=Object.assign(new Error('uncertain'),{code:'PI_SESSION_COMMIT_UNCERTAIN'}),written=[]
 const store={kind:'pi-native',header:{cwd:'/authorized'},readAudit:async()=>[],appendAudit:receipt=>written.push(receipt),commit:async()=>{throw uncertain}}
 const state=await createNativeBusinessState(store),actor={piSession:{},id:'a'},policy=Object.create(NativePolicy.prototype);policy.defaultMode='read-only'
 const detach=state.bindActor(actor,{isLive:()=>true,admitNotice:async()=>{}})
 await assert.rejects(setSandboxMode(actor,'danger-full-access'),error=>error===uncertain)
 assert.equal(written.length,1);assert.throws(()=>policy.resolve({actor}),error=>error===uncertain)
 assert.equal(state.audit({isLive:()=>true,isTurnOpen:()=>true}).isLive(),false)
 detach()
})
