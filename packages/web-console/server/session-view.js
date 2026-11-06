import {digest, fail} from './security.js'

// 仅显示业务文字；原始参数、系统指令、思考块与审计对象不进入浏览器。
export function visibleText(value, secrets = [], {maxLength = 16000} = {}) {
  const original = String(value ?? '')
  let text = original, redacted = false
  // 工具的文字块可能是 JSON；先移除结构化私有字段，再处理普通文本。
  const scrub = value => Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (/^(?:.*(?:token|password|secret|credential|authorization|permission|capability|apiKey).*|arguments|env|cwd|path|directory|workspaceDir|logPath|taskSession|materials|sourceRefs)$/i.test(key)) {
        redacted = true; return [key, '[已隐藏]']
      }
      return [key, scrub(child)]
    })) : value
  try {const parsed = JSON.parse(text); if (parsed && typeof parsed === 'object') text = JSON.stringify(scrub(parsed), null, 2)} catch {}
  const before = text
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[已隐藏]')
  text = text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret|credentials?|permission[_-]?token|dispatch[_-]?token|token)["']?\s*[:=]\s*["']?)(?!\[已隐藏\])[^\s"'&,}\]]+/gi, '$1[已隐藏]')
    .replace(/(^|[\s"'=(\[{])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>)}\]]+/g, '$1[路径已隐藏]')
  const truncated = text.length > maxLength
  return {text: text.slice(0, maxLength), redacted: redacted || text !== before, ...(truncated ? {truncated: true} : {})}
}

const texts = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : ''
const stamp = (message, entry) => {
  const value = message?.timestamp ?? entry.timestamp
  const date = typeof value === 'number' || typeof value === 'string' ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function projectEntries(snapshot, taskId, sessionId, secrets) {
  const items = [], sources = new Set()
  const add = (entry, suffix, role, value, extra = {}, message) => {
    const visible = visibleText(value, secrets)
    if (!visible.text && !extra.toolName) return
    items.push({id: digest(entry.id + ':' + suffix), role, createdAt: stamp(message, entry), ...visible, ...extra})
  }
  for (const projected of snapshot.context.projection.entries) {
    const entry = projected.sourceEntry
    if (!entry || typeof entry.id !== 'string') continue
    for (const [index, message] of projected.messages.entries()) {
      if (message.role === 'assistant') {
        add(entry, 'assistant-' + index, 'assistant', texts(message.content), {kind: 'message', ...(['stop', 'length', 'toolUse', 'error', 'aborted'].includes(message.stopReason) ? {status: message.stopReason} : {})}, message)
        for (const [blockIndex, block] of (message.content ?? []).entries()) {
          if (block.type !== 'toolCall' || typeof block.name !== 'string') continue
          add(entry, 'call-' + index + '-' + blockIndex, 'tool', '', {kind: 'tool-call', toolName: visibleText(block.name, secrets).text.slice(0, 128), ...(typeof block.id === 'string' ? {callId: digest(block.id)} : {})}, message)
        }
      } else if (message.role === 'toolResult') {
        add(entry, 'result-' + index, 'tool', texts(message.content), {kind: 'tool-result', toolName: visibleText(message.toolName, secrets).text.slice(0, 128), ...(typeof message.toolCallId === 'string' ? {callId: digest(message.toolCallId)} : {}), status: message.isError ? 'error' : 'completed'}, message)
      } else if (message.role === 'user') {
        add(entry, 'user-' + index, 'user', texts(message.content), {kind: 'source'}, message)
      } else if (message.role === 'custom' && message.customType === 'night.business-input') {
        const source = message.details?.source
        if (source?.kind !== 'task-input' && source?.kind !== 'task-supplement') continue
        if (source.taskSession?.taskId !== taskId || source.taskSession?.sessionId !== sessionId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
        let input
        try {input = JSON.parse(texts(message.content))} catch {fail('SESSION_SOURCE_INVALID', 503)}
        const originalSources = Array.isArray(input.sources) ? input.sources.filter(row => typeof row.text === 'string') : []
        if (originalSources.length) {
          for (const [sourceIndex, row] of originalSources.entries()) {
            const key = JSON.stringify([row.sourceId, row.version, row.text])
            if (sources.has(key)) continue
            sources.add(key)
            add(entry, 'source-' + index + '-' + sourceIndex, 'user', row.text, {kind: 'source'})
          }
        } else if (typeof input.task?.request === 'string') {
          const key = digest(input.task.request)
          if (!sources.has(key)) {sources.add(key); add(entry, 'request-' + index, 'user', input.task.request, {kind: 'source'})}
        }
      }
    }
  }
  return items
}

export async function taskSessionView({task, persistence, offset = 0, limit = 50, revision, secrets = []}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('PAGE_INVALID')
  const taskId = task.taskId, sessionId = task.session?.sessionId ?? task.sessionId
  const base = {taskId, sessionId: sessionId ?? null, scope: 'current-session-context', items: [], total: 0, nextOffset: null}
  if (!sessionId || !persistence?.readNative) return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  let snapshot
  try {snapshot = await persistence.readNative(sessionId, {requireComplete: true})} catch (error) {
    if (error.code === 'PI_SESSION_UNCOMMITTED_TAIL' || error.code === 'PI_SESSION_COMMIT_REQUIRED') return {...base, status: 'pending', reason: 'SESSION_COMMIT_PENDING'}
    if (error.name === 'SessionPersistenceNotFoundError' && task.session?.sessionBound === false) return {...base, status: 'pending', reason: 'SESSION_NOT_STARTED'}
    return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  }
  const identities = snapshot.audit?.filter(row => row.domain === 'task' && row.kind === 'identity') ?? []
  if (snapshot.header?.id !== sessionId || identities.length !== 1 || identities[0].version !== 1
    || identities[0].payload?.taskId !== taskId || identities[0].payload?.sessionId !== sessionId
    || !Array.isArray(snapshot.context?.projection?.entries)) fail('SESSION_IDENTITY_INVALID', 503)
  const currentRevision = digest(JSON.stringify([sessionId, snapshot.entries.at(-1)?.id]))
  if (revision && revision !== currentRevision) fail('SESSION_PAGE_STALE', 409)
  const rows = projectEntries(snapshot, taskId, sessionId, secrets), end = Math.max(0, rows.length - offset)
  const items = rows.slice(Math.max(0, end - limit), end)
  return {...base, status: 'ready', items, total: rows.length, offset, limit, revision: currentRevision,
    nextOffset: offset + items.length < rows.length ? offset + items.length : null}
}
