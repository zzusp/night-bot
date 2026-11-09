import {digest, fail} from './security.js'

// 业务文字在既有授权范围内脱敏；工具另经固定字段投影。系统、思考和私有审计不进入浏览器。
export function visibleText(value, secrets = [], {maxLength = 16000, preservePaths = false} = {}) {
  const original = String(value ?? '')
  let text = original, redacted = false
  // 已获准的业务文字也可能是 JSON；敏感键脱敏不能替代工具公开字段选择。
  const scrub = value => Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (/^(?:.*(?:token|password|secret|credential|authorization|permission|capability|apiKey).*|arguments|env|cwd|path|directory|workspaceDir|logPath|taskSession|materials|sourceRefs)$/i.test(key)) {
        redacted = true; return [key, '[已隐藏]']
      }
      return [key, scrub(child)]
    })) : value
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      const selected = scrub(parsed)
      if (redacted) text = JSON.stringify(selected, null, 2)
    }
  } catch {}
  const before = text
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[已隐藏]')
  text = text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret|credentials?|permission[_-]?token|dispatch[_-]?token|token)["']?\s*[:=]\s*["']?)(?!\[已隐藏\])[^\s"'&,}\]]+/gi, '$1[已隐藏]')
  if (!preservePaths) text = text.replace(/(^|[\s"'=(\[{])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>)}\]]+/g, '$1[路径已隐藏]')
  const truncated = text.length > maxLength
  return {text: text.slice(0, maxLength), redacted: redacted || text !== before, ...(truncated ? {truncated: true} : {})}
}

const texts = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : ''
// 工具名、字段和类型决定公开上限；未知字段不读取值，也不递归或原样序列化。
const toolString = value => typeof value === 'string' ? value : undefined
const toolNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const toolBoolean = value => typeof value === 'boolean' ? value : undefined
const toolEnum = values => value => values.includes(value) ? value : undefined
const toolObject = fields => (value, state) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = {}
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(fields, key)) {state.hidden = true; continue}
    const selected = fields[key](value[key], state)
    if (selected === undefined) state.hidden = true
    else result[key] = selected
  }
  return result
}
const toolArray = select => (value, state) => {
  if (!Array.isArray(value)) return undefined
  const result = []
  for (const row of value) {
    const selected = select(row, state)
    if (selected === undefined) state.hidden = true
    else result.push(selected)
  }
  return result
}
const toolStrings = toolArray(toolString)
const toolPage = {offset: toolNumber, limit: toolNumber}
const toolTaskFields = {title: toolString, objective: toolString, request: toolString, requirements: toolStrings, quote: toolString}
const toolDependencies = toolArray(toolObject({condition: toolString}))
const toolDecision = toolObject({action: toolEnum(['complete', 'wait', 'blocked']), summary: toolString, question: toolString,
  limitations: toolStrings, evidence: toolStrings, deliveryFiles: toolArray(toolObject({caption: toolString}))})
const toolSchedule = {title: toolString, prompt: toolString, after_seconds: toolNumber, every_seconds: toolNumber,
  daily: toolObject({time: toolString, time_zone: toolString}),
  weekly: toolObject({time: toolString, time_zone: toolString, weekdays: toolArray(toolNumber)}),
  cron: toolObject({expression: toolString, time_zone: toolString})}
const toolMemory = {scope: toolEnum(['personal', 'group', 'project'])}

