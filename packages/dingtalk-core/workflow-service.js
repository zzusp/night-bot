// Business constraints, source authorization and read-only workflow helpers.
// The former Owner/node execution service is retired.
import {describeTaskNodeOutput} from './node-output-readout.js'

import {normalizeResourceRefs} from "./dws-bridge.js"
import {isNamedAgentDirection} from "./decision.js"

import { join } from 'node:path'

import { executionDigest, executionError } from './execution-artifacts.js'

export { createEngineeringFailureRepair } from './workflow-engineering.js'

import {selectTaskDeliveryFiles, verifyFileDeliveryOutput} from "./task-group-file-delivery.js"

import { sameDwsFileProjection } from './coordination-resources.js'

export function reviseTaskConstraintScope(previous, { constraints, requirementRef, requirementRevision } = {}) {
  if (constraints === undefined) return { constraints: [...(previous.constraints ?? [])],
    ...(previous.constraintHistory ? { constraintHistory: previous.constraintHistory } : {}) }
  return { constraints: [...new Set(constraints)], constraintHistory: [
    ...(previous.constraintHistory ?? []),
    ...(requirementRef ? [{ requirementRef, requirementRevision }] : []),
  ] }
}

export function groupTaskExecutions(physical, families) {
  const byId = new Map(physical.map(task => [task.taskId, task]))
  return families.flatMap(family => {
    const members = family.taskIds.map(id => byId.get(id)).filter(Boolean)
    if (!members.length) return []
    const latest = members.at(-1)
    // 既有并发分叉不能被后来的终态遮住：优先保留活动执行在看板上。
    const active = members.filter(task => task.state !== 'completed')
    const displayed = active.at(-1) ?? latest
    const source = members.find(task => task.groupId && !task.groupId.startsWith('web:'))
    return [{ ...displayed, logicalTaskId: members[0].taskId, latestTaskId: latest.taskId,
      sourceGroupId: source?.groupId ?? null,
      topicRefs: displayed.topicRefs?.length ? displayed.topicRefs : source?.topicRefs ?? [],
      executionCount: members.length, executionNumber: members.indexOf(displayed) + 1,
      activeExecutionCount: active.length,
      archivedAt: members.every(task => task.archivedAt) ? latest.archivedAt : undefined }]
  })
}

const isWebDevelopmentDelivery = origin => origin?.channel === 'web'
  && JSON.stringify(origin.run?.request?.stages) === JSON.stringify(['task-engineering', 'task-uat-pr-merge', 'task-uat-deployment'])

