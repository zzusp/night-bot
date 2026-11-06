import {createHash} from 'node:crypto'
// Scripted routing model readers; all history and tool execution stay in the official SDK.
const modelMessageParts = message => typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? []

export function modelToolValues(request) {
  const definitions = Object.assign({}, ...request.messages.flatMap(message => modelMessageParts(message).flatMap(part => {
    if (part.type !== 'text') return []
    try { return [JSON.parse(part.text).contentIndex ?? {}] } catch { return [] }
  })))
  const inline = value => value && typeof value === 'object' ? value.contentRef && Object.hasOwn(definitions, value.contentRef)
    ? definitions[value.contentRef] : Array.isArray(value) ? value.map(inline) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inline(child)])) : value
  return request.messages.filter(message => ['toolResult', 'tool'].includes(message.role)).flatMap(modelMessageParts).filter(part => part.type === 'text')
    .flatMap(part => { try { return [inline(JSON.parse(part.text))] } catch { return [] } })
}

export function latestInput(request) {
  // Scripted models understand the same inline dictionary as a real model.
  // Deferred catalogues remain references and must be read with the model tool.
  const definitions = Object.assign({}, ...request.messages.flatMap(message => modelMessageParts(message).flatMap(part => {
    if (part.type !== 'text') return []
    try { return [JSON.parse(part.text).contentIndex ?? {}] } catch { return [] }
  })))
  const inline = value => value && typeof value === 'object' ? value.contentRef && Object.hasOwn(definitions, value.contentRef)
    ? definitions[value.contentRef] : Array.isArray(value) ? value.map(inline) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inline(child)])) : value
  for (const message of request.messages.toReversed()) {
    if (message.role !== 'user') continue
    for (const part of message.content ?? []) {
      if (part.type !== 'text') continue
      if (part.text.startsWith('[AGENT_PLATFORM_QUERY]\n')) return JSON.parse(part.text.slice('[AGENT_PLATFORM_QUERY]\n'.length))
      if (part.text.startsWith('[SCHEDULE REMINDER]')) return { schedule: part.text }
      try { const parsed = JSON.parse(part.text); if (parsed.task || parsed.sources || parsed.contextReadRequired || parsed.reservationId && parsed.source) return resolveContextInput(request, inline(parsed)) } catch (error) { if (error.contextReads) throw error }
      for(const prefix of ['一级分诊请求：','Router 请求：','Router 交接请求：']){const line=part.text.split(String.fromCharCode(10)).find(line=>line.startsWith(prefix));if(line)return JSON.parse(line.slice(prefix.length))}
      const topicLine = part.text.split('\n').find(line => line.startsWith('Topic 请求：'))
      if (topicLine) return JSON.parse(topicLine.slice('Topic 请求：'.length))
    }
  }
  throw new Error('No native coordinator input found')
}

// Scripted decisions must observe overflow through the same admitted tool as a
// real model. Only contextPath fields are expanded; ordinary contentRef bodies
// remain explicit references for the individual test's judgment.
export function resolveContextInput(request, input) {
  const pages = modelToolValues(request), pending = new Map()
  const read = (contentRef, path = '') => {
    let offset = 0, text = '', entries = [], kind
    while (true) {
      // JSON indexes omit offset; the page range follows from entry count and
      // its nextOffset (or totalEntries for the final page).
      const page = pages.findLast(page => page.contentRef === contentRef && page.path === path && (page.format === 'json-index' ? (page.nextOffset ?? page.totalEntries) - page.entries.length : page.offset) === offset)
      if (!page) {
        const args = { contentRef, path, offset, limit: 16000 }
        pending.set(JSON.stringify(args), args)
        return undefined
      }
      if (page.format === 'json-index') { entries.push(...page.entries); kind = page.valueKind }
      else text += page.text
      if (page.nextOffset === null) break
      offset = page.nextOffset
    }
    if (kind) {
      const value = kind === 'array' ? [] : {}
      for (const entry of entries) value[entry.key] = entry.valueRef ? read(entry.valueRef.contentRef) : entry.value
      return value
    }
    const page = pages.findLast(page => page.contentRef === contentRef && page.path === path)
    return page.format === 'text' ? text : JSON.parse(text)
  }
  const visit = value => value && typeof value === 'object'
    ? value.contextPath ? read(input.contextRef, value.contextPath)
      : Array.isArray(value) ? value.map(visit) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    : value
  const resolved = input.contextReadRequired && !input.task && !input.sources ? read(input.contextRef) : visit(input)
  if (pending.size) throw Object.assign(new Error('Native context requires explicit tool reads'), { contextReads: [...pending.values()].slice(0, 4) })
  return resolved
}

