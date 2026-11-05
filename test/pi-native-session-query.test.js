import test from 'node:test'
import assert from 'node:assert/strict'
import {Context,symbols} from '@deepseek-ai/cordis'
import {z} from 'zod'
import {buildSessionProjection} from '@earendil-works/pi-coding-agent'
import {createUserMessage} from '../src/native-message-protocol.js'
import NativeSessions from '../src/native-sessions.js'
import NativeProjections from '../src/native-projections.js'
import NativeQuery from '../src/native-session-query.js'
function fixture(t,options={}){const ctx=new Context();new NativeSessions(ctx);new NativeProjections(ctx);if(options.persistence)ctx.provide('sessionPersistence',options.persistence);new NativeQuery(ctx,options.config);const query=ctx.sessionQuery[symbols.original]??ctx.sessionQuery;t.after(()=>ctx.fiber.dispose());return{ctx,query}}
test('native read-only leases capture a live audit cut and preserve independent retain/dispose ownership',async t=>{
 const h=fixture(t);await h.ctx.fiber.await();const session=h.ctx.sessions.create('query-live')
 const observation=await h.query.observeSession(session.id,{projectionMode:'none'}),cut=session.snapshotEvents()
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'after observation'}]}),{surfaceOp:'append'})
 assert.equal(observation.source,'live');assert.equal(observation.cursor,cut.length-1);assert.deepEqual(observation.events,cut)
 const retained=observation.retain();observation[Symbol.dispose]();assert.throws(()=>observation.retain(),/disposed/)
 assert.deepEqual(retained.events,cut);retained[Symbol.dispose]()
 await assert.rejects(h.query.observeSession('absent'),e=>e.code==='SESSION_QUERY_SESSION_NOT_FOUND')
 const aborted=new AbortController();aborted.abort(new Error('caller stopped'))
 await assert.rejects(h.query.observeSession(session.id,{signal:aborted.signal}),e=>e.code==='SESSION_QUERY_ABORTED')
 assert.equal(h.ctx.sessions.get(session.id),session)
})
test('native cold observation reuses only an exact source revision and releases bounded read handles',async t=>{
 const seed=fixture(t),header={...seed.ctx.sessions.create('template').header,id:'cold'},identity=Symbol('query-backend');let revision='one',reads=0,closed=0;const persistence={identity,async stat(){return{header,revision,eventCount:0}},async open(){reads++;return{header,inheritedEventCount:0,async read(){return{events:[],eventState:'detached'}},async close(){closed++}}}};const h=fixture(t,{persistence});await h.ctx.fiber.await();const a=await h.query.observeSession('cold'),b=await h.query.observeSession('cold');assert.equal(reads,1);assert.equal(closed,1);assert.equal(a.source,'prepared');a[Symbol.dispose]();b[Symbol.dispose]();revision='two';const c=await h.query.observeSession('cold');assert.equal(reads,2);assert.equal(closed,2);c[Symbol.dispose]();assert.equal(h.ctx.sessions.get('cold'),undefined)
})
test('native query owner close aborts and drains a borrowed cold read, closes its handle and rejects future work',async t=>{
 const seed=fixture(t),header={...seed.ctx.sessions.create('template').header,id:'cold'},entered=Promise.withResolvers(),release=Promise.withResolvers();let closed=0,observed;const h=fixture(t,{persistence:{identity:Symbol(),async stat(){return{header,revision:'one',eventCount:0}},async open(_id,_access,{signal}){observed=signal;return{header,inheritedEventCount:0,async read(){entered.resolve();await release.promise;signal.throwIfAborted();return{events:[]}},async close(){closed++}}}}});await h.ctx.fiber.await();const pending=h.query.observeSession('cold'),rejected=assert.rejects(pending,e=>e.code==='SESSION_QUERY_ABORTED'&&/CLOSED/.test(e.cause?.message));await entered.promise;let drained=false;const close=h.ctx.fiber.dispose().then(()=>{drained=true});await new Promise(r=>setImmediate(r));assert.equal(observed.aborted,true);assert.equal(drained,false);release.resolve();await rejected;await close;assert.equal(closed,1);await assert.rejects(h.query.observeSession('cold'),e=>e.code==='SESSION_QUERY_ABORTED'&&/CLOSED/.test(e.cause?.message))
})
test('cold observation closes a failed borrowed read and never acquires writer authority',async t=>{
 const accesses=[],header={id:'failure',version:4,createdAt:0,isSeeded:false};let closed=0
 const h=fixture(t,{persistence:{identity:Symbol(),async stat(){return{header,revision:'one'}},async open(_id,access){accesses.push(access);return{header,inheritedEventCount:0,async read(){throw new Error('fixture read failure')},async close(){closed++}}}}});await h.ctx.fiber.await()
 await assert.rejects(h.query.observeSession(header.id),error=>error.code==='SESSION_QUERY_PERSISTENCE_FAILED'&&/fixture read failure/.test(error.cause?.message))
 assert.deepEqual(accesses,['read']);assert.equal(closed,1)
})
test('native query disposed from its own backend completes without waiting on its own nested call',{timeout:1000},async t=>{
 const seed=fixture(t),header={...seed.ctx.sessions.create('template').header,id:'self-close'};let h,returned=false;h=fixture(t,{persistence:{identity:Symbol(),async stat(){await h.ctx.fiber.dispose();returned=true;return{header,revision:'one',eventCount:0}}}});await h.ctx.fiber.await();await assert.rejects(h.query.observeSession('self-close'),e=>e.code==='SESSION_QUERY_ABORTED');assert.equal(returned,true)
})