// 私有 memory topic/key/query 与 skill catalog 没有公开证明，不由任务历史读取权推导。
const toolInputs = {
  read: toolPage, read_window: toolPage, read_image: {}, write: {}, edit: {},
  find: {pattern: toolString, limit: toolNumber}, grep: {pattern: toolString, include: toolString},
  web_search: {queries: toolStrings}, web_fetch: {},
  bash: {description: toolString, timeoutMs: toolNumber, run_in_background: toolBoolean},
  pwsh: {description: toolString, timeoutMs: toolNumber, run_in_background: toolBoolean},
  job_output: {wait: toolBoolean, timeout_ms: toolNumber}, job_kill: {reason: toolString}, job_list: {},
  working_directory: {}, skill: {},
  todo_write: {todos: toolArray(toolObject({content: toolString, status: toolEnum(['pending', 'in_progress', 'completed'])}))},
  schedule_create: toolSchedule, schedule_update: toolSchedule, schedule_list: {}, schedule_delete: {},
  memory_status: {}, memory_candidates: {}, memory_read: toolMemory, memory_search: {...toolMemory, limit: toolNumber},
  memory_remember: {...toolMemory, expectedRevision: toolNumber, expiresAt: toolString},
  memory_forget: {...toolMemory, expectedRevision: toolNumber}, memory_promote: {...toolMemory, expectedRevision: toolNumber},
  task_result: {decision: toolDecision}, task_human_resolve: {reason: toolString},
  resident_task_query: toolPage, resident_source_get: {},
  resident_task_plan: {tasks: toolArray(toolObject(toolTaskFields)), dependencies: toolDependencies},
  resident_task_action: {kind: toolEnum(['supplement', 'revise', 'reopen', 'control', 'arrange']), control: toolEnum(['active', 'paused', 'cancelled']),
    text: toolString, objective: toolString, title: toolString, requirements: toolStrings, reason: toolString, sameGoal: toolBoolean, dependencies: toolDependencies},
  resident_dependency_evaluate: {decision: toolEnum(['satisfied', 'continue', 'wait']), evidence: toolStrings},
  resident_router_reply: {text: toolString, replyToSource: toolBoolean}, resident_router_settle: {},
  platform_task_query: {state: toolEnum(['running', 'completed', 'all']), day: toolString, ...toolPage},
  platform_config_query: {}, platform_schedule_submit: {title: toolString, prompt: toolString, at: toolString},
  model_content_read: toolPage,
}
const toolStatus = toolEnum(['open', 'active', 'paused', 'cancelled', 'pending', 'running', 'completed', 'error', 'failed', 'blocked',
  'waiting', 'scheduled', 'accepted', 'settled', 'ready', 'done', 'unknown', 'held', 'deferred', 'queued', 'sent', 'delivered', 'ok'])
const toolReceipt = {received: toolBoolean, accepted: toolBoolean, settled: toolBoolean, scheduled: toolBoolean, status: toolStatus}
const toolTask = toolObject({...toolTaskFields, state: toolStatus, status: toolStatus, control: toolEnum(['active', 'paused', 'cancelled']),
  result: toolDecision, completion: toolObject({result: toolDecision})})
const toolTaskResults = {...toolPage, task: toolTask, tasks: toolArray(toolTask), total: toolNumber, hasMore: toolBoolean, nextOffset: toolNumber,
  dependencies: toolDependencies}
const toolOutputs = {
  task_result: toolReceipt, task_human_resolve: toolReceipt,
  resident_task_query: toolTaskResults, platform_task_query: {...toolTaskResults, day: toolString, timeZone: toolString},
  resident_source_get: {text: toolString, quote: toolString},
  resident_task_plan: {...toolReceipt, result: toolObject({tasks: toolArray(toolTask), dependencies: toolDependencies})},
  resident_task_action: {...toolReceipt, task: toolTask, result: toolObject({task: toolTask})},
  resident_dependency_evaluate: {...toolReceipt, result: toolObject({decision: toolEnum(['satisfied', 'continue', 'wait']), evidence: toolStrings})},
  resident_router_reply: toolReceipt, resident_router_settle: toolReceipt,
  platform_config_query: {timeZone: toolString, concurrency: toolNumber}, platform_schedule_submit: toolReceipt,
}

