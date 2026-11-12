import {createHash} from 'node:crypto'

export const routerSchemaVersion = '1'
export const routerTables = ['conversations','router_inbox','triage','source_links','dependencies','completion_evaluations','router_rotations','router_actions','router_upgrade_audit']
export const routerSchema = routerTables.map(name => `CREATE TABLE IF NOT EXISTS dynamic_${name}(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(json_valid(body)));`).join('\n') + `
CREATE INDEX IF NOT EXISTS dynamic_source_link_task ON dynamic_source_links(json_extract(body,'$.taskId'),json_extract(body,'$.conversationId'));
CREATE INDEX IF NOT EXISTS dynamic_source_link_source ON dynamic_source_links(json_extract(body,'$.conversationId'),json_extract(body,'$.sourceId'));
CREATE UNIQUE INDEX IF NOT EXISTS dynamic_router_event ON dynamic_router_inbox(json_extract(body,'$.conversationId'),json_extract(body,'$.eventId'));
CREATE UNIQUE INDEX IF NOT EXISTS dynamic_dependency_pair ON dynamic_dependencies(json_extract(body,'$.taskId'),json_extract(body,'$.prerequisiteTaskId'));
`
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
  const latest = source => !rows('sources').some(row => row.groupId === source.groupId && row.messageId === source.messageId && row.version > source.version)
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
      if(!readEvent(event.id))db.prepare('INSERT INTO dynamic_task_events(id,body) VALUES (?,?)').run(event.id,JSON.stringify({...event,eventVersion:1,requirementRevision:task.requirementRevision,controlRevision:task.controlRevision,recordedAt:new Date().toISOString()}))
      return enqueue(task.conversationId,event.id,{kind:event.kind,taskId:task.taskId,taskEventId:event.id})
    }
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
    const {generation,sessionId,agent,hostLiveBinding, ...request} = a
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
        const source = sourceOf(item), id = `triage:${source.sourceId}`, prior = read('triage',id,true)
        if (typeof item.needsHandling !== 'boolean' || typeof item.reason !== 'string' || item.reply !== undefined && item.reply !== null && typeof item.reply !== 'string') fail('ROUTER_TRIAGE_INVALID')
        const decision = {sourceId:source.sourceId,messageVersion:source.version,needsHandling:item.needsHandling,reply:item.reply?.trim() || null,reason:item.reason}
        if (prior?.state === 'committed') { if (digest(prior.decision) !== digest(decision)) fail('ROUTER_TRIAGE_CONFLICT'); dispositions.push(prior); continue }
        let notification
        if (decision.reply) {
          const notificationId = `triage-reply:${source.sourceId}`
          notification = {id:notificationId,notificationId,kind:'triage-reply',taskId:null,requirementRevision:source.version,state:'prepared',payload:{outboundId:notificationId,conversationId:source.groupId,sourceId:source.sourceId,sourceMessageId:source.messageId,actorId:source.actorId,text:decision.reply,replyKind:'confirmation',replyToMessageId:source.messageId,replyToActorId:source.actorId,sourceRef:{messageId:source.messageId,messageVersion:source.version,actorId:source.actorId}},createdAt:new Date().toISOString()}
          notification.payloadDigest = digest(notification.payload)
          write('notifications',notification); notifications.push(notification)
        }
        if (decision.needsHandling) routerEvents.push(enqueue(source.groupId,`source:${source.sourceId}`,{kind:'source.message',sourceId:source.sourceId,messageVersion:source.version,triageReplyId:notification?.id ?? null}))
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
      if (!Array.isArray(a.tasks) || !a.tasks.length || !Array.isArray(a.dependencies ?? [])) fail('ROUTER_PLAN_INVALID')
      const created=[]
      for (const input of a.tasks) {
        const result=reduce('task.create',{...input,groupId:source.groupId,ownerActorId:source.actorId,sourceRefs:[...new Set([...(input.sourceRefs ?? []),source.sourceId])],operationId:a.operationId},`${commandId}:${input.taskId}`)
        const task=result.result.task;task.conversationId=source.groupId;task.arrangementRevision=1;saveTask(task);link(task,source,'create',input.quote);created.push(task)
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
      if(a.sameGoal===true&&(a.kind!=='task.reopen'||['objective','title','requirements'].some(key=>a.action[key]!==undefined&&digest(a.action[key])!==digest(task[key]))))fail('ROUTER_SAME_GOAL_CONFLICT')
      if(a.kind==='task.arrange')return arrange(task,a.action,source,a.operationId,commandId)
      // Host 派生值只在未命中业务回执后计算，避免跨代重试受当前任务或 actor 变化影响。
      const action={...a.action,sourceRefs:[...new Set([...(task.sourceRefs??[]),source.sourceId])],operationId:a.operationId,sameGoal:a.sameGoal}
      if(['task.supplement','task.resume','task.revise','task.reopen'].includes(a.kind)) {
        const message=required(a.action.text??source.text)
        action.request=[task.request,['task.supplement','task.resume'].includes(a.kind)?'[原消息补充]':'[原消息调整]',message].join(String.fromCharCode(10,10))
        if(['task.supplement','task.resume'].includes(a.kind)) {action.text=message;if(a.hostLiveBinding!==undefined)action.liveBinding=a.hostLiveBinding}
      }
      const result=a.kind==='task.resume'
        ?a.action.humanRequestId!==undefined?resume(task,action,source,a,commandId):reduce('task.control',{...action,control:'active'},commandId,{routerScheduling:true})
        :reduce(a.kind,action,commandId,{routerScheduling:true})
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
    if(kind==='router.settle')return operation(a,()=>{
      const conversation=conversationOf(a)
      if(!Array.isArray(a.eventIds)||!a.eventIds.length)fail('ROUTER_EVENTS_REQUIRED')
      for(const eventId of new Set(a.eventIds)){
        const row=rows('router_inbox').find(item=>item.conversationId===a.conversationId&&(item.id===eventId||item.eventId===eventId))
        if(!row)fail('ROUTER_EVENT_SCOPE')
        if(row.state==='consumed')continue
        row.state='consumed';row.operationId=a.operationId;row.processedGeneration=conversation.generation;row.processedCursor=++conversation.cursor;write('router_inbox',row)
      }
      write('conversations',conversation);return changed({conversation})
    })
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
        row.activeSessionId=rotation.candidateSessionId;row.generation++;row.phase='active';row.holderVersion++;row.lastHandoffCursor=rotation.cutoff;delete row.rotationId;rotation.state='published'
      }else{if(rotation.state!=='handoff')fail('ROUTER_ROTATION_STALE');if(a.safeToResume!==true)fail('ROUTER_RECOVERY_PROOF_REQUIRED');row.phase='active';delete row.rotationId;rotation.state='aborted';rotation.error=a.error}
      write('router_rotations',rotation);write('conversations',row);return changed({conversation:row,rotation})
    }
  }
  function query(q) {
    if(q.kind==='triage.pending')return rows('triage').filter(row=>row.state==='pending'&&(!q.conversationId||row.conversationId===q.conversationId)).map(row=>read('sources',row.sourceId)).filter(row=>!row.routed&&!row.authorizationRevoked&&!row.triageHold&&!row.archiveRestoreHold&&latest(row)).slice(0,bounded(q.limit))
    if(q.kind==='router.upgrade-held')return {sources:rows('sources').filter(row=>row.triageHold&&(!q.conversationId||row.groupId===q.conversationId)),audit:rows('router_upgrade_audit').filter(row=>!q.conversationId||row.conversationId===q.conversationId)}
    if(q.kind==='router.source-status')return {triage:read('triage',`triage:${q.sourceId}`,true),event:rows('router_inbox').find(row=>row.sourceId===q.sourceId)??null}
    if(q.kind==='router.get')return read('conversations',q.conversationId,true)
    if(q.kind==='router.list')return rows('conversations')
    if(q.kind==='router.pending-conversations')return [...new Set([...rows('router_inbox').filter(row=>row.state==='pending').map(row=>row.conversationId),...rows('conversations').filter(row=>row.cursor>row.lastHandoffCursor||row.phase!=='active').map(row=>row.id)])]
    if(q.kind==='router.inbox')return rows('router_inbox').filter(row=>row.conversationId===q.conversationId&&row.state==='pending').slice(0,bounded(q.limit,30)).map(row=>({...row,source:row.sourceId?read('sources',row.sourceId):undefined,triageReply:row.triageReplyId?read('notifications',row.triageReplyId):undefined,taskEvent:row.taskEventId?readEvent(row.taskEventId):undefined}))
    if(q.kind==='router.pending-completion')return rows('router_inbox').some(row=>row.conversationId===q.conversationId&&row.state==='pending'&&row.taskEventId&&readEvent(row.taskEventId)?.kind==='task.completed')
    if(q.kind==='router.inbox-count')return rows('router_inbox').filter(row=>row.conversationId===q.conversationId&&row.state==='pending').length
    if(q.kind==='router.dependencies')return rows('dependencies').filter(row=>(!q.conversationId||row.conversationId===q.conversationId)&&(!q.taskId||row.taskId===q.taskId||row.prerequisiteTaskId===q.taskId))
    if(q.kind==='router.rotations')return rows('router_rotations').filter(row=>!q.conversationId||row.conversationId===q.conversationId)
    if(q.kind==='router.source-links')return rows('source_links').filter(row=>(!q.taskId||row.taskId===q.taskId)&&(!q.sourceId||row.sourceId===q.sourceId))
    if(q.kind==='router.evaluations')return rows('completion_evaluations').filter(row=>!q.taskId||row.taskId===q.taskId)
  }
  return {command,query,dependenciesReady,taskEvent,taskMutation}
}