test('cold audit observations never prepare a Session, append lifecycle markers, or hydrate Session projection cells',async t=>{
 const seed=fixture(t),session=seed.ctx.sessions.create('audit-source')
 session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'private attachment scope'}]}),{surfaceOp:'append'})
 const header={...session.header,id:'cold-audit'},events=session.snapshotEvents(),persistence={identity:Symbol(),async list(){return[{header,eventCount:events.length}]},async stat(){return{header,revision:'cut-one'}},async open(_id,access){assert.equal(access,'read');return{header,inheritedEventCount:0,async read(){return{events,eventState:'detached'}},async close(){}}}}
 const h=fixture(t,{persistence});await h.ctx.fiber.await()
 h.ctx.sessions.prepare=()=>{throw Error('must not prepare a Session')}
 h.ctx.sessionProjections.hydrate=()=>{throw Error('must not hydrate Session cells')}
 h.ctx.sessionProjections.register({key:'event-count',stateVersion:1,stateSchema:z.number(),init:()=>0,apply:n=>n+1,wire:{viewSchema:z.number(),view:n=>n}})
 const observed=await h.query.observeSession(header.id)
 assert.deepEqual(observed.events,events)
 assert.equal(observed.cursor,events.length-1)
 assert.deepEqual(observed.projections,{asOfSeq:events.length-1,values:{'event-count':events.length}})
 assert.equal(observed.events.some(e=>e.type==='session/end-seed'),false)
 assert.equal(Object.isFrozen(observed.header),true)
 assert.equal(Object.isFrozen(observed.events[0].data.content),true)
 assert.equal(h.ctx.sessions.get(header.id),undefined)
 observed[Symbol.dispose]()
})
test('cold observation enforces audit envelope, header and lineage validation without changing borrowed evidence',async t=>{
 const header={id:'audit',version:4,createdAt:0,isSeeded:false},event={seq:0,time:0,type:'session/end-seed',data:{}}
 const cases=[...[[{...event,seq:1}],[{...event,extra:true}],[{...event,time:1.5}],[{...event,type:'user/message',data:{}}]].map(events=>({header,events,inherited:0})),
  ...[{...header,id:'other'},{...header,version:5},{...header,cwd:'relative'},{...header,isSeeded:true}].map(metadata=>({header:metadata,events:[event]})),
  {header,events:[event],inherited:1},{header:{...header,isSeeded:true},events:[event],inherited:2}]
 for(const evidence of cases){
  const original=structuredClone(evidence)
  const h=fixture(t,{persistence:{identity:Symbol(),async stat(){return{header:evidence.header,revision:'cut'}},async open(){return{header:evidence.header,inheritedEventCount:evidence.inherited,async read(){return{events:evidence.events}},async close(){}}}}});await h.ctx.fiber.await()
  await assert.rejects(h.query.observeSession('audit'),e=>['SESSION_QUERY_CORRUPT_SESSION','SESSION_QUERY_SOURCE_CONFLICT'].includes(e.code))
  assert.deepEqual(evidence,original);assert.equal(h.ctx.sessions.get('audit'),undefined)
 }
})
test('cold audit cache evicts released revisions while retained cuts remain independent',async t=>{
 const headerFor=id=>({id,version:4,createdAt:0,isSeeded:false}),reads=new Map();let revision='one'
 const persistence={identity:Symbol(),async stat(id){return{header:headerFor(id),revision}},async open(id){reads.set(id,(reads.get(id)??0)+1);return{header:headerFor(id),inheritedEventCount:0,async read(){return{events:[]}},async close(){}}}}
 const h=fixture(t,{persistence,config:{observationCacheSize:1}});await h.ctx.fiber.await()
 const a=await h.query.observeSession('a'),retained=a.retain(),b=await h.query.observeSession('b')
 a[Symbol.dispose]();b[Symbol.dispose]()
 assert.equal(h.query._observations.cache.size,1)
 assert.equal(retained.header.id,'a')
 revision='two'
 const replacement=await h.query.observeSession('a')
 assert.equal(replacement.revision,'two');assert.equal(retained.revision,'one')
 assert.equal(reads.get('a'),2)
 retained[Symbol.dispose]();replacement[Symbol.dispose]()
 assert.equal(h.query._observations.cache.size,1)
 await h.ctx.fiber.dispose()
 assert.equal(h.query._observations.cache.size,0)
})
test('cold observation preserves image audit decisions and private attachment references without projecting model history',async t=>{
 const header={id:'cold-image',version:4,createdAt:0,isSeeded:false},message=createUserMessage({source:{kind:'user'},content:[{type:'image',attachment:{id:'private-image',mediaType:'image/png',width:1,height:1}},{type:'image',attachment:{id:'other-image',mediaType:'image/png',width:1,height:1}}]})
 const events=[{seq:0,time:0,type:'user/message',data:message,surfaceOp:'append'},{seq:1,time:0,type:'image/offload',data:{targets:[{seq:0,imageIndexes:[0]}]}}]
 const original=structuredClone(events),h=fixture(t,{persistence:{identity:Symbol(),async list(){return[{header,eventCount:events.length}]},async stat(){return{header,revision:'images'}},async open(){return{header,inheritedEventCount:0,async read(){return{events}},async close(){}}}}});await h.ctx.fiber.await()
 const observation=await h.query.observeSession(header.id)
 assert.equal(observation.events[0].data.content[0].offloaded,undefined)
 assert.equal(observation.events[0].data.content[0].attachment.id,'private-image')
 assert.deepEqual(observation.events[1].data.targets,[{seq:0,imageIndexes:[0]}])
 assert.deepEqual(observation.events,original);assert.deepEqual(events,original)
 assert.equal(h.ctx.sessions.get(header.id),undefined)
 observation[Symbol.dispose]()
})
test('cold observation rejects identity metadata changing between stat and the actual read',async t=>{
 const header={id:'unstable',version:4,createdAt:0,isSeeded:false};let closed=0
 const h=fixture(t,{persistence:{identity:Symbol(),async stat(){return{header,revision:'cut'}},async open(){return{header:{...header,createdAt:1},inheritedEventCount:0,async read(){return{events:[]}},async close(){closed++}}}}});await h.ctx.fiber.await()
 await assert.rejects(h.query.observeSession(header.id),e=>e.code==='SESSION_QUERY_SOURCE_CONFLICT')
 assert.equal(closed,1);assert.equal(h.ctx.sessions.get(header.id),undefined);assert.equal(h.query._observations.cache.size,0)
})
test('cold observation context is requested with its read and frozen independently across retained revisions',async t=>{
 const header={id:'context-cut',version:4,createdAt:0,isSeeded:false};let revision='one',reads=0
 const event={seq:0,time:0,type:'user/message',data:createUserMessage({source:{kind:'user'},content:[{type:'text',text:'PI_COMMITTED_ONLY'}]}),surfaceOp:'append'}
 const entry={type:'message',id:'context-source',parentId:null,timestamp:new Date(0).toISOString(),message:{role:'user',content:[{type:'text',text:'PI_COMMITTED_ONLY'}],timestamp:0,night:{event}}}
 const projection=buildSessionProjection([entry],entry.id)
 const context={engine:'pi-session-manager',eventCount:1,projection,piMessages:projection.messages}
 const persistence={identity:Symbol(),async stat(){return{header,revision}},async open(_id,access){assert.equal(access,'read');return{header,inheritedEventCount:0,async read(_offset,_length,options){assert.equal(options.includeContext,true);reads++;return{events:[event],context}},async close(){}}}}
 const h=fixture(t,{persistence});await h.ctx.fiber.await()
 const a=await h.query.observeSession(header.id),retained=a.retain(),b=await h.query.observeSession(header.id)
 assert.equal(reads,1);assert.deepEqual(a.context,context);assert.equal(a.context,b.context);assert.equal(a.context,retained.context)
 assert.equal(Object.isFrozen(a.context.projection.messages[0].content),true)
 context.projection.messages[0].content[0].text='NEXT_COMMIT';revision='two'
 const c=await h.query.observeSession(header.id)
 assert.equal(c.context.piMessages[0].content[0].text,'NEXT_COMMIT')
 assert.equal(retained.context.projection.messages[0].content[0].text,'PI_COMMITTED_ONLY')
 assert.equal(reads,2)
 for(const lease of [a,b,c,retained])lease[Symbol.dispose]()
 const live=h.ctx.sessions.create('live-audit-only'),observation=await h.query.observeSession(live.id)
 assert.equal(Object.hasOwn(observation,'context'),false);observation[Symbol.dispose]()
})

