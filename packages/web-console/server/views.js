import {digest, fail} from './security.js'
import {visibleText} from './session-view.js'
import {channelIngressView} from '../../../src/channels/ingress-control.js'

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))
// 任务业务字段由原合同限制长度；这里仅脱敏，不沿用执行日志的单条截断策略。
const displayText = (value, secrets) => visibleText(value, secrets, {maxLength: Infinity}).text
// 展示字段按现有结果/时间线合同逐层选取；新增领域字段不会自动穿透到浏览器。
const displayFields = (value, keys, secrets) => Object.fromEntries(keys.flatMap(key => {
  const item = value?.[key]
  if (typeof item === 'string') return [[key, displayText(item, secrets)]]
  if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return [[key, item]]
  return []
}))
const displayLists = (value, keys, secrets) => Object.fromEntries(keys.filter(key => Array.isArray(value?.[key]))
  .map(key => [key, value[key].filter(item => typeof item === 'string').map(item => displayText(item, secrets))]))
const resultView = (value, secrets) => typeof value === 'string' ? displayText(value, secrets) : {
  ...displayFields(value, ['action', 'status', 'summary', 'question'], secrets),
  ...displayLists(value, ['evidence', 'limitations'], secrets),
}
const timelineEntry = (value, secrets) => ({
  ...displayFields(value, ['id', 'kind', 'sequence', 'executionId', 'inputVersion', 'leaseEpoch', 'at', 'startedAt', 'endedAt', 'active', 'status', 'label', 'description', 'summary', 'activity'], secrets),
  ...displayLists(value, ['evidence', 'limitations'], secrets),
})
const timelineTrack = (value, secrets) => ({
  ...displayFields(value, ['id', 'title', 'status', 'complete', 'startedAt', 'endedAt', 'active'], secrets),
  ...Object.fromEntries(['events', 'segments', 'milestones', 'conclusions'].filter(key => Array.isArray(value?.[key]))
    .map(key => [key, value[key].map(item => timelineEntry(item, secrets))])),
})
const timelineView = (value, secrets) => ({
  ...displayFields(value, ['version'], secrets),
  ...(value.task ? {task: timelineTrack(value.task, secrets)} : {}),
  ...(Array.isArray(value.executions) ? {executions: value.executions.map(item => timelineTrack(item, secrets))} : {}),
  ...(value.human ? {human: timelineTrack(value.human, secrets)} : {}),
})

const blockerStates = new Set(['queued', 'pending', 'prepared', 'running', 'stopping', 'waiting', 'blocked', 'recovering', 'unknown', 'succeeded', 'failed', 'cancelled', 'stale', 'not_started'])
const blockerTitle = value => typeof value === 'string' && value.trim()
  && !/(?:Bearer\s|(?:password|token|api[_-]?key|secret)\s*[:=]|[A-Za-z]:[\\/]|(?:^|\s)\/)/i.test(value) ? value.trim().slice(0, 240) : undefined

// 底座返回三类原记录；页面只接收平坦的展示项，不带操作参数、资源键或历史来源路径。
function blockerViews(value) {
  if (!value || Array.isArray(value) || ['executions', 'operations', 'legacy'].some(key => !Array.isArray(value[key]))) fail('TASK_BLOCKERS_INVALID', 503)
  const common = (kind, id, status, title) => ({kind, id: digest(JSON.stringify([kind, id])), title, status: blockerStates.has(status) ? status : null})
  return [
    ...value.executions.map(row => ({...common('execution', row.executionId, row.status, blockerTitle(row.input?.title ?? row.title) ?? '执行尚未排空'),
      ...(typeof row.drained === 'boolean' ? {drained: row.drained} : {}), ...(typeof row.recovering === 'boolean' ? {recovering: row.recovering} : {})})),
    ...value.operations.map(row => {
      const name = row.definition?.toolName ?? row.definition?.tool
      const toolName = typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(name) ? name : undefined
      return {...common('operation', row.operationId ?? row.id, row.state, toolName ? `待核实操作：${toolName}` : '待核实操作'), ...(toolName ? {toolName} : {})}
    }),
    ...value.legacy.map(row => common('legacy', row.id, row.state, '历史阻断待核实')),
  ]
}

// List rows do not include execution-derived board state. Preserve their recorded
// status rather than infer that an active task is currently running.
export function taskSummaryView(task, secrets = []) {
  const state = task.state ?? (task.status === 'completed' ? 'completed' : task.control === 'cancelled' ? 'cancelled' : task.control === 'paused' ? 'waiting' : task.status)
  return Object.fromEntries(['taskId', 'title', 'state', 'updatedAt'].flatMap(key => {
    const value = key === 'state' ? state : task[key]
    return typeof value === 'string' ? [[key, displayText(value, secrets)]] : []
  }))
}

