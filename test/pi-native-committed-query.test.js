import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {Context} from '@deepseek-ai/cordis'
import {buildSessionProjection,SessionManager} from '@earendil-works/pi-coding-agent'
import NativeSessions from '../src/native-sessions.js'
import NativeQuery from '../src/native-session-query.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {createUserMessage,createDeveloperMessage,createSystemMessage} from '../src/native-message-protocol.js'
import {decodePiJournal,piJournalFilename} from '../src/runtime/pi-journal.js'

const user = text => createUserMessage({source:{kind:'user'},content:[{type:'text',text}]})
async function fixture(t){
 const root=await mkdtemp('/tmp/night-committed-query-'),ctx=new Context()
 t.after(async()=>{try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 new NativeSessions(ctx);authority(ctx);const backend=new PiPersistence(ctx,{root});new NativeQuery(ctx);await ctx.fiber.await()
 const header={id:'pi-current',version:4,createdAt:0,isSeeded:false,parentSession:'lineage-parent'},writer=await backend.create(header)
 const events=[{seq:0,time:0,type:'user/message',data:user('REMOVED_CONTEXT'),surfaceOp:'append'},
  {seq:1,time:1,type:'user/message',data:user('RETAINED_CONTEXT'),surfaceOp:'append'}]
 await writer.append(events)
 return{ctx,backend,root,header,writer,events,query:ctx.sessionQuery,path:join(root,piJournalFilename(header.id))}
}

test('native readSurface returns the official provenance-preserving projection without Night message reconstruction',async t=>{
 const f=await fixture(t),replacement={seq:2,time:2,type:'developer/message',data:{turn:1,step:1,message:createDeveloperMessage({source:{kind:'retirement'},content:[{type:'text',text:'REPLACEMENT_CONTEXT'}]})},surfaceOp:{op:'replace',startSeq:0,endSeq:0},sourceEventSeqs:[0]}
 await f.writer.append([replacement]);await f.writer.close()
 const bytes=await readFile(f.path),decoded=decodePiJournal(bytes,f.header.id,{requireComplete:true}),official=buildSessionProjection(decoded.entries,decoded.entries.at(-1).id)
 const page=await f.query.readContextProjection(f.header.id)
 assert.equal(page.authority,'pi-session-manager');assert.equal(page.session.parentSession,'lineage-parent')
 assert.deepEqual(page.entries,official.entries);assert.deepEqual(page.messages,official.messages)
 const contributors=page.entries.filter(entry=>entry.messages.length)
 assert.deepEqual(contributors.map(entry=>(entry.sourceEntry.type==='custom_message'?entry.sourceEntry.details:entry.sourceEntry.message.night).event.seq),[2,1])
 assert.deepEqual(contributors[0].sourceEntry.details.event.sourceEventSeqs,[0])
 assert.equal(JSON.stringify(page.messages).includes('REMOVED_CONTEXT'),false)
 assert.deepEqual(await f.query.readSurface(f.header.id),page)
 assert.equal(f.ctx.sessions.get(f.header.id),undefined);assert.equal(f.backend.writers.size,0)
 assert.deepEqual(await readFile(f.path),bytes)
})

test('persisted live and cold queries share one cut while uncommitted audit events remain separate',async t=>{
 const f=await fixture(t);await f.writer.close()
 const cold=await f.query.readSurface(f.header.id),live=f.ctx.sessions.create(f.header.id,{meta:f.header})
 live.append('user/message',user('UNCOMMITTED_LIVE_AUDIT'),{surfaceOp:'append'})
 const same=await f.query.readSurface(f.header.id)
 assert.deepEqual(same,cold)
 const observed=await f.query.observeSession(f.header.id)
 assert.equal(JSON.stringify(observed.events).includes('UNCOMMITTED_LIVE_AUDIT'),true);observed[Symbol.dispose]()
 assert.equal(JSON.stringify(same).includes('UNCOMMITTED_LIVE_AUDIT'),false)
 const fresh=f.ctx.sessions.create('no-committed-journal')
 fresh.append('user/message',user('AUDIT_ONLY'),{surfaceOp:'append'})
 await assert.rejects(f.query.readSurface(fresh.id),e=>e.code==='SESSION_QUERY_SESSION_NOT_FOUND')
})

test('official projection transport pages are bounded and bound to their committed snapshot',async t=>{
 const f=await fixture(t);await f.writer.close()
 const first=await f.query.readContextProjection(f.header.id,{limit:1})
 assert.equal(first.entries.length,1);assert.ok(first.nextCursor)
 const second=await f.query.readContextProjection(f.header.id,{limit:1,cursor:first.nextCursor})
 assert.equal(second.entries.length,1);assert.equal(second.revision,first.revision)
 assert.notEqual(first.entries[0].sourceEntry.id,second.entries[0].sourceEntry.id)
 for(const limit of [0,51,1.5])await assert.rejects(f.query.readSurface(f.header.id,{limit}),e=>e.code==='SESSION_QUERY_INVALID_WINDOW')
 await assert.rejects(f.query.readSurface(f.header.id,{cursor:'broken'}),e=>e.code==='SESSION_QUERY_INVALID_CURSOR')
 await assert.rejects(f.query.readContextProjection(f.header.id,{text:'search'}),e=>e.code==='SESSION_QUERY_SEARCH_UNAVAILABLE')
 const writer=await f.backend.open(f.header.id,'write');await writer.append([{seq:2,time:2,type:'user/message',data:user('NEW_COMMIT'),surfaceOp:'append'}]);await writer.close()
 await assert.rejects(f.query.readSurface(f.header.id,{cursor:first.nextCursor}),e=>e.code==='SESSION_QUERY_STALE_CURSOR')
})

test('native committed query ignores a physical uncommitted tail without repairing or indexing it',async t=>{
 const f=await fixture(t);await f.writer.close();const before=await readFile(f.path),tail=Buffer.from('{"uncommitted":')
 const expected=await f.query.readSurface(f.header.id)
 await writeFile(f.path,Buffer.concat([before,tail]))
 assert.deepEqual(await f.query.readSurface(f.header.id),expected)
 assert.deepEqual(await readFile(f.path),Buffer.concat([before,tail]))
 assert.throws(()=>decodePiJournal(Buffer.concat([before,tail]),f.header.id,{requireComplete:true}),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
})

test('committed projection query refuses a missing projection and never reads the temporary Host adapter',async t=>{
 const ctx=new Context();new NativeSessions(ctx);new NativeQuery(ctx);t.after(()=>ctx.fiber.dispose());await ctx.fiber.await()
 const header={id:'fake',version:4,createdAt:0,isSeeded:false},event={seq:0,time:0,type:'user/message',data:user('AUDIT_FAKE'),surfaceOp:'append'}
 let context,closed=0
 ctx.provide('sessionPersistence',{async open(_id,access){assert.equal(access,'read');return{header,inheritedEventCount:0,async read(_offset,_length,options){assert.equal(options.includeContext,true);return{events:[event],context}},async close(){closed++}}}})
 await assert.rejects(ctx.sessionQuery.readSurface(header.id),e=>e.code==='SESSION_QUERY_CONTEXT_REQUIRED')
 context={engine:'pi-session-manager',eventCount:1,piMessages:[]}
 await assert.rejects(ctx.sessionQuery.readSurface(header.id),e=>e.code==='SESSION_QUERY_CONTEXT_INVALID')
 const projection=buildSessionProjection([{type:'message',id:'official-source',parentId:null,timestamp:new Date(0).toISOString(),message:{role:'user',content:'PI_ONLY',timestamp:0}}])
 context={engine:'pi-session-manager',eventCount:1,projection,get hostMessages(){throw Error('Host adapter must not be read')}}
 const surface=await ctx.sessionQuery.readSurface(header.id)
 assert.deepEqual(surface.entries,projection.entries);assert.deepEqual(surface.messages,projection.messages)
 assert.equal(closed,3);assert.equal(ctx.sessions.get(header.id),undefined)
})

test('committed context query cancellation closes its sole read handle and owner disposal drains in-flight reads',async t=>{
 const ctx=new Context();new NativeSessions(ctx);const query=new NativeQuery(ctx);t.after(()=>ctx.fiber.dispose());await ctx.fiber.await()
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let closed=0,observed
 ctx.provide('sessionPersistence',{async open(_id,access){assert.equal(access,'read');return{header:{id:'blocked'},inheritedEventCount:0,async read(_offset,_length,{signal}){observed=signal;entered.resolve();await release.promise;signal.throwIfAborted()},async close(){closed++}}}})
 const pending=query.readSurface('blocked'),rejected=assert.rejects(pending,/NATIVE_SESSION_QUERY_CLOSED/)
 await entered.promise;let drained=false
 const disposing=ctx.fiber.dispose().then(()=>{drained=true})
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(observed.aborted,true);assert.equal(drained,false)
 release.resolve();await rejected;await disposing
 assert.equal(closed,1)
 await assert.rejects(query.readContextProjection('blocked'),/NATIVE_SESSION_QUERY_CLOSED/)
})

test('native committed query borrows the active writer read cut without flushing its pending queue',async t=>{
 const f=await fixture(t),before=await readFile(f.path)
 f.writer.enqueue({seq:2,time:2,type:'user/message',data:user('PENDING_HOST_EVENT'),surfaceOp:'append'})
 const page=await f.query.readSurface(f.header.id)
 assert.equal(page.eventCount,2);assert.equal(JSON.stringify(page).includes('PENDING_HOST_EVENT'),false)
 assert.equal(f.backend.writers.get(f.header.id),f.writer)
 assert.deepEqual(await readFile(f.path),before)
 await f.writer.flush()
 const committed=await f.query.readSurface(f.header.id)
 assert.equal(committed.eventCount,3);assert.ok(JSON.stringify(committed.messages).includes('PENDING_HOST_EVENT'))
 await f.writer.close()
})

test('external cancellation rejects a completed borrowed read before publishing any page',async t=>{
 const ctx=new Context();new NativeSessions(ctx);const query=new NativeQuery(ctx);t.after(()=>ctx.fiber.dispose());await ctx.fiber.await()
 const controller=new AbortController(),entered=Promise.withResolvers(),release=Promise.withResolvers();let closed=0
 ctx.provide('sessionPersistence',{async open(){return{header:{id:'caller-abort'},inheritedEventCount:0,async read(){entered.resolve();await release.promise;return{events:[],context:{engine:'pi-session-manager',eventCount:0,projection:buildSessionProjection([]),piMessages:[]}}},async close(){closed++}}}})
 const pending=query.readContextProjection('caller-abort',{signal:controller.signal}),rejected=assert.rejects(pending,/CALLER_STOP/)
 await entered.promise;controller.abort(new Error('CALLER_STOP'));release.resolve();await rejected
 assert.equal(closed,1);assert.equal(query.activeQueries.size,0)
})

test('native query options reject arrays and primitive values before persistence I/O',async t=>{
 const ctx=new Context();new NativeSessions(ctx);const query=new NativeQuery(ctx);t.after(()=>ctx.fiber.dispose());await ctx.fiber.await();let opens=0
 ctx.provide('sessionPersistence',{async open(){opens++;throw Error('unexpected read')}})
 for(const method of ['readSurface','readContextProjection'])for(const options of [null,[],[1],'text',1,true,Symbol('invalid'),()=>{},new Date()])
  await assert.rejects(query[method]('session',options),/query options must be a plain object/)
 assert.equal(opens,0)
})


test('official compaction, branch summaries and context edits retain their native types and sourceEntry relationships',async t=>{
 const f=await fixture(t);await f.writer.close()
 const before=await readFile(f.path),decoded=decodePiJournal(before,f.header.id,{requireComplete:true}),manager=SessionManager.inMemory(f.root)
 manager.setSessionFile(f.path)
 const kept=decoded.entries.find(entry=>entry.type==='message'&&entry.message.night.event.seq===1)
 const checkpointEvent={seq:2,time:2,type:'system/message',data:{turn:1,step:1,message:createSystemMessage('OFFICIAL_CHECKPOINT')},surfaceOp:'append'}
 manager.appendMessage({role:'system',content:'OFFICIAL_CHECKPOINT',timestamp:2,night:{event:checkpointEvent}})
 manager.appendCompaction('OFFICIAL_COMPACTION',kept.id,100)
 manager.appendContextEdit(kept.id,{content:[{type:'text',text:'OFFICIAL_EDIT'}]})
 manager.branchWithSummary(manager.getLeafId(),'OFFICIAL_BRANCH')
 const batch=manager.getEntries().slice(decoded.entries.length)
 manager.appendCustomEntry('night.commit',{eventCount:f.events.length+1,previousCommit:decoded.entries.at(-1).id,entriesHash:createHash('sha256').update(batch.map(entry=>JSON.stringify(entry)).join('\n')).digest('hex')})
 // Materialize the official entries explicitly: this user-only fixture has not
 // triggered SessionManager's first-assistant disk flush policy.
 await writeFile(f.path,Buffer.concat([before,Buffer.from(manager.getEntries().slice(decoded.entries.length).map(entry=>JSON.stringify(entry)).join('\n')+'\n')]))
 const bytes=await readFile(f.path),committed=decodePiJournal(bytes,f.header.id,{requireComplete:true}),official=buildSessionProjection(committed.entries,committed.entries.at(-1).id)
 const page=await f.query.readSurface(f.header.id)
 assert.deepEqual(page.entries,official.entries);assert.deepEqual(page.messages,official.messages)
 assert.ok(page.messages.some(message=>message.role==='compactionSummary'))
 assert.ok(page.entries.some(entry=>entry.sourceEntry.type==='compaction'&&entry.messages.length===2))
 assert.ok(page.messages.some(message=>message.role==='system'&&message.content==='OFFICIAL_CHECKPOINT'))
 assert.ok(page.messages.some(message=>message.role==='branchSummary'))
 assert.ok(page.messages.some(message=>JSON.stringify(message.content??'').includes('OFFICIAL_EDIT')))
 assert.ok(page.entries.some(entry=>entry.sourceEntry.type==='context_edit'&&entry.messages.length===0))
 assert.equal(f.ctx.sessions.get(f.header.id),undefined);assert.deepEqual(await readFile(f.path),bytes)
})

test('official committed projection refuses conflicting metadata from a live source',async t=>{
 const f=await fixture(t);await f.writer.close()
 f.ctx.sessions.create(f.header.id,{meta:{...f.header,createdAt:1}})
 await assert.rejects(f.query.readSurface(f.header.id),error=>error.code==='SESSION_QUERY_SOURCE_CONFLICT')
})

test('official authority context has no Host shadow and each projection snapshot is independent',async t=>{
 const f=await fixture(t),first=f.ctx.piAuthority.context(f.header.id),second=f.ctx.piAuthority.context(f.header.id)
 assert.deepEqual(Object.keys(first).sort(),['piMessages','projection'])
 assert.equal(Object.hasOwn(first,'hostMessages'),false)
 assert.deepEqual(first.projection,second.projection);assert.deepEqual(first.piMessages,second.piMessages)
 first.piMessages.length=0
 assert.ok(f.ctx.piAuthority.context(f.header.id).piMessages.length)
 assert.ok(second.projection.messages.length)
 await f.writer.close()
})
