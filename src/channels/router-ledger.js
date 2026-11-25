import {triageHandoff,routerTriageConclusion} from './triage-conclusion.js'
import {inspectionIsCurrent,taskWaitIdentity,MIN_WAIT_RECHECK_MS} from '../tasks/inspection.js'
import {queryTaskIndex,queryReplyHistory} from './conversation-context.js'
import {createHash} from 'node:crypto'
import {blockedReplyId,completionReplyId,currentOutcomeBinding,isOutcomeChannelSource,isTaskOutcome,outcomeOriginId,suppressChannelOutcome} from './router-task-context.js'
import {querySourceHistory,queryCurrentSource,sourceHistorySchema} from './source-history.js'
import {normalizeRouterHandoff,recordRouterHandoff,ROUTER_HANDOFF_POLICY} from './router-handoff.js'

export const routerSchemaVersion = '1'
export const routerTables = ['conversations','router_inbox','triage','source_links','dependencies','completion_evaluations','router_rotations','router_actions','router_upgrade_audit']
export const routerSchema = routerTables.map(name => `CREATE TABLE IF NOT EXISTS dynamic_${name}(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(json_valid(body)));`).join('\n') + `
${sourceHistorySchema}
CREATE INDEX IF NOT EXISTS dynamic_source_link_task ON dynamic_source_links(json_extract(body,'$.taskId'),json_extract(body,'$.conversationId'));
CREATE INDEX IF NOT EXISTS dynamic_source_link_source ON dynamic_source_links(json_extract(body,'$.conversationId'),json_extract(body,'$.sourceId'));
CREATE UNIQUE INDEX IF NOT EXISTS dynamic_router_event ON dynamic_router_inbox(json_extract(body,'$.conversationId'),json_extract(body,'$.eventId'));
CREATE UNIQUE INDEX IF NOT EXISTS dynamic_dependency_pair ON dynamic_dependencies(json_extract(body,'$.taskId'),json_extract(body,'$.prerequisiteTaskId'));
`
// 以派生索引筛出还需要核对的行，不为巡检解码整份 Router 历史。
const outcomeCandidates = `json_extract(body,'$.trackOutcome')=1 AND json_extract(body,'$.suppressChannelOutcome') IS NOT 1
 AND (json_extract(body,'$.state')='pending' OR json_extract(body,'$.state')='consumed' AND json_extract(body,'$.outcomeDisposition.kind')='not-reported')`
export const routerOutcomeInspectionIndex = `CREATE INDEX IF NOT EXISTS dynamic_router_outcome_inspection
 ON dynamic_router_inbox(json_extract(body,'$.state'),json_extract(body,'$.createdAt')) WHERE ${outcomeCandidates};`
const fail = code => { throw Object.assign(new Error(code), {code}) }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const required = value => typeof value === 'string' && value.length ? value : fail('ROUTER_ARGUMENT_INVALID')
const bounded = (value, max = 15) => Number.isSafeInteger(value ?? max) && (value ?? max) > 0 && (value ?? max) <= max ? value ?? max : fail('ROUTER_ARGUMENT_INVALID')