export function taskView(task, secrets = []) {
  return {
    ...displayFields(task, ['taskId', 'title', 'objective', 'request', 'state', 'status', 'controlState', 'groupId', 'createdAt', 'updatedAt', 'archivedAt', 'requirementRevision', 'controlRevision', 'waitingReason'], secrets),
    ...(task.result ? {result: resultView(task.result, secrets)} : {}),
    ...(task.session ? {session: pick(task.session, ['role', 'sessionId', 'sessionBound', 'status'])} : {}),
    ...(task.timeline ? {timeline: timelineView(task.timeline, secrets)} : {}),
    ...(task.blockers !== undefined ? {blockers: blockerViews(task.blockers)} : {}),
    ...(task.notifications ? {notifications: task.notifications.map(value => ({...pick(value, ['id', 'state', 'kind', 'updatedAt', 'createdAt']), text: displayText(value.payload?.text, secrets)}))} : {}),
  }
}

export function taskDialogueView(value, secrets = []) {
  return {taskId: value.taskId, sessionId: value.sessionId,
    messages: value.messages.map(message => displayFields(message, ['id', 'text', 'receivedAt', 'reply', 'repliedAt', 'replyFailedAt'], secrets)),
    writable: false, error: value.error ? 'TASK_DIALOGUE_UNAVAILABLE' : null}
}

const connectionStates = new Set(['starting', 'waiting-auth', 'ready', 'paused', 'recovering', 'listening', 'error', 'stopped'])
export function configuredChannels(application, channels, savedRows = application.config.channelPlugins ?? []) {
  const running=new Map((application.config.channelPlugins??[]).map(row=>[row.channelId??row.config?.channelId??row.type,row]))
  const errorFor=(health,type)=>{
    if(health?.state==='waiting-auth')return 'CHANNEL_AUTH_REQUIRED'
    if(health?.state==='error')return type==='dingtalk-dws'&&health.lastError==='DINGTALK_CHANNEL_SWITCH_BLOCKED'?'DINGTALK_CHANNEL_SWITCH_BLOCKED':'CHANNEL_ADAPTER_ERROR'
    if(type!=='dingtalk-dws'||health?.state!=='recovering')return null
    const failed=health.conversations?.filter(entry=>entry.backfill?.state==='failed')??[]
    if(failed.some(entry=>entry.backfill.lastError==='CHANNEL_MESSAGE_ID_CONFLICT'))return 'CHANNEL_MESSAGE_ID_CONFLICT'
    if(failed.some(entry=>['DINGTALK_HISTORY_INCOMPLETE','DINGTALK_DEFERRED_HISTORY_INCOMPLETE'].includes(entry.backfill.lastError)))return 'CHANNEL_HISTORY_INCOMPLETE'
    return failed.length?'CHANNEL_HISTORY_RECOVERY_FAILED':null
  }
  return {items:savedRows.map(row=>{
    const channelId=row.channelId??row.config?.channelId??row.type,loaded=running.get(channelId),plugin=channels.plugins.get(channelId)
    const savedVersion=digest(JSON.stringify(row)),runningVersion=loaded?digest(JSON.stringify(loaded)):null,pending=savedVersion!==runningVersion
    const health=plugin?.health,runningConnectionState=connectionStates.has(health?.state)?health.state:'unknown'
    const healthy = typeof health?.healthy === 'boolean' ? health.healthy && !['waiting-auth', 'error', 'stopped'].includes(runningConnectionState) && !errorFor(health,row.type) : undefined
    const lifecycleError=channels.configurationErrors?.get(channelId)
    const connectionState=lifecycleError?'error':pending?'pending-restart':runningConnectionState,errorCode=lifecycleError??(pending?null:errorFor(health,row.type))
    return {channelId,type:row.type,enabled:row.enabled===true,savedVersion,runningVersion,connectionState,errorCode,
      ingress:channelIngressView(row,plugin,channels.ingressErrors?.get(channelId)),
      restartRequired:pending,liveApplied:!lifecycleError&&!pending&&row.enabled===true&&!!plugin&&(row.type!=='dingtalk-dws'||plugin.bindingActive===true)&&!['waiting-auth','error','stopped'].includes(runningConnectionState),
      runningConnectionState,runningErrorCode:errorFor(health,row.type),
      ...(typeof healthy==='boolean'?{runningConnected:healthy}:{}),
      ...(row.type==='dingtalk-dws'?{name:row.config?.dingtalk_name??channelId,conversationType:row.config?.dingtalk_conversation_type,promptConfigured:!!row.config?.dingtalk_prompt,writesAuthorized:row.config?.dingtalk_writes_authorized===true,
        ...(loaded?{runningName:loaded.config?.dingtalk_name??channelId,runningConversationType:loaded.config?.dingtalk_conversation_type}:{} )}:{}),
      ...(pending||lifecycleError?{connected:false}:typeof healthy==='boolean'?{connected:healthy}:{})}
  })}
}

