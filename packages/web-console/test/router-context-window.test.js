import test from 'node:test'
import assert from 'node:assert/strict'
import {routerContextWindow} from '../server/router-context-window.js'
function fixture(){
 const row={id:'room',phase:'active',generation:2,activeSessionId:'router-2'}
 const actor={id:'router-2',metadata:{runtimeOwner:'conversation-router',conversationId:'room',generation:2},lifecycle:{signal:new AbortController().signal},piSession:{sessionId:'router-2',model:{provider:'fixture',id:'model',contextWindow:1000000},getContextUsage:()=>({tokens:820000,contextWindow:1000000,secret:'never expose'})}}
 return {row,actor,tasks:{store:{query:async()=>row}},agents:{get:()=>actor}}
}
test('live current Pi estimate exposes numbers only and its effective window',async()=>{
 const f=fixture();assert.deepEqual(await routerContextWindow(f.tasks,f.agents,'room'),{status:'ready',basis:'pi-context-estimate',tokens:820000,contextWindow:472000,modelWindow:1000000,categories:[{key:'unclassified',tokens:820000}]})
})
test('classifies the current Pi projection without counting superseded system sections; reuses only the same leaf',async()=>{
 const f=fixture();let reads=0,leaf='latest',total=40
 const text=n=>[{type:'text',text:n}]
 const messages=[
  {role:'system',content:'',sections:{rules:'x'.repeat(400),skills:'old '.repeat(100)},timestamp:1},
  {role:'system',content:'',sections:{rules:'abcdefgh',skills:'abcd',night_memory_index:'index123',tools:'list'},toolsAdded:[{name:'read'}],timestamp:2},
  {role:'custom',customType:'night.business-input',content:text('incoming'),timestamp:3},
  {role:'assistant',content:text('done'),timestamp:4},
  {role:'compactionSummary',summary:'summ',timestamp:5},
  {role:'toolResult',content:text('tool'),timestamp:6},
  {role:'custom',customType:'other',content:text('private'),timestamp:7},
  {role:'toolResult',toolName:'resident_skill_query',content:text('body'),timestamp:8},
  {role:'toolResult',toolName:'resident_memory_review',content:text('note'),timestamp:9},
  {role:'toolResult',toolName:'resident_memory_review',isError:true,content:text('oops'),timestamp:10},
 ]
 f.actor.piSession.getContextUsage=()=>({tokens:total,contextWindow:1000000})
 f.actor.piSession.sessionManager={getLeafId:()=>leaf,buildSessionProjection:()=>{reads++;return {messages}}}
 const get=async()=>(await routerContextWindow(f.tasks,f.agents,'room')).categories
 assert.deepEqual(await get(),[{key:'messages',tokens:4},{key:'skills',tokens:2},{key:'memory',tokens:3},{key:'systemTools',tokens:6},{key:'system',tokens:2},{key:'tools',tokens:2},{key:'unclassified',tokens:21}])
 assert.deepEqual(await get(),await get());assert.equal(reads,1)
 total=6;assert.deepEqual(await get(),[{key:'unclassified',tokens:6}]);assert.equal(reads,1)
 total=40;leaf='after-edit';messages.splice(0,4)
 assert.deepEqual(await get(),[{key:'messages',tokens:1},{key:'skills',tokens:1},{key:'memory',tokens:1},{key:'tools',tokens:2},{key:'unclassified',tokens:35}]);assert.equal(reads,2)
})
for(const [name,change,reason] of [
 ['foreign conversation',f=>f.actor.metadata.conversationId='other'],['foreign generation',f=>f.actor.metadata.generation=1],
 ['foreign session',f=>f.actor.piSession.sessionId='other'],['task actor',f=>f.actor.metadata.runtimeOwner='execution'],
 ['no live handle',f=>f.agents.get=()=>undefined,'not-loaded'],['unknown after compaction',f=>f.actor.piSession.getContextUsage=()=>({tokens:null,contextWindow:1000000}),'awaiting-model-usage'],
 ['missing window',f=>f.actor.piSession.getContextUsage=()=>({tokens:20,contextWindow:0})],['no measured context',f=>f.actor.piSession.getContextUsage=()=>({tokens:0,contextWindow:1000000})],
 ['invalid count',f=>f.actor.piSession.getContextUsage=()=>({tokens:NaN,contextWindow:1000000})],['closed owner',f=>f.actor.lifecycle.signal=AbortSignal.abort()],
 ['changed owner during read',f=>{let n=0;f.tasks.store.query=async()=>++n===1?f.row:{...f.row,generation:3}}],
])test(name+' remains unavailable rather than zero',async()=>{const f=fixture();change(f);assert.deepEqual(await routerContextWindow(f.tasks,f.agents,'room'),{status:'unavailable',...reason&&{reason}})})
