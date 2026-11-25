import {nativeTokenUsage} from './token-usage.js'
import {observeMemoryLock} from '../../../src/memory/lock-observation.js'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {isDeepStrictEqual} from 'node:util'
import {setImmediate as yieldToIO} from 'node:timers/promises'
import {digest, fail} from './security.js'
import {committedCommunicationGuidance, coreToolInput, coreToolOutput, hasCoreToolActivity} from './core-tool-activity.js'
import {specializedToolInput, specializedToolOutput} from './specialized-tool-activity.js'
import {residentTaskToolInput, residentTaskToolOutput} from './resident-task-activity.js'
import {residentMemoryToolInput, residentMemoryToolOutput} from './resident-memory-tool-activity.js'
import {isResidentRouterActivity, residentRouterActivityInput, residentRouterActivityOutput, residentRouterSettleDetails, safeRouterSettlementEvent} from './resident-router-tool-activity.js'
import {isResourceTool, resourceReadCandidate} from './resource-tool-content.js'
import {parsePiEditDiff} from '../src/edit-diff.ts'

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
    const parsed = /^[\x20\t\r\n]*[\[{]/.test(text) ? JSON.parse(text) : undefined
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
  resident_task_query: toolPage, resident_source_get: {},
  resident_task_plan: {tasks: toolArray(toolObject(toolTaskFields)), dependencies: toolDependencies},
  resident_task_action: {kind: toolEnum(['supplement', 'revise', 'reopen', 'control', 'arrange']), control: toolEnum(['active', 'paused', 'cancelled']),
    text: toolString, objective: toolString, title: toolString, requirements: toolStrings, reason: toolString, sameGoal: toolBoolean, dependencies: toolDependencies},
  resident_dependency_evaluate: {decision: toolEnum(['satisfied', 'continue', 'wait']), evidence: toolStrings},
  resident_operator_reply: {text: toolString}, resident_router_reply: {text: toolString, replyToSource: toolBoolean}, resident_router_settle: {},
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
  resident_operator_reply: {result:toolObject({accepted:toolBoolean,webOnly:toolBoolean,reused:toolBoolean,text:toolString})}, resident_router_reply: toolReceipt, resident_router_settle: toolReceipt,
  platform_config_query: {timeZone: toolString, concurrency: toolNumber}, platform_schedule_submit: toolReceipt,
}

function toolInput(name, args, identity) {
  const resident = residentRouterActivityInput(name,args,identity) ?? residentMemoryToolInput(name,args,identity) ?? residentTaskToolInput(name,args,identity)
  if (resident) return resident
  if (isResidentRouterActivity(name)) return {toolName:name,text:'此调用缺少可核对的参数；未展示私有内容。',redacted:true}
  const core = coreToolInput(name,args)
  if (core) return core
  const specialized=specializedToolInput(name,args,identity)
  if(specialized)return specialized
  if (!Object.hasOwn(toolInputs, name)) return {toolName: name, text: '该工具的参数未公开。', redacted: true, detailState:'withheld'}
  const state = {hidden: false}, value = toolObject(toolInputs[name])(args ?? {}, state) ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) state.hidden = true
  if (name === 'working_directory') value.action = typeof args?.cd === 'string' ? '切换工作目录' : '读取工作目录'
  if (name === 'skill') value.action = '加载技能'
  if (name === 'read_image') value.action = '读取图像'
  if (name === 'web_fetch') value.action = '读取网页'
  if (name === 'resident_router_reply' && Array.isArray(args?.taskDelivery?.artifactIds)) value.deliveryFileCount = args.taskDelivery.artifactIds.length
  return {toolName: name, text: JSON.stringify(value, null, 2), redacted: state.hidden, ...Object.keys(value).length===0?{detailState:state.hidden?'withheld':'empty'}:{}}
}
// The input has already passed the tool field allowlist. Receipts decide whether
// this text becomes a message; raw journal arguments are never used here.
function businessResultText(name, input) {
  if (name !== 'task_result' && name !== 'resident_router_reply' && name !== 'resident_operator_reply') return null
  let value
  try {value = JSON.parse(input)} catch {return null}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (name === 'resident_router_reply' || name === 'resident_operator_reply') return value.text?.trim() || null
  const decision = value.decision
  if (!decision || !['complete', 'wait', 'blocked'].includes(decision.action) || !decision.summary?.trim()) return null
  const summary = decision.summary.trim(), question = decision.question?.trim()
  return [summary, question !== summary ? question : ''].filter(Boolean).join('\n\n')
}

const taskTextTools = new Set(['read', 'read_window', 'read_image', 'write', 'edit', 'find', 'grep', 'bash', 'pwsh',
  'job_output', 'job_list', 'job_kill', 'working_directory', 'todo_write', 'web_search', 'web_fetch'])

// Only the Host envelope produced by pi-official-tools/native-tools lends a
// classification. Never parse error text, tool JSON, arbitrary details or stack.
// Exact name+code pairs are public vocabulary, not arbitrary error fields.
const publicToolFailures = new Map([
  ['ToolArgsError:INVALID_ARGS', '输入不符合要求，请检查参数。'],
  ['ToolOutputError:INVALID_TOOL_OUTPUT', '返回结果格式不符合要求，请检查工具实现。'],
  ['ToolNotFoundError:UNKNOWN_TOOL', '工具不可用，请检查工具配置。'],
  ['ToolTimeoutError:TOOL_TIMEOUT', '调用超时，请先核对执行状态，避免重复操作。'],
  ['AbortError:ABORTED', '调用已中断，请先核对执行状态。'],
  ['AbortError:ABORTED_BEFORE_DISPATCH', '调用在执行前已取消。'],
  ['AuthorizationDeclinedError:DECLINED', '本次操作未获批准，请核对授权。'],
])
function toolFailure(call, message) {
  const fallback = {reason: '未记录失败原因'}
  // Unknown/custom tool bodies cannot lend themselves the Host error contract.
  if (!call || call.name !== message.toolName || !(Object.hasOwn(toolInputs, call.name) || hasCoreToolActivity(call.name) || call.name === 'resident_reply_query')) return fallback
  const native = message.details?.nativeResult
  if (native?.isError !== true) return fallback
  const info = native.error?.info
  if (!info || typeof info.name !== 'string' || typeof info.code !== 'string') return fallback
  const reason = publicToolFailures.get(info.name + ':' + info.code)
  return reason ? {reason, code: info.code} : fallback
}

// Night Bot's retired native subagent tool returned an activation, not a report.
// Only a true, matched legacy wire receipt can disclose its original assignment.
// An SDK extension's arbitrary details or a child ID are never an access grant.
function committedSubagentActivation(message, entry) {
  const original = entry.type === 'message' && entry.message
  if (!original || original.role !== 'toolResult' || original.toolName !== 'subagent'
    || original.toolCallId !== message.toolCallId || original.isError !== false || message.isError !== false) return null
  const receipt = original.details?.nativeResult, value = receipt?.value
  if (receipt?.isError !== false || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || value.kind !== 'activation'
    || typeof value.subagentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value.subagentId)) return null
  const content = [{type: 'text', text: 'started subagent ' + value.subagentId}]
  return isDeepStrictEqual(original.content, content) && isDeepStrictEqual(message.content, content)
    && isDeepStrictEqual(receipt.content, content) ? value.subagentId : null
}

