import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {officialWorkingDirectoryOrigin} from '../src/native-working-directory.js'
import {join} from 'node:path'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'
test('actual Pi native todo and working-directory bindings retain durable state and scoped directory ownership',{timeout:20000},async t=>{
 let step=0
 const f=await subagentFixture(t,()=>++step===1?{tools:[{id:'todo-write',name:'todo_write',args:{todos:[{content:' scoped plan ',status:'in_progress'}]}},{id:'directory-write',name:'working_directory',args:{cd:'next'}}]}:{text:'plan recorded'})
 const handle=await f.host.ctx.agents.create({sessionId:'control-todo-cwd',meta:{cwd:join(f.root,'work'),agentPreset:'night-bot'},authorizeInput:(packet,actor)=>actor.id==='control-todo-cwd'&&packet.source.kind==='control-fixture'})
 f.handles.push(handle);const actor=handle.actor
 assert.ok(handle.session instanceof AgentSession);assert.equal(actor.session,undefined)
 await mkdir(join(f.root,'work','next'))
 await handle.enqueue({id:'todo-cwd-proof',source:{kind:'control-fixture'},content:'PLAN_DIRECTORY_MARKER'});await handle.deliver('todo-cwd-proof');await handle.whenIdle()
 const saved=await f.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true}),receipts=saved.audit,results=saved.context.piMessages.filter(message=>message.role==='toolResult')
 assert.deepEqual(receipts.find(receipt=>receipt.domain==='planning'&&receipt.kind==='todos').payload.todos,[{content:'scoped plan',status:'in_progress'}])
 assert.equal(results.length,2);assert.ok(results.every(message=>!message.isError))
 assert.equal(await actor.ctx.get('workingDirectory').ensure(actor),join(f.root,'work','next'))
 assert.ok(receipts.some(receipt=>receipt.domain==='directory'&&receipt.kind==='changed'&&receipt.payload.cwd===join(f.root,'work','next')))
 assert.equal(saved.header.cwd,join(f.root,'work'));assert.equal(officialWorkingDirectoryOrigin(actor),join(f.root,'work'))
 assert.throws(()=>officialWorkingDirectoryOrigin({...actor}),'a same-id copy is not directory ownership')
 assert.equal(f.host.ctx.piAuthority.describe(actor.id).engine,'pi-session-manager');assert.equal(f.requests.length,2)
 await handle.dispose()
 const resumed=await f.host.ctx.agents.resume({resumeSessionId:actor.id,authorizeInput:packet=>packet.source.kind==='control-fixture'});f.handles.push(resumed)
 assert.equal(resumed.actor.ctx.get('workingDirectory').get(resumed.actor),join(f.root,'work','next'));assert.equal(officialWorkingDirectoryOrigin(resumed.actor),join(f.root,'work'))
 assert.deepEqual((await resumed.actor.receipts.read()).find(receipt=>receipt.domain==='planning'&&receipt.kind==='todos').payload.todos,[{content:'scoped plan',status:'in_progress'}]);assert.equal(f.requests.length,2,'cold restore never runs the model or repeats either tool')
})
