import test from 'node:test'
import assert from 'node:assert/strict'
import {compactionSamples,routerCompactionTimes} from '../server/router-compaction-times.js'
const identity={conversationId:'room',sessionId:'router',limit:8}
const row=(phase,start,end,extra={})=>({groupId:'room',sessionId:'router',runtimeOwner:'conversation-router',runId:'run',kind:'phase',phase,startedAt:start,endedAt:end,status:'observed',outcome:'completed',...extra})
test('only exact current Router compaction phases produce durations, with no queue/model/source or foreign leakage',()=>{
 const rows=[row('foreground-compaction',1000,4000,{spanId:'same'}),row('foreground-compaction',1000,4000,{spanId:'same'}),row('request-prepare',0,9000),row('foreground-compaction',0,10000,{groupId:'foreign'}),row('foreground-compaction',0,10000,{sessionId:'old-router'}),row('foreground-compaction',0,10000,{runtimeOwner:'channel-triage'}),row('foreground-compaction',0,10000,{kind:'model'})]
 const before=structuredClone(rows),value=compactionSamples(rows,identity)
 assert.deepEqual(value,[{receivedAt:new Date(4000).toISOString(),compaction:{status:'recorded',durationMs:3000,shared:false}}]);assert.deepEqual(rows,before)
 assert.doesNotMatch(JSON.stringify(value),/foreign|sessionId|runId|triage|request-prepare/)
})
test('background success requires retained unambiguous adoption; cancelled, failed and unknown attempts are not successful points',()=>{
 for(const [markers,expected] of [[[], 'unconfirmed'],[[row('background-compaction-adopted',4000,4000)],'recorded'],[[row('background-compaction-adopted',4000,4000),row('background-compaction-adopted',4001,4001)],'unconfirmed'],[[row('background-compaction-cancelled',2000,2000)],'cancelled']])assert.equal(compactionSamples([row('background-compaction',1000,4000),...markers],identity)[0].compaction.status,expected)
 assert.equal(compactionSamples([row('foreground-compaction',1000,4000,{outcome:'failed'})],identity)[0].compaction.status,'failed')
 assert.equal(compactionSamples([row('foreground-compaction',4000,1000)],identity)[0].compaction.status,'invalid')
 assert.equal(compactionSamples([row('foreground-compaction',1000,1000)],identity)[0].compaction.durationMs,0)
 // A later attempt's adoption never certifies the preceding abandoned attempt.
 const samples=compactionSamples([row('background-compaction',1000,2000),row('background-compaction',3000,4000),row('background-compaction-adopted',4001,4001)],identity)
 assert.deepEqual(samples.map(item=>item.compaction.status),['recorded','unconfirmed'])
})
test('bounded existing trace pages recall late compactions; source fields stay internal and generation changes fail closed',async()=>{
 let generation=1;const calls=[]
 const rows=[...Array.from({length:600},(_,i)=>row('request-prepare',i,i+1)),row('foreground-compaction',1000,5000)]
 const tasks={store:{query:async q=>q.conversationId==='room'?{id:'room',generation,activeSessionId:'router'}:null},listExecutionTrace:async args=>{calls.push(args);return {items:rows.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<rows.length?args.offset+args.limit:null}}}
 const page=await routerCompactionTimes(tasks,'room',8);assert.equal(page.items.length,1);assert.equal(page.items[0].compaction.durationMs,4000);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.groupId==='room'&&call.sessionId==='router'&&call.limit===500))
 const reads=calls.length;assert.deepEqual(await routerCompactionTimes(tasks,'other-room',8),{status:'ready',items:[]});assert.equal(calls.length,reads,'another conversation does not reuse the current trace')
 tasks.listExecutionTrace=async()=>{generation++;return {items:rows,nextOffset:null}}
 assert.deepEqual(await routerCompactionTimes(tasks,'room',8),{status:'unavailable',items:[]})
})
test('empty, unsupported and unreadable metadata never become zero-duration records',async()=>{
 assert.deepEqual(await routerCompactionTimes({},'room',8),{status:'unavailable',items:[]})
 const tasks={store:{query:async()=>({id:'room',activeSessionId:'router',generation:1})},listExecutionTrace:async()=>({items:[],nextOffset:null})}
 assert.deepEqual((await routerCompactionTimes(tasks,'room',8)).items,[])
 tasks.listExecutionTrace=async()=>{throw Object.assign(Error(),{code:'SESSION_NOT_FOUND'})}
 assert.deepEqual((await routerCompactionTimes(tasks,'room',8)).items,[])
 tasks.listExecutionTrace=async()=>({items:[],nextOffset:null,diagnostics:{available:false}})
 assert.deepEqual(await routerCompactionTimes(tasks,'room',8),{status:'unavailable',items:[]})
})

test('recent compactions are selected and ordered by completion, not start or any message timestamp',()=>{
 const samples=compactionSamples([row('foreground-compaction',1000,9000),row('foreground-compaction',2000,3000)],{...identity,limit:1})
 assert.equal(samples.length,1);assert.equal(samples[0].receivedAt,new Date(9000).toISOString());assert.equal(samples[0].compaction.durationMs,8000)
})
