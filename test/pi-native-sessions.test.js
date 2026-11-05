import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {Session,appendPluginRecord} from '../src/native-session-protocol.js'
import NativeSessions from '../src/native-sessions.js'
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}}
function fixture(t,Impl=NativeSessions){const ctx=new Context();ctx.logger={warn(){}};new Impl(ctx);t.after(()=>ctx.fiber.dispose());return ctx}
async function contract(t,Impl){const append=appendPluginRecord;const ctx=fixture(t,Impl),events=[];ctx.on('session/created',s=>events.push(['created',s.id]));ctx.on('session/event',(s,e)=>events.push(['event',s.id,e.type,e.seq]));ctx.on('session/disposed',s=>events.push(['disposed',s.id]));ctx.on('session/flush',()=>{});const s=ctx.sessions.prepare('one',{meta:{createdAt:1}}),detach=ctx.sessions.enter(s);ctx.sessions.announce(s);append(s,'plugin:test/count',{value:1});assert.equal(await ctx.sessions.flush(s),true);assert.equal(ctx.sessions.get(s.id),s);detach();detach();assert.equal(ctx.sessions.get(s.id),undefined);append(s,'plugin:test/count',{value:2});return{events,records:s.snapshotEvents().map(({time,...e})=>e),header:s.header}}
test('application session publication orders durable records, flush and detach notifications',async t=>{
 const result=await contract(t,NativeSessions)
 assert.deepEqual(result.events,[['created','one'],['event','one','plugin:test/count',0],['disposed','one']])
 assert.deepEqual(result.records.map(e=>({seq:e.seq,type:e.type,data:e.data})),[{seq:0,type:'plugin:test/count',data:{value:1}},{seq:1,type:'plugin:test/count',data:{value:2}}])
 assert.equal(result.header.id,'one');assert.equal(result.header.createdAt,1)
})
test('native session detach during append waits until every accepted event observer runs',async t=>{const ctx=fixture(t),s=ctx.sessions.prepare('one'),seen=[],detach=ctx.sessions.enter(s);ctx.on('session/event',()=>{seen.push('first');detach();assert.equal(ctx.sessions.get(s.id),s);assert.throws(()=>appendPluginRecord(s,'plugin:test/reentrant',{}),/cannot reenter/)});ctx.on('session/event',()=>seen.push('second'));ctx.on('session/disposed',()=>seen.push('disposed'));ctx.sessions.announce(s);appendPluginRecord(s,'plugin:test/first',{});assert.deepEqual(seen,['first','second','disposed']);assert.equal(s.seq,1);assert.equal(Object.hasOwn(s,'publicationEntry'),false)})
test('native session flush awaits all listeners before returning its first registered failure',async t=>{const ctx=fixture(t),s=ctx.sessions.create('one'),gate=deferred(),failure=Error('write uncertain');let completed=false;ctx.on('session/flush',()=>{throw failure});ctx.on('session/flush',async()=>{await gate.promise;completed=true});let settled=false;const flush=ctx.sessions.flush(s).catch(error=>{settled=true;throw error});await Promise.resolve();assert.equal(settled,false);gate.resolve();await assert.rejects(flush,error=>error===failure);assert.equal(completed,true);await assert.rejects(ctx.sessions.flush(Session.create('one')),/not live/)})
test('native session stale preparations and cross-store attachments cannot replace a live owner',async t=>{const ctx=fixture(t),other=fixture(t),a=ctx.sessions.prepare('one'),stale=ctx.sessions.prepare('one'),detach=ctx.sessions.enter(a);assert.throws(()=>ctx.sessions.enter(stale),/already exists/);assert.throws(()=>other.sessions.enter(a),/already attached/);detach();const moved=other.sessions.enter(a);assert.equal(other.sessions.get('one'),a);moved();assert.equal(Object.hasOwn(a,'publicationEntry'),false)})
test('external Session facades and prototype impersonations cannot acquire application publication',async t=>{
 const ctx=fixture(t),session=ctx.sessions.prepare('one')
 for(const foreign of [{id:'one',publicationEntry(){throw Error('must not be called')}},Object.create(Session.prototype)])assert.throws(()=>ctx.sessions.enter(foreign),/Unsupported external Session facade/)
 assert.equal(ctx.sessions.get('one'),undefined);assert.equal(session.seq,0)
})
test('native session fork keeps exact prefix lineage and rejects stale source identities',async t=>{const ctx=fixture(t),s=ctx.sessions.create('parent',{meta:{createdAt:1}});appendPluginRecord(s,'plugin:test/first',{value:1});appendPluginRecord(s,'plugin:test/second',{value:2});const child=ctx.sessions.fork(s,0,'child');assert.equal(child.header.parentSession,'parent');assert.equal(child.header.isSeeded,true);assert.equal(child.inheritedEventCount,1);assert.equal(child.snapshotEvents()[0].data.value,1);assert.throws(()=>ctx.sessions.fork(Session.create('parent'),0,'fake'),e=>e.code==='SESSION_NOT_LIVE');assert.throws(()=>ctx.sessions.fork(s,99,'invalid'),e=>e.code==='INVALID_BOUNDARY')})
test('native session creation rollback restores its publication method after an observer throws',async t=>{const ctx=fixture(t),s=ctx.sessions.prepare('one');let detach=ctx.sessions.enter(s);ctx.on('session/created',()=>{throw Error('created failed')});assert.throws(()=>ctx.sessions.announce(s),/created failed/);detach();assert.equal(ctx.sessions.get('one'),undefined);assert.equal(Object.hasOwn(s,'publicationEntry'),false)})
test('sealed facade teardown cannot replace an accepted append and can safely reattach',async t=>{const ctx=fixture(t),s=ctx.sessions.prepare('sealed');let events=0;ctx.on('session/event',()=>events++);const detach=ctx.sessions.enter(s);Object.seal(s);appendPluginRecord(s,'plugin:test/first',{});detach();appendPluginRecord(s,'plugin:test/detached',{});assert.equal(events,1);const again=ctx.sessions.enter(s);appendPluginRecord(s,'plugin:test/reattached',{});assert.equal(events,2);again()})
test('public publicationEntry methods cannot redirect another session event or ownership',async t=>{
 const ctx=fixture(t),a=ctx.sessions.prepare('a'),b=ctx.sessions.prepare('b'),seen=[]
 ctx.on('session/event',(session,event)=>seen.push([session.id,event.data.value]))
 const releaseA=ctx.sessions.enter(a)
 Object.defineProperty(b,'publicationEntry',{value:()=>{throw Error('untrusted hook must not run')},configurable:true})
 const releaseB=ctx.sessions.enter(b);appendPluginRecord(b,'plugin:test/owned',{value:'b'});appendPluginRecord(a,'plugin:test/owned',{value:'a'})
 assert.deepEqual(seen,[['b','b'],['a','a']]);assert.equal(a.seq,1);assert.equal(b.seq,1);releaseA();releaseB()
})
