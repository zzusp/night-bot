import {diagnosticQueryFailure} from './diagnostic-contract.js'
import {AGENT_PHASES} from '../runtime/pi-agent-observation.js'
import {buildTraceLedger} from '../runtime/performance-trace.js'
import {responseTiming} from '../../packages/web-console/server/response-times.js'

const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null
const epoch=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=8640000000000000?new Date(value).toISOString():null
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null
const state=value=>['pending','committed','consumed','prepared','starting','delivered','unknown','failed','running','queued','completed','waiting','cancelled','paused','active','inactive','idle','open-or-missing-boundary','clock-order-unknown','observed'].includes(value)?value:null
const pickNumbers=(value,keys)=>Object.fromEntries(keys.map(key=>[key,number(value?.[key])]))
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()
const phases=new Set([...AGENT_PHASES,'ingress','queue','turn','host','send','readback','triage','router','source-read','resource-read','image-save','resident-store','source-record','task-commit','old-drain','materialize'])
const fail=(code='FEEDBACK_EVIDENCE_SCOPE')=>{throw Object.assign(new Error(code),{code})}
/** Consent is enforced by the caller. No filesystem, command, network or mutation
 * capability is exposed. Private bodies are used for local matching only. */
export function createChainEvidence({application,title='',description,secrets=[],getSessionPersistence,getSchedule}) {
 const sources=new Map(),tasks=new Map(),schedules=new Map(),conversations=new Map(),identities=new Map(),sessions=new Map(),pageCache=new Map();let calls=0,groupsCache
 const identity=(kind,id)=>{if(!id)return null;const key=kind+':'+id;if(!identities.has(key))identities.set(key,kind+'-'+(identities.size+1));return identities.get(key)}
 const conversation=id=>{const alias=identity('conversation',id);if(alias)conversations.set(alias,id);return alias}
 const registerSession=(id,scope)=>{if(!id)return null;const alias=identity('session',id);const previous=sessions.get(alias);sessions.set(alias,{...previous,sessionId:id,...scope,windows:[...(previous?.windows??[]),...(scope.windows??(scope.window?[scope.window]:[]))]});return alias}
 const app=()=>typeof application==='function'?application():application
 const query=(kind,args)=>app().tasks.store.query({kind,...args})
 const input=[title,description].filter(Boolean).join('\n'),terms=[...new Set([...input.matchAll(/[“「"]([^”」"\n]{1,500})[”」"]/g)].map(match=>normalize(match[1])))]
 if(!terms.length)for(const part of [title,description,...String(description??'').split(/[，。！？：；,!?;:\n]/)]){const term=normalize(part);if(term)terms.push(term)}
 const matches=value=>{const body=normalize(value);return body&&terms.some(term=>body.includes(term)||term.includes(body)&&body.length>=8)}
 const sourceFor=alias=>{const value=sources.get(alias);if(!value)fail('FEEDBACK_ALIAS_INVALID');return value}
 const taskFor=alias=>{const value=tasks.get(alias);if(!value)fail('FEEDBACK_ALIAS_INVALID');return value}
 const addTask=row=>{const alias=identity('task',row.taskId);tasks.set(alias,{taskId:row.taskId,groupId:row.groupId??row.conversationId});return alias}
 const addSource=(source,match='literal-description-fragment')=>{const alias=identity('message',source.sourceId+':'+source.version);sources.set(alias,{sourceId:source.sourceId,groupId:source.groupId,messageId:source.messageId,version:source.version});return {alias,conversation:conversation(source.groupId),version:source.version,receivedAt:stamp(source.receivedAt),platformAt:stamp(source.timestamp),match}}
 const unavailable=reason=>({status:'unavailable',reason,complete:false})
 return async function collect(action,signal,args={}) {
  signal?.throwIfAborted();if(++calls>24)fail('FEEDBACK_EVIDENCE_LIMIT')
  const service=app()?.tasks
  if(!service?.store?.query&&action!=='schedule'&&action!=='discover')return unavailable('task-service-unavailable')
  let result
  if(action==='discover'){
   if(args.query!==undefined){const text=normalize(args.query);if(!text||text.length>500||![title,description].some(value=>normalize(value).includes(text)))fail('FEEDBACK_QUERY_INVALID');terms.splice(0,terms.length,text)}
   const start=args.offset??0
   if(!Number.isSafeInteger(start)||start<0)fail('FEEDBACK_OFFSET_INVALID')
   if(args.target!==undefined&&!['messages','tasks','schedules'].includes(args.target))fail()
   if(args.alias!==undefined&&(!conversations.has(args.alias)||args.target&&args.target!=='messages'))fail('FEEDBACK_ALIAS_INVALID')
   if(!terms.length)return unavailable('no-specific-text-in-description')
   const candidates=[],taskCandidates=[],scheduleCandidates=[],continuations=[],failures=[]
   let inspected=0,groupsScanned=0,inspectedTasks=0,inspectedSchedules=0
   const failed=(target,error)=>{signal?.throwIfAborted();failures.push({target,...diagnosticQueryFailure(error)})}
   if(!args.alias&&(!args.target||args.target==='tasks')){
    if(!service?.store?.query)failures.push({target:'tasks',...unavailable('task-service-unavailable')})
    else try{
     const catalog=await query('task.list',{archived:'all'}),rows=catalog.filter(row=>[row.title,row.request].some(matches));inspectedTasks=catalog.length
     for(const row of rows.slice(start,start+10))taskCandidates.push({alias:addTask(row),conversation:conversation(row.groupId),state:state(row.status),createdAt:stamp(row.createdAt),match:'literal-description-fragment'})
     if(start+10<rows.length)continuations.push({target:'tasks',offset:start+10})
    }catch(error){failed('tasks',error)}
   }
   if(!args.alias&&(!args.target||args.target==='schedules')){
    const schedule=getSchedule?.()
    if(!schedule?.catalog)failures.push({target:'schedules',...unavailable('schedule-service-unavailable')})
    else try{
     const catalog=await schedule.catalog(),rows=catalog.filter(row=>[row.title,row.prompt].some(matches));inspectedSchedules=catalog.length
     for(const row of rows.slice(start,start+10)){const alias=identity('schedule',row.id);schedules.set(alias,{id:row.id,sessionId:row.sessionId});scheduleCandidates.push({alias,kind:['at','after','every','daily','weekly','cron'].includes(row.kind)?row.kind:null,state:state(row.status),scheduledAt:stamp(row.scheduledAt),match:'literal-description-fragment'})}
     if(start+10<rows.length)continuations.push({target:'schedules',offset:start+10})
    }catch(error){failed('schedules',error)}
   }
   if(!args.target||args.target==='messages'){
    if(!service?.store?.query||!service.listObserverGroups||!service.observerGroupPage)failures.push({target:'messages',...unavailable('message-index-unavailable')})
    else try{
     const groups=groupsCache??=await service.listObserverGroups(),selected=args.alias?[{groupId:conversations.get(args.alias)}]:groups.slice(start,start+20)
     if(!args.alias&&start+20<groups.length)continuations.push({target:'messages',offset:start+20})
     for(const group of selected){
      const alias=conversation(group.groupId),first=args.alias?start:0;groupsScanned++;let offset=first
      if(candidates.length>=10){continuations.push({target:'messages',alias,offset});continue}
      try{
       // 每次只读一段；返回准确游标，旧消息可在后续调用继续定位。
       while(offset<first+100){
        signal?.throwIfAborted();const key=JSON.stringify([group.groupId,offset]);let page=pageCache.get(key)
        if(!page){page=await service.observerGroupPage(group.groupId,{collection:'messages',offset,limit:50,filter:'all'});if(page)pageCache.set(key,page)}
        if(!page)break
        const matched=page.items.filter(row=>matches(row.text)),refs=matched.map(row=>({messageId:row.messageId,version:row.messageVersion??1}))
        const context=refs.length?await query('observer.message-contexts',{groupId:group.groupId,messageIds:refs.map(row=>row.messageId),messages:refs}):{sources:[]}
        let consumed=0
        for(const row of page.items){
         if(candidates.length>=10)break
         consumed++;inspected++
         if(!matches(row.text))continue
         const exact=context.sources.filter(source=>source.groupId===group.groupId&&source.messageId===row.messageId&&source.version===(row.messageVersion??1))
         if(exact.length===1)candidates.push(addSource(exact[0]))
        }
        if(consumed<page.items.length){continuations.push({target:'messages',alias,offset:offset+consumed});break}
        if(page.nextOffset==null)break
        if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)fail('FEEDBACK_OFFSET_INVALID')
        offset=page.nextOffset
        if(offset>=first+100||candidates.length>=10){continuations.push({target:'messages',alias,offset});break}
       }
      }catch(error){failed('messages',error)}
     }
    }catch(error){failed('messages',error)}
   }
   result={candidates,taskCandidates,scheduleCandidates,ambiguous:candidates.length+taskCandidates.length+scheduleCandidates.length>1,complete:false,coverage:'indexed-messages-and-task-schedule-catalogs',inspected,groupsScanned,inspectedTasks,inspectedSchedules,truncated:continuations.length>0,continuations,failures,unavailableGroups:failures.filter(row=>row.target==='messages').length,limitations:['no-match-does-not-prove-absence','candidates-are-not-automatic-selection','message-content-not-returned','deleted-schedules-not-in-catalog']}
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
   if(!Number.isSafeInteger(offset)||offset<0||offset>450)fail('FEEDBACK_OFFSET_INVALID')
   if(!service.listExecutionTrace)return unavailable('execution-trace-unavailable')
   const trace=await service.listExecutionTrace({sourceId:ref.sourceId,sourceVersion:ref.version,groupId:ref.groupId,limit:15,offset})
   result={alias:args.alias,offset,nextOffset:Number.isSafeInteger(trace.nextOffset)&&trace.nextOffset<=450?trace.nextOffset:null,total:number(trace.total),complete:false,coverage:'retained-metadata-only',
    items:(trace.items??[]).slice(0,15).map(row=>({span:identity('span',row.spanId),parent:identity('span',row.parentSpanId),session:registerSession(row.sessionId,{groupId:ref.groupId,sourceId:ref.sourceId,sourceVersion:ref.version,windows:row.scopeIntervals??(Number.isFinite(row.startedAt)&&Number.isFinite(row.endedAt)?[[row.startedAt,row.endedAt]]:[])}),kind:['model','tool','phase','source-stage'].includes(row.kind)?row.kind:null,
     phase:phases.has(row.phase)?row.phase:null,startedAt:epoch(row.startedAt),endedAt:epoch(row.endedAt),durationMs:Number.isFinite(row.startedAt)&&Number.isFinite(row.endedAt)&&row.endedAt>=row.startedAt?row.endedAt-row.startedAt:null,status:state(row.status),shared:(row.sourceLinks??[]).some(link=>link.shared===true)})),
    ledger:ref.receivedAt&&ref.firstReplyAt?{...buildTraceLedger(trace.items??[],{startedAt:Date.parse(ref.receivedAt),endedAt:Date.parse(ref.firstReplyAt)}),startedAt:stamp(ref.receivedAt),endedAt:stamp(ref.firstReplyAt),scope:'this-trace-page-only'}:null,
    retention:{dropped:number(trace.retention?.dropped),evictedFrom:epoch(trace.retention?.evictedFrom),evictedThrough:epoch(trace.retention?.evictedThrough)},limitations:['retention-may-omit-earlier-events','unobserved-time-is-not-idle','sdk-model-start-is-not-network-start','first-token-not-exposed-by-retained-span-api','overlapping-spans-must-not-be-summed','raw-tool-arguments-and-results-not-returned']}
  }else if(action==='task'){
   const ref=taskFor(args.alias),task=await query('task.get',{taskId:ref.taskId})
   if(!task||task.groupId!==ref.groupId)return unavailable('associated-task-no-longer-available')
   const links=(await query('router.source-links',{taskId:ref.taskId})).filter(row=>row.taskId===ref.taskId&&row.conversationId===ref.groupId),linkedSources=[]
   for(const link of links.slice(0,20)){
    const source=await query('source.get',{sourceId:link.sourceId})
    if(source?.groupId===ref.groupId&&source.version===link.messageVersion)linkedSources.push(addSource(source,'associated-task-source'))
   }
   result={alias:args.alias,state:state(task.status),control:state(task.control),createdAt:stamp(task.createdAt),updatedAt:stamp(task.updatedAt),completedAt:stamp(task.completedAt),session:registerSession(task.sessionId,{groupId:ref.groupId,taskId:ref.taskId}),drained:task.drained===true,sources:linkedSources,sourcesTruncated:links.length>20,complete:false,limitations:['task-body-and-private-results-not-returned']}
  }else if(action==='schedule'){
   const ref=schedules.get(args.alias);if(!ref)fail('FEEDBACK_ALIAS_INVALID')
   const schedule=getSchedule?.();if(!schedule?.catalog)return unavailable('schedule-service-unavailable')
   const row=(await schedule.catalog()).find(row=>row.id===ref.id&&row.sessionId===ref.sessionId)
   if(!row)return unavailable('selected-schedule-no-longer-retained')
   const kind=['at','after','every','daily','weekly','cron'].includes(row.kind)?row.kind:null
   // 仅暴露原生合同中的时间参数，不公开指令，也不猜测其中的停止条件。
   result={alias:args.alias,kind,recurring:kind?['every','daily','weekly','cron'].includes(kind):null,state:state(row.status),scheduledAt:stamp(row.scheduledAt),timing:{afterSeconds:number(row.afterSeconds),everySeconds:number(row.everySeconds),time:row.time??null,timeZone:row.timeZone??null,weekdays:row.weekdays??null,expression:row.expression??null},lastDelivery:row.lastDelivery?{deliveredAt:stamp(row.lastDelivery.deliveredAt),scheduledAt:stamp(row.lastDelivery.scheduledAt)}:null,stopCondition:'not-a-structured-schedule-field',complete:false,limitations:['prompt-and-private-identities-not-returned','stop-condition-in-prompt-not-verified','deleted-schedules-not-in-catalog','accepted-delivery-is-not-business-completion']}
  }else if(action==='journal'){
   const ref=sessions.get(args.alias),offset=args.offset??0
   if(!ref)fail('FEEDBACK_ALIAS_INVALID')
   if(!Number.isSafeInteger(offset)||offset<0||offset>180)fail('FEEDBACK_OFFSET_INVALID')
   const persistence=getSessionPersistence?.()
   if(!persistence?.readNative)return unavailable('native-journal-unavailable')
   let snapshot
   try{snapshot=await persistence.readNative(ref.sessionId,{requireComplete:true,signal})}catch{signal?.throwIfAborted();return unavailable('native-journal-uncommitted-or-unavailable')}
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
    while(ancestor&&!visited.has(ancestor.id)){visited.add(ancestor.id);const matches=ancestor.message?.role==='assistant'&&Array.isArray(ancestor.message.content)?ancestor.message.content.filter(block=>block.type==='toolCall'&&block.id===message.toolCallId):[];if(matches.length){if(matches.length===1&&message.toolName===matches[0].name)call={entry:ancestor,block:matches[0]};break}ancestor=entries.get(ancestor.parentId)}
    if(!call)continue
    if(!ref.taskId){const start=Date.parse(call.entry.timestamp),end=Date.parse(entry.timestamp);if(!ref.windows?.some(([a,b])=>Number.isFinite(start)&&Number.isFinite(end)&&start<=b&&end>=a))continue}
    pending.delete(message.toolCallId)
    const tool=toolNames.has(call.block.name)?call.block.name:'other'
    const content=Array.isArray(message.content)?message.content.filter(block=>block.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n'):''
    // Read/file/search outputs may be private documents. Only diagnostic lines
    // from execution tools, or explicitly errored tool results, are selected.
    const knownCodes=new Set(['ENOENT','EACCES','EPERM','ECONNREFUSED','ECONNRESET','ETIMEDOUT','SQLITE_BUSY','SQLITE_LOCKED','MODEL_REQUEST_FAILED','CHANNEL_ADAPTER_ERROR','AUTH_REQUIRED','BOT_NOT_READY'])
    const errorCodes=[...new Set(content.match(/\b[A-Z][A-Z0-9_]{2,64}\b/g)??[])].filter(code=>knownCodes.has(code)).slice(0,12)
    const categories=[['timeout',/\b(?:timeout|timed out)\b|超时/i],['permission',/\b(?:permission denied|access denied)\b/i],['not-found',/\b(?:not found|no such file)\b/i],['connection',/\bconnection (?:refused|reset)\b/i]].filter(([,pattern])=>pattern.test(content)).map(([label])=>label)
    const exitMatch=content.match(/\bexit(?:ed)?(?: with)?(?: code)?[: ]+(-?\d{1,3})\b/i),httpMatch=content.match(/\bHTTP(?:\/\d(?:\.\d)?)?\s+(?:status[: ]+)?([45]\d{2})\b/i)
    rows.push({call:identity('call',message.toolCallId),tool,startedAt:stamp(call.entry.timestamp),endedAt:stamp(entry.timestamp),isError:message.isError===true,resultCharacters:content.length,diagnostic:{errorCodes,categories,exitCode:exitMatch?Number(exitMatch[1]):null,httpStatus:httpMatch?Number(httpMatch[1]):null,unsharedText:content.length>0},input:{timeoutMs:number(call.block.arguments?.timeoutMs??call.block.arguments?.timeout_ms),runInBackground:typeof call.block.arguments?.run_in_background==='boolean'?call.block.arguments.run_in_background:null},limitation:'structured-error-evidence-only-result-text-not-disclosed'})
   }
   const items=rows.slice(offset,offset+5)
   result={alias:args.alias,items,total:rows.length,offset,nextOffset:offset+items.length<rows.length&&offset+items.length<=180?offset+items.length:null,complete:false,unmatchedToolCalls:pending.size,coverage:'committed-associated-session-tool-results',limitations:['source-journal-limited-to-observed-span-windows','no-user-or-assistant-prose','no-arbitrary-tool-arguments','unrecognized-error-details-withheld-not-absence-of-error','manual-preview-required-before-publishing']}
  }else fail()
  signal?.throwIfAborted();return result
 }
}
