import {z} from 'zod'
import {agentObservationSchema} from './pi-agent-observation.js'
export const TRACE_LIMIT=2048,TRACE_GLOBAL_LIMIT=4096
const id=z.string().min(1).max(512),time=z.number().finite().nonnegative().max(8640000000000000)
const identity=z.object({sessionId:id,generation:z.number().int().positive().optional(),taskId:id.optional(),groupId:id.optional(),runtimeOwner:z.enum(['channel-triage','conversation-router']).optional()})
export const sourceTraceStageSchema=z.object({sourceId:id,sourceVersion:z.number().int().positive(),groupId:id,sessionId:id.optional(),spanId:id,requestId:id,stage:z.enum(['ingress','queue','turn','host','send','readback','triage','router']),phase:z.enum(['source-read','resource-read','image-save','resident-store','source-record','task-commit','old-drain','materialize']).optional(),startedAt:time,completedAt:time.nullable(),shared:z.boolean()})
const traceEntry=z.discriminatedUnion('type',[z.object({type:z.literal('observation'),identity,observation:agentObservationSchema}),z.object({type:z.literal('source-stage'),stage:sourceTraceStageSchema})])
export const performanceTraceSchema=z.object({entries:z.array(traceEntry).max(TRACE_LIMIT),startedAt:time,dropped:z.number().int().nonnegative(),evictedFrom:time.nullable(),evictedThrough:time.nullable()})
export const traceEntryTime=entry=>entry.type==='observation'?entry.observation.timestamp:entry.stage.startedAt
export function evictTraceEntries(trace){const stamps=trace.entries.map(traceEntryTime);return stamps.length?{...trace,entries:[],dropped:trace.dropped+stamps.length,evictedFrom:Math.min(trace.evictedFrom??Infinity,...stamps),evictedThrough:Math.max(trace.evictedThrough??0,...stamps)}:trace}
function append(projection,entry){const at=traceEntryTime(entry),trace=projection.trace??={entries:[],startedAt:at,dropped:0,evictedFrom:null,evictedThrough:null};trace.entries.push(entry);while(trace.entries.length>TRACE_LIMIT){const stamp=traceEntryTime(trace.entries.shift());trace.dropped++;trace.evictedFrom=Math.min(trace.evictedFrom??stamp,stamp);trace.evictedThrough=Math.max(trace.evictedThrough??stamp,stamp)}}
export function appendObservationTrace(projection,scope,observation){append(projection,{type:'observation',identity:identity.parse(scope),observation})}
export function projectSourceTraceStage(previous,input,{owned=false}={}){
 const stage=sourceTraceStageSchema.parse(input),initial=previous??{observedSince:new Date().toISOString(),buckets:{},sessions:{}},projection=owned?initial:structuredClone(initial)
 const prior=projection.trace?.entries.find(entry=>entry.type==='source-stage'&&entry.stage.sourceId===stage.sourceId&&entry.stage.sourceVersion===stage.sourceVersion&&entry.stage.spanId===stage.spanId)
 if(prior){const {completedAt,...before}=prior.stage,{completedAt:next,...after}=stage;if(JSON.stringify(before)!==JSON.stringify(after)||completedAt!==null&&next!==completedAt)throw new Error('source_trace_identity_conflict');if(completedAt===next)return{projection:previous,created:false};prior.stage=stage}else append(projection,{type:'source-stage',stage})
 return{projection,created:true}
}
const union=intervals=>{const out=[];for(const [a,b]of intervals.sort((x,y)=>x[0]-y[0])){const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b])}return out}
const length=intervals=>intervals.reduce((n,[a,b])=>n+b-a,0)
export function buildTraceLedger(spans,{startedAt,endedAt}={}){
 const valid=Number.isFinite(startedAt)&&Number.isFinite(endedAt)&&startedAt>=0&&endedAt>=startedAt
 if(!valid)throw new Error('trace_window_invalid')
 const byKind={model:0,tool:0,phase:0};let covered=[],openOrInvalidSpans=0
 for(const kind of Object.keys(byKind)){const intervals=[];for(const span of spans.filter(s=>s.kind===kind)){if(!valid||!Number.isFinite(span.startedAt)||!Number.isFinite(span.endedAt)||span.endedAt<span.startedAt){openOrInvalidSpans++;continue}for(const [a,b]of span.scopeIntervals??[[span.startedAt,span.endedAt]]){if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<a){openOrInvalidSpans++;continue}const start=Math.max(a,startedAt),end=Math.min(b,endedAt);if(end>start)intervals.push([start,end])}}const combined=union([...covered,...intervals]);byKind[kind]=length(combined)-length(covered);covered=combined}
 return{startedAt:startedAt??null,endedAt:endedAt??null,wallMs:valid?endedAt-startedAt:null,coveredMs:valid?length(covered):null,unattributedMs:valid?endedAt-startedAt-length(covered):null,byKind,openOrInvalidSpans,complete:false,interpretation:'unattributed-is-unknown-not-idle'}
}
const key=(session,run)=>JSON.stringify([session,run])
const overlap=(span,root)=>span.startedAt!==null&&(root.completedAt===null||span.startedAt<=root.completedAt)&&(span.endedAt===null||span.endedAt>=root.startedAt)
export function listExecutionTrace(projections,filter={}){
 if(!['sessionId','taskId','groupId','sourceId'].some(k=>typeof filter[k]==='string'&&filter[k]))throw new Error('trace_scope_required')
 if(filter.sourceId!==undefined&&(!Number.isInteger(filter.sourceVersion)||filter.sourceVersion<1))throw new Error('trace_source_version_required')
 const limit=filter.limit??100,offset=filter.offset??0;if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0)throw new Error('trace_page_invalid')
 const spans=new Map(),admissions=[],roots=[],partitionOrders=new Map()
 for(const projection of projections){for(const [order,entry]of (projection.trace?.entries??[]).entries()){
  if(entry.type==='source-stage'){roots.push(entry.stage);continue}
  const {identity:scope,observation:o}=entry,k=JSON.stringify([scope.sessionId,o.runId,o.spanId]);partitionOrders.set(o.eventId,order)
  if(o.kind==='input-admitted'){admissions.push({scope,o,order});continue}
  const kind=o.kind.startsWith('model-')?'model':o.kind.startsWith('tool-')?'tool':o.kind==='phase-completed'?'phase':null;if(!kind)continue
  let row=spans.get(k);if(!row){row={...scope,spanId:o.spanId,runId:o.runId,parentSpanId:o.parentSpanId??null,kind,phase:o.summary.phase??null,startedAt:null,endedAt:null,clock:kind==='phase'?'host-wall-anchor-monotonic-duration':'host-wall-ms',status:'open-or-missing-boundary',sourceLinks:[],taskLinks:[],startOrder:null};spans.set(k,row)}
  if(o.kind.endsWith('-started')){row.startedAt=o.timestamp;row.startOrder=order}
  if(o.kind.endsWith('-completed'))row.endedAt=o.timestamp
  if(kind==='phase'){row.startedAt=Math.max(0,o.timestamp-o.summary.elapsedMs);row.parentSpanId=o.parentSpanId??null;row.outcome=o.summary.outcome}
 }}
 const taskRuns=new Set(admissions.filter(a=>a.o.traceTaskEvents?.some(ref=>ref.taskId===filter.taskId)).map(a=>key(a.scope.sessionId,a.o.runId)))
 const sourceRoots=roots.filter(r=>['sourceId','groupId','sessionId'].every(k=>filter[k]===undefined||r[k]===filter[k])&&(filter.sourceId===undefined||r.sourceVersion===filter.sourceVersion))
 const rows=[]
 for(const row of spans.values()){
  if(!['sessionId','groupId','runId'].every(k=>filter[k]===undefined||row[k]===filter[k]))continue
  if(filter.taskId!==undefined&&row.taskId!==filter.taskId&&!taskRuns.has(key(row.sessionId,row.runId)))continue
  row.status=row.startedAt===null||row.endedAt===null?'open-or-missing-boundary':row.endedAt<row.startedAt?'clock-order-unknown':'observed'
  const linked=roots.filter(r=>r.sessionId===row.sessionId&&(row.groupId===undefined||r.groupId===row.groupId)&&overlap(row,r)&&(r.requestId===row.runId||row.runtimeOwner==='channel-triage'))
  for(const root of linked)row.sourceLinks.push({sourceId:root.sourceId,sourceVersion:root.sourceVersion,groupId:root.groupId,stageSpanId:root.spanId,shared:root.shared,association:root.requestId===row.runId?'request':'shared-session-window'})
  // Concrete start events have retained ordering. Reconstructed phase starts do
  // not prove same-millisecond ordering, so ambiguous links remain unknown.
  const accepted=admissions.filter(a=>a.scope.sessionId===row.sessionId&&a.o.runId===row.runId&&row.startedAt!==null&&(a.o.timestamp<row.startedAt||a.o.timestamp===row.startedAt&&row.startOrder!==null&&a.order<=row.startOrder)).sort((a,b)=>a.o.timestamp-b.o.timestamp||a.order-b.order)
  row.taskLinks=accepted.flatMap(a=>(a.o.traceTaskEvents??[]).map(ref=>({...ref,inputEntryId:a.o.entryId})))
  const latest=new Map();for(const a of accepted)for(const ref of a.o.traceSources??[])latest.set(ref.sourceId,ref)
  for(const ref of latest.values())if(row.groupId===undefined||ref.groupId===row.groupId)row.sourceLinks.push({...ref,association:'admitted-input'})
  if(filter.sourceId!==undefined){row.sourceLinks=row.sourceLinks.filter(ref=>filter.groupId===undefined||ref.groupId===filter.groupId);const matches=row.sourceLinks.filter(ref=>ref.sourceId===filter.sourceId&&ref.sourceVersion===filter.sourceVersion);if(!matches.length)continue
   const windows=linked.filter(r=>r.sourceId===filter.sourceId&&r.sourceVersion===filter.sourceVersion);if(windows.length&&!matches.some(ref=>ref.association==='admitted-input')&&row.startedAt!==null&&row.endedAt!==null)row.scopeIntervals=union(windows.map(r=>[Math.max(row.startedAt,r.startedAt),Math.min(row.endedAt,r.completedAt??row.endedAt)]).filter(([a,b])=>b>=a))
  }
  row.sourceCorrelation=row.sourceLinks.length?'observed':'unknown'
  delete row.startOrder;rows.push(row)
 }
 if(filter.taskId===undefined&&filter.runId===undefined)for(const r of sourceRoots)rows.push({sessionId:r.sessionId??null,groupId:r.groupId,spanId:r.spanId,runId:r.requestId,parentSpanId:null,kind:'source-stage',sourceCorrelation:'observed',taskLinks:[],phase:r.phase??r.stage,startedAt:r.startedAt,endedAt:r.completedAt,clock:'host-wall-ms',status:r.completedAt===null?'open-or-missing-boundary':r.completedAt<r.startedAt?'clock-order-unknown':'observed',sourceLinks:[{sourceId:r.sourceId,sourceVersion:r.sourceVersion,groupId:r.groupId,stageSpanId:r.spanId,shared:r.shared,association:'source-stage'}]})
 rows.sort((a,b)=>(a.startedAt??a.endedAt??0)-(b.startedAt??b.endedAt??0)||a.spanId.localeCompare(b.spanId))
 const relevant=projections.filter(p=>p.trace?.entries.some(e=>e.type==='source-stage'?sourceRoots.some(r=>r.sourceId===e.stage.sourceId&&r.sourceVersion===e.stage.sourceVersion):filter.sourceId===undefined?['sessionId','groupId'].every(k=>filter[k]===undefined||e.identity[k]===filter[k])&&(filter.taskId===undefined||e.identity.taskId===filter.taskId||taskRuns.has(key(e.identity.sessionId,e.observation.runId))):sourceRoots.some(r=>r.sessionId===e.identity.sessionId)||e.observation.traceSources?.some(r=>r.sourceId===filter.sourceId&&r.sourceVersion===filter.sourceVersion)))
 const evicted=relevant.map(p=>p.trace).filter(t=>t.dropped),globalRetained=projections.reduce((n,p)=>n+(p.trace?.entries.length??0),0)
 return{items:structuredClone(rows.slice(offset,offset+limit)),total:rows.length,offset,limit,nextOffset:offset+limit<rows.length?offset+limit:null,coverage:'retained-metadata-only',complete:false,retention:{limitPerPartition:TRACE_LIMIT,limitGlobal:TRACE_GLOBAL_LIMIT,globalRetained,globalBudgetExceeded:globalRetained>TRACE_GLOBAL_LIMIT,globalBudgetPolicy:'enforced-on-successful-write',observedFrom:relevant.length?Math.min(...relevant.map(p=>p.trace.startedAt)):null,scopeHistoryUnknown:!relevant.length,dropped:evicted.reduce((n,t)=>n+t.dropped,0),evictedFrom:evicted.length?Math.min(...evicted.map(t=>t.evictedFrom)):null,evictedThrough:evicted.length?Math.max(...evicted.map(t=>t.evictedThrough)):null},limitations:['not-business-authority','no-historical-backfill','unobserved-time-is-not-idle','source-session-window-is-shared-not-exclusive','wall-clock-skew-not-corrected'],...(filter.startedAt!==undefined||filter.endedAt!==undefined?{ledger:buildTraceLedger(rows,filter)}:{})}
}
