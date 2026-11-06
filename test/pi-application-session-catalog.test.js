import test from 'node:test'
import {Context} from '@deepseek-ai/cordis'
import {setImmediate} from 'node:timers/promises'
import NativeWorkspace from '../src/native-workspace.js'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {providerHost,result} from './fixtures/provider-official-host.js'

test('default Host metadata catalog has no Session facade and preserves actual cold headers, names and permissions',{timeout:15000},async t=>{
 const f=await memoryHost(t),ctx=f.host.ctx,catalog=ctx.get('sessionCatalog')
 assert.ok(catalog);assert.equal(ctx.get('sessions'),undefined)
 for(const method of ['prepare','create','enter','announce','flush','fork','snapshotEvents','registerMessageProjection'])assert.equal(catalog[method],undefined)
 assert.equal(await catalog.header('not-a-session'),undefined);assert.equal(await catalog.isKnown('not-a-session'),false)
 const registry=ctx.workspaceRegistry;registry.headers.set('stale-cached-only',{id:'stale-cached-only',createdAt:1,cwd:ctx.runtimePaths.workspaces});assert.equal(await registry.sessionKnown('stale-cached-only'),false);await assert.rejects(registry.readSessionHeader('stale-cached-only'),/no header/);await assert.rejects(registry.archiveSession('stale-cached-only'),error=>error.name==='WorkspaceUnknownSessionError')
 const handle=await f.agent('catalog-actual'),actor=handle.actor,header=await catalog.header(actor.id)
 assert.deepEqual(header,actor.metadata);header.cwd='/forged';assert.notEqual((await catalog.header(actor.id)).cwd,'/forged')
 assert.equal(ctx.permissionPresets.current(actor),'workspace-write');await ctx.permissionPresets.select(actor,'read-only');assert.equal(ctx.permissionPresets.current(actor),'read-only')
 await ctx.sessionNames.set(actor,'Actual official name');const before=await ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
 const headers=await catalog.listHeaders();assert.equal(headers.filter(row=>row.id===actor.id).length,1);assert.deepEqual(headers.find(row=>row.id===actor.id),actor.metadata)
 assert.deepEqual((await ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})).entries,before.entries,'catalog reads do not append history or projections')
 await handle.dispose();assert.equal(ctx.agents.get(actor.id),undefined);assert.equal(ctx.piAuthority.describe(actor.id),undefined)
 assert.deepEqual(await catalog.header(actor.id),actor.metadata);assert.equal(await catalog.isKnown(actor.id),true,'known metadata does not mean a live actor or writer')
 assert.equal((await ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})).sessionName.name,'Actual official name')
 assert.equal(ctx.get('sessions'),undefined)
})

test('cold task recovery retains its unregistered actual native writer instead of declaring it drained',{timeout:20000},async t=>{
 const root=await mkdtemp('/tmp/night-catalog-writer-');let first,cold,writer
 t.after(async()=>{await writer?.close();await cold?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 first=await providerHost(t,{root,decide:()=>[result()]});const id=await first.create('catalog-writer-original');await first.service.whenIdle()
 const prior=await first.query('task.get',{taskId:id});await first.service.store.command({id:'held-writer-wake',kind:'task.wake',args:{taskId:id,kind:'operator.continue',payload:{requestId:'held-writer-proof'}}});await first.service.store.command({id:'claim-held-writer',kind:'task.claim',args:{taskId:id}});await first.close()
 cold=await providerHost(t,{root,initialize:false,decide:()=>[result()]});const task=await cold.query('task.get',{taskId:id});assert.equal(task.recovering,true);assert.equal(task.drained,false)
 writer=await cold.ctx.sessionPersistence.openNative(prior.sessionId);assert.equal(cold.ctx.agents.get(prior.sessionId),undefined);assert.ok(cold.ctx.piAuthority.describe(prior.sessionId));assert.equal(await cold.ctx.sessionCatalog.isKnown(prior.sessionId),true)
 await cold.service.recover();await cold.service.whenIdle();const held=await cold.query('task.get',{taskId:id});assert.equal(held.recovering,true);assert.equal(held.drained,false);assert.equal(cold.taskRequests().length,0)
 await writer.close();writer=undefined;await cold.service.recover();await cold.service.whenIdle();const recovered=await cold.query('task.get',{taskId:id});assert.equal(recovered.recovering,false);assert.equal(recovered.drained,true)
})

test('a missing application catalog cannot activate workspace through the old Session service',{timeout:3000},async t=>{
 const ctx=new Context();let opened=0
 t.after(()=>ctx.fiber.dispose())
 ctx.provide('storageDomain',{async open(){opened++;throw Error('workspace must wait for its metadata authority')}})
 ctx.provide('sessionPersistence',{async list(){return []}})
 ctx.provide('sessions',{list(){throw Error('legacy Session fallback must not be used')}})
 ctx.plugin(NativeWorkspace);await setImmediate()
 assert.equal(ctx.get('workspaceRegistry'),undefined);assert.equal(opened,0)
})
