import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '../src/native-scope.js'
import NativeAgents from '../src/native-agents.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}}
function fixture(t,Impl=NativeAgents){const ctx=new Context();ctx.logger={warn(){}};new Impl(ctx);t.after(()=>ctx.fiber.dispose());return ctx}
async function agent(t,ctx){const f=await officialToolsFixture(t,()=>{}),id=f.session.sessionId,a={id,metadata:Object.freeze({id}),piSession:f.session,status:'idle'},scope=createScope(ctx,a);a.ctx=scope.ctx;return{a,scope}}
async function registryContract(t,Impl){const ctx=fixture(t,Impl),{a,scope}=await agent(t,ctx),events=[];ctx.on('agent/created',({agent,source})=>events.push([agent.id,source]));ctx.on('agent/disposed',({agent})=>events.push([agent.id,'disposed']));const detach=ctx.agents.enter(a,undefined);assert.deepEqual(ctx.agents.roots(),[a]);await ctx.agents.announce(a,'startup');assert.throws(()=>ctx.agents.enter(a,undefined),/already registered/);const list=ctx.agents.list();list.length=0;assert.equal(ctx.agents.get(a.id),a);detach();detach();assert.deepEqual(ctx.agents.list(),[]);await scope.dispose();return events.map(([id,event])=>[id===a.id?'one':id,event])}
test('native agent registry preserves live publication and paired disposal contract',async t=>assert.deepEqual(await registryContract(t,NativeAgents),[['one','startup'],['one','disposed']]))

test('native agent detach during serial creation waits for listener settlement',async t=>{const ctx=fixture(t),{a,scope}=await agent(t,ctx),entered=deferred(),release=deferred();let disposed=0;const detach=ctx.agents.enter(a,undefined);ctx.on('agent/created',async()=>{entered.resolve();await release.promise});ctx.on('agent/disposed',()=>disposed++);const pending=ctx.agents.announce(a,'startup');await entered.promise;detach();assert.equal(ctx.agents.get(a.id),a);assert.equal(disposed,0);release.resolve();await pending;assert.equal(disposed,1);assert.equal(ctx.agents.get(a.id),undefined);await scope.dispose()})
test('native agent registration failure rolls back its live entry and retains paired disposal',async t=>{const ctx=fixture(t),{a,scope}=await agent(t,ctx);let disposed=0;ctx.on('agent/created',()=>{throw Error('setup failed')});ctx.on('agent/disposed',()=>disposed++);await assert.rejects(async()=>await ctx.agents.register(a),/setup failed/);assert.equal(ctx.agents.get(a.id),undefined);assert.equal(disposed,1);await scope.dispose()})
test('native agent runtime ownership uses exact parent identity rather than durable lineage',async t=>{const ctx=fixture(t),{a,scope}=await agent(t,ctx),parent={id:'parent'},other={id:'parent'},detach=ctx.agents.enter(a,parent);assert.equal(ctx.agents.isOwnedBy(a.id,parent),true);assert.equal(ctx.agents.isOwnedBy(a.id,other),false);assert.deepEqual(ctx.agents.roots(),[]);detach();await scope.dispose()})
test('native initiator boundaries preserve Promise identity and explicit attribution clearing',async t=>{const ctx=fixture(t),a={id:'a'},done=deferred(),registry=ctx.agents;let inherited,cleared;const promise=registry.withInitiator(a,()=>{inherited=registry.requireInitiator();cleared=registry.withoutInitiator(()=>registry.currentInitiator());return done.promise});assert.equal(promise,done.promise);assert.equal(inherited,a);assert.equal(cleared,undefined);assert.equal(registry.currentInitiator(),undefined);let disposed=false;const disposal=registry.disposeInitiators().then(()=>disposed=true);await Promise.resolve();assert.equal(disposed,false);assert.throws(()=>registry.withInitiator(a,()=>{}),/disposed/);done.resolve();await disposal;assert.throws(()=>registry.currentInitiator(),/disposed/)})
test('native initiator disposal excludes its reentrant returned-Promise chain',async t=>{const ctx=fixture(t),registry=ctx.agents;await registry.withInitiator({id:'a'},async()=>{await registry.withoutInitiator(async()=>registry.disposeInitiators())});assert.throws(()=>registry.currentInitiator(),/disposed/)})
test('native agent factory registration is single-owner and disposal clears it',async t=>{const ctx=fixture(t),calls=[],factory={createAgent(owner,options){calls.push(['create',owner,options]);return'created'},resume(owner,options){calls.push(['resume',owner,options]);return'resumed'}},dispose=ctx.agents.setFactory(factory);assert.equal(await ctx.agents.create({id:'a'}),'created');assert.equal(await ctx.agents.resume({id:'a'}),'resumed');assert.deepEqual(calls.map(c=>c[0]),['create','resume']);assert.throws(()=>ctx.agents.setFactory(factory),/already registered/);await dispose();await assert.rejects(ctx.agents.create({id:'b'}),/no agent factory/)})
test('native agent entry teardown retains original identity even if a caller mutates its object',async t=>{const ctx=fixture(t),{a,scope}=await agent(t,ctx),detach=ctx.agents.enter(a,undefined),original=a.id;a.id='changed';detach();assert.equal(ctx.agents.get(original),undefined);await scope.dispose()})
test('native event subject cannot be spoofed and unrelated scopes receive no notifications',async t=>{const {agentEvents,assembleContextFor}=await import('../src/native-agent-context.js'),ctx=fixture(t),a=await agent(t,ctx),b=await agent(t,ctx),seen=[];let foreign=0;a.scope.ctx.on('agent/status',payload=>seen.push(payload.agent));b.scope.ctx.on('agent/status',()=>{foreign++});agentEvents(ctx,a.a).emit('agent/status',{agent:b.a,status:'idle'});assert.deepEqual(seen,[a.a]);assert.equal(foreign,0);assert.deepEqual(assembleContextFor(a.a),{agent:a.a,scope:a.a});await a.scope.dispose();await b.scope.dispose()})


test('publication requires the actual official SDK session, matching metadata and no Session facade',async t=>{
 const ctx=fixture(t),{a,scope}=await agent(t,ctx)
 let legacyReads=0
 const hybrid={...a};Object.defineProperty(hybrid,'session',{get(){legacyReads++;throw Error('legacy accessor must not execute')}})
 for(const invalid of [null,{}, {id:'legacy',metadata:{id:'legacy'},session:{id:'legacy'}}, {...a,piSession:{sessionId:a.id}}, {...a,id:'different'}, {...a,metadata:{id:'different'}}, {...a,metadata:undefined}, hybrid]){
  assert.throws(()=>ctx.agents.enter(invalid,undefined),/identity/)
  assert.deepEqual(ctx.agents.list(),[])
 }
 assert.equal(legacyReads,0)
 const detach=ctx.agents.enter(a,undefined)
 assert.equal(ctx.agents.get(a.id),a)
 assert.throws(()=>ctx.agents.enter(a,undefined),/already registered/)
 detach();await scope.dispose()
})
