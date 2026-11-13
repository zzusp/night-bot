import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {querySourceHistory,recentSourceBackground} from '../src/channels/source-history.js'

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close())
 db.exec("CREATE TABLE dynamic_sources(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE INDEX dynamic_source_history_conversation ON dynamic_sources(json_extract(body,'$.groupId')); CREATE INDEX dynamic_source_history_version ON dynamic_sources(json_extract(body,'$.groupId'),json_extract(body,'$.messageId'),json_extract(body,'$.version'))")
 const put=(id,extra={})=>{const value={id,sourceId:id,groupId:'room',messageId:id,version:1,actorId:'alice',timestamp:'2026-11-01T10:00:00Z',text:'Information '+id,...extra};db.prepare('INSERT INTO dynamic_sources VALUES (?,?)').run(id,JSON.stringify(value));return value}
 return {db,put,query:q=>querySourceHistory(db,{conversationId:'room',...q})}
}
test('history pages original no-action messages without creating new work or crossing conversations',t=>{
 const {put,query}=fixture(t)
 put('a',{routed:true,text:'Do not act yet; VERSION B is the valid attachment.'});put('private',{groupId:'private-alice',text:'private secret'});put('other',{groupId:'other-room'});put('b');put('c')
 const first=query({limit:2});assert.deepEqual(first.sources.map(x=>x.sourceId),['c','b']);assert.equal(first.hasMore,true)
 const second=query({cursor:first.nextCursor,limit:2});assert.deepEqual(second.sources.map(x=>x.sourceId),['a']);assert.equal(second.nextCursor,null)
 assert.equal(second.sources[0].messageVersion,1);assert.equal(second.backgroundOnly,true)
 assert.equal(query({keyword:'VERSION B'}).sources[0].sourceId,'a')
 assert.equal(query({keyword:"' OR 1=1 --"}).sources.length,0)
 assert.throws(()=>query({anchorSourceId:'private'}),/HISTORY_INVALID/)
})
test('latest version wins; revoked or held latest never reveals previous text; page text is bounded',t=>{
 const {put,query}=fixture(t)
 put('v1',{messageId:'edited',text:'old fact'});put('v2',{messageId:'edited',version:2,text:'new fact'})
 put('r1',{messageId:'removed',text:'private old fact'});put('r2',{messageId:'removed',version:2,authorizationRevoked:true})
 put('held',{triageHold:true});put('archived',{archiveRestoreHold:true});put('internal',{channel:'internal'})
 put('long',{text:'x'.repeat(9000),quote:{groupId:'foreign',text:'foreign quote'},resources:[{id:'file'}]})
 const values=query({}).sources;assert.deepEqual(values.map(x=>x.sourceId),['long','v2'])
 assert.equal(values[0].text.length,1200);assert.equal(values[0].truncated,true);assert.equal(values[0].hasAttachments,true);assert.equal(values[0].quote,undefined)
 assert.equal(query({keyword:'old fact'}).sources.length,0)
})
test('history time filters, keyset anchor and bounded arguments',t=>{
 const {put,query}=fixture(t)
 put('old',{timestamp:'2026-11-01T09:00:00Z'});put('current');put('future',{timestamp:'2026-11-01T11:00:00Z'})
 assert.deepEqual(query({after:'2026-11-01T09:30:00Z',before:'2026-11-01T10:30:00Z'}).sources.map(x=>x.sourceId),['current'])
 assert.deepEqual(query({anchorSourceId:'current'}).sources.map(x=>x.sourceId),['old'])
 for(const args of [{limit:0},{limit:21},{cursor:-1},{before:'bad'},{after:'2026-12-01',before:'2026-11-01'},{keyword:'x'.repeat(201)}])assert.throws(()=>query(args),/HISTORY_INVALID/)
})
test('triage background is capped and excludes current batch versions',async t=>{
 const {put,query}=fixture(t)
 for(let i=0;i<10;i++)put('old-'+i)
 const current=put('current'),steered=put('steered');put('late')
 const background=await recentSourceBackground((_kind,args)=>query(args),'room',[current,steered])
 assert.equal(background.sources.length,5);assert.equal(background.sources[0].sourceId,'old-9');assert.ok(background.sources.every(x=>x.sourceId.startsWith('old-')))
 assert.deepEqual(await recentSourceBackground(undefined,'room',[current]),{backgroundOnly:true,sources:[]})
})

