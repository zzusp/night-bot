import {AsyncLocalStorage} from 'node:async_hooks'
import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {isDeepStrictEqual} from 'node:util'

const id=z.string().min(1).max(512)
const hash=z.string().regex(/^[a-f0-9]{64}$/)
const number=z.number().finite().nonnegative()
const timestamp=number.max(8640000000000000)
const usage=z.strictObject({input:number.optional(),output:number.optional(),cacheRead:number.optional(),cacheWrite:number.optional(),totalTokens:number.optional()})
export const AGENT_OBSERVATION_KINDS=Object.freeze(['input-admitted','model-started','model-first-token','model-completed','tool-started','tool-completed','run-settled','phase-completed'])
export const AGENT_PHASES=Object.freeze(['triage-total','workspace','session-create','session-resume','session-store-open','session-store-commit','session-admission-restore','session-state-restore','session-prepare-actor','session-resolve-resources','session-sdk-create','session-publish','session-bind-names','session-skills-bind','resources-create','resources-deliver','resources-before-run','before-run','memory-before-run','system-prompt','memory-prompt','context-projection','resources-turn-end','memory-bind','instructions','skills','sdk-reload','input-enqueue','input-acknowledge','request-prepare','request-guards','request-commit','request-sdk-prepare','triage-commit','session-dispose'])
export const traceSourcesSchema=z.array(z.strictObject({sourceId:id,sourceVersion:z.number().int().positive(),groupId:id})).max(100)
export const traceTaskEventsSchema=z.array(z.strictObject({taskId:id,eventId:id})).max(100)
export function traceSourcesMetadata(sources){const parsed=traceSourcesSchema.safeParse(sources.map(source=>({sourceId:source.sourceId,sourceVersion:source.version,groupId:source.groupId})));return parsed.success&&parsed.data.length?{traceSources:parsed.data}:{}}
export function traceTaskEventsMetadata(events){const parsed=traceTaskEventsSchema.safeParse(events.filter(event=>event.taskEvent?.taskId).map(event=>({taskId:event.taskEvent.taskId,eventId:event.taskEventId??event.id})));return parsed.success&&parsed.data.length?{traceTaskEvents:parsed.data}:{}}
export const agentObservationSchema=z.strictObject({
 version:z.literal(1),ownerId:id,runId:id,entryId:id.nullable(),spanId:hash,parentSpanId:hash.optional(),eventId:hash,
 kind:z.enum(AGENT_OBSERVATION_KINDS),timestamp,traceSources:traceSourcesSchema.optional(),traceTaskEvents:traceTaskEventsSchema.optional(),
 summary:z.strictObject({phase:z.enum(AGENT_PHASES).optional(),elapsedMs:number.optional(),isError:z.boolean().optional(),stopReason:z.enum(['stop','length','toolUse','error','aborted']).optional(),usage:usage.optional(),providerAttempted:z.boolean().optional(),inputBytes:z.number().int().nonnegative().optional(),sourceKind:z.enum(['coordinator','user','other']).optional(),outcome:z.enum(['completed','aborted','failed','unknown']).optional()}),
}).superRefine((value,ctx)=>{
 if(value.kind!=='input-admitted'&&(value.traceSources||value.traceTaskEvents))ctx.addIssue({code:'custom',message:'Trace links require committed input'})
 if(['input-admitted','model-completed'].includes(value.kind)&&value.entryId===null)ctx.addIssue({code:'custom',path:['entryId'],message:'Committed official entry required'})
 if(value.kind==='phase-completed'&&(value.summary.phase===undefined||value.summary.elapsedMs===undefined||!['completed','failed'].includes(value.summary.outcome)))ctx.addIssue({code:'custom',path:['summary'],message:'Host phase, duration and outcome required'})
 const allowed=value.kind==='phase-completed'?['phase','elapsedMs','outcome']:value.kind==='input-admitted'?['inputBytes','sourceKind']:value.kind==='model-completed'?['stopReason','usage','providerAttempted']:value.kind==='tool-completed'?['isError']:value.kind==='run-settled'?['outcome']:[]
 for(const key of Object.keys(value.summary))if(!allowed.includes(key))ctx.addIssue({code:'custom',path:['summary',key],message:'Metadata does not belong to this observation kind'})
 if(value.eventId!==agentObservationEventId(value))ctx.addIssue({code:'custom',path:['eventId'],message:'Observation identity mismatch'})
})

