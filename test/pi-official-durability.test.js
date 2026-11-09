import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import {definition,officialToolsFixture} from './fixtures/pi-official-tools.js'
import {bindOfficialDurability} from '../src/runtime/pi-official-durability.js'

// Native store fsync/prefix/lease behavior has separate real-filesystem tests.
// This controlled port verifies the public SDK's awaited subscriber ordering.
test('official assistant append must pass the durability barrier before a tool effect starts',async t=>{
 let effects=0,hold=true
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await officialToolsFixture(t,({ctx})=>ctx.tools.register(definition('effect',async()=>{effects++;return{ok:true}})))
 const store={kind:'pi-native',manager:f.manager,async commit(){
  if(hold&&f.manager.getEntries().some(e=>e.type==='message'&&e.message.role==='assistant')){hold=false;entered.resolve();await release.promise}
 },async close(){}}
 const gate=bindOfficialDurability({session:f.session,store,tools:f.adapter})
 const run=f.run([{name:'effect',id:'one'}]);await entered.promise
 assert.equal(effects,0);assert.ok(f.manager.getEntries().some(e=>e.type==='message'&&e.message.role==='assistant'))
 release.resolve();await run;assert.equal(effects,1);await gate.close()
})
test('uncertain commit fences subsequent official requests and effects without rewriting history',async t=>{
 let effects=0,fail=false,commits=0
 const f=await officialToolsFixture(t,({ctx})=>ctx.tools.register(definition('effect',async()=>{effects++;return{ok:true}})))
 const uncertain=Object.assign(new Error('uncertain storage'),{code:'PI_SESSION_COMMIT_UNCERTAIN'})
 const store={kind:'pi-native',manager:f.manager,async commit(){commits++;if(fail)throw uncertain},async close(){throw Error('must not close as successful')}}
 const gate=bindOfficialDurability({session:f.session,store,tools:f.adapter})
 await f.run([]);const before=f.requests.length;fail=true
 await f.run([{name:'effect',id:'never'}]).catch(()=>{})
 assert.equal(gate.failure,uncertain);assert.equal(effects,0);assert.equal(f.requests.length,before)
 await f.run([{name:'effect',id:'still-never'}]).catch(()=>{})
 assert.equal(f.requests.length,before);assert.equal(effects,0);assert.ok(commits>0)
 await assert.rejects(gate.close(),error=>error===uncertain)
})
test('official close retains the body lease until cancellation and the real body have drained',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let storeClosed=false
 const f=await officialToolsFixture(t,({ctx})=>ctx.tools.register(definition('slow',async()=>{entered.resolve();await release.promise;return{drained:true}})))
 const store={kind:'pi-native',manager:f.manager,async commit(){},async close(){storeClosed=true}}
 const gate=bindOfficialDurability({session:f.session,store,tools:f.adapter})
 const running=f.run([{name:'slow',id:'slow'}]);await entered.promise
 const closing=gate.close();await delay(10);assert.equal(storeClosed,false)
 release.resolve();await running;await closing;assert.equal(storeClosed,true)
})
test('SDK-absorbed business request rejection retains its typed cause and is distinct from storage poison',async t=>{
 let denied=true
 const f=await officialToolsFixture(t,()=>{}),reason=Object.assign(new Error('current task input was revoked'),{code:'TASK_SESSION_STALE'})
 const store={kind:'pi-native',manager:f.manager,async commit(){},async close(){}}
 const gate=bindOfficialDurability({session:f.session,store,tools:f.adapter,beforeRequest(){if(denied)throw reason}})
 await f.run([]).catch(()=>{})
 assert.equal(f.requests.length,0);assert.equal(gate.requestFailure,reason);assert.equal(gate.failure,undefined)
 denied=false;await f.run([]);assert.equal(gate.requestFailure,undefined);assert.equal(f.requests.length,1)
 await gate.close()
})
