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

test('Router uses each admitted source-less or deduplicated packet boundary without exposing it', async()=>{
 const from=offset=>new Date(Date.parse(iso)+offset).toISOString()
 const source={sourceId:'INTERNAL_REPEAT_ID',version:1,conversationId,text:'One visible source'}
 const snap={header:{id:sessionId,runtimeOwner:'conversation-router',conversationId,generation:2}, entries:[], audit:[], context:{projection:{entries:[]}}}
 const add=(row,...messages)=>{snap.entries.push(row);snap.context.projection.entries.push(project(row,...messages))}
 const packet=(id,at,events,admit=true)=>{
  const details={packetId:'PRIVATE_PACKET_'+id,source:{kind:'conversation-router',conversationId,generation:2}}
  const content=[{type:'text',text:'Router 请求：'+JSON.stringify({conversationId,generation:2,events})}]
  const row={id,type:'custom_message',customType:'night.business-input',timestamp:from(at),details,content}
  add(row,{role:'custom',customType:row.customType,timestamp:from(at+500),details,content})
  snap.audit.push({version:1,domain:'admission',kind:id==='internal-b'?'enqueued-internal':'enqueued',payload:{id:details.packetId,source:details.source,content}})
  if(admit)snap.audit.push({version:1,domain:'admission',kind:'admitted',payload:{id:details.packetId,entryId:id}})
 }
 const report=(id,at)=>{
  add({...entry(id+'-call',null,{role:'assistant',content:[{type:'thinking',thinking:'Review'},nativeTool(id,'resident_router_reply')].map(block=>block.type==='toolCall'?{...block,arguments:{text:'Report '+id}}:block)}),timestamp:from(at-250)})
  add({...entry(id+'-result',null,{role:'toolResult',toolName:'resident_router_reply',toolCallId:id,isError:false,content:[{type:'text',text:'{"accepted":true}'}]}),timestamp:from(at)})
 }
 packet('source-a',0,[{source}])
 report('a',250)
 packet('internal-b',5000,[{kind:'task.event',title:'INTERNAL_TASK_TITLE'}])
 report('b',6300)
 packet('repeated-c',10000,[{source}])
 report('c',12600)
 packet('open-d',19000,[{kind:'task.event'}])
 add({...entry('open-tool',null,{role:'assistant',content:[nativeTool('open')]}),timestamp:from(21000)})
 packet('no-proof',22000,[{kind:'task.event'}],false)
 const readRouter=async()=>({id:conversationId,activeSessionId:sessionId,generation:2}), persistence={readNative:async()=>snap}
 const opts={conversationId,readRouter,persistence,stream:true,executionActivity:true}
 const page=await routerSessionView(opts)
 const boundaries=page.items.filter(row=>row.kind==='router-packet-boundary')
 assert.deepEqual(boundaries.map(row=>[row.text,row.createdAt,row.source.sessionId]),[[ '',from(5000),sessionId],['',from(10000),sessionId],['',from(19000),sessionId]])
 assert.equal(page.items.filter(row=>row.text===source.text).length,1)
 assert.doesNotMatch(JSON.stringify(page),/PRIVATE_PACKET|INTERNAL_TASK_TITLE|INTERNAL_REPEAT_ID/)
 assert.deepEqual((await routerSessionView({...opts,checkpoint:page.checkpoint})).items,[])
 await assert.rejects(routerSessionMessageView({...opts,messageId:boundaries[0].id,revision:page.revision}),{code:'SESSION_MESSAGE_NOT_FOUND'})
 const {executionTurns}=await import('../src/execution-turns.ts')
 const turns=executionTurns(page.items)
 assert.deepEqual(turns.filter(row=>row.kind==='turn').map(turn=>[turn.complete,turn.durationMs]),[[true,250],[true,1300],[true,2600],[false,undefined]])
 assert.ok(!turns.some(row=>row.kind==='standalone'&&row.row.message.kind==='router-packet-boundary'))
 const {searchExecutionRecords}=await import('../src/execution-search.ts')
 assert.ok(!searchExecutionRecords(page.items,'助手').some(row=>boundaries.some(boundary=>boundary.id===row.id)))
})
