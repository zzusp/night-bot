import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {ControlError} from '../src/runtime/control-error.js'
import NativeLlm from '../src/native-llm.js'
import NativeAgents from '../src/native-agents.js'

test('application control failures detach and freeze diagnostic facts while retaining the original cause',()=>{
 const details={issues:[{path:['field'],message:'invalid'}]},cause=new Error('original cause'),error=new ControlError('control/rejected','Request refused',details,{cause})
 details.issues[0].message='changed'
 assert.equal(error.code,'control/rejected');assert.equal(error.message,'Request refused');assert.equal(error.cause,cause)
 assert.equal(error.details.issues[0].message,'invalid')
 assert.equal(Object.isFrozen(error.details.issues[0].path),true)
 assert.throws(()=>{error.code='spoofed'},TypeError)
 assert.throws(()=>{error.details.issues.push({})},TypeError)
 assert.equal(Object.hasOwn(error,'isDSHRemoteError'),false)
})

test('control diagnostics reject unsupported live values and invalid machine codes',()=>{
 for(const code of ['',undefined,42])assert.throws(()=>new ControlError(code,'message',{}),TypeError)
 assert.throws(()=>new ControlError('control/rejected','message',new Map()),TypeError)
 assert.throws(()=>new ControlError('control/rejected','message',{callback(){}}))
 const empty=new ControlError('control/rejected',undefined,undefined)
 assert.equal(empty.message,'');assert.equal(empty.details,undefined)
})

test('ordinary application management methods retain coded failures without a gateway binding',async t=>{
 const ctx=new Context();ctx.logger={warn(){}};new NativeLlm(ctx);t.after(()=>ctx.fiber.dispose())
 assert.deepEqual(ctx.llm.listProviders(),[])
 assert.equal(ctx.llm.typertRemote,undefined)
 await assert.rejects(ctx.llm.remoteDiscoverModels('missing',{provider:'fixture'}),error=>{
  assert.ok(error instanceof ControlError)
  assert.equal(error.code,'llm/model-discovery-rejected')
  assert.deepEqual(error.details,{settingsNs:'missing'})
  assert.equal(error.cause.code,'NO_DISCOVERY')
  return true
 })
})

test('agent ownership no longer registers legacy gateway type or context lookups',async t=>{
 const ctx=new Context();let lookups=0
 ctx.provide('typert',{lookups:{register(){lookups++}},contexts:{registerHost(){lookups++}}})
 new NativeAgents(ctx);t.after(()=>ctx.fiber.dispose());await ctx.fiber.await()
 assert.equal(lookups,0)
 assert.deepEqual(ctx.agents.list(),[])
})