// UI proof for the registered Pi file tool only. The display diff contains
// neighboring file lines: never republish the native receipt, path headers,
// patch, other details, or a redacted/partial change under an applied label.
function committedEditDiff(message, entry, expectedText, secrets) {
  const original = entry.type === 'message' && entry.message
  if (!original || original.role !== 'toolResult' || original.toolName !== 'edit'
    || original.toolCallId !== message.toolCallId || original.isError !== false || message.isError !== false) return null
  const native = original.details?.nativeResult, value = native?.value, details = value?.details
  if (native?.isError !== false || value?.text !== expectedText || !Array.isArray(value.images) || value.images.length !== 0
    || !details || Object.keys(details).length !== 3 || typeof details.patch !== 'string'
    || details.patch.length > 16000 || !details.patch.includes('\n@@ -')
    || !Number.isSafeInteger(details.firstChangedLine) || details.firstChangedLine < 1) return null
  const content = [{type: 'text', text: expectedText}]
  if (!isDeepStrictEqual(original.content, content) || !isDeepStrictEqual(message.content, content)
    || !isDeepStrictEqual(native.content, content)) return null
  const rows = parsePiEditDiff(details.diff)
  if (!rows || rows.find(row => row.kind === 'added' || row.kind === 'removed')?.line !== details.firstChangedLine) return null
  // Check the formatted representation and both underlying sides. The line
  // gutter and interleaved changes must not shield a multiline credential.
  const unsafe = text => visibleText(text, secrets, {maxLength:Infinity, preservePaths:true}).redacted
  return unsafe(details.diff) || unsafe(details.patch) || ['added','removed'].some(skip =>
    unsafe(rows.filter(row => row.kind !== skip).map(row => row.text).join('\n'))) ? null : details.diff
}

function toolOutput(call, message, identity, entry) {
  if (message.isError === true) {
    const failure = toolFailure(call, message)
    return {toolName: message.toolName, text: failure.reason + (failure.code ? '\n错误码：' + failure.code : ''), redacted: true, failure}
  }
  const hidden = {toolName: message.toolName, text: '此结果没有唯一配对的工具调用，正文未展示。', redacted: true, detailState:'not-recorded'}
  // 孤立、重复 ID 或名称冲突的结果保留事件，但不借 result.toolName 猜测公开权限。
  if (!call || call.name !== message.toolName) return hidden
  const name = call.name, state = {hidden: false}
  if (name==='communication_guidance_read') {
    return committedCommunicationGuidance(call,message,entry) ?? {toolName:name,text:'未记录可核对的沟通指引正文。',redacted:true,detailState:'withheld'}
  }
  const summary = {toolName: name, text: /^(?:memory_|skill$|resident_(?:memory|skill)_)/.test(name)
    ? '此工具涉及独立的记忆或技能读取权限，请通过记忆与技能入口查看获权正文。'
    : '该工具的返回正文未公开。', redacted: true, detailState:'withheld'}
  const content = message.content
  if (Array.isArray(content) && content.some(block => block.type !== 'text' || Object.keys(block).some(key => key !== 'type' && key !== 'text'))) state.hidden = true
  const text = texts(content)
  // 同一任务已授权的执行工具正文可读；details、二进制和独立 memory/skill scope 不由此公开。
  if (identity.taskId && taskTextTools.has(name)) {
    return {toolName: name, text: text || '工具已返回，未包含文字正文。', redacted: state.hidden, ...!text?{detailState:state.hidden?'withheld':'empty'}:{}}
  }
  if (name==='resident_task_lookup_async'&&text.length<=65536) {
    let raw
    try {raw=JSON.parse(text)} catch {}
    const specialized=specializedToolOutput(name,raw,identity)
    if(specialized)return specialized
  }
  if (isResidentRouterActivity(name)) {
    let raw
    if (text.length <= 1048576 && !state.hidden) try {raw = JSON.parse(text)} catch {}
    let input
    if (call.publicInput) try {input=JSON.parse(call.publicInput)} catch {}
    const activity = residentRouterActivityOutput(name,raw,identity,input,call.settlementEvents)
    if (activity) return activity
    // Old journals can lack a full payload. Retain the historical reply event,
    // without treating it as fresh notification state or leaking a raw ID.
    if (!identity.taskId && name==='resident_router_reply' && raw?.notification?.payload===undefined
      && typeof raw?.notification?.id==='string') return {toolName:name,text:'{"accepted":true}',redacted:true}
    return {toolName:name,text:'此结果缺少可核对的回执；未展示私有内容。',redacted:true}
  }
  if (name === 'resident_web_attachment' && Array.isArray(content) && content.length >= 1 && content.length <= 2
    && content[0]?.type === 'text' && typeof content[0].text === 'string' && content[0].text.length <= 1048576
    && (content.length === 1 || content[1]?.type === 'image')) {
    // The native renderer emits one metadata/body JSON block and an optional
    // image. Project only the fixed metadata; never consume the image or body.
    let attachment
    try {attachment = JSON.parse(content[0].text)} catch {}
    const projected = residentTaskToolOutput(name,attachment,identity)
    if (projected) return projected
  }
  if (hasCoreToolActivity(name) && text.length <= 1048576 && !state.hidden) {
    let raw
    try {raw=JSON.parse(text)} catch {}
    const projected = coreToolOutput(name,raw)
    if (projected) return projected
  }
  if (!text && !state.hidden) return {...summary,text:'工具已返回，未包含文字正文。',detailState:'empty'}
  if (!Object.hasOwn(toolOutputs, name) && !/^resident_(?:memory|skill)_/.test(name)) return summary
  let raw
  if (text.length <= 1048576) try {raw = JSON.parse(text)} catch {return summary}
  if (!state.hidden) {
    const resident = residentMemoryToolOutput(name,raw,identity) ?? residentTaskToolOutput(name,raw,identity)
    if (resident) return resident
  }
  if (!Object.hasOwn(toolOutputs, name)) return summary
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
  if (task.inputPolicy === 'faithful-handoff-v1') {
    return [input.handoffs, input.updates].flatMap(rows => Array.isArray(rows) ? rows.map(row => row?.text) : [])
      .filter(value => typeof value === 'string' && value.trim()).join('\n\n')
  }
  const updates = [...(Array.isArray(input.updates) ? input.updates.map(row => row?.text) : []), input.supplement?.text].filter(value => typeof value === 'string' && value.trim())
  const request = typeof task.request === 'string' && task.request.trim() ? task.request : ''
  const objective = typeof task.objective === 'string' && task.objective.trim() ? task.objective : ''
  const requirements = Array.isArray(task.requirements) ? task.requirements.filter(value => typeof value === 'string' && value.trim()) : []
  return [updates.length ? updates.join('\n\n') : request, objective && objective !== request ? '目标：\n' + objective : '',
    requirements.length ? '要求：\n' + requirements.map(value => '- ' + value).join('\n') : ''].filter(Boolean).join('\n\n')
}

// A credential may span semantic blocks, not only provider chunks. Apply the
// existing redactor to their joined, individually sanitized text as well.
function crossBlockSensitive(blocks, secrets, redact = value => visibleText(value,secrets,{maxLength:Infinity,preservePaths:true})) {
  const joined = (Array.isArray(blocks) ? blocks : []).filter(b => b.type === 'text' || b.type === 'thinking').map(b => redact(b.text ?? b.thinking ?? '').text).join('')
  return redact(joined).text !== joined
}

