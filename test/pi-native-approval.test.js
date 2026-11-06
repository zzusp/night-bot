import test from 'node:test'
import assert from 'node:assert/strict'
import {createScope} from '../src/native-scope.js'
import NativeApproval from '../src/native-approval.js'
import {nativeBusinessPolicyFixture} from './fixtures/native-business-policy.js'
const gate=()=>Promise.withResolvers()
async function fixture(t,{policy='ask',flush,scopeOwner=false}={}){
 const h=await nativeBusinessPolicyFixture(t),owner=scopeOwner?createScope(h.ctx,{}):undefined,service=new NativeApproval(owner?.ctx??h.ctx,{policy}),a=await h.actor('approval-fixture');if(owner)h.ctx.effect(()=>()=>owner.dispose())
 if(flush)a.store.commit=async()=>{await flush(a.store);return a.originalCommit()}
 return {...h,...a,agent:a.actor,service,owner,open(){a.control.turnOpen=true},req(signal){return{agent:a.actor,toolName:'fixture',callId:'fixture-call',reason:'fixture reason',signal}}}
}
const facts=async h=>(await h.facts()).map(({domain,kind,payload})=>({domain,kind,payload:{...payload,...payload.id?{id:'approval-id'}:{}}}))
test('native approval retains borrowed identity, visible policy text and durable paired outcomes without invented messages',async t=>{
 const h=await fixture(t);h.open();const req=h.req(new AbortController().signal);let borrowed;h.ctx.on('approval/request',request=>{borrowed=request;return'allowed-once'})
 assert.equal(await h.service.request(req),'allowed-once');await h.service.setPolicy(h.agent,'never');assert.equal(await h.service.request(req),'rejected');assert.equal(borrowed,req);assert.equal(h.service.policyForActor(h.agent),'never');assert.match(h.service.officialText({actor:h.agent}),/Approval prompts are disabled/)
 assert.deepEqual(await facts(h),[{domain:'approval',kind:'asked',payload:{id:'approval-id',toolName:'fixture',callId:'fixture-call',reason:'fixture reason'}},{domain:'approval',kind:'decided',payload:{id:'approval-id',outcome:'allowed-once'}},{domain:'approval',kind:'policy',payload:{policy:'never'}},{domain:'approval',kind:'asked',payload:{id:'approval-id',toolName:'fixture',callId:'fixture-call',reason:'fixture reason'}},{domain:'approval',kind:'decided',payload:{id:'approval-id',outcome:'rejected'}}])
 assert.deepEqual(h.store.manager.buildSessionProjection().messages,[])
})
test('approval outside an open turn, stale actor or foreign audit cannot append or grant',async t=>{
 const h=await fixture(t);await assert.rejects(h.service.request(h.req()),/open turn/);assert.deepEqual(await h.facts(),[]);h.open();h.control.live=false;await assert.rejects(h.service.request(h.req()),/not live/);h.control.live=true
 await assert.rejects(h.service.request({...h.req(),agent:{...h.agent,session:{id:h.agent.id}}}),/bound business audit/);await assert.rejects(h.service.request({...h.req(),businessAudit:{...h.audit}}),/Foreign/);assert.throws(()=>h.service.setPolicy(h.agent,'always'),/policy/);assert.deepEqual(await h.facts(),[])
})
test('missing, throwing and rogue answerers fail closed while never and cancelled requests do not prompt',async t=>{
 for(const mode of ['missing','throwing','rogue','never','cancelled']){const h=await fixture(t,{policy:mode==='never'?'never':'ask'});h.open();let prompts=0;if(mode!=='missing')h.ctx.on('approval/request',()=>{prompts++;if(mode==='throwing')throw Error('fixture answer failure');return mode==='rogue'?'allow-forever':'allowed-once'});const controller=new AbortController();if(mode==='cancelled')controller.abort();assert.equal(await h.service.request(h.req(controller.signal)),mode==='never'?'rejected':mode==='cancelled'?'cancelled':'unavailable');if(['never','cancelled'].includes(mode))assert.equal(prompts,0);assert.equal((await h.facts()).filter(e=>e.kind==='decided').length,1)}
})
test('asked must commit before answerer and decided must commit before returning grant',async t=>{
 const asked=gate(),releaseAsked=gate(),decided=gate(),releaseDecided=gate();let writes=0,prompts=0;const h=await fixture(t,{flush:async()=>{if(++writes===1){asked.resolve();await releaseAsked.promise}else{decided.resolve();await releaseDecided.promise}}});h.open();h.ctx.on('approval/request',()=>{prompts++;return'allowed-once'})
 const pending=h.service.request(h.req());await asked.promise;assert.equal(prompts,0);releaseAsked.resolve();await decided.promise;let ended=false;void pending.then(()=>ended=true);await Promise.resolve();assert.equal(ended,false);releaseDecided.resolve();assert.equal(await pending,'allowed-once')
 const saved=await h.backend.readNative(h.agent.id,{requireComplete:true});assert.deepEqual(saved.audit.map(e=>e.kind),['asked','decided'])
})
test('native audit append and journal commit failures never become unlogged grants',async t=>{
 for(const failing of [1,2]){let appends=0,prompts=0;const h=await fixture(t);h.open();h.store.appendAudit=receipt=>{if(++appends===failing)throw Error('fixture append failure');return h.originalAppend(receipt)};h.ctx.on('approval/request',()=>{prompts++;return'allowed-once'});await assert.rejects(h.service.request(h.req()),/append failure/);assert.equal(prompts,failing===1?0:1)}
 for(const failing of [1,2]){let writes=0,prompts=0;const h=await fixture(t,{flush:async()=>{if(++writes===failing)throw Error('fixture journal failure')}});h.open();h.ctx.on('approval/request',()=>{prompts++;return'allowed-once'});await assert.rejects(h.service.request(h.req()),/journal failure/);assert.equal(prompts,failing===1?0:1)}
})
test('policy revoked while answerer waits cannot grant from late allowed answer',async t=>{
 const entered=gate(),release=gate(),h=await fixture(t);h.open();h.ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'});const pending=h.service.request(h.req());await entered.promise;await h.service.setPolicy(h.agent,'never');release.resolve();assert.equal(await pending,'rejected');assert.equal((await h.facts()).at(-1).payload.outcome,'rejected')
})
test('service-only owner disposal seals late answers and commits canceled pair through surviving native writer',async t=>{
 const entered=gate(),release=gate(),h=await fixture(t,{scopeOwner:true});h.open();h.ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'});const pending=h.service.request(h.req());await entered.promise;await h.owner.dispose();assert.equal(await pending,'cancelled');release.resolve();assert.equal((await h.facts()).at(-1).payload.outcome,'cancelled');await assert.rejects(h.service.request(h.req()),/disposed/)
})
test('answerer may close approval service without waiting on its own request',async t=>{
 const h=await fixture(t);h.open();h.ctx.on('approval/request',async()=>{await h.service.close();return'allowed-once'});assert.equal(await h.service.request(h.req()),'cancelled');assert.equal((await h.facts()).at(-1).payload.outcome,'cancelled')
})
test('already admitted decision drains durable commit while service close refuses new requests',async t=>{
 const entered=gate(),release=gate();let writes=0;const h=await fixture(t,{flush:async()=>{if(++writes===2){entered.resolve();await release.promise}}});h.open();h.ctx.on('approval/request',()=> 'allowed-once');const pending=h.service.request(h.req());await entered.promise;const closing=h.service.close();await assert.rejects(h.service.request(h.req()),/disposed/);release.resolve();assert.equal(await pending,'allowed-once');await closing
})
test('approval answer dispatch keeps exact actor scope and excludes unrelated answerers',async t=>{
 const h=await fixture(t),a=createScope(h.ctx,h.agent),b=createScope(h.ctx,{});h.agent.ctx=a.ctx;h.ctx.effect(()=>async()=>{await a.dispose();await b.dispose()});h.open();let actual=0,unrelated=0;a.ctx.on('approval/request',()=>{actual++;return'allowed-once'});b.ctx.on('approval/request',()=>{unrelated++;return'allowed-once'});const signal=new AbortController().signal,req=h.req(signal);assert.equal(await h.service.request(req),'allowed-once');assert.equal(req.signal,signal);assert.equal(req.agent,h.agent);assert.equal(actual,1);assert.equal(unrelated,0)
})
test('a turn closing during an approval seals one canceled native decision before any later turn',async t=>{
 const h=await fixture(t),entered=gate(),release=gate();h.open();h.ctx.on('approval/request',async()=>{entered.resolve();await release.promise;return'allowed-once'})
 const pending=h.service.request(h.req());await entered.promise;h.control.turnOpen=false;release.resolve();assert.equal(await pending,'cancelled');h.control.turnOpen=true
 const saved=await h.backend.readNative(h.agent.id,{requireComplete:true});assert.deepEqual(saved.audit.map(row=>[row.kind,row.payload.outcome??null]),[['asked',null],['decided','cancelled']]);assert.deepEqual(h.store.manager.buildSessionProjection().messages,[])
})