export function bindFileDelivery(candidate, source) {
  if (!candidate) return null
  if (typeof source !== 'string' || typeof candidate.sourceQuote !== 'string') throw executionError('TASK_FILE_DELIVERY_AUTHORIZATION_REQUIRED')
  const quote = candidate.sourceQuote.trim()
  const ranges = []
  if (quote) for (let start = source.indexOf(quote); start !== -1; start = source.indexOf(quote, start + 1)) ranges.push([start, start + quote.length])
  // 校验引用覆盖的完整源句，保留引用之外的否定与群范围上下文。
  const clauses = [...source.matchAll(/[^。！？；\n]+[。！？；\n]?/gu)]
    .filter(match => ranges.some(([start, end]) => match.index < end && match.index + match[0].length > start))
    .map(match => match[0])
  if (!quote || !clauses.length || clauses.some(clause => /不要|不用|不必|不需|不(?:发送|发|传)|禁止|不得|取消|暂停|(?:另一个|其他|其它|别的)群/u.test(clause))
    || !/(?:发送|发|上传|传到).*(?:群|群聊)|(?:群|群聊).*(?:发送|发|传)/u.test(quote)
    || !/文件|文档|附件|markdown|sql|图片|\.(?:md|sql|pdf|docx|xlsx|pptx|png|jpe?g|webp)\b/iu.test(quote)) throw executionError('TASK_FILE_DELIVERY_AUTHORIZATION_REQUIRED')
  const files = candidate.files
  if (!Array.isArray(files) || !files.length || files.length > 20
    || files.some(file => !file.role?.trim() || !file.fileName?.trim() || /[\\/\x00-\x1f<>:"|?*]/u.test(file.fileName))
    || new Set(files.map(file => file.role)).size !== files.length
    || new Set(files.map(file => file.fileName)).size !== files.length) throw executionError('TASK_FILE_DELIVERY_MANIFEST_INVALID')
  return { sourceQuote: quote, files: files.map(file => ({ role: file.role, fileName: file.fileName })) }
}

export { selectTaskDeliveryFiles, verifyFileDeliveryOutput } from './task-group-file-delivery.js'

/** 只替换明确失败的部署后缀；成功工程与合并 Run 保持不变。 */
export async function continueFailedUatStage({ taskId, plan, store, controller, external }) {
  if (!plan || plan.task.controlState !== 'active' || plan.stages.length !== 3
    || !plan.stages[0].workflowId.startsWith('task-engineering-')
    || plan.stages[1].workflowId !== 'task-uat-pr-merge'
    || plan.stages.slice(0, 2).some(stage => stage.status !== 'succeeded' || !stage.runId || !stage.outputRef)
    || typeof external?.prepareUatRebuildFromFailure !== 'function') return plan
  let current = plan.stages[2]
  const replacing = current.workflowId === 'task-uat-deployment' && current.status === 'blocked' && current.runId && current.attempt === 1
  const binding = current.workflowId === 'task-uat-rebuild' && current.status === 'ready' && !current.requirementRef
    && plan.task.planRevision > 1 && current.attempt === 2
  if (!replacing && !binding || !isWebDevelopmentDelivery(await store.query({ kind: 'task.origin', taskId }))) return plan
  const failedRunId = replacing ? current.runId : controller.plannedTaskStageRunId({ taskId,
    planRevision: plan.task.planRevision - 1, stageId: current.stageId, attempt: current.attempt - 1 })
  const input = await external.prepareUatRebuildFromFailure({ taskId, runId: failedRunId, mergeRunId: plan.stages[1].runId })
  if (replacing) {
    await controller.reviseTaskPlan({ commandId: `uat-rebuild-plan:${failedRunId}`, taskId,
      expectedPlanRevision: plan.task.planRevision, expectedControlRevision: plan.task.controlRevision,
      requirementRevision: plan.task.requirementRevision, affectedFrom: 2,
      stages: plan.stages.map((stage, index) => ({ stageId: stage.stageId,
        workflowId: index === 2 ? 'task-uat-rebuild' : stage.workflowId, gate: stage.gate })) })
    plan = await controller.taskPlan(taskId)
    current = plan.stages[2]
  }
  if (current.status === 'ready' && !current.requirementRef) {
    await controller.bindTaskStageInput({ commandId: `uat-rebuild-input:${failedRunId}`, taskId,
      planRevision: plan.task.planRevision, expectedControlRevision: plan.task.controlRevision,
      stageId: current.stageId, predecessorOutputRef: plan.stages[1].outputRef, input })
    return controller.advanceTaskPlan(taskId)
  }
  return plan
}

/** 将持久节点工件转换为可读产出；不推断未落盘的文件或外部执行结果。 */
export {describeTaskNodeOutput} from './node-output-readout.js'

export const describeMessageTraceItem = (item) => {
  const input = item.input ?? {}, output = item.output ?? {}
  const text = value => typeof value === 'string' ? value : ''
  const rows = []
  const add = (label, value) => { if (text(value)) rows.push({ label, value }) }
  const actionNames = { create: '创建任务', research: '开展排查', answer: '回答问题', status: '查询进展', result: '查询结果', fact: '补充话题事实', no_action: '不采取动作', revise: '调整任务', reopen: '重新打开任务', pause: '暂停任务', cancel: '取消任务', resume: '继续任务', report: '调整报告', clarification: '答复澄清', approve: '处理审批' }
  let title = { split: '拆分事项', route: '关联话题', intent: '判断下一步', command: '接纳动作', agent: '查询与答复' }[item.kind] ?? (item.nodeId === 'material' ? '读取补充材料' : '处理记录')
  let conclusion = '尚未记录判断结论'
  if(item.kind==='coordinator'&&Array.isArray(output.units)){
    title='群消息协调'
    conclusion=output.units.length?`本批记录 ${output.units.length} 个有效协调单元`:'未记录有效协调单元'
    output.units.forEach((unit,index)=>add(`协调单元 ${unit.unitId??index+1}`,unit.goalText))
  } else if (item.kind === 'split' && Array.isArray(output.units)) {
    conclusion = `拆分为 ${output.units.length} 个事项`
    output.units.forEach((unit, i) => add(`事项 ${i + 1}`, unit.goalText ?? unit.text))
  } else if (item.kind === 'route' && output.kind === 'binding') {
    const candidate = input.candidates?.find(candidate => candidate.candidateId === output.candidateId)
    conclusion = { existing: '关联到已有话题或任务', new: '判断为新话题', conversation: '关联到当前群的任务集合' }[output.disposition] ?? '已记录关联判断'
    add('当前事项', input.goalText)
    add('关联对象', candidate?.title ?? candidate?.goal)
    if (!candidate && output.candidateId) add('关联对象', '历史记录未提供关联对象名称')
    if (Array.isArray(output.evidence)) output.evidence.forEach(value => add('关联依据', value))
  } else if (item.kind === 'intent') {
    const decisions = Array.isArray(output.decisions) ? output.decisions : [{ intent: output }]
    let count = 0
    for (const decision of decisions) {
      const intent = decision.intent ?? {}, unit = input.units?.find(unit => unit.unitId === decision.unitId)
      const sourceIndex = item.sourceMessages?.findIndex(message => message.runId === unit?.runId) ?? -1
      add(sourceIndex >= 0 ? `消息 ${sourceIndex + 1} 的事项` : '对应事项', unit?.input?.goalText ?? unit?.input?.source?.text)
      for (const action of intent.actions ?? []) {
        count++
        add(actionNames[action.intent] ?? '其他动作', action.arguments?.objective ?? action.arguments?.text ?? action.arguments?.answer ?? actionNames[action.intent] ?? '具体内容未记录')
      }
      if (intent.kind === 'needs_clarification') add('需要确认', intent.question ?? intent.reason)
      if (intent.kind === 'needs_context') add('需要材料', intent.reason)
      for (const constraint of intent.constraints ?? []) add('执行限制', typeof constraint === 'string' ? constraint : constraint.text)
    }
    conclusion = count ? `提出 ${count} 项处理决定` : '已记录判断，等待补充信息或后续处理'
  } else if (item.kind === 'agent') {
    conclusion = { running: '正在查询并组织答复', waiting_user: '等待必要补充', succeeded: '答复已生成，送达情况见发信箱', blocked: '查询受阻，尚未完成答复', failed: '本次查询未完成', cancelled: '本次查询已取消', cancelling: '正在停止查询', superseded: '已由新问题替代', interrupted: '等待恢复原会话', ready: '等待继续执行' }[item.status] ?? '等待开始查询'
    add('答复摘要', text(output.reply).slice(0, 240))
    add('待补充', input.question)
  } else if (item.kind === 'command') {
    const action = actionNames[input.kind] ?? '处理动作'
    conclusion = `${action} · ${({applied:'已接纳',running:'处理中',unknown:'结果待核对',failed:'失败'}[item.status] ?? '状态未记录')}`
    add('处理目标', input.args?.arguments?.objective ?? input.args?.arguments?.text)
    if (input.kind !== 'answer') add('处理结果', output.reply ?? output.summary)
    if (output.taskId) add('后续任务', '已记录任务身份；实际执行进展请查看任务看板')
  } else if (item.nodeId === 'material') {
    conclusion = output.complete === true ? '本页材料读取完成' : '材料完整性尚未确认'
    for (const fact of output.facts ?? []) add('原文依据', fact.quote)
  }
  if (output.kind === 'needs_clarification') { conclusion = '需要进一步确认'; add('待确认问题', output.question ?? output.reason) }
  if (output.kind === 'needs_context') { conclusion = '需要补充材料'; add('原因', output.reason) }
  if (['needs_relink', 'needs_resegmentation'].includes(output.kind)) { conclusion = output.kind === 'needs_relink' ? '需要重新关联话题' : '需要重新拆分事项'; add('原因', output.reason) }
  if (['failed', 'blocked'].includes(item.status)) conclusion = '本步未完成，请查看阻塞原因'
  return { title, conclusion, rows }
}

const sourceKey = (profile, groupId, messageId) => `dws:${executionDigest([profile, groupId, messageId])}`
// 这里仅核对被点名的接收者；语义动作已经由 I/IB 判定，执行批准仍走阶段批准。
export const isDirectedTaskRequest = (body, agentNames = []) => typeof body === 'string' && isNamedAgentDirection(body, agentNames)

// 环境来自有效来源；模型填写的参数不能为缺失的交付目标制造授权。

// 目标摘要可用于展示；执行要求取已接纳事项的原文，避免模型附加的调查方法升级为交付前提。

export function createSourceDossierCapability(sourceRead) {
  const capability = {
    id: 'organize-topic-sources', effectClass: 'read', description: '将已授权消息逐字整理为带来源键的 Markdown 摘录，不推断未给出的事实',
    identity: 'organize-topic-sources-v1',
    authorize: ({ input, scope }) => sourceRead.authorize({ input, scope }),
    async execute({ input }) {
      const fresh = await sourceRead.execute({ input })
      const markdown = fresh.sources.map(source => `### ${source.sourceKey}\n\n${source.text.split('\n')
        .map(line => `> ${line}`).join('\n')}`).join('\n\n')
      return { markdown, sourceKeys: fresh.sources.map(source => source.sourceKey) }
    },
    async verify({ input, scope, output }) {
      if (!await capability.authorize({ input, scope })) return { passed: false }
      const fresh = await capability.execute({ input })
      return { passed: executionDigest(fresh) === executionDigest(output),
        outputDigest: executionDigest(fresh), sourceRefs: fresh.sourceKeys }
    },
  }
  return capability
}

/** 仅沿当前 Task 冻结的消息来源和该消息明确引用读取平台文本。 */
export function createTaskMessageResourceCapability({ store, readMessage, readResource }) {
  if (typeof readMessage !== 'function' || typeof readResource !== 'function') return null
  const identify = async (input, scope) => {
    if (!input || !scope || typeof input.sourceKey !== 'string' || !Array.isArray(scope.sourceKeys)
      || !scope.sourceKeys.includes(input.sourceKey) || !['mediaId', 'fileId', 'dingtalkDoc'].includes(input.type)
      || typeof input.resourceId !== 'string' || !input.resourceId) return null
    const source = await store.query({ kind: 'task.source', sourceKey: input.sourceKey })
    if (!source || source.status === 'superseded' || source.conversationId !== scope.conversationId
      || source.sourceVersion !== scope.sourceVersions?.[input.sourceKey]
      || typeof source.context?.sourceMessageId !== 'string') return null
    const ref = input.type === 'dingtalkDoc'
      ? normalizeResourceRefs([], source.body).find(item => item.type === input.type && item.resourceId === input.resourceId)
      : source.context.attachments?.find(item => item.source?.type === input.type
        && item.source.resourceId === input.resourceId)?.source
    return ref ? { source, ref } : null
  }
  const load = async (input, scope) => {
    const bound = await identify(input, scope)
    if (!bound) throw executionError('GENERAL_RESOURCE_SCOPE_DENIED')
    const { source, ref } = bound
    const remote = await readMessage(scope.conversationId, source.context.sourceMessageId)
    if (!remote || remote.messageId !== source.context.sourceMessageId
      || (remote.conversationId ?? remote.groupId) !== scope.conversationId
      || (remote.text !== source.body && !sameDwsFileProjection({ sourceKind: 'dingtalk', text: source.body }, remote)) || remote.complete === false || remote.hasMore === true
      || remote.failures?.length
      || !(input.type === 'dingtalkDoc' ? normalizeResourceRefs([], remote.text) : remote.resourceRefs ?? [])
        .some(item => item.type === input.type && item.resourceId === input.resourceId))
      throw executionError('GENERAL_RESOURCE_SOURCE_CHANGED')
    const value = await readResource(scope.conversationId, remote.messageId, ref)
    if (!value || typeof value.text !== 'string' || value.complete === false || value.hasMore === true
      || value.coverage?.complete === false || value.projection?.complete === false
      || value.failures?.length || value.mediaUnavailable?.length) throw executionError('GENERAL_RESOURCE_READ_INCOMPLETE')
    if (!await identify(input, scope)) throw executionError('GENERAL_RESOURCE_SOURCE_CHANGED')
    const markdown = `### ${input.sourceKey} / ${remote.messageId} / ${input.type}:${input.resourceId}\n\n${value.text.split('\n').map(line => `> ${line}`).join('\n')}`
    const metadata = Object.fromEntries(['nodeId', 'name', 'extension', 'sizeBytes', 'modifyTime', 'sourceSha256']
      .filter(key => value.metadata?.[key] !== undefined).map(key => [key, value.metadata[key]]))
    return { markdown, sourceKey: input.sourceKey, messageId: remote.messageId,
      resource: { type: input.type, resourceId: input.resourceId }, contentDigest: executionDigest(value.text),
      ...(Object.keys(metadata).length ? { metadata } : {}) }
  }
  return { id: 'read-task-message-resource', effectClass: 'read', identity: 'read-task-message-resource-v2',
    parameters: { type: 'object', properties: { sourceKey: { type: 'string' }, type: { type: 'string', enum: ['mediaId', 'fileId', 'dingtalkDoc'] }, resourceId: { type: 'string' } }, required: ['sourceKey', 'type', 'resourceId'], additionalProperties: false },
    description: '只读当前业务任务已冻结消息明确引用的钉钉文档、文本或工作簿附件，完整保留正文结构与元数据；返回带精确来源和内容摘要的 Markdown。钉钉文档读取失败须按实际错误判断，不将标题或登录页视为正文。',
    authorize: async ({ input, scope }) => Boolean(await identify(input, scope)),
    execute: ({ input, scope }) => load(input, scope),
    async verify({ input, scope, output }) {
      const fresh = await load(input, scope)
      return { passed: executionDigest(fresh) === executionDigest(output), outputDigest: executionDigest(fresh),
        sourceRefs: [input.sourceKey, `${input.sourceKey}:${fresh.messageId}:${input.type}:${input.resourceId}:${fresh.contentDigest}`] }
    },
  }
}

export async function verifyDefaultGeneralCompletion({ request, acceptanceCriteria, scope, evidence, report }) {
  const isPureCompilation = text => /^(整理|汇总|摘录)/u.test(text)
    && /消息|材料|原文|内容|记录/u.test(text)
    && !/排查|查明|原因|修复|部署|发布|创建|更新|删除|发送|审批|数据库|代码|文件写入/u.test(text)
  const pureCompilation = isPureCompilation(request) && acceptanceCriteria.every(isPureCompilation)
  const dossier = evidence.find(item => item.capabilityId === 'organize-topic-sources'
    && report.evidenceIds.includes(item.evidenceId) && item.verification.passed === true)
  if (!pureCompilation || !dossier || !scope.sourceKeys.every(key => dossier.output.sourceKeys.includes(key))
    || report.summary !== dossier.output.markdown || report.limitations.length)
    return { status: 'unverified', resultVerified: false, criteria: [] }
  return { status: 'satisfied', resultVerified: true,
    criteria: acceptanceCriteria.map(criterion => ({ criterion, passed: true,
      evidenceIds: [dossier.evidenceId] })) }
}

export function rankMessageCandidates(cards, goalText, recentSourceKey = null) {
  const words = [...new Set((goalText ?? '').toLowerCase().match(/[a-z0-9_-]+|[\u4e00-\u9fff]{2}/g) ?? [])]
  const score = card => card.explicitReferenceMatches.length * 10000
    + (recentSourceKey && card.topicId && card.sourceRefs.includes(recentSourceKey) ? 5000 : 0)
    + words.filter(word => card.goal?.toLowerCase().includes(word)).length
  return cards.sort((a, b) => score(b) - score(a) || String(b.relevantTime).localeCompare(String(a.relevantTime)))
}

/** 复用已持锁的 Host Store；终态写入仍由原生 reducer 核验维护许可和冻结回执。 */
export async function reconcilePausedWorkspaceFailure({store,taskId,request}) {
  const fields=['runId','runRevision','nodeRunId','generation','leaseEpoch','inputDigest','effectId','expectedRequirementRevision','expectedPlanRevision','expectedControlRevision','maintenanceId','maintenanceRevision']
  if(fields.some(key=>request[key]===undefined)||request.outputRef!==undefined||request.evidenceRefs?.length)throw executionError('WORKSPACE_TERMINAL_REQUEST_INVALID')
  const commandId=`workspace-terminal:${request.effectId}:${request.leaseEpoch}`,prior=await store.query({kind:'receipt',commandId})
  if(prior){
    const state=await store.query({kind:'run',runId:request.runId}),plan=await store.query({kind:'task.plan',taskId})
    if(prior.result?.status!=='failed'||prior.result.taskId!==taskId||prior.result.runId!==request.runId
      ||prior.result.nodeRunId!==request.nodeRunId||prior.result.effectId!==request.effectId
      ||state.run.taskId!==taskId||state.run.status!=='failed'||state.nodes.find(n=>n.nodeRunId===request.nodeRunId)?.status!=='failed'
      ||plan.stages.find(s=>s.runId===request.runId)?.status!=='blocked'||plan.task.controlState!=='paused')throw executionError('WORKSPACE_TERMINAL_RECEIPT_CHANGED')
    return prior
  }
  return store.command({id:commandId,kind:'node.failure.reconcile-workspace',args:{taskId,...Object.fromEntries(fields.map(key=>[key,request[key]]))}})
}

export function isWebRequirementTargetAllowed({ workflowId, targetId, repositoryId, engineeringRepositories = [], externalWorkflowIds = [], externalTargets = [] }) {
  if (workflowId === 'task-engineering') return Boolean(targetId && targetId === repositoryId
    && engineeringRepositories.some(item => item.repositoryId === targetId))
  return externalWorkflowIds.includes(workflowId) && externalTargets.some(item => item.workflowId === workflowId && item.targetId === targetId)
}
