import { nativeLifecycle, nativeLifecycleTimeout, nativeTemporaryDirectory as mkdtemp, nativeRemove as rm } from './fixtures/native-lifecycle.js'
import test from 'node:test'
import assert from 'node:assert/strict'

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { available, reason, nativeTaskHost, topicTaskCalls } from './fixtures/routing-official-host.js'
import { createDwsAdapter } from '../packages/dingtalk-core/dws-adapter.js'
import { sendWorkflowNotification } from '../packages/dingtalk-core/group-message.js'

const refusal = { error: { category: 'api', code: 1, origin: 'mcp_gateway', operation: 'chat/get_conversation_info',
  reason: 'topic_quote_guard_unavailable', retryable: true, message: '无法确认引用回复目标是否属于话题圈，已阻止发送' } }

test('a historical frozen start confirmation retires after its real native task completes without re-dispatch', { ...({ timeout: 10000, ...(!available ? { skip: reason } : {}) }), timeout: nativeLifecycleTimeout(10000) }, nativeLifecycle(10000, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notification-terminal-native-'))
  let host, sends = 0, reads = 0
  t.after(async () => { try { await host?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  const adapter = createDwsAdapter({ enabled: true, writesAuthorized: true, runner: { async run() {
    sends++
    return { exitCode: 1, stdout: '', stderr: JSON.stringify(refusal) }
  } } })
  await t.beginBusiness()
  host = await t.step(async () => nativeTaskHost(root, async request => topicTaskCalls(request) ?? [{ name: 'task_result', args: {
    decision: { action: 'complete', summary: '已核验完整资料。', evidence: ['真实任务所有验收条件已满足'], limitations: [] },
  } }], { notifications: { send: notice => notice.payload.replyKind === 'confirmation' ? sendWorkflowNotification(adapter, notice) : {messageId:'final-result'},
    readback: async notice => { if(notice.payload.replyKind === 'confirmation'){reads++;return undefined}return {messageId:'final-result',visible:true} } } }))
  // Frozen historical receipts remain recoverable; no active Topic planner runs.
  const taskId='historical-confirmation-task',decisionId='historical-confirmation-decision',notificationId='historical-confirmation-outbound'
  const message={groupId:'native-group',messageId:'request',senderOpenDingTalkId:'native-user',text:'测试助手，请核验资料并给出结论。',occurredAt:new Date().toISOString()}
  await host.residentStore.ingest(message)
  await host.service.store.command({id:'historical-original',kind:'source.record',args:{sourceId:'historical-original',groupId:message.groupId,messageId:message.messageId,actorId:message.senderOpenDingTalkId,version:1,text:message.text}})
  await host.service.store.command({id:'historical-original-routed',kind:'source.routed',args:{sourceId:'historical-original',receipt:{kind:'historical-frozen'}}})
  await host.service.store.command({id:'historical-task',kind:'task.create',args:{taskId,groupId:message.groupId,ownerActorId:message.senderOpenDingTalkId,sourceRefs:['historical-original'],operationId:decisionId+':action:0',objective:message.text}})
  const payload={conversationId:message.groupId,text:'收到，已交办核查资料。',replyKind:'confirmation',sourceMessageId:message.messageId,actorId:message.senderOpenDingTalkId,atOpenDingTalkIds:[message.senderOpenDingTalkId],topicRefs:[]}
  await host.residentStore.appendOutbox({groupId:message.groupId,outboundId:notificationId,sourceMessageId:message.messageId,decisionId,taskIds:[taskId],replyKind:'confirmation',text:payload.text,replyToMessageId:message.messageId,replyToSenderOpenDingTalkId:message.senderOpenDingTalkId,atOpenDingTalkIds:payload.atOpenDingTalkIds,topicRefs:[]})
  await host.service.store.command({id:'historical-prepared-confirmation',kind:'notification.prepare',args:{notificationId,taskId,requirementRevision:1,kind:'status',payload}})
  await t.step(async () => host.service.recover())
  await t.step(async () => host.service.whenIdle())
  assert.equal((await t.step(async () => host.query('task.list')))[0].status, 'completed')
  await t.step(async () => host.service.recover()); await t.step(async () => host.service.whenIdle())
  const notice = (await t.step(async () => host.query('notification.list'))).find(row => row.payload.replyKind === 'confirmation')
  assert.equal(notice.state, 'failed')
  assert.equal(notice.retirement.reason, 'task-terminal')
  assert.equal(notice.deliveryError.knownNotSent, true)
  assert.equal(notice.deliveryError.retryable, false)
  assert.equal(notice.nextAttemptAt, null)
  assert.equal(sends, 1); assert.equal(reads, 0)
  const tasks = await t.step(async () => host.query('task.list'))
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].status, 'completed', 'retiring an unsent confirmation cannot cancel a valid completion')
  assert.equal(host.toolResults.filter(item => item.name === 'task_result').length, 1, 'recovery cannot re-dispatch the completed task')
}))
