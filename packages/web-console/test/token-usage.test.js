import test from 'node:test'
import assert from 'node:assert/strict'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {nativeTokenUsage} from '../server/token-usage.js'
import {taskSessionView} from '../server/session-view.js'
const usage=n=>({input:100*n,output:10*n,cacheRead:400*n,cacheWrite:20*n,totalTokens:999999,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}})
const entries=[{id:'old',type:'message',message:{role:'assistant',usage:usage(1)}},{id:'compact',type:'compaction',usage:usage(2)},{id:'branch',type:'branch_summary',usage:usage(3)},{id:'usage',type:'usage',usage:usage(4)},{id:'tool',type:'message',message:{role:'toolResult',usage:usage(5)}},{id:'error',type:'message',message:{role:'assistant',api:'openai',stopReason:'error',usage:usage(6)}}]
const official=entries=>AgentSession.prototype.getSessionStats.call({sessionManager:{getEntries:()=>entries},getContextUsage:()=>undefined}).tokens
const values=value=>Object.fromEntries(['input','output','cacheRead','cacheWrite','total'].map(k=>[k,value[k]]))
test('full native entries include pre-compaction, summaries, explicit usage, tool and error usage exactly as official Pi',()=>{
 const result=nativeTokenUsage(entries)
 assert.deepEqual(values(result),official(entries));assert.equal(result.total,11130)
 assert.deepEqual(nativeTokenUsage([...entries,entries[0]]),result)
 assert.deepEqual(nativeTokenUsage(entries),result,'refresh recomputes rather than accumulating')
 assert.throws(()=>nativeTokenUsage([...entries,{...entries[0],usage:usage(100)}]),{code:'SESSION_USAGE_INVALID'})
})
test('unknown and genuine zero remain distinct, including normalized Host fake-zero usage',()=>{
 assert.deepEqual(values(nativeTokenUsage([])),{input:0,output:0,cacheRead:0,cacheWrite:0,total:0})
 const assistant=(usage,extra={})=>[{id:'a',type:'message',message:{role:'assistant',usage,...extra}}]
 assert.equal(nativeTokenUsage(assistant(usage(0))).total,0)
 for(const row of [assistant(undefined),assistant(usage(0),{_hostUsage:undefined}),assistant(usage(0),{api:'host'}),assistant(usage(0),{api:'host',stopReason:'error'})])assert.equal(nativeTokenUsage(row).total,null)
 const partial=nativeTokenUsage(assistant(usage(0),{_hostUsage:{inputTokens:12,outputTokens:3,cacheReadTokens:0}}))
 assert.equal(partial.input,12);assert.equal(partial.cacheRead,0);assert.equal(partial.cacheWrite,null);assert.equal(partial.total,null)
 for(const value of [undefined,-1,Infinity,0.5])assert.equal(nativeTokenUsage(assistant({...usage(1),input:value})).input,null)
})
test('task projection reuses one validated read, pages do not change totals, foreign identity and guard cannot disclose usage',async()=>{
 const task={taskId:'t',session:{sessionId:'s'}}, snapshot={header:{id:'s'},entries,audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'t',sessionId:'s'}}],context:{projection:{entries:[]}}}
 let reads=0;const persistence={readNative:async(id,options)=>{reads++;assert.equal(id,'s');assert.equal(options.requireComplete,true);return snapshot},readLive:async()=>({sessionId:'s',active:true,revision:'live',assistant:{id:'live',message:{role:'assistant',usage:usage(1000),content:[]}},tools:[]})}
 const first=await taskSessionView({task,persistence,limit:1});assert.equal(reads,1);assert.deepEqual(first.tokenUsage,nativeTokenUsage(entries))
 const second=await taskSessionView({task,persistence,limit:50});assert.deepEqual(second.tokenUsage,first.tokenUsage)
 snapshot.audit[0].payload.taskId='foreign';await assert.rejects(taskSessionView({task,persistence}),{code:'SESSION_IDENTITY_INVALID'})
 snapshot.audit[0].payload.taskId='t';await assert.rejects(taskSessionView({task,persistence,guard:()=>{throw Object.assign(Error('forbidden'),{code:'AUTH_REQUIRED'})}}),{code:'AUTH_REQUIRED'})
})

test('flat task-store unbound identity and genuinely absent native file remain pending without token metadata',async()=>{
 const result=await taskSessionView({task:{taskId:'not-started',sessionId:'missing',sessionBound:false},persistence:{readNative:async()=>{throw Object.assign(Error('missing'),{name:'SessionPersistenceNotFoundError'})}}});
 assert.equal(result.status,'pending');assert.equal(result.reason,'SESSION_NOT_STARTED');assert.equal(Object.hasOwn(result,'tokenUsage'),false);
});