// Names are display-only. Never substitute a known provider/internal identity for a missing name.
const displayName = (candidates, ids, fallback) => candidates.map(value => typeof value === 'string' ? value.trim() : '').find(value => value && !ids.includes(value)) || fallback

export function conversations(application, channels) {
  return {items: application.tasks.listObserverGroups().map(group => {
    const context = channels.groupContext(group.groupId)
    return {id: group.groupId, name: displayName([context?.conversationName, group.name], [context?.conversationId, group.groupId, context?.channelId], context?.type === 'chat-room' ? '未命名群聊' : '未命名会话'),
      channelId: context?.channelId ?? null, type: context?.type ?? null,
      ...((context?.updatedAt ?? group.updatedAt) ? {updatedAt: context?.updatedAt ?? group.updatedAt} : {})}
  })}
}

// Merge only this Web ledger with visible channel conversations; IDs remain route keys.
export function recentConversations(application, channels, ledger, webChannelId, {offset = 0, limit = 20} = {}) {
  const web = ledger.chats({offset: 0, limit: offset + limit})
  const remote = conversations(application, channels).items.filter(item => item.channelId !== webChannelId)
    .map(item => ({id: item.id, title: item.name, updatedAt: item.updatedAt ?? '', kind: 'channel'}))
  const items = [...web.items.map(item => ({...item, kind: 'web'})), ...remote]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .slice(offset, offset + limit)
  const total = web.total + remote.length
  return {items, total, nextOffset: offset + items.length < total ? offset + items.length : null}
}

export async function conversationMessages(application, id, options, channels) {
  const query = {limit: options.limit, filter: 'all'}
  const [messages, outbox] = await Promise.all([
    application.tasks.observerGroupPage(id, {...query, collection: 'messages', offset: options.messageOffset, ...(options.messageRevision ? {revision: options.messageRevision} : {})}),
    application.tasks.observerGroupPage(id, {...query, collection: 'outbox', offset: options.outboxOffset, ...(options.outboxRevision ? {revision: options.outboxRevision} : {})}),
  ])
  if (!messages || !outbox) fail('CONVERSATION_NOT_FOUND', 404)
  const context = channels?.groupContext(id)
  const knownIds = [id, context?.conversationId, context?.channelId, ...Object.keys(context?.participants ?? {}), ...Object.values(context?.participants ?? {})]
  const items = [
    ...messages.items.map(message => ({id: message.messageId, messageVersion: message.messageVersion, role: 'user', text: message.text ?? '',
      createdAt: message.occurredAt ?? null, status: message.processingState ?? 'unknown', senderName: displayName([context?.participantNames?.[message.actorId ?? message.senderOpenDingTalkId], message.senderName], [...knownIds, message.actorId, message.senderOpenDingTalkId], '渠道成员'), taskIds: message.taskSessionRefs ?? []})),
    ...outbox.items.map(message => ({id: message.outboundId, role: 'assistant', text: message.text ?? '',
      createdAt: message.sentAt ?? message.deliveredAt ?? message.sendStartedAt ?? null,
      status: message.notificationState ?? message.status ?? 'unknown', taskIds: message.taskIds ?? []})),
  ].sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.id.localeCompare(right.id))
  return {items, pages: {messages: pick(messages, ['total', 'nextOffset', 'revision']), outbox: pick(outbox, ['total', 'nextOffset', 'revision'])}}
}

// 认证操作者必须能核对待批准的业务目标；仍脱敏秘密，不返回 raw args/env。
export function permissionsView(value, secrets = []) {
  const modes = ['ask', 'auto', 'full']
  if (!value || !modes.includes(value.mode)) fail('PERMISSIONS_UNAVAILABLE', 503)
  const text = value => visibleText(value, secrets, {maxLength: Infinity, preservePaths: true}).text
  const fields = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key] === null ? null : text(value[key])]))
  const tools = new Set(['read', 'read_window', 'read_image', 'write', 'edit', 'ls', 'find', 'grep', 'bash', 'pwsh'])
  return {mode: value.mode,
    options: value.options.filter(row => modes.includes(row.value)).map(row => ({value: row.value, label: text(row.label), description: text(row.description)})),
    protection: {...pick(value.protection, ['status', 'backend']), description: text(value.protection.description)},
    requests: value.requests.filter(row => tools.has(row.toolName)).map(row => ({
      ...fields(row, ['id', 'actorId', 'taskId', 'conversationId', 'callId', 'toolName', 'status', 'createdAt', 'decidedAt']),
      revocable: row.revocable === true,
      display: fields(row.display, ['summary', 'target', 'cwd', 'command', 'parametersDigest']),
    })),
  }
}