test('full source read reports superseded and denies hidden latest or foreign records',async t=>{
 const {queryCurrentSource}=await import('../src/channels/source-history.js')
 const {db,put}=fixture(t)
 put('v1',{messageId:'edited',text:'old fact'});put('v2',{messageId:'edited',version:2,text:'new fact'})
 assert.deepEqual(queryCurrentSource(db,{conversationId:'room',sourceId:'v1'}),{sourceId:'v1',messageVersion:1,status:'superseded',latestSourceId:'v2',latestMessageVersion:2})
 assert.equal(queryCurrentSource(db,{conversationId:'room',sourceId:'v2'}).text,'new fact')
 put('v3',{messageId:'edited',version:3,archiveRestoreHold:true})
 assert.deepEqual(queryCurrentSource(db,{conversationId:'room',sourceId:'v1'}),{status:'unavailable'})
 assert.deepEqual(queryCurrentSource(db,{conversationId:'other-room',sourceId:'v2'}),{status:'unavailable'})
})

test('recent page uses receipt-order index without full conversation sorting',t=>{
 const {db,put,query}=fixture(t)
 db.exec('BEGIN');for(let i=0;i<10000;i++)put('record-'+i);db.exec('COMMIT')
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT s.body FROM dynamic_sources s INDEXED BY dynamic_source_history_conversation WHERE json_extract(s.body,'$.groupId')=? ORDER BY s.rowid DESC LIMIT 5").all('room')
 assert.ok(plan.some(row=>row.detail.includes('dynamic_source_history_conversation')))
 assert.ok(plan.every(row=>!row.detail.includes('TEMP B-TREE')))
 assert.deepEqual(query({limit:5}).sources.map(x=>x.sourceId),[9999,9998,9997,9996,9995].map(i=>'record-'+i))
})
test('quote snapshots never expose foreign or withdrawn target bodies and identify edits',async t=>{
 const {db,put,query}=fixture(t),{queryCurrentSource}=await import('../src/channels/source-history.js')
 put('target1',{messageId:'target',text:'old quoted fact'})
 put('quoting',{quote:{groupId:'room',messageId:'target',text:'old quoted fact'}})
 assert.equal(query({keyword:'Information quoting'}).sources[0].quote.status,'current')
 put('target2',{messageId:'target',version:2,text:'corrected fact'})
 let quote=queryCurrentSource(db,{conversationId:'room',sourceId:'quoting'}).quote
 assert.equal(quote.status,'superseded');assert.equal(quote.text,undefined);assert.equal(quote.currentSourceId,'target2')
 put('target3',{messageId:'target',version:3,authorizationRevoked:true})
 quote=queryCurrentSource(db,{conversationId:'room',sourceId:'quoting'}).quote
 assert.equal(quote.status,'unavailable');assert.equal(quote.text,undefined)
 put('foreignQuote',{quote:{groupId:'other-room',messageId:'target',text:'foreign secret'}})
 assert.equal(queryCurrentSource(db,{conversationId:'room',sourceId:'foreignQuote'}).quote,undefined)
 put('unknownQuote',{quote:{messageId:'not-captured',text:'unverified quote snapshot'}})
 assert.equal(queryCurrentSource(db,{conversationId:'room',sourceId:'unknownQuote'}).quote.status,'unverified')
})
test('closing while optional background loads cannot create a new triage actor',async()=>{
 const {createChannelTriage}=await import('../src/channels/resident-router-business.js')
 let resolve
 const gate=new Promise(done=>{resolve=done})
 const triage=createChannelTriage({ctx:{get(){throw Error('No actor may be created after close')}},query:()=>gate})
 const running=triage.run('room',[{sourceId:'source',messageId:'message',version:1}])
 await triage.close();resolve({sources:[]})
 await assert.rejects(running,/TRIAGE_CLOSED/)
})

test('existing v4 ledger gains derived history indexes only after installation identity checks',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {openDynamicTaskStore}=await import('../packages/dingtalk-core/dynamic-task-store.js')
 const root=await mkdtemp(join(tmpdir(),'night-history-upgrade-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const config={dbPath:join(root,'tasks.sqlite'),initialize:true,instanceId:'history-upgrade',ownerActorId:'operator',webActorId:'operator'}
 let store=await openDynamicTaskStore(config)
 await store.command({id:'source',kind:'source.record-direct',args:{source:{sourceId:'prior',messageId:'prior',version:1,groupId:'room',actorId:'alice',text:'Retained original'},conversation:{conversationId:'room'}}})
 await store.close()
 let db=new DatabaseSync(config.dbPath);db.exec('DROP INDEX dynamic_source_history_conversation; DROP INDEX dynamic_source_history_version');db.close()
 await assert.rejects(openDynamicTaskStore({...config,initialize:false,instanceId:'foreign-installation'}))
 db=new DatabaseSync(config.dbPath);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'dynamic_source_history_%'").get().n,0);db.close()
 store=await openDynamicTaskStore({...config,initialize:false})
 try {assert.equal((await store.query({kind:'router.source-history',conversationId:'room'})).sources[0].sourceId,'prior')}
 finally {await store.close()}
 db=new DatabaseSync(config.dbPath);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'dynamic_source_history_%'").get().n,2);db.close()
})
