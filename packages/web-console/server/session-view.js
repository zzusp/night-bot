import {randomUUID} from 'node:crypto'
import {triageSessionId} from '../../../src/channels/triage.js'
import {setImmediate as yieldToIO} from 'node:timers/promises'
import {digest, fail} from './security.js'

// Names cover environment variables, JSON fields and HTTP headers. A configured
// installation token alone is not a registry of credentials used by task tools.
const credentialName = /(?:token|password|passwd|secret|credential|cookie|authorization|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?key)/i
const credentialAssignment = /(?<![\w.-])([\w.-]*(?:token|password|passwd|secret|credential|cookie|authorization|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?key)[\w.-]*["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:''|[^'])*'|[^\s"'&,}\]]+)/gi
const credentialFlag = /(?:^|\s)--?(?:[\w-]*[-_])?(?:token|password|passwd|secret|credentials?|cookie|authorization|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?key)(?=[=:\s]|$)/i

// 安装操作者可查看任务业务文字与已返回思考；系统指令、秘密和私有审计不透传。
export function visibleText(value, secrets = [], {maxLength = 16000, preservePaths = false} = {}) {
  const original = String(value ?? '')
  let text = original, redacted = false, structured = false
  const redact = value => {
    let result = value
    for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[已隐藏]')
    // Shell flags can feed literals, here-strings, heredocs, pipelines or
    // PowerShell expressions. Do not guess their boundaries and expose a tail.
    if (credentialFlag.test(result) || /(?:^|\s)(?:--user(?:\s+|=)|-u\s*)\S+:\S+/.test(result)) return '[含凭据参数的内容已隐藏]'
    result = result.split(/(\r?\n)/).map(line => /\b(?:proxy-authorization|authorization|set-cookie|cookie)\s*:/i.test(line) ? '[含认证标头的内容已隐藏]' : line).join('')
    result = result.replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[私钥已隐藏]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[凭据已隐藏]')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
      .replace(credentialAssignment, (match, prefix) => {const value = match.slice(prefix.length), quote = value[0]; return prefix + (quote === '"' || quote === "'" ? quote + '[已隐藏]' + quote : '[已隐藏]')})
      .replace(/\b(https?:\/\/)[^\s/@?#]+@/gi, '$1[凭据已隐藏]@')
    if (!preservePaths) result = result.replace(/(^|[\s"'=(\[{])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>)}\]]+/g, '$1[路径已隐藏]')
    return result
  }
  const scrubString = value => {const result = redact(value); if (result !== value) redacted = true; return result}
  // 先选择获权字段；秘密也可能出现在业务命令、错误或思考的字符串中。
  const scrub = value => Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => {
      const publicKey = scrubString(key)
      if (credentialName.test(key) || /^(?:.*(?:permission|capability).*|arguments|env|taskSession|materials|sourceRefs)$/i.test(key)
        || !preservePaths && /^(?:cwd|path|directory|workspaceDir|logPath)$/i.test(key)) {
        redacted = true; return [publicKey, '[已隐藏]']
      }
      return [publicKey, scrub(child)]
    })) : typeof value === 'string' ? scrubString(value) : value
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      structured = true
      const selected = scrub(parsed)
      if (redacted) text = JSON.stringify(selected, null, 2)
    }
  } catch {
    // A parsed but unprocessable object must never fall back to its raw bytes.
    if (structured) return {text: '[无法安全处理的内容已隐藏]', redacted: true}
  }
  const before = text
  if (!structured) text = redact(text)
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
  read: {path: toolString, ...toolPage}, read_window: {path: toolString, ...toolPage}, read_image: {path: toolString},
  write: {path: toolString, content: toolString},
  edit: {path: toolString, edits: toolArray(toolObject({oldText: toolString, newText: toolString}))},
  find: {pattern: toolString, path: toolString, limit: toolNumber}, grep: {pattern: toolString, path: toolString, include: toolString},
  web_search: {queries: toolStrings}, web_fetch: {url: toolString},
  bash: {description: toolString, command: toolString, workdir: toolString, timeoutMs: toolNumber, run_in_background: toolBoolean},
  pwsh: {description: toolString, command: toolString, workdir: toolString, timeoutMs: toolNumber, run_in_background: toolBoolean},
  job_output: {job_id: toolString, wait: toolBoolean, timeout_ms: toolNumber}, job_kill: {job_id: toolString, reason: toolString}, job_list: {},
  working_directory: {cd: toolString}, skill: {},
  todo_write: {todos: toolArray(toolObject({content: toolString, status: toolEnum(['pending', 'in_progress', 'completed'])}))},
  schedule_create: toolSchedule, schedule_update: toolSchedule, schedule_list: {}, schedule_delete: {},
  memory_status: {}, memory_candidates: {}, memory_read: toolMemory, memory_search: {...toolMemory, limit: toolNumber},
  memory_remember: {...toolMemory, expectedRevision: toolNumber, expiresAt: toolString},
  memory_forget: {...toolMemory, expectedRevision: toolNumber}, memory_promote: {...toolMemory, expectedRevision: toolNumber},
  task_result: {decision: toolDecision}, task_human_resolve: {reason: toolString},
  channel_triage_submit: {dispositions: toolArray(toolObject({needsHandling: toolBoolean, reply: toolString, reason: toolString}))},
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
  channel_triage_submit: {dispositions: toolArray(toolObject({state: toolEnum(['committed']), decision: toolObject({needsHandling: toolBoolean, reply: toolString, reason: toolString})}))},
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
  if (!Object.hasOwn(toolInputs, name)) return {toolName: name, text: '此工具尚未声明可展示的输入字段；调用名称与状态保留。', redacted: true}
  const state = {hidden: false}, value = toolObject(toolInputs[name])(args ?? {}, state) ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) state.hidden = true
  if (name === 'working_directory') value.action = typeof args?.cd === 'string' ? '切换工作目录' : '读取工作目录'
  if (name === 'skill') value.action = '加载技能'
  if (name === 'read_image') value.action = '读取图像'
  if (name === 'web_fetch') value.action = '读取网页'
  if (name === 'resident_router_reply' && Array.isArray(args?.taskDelivery?.artifactIds)) value.deliveryFileCount = args.taskDelivery.artifactIds.length
  return {toolName: name, text: JSON.stringify(value, null, 2), redacted: state.hidden}
}
const taskTextTools = new Set(['read', 'read_window', 'read_image', 'write', 'edit', 'find', 'grep', 'bash', 'pwsh',
  'job_output', 'job_list', 'job_kill', 'working_directory', 'todo_write', 'web_search', 'web_fetch'])

function toolOutput(call, message, identity) {
  const hidden = {toolName: message.toolName, text: '此结果没有唯一配对的工具调用，正文未展示。', redacted: true}
  // 孤立、重复 ID 或名称冲突的结果保留事件，但不借 result.toolName 猜测公开权限。
  if (!call || call.name !== message.toolName) return hidden
  const name = call.name, state = {hidden: false}
  const summary = {toolName: name, text: /^(?:memory_|skill$)/.test(name)
    ? '此工具涉及独立的记忆或技能读取权限，请通过记忆与技能入口查看获权正文。'
    : '此工具尚未声明可展示的结果字段；调用名称与状态保留。', redacted: true}
  const content = message.content
  if (Array.isArray(content) && content.some(block => block.type !== 'text' || Object.keys(block).some(key => key !== 'type' && key !== 'text'))) state.hidden = true
  const text = texts(content)
  // 同一任务已授权的执行工具正文可读；details、二进制和独立 memory/skill scope 不由此公开。
  if (identity.taskId && taskTextTools.has(name)) {
    return {toolName: name, text: text || '工具已返回，未包含文字正文。', redacted: state.hidden}
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

// Only project fields from the exact admitted packet, never today's mutable task.
// Legacy requests may be cumulative. New packets carry exact explicit deltas; never parse marker strings.
function taskInstruction(input) {
  const task = input?.task
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ''
  const updates = [...(Array.isArray(input.updates) ? input.updates.map(row => row?.text) : []), input.supplement?.text].filter(value => typeof value === 'string' && value.trim())
  const request = typeof task.request === 'string' && task.request.trim() ? task.request : ''
  const objective = typeof task.objective === 'string' && task.objective.trim() ? task.objective : ''
  const requirements = Array.isArray(task.requirements) ? task.requirements.filter(value => typeof value === 'string' && value.trim()) : []
  return [updates.length ? updates.join('\n\n') : request, objective && objective !== request ? '目标：\n' + objective : '',
    requirements.length ? '要求：\n' + requirements.map(value => '- ' + value).join('\n') : ''].filter(Boolean).join('\n\n')
}

// A credential may span semantic blocks, not only provider chunks. Apply the
// existing redactor to their joined, individually sanitized text as well.
function crossBlockSensitive(blocks, secrets) {
  const joined = (Array.isArray(blocks) ? blocks : []).filter(b => b.type === 'text' || b.type === 'thinking').map(b => visibleText(b.text ?? b.thinking ?? '', secrets, {maxLength: Infinity, preservePaths: true}).text).join('')
  return visibleText(joined, secrets, {maxLength: Infinity, preservePaths: true}).text !== joined
}

async function projectEntries(snapshot, identity, secrets, calls = new Map()) {
  const {taskId, sessionId, conversationId, generation, triage} = identity
  const items = [], sources = new Set()
  let processed = 0
  const opaque = (...parts) => digest(JSON.stringify([sessionId, ...parts]))
  const add = (entry, suffix, role, value, extra = {}, message) => {
    const visible = visibleText(value, secrets, {maxLength: Infinity, preservePaths: true})
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
    // Long journals must not monopolize the shared HTTP event loop.
    if (++processed % 32 === 0) await yieldToIO()
    const entry = projected.sourceEntry
    if (!entry || typeof entry.id !== 'string') continue
    for (const [index, message] of projected.messages.entries()) {
      if (message.role === 'assistant') {
        const blocks = typeof message.content === 'string' ? [{type: 'text', text: message.content}] : message.content
        const suppressBodies = crossBlockSensitive(blocks, secrets)
        for (const [blockIndex, block] of (Array.isArray(blocks) ? blocks : []).entries()) {
          if (suppressBodies && (block.type === 'text' || block.type === 'thinking')) continue
          if (block.type === 'text' && typeof block.text === 'string') {
            add(entry, 'assistant-' + index + '-' + blockIndex, 'assistant', block.text, {kind: 'message', ...(['stop', 'length', 'toolUse', 'error', 'aborted'].includes(message.stopReason) ? {status: message.stopReason} : {})}, message)
          } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.redacted !== true) {
            add(entry, 'thinking-' + index + '-' + blockIndex, 'assistant', block.thinking, {kind: 'thinking'}, message)
          }
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
          const instruction = taskInstruction(input)
          if (instruction) add(entry, 'instruction-' + index, 'user', instruction, {kind: 'instruction'}, message)
          else {
            // Old packets without an instruction retain their real source text;
            // do not invent a Router directive or hide an otherwise readable turn.
            const originals = Array.isArray(input?.sources) ? input.sources.filter(row => typeof row?.text === 'string') : []
            originals.forEach((row, n) => sourceText(entry, 'source-' + index + '-' + n, {...row, text: '原始消息：\n' + row.text}))
          }
        } else if (triage && source?.kind === 'channel-triage') {
          if (source.conversationId !== conversationId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          const content = texts(message.content), prefix = '一级分诊请求：'
          let input
          try {if (!content.startsWith(prefix)) throw new Error(); input = JSON.parse(content.slice(prefix.length))} catch {fail('SESSION_SOURCE_INVALID', 503)}
          if (input.conversationId !== conversationId || !Array.isArray(input.messages)) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          input.messages.forEach((row, n) => {
            if ((row.conversationId ?? row.groupId) !== conversationId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
            sourceText(entry, 'triage-source-' + index + '-' + n, row)
          })
        } else if (!triage && source?.kind === 'conversation-router') {
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

function pageOptions({offset = 0, limit = 50, stream = false, checkpoint, before, revision}) {
  if (stream) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || offset !== 0 || revision
      || checkpoint != null && !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(checkpoint)
      || before != null && (!checkpoint || !/^[a-f0-9]{64}$/.test(before))) fail('PAGE_INVALID')
    return {limit}
  }
  if (checkpoint != null || before != null) fail('PAGE_INVALID')
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('PAGE_INVALID')
  return {offset, limit}
}
function taskTodos(snapshot, identity, secrets) {
  if (!identity.taskId) return {}
  const entry = snapshot.entries.findLast(entry => entry.type === 'custom' && entry.customType === 'night.audit'
    && entry.data?.domain === 'planning' && entry.data.kind === 'todos' && entry.data.version === 1)
  if (!entry) return {todos: null}
  const rows = entry.data.payload?.todos
  if (!Array.isArray(rows) || rows.some(row => typeof row?.content !== 'string' || !['pending', 'in_progress', 'completed'].includes(row.status))) fail('SESSION_TODOS_INVALID', 503)
  return {todos: {items: rows.map(row => ({...visibleText(row.content, secrets, {maxLength: Infinity, preservePaths: true}), status: row.status})),
    updatedAt: stamp(null, entry), source: {sessionId: identity.sessionId, entryId: digest(JSON.stringify([identity.sessionId, entry.id]))}}}
}

// Incremental output is cumulative, never a raw delta. Keep an unfinished tail
// (at least 512 chars and every configured secret's maximum length) so a secret
// split over provider chunks cannot leak its earlier prefix. Credential-shaped
// unfinished content is withheld as a whole until its native block ends.
export function visibleLiveText(value, secrets = [], complete = false, {shortProse = false} = {}) {
  const text = String(value ?? '')
  if(shortProse&&!complete){
    // Narrow incremental prose lane: Chinese natural-language characters and
    // punctuation only. ASCII/structured/opaque values wait for block_end,
    // rather than guessing whether an incomplete credential is harmless.
    if(/密码|密钥|令牌|口令|凭据|私钥|验证码/.test(text))return ''
    if(!/^[\p{Script=Han}\s，。！？、；：（）《》“”‘’…—·]*$/u.test(text))return ''
    const visible=visibleText(text,secrets,{maxLength:Infinity,preservePaths:true})
    if(visible.redacted)return ''
    let end=text.length
    const word=text.match(/[A-Za-z0-9_./:=+@\\-]+$/)
    if(word)end=Math.min(end,text.length-word[0].length)
    for(const secret of secrets)for(let n=Math.min(text.length,secret.length-1);n>0;n--)if(text.endsWith(secret.slice(0,n))){end=Math.min(end,text.length-n);break}
    // Do not split a UTF-16 surrogate when an event ends mid-character.
    if(end>0&&/[\uD800-\uDBFF]/.test(text[end-1]))end--
    return text.slice(0,end)
  }
  if (complete) {
    // A completed block is not the whole assistant turn. Withhold a configured
    // secret prefix at its tail until a later complete snapshot can disambiguate.
    for (const secret of secrets) for (let n = Math.min(text.length, secret.length - 1); n > 0; n--) if (text.endsWith(secret.slice(0, n))) return ''
    return visibleText(text, secrets, {maxLength: Infinity, preservePaths: true}).text
  }
  if (credentialName.test(text) || /-----BEGIN|\bBearer\b|\b(?:sk-|gh[pousr]_|github_pat_|eyJ)/i.test(text)) return ''
  const reserve = Math.max(512, ...secrets.map(value => value.length))
  const cut = text.lastIndexOf('\n', Math.max(-1, text.length - reserve - 1))
  if (cut < 0) return ''
  // Redact the cumulative value BEFORE selecting its safe prefix. Suppress
  // rather than guessing offsets when redaction has changed its length.
  const visible = visibleText(text, secrets, {maxLength: Infinity, preservePaths: true})
  if (visible.redacted) return ''
  return text.slice(0, cut + 1)
}
async function projectLive(snapshot, identity, secrets, raw, calls) {
  if (!raw || raw.sessionId !== identity.sessionId || typeof raw.active !== 'boolean' || typeof raw.revision !== 'string') return {active:false,items:[]}
  if (!raw.active) return {active:false,revision:raw.revision,items:[]}
  const extra = []
  if (raw.assistant?.message?.role === 'assistant' && typeof raw.assistant.id === 'string') {
    const message = raw.assistant.message
    const blocks = (crossBlockSensitive(message.content, secrets) ? [] : message.content ?? []).flatMap(block => {
      if (block.type !== 'text' && block.type !== 'thinking') return [{type:'omitted'}]
      const field = block.type === 'text' ? 'text' : 'thinking'
      const text = visibleLiveText(block[field], secrets, block.complete === true, {shortProse:true})
      return text ? [{type:block.type,[field]:text}] : [{type:'omitted'}]
    })
    if (blocks.length) extra.push({sourceEntry:{id:raw.assistant.id},messages:[{role:'assistant',timestamp:message.timestamp,content:blocks}]})
  }
  // Only the exact currently pending official call can lend its public result
  // schema to a live tool update; tools never self-authorize by naming a tool.
  const pending = new Map([...calls].map(([id, call]) => [id, call?.name ?? null]))
  for (const tool of raw.tools ?? []) {
    if (typeof tool.id !== 'string' || pending.get(tool.toolCallId) !== tool.toolName || !Array.isArray(tool.content) || !tool.content.length) continue
    if (!(identity.taskId && taskTextTools.has(tool.toolName)) && !Object.hasOwn(toolOutputs,tool.toolName)) continue
    if (!(identity.taskId && taskTextTools.has(tool.toolName)) && !tool.complete) continue
    const text=visibleLiveText(texts(tool.content),secrets,tool.complete===true)
    if (!text) continue
    extra.push({sourceEntry:{id:tool.id},messages:[{role:'toolResult',toolCallId:tool.toolCallId,toolName:tool.toolName,isError:tool.isError===true,content:[{type:'text',text}]}]})
  }
  const liveEntryIds = new Set(extra.map(row=>digest(JSON.stringify([identity.sessionId,row.sourceEntry.id]))))
  const combined={...snapshot,context:{...snapshot.context,projection:{...snapshot.context.projection,entries:extra}}}
  return {active:true,revision:raw.revision,...(['waiting','thinking','text','tool'].includes(raw.phase)?{phase:raw.phase}:{}),...(typeof raw.phaseStartedAt==='string'&&Number.isFinite(Date.parse(raw.phaseStartedAt))?{phaseStartedAt:raw.phaseStartedAt}:{}),items:(await projectEntries(combined,identity,secrets,new Map(calls))).filter(row=>liveEntryIds.has(row.source.entryId)).map(row=>({...row,transient:true,status:'running',text:row.text.slice(0,16000),textTotal:row.text.length,textNextOffset:null,...row.text.length>16000?{truncated:true}:{}}))}
}

// No public history is cached: only short-lived committed identity/pending calls.
// Every live request rechecks the exact physical journal, current browser and secrets.
const liveProofs = new WeakMap()
const liveValidity = Symbol('live-proof-validity')
const proofTTL = 10000, proofLimit = 64
async function projection({base, identity, persistence, validIdentity, notStarted, revision, secrets = [], liveProof, proofScope, guard}) {
  const {sessionId} = identity
  if (!sessionId || !persistence?.readNative) return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  const identityKey = JSON.stringify(identity), secretKey = digest(JSON.stringify(secrets))
  // Cordis 服务门面每次查询都会改变；proof 绑定底层持久化身份。
  const authority = persistence.identity ?? persistence
  let proofs = liveProofs.get(authority)
  if (!proofs) {proofs = new Map(); liveProofs.set(authority, proofs)}
  for (const [key, value] of proofs) if (value.expires <= Date.now()) proofs.delete(key)
  if (liveProof) {
    const saved = proofs.get(liveProof)
    const changed = () => ({...base, status:'ready', historyChanged:true, live:{active:false,items:[]}})
    if (saved && saved.secret !== secretKey) fail('SESSION_REDACTION_CHANGED',409)
    if (!saved || !proofScope || saved.scope !== proofScope || saved.identity !== identityKey || !persistence.readNativeDigest) return changed()
    try {if (await persistence.readNativeDigest(sessionId) !== saved.digest) return changed()} catch {return changed()}
    const live = await projectLive({context:{projection:{entries:[]}}}, identity, secrets, await persistence.readLive?.(sessionId), saved.calls)
    return {...base, status:'ready', live, liveProof, historyChanged:false, [liveValidity]:()=>saved.expires>Date.now() && proofs.get(liveProof)===saved}
  }
  let snapshot
  try {snapshot = await persistence.readNative(sessionId, {requireComplete: true})} catch (error) {
    if (error.code === 'PI_SESSION_CHANGED' || error.code === 'PI_SESSION_UNCOMMITTED_TAIL' || error.code === 'PI_SESSION_COMMIT_REQUIRED') return {...base, status: 'pending', reason: 'SESSION_COMMIT_PENDING'}
    if (error.name === 'SessionPersistenceNotFoundError' && notStarted) return {...base, status: 'pending', reason: 'SESSION_NOT_STARTED'}
    return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  }
  if (snapshot.header?.id !== sessionId || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.context?.projection?.entries) || !validIdentity(snapshot)) fail('SESSION_IDENTITY_INVALID', 503)
  const currentRevision = digest(JSON.stringify([sessionId, snapshot.entries.at(-1)?.id]))
  if (revision && revision !== currentRevision) fail('SESSION_PAGE_STALE', 409)
  // Validate/redact committed history once, retaining its exact pending-call
  // pairing state for the bounded live suffix. No cached authorization.
  const calls = new Map()
  const items = await projectEntries(snapshot, identity, secrets, calls)
  const live = persistence.readLive ? await projectLive(snapshot, identity, secrets, await persistence.readLive(sessionId), calls) : undefined
  let nextProof
  if (proofScope && calls.size <= 256 && JSON.stringify([...calls]).length <= 65536 && typeof snapshot.journalDigest === 'string' && persistence.readNativeDigest) {
    while (proofs.size >= proofLimit) proofs.delete(proofs.keys().next().value)
    nextProof = randomUUID()
    proofs.set(nextProof, {scope:proofScope, identity:identityKey, secret:secretKey, digest:snapshot.journalDigest, calls:new Map(calls), expires:Date.now()+proofTTL})
  }
  return {...base, status: 'ready', revision: currentRevision, ...taskTodos(snapshot, identity, secrets), items, ...(live ? {live} : {}), ...(nextProof ? {liveProof:nextProof} : {})}
}
function sessionPage(value, options) {
  const {offset, limit} = pageOptions(options)
  if (value.status !== 'ready') return value
  if (options.stream) return sessionStream(value, options)
  const rows = value.items, end = Math.max(0, rows.length - offset)
  const items = rows.slice(Math.max(0, end - limit), end).map(row => ({...row, text: row.text.slice(0, 16000), textTotal: row.text.length,
    textNextOffset: row.text.length > 16000 ? 16000 : null, ...(row.text.length > 16000 ? {truncated: true} : {})}))
  return {...value, items, total: rows.length, offset, limit, nextOffset: offset + items.length < rows.length ? offset + items.length : null}
}

// A checkpoint commits the entire authorized prefix, not just its last ID.
// Appends remain readable without offset drift; branch/compaction/redaction or
// a different session invalidates the prefix instead of mixing snapshots.
function sessionStream(value, {limit = 200, checkpoint, before}) {
  const rows = value.items
  const proof = index => digest(JSON.stringify(rows.slice(0, index + 1)))
  let anchor = -1
  if (checkpoint) {
    const [id, hash] = checkpoint.split('.')
    anchor = rows.findIndex(row => row.id === id)
    if (anchor < 0 || proof(anchor) !== hash) fail('SESSION_PAGE_STALE', 409)
  }
  let start, end
  if (before) {
    end = rows.findIndex(row => row.id === before)
    if (end < 0 || end > anchor) fail('SESSION_PAGE_STALE', 409)
    start = Math.max(0, end - limit)
  } else if (checkpoint) {
    start = anchor + 1
    end = Math.min(rows.length, start + limit)
  } else {
    end = rows.length
    start = Math.max(0, end - limit)
  }
  const last = before ? anchor : end - 1
  const items = rows.slice(start, end).map(row => ({...row, text: row.text.slice(0, 16000), textTotal: row.text.length,
    textNextOffset: row.text.length > 16000 ? 16000 : null, ...(row.text.length > 16000 ? {truncated: true} : {})}))
  return {...value, items, total: rows.length, limit, nextOffset: null,
    checkpoint: last >= 0 ? `${rows[last].id}.${proof(last)}` : null,
    before: start > 0 && start < rows.length ? rows[start].id : null, hasNewer: !before && end < rows.length}
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
async function routerProjection({conversationId, readRouter, readRotations, ...options}) {
  const router = await readRouter(), sessionId = router?.activeSessionId
  const base = {conversationId, sessionId: sessionId ?? null, scope: 'current-router-session-context', items: [], total: 0, nextOffset: null}
  if (!router || !sessionId) return {...base, status: 'pending', reason: 'SESSION_NOT_STARTED'}
  if (router.id !== conversationId || !Number.isSafeInteger(router.generation) || router.generation < 1) fail('SESSION_IDENTITY_INVALID', 503)
  let value = await projection({...options, revision: undefined, base: {...base, generation: router.generation, activeGeneration: router.generation}, identity: {sessionId, conversationId, generation: router.generation}, notStarted: true,
    validIdentity: snapshot => snapshot.header.runtimeOwner === 'conversation-router' && snapshot.header.conversationId === conversationId && snapshot.header.generation === router.generation})
  // Idle rotation starts a fresh context containing only private handoff data.
  // Select only a published, same-conversation predecessor; never expose handoff.
  if (!options.liveProof && value.status === 'ready' && !value.items.length && readRotations) {
    const rotations = await readRotations()
    const previous = rotations.filter(row => row.state === 'published' && row.conversationId === conversationId
      && Number.isSafeInteger(row.oldGeneration) && row.oldGeneration > 0 && row.oldGeneration < router.generation
      && typeof row.oldSessionId === 'string' && row.oldCommit).sort((a, b) => b.oldGeneration - a.oldGeneration)[0]
    if (previous) value = await projection({...options, revision: undefined,
      base: {...base, sessionId: previous.oldSessionId, generation: previous.oldGeneration, activeGeneration: router.generation, scope: 'previous-committed-router-context'},
      identity: {sessionId: previous.oldSessionId, conversationId, generation: previous.oldGeneration},
      validIdentity: snapshot => snapshot.header.runtimeOwner === 'conversation-router' && snapshot.header.conversationId === conversationId && snapshot.header.generation === previous.oldGeneration})
  }
  if (options.revision && value.status === 'ready' && options.revision !== value.revision) fail('SESSION_PAGE_STALE', 409)
  const current = await readRouter()
  if (current?.activeSessionId !== sessionId || current?.generation !== router.generation || current?.phase !== router.phase) fail('SESSION_PAGE_STALE', 409)
  return value
}
async function finalRead(value, options) {
  await options.guard?.()
  const valid=value[liveValidity];delete value[liveValidity]
  if(valid&&!valid())return {...value,historyChanged:true,live:{active:false,items:[]}}
  return value
}
export async function taskSessionView(options) {pageOptions(options); const value = await finalRead(await taskProjection(options), options); return options.liveProof ? value : sessionPage(value, options)}
export async function taskSessionMessageView(options) {const value = await finalRead(await taskProjection(options), options); return messagePage(value, options)}
export async function routerSessionView(options) {pageOptions(options); const value = await finalRead(await routerProjection(options), options); return options.liveProof ? value : sessionPage(value, options)}
export async function routerSessionMessageView(options) {const value = await finalRead(await routerProjection(options), options); return messagePage(value, options)}

// Triage has one stable native Pi journal per authenticated conversation. Never
// list arbitrary journals or accept a session ID supplied by the browser.
async function triageProjection({conversationId, ...options}) {
  const sessionId = triageSessionId(conversationId)
  return projection({...options, base: {conversationId, sessionId, scope: 'current-triage-session-context', items: [], total: 0, nextOffset: null},
    identity: {sessionId, conversationId, triage: true}, notStarted: true,
    validIdentity: snapshot => snapshot.header.runtimeOwner === 'channel-triage' && snapshot.header.conversationId === conversationId})
}
export async function triageSessionView(options) {pageOptions(options); const value = await finalRead(await triageProjection(options), options); return options.liveProof ? value : sessionPage(value, options)}
export async function triageSessionMessageView(options) {return messagePage(await finalRead(await triageProjection(options), options), options)}
