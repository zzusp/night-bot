import {redactFeedback} from './redaction.js'
import {AGENT_PHASES} from '../runtime/pi-agent-observation.js'
import {buildTraceLedger} from '../runtime/performance-trace.js'
import {responseTiming} from '../../packages/web-console/server/response-times.js'

const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null
const epoch=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=8640000000000000?new Date(value).toISOString():null
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null
const state=value=>['pending','committed','consumed','prepared','starting','delivered','unknown','failed','running','queued','completed','waiting','cancelled','paused','active','idle','open-or-missing-boundary','clock-order-unknown','observed'].includes(value)?value:null
const pickNumbers=(value,keys)=>Object.fromEntries(keys.map(key=>[key,number(value?.[key])]))
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()
const phases=new Set([...AGENT_PHASES,'ingress','queue','turn','host','send','readback','triage','router','source-read','resource-read','image-save','resident-store','source-record','task-commit','old-drain','materialize'])
const fail=()=>{throw new Error('FEEDBACK_EVIDENCE_SCOPE')}
/** Consent is enforced by the caller. No filesystem, command, network or mutation
 * capability is exposed. Private bodies are used for local matching only. */
export function createChainEvidence({application,description,secrets=[],getSessionPersistence}) {
 const sources=new Map(),tasks=new Map(),identities=new Map(),sessions=new Map(),pageCache=new Map();let calls=0,scans=0,groupsCache
 const identity=(kind,id)=>{if(!id)return null;const key=kind+':'+id;if(!identities.has(key))identities.set(key,kind+'-'+(identities.size+1));return identities.get(key)}
 const registerSession=(id,scope)=>{if(!id)return null;const alias=identity('session',id);const previous=sessions.get(alias);sessions.set(alias,{...previous,sessionId:id,...scope,windows:[...(previous?.windows??[]),...(scope.window?[scope.window]:[])]});return alias}
 const safeExcerpt=value=>{let text=redactFeedback(value,secrets);for(const [key,alias] of identities){const id=key.slice(key.indexOf(':')+1);if(id.length>=4)text=text.replaceAll(id,alias)}return text.slice(0,1000)}
 const app=()=>typeof application==='function'?application():application
 const query=(kind,args)=>app().tasks.store.query({kind,...args})
 const terms=[...new Set([...(String(description??'').matchAll(/[“「"]([^”」"\n]{4,500})[”」"]/g))].map(match=>normalize(match[1])))]
 if(!terms.length){const full=normalize(description).slice(0,2000);if(full.length>=4)terms.push(full);for(const part of full.split(/[，。！？：；,!?;:\n]/))if(part.trim().length>=6)terms.push(part.trim())}
 const sourceFor=alias=>{const value=sources.get(alias);if(!value)fail();return value}
 const taskFor=alias=>{const value=tasks.get(alias);if(!value)fail();return value}
 const addTask=row=>{const alias=identity('task',row.taskId);tasks.set(alias,{taskId:row.taskId,groupId:row.conversationId});return alias}
 const unavailable=reason=>({status:'unavailable',reason,complete:false})
 return async function collect(action,signal,args={}) {
  signal?.throwIfAborted();if(++calls>24)throw new Error('FEEDBACK_EVIDENCE_LIMIT')
  const service=app()?.tasks;if(!service?.store?.query)return unavailable('task-service-unavailable')
  let result
  if(action==='discover'){
   if(scans&&args.query===undefined)return {status:'already-scanned',candidates:[...sources.keys()],complete:false}
   if(scans>=3)throw new Error('FEEDBACK_DISCOVERY_LIMIT')
   if(args.query!==undefined){const text=normalize(args.query);if(text.length<4||text.length>500||!normalize(description).includes(text))fail();terms.splice(0,terms.length,text)}
   scans++
   if(!terms.length)return unavailable('no-specific-message-text-in-description')
   if(!service.listObserverGroups||!service.observerGroupPage)return unavailable('message-index-unavailable')
   const groups=groupsCache??=await service.listObserverGroups(),candidates=[];let inspected=0,groupsScanned=0,truncated=groups.length>20,failures=0
   for(const group of groups.slice(0,20)){
    groupsScanned++;let offset=0
    // Fair recent window per conversation, bounded in both rows and calls.
    while(offset<100&&inspected<2000){
     signal?.throwIfAborted();let page
     try{const key=JSON.stringify([group.groupId,offset]);if(pageCache.has(key))page=pageCache.get(key);else{page=await service.observerGroupPage(group.groupId,{collection:'messages',offset,limit:50,filter:'all'});pageCache.set(key,page)}}catch{failures++;break}
     if(!page)break
     inspected+=page.items.length
     const matches=page.items.filter(row=>{const body=normalize(row.text);return body&&terms.some(term=>body.includes(term)||term.includes(body)&&body.length>=8)})
     if(matches.length){
      const refs=matches.map(row=>({messageId:row.messageId,version:row.messageVersion??1}))
      const context=await query('observer.message-contexts',{groupId:group.groupId,messageIds:refs.map(row=>row.messageId),messages:refs})
      for(const row of matches){
       const exact=context.sources.filter(source=>source.messageId===row.messageId&&source.version===(row.messageVersion??1))
       if(exact.length!==1)continue
       const source=exact[0],alias=identity('message',source.sourceId+':'+source.version)
       if(sources.has(alias)||sources.size<10){sources.set(alias,{sourceId:source.sourceId,groupId:source.groupId,messageId:source.messageId,version:source.version});candidates.push({alias,conversation:identity('conversation',source.groupId),version:source.version,receivedAt:stamp(source.receivedAt),platformAt:stamp(source.timestamp),match:'literal-description-fragment'})}
       else if(sources.size>=10)truncated=true
      }
     }
     if(page.nextOffset==null)break
     if(page.nextOffset<=offset)break
     offset=page.nextOffset;if(offset>=100)truncated=true
    }
   }
   result={candidates,ambiguous:candidates.length>1,complete:false,coverage:'recent-indexed-messages-only',inspected,groupsScanned,truncated,unavailableGroups:failures,limits:{groups:20,messagesPerGroup:100,candidates:10},limitations:['no-match-does-not-prove-absence','candidates-are-not-automatic-selection','message-content-not-returned']}
  }else if(action==='message'){
   const ref=sourceFor(args.alias)
   const context=await query('observer.message-contexts',{groupId:ref.groupId,messageIds:[ref.messageId],messages:[{messageId:ref.messageId,version:ref.version}]})
   const source=context.sources.find(row=>row.sourceId===ref.sourceId&&row.version===ref.version)
   if(!source)return unavailable('selected-source-no-longer-retained')
   const recordedRouting=await query('router.source-status',{sourceId:ref.sourceId})
   const routing={triage:recordedRouting?.triage?.messageVersion!==undefined&&recordedRouting.triage.messageVersion!==ref.version?null:recordedRouting?.triage,event:recordedRouting?.event?.messageVersion!==undefined&&recordedRouting.event.messageVersion!==ref.version?null:recordedRouting?.event}
   const timing=responseTiming({messageId:ref.messageId,messageVersion:ref.version},[source],context.notifications??[],routing,{secrets,taskReplySources:context.taskReplySources??[]})
   ref.receivedAt=timing.receivedAt;ref.firstReplyAt=timing.firstReplyAt
   const links=(await query('router.source-links',{sourceId:ref.sourceId})).filter(row=>row.sourceId===ref.sourceId&&row.messageVersion===ref.version&&row.conversationId===ref.groupId)
   result={alias:args.alias,complete:false,platformAt:stamp(source.timestamp),receivedAt:stamp(timing.receivedAt),firstReplyAt:stamp(timing.firstReplyAt),durationMs:number(timing.durationMs),status:timing.status,
    steps:timing.steps.map(row=>({kind:row.kind,at:stamp(row.at),durationMs:number(row.durationMs),shared:row.shared===true,clipped:row.clipped===true,timingType:row.timingType})),
    triage:{state:state(routing?.triage?.state),needsHandling:typeof routing?.triage?.decision?.needsHandling==='boolean'?routing.triage.decision.needsHandling:null},router:{state:state(routing?.event?.state),createdAt:stamp(routing?.event?.createdAt),consumedAt:stamp(routing?.event?.consumedAt)},
    deliveries:(context.notifications??[]).filter(row=>row.payload?.conversationId===ref.groupId&&(row.payload.sourceId===ref.sourceId&&(row.payload.sourceVersion??row.payload.sourceRef?.messageVersion)===ref.version&&(row.payload.sourceRef?.messageId??row.payload.sourceMessageId)===ref.messageId||(context.taskReplySources??[]).some(link=>link.notificationId===row.id&&link.sourceId===ref.sourceId&&link.messageVersion===ref.version&&link.taskId===row.taskId))).slice(0,20).map(row=>({delivery:identity('delivery',row.id),state:state(row.state),createdAt:stamp(row.createdAt),sendStartedAt:stamp(row.sendStartedAt),deliveredAt:stamp(row.deliveredAt)})),
    tasks:links.slice(0,20).map(addTask),tasksTruncated:links.length>20,limitations:['host-receipt-is-not-platform-send','delivery-confirmation-is-not-client-render','missing-time-is-not-zero','shared-spans-must-not-be-summed']}
  }else if(action==='trace'){
   const ref=sourceFor(args.alias),offset=args.offset??0
   if(!Number.isSafeInteger(offset)||offset<0||offset>450)fail()
   if(!service.listExecutionTrace)return unavailable('execution-trace-unavailable')
   const trace=await service.listExecutionTrace({sourceId:ref.sourceId,sourceVersion:ref.version,groupId:ref.groupId,limit:15,offset})
   result={alias:args.alias,offset,nextOffset:Number.isSafeInteger(trace.nextOffset)&&trace.nextOffset<=450?trace.nextOffset:null,total:number(trace.total),complete:false,coverage:'retained-metadata-only',
    items:(trace.items??[]).slice(0,15).map(row=>({span:identity('span',row.spanId),parent:identity('span',row.parentSpanId),session:registerSession(row.sessionId,{groupId:ref.groupId,sourceId:ref.sourceId,sourceVersion:ref.version,window:Number.isFinite(row.startedAt)&&Number.isFinite(row.endedAt)?[row.startedAt,row.endedAt]:null}),kind:['model','tool','phase','source-stage'].includes(row.kind)?row.kind:null,
     phase:phases.has(row.phase)?row.phase:null,startedAt:epoch(row.startedAt),endedAt:epoch(row.endedAt),durationMs:Number.isFinite(row.startedAt)&&Number.isFinite(row.endedAt)&&row.endedAt>=row.startedAt?row.endedAt-row.startedAt:null,status:state(row.status),shared:(row.sourceLinks??[]).some(link=>link.shared===true)})),
    ledger:ref.receivedAt&&ref.firstReplyAt?{...buildTraceLedger(trace.items??[],{startedAt:Date.parse(ref.receivedAt),endedAt:Date.parse(ref.firstReplyAt)}),startedAt:stamp(ref.receivedAt),endedAt:stamp(ref.firstReplyAt),scope:'this-trace-page-only'}:null,
    retention:{dropped:number(trace.retention?.dropped),evictedFrom:epoch(trace.retention?.evictedFrom),evictedThrough:epoch(trace.retention?.evictedThrough)},limitations:['retention-may-omit-earlier-events','unobserved-time-is-not-idle','sdk-model-start-is-not-network-start','first-token-not-exposed-by-retained-span-api','overlapping-spans-must-not-be-summed','raw-tool-arguments-and-results-not-returned']}
  }else if(action==='task'){
   const ref=taskFor(args.alias),task=await query('task.get',{taskId:ref.taskId})
   if(!task||task.groupId!==ref.groupId)return unavailable('associated-task-no-longer-available')
   result={alias:args.alias,state:state(task.status),control:state(task.control),createdAt:stamp(task.createdAt),updatedAt:stamp(task.updatedAt),completedAt:stamp(task.completedAt),session:registerSession(task.sessionId,{groupId:ref.groupId,taskId:ref.taskId}),drained:task.drained===true,complete:false,limitations:['task-body-and-private-results-not-returned']}
  }else if(action==='journal'){
   const ref=sessions.get(args.alias),offset=args.offset??0
   if(!ref||!Number.isSafeInteger(offset)||offset<0||offset>180)fail()
   const persistence=getSessionPersistence?.()
   if(!persistence?.readNative)return unavailable('native-journal-unavailable')
   let snapshot
   try{snapshot=await persistence.readNative(ref.sessionId,{requireComplete:true,signal})}catch{return unavailable('native-journal-uncommitted-or-unavailable')}
   if(snapshot.header?.id!==ref.sessionId||!Array.isArray(snapshot.entries))return unavailable('native-journal-identity-unproven')
   const taskIdentities=(snapshot.audit??[]).filter(row=>row.domain==='task'&&row.kind==='identity')
   const validTask=ref.taskId&&taskIdentities.length===1&&taskIdentities[0].version===1&&taskIdentities[0].payload?.taskId===ref.taskId&&taskIdentities[0].payload?.sessionId===ref.sessionId
   const validConversation=!ref.taskId&&snapshot.header.conversationId===ref.groupId&&['conversation-router','channel-triage'].includes(snapshot.header.runtimeOwner)
   if(!validTask&&!validConversation)return unavailable('native-journal-owner-unproven')
   const toolNames=new Set(['bash','pwsh','read','read_window','write','edit','find','grep','web_fetch','web_search','job_output','job_list','job_kill','resident_task_action','resident_task_plan','resident_router_reply','resident_router_settle','task_result','memory_read','memory_remember','skill'])
   const rows=[],pending=new Map(),entries=new Map(snapshot.entries.map(entry=>[entry.id,entry]))
   for(const entry of snapshot.entries){
    signal?.throwIfAborted();if(entry.type!=='message')continue
    const message=entry.message
    if(message?.role==='assistant')for(const block of Array.isArray(message.content)?message.content:[]){if(block.type==='toolCall'&&typeof block.id==='string')pending.set(block.id,{entry,block})}
    if(message?.role!=='toolResult'||typeof message.toolCallId!=='string')continue
    let ancestor=entries.get(entry.parentId),call;const visited=new Set()
    while(ancestor&&!visited.has(ancestor.id)){visited.add(ancestor.id);const found=ancestor.message?.role==='assistant'&&Array.isArray(ancestor.message.content)?ancestor.message.content.find(block=>block.type==='toolCall'&&block.id===message.toolCallId):null;if(found){call={entry:ancestor,block:found};break}ancestor=entries.get(ancestor.parentId)}
    if(!call)continue
    if(!ref.taskId){const start=Date.parse(call.entry.timestamp),end=Date.parse(entry.timestamp);if(!ref.windows?.some(([a,b])=>Number.isFinite(start)&&Number.isFinite(end)&&start<=b&&end>=a))continue}
    pending.delete(message.toolCallId)
    const tool=toolNames.has(call.block.name)?call.block.name:'other'
    const content=Array.isArray(message.content)?message.content.filter(block=>block.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n'):''
    // Read/file/search outputs may be private documents. Only diagnostic lines
    // from execution tools, or explicitly errored tool results, are selected.
    const diagnostic=message.isError===true||['bash','pwsh','job_output'].includes(tool)?content.split('\n').filter(line=>/\b(?:error|failed|failure|timeout|timed out|exception|exit code|ENOENT|EACCES|ECONNREFUSED|SQLITE_BUSY)\b|错误|失败|超时|找不到/i.test(line)).slice(0,5).join('\n'):''
    rows.push({call:identity('call',message.toolCallId),tool,startedAt:stamp(call.entry.timestamp),endedAt:stamp(entry.timestamp),isError:message.isError===true,resultCharacters:content.length,diagnostic:safeExcerpt(diagnostic),truncated:diagnostic.length>1000,input:{timeoutMs:number(call.block.arguments?.timeoutMs??call.block.arguments?.timeout_ms),runInBackground:typeof call.block.arguments?.run_in_background==='boolean'?call.block.arguments.run_in_background:null},limitation:'diagnostic-lines-only-not-full-output'})
   }
   const items=rows.slice(offset,offset+5)
   result={alias:args.alias,items,total:rows.length,offset,nextOffset:offset+items.length<rows.length&&offset+items.length<=180?offset+items.length:null,complete:false,unmatchedToolCalls:pending.size,coverage:'committed-associated-session-tool-results',limitations:['source-journal-limited-to-observed-span-windows','no-user-or-assistant-prose','no-arbitrary-tool-arguments','diagnostic-lines-redacted-not-proof-of-no-sensitive-data','manual-preview-required-before-publishing']}
  }else fail()
  signal?.throwIfAborted();return result
 }
}
