// Read only the existing bounded Host metadata trace for the current Router.
// Phase elapsedMs is measured with a monotonic clock; trace ends are wall anchors.
const phases=new Set(['foreground-compaction','background-compaction'])
export function compactionSamples(rows,{conversationId,sessionId,limit=8}){
 const scoped=[...new Map(rows.filter(row=>row.groupId===conversationId&&row.sessionId===sessionId&&row.runtimeOwner==='conversation-router'&&row.kind==='phase').map((row,index)=>[typeof row.spanId==='string'?JSON.stringify([row.runId,row.spanId]):index,row])).values()]
 const attempts=scoped.filter(row=>phases.has(row.phase)).sort((a,b)=>(a.startedAt??Infinity)-(b.startedAt??Infinity))
 return attempts.map((row,index)=>{
  const valid=Number.isFinite(row.startedAt)&&Number.isFinite(row.endedAt)&&row.startedAt>=0&&row.endedAt>=row.startedAt&&row.status==='observed'
  let status=!valid?'invalid':row.outcome==='failed'?'failed':row.outcome==='completed'?'recorded':'unconfirmed'
  if(valid&&row.phase==='background-compaction'){
   const next=attempts.slice(index+1).find(next=>next.phase==='background-compaction'),markers=scoped.filter(marker=>marker.runId===row.runId&&marker.outcome==='completed'&&marker.status==='observed'&&Number.isFinite(marker.endedAt))
   // Cancellation during this attempt is not a successful context update.
   const cancelled=markers.some(marker=>marker.phase==='background-compaction-cancelled'&&marker.endedAt>=row.startedAt&&marker.endedAt<=row.endedAt)
   // Background compute success alone does not prove adoption. Missing or
   // ambiguous retained adoption boundaries stay unknown instead of successful.
   const adopted=markers.filter(marker=>marker.phase==='background-compaction-adopted'&&marker.endedAt>=row.endedAt&&(!next||marker.endedAt<next.startedAt))
   if(cancelled)status='cancelled'
   else if(status==='recorded'&&adopted.length!==1)status='unconfirmed'
  }
  return {receivedAt:valid?new Date(row.endedAt).toISOString():null,compaction:{status,durationMs:valid?row.endedAt-row.startedAt:null,shared:false}}
 }).sort((a,b)=>(a.receivedAt===null?-Infinity:Date.parse(a.receivedAt))-(b.receivedAt===null?-Infinity:Date.parse(b.receivedAt))).slice(-limit).reverse()
}
export async function routerCompactionTimes(tasks,conversationId,limit){
 if(!tasks?.store?.query||!tasks.listExecutionTrace)return {status:'unavailable',items:[]}
 const row=await tasks.store.query({kind:'router.get',conversationId})
 if(!row?.activeSessionId)return {status:'ready',items:[]}
 if(row.id!==conversationId||!Number.isSafeInteger(row.generation)||row.generation<1)return {status:'unavailable',items:[]}
 const rows=[];let offset=0
 for(;;){
  let page
  try{page=await tasks.listExecutionTrace({groupId:conversationId,sessionId:row.activeSessionId,offset,limit:500})}
  catch(error){if(error.code!=='SESSION_NOT_FOUND')throw error;page={items:[],nextOffset:null}}
  if(page.diagnostics?.available===false)return {status:'unavailable',items:[]}
  rows.push(...page.items)
  if(page.nextOffset===null)break
  if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw Object.assign(Error('COMPACTION_TIMES_UNAVAILABLE'),{code:'COMPACTION_TIMES_UNAVAILABLE'})
  offset=page.nextOffset
 }
 const current=await tasks.store.query({kind:'router.get',conversationId})
 if(current?.activeSessionId!==row.activeSessionId||current.generation!==row.generation)return {status:'unavailable',items:[]}
 return {status:'ready',items:compactionSamples(rows,{conversationId,sessionId:row.activeSessionId,limit}),coverage:'retained-host-compaction-phases'}
}
