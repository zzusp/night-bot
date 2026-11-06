import {digest, fail} from './security.js'

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))
const privateKeys = new Set(['workspaceDir', 'logPath', 'path', 'directory', 'absolutePath', 'dispatchToken', 'sendPermit', 'payloadDigest', 'apiKey', 'accessToken', 'authorization'])
const publicDetail = value => Array.isArray(value) ? value.map(publicDetail)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !privateKeys.has(key)).map(([key, item]) => [key, publicDetail(item)])) : value

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

export function taskView(task) {
  return {
    ...pick(task, ['taskId', 'title', 'objective', 'request', 'state', 'status', 'controlState', 'groupId', 'createdAt', 'updatedAt', 'archivedAt', 'requirementRevision', 'controlRevision', 'waitingReason']),
    ...(task.result ? {result: publicDetail(task.result)} : {}),
    ...(task.session ? {session: pick(task.session, ['role', 'sessionId', 'sessionBound', 'status'])} : {}),
    ...(task.timeline ? {timeline: publicDetail(task.timeline)} : {}),
    ...(task.blockers !== undefined ? {blockers: blockerViews(task.blockers)} : {}),
    ...(task.notifications ? {notifications: task.notifications.map(value => ({...pick(value, ['id', 'state', 'kind', 'updatedAt', 'createdAt']), text: value.payload?.text ?? ''}))} : {}),
  }
}

export function configuredChannels(application, channels) {
  return {items: (application.config.channelPlugins ?? []).map(row => {
    const channelId = row.channelId ?? row.config?.channelId ?? row.type
    const health = channels.plugins.get(channelId)?.health
    return {channelId, type: row.type, enabled: row.enabled === true,
      ...(typeof health?.healthy === 'boolean' ? {connected: health.healthy} : {})}
  })}
}

export function conversations(application, channels) {
  return {items: application.tasks.listObserverGroups().map(group => {
    const context = channels.groupContext(group.groupId)
    return {id: group.groupId, name: group.name || context?.conversationId || group.groupId,
      channelId: context?.channelId ?? null, type: context?.type ?? null,
      ...(group.updatedAt ? {updatedAt: group.updatedAt} : {})}
  })}
}

export async function conversationMessages(application, id, options) {
  const query = {limit: options.limit, filter: 'all'}
  const [messages, outbox] = await Promise.all([
    application.tasks.observerGroupPage(id, {...query, collection: 'messages', offset: options.messageOffset, ...(options.messageRevision ? {revision: options.messageRevision} : {})}),
    application.tasks.observerGroupPage(id, {...query, collection: 'outbox', offset: options.outboxOffset, ...(options.outboxRevision ? {revision: options.outboxRevision} : {})}),
  ])
  if (!messages || !outbox) fail('CONVERSATION_NOT_FOUND', 404)
  const items = [
    ...messages.items.map(message => ({id: message.messageId, role: 'user', text: message.text ?? '',
      createdAt: message.occurredAt ?? null, status: message.processingState ?? 'unknown', senderName: message.senderName ?? '', taskIds: message.taskSessionRefs ?? []})),
    ...outbox.items.map(message => ({id: message.outboundId, role: 'assistant', text: message.text ?? '',
      createdAt: message.sentAt ?? message.deliveredAt ?? message.sendStartedAt ?? null,
      status: message.notificationState ?? message.status ?? 'unknown', taskIds: message.taskIds ?? []})),
  ].sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.id.localeCompare(right.id))
  return {items, pages: {messages: pick(messages, ['total', 'nextOffset', 'revision']), outbox: pick(outbox, ['total', 'nextOffset', 'revision'])}}
}