function toolInput(name, args) {
  if (!Object.hasOwn(toolInputs, name)) return {toolName: '未公开工具', text: '工具输入未公开。', redacted: true}
  const state = {hidden: false}, value = toolObject(toolInputs[name])(args ?? {}, state) ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) state.hidden = true
  if (name === 'write' && typeof args?.content === 'string') value.contentCharacters = args.content.length
  if (name === 'edit' && Array.isArray(args?.edits)) value.editCount = args.edits.length
  if (name === 'working_directory') value.action = typeof args?.cd === 'string' ? '切换工作目录' : '读取工作目录'
  if (name === 'skill') value.action = '加载技能'
  if (name === 'read_image') value.action = '读取图像'
  if (name === 'web_fetch') value.action = '读取网页'
  if (name === 'resident_router_reply' && Array.isArray(args?.taskDelivery?.artifactIds)) value.deliveryFileCount = args.taskDelivery.artifactIds.length
  return {toolName: name, text: JSON.stringify(value, null, 2), redacted: state.hidden}
}
function toolOutput(call, message, identity) {
  const hidden = {toolName: '未公开工具', text: '工具结果正文未公开。', redacted: true}
  // 孤立、重复 ID 或名称冲突的结果保留事件，但不借 result.toolName 猜测公开权限。
  if (!call || call.name !== message.toolName || !Object.hasOwn(toolInputs, call.name)) return hidden
  const name = call.name, state = {hidden: false}
  const summary = {toolName: name, text: '工具已返回；仅展示调用与状态，结果正文未公开。', redacted: true}
  if (message.isError === true) return summary
  const content = message.content
  if (Array.isArray(content) && content.some(block => block.type !== 'text' || Object.keys(block).some(key => key !== 'type' && key !== 'text'))) state.hidden = true
  const text = texts(content)
  // 调用方已认证安装操作者的任务读取权；这些工具声明的是该任务业务文字。
  // JSON 文件仍是文字，不按外观改当工具 DTO；memory/skill 的独立 scope 不由此授予。
  if (identity.taskId && ['read', 'read_window', 'grep', 'web_search', 'web_fetch'].includes(name)) {
    if (!text) return summary
    const publicText = ['web_search', 'web_fetch'].includes(name)
      ? text.replace(/https?:\/\/[^\s<>"')]+/gi, '[网页地址已隐藏]') : text
    return {toolName: name, text: publicText, redacted: state.hidden || publicText !== text}
  }
  if (!Object.hasOwn(toolOutputs, name)) return summary
  let raw
  try {raw = JSON.parse(text)} catch {return summary}
  const value = toolObject(toolOutputs[name])(raw, state)
  if (!value || !Object.keys(value).length) return summary
  return {toolName: name, text: JSON.stringify(value, null, 2), redacted: state.hidden}
}

const stamp = (message, entry) => {
  const value = message?.timestamp ?? entry.timestamp
  const date = typeof value === 'number' || typeof value === 'string' ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function projectEntries(snapshot, identity, secrets) {
  const {taskId, sessionId, conversationId, generation} = identity
  const items = [], sources = new Set(), calls = new Map()
  const opaque = (...parts) => digest(JSON.stringify([sessionId, ...parts]))
  const add = (entry, suffix, role, value, extra = {}, message) => {
    const visible = visibleText(value, secrets, {maxLength: Infinity})
    if (!visible.text && !extra.toolName) return
    items.push({id: opaque(entry.id, suffix), role, createdAt: stamp(message, entry), ...visible, ...extra,
      source: {sessionId, entryId: opaque(entry.id), ...(extra.callId ? {callId: extra.callId} : {})}})
  }
  const sourceText = (entry, suffix, row) => {
    if (typeof row?.text !== 'string') return
    const key = JSON.stringify([row.sourceId, row.version, row.text])
    if (sources.has(key)) return
    sources.add(key)
    add(entry, suffix, 'user', row.text, {kind: 'source'})
  }
  for (const projected of snapshot.context.projection.entries) {
    const entry = projected.sourceEntry
    if (!entry || typeof entry.id !== 'string') continue
    for (const [index, message] of projected.messages.entries()) {
      if (message.role === 'assistant') {
        add(entry, 'assistant-' + index, 'assistant', texts(message.content), {kind: 'message', ...(['stop', 'length', 'toolUse', 'error', 'aborted'].includes(message.stopReason) ? {status: message.stopReason} : {})}, message)
        for (const [blockIndex, block] of (Array.isArray(message.content) ? message.content : []).entries()) {
          if (block.type !== 'toolCall' || typeof block.name !== 'string') continue
          const callId = opaque(entry.id, index, blockIndex)
          // 厂商 ID 可跨轮重用；未配对的重复 ID 不能猜测归属。
          if (typeof block.id === 'string') calls.set(block.id, calls.has(block.id) ? null : {id: callId, name: block.name})
          const selected = toolInput(block.name, block.arguments)
          add(entry, 'call-' + index + '-' + blockIndex, 'tool', selected.text, {kind: 'tool-call', toolName: selected.toolName, ...(selected.redacted ? {redacted: true} : {}), callId, status: 'pending'}, message)
        }
      } else if (message.role === 'toolResult') {
        const nativeId = message.toolCallId, pending = calls.get(nativeId)
        const call = pending?.name === message.toolName ? pending : undefined
        const callId = call?.id ?? opaque(entry.id, 'orphan-result', index)
        calls.delete(nativeId)
        const selected = toolOutput(call, message, identity)
        add(entry, 'result-' + index, 'tool', selected.text, {kind: 'tool-result', toolName: selected.toolName, ...(selected.redacted ? {redacted: true} : {}), callId, isError: message.isError === true, status: message.isError ? 'error' : 'completed'}, message)
      } else if (message.role === 'user') {
        add(entry, 'user-' + index, 'user', texts(message.content), {kind: 'source'}, message)
      } else if (message.role === 'custom' && message.customType === 'night.business-input') {
        const source = message.details?.source
        if (taskId) {
          if (source?.kind !== 'task-input' && source?.kind !== 'task-supplement') continue
          if (source.taskSession?.taskId !== taskId || source.taskSession?.sessionId !== sessionId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          let input
          try {input = JSON.parse(texts(message.content))} catch {fail('SESSION_SOURCE_INVALID', 503)}
          const originals = Array.isArray(input.sources) ? input.sources.filter(row => typeof row.text === 'string') : []
          if (originals.length) originals.forEach((row, n) => sourceText(entry, 'source-' + index + '-' + n, row))
          else if (typeof input.task?.request === 'string') sourceText(entry, 'request-' + index, {text: input.task.request})
        } else if (source?.kind === 'conversation-router') {
          if (source.conversationId !== conversationId || source.generation !== generation) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          const content = texts(message.content), prefix = 'Router 请求：'
          let input
          try {if (!content.startsWith(prefix)) throw new Error(); input = JSON.parse(content.slice(prefix.length))} catch {fail('SESSION_SOURCE_INVALID', 503)}
          if (input.conversationId !== conversationId || input.generation !== generation || !Array.isArray(input.events)) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          input.events.forEach((event, n) => {
            if (!event.source) return
            const row = event.source
            if ((row.conversationId ?? row.groupId) !== conversationId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
            sourceText(entry, 'router-source-' + index + '-' + n, row)
          })
        }
      }
    }
  }
  return items
}

function pageOptions({offset = 0, limit = 50}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('PAGE_INVALID')
  return {offset, limit}
}
async function projection({base, identity, persistence, validIdentity, notStarted, revision, secrets = []}) {
  const {sessionId} = identity
  if (!sessionId || !persistence?.readNative) return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  let snapshot
  try {snapshot = await persistence.readNative(sessionId, {requireComplete: true})} catch (error) {
    if (error.code === 'PI_SESSION_UNCOMMITTED_TAIL' || error.code === 'PI_SESSION_COMMIT_REQUIRED') return {...base, status: 'pending', reason: 'SESSION_COMMIT_PENDING'}
    if (error.name === 'SessionPersistenceNotFoundError' && notStarted) return {...base, status: 'pending', reason: 'SESSION_NOT_STARTED'}
    return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  }
  if (snapshot.header?.id !== sessionId || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.context?.projection?.entries) || !validIdentity(snapshot)) fail('SESSION_IDENTITY_INVALID', 503)
  const currentRevision = digest(JSON.stringify([sessionId, snapshot.entries.at(-1)?.id]))
  if (revision && revision !== currentRevision) fail('SESSION_PAGE_STALE', 409)
  return {...base, status: 'ready', revision: currentRevision, items: projectEntries(snapshot, identity, secrets)}
}
function sessionPage(value, options) {
  const {offset, limit} = pageOptions(options)
  if (value.status !== 'ready') return value
  const rows = value.items, end = Math.max(0, rows.length - offset)
  const items = rows.slice(Math.max(0, end - limit), end).map(row => ({...row, text: row.text.slice(0, 16000), textTotal: row.text.length,
    textNextOffset: row.text.length > 16000 ? 16000 : null, ...(row.text.length > 16000 ? {truncated: true} : {})}))
  return {...value, items, total: rows.length, offset, limit, nextOffset: offset + items.length < rows.length ? offset + items.length : null}
}
function messagePage(value, {messageId, offset = 0, limit = 16000, revision}) {
  if (typeof revision !== 'string' || !revision || typeof messageId !== 'string' || !/^[a-f0-9]{64}$/.test(messageId)
    || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) fail('PAGE_INVALID')
  if (value.status !== 'ready') fail(value.reason, 503)
  const row = value.items.find(item => item.id === messageId)
  if (!row) fail('SESSION_MESSAGE_NOT_FOUND', 404)
  if (offset > row.text.length) fail('PAGE_INVALID')
  const end = Math.min(row.text.length, offset + limit)
  return {messageId, text: row.text.slice(offset, end), offset, nextOffset: end < row.text.length ? end : null, total: row.text.length, revision: value.revision, source: row.source, redacted: row.redacted}
}
async function taskProjection({task, ...options}) {
  const taskId = task.taskId, sessionId = task.session?.sessionId ?? task.sessionId
  const base = {taskId, sessionId: sessionId ?? null, scope: 'current-session-context', items: [], total: 0, nextOffset: null}
  return projection({...options, base, identity: {taskId, sessionId}, notStarted: task.session?.sessionBound === false,
    validIdentity: snapshot => {
      const identities = snapshot.audit?.filter(row => row.domain === 'task' && row.kind === 'identity') ?? []
      return identities.length === 1 && identities[0].version === 1 && identities[0].payload?.taskId === taskId && identities[0].payload?.sessionId === sessionId
    }})
}
async function routerProjection({conversationId, readRouter, ...options}) {
  const router = await readRouter(), sessionId = router?.activeSessionId
  const base = {conversationId, sessionId: sessionId ?? null, scope: 'current-router-session-context', items: [], total: 0, nextOffset: null}
  if (!router || !sessionId) return {...base, status: 'pending', reason: 'SESSION_NOT_STARTED'}
  if (router.id !== conversationId || !Number.isSafeInteger(router.generation) || router.generation < 1) fail('SESSION_IDENTITY_INVALID', 503)
  const value = await projection({...options, base, identity: {sessionId, conversationId, generation: router.generation}, notStarted: true,
    validIdentity: snapshot => snapshot.header.runtimeOwner === 'conversation-router' && snapshot.header.conversationId === conversationId && snapshot.header.generation === router.generation})
  const current = await readRouter()
  if (current?.activeSessionId !== sessionId || current?.generation !== router.generation || current?.phase !== router.phase) fail('SESSION_PAGE_STALE', 409)
  return value
}
export async function taskSessionView(options) {pageOptions(options); return sessionPage(await taskProjection(options), options)}
export async function taskSessionMessageView(options) {return messagePage(await taskProjection(options), options)}
export async function routerSessionView(options) {pageOptions(options); return sessionPage(await routerProjection(options), options)}
export async function routerSessionMessageView(options) {return messagePage(await routerProjection(options), options)}