// Presentation only: retained Pi envelopes stay untouched.
function routerSummary(text) {
  if (!/^[\x20\t\r\n]*\{/.test(text)) return null
  let value
  try { value = JSON.parse(text) } catch { return null }
  const keys = ['currentIntent', 'unresolvedQuestions', 'referents', 'assumptions', 'evidenceRefs', 'cutoff']
  if (!value || Object.keys(value).some(key => !keys.includes(key))
    || typeof value.currentIntent !== 'string' || !Number.isSafeInteger(value.cutoff)
    || !['unresolvedQuestions', 'referents', 'assumptions'].every(key => Array.isArray(value[key]) && value[key].every(row => typeof row === 'string'))
    || !Array.isArray(value.evidenceRefs)) return null
  return [value.currentIntent, ...[['待确认', value.unresolvedQuestions], ['关联信息', value.referents], ['假设', value.assumptions]]
    .filter(([, rows]) => rows.length).map(([title, rows]) => '### ' + title + '\n' + rows.map(row => '- ' + row).join('\n'))].filter(Boolean).join('\n\n')
}

function scheduledPrompts(content, source) {
  const occurrences = source.occurrences
  if (!Array.isArray(occurrences) || !occurrences.length) return null
  const matches = row => occurrences.some(item => item.id === row.schedule_id && item.occurrenceAt === row.occurrence_at)
  try {
    if (content.startsWith('[SCHEDULE REMINDER]\n')) {
      const field = name => content.split('\n').find(line => line.startsWith(name + ': '))?.slice(name.length + 2)
      const row = {schedule_id: JSON.parse(field('schedule_id_json')), occurrence_at: field('occurrence_at'), reminder_prompt: JSON.parse(field('reminder_prompt_json'))}
      return occurrences.length === 1 && matches(row) && typeof row.reminder_prompt === 'string' ? [row.reminder_prompt] : null
    }
    if (content.startsWith('[SCHEDULE REMINDER BATCH]\n')) {
      const line = content.split('\n').find(line => line.startsWith('reminders_json: '))
      const rows = JSON.parse(line?.slice('reminders_json: '.length))
      return Array.isArray(rows) && rows.length === occurrences.length && rows.every(row => matches(row) && typeof row.reminder_prompt === 'string')
        && new Set(rows.map(row => row.schedule_id)).size === rows.length ? rows.map(row => row.reminder_prompt) : null
    }
  } catch { /* Keep unknown/older formats readable instead of discarding input. */ }
  return null
}

function taskInputInstructions(input, binding, inputs, sources) {
  const direct = new Map()
  const read = (row, value) => {
    if (!row || typeof value !== 'string' || !value.trim()
      || !Number.isSafeInteger(row.requirementRevision) || row.requirementRevision !== binding.requirementRevision
      || !Number.isSafeInteger(row.controlRevision) || row.controlRevision !== binding.controlRevision
      || !Number.isSafeInteger(row.contextRevision) || !Number.isSafeInteger(binding.contextRevision ?? 0)
      || row.contextRevision > (binding.contextRevision ?? 0)) return false
    if (!direct.has(row.requestId)) direct.set(row.requestId, {text: value})
    return true
  }
  const updates = (Array.isArray(input?.updates) ? input.updates : []).filter(update => {
    const row = inputs.get(update?.id)
    return !(row && (update.sourceId === undefined || update.sourceId === row.sourceId)
      && (update.messageVersion === undefined || update.messageVersion === row.messageVersion)
      && read(row, update.text))
  })
  let supplement = input?.supplement
  const row = inputs.get(supplement?.messageId)
  if (row && supplement.contextRevision === row.contextRevision && read(row, supplement.text)) supplement = undefined
  // Older source-only task packets omit updates. A committed, exactly matched
  // source/version is accepted only when the Host ledger independently binds it to this task input.
  if (input?.task?.inputPolicy === 'source-only-v1' && Array.isArray(input.sources)) {
    for (const source of input.sources) {
      const proof = sources.get(source?.sourceId)
      if (proof && proof.messageVersion === source.version) read(proof, source.text)
    }
  }
  if (!direct.size) return {instruction:taskInstruction(input), direct}
  const task = input?.task && !updates.length ? {...input.task,request:undefined} : input?.task
  return {instruction:taskInstruction({...input,task,updates,supplement}),direct}
}

const nonnegativeNumber = value => Number.isFinite(value) && value >= 0
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0
const timingFields = value => {
  const pairs = ['durationMs', 'modelWaitMs', 'modelDurationMs', 'turnDurationMs'].flatMap(key => nonnegativeNumber(value?.[key]) ? [[key,value[key]]] : [])
  return pairs.length ? Object.fromEntries(pairs) : undefined
}
// Pi summarizes raw tool/custom inputs, not this Web reader's projection. Only
// an all-public text ancestry permits opening the summary. Closed/edited/
// extension-supplied contexts still get an authentic metadata-only marker.
function compactionSummaryVisible(entry, entries, secrets) {
  const native=entries.get(entry.id)?.entry
  if (native?.type!=='compaction'||native.fromHook===true||typeof native.parentId!=='string') return false
  let id=native.parentId
  const seen=new Set()
  while(id!==null){
    if(seen.has(id)||seen.size>=512)return false
    seen.add(id)
    const prior=entries.get(id)?.entry
    if(!prior)return false
    if(prior.type==='message'){
      const message=prior.message
      if(!['user','assistant'].includes(message?.role))return false
      const blocks=typeof message.content==='string'?[{type:'text',text:message.content}]:message.content
      if(!Array.isArray(blocks)||crossBlockSensitive(blocks,secrets)||blocks.some(block=>block?.type!=='thinking'&&(block?.type!=='text'||typeof block.text!=='string'||visibleText(block.text,secrets,{maxLength:Infinity}).redacted)))return false
    }else if(!['model_change','thinking_level_change','label','session_info'].includes(prior.type)
      &&!(prior.type==='custom'&&['night.header','night.audit','night.commit'].includes(prior.customType)))return false
    id=prior.parentId
  }
  return true
}
async function projectEntries(snapshot, identity, secrets, calls = new Map(), resultMessages = true, taskInputs = [], executionActivity = false, executionTiming, resourceCandidates, readRouterTasks) {
  const {taskId, sessionId, conversationId, generation} = identity
  const items = [], sources = new Set(), operatorReplies = new Set(), seenTaskInputs = new Set(), subagentCalls = new Map()
  const inputsById = new Map(taskInputs.map(row => [row.inputId, row]))
  const inputsBySource = new Map(taskInputs.map(row => [row.sourceId, row]))
  const provedRouterEvents = new Map()
  let authorizedTaskTitles
  const sourceRows = new Map()
  let routerPacketProof, processed = 0
  function isOriginalRouterPacket(entry, message) {
    const packetId = entry.details?.packetId
    if (entry.type !== 'custom_message' || entry.customType !== 'night.business-input' || typeof packetId !== 'string' || !packetId
      || !isDeepStrictEqual(entry.details, message.details) || !isDeepStrictEqual(entry.content, message.content)) return false
    if (!routerPacketProof) {
      const packets = new Map(), admitted = new Map()
      const unique = (map, id, value) => map.set(id, map.has(id) ? null : value)
      for (const receipt of snapshot.audit ?? []) {
        const payload = receipt.payload
        if (receipt.domain !== 'admission' || receipt.version !== 1 || typeof payload?.id !== 'string') continue
        if (receipt.kind === 'enqueued' || receipt.kind === 'enqueued-internal') unique(packets, payload.id, payload)
        if (receipt.kind === 'admitted') unique(admitted, payload.id, payload.entryId)
      }
      routerPacketProof = {packets, admitted}
    }
    const packet = routerPacketProof.packets.get(packetId)
    return !!packet && routerPacketProof.admitted.get(packetId) === entry.id
      && isDeepStrictEqual(packet.source, entry.details.source) && isDeepStrictEqual(packet.content, entry.content)
  }
  const opaque = (...parts) => digest(JSON.stringify([sessionId, ...parts]))
  const editReceipts = executionActivity && identity.taskId ? new Map() : undefined
  const nativeEntries=executionActivity&&snapshot.context.projection.entries.some(row=>row.sourceEntry?.type==='compaction')?new Map(snapshot.entries.map((entry,index)=>[entry.id,{entry,index}])):undefined
  const timeline=nativeEntries?new WeakMap():undefined
  const add = (entry, suffix, role, value, extra = {}, message, preparedVisible) => {
    const visible = preparedVisible ?? visibleText(value, secrets, {maxLength: Infinity, preservePaths:extra.kind!=='compaction'})
    if (!visible.text && !extra.toolName && !['compaction','router-packet-boundary'].includes(extra.kind)) return
    const row={id: opaque(entry.id, suffix), role, createdAt: stamp(message, entry), ...visible, ...extra,
      source: {sessionId, entryId: opaque(entry.id), ...(extra.callId ? {callId: extra.callId} : {})}}
    items.push(row)
    if(timeline)timeline.set(row,nativeEntries.get(entry.id)?.index??Number.MAX_SAFE_INTEGER)
  }
  const sourceText = (entry, suffix, row) => {
    if (typeof row?.text !== 'string') return
    const key = JSON.stringify([row.sourceId, row.version, row.text])
    if (sources.has(key)) return sourceRows.get(key)
    sources.add(key)
    const previousCount=items.length
    add(entry, suffix, 'user', row.text, {kind: 'source'})
    if(items.length!==previousCount)sourceRows.set(key,items.at(-1))
    return sourceRows.get(key)
  }
  for (const projected of snapshot.context.projection.entries) {
    // Long journals must not monopolize the shared HTTP event loop.
    if (++processed % 32 === 0) await yieldToIO()
    const entry = projected.sourceEntry
    if (!entry || typeof entry.id !== 'string') continue
    for (const [index, message] of projected.messages.entries()) {
      if (message.role === 'assistant') {
        const firstRow = items.length
        const blocks = typeof message.content === 'string' ? [{type: 'text', text: message.content}] : message.content
        // Keep identical policy including cross-block checks; reuse redaction for this one message only.
        const checkedText = new Map()
        const redactBlock = value => {
          if(!checkedText.has(value))checkedText.set(value,visibleText(value,secrets,{maxLength:Infinity,preservePaths:true}))
          return checkedText.get(value)
        }
        const suppressBodies = crossBlockSensitive(blocks, secrets, redactBlock)
        for (const [blockIndex, block] of (Array.isArray(blocks) ? blocks : []).entries()) {
          if (suppressBodies && (block.type === 'text' || block.type === 'thinking')) continue
          if (block.type === 'text' && typeof block.text === 'string') {
            const summary = !taskId ? routerSummary(block.text) : null
            add(entry, 'assistant-' + index + '-' + blockIndex, 'assistant', summary ?? block.text, {kind: summary !== null ? 'context-summary' : 'message', ...(['stop', 'length', 'toolUse', 'error', 'aborted'].includes(message.stopReason) ? {status: message.stopReason} : {})}, message, redactBlock(summary ?? block.text))
          } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.redacted !== true) {
            const timing = timingFields({durationMs:executionTiming?.thinking(entry.id,blockIndex)})
            add(entry, 'thinking-' + index + '-' + blockIndex, 'assistant', block.thinking, {kind: 'thinking',...(timing?{timing}:{})}, message, redactBlock(block.thinking))
          }
          if (block.type !== 'toolCall' || typeof block.name !== 'string') continue
          const callId = opaque(entry.id, index, blockIndex)
          // 厂商 ID 可跨轮重用；未配对的重复 ID 不能猜测归属。
          const selected = toolInput(block.name, block.arguments, identity)
          const resultText = businessResultText(block.name, selected.text)
          if (typeof block.id === 'string') calls.set(block.id, calls.has(block.id) ? null : {id: callId, name: block.name, ...(executionActivity?{entryId:entry.id}:{}), ...(block.name==='resident_router_settle'?{publicInput:selected.text,settlementEvents:residentRouterSettleDetails(block.arguments,provedRouterEvents)}:{}), ...(resourceCandidates&&isResourceTool(block.name)?{resourceArgs:block.arguments}:{}), ...(block.name==='resident_operator_reply'&&typeof block.arguments?.eventId==='string'?{operatorEventKey:opaque('operator-reply',block.arguments.eventId)}:{}), ...(resultText ? {resultText} : {})})
          add(entry, 'call-' + index + '-' + blockIndex, 'tool', selected.text, {kind: 'tool-call', toolName: selected.toolName, ...(selected.redacted ? {redacted: true} : {}), ...(selected.detailState ? {detailState:selected.detailState}:{}), callId, status: 'result-unrecorded'}, message)
          const args = block.arguments
          if (editReceipts && block.name === 'edit' && entry.type === 'message' && entry.message?.role === 'assistant'
            && isDeepStrictEqual(entry.message.content?.[blockIndex], block)
            && typeof args?.path === 'string' && args.path.length <= 4096 && Array.isArray(args.edits) && args.edits.length)
            editReceipts.set(callId, `Successfully replaced ${args.edits.length} block(s) in ${args.path}.`)

          if (resultMessages && block.name === 'subagent' && entry.type === 'message' && entry.message?.role === 'assistant'
            && isDeepStrictEqual(entry.message.content?.[blockIndex], block)
            && typeof block.arguments?.description === 'string' && block.arguments.description.trim()
            && typeof block.arguments?.prompt === 'string' && block.arguments.prompt.trim()) {
            subagentCalls.set(callId, {row: items.at(-1), description: block.arguments.description, prompt: block.arguments.prompt})
          }
        }
        const timing = timingFields(executionTiming?.assistant(entry.id))
        if (timing&&items.length>firstRow) items[firstRow].timing={...items[firstRow].timing,...timing}
      } else if (message.role === 'toolResult') {
        const nativeId = message.toolCallId, pending = calls.get(nativeId)
        const call = pending?.name === message.toolName ? pending : undefined
        const callId = call?.id ?? opaque(entry.id, 'orphan-result', index)
        calls.delete(nativeId)
        const assignment = call?.name === 'subagent' && subagentCalls.get(call.id)
        const childId = assignment && committedSubagentActivation(message, entry)
        if (assignment) subagentCalls.delete(call.id)
        if (childId) {
          const text = [...new Set([assignment.description, assignment.prompt])].join('\n\n')
          const visible = visibleText(text, [...secrets, childId], {maxLength: Infinity})
          Object.assign(assignment.row, visible, {redacted:true, resourceContent:true})
        }
        const expectedEdit = editReceipts?.get(call?.id)
        if (expectedEdit) editReceipts.delete(call.id)
        const editDiff = expectedEdit && committedEditDiff(message, entry, expectedEdit, secrets)
        const selected = childId ? {toolName: 'subagent', text: '子代理已启动。', redacted: true, resourceContent: true} : toolOutput(call, message, identity, entry)
        const timing = typeof nativeId === 'string' && call?.entryId ? timingFields({durationMs:executionTiming?.tool(call.entryId,nativeId)}) : undefined
        add(entry, 'result-' + index, 'tool', editDiff || selected.text, {kind: 'tool-result', toolName: selected.toolName, ...(editDiff ? {editDiff:true} : {}), ...(selected.redacted ? {redacted: true} : {}), ...(selected.detailState ? {detailState:selected.detailState}:{}), ...(selected.resourceContent ? {resourceContent: true} : {}), ...(selected.failure ? {failure: selected.failure} : {}), ...(timing?{timing}:{}), callId, isError: message.isError === true, status: message.isError ? 'error' : childId ? 'accepted' : 'completed'}, message)
        if (resourceCandidates && call?.resourceArgs) {
          let candidate
          try {candidate = resourceReadCandidate(call.name, call.resourceArgs, message, entry)} catch { /* Invalid receipt proves no body. */ }
          if (candidate) resourceCandidates.push({id: items.at(-1).id, candidate})
        }
        // Only a committed, uniquely paired successful Host receipt presents a result.
        // Keep the original tool records and derive a separately pageable message.
        if (resultMessages && call?.resultText && !message.isError) {
          let receipt
          try { receipt = JSON.parse(selected.text) } catch { /* no successful receipt */ }
          const taskResult = taskId && call.name === 'task_result' && receipt?.received === true && receipt.accepted !== false
          const operatorReply = !taskId && call.name === 'resident_operator_reply' && receipt?.result?.accepted === true && receipt.result.webOnly === true && !operatorReplies.has(call.operatorEventKey)
          if(operatorReply)operatorReplies.add(call.operatorEventKey)
          const routerReply = !taskId && call.name === 'resident_router_reply' && receipt?.accepted === true
          if (taskResult || routerReply || operatorReply) add(entry, 'business-result-' + index, 'assistant', operatorReply?receipt.result.text:call.resultText, {kind: taskResult ? 'task-result' : 'router-reply', callId}, message)
        }
      } else if (executionActivity && message.role === 'compactionSummary' && entry.type === 'compaction' && typeof message.summary === 'string') {
        const observation=executionTiming?.compaction(entry.id),timing=timingFields(observation)
        const summaryVisible=compactionSummaryVisible(entry,nativeEntries,secrets)
        const mode=['foreground','background'].includes(observation?.mode)?observation.mode:undefined
        const compaction={...mode?{mode}:{},...nonnegativeInteger(message.tokensBefore)?{tokensBefore:message.tokensBefore}:{},
          ...nonnegativeInteger(observation?.tokensAfter)?{tokensAfter:observation.tokensAfter}:{},...!summaryVisible?{summaryHidden:true}:{}}
        // Use the authoritative summary and only numeric metadata. In particular
        // never return raw extension details, the full old branch, or a saved prompt.
        add(entry,'compaction-'+index,'assistant',summaryVisible?message.summary:'',{kind:'compaction',compaction,...!summaryVisible?{redacted:true}:{},...timing?{timing}:{}},message)
      } else if (message.role === 'user') {
        add(entry, 'user-' + index, 'user', texts(message.content), {kind: 'source'}, message)
      } else if (message.role === 'custom' && message.customType === 'night.business-input') {
        const source = message.details?.source
        if (taskId) {
          if (source?.kind !== 'task-input' && source?.kind !== 'task-supplement') continue
          if (source.taskSession?.taskId !== taskId || source.taskSession?.sessionId !== sessionId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          let input
          try {input = JSON.parse(texts(message.content))} catch {fail('SESSION_SOURCE_INVALID', 503)}
          const {instruction,direct} = inputsById.size ? taskInputInstructions(input, source.taskSession, inputsById, inputsBySource)
            : {instruction:taskInstruction(input),direct:[]}
          if (instruction) add(entry, 'instruction-' + index, 'user', instruction, {kind: 'instruction'}, message)
          for (const [requestId,row] of direct) {
            if (seenTaskInputs.has(requestId)) continue
            seenTaskInputs.add(requestId)
            const safe = visibleText(requestId,secrets).text === requestId
            add(entry, 'task-input-' + index + '-' + requestId, 'user', row.text, {kind:'instruction',...(safe?{requestId}:{})}, message)
          }
        } else if (source?.kind === 'schedule') {
          const content = texts(message.content)
          const prompts = scheduledPrompts(content, source)
          ;(prompts ?? [content]).forEach((prompt, n) => add(entry, 'scheduled-' + index + '-' + n, 'user', prompt, {kind: 'scheduled-trigger'}, message))
        } else if (source?.kind === 'conversation-router') {
          if (source.conversationId !== conversationId || source.generation !== generation) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          const content = texts(message.content), prefix = 'Router 请求：'
          let input
          try {if (!content.startsWith(prefix)) throw new Error(); input = JSON.parse(content.slice(prefix.length))} catch {fail('SESSION_SOURCE_INVALID', 503)}
          if (input.conversationId !== conversationId || input.generation !== generation || !Array.isArray(input.events)) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
          const verifiedPacket = isOriginalRouterPacket(entry,message)
          const firstRow = items.length
          const displayed = input.events.map((event, n) => {
            if(event.kind==='operator.message'){if(event.operator?.destination!=='web')fail('SESSION_SOURCE_IDENTITY_INVALID',503);return sourceText(entry,'router-operator-'+index+'-'+n,{sourceId:event.id,version:1,text:event.operator.text})}
            if (!event.source) return
            const row = event.source
            if ((row.conversationId ?? row.groupId) !== conversationId) fail('SESSION_SOURCE_IDENTITY_INVALID', 503)
            return sourceText(entry, 'router-source-' + index + '-' + n, row)
          })
          if (verifiedPacket && Array.isArray(source.eventIds) && source.eventIds.length <= 30
            && isDeepStrictEqual(source.eventIds,input.events.map(event=>event.id))) {
            for (const [n,event] of input.events.entries()) {
              const safe = safeRouterSettlementEvent(event)
              if (!safe || typeof event.id !== 'string' || !event.id) continue
              if (safe.kind==='source.message' && event.sourceId===event.source?.sourceId
                && event.messageVersion===event.source?.version && displayed[n]?.text
                && event.source.retracted!==true && event.source.authorizationRevoked!==true) {
                const chars=Array.from(displayed[n].text.replace(/\s+/g,' ').trim())
                if(chars.length)safe.snippet=chars.slice(0,120).join('')
                if(chars.length>120)safe.snippetTruncated=true
              }
              if (readRouterTasks && safe.kind.startsWith('task.') && typeof event.taskId==='string' && event.taskId
                && event.taskEvent?.taskId===event.taskId && typeof event.taskEventId==='string' && event.taskEventId
                && event.taskEvent.id===event.taskEventId) {
                authorizedTaskTitles ??= Promise.resolve().then(readRouterTasks).then(rows => new Map(
                  (Array.isArray(rows)?rows:[]).filter(row=>row?.groupId===conversationId && typeof row.taskId==='string' && typeof row.title==='string')
                    .map(row=>[row.taskId,visibleText(row.title,secrets).text.slice(0,120)])
                )).catch(()=>new Map())
                const title = (await authorizedTaskTitles).get(event.taskId)
                if(title)safe.title=title
              }
              const prior = provedRouterEvents.get(event.id)
              if (prior === undefined) provedRouterEvents.set(event.id,safe)
              else if (!isDeepStrictEqual(prior,safe)) provedRouterEvents.set(event.id,null)
            }
          }
          // An internal or deduplicated packet still starts its own *admitted*
          // Router process. Carry only that boundary; never publish the packet.
          if (executionActivity && items.length === firstRow && stamp(undefined, entry) && verifiedPacket) {
            add(entry, 'router-packet-boundary', 'assistant', '', {kind:'router-packet-boundary'})
          }
        }
      }
    }
  }
  // Pi puts its latest summary first for model context; the Web timeline keeps
  // the actual commit position relative to still-retained earlier messages.
  return timeline?items.sort((a,b)=>timeline.get(a)-timeline.get(b)):items
}

function pageOptions({offset = 0, limit = 50, stream = false, checkpoint, before, revision}) {
  if (stream) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || offset !== 0 || revision
      || checkpoint != null && !/^[a-f0-9]{64}\.[a-f0-9]{64}(?:\.r)?$/.test(checkpoint)
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
const isoTime = value => typeof value==='string'&&Number.isFinite(Date.parse(value))?value:undefined
function liveNotice(value) {
  if(!['model','compaction'].includes(value?.source))return
  if(['failed','cancelled'].includes(value.kind))return {kind:value.kind,source:value.source}
  if(value.kind==='retry'&&nonnegativeInteger(value.attempt)&&value.attempt>0&&nonnegativeInteger(value.maxAttempts)&&value.maxAttempts>=value.attempt)return {kind:'retry',source:value.source,attempt:value.attempt,maxAttempts:value.maxAttempts}
}
async function projectLive(snapshot, identity, secrets, raw, calls, executionActivity) {
  if (!raw || raw.sessionId !== identity.sessionId || typeof raw.active !== 'boolean' || typeof raw.revision !== 'string') return {active:false,items:[]}
  const notice=executionActivity?liveNotice(raw.notice):undefined
  if (!raw.active||!executionActivity&&['compaction','retry'].includes(raw.phase)) return {active:false,revision:raw.revision,items:[],...notice?{notice}:{}}
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
  const tools=[]
  for (const tool of raw.tools ?? []) {
    if (typeof tool.id !== 'string' || typeof tool.toolName!=='string'||pending.get(tool.toolCallId) !== tool.toolName) continue
    const startedAt=isoTime(tool.startedAt)
    if(executionActivity&&startedAt&&!tool.ended)tools.push({callId:calls.get(tool.toolCallId).id,startedAt})
    if (!Array.isArray(tool.content) || !tool.content.length) continue
    if (!(identity.taskId && taskTextTools.has(tool.toolName)) && !Object.hasOwn(toolOutputs,tool.toolName)) continue
    if (!(identity.taskId && taskTextTools.has(tool.toolName)) && !tool.complete) continue
    const text=visibleLiveText(texts(tool.content),secrets,tool.complete===true)
    if (!text) continue
    extra.push({sourceEntry:{id:tool.id},messages:[{role:'toolResult',toolCallId:tool.toolCallId,toolName:tool.toolName,isError:tool.isError===true,content:[{type:'text',text}]}]})
  }
  const liveEntryIds = new Set(extra.map(row=>digest(JSON.stringify([identity.sessionId,row.sourceEntry.id]))))
  const combined={...snapshot,context:{...snapshot.context,projection:{...snapshot.context.projection,entries:extra}}}
  const phase=['waiting','thinking','text','tool'].includes(raw.phase)||executionActivity&&['preparing','compaction','retry'].includes(raw.phase)?raw.phase:undefined
  const phaseStartedAt=phase?isoTime(raw.phaseStartedAt):undefined
  return {active:true,revision:raw.revision,...phase?{phase}:{},...phaseStartedAt?{phaseStartedAt}:{},...notice?{notice}:{},...tools.length?{tools}:{},
    items:(await projectEntries(combined,identity,secrets,new Map(calls),false)).filter(row=>liveEntryIds.has(row.source.entryId)).map(row=>({...row,transient:true,status:'running',text:row.text.slice(0,16000),textTotal:row.text.length,textNextOffset:null,...row.text.length>16000?{truncated:true}:{}}))}
}

// No public history is cached: only short-lived committed identity/pending calls.
// Every live request rechecks the exact physical journal, current browser and secrets.
const liveProofs = new WeakMap()
const liveValidity = Symbol('live-proof-validity')
const historyData = Symbol('history-candidate-data')
const historyCache=new WeakMap(), exposureProofs=new Map()
const projectionBudget=8*1024*1024, cacheTTL=12000, cacheLimit=4, exposureTTL=120000
async function measure(timing,name,fn){
  const start=performance.now()
  try{return await fn()}finally{if(timing)timing[name]=(timing[name]??0)+(performance.now()-start)}
}
function cachedHistory(authority,key,read){
  if(!authority||!['object','function','symbol'].includes(typeof authority))return
  let cache=historyCache.get(authority)
  if(!cache){cache=new Map();historyCache.set(authority,cache)}
  for(const [id,value] of cache)if(value.expires<=Date.now())cache.delete(id)
  if(read===undefined)return cache.get(key)
  if(cache.size>=cacheLimit)cache.delete(cache.keys().next().value)
  cache.set(key,{...read,expires:Date.now()+cacheTTL})
}
const resourceHash=row=>digest(JSON.stringify([row.text,row.redacted,row.skillName]))

const proofTTL = 10000, proofLimit = 64
async function projection({base, identity, persistence, validIdentity, notStarted, revision, secrets = [], liveProof, proofScope, guard, includeTaskUsage = false, readTaskInputIds, executionActivity = false, readExecutionTiming, readResourceContents, readRouterTasks, resourceProof, requestTiming}) {
  const {sessionId} = identity
  if (!sessionId || !persistence?.readNative) return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  const identityKey = JSON.stringify(identity), secretKey = digest(JSON.stringify(secrets))
  // Cordis 服务门面每次查询都会改变；proof 绑定底层持久化身份。
  const authority = persistence.identity ?? persistence
  const scoped = JSON.stringify([proofScope,identityKey,secretKey,includeTaskUsage,executionActivity])
  let proofs = liveProofs.get(authority)
  if (!proofs) {proofs = new Map(); liveProofs.set(authority, proofs)}
  for (const [key, value] of proofs) if (value.expires <= Date.now()) proofs.delete(key)
  if (liveProof) {
    const saved = proofs.get(liveProof)
    const changed = () => ({...base, status:'ready', historyChanged:true, live:{active:false,items:[]}})
    if (saved && saved.secret !== secretKey) fail('SESSION_REDACTION_CHANGED',409)
    if (!saved || !proofScope || saved.scope !== proofScope || saved.identity !== identityKey || !persistence.readNativeDigest) return changed()
    try {if (await measure(requestTiming,'journal',()=>persistence.readNativeDigest(sessionId)) !== saved.digest) return changed()} catch {return changed()}
    if(resourceProof)fail('SESSION_PAGE_STALE',409)
    const live = await projectLive({context:{projection:{entries:[]}}}, identity, secrets, await persistence.readLive?.(sessionId), saved.calls, executionActivity)
    return {...base, status:'ready', live, liveProof, historyChanged:false, [liveValidity]:()=>saved.expires>Date.now() && proofs.get(liveProof)===saved}
  }
  let taskInputs,inputKey
  async function refreshTaskInputs(){
    const current=identity.taskId&&readTaskInputIds?await measure(requestTiming,'task_inputs',()=>readTaskInputIds(sessionId)):undefined
    // Some observation-only stores do not implement the optional ledger
    // read. No result means no proven Web input identities, never a guess.
    if(current!=null&&!Array.isArray(current))fail('SESSION_SOURCE_INVALID',503)
    taskInputs=current??[]
    inputKey=digest(JSON.stringify(taskInputs))
  }
  let routerTitles,routerTitleKey
  const currentTitles=readRouterTasks&&(()=>routerTitles??=measure(requestTiming,'task_titles',readRouterTasks).catch(()=>[]))
  const titleKey=async()=>digest(JSON.stringify((await currentTitles())?.map(row=>[row.taskId,row.groupId,row.title])??[]))
  const issueLiveProof=(nativeDigest,calls)=>{
    while (proofs.size>=proofLimit)proofs.delete(proofs.keys().next().value)
    const token=randomUUID()
    proofs.set(token,{scope:proofScope,identity:identityKey,secret:secretKey,digest:nativeDigest,calls,expires:Date.now()+proofTTL})
    return token
  }
  const cached=proofScope&&persistence.readNativeDigest&&cachedHistory(authority,scoped)
  if(cached){
    let fresh
    try{fresh=await measure(requestTiming,'journal',()=>persistence.readNativeDigest(sessionId))===cached.nativeDigest}catch{}
    if(fresh)await refreshTaskInputs()
    if(fresh&&cached.inputKey===inputKey&&(!cached.routerTitleKey||currentTitles&&await titleKey()===cached.routerTitleKey)){
      const live=persistence.readLive?await projectLive({context:{projection:{entries:[]}}},identity,secrets,await persistence.readLive(sessionId),cached.calls,executionActivity):undefined
      if (revision&&revision!==cached.fixed.revision)fail('SESSION_PAGE_STALE',409)
      const liveProof=issueLiveProof(cached.nativeDigest,cached.calls)
      return {...base,...cached.fixed,...live?{live}:{},liveProof,[historyData]:{...cached.data,scoped,authority}}
    }
  }
  let snapshot
  try {snapshot = await measure(requestTiming,'journal',()=>persistence.readNative(sessionId, {requireComplete: true}))} catch (error) {
    if (error.code === 'PI_SESSION_CHANGED' || error.code === 'PI_SESSION_UNCOMMITTED_TAIL' || error.code === 'PI_SESSION_COMMIT_REQUIRED') {
      return {...base, status: 'pending', reason: 'SESSION_COMMIT_PENDING', [historyData]:{scoped,authority}}
    }
    if (error.name === 'SessionPersistenceNotFoundError' && notStarted) return {...base, status: 'pending', reason: 'SESSION_NOT_STARTED'}
    return {...base, status: 'unavailable', reason: 'SESSION_UNAVAILABLE'}
  }
  if (snapshot.header?.id !== sessionId || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.context?.projection?.entries) || !validIdentity(snapshot)) fail('SESSION_IDENTITY_INVALID', 503)
  const journalRevision = digest(JSON.stringify([sessionId, snapshot.journalDigest??snapshot.entries.at(-1)?.id,secretKey]))
  // Validate/redact committed history once, retaining its exact pending-call
  // pairing state for the bounded live suffix. No cached authorization.
  const calls = new Map()
  await refreshTaskInputs()
  let timing
  if (executionActivity&&readExecutionTiming) try {timing=await measure(requestTiming,'diagnostics',()=>readExecutionTiming(identity))} catch { /* Optional diagnostics never blocks committed history. */ }
  const resourceCandidates = readResourceContents ? [] : undefined
  const items = await measure(requestTiming,'projection',()=>projectEntries(snapshot, identity, secrets, calls, true, taskInputs, executionActivity, timing, resourceCandidates, currentTitles))
  const live = persistence.readLive ? await projectLive(snapshot, identity, secrets, await persistence.readLive(sessionId), calls, executionActivity) : undefined
  if (revision && revision !== journalRevision) fail('SESSION_PAGE_STALE', 409)
  let nextProof
  const liveCalls = new Map([...calls].map(([id, call]) => {
    if (!call?.resourceArgs) return [id, call]
    const {resourceArgs, ...safe} = call
    return [id, safe]
  }))
  const canProve=proofScope && liveCalls.size<=256 && JSON.stringify([...liveCalls]).length<=65536 && typeof snapshot.journalDigest==='string' && persistence.readNativeDigest
  if(canProve)nextProof=issueLiveProof(snapshot.journalDigest,liveCalls)
  const fixed={status:'ready',revision:journalRevision,...(includeTaskUsage?{tokenUsage:nativeTokenUsage(snapshot.entries)}:{}),
    ...taskTodos(snapshot,identity,secrets),items}
  const data={candidates:new Map((resourceCandidates??[]).map(({id,candidate})=>[id,candidate])),prefixes:new Map(),positions:new Map(items.map((row,index)=>[row.id,index]))}
  // Never retain independently authorized readback text or a native snapshot.
  // Only verified selectors with body digests and redacted projection belong here.
  if(routerTitles)routerTitleKey=await titleKey()
  if(canProve && Buffer.byteLength(JSON.stringify([items,[...data.candidates]]))<=projectionBudget)
    cachedHistory(authority,scoped,{nativeDigest:snapshot.journalDigest,inputKey,routerTitleKey,fixed,data,calls:liveCalls})
  return {...base,...fixed,...(live?{live}:{}),...(nextProof?{liveProof:nextProof}:{}),[historyData]:{...data,scoped,authority}}
}
function readExposure(token,context){
  if(!token)return new Map()
  const entry=exposureProofs.get(token)
  if(!entry||entry.expires<=Date.now()||entry.scope!==context?.scoped||entry.authority!==context?.authority)fail('SESSION_PAGE_STALE',409)
  return entry.loaded
}
function resourceFields(body,candidate,secrets){
  const safe=visibleText(body.text,secrets,{maxLength:Infinity})
  if(['filesystem','learned'].includes(candidate.kind)&&typeof body.skillName==='string'&&!visibleText(body.skillName,secrets).redacted)safe.skillName=body.skillName
  return safe
}
async function authorizeHistory(value,options,selected){
  const context=value[historyData]
  const {resourceProof,readResourceContents,requestTiming,secrets=[]}=options
  const loaded=readExposure(resourceProof,context)
  if(!context){return {value,selected}}
  const pending=value.reason==='SESSION_COMMIT_PENDING'
  // No uncommitted journal rows are eligible. Previously disclosed references
  // let us recheck the old bodies while the committed projection is unavailable.
  const candidateFor=id=>pending?loaded.get(id)?.candidate:context.candidates.get(id)
  const ids=new Set([...selected.map(row=>row.id),...loaded.keys()])
  const candidates=[...ids].flatMap(id=>{const candidate=candidateFor(id);return candidate?[{id,candidate}]:[]})
  const granted=candidates.length&&readResourceContents?await measure(requestTiming,'permissions',()=>requestTiming?observeMemoryLock((name,ms)=>{
    requestTiming[name]=(requestTiming[name]??0)+ms
  },()=>readResourceContents(candidates,(name,work)=>measure(requestTiming,name,work))):readResourceContents(candidates)):new Map()
  const current=new Map()
  const items=selected.map(row=>{
    const body=granted.get(row.id)
    if(!body)return row
    const candidate=candidateFor(row.id)
    const next={...row,...resourceFields(body,candidate,secrets),resourceContent:true}
    delete next.detailState
    current.set(row.id,{hash:resourceHash(next),candidate})
    return next
  })
  if(options.messageId&&context.candidates.has(options.messageId)&&!granted.has(options.messageId))fail('SESSION_PAGE_STALE',409)
  for(const [id,{hash}] of loaded){
    const body=granted.get(id),candidate=candidateFor(id)
    if(!body||!candidate||resourceHash(resourceFields(body,candidate,secrets))!==hash)fail('SESSION_PAGE_STALE',409)
    current.set(id,{hash,candidate})
  }
  let next
  if(!pending&&options.stream&&current.size){
    // A viewer that has accumulated too many independently revocable bodies
    // must reload its window, not keep unverified bodies indefinitely.
    if(current.size>512)fail('SESSION_PAGE_STALE',409)
    for(const [token,proof] of exposureProofs)if(proof.expires<=Date.now())exposureProofs.delete(token)
    while(exposureProofs.size>=128)exposureProofs.delete(exposureProofs.keys().next().value)
    next=randomUUID()
    exposureProofs.set(next,{scope:context.scoped,authority:context.authority,loaded:current,expires:Date.now()+exposureTTL})
  }
  const out={...value}
  delete out[historyData]
  if(next){out.resourceProof=next;delete out.liveProof}
  return {value:out,selected:items}
}
function sessionPage(value, options) {
  const {offset, limit} = pageOptions(options)
  if (value.status !== 'ready') return value
  if (options.stream) return sessionStream(value, options)
  const rows = value.items, end = Math.max(0, rows.length - offset)
  const items = rows.slice(Math.max(0, end - limit), end)
  return {...value, items, total: rows.length, offset, limit, nextOffset: offset + items.length < rows.length ? offset + items.length : null}
}

// A checkpoint commits the entire authorized prefix, not just its last ID.
// Appends remain readable without offset drift; branch/compaction/redaction or
// a different session invalidates the prefix instead of mixing snapshots.
function sessionStream(value, {limit = 200, checkpoint, before, executionActivity}) {
  const rows = value.items
  const proof = index => {
    const known=value[historyData]?.prefixes
    if(known?.has(index))return known.get(index)
    const hash=digest(JSON.stringify(rows.slice(0, index + 1).map(row=>{
    if(!row.timing)return row
    const {timing,...stable}=row
    if(stable.compaction){const {mode,tokensAfter,...committed}=stable.compaction;stable.compaction=committed}
    return stable
    })))
    if((known?.size??0)<1024)known?.set(index,hash)
    return hash
  }
  let anchor = -1
  if (checkpoint) {
    const [id, hash] = checkpoint.split('.')
    anchor = value[historyData]?.positions.get(id)??-1
    if (anchor < 0 || proof(anchor) !== hash) fail('SESSION_PAGE_STALE', 409)
  }
  let start, end
  if (before) {
    end = value[historyData]?.positions.get(before)??-1
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
  const items = rows.slice(start, end)
  // Asynchronous diagnostic metadata must not rewrite a history cursor.
  const previousTail=executionActivity&&checkpoint&&!before?rows.slice(Math.max(0,start-200),start):[]
  const timingUpdates=Object.fromEntries(previousTail.flatMap(row=>row.timing?[[row.id,row.timing]]:[]))
  const compactionUpdates=Object.fromEntries(previousTail.flatMap(row=>{
    const {mode,tokensAfter}=row.compaction??{}
    return mode||tokensAfter!==undefined?[[row.id,{...mode?{mode}:{},...tokensAfter!==undefined?{tokensAfter}:{}}]]:[]
  }))
  return {...value, items, total: rows.length, limit, nextOffset: null,...Object.keys(timingUpdates).length?{timingUpdates}:{},...Object.keys(compactionUpdates).length?{compactionUpdates}:{},
    checkpoint: last >= 0 ? `${rows[last].id}.${proof(last)}` : null,
    before: start > 0 && start < rows.length ? rows[start].id : null, hasNewer: !before && end < rows.length}
}
function messagePage(value, {messageId, offset = 0, limit = 16000, revision}) {
  if (typeof revision !== 'string' || !revision || typeof messageId !== 'string' || !/^[a-f0-9]{64}$/.test(messageId)
    || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) fail('PAGE_INVALID')
  if (value.status !== 'ready') fail(value.reason, 503)
  const row = value.items.find(item => item.id === messageId)
  if (!row || row.compaction?.summaryHidden || row.kind === 'router-packet-boundary') fail('SESSION_MESSAGE_NOT_FOUND', 404)
  if (offset > row.text.length) fail('PAGE_INVALID')
  const end = Math.min(row.text.length, offset + limit)
  return {messageId, text: row.text.slice(offset, end), offset, nextOffset: end < row.text.length ? end : null, total: row.text.length, revision: value.revision, source: row.source, redacted: row.redacted, ...(row.resourceContent ? {resourceContent: true} : {})}
}
async function taskProjection({task, ...options}) {
  const taskId = task.taskId, sessionId = task.session?.sessionId ?? task.sessionId
  const base = {taskId, sessionId: sessionId ?? null, scope: 'current-session-context', items: [], total: 0, nextOffset: null}
  return projection({...options, includeTaskUsage:true, base, identity: {taskId, sessionId}, notStarted: (task.session?.sessionBound ?? task.sessionBound) === false,
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
  if (!options.liveProof && value.status === 'ready' && !value.items.some(row => row.kind !== 'router-packet-boundary') && readRotations) {
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
  if(options.guard)await measure(options.requestTiming,'final_guard',options.guard)
  const valid=value[liveValidity];delete value[liveValidity]
  if(valid&&!valid())return {...value,historyChanged:true,live:{active:false,items:[]}}
  return value
}
async function readPage(project,options){
  pageOptions(options)
  if(options.checkpoint?.endsWith('.r')&&!options.resourceProof)fail('SESSION_PAGE_STALE',409)
  const value=await project(options)
  if(options.activityOnly) {
    await finalRead(value,options)
    if(value.status==='unavailable')fail(value.reason,503)
    return {sessionId:value.sessionId,activeGeneration:value.activeGeneration,live:value.live??{active:false,items:[]},committing:value.reason==='SESSION_COMMIT_PENDING'}
  }
  if(value.status!=='ready'){
    if(!options.resourceProof)return finalRead(value,options)
    if(value.reason!=='SESSION_COMMIT_PENDING')fail('SESSION_PAGE_STALE',409)
    const {value:pending}=await authorizeHistory(value,options,[])
    return finalRead(pending,options)
  }
  if(options.liveProof)return finalRead(value,options)
  const page=sessionPage(value,options)
  const {value:output,selected}=await authorizeHistory(value,options,page.items)
  const result={...page,...output.resourceProof?{resourceProof:output.resourceProof}:{},items:selected.map(row=>({...row,text:row.text.slice(0,16000),textTotal:row.text.length,
    textNextOffset:row.text.length>16000?16000:null,...row.text.length>16000?{truncated:true}:{}}))}
  delete result[historyData]
  if(result.resourceProof){delete result.liveProof;if(result.checkpoint)result.checkpoint+='.r'}
  return finalRead(result,options)
}
async function readBody(project,options){
  const value=await project(options)
  if(value.status!=='ready')return messagePage(await finalRead(value,options),options)
  const found=value.items[value[historyData]?.positions.get(options.messageId)]
  const {value:output,selected}=await authorizeHistory(value,options,found?[found]:[])
  return messagePage(await finalRead({...output,items:selected},options),options)
}
export const taskSessionView=options=>readPage(taskProjection,options)
export const taskSessionMessageView=options=>readBody(taskProjection,options)
export const routerSessionView=options=>readPage(routerProjection,options)
export const routerSessionMessageView=options=>readBody(routerProjection,options)
