// Read-only projection of retained Host spans. Unlike first-reply timing these
// spans are not clipped at delivery. They include preparation and SDK retries.
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null
const metric=(status,shared=false)=>({status,durationMs:null,shared})
export function sourceStageMetric(source,stage){
 const rows=(source.stages??[]).filter(row=>row.stage===stage&&!row.phase)
 if(!rows.length)return metric('missing')
 const shared=rows.some(row=>row.shared===true),unique=new Map(),intervals=[]
 let open=false
 for(const row of rows){
  const start=instant(row.startedAt),end=instant(row.completedAt)
  if(start===null||row.completedAt!=null&&(end===null||end<start))return metric('invalid',shared)
  const key=row.spanId??JSON.stringify([row.startedAt,row.completedAt,row.requestId,row.attempt])
  const signature=JSON.stringify([row.startedAt,row.completedAt,row.shared===true])
  if(unique.has(key)&&unique.get(key)!==signature)return metric('invalid',shared)
  unique.set(key,signature)
  // A missing completion can also be a lost historical boundary. Do not infer
  // live execution or draw an elapsed-to-now duration from it.
  if(end===null)open=true
  else intervals.push([start,end])
 }
 if(open)return metric('running',shared)
 intervals.sort((a,b)=>a[0]-b[0])
 let durationMs=0,start=null,end=null
 for(const [from,to] of intervals){if(start===null){start=from;end=to}else if(from<=end)end=Math.max(end,to);else{durationMs+=end-start;start=from;end=to}}
 if(start!==null)durationMs+=end-start
 return {status:'recorded',durationMs,shared}
}
export function stageTiming(message,sources,groupId){
 const matches=sources.filter(row=>row.groupId===groupId&&row.messageId===message.messageId&&row.version===(message.messageVersion??1))
 if(matches.length!==1)return {receivedAt:null,triage:metric('missing'),router:metric('missing')}
 const source=matches[0]
 return {receivedAt:instant(source.receivedAt)===null?null:source.receivedAt,triage:sourceStageMetric(source,'triage'),router:sourceStageMetric(source,'router')}
}
