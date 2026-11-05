import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import NativeAgents from '../src/native-agents.js'
import {bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import {installOfficialProcessOwnership} from '../src/runtime/pi-process-ownership.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'

async function fixture(t,runtime){
 const f=await officialToolsFixture(t,()=>{});new NativeAgents(f.ctx)
 f.owner.piSession=f.session
 const unbind=bindWorkingDirectoryActor(f.owner,{initialDirectory:f.manager.getCwd(),isLive:()=>true,readDirectory:()=>null,appendChange(){},admitNotice(){}})
 const detach=f.ctx.agents.enter(f.owner,undefined);f.ctx.provide('subprocess',runtime)
 const port=installOfficialProcessOwnership(f.ctx)
 t.after(()=>{detach();unbind()})
 return {...f,port}
}
function range(){const exit=Promise.withResolvers();return {exit,handle:{done:exit.promise,waitForExit:()=>exit.promise,terminate(){}}}}
test('owned provider range drains only its trusted actor and waits for actual range exit',async t=>{
 const owned=range(),foreign=range();let selected=foreign.handle
 const runtime={spawn:()=>selected,spawnTerminal:async()=>{throw Error('unused')}}
 const f=await fixture(t,runtime)
 runtime.spawn({});selected=owned.handle
 f.ctx.agents.withInitiator(f.owner,()=>runtime.spawn({}))
 assert.equal(f.port.inspectOwner(f.owner).ranges,1)
 let ended=false;const draining=f.port.drainOwner(f.owner).then(()=>{ended=true})
 await delay(10);assert.equal(ended,false);owned.exit.resolve();await draining
 assert.equal(f.port.inspectOwner(f.owner).ranges,0)
 assert.throws(()=>f.ctx.agents.withInitiator(f.owner,()=>runtime.spawn({})),{code:'PI_PROCESS_OWNER_DRAINING'})
 f.port.resumeOwner(f.owner)
 let foreignDone=false;foreign.exit.promise.then(()=>{foreignDone=true});await Promise.resolve();assert.equal(foreignDone,false)
 f.port.close();foreign.exit.resolve()
})
test('provider uncertainty cannot be reported as successful process drain or release tracking',async t=>{
 const uncertain=new Error('provider range observation incomplete')
 const runtime={spawn:()=>({done:Promise.resolve(),waitForExit:()=>Promise.reject(uncertain),terminate(){}}),spawnTerminal:async()=>{throw Error('unused')}}
 const f=await fixture(t,runtime);f.ctx.agents.withInitiator(f.owner,()=>runtime.spawn({}));await delay(1)
 assert.equal(f.port.inspectOwner(f.owner).uncertain,true)
 await assert.rejects(f.port.drainOwner(f.owner),{code:'PI_PROCESS_DRAIN_UNPROVEN'})
 assert.equal(f.port.inspectOwner(f.owner).ranges,1)
 assert.throws(()=>f.port.close(),{code:'PI_PROCESS_DRAIN_UNPROVEN'})
})
test('pending terminal launch remains owned until provider termination finishes; foreign identity cannot launch',async t=>{
 const launched=Promise.withResolvers(),terminated=Promise.withResolvers()
 const runtime={spawn:()=>{throw Error('unused')},spawnTerminal:()=>launched.promise}
 const f=await fixture(t,runtime),launch=f.ctx.agents.withInitiator(f.owner,()=>runtime.spawnTerminal({}))
 assert.equal(f.port.inspectOwner(f.owner).launches,1)
 let drained=false;const draining=f.port.drainOwner(f.owner).then(()=>{drained=true})
 launched.resolve({terminate:()=>terminated.promise});await launch;await delay(10);assert.equal(drained,false)
 terminated.resolve();await draining
 assert.throws(()=>f.ctx.agents.withInitiator({...f.owner},()=>runtime.spawn({})),{code:'PI_PROCESS_ACTOR_UNBOUND'})
 f.port.close()
})
