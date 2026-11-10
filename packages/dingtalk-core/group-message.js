import {assertConversationReply as assertGroupReply,replyInternalTaskId} from '../../src/channels/message-safety.js'
export {conversationReplyScopeInstructions as groupReplyScopeInstructions,conversationReplyInstructions as groupReplyInstructions,assertConversationReply as assertGroupReply} from '../../src/channels/message-safety.js'

export function sameDeliveredText(observed, expected, quoted = false) {
  const normalize = text => typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : null
  const actual = normalize(observed), wanted = normalize(expected)
  if (actual === null || wanted === null) return false
  // 钉钉回读把单行 inline-code 表示成粗体；只变换期望的成对单反引号，保留正文。
  const inlineRendered = expected.replace(/(^|[^`])`([^`\r\n]+)`(?!`)/gu, '$1**$2**')
  // DWS 会移除列表项间换行；仅变换期望的顶层列表边界，保留正文和段落间隔。
  const listRendered = (text, restartOrdered = false) => {
    const lines = text.split(/\r?\n/u), rendered = []
    let fence = null
    for (let index = 0; index < lines.length; index++) {
      const marker = lines[index].match(/^\s*(`{3,}|~{3,})/u)?.[1]
      if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null }
      if (!fence && /^- .+/u.test(lines[index])) {
        let end = index, joined = lines[index]
        while (end + 1 < lines.length) {
          let next = end + 1
          while (next < lines.length && lines[next].trim() === '') next++
          if (!/^- .+/u.test(lines[next] ?? '')) break
          joined += lines[next]; end = next
        }
        rendered.push(joined); index = end; continue
      }
      if (!fence && /^1\. .+/u.test(lines[index])) {
        // 分段有序列表在钉钉回读中可各自从 1 开始；只变换连续原序号，正文逐字保留。
        if (restartOrdered) {
          let end = index, count = 1
          const items = [lines[index]]
          while (end + 1 < lines.length) {
            let next = end + 1
            while (next < lines.length && lines[next].trim() === '') next++
            const prefix = `${count + 1}. `
            if (!lines[next]?.startsWith(prefix) || lines[next].length <= prefix.length) break
            items.push(...lines.slice(end + 1, next), `1. ${lines[next].slice(prefix.length)}`)
            end = next; count++
          }
          if (count > 1) { rendered.push(...items); index = end; continue }
        }
        let end = index + 1
        while (end < lines.length && lines[end].startsWith(`${end - index + 1}. `) && lines[end].length > `${end - index + 1}. `.length) end++
        if (end > index + 1) { rendered.push(lines.slice(index, end).join('')); index = end - 1; continue }
      }
      rendered.push(lines[index])
    }
    return normalize(rendered.join('\n'))
  }
  const prefix = typeof quoted === 'object' && quoted?.sender ? normalize(`@${quoted.sender} `) + ' ' : null
  const body = prefix && actual.startsWith(prefix) ? actual.slice(prefix.length) : actual
  return [wanted, normalize(inlineRendered), listRendered(expected), listRendered(inlineRendered),
    listRendered(expected, true), listRendered(inlineRendered, true)].some(candidate => body === candidate)
}

export function notificationOpenTaskId(ack) {
  return ack?.openTaskId ?? ack?.sendReceipt?.openTaskId ?? ack?.result?.openTaskId ?? ack?.result?.result?.openTaskId
}

/** 只收集事实里的结构化身份和摘要；业务正文、标题及普通数值不作为内部标识。 */
function factInternalIds(fact) {
  if (!fact || typeof fact !== 'object') return []
  return Object.entries(fact).flatMap(([key, value]) => {
    const identity = /(?:Id|Ids|Digest|Ref|Refs)$/u.test(key) || key === 'id'
    if (Array.isArray(value)) return value.flatMap(item => item && typeof item === 'object' ? factInternalIds(item) : identity ? [item] : [])
    if (value && typeof value === 'object') return factInternalIds(value)
    return identity ? [value] : []
  })
}

export function assertWorkflowNotificationReply(notification) {
  const payload = notification.payload
  if (payload.reportChannel === 'web' || payload.externalMessaging === false
    || notification.disclosure?.authorizationRef?.startsWith('web-rerun:')) throw new Error('WORKFLOW_WEB_NOTIFICATION_FORBIDDEN')
  assertGroupReply(payload.text, [notification.id, replyInternalTaskId(notification.taskId, notification.replySourceText), payload.conversationId, payload.sourceMessageId,
    payload.actorId, payload.recipientUserId, payload.humanRequestId,
    ...(Array.isArray(payload.atOpenDingTalkIds) ? payload.atOpenDingTalkIds : []), ...factInternalIds(payload.fact)])
}

export function sendWorkflowNotification(adapter, notification) {
  assertWorkflowNotificationReply(notification)
  const payload = notification.payload
  // 普通提醒与引用回复都使用原生提及参数，不把人员 ID 或 @ 姓名拼进正文。
  const base = { groupId: payload.conversationId, text: payload.text, idempotencyKey: notification.id,
    atOpenDingTalkIds: payload.atOpenDingTalkIds ?? [], ...(payload.atAll ? { atAll: true } : {}) }
  return payload.sourceMessageId && payload.actorId
    ? adapter.sendGroupReply({ ...base, replyToMessageId: payload.sourceMessageId, replyToSenderOpenDingTalkId: payload.actorId })
    : adapter.sendGroup(base)
}

/** 重现原正文的本地拒发，且绑定唯一发送许可；不能从普通异常或缺少 ACK 推断未发送。 */
export function persistedReplySendRejectionProof(notification) {
  const id = notification?.id, permit = notification?.sendPermit, failure = notification?.deliveryError
  if (notification?.state !== 'unknown' || notification.sendAttemptCount !== 1
    || notification.ack != null || notification.receipt != null || !id || notification.payload?.artifact
    || !/^[a-f0-9]{64}$/u.test(notification.payloadDigest ?? '') || permit?.notificationId !== id
    || permit.payloadDigest !== notification.payloadDigest || permit.attempt !== 1
    || typeof notification.dispatchToken !== 'string' || !notification.dispatchToken.trim() || permit.fence !== notification.dispatchToken
    || failure?.phase !== 'send' || failure.name !== 'Error' || failure.code !== 'GROUP_REPLY_INTERNAL_DETAILS'
    || ['exitCode', 'stdout', 'stderr', 'serverErrorCode', 'origin', 'operation'].some(key => failure[key] != null)) return undefined
  try { assertWorkflowNotificationReply(notification) }
  catch (error) {
    if (error.code === failure.code && error.message === failure.message) return {
      kind: 'local-reply-validation-rejected', notificationId: id, payloadDigest: notification.payloadDigest,
      attempt: 1, fence: permit.fence, code: error.code, errorMessage: error.message,
    }
  }
  return undefined
}

/** 显式恢复只接纳与原发送许可逐字段相符的本地未发送证明；不把普通失败变成可重发。 */
export function taskReplySendRetryProof(notification) {
  if (notification?.state !== 'failed' || notification.kind !== 'status'
    || !notification.taskId || notification.payload?.taskDelivery?.taskId !== notification.taskId
    || notification.deliveryError?.knownNotSent !== true || notification.deliveryError.retryable !== false) return undefined
  const proof = persistedReplySendRejectionProof({ ...notification, state: 'unknown', replySourceText: undefined })
  return proof && Object.entries(proof).every(([key, value]) => notification.deliveryError.proof?.[key] === value) ? proof : undefined
}

// CLI v1.0.63 gateway contract: this exact guard refusal precedes the send call.
// A generic exit, rate limit, retryable flag or missing ACK is never a negative receipt.
export function quotedSendRejectionProof(result, request) {
  let error
  try { error = JSON.parse(result.stderr)?.error } catch { return undefined }
  if (result.exitCode !== 1 || (result.stdout ?? '').trim() || error?.category !== 'api' || error.code !== 1
    || error.origin !== 'mcp_gateway' || error.operation !== 'chat/get_conversation_info'
    || error.reason !== 'topic_quote_guard_unavailable' || error.retryable !== true
    || error.message !== '无法确认引用回复目标是否属于话题圈，已阻止发送') return undefined
  if (![request.groupId, request.replyToMessageId, request.replyToSenderOpenDingTalkId, request.idempotencyKey].every(value => typeof value === 'string' && value.trim())) return undefined
  return { kind: 'dws-topic-quote-guard-rejected', category: error.category, code: error.code, origin: error.origin,
    operation: error.operation, reason: error.reason, retryable: true, message: error.message,
    groupId: request.groupId, replyToMessageId: request.replyToMessageId, replyToSenderOpenDingTalkId: request.replyToSenderOpenDingTalkId, idempotencyKey: request.idempotencyKey }
}

/** 仅凭原发送尝试的完整 uuid 校验拒绝结清失败；不为未知网络结果或重发提供许可。 */
export function persistedUuidSendRejectionProof(notification) {
  const id = notification?.id, permit = notification?.sendPermit, failure = notification?.deliveryError
  if (notification?.state !== 'unknown' || notification.sendAttemptCount !== 1
    || notification.ack != null || notification.receipt != null || typeof id !== 'string' || id.length <= 128
    || !/^[a-f0-9]{64}$/u.test(notification.payloadDigest ?? '') || permit?.notificationId !== id
    || permit.payloadDigest !== notification.payloadDigest || permit.attempt !== 1
    || typeof notification.dispatchToken !== 'string' || !notification.dispatchToken.trim() || permit.fence !== notification.dispatchToken
    || failure?.phase !== 'send' || failure.exitCode !== 1 || failure.stdout !== ''
    || !['dws_send_failed:1:PARAM_ERROR', 'dws_reply_failed:1:PARAM_ERROR'].includes(failure.message)
    || failure.serverErrorCode !== 'PARAM_ERROR' || failure.origin !== 'dingtalk_api'
    || failure.operation !== 'tools/call' || failure.reason !== 'invalid_request' || failure.retryable !== false) return undefined
  let error
  try { error = JSON.parse(failure.stderr)?.error } catch { return undefined }
  const message = `sendPersonalMessageByServerPush error: Length of filed: 'uuid' cannot greater than 128 but actual is ${id.length}.`
  if (error?.category !== 'api' || error.code !== 1 || error.origin !== 'dingtalk_api'
    || error.operation !== 'tools/call' || error.reason !== 'invalid_request' || error.retryable !== false
    || error.server_error_code !== 'PARAM_ERROR' || error.server_key !== 'chat' || error.stage !== 'tool_validation'
    || error.message !== message) return undefined
  return { kind: 'dws-uuid-validation-rejected', notificationId: id, idempotencyKey: id,
    payloadDigest: notification.payloadDigest, attempt: 1, fence: permit.fence,
    origin: error.origin, operation: error.operation, stage: error.stage, reason: error.reason,
    serverErrorCode: error.server_error_code, maximumLength: 128, actualLength: id.length, errorMessage: message }
}

/** 已观察到的单成员 CLI 占位符校验在发送前拒绝；历史通知只能结清失败，不能自动补发。 */
export function persistedMentionSendRejectionProof(notification) {
  const id = notification?.id, permit = notification?.sendPermit, failure = notification?.deliveryError
  const mentions = notification?.payload?.atOpenDingTalkIds
  if (notification?.state !== 'unknown' || notification.sendAttemptCount !== 1
    || notification.ack != null || notification.receipt != null || typeof id !== 'string' || !id.trim()
    || !/^[a-f0-9]{64}$/u.test(notification.payloadDigest ?? '') || permit?.notificationId !== id
    || permit.payloadDigest !== notification.payloadDigest || permit.attempt !== 1
    || typeof notification.dispatchToken !== 'string' || !notification.dispatchToken.trim() || permit.fence !== notification.dispatchToken
    || failure?.phase !== 'send' || failure.exitCode !== 3 || failure.stdout !== ''
    || !['dws_send_failed:3', 'dws_reply_failed:3'].includes(failure.message)
    || !Array.isArray(mentions) || mentions.length !== 1 || typeof mentions[0] !== 'string' || !mentions[0]
    || /[\s,<>]/u.test(mentions[0]) || typeof notification.payload.text !== 'string'
    || notification.payload.text.includes(`<@${mentions[0]}>`)) return undefined
  let error
  try { error = JSON.parse(failure.stderr)?.error } catch { return undefined }
  const message = `--at-open-dingtalk-ids 中的成员必须在正文中使用对应 <@openDingTalkId> 占位符；缺少: ${mentions[0]}`
  if (error?.category !== 'validation' || error.code !== 3 || error.message !== message
    || Object.keys(error).sort().join(',') !== 'category,code,message') return undefined
  return { kind: 'dws-mention-validation-rejected', notificationId: id, payloadDigest: notification.payloadDigest,
    attempt: 1, fence: permit.fence, category: error.category, code: error.code, errorMessage: message }
}
