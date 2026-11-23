import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {agentToolSpanId,makeAgentObservation} from '../../../src/runtime/pi-agent-observation.js'
import {executionHistoryTiming} from '../../../src/runtime/performance-trace.js'
import {routerSessionMessageView,routerSessionView,taskSessionView} from '../server/session-view.js'

const hash=value=>createHash('sha256').update(value).digest('hex')
const iso='2026-11-23T15:00:00.000Z'
const sessionId='sid',taskId='tid',conversationId='cid'
const task={taskId,sessionId,sessionBound:true}
const taskIdentity={sessionId,taskId}
const routerIdentity={sessionId,conversationId,generation:2}
const entry=(id,parentId,message)=>({id,parentId,type:'message',timestamp:iso,message})
const project=(row,...messages)=>({sourceEntry:row,messages:messages.length?messages:[row.message]})
const text=(role,value)=>({role,content:[{type:'text',text:value}]})
const nativeTool=(id,name='bash')=>({type:'toolCall',id,name,arguments:{command:'echo safe'}})
function sample(kind,entryId,spanId,t,summary={},identity={sessionId,taskId},runId='run'){
 const observation=makeAgentObservation({ownerId:identity.sessionId,runId,entryId,spanId,kind,timestamp:t,summary})
 return {type:'observation',identity,observation}
}
const model='assistant', toolNativeId='tool-native'
const timingRows=[
 sample('model-started',null,hash('model'),10),
 sample('model-first-token',null,hash('model'),25),
 sample('model-completed',model,hash('model'),40),
 sample('turn-completed',model,hash('turn'),90,{elapsedMs:85}),
 sample('thinking-completed',model,hash('thinking'),42,{elapsedMs:12,contentIndex:0}),
 sample('tool-started',model,agentToolSpanId(sessionId,'run',model,toolNativeId),45),
 sample('tool-completed',model,agentToolSpanId(sessionId,'run',model,toolNativeId),70),
 sample('tool-started',model,agentToolSpanId(sessionId,'run',model,'unclosed'),50),
 sample('tool-completed',model,agentToolSpanId(sessionId,'run',model,toolNativeId),100,{}, {sessionId,taskId:'foreign'}),
]
function fixture(entries,projected=entries.map(row=>project(row))){
 return {header:{id:sessionId},entries,context:{projection:{entries:projected}},
  audit:[{domain:'task',kind:'identity',version:1,payload:{taskId,sessionId}}]}
}
const result=(nativeId)=>({role:'toolResult',toolCallId:nativeId,toolName:'bash',content:[{type:'text',text:'safe result'}]})

test('exact session spans join thinking, model wait, native turn and tool without making late timing a cursor rewrite',async()=>{
 const input=entry('input',null,text('user','public input'))
 const assistant=entry(model,'input',{role:'assistant',content:[{type:'thinking',thinking:'public thinking'},{type:'text',text:'public answer'},nativeTool(toolNativeId),nativeTool('unclosed')]})
 const answer=entry('tool-result',model,result(toolNativeId)),unclosed=entry('unclosed-result','tool-result',result('unclosed'))
 const snap=fixture([input,assistant,answer,unclosed])
 let trace=[]
 const readExecutionTiming=scope=>executionHistoryTiming({trace:{entries:trace}},scope)
 const options={task,executionActivity:true,readExecutionTiming,persistence:{readNative:async()=>snap},stream:true}
 const first=await taskSessionView(options)
 assert.ok(first.items.every(row=>!row.timing))
 trace=timingRows
 const next=await taskSessionView({...options,checkpoint:first.checkpoint})
 assert.equal(next.checkpoint,first.checkpoint)
 assert.deepEqual(next.items,[])
 const thinking=first.items.find(row=>row.kind==='thinking')
 assert.deepEqual(next.timingUpdates[thinking.id],{durationMs:12,modelWaitMs:15,modelDurationMs:30,turnDurationMs:85})
 const [good,bad]=first.items.filter(row=>row.kind==='tool-result')
 assert.deepEqual(next.timingUpdates[good.id],{durationMs:25})
 assert.equal(next.timingUpdates[bad.id],undefined)
 const full=await taskSessionView(options)
 assert.deepEqual(full.items.find(row=>row.id===thinking.id).timing,next.timingUpdates[thinking.id])
 assert.ok(!JSON.stringify(full).includes(toolNativeId))
 assert.ok((await taskSessionView({...options,executionActivity:false})).items.every(row=>!row.timing))
})

test('compaction cards keep native order, expose only proved metadata and guard independently scoped or edited summaries',async()=>{
 const input=entry('input',null,text('user','already public'))
 const summary='The prior user request was handled. We can continue.'
 const compact={id:'compaction',parentId:'input',timestamp:iso,type:'compaction',summary,tokensBefore:1000}
 const compactionView=project(compact,{role:'compactionSummary',summary,tokensBefore:1000})
 const snap=fixture([input,compact],[compactionView,project(input)])
 snap.header={...snap.header,runtimeOwner:'conversation-router',conversationId,generation:2}
 const persistence={readNative:async()=>snap}
 const evidence=[
  sample('compaction-completed','compaction',hash('bg'),1,{elapsedMs:180,compactionMode:'background'},
   {sessionId,runtimeOwner:'conversation-router',groupId:conversationId,generation:2}),
  sample('compaction-completed','compaction',hash('spoof'),1,{elapsedMs:9999,compactionMode:'foreground',tokensAfter:25},
   {sessionId,runtimeOwner:'conversation-router',groupId:conversationId,generation:3}),
 ]
 let trace=[]
 const readExecutionTiming=scope=>executionHistoryTiming({trace:{entries:trace}},scope)
 const options={conversationId,persistence,readRouter:async()=>({id:conversationId,activeSessionId:sessionId,generation:2}),readExecutionTiming,executionActivity:true}
 const read=()=>routerSessionView({...options,stream:true})
 const first=await read()
 trace=evidence
 const updated=await routerSessionView({...options,stream:true,checkpoint:first.checkpoint})
 assert.equal(updated.checkpoint,first.checkpoint)
 assert.deepEqual(updated.compactionUpdates[first.items[1].id],{mode:'background'})
 let view=await read(),[user,card]=view.items
 assert.equal(user.role,'user');assert.equal(card.kind,'compaction');assert.equal(card.text,summary)
 assert.deepEqual(card.timing,{durationMs:180})
 assert.deepEqual(card.compaction,{mode:'background',tokensBefore:1000})
 assert.equal((await routerSessionMessageView({...options,messageId:card.id,revision:view.revision})).text,summary)
 const privateTool=entry('private','input',{...result('private'),toolName:'memory_read'})
 compact.parentId='private';snap.entries.splice(1,0,privateTool)
 view=await read();card=view.items.find(row=>row.kind==='compaction')
 assert.equal(card.text,'');assert.equal(card.compaction.summaryHidden,true);assert.equal(card.textTotal,0)
 await assert.rejects(routerSessionMessageView({...options,messageId:card.id,revision:view.revision}),{code:'SESSION_MESSAGE_NOT_FOUND'})
 const system=entry('system','input',text('system','protected memory, skill and prompt context'))
 compact.parentId='system';snap.entries.splice(1,1,system)
 view=await read()
 assert.equal(view.items.find(row=>row.kind==='compaction').compaction.summaryHidden,true)
 assert.ok(!JSON.stringify(view).includes(summary))
 const mismatched=executionHistoryTiming({trace:{entries:trace}},{...routerIdentity,generation:1})
 assert.equal(mismatched.compaction('compaction'),undefined)
})
