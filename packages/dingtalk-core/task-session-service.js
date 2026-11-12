import {bindTaskMaterialPaths,resolveTaskMaterialPaths} from '../../src/tasks/material-paths.js'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {committedLiveSupplementAdmissions} from '../../src/tasks/input-origin.js'
import {assertPiTaskBackend} from '../../src/runtime/pi-task-backend.js'
import {AsyncLocalStorage} from 'node:async_hooks'
import {agentObservationSchema} from '../../src/runtime/pi-agent-observation.js'
import {TaskArchives} from '../../src/tasks/archive.js'
import {freezeSingleTaskFiles} from '../../src/tasks/delivery.js'
import {createSingleTaskSessions} from '../../src/tasks/single-session.js'
import {createTaskEffectReconciliation,taskEffectReconciliationIdentity,taskEffectActionAuthorizationIdentity,verifyTaskEffectClosures,taskEffectScopeDigest,taskEffectDigest,effectReconciliationAuditKinds} from '../../src/tasks/effect-reconciliation.js'
import {readTaskEffectScope} from '../../src/tasks/effect-scope.js'
import {createObserverAlertPages} from './observer-alert-pages.js'
import {createObserverGroupPages} from './observer-group-pages.js'
import {retiredSourceOwnership} from './coordination-retirement.js'
import { deliverTaskNotification, recallTaskOperatorNotification, retryTaskNotification, taskNotificationRecovery } from './notification-delivery.js'
import { inspectInvestigatedNativeFailure } from './dynamic-operation-readback.js'

import { inspectIsolatedHostRestart } from './dynamic-operation-readback.js'

import { hasRestartIsolation } from './native-restart-isolation.js'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, lstat, link, unlink } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { openDynamicTaskStore, ingressTimestamp, pendingTaskHumanReview, taskHumanWait } from './dynamic-task-store.js'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { readExecutionResourceCatalog, createExecutionResourceCatalog } from './execution-resource-catalog.js'
import { taskSessionModelSelection, taskModelConfig, taskModelSelection } from './task-model-config.js'
import {roleModelSelection} from '../../src/role-models.js'
import { createStartupMetrics, createCloseObservation, observeClose } from './startup-metrics.js'
import { createTaskSessionObservability, createTaskObservationQueue } from './task-session-observability.js'
import { activeFixedUnits, fixedTopicIds, fixedUnitRequestId, platformScheduleSessionId, platformScheduleOutboundId } from './fixed-topics.js'
import {openRouterLifecycle} from '../../src/channels/router-lifecycle.js'
import {createChannelTriage,registerResidentRouterTools,residentOperationId} from '../../src/channels/resident-router-business.js'
import {createPlatformSchedules} from './platform-schedule.js'
import {platformTaskPage} from './fixed-topics.js'
import { resolveTaskArtifactScope } from './task-artifact-scope.js'
import { buildReplyReviewCandidates } from './decision.js'
import { resolveTopicMessages, topicSourceEntries, stableId, fingerprint, replyTopicForMessage, canonicalReplyTopic, topicDecisionCoversEntry } from './topic-model.js'
import { ingestTaskResidentMessage, projectTaskNotification, stableTaskResourceIdentity, mergeTaskResources, taskBoardState, messageProcessingSources } from './task-message-projections.js'
import { taskWorkspace, taskDirectories, taskFilePath, checkedTaskDirectory, taskWorkspaceReady, assertTaskWorkspaceReady, initializeTaskDirectories } from './session-workspaces.js'
import {conversationNotificationRouting,finalConversationNotificationRouting,prepareConversationNotification,notificationAudience,conversationMessageActorId} from './group-notification.js'
import {formatTaskConversationReply} from './group-reply-format.js'
import {assertConversationReply,replyInternalTaskId,conversationQuote} from '../../src/channels/message-safety.js'
import { taskExecutionContext } from './execution-context.js'
import { assertTaskContextSemantics } from './task-input-contract.js'
import { projectTaskTimeline, readTaskLifecycle } from './task-execution-timeline.js'
import { createTaskArtifactFiles } from './task-artifact-files.js'
import { withTaskFileNotifications } from './task-final-delivery.js'
export { taskExecutionContext } from './execution-context.js'

const hash = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex')
const fail = code => { throw Object.assign(new Error(code), { code }) }
const clean = value => JSON.parse(JSON.stringify(value))
const validMaterialFile = file => file && typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 255
  && !file.name.includes(String.fromCharCode(92)) && !/[/\x00-\x1f\x7f]/u.test(file.name) && file.name !== '.' && file.name !== '..'
  && typeof file.mediaType === 'string' && file.mediaType.length <= 128 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(file.mediaType)
