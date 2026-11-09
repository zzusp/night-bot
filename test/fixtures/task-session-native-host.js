// Actual installed Host and public Pi SDK; legacy manual Loop/Session composition retired.
// Business scripts consume the official request. This fixture does not translate
// Owner/member tools, seed audit events, or recreate Host message history.
import assert from 'node:assert/strict'
export {nativeRuntimeHost as nativeTaskHost,available,reason,nativeShell} from './runtime-official-host.js'

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

let contextSequence = 0
export function* contextReadResponse(request) {
  const calls = contextReadCalls(request)
  if (!calls) return false
  for (const [index, call] of calls.entries()) {
    const id = 'context-read-' + ++contextSequence, args = JSON.stringify(call.args)
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args }
    yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: args } }
  }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
  return true
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

// Custom fault-injection adapters must answer maintenance in its own session
// before advancing any owner/executor fault counter.
export function* topicSummaryResponse(request, audit) {
  let input
  try { input = latestInput(request) } catch { return false }
  if (!input.requestId?.startsWith('coord-summary-')) return false
  audit.push(structuredClone(request))
  const call = topicTaskCalls(request)[0], id = 'summary-' + input.requestId, args = JSON.stringify(call.args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
  return true
}

// Script model decisions only; routing, validation and durable topic state remain real.
export function topicTaskCalls(request, { title = '原消息交办', objective } = {}) {
  const input = latestInput(request), names = request.tools.map(tool => tool.name)
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

// 给原流程补充两项实际验收：核对结果所属版本、核对交付引用/限制。
// 通过原生团队读取与文件读取取证，不重放原作业，不改变原执行身份。
export function nativeVerificationTeam({ filePath, expected } = {}) {
  const call = (name, args) => ({ name, args })
  const decision = (action, summary) => call('task_session_submit', { decision: { action, summary, evidence: [], limitations: [] } })
  const assigned = new Set(), steps = new Map()
  return {
    owner(input, primary) {
      if (!primary?.drained || primary.status !== 'succeeded') return null
      if (input.executions.length >= 3) return null
      if (assigned.has(input.task.taskId)) return null
      assigned.add(input.task.taskId)
      const roles = input.executions.length === 2 ? ['delivery-evidence'] : ['result-version', 'delivery-evidence']
      return roles.map(role => call('task_delegate', {
        key: 'verify-' + role, objective: 'verify-' + role,
        context: JSON.stringify({ role, executionId: primary.executionId, inputVersion: primary.inputVersion,
          instruction: role === 'result-version' ? '只读核对原执行结果与当前输入版本一致，不能重放原作业。' : '只读核对原结果的交付引用和限制；有文件则读取实际交付，不扩大为业务完成。',
          ...(filePath ? { filePath, expected: expected || primary.input.objective } : {}) }),
      })).concat(decision('wait', '原作业已结束，等待结果版本和交付证据核验'))
    },
    execute(request, input) {
      if (!['verify-result-version', 'verify-delivery-evidence'].includes(input.objective)) return null
      const scope = JSON.parse(input.context), key = input.task.taskId + ':' + input.objective
      const step = steps.get(key) ?? 0
      if (step === 0) { steps.set(key, 1); return [call('execution_team_read', {})] }
      const projected = modelToolValues(request).findLast(value => value.taskId === input.task.taskId && value.executions)
      let team
      try { team = projected && resolveContextInput(request, projected) }
      catch (error) { if (error.contextReads) return error.contextReads.map(args => call('model_content_read', args)); throw error }
      assert.ok(team, '独立成员必须实际读取同Task团队记录')
      const original = team.executions.find(item => item.executionId === scope.executionId)
      assert.equal(original?.inputVersion, scope.inputVersion)
      assert.equal(original.status, 'succeeded')
      assert.ok(original.result, '核验必须基于已落账结果')
      if (scope.role === 'delivery-evidence') {
        assert.ok(original.result.payload.output)
        assert.ok(Array.isArray(original.result.payload.output.artifacts))
        assert.ok(Array.isArray(original.result.payload.output.limitations))
        if (scope.filePath) {
          if (step === 1) { steps.set(key, 2); return [call('read', { file_path: scope.filePath })] }
          assert.ok(JSON.stringify(request.messages.filter(message => ['toolResult', 'tool'].includes(message.role))).includes(scope.expected), '实际交付内容必须进入核验成员上下文')
        }
      }
      return [call('execution_submit', { output: { status: 'completed', summary: scope.instruction,
        evidence: [scope.executionId + ':' + scope.inputVersion, ...(scope.filePath ? [scope.filePath] : [])],
        limitations: ['只核对指定结果版本与交付证据，不代替整体业务验收'], artifacts: [] } })]
    },
  }
}
