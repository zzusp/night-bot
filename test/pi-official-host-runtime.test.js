import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {memoryHost} from './fixtures/memory-host.js'

async function create(f,id,{permission='workspace-write'}={}){
 return f.host.ctx.agents.create({sessionId:id,meta:{cwd:f.host.ctx.runtimePaths.workspaces,agentPreset:'night-bot-task'},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='test-input'&&packet.source.principal==='authorized-fixture',setup:async(ctx,actor)=>{await ctx.get('agentPresets').mount(ctx,'night-bot-task');await ctx.get('permissionPresets').set(actor,permission)}})
}
test('default Host publishes a real official SDK, scoped resources and durable input without legacy Session',async t=>{
 const f=await memoryHost(t),h=await create(f,'official-default')
 t.after(()=>h.dispose())
 assert.ok(h.session instanceof AgentSession);assert.equal(h.agent.session,undefined)
 assert.equal(f.host.ctx.get('agentLoop'),undefined)
 assert.equal(typeof h.agent.admission.deliver,'undefined','raw queue cannot send to a caller-selected SDK session')
 await h.enqueue({id:'host-input',source:{kind:'test-input',principal:'authorized-fixture'},content:'NIGHT_OFFICIAL_HOST_SMOKE'})
 await h.deliver('host-input');await h.whenIdle()
 assert.equal(f.requests.length,1)
 assert.equal(h.agent.admission.status('host-input'),'admitted')
 assert.ok(h.session.messages.some(message=>message.role==='assistant'))
 const stored=await f.host.ctx.sessionPersistence.readNative(h.agent.id,{requireComplete:true})
 assert.equal(stored.audit.filter(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted').length,1)
 assert.equal(stored.context.projection.model.provider,'fixture')
 assert.equal(stored.context.projection.model.modelId,'m')
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const first=h.runMaintenance(async actor=>{assert.equal(actor.admission.paused,true);entered.resolve();await release.promise})
 await entered.promise;const second=h.runMaintenance(async actor=>{assert.equal(actor.admission.paused,true)})
 release.resolve();await Promise.all([first,second]);assert.equal(h.agent.admission.paused,false)
})
test('default read-only file tool cannot inherit the deployment write policy',async t=>{
 let calls=0
 const f=await memoryHost(t,()=>++calls===1?{tool:'write',args:{file_path:'forbidden.txt',content:'must not write'}}:{text:'verified denial'})
 const h=await create(f,'official-read-only',{permission:'read-only'});t.after(()=>h.dispose())
 await h.enqueue({id:'readonly-input',source:{kind:'test-input',principal:'authorized-fixture'},content:'Exercise the read-only boundary'})
 await h.deliver('readonly-input');await h.whenIdle()
 assert.ok(h.session.messages.some(message=>message.role==='toolResult'&&message.isError))
 assert.equal(h.agent.ctx.get('sandboxPolicy').resolve({actor:h.agent}).mode,'read-only')
 await assert.rejects(readFile(join(f.host.ctx.runtimePaths.workspaces,'forbidden.txt')),{code:'ENOENT'})
})