test('observation rejects a conflicting live attachment racing a persisted stat',async t=>{
 const header={id:'racing-source',version:4,createdAt:0,isSeeded:false};let h,opened=0
 const persistence={identity:Symbol(),async stat(){h.ctx.sessions.create(header.id,{meta:{...header,createdAt:1}});return{header,revision:'cut'}},async open(){opened++;throw Error('not reached')}}
 h=fixture(t,{persistence});await h.ctx.fiber.await()
 await assert.rejects(h.query.observeSession(header.id),e=>e.code==='SESSION_QUERY_SOURCE_CONFLICT')
 assert.equal(opened,0)
})
test('cache reuse still validates immutable header identity even if a backend repeats its revision',async t=>{
 const header={id:'cache-header',version:4,createdAt:0,isSeeded:false};let current=header,reads=0
 const h=fixture(t,{persistence:{identity:Symbol(),async stat(){return{header:current,revision:'same'}},async open(){reads++;return{header,inheritedEventCount:0,async read(){return{events:[]}},async close(){}}}}});await h.ctx.fiber.await()
 const retained=await h.query.observeSession(header.id)
 current={...header,createdAt:1}
 await assert.rejects(h.query.observeSession(header.id),e=>e.code==='SESSION_QUERY_SOURCE_CONFLICT')
 assert.equal(reads,1);assert.deepEqual(retained.header,header);retained[Symbol.dispose]()
})