export function contextReadCalls(request) {
  try { latestInput(request); return undefined }
  catch (error) { if (error.contextReads) return error.contextReads.map(args => ({ name: 'model_content_read', args })); throw error }
}

export async function waitUntil(read, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out: ' + description)
}

export function topicTaskCalls(request, { title = '原消息交办', objective, task, signature = '', replyRecipients } = {}) {
  const input = latestInput(request), names = request.tools.map(tool => tool.name)
  if(names.includes('channel_triage_submit'))return [{name:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'This execution scenario requests original business handling'}))}}]
  if(names.includes('resident_router_settle')){
    const lastInput=request.messages.findLastIndex(message=>message.role==='user'&&modelMessageParts(message).some(part=>part.type==='text'&&part.text.startsWith('Router ')))
    const current=request.messages.slice(lastInput+1),accepted=new Set(current.filter(message=>message.role==='toolResult'&&!message.isError).map(message=>message.toolCallId))
    const calls=current.filter(message=>message.role==='assistant').flatMap(message=>modelMessageParts(message)).filter(part=>part.type==='toolCall'&&accepted.has(part.id))
    if(calls.some(call=>call.name==='resident_router_settle'))return []
    const sourceEvents=input.events.filter(event=>event.source)
    const completed=input.events.find(event=>event.taskEvent?.kind==='task.completed'&&!calls.some(call=>call.name==='resident_router_reply'&&call.arguments.operationId==='fixture-completion:'+event.taskEventId))
    if(!sourceEvents.length&&completed){
      const values=modelToolValues(request),row=values.findLast(value=>value.task?.taskId===completed.taskId&&value.task.requirementRevision===completed.taskEvent.requirementRevision)?.task
      if(!calls.some(call=>call.name==='resident_task_query'&&call.arguments.taskId===completed.taskId))return [{name:'resident_task_query',args:{taskId:completed.taskId}}]
      if(!row)throw Error('Completion reply requires the actual current task result')
      const sourceId=row.sourceRefs[0],source=values.findLast(value=>value.sourceId===sourceId)
      if(!calls.some(call=>call.name==='resident_source_get'&&call.arguments.sourceId===sourceId))return [{name:'resident_source_get',args:{sourceId}}]
      if(!source)throw Error('Completion reply requires the authenticated original source')
      return [{name:'resident_router_reply',args:{operationId:'fixture-completion:'+completed.taskEventId,sourceId:source.sourceId,messageVersion:source.version,text:(row.completion?.result?.summary??row.completion?.summary)+signature,...(replyRecipients?{atOpenDingTalkIds:replyRecipients}:{}),...(row.completion?.result?.artifactFiles?.length?{taskDelivery:{taskId:row.taskId,requirementRevision:row.requirementRevision,artifactIds:row.completion.result.artifactFiles.map(file=>file.artifact.artifactId)}}:{})}}]
    }
    if(task){
      const next=sourceEvents.find(event=>!calls.some(call=>call.name==='resident_task_action'&&call.arguments.sourceId===event.source.sourceId))
      if(next)return [{name:'resident_task_action',args:{operationId:'fixture-context:'+next.source.sourceId,sourceId:next.source.sourceId,messageVersion:next.source.version,kind:'supplement',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,text:next.source.text}}]
      return [{name:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'fixture-settle:'+input.events.map(event=>event.id).join(',')}}]
    }
    if(sourceEvents.length&&!calls.some(call=>call.name==='resident_task_plan'))return [{name:'resident_task_plan',args:{operationId:'fixture-plan:'+sourceEvents.map(event=>event.source.sourceId).join(','),sourceId:sourceEvents[0].source.sourceId,messageVersion:sourceEvents[0].source.version,
      tasks:sourceEvents.map(event=>({taskId:'fixture-task-'+createHash('sha256').update(event.source.sourceId).digest('hex').slice(0,24),title,objective:objective??event.source.text,requirements:['Complete the original request and retain evidence'],quote:event.source.text})),dependencies:[]}}]
    const confirmation=sourceEvents.find(event=>!calls.some(call=>call.name==='resident_router_reply'&&call.arguments.sourceId===event.source.sourceId))
    if(confirmation)return [{name:'resident_router_reply',args:{operationId:'fixture-confirmation:'+confirmation.source.sourceId,sourceId:confirmation.source.sourceId,messageVersion:confirmation.source.version,text:'已接收原交办，按当前要求核查。'+signature}}]
    return [{name:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'fixture-settle:'+input.events.map(event=>event.id).join(',')}}]
  }

  if (input.trigger === 'task-facts') return [{ name: 'group_decision_submit', args: {
    requestId: input.requestId, topicId: input.topicId, revision: input.revision,
    decision: { actions: [], topicUpdate: { summary: input.facts.map(fact => fact.summary).join('\n') },
      ...(input.facts.some(fact => fact.audience !== 'operator') ? { reply: input.facts.filter(fact => fact.audience !== 'operator').map(fact => fact.question || fact.summary).join('\n'),
        replyToMessageId: input.sources.at(-1).messageId, atOpenDingTalkIds: [input.sources.at(-1).actorId] } : {}), reason: '任务新增了可向用户说明的结果。' },
  } }]
  if (input.requestId?.startsWith('coord-summary-')) return [{ name: 'group_topic_summary_submit', args: {
    requestId: input.requestId, topicId: input.topicId, summary: title,
  } }]
  if (names.includes('group_topic_route_submit')) return [{ name: 'group_topic_route_submit', args: { requestId: input.requestId, routes: input.messages.map(message => ({
    messageId: message.messageId, messageVersion: message.messageVersion, ignoredRefs: [],
    units: [{ unitKey: 'request', summary: title, sourceRefs: [{ quote: message.text }], topics: [{ newTopicKey: message.messageId, title, reason: '当前消息是新的交付事项', candidateComparisons: [...new Map([...(input.topics ?? []), ...(input.relatedTopics ?? []), ...(input.recalledTopics ?? [])].map(topic => [topic.topicId, topic])).values()].map(topic => ({ topicId: topic.topicId, revision: topic.revision, reason: '当前测试消息是独立交付事项' })) }] }],
  })) } }]
  if (names.includes('group_decision_submit')) {
    const basisUnitRefs = input.messages.map(({ unitId, unitRevision }) => ({ unitId, unitRevision }))
    const text = objective ?? input.messages.map(message => message.text).join('\n')
    const replyTarget = input.messages.findLast(message => message.senderOpenDingTalkId && !['web', 'internal'].includes(message.sourceKind))
    return [{ name: 'group_decision_submit', args: { requestId: input.requestId, topicId: input.topicId, revision: input.revision, decision: {
      basisMessageIds: [...new Set(input.messages.map(message => message.messageId))], basisUnitRefs,
      actions: [{ kind: 'new-task', title, objective: text, acceptanceCriteria: ['完成原消息要求并核验证据'], topicRefs: [{ topicId: input.topicId, revision: input.revision }], basisUnitRefs,
        dispatchAssessment: { businessObject: title, agentDeliverable: text, externalFollowup: [], sourceUnitRefs: basisUnitRefs } }], reply: '收到，已交办任务。', ...(replyTarget ? { replyToMessageId: replyTarget.messageId } : {}), replyReview: { kind: 'confirmation', reviewedOutboundIds: [], sameMatterOutboundIds: [], replaceOutboundIds: [] },
    } } }]
  }
}