/** Native entry IDs establish completed-message idempotence. Other SDK signals
 * identify metadata spans only; these keys never become conversation sequences. */
export function agentObservationEventId({ownerId,runId,entryId,spanId,kind}){
 const key=['model-completed','input-admitted'].includes(kind)?[ownerId,entryId,kind]:[ownerId,runId,entryId,spanId,kind]
 return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}
export function makeAgentObservation(input){
 return agentObservationSchema.parse({...input,version:1,eventId:agentObservationEventId(input)})
}

/** Bind after the official SDK's own append and Night durability subscriber.
 * emit synchronously admits sanitized metadata to the application's observation
 * queue. No message body, provider chunk, tool name or private call ID escapes.
 * The public AgentSession settled signal spans Pi's own retries; low-level
 * agent_end is deliberately not treated as a completed application run.
 */
export function bindPiAgentObservation({actor,emit,onError=()=>{},clock=Date.now}){
 if(!(actor?.piSession instanceof AgentSession)||actor.piSession.sessionId!==actor.id||!Object.isFrozen(actor.metadata)||actor.metadata?.id!==actor.id||typeof emit!=='function'||typeof onError!=='function')throw new TypeError('Official actor and observation sink required')
 const session=actor.piSession,manager=session.sessionManager,spans=new Map(),sources=new Map(),reports=new Set()
 let runId,model,closed=false
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
 const live=()=>!closed&&actor.metadata.id===actor.id&&session.sessionId===actor.id&&actor.ctx.get('agents')?.get(actor.id)===actor
 const report=cause=>{try{const result=onError(cause);if(result?.then){const pending=Promise.resolve(result);reports.add(pending);void pending.finally(()=>reports.delete(pending)).catch(()=>{})}}catch{}}
 const send=(kind,entryId,spanId,summary={},links={})=>{
  if(!runId||!live())return
  const record=makeAgentObservation({ownerId:actor.id,runId,entryId,spanId,kind,timestamp:clock(),summary,...links})
  const result=emit(actor,record)
  if(result?.then){
   const pending=Promise.resolve(result).catch(report);reports.add(pending);void pending.finally(()=>reports.delete(pending)).catch(()=>{})
   throw Object.assign(new TypeError('Observation sink must synchronously enqueue'),{code:'AGENT_OBSERVATION_ASYNC_SINK'})
  }
 }
 function persisted(message){
  // Public entries retain object identity. Never guess by JSON equality or read
  // Pi's private message-to-entry map. A missing association stays unobserved.
  const matches=manager.getEntries().filter(entry=>entry.type==='message'?entry.message===message:entry.type==='custom_message'&&message.role==='custom'&&message.details&&entry.details===message.details&&entry.content===message.content&&entry.customType===message.customType)
  return matches.length===1?matches[0]:undefined
 }
 function start(){runId??=actor.admission?.current()?.id;if(typeof runId!=='string'||!runId)runId=undefined}
 const agentEvent=event=>{
  if(!live())return
  try{
   if(event.type==='agent_start')start()
   if(!runId)return
   if(event.type==='message_start'&&event.message.role==='assistant'){
    // Provider start is later than invocation of the official stream port.
    // Keep that earlier boundary; errors rejected before dispatch have no start.
    if(!model)model={spanId:hash([actor.id,runId,randomUUID()]),first:false,providerAttempted:false}
   }
   if(event.type==='message_update'&&event.message.role==='assistant'&&model&&!model.first&&['text_delta','thinking_delta','toolcall_delta'].includes(event.assistantMessageEvent?.type)){
    model.first=true;send('model-first-token',null,model.spanId)
   }
   if(event.type==='message_end'){
    const entry=persisted(event.message)
    if(!entry)return
    if(event.message.role==='assistant'){
     const spanId=model?.spanId??hash([actor.id,runId,entry.id,'missing-start']),summary={providerAttempted:model?.providerAttempted===true}
     if(['stop','length','toolUse','error','aborted'].includes(event.message.stopReason))summary.stopReason=event.message.stopReason
     if(event.message.usage){summary.usage={};for(const key of ['input','output','cacheRead','cacheWrite','totalTokens']){const value=event.message.usage[key];if(Number.isFinite(value)&&value>=0)summary.usage[key]=value}}
     send('model-completed',entry.id,spanId,summary)
     for(const block of event.message.content??[])if(block.type==='toolCall'&&typeof block.id==='string')sources.set(block.id,entry.id)
     model=undefined
    }else if(entry.type==='custom_message'&&entry.customType==='night.business-input'){
     const packet=actor.admission?.lookupPacket(entry.details?.packetId)
     if(packet&&isDeepStrictEqual(packet.source,entry.details.source)&&isDeepStrictEqual(packet.content,entry.content))send('input-admitted',entry.id,hash([actor.id,runId,entry.id]),{sourceKind:['coordinator','user'].includes(packet.source.kind)?packet.source.kind:'other',inputBytes:Buffer.byteLength(JSON.stringify(entry.content))},{...packet.source.traceSources?{traceSources:packet.source.traceSources}:{},...packet.source.traceTaskEvents?{traceTaskEvents:packet.source.traceTaskEvents}:{}})
    }
   }
   if(event.type==='tool_execution_start'||event.type==='tool_execution_end'){
    let span=spans.get(event.toolCallId);const entryId=sources.get(event.toolCallId)??null
    if(!span||span.entryId!==entryId){span={entryId,spanId:hash([actor.id,runId,entryId,event.toolCallId])};spans.set(event.toolCallId,span)}
    send(event.type==='tool_execution_start'?'tool-started':'tool-completed',span.entryId,span.spanId,event.type==='tool_execution_end'?{isError:event.isError===true}:{})
   }
  }catch(cause){report(cause)}
 }
 const sessionEvent=event=>{
  if(!live()||event.type!=='agent_settled')return
  try{
   start()
   // The public v1.5 SDK signal exposes aborted, not an outcome field. Read
   // only the presence of its public error state; never forward error text.
   const outcome=event.aborted===true?'aborted':session.agent.state.errorMessage!==undefined?'failed':event.aborted===false?'completed':'unknown'
   if(runId)send('run-settled',null,hash([actor.id,runId,'settled']),{outcome})
  }catch(cause){report(cause)}
  finally{runId=undefined;model=undefined;spans.clear();sources.clear()}
 }
 // Public SDK stream port invocation includes provider setup and time to its
 // first event. It is not an HTTP dispatch counter (providers may retry).
 const originalStream=session.agent.streamFunction
 const observedStream=function(...args){
  try{start();if(runId&&live()){model={spanId:hash([actor.id,runId,randomUUID()]),first:false,providerAttempted:true};send('model-started',null,model.spanId)}}catch(cause){report(cause)}
  return Reflect.apply(originalStream,this,args)
 }
 session.agent.streamFunction=observedStream
 const offAgent=session.agent.subscribe(agentEvent),offSession=session.subscribe(sessionEvent)
 return{async close(){if(!closed){closed=true;if(session.agent.streamFunction===observedStream)session.agent.streamFunction=originalStream;offAgent();offSession();spans.clear();sources.clear();model=undefined}await Promise.allSettled([...reports])}}
}

/** Host 计时只提交元数据；计量失败不能回滚业务或触发输入重放。 */
export function createAgentPhaseTimer({ownerId,emit,onError=()=>{},clock=Date.now,elapsed=()=>performance.now(),runId=()=>'host-lifecycle'}){
 const nesting=new AsyncLocalStorage()
 const report=cause=>{try{const result=onError(cause);if(result?.then)void Promise.resolve(result).catch(()=>{})}catch{}}
 return async(phase,operation)=>{
  const started=elapsed(),parentSpanId=nesting.getStore(),spanId=createHash('sha256').update(randomUUID()).digest('hex');let outcome='failed',phaseRunId='host-lifecycle'
  try{phaseRunId=runId()}catch(cause){report(cause)}
  try{const result=await nesting.run(spanId,operation);outcome='completed';return result}
  finally{
   try{
    const record=makeAgentObservation({ownerId,runId:phaseRunId,entryId:null,spanId,...parentSpanId?{parentSpanId}:{},kind:'phase-completed',timestamp:clock(),summary:{phase,elapsedMs:Math.max(0,elapsed()-started),outcome}})
    const result=emit(record)
    if(result?.then)void Promise.resolve(result).catch(report)
   }catch(cause){report(cause)}
  }
 }
}