// 仅由任务账本事务调用；不持有第二个数据库或模型历史。
export function createRouterLedger({db, get, put, all, reduce, wake, saveTask, blockers, taskHumanWait, digest}) {
  const rows = name => all(`dynamic_${name}`)
  const read = (name, id, optional = false) => get(`dynamic_${name}`, id, optional)
  const write = (name, row) => put(`dynamic_${name}`, row)
  const changed = result => ({result, dispatchEligible:false})
  function readEvent(id){
    const found=db.prepare('SELECT body FROM dynamic_task_events WHERE id=? UNION ALL SELECT body FROM dynamic_archived_task_events WHERE id=?').all(id,id)
    if(found.length>1)fail('ROUTER_EVENT_IDENTITY_CONFLICT')
    return found.length?JSON.parse(found[0].body):null
  }
  // 复用现有会话/消息/版本索引，不能为每条候选反复解码全部来源正文。
  const newerSource = db.prepare("SELECT 1 FROM dynamic_sources WHERE json_extract(body,'$.groupId')=? AND json_extract(body,'$.messageId')=? AND json_extract(body,'$.version')>? LIMIT 1")
  const latest = source => !newerSource.get(source.groupId,source.messageId,source.version)
  function sourceOf(a, scheduling = false) {
    const source = read('sources', required(a.sourceId))
    if (source.version !== a.messageVersion || !scheduling && (!latest(source) || source.authorizationRevoked || source.triageHold || source.archiveRestoreHold)) fail('ROUTER_SOURCE_STALE')
    if (a.conversationId !== undefined && source.groupId !== a.conversationId) fail('ROUTER_CONVERSATION_SCOPE')
    return source
  }
  function conversationOf(a, business = true) {
    const row = read('conversations', required(a.conversationId))
    if (a.generation !== undefined && row.generation !== a.generation || business && row.phase !== 'active') fail('ROUTER_GENERATION_STALE')
    return row
  }
  function enqueue(conversationId, eventId, payload) {
    const id = `router-event:${hash([conversationId,eventId])}`
    const prior = read('router_inbox', id, true)
    if (prior) return prior
    const row = {id,conversationId,eventId,...payload,state:'pending',createdAt:new Date().toISOString()}
    write('router_inbox',row)
    return row
  }
  function routeSource(source){
    if(source.routed)return changed({source})
    sourceOf({sourceId:source.sourceId,messageVersion:source.version,conversationId:source.groupId})
    const event=enqueue(source.groupId,`source:${source.sourceId}`,{kind:'source.message',sourceId:source.sourceId,messageVersion:source.version,directRouter:true})
    source.routed=true;source.routedAt=new Date().toISOString();source.routeReceipt={kind:'router',eventId:event.id};write('sources',source)
    return changed({source,routerEvents:[event]})
  }
  function triageConclusion(event,source){
    if(event.triageDecisionId===undefined)return undefined // Never backfill old/in-flight packets.
    const row=read('triage',event.triageDecisionId,true),decision=row?.decision
    if(!row||row.id!==`triage:${event.sourceId}`||row.state!=='committed'||row.conversationId!==event.conversationId||row.sourceId!==event.sourceId||row.messageVersion!==event.messageVersion||decision?.sourceId!==row.sourceId||decision.messageVersion!==row.messageVersion||decision.needsHandling!==true)fail('ROUTER_TRIAGE_BINDING_INVALID')
    const value={decisionId:row.id,conversationId:row.conversationId,sourceId:row.sourceId,messageVersion:row.messageVersion,...triageHandoff(decision.handoff)}
    return routerTriageConclusion({...event,source,triageConclusion:value})
  }
  const pendingInbox = (conversationId, deliverable) => rows('router_inbox').filter(row=>row.conversationId===conversationId&&row.state==='pending'&&(!deliverable||!row.deliveryHold))
  const sourceLinks=db.prepare("SELECT body FROM dynamic_source_links WHERE json_extract(body,'$.conversationId')=? AND json_extract(body,'$.sourceId')=? AND json_extract(body,'$.messageVersion')=?")
  const heldReplies=db.prepare(`SELECT body FROM (SELECT body FROM dynamic_notifications UNION ALL SELECT body FROM dynamic_archived_notifications)
    WHERE json_extract(body,'$.payload.conversationId')=? AND json_extract(body,'$.payload.sourceId')=?
    AND coalesce(json_extract(body,'$.payload.sourceVersion'),json_extract(body,'$.payload.sourceRef.messageVersion'))=?`)
  function heldSource(row){
    if(row?.state!=='pending'||row.kind!=='source.message'||!row.deliveryHold)return
    const source=read('sources',row.sourceId,true)
    if(source?.groupId===row.conversationId&&source.version===row.messageVersion&&source.channel!=='internal'
      &&!source.retracted&&!source.authorizationRevoked&&!source.triageHold&&!source.archiveRestoreHold&&latest(source))return source
  }
  function heldEvidence(row){
    const args=[row.conversationId,row.sourceId,row.messageVersion]
    return {
      tasks:sourceLinks.all(...args).map(({body})=>JSON.parse(body)).flatMap(link=>{
        const task=read('tasks',link.taskId,true)
        return task?.groupId===row.conversationId?[{taskId:task.taskId,relation:link.relation,status:task.status}]:[]
      }),
      replies:heldReplies.all(...args).map(({body})=>JSON.parse(body)).map(n=>({notificationId:n.id,kind:n.kind,state:n.state,purpose:n.payload.replyPurpose}))
    }
  }
  function mayReleaseHold(row){
    // Only clear the restriction belonging to the checked hold, never a separate unknown effect.
    const released=new Set(row.heldReviews?.filter(review=>review.decision==='continue').map(review=>review.handoffId))
    return rows('router_rotations').every(rotation=>rotation.conversationId!==row.conversationId
      ||rotation.id===row.deliveryHold.handoffId||released.has(rotation.id)||!rotation.recovery?.unknownSourceIds.includes(row.sourceId))
  }
  function independentSource(pending, excluded){
    return pending.find(row=>{
      if(excluded.has(row.id)||row.kind!=='source.message')return false
      const source=read('sources',row.sourceId,true)
      return source?.groupId===row.conversationId&&source.version===row.messageVersion&&!source.authorizationRevoked&&!source.retracted&&!source.triageHold&&!source.archiveRestoreHold&&latest(source)
    })
  }
  function inboxEvent(row){
    const source=row.sourceId?read('sources',row.sourceId):undefined,conclusion=triageConclusion(row,source)
    return {...row,source,triageReply:row.triageReplyId?read('notifications',row.triageReplyId):undefined,taskEvent:row.taskEventId?readEvent(row.taskEventId):undefined,...conclusion?{triageConclusion:conclusion}:{}}
  }
  function sourceOnlyTask(task,source,quote,resetSelection=false){
    if(source.channel==='internal'||task.metadata?.routerInputPolicy===ROUTER_HANDOFF_POLICY)return
    if(resetSelection&&task.metadata)delete task.metadata.routerSourceSelection
    task.metadata={...task.metadata,routerInputPolicy:'source-only-v1',...quote?{routerSourceSelection:{sourceId:source.sourceId,messageVersion:source.version,quote}}:{}}
  }
  function dependenciesReady(task) {
    return rows('dependencies').filter(row => row.taskId === task.taskId).every(row => {
      const prior = read('tasks',row.prerequisiteTaskId,true), authorization = read('sources',row.authorizationSourceId,true)
      return row.state === 'satisfied' && !row.archiveRestoreHold && row.requirementRevision === task.requirementRevision
        && row.controlRevision === task.controlRevision && row.arrangementRevision === (task.arrangementRevision ?? 1)
        && prior?.status === 'completed' && prior.drained && prior.control === 'active' && prior.requirementRevision === row.prerequisiteRequirementRevision
        && !taskHumanWait(prior) && !blockers(prior.taskId).operations.length
        && authorization?.version === row.authorizationSourceVersion
    })
  }
  function link(task, source, relation, anchor) {
    if (anchor !== undefined && (typeof anchor !== 'string' || !anchor || !source.text.includes(anchor))) fail('ROUTER_SOURCE_ANCHOR_INVALID')
    const id = `source-link:${hash([task.taskId,source.sourceId,source.version,relation,anchor ?? null])}`
    write('source_links',{id,taskId:task.taskId,conversationId:source.groupId,sourceId:source.sourceId,messageVersion:source.version,relation,anchor:anchor ?? null})
  }
  function dependency(task,input,source,graph) {
    const prior=read('tasks',required(input.prerequisiteTaskId))
    if(task.taskId===prior.taskId||task.conversationId!==source.groupId||prior.conversationId!==source.groupId||prior.control==='cancelled')fail('ROUTER_DEPENDENCY_INVALID')
    required(input.condition)
    const seen=new Set()
    const visit=id=>{if(id===task.taskId)fail('ROUTER_DEPENDENCY_CYCLE');if(seen.has(id))return;seen.add(id);for(const row of graph.filter(row=>row.taskId===id))visit(row.prerequisiteTaskId)}
    visit(prior.taskId)
    const id=`dependency:${hash([task.taskId,prior.taskId])}`
    if(graph.some(row=>row.taskId===task.taskId&&row.prerequisiteTaskId===prior.taskId))fail('ROUTER_DEPENDENCY_EXISTS')
    return {id,dependencyId:id,taskId:task.taskId,conversationId:source.groupId,prerequisiteTaskId:prior.taskId,prerequisiteRequirementRevision:prior.requirementRevision,requirementRevision:task.requirementRevision,controlRevision:task.controlRevision,arrangementRevision:task.arrangementRevision??1,authorizationSourceId:source.sourceId,authorizationSourceVersion:source.version,condition:input.condition,state:'pending'}
  }
  function arrange(task,action,source,operationId,commandId) {
    if(action.expectedArrangementRevision!==(task.arrangementRevision??1))fail('ROUTER_ARRANGEMENT_STALE')
    if(!Array.isArray(action.dependencies)||action.dependencies.length>30)fail('ROUTER_DEPENDENCIES_REQUIRED')
    const previousDependencies=rows('dependencies').filter(row=>row.taskId===task.taskId)
    const previousEvaluations=rows('completion_evaluations').filter(row=>row.taskId===task.taskId)
    const previousArrangementRevision=task.arrangementRevision??1
    task.arrangementRevision=previousArrangementRevision+1
    const graph=rows('dependencies').filter(row=>row.taskId!==task.taskId),dependencies=[]
    for(const input of action.dependencies){const row=dependency(task,input,source,[...graph,...dependencies]);dependencies.push(row)}
    // 原件先冻结进任务自己的审计事件；移除的条件和评估不再充当活动执行权限。
    for(const row of previousDependencies)db.prepare('DELETE FROM dynamic_dependencies WHERE id=?').run(row.id)
    for(const row of previousEvaluations)db.prepare('DELETE FROM dynamic_completion_evaluations WHERE id=?').run(row.id)
    for(const row of dependencies)write('dependencies',row)
    task.sourceRefs=[...new Set([...(task.sourceRefs??[]),source.sourceId])]
    task.appliedOperations=[...new Set([...(task.appliedOperations??[]),operationId])]
    saveTask(task);link(task,source,'task.arrange',action.quote)
    taskEvent({id:`task-arranged:${commandId}`,kind:'task.arranged',taskId:task.taskId,operationId,sourceId:source.sourceId,messageVersion:source.version,previousArrangementRevision,arrangementRevision:task.arrangementRevision,previousDependencies,previousEvaluations,dependencies})
    wake(task.taskId,'task.arrange',{arrangementRevision:task.arrangementRevision},`wake:${commandId}`)
    return changed({task,dependencies})
  }
  function taskEvent(event) {
    const task = read('tasks',event.taskId,true)
    if (task?.conversationId) {
      const outcome=isTaskOutcome(event)
      const muted=outcome&&(event.suppressChannelOutcome===true||suppressChannelOutcome(task))
      const outcomePolicy=muted?{suppressChannelOutcome:true}:{}
      if(!readEvent(event.id))db.prepare('INSERT INTO dynamic_task_events(id,body) VALUES (?,?)').run(event.id,JSON.stringify({...event,...outcomePolicy,eventVersion:1,requirementRevision:task.requirementRevision,controlRevision:task.controlRevision,recordedAt:new Date().toISOString()}))
      // 普通等待只保留审计；已排空的技术失败复用自己的巡检事件回报。
      const inspectionReport=event.kind==='task.blocked'&&event.resultSource!=='pi-task-result'&&(task.technicalFailure||task.sessionFailure
        ||task.lastDecision?.limitations?.some(code=>['TASK_SESSION_NO_SUBMISSION','TASK_EFFECT_UNCERTAIN_NO_REPLAY','TASK_JOB_UNCERTAIN_NO_REPLAY'].includes(code)))
      if(event.kind==='task.waiting'||inspectionReport)return
      return enqueue(task.conversationId,event.id,{kind:event.kind,taskId:task.taskId,taskEventId:event.id,...outcome?{trackOutcome:true}:{},...outcomePolicy})
    }
  }
  function outcomeDisposition(row,event){
    if(row.suppressChannelOutcome===true||event?.suppressChannelOutcome===true)return {kind:'channel-delivery-suppressed'}
    const task=read('tasks',row.taskId,true),binding=currentOutcomeBinding(task,event,row.conversationId)
    if(!binding)return {kind:'superseded'}
    const sources=(task.sourceRefs??[]).map(id=>read('sources',id,true)).filter(Boolean)
    const ids=event.kind==='task.completed'?sources.map(source=>completionReplyId(row.conversationId,event.id,source.sourceId,source.version))
      :[blockedReplyId(row.conversationId,event.id)]
    for(const id of ids){
      const notice=read('notifications',id,true),p=notice?.payload,b=p?.completionBinding??p?.blockedBinding
      if(b?.eventId===event.id&&b.taskId===task.taskId&&p.conversationId===row.conversationId&&(!p.taskDelivery||p.taskDelivery.taskId===task.taskId))return {kind:'notification-frozen',notificationId:id}
    }
    const origin=sources.find(source=>source.sourceId===outcomeOriginId(task))
    if(!isOutcomeChannelSource(origin,row.conversationId)||origin.actorId!==task.ownerActorId||origin.authorizationRevoked||origin.retracted||origin.triageHold||origin.archiveRestoreHold||!latest(origin))return {kind:'channel-source-unavailable'}
    return {kind:'not-reported'}
  }
  function inspectOutcomes(overdueBefore){
    const candidates=db.prepare(`SELECT body FROM dynamic_router_inbox WHERE ${outcomeCandidates}
      AND (json_extract(body,'$.state')='consumed' OR json_type(body,'$.deliveryHold')='object'
        OR json_extract(body,'$.createdAt')<=?)`).all(required(overdueBefore))
    return candidates.flatMap(({body})=>{
      const row=JSON.parse(body),event=row.taskEventId&&readEvent(row.taskEventId)
      if(!event||row.eventId!==event.id||outcomeDisposition(row,event).kind!=='not-reported')return []
      const code=row.deliveryHold?'ROUTER_OUTCOME_HELD':row.state==='consumed'?'ROUTER_OUTCOME_NOT_REPORTED':'ROUTER_OUTCOME_OVERDUE'
      return [{id:'router-outcome:'+row.id,code,taskEventId:event.id,conversationId:row.conversationId,taskId:row.taskId,at:row.createdAt}]
    })
  }
  function taskMutation(kind, task, {sameGoal,previousRequirementRevision}={}) {
    for(const row of rows('dependencies').filter(row=>row.taskId===task.taskId)) {
      row.state='pending';row.requirementRevision=task.requirementRevision;row.controlRevision=task.controlRevision;row.arrangementRevision=task.arrangementRevision??1;delete row.evaluationId;write('dependencies',row)
    }
    if(kind==='task.reopen'&&sameGoal===true)for(const row of rows('dependencies').filter(row=>row.prerequisiteTaskId===task.taskId&&row.prerequisiteRequirementRevision===previousRequirementRevision)) {
      if(row.state==='satisfied'&&!read('tasks',row.taskId).drained)continue
      row.prerequisiteRequirementRevision=task.requirementRevision;row.state='pending';delete row.evaluationId;write('dependencies',row)
    }
  }
  function operation(a, action) {
    const id = `router-action:${hash([a.conversationId,required(a.operationId)])}`
    // generation 是执行栅栏，不是业务幂等身份。
    const {generation,sessionId,agent,hostLiveBinding,inputSource, ...request} = a
    const prior = read('router_actions',id,true), requestDigest = digest(request)
    if (prior) { if (prior.requestDigest !== requestDigest) fail('ROUTER_OPERATION_CONFLICT'); return changed(prior.result) }
    const value = action()
    write('router_actions',{id,conversationId:a.conversationId,operationId:a.operationId,requestDigest,result:value.result})
    return value
  }
  function resume(task, action, source, a, commandId) {
    if(action.expectedContextRevision!==(task.contextRevision??0))fail('DYNAMIC_TASK_CONTEXT_STALE')
    const request=task.humanRequests?.find(item=>item.requestId===required(action.humanRequestId))
    if(!request||request.status!=='waiting-reply'||request.requirementRevision!==task.requirementRevision||request.controlRevision!==task.controlRevision)fail('DYNAMIC_HUMAN_REQUEST_STALE')
    if(task.archivedAt||task.status!=='active'||task.control!=='active'||!task.drained||task.recovering||task.archiveRestore?.reviewRequired)fail('ROUTER_TASK_RESUME_NOT_QUIESCENT')
    if(request.executionBindings?.length)fail('ROUTER_HUMAN_REQUEST_SCOPE')
    const stamp=new Date().toISOString()
    if(!['im','chat','chat-room','web'].includes(source.channel))fail('ROUTER_HUMAN_RESPONSE_SOURCE_INVALID')
    const reason=required(action.reason).trim()
    if(!reason)fail('ROUTER_ARGUMENT_INVALID')
    // 补充、原等待的结清和可靠 wake 共用当前 SQLite 事务；不另开执行角色。
    const result=reduce('task.supplement',action,commandId),current=result.result.task
    const answered=current.humanRequests.find(item=>item.requestId===request.requestId)
    Object.assign(answered,{status:'answered',reply:source.text,sourceId:source.sourceId,actorId:source.actorId,answeredAt:stamp,replyChannel:source.channel,
      resolution:{kind:'router',reason,evidence:[source.sourceId],conversationId:a.conversationId,generation:a.generation,operationId:a.operationId,recordedAt:stamp}})
    current.lastDecision=null
    saveTask(current)
    return result
  }
  function command(kind, a, commandId) {
    if(kind==='router.lookup.submit'){
      conversationOf(a);sourceOf(a)
      return operation(a,()=>{
        if(!Array.isArray(a.taskIds)||!a.taskIds.length||a.taskIds.length>3||new Set(a.taskIds).size!==a.taskIds.length)fail('ROUTER_LOOKUP_ARGUMENT_INVALID')
        for(const taskId of a.taskIds){const task=read('tasks',required(taskId),true);if(!task||task.groupId!==a.conversationId)fail('ROUTER_LOOKUP_TASK_SCOPE')}
        const pending=rows('router_actions').filter(row=>row.result?.lookup?.state==='pending')
        if(pending.length>=2||pending.some(row=>row.conversationId===a.conversationId))fail('ROUTER_LOOKUP_CAPACITY')
        const id=`router-action:${hash([a.conversationId,a.operationId])}`
        return changed({lookup:{id,conversationId:a.conversationId,sourceId:a.sourceId,messageVersion:a.messageVersion,taskIds:a.taskIds,state:'pending',createdAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+30000).toISOString()}})
      })
    }
    if(kind==='router.lookup.complete'){
      const row=read('router_actions',required(a.lookupId)),lookup=row.result?.lookup
      if(!lookup||row.conversationId!==a.conversationId)fail('ROUTER_LOOKUP_SCOPE')
      if(lookup.state!=='pending')return changed({lookup})
      if(!['completed','failed','timed-out','interrupted'].includes(a.status))fail('ROUTER_LOOKUP_RESULT_INVALID')
      const source=read('sources',lookup.sourceId,true)
      const fresh=source&&source.groupId===a.conversationId&&source.version===lookup.messageVersion&&latest(source)&&!source.retracted&&!source.authorizationRevoked&&!source.triageHold&&!source.archiveRestoreHold
      lookup.state=fresh?a.status:'discarded';lookup.completedAt=new Date().toISOString()
      if(a.status==='completed'&&fresh){
        if(typeof a.summary!=='string'||!a.summary.trim()||a.summary.length>4000||!Array.isArray(a.limitations)||a.limitations.length>4||a.limitations.some(text=>typeof text!=='string'||text.length>300)||!Array.isArray(a.snapshots)||a.snapshots.length!==lookup.taskIds.length||new Set(a.snapshots.map(row=>row.taskId)).size!==lookup.taskIds.length)fail('ROUTER_LOOKUP_RESULT_INVALID')
        for(const snap of a.snapshots){const task=read('tasks',snap.taskId,true);if(!lookup.taskIds.includes(snap.taskId)||!task||task.groupId!==a.conversationId)fail('ROUTER_LOOKUP_SCOPE');if(task.requirementRevision!==snap.requirementRevision||task.controlRevision!==snap.controlRevision||(task.contextRevision??0)!==snap.contextRevision||(task.runSequence??0)!==snap.runSequence||task.status!==snap.status||(task.leaseEpoch??0)!==snap.leaseEpoch)lookup.state='stale'}
        if(lookup.state==='completed')lookup.result={summary:a.summary,limitations:a.limitations,snapshots:a.snapshots}
      }
      write('router_actions',row)
      const event=fresh?enqueue(a.conversationId,'lookup:'+lookup.id,{kind:'router.lookup.completed',lookupResult:{lookupId:lookup.id,sourceId:lookup.sourceId,messageVersion:lookup.messageVersion,state:lookup.state,completedAt:lookup.completedAt,...lookup.result??{}}}):undefined
      return changed({lookup,...event?{event}:{}})
    }
    if(kind==='router.operator.enqueue'){
      const requestId=required(a.requestId),actorId=required(a.actorId)
      if(typeof a.text!=='string'||!a.text.trim()||a.text.length>8000)fail('ROUTER_OPERATOR_TEXT_INVALID')
      const event=enqueue(required(a.conversationId),'operator:'+hash([actorId,requestId]),{kind:'operator.message',operator:{requestId,actorId,text:a.text,destination:'web'}})
      if(digest(event.operator)!==digest({requestId,actorId,text:a.text,destination:'web'}))fail('ROUTER_OPERATOR_REQUEST_CONFLICT')
      return changed({requestId,eventId:event.id,status:'accepted',webOnly:true})
    }
    if(kind==='router.operator.reply'){
      conversationOf(a)
      const event=read('router_inbox',required(a.eventId))
      if(event.conversationId!==a.conversationId||event.kind!=='operator.message'||event.operator?.destination!=='web'||event.state!=='pending')fail('ROUTER_OPERATOR_EVENT_FORBIDDEN')
      if(typeof a.text!=='string'||!a.text.trim()||a.text.length>8000)fail('ROUTER_OPERATOR_TEXT_INVALID')
      const reused=!!event.operatorReply
      event.operatorReply??={text:a.text,actorId:event.operator.actorId,createdAt:new Date().toISOString()};write('router_inbox',event)
      return changed({accepted:true,webOnly:true,reused,text:event.operatorReply.text})
    }
    if(kind==='router.timeout.defer'){
      const row=conversationOf(a)
      if(a.sessionId!==row.activeSessionId)fail('ROUTER_GENERATION_STALE')
      const {eventIds}=a
      if(!Array.isArray(eventIds)||!eventIds.length||eventIds.length>30||new Set(eventIds).size!==eventIds.length)fail('ROUTER_EVENTS_REQUIRED')
      for(const id of eventIds){
        const event=read('router_inbox',id)
        if(event.conversationId!==row.id||event.state!=='pending'||event.deliveryHold)fail('ROUTER_RESUME_BATCH_STALE')
      }
      const checkpoint={packetId:required(a.packetId),failedEntryId:required(a.failedEntryId),eventIds}
      if(row.timeoutContinuation&&digest(row.timeoutContinuation)!==digest(checkpoint))fail('ROUTER_RESUME_BATCH_STALE')
      row.timeoutContinuation=checkpoint;write('conversations',row);return changed({conversation:row})
    }
    if(kind==='router.recovery-attempt'){
      const row=read('conversations',a.conversationId)
      if(row.generation!==a.generation)fail('ROUTER_GENERATION_STALE')
      const prior=row.recoveryRetry
      const attempts=prior?.key===a.key&&!prior.exhausted?prior.attempts+1:1
      row.recoveryRetry={key:required(a.key),attempts,nextAttemptAt:new Date(Date.now()+(attempts>=3?300000:5000*6**(attempts-1))).toISOString(),exhausted:attempts>=3}
      write('conversations',row);return changed({conversation:row})
    }
    if (kind === 'source.record-direct') {
      const input={...(a.source ?? a)},prior=read('sources',input.sourceId,true)
      const type=a.conversation?.type
      if(prior&&a.conversation?.conversationId===input.groupId&&['chat','chat-room'].includes(type)&&((prior.channel==='im'&&input.channel===type)||(input.channel==='im'&&prior.channel===type)))input.channel=prior.channel
      const result = reduce('source.record',input,commandId)
      const source = result.result.source
      if (!source) return result
      // 新消息版本要求 Router 重新判断既有安排，不把原作者变成 Router 的调度许可人。
      if(!prior)for(const row of rows('dependencies')){
        const original=read('sources',row.authorizationSourceId)
        if(original.groupId===source.groupId&&original.messageId===source.messageId&&original.version<source.version){row.state='pending';delete row.evaluationId;write('dependencies',row)}
      }
      if(source.retracted){
        for(const previous of rows('sources').filter(row=>row.groupId===source.groupId&&row.messageId===source.messageId)){
          if(previous.actorId!==source.actorId)fail('DYNAMIC_SOURCE_CONFLICT')
          previous.authorizationRevoked=true
          if(previous.sourceId===source.sourceId){previous.routed=true;previous.routedAt??=new Date().toISOString();previous.routeReceipt={kind:'message-retracted'}}
          write('sources',previous)
        }
        return changed({source:read('sources',source.sourceId)})
      }
      if (source.routed) return result
      if(a.routeDirect===true)return routeSource(source)
      const conversationId = a.conversation?.conversationId ?? source.groupId
      if (conversationId !== source.groupId) fail('ROUTER_CONVERSATION_SCOPE')
      const id = `triage:${source.sourceId}`
      if (!read('triage',id,true)) write('triage',{id,conversationId,sourceId:source.sourceId,messageVersion:source.version,state:'pending'})
      return result
    }
    if (kind === 'triage.commit') {
      if (!Array.isArray(a.dispositions) || !a.dispositions.length || a.dispositions.length > 15 || new Set(a.dispositions.map(row=>row.sourceId)).size !== a.dispositions.length) fail('ROUTER_TRIAGE_INVALID')
      const dispositions=[],notifications=[],routerEvents=[]
      for (const item of a.dispositions) {
        const source = sourceOf({...item,...a.conversationId===undefined?{}:{conversationId:a.conversationId}}), id = `triage:${source.sourceId}`, prior = read('triage',id,true)
        if (typeof item.needsHandling !== 'boolean' || typeof item.reason !== 'string' || item.reply !== undefined && item.reply !== null && typeof item.reply !== 'string') fail('ROUTER_TRIAGE_INVALID')
        const decision = {sourceId:source.sourceId,messageVersion:source.version,needsHandling:item.needsHandling,reply:item.reply?.trim() || null,reason:item.reason,...item.handoff===undefined?{}:{handoff:triageHandoff(item.handoff)}}
        if (prior?.state === 'committed') { if (digest(prior.decision) !== digest(decision)) fail('ROUTER_TRIAGE_CONFLICT'); dispositions.push(prior); continue }
        let notification
        if (decision.reply) {
          const notificationId = `triage-reply:${source.sourceId}`
          notification = {id:notificationId,notificationId,kind:'triage-reply',taskId:null,requirementRevision:source.version,state:'prepared',payload:{outboundId:notificationId,conversationId:source.groupId,sourceId:source.sourceId,sourceMessageId:source.messageId,actorId:source.actorId,text:decision.reply,replyKind:'confirmation',replyToMessageId:source.messageId,replyToActorId:source.actorId,sourceRef:{messageId:source.messageId,messageVersion:source.version,actorId:source.actorId}},createdAt:new Date().toISOString()}
          notification.payloadDigest = digest(notification.payload)
          write('notifications',notification); notifications.push(notification)
        }
        if (decision.needsHandling) routerEvents.push(enqueue(source.groupId,`source:${source.sourceId}`,{kind:'source.message',sourceId:source.sourceId,messageVersion:source.version,triageReplyId:notification?.id ?? null,...decision.handoff?{triageDecisionId:id}:{}}))
        const row = {id,conversationId:source.groupId,sourceId:source.sourceId,messageVersion:source.version,state:'committed',decision,notificationId:notification?.id ?? null,commandId}
        write('triage',row); dispositions.push(row)
        source.routed=true;source.routedAt=new Date().toISOString();source.routeReceipt={kind:'triage',decisionId:id};write('sources',source)
      }
      return changed({dispositions,notifications,routerEvents})
    }
    if (kind === 'router.ensure') {
      const id = required(a.conversationId), prior = read('conversations',id,true)
      if (prior) return changed({conversation:prior})
      const row = {id,conversationId:id,activeSessionId:required(a.sessionId),generation:1,phase:'active',cursor:0,lastHandoffCursor:0,holderVersion:1}
      write('conversations',row); return changed({conversation:row})
    }
    if (kind === 'router.plan') return operation(a,()=>{
      conversationOf(a);const source=sourceOf(a,true)
      if(source.routeReceipt?.kind==='router')sourceOf(a)
      if (!Array.isArray(a.tasks) || !a.tasks.length || !Array.isArray(a.dependencies ?? [])) fail('ROUTER_PLAN_INVALID')
      const created=[]
      for (const input of a.tasks) {
        for(const id of input.sourceRefs??[]){if(id!==source.sourceId){const context=read('sources',id);if(context.channel==='internal')fail('ROUTER_SOURCE_FORBIDDEN');sourceOf({sourceId:id,messageVersion:context.version,conversationId:source.groupId})}}
        const handoff=input.handoff===undefined?undefined:normalizeRouterHandoff(input.handoff)
        if(handoff!==undefined){sourceOf(a);if(source.retracted)fail('ROUTER_SOURCE_STALE')}
        const result=reduce('task.create',{...input,...handoff===undefined?{}:{request:handoff},groupId:source.groupId,ownerActorId:source.actorId,sourceRefs:[...new Set([...(input.sourceRefs ?? []),source.sourceId])],operationId:a.operationId},`${commandId}:${input.taskId}`)
        const task=result.result.task;task.conversationId=source.groupId;task.arrangementRevision=1
        if(handoff!==undefined)recordRouterHandoff(task,source,a.operationId,handoff)
        else sourceOnlyTask(task,source,input.quote,true)
        saveTask(task);link(task,source,'create',input.quote);created.push(task)
      }
      const dependencies=[]
      for (const input of a.dependencies ?? []) {
        if(!created.some(task=>task.taskId===input.taskId))fail('ROUTER_PLAN_EXISTING_TARGET')
        const row=dependency(read('tasks',input.taskId),input,source,rows('dependencies'))
        write('dependencies',row);dependencies.push(row)
      }
      return changed({tasks:created,dependencies})
    })
    if (kind === 'router.task-action') return operation(a,()=>{
      conversationOf(a);const task=read('tasks',a.action?.taskId)
      const source=sourceOf({...a,sourceId:a.sourceId??task.sourceRefs[0],messageVersion:a.messageVersion??read('sources',a.sourceId??task.sourceRefs[0]).version},true)
      if(task.conversationId!==source.groupId)fail('ROUTER_CONVERSATION_SCOPE')
      if(!['task.supplement','task.resume','task.revise','task.reopen','task.control','task.arrange'].includes(a.kind))fail('ROUTER_TASK_ACTION_INVALID')
      if(a.action.expectedRequirementRevision!==task.requirementRevision || a.action.expectedControlRevision!==task.controlRevision)fail('DYNAMIC_TASK_REVISION_STALE')
      if(a.action.request!==undefined&&!['task.revise','task.reopen'].includes(a.kind))fail('TASK_CONTEXT_CLASSIFICATION_CONFLICT')
      if(a.sameGoal===true&&(a.kind!=='task.reopen'||['objective','title','requirements'].some(key=>a.action[key]!==undefined&&digest(a.action[key])!==digest(task[key]))))fail('ROUTER_SAME_GOAL_CONFLICT')
      if(a.kind==='task.arrange'){const result=arrange(task,a.action,source,a.operationId,commandId);sourceOnlyTask(result.result.task,source);saveTask(result.result.task);return result}
      // Host 派生值只在未命中业务回执后计算，避免跨代重试受当前任务或 actor 变化影响。
      const action={...a.action,sourceRefs:[...new Set([...(task.sourceRefs??[]),source.sourceId])],operationId:a.operationId,sameGoal:a.sameGoal}
      const handoff=a.handoff===undefined?undefined:normalizeRouterHandoff(a.handoff)
      if(handoff!==undefined){
        if(a.inputSource===false||!['task.supplement','task.resume','task.revise','task.reopen'].includes(a.kind))fail('ROUTER_HANDOFF_INVALID')
        sourceOf(a)
        if(source.retracted)fail('ROUTER_SOURCE_STALE')
      }
      if(handoff!==undefined&&a.kind==='task.supplement')action.routerInputPolicy=ROUTER_HANDOFF_POLICY
      if(['task.supplement','task.resume','task.revise','task.reopen'].includes(a.kind)) {
        const message=handoff??required(source.channel==='internal'?a.action.text??source.text:source.text)
        if(a.inputSource!==false||source.channel==='internal')action.currentInput={id:a.operationId,text:message,sourceId:source.sourceId,messageVersion:source.version}
        if(a.action.request!==undefined)action.request=required(a.action.request)
        if(handoff!==undefined&&a.sameGoal!==true&&['task.revise','task.reopen'].includes(a.kind))action.request=handoff
        if(['task.supplement','task.resume'].includes(a.kind)) {action.text=message;if(a.hostLiveBinding!==undefined)action.liveBinding=a.hostLiveBinding}
      }
      const result=a.kind==='task.resume'
        ?a.action.humanRequestId!==undefined?resume(task,action,source,a,commandId):reduce('task.control',{...action,control:'active'},commandId,{routerScheduling:true})
        :reduce(a.kind,action,commandId,{routerScheduling:true})
      if(handoff!==undefined)recordRouterHandoff(result.result.task,source,a.operationId,handoff)
      else sourceOnlyTask(result.result.task,source,undefined,['task.revise','task.reopen'].includes(a.kind)&&a.sameGoal!==true)
      saveTask(result.result.task)
      if(a.kind==='task.supplement'&&result.result.task.inspection){Object.assign(result.result.task.inspection,{pending:false,resolvedAt:new Date().toISOString(),resolvedOperationId:a.operationId});saveTask(result.result.task)}
      link(result.result.task,source,a.kind,a.quote)
      taskEvent({id:`task-changed:${commandId}`,kind:'task.changed',taskId:task.taskId,operationId:a.operationId,sourceId:source.sourceId,messageVersion:source.version})
      return result
    })
    if (kind === 'router.evaluate') return operation(a,()=>{
      conversationOf(a)
      const row=read('dependencies',a.dependencyId),task=read('tasks',row.taskId),prior=read('tasks',row.prerequisiteTaskId),source=sourceOf({sourceId:row.authorizationSourceId,messageVersion:row.authorizationSourceVersion,conversationId:a.conversationId},true)
      const event=readEvent(a.completionEventId)
      if(row.conversationId!==a.conversationId || !event || event.taskId!==prior.taskId || event.kind!=='task.completed' || event.requirementRevision!==prior.requirementRevision || prior.requirementRevision!==a.prerequisiteRequirementRevision || row.prerequisiteRequirementRevision!==prior.requirementRevision
        || task.requirementRevision!==a.requirementRevision || row.requirementRevision!==task.requirementRevision || task.controlRevision!==a.controlRevision || row.controlRevision!==task.controlRevision || row.arrangementRevision!==a.arrangementRevision || (task.arrangementRevision ?? 1)!==a.arrangementRevision)fail('ROUTER_EVALUATION_STALE')
      if(prior.status!=='completed' || prior.control!=='active' || !prior.drained || task.status!=='active' || task.control!=='active' || taskHumanWait(prior) || taskHumanWait(task) || blockers(prior.taskId).operations.length || blockers(task.taskId).operations.length)fail('ROUTER_DEPENDENCY_BLOCKED')
      if(!['satisfied','continue','wait'].includes(a.decision) || !Array.isArray(a.evidence) || a.decision==='satisfied'&&!a.evidence.length)fail('ROUTER_EVIDENCE_REQUIRED')
      if(a.decision==='satisfied'){const evidence=prior.completion?.result?.evidence??[];const refs=evidence.map(item=>typeof item==='string'?item:item?.ref??item?.path??item?.id);if(a.evidence.some(ref=>typeof ref!=='string'||!refs.includes(ref)))fail('ROUTER_EVIDENCE_REFERENCE_INVALID')}
      if(row.state==='satisfied')return changed({dependency:row,evaluation:read('completion_evaluations',row.evaluationId)})
      const id=`completion-evaluation:${hash([row.id,a.completionEventId,a.operationId])}`
      const evaluation={id,taskId:task.taskId,conversationId:a.conversationId,dependencyId:row.id,completionEventId:event.id,prerequisiteTaskId:prior.taskId,prerequisiteRequirementRevision:prior.requirementRevision,requirementRevision:task.requirementRevision,controlRevision:task.controlRevision,arrangementRevision:row.arrangementRevision,condition:row.condition,decision:a.decision,evidence:a.evidence}
      write('completion_evaluations',evaluation);row.evaluationId=id;row.state=a.decision==='satisfied'?'satisfied':'pending';write('dependencies',row)
      const inbox=rows('router_inbox').find(item=>item.conversationId===a.conversationId&&item.taskEventId===event.id)
      if(inbox){inbox.evaluations=[...new Set([...(inbox.evaluations ?? []),id])];write('router_inbox',inbox)}
      if(a.decision==='satisfied'&&dependenciesReady(task))wake(task.taskId,'dependency.satisfied',{dependencyId:row.id,evaluationId:id},`wake:dependency:${row.id}:${row.arrangementRevision}`)
      return changed({dependency:row,evaluation,task})
    })
    if(kind==='router.held-review.record'){
      const conversation=conversationOf(a),row=read('router_inbox',required(a.eventId),true)
      if(!row||row.conversationId!==conversation.id||row.sourceId!==a.sourceId||row.messageVersion!==a.messageVersion
        ||row.deliveryHold?.handoffId!==a.handoffId||!heldSource(row))fail('ROUTER_HELD_REVIEW_STALE')
      if(row.heldReviews?.some(review=>review.handoffId===a.handoffId&&review.generation===a.generation))fail('ROUTER_HELD_REVIEW_STALE')
      const evidence=heldEvidence(row)
      if(a.decision==='processed'){
        const task=evidence.tasks.find(task=>task.taskId===a.evidenceId)
        const reply=evidence.replies.find(reply=>reply.notificationId===a.evidenceId&&reply.state==='delivered'
          &&reply.purpose!=='acknowledgement'&&reply.kind!=='triage-reply')
        if(!task&&!reply)fail('ROUTER_HELD_REVIEW_EVIDENCE_REQUIRED')
        row.state='consumed';row.processedGeneration=conversation.generation;row.processedCursor=++conversation.cursor
        write('conversations',conversation)
      }else if(a.decision==='continue'){
        if(a.noEffect!==true||!mayReleaseHold(row)||evidence.tasks.length||evidence.replies.length)fail('ROUTER_HELD_REVIEW_EFFECT_UNKNOWN')
        delete row.deliveryHold
      }else if(!['defer','no-decision'].includes(a.decision))fail('ROUTER_ARGUMENT_INVALID')
      const review={handoffId:a.handoffId,generation:a.generation,decision:a.decision,...a.decision==='processed'?{evidenceId:a.evidenceId}:{},recordedAt:new Date().toISOString()}
      ;(row.heldReviews??=[]).push(review)
      write('router_inbox',row);return changed({review})
    }
    if(kind==='router.settle')return operation(a,()=>{
      const conversation=conversationOf(a)
      if(!Array.isArray(a.eventIds)||!a.eventIds.length)fail('ROUTER_EVENTS_REQUIRED')
      for(const eventId of new Set(a.eventIds)){
        const row=rows('router_inbox').find(item=>item.conversationId===a.conversationId&&(item.id===eventId||item.eventId===eventId))
        if(!row)fail('ROUTER_EVENT_SCOPE')
        if(row.kind==='operator.message'){if(a.webOnly!==true||row.operator?.destination!=='web'||!row.operatorReply)fail('ROUTER_OPERATOR_REPLY_REQUIRED')}else if(a.webOnly===true)fail('ROUTER_OPERATOR_BATCH_MIXED')
        if(row.state==='consumed')continue
        if(row.deliveryHold)fail('ROUTER_EVENT_DELIVERY_HELD')
        const event=row.taskEventId?readEvent(row.taskEventId):null
        if(row.trackOutcome===true)row.outcomeDisposition=outcomeDisposition(row,event)
        if(event?.kind==='task.inspection'&&event.reason==='wait-overdue'){
          const task=read('tasks',row.taskId),inspection=task.inspection
          const reviews=(a.inspectionReviews??[]).filter(review=>review.taskId===task.taskId&&review.inspectionKey===event.inspectionKey)
          const current=inspection?.key===event.inspectionKey&&inspection.pending&&inspectionIsCurrent(task)
            &&task.status==='active'&&task.control==='active'&&task.drained&&inspection.waitIdentity===taskWaitIdentity(task)
          if(reviews.length>1)fail('ROUTER_INSPECTION_REVIEW_INVALID')
          if(!current){if(reviews.length)fail('ROUTER_INSPECTION_REVIEW_STALE');row.inspectionDisposition='state-changed'}
          else{
            const review=reviews[0],at=new Date().toISOString()
            if(!review)fail('ROUTER_INSPECTION_REVIEW_REQUIRED')
            if(review.expectedRequirementRevision!==task.requirementRevision||review.expectedControlRevision!==task.controlRevision||review.expectedContextRevision!==(task.contextRevision??0))fail('ROUTER_INSPECTION_REVIEW_STALE')
            if(!['wait','investigate','continue','notify'].includes(review.decision)||typeof review.reason!=='string'||!review.reason.trim()||review.reason.length>2000||!Number.isFinite(Date.parse(review.nextCheckAt))||Date.parse(review.nextCheckAt)<Date.parse(at)+MIN_WAIT_RECHECK_MS)fail('ROUTER_INSPECTION_REVIEW_INVALID')
            inspection.pending=false;inspection.nextCheckAt=new Date(review.nextCheckAt).toISOString()
            inspection.review={decision:review.decision,reason:review.reason.trim(),at,nextCheckAt:inspection.nextCheckAt,operationId:a.operationId,generation:a.generation}
            saveTask(task);row.inspectionDisposition=inspection.review
          }
        }
        // A frozen first reply is feedback, not proof of task arrangement or
        // authority. Require an explicit source-grounded no-task decision when
        // an acknowledged source has no durable task action. Never infer intent
        // by matching reply text, or automatically create work from triage.
        if(row.sourceId && (row.triageReplyId || row.directRouter) && !rows('source_links').some(link=>link.conversationId===a.conversationId&&link.sourceId===row.sourceId&&link.messageVersion===row.messageVersion)) {
          const decisions=a.noTaskDispositions
          const matches=Array.isArray(decisions)?decisions.filter(item=>item.eventId===row.id):[]
          if(matches.length!==1)fail('ROUTER_SOURCE_DISPOSITION_REQUIRED')
          const decision=matches[0], original=read('sources',row.sourceId)
          if(decision.sourceQuote!==original.text || !['handled-inline','clarification','not-assigned',...(row.directRouter?['context-only','async-query']:[])].includes(decision.outcome) || typeof decision.reason!=='string' || !decision.reason.trim())fail('ROUTER_SOURCE_DISPOSITION_INVALID')
          if(decision.outcome==='clarification' && (!Array.isArray(decision.missingInformation)||!decision.missingInformation.length||decision.missingInformation.some(value=>typeof value!=='string'||!value.trim())))fail('ROUTER_CLARIFICATION_INFORMATION_REQUIRED')
          if(row.directRouter&&decision.outcome==='handled-inline'&&!rows('notifications').some(notice=>notice.kind==='router-reply'&&notice.payload?.replyPurpose!=='acknowledgement'&&notice.payload?.conversationId===a.conversationId&&notice.payload.sourceId===row.sourceId&&notice.payload.sourceVersion===row.messageVersion&&notice.state!=='failed'))fail('ROUTER_DIRECT_REPLY_REQUIRED')
          if(decision.outcome==='async-query'){
            const lookup=typeof decision.lookupId==='string'?read('router_actions',decision.lookupId,true)?.result?.lookup:null
            if(!lookup||lookup.conversationId!==a.conversationId||lookup.sourceId!==row.sourceId||lookup.messageVersion!==row.messageVersion)fail('ROUTER_LOOKUP_RECEIPT_REQUIRED')
          }
          if(decision.outcome==='clarification') {
            const notification=typeof decision.notificationId==='string'?read('notifications',decision.notificationId,true):null
            if(notification?.kind!=='router-reply'||notification.payload?.conversationId!==a.conversationId||notification.payload.sourceId!==row.sourceId||notification.payload.sourceVersion!==row.messageVersion||notification.state==='failed')fail('ROUTER_CLARIFICATION_RECEIPT_REQUIRED')
          }
          row.noTaskDisposition=decision
        }
        row.state='consumed';row.operationId=a.operationId;row.processedGeneration=conversation.generation;row.processedCursor=++conversation.cursor;write('router_inbox',row)
      }
      if(conversation.timeoutContinuation?.eventIds.every(id=>read('router_inbox',id,true)?.state==='consumed'))delete conversation.timeoutContinuation
      write('conversations',conversation);return changed({conversation})
    })
    if(kind==='router.handoff.recover'){
      const row=conversationOf(a)
      if(a.sessionId!==row.activeSessionId||a.generation!==row.generation)fail('ROUTER_GENERATION_STALE')
      const pending=pendingInbox(row.id,true)
      if(!pending.length)fail('ROUTER_EVENTS_REQUIRED')
      const isolatedReply=a.reason==='ROUTER_CONTINUATION_REPLY_UNRESOLVED'
      const blocking=a.reason==='ROUTER_BATCH_NO_PROGRESS'||isolatedReply
      const prior=rows('router_rotations').find(rotation=>rotation.candidateSessionId===row.activeSessionId&&rotation.recovery&&rotation.cutoff===row.cursor)
      if(prior&&!blocking)fail('ROUTER_RECOVERY_OWNER_UNAVAILABLE')
      const scope=a.unknownEventIds===undefined?pending:(()=>{
        if(!Array.isArray(a.unknownEventIds)||a.unknownEventIds.length>30||new Set(a.unknownEventIds).size!==a.unknownEventIds.length)fail('ROUTER_ARGUMENT_INVALID')
        return a.unknownEventIds.map(id=>{const event=read('router_inbox',required(id),true);if(!event||event.conversationId!==row.id)fail('ROUTER_EVENT_SCOPE');return event})
      })()
      if(blocking){
        const ids=new Set(scope.map(event=>event.id))
        if(isolatedReply){
          if(!Array.isArray(a.knownEventIds)||a.knownEventIds.length>30||new Set(a.knownEventIds).size!==a.knownEventIds.length
            ||a.knownEventIds.some(id=>read('router_inbox',required(id),true)?.conversationId!==row.id)
            ||scope.some(event=>event.kind!=='source.message'||!a.knownEventIds.includes(event.id)))fail('ROUTER_RESUME_BATCH_STALE')
          for(const id of a.knownEventIds)ids.add(id)
        }
        if(!a.unknownEventIds?.length||scope.some(event=>event.state!=='pending'||event.deliveryHold)||independentSource(pending,ids)?.id!==a.freshEventId||!a.freshEventId)fail('ROUTER_RESUME_BATCH_STALE')
        for(const event of scope)write('router_inbox',{...event,deliveryHold:{handoffId:a.handoffId,reason:a.reason}})
      }
      // Earlier recovery rows retain their original restrictions. A new message
      // outside the frozen checkpoint is not evidence of an old unknown effect.
      if(a.unknownTaskIds!==undefined&&!Array.isArray(a.unknownTaskIds)||a.unknownSourceIds!==undefined&&!Array.isArray(a.unknownSourceIds))fail('ROUTER_ARGUMENT_INVALID')
      const taskIds=[...new Set([...scope.map(event=>event.taskId??event.taskEvent?.taskId).filter(Boolean),...(a.unknownTaskIds??[])])]
      if(taskIds.length>100||taskIds.some(id=>typeof id!=='string'))fail('ROUTER_ARGUMENT_INVALID')
      const tasks=taskIds.map(id=>read('tasks',id,true)).filter(task=>task?.groupId===row.id||task?.conversationId===row.id)
      const sources=[...scope.map(event=>event.sourceId).filter(Boolean),...tasks.flatMap(task=>task.sourceRefs??[]),...(a.unknownSourceIds??[])]
      if(sources.length>500||sources.some(id=>typeof id!=='string'))fail('ROUTER_ARGUMENT_INVALID')
      const recovery={oldSessionId:row.activeSessionId,reason:required(a.reason),unknownSourceIds:[...new Set(sources)],unknownTaskIds:tasks.map(task=>task.taskId)}
      const rotation={id:required(a.handoffId),conversationId:row.id,oldGeneration:row.generation,oldSessionId:row.activeSessionId,cutoff:row.cursor,requiredSourceIds:recovery.unknownSourceIds,state:'summarized',recovery,handoff:{recovery}}
      row.phase='handoff';row.rotationId=rotation.id;write('router_rotations',rotation);write('conversations',row);return changed({conversation:row,rotation})
    }
    if(kind==='router.handoff.begin'){
      const row=conversationOf(a)
      if(row.cursor<=row.lastHandoffCursor || rows('router_inbox').some(item=>item.conversationId===row.id&&item.state==='pending'))fail('ROUTER_NOT_IDLE')
      const rotation={id:required(a.handoffId),conversationId:row.id,oldGeneration:row.generation,oldSessionId:row.activeSessionId,cutoff:row.cursor,requiredSourceIds:[...new Set(rows('router_inbox').filter(item=>item.conversationId===row.id&&item.state==='consumed'&&item.processedCursor>row.lastHandoffCursor&&item.processedCursor<=row.cursor&&item.sourceId).map(item=>item.sourceId))],state:'handoff'}
      row.phase='handoff';row.rotationId=rotation.id;write('router_rotations',rotation);write('conversations',row);return changed({conversation:row,rotation})
    }
    if(kind==='router.handoff.ready'||kind==='router.candidate.commit'||kind==='router.publish'||kind==='router.handoff.abort'){
      const row=conversationOf(a,false),rotation=read('router_rotations',required(a.handoffId))
      if(row.rotationId!==rotation.id||rotation.oldGeneration!==row.generation||rotation.oldSessionId!==row.activeSessionId||rotation.cutoff!==row.cursor)fail('ROUTER_ROTATION_STALE')
      if(kind==='router.handoff.ready'){
        if(rotation.state!=='handoff')fail('ROUTER_ROTATION_STALE')
        rotation.handoff=a.handoff;rotation.oldCommit=a.commitProof;rotation.state='summarized'
      }else if(kind==='router.candidate.commit'){
        if(rotation.state!=='summarized'||!a.commitProof?.sessionId||!a.commitProof?.commitId)fail('ROUTER_CANDIDATE_PROOF_REQUIRED')
        rotation.candidateSessionId=required(a.sessionId);if(a.commitProof.sessionId!==a.sessionId)fail('ROUTER_CANDIDATE_PROOF_REQUIRED');rotation.candidateCommit=a.commitProof;rotation.state='candidate-committed'
      }else if(kind==='router.publish'){
        if(rotation.state!=='candidate-committed')fail('ROUTER_CANDIDATE_PROOF_REQUIRED')
        row.activeSessionId=rotation.candidateSessionId;row.generation++;row.phase='active';row.holderVersion++;row.lastHandoffCursor=rotation.cutoff;delete row.rotationId;delete row.timeoutContinuation;rotation.state='published'
      }else{if(rotation.state!=='handoff')fail('ROUTER_ROTATION_STALE');if(a.safeToResume!==true)fail('ROUTER_RECOVERY_PROOF_REQUIRED');row.phase='active';delete row.rotationId;rotation.state='aborted';rotation.error=a.error}
      write('router_rotations',rotation);write('conversations',row);return changed({conversation:row,rotation})
    }
  }
  function query(q) {
    if(q.kind==='router.task-index')return queryTaskIndex(db,q,{dependenciesReady})
    if(q.kind==='router.reply-history')return queryReplyHistory(db,q)
    if(q.kind==='router.source-history')return querySourceHistory(db,q)
    if(q.kind==='router.source-latest'){const source=read('sources',q.sourceId,true);return !!source&&source.groupId===q.conversationId&&source.version===q.messageVersion&&latest(source)}
    if(q.kind==='router.source-current')return queryCurrentSource(db,q)
    if(q.kind==='triage.pending')return rows('triage').filter(row=>row.state==='pending'&&(!q.conversationId||row.conversationId===q.conversationId)).map(row=>read('sources',row.sourceId)).filter(row=>!row.routed&&!row.authorizationRevoked&&!row.triageHold&&!row.archiveRestoreHold&&latest(row)).slice(0,bounded(q.limit))
    if(q.kind==='router.upgrade-held')return {sources:rows('sources').filter(row=>row.triageHold&&(!q.conversationId||row.groupId===q.conversationId)),audit:rows('router_upgrade_audit').filter(row=>!q.conversationId||row.conversationId===q.conversationId)}
    if(q.kind==='router.source-status')return {triage:read('triage',`triage:${q.sourceId}`,true),event:rows('router_inbox').find(row=>row.sourceId===q.sourceId)??null}
    if(q.kind==='router.get')return read('conversations',q.conversationId,true)
    if(q.kind==='router.lookup.pending')return rows('router_actions').map(row=>row.result?.lookup).filter(row=>row?.state==='pending')
    if(q.kind==='router.action')return read('router_actions',`router-action:${hash([required(q.conversationId),required(q.operationId)])}`,true)
    if(q.kind==='router.list')return rows('conversations')
    if(q.kind==='router.operator.request'){const event=rows('router_inbox').find(row=>row.conversationId===q.conversationId&&row.kind==='operator.message'&&row.operator?.requestId===q.requestId&&row.operator.actorId===q.actorId);return event?{requestId:q.requestId,eventId:event.id,status:'accepted',webOnly:true}:null}
    if(q.kind==='router.pending-conversations')return [...new Set([...rows('router_inbox').filter(row=>row.state==='pending').map(row=>row.conversationId),...rows('conversations').filter(row=>row.phase!=='active').map(row=>row.id)])]
    if(q.kind==='router.batch-events'){
      required(q.conversationId)
      if(!Array.isArray(q.eventIds)||!q.eventIds.length||q.eventIds.length>30||new Set(q.eventIds).size!==q.eventIds.length)fail('ROUTER_ARGUMENT_INVALID')
      return q.eventIds.map(id=>{const row=read('router_inbox',required(id),true);if(!row||row.conversationId!==q.conversationId)fail('ROUTER_EVENT_SCOPE');return inboxEvent(row)})
    }
    if(q.kind==='router.inbox')return pendingInbox(q.conversationId,q.deliverable).slice(0,bounded(q.limit,30)).map(inboxEvent)
    if(q.kind==='router.independent-source'){
      if(!Array.isArray(q.eventIds)||!q.eventIds.length||q.eventIds.length>30)fail('ROUTER_ARGUMENT_INVALID')
      return independentSource(pendingInbox(q.conversationId,true),new Set(q.eventIds))?.id??null
    }
    if(q.kind==='router.outcome-inspection')return inspectOutcomes(q.overdueBefore)
    if(q.kind==='router.held-review.next'){
      const conversation=conversationOf(q)
      const candidates=q.eventId===undefined?pendingInbox(conversation.id,false):[read('router_inbox',q.eventId,true)]
      for(const row of candidates){
        if(row?.conversationId!==conversation.id)continue
        const source=heldSource(row)
        if(!source||row.heldReviews?.some(review=>review.generation===conversation.generation&&review.handoffId===row.deliveryHold.handoffId))continue
        return {row,source,evidence:heldEvidence(row),mayRelease:mayReleaseHold(row)}
      }
      return null
    }
    if(q.kind==='router.held-review.released')return rows('router_inbox').filter(row=>row.conversationId===q.conversationId
      &&row.heldReviews?.some(review=>review.decision==='continue')).flatMap(row=>row.heldReviews.filter(review=>review.decision==='continue')
        .map(review=>({sourceId:row.sourceId,handoffId:review.handoffId})))
    if(q.kind==='router.delivery-holds')return [...new Set(rows('router_inbox').filter(row=>row.state==='pending'&&row.deliveryHold).map(row=>row.conversationId))]
    if(q.kind==='router.pending-completion')return rows('router_inbox').some(row=>row.conversationId===q.conversationId&&row.state==='pending'&&row.taskEventId&&readEvent(row.taskEventId)?.kind==='task.completed')
    if(q.kind==='router.inbox-count')return pendingInbox(q.conversationId,q.deliverable).length
    if(q.kind==='router.dependencies')return rows('dependencies').filter(row=>(!q.conversationId||row.conversationId===q.conversationId)&&(!q.taskId||row.taskId===q.taskId||row.prerequisiteTaskId===q.taskId))
    if(q.kind==='router.rotations')return rows('router_rotations').filter(row=>!q.conversationId||row.conversationId===q.conversationId)
    if(q.kind==='router.source-links')return rows('source_links').filter(row=>(!q.taskId||row.taskId===q.taskId)&&(!q.sourceId||row.sourceId===q.sourceId))
    if(q.kind==='router.evaluations')return rows('completion_evaluations').filter(row=>!q.taskId||row.taskId===q.taskId)
  }
  function assertReplySource({conversationId,generation,sourceId,messageVersion}) {
    conversationOf({conversationId,generation})
    sourceOf({conversationId,sourceId,messageVersion})
  }
  return {command,query,dependenciesReady,taskEvent,taskMutation,assertReplySource,routeSource}
}