const string = { type: 'string' }
const texts = { type: 'array', items: string }
// 后端属于执行身份；缺省的历史执行始终是 DSH，不跟随当前配置迁移。
const executionBackend = execution => execution.definition?.executionBackend ?? 'dsh'
export function executionProgressDue(execution, now = Date.now()) {
  const last = Date.parse(execution.progressReview?.checkedAt ?? execution.updatedAt)
  return execution.status === 'running' && !execution.drained && !execution.recovering && !execution.cancelRequested
    && Number.isFinite(last) && now - last >= 10 * 60 * 1000
}
export const dynamicExecutionOutputSchema = { type: 'object', properties: {
  status: { type: 'string', enum: ['completed','blocked','needs_input'] }, summary: { type: 'string' },
  evidence: texts, limitations: texts, artifacts: texts, question: string,
}, required: ['status','summary','evidence','limitations','artifacts'], additionalProperties: false }
const drainDiagnostic = (error, depth = 0) => ({
  code: String(error?.code ?? 'execution_drain_failed'), message: String(error?.message ?? error).slice(0, 2000),
  ...(typeof error?.phase === 'string' ? { phase: error.phase } : {}),
  ...(error?.cause && depth < 4 ? { cause: drainDiagnostic(error.cause, depth + 1) } : {}),
})
/** All model decisions pass through this Host boundary. No workflow catalog or staged plan exists here. */
export async function openTaskSessionService({ ctx, config, legacy, residentStore, notifications, readMessage, readResource, readMentioned,
  taskSessions: suppliedTaskSessions, executionSessions: rejectedExecutionSessions, claudeExecutionSessions: rejectedClaudeExecutionSessions,
  store: suppliedStore, startupObserver, closeObserver } = {}) {
  const hostAgents=typeof ctx.get==='function'?ctx.get('agents'):ctx.agents
  if(hostAgents?.currentInitiator?.()!==undefined)fail('TASK_SESSION_HOST_CONTEXT_REQUIRED')
  if(!ctx.get?.('officialAgentFactory'))fail('TASK_OFFICIAL_FACTORY_REQUIRED')
  if(rejectedExecutionSessions!==undefined||rejectedClaudeExecutionSessions!==undefined)fail('TASK_SPLIT_EXECUTION_REMOVED')
  // Capture the trusted service startup context. Accepted SQL-backed work must
  // not inherit the initiating model actor's revocable filesystem capability.
  const hostScheduler=AsyncLocalStorage.snapshot()
  const closeTrace = createCloseObservation(closeObserver)
  const startup = createStartupMetrics(startupObserver)
  if (!config?.dbPath || !config?.instanceId) fail('TASK_SESSION_CONFIGURATION_REQUIRED')
  taskSessionModelSelection({}, config.model, config.provider)
  taskModelConfig(config)
  for (const value of [config.maxConcurrentExecutions, config.maxConcurrentTasks, legacy.getAgentConfig().maxConcurrentTasks]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 50)) fail('TASK_SESSION_CONCURRENCY_INVALID')
  }
  assertPiTaskBackend(config)
  const root = resolve(config.workspaceDir ?? residentStore.getTaskWorkspaceDir?.() ?? legacy.getAgentConfig().workspaceDir)
  await mkdir(dirname(config.dbPath), { recursive: true })
  const store = suppliedStore ?? await openDynamicTaskStore({ dbPath: config.dbPath, instanceId: config.instanceId,
    initialize: config.initialize === true, migrate: config.migrate === true, ingressEpoch: config.ingressEpoch, webActorId: config.webActorId, ownerActorId: config.ownerActorId,
    resourceCatalog: await readExecutionResourceCatalog(root), startupObserver })
  try {
    createExecutionResourceCatalog(await store.query({ kind: 'resource.catalog' }))
  } catch (error) {
    if (!suppliedStore) await store.close()
    throw error
  }
  const deliveryFiles = createTaskArtifactFiles({ root: join(root, 'delivery-files'),getTaskDirectories:async taskId=>taskDirectories(root,taskId,{task:await requireTask(taskId)}) })
  const originalNotifications=notifications
  notifications={...notifications,canDisclose:notification=>ctx.get('channels').deliveryEnvelope(notification)?ctx.get('channels').canDeliver(notification):originalNotifications.canDisclose?originalNotifications.canDisclose(notification):true,send:async notification=>{
    // 来源只从 Host 账本取得；不改冻结 payload，也不接受模型提供的公开标记声明。
    const p=notification.payload,source=p.sourceId?await store.query({kind:'source.get',sourceId:p.sourceId}):null,ref=p.sourceRef
    const replySourceText=source&&source.groupId===p.conversationId&&source.version===p.sourceVersion
      &&ref?.messageId===source.messageId&&ref.messageVersion===source.version&&ref.actorId===source.actorId
      &&!source.authorizationRevoked&&!source.triageHold&&!source.archiveRestoreHold?source.text:undefined
    const outgoing={...notification,replySourceText}
    return ctx.get('channels').deliveryEnvelope(outgoing)?ctx.get('channels').transportCall('send',outgoing):originalNotifications.send(outgoing)
  },readback:notification=>ctx.get('channels').deliveryEnvelope(notification)?ctx.get('channels').transportCall('readback',notification):originalNotifications.readback(notification),sendFile:(notification,file)=>ctx.get('channels').deliveryEnvelope(notification)?ctx.get('channels').transportCall('sendFile',notification,file):originalNotifications.sendFile?.(notification,file),readbackFile:notification=>ctx.get('channels').deliveryEnvelope(notification)?ctx.get('channels').transportCall('readbackFile',notification):originalNotifications.readbackFile?.(notification)}
  notifications = withTaskFileNotifications(notifications, deliveryFiles)
  const inflightTasks = new Map(), inflightExecutions = new Map(), inflightGroups = new Map(), inflightNotifications = new Map()
  let nativeDws, residentRouter
  const admissions = new Map(), admissionHolds = new Set(), admissionGroups = new Map(), targetCommands = new Map()
  const sourceProjections = new Set(), notificationSends = new Set(), notificationReadbacks = new Set()
  const failures = new Map(), taskSlots = new Set(), messageRecoveryFlights = new Set()
  const pendingDialogue = task => task.dialogue?.some(item => !item.reply&&!item.replyError)
  const taskLimit = () => legacy.getAgentConfig().maxConcurrentTasks ?? config.maxConcurrentTasks ?? 5
  const reserveTask = taskId => taskSlots.has(taskId) || taskSlots.size < taskLimit() && (taskSlots.add(taskId), true)
  const retryReady = id => {
    // Only the retired execution driver wrote dynamic_operations. Official Single
    // effects use native typed receipts; retained SQL rows never authorize replay.
    if([...operationCache.values()].some(operation=>operation.taskId===id)){
      failures.set(id,{id,code:'TASK_LEGACY_OPERATION_REVIEW_REQUIRED'})
      return false
    }
    const task = taskCache.get(id), recovery = task?.providerRecovery
    if(recovery&&recovery.requirementRevision===task.requirementRevision)return false
    if (recovery) return recovery.requirementRevision !== task.requirementRevision
      || !!recovery.nextAttemptAt && Date.parse(recovery.nextAttemptAt) <= Date.now()
    return (failures.get(id)?.retryAfter ?? 0) <= Date.now()
  }
  let closed = false, closingService, recovering, scheduling, scheduleRequested = false
  let notificationScan, notificationScanRequested = false, notificationTransportRetryAt = 0
  let sourceProcessingRevision = 0
  let observerGroupPage
  const sourceHeldNotifications = new Map()
  const query = (kind, args = {}) => store.query({ kind, ...args })
  if((await query('execution.list')).length)fail('TASK_SPLIT_EXECUTION_DATA_UNSUPPORTED')
  const archives=new TaskArchives({paths:ctx.get('runtimePaths'),store,routes:ctx.get('taskSessionRoutes'),onSuccess:taskId=>failures.delete('task-archive:'+taskId),onFailure:(taskId,error)=>{failures.set('task-archive:'+taskId,{id:taskId,code:error.code??'TASK_ARCHIVE_CAPTURE_FAILED'});ctx.logger?.warn?.('task archive '+taskId+': '+(error.code??'TASK_ARCHIVE_CAPTURE_FAILED'))}})
  const responsibilityFor=conversationId=>ctx.get('channels').responsibility(conversationId)??residentStore.getGroup(conversationId)?.responsibility??''
  const reflection=ctx.get?.('reflection')
  const stopReflection=reflection?.attachStore(store,{ownerActorId:config.ownerActorId,responsibilityFor,onReview:archives?(taskId,report)=>archives.recordReview(taskId,report):undefined,model:{provider:config.provider,model:config.model,...config.reasoningEffort?{reasoningEffort:config.reasoningEffort}:{}}})

  if (residentStore.retireIndependentCoordination)
    await residentStore.retireIndependentCoordination(await query('coordination.retirement'))
  const taskCache = new Map(), operationCache = new Map(), notificationCache = new Map(), executionCache = new Map()

  const refreshTasks = async () => { taskCache.clear(); for (const task of await query('task.list')) taskCache.set(task.taskId, topicTaskView(task)) }
  function topicTaskView(task) { return { ...task, state: task.status === 'completed' ? 'completed' : task.control === 'cancelled' ? 'cancelled' : task.control === 'paused' || task.drained ? 'waiting' : 'running', inputVersion: task.requirementRevision, runSequence: task.runSequence ?? 1, topicRefs: task.topicRefs ?? [], appliedOperations: task.appliedOperations ?? [], acceptanceCriteria: task.requirements ?? [], taskPromptRefs: [] } }
  async function initializeNewTaskWorkspace(task) {
    if(closed&&!admissionHolds.has(task.taskId))fail('TASK_SESSION_CLOSED')
    if(!task.workspaceInitialization)return
    const {creationCommandId,sessionId}=task.workspaceInitialization,binding={taskId:task.taskId,creationCommandId,sessionId}
    const begin=await store.command({id:creationCommandId+':workspace-begin',kind:'task.workspace.begin',args:binding})
    if(begin.replayed)throw Object.assign(new Error('TASK_WORKSPACE_INITIALIZATION_NO_REPLAY'),{code:'TASK_WORKSPACE_INITIALIZATION_NO_REPLAY'})
    let failure,observation
    try {observation=await hostScheduler(()=>initializeTaskDirectories(root,begin.result.task))}catch(error){failure=error}
    // finish 的提交错误不得改写为另一终态；原 initializing 保留为不确定且禁重放。
    try{
      await store.command({id:creationCommandId+':workspace-finish',kind:'task.workspace.finish',args:{...binding,state:failure?'failed':'ready',...(failure?{code:failure.code??'TASK_WORKSPACE_INITIALIZATION_FAILED',...(failure.nativeResources?{nativeResources:failure.nativeResources}:{}),...(failure.api?{nativeFailure:{api:failure.api,win32Code:failure.win32Code}}:{})}:{observation:observation.native})}})
    }catch(commitError){
      const error=new AggregateError([...(failure?[failure]:[]),commitError],'Task workspace initialization finish is uncertain')
      error.code='TASK_WORKSPACE_INITIALIZATION_COMMIT_UNCERTAIN'
      error.nativeResources=failure?.nativeResources??observation?.native?.nativeResources
      throw error
    }
    if(failure)throw failure
  }
  const targetCommandKinds=new Set(['source.record','source.record-direct','source.acceptHistory','task.create','task.reopen','task.revise','task.supplement','task.claim','task.dialogue.add','router.plan','router.task-action','notification.prepare','notification.start'])
  const command = async (kind,args,id) => {
    if(!targetCommandKinds.has(kind))return commitCommand(kind,args,id)
    const groupId=args.groupId??args.conversationId??args.source?.groupId??args.conversation?.conversationId??args.payload?.conversationId??taskCache.get(args.taskId)?.groupId??(args.taskId?(await query('task.get',{taskId:args.taskId}))?.groupId:undefined)??(args.notificationId?(notificationCache.get(args.notificationId)??await query('notification.get',{notificationId:args.notificationId}))?.payload?.conversationId:undefined)
    ctx.get('channels').assertGroupTarget(groupId)
    const flight={};targetCommands.set(flight,groupId)
    try{return await commitCommand(kind,args,id,groupId)}finally{targetCommands.delete(flight)}
  }
  const commitCommand = async (kind, args, id, targetGroup) => {
    if(closed&&(kind==='router.plan'||kind==='task.create'&&!admissionHolds.has(args.taskId)))fail('TASK_SESSION_CLOSED')
    if(kind.startsWith('execution.'))fail('TASK_SPLIT_EXECUTION_REMOVED')
    let clarification = kind === 'notification.prepare' && args.kind === 'routing-clarification' ? args.payload : undefined
    if (kind === 'notification.start') {
      const notification = notificationCache.get(args.notificationId) ?? await query('notification.get', { notificationId: args.notificationId })
      if (notification?.kind === 'routing-clarification') clarification = notification.payload
    }
    const settledEvents=kind==='router.settle'?(await query('router.inbox',{conversationId:args.conversationId,limit:30})).filter(event=>args.eventIds.includes(event.id)||args.eventIds.includes(event.eventId)):[]
    const commandId=id??`${kind}:${randomUUID()}`
    const commit = () => {if(targetCommandKinds.has(kind))ctx.get('channels').assertGroupTarget(targetGroup);return store.command({ id:commandId, kind, args: clean(args) })}
    // 发送许可与待判版本在同一群锁内线性化；缓存/出箱投影必须留在锁外。
    let receipt
    if (clarification) {
      const p = clarification, fact = p.fact
      receipt = await residentStore.withRoutingHold({ groupId: p.conversationId, messageId: p.sourceMessageId,
        messageVersion: p.sourceVersion, epoch: residentStore.getGroup(p.conversationId)?.messages.find(message => message.messageId === p.sourceMessageId)?.routingHold?.epoch, commit: () => {
          assertRoutingClarification(p, args.notificationId)
          if (kind === 'notification.start') args = { ...args, routingHold: { messageVersion: fact.messageVersion, epoch: fact.epoch, reviewFingerprint: fact.reviewFingerprint } }
          return commit()
        } }).catch(error => {
          if (kind === 'notification.start' && ['topic_routing_hold_stale', 'routing_clarification_stale'].includes(error.code ?? error.message))
            throw Object.assign(error, { code: 'DYNAMIC_NOTIFICATION_SOURCE_PENDING' })
          throw error
        })
    } else receipt = await commit()
    const creating=kind==='task.create'||kind==='router.plan',workspaceFailures=[]
    const createdTasks=creating?(receipt.result?.tasks??(receipt.result?.task?[receipt.result.task]:[])):[]
    if(creating){
      for(const created of createdTasks){
        const creationId=kind==='router.plan'?commandId+':'+created.taskId:commandId
        // Router action 幂等可由新 commandId 返回旧结果；不能仅看外层 replayed。
        if(!receipt.replayed&&created.workspaceInitialization?.creationCommandId===creationId)try{
          if(kind==='router.plan')await admitTask(created.taskId,()=>initializeNewTaskWorkspace(created))
          else await initializeNewTaskWorkspace(created)
        }catch(error){
          const diagnostic={id:created.taskId,code:error.code??'TASK_WORKSPACE_INITIALIZATION_FAILED',...(error.nativeResources?{nativeResources:error.nativeResources}:{}),...(error.api?{nativeFailure:{api:error.api,win32Code:error.win32Code}}:{})}
          Object.defineProperty(diagnostic,'cause',{value:error})
          failures.set('task-workspace:'+created.taskId,diagnostic)
        }
        const current=await query('task.get',{taskId:created.taskId})
        if(!taskWorkspaceReady(current))workspaceFailures.push({taskId:current.taskId,...current.workspaceInitialization})
        else failures.delete('task-workspace:'+current.taskId)
      }
      // 仅更新本次返回投影，不回写已提交的创建收据快照。
      receipt={...receipt,result:{...receipt.result,...(receipt.result?.task?{task:await query('task.get',{taskId:receipt.result.task.taskId})}:{}),
        ...(receipt.result?.tasks?{tasks:await Promise.all(receipt.result.tasks.map(task=>query('task.get',{taskId:task.taskId})))}:{})}}
    }
    const archiveTaskIds=new Set([...(receipt.result?.tasks??[]).map(task=>task.taskId),receipt.result?.task?.taskId??receipt.result?.operation?.taskId??receipt.result?.notification?.taskId??args.binding?.taskId??args.taskId].filter(Boolean))
    if(archives)for(const taskId of archiveTaskIds){
      const current=await query('task.get',{taskId})
      if(!current||!taskWorkspaceReady(current))continue
      try{await archives.register(current);archives.schedule(taskId)}catch(error){archives.errors.set(taskId,error.code??'TASK_ARCHIVE_NOT_READY');archives.onFailure(taskId,error);receipt.archiveMaintenance={pending:true,taskId,code:error.code??'TASK_ARCHIVE_NOT_READY'}}
    }
    if(receipt.completionEvent)ctx.get?.('reflection')?.scan()
    observerGroupPage?.sourceChanged(receipt.result?.source ?? args.source)
    for(const row of receipt.result?.dispositions??[]){const source=await query('source.get',{sourceId:row.sourceId});observerGroupPage?.sourceChanged(source)}
    for(const event of settledEvents)if(event.source)observerGroupPage?.sourceChanged(event.source)
    // 幂等收据保存的是当时快照；通知当前态须独立回读，不能用旧 prepared 覆盖已送达缓存。
    if (receipt.replayed && receipt.result?.notification)
      receipt.result.notification = await query('notification.get', { notificationId: receipt.result.notification.id })
    if (receipt.result?.execution) executionCache.set(receipt.result.execution.executionId,
      await query('execution.get', { executionId: receipt.result.execution.executionId }))

    if (receipt.result?.operation) operationCache.set(receipt.result.operation.id ?? receipt.result.operation.operationId, receipt.result.operation)
    // 人工结清是复合事务，只返回任务；从账本刷新其中已结清的操作，避免残留 unknown 告警。
    if (kind === 'task.human.resolve-failures') for (const resolution of args.resolutions) {
      const operation = await query('operation.get', { operationId: resolution.operationId })
      operationCache.set(operation.id ?? operation.operationId, operation)
    }
    if (receipt.result?.notification) {
      const previous=notificationCache.get(receipt.result.notification.id), notification=receipt.result.notification
      notificationCache.set(notification.id,notification)
      nativeDws?.notificationChanged(notification)
      if(observerGroupPage)for(const item of [previous,notification].filter(Boolean))
        for(const value of [item.receipt,item.ack])observerGroupPage.sourceChanged({groupId:item.payload?.conversationId,messageId:receiptMessageId(value)})
    }
    if (receipt.result?.notification) await projectTaskNotification({ residentStore, notification: receipt.result.notification })
    if (receipt.result?.task) taskCache.set(receipt.result.task.taskId, topicTaskView(receipt.replayed?await query('task.get',{taskId:receipt.result.task.taskId}):receipt.result.task))
    for(const task of receipt.result?.tasks??[])taskCache.set(task.taskId,topicTaskView(receipt.replayed?await query('task.get',{taskId:task.taskId}):task))
    for(const notification of receipt.result?.notifications??[]){notificationCache.set(notification.id,notification);await projectTaskNotification({residentStore,notification})}
    if(residentRouter&&receipt.result?.task?.conversationId)void hostScheduler(()=>residentRouter.schedule(receipt.result.task.conversationId)).catch(error=>recordRouterFailure(receipt.result.task.conversationId,error))
    for (const fact of receipt.topicFacts ?? receipt.result?.topicFacts ?? []) {
      if (fact.state === 'unbound') failures.set(`topic-fact:${fact.id}`, { id: fact.taskId, code: 'TOPIC_FACT_REPLY_BINDING_MISSING' })
      else if (fact.state === 'pending' && !closed) void kickGroup(fact.groupId, true).catch(error => {
        failures.set(`topic-fact:${fact.id}`, { id: fact.taskId, code: error.code ?? error.message })
      })
    }
    // 原效果终态可能晚于会话退出；释放后直接提升持久队列，不等待恢复定时器。
    if(kind==='router.evaluate'&&receipt.result?.dependency?.state==='satisfied')void hostScheduler(()=>schedulePending())
    if (['execution.drained', 'execution.cancel', 'task.control', 'task.revise', 'task.reopen'].includes(kind)
      || kind.startsWith('operation.') && ['succeeded', 'failed', 'cancelled'].includes(receipt.result?.operation?.state)) void schedulePending()
    // 持久通知已可发送，无需等待协调规划、其他群恢复或下个轮询周期。
    if (kind === 'source.processingCompleted' && !receipt.replayed) sourceProcessingRevision++
    if (!closed && (receipt.result?.notification?.state === 'prepared'
      || kind === 'source.processingCompleted' && !receipt.replayed)) void deliverNotifications().catch(error => {
      ctx.logger?.warn?.(`notification scan: ${error.code ?? error.message}`)
    })
    if(workspaceFailures.length){
      void hostScheduler(()=>schedulePending())
      throw Object.assign(new Error('TASK_WORKSPACE_NOT_READY'),{code:'TASK_WORKSPACE_NOT_READY',committed:true,tasks:workspaceFailures})
    }
    return receipt
  }
  await startup.measure('task-service.cache', async () => {
    await refreshTasks()
    await disableSingleProviderRetries()
    for (const item of await query('operation.list')) operationCache.set(item.id ?? item.operationId, item)
    for (const item of await query('notification.list')) notificationCache.set(item.id, item)
    for (const item of await query('execution.list')) executionCache.set(item.executionId, item)
  })
  async function disableSingleProviderRetries(){

    for(const task of await query('task.list'))if(task.providerRecovery&&!task.archivedAt&&task.status==='active'&&!task.effectReconciliations?.some(row=>row.state==='prepared')&&!ctx.agents.get(task.sessionId)&&!inflightTasks.has(task.taskId)){
      if(!task.providerRecovery.hostRetryDisabled)await command('task.provider-retry-disabled',{taskId:task.taskId},'pi-disable-host-retry:'+hash([task.taskId,task.providerRecovery]))
      failures.set(task.taskId,{id:task.taskId,code:'TASK_PI_HOST_RETRY_DISABLED'})
    }
  }
  const dwsObserverOptions={ operations: operationCache, residentStore, notificationCache,
    querySendStatus: notifications?.querySendStatus, warn: error => ctx.logger?.warn?.(`channel receipt: ${error.code ?? error.message}`) }
  nativeDws=ctx.get('channels').createOperationObserver(dwsObserverOptions)
  await nativeDws.recover()
  // Prior Night business failures remain visible; a code change never authorizes another model run.
  const recoveryCandidates = [...taskCache.values()].filter(task => !task.archivedAt && task.status === 'active' && task.control === 'active'
    && task.drained && !task.lastDecision?.question && (task.lastDecision?.action === 'blocked'
      && task.lastDecision.limitations?.includes('TASK_SESSION_NO_SUBMISSION')
      || task.lastDecision?.action === 'wait'
      && [...operationCache.values()].some(operation => operation.taskId === task.taskId && operation.state === 'unknown')))
  const receiptMessageId = value => value?.messageId ?? value?.messageRef?.openMessageId ?? value?.sendReceipt?.messageId ?? value?.result?.messageId ?? value?.result?.openMessageId
  const isOwnNotification = message => {
    if (!message.messageId) return false
    // Account, the generic DWS flag, quote and body do not identify this plugin's send.
    // Reuse both durable outbound projections and current exact send acknowledgements.
    if (residentStore?.getGroup(message.groupId)?.outbox.some(item => item.deliveredMessageId === message.messageId)) return true
    return [...notificationCache.values()].some(item => item.payload?.conversationId === message.groupId
      && [receiptMessageId(item.receipt), receiptMessageId(item.ack)].includes(message.messageId))
  }
  async function ownNotificationAtIngress(message) {
    if (closed) fail('TASK_SESSION_CLOSED')
    if (isOwnNotification(message)) return true
    try { await nativeDws.beforeIngress(message.groupId) }
    catch (error) {
      if (error.code !== 'CHANNEL_NOTIFICATION_IDENTITY_PENDING' || !isOwnNotification(message)) throw error
    }
    if (closed) fail('TASK_SESSION_CLOSED')
    return isOwnNotification(message)
  }
  const observation = createTaskSessionObservability({ store: residentStore, listTasks: () => [...taskCache.values()], resolveSessionIdentity: sessionId => {
    const task = [...taskCache.values()].find(item => item.sessionId === sessionId && item.sessionBound)
    if (task) return { taskId: task.taskId, groupId: task.groupId, role: 'owner' }
    const execution = [...executionCache.values()].find(item => item.sessionId === sessionId && item.sessionBound)
    if (execution) return { taskId: execution.taskId, groupId: taskCache.get(execution.taskId)?.groupId, role: 'execution' }
    return null
  } })
  const observationQueue = createTaskObservationQueue({
    observe: (record,identity) => observation.observeNative(record,identity),
    onError: error => failures.set('observability', { id: 'observability', code: error.code ?? 'AGENT_OBSERVATION_FAILED' }),
    ...(closeTrace ? { onProgress: queued => closeTrace.sample('service.observation-progress', () => ({ queued })) } : {}),
  })
  const phaseIdentityReads=new WeakMap()
  const stopObservation = ctx.on?.('night/agent-observation', async (actor, record) => {
    if(!record||record.ownerId!==actor?.id||actor.metadata?.id!==actor.id||!Object.isFrozen(actor.metadata)||ctx.get('agents')?.get(record.ownerId)!==actor)return
    try{
      // 在可信实时 actor 仍存在时捕获身份；排队写入不得依赖 dispose 后的查找。
      let identity=['channel-triage','conversation-router'].includes(actor.metadata.runtimeOwner)?{runtimeOwner:actor.metadata.runtimeOwner,groupId:actor.metadata.conversationId,...Number.isInteger(actor.metadata.generation)&&actor.metadata.generation>0?{generation:actor.metadata.generation}:{}}:undefined
      // Startup precedes task.sessionBound. Capture only the current ledger
      // session plus its committed task identity; never infer from a path/name.
      if(!identity&&record.kind==='phase-completed'){
        const task=[...taskCache.values()].find(item=>item.sessionId===actor.id)
        if(task){
          let proof=phaseIdentityReads.get(actor)
          if(!proof){proof=Promise.resolve(actor.receipts?.read()).then(rows=>rows?.some(row=>row.domain==='task'&&row.kind==='identity'&&row.payload?.taskId===task.taskId&&row.payload?.sessionId===actor.id));phaseIdentityReads.set(actor,proof)}
          if(await proof)identity={taskId:task.taskId,groupId:task.groupId,role:'execution'}
        }
      }
      observationQueue.enqueue(agentObservationSchema.parse(record),identity)
    }
    catch(error){failures.set('observability',{id:'observability',code:error.code??'AGENT_OBSERVATION_INVALID'})}
  })
  residentStore?.setTaskSessionReader?.({ getTask: id => taskCache.get(id), listTasks: () => [...taskCache.values()],
    hasAppliedOperation: async operationId => !!await query('receipt.get', { id: `topic-operation:${operationId}` }),
    isTaskQuiescent: taskId => [...executionCache.values()].filter(item => item.taskId === taskId).every(item => item.drained && !item.recovering) })
  const models = () => { const { provider, model, reasoningEffort } = legacy.getAgentConfig(); return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) } }
  const roleModels = role => roleModelSelection(ctx,role,role==='task'?taskModelSelection(models(),legacy.getAgentConfig().taskSessionModel??config):models())
  const currentTask = async (binding,{allowLiveSupplements=false}={}) => {
    const task = await query('task.get', { taskId: binding.taskId })
    return !!task && !task.archivedAt && !task.recovering && !task.drained && task.status === 'active' && task.control === 'active' && task.sessionId === binding.sessionId
      && task.leaseEpoch === binding.leaseEpoch && task.requirementRevision === binding.requirementRevision && task.controlRevision === binding.controlRevision
      && ((task.contextRevision ?? 0) === (binding.contextRevision ?? 0)||allowLiveSupplements&&(()=>{let revision=binding.contextRevision??0;for(const row of task.liveSupplements??[])if(row.leaseEpoch===binding.leaseEpoch&&row.requirementRevision===binding.requirementRevision&&row.controlRevision===binding.controlRevision&&row.fromContextRevision===revision)revision=row.contextRevision;return revision===(task.contextRevision??0)})())
  }
  const taskSessions = suppliedTaskSessions ?? createSingleTaskSessions({ ctx, isCurrent: currentTask, isOwnerCurrent:binding=>currentTask(binding,{allowLiveSupplements:true}),
    readEffectScope:async(binding,stored)=>readTaskEffectScope(ctx,await query('task.get',{taskId:binding.taskId}),stored),
    getWorkspaceDir: async ({ binding }) => {const task=await requireTask(binding.taskId);assertTaskWorkspaceReady(task);if(archives)await archives.register(task);return taskWorkspace(root,binding.taskId,task)} })
  const effectReconciliation=config.webActorId?createTaskEffectReconciliation({persistence:ctx.sessionPersistence,readTask:taskId=>query('task.get',{taskId}),readScope:(task,stored)=>readTaskEffectScope(ctx,task,stored),isSessionLive:async sessionId=>!!ctx.agents.get(sessionId),readOperatorSource:sourceId=>query('source.get',{sourceId}),operatorActorId:config.webActorId}):undefined
  async function projectEffectReconciliation(task,row,writerHeld=false,preserveControl=false){
    if(!writerHeld){
      if(ctx.agents.get(task.sessionId)||inflightTasks.has(task.taskId))fail('TASK_EFFECT_OWNER_LIVE')
      const writer=await ctx.sessionPersistence.openNative(task.sessionId,{auditKinds:effectReconciliationAuditKinds})
      try{return await projectEffectReconciliation(task,row,true,preserveControl)}finally{await writer.close()}
    }
    const stored=await ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
    const matches=stored.auditEntries.filter(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-reconciled'&&entry.data.payload.requestId===row.requestId)
    if(!matches.length)return false
    if(matches.length!==1||taskEffectDigest(matches[0].data)!==row.receiptDigest)fail('TASK_EFFECT_RECONCILIATION_JOURNAL_CONFLICT')
    await command('task.effect-reconciliation.commit',{taskId:task.taskId,requestId:row.requestId,receiptDigest:row.receiptDigest,entryId:matches[0].entryId,...preserveControl?{preserveControl:true}:{}},'effect-reconciliation-commit:'+hash([task.taskId,row.requestId]))
    failures.delete(task.taskId);return true
  }
  async function reconcileTaskEffect({operatorText,...proposal}){
    if(hostAgents?.currentInitiator?.()!==undefined)fail('TASK_SESSION_HOST_CONTEXT_REQUIRED')
  if(!ctx.get?.('officialAgentFactory'))fail('TASK_OFFICIAL_FACTORY_REQUIRED')
  if(rejectedExecutionSessions!==undefined||rejectedClaudeExecutionSessions!==undefined)fail('TASK_SPLIT_EXECUTION_REMOVED')
    if(!effectReconciliation)fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
    if(typeof operatorText!=='string'||!operatorText.trim()||operatorText.length>16000)fail('DYNAMIC_ARGUMENT_INVALID')
    const identity=taskEffectReconciliationIdentity(proposal),taskId=identity.taskId
    return admitTask(taskId,async(oldTask)=>{
      if(oldTask)await oldTask
      let task=await requireTask(taskId)
      if(inflightTasks.has(taskId)||ctx.agents.get(task.sessionId))fail('TASK_EFFECT_OWNER_LIVE')
      const previous=task.effectReconciliations?.find(row=>row.requestId===identity.requestId)
      const sourceId='effect-operator:'+hash([taskId,identity.requestId])
      const existingSource=await query('source.get',{sourceId})
      if(existingSource&&(existingSource.text!==operatorText||hash(existingSource.requestIdentity?.effectReconciliation)!==hash(identity)))fail('DYNAMIC_COMMAND_ID_CONFLICT')
      if(previous){
        const source=await query('source.get',{sourceId})
        if(source?.text!==operatorText||hash(source.requestIdentity?.effectReconciliation)!==hash(identity))fail('DYNAMIC_COMMAND_ID_CONFLICT')
        if(previous.state==='committed')return {taskId,state:'committed',entryId:previous.entryId,outcome:previous.receipt.payload.outcome,noReplay:true}
        if(await projectEffectReconciliation(task,previous)){const updated=await requireTask(taskId),row=updated.effectReconciliations.find(row=>row.requestId===identity.requestId);return {taskId,state:row.state,entryId:row.entryId,outcome:row.receipt.payload.outcome,noReplay:true}}
      }
      // The native writer is held continuously across evidence validation, SQL
      // prepare, journal commit and SQL projection. It never opens an actor.
      const writer=await ctx.sessionPersistence.openNative(task.sessionId,{auditKinds:{...effectReconciliationAuditKinds}})
      try{
        if(!existingSource)await command('source.record',{sourceId,groupId:task.groupId??'task:'+taskId,messageId:sourceId,actorId:config.webActorId,channel:'web',text:operatorText,timestamp:new Date().toISOString(),requestIdentity:{effectReconciliation:identity}},'source:'+sourceId)
        const receipt=await effectReconciliation.prepare({...identity,operatorSourceId:sourceId})
        const prepared=await command('task.effect-reconciliation.prepare',{taskId,receipt},'effect-reconciliation-prepare:'+hash([taskId,identity.requestId]))
        if(prepared.result.reconciliation.receiptDigest!==taskEffectDigest(receipt))fail('DYNAMIC_COMMAND_ID_CONFLICT')
        writer.appendAudit(receipt);await writer.commit()
        // A failure here leaves the SQL prepared hold intact. Restart only
        // verifies the exact committed receipt and completes this projection.
        await projectEffectReconciliation(task,prepared.result.reconciliation,true)
      }finally{await writer.close()}
      task=await requireTask(taskId);const row=task.effectReconciliations.find(row=>row.requestId===identity.requestId)
      return {taskId,state:row.state,entryId:row.entryId,outcome:row.receipt.payload.outcome,noReplay:true}
    })
  }
  async function authorizeTaskEffectAction({operatorText,...proposal}) {
    if(hostAgents?.currentInitiator?.()!==undefined)fail('TASK_SESSION_HOST_CONTEXT_REQUIRED')
  if(!ctx.get?.('officialAgentFactory'))fail('TASK_OFFICIAL_FACTORY_REQUIRED')
  if(rejectedExecutionSessions!==undefined||rejectedClaudeExecutionSessions!==undefined)fail('TASK_SPLIT_EXECUTION_REMOVED')
    if(!effectReconciliation)fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
    if(typeof operatorText!=='string'||!operatorText.trim()||operatorText.length>16000)fail('DYNAMIC_ARGUMENT_INVALID')
    const identity=taskEffectActionAuthorizationIdentity(proposal),{taskId,requestId}=identity
    return admitTask(taskId,async()=>{
      let task=await requireTask(taskId)
      const key=hash([taskId,requestId]),sourceId='effect-action:'+key,pauseId='effect-action-pause:'+key,reviseId='effect-action-revise:'+key,activateId='effect-action-activate:'+key
      const source=await query('source.get',{sourceId})
      if(source&&(source.actorId!==config.webActorId||source.channel!=='web'||source.groupId!==(task.groupId??'task:'+taskId)||source.text!==operatorText||hash(source.requestIdentity?.effectAuthorization)!==hash(identity)))fail('DYNAMIC_COMMAND_ID_CONFLICT')
      const activated=await query('receipt.get',{id:activateId})
      if(activated){if(!source)fail('TASK_EFFECT_OPERATOR_SOURCE_REQUIRED');return {taskId,sourceId,state:'authorized',requirementRevision:activated.result.task.requirementRevision,controlRevision:activated.result.task.controlRevision,noReplay:true}}
      if(inflightTasks.has(taskId)||ctx.agents.get(task.sessionId))fail('TASK_EFFECT_OWNER_LIVE')
      if(!task.drained||task.recovering||task.archivedAt||task.status!=='active'||!['active','paused'].includes(task.control))fail('TASK_EFFECT_TASK_NOT_QUIESCENT')
      const pauseArgs={taskId,control:'paused',expectedControlRevision:identity.expectedControlRevision,reason:'effect-action:'+hash([identity,operatorText])}
      const paused=await query('receipt.get',{id:pauseId})
      // 暂停收据绑定完整提案和说明摘要；中断重试不能更换授权内容。
      if(paused)await command('task.control',pauseArgs,pauseId)
      let expectedControlRevision=identity.expectedControlRevision+(paused?1:0)
      if(paused&&task.control!=='paused')fail('TASK_EFFECT_AUTHORIZATION_STALE')
      const revised=await query('receipt.get',{id:reviseId})
      if(revised){
        if(!source||task.requirementRevision!==identity.expectedRequirementRevision+1||task.controlRevision!==expectedControlRevision||task.objective!==identity.objective||!task.sourceRefs.includes(sourceId))fail('TASK_EFFECT_AUTHORIZATION_STALE')
      }else if(task.requirementRevision!==identity.expectedRequirementRevision||task.controlRevision!==expectedControlRevision)fail('TASK_EFFECT_AUTHORIZATION_STALE')
      const writer=await ctx.sessionPersistence.openNative(task.sessionId,{auditKinds:effectReconciliationAuditKinds})
      try {
        const stored=await ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
        const closures=await verifyTaskEffectClosures({task,stored,closedIntentEntryIds:identity.closedIntentEntryIds})
        const scopeDigest=taskEffectScopeDigest(await readTaskEffectScope(ctx,task,stored))
        if(closures.some(row=>row.receipt.payload.scopeDigest!==scopeDigest))fail('TASK_EFFECT_SCOPE_MISMATCH')
        if(closures.some(row=>identity.expectedRequirementRevision+1<=row.receipt.payload.currentBinding.requirementRevision))fail('TASK_EFFECT_AUTHORIZATION_STALE')
        if(task.control==='active'){
          const held=await command('task.control',pauseArgs,pauseId)
          expectedControlRevision=held.result.task.controlRevision
        }
        if(!source)await command('source.record',{sourceId,groupId:task.groupId??'task:'+taskId,messageId:sourceId,actorId:config.webActorId,channel:'web',text:operatorText,timestamp:new Date().toISOString(),requestIdentity:{effectAuthorization:identity}},'source:'+sourceId)
        if(!revised)await command('task.revise',{taskId,expectedRequirementRevision:identity.expectedRequirementRevision,expectedControlRevision,request:identity.objective,objective:identity.objective,sourceRefs:[...new Set([...task.sourceRefs,sourceId])]},reviseId)
        task=await requireTask(taskId)
        if(task.control!=='paused'||task.requirementRevision!==identity.expectedRequirementRevision+1||task.controlRevision!==expectedControlRevision)fail('TASK_EFFECT_AUTHORIZATION_STALE')
        await command('task.control',{taskId,control:'active',expectedControlRevision},activateId)
      }finally{await writer.close()}
      const activatedReceipt=await query('receipt.get',{id:activateId})
      return {taskId,sourceId,state:'authorized',requirementRevision:activatedReceipt.result.task.requirementRevision,controlRevision:activatedReceipt.result.task.controlRevision,noReplay:true}
    })
  }

  const track = (map, id, action) => {
    if (map.has(id)) return map.get(id)
    const previousFailure = failures.get(id)
    const promise = hostScheduler(()=>Promise.resolve().then(action).then(async value => {
      const settled = map !== inflightTasks || (await query('task.get', { taskId: id }))?.drained
      if (settled && failures.get(id) === previousFailure) failures.delete(id)
      return value
    }).catch(error => {
      const recovery = taskCache.get(id)?.providerRecovery
      failures.set(id, { id, code: error.code ?? error.message, at: new Date().toISOString(),
        ...(recovery ? { retryAfter: recovery.nextAttemptAt ? Date.parse(recovery.nextAttemptAt) : null, suspended: recovery.suspended }
          : { retryAfter: Date.now() + Math.max(100, config.retryIntervalMs ?? 5000) }) })
      ctx.logger?.warn?.(`task-session ${id}: ${error.code ?? error.message}`)
      throw error
    }).finally(async () => {
      let again = false
      if (!closed && map === inflightTasks) {
        const pending = await query('wake.list', { taskId: id }).catch(() => [])
        const task = await query('task.get', { taskId: id }).catch(() => null)
        again = !task?.archivedAt && task?.status === 'active' && task.control === 'active' && task.drained
          && taskWorkspaceReady(task) && retryReady(id)
          && (pendingDialogue(task) || pendingTaskHumanReview(task, pending) || !taskHumanWait(task))
          && pending.some(item => item.state !== 'acked')
      }
      // Keep the tracked promise visible through asynchronous slot cleanup.
      // whenIdle must not return while a drained turn can still promote work.
      if (!closed && (map === inflightTasks || map === inflightExecutions)) {
        const taskId = map === inflightTasks ? id : (await query('execution.get', { executionId: id }).catch(() => null))?.taskId
        if (taskId && (map === inflightTasks || !inflightTasks.has(taskId))) {
          const task = await query('task.get', { taskId }).catch(() => null)
          const executions = await query('execution.list', { taskId }).catch(() => [])
          if (!task || task.drained && !executions.some(item => !item.drained || item.status === 'queued' && !item.providerRecovery?.nextAttemptAt && item.resources?.state !== 'waiting')) taskSlots.delete(taskId)
        }
      }
      map.delete(id)
      if (again) void kickTask(id)
      if (!closed && (map === inflightTasks || map === inflightExecutions)) void schedulePending()
    }))
    map.set(id, promise)
    promise.catch(() => {})
    return promise
  }

  function schedulePending() {
    if (closed) return Promise.resolve()
    scheduleRequested = true
    if (scheduling) return scheduling
    scheduling = (async () => {
      while (scheduleRequested && !closed) {
        scheduleRequested = false

        // SQLite is the durable queue. A freed slot promotes existing work immediately,
        // without depending on a periodic recovery tick or manufacturing another wake.
        for (const task of await query('task.list')) {
          if(!taskWorkspaceReady(task)||task.effectReconciliations?.some(row=>row.state==='prepared'))continue
          if (closed) return
          if (task.dependenciesReady===false || task.archivedAt || !retryReady(task.taskId) || inflightTasks.has(task.taskId) || !task.drained || task.recovering || task.status !== 'active' || task.control !== 'active') continue
          const pending = await query('wake.list', { taskId: task.taskId })
          if (!pendingDialogue(task) && !pendingTaskHumanReview(task, pending) && taskHumanWait(task)) continue
          if (!taskSlots.has(task.taskId) && taskSlots.size >= taskLimit()) continue
          if (pending.some(item => item.state !== 'acked')) void kickTask(task.taskId)
        }

      }
    })().catch(error => { failures.set('scheduler', { id: 'scheduler', code: error.code ?? error.message }) })
      .finally(() => { scheduling = undefined })
    return scheduling
  }
  async function attachWorkspace(sessionId, cwd, title) {
    const registry = ctx.get?.('workspaceRegistry') ?? ctx.workspaceRegistry
    if (!registry) { if (!suppliedTaskSessions) fail('TASK_WORKSPACE_REGISTRY_REQUIRED'); return }
    await registry.sessionKnown(sessionId)
    const workspace = await registry.resolveByPath(cwd) ?? await registry.create(cwd, title)
    // A registry initialized before task-specific persistence may have retained the
    // durable slot without its header index. Rebind that same slot via public APIs.
    if (!workspace.sessionIds.includes(sessionId)) await workspace.detachSession(sessionId)
    await workspace.attachSession(sessionId)
    if (title?.trim() && workspace.title !== title.trim()) await workspace.setTitle(title.trim())
  }
  const sourceFor = async task => {
    const id = task.metadata?.authorizationSourceId
    if (id) return query('source.get', { sourceId: id })
    const sources = await Promise.all(task.sourceRefs.map(sourceId => query('source.get', { sourceId })))
    return sources.find(source => source?.actorId === task.ownerActorId)
  }
  function bindingsForSources(sources) {
    const bindings = new Map()
    for (const source of sources) {
      if (source.channel === 'web' || source.channel === 'internal') continue
      const group = residentStore.getGroup(source.groupId)
      const current = group?.messages.find(item => item.messageId === source.messageId)
      const message = current?.messageVersion === source.version ? current : current?.facts?.find(item => item.messageVersion === source.version)
      const topicId = message && replyTopicForMessage(group, message)
      if (!topicId) continue
      const key = JSON.stringify([source.groupId, topicId])
      const entry = bindings.get(key) ?? { groupId: source.groupId, topicId, sourceIds: [] }
      entry.sourceIds.push(source.sourceId); bindings.set(key, entry)
    }
    return [...bindings.values()]
  }
  async function taskReplyBindings(task) {
    if(task.conversationId)return []
    if (task.replyBindings?.length) return task.replyBindings.flatMap(binding => {
      const topicId = canonicalReplyTopic(residentStore.getGroup(binding.groupId), binding.topicId)
      return topicId ? [{ ...binding, topicId }] : []
    })
    // Historical fallback is the recorded authorization source, not all topicRefs.
    const source = await sourceFor(task)
    return source ? bindingsForSources([source]) : []
  }
  const requireTask = async taskId => (await query('task.get', { taskId })) ?? fail('TASK_SESSION_NOT_FOUND')
  const taskTopicRefs = (task, titles = new Map()) => (task.topicRefs ?? []).map(ref => {
    const groupId = ref.groupId || task.sourceGroupId || task.groupId
    const key = JSON.stringify([groupId, ref.topicId])
    // The resident already owns these topics; project only names for the selected task page.
    if (!titles.has(key)) titles.set(key, residentStore.getTopic(groupId, ref.topicId)?.title)
    return { ...ref, title: titles.get(key) || ref.title || null }
  })
  const taskDTO = async task => {
    const { dialogue: _dialogue, ...publicTask } = task
    const executions = await query('execution.list', { taskId: task.taskId })
    const pendingWake = !task.lastDecision && (await query('wake.list', { taskId: task.taskId })).some(wake => wake.state !== 'acked')
    const state = taskBoardState(task, executions, pendingWake)
    return {...publicTask,state,topicRefs:taskTopicRefs(task),executionCount:1,controlState:task.control,inputVersion:task.requirementRevision,result:task.completion?.result??task.lastDecision??null,session:{role:'execution',sessionId:task.sessionId,sessionBound:task.sessionBound,status:task.drained?'idle':'running',workspaceDir:taskWorkspaceReady(task)?await taskWorkspace(root,task.taskId,task):null,logPath:ctx.sessionPersistence.path(task.sessionId)}}

  }
  async function taskDetail(taskId) {
    const task = await query('task.get', { taskId })
    if (!task) return null
    const wakes = await query('wake.list', { taskId })
    const lifecycle = await readTaskLifecycle(task, wakes, id => query('receipt.get', { id }))
    return { ...await taskDTO(task), executions: (await taskExecutions(taskId)).executions,
      timeline: projectTaskTimeline(task, await query('execution.list', { taskId }), wakes, lifecycle),
      blockers: await query('task.blockers', { taskId }), notifications: await query('notification.list', { taskId }),
      }
  }
  async function taskExecutions(taskId, { offset = 0, limit = 50, revision, summary = false } = {}) {
    const page=await query('observer.page',{collection:'executions',taskId,offset,limit,revision,summary})
    if(page.items.length)fail('TASK_SPLIT_EXECUTION_DATA_UNSUPPORTED')
    return {...page,items:undefined,executions:[]}
  }
  async function materializeSource(taskId, source) {
    const directories = await taskDirectories(root, taskId, {task:await requireTask(taskId)})
    const target = join(directories.materials, `source-${hash(source.sourceId).slice(0, 32)}.json`)
    const readSnapshot = async () => {
      await checkedTaskDirectory(directories.materials)
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink()) fail('TASK_MATERIAL_PATH_INVALID')
      let material
      try { material = JSON.parse(await readFile(target, 'utf8')) } catch { fail('TASK_MATERIAL_SNAPSHOT_INVALID') }
      material = resolveTaskMaterialPaths(material, directories.materials, target)
      if (!material || material.sourceId !== source.sourceId || material.path !== target || material.taskId !== undefined && material.taskId !== taskId
        || material.version !== undefined && material.version !== source.version || material.actorId !== source.actorId || material.messageId !== source.messageId || material.text !== source.text
        || hash(material.quote ?? null) !== hash(source.quote ?? null) || !Array.isArray(material.resources)
        || material.resources.length !== (source.resources ?? []).length) fail('TASK_MATERIAL_SOURCE_MISMATCH')
      for (const [index, resource] of material.resources.entries()) {
        if (!resource || !source.resources.some(item => stableTaskResourceIdentity([resource.resource]) === stableTaskResourceIdentity([item]))) fail('TASK_MATERIAL_SOURCE_MISMATCH')
        if (resource.status === 'unavailable') {
          if (resource.path !== undefined || resource.value !== undefined) fail('TASK_MATERIAL_SNAPSHOT_INVALID')
          continue
        }
        if (resource.status !== 'read' || resource.complete !== true || typeof resource.path !== 'string'
          || dirname(resource.path) !== directories.materials || !/^[a-f0-9]{64}$/.test(resource.sha256 ?? '')
          || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || resource.bytes > 8 * 1024 * 1024) fail('TASK_MATERIAL_PATH_INVALID')
        let bytes
        try {
          const entry = await lstat(resource.path)
          if (!entry.isFile() || entry.isSymbolicLink()) fail('TASK_MATERIAL_PATH_INVALID')
          bytes = await readFile(resource.path)
        } catch (error) { if (error.code === 'ENOENT') fail('TASK_MATERIAL_CONTENT_MISSING'); throw error }
        if (bytes.length !== resource.bytes || createHash('sha256').update(bytes).digest('hex') !== resource.sha256
          || typeof resource.value?.text === 'string' && !bytes.equals(Buffer.from(resource.value.text, 'utf8'))
          || resource.value?.image && resource.value.image.path !== resource.path
          || resource.value?.file && (!validMaterialFile(resource.value.file) || resource.value.file.path !== resource.path
            || resource.value.file.bytes !== resource.bytes || resource.value.file.sha256 !== resource.sha256)) fail('TASK_MATERIAL_CONTENT_CHANGED')
      }
      await checkedTaskDirectory(directories.materials)
      if (typeof source.text === 'string' && Buffer.byteLength(source.text) >= 512) {
        const textPath = target.replace(/\.json$/, '.txt')
        await publish(textPath, Buffer.from(source.text, 'utf8'))
        return { ...material, version: source.version, textPath }
      }
      return material
    }
    const publish = async (path, bytes) => {
      await checkedTaskDirectory(directories.materials)
      const temporary = join(directories.materials, `.pending-${randomUUID()}`)
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      try {
        await checkedTaskDirectory(directories.materials)
        await link(temporary, path).catch(error => { if (error.code !== 'EEXIST') throw error })
      } finally { await unlink(temporary) }
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) fail('TASK_MATERIAL_PATH_INVALID')
      if (!(await readFile(path)).equals(bytes)) fail('TASK_MATERIAL_CONTENT_CHANGED')
    }
    try {
      return await readSnapshot()
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const resources = []
    for (const resource of source.resources ?? []) {
      if (!readResource) { resources.push({ resource, status: 'unavailable', reason: 'resource_reader_not_configured' }); continue }
      try {
        const value = await readResource(source.groupId, source.messageId, resource)
        const text = typeof value?.text === 'string'
        const image = value?.image?.data instanceof Uint8Array && value.image.data.byteLength > 0
        const file = value?.file !== undefined
        if (file && (!validMaterialFile(value.file) || !(value.file.data instanceof Uint8Array) || !value.file.data.byteLength || text || image)) fail('RESOURCE_FILE_DESCRIPTOR_INVALID')
        if (!value || value.complete === false || value.hasMore === true || value.failures?.length || value.mediaUnavailable?.length || !text && !image && !file) fail('RESOURCE_READ_INCOMPLETE')
        const bytes = file ? Buffer.from(value.file.data) : text ? Buffer.from(value.text, 'utf8') : Buffer.from(value.image.data)
        if (bytes.length > 8 * 1024 * 1024) fail('RESOURCE_READ_TOO_LARGE')
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const originalExtension = file ? extname(value.file.name).toLowerCase() : ''
        const extension = file ? (/^\.[a-z0-9]{1,16}$/u.test(originalExtension) ? originalExtension : '.bin') : text ? '.txt' : ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[value.image.mediaType] ?? '.bin')
        const path = join(directories.materials, `resource-${hash([source.sourceId, resource]).slice(0, 16)}-${sha256.slice(0, 16)}${extension}`)
        await publish(path, bytes)
        resources.push({ resource, status: 'read', complete: true, path, bytes: bytes.length, sha256,
          value: file ? { file: { name: value.file.name, mediaType: value.file.mediaType, path, bytes: bytes.length, sha256 } }
            : text ? clean(value) : { image: { mediaType: value.image.mediaType, name: value.image.name, path, bytes: bytes.length, sha256 } } })
      }
      catch (error) { resources.push({ resource, status: 'unavailable', reason: error.code ?? 'RESOURCE_READ_FAILED' }) }
    }
    const material = clean({ taskId, sourceId: source.sourceId, version: source.version, actorId: source.actorId, messageId: source.messageId,
      text: source.text, quote: source.quote, resources, path: target })
    await publish(target, Buffer.from(JSON.stringify(bindTaskMaterialPaths(material,directories.materials))))
    return readSnapshot()
  }
  async function cancelLiveTask(taskId, oldTask, oldExecutions) {
    const list = await query('execution.list', { taskId })
    if(list.length)fail('TASK_SPLIT_EXECUTION_DATA_UNSUPPORTED')
    await taskSessions.cancel(taskId)
    await Promise.allSettled([oldTask, ...list.map(item => oldExecutions.get(item.executionId))].filter(Boolean))
  }
  function admitTask(taskId, action, groupId) {
    if(groupId)ctx.get('channels').assertGroupTarget(groupId)
    if(closed)fail('TASK_SESSION_CLOSED')
    const previous = admissions.get(taskId) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(async () => {
      if(groupId)ctx.get('channels').assertGroupTarget(groupId)
      admissionHolds.add(taskId)
      const oldTask = inflightTasks.get(taskId), oldExecutions = new Map(inflightExecutions)
      try { return await action(oldTask, oldExecutions) }
      finally {
        admissionHolds.delete(taskId)
        if (!closed) void schedulePending()
      }
    })
    admissions.set(taskId, pending);if(groupId)admissionGroups.set(pending,groupId)
    pending.finally(() => { if (admissions.get(taskId) === pending) admissions.delete(taskId);admissionGroups.delete(pending) }).catch(() => {})
    return pending
  }
  function persistSourceTraceStage(source,stage){
    const at=value=>typeof value==='number'?value:Date.parse(value)
    void residentStore.recordSourceTraceStage({sourceId:source.sourceId,sourceVersion:source.version,groupId:source.groupId,...stage.sessionId?{sessionId:stage.sessionId}:{},spanId:stage.spanId,requestId:stage.requestId,stage:stage.stage,...stage.phase?{phase:stage.phase}:{},startedAt:at(stage.startedAt),completedAt:stage.completedAt==null?null:at(stage.completedAt),shared:stage.shared===true}).catch(error=>ctx.logger?.warn?.(`trace timing: ${error.code??error.message}`))
  }
  async function recordMessageStage(request, stage) {
    try {
      const group = residentStore.getGroup(request.groupId)
      const refs = request.sourceSnapshot ? [request.sourceSnapshot] : request.messages
        ?? (request.topicId && request.revision ? resolveTopicMessages(group, request.topicId, request.revision) : [])
      if (!refs.length) return
      const sources = await query('source.list', { groupId: request.groupId })
      const matched = sources.filter(source => refs.some(ref => ref.messageId === source.messageId
        && (ref.messageVersion ?? ref.version) === source.version))
      for (const source of matched){const value={...stage,shared:matched.length>1};await command('source.stage',{sourceId:source.sourceId,stage:value});persistSourceTraceStage(source,value)}
    } catch (error) {
      failures.set(`timing:${stage.requestId}`, { id: `timing:${stage.requestId}`, code: error.code ?? error.message })
      ctx.logger?.warn?.(`message timing: ${error.code ?? error.message}`)
    }
  }
  async function recordResidentStage(ref, stage) {
    try {
      const source = await query('source.get', { sourceId: ref.sourceId })
      if (!source || source.messageId !== ref.messageId || source.version !== ref.version || source.groupId !== ref.groupId) fail('DYNAMIC_SOURCE_REVISION_CONFLICT')
      await command('source.stage', { sourceId: ref.sourceId, messageId: ref.messageId, messageVersion: ref.version, groupId: ref.groupId, stage });persistSourceTraceStage(source,stage)
    } catch (error) {
      failures.set(`timing:${stage.requestId}`, { id: `timing:${stage.requestId}`, code: error.code ?? error.message })
      ctx.logger?.warn?.(`message timing: ${error.code ?? error.message}`)
    }
  }
  async function projectSource(_source) { /* Historical projection is read-only after Topic retirement. */ }
  const sameRefs = (left, right) => hash((left ?? []).map(({ topicId, revision }) => [topicId, revision]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) === hash((right ?? []).map(({ topicId, revision }) => [topicId, revision]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  const sameIds = (left, right) => hash([...(left ?? [])].sort()) === hash([...(right ?? [])].sort())
  function fixedReplyFact(args) {
    const message = residentStore.getGroup(args.groupId)?.messages.find(item => item.messageId === (args.sourceRef?.messageId ?? args.replyToMessageId) && item.messageVersion === args.sourceVersion)
    const ref = args.matterUnitRefs?.length === 1 && args.matterUnitRefs[0]
    const unit = message?.units?.find(item => item.unitId === ref?.unitId && item.unitRevision === ref?.unitRevision && item.fixedTopic === args.fixedTopic)
    const requestId = unit && fixedUnitRequestId(args.groupId, message, unit)
    const scheduled = args.outboundId === platformScheduleOutboundId(requestId)
    if (!fixedTopicIds.includes(args.fixedTopic) || !unit || args.topicRefs?.length || args.taskIds?.length
      || !message.activeUnitRefs?.some(item => item.unitId === unit.unitId && item.unitRevision === unit.unitRevision)
      || (args.sourceRef ? args.sourceRef.actorId !== conversationMessageActorId(message) || args.sourceRef.messageVersion !== message.messageVersion
        : args.replyToSenderOpenDingTalkId !== conversationMessageActorId(message))
      || !scheduled && args.outboundId !== requestId) fail('fixed_topic_reply_source_invalid')
    const fact = { fixedTopic: unit.fixedTopic, unitId: unit.unitId, unitRevision: unit.unitRevision }
    if (scheduled) {
      const binding = residentStore.getPlatformSchedule(platformScheduleSessionId(requestId))
      if (unit.fixedTopic !== 'agent-platform' || binding?.requestId !== requestId || !binding.scheduleId
        || binding.groupId !== args.groupId || binding.messageId !== message.messageId || binding.messageVersion !== message.messageVersion
        || binding.unitId !== unit.unitId || binding.unitRevision !== unit.unitRevision || Date.parse(binding.at) > Date.now()) fail('fixed_topic_reply_source_invalid')
      fact.scheduleId = binding.scheduleId; fact.scheduledAt = binding.at
    }
    return fact
  }
  const frozenReply = async ({ groupId, topicRefs, decisionId, outboundId, taskIds, resultFingerprint, taskInputVersion, taskRunSequence, fixedTopic, sourceVersion, matterUnitRefs, sourceRef, triage, replyToMessageId, replyToSenderOpenDingTalkId }) => {
    const fact = fixedTopic ? fixedReplyFact({ groupId, topicRefs, outboundId, taskIds, fixedTopic, sourceVersion, matterUnitRefs, sourceRef, triage, replyToMessageId, replyToSenderOpenDingTalkId }) : null
    const outbound = residentStore.getGroup(groupId)?.outbox.find(item => item.outboundId === outboundId)
    const notification = (await query('notification.list')).find(item => item.id === outboundId)
    const payload = notification?.payload
    if (notification && (notification.kind !== (fact ? 'fixed-topic-reply' : triage||outbound?.triage?'triage-reply':'topic-reply') || payload?.conversationId !== groupId || !sameRefs(payload?.topicRefs, topicRefs)
      || fact && (hash(payload.fact) !== hash(fact) || payload.sourceVersion !== sourceVersion || payload.sourceMessageId !== replyToMessageId || payload.actorId !== replyToSenderOpenDingTalkId || hash(payload.sourceRef ?? null) !== hash(sourceRef ?? null))
      || taskIds !== undefined && !sameIds(payload?.taskIds, taskIds)
      || Object.hasOwn(payload, 'replyToMessageId') && payload.replyToMessageId !== payload.sourceMessageId
      || Object.hasOwn(payload, 'replyToSenderOpenDingTalkId') && payload.replyToSenderOpenDingTalkId !== payload.actorId)) fail('group_reply_frozen_identity_conflict')
    if (outbound && (!sameRefs(outbound.topicRefs, topicRefs)
      || fact && (outbound.replyToMessageId !== replyToMessageId || outbound.replyToSenderOpenDingTalkId !== replyToSenderOpenDingTalkId || hash(outbound.matterUnitRefs ?? []) !== hash(matterUnitRefs) || hash(outbound.sourceRef ?? null) !== hash(sourceRef ?? null))
      || decisionId && outbound.decisionId !== decisionId && !(notification && !outbound.decisionId && outbound.sourceMessageId === `task-notification:${outboundId}`)
      || !decisionId && outbound.decisionId
      || taskIds !== undefined && !sameIds(outbound.taskIds, taskIds)
      || resultFingerprint !== undefined && outbound.resultFingerprint !== undefined && outbound.resultFingerprint !== resultFingerprint
      || taskInputVersion !== undefined && outbound.taskInputVersion !== undefined && outbound.taskInputVersion !== taskInputVersion
      || taskRunSequence !== undefined && outbound.taskRunSequence !== undefined && outbound.taskRunSequence !== taskRunSequence)) fail('group_reply_frozen_identity_conflict')
    const frozen = payload && { text: payload.text, replyToMessageId: payload.sourceMessageId, replyToSenderOpenDingTalkId: payload.actorId, atOpenDingTalkIds: payload.atOpenDingTalkIds ?? [], ...(payload.atAll ? { atAll: true } : {}),
      ...(payload.sourceRef ? { sourceRef: payload.sourceRef } : {}), artifactFiles: payload.artifactFiles ?? [] }
    if (outbound && frozen && (outbound.text !== frozen.text || outbound.replyToMessageId !== frozen.replyToMessageId || outbound.replyToSenderOpenDingTalkId !== frozen.replyToSenderOpenDingTalkId || hash(outbound.atOpenDingTalkIds ?? []) !== hash(frozen.atOpenDingTalkIds) || !!outbound.atAll !== !!frozen.atAll
      || hash(outbound.artifactFiles ?? []) !== hash(frozen.artifactFiles))) fail('group_reply_frozen_identity_conflict')
    return { outbound, notification, frozen: outbound ?? frozen }
  }
  function assertRoutingClarification(payload, outboundId) {
    const group = residentStore.getGroup(payload.conversationId)
    const message = group?.messages.find(item => item.messageId === payload.sourceMessageId)
    const hold = message?.routingHold, draft = hold?.clarification, fact = payload.fact
    if (!message || message.routingStatus !== 'needs-context' || message.messageVersion !== payload.sourceVersion
      || hold.messageVersion !== fact.messageVersion || !draft || draft.epoch !== fact.epoch
      || conversationMessageActorId(message) !== payload.actorId || ['web', 'internal'].includes(message.sourceKind)
      || (message.automated === true || message.messageAiSendFlag === 'DWS') || isOwnNotification({ ...message, groupId: group.groupId })
      || draft.question !== fact.question || draft.assignmentQuote !== fact.assignmentQuote || draft.reviewFingerprint !== fact.reviewFingerprint
      || fact.agentDirected !== true || draft.replyReview?.kind !== 'substantive' || draft.replyReview.replaceOutboundIds?.length)
      fail('routing_clarification_stale')
    const quoteAt = message.text.indexOf(draft.assignmentQuote)
    if (quoteAt < 0 || message.text.indexOf(draft.assignmentQuote, quoteAt + 1) >= 0) fail('routing_clarification_stale')
    const reviewMessages = (draft.reviewMessageIds ?? []).map(id => group.messages.find(item => item.messageId === id)).filter(Boolean)
    if (!reviewMessages.length || reviewMessages.length !== draft.reviewMessageIds.length
      || draft.reviewMessageVersions?.length !== reviewMessages.length
      || reviewMessages.some(message => !draft.reviewMessageVersions.some(ref => ref.messageId === message.messageId && ref.messageVersion === message.messageVersion)))
      fail('routing_clarification_stale')
    const candidates = buildReplyReviewCandidates({ group: { ...group, outbox: group.outbox.filter(item => item.outboundId !== outboundId) },
      tasks: residentStore.listTasks().filter(task => task.groupId === group.groupId && !task.archivedAt), currentMessages: reviewMessages })
    if (fingerprint(candidates) !== draft.reviewFingerprint) fail('routing_clarification_stale')
    return message
  }
  async function settlePreparedEffectsForRouter(task){
    for(const row of task.effectReconciliations??[])if(row.state==='prepared'){
      // 完成已通过操作者证据核验的原结清事务，不授权或重放任何业务调用。
      if(await projectEffectReconciliation(task,row,false,true))continue
      const source=await query('source.get',{sourceId:row.receipt.payload.operatorSourceId})
      const writer=await ctx.sessionPersistence.openNative(task.sessionId,{auditKinds:effectReconciliationAuditKinds})
      try{
        const receipt=await effectReconciliation.prepare({...source.requestIdentity.effectReconciliation,operatorSourceId:source.sourceId})
        if(taskEffectDigest(receipt)!==row.receiptDigest)fail('TASK_EFFECT_RECONCILIATION_JOURNAL_CONFLICT')
        writer.appendAudit(receipt);await writer.commit()
        await projectEffectReconciliation(task,row,true,true)
      }finally{await writer.close()}
    }
    return requireTask(task.taskId)
  }
  async function applyDirectTaskAction(args){
    if(args.kind==='materialize'){
      for(const entry of args.tasks){const task=await requireTask(entry.taskId);taskCache.set(task.taskId,topicTaskView(task));await materializeSource(task.taskId,args.source)}
      void hostScheduler(()=>schedulePending());return
    }
    return admitTask(args.taskId,async(oldTask,oldExecutions)=>{
      let task=await requireTask(args.taskId);const source=args.source
      if(task.effectReconciliations?.some(row=>row.state==='prepared')){if(oldTask)await oldTask;task=await settlePreparedEffectsForRouter(task)}
      if(task.groupId!==source.groupId||task.groupId!==args.conversationId)fail('TASK_SESSION_SOURCE_FORBIDDEN')
      if(['supplement','resume'].includes(args.kind)&&[args.objective,args.title,args.requirements,args.control].some(value=>value!==undefined))fail('TASK_CONTEXT_CLASSIFICATION_CONFLICT')
      const action={taskId:task.taskId,expectedRequirementRevision:args.expectedRequirementRevision,expectedControlRevision:args.expectedControlRevision,operationId:args.operationId,
        ...(['supplement','resume'].includes(args.kind)?{messageId:args.operationId,text:args.text??source.text}:{}),
        ...(args.kind==='resume'?{humanRequestId:args.humanRequestId,expectedContextRevision:args.expectedContextRevision,reason:args.reason}:{}),
        ...(['revise','reopen'].includes(args.kind)?{text:args.text??source.text,...(args.objective!==undefined?{objective:args.objective}:{}),...(args.title!==undefined?{title:args.title}:{}),...(args.requirements!==undefined?{requirements:args.requirements}:{})}:{}),
        ...(args.kind==='control'?{control:args.control,reason:args.reason??source.text}:{}),
        ...(args.kind==='arrange'?{expectedArrangementRevision:args.expectedArrangementRevision,dependencies:args.dependencies}:{})}
      const hostLiveBinding=args.kind==='supplement'?taskSessions.liveBinding?.(task.taskId):undefined
      const receipt=await command('router.task-action',{conversationId:args.conversationId,generation:args.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:args.operationId,kind:'task.'+args.kind,action,...(hostLiveBinding?{hostLiveBinding}:{}),...(args.sameGoal!==undefined?{sameGoal:args.sameGoal}:{})},'router-action:'+args.operationId)
      // 重放只补排空尚未退出的原租约，不能取消后续已经合法启动的新轮次。
      const originalLease=!task.drained&&task.leaseEpoch===receipt.result.task.leaseEpoch&&task.requirementRevision===receipt.result.task.requirementRevision&&task.controlRevision===receipt.result.task.controlRevision
      if(!(args.kind==='supplement'||args.kind==='resume'&&args.humanRequestId!==undefined)&&(!receipt.replayed||originalLease))await cancelLiveTask(task.taskId,oldTask,oldExecutions)
      if(!receipt.replayed)failures.delete(task.taskId)
      await materializeSource(task.taskId,source)
      const current=await requireTask(task.taskId)
      if(args.kind==='supplement'&&taskSessions.liveBinding?.(task.taskId)){
        const sources=(await Promise.all(current.sourceRefs.map(sourceId=>query('source.get',{sourceId})))).filter(Boolean)
        const materials=await Promise.all(sources.map(source=>materializeSource(task.taskId,source)))
        await taskSessions.supplement({task:await taskInputWithDependencies(current),sources,materials})
      }
      void hostScheduler(()=>schedulePending());return receipt
    })
  }
  // Compare old frozen requests through one read projection; never mutate their payload/digest.
  function canonicalReplyRequest(value){
    const {atOpenDingTalkIds,replyToSenderOpenDingTalkId,...request}=value
    return clean({...request,...notificationAudience(value)})
  }
  async function prepareDirectReply(args){
    const source=args.source,selection=args.taskDelivery,kind=selection?'status':args.kind??'router-reply',notificationId=args.outboundId
    const audience=notificationAudience(args)
    const explicitAudience=kind!=='platform-reply'&&audience.recipientActorIds!==undefined
    const finalReply=kind==='platform-reply'||!!selection||explicitAudience
    const replyToSource=args.replyToSource===true
    const replyToMessageId=replyToSource?source.messageId:finalReply?args.replyToMessageId:args.replyToMessageId??source.messageId
    const replyToActorId=replyToSource?source.actorId:finalReply?audience.replyToActorId:audience.replyToActorId??source.actorId
    const recipients=[...new Set(audience.recipientActorIds??(finalReply||replyToSource?[]:[source.actorId]))]
    const request=clean({kind,sourceId:source.sourceId,sourceVersion:source.version,text:args.text,taskDelivery:selection,...(args.replyPurpose?{replyPurpose:args.replyPurpose}:{}),
      replyToMessageId,replyToActorId,recipientActorIds:recipients,...(args.atAll?{atAll:true}:{}),artifactFiles:args.artifactFiles??[]})
    const previous=await query('notification.get',{notificationId})
    if(previous){
      const p=previous.payload
      const frozen=args.frozen===true&&kind==='platform-reply'
      const saved=canonicalReplyRequest(frozen?{kind:previous.kind,sourceId:p.sourceId,sourceVersion:p.sourceVersion,text:p.text,
        replyToMessageId:p.sourceMessageId,replyToActorId:notificationAudience(p).replyToActorId??p.actorId,recipientActorIds:notificationAudience(p).recipientActorIds??[],...(p.atAll?{atAll:true}:{}),artifactFiles:p.artifactFiles??[]}
        :p.replyRequest??{kind:previous.kind,sourceId:p.sourceId,sourceVersion:p.sourceVersion,text:p.text,taskDelivery:p.taskDelivery,
          replyToMessageId:p.sourceMessageId,replyToActorId:notificationAudience(p).replyToActorId??p.actorId,recipientActorIds:notificationAudience(p).recipientActorIds??[],...(p.atAll?{atAll:true}:{}),artifactFiles:p.artifactFiles??[]})
      if(previous.kind!==kind||hash(canonicalReplyRequest(request))!==hash(saved))fail('DYNAMIC_COMMAND_ID_CONFLICT')
      void deliverNotifications();return {notification:{...previous,payload:{...canonicalReplyRequest(p),...p.replyRequest?{replyRequest:canonicalReplyRequest(p.replyRequest)}:{}}}}
    }
    if(replyToSource){
      const {target}=conversationNotificationRouting(residentStore.getGroup(source.groupId).messages,{replyToMessageId,recipientActorIds:recipients,atAll:args.atAll})
      if(conversationMessageActorId(target)!==replyToActorId)fail('DYNAMIC_DIRECT_SOURCE_INVALID')
    }else if(explicitAudience)finalConversationNotificationRouting(residentStore.getGroup(source.groupId).messages,{recipientActorIds:recipients})
    let artifactFiles=args.artifactFiles??[]
    if(selection){
      const task=await requireTask(selection.taskId)
      if(task.groupId!==source.groupId||!task.sourceRefs.includes(source.sourceId)||task.status!=='completed'||task.archivedAt
        ||task.requirementRevision!==selection.requirementRevision||task.archiveRestore?.reviewRequired)fail('TASK_DELIVERY_SOURCE_STALE')
      artifactFiles=selection.artifactIds.map(id=>{
        const file=task.completion?.result?.artifactFiles?.find(file=>file.artifact.artifactId===id)
        if(!file)fail('TASK_DELIVERY_ARTIFACT_NOT_REPORTED')
        return file
      })
      await deliveryFiles.validateManifest(artifactFiles.map(file=>file.artifact),task)
    }
    const internalIds=[source.sourceId,source.groupId,source.messageId,source.actorId,notificationId,replyInternalTaskId(selection?.taskId,source.text)]
    const text=finalReply?prepareConversationNotification({conversationId:source.groupId,text:args.text,replyToMessageId,replyToActorId,
      recipientActorIds:recipients,atAll:args.atAll,artifactFiles,signature:legacy.getAgentConfig().replySignature,internalIds}).text:args.text
    assertConversationReply(text,internalIds)
    const receipt=await command('notification.prepare',{notificationId,taskId:selection?.taskId??null,requirementRevision:selection?.requirementRevision??1,kind,
      payload:{text,conversationId:source.groupId,sourceId:source.sourceId,sourceVersion:source.version,sourceMessageId:replyToMessageId,actorId:replyToActorId,
        sourceRef:{messageId:source.messageId,messageVersion:source.version,actorId:source.actorId},replyToMessageId,replyToActorId,
        recipientActorIds:recipients,...(args.atAll?{atAll:true}:{}),replyKind:'substantive',taskIds:selection?[selection.taskId]:[],topicRefs:[],replyRequest:request,...(args.replyPurpose?{replyPurpose:args.replyPurpose}:{}),
        ...(selection?{taskDelivery:selection}:{}),...(artifactFiles.length?{artifactFiles,deliveryId:notificationId}:{})}},'prepare-notification:'+notificationId)
    void deliverNotifications();return receipt.result
  }
  async function prepareDirectPlatformReply(args){
    await args.preflight?.()
    if(args.directSource){
      const source=await query('source.get',{sourceId:args.directSource.sourceId})
      if(!source||source.groupId!==args.groupId||source.actorId!==args.directSource.actorId||source.version!==args.sourceVersion)fail('PLATFORM_SOURCE_STALE')
      await prepareDirectReply({...args,source,kind:'platform-reply'})
    }else{
      // 旧排期沿冻结的来源身份交付，不恢复 Topic 推理或改写 unit 身份。
      const {replyToMessageId,replyToActorId:replyToSenderOpenDingTalkId}=notificationAudience(args)
      const fact=fixedReplyFact({...args,replyToMessageId,replyToSenderOpenDingTalkId})
      const source=(await query('source.list',{groupId:args.groupId})).find(item=>item.messageId===(args.sourceRef?.messageId??replyToMessageId)&&item.version===args.sourceVersion&&item.actorId===(args.sourceRef?.actorId??replyToSenderOpenDingTalkId))
      if(!source)fail('PLATFORM_SOURCE_STALE')
      await frozenReply({...args,replyToMessageId,replyToSenderOpenDingTalkId})
      if(args.artifactFiles?.length)await deliveryFiles.validateManifest(args.artifactFiles.map(file=>file.artifact),{platformSource:args.artifactFiles[0].artifact.platformSource})
      assertConversationReply(args.text,[source.sourceId,source.groupId,source.messageId,source.actorId,args.outboundId])
      await command('notification.prepare',{notificationId:args.outboundId,taskId:null,requirementRevision:1,kind:'fixed-topic-reply',payload:{text:args.text,conversationId:args.groupId,sourceId:source.sourceId,sourceVersion:source.version,sourceMessageId:replyToMessageId,actorId:replyToSenderOpenDingTalkId,sourceRef:args.sourceRef,replyToMessageId,replyToSenderOpenDingTalkId,atOpenDingTalkIds:notificationAudience(args).recipientActorIds??[],...(args.atAll?{atAll:true}:{}),replyKind:'substantive',taskIds:[],topicRefs:[],fact,...(args.artifactFiles?.length?{artifactFiles:args.artifactFiles}:{})}},'prepare-notification:'+args.outboundId)
      void deliverNotifications()
    }
    return residentStore.getGroup(args.groupId)
  }
  const readPlatformTasks=async groupId=>Promise.all((await query('task.list',{groupId,archived:'all'})).map(async task=>{
    const executions=await query('execution.list',{taskId:task.taskId})
    const pendingWake=!task.lastDecision&&(await query('wake.list',{taskId:task.taskId})).some(wake=>wake.state!=='acked')
    return {...task,state:taskBoardState(task,executions,pendingWake),completedAt:task.completion?.at??null}
  }))
  const platformSchedules=createPlatformSchedules({ctx,store:residentStore,legacy,root,models,
    readTasks:readPlatformTasks,appendOutbox:prepareDirectPlatformReply,
    notify:undefined})
  const triage=createChannelTriage({ctx,root,recordStage:recordResidentStage,models:()=>roleModels('triage'),legacy,responsibilityFor,
    observe:(groupId,record)=>observationQueue.enqueue(record,{runtimeOwner:'channel-triage',groupId}),
    commit:async(groupId,decision)=>{
    const receipt=await command('triage.commit',decision,'triage:'+hash(decision.dispositions))
    for(const notification of receipt.result?.notifications??[])notificationCache.set(notification.id,notification)
    void deliverNotifications()
    void hostScheduler(()=>residentRouter.schedule(groupId)).catch(error=>recordRouterFailure(groupId,error))
    return receipt.result
  }})
  residentRouter=await openRouterLifecycle({ctx,store,root,recordStage:recordResidentStage,models:()=>roleModels('router'),agentPreset:legacy.getAgentConfig().agentPreset,setupBusiness:(agentCtx,binding)=>{
    const platformPages=new Map()
    return registerResidentRouterTools(agentCtx,binding,{
    query,command,responsibilityFor,applyTaskAction:applyDirectTaskAction,prepareReply:args=>{if([...platformPages.values()].some(page=>page.consumed<page.total))fail('platform_task_pages_unread');return prepareDirectReply(args)},
    platformQuery:async(groupId,args)=>{
      const key=JSON.stringify([args.state??'all',args.day??null,args.limit??50])
      let snapshot=platformPages.get(key)
      if(!snapshot||(args.offset??0)===0){snapshot={tasks:await readPlatformTasks(groupId),asOf:Date.now(),timezone:residentStore.getGroup(groupId)?.timezone??legacy.getAgentConfig().timezone??Intl.DateTimeFormat().resolvedOptions().timeZone,consumed:0,total:0};platformPages.set(key,snapshot)}
      if((args.offset??0)>snapshot.consumed)fail('platform_task_page_gap')
      const page=platformTaskPage(snapshot.tasks,args,{groupId,timezone:snapshot.timezone,now:snapshot.asOf})
      snapshot.consumed=Math.max(snapshot.consumed,page.nextOffset);snapshot.total=page.total
      return page
    },
    platformConfig:groupId=>({responsibility:responsibilityFor(groupId),timezone:residentStore.getGroup(groupId)?.timezone??legacy.getAgentConfig().timezone??Intl.DateTimeFormat().resolvedOptions().timeZone,model:roleModels('router'),agentPreset:legacy.getAgentConfig().agentPreset,maxConcurrentTasks:taskLimit()}),
    platformSchedule:args=>platformSchedules.submit({sourceMode:'direct',sourceId:args.source.sourceId,actorId:args.source.actorId,groupId:args.conversationId,requestId:args.requestId,messageId:args.source.messageId,messageVersion:args.source.version,timezone:residentStore.getGroup(args.conversationId)?.timezone??legacy.getAgentConfig().timezone??Intl.DateTimeFormat().resolvedOptions().timeZone},args),
  })}})
  const rerouteGroups=new Set()
  function kickGroup(groupId,source){
    if(closed)return Promise.resolve()
    try{ctx.get('channels').assertGroupTarget(groupId)}catch(error){return Promise.reject(error)}
    if(inflightGroups.has(groupId)){rerouteGroups.add(groupId);void hostScheduler(async()=>triage.append(groupId,source?[source]:await query('triage.pending',{conversationId:groupId,limit:15}))).catch(error=>failures.set(groupId,{id:groupId,code:error.code??error.message}));return inflightGroups.get(groupId)}
    const work=track(inflightGroups,groupId,async()=>{
      do{
        rerouteGroups.delete(groupId)
        const pending=await query('triage.pending',{conversationId:groupId,limit:15})
        if(pending.length){await triage.run(groupId,pending);failures.delete(groupId)}
        if((await query('triage.pending',{conversationId:groupId,limit:15})).length)rerouteGroups.add(groupId)
      }while(!closed&&rerouteGroups.has(groupId))
      void hostScheduler(()=>residentRouter.schedule(groupId)).catch(error=>recordRouterFailure(groupId,error))
    })
    void work.catch(error=>failures.set(groupId,{id:groupId,code:error.code??error.message}))
    return work
  }
  function ingest(message,notificationIdentityChecked=false){
    const channels=ctx.get('channels'),context=channels.groupContext(message.groupId)
    return context?channels.withInputTarget(context,()=>ingestMessage(message,notificationIdentityChecked)):ingestMessage(message,notificationIdentityChecked)
  }
  async function ingestMessage(message, notificationIdentityChecked = false) {
    const receivedAt = new Date().toISOString()
    const loopDelay = monitorEventLoopDelay({ resolution: 10 })
    loopDelay.enable()
    const phases = []
    try {
    if (closed) fail('TASK_SESSION_CLOSED')
    ctx.get('channels').assertGroupTarget(message.groupId)
    // 订阅身份读取权威群记录，不为接入校验展开并过滤展示消息历史。
    if (!residentStore.getGroup(message.groupId)) fail('group_not_subscribed')
    const actorId = conversationMessageActorId(message)
    if (!actorId) fail('TASK_SESSION_AUTHENTICATED_SOURCE_REQUIRED')
    if (notificationIdentityChecked ? isOwnNotification(message) : await ownNotificationAtIngress(message)) {
      return { accepted: false, processing: 'ignored', reason: 'own-notification' }
    }
    const sourceId = `im:${hash([message.groupId, message.messageId, message.messageVersion ?? 1])}`
    // DWS rawOccurredAt is explicit even when absent: never admit its display-time fallback.
    const rawTime = Object.hasOwn(message, 'rawOccurredAt') ? message.rawOccurredAt : message.occurredAt ?? message.timestamp
    // Only the documented DWS local datetime format is Beijing time; ambiguous dates stay invalid.
    const envelopeTime = typeof rawTime === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/u.test(rawTime)
      ? rawTime.replace(' ', 'T') + '+08:00' : rawTime
    const actualTime = ingressTimestamp(envelopeTime)
    const sourceReadStartedAt = new Date().toISOString()
    const original = await query('source.get', { sourceId })
    if (!original) {
      const priorAdmission = await query('receipt.get', { id: `source:${sourceId}` })
      if (priorAdmission?.result?.ignored) return { accepted: false, sourceId, processing: 'quarantined', reason: priorAdmission.result.reason }
    }
    phases.push({ phase: 'source-read', startedAt: sourceReadStartedAt, completedAt: new Date().toISOString() })
    if (original && (original.actorId !== actorId || original.text !== (message.text ?? ''))) fail('DYNAMIC_SOURCE_CONFLICT')
    const rawSource = { sourceId, groupId: message.groupId, messageId: message.messageId,
      version: message.messageVersion ?? 1, actorId, senderName: message.senderName ?? '', text: message.text ?? '',
      ...message.platformFlags?.retracted===true?{retracted:true}:{},
      quote: original&&hash(conversationQuote(original.quote??null))===hash(conversationQuote(message.quotedMessage??null))?original.quote:conversationQuote(message.quotedMessage??null), resources: message.resourceRefs ?? message.imageRefs ?? [], timestamp: actualTime ?? '' }
    if (!original && config.ingressEpoch && (!actualTime || Date.parse(actualTime) < Date.parse(config.ingressEpoch))) {
      const stored = await command('source.record', rawSource, `source:${sourceId}`)
      return { accepted: false, sourceId, processing: 'quarantined', reason: stored.result.reason }
    }
    await ingestTaskResidentMessage({ctx,residentStore,message:{...message,occurredAt:message.occurredAt??actualTime},readResource,onPhase:phase=>phases.push(phase)})
    const projected=residentStore.getGroup(message.groupId).messages.find(item=>item.messageId===message.messageId)
    const version=projected.messageVersion
    const currentSourceId=`im:${hash([message.groupId,message.messageId,version])}`
    const previous=await query('source.get',{sourceId:currentSourceId})
    const args={...rawSource,sourceId:currentSourceId,version,receivedAt:previous?.receivedAt??receivedAt,channel:'im'}
    const context=ctx.get('channels').groupContext(message.groupId)
    const conversation={conversationId:message.groupId,type:message.channelType??'chat-room',channelAccountId:message.channelId??'legacy-channel',...message.channelType==='chat'?{peerId:actorId}:{}}
    const stored=await command('source.record-direct',{source:args,conversation},`source-direct:${currentSourceId}`)
    if(stored.result.ignored)return {accepted:false,sourceId:currentSourceId,processing:'quarantined',reason:stored.result.reason}
    if (!previous) {
      const completedAt = new Date().toISOString()
      const loopDelayMetadata = loopDelay.count > 0 ? { loopDelayMs: loopDelay.max / 1e6 } : {}
      // The exact source is already known; timing must not re-read every group source per phase.
      const spans = [{ spanId: `ingress:${currentSourceId}`, stage: 'ingress', requestId: currentSourceId, attempt: 0, startedAt: receivedAt, completedAt, ...loopDelayMetadata },
        ...phases.map((phase, index) => ({ ...phase, spanId: `ingress:${currentSourceId}:${index}`, stage: 'ingress', requestId: currentSourceId, attempt: 0 }))]
      try {
        for (const stage of spans){await command('source.stage',{sourceId:currentSourceId,stage});persistSourceTraceStage(args,stage)}
      } catch (error) {
        failures.set(`timing:${currentSourceId}`, { id: `timing:${currentSourceId}`, code: error.code ?? error.message })
        ctx.logger?.warn?.(`message timing: ${error.code ?? error.message}`)
      }
    }
    void kickGroup(message.groupId,stored.result.source??previous)
    return { accepted: true, sourceId: currentSourceId, processing: (stored.result.source??previous)?.routed ? 'routed' : 'pending' }
    } finally { loopDelay.disable() }
  }

  async function taskInputWithDependencies(task) {
    const dependencies=(await query('router.dependencies',{taskId:task.taskId})).filter(row=>row.taskId===task.taskId)
    const inputs=[]
    const evaluations=dependencies.length?await query('router.evaluations',{taskId:task.taskId}):[]
    for(const dependency of dependencies){
      const evaluation=evaluations.find(row=>row.id===dependency.evaluationId)
      const prerequisite=await query('task.get',{taskId:dependency.prerequisiteTaskId})
      const completion=prerequisite?.completion
      const receipt=completion?await query('receipt.get',{id:completion.commandId}):null
      const event=receipt?.completionEvent
      const authorization=await query('source.get',{sourceId:dependency.authorizationSourceId})
      // 只交接真实入边当前完成版本及其原评估，不把旧结果或全会话复制为新授权。
      if(dependency.state!=='satisfied'||!evaluation||evaluation.decision!=='satisfied'
        ||['taskId','conversationId','prerequisiteTaskId','prerequisiteRequirementRevision','requirementRevision','controlRevision','arrangementRevision','condition'].some(key=>evaluation[key]!==dependency[key])
        ||dependency.requirementRevision!==task.requirementRevision||dependency.controlRevision!==task.controlRevision||dependency.arrangementRevision!==(task.arrangementRevision??1)
        ||dependency.conversationId!==task.conversationId||prerequisite?.conversationId!==task.conversationId
        ||!completion||completion.requirementRevision!==dependency.prerequisiteRequirementRevision||prerequisite.requirementRevision!==dependency.prerequisiteRequirementRevision
        ||!event||event.id!==evaluation.completionEventId||event.kind!=='task.completed'||event.taskId!==prerequisite.taskId
        ||event.commandId!==completion.commandId||event.requirementRevision!==completion.requirementRevision||event.controlRevision!==completion.controlRevision||hash(event.result)!==hash(completion.result)
        ||!authorization||authorization.groupId!==dependency.conversationId||authorization.version!==dependency.authorizationSourceVersion)fail('ROUTER_EVALUATION_STALE')
      inputs.push({...dependency,evaluation,
        authorization:{sourceId:authorization.sourceId,messageVersion:authorization.version,actorId:authorization.actorId},
        prerequisite:{taskId:prerequisite.taskId,requirementRevision:prerequisite.requirementRevision,completion},
        completionEvent:{id:event.id,kind:event.kind,taskId:event.taskId,requirementRevision:event.requirementRevision,controlRevision:event.controlRevision,recordedAt:event.recordedAt}})
    }
    if(dependencies.length&&!await query('task.dependencies-ready',{taskId:task.taskId}))fail('ROUTER_DEPENDENCY_PENDING')
    return {...task,dependencies:inputs}
  }

  function kickTask(taskId) {
    if (closed || admissionHolds.has(taskId) || !retryReady(taskId) || !reserveTask(taskId)) return Promise.resolve()
    return track(inflightTasks, taskId, async () => {
      let task = await requireTask(taskId)
      if(!taskWorkspaceReady(task)){if(!failures.has('task-workspace:'+taskId))failures.set('task-workspace:'+taskId,{id:taskId,code:'TASK_WORKSPACE_NOT_READY'});taskSlots.delete(taskId);return}
      if(task.dependenciesReady===false){taskSlots.delete(taskId);return}
      if(task.effectReconciliations?.some(row=>row.state==='prepared')){taskSlots.delete(taskId);return}
      if (task.archivedAt || task.status !== 'active' || task.control !== 'active') { taskSlots.delete(taskId); return }
      if (!task.drained) return
      const pending = await query('wake.list', { taskId })
      const reviewPending = pendingTaskHumanReview(task, pending)
      if (!pendingDialogue(task) && !reviewPending && taskHumanWait(task)) { taskSlots.delete(taskId); return }
      if (!pending.some(item => item.state !== 'acked') || admissionHolds.has(taskId)) return
      const claimed = await command('task.claim', { taskId, ...task.archiveRestore?.reviewRequired?{restoreReview:true}:{}, ...(pendingDialogue(task) ? { dialogue: true } : reviewPending ? { humanReview: true } : {}) })
      const { binding, wakeIds, wakes, humanReview } = claimed.result
      task = claimed.result.task
      const dialogueMessage = wakes.find(item => item.kind === 'task.dialogue')?.payload.messageId
      const dialogue = dialogueMessage ? { ...task.dialogue.find(item => item.id === dialogueMessage),
        history: task.dialogue.filter(item => item.reply && item.id !== dialogueMessage).slice(-20) } : null
      let drained = true, submitted = false
      try {
        const sources = (await Promise.all(task.sourceRefs.map(sourceId => query('source.get', { sourceId })))).filter(Boolean)
        const materials = await Promise.all(sources.map(source => materializeSource(taskId, source)))
        const operations = await query('operation.list', { taskId })
        const executions = await query('execution.list',{taskId})
        if(executions.length)fail('TASK_SPLIT_EXECUTION_DATA_UNSUPPORTED')
        await ctx.get?.('memory')?.bindSession(binding.sessionId,{actorId:task.ownerActorId??config.ownerActorId,...task.groupId&&task.metadata?.channelType!=='chat'?{groupId:task.metadata?.memoryGroupId??task.groupId,groupWrite:true}:{}})
        const runResult = await taskSessions.run({ binding, input: { task:await taskInputWithDependencies(task), artifactScope: await resolveTaskArtifactScope({ root, task, query }), sources, ...(dialogue ? { dialogue } : {}), ...(humanReview ? { humanReview } : {}), materials: materials.map(({ resources, ...value }) => ({ ...value, resources: resources.map(({ value: body, ...resource }) => ({ ...resource, ...(body?.file ? { file: body.file } : {}) })) })), wakes, executions,
          operations,
          operationCounts: Object.fromEntries(Object.entries(Object.groupBy(operations, operation => operation.state)).map(([state, items]) => [state, items.length])),
          blockers: await query('task.blockers', { taskId }) }, ...roleModels('task'), agentPreset: legacy.getAgentConfig().agentPreset,
          groupResponsibility: responsibilityFor(task.groupId),
          readDecisions: (args, current) => query('task.decisions', { ...args, taskId: current.taskId }),
          onSupplementAdmitted:async({messageId,entryId,packetId,binding:nextBinding})=>{
            await command('task.supplement.admitted',{binding:nextBinding,messageId,entryId,packetId},`task-supplement-admitted:${taskId}:${messageId}`)
            Object.assign(binding,{contextRevision:nextBinding.contextRevision});task=await requireTask(taskId)
            sources.splice(0,sources.length,...(await Promise.all(task.sourceRefs.map(sourceId=>query('source.get',{sourceId})))).filter(Boolean))
          },
          onSessionBound: async () => { await attachWorkspace(binding.sessionId, await taskWorkspace(root,taskId,task), task.title); return command('task.sessionBound', { binding }, `task-bound:${taskId}:${binding.leaseEpoch}`) },
          resolveHuman: async args => {
            if (!humanReview) fail('DYNAMIC_HUMAN_REVIEW_NOT_PENDING')
            return (await command('task.human.resolve', { binding, ...args },
              `human-review:${taskId}:${humanReview.requestId}:${binding.leaseEpoch}`)).result
          },
          submit: async decision => {
            if(task.conversationId&&decision.audience==='topic')decision={...decision,audience:'requester'}
            if (decision.question?.trim() && decision.audience === undefined) decision = { ...decision, audience: 'operator' }
            if (decision.question?.trim() && decision.executionIds) for (const id of decision.executionIds) {
              const execution = await query('execution.get', { executionId: id })
              if (execution?.taskId !== taskId) fail('TASK_EXECUTION_SCOPE_MISMATCH')
              // Cancel joins the native turn; join its existing ledger finalizer too.
              if (execution.cancelRequested && !execution.drained) await inflightExecutions.get(id)
            }
            if (humanReview && (decision.action !== 'wait' || decision.question?.trim())) fail('DYNAMIC_HUMAN_REVIEW_READ_ONLY')
            if (decision.replySourceId !== undefined && (!humanReview || decision.action !== 'wait' || !humanReview.sourceIds.includes(decision.replySourceId))) fail('DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID')
            const publicInternalIds = decision.question?.trim() && decision.audience !== 'requester' || dialogue || decision.replySourceId !== undefined ? await replyInternalIds(task, sources) : []
            if (decision.question?.trim() && decision.audience !== 'requester') {
              // 人工问题和已尝试事项会外发；evidence 保留在内部账本，不拿调试 ID 当用户操作入口。
              for (const text of [task.title, decision.question, ...(decision.attemptedActions ?? [])]) assertConversationReply(text, publicInternalIds)
            }
            if (dialogue || decision.replySourceId !== undefined) assertConversationReply(decision.summary, publicInternalIds)
            if (dialogue) {
              if (decision.action !== 'wait' || decision.question?.trim()) fail('TASK_DIALOGUE_REPLY_ONLY')
              await command('task.dialogue.reply', { binding, messageId: dialogue.id, reply: decision.summary, decision }, `dialogue-reply:${taskId}:${dialogue.id}`)
              submitted = true
              return { accepted: true, replied: true }
            }
            if (decision.action === 'complete') {
              if (decision.deliveryFiles?.length && (!notifications?.sendFile || !notifications?.readbackFile)) fail('TASK_DELIVERY_FILE_TRANSPORT_UNAVAILABLE')
              const artifactFiles = await (freezeSingleTaskFiles)({ reported:decision.artifacts,selected: decision.deliveryFiles, task,
                executions: await query('execution.list', { taskId }), directory: await taskWorkspace(root,taskId,task), files: deliveryFiles })
              const replyBindings=await taskReplyBindings(task)
              const topicFacts=!task.conversationId&&(replyBindings.length>0||!!task.replyBindings?.length||!!task.topicRefs?.length)
              await command('task.complete', { binding, summary: decision.summary, result: artifactFiles.length ? { ...decision, artifactFiles } : decision, topicFacts,
                replyBindings }, `complete:${taskId}:${binding.requirementRevision}`)
            } else {
              let humanReply, replyBindings = await taskReplyBindings(task)
              if (decision.question?.trim() && decision.audience === 'topic' && !replyBindings.length) fail('TASK_COORDINATION_TOPIC_REQUIRED')
              if (decision.replySourceId) {
                const source = sources.find(item => item.sourceId === decision.replySourceId)
                if (!source) fail('DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID')
                replyBindings = bindingsForSources([source])
                humanReply = { requestId: humanReview.requestId, sourceId: source.sourceId }
                if(task.conversationId){
                  const reply=prepareConversationNotification({conversationId:source.groupId,text:decision.summary,recipientActorIds:[source.actorId],signature:legacy.getAgentConfig().replySignature,internalIds:publicInternalIds})
                  humanReply.notification={...reply,conversationId:source.groupId,sourceId:source.sourceId,sourceVersion:source.version,sourceRef:{messageId:source.messageId,messageVersion:source.version,actorId:source.actorId},humanRequestId:humanReview.requestId,replyKind:'substantive',fact:{taskId:task.taskId}}
                }
              }
              const topicFacts=!task.conversationId&&(replyBindings.length>0||!!task.replyBindings?.length||!!task.topicRefs?.length)
              await command('task.wait', { binding, ...decision, topicFacts, replyBindings, ...(humanReply ? { humanReply } : {}), ...(decision.question?.trim() ? { humanRequest: {
                requestId: `human-${hash([taskId, binding.requirementRevision, binding.controlRevision, binding.leaseEpoch])}`,
                reason: decision.summary, audience: decision.audience ?? 'operator', ...(decision.executionIds ? { executionIds: decision.executionIds } : {}), attemptedActions: decision.attemptedActions ?? [] } } : {}) }, `wait:${taskId}:${binding.leaseEpoch}`)
              if (decision.question?.trim()) {
                const current = await requireTask(taskId)
                await queueHumanRequest(current, current.humanRequests.findLast(request => request.status === 'waiting-reply'))
              }
            }
            submitted = true
            return { accepted: true }
          } })
        if (!submitted && runResult.status === 'no_submission') {
          // 补充输入会在安全步骤使旧回合停止；旧绑定不能写技术阻塞，排空后由原唤醒接续最新版本。
          if(['TASK_EFFECT_UNCERTAIN_NO_REPLAY','TASK_JOB_UNCERTAIN_NO_REPLAY'].includes(runResult.reason)&&await currentTask(binding,{allowLiveSupplements:true})){const latest=await requireTask(taskId);binding.contextRevision=latest.contextRevision??0}
          if (!await currentTask(binding)) return
          // 复核未提交判断时保留候选唤醒，用既有有界退避恢复，不能把技术失败当成已审阅。
          if (humanReview && !runResult.reason) throw Object.assign(new Error('TASK_SESSION_NO_SUBMISSION'), { code: 'TASK_SESSION_NO_SUBMISSION', phase: 'decision' })
          if (dialogue) fail('TASK_DIALOGUE_NO_REPLY')
          failures.set(taskId, { id: taskId, code: runResult.reason ?? 'TASK_SESSION_NO_SUBMISSION' })
          const uncertainEffect=['TASK_EFFECT_UNCERTAIN_NO_REPLAY','TASK_JOB_UNCERTAIN_NO_REPLAY'].includes(runResult.reason)
          await command('task.wait', { binding, action: 'blocked', summary: uncertainEffect?'任务有尚未核实的外部效果，自动执行已停止，等待人工核验。':'任务会话本轮未能提交有效决定，原任务和执行结果已保留。',
            limitations: [runResult.reason ?? 'TASK_SESSION_NO_SUBMISSION'], ...(humanReview ? { reviewFailureCode: runResult.reason } : {}) }, `task-technical-block:${taskId}:${binding.leaseEpoch}`)
          submitted = !humanReview
        }
        if (submitted) await command('wake.ack', { binding, wakeIds }, `wake-ack:${taskId}:${binding.leaseEpoch}`)
      } catch (error) {
        drained = error.taskSessionDrained !== false
        if(drained&&['TASK_PI_PROVIDER_ERROR','TASK_SESSION_NO_SUBMISSION','TASK_SESSION_PROVIDER_TRANSIENT','TASK_DIALOGUE_NO_REPLY'].includes(error.code)){
          if(!await currentTask(binding))return
          const failure={code:error.code,...typeof error.phase==='string'?{phase:error.phase}:{},...typeof error.nativeAssistantStopReason==='string'?{stopReason:error.nativeAssistantStopReason}:{}}
          failures.set(taskId,{id:taskId,code:error.code})
          if(dialogue)await command('task.dialogue.failed',{binding,messageId:dialogue.id,failure},`dialogue-failed:${taskId}:${dialogue.id}:${binding.leaseEpoch}`)
          else{
            await command('task.wait',{binding,action:humanReview?'blocked':'wait',summary:'模型本轮未能提交有效决定；自动处理已停止，原任务和输入已保留，等待新的明确输入。',evidence:[],limitations:[error.code],technicalFailure:failure,...humanReview?{reviewFailureCode:error.code}:{}},`task-technical-failure:${taskId}:${binding.leaseEpoch}`)
            if(!humanReview)await command('wake.ack',{binding,wakeIds},`wake-ack:${taskId}:${binding.leaseEpoch}`)
          }
          return
        }

        throw error
      }
      finally {
        if (drained) await command('task.drained', { binding }, `task-drained:${taskId}:${binding.leaseEpoch}`)
        if (!closed) void deliverNotifications()
        // Slot release and queued-work promotion happen after the tracked turn drains.
      }
    })
  }
  async function replyInternalIds(task, knownSources) {
    const [executions, operations, current] = await Promise.all([
      query('execution.list', { taskId: task.taskId }), query('operation.list', { taskId: task.taskId }), query('task.get', { taskId: task.taskId }),
    ])
    const sourceIds = new Set([...task.sourceRefs, ...(current?.sourceRefs ?? [])])
    // 复用本轮已读来源；恢复出口也只读取本任务绑定项，不扫描所有历史消息。
    const sources = knownSources ?? (await Promise.all([...sourceIds].map(sourceId => query('source.get', { sourceId })))).filter(Boolean)
    return [task.taskId, task.sessionId, task.groupId, task.ownerActorId, config.operatorUserId, ...sourceIds,
      ...sources.flatMap(source => [source.messageId, source.actorId]),
      ...(current?.humanRequests ?? task.humanRequests ?? []).map(item => item.requestId),
      ...executions.flatMap(item => [item.executionId, item.sessionId]), ...operations.map(item => item.operationId)].filter(Boolean)
  }
  async function queueReply(task, source, decision, id, kind, humanRequest) {
    if (!source || source.channel === 'web' || source.sourceId.startsWith('web:')) return
    if ((await query('notification.list')).some(item => item.id === id)) {
      void deliverNotifications()
      return
    }
    const reply = formatTaskConversationReply({ source: { conversationId: source.groupId, messageId: source.messageId,
      actorId: source.actorId, senderName: source.senderName, text: source.text }, summary: decision.summary,
      evidence: decision.evidence, limitations: decision.limitations,
      signature: legacy.getAgentConfig().replySignature, internalIds: await replyInternalIds(task) })
    await command('notification.prepare', { notificationId: id, taskId: task.taskId, requirementRevision: task.requirementRevision,
      kind, payload: { ...reply, conversationId: source.groupId, sourceMessageId: source.messageId, actorId: source.actorId,
        sourceId: source.sourceId, sourceVersion: source.version,
        ...(humanRequest ? { audience: humanRequest.audience, humanRequestId: humanRequest.requestId } : {}), fact: { taskId: task.taskId }, kind } }, `prepare-notification:${id}`)
    void deliverNotifications()
  }
  async function queueHumanRequest(task, request) {
    if (!request) return
    if (request.topicFactIds?.length) return
    if (request.audience === 'topic') return // 归属 Topic 负责选择联系人与原群回复，绝不退回默认私聊。
    if (request.audience === 'requester') {
      const source = await sourceFor(task)
      return queueReply(task, source, { summary: request.question, evidence: [], limitations: [] },
        `question:${task.taskId}:${request.requestId}`, 'question', request)
    }
    if (!config.operatorUserId) return // 未配置/登录时仍保留Web人工介入，不能转发给需求提出人。
    const notificationId = `operator-request:${request.requestId}`
    const text = ['【需要协助处理】', `事项：${task.title}`,
      request.question, ...(request.attemptedActions?.length ? ['已尝试：', ...request.attemptedActions] : []),
      '请在人工介入页答复，或引用本消息回复处理结果。'].join('\n\n')
    assertConversationReply(text, [request.requestId, notificationId, ...await replyInternalIds(task)])
    await command('notification.prepare', { notificationId, taskId: task.taskId, requirementRevision: request.requirementRevision,
      kind: 'question', payload: { text, audience: 'operator', humanRequestId: request.requestId,
        recipientUserId: config.operatorUserId, fact: { taskId: task.taskId }, kind: 'question' } }, `prepare-notification:${notificationId}`)
    void deliverNotifications()
  }
  function deliverNotifications(attempted = new Set()) {
    if (closed) return Promise.resolve()
    notificationScanRequested = true
    if (notificationScan) return notificationScan
    notificationScan = (async () => {
      do {
        notificationScanRequested = false
        await scanNotifications(attempted)
      } while (!closed && notificationScanRequested)
    })().finally(() => { notificationScan = undefined })
    return notificationScan
  }
  function continueNotificationDelivery(pending, attempted) {
    // 同一轮每条最多尝试一次，拒发、未知和限流仍由原恢复/退避条件控制。
    void pending.catch(() => {}).then(() => { if (!closed) return deliverNotifications(attempted) }).catch(error => {
      ctx.logger?.warn?.(`notification drain: ${error.code ?? error.message}`)
    })
  }
  const notificationRecoveryError = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode })
  const notificationStage = (current, stage) => current.payload.conversationId && Number.isSafeInteger(current.payload.sourceVersion)
    ? recordMessageStage({ groupId: current.payload.conversationId,
      messages: [{ messageId: current.payload.sourceRef?.messageId ?? current.payload.sourceMessageId, messageVersion: current.payload.sourceVersion }] }, stage) : undefined
  async function notificationDeliveryGate(notification) {
    if(notification.archiveRestoreHold)return false
    // 所有通知先核原持久父子顺序，direct 来源分支也不能绕过。
    if (notification.payload.afterNotificationId) {
      const previous = await query('notification.get', { notificationId: notification.payload.afterNotificationId })
      if (previous?.state !== 'delivered') return false
    }
    if(['triage-reply','router-reply','platform-reply'].includes(notification.kind)||notification.kind==='status'&&notification.payload.taskDelivery){
      const parent=notification.payload.artifact?await query('notification.get',{notificationId:notification.payload.deliveryId}):notification
      const p=parent?.payload,source=p&&await query('source.get',{sourceId:p.sourceId})
      if(!parent||parent.kind!==notification.kind||parent.archiveRestoreHold||!source||source.groupId!==p.conversationId||source.actorId!==p.sourceRef?.actorId||source.version!==p.sourceRef?.messageVersion)return false
      if(['unknown','starting'].includes(notification.state))return true
      if(source.authorizationRevoked||source.triageHold||source.archiveRestoreHold)return false
      return !(await query('source.list',{groupId:source.groupId})).some(row=>row.messageId===source.messageId&&row.version>source.version)
    }
    if (notification.kind === 'coordination' || notification.state === 'superseded') return false
    if (notification.kind === 'routing-clarification' && ['prepared', 'failed'].includes(notification.state)) {
      try { assertRoutingClarification(notification.payload, notification.id) }
      catch (error) {
        failures.set(notification.id, { id: notification.id, code: error.code ?? error.message })
        return false
      }
    }
    if (notification.kind === 'fixed-topic-reply' && ['prepared', 'failed'].includes(notification.state)) {
      const parent = notification.payload.artifact ? await query('notification.get', { notificationId: notification.payload.deliveryId }) : notification
      const p = parent?.payload
      try {
        if (!p || parent.kind !== 'fixed-topic-reply') fail('fixed_topic_reply_source_invalid')
        await frozenReply({ groupId: p.conversationId, outboundId: parent.id, topicRefs: p.topicRefs, taskIds: p.taskIds,
          fixedTopic: p.fact.fixedTopic, sourceVersion: p.sourceVersion, sourceRef: p.sourceRef, matterUnitRefs: [{ unitId: p.fact.unitId, unitRevision: p.fact.unitRevision }],
          replyToMessageId: p.sourceMessageId, replyToSenderOpenDingTalkId: p.actorId })
        if (['fixed_topic_reply_source_invalid', 'group_reply_frozen_identity_conflict'].includes(failures.get(notification.id)?.code)) failures.delete(notification.id)
      } catch (error) {
        failures.set(notification.id, { id: notification.id, code: error.code ?? error.message })
        return false
      }
    }
    if (notification.state === 'prepared' || notification.state === 'failed' && notification.deliveryError?.knownNotSent === true && notification.deliveryError?.retryable === true) {
      const owners = residentStore.listGroups().flatMap(group => group.topics.flatMap(topic => topic.decisions.filter(record => record.outboundId === notification.id).map(record => ({ group, topic, record }))))
      if (owners.length) {
        try {
          if (owners.length !== 1 || notification.payload.conversationId !== owners[0].group.groupId) fail('group_reply_frozen_identity_conflict')
          const { group, topic, record } = owners[0]
          await frozenReply({ groupId: group.groupId, topicRefs: [{ topicId: topic.topicId, revision: record.revision }], decisionId: record.decisionId, outboundId: notification.id, taskIds: record.operations.map(operation => operation.taskId).filter(Boolean) })
          if (failures.get(notification.id)?.code === 'group_reply_frozen_identity_conflict') failures.delete(notification.id)
        } catch (error) {
          if (error.code !== 'group_reply_frozen_identity_conflict') throw error
          failures.set(notification.id, { id: notification.id, code: error.code })
          return false
        }
      }
    }
    const previousOutbound = residentStore?.getGroup(notification.payload.conversationId)?.outbox.find(item => item.outboundId === notification.id)
    if (notification.state === 'failed' && notification.deliveryError?.knownNotSent === true && notification.deliveryError?.retryable === true) {
      let reason, taskIds = previousOutbound?.taskIds ?? []
      if (previousOutbound?.supersededByOutboundId || previousOutbound?.status === 'superseded' || previousOutbound?.recallStatus) reason = 'superseded'
      else if ((notification.payload.replyKind ?? previousOutbound?.replyKind) === 'confirmation') {
        const linked = await Promise.all(taskIds.map(taskId => query('task.get', { taskId })))
        if (!taskIds.length || !previousOutbound?.decisionId || linked.some(task => !task || !task.appliedOperations?.some(id => id.startsWith(`${previousOutbound.decisionId}:action:`)))) reason = 'confirmation-reassessment-required'
        else if (linked.every(task => task.status !== 'active' || task.control === 'cancelled')) reason = 'task-terminal'
      } else if (!(notification.payload.replyKind ?? previousOutbound?.replyKind)) reason = 'confirmation-reassessment-required'
      if (reason) {
        const retired = await command('notification.retireUnsent', { notificationId: notification.id, reason, taskIds,
          evidenceRef: `unsent-intent:${previousOutbound?.decisionId ?? notification.id}:${reason}` })
        await projectTaskNotification({ residentStore, notification: retired.result.notification })
        return false
      }
    }
    const blocked = ['prepared', 'failed'].includes(notification.state)
      && (previousOutbound?.supersededByOutboundId || previousOutbound?.status === 'superseded' || previousOutbound?.recallStatus)
    if (blocked) await projectTaskNotification({ residentStore, notification })
    return !blocked
  }
  async function scanNotifications(attempted) {
    for (let notification of await query('notification.list')) {
      if (closed) return
      // 历史协调通知保持原账，不发送、不刷新、不自动重试。
      if (notification.kind === 'coordination') { await projectTaskNotification({ residentStore, notification }); continue }
      // 只释放被新来源暂缓的尝试；未知发送和限流的本轮去重不受影响。
      if (sourceHeldNotifications.has(notification.id) && sourceHeldNotifications.get(notification.id) < sourceProcessingRevision) {
        attempted?.delete(notification.id)
      }
      if (notification.state === 'superseded') { await projectTaskNotification({ residentStore, notification }); continue }
      if (notifications?.recall && notification.kind === 'question' && notification.payload.audience === 'operator'
        && notification.state === 'delivered' && notification.recall?.state !== 'recalled'
        && !(Date.parse(notification.recall?.nextAttemptAt ?? '') > Date.now())
        && retryReady(notification.id) && !inflightNotifications.has(notification.id) && !attempted?.has(notification.id)) {
        const task = await query('task.get', { taskId: notification.taskId })
        const request = task?.humanRequests?.find(item => item.requestId === notification.payload.humanRequestId)
        if (request?.status === 'answered' && request.replyChannel === 'web') {
          attempted?.add(notification.id)
          continueNotificationDelivery(track(inflightNotifications, notification.id, () => recallTaskOperatorNotification({ notification, notifications, command })), attempted)
        }
      }

      if (!await notificationDeliveryGate(notification)) continue
      await projectTaskNotification({ residentStore, notification })
      // 投影的 await 期间原投递可能已完成；使用命令更新的当前态，不能再按旧 starting 快照回读。
      notification = notificationCache.get(notification.id) ?? notification
      if (notification.state === 'delivered' && failures.get(notification.id)?.code === 'TASK_NOTIFICATION_INCOMPLETE_READBACK')
        failures.delete(notification.id)
      if (notification.state === 'delivered' || notification.state === 'failed' && !(notification.deliveryError?.knownNotSent && notification.deliveryError?.retryable)) continue
      const readbackOnly = ['unknown', 'starting'].includes(notification.state)
      if(!ctx.get('channels').canDeliver(notification)){failures.set(notification.id,{id:notification.id,code:'CHANNEL_TRANSPORT_UNAVAILABLE'});continue}
      if ((readbackOnly ? notificationReadbacks.size > 0 : notificationSends.size > 0 || Date.now() < notificationTransportRetryAt) || !retryReady(notification.id) || Date.parse(notification.nextAttemptAt ?? '') > Date.now() || inflightNotifications.has(notification.id) || attempted?.has(notification.id)) continue
      attempted?.add(notification.id)
      if (readbackOnly) notificationReadbacks.add(notification.id)
      else notificationSends.add(notification.id)
      continueNotificationDelivery(track(inflightNotifications, notification.id, async () => {
        const processingRevision = sourceProcessingRevision
        try {
          const result = await deliverTaskNotification({ notification, notifications, command,
            onStage: notificationStage, deferReadback: true })
          if (result?.acknowledged) attempted?.delete(notification.id)
          if (result?.sourcePending) sourceHeldNotifications.set(notification.id, processingRevision)
          else sourceHeldNotifications.delete(notification.id)
        }
        catch (error) {
          if (error.notificationPhase === 'send' && (error.serverErrorCode === 'RATE_LIMIT_ERROR' || error.code === 'RATE_LIMIT_ERROR' || error.knownNotSent === true && error.retryable !== false)) notificationTransportRetryAt = Math.max(notificationTransportRetryAt, Date.parse(error.notificationRetryAt) || Date.now() + 60000)
          throw error
        } finally { notificationSends.delete(notification.id); notificationReadbacks.delete(notification.id) }
      }), attempted)
    }
  }
  function recordRouterFailure(id,error){failures.set('router:'+id,{id:'router:'+id,conversationId:id,code:error.code??error.message})}
  function syncRouterFailures(){
    for(const [id,error]of residentRouter.errors)recordRouterFailure(id,error)
    for(const [id,error]of failures)if(id==='router:'+error.conversationId&&!residentRouter.errors.has(error.conversationId))failures.delete(id)
  }
  async function recover() {
    if (closed) return { failures: [] }
    if (recovering) return recovering
    ctx.get?.('reflection')?.scan()
    return recovering = (async () => {
      await disableSingleProviderRetries()
      for(const task of await query('task.list'))for(const row of task.effectReconciliations??[])if(row.state==='prepared'){
        try{await admitTask(task.taskId,async()=>projectEffectReconciliation(task,row))}catch(error){failures.set('effect-reconciliation:'+task.taskId,{id:task.taskId,code:error.code??'TASK_EFFECT_RECONCILIATION_RECOVERY_FAILED'})}
      }
      await disableSingleProviderRetries()
      if(archives)for(const taskId of archives.errors.keys())archives.schedule(taskId)
      // A process restart cannot prove detached external operations stopped. Recover only native handles known absent;
      // unfinished operation rows remain unknown and fence execution until explicit readback reconciliation.
      const pending = await query('recovery.pending')
      for (const task of pending.tasks) if (task.recovering && !ctx.agents.get(task.sessionId) && !ctx.piAuthority.describe(task.sessionId)){
        if(task.liveSupplements?.some(row=>row.state==='pending'&&row.leaseEpoch===task.leaseEpoch)){
          const stored=await ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
          const manager=SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(stored.entries))
          for(const admission of committedLiveSupplementAdmissions(manager,task))await command('task.supplement.admitted',admission,`task-supplement-admitted:${task.taskId}:${admission.messageId}`)
        }
        await command('task.drained', { binding: await query('task.binding', { taskId: task.taskId }) })
      }
      for (const group of pending.groups ?? []) if (group.recovering && !ctx.agents.get(group.sessionId) && !ctx.piAuthority.describe(group.sessionId))
        await command('group.drained', { binding: { kind: 'group-session', groupId: group.groupId, sessionId: group.sessionId, leaseEpoch: group.leaseEpoch, sessionBound: group.sessionBound } })

      await refreshTasks()
      for (const task of taskCache.values()) if (!task.archivedAt && task.status === 'active' && task.control === 'active')
        for (const request of task.humanRequests ?? []) if (request.status === 'waiting-reply') await queueHumanRequest(task, request)
      for(const candidate of recoveryCandidates)failures.set(candidate.taskId,{id:candidate.taskId,code:'TASK_LEGACY_OPERATION_REVIEW_REQUIRED'})
      for (const task of await query('task.list')) if (task.sessionBound) {
        const cwd = await taskWorkspace(root,task.taskId,task)
        await attachWorkspace(task.sessionId, cwd, task.title)
      }

      for(const group of residentStore.listGroups())for(const outbound of group.outbox){
        if(outbound.status!=='pending'||outbound.matterUnitRefs?.length!==1||await query('notification.get',{notificationId:outbound.outboundId}))continue
        const ref=outbound.matterUnitRefs[0]
        const candidates=group.messages.flatMap(message=>(message.units??[]).filter(unit=>unit.fixedTopic&&unit.unitId===ref.unitId&&unit.unitRevision===ref.unitRevision&&message.activeUnitRefs?.some(active=>active.unitId===unit.unitId&&active.unitRevision===unit.unitRevision))
          .filter(unit=>{const id=fixedUnitRequestId(group.groupId,message,unit);return outbound.outboundId===id||outbound.outboundId===platformScheduleOutboundId(id)}).map(unit=>({message,unit})))
        if(!candidates.length)continue
        try{
          if(candidates.length!==1)fail('fixed_topic_reply_source_invalid')
          // 没有 SQL 发送账时，仅恢复有可靠未发证据的冻结内容；未知发送不能重发。
          if(outbound.sendStartedAt||outbound.sendAttemptCount>0||outbound.deliveryAttemptCount>0||outbound.sendReceipt||outbound.deliveredMessageId||['starting','unknown','delivered'].includes(outbound.notificationState))fail('fixed_topic_reply_delivery_unproven')
          const {message,unit}=candidates[0]
          await prepareDirectPlatformReply({...outbound,groupId:group.groupId,fixedTopic:unit.fixedTopic,sourceVersion:message.messageVersion,topicRefs:outbound.topicRefs??[],taskIds:outbound.taskIds??[]})
          failures.delete(outbound.outboundId)
        }catch(error){failures.set(outbound.outboundId,{id:outbound.outboundId,code:error.code??error.message})}
      }
      await residentRouter.recover()
      syncRouterFailures()
      for (const source of await query('source.list')) {
        if (!source.routed) void kickGroup(source.groupId)
      }

      for (const task of await query('task.list')) void kickTask(task.taskId)

      void schedulePending()
      await deliverNotifications()
      return { status:failures.size?'degraded':'ok', failures: [...failures.values()], recovery: pending }
    })().finally(() => { recovering = undefined })
  }
  async function webTopicAction(args,task,kind){
    if(!config.webActorId)fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
    if(!args.requestId)fail('TASK_SESSION_REQUEST_ID_REQUIRED')
    if(args.topicRefs?.length)fail('TOPIC_ROUTING_RETIRED')
    if(kind==='task-context')assertTaskContextSemantics(args)
    if(!task)fail('TASK_WEB_CREATE_USE_DIRECT_ENTRY')
    // 无群 Web 输入沿用建任务时的来源作用域，不将其注册为渠道群。
    const groupId=task.groupId??'task:'+task.taskId
    ctx.get('channels').assertGroupTarget(groupId)
    if(task.groupId&&!residentStore.getGroup(task.groupId))fail('group_not_subscribed')
    const sourceId='web:'+hash([config.webActorId,groupId,args.requestId]),text=args.context?.trim()||args.objective||args.reason||''
    const request=clean(args),operationId=residentOperationId(groupId,args.requestId)
    await admitTask(task.taskId,async(oldTask,oldExecutions)=>{
      const current=await requireTask(task.taskId),previous=await query('source.get',{sourceId})
      if(previous&&(hash(previous.requestIdentity?.request)!==hash(request)||previous.requestIdentity?.kind!==kind))fail('DYNAMIC_COMMAND_ID_CONFLICT')
      const directKind=kind==='task-reopen'?'reopen':kind==='task-cancel'?'control':args.progressImpact==='preserve'&&args.authorizationChange!=='changed'?'supplement':'revise'
      const action=previous?.requestIdentity?.action??{kind:'task.'+directKind,taskId:task.taskId,
        expectedRequirementRevision:args.expectedRequirementRevision??current.requirementRevision,expectedControlRevision:args.expectedControlRevision??current.controlRevision,
        text,...(directKind==='control'?{control:'cancelled',reason:text}:{}),
        ...(args.objective?{objective:args.objective}:{}),...(args.title?{title:args.title}:{}),...(args.acceptanceCriteria?{requirements:args.acceptanceCriteria}:{})}
      const source=previous??(await command('source.record',{sourceId,groupId,messageId:'web:'+args.requestId,actorId:config.webActorId,text,timestamp:'',channel:'web',requestIdentity:{request,kind,action}},'source:'+sourceId)).result.source
      // 原请求及版本已冻结；已提交动作直接复用收据，不重算旧 request 或 liveBinding。
      const prior=await query('receipt.get',{id:operationId})
      let receipt
      if(prior)receipt={...prior,replayed:true}
      else{
        const {kind:actionKind,text:input,...fields}=action
        const liveBinding=actionKind==='task.supplement'?taskSessions.liveBinding?.(task.taskId):undefined
        receipt=await command(actionKind,{...fields,operationId,sourceRefs:[...new Set([...current.sourceRefs,sourceId])],
          ...(actionKind==='task.control'?{}:{request:[current.request,'[操作员输入]',input].join(String.fromCharCode(10,10))}),
          ...(actionKind==='task.supplement'?{messageId:operationId,text:input,...(liveBinding?{liveBinding}:{})}:{})},operationId)
      }
      const originalLease=!current.drained&&current.leaseEpoch===receipt.result.task.leaseEpoch&&current.requirementRevision===receipt.result.task.requirementRevision&&current.controlRevision===receipt.result.task.controlRevision
      if(action.kind!=='task.supplement'&&(!receipt.replayed||originalLease))await cancelLiveTask(task.taskId,oldTask,oldExecutions)
      await materializeSource(task.taskId,source)
      const latest=await requireTask(task.taskId);taskCache.set(task.taskId,topicTaskView(latest))
      if(action.kind==='task.supplement'&&taskSessions.liveBinding?.(task.taskId)){
        const sources=(await Promise.all(latest.sourceRefs.map(sourceId=>query('source.get',{sourceId})))).filter(Boolean),materials=await Promise.all(sources.map(source=>materializeSource(task.taskId,source)))
        await taskSessions.supplement({task:await taskInputWithDependencies(latest),sources,materials})
      }
      await command('source.routed',{sourceId,receipt:[{taskId:task.taskId,operationId}]},'web-task-source-routed:'+sourceId)
    },groupId)
    void hostScheduler(()=>schedulePending());return requireTask(task.taskId)
  }
  async function listHumanRequests(options) {
    const page=options?await query('observer.page',{collection:'authorizations',...options}):null
    const notices=page?page.items.map(task=>task.observerNotice).filter(Boolean):await query('notification.list')
    const result=(page?page.items:await query('task.list')).flatMap(task => (task.humanRequests ?? []).map(request => ({ ...request, audience: request.audience ?? 'operator',
      taskSessionRequest: true, taskId: task.taskId, groupId: task.groupId, objective: task.objective,
      notification: (() => { const notice = notices.find(item => item.taskId === task.taskId && item.payload.humanRequestId === request.requestId && item.payload.audience === 'operator')
        return notice ? { notificationId: notice.id, state: notice.state, recall: notice.recall ?? null, delivery: notice.state === 'delivered' ? notice.receipt : null } : undefined })(),
      waitingReason: request.question, evidence: request.evidence ?? [], attemptedActions: request.attemptedActions ?? [],
      decidedAt: request.answeredAt, decision: request.status === 'answered' ? 'answered' : undefined,
      decisionSource: request.status === 'answered' ? request.replyChannel : undefined })))
    return page?{...page,items:result}:result
  }

  async function respondHumanRequest(args) {
    if (!config.webActorId) fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
    if (!args.requestId?.trim() || !args.reply?.trim()) fail('TASK_HUMAN_REPLY_REQUIRED')
    const task = await requireTask(args.taskId)
    const sourceId = `web-human:${hash([config.webActorId, task.taskId, args.humanRequestId, args.requestId])}`
    const receiptId = `human-reply:${sourceId}`
    const prior = await query('receipt.get', { id: receiptId })
    const request = task.humanRequests?.find(request => request.requestId === args.humanRequestId)
    if (!request) fail('DYNAMIC_NOT_FOUND')
    if (!prior && (request.status !== 'waiting-reply' || args.expectedRequirementRevision !== task.requirementRevision
      || args.expectedControlRevision !== task.controlRevision)) fail('DYNAMIC_HUMAN_REQUEST_STALE')
    if (prior) {
      const originalSource = await query('source.get', { sourceId })
      if (originalSource?.text !== args.reply || hash(originalSource.requestIdentity?.nativeFailureResolutions ?? []) !== hash(args.nativeFailureResolutions ?? [])
        || hash(originalSource.requestIdentity?.nativeRestartResolutions ?? []) !== hash(args.nativeRestartResolutions ?? [])
        || hash(originalSource.requestIdentity?.artifactScopeCorrectionRequest ?? null) !== hash(args.artifactScopeCorrection ?? null)
        || hash(originalSource.requestIdentity?.executionPermissionCorrectionRequest ?? null) !== hash(args.executionPermissionCorrection ?? null)) fail('DYNAMIC_COMMAND_ID_CONFLICT')
      if (!args.checkOnly) return taskDTO(prior.result.task)
    }
    let executionPermissionCorrection
    if (args.executionPermissionCorrection) {
      const correction = args.executionPermissionCorrection
      const execution = await query('execution.get', { executionId: correction.executionId })
      if (request.audience !== 'operator'
        || execution?.taskId !== task.taskId || execution.inputVersion !== correction.expectedInputVersion
        || !execution.drained || execution.recovering || !['succeeded', 'failed', 'cancelled', 'stale'].includes(execution.status)
        || executionBackend(execution) !== 'dsh' || !['read-only', 'workspace-write', 'danger-full-access'].includes(correction.mode)
        || !correction.reason?.trim() || (await query('operation.list', { taskId: task.taskId })).some(operation => operation.executionId === execution.executionId && !['succeeded', 'failed', 'cancelled'].includes(operation.state))) fail('TASK_EXECUTION_PERMISSION_CORRECTION_SCOPE')
      executionPermissionCorrection = { ...correction, reason: correction.reason.trim(), actorId: config.webActorId,
        requirementRevision: task.requirementRevision, controlRevision: task.controlRevision }
    }
    let artifactScopeCorrection
    if (args.artifactScopeCorrection) {
      const correction = args.artifactScopeCorrection
      const state = await query('coordination.get', { coordinationId: correction.coordinationId })
      if (request.audience !== 'operator' || config.webActorId !== task.ownerActorId
        || state.coordination.groupId !== task.groupId || state.coordination.revision !== correction.expectedRevision
        || state.coordination.state !== 'active' || !correction.reason?.trim()) fail('TASK_ARTIFACT_CORRECTION_SCOPE')
      const members = state.members.filter(member => !member.observation && member.control !== 'cancelled'
        && !['cancelled', 'superseded', 'template'].includes(member.state))
      if (!members.some(member => member.taskId === task.taskId)) fail('TASK_ARTIFACT_CORRECTION_SCOPE')
      for (const member of members) {
        const sibling = await requireTask(member.taskId)
        if (sibling.ownerActorId !== task.ownerActorId || sibling.groupId !== task.groupId) fail('TASK_ARTIFACT_CORRECTION_SCOPE')
      }
      artifactScopeCorrection = { coordinationId: correction.coordinationId, revision: correction.expectedRevision,
        artifactRoot: taskFilePath(root, correction.coordinationId, 'outputs'), reason: correction.reason.trim(), actorId: config.webActorId }
    }
    const resolutions = args.nativeFailureResolutions ?? []
    const restartResolutions = args.nativeRestartResolutions ?? []
    const allResolutions = [...resolutions, ...restartResolutions]
    if (allResolutions.length > 8 || new Set(allResolutions.map(item => item.operationId)).size !== allResolutions.length) fail('DYNAMIC_ARGUMENT_INVALID')
    if (allResolutions.length && request.audience !== 'operator') fail('TASK_OPERATION_OPERATOR_REQUIRED')
    const proofs = [], requiredScopeProbes = []
    for (const resolution of resolutions) {
      const operation = await query('operation.get', { operationId: resolution.operationId })
      if (operation?.taskId !== task.taskId) fail('TASK_OPERATION_SCOPE_MISMATCH')
      if (operation.state === 'failed' && operation.result.operatorSourceId === sourceId
        && hash(operation.result.previousObservation) === resolution.expectedOperationDigest) continue
      if (hash(operation) !== resolution.expectedOperationDigest) fail('DYNAMIC_OPERATION_SCOPE_STALE')
      const executions = await query('execution.list', { taskId: task.taskId })
      if (executionBackend(executions.find(item => item.executionId === operation.executionId)) === 'claude-code') fail('CLAUDE_OPERATION_READBACK_REQUIRED')
      const proof = await inspectInvestigatedNativeFailure({ ctx, operation, executions,
        execution: executions.find(item => item.executionId === operation.executionId) })
      if (!proof) fail('DYNAMIC_OPERATION_EVIDENCE_INSUFFICIENT')
      proofs.push({ operationId: operation.operationId, proof })
    }
    for (const resolution of restartResolutions) {
      const operation = await query('operation.get', { operationId: resolution.operationId })
      if (operation?.taskId !== task.taskId) fail('TASK_OPERATION_SCOPE_MISMATCH')
      if (hasRestartIsolation(operation) && operation.recoverySettlement.operatorSourceId === sourceId
        && operation.recoverySettlement.proof.operationDigest === resolution.expectedOperationDigest) continue
      if (hash(operation) !== resolution.expectedOperationDigest) fail('DYNAMIC_OPERATION_SCOPE_STALE')
      const executions = await query('execution.list', { taskId: task.taskId })
      const execution = executions.find(item => item.executionId === operation.executionId)
      if (executionBackend(execution) !== 'dsh') fail('CLAUDE_OPERATION_READBACK_REQUIRED')
      if (resolution.scopeEvidence && (!resolution.scopeEvidence.probeExecutionId || !resolution.scopeEvidence.probeCallId)) {
        if (!args.checkOnly) fail('DYNAMIC_SCOPE_ISOLATION_PROBE_REQUIRED')
        const plan = await inspectIsolatedHostRestart({ ctx, operation, execution, executions, scopeEvidence: resolution.scopeEvidence, planOnly: true, workspaceRoot: root })
        if (!plan) fail('DYNAMIC_SCOPE_ISOLATION_UNSUPPORTED')
        requiredScopeProbes.push({ operationId: operation.operationId, readbackOperationId: operation.operationId,
          command: plan.probe.command, scriptDigest: plan.probe.scriptDigest, scope: plan.probe.spec.scope,
          managedCall: { name: 'execution_restart_scope_probe', arguments: { expectedOperationDigest: resolution.expectedOperationDigest,
            expectedScriptDigest: plan.probe.scriptDigest, scopeEvidence: Object.fromEntries(['hostPid', 'hostLogPath', 'hostLogSha256',
              'producerScopeReviewed', 'localEffectsOnlyConfirmed', 'excludeOriginalSourcesConfirmed', 'hostExit', 'postgresWrapper'].filter(key => resolution.scopeEvidence[key] !== undefined).map(key => [key, resolution.scopeEvidence[key]])) } } })
        continue
      }
      if (!resolution.scopeEvidence && !ctx.get?.('nativeJobRecovery')) fail('DYNAMIC_SCOPED_ISOLATION_EVIDENCE_REQUIRED')
      const proof = await inspectIsolatedHostRestart({ ctx, operation, execution, executions, scopeEvidence: resolution.scopeEvidence, workspaceRoot: root })
      if (!proof) fail('DYNAMIC_OPERATION_EVIDENCE_INSUFFICIENT')
      if (!args.checkOnly && resolution.expectedIsolationDigest !== hash(proof.isolation)) fail('DYNAMIC_ISOLATION_EVIDENCE_STALE')
      proofs.push({ operationId: operation.operationId, proof })
    }
    if (args.checkOnly) return { checkOnly: true, writes: 0, taskId: task.taskId, ready: requiredScopeProbes.length === 0, requiredScopeProbes,
      ...(executionPermissionCorrection ? { executionPermissionCorrection } : {}),
      ...(artifactScopeCorrection ? { artifactScopeCorrection } : {}),
      resolutions: proofs.filter(({ proof }) => proof.kind !== 'native-host-restart-isolated').map(({ operationId, proof }) => ({ operationId, operationDigest: proof.operationDigest,
        resultSequence: proof.resultSequence, turnEndSequence: proof.turnEndSequence,
        investigationCount: new Set(proof.observations.map(item => item.executionId)).size,
        outcome: 'failed', partialEffectsPossible: true })),
      restartResolutions: proofs.filter(({ proof }) => proof.kind === 'native-host-restart-isolated').map(({ operationId, proof }) => ({ operationId,
        operationDigest: proof.operationDigest, isolationDigest: hash(proof.isolation), outcome: 'unknown', partialEffectsPossible: true, noReplay: true,
        unblocksRecovery: true, isolationReceiptId: proof.isolation.receiptId })) }
    const source = { sourceId, groupId: task.groupId, messageId: sourceId, actorId: config.webActorId,
      text: args.reply, timestamp: '', channel: 'web',
      ...(allResolutions.length || artifactScopeCorrection || executionPermissionCorrection ? { requestIdentity: { humanRequestId: args.humanRequestId,
        ...(executionPermissionCorrection ? { executionPermissionCorrectionRequest: args.executionPermissionCorrection, executionPermissionCorrection } : {}),
        ...(resolutions.length ? { nativeFailureResolutions: resolutions } : {}),
        ...(restartResolutions.length ? { nativeRestartResolutions: restartResolutions } : {}),
        ...(artifactScopeCorrection ? { artifactScopeCorrectionRequest: args.artifactScopeCorrection, artifactScopeCorrection } : {}) } } : {}) }
    const response = { taskId: task.taskId, requestId: args.humanRequestId, sourceId,
      ...(executionPermissionCorrection ? { executionPermissionCorrection } : {}),
      expectedRequirementRevision: args.expectedRequirementRevision, expectedControlRevision: args.expectedControlRevision,
      ...(artifactScopeCorrection ? { artifactScopeCorrection } : {}) }
    let result
    if (allResolutions.length) result = await command('task.human.resolve-failures', { ...response, source, resolutions: proofs }, receiptId)
    else if (executionPermissionCorrection) result = await command('task.human.respond', { ...response, source }, receiptId)
    else {
      await command('source.record', source, `source:${sourceId}`)
      result = await command('task.human.respond', response, receiptId)
      await command('source.routed', { sourceId, receipt: [{ taskId: task.taskId, humanRequestId: args.humanRequestId }] }, `human-source-routed:${sourceId}`)
    }
    void deliverNotifications().catch(error => {
      ctx.logger?.warn?.(`task-session recall scan ${task.taskId}: ${error.code ?? error.message}`)
    })
    void kickTask(task.taskId)
    return taskDTO(result.result.task)
  }
  async function respondPrivateHumanReply(message) {
    if (!message.messageId || !message.text?.trim() || !message.quotedMessage?.messageId) fail('TASK_HUMAN_REPLY_REQUIRED')
    const requests = await listHumanRequests()
    const request = requests.find(item => item.audience === 'operator' && item.notification?.delivery?.messageId === message.quotedMessage.messageId)
    if (!request) fail('TASK_HUMAN_PRIVATE_REQUEST_NOT_FOUND')
    const delivery = request.notification.delivery
    if (delivery.conversationId !== message.groupId || delivery.senderActorId !== conversationMessageActorId(message)) fail('DYNAMIC_HUMAN_RESPONSE_FORBIDDEN')
    const sourceId = `private-human:${hash([request.requestId, message.groupId, message.messageId])}`, receiptId = `human-reply:${sourceId}`
    const task = await requireTask(request.taskId), prior = await query('receipt.get', { id: receiptId })
    if (!prior && (request.status !== 'waiting-reply' || request.requirementRevision !== task.requirementRevision
      || request.controlRevision !== task.controlRevision)) fail('DYNAMIC_HUMAN_REQUEST_STALE')
    await command('source.record', { sourceId, groupId: task.groupId, messageId: message.messageId,
      actorId: conversationMessageActorId(message), text: message.text, timestamp: message.occurredAt, channel: 'private',
      quote: { messageId: delivery.messageId, conversationId: delivery.conversationId } }, `source:${sourceId}`)
    if (prior) return taskDTO(task)
    const result = await command('task.human.respond', { taskId: task.taskId, requestId: request.requestId, notificationId: request.notification.notificationId,
      sourceId, expectedRequirementRevision: request.requirementRevision, expectedControlRevision: request.controlRevision }, receiptId)
    await command('source.routed', { sourceId, receipt: [{ taskId: task.taskId, humanRequestId: request.requestId }] }, `human-source-routed:${sourceId}`)
    if (!prior) void kickTask(task.taskId)
    return taskDTO(result.result.task)
  }
  let stopInboxProjection
  try {
   observerGroupPage=createObserverGroupPages({
    indexPath:config.dbPath+'.observer-inbox.sqlite',
    readGroup:groupId=>residentStore.getGroup(groupId),readRequests:groupId=>[],
    readTask:taskId=>taskCache.get(taskId),isOwnNotification,
    readSources:async(groupId,messages)=>Promise.all((await query('observer.message-list-contexts',{groupId,messages,messageIds:messages.map(item=>item.messageId)})).sources.map(async source=>({...source,directRouting:await query('router.source-status',{sourceId:source.sourceId})})))
  })
   stopInboxProjection=residentStore.onGroupCommitted?.(observerGroupPage.update)
   for(const group of residentStore.listGroups())observerGroupPage.update({group})
   await observerGroupPage.ready()
  }catch(error){
    closed=true
    stopInboxProjection?.()
    await Promise.allSettled([Promise.all([triage.close(),residentRouter.close(),platformSchedules.close()]),taskSessions.close()])
    stopObservation?.();await observationQueue.close()
    await observerGroupPage?.close()
    if(!suppliedStore)await store.close()
    throw error
  }

  const observerAlerts=createObserverAlertPages({failures,tasks:taskCache,operations:operationCache,notifications:notificationCache,groups:()=>residentStore.listGroups()})

  const unifiedIngress=async input=>{
    if(!['chat','chat-room'].includes(input?.type))return ingest(input)
    const channels=ctx.get('channels'),identity=channels.identity(input)
    return channels.withInputTarget(identity.envelope,async()=>{
    // 只读派生 scope；身份未决必须在消息事实和来源持久登记之前暂缓。
    if(await ownNotificationAtIngress({groupId:identity.sessionId,messageId:identity.envelope.messageId}))return {accepted:false,processing:'ignored',reason:'own-notification',channelType:identity.envelope.type,conversationId:identity.envelope.conversationId}
    const channel=await channels.registerConversation(input),e=channel.envelope
    const group=residentStore.getGroup(channel.sessionId),configuredResponsibility=ctx.get('channels').responsibility(channel.sessionId)
    if(!group)await residentStore.subscribe({groupId:channel.sessionId,name:e.conversationName??(e.type==='chat-room'?'未命名群聊':'未命名单聊'),responsibility:configuredResponsibility??'Respect authenticated channel participants and the current user request.'})
    else if(e.conversationName&&group.name!==e.conversationName||configuredResponsibility!==undefined&&group.responsibility!==configuredResponsibility)await residentStore.updateGroup({groupId:channel.sessionId,...e.conversationName?{name:e.conversationName}:{},...configuredResponsibility!==undefined?{responsibility:configuredResponsibility}:{}})
    const principal=senderId=>channels.identity({...e,senderId}).principal
    const occurredAt=channels.groupContext(channel.sessionId).messageFacts[e.messageId].occurredAt
    const response=await ingest({
      groupId:channel.sessionId,messageId:e.messageId,messageVersion:e.messageVersion??1,actorId:channel.principal,...e.senderName?{senderName:e.senderName}:{},text:e.text,
      sourceKind:'channel',channelType:e.type,channelId:e.channelId,occurredAt,timestamp:occurredAt,
      ...e.resourceRefs?{resourceRefs:e.resourceRefs}:{},
      ...e.quotedMessage?{quotedMessage:{messageId:e.quotedMessage.messageId,text:e.quotedMessage.text??'',
        ...e.quotedMessage.senderId?{actorId:principal(e.quotedMessage.senderId)}:{}}}:{},
      ...typeof e.mentionedAgent==='boolean'?{mentionedAgent:e.mentionedAgent}:{},
      ...e.mentions?{mentions:e.mentions.map(principal)}:{},
      ...e.platformFlags?{platformFlags:e.platformFlags}:{},automated:e.platformFlags?.automated===true,
    },true)
    return {...response,channelType:e.type,conversationId:e.conversationId}
    })
  }
  const detachIngress=ctx.get('channels').attachIngress(unifiedIngress)
  // 短准入栅栏贯穿异步权威读取与发布；原结果、回查和排空落账继续放行。
  async function withChannelTargetSwitch({channelId,nextTarget,includeAllScopes=false},work,{activate=false,publish}={}){
    const channels=ctx.get('channels'),hold=channels.holdChannelTarget(channelId,nextTarget,{includeAllScopes})
    const blocked=()=>fail('DINGTALK_CHANNEL_SWITCH_BLOCKED')
    try{
      const groups=new Set(hold.groups)
      const assertFlights=()=>{
        if(hold.hasInflight()||[...admissionGroups.values(),...targetCommands.values()].some(group=>groups.has(group))||hold.groups.some(group=>inflightGroups.has(group)||residentRouter.hasInflight(group)||platformSchedules.hasInflight(group)))blocked()
      }
      assertFlights()
      for(const groupId of groups){
        const tasks=await query('task.list',{groupId,archived:'all'})
        for(const task of tasks){
          if(admissions.has(task.taskId)||inflightTasks.has(task.taskId)||(task.status!=='completed'&&task.control!=='cancelled')||!task.drained||task.recovering||task.effectReconciliations?.some(row=>row.state==='prepared'))blocked()
          const effects=await query('task.blockers',{taskId:task.taskId})
          if(effects.executions.length||effects.operations.length)blocked()
        }
        const metadata=await query('observer.group-metadata',{groupId}),sources=await Promise.all((metadata.sources??[]).map(source=>query('source.get',{sourceId:typeof source==='string'?source:source.sourceId})))
        const latest=new Map()
        for(const source of sources.filter(Boolean)){const prior=latest.get(source.messageId);if(!prior||source.version>prior.version)latest.set(source.messageId,source)}
        if([...latest.values()].some(source=>!source.routed||source.processingPending||source.triageHold||source.archiveRestoreHold))blocked()
        const router=await query('router.get',{conversationId:groupId})
        if(await query('router.inbox-count',{conversationId:groupId})>0||router&&(router.phase!=='active'||router.cursor>router.lastHandoffCursor))blocked()
        const notifications=[...await query('notification.list',{groupId}),...(await Promise.all(tasks.map(task=>query('notification.list',{taskId:task.taskId})))).flat()]
        if(notifications.some(row=>['prepared','starting','unknown'].includes(row.state)||row.state==='failed'&&row.deliveryError?.knownNotSent&&row.deliveryError?.retryable))blocked()
        if(residentStore.listPlatformSchedules(groupId).some(binding=>!binding.outcome))blocked()
      }
      assertFlights()
      const result=await work()
      assertFlights()
      if(activate){hold.activate();publish?.()}
      return result
    }finally{hold.release()}
  }
  const api = {
    withChannelTargetSwitch,
    async resumeRouterBatch(args){
      if(hostAgents?.currentInitiator?.()!==undefined)fail('TASK_SESSION_HOST_CONTEXT_REQUIRED')
      try{return await hostScheduler(()=>residentRouter.resumeRouterBatch(args))}finally{syncRouterFailures()}
    },
    async retryNotification({ groupId, notificationId, expectedToken }) {
      const notification = typeof notificationId === 'string' && notificationId
        ? await query('notification.get', { notificationId }) : null
      if (!groupId || !residentStore.getGroup(groupId) || !notification || notification.payload.audience === 'operator'
        || notification.payload.conversationId !== groupId) throw notificationRecoveryError('TASK_NOTIFICATION_NOT_FOUND', 404)
      if (notification.kind === 'coordination') throw notificationRecoveryError('INDEPENDENT_COORDINATION_RETIRED')
      if (inflightNotifications.has(notificationId)) throw notificationRecoveryError('TASK_NOTIFICATION_RECOVERY_IN_PROGRESS')
      if (taskNotificationRecovery(notification).expectedToken !== expectedToken) throw notificationRecoveryError('DYNAMIC_NOTIFICATION_RECOVERY_STALE')
      const pending = Promise.resolve().then(async () => {
        if (!await notificationDeliveryGate(notification)) throw notificationRecoveryError('TASK_NOTIFICATION_RECOVERY_FORBIDDEN')
        const processingRevision = sourceProcessingRevision
        const result = await retryTaskNotification({ notification, expectedToken, notifications, command, onStage: notificationStage })
        if (result?.sourcePending) sourceHeldNotifications.set(notificationId, processingRevision)
        else sourceHeldNotifications.delete(notificationId)
        failures.delete(notificationId)
        return { groupId, notificationId, ...result }
      })
      // Expected CAS/gate refusals are not transport failures; effect diagnostics remain durable.
      const settled = pending.finally(() => inflightNotifications.delete(notificationId))
      inflightNotifications.set(notificationId, settled)
      continueNotificationDelivery(settled, new Set([notificationId]))
      return settled
    },
    observerGroupPage,
    listObserverGroups:()=>residentStore.listGroups().map(({groupId,name,responsibility,residentSessionId})=>({groupId,name,responsibility,residentSessionId})),
    listAuthorizationRequests: listHumanRequests, respondHumanRequest, respondPrivateHumanReply,
    taskArchiveStatus:taskId=>({pending:archives?.tails.has(taskId)??false,error:archives?.errors.get(taskId)??null}),
    store, ingest:unifiedIngress, recover, taskDetail, taskExecutions, isOwnNotification,
    async taskIdentity(taskId) { return await query('task.get', { taskId }) ? { taskId, legacyReadonly: false } : null },
    messageProcessingRequests: groupId => [],
    async messageProcessingSources(groupId) {
      const [sources, notifications] = await Promise.all([
        query('source.list', { groupId }), query('notification.list', { groupId }),
      ])
      return Promise.all(messageProcessingSources(retiredSourceOwnership(sources,residentStore.getGroup(groupId)?.sourceDispatchOwnership,groupId),notifications,groupId).map(async source=>({...source,directRouting:await query('router.source-status',{sourceId:source.sourceId})})))
    },
    async updateMessageRoutingHold(){fail('TOPIC_ROUTING_RETIRED')},
    async retryMessageProcessing(args){
      ctx.get('channels').assertGroupTarget(args.groupId)
      if(!['triage','router'].includes(args.phase))fail('TOPIC_ROUTING_RETIRED')
      const source=await query('source.get',{sourceId:args.sourceId})
      if(!source||source.groupId!==args.groupId||source.messageId!==args.messageId||source.version!==args.messageVersion)fail('MESSAGE_RETRY_STALE')
      if(args.phase==='triage'&&source.routed)fail('MESSAGE_RETRY_STALE')
      await kickGroup(args.groupId)
      return {groupId:args.groupId,sourceId:source.sourceId,phase:args.phase,status:'attempted'}
    },

    async listExecutionTrace(filter){
      if(filter.taskId&&!await query('task.get',{taskId:filter.taskId}))fail('TASK_NOT_FOUND')
      if(filter.sourceId){const source=await query('source.get',{sourceId:filter.sourceId});if(!source||filter.groupId&&source.groupId!==filter.groupId)fail('SOURCE_NOT_FOUND');if(!Number.isInteger(filter.sourceVersion)||filter.sourceVersion<1||filter.sourceVersion>source.version)fail('SOURCE_VERSION_INVALID');filter={...filter,groupId:source.groupId}}
      if(filter.groupId)ctx.get('channels').assertGroupTarget(filter.groupId)
      if(filter.sessionId&&!observation.listPerformance({sessionId:filter.sessionId}).rows.some(row=>row.sessionId===filter.sessionId))fail('SESSION_NOT_FOUND')
      return residentStore.listExecutionTrace(filter)
    },
    listActivities: observation.listActivities, listTaskTimings: observation.listTaskTimings, listPerformance: observation.listPerformance, getActivityAuditStatus: observation.getActivityAuditStatus,
    listAlerts:observerAlerts.all, listAlertPage:observerAlerts.page,
    listTopics: groupId => residentStore.listTopics(groupId), getTopic: (groupId, topicId) => residentStore.getTopic(groupId, topicId),
    getTopicContext: args => residentStore.getTopicContext(args),
    async retryMessage({ groupId, messageId }) {
      ctx.get('channels').assertGroupTarget(groupId)
      if (!residentStore.getGroup(groupId)) fail('group_not_subscribed')
      const sources = (await query('source.list', { groupId })).filter(source => source.messageId === messageId)
      if (!sources.length) {
        const message = residentStore.getGroup(groupId)?.messages.find(item => item.messageId === messageId)
        if (!message) fail('TASK_SESSION_SOURCE_NOT_FOUND')
        const actorId = conversationMessageActorId(message)
        if (!actorId) fail('TASK_SESSION_AUTHENTICATED_SOURCE_REQUIRED')
        if (isOwnNotification({ ...message, groupId })) fail('TASK_SESSION_OWN_NOTIFICATION')
        const sourceId = `im:${hash([groupId, messageId, message.messageVersion ?? 1])}`
        await command('source.acceptHistory', { sourceId, groupId, messageId, version: message.messageVersion ?? 1,
          actorId, senderName: message.senderName ?? '', text: message.text ?? '', quote: message.quotedMessage ?? null,
          resources: message.resourceRefs ?? message.imageRefs ?? [], timestamp: message.occurredAt,
          authorizationRef: `message-retry:${groupId}:${messageId}:${message.messageVersion ?? 1}` }, `retry-source:${sourceId}`)
      }
      // Recover a partially accepted explicit retry without changing any message facts.
      // Retry only pending durable triage/Router work; never reopen Topic units.
      await kickGroup(groupId)
      await recover()
      return { groupId, messageId, recoveryRequested: true }
    },
    isGroup: groupId => !!residentStore.getGroup(groupId),
    async archiveTask({ taskId }) {
      const task = await requireTask(taskId)
      if (!config.webActorId) fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
      const result = await command('task.archive', { taskId: task.taskId, actorId: config.webActorId })
      return taskDTO(result.result.task)
    },
    async boardTasks(options) {
      if (!options) return Promise.all((await query('task.list')).map(taskDTO))
      const page = await query('observer.page', { collection: 'tasks', ...options })
      if (options.summary) return page
      const titles = new Map()
      return { ...page, items: page.items.map(task => ({ ...task, topicRefs: taskTopicRefs(task, titles), inputVersion: task.requirementRevision,
        controlState: task.control, waitingReason: task.state === 'waiting' ? task.lastDecision?.summary ?? '' : '',
        result: task.completion?.result ?? task.lastDecision ?? null, legacyReadonly: false,
        ...(task.archivedAt ? {} : { session: { sessionId: task.sessionId, sessionBound: task.sessionBound, status: task.drained ? 'idle' : 'running',
          workspaceDir: taskWorkspaceReady(task)?dirname(taskFilePath(root,task.taskId,'work')):null, logPath: ctx.sessionPersistence.path(task.sessionId) } }) })) }
    },
    async taskDecisions(taskId, options = {}) { await requireTask(taskId); return query('task.decisions', { ...options, taskId }) },
    async reconcileWebTaskTopics(){fail('TOPIC_ROUTING_RETIRED')},
    async createTask(args) {

      if(args.topicRefs?.length)fail('TOPIC_ROUTING_RETIRED')
      if(!args.requestId||!args.objective?.trim())fail('TASK_SESSION_REQUEST_ID_REQUIRED')
      const channel=args.channel?ctx.get('channels').identity(args.channel):undefined
      const actorId=channel?.principal??config.webActorId
      if(!actorId)fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
      const id='single-task:'+hash([actorId,channel?.sessionId??args.groupId??'personal',args.requestId])
      const taskId='task-'+hash(id).slice(0,32),groupId=channel?.sessionId??args.groupId??null
      return admitTask(taskId,async()=>{
      if(args.context!==undefined&&typeof args.context!=='string'||args.sourceRefs!==undefined&&(!Array.isArray(args.sourceRefs)||args.sourceRefs.some(value=>typeof value!=='string'||!value.trim())))fail('DYNAMIC_ARGUMENT_INVALID')
      const sources=[]
      for(const sourceId of new Set(args.sourceRefs??[])){
        const source=await query('source.get',{sourceId})
        if(!source||source.channel==='internal'||(groupId?source.groupId!==groupId:source.actorId!==actorId||source.channel!=='web'))fail('TASK_INITIAL_SOURCE_SCOPE_INVALID')
        sources.push(source)
      }
      const sourceId='single-task-source:'+hash(id),identity=clean(args),previous=await query('source.get',{sourceId})
      if(previous&&hash(previous.requestIdentity?.singleTaskCreate)!==hash(identity))fail('DYNAMIC_COMMAND_ID_CONFLICT')
      if(!previous)await command('source.record',{sourceId,groupId:groupId??'task:'+taskId,messageId:channel?.envelope.messageId??sourceId,actorId,channel:channel?channel.envelope.type:'web',text:channel?.envelope.text??(args.context?.trim()||args.objective),timestamp:channel?.envelope.sentAt??new Date().toISOString(),requestIdentity:{singleTaskCreate:identity}},'source:'+sourceId)
      await command('source.routed',{sourceId,receipt:[]},'single-initial-routed:'+sourceId)
      const receipt=await command('task.create',{taskId,request:args.objective,objective:args.objective,title:args.title??args.objective.slice(0,80),requirements:args.acceptanceCriteria??[],ownerActorId:actorId,...groupId?{groupId,conversationId:groupId}:{},sourceRefs:[...new Set([sourceId,...sources.map(source=>source.sourceId)])],topicRefs:args.topicRefs??[],replyBindings:bindingsForSources(sources),metadata:{channel:channel?channel.envelope.type:'web',authorizationSourceId:sourceId,...channel&&args.context?.trim()?{initialContext:args.context}:{},...channel?{channelType:channel.envelope.type,channelId:channel.envelope.channelId,conversationId:channel.envelope.conversationId,senderId:channel.envelope.senderId}:{}}},id)
      void kickTask(receipt.result.task.taskId);return taskDTO(receipt.result.task)
      },groupId)
    },
    async appendTaskContext(args) { return taskDTO(await webTopicAction(args, await requireTask(args.taskId), 'task-context')) },
    async reopenTask(args) { return taskDTO(await webTopicAction(args, await requireTask(args.taskId), 'task-reopen')) },
    async taskDialogue(taskId) {
      const task = await requireTask(taskId)
      return { taskId, sessionId: task.sessionId, messages: task.dialogue ?? [],
        writable: !!config.webActorId && !task.archivedAt && task.status === 'active' && task.control === 'active',
        error: failures.get(taskId)?.code ?? null }
    },
    async inspectTaskEffect(args){if(hostAgents?.currentInitiator?.()!==undefined)fail('TASK_SESSION_HOST_CONTEXT_REQUIRED');if(!effectReconciliation)fail('TASK_SESSION_WEB_ACTOR_REQUIRED');return admitTask(args.taskId,()=>effectReconciliation.inspect(args))},
    reconcileTaskEffect,
    authorizeTaskEffectAction,
    async sendTaskDialogue({ taskId, requestId, text }) {
      if (!config.webActorId) fail('TASK_SESSION_WEB_ACTOR_REQUIRED')
      const receipt = await command('task.dialogue.add', { taskId, requestId, text, actorId: config.webActorId }, `dialogue:${taskId}:${requestId}`)
      // The durable wake survives a closed tab, a lost response and Host restart.
      void kickTask(taskId).catch(() => {})
      return receipt.result.message
    },
    async cancelTask(args) {

      if(!args.requestId)fail('TASK_SESSION_REQUEST_ID_REQUIRED')
      const task=await requireTask(args.taskId)
      if(args.channel&&ctx.get('channels').identity(args.channel).principal!==task.ownerActorId)fail('DYNAMIC_HUMAN_RESPONSE_FORBIDDEN')
      await command('task.control',{taskId:task.taskId,control:'cancelled',expectedControlRevision:args.expectedControlRevision??task.controlRevision},'single-cancel:'+hash([task.taskId,args.requestId]))
      await cancelLiveTask(task.taskId,inflightTasks.get(task.taskId),inflightExecutions);return taskDTO(await requireTask(task.taskId))
    },
    hasPendingTopicFacts: groupId => query('topic.fact.unsettled', { groupId }),
    async whenIdle() {
      const notificationAttempts = new Set()
      await schedulePending()
      await deliverNotifications(notificationAttempts)
      do {
        await Promise.allSettled([scheduling, notificationScan, ...admissions.values(), ...sourceProjections, ...inflightTasks.values(), ...inflightExecutions.values(), ...inflightGroups.values(), ...inflightNotifications.values()].filter(Boolean))
        await residentRouter.whenIdle()
        await schedulePending()
        await deliverNotifications(notificationAttempts)
      } while (scheduling || notificationScan || admissions.size || sourceProjections.size || [inflightTasks,inflightExecutions,inflightGroups,inflightNotifications].some(map => map.size))
      await archives?.idle()
    },
    close() {return closingService??=(async()=>{
      closed = true
      const errors=[]
      const attempt=async action=>{try{await action()}catch(error){errors.push(error)}}
      await attempt(()=>stopReflection?.())
      await attempt(()=>detachIngress?.())
      await attempt(()=>reflection?.whenIdle())
      await attempt(()=>nativeDws.close())
      const counts = () => ({ observationPending: observationQueue.pending, tasks: inflightTasks.size, executions: inflightExecutions.size, groups: inflightGroups.size,
        notifications: inflightNotifications.size, admissions: admissions.size, sourceProjections: sourceProjections.size,
        scheduling: !!scheduling, recovering: !!recovering, notificationScan: !!notificationScan })
      // 任一资源关闭失败仍需等待其它关闭，最后保留全部真实异常。
      await attempt(()=>observeClose(closeTrace, 'service.topic.close', async()=>{
        const results=await Promise.allSettled([()=>triage.close(),()=>residentRouter.close(),()=>platformSchedules.close()].map(action=>Promise.resolve().then(action)))
        const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason)
        if(failures.length)throw new AggregateError(failures,'Conversation shutdown failed')
      }, counts))
      await attempt(()=>observeClose(closeTrace, 'service.owner.close', () => taskSessions.close(), counts))
      await attempt(()=>observeClose(closeTrace, 'service.inflight-settled', () => Promise.allSettled([scheduling, recovering, notificationScan, ...admissions.values(), ...sourceProjections, ...inflightTasks.values(), ...inflightExecutions.values(), ...inflightGroups.values(), ...inflightNotifications.values()].filter(Boolean)), counts))
      for(const diagnostic of failures.values())if(diagnostic.nativeResources?.handles.retained||diagnostic.nativeResources?.local.retained)
        errors.push(diagnostic.cause??Object.assign(new Error('TASK_WORKSPACE_NATIVE_RESOURCES_RETAINED'),{nativeResources:diagnostic.nativeResources}))
      await attempt(()=>stopObservation?.())
      await attempt(()=>observeClose(closeTrace, 'service.observation-tail', () => observationQueue.close(), counts))
      await attempt(()=>stopInboxProjection?.())
      await attempt(()=>observeClose(closeTrace, 'service.observer-page.close', () => observerGroupPage.close(), counts))
      // 完整文件封存由离线 backup 显式执行；普通停机只等待已提交投影。
      if(archives)await attempt(()=>archives.idle())
      if (!suppliedStore) await attempt(()=>observeClose(closeTrace, 'service.store.close', () => store.close(), counts))
      if(errors.length)throw new AggregateError(errors,'Task service shutdown failed')
    })()},
  }
  if(archives)ctx.effect(()=>()=>api.close(),'portable task archive shutdown')
  return api
}
