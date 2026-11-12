import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {openNativeDomains} from '../src/native-domain.js'
import {openResidentStore,residentDomainSpec,performanceDomainSpec} from '../packages/dingtalk-core/store.js'
import {makeAgentObservation} from '../src/runtime/pi-agent-observation.js'
import {projectAgentObservation} from '../packages/dingtalk-core/performance.js'
import {handleRequest} from '../packages/dingtalk-core/http.js'
import {TRACE_LIMIT,TRACE_GLOBAL_LIMIT,appendObservationTrace,listExecutionTrace,buildTraceLedger,projectSourceTraceStage} from '../src/runtime/performance-trace.js'
const hash=value=>createHash('sha256').update(value).digest('hex'),base=Date.parse('2026-11-12T00:00:00Z')
const event=(kind,time,span='phase',summary={},extra={})=>makeAgentObservation({ownerId:'session',runId:'request',entryId:kind==='model-completed'?'entry':null,spanId:hash(span),kind,timestamp:base+time,summary,...extra})
const stage=(extra={})=>({sourceId:'source',sourceVersion:1,groupId:'room',sessionId:'session',spanId:'source-stage',requestId:'request',stage:'router',startedAt:base,completedAt:null,shared:false,...extra})
test('durable trace survives restart, pairs out-of-order metadata, links exact source versions and paginates',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-trace-'));let domain=await openNativeDomains({root}),store=await openResidentStore(domain)
 t.after(async()=>{await store.close();await domain.closeAll();await rm(root,{recursive:true,force:true})})
 await store.recordSourceTraceStage(stage())
 const parent=event('phase-completed',90,'parent',{phase:'request-prepare',elapsedMs:80,outcome:'completed'}),child=event('phase-completed',40,'child',{phase:'request-guards',elapsedMs:20,outcome:'completed'},{parentSpanId:parent.spanId})
 for(const observation of [parent,child,event('model-completed',80,'model',{providerAttempted:true,stopReason:'stop'}),event('model-started',50,'model')])await store.recordAgentObservation({taskId:'task',groupId:'room',observation})
 await store.recordSourceTraceStage(stage({completedAt:base+100}));await store.recordSourceTraceStage(stage({sourceVersion:2,spanId:'source-v2',requestId:'other',startedAt:base+200,completedAt:base+300}))
 const result=store.listExecutionTrace({sourceId:'source',sourceVersion:1,limit:2,startedAt:base,endedAt:base+100});assert.equal(result.total,4);assert.equal(result.items.length,2);assert.equal(result.nextOffset,2);assert.equal(result.ledger.coveredMs,80);assert.equal(result.ledger.unattributedMs,20)
 const all=store.listExecutionTrace({sourceId:'source',sourceVersion:1,limit:20}).items;assert.equal(all.find(r=>r.spanId===child.spanId).parentSpanId,parent.spanId);assert.equal(all.find(r=>r.kind==='model').startedAt,base+50)
 assert.equal(store.listExecutionTrace({sourceId:'source',sourceVersion:2}).items.length,1);assert.equal(store.listExecutionTrace({groupId:'foreign'}).total,0);assert.equal(store.listExecutionTrace({taskId:'foreign'}).total,0)
 const before=store.listExecutionTrace({sessionId:'session',limit:20});await store.close();await domain.closeAll();domain=await openNativeDomains({root});store=await openResidentStore(domain);assert.deepEqual(store.listExecutionTrace({sessionId:'session',limit:20}),before);assert.equal((await store.recordAgentObservation({taskId:'task',groupId:'room',observation:parent})).created,false)
 assert.throws(()=>store.listExecutionTrace({}),/scope_required/);assert.throws(()=>store.listExecutionTrace({sourceId:'source'}),/version_required/)
})
test('retention, unknown boundaries and nested parallel union never imply idle',()=>{
 const p={observedSince:new Date(base).toISOString(),buckets:{},sessions:{}};for(let i=0;i<TRACE_LIMIT+3;i++)appendObservationTrace(p,{sessionId:'session',taskId:'task'},event('phase-completed',i,'p'+i,{phase:'skills',elapsedMs:1,outcome:'completed'}));const result=listExecutionTrace([p],{taskId:'task'});assert.equal(result.retention.dropped,3);assert.equal(result.retention.evictedFrom,base);assert.equal(result.complete,false)
 const ledger=buildTraceLedger([{kind:'model',startedAt:10,endedAt:50},{kind:'tool',startedAt:30,endedAt:80},{kind:'phase',startedAt:0,endedAt:100},{kind:'phase',startedAt:20,endedAt:40},{kind:'tool',startedAt:80,endedAt:null}],{startedAt:0,endedAt:120});assert.deepEqual(ledger.byKind,{model:40,tool:30,phase:30});assert.equal(ledger.coveredMs,100);assert.equal(ledger.unattributedMs,20);assert.equal(ledger.openOrInvalidSpans,1);assert.equal(ledger.complete,false)
})
test('schema rejects private payload and unknown phase; open spans remain visible by source',()=>{
 assert.throws(()=>projectAgentObservation(undefined,{observation:{...event('tool-started',1),arguments:'SECRET'}}));assert.throws(()=>projectSourceTraceStage(undefined,stage({phase:'SECRET'})))
 let p=projectSourceTraceStage(undefined,stage({completedAt:base+20})).projection;p=projectAgentObservation(p,{taskId:'task',groupId:'room',observation:event('tool-started',5)}).projection
 const result=listExecutionTrace([p],{sourceId:'source',sourceVersion:1,startedAt:base,endedAt:base+20});assert.equal(result.items.find(r=>r.kind==='tool').endedAt,null);assert.equal(result.ledger.coveredMs,0);assert.throws(()=>projectSourceTraceStage(p,stage({completedAt:base+21})),/identity_conflict/)
})
const admitted=(at,version,extra={})=>event('input-admitted',at,'admit'+version,{}, {entryId:'input'+version,traceSources:[{sourceId:'input-source',sourceVersion:version,groupId:'room'}],...extra})
test('only admitted source versions associate later phases',()=>{
 let p;for(const observation of [admitted(15,1),event('phase-completed',30,'before',{phase:'skills',elapsedMs:10,outcome:'completed'}),admitted(40,2),event('phase-completed',60,'after',{phase:'skills',elapsedMs:10,outcome:'completed'})])p=projectAgentObservation(p,{groupId:'room',observation}).projection
 assert.deepEqual(listExecutionTrace([p],{sourceId:'input-source',sourceVersion:1}).items.map(r=>r.spanId),[hash('before')]);assert.deepEqual(listExecutionTrace([p],{sourceId:'input-source',sourceVersion:2}).items.map(r=>r.spanId),[hash('after')])
})
for(const kind of ['model','tool'])test('same-ms '+kind+' start does not retrospectively acquire later admission',()=>{
 let p;for(const observation of [admitted(5,1),event(kind+'-started',5,'work'),admitted(5,2),event(kind+'-completed',10,'work',kind==='model'?{providerAttempted:true}: {})])p=projectAgentObservation(p,{groupId:'room',observation}).projection
 assert.equal(listExecutionTrace([p],{sourceId:'input-source',sourceVersion:1}).total,1);assert.equal(listExecutionTrace([p],{sourceId:'input-source',sourceVersion:2}).total,0)
})
test('same-ms prior admission orders concrete start but not reconstructed phase start',()=>{
 let p;for(const observation of [admitted(5,1),admitted(5,2),event('model-started',5,'model'),event('phase-completed',10,'phase',{phase:'skills',elapsedMs:5,outcome:'completed'})])p=projectAgentObservation(p,{groupId:'room',observation}).projection
 assert.equal(listExecutionTrace([p],{sourceId:'input-source',sourceVersion:1}).total,0);assert.deepEqual(listExecutionTrace([p],{sourceId:'input-source',sourceVersion:2}).items.map(r=>r.kind),['model'])
})
test('completion-only Router input links task without inventing source versions',()=>{
 let p;for(const observation of [event('input-admitted',1,'input',{}, {entryId:'completion',traceTaskEvents:[{taskId:'task',eventId:'done'}]}),event('model-started',2,'model')])p=projectAgentObservation(p,{runtimeOwner:'conversation-router',groupId:'room',observation}).projection
 const linked=listExecutionTrace([p],{taskId:'task'});assert.equal(linked.total,1);assert.deepEqual(linked.items[0].taskLinks,[{taskId:'task',eventId:'done',inputEntryId:'completion'}]);assert.equal(linked.items[0].sourceCorrelation,'unknown');assert.equal(listExecutionTrace([p],{taskId:'foreign'}).total,0);assert.equal(listExecutionTrace([p],{sourceId:'unknown',sourceVersion:1}).total,0)
})
test('late source clips shared phase coverage rather than inheriting earlier time',()=>{
 let p=projectSourceTraceStage(undefined,stage({startedAt:base+50,completedAt:base+100,shared:true})).projection;p=projectAgentObservation(p,{groupId:'room',observation:event('phase-completed',100,'phase',{phase:'skills',elapsedMs:100,outcome:'completed'})}).projection
 const result=listExecutionTrace([p],{sourceId:'source',sourceVersion:1,startedAt:base,endedAt:base+100});assert.equal(result.ledger.coveredMs,50);assert.equal(result.ledger.unattributedMs,50)
})
test('2200 observations batch once and retain bounded metadata',async t=>{
 const {nativeResidentSnapshot}=await import('./fixtures/native-domain-snapshot.js');let writes=0
 const f=await nativeResidentSnapshot(undefined,{beforeCommit:({change})=>{if(change.key==='performance:session')writes++}}),store=await openResidentStore(f.domains);t.after(async()=>{await store.close();await f.close()})
 await Promise.all(Array.from({length:2200},(_,i)=>store.recordAgentObservation({taskId:'task',observation:event('phase-completed',i,'batch'+i,{phase:'skills',elapsedMs:1,outcome:'completed'})})));assert.equal(writes,1);const result=store.listExecutionTrace({taskId:'task'});assert.equal(result.total,2048);assert.equal(result.retention.dropped,152)
})
test('trace HTTP forwards exact scope and rejects invalid pagination',async t=>{
 const calls=[],server=createServer((request,response)=>handleRequest(request,response,{listExecutionTrace:filter=>{calls.push(filter);return {items:[]}}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port
 assert.equal((await fetch(url+'/state/execution-trace?sourceId=s&sourceVersion=2&limit=10&offset=20')).status,200);assert.deepEqual(calls,[{sourceId:'s',sourceVersion:2,limit:10,offset:20}]);assert.equal((await fetch(url+'/state/execution-trace?taskId=t&limit=501')).status,400)
})
test('diagnostic partitions override legacy metrics once without rewriting business history',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-trace-domain-'));let domains,store;t.after(async()=>{await store?.close();await domains?.closeAll();await rm(root,{recursive:true,force:true})})
 const observation=event('phase-completed',10,'old',{phase:'skills',elapsedMs:2,outcome:'completed'}),projection=projectAgentObservation(undefined,{taskId:'task',observation}).projection;delete projection.trace
 const file=join(root,residentDomainSpec.name+'.json');await writeFile(file,JSON.stringify({unit:{name:residentDomainSpec.name,version:residentDomainSpec.version},global:null,tables:{scheduler:{runtime:{tasks:[]},'performance:session':{tasks:[],performanceProjection:projection}}}}))
 domains=await openNativeDomains({root});store=await openResidentStore(domains);const before=await readFile(file,'utf8');assert.equal((await store.recordAgentObservation({taskId:'task',observation})).created,false);await store.recordAgentObservation({taskId:'task',observation:event('phase-completed',20,'new',{phase:'skills',elapsedMs:3,outcome:'completed'})});assert.equal(await readFile(file,'utf8'),before);assert.equal(store.listPerformance().rows.length,1)
 const expected=store.listPerformance().rows;await store.close();await domains.closeAll();domains=await openNativeDomains({root});store=await openResidentStore(domains);assert.deepEqual(store.listPerformance().rows,expected)
})
test('corrupt diagnostics do not block business or overwrite evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-trace-corrupt-')),path=join(root,performanceDomainSpec.name+'.json');await writeFile(path,'corrupt');const domains=await openNativeDomains({root}),store=await openResidentStore(domains);t.after(async()=>{await store.close();await domains.closeAll();await rm(root,{recursive:true,force:true})});await store.subscribe({groupId:'room',responsibility:'test'});await assert.rejects(store.recordSourceTraceStage(stage()));assert.equal(store.listExecutionTrace({groupId:'room'}).diagnostics.available,false);assert.equal(await readFile(path,'utf8'),'corrupt')
})
test('uncertain diagnostic commit poisons diagnostics alone and closes both domains',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-trace-poison-'));let fail=true;const domains=await openNativeDomains({root,afterRename:({domain})=>{if(domain===performanceDomainSpec.name&&fail){fail=false;throw new Error('uncertain')}}}),store=await openResidentStore(domains);t.after(async()=>{await store.close();await domains.closeAll();await rm(root,{recursive:true,force:true})});await assert.rejects(store.recordSourceTraceStage(stage()),/COMMIT_UNCERTAIN/);assert.equal(store.listExecutionTrace({groupId:'room'}).diagnostics.available,false);await store.subscribe({groupId:'room',responsibility:'writable'});await store.close();assert.equal(domains.get(performanceDomainSpec.name),undefined);assert.equal(domains.get(residentDomainSpec.name),undefined)
})
test('global budget preserves aggregates across eviction, partial failure and cold restart',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-trace-budget-'));let domains,store,failKey;const open=async()=>{domains=await openNativeDomains({root,beforeCommit:({domain,change})=>{if(domain===performanceDomainSpec.name&&change.key===failKey)throw new Error('retention-write-failed')}});store=await openResidentStore(domains)};t.after(async()=>{await store?.close();await domains?.closeAll();await rm(root,{recursive:true,force:true})});await open()
 const obs=(session,i)=>makeAgentObservation({ownerId:session,runId:'run',entryId:null,spanId:hash(session+i),kind:'phase-completed',timestamp:base+i,summary:{phase:'skills',elapsedMs:1,outcome:'completed'}}),add=(session,count,offset=0)=>Promise.all(Array.from({length:count},(_,i)=>store.recordAgentObservation({taskId:session,observation:obs(session,i+offset)})))
 await add('old',2048);await add('middle',2048);const old=store.listPerformance({sessionId:'old'}).rows;failKey='performance:old';await assert.rejects(add('new',1),/retention-write-failed/);assert.equal(store.listExecutionTrace({taskId:'old'}).total,2048);assert.equal(store.listPerformance().diagnostics.available,false);failKey=undefined;await add('new',1);assert.deepEqual(store.listPerformance({sessionId:'old'}).rows,old);assert.equal(store.listExecutionTrace({taskId:'old'}).total,0)
 let saved=JSON.parse(await readFile(join(root,performanceDomainSpec.name+'.json'),'utf8')).tables.scheduler;assert.ok(Object.values(saved).reduce((n,row)=>n+(row.performanceProjection.trace?.entries.length??0),0)<=TRACE_GLOBAL_LIMIT);assert.equal(saved['performance:old'].performanceProjection.trace.dropped,2048)
 await add('new',2047,1);const middle=store.listPerformance({sessionId:'middle'}).rows;failKey='performance:latest';await assert.rejects(add('latest',1),/retention-write-failed/);assert.equal(store.listExecutionTrace({taskId:'middle'}).total,0);assert.equal(store.listPerformance().diagnostics.available,false);assert.deepEqual(store.listPerformance({sessionId:'middle'}).rows,middle);failKey=undefined
 await store.close();await domains.closeAll();await open();assert.deepEqual(store.listPerformance({sessionId:'old'}).rows,old);assert.equal((await store.recordAgentObservation({taskId:'old',observation:obs('old',0)})).created,false)
})
test('cold oversized snapshots expose actual budget and do not migrate on read or duplicate',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-trace-oversized-')),tables={scheduler:{}};let duplicate
 for(const session of ['a','b','c']){let p;for(let i=0;i<2000;i++){duplicate={groupId:'room',observation:makeAgentObservation({ownerId:session,runId:'run',entryId:null,spanId:hash(session+i),kind:'phase-completed',timestamp:base+i,summary:{phase:'skills',elapsedMs:1,outcome:'completed'}})};p=projectAgentObservation(p,duplicate,{owned:true}).projection}tables.scheduler['performance:'+session]={tasks:[],performanceProjection:p}}
 const path=join(root,performanceDomainSpec.name+'.json');await writeFile(path,JSON.stringify({unit:{name:performanceDomainSpec.name,version:1},tables,global:null}));const before=await readFile(path,'utf8'),domains=await openNativeDomains({root}),store=await openResidentStore(domains);t.after(async()=>{await store.close();await domains.closeAll();await rm(root,{recursive:true,force:true})});for(let i=0;i<2;i++){const result=store.listExecutionTrace({groupId:'room'});assert.equal(result.retention.globalRetained,6000);assert.equal(result.retention.globalBudgetExceeded,true);assert.equal(result.retention.globalBudgetPolicy,'enforced-on-successful-write');assert.equal((await store.recordAgentObservation(duplicate)).created,false)}assert.equal(await readFile(path,'utf8'),before)
})


test('ledger rejects invalid windows and nonfinite scoped intervals cannot fabricate zero-origin coverage',()=>{
 for(const window of [{},{startedAt:0},{startedAt:-1,endedAt:5},{startedAt:5,endedAt:4},{startedAt:NaN,endedAt:5}])assert.throws(()=>buildTraceLedger([],window),/trace_window_invalid/)
 const result=buildTraceLedger([{kind:'phase',startedAt:0,endedAt:10,scopeIntervals:[[null,10],[0,NaN],[5,10]]}],{startedAt:0,endedAt:10});assert.equal(result.coveredMs,5);assert.equal(result.unattributedMs,5);assert.equal(result.openOrInvalidSpans,2)
 const p=projectAgentObservation(undefined,{taskId:'task',observation:event('phase-completed',10,'phase',{phase:'skills',elapsedMs:5,outcome:'completed'})}).projection;const row=listExecutionTrace([p],{taskId:'task'}).items[0];assert.equal(row.clock,'host-wall-anchor-monotonic-duration');assert.equal(row.sourceCorrelation,'unknown')
})
