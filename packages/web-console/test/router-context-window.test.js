import test from 'node:test'
import assert from 'node:assert/strict'
import {routerContextWindow} from '../server/router-context-window.js'
function fixture(){
 const row={id:'room',phase:'active',generation:2,activeSessionId:'router-2'}
 const actor={id:'router-2',metadata:{runtimeOwner:'conversation-router',conversationId:'room',generation:2},lifecycle:{signal:new AbortController().signal},piSession:{sessionId:'router-2',model:{provider:'fixture',id:'model',contextWindow:1000000},getContextUsage:()=>({tokens:820000,contextWindow:1000000,secret:'never expose'})}}
 return {row,actor,tasks:{store:{query:async()=>row}},agents:{get:()=>actor}}
}
test('live current Pi estimate exposes numbers only and its effective window',async()=>{
 const f=fixture();assert.deepEqual(await routerContextWindow(f.tasks,f.agents,'room'),{status:'ready',basis:'pi-context-estimate',tokens:820000,contextWindow:472000,modelWindow:1000000,categories:[{key:'unclassified',label:'未分类',tokens:820000}]})
})
for(const [name,change] of [
 ['foreign conversation',f=>f.actor.metadata.conversationId='other'],['foreign generation',f=>f.actor.metadata.generation=1],
 ['foreign session',f=>f.actor.piSession.sessionId='other'],['task actor',f=>f.actor.metadata.runtimeOwner='execution'],
 ['no live handle',f=>f.agents.get=()=>undefined],['unknown after compaction',f=>f.actor.piSession.getContextUsage=()=>({tokens:null,contextWindow:1000000})],
 ['missing window',f=>f.actor.piSession.getContextUsage=()=>({tokens:20,contextWindow:0})],['no measured context',f=>f.actor.piSession.getContextUsage=()=>({tokens:0,contextWindow:1000000})],
 ['invalid count',f=>f.actor.piSession.getContextUsage=()=>({tokens:NaN,contextWindow:1000000})],['closed owner',f=>f.actor.lifecycle.signal=AbortSignal.abort()],
 ['changed owner during read',f=>{let n=0;f.tasks.store.query=async()=>++n===1?f.row:{...f.row,generation:3}}],
])test(name+' remains unavailable rather than zero',async()=>{const f=fixture();change(f);assert.deepEqual(await routerContextWindow(f.tasks,f.agents,'room'),{status:'unavailable'})})
