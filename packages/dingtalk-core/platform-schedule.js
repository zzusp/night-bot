import {AsyncLocalStorage} from 'node:async_hooks'
import {bindPlatformScheduleSource} from '../../src/runtime/pi-platform-source.js'
import {scopeOf} from '../../src/native-scope.js'
import {officialWorkingDirectoryOrigin} from '../../src/native-working-directory.js'
import {isDeepStrictEqual} from 'node:util'
import {enqueueBusinessNotice} from '../../src/runtime/pi-business-notices.js'
import { fixedUnitRequestId, platformTaskPage, platformScheduleSessionId as sessionKey, platformScheduleOutboundId as outboundKey } from './fixed-topics.js'
import { sessionWorkspace, sessionTitle } from './session-workspaces.js'
import {conversationReplyInstructions} from '../../src/channels/message-safety.js'
import { z } from 'zod'
import { createPlatformNotifier, platformNotificationContext, platformReplyParameters } from './platform-notification.js'
import {conversationNotificationInstructions,conversationMessageActorId} from './group-notification.js'

const fail=code=>Object.assign(new Error(code),{code})
const output = { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const deliveryPrompt = binding => binding.everySeconds ? `按原消息持续执行平台检查：${binding.prompt}。每 ${binding.everySeconds} 秒一次，检查范围 ${JSON.stringify(binding.stopWhen??null)}。每次先 platform_task_query 读取当前任务快照，再 platform_reply_submit 汇报本次，不另建提醒或业务任务。只有宿主核实指定任务当前版本全部完成后才停止；等待、失败、阻塞不是完成。` : `执行原群已授权的一次平台事项：${binding.prompt}\n约定时间 ${binding.at}，原群 ${binding.groupId}。必须先使用 platform_task_query 核对本群事实，再用 platform_reply_submit 提交；这两个工具未就绪时等待宿主恢复，不自行发群、不改排时间、不创建业务任务。已过期时判断补报或失去意义而静默，不能把入站提醒当已交付。`
const matchesNative = (binding, record) => (binding.everySeconds ? record?.kind === 'every' && record.everySeconds === binding.everySeconds : record?.kind === 'at' && record.scheduledAt === (binding.nativeAt??binding.at)) && record.sessionId === binding.sessionId
  && record.prompt === deliveryPrompt(binding) && record.title === binding.title && (!binding.scheduleId || binding.scheduleId === record.id)

const recoveryInput=(binding,record)=>({id:`${record.id}-platform-recovery:${record.lastDelivery.messageId}`,source:{kind:'platform-schedule-recovery',scheduleId:record.id,originalPacketId:record.lastDelivery.messageId,requestId:binding.requestId},content:`[SCHEDULE REMINDER]\n原生定时已在 ${record.lastDelivery.deliveredAt} 投入本会话，平台工具现已就绪。沿原事项补报或判断过期，只通过 platform_reply_submit 结清；不要创建新的 schedule。`})

// Native Schedule owns timing, storage and cold-session delivery. This bridge
// owns only the accepted source binding and its existing outbox identity.
export function createPlatformSchedules({ ctx, store, legacy, root, models, readTasks, appendOutbox, notify = createPlatformNotifier({ store, root, appendOutbox }), now = Date.now }) {
  if(ctx.get?.('agents')?.currentInitiator?.()!==undefined)throw fail('platform_schedule_host_context_required')
  const hostScheduler=AsyncLocalStorage.snapshot(),watchers=new Map()
  let closed = false
  const watch=actor=>{if(watchers.has(actor)||!actor.piSession)return;watchers.set(actor,actor.piSession.subscribe(event=>{if(event.type==='agent_settled')recover()}))}
  const flights = new Map(), flightGroups = new Map(), recoveryGroups = new Set(), mounted = new Map(), recovered = new Set()
  let recovery = Promise.resolve(),recoveryRunning=false,recoveryRequested=false
  const source = binding => {
    if (closed) return null
    const message = store.getGroup(binding.groupId)?.messages.find(item => item.messageId === binding.messageId && item.messageVersion === binding.messageVersion)
    if(binding.sourceMode==='direct')return message&&conversationMessageActorId(message)===binding.actorId?{message,sourceId:binding.sourceId}:null
    const unit = message?.units?.find(item => item.unitId === binding.unitId && item.unitRevision === binding.unitRevision && item.fixedTopic === 'agent-platform')
    return unit && message.activeUnitRefs?.some(ref => ref.unitId === unit.unitId && ref.unitRevision === unit.unitRevision)
      && fixedUnitRequestId(binding.groupId, message, unit) === binding.requestId ? { message, unit } : null
  }
  const assertTarget=groupId=>ctx.get?.('channels')?.assertGroupTarget(groupId)
  const settle = (binding, outcome) => store.updatePlatformSchedule(binding.sessionId, { outcome, completedAt: new Date(now()).toISOString() })
  const assertUnchanged = binding => {
    if(store.getPlatformSchedule(binding.sessionId)?.managementKey)throw fail('platform_schedule_superseded')
  }
  async function deliver(binding, decision, occurrenceAt) {
    assertUnchanged(binding)
    assertTarget(binding.groupId)
    const current = source(binding)
    if (!current) throw new Error('platform_schedule_source_stale')
    const outboundId = outboundKey(binding.requestId + (occurrenceAt ? ':'+occurrenceAt : '')), message = current.message
    await notify({ groupId: binding.groupId, outboundId, message, unit: current.unit, directSource:binding.sourceMode==='direct'?{sourceId:binding.sourceId,actorId:binding.actorId}:undefined, decision, sessionId: binding.sessionId,
      preflight: () => { assertUnchanged(binding);assertTarget(binding.groupId);if (!source(binding)) throw new Error('platform_schedule_source_stale') } })
    if(!binding.everySeconds)await settle(binding, 'replied')
  }
  const mount = async agent => {
    const binding = store.getPlatformSchedule?.(agent.id)
    if (!binding || binding.sessionId !== sessionKey(binding.requestId) || closed || mounted.has(agent)) return
    if(agent.metadata?.id!==agent.id||scopeOf(agent.ctx)!==agent||agent.lifecycle?.isLive()!==true||officialWorkingDirectoryOrigin(agent)!==agent.metadata.cwd||agent.metadata.origin==='subagent'||(agent.metadata.delegationDepth??0)>0)throw fail('platform_schedule_actor_unbound')
    if(agent.piSession&&ctx.get('agents').get(agent.id)!==agent)throw fail('platform_schedule_actor_unbound')
    const agentCtx = agent.ctx, disposers = [], pages = new Map()
    let snapshot, occurrenceAt, submission = Promise.resolve()
    const dueOutboundId=()=>outboundKey(binding.requestId+(occurrenceAt?':'+occurrenceAt:''))
    const checkComplete=tasks=>!!binding.stopWhen&&binding.stopWhen.taskIds.every(id=>{const task=tasks.find(row=>row.taskId===id&&row.groupId===binding.groupId);return task?.status==='completed'&&!task.technicalFailure&&!!task.completion&&['requirementRevision','controlRevision','runSequence'].every(key=>task.completion[key]===task[key])})
    const finishOccurrence=async({reported=true}={})=>{
      if(!binding.everySeconds)return
      if(!occurrenceAt)throw fail('platform_schedule_delivery_unproven')
      const tasks=await readTasks(binding.groupId)
      await store.updatePlatformSchedule(binding.sessionId,{lastOccurrenceAt:occurrenceAt})
      if(reported&&checkComplete(snapshot?.tasks??[])&&checkComplete(tasks)&&binding.stopWhen.taskIds.every(id=>isDeepStrictEqual(snapshot.tasks.find(task=>task.taskId===id)?.completion,tasks.find(task=>task.taskId===id)?.completion))){await settle(binding,'completed');await ctx.get('schedule').delete({sessionId:binding.sessionId,id:store.getPlatformSchedule(binding.sessionId).scheduleId})}
    }
    disposers.push(bindPlatformScheduleSource(agent,{isReady:()=>!closed&&mounted.get(agent)?.prepared===true}))
    const assert = exec => {
      assertUnchanged(binding)
      assertTarget(binding.groupId)
      if (exec.agent !== agent || !source(binding)) throw new Error('platform_schedule_source_stale')
    }
    disposers.push(agentCtx.get('tools').register({ name: 'platform_task_query', description: '查询本群到期执行时的真实任务快照，按 nextCall 读完所有页后答复。',
      parameters: { type: 'object', properties: { state: { enum: ['running', 'completed', 'all'] }, day: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, additionalProperties: false }, output,
      execute: async (args, exec) => {
        assert(exec)
        snapshot ??= { tasks: await readTasks(binding.groupId), asOf: now() }
        const page = platformTaskPage(snapshot.tasks, args, { groupId: binding.groupId, timezone: binding.timezone, now: snapshot.asOf })
        const key = JSON.stringify([args.state ?? 'all', args.day ?? null, args.limit ?? 50]), consumed = pages.get(key)?.consumed ?? 0
        if ((args.offset ?? 0) > consumed) throw new Error('platform_task_page_gap')
        pages.set(key, { consumed: Math.max(consumed, page.nextOffset), total: page.total })
        return {...page,...(binding.everySeconds?{stopWhen:binding.stopWhen??null,stopConditionMet:checkComplete(snapshot.tasks)}:{})}
      } }))
    disposers.push(agentCtx.get('tools').register({ name: 'platform_reply_submit', description: '提交本次到期结果到原群可靠发件箱。仅失去意义的过期提醒用 text=null 静默结清；有价值的汇报仍补报并注明实际时间。',
      parameters: platformReplyParameters, output,
      execute: (decision, exec) => submission = submission.catch(() => {}).then(async () => {
        const { text } = decision
        assert(exec)
        const saved = store.getPlatformSchedule(binding.sessionId)
        if (saved.outcome) {exec.concludeTurn();return { status: saved.outcome }}
        if ([...pages.values()].some(page => page.consumed < page.total)) throw new Error('platform_task_pages_unread')
        if (text === null) { if(binding.everySeconds){if(!snapshot)throw fail('platform_task_query_required');await finishOccurrence({reported:false})}else await settle(binding, 'expired'); exec.concludeTurn(); return { status: binding.everySeconds?'occurrence-settled':'expired' } }
        if (typeof text !== 'string' || !text.trim()) throw new Error('platform_reply_empty')
        if(binding.everySeconds&&!snapshot)throw fail('platform_task_query_required')
        await deliver(binding, decision, occurrenceAt)
        await finishOccurrence()
        exec.concludeTurn()
        return { status: 'accepted', outboundId: dueOutboundId() }
      }) }))
    if(typeof agent.requestPolicy?.addBeforeRequest!=='function')throw fail('platform_schedule_request_policy_required')
    disposers.push(agent.requestPolicy.addBeforeRequest(async ({actor,signal})=>{
      signal?.throwIfAborted()
      assertTarget(binding.groupId)
      if(actor!==agent||closed)throw fail('platform_schedule_closed')
      let saved=store.getPlatformSchedule(binding.sessionId)
      if(!saved||saved.outcome)throw fail('platform_schedule_settled')
      if(!source(binding)){await settle(binding,'superseded');throw fail('platform_schedule_superseded')}
      if(Date.parse(binding.at)>now())throw fail('platform_schedule_not_due')
      const schedule=ctx.get('schedule'),native=(await schedule.catalog()).find(record=>matchesNative(saved,record))
      if(!native){await settle(binding,'superseded');throw fail('platform_schedule_superseded')}
      if(!saved.scheduleId){await store.updatePlatformSchedule(binding.sessionId,{scheduleId:native.id});saved=store.getPlatformSchedule(binding.sessionId)}
      const current=await agent.admission.current(),packet=current?.messages?.length===1?current.messages[0]:undefined
      if(!packet||!isDeepStrictEqual(packet,agent.admission.lookupPacket(packet.id)))throw fail('platform_schedule_delivery_unproven')
      let original=packet
      if(packet.source?.kind==='platform-schedule-recovery'){
        original=agent.admission.lookupPacket(packet.source.originalPacketId)
        if(!isDeepStrictEqual(packet,recoveryInput(binding,native))||!(await agent.receipts.read()).some(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued-internal'&&isDeepStrictEqual(receipt.payload,packet)))throw fail('platform_schedule_delivery_unproven')
      }
      if(!original||!await schedule.authorizeInput(original,agent))throw fail('platform_schedule_delivery_unproven')
      const occurrence=original.source?.occurrences?.find(item=>item.id===native.id)
      if(!occurrence||original.source.occurrences.length!==1)throw fail('platform_schedule_delivery_unproven')
      if(binding.everySeconds){
        if(Date.parse(occurrence.occurrenceAt)>now())throw fail('platform_schedule_not_due')
        if(saved.lastOccurrenceAt&&occurrence.occurrenceAt<=saved.lastOccurrenceAt)throw fail('platform_schedule_settled')
        if(occurrenceAt!==occurrence.occurrenceAt){occurrenceAt=occurrence.occurrenceAt;snapshot=undefined;pages.clear()}
      }else if(original.id!==native.lastDelivery?.messageId)throw fail('platform_schedule_delivery_unproven')
      const previous=store.getGroup(binding.groupId).outbox.find(item=>item.outboundId===dueOutboundId())
      if(previous){await deliver(binding,undefined,occurrenceAt);await finishOccurrence();throw fail('platform_schedule_settled')}
    }))
    disposers.push(agentCtx.get('systemPrompt').section({ name: 'conversation-platform-schedule', order: 120, officialText: ({actor}) => {if(actor!==agent)throw fail('platform_schedule_actor_mismatch');return `这是宿主持有的独立平台定时会话，仅执行原用户已交办的事项，不创建业务任务，不重新安排同一提醒。${binding.everySeconds?'这是周期检查，每次必须重新查询当前事实；首次回复不结束周期。宿主仅在指定任务当前版本全部完成时停止。':''}原群=${binding.groupId}；约定时间=${binding.at}；默认时区=${binding.timezone}；本次恢复时刻=${new Date(now()).toISOString()}。原消息=${JSON.stringify(source(binding)?.unit?.sourceRanges ?? [{sourceId:binding.sourceId,text:source(binding)?.message.text}])}。事项：${binding.prompt}。到期汇报先调用 platform_task_query 读取本群最新事实，分页读全，再调用 platform_reply_submit 提交原群答复，普通自然语言不会发送。结合原消息的明确时区与实际执行时刻重新核对目标；已过期的有价值汇报补报一次并注明实际时间和延迟，失去意义的定点提醒可 text=null 静默结清，不得改排明天。只有不确定且影响执行才澄清。宿主的 schedule 送入会话回执不代表汇报已发送；只有原群通知账确认才称送达。`} }))
    disposers.push(agentCtx.get('systemPrompt').section({ name: 'conversation-reply', order: 119, officialText: ({actor}) => actor===agent?conversationReplyInstructions:'' }))
    disposers.push(agentCtx.get('systemPrompt').section({ name: 'conversation-notification', order: 121,
      officialText: ({actor}) => {if(actor!==agent)throw fail('platform_schedule_actor_mismatch');return `${conversationNotificationInstructions}\n受信原请求与近期群上下文（不代表全部都要通知）：${JSON.stringify(platformNotificationContext(store.getGroup(binding.groupId), source(binding)?.message ?? {}))}`} }))
    mounted.set(agent, {disposers,prepared:!agent.piSession})
  }
  const stopPrepared=ctx.on?.('night/agent-prepare',({agent})=>mount(agent))
  const stopCreated = ctx.on?.('agent/created', ({ agent }) => {mount(agent);if(store.getPlatformSchedule?.(agent.id))watch(agent)})
  const stopDisposed = ctx.on?.('agent/disposed', ({ agent }) => {const entry=mounted.get(agent);mounted.delete(agent);watchers.get(agent)?.();watchers.delete(agent);for(const dispose of entry?.disposers??[])dispose?.()})
  // Schedule can restore a due actor before Resident finishes loading. Its
  // accepted ledger and durable business packet authorize one recovery after idle;
  // ordinary successful turns need no additional model call or timer.
  const recoverOnce = async () => {
      if (closed) return
      const schedule = ctx.get?.('schedule'), controller = ctx.get?.('sessionController')
      if (!schedule || !controller) return
      for(const group of store.listGroups())for(const binding of store.listPlatformSchedules(group.groupId)){
        if(binding.managementKey&&!binding.managementCompleted)try{await serialize(binding.sessionId,()=>finishManagement(binding))}catch(error){ctx.logger?.warn?.('platform schedule management recovery: '+error.message)}
      }
      for (const record of await schedule.catalog()) {
        const binding = store.getPlatformSchedule?.(record.sessionId)
        if(binding?.everySeconds&&binding.outcome&&matchesNative(binding,record)){await schedule.delete({sessionId:binding.sessionId,id:record.id});continue}
        if (!binding || binding.outcome || !matchesNative(binding, record) || (!binding.everySeconds&&record.status !== 'inactive') || !record.lastDelivery || (binding.everySeconds&&binding.lastOccurrenceAt&&record.lastDelivery.scheduledAt<=binding.lastOccurrenceAt) || recovered.has(record.id+':'+record.lastDelivery.messageId)) continue
        assertTarget(binding.groupId);recoveryGroups.add(binding.groupId)
        try{
        let result=await controller.resolveAgent(record.sessionId)
        if(result.error)throw result.error
        if(closed)return
        // Inactive records are committed before Schedule's original enqueue.
        // Do not dispose that writer until its real packet has been admitted.
        const originalActor=result.agent
        watch(originalActor)
        const firstPacket=originalActor.admission.lookupPacket(record.lastDelivery.messageId)
        if(!firstPacket||originalActor.admission.status(firstPacket.id)==='pending')continue
        if(originalActor.admission.status(firstPacket.id)==='cancelled')continue
        if(originalActor.admission.status(firstPacket.id)!=='admitted'||!await schedule.authorizeInput(firstPacket,originalActor))throw fail('platform_schedule_delivery_unproven')
        if(!mounted.get(result.agent)?.prepared){
          await result.agent.dispose()
          result=await controller.resolveAgent(record.sessionId)
          if(result.error)throw result.error
        }
        const actor=result.agent
        watch(actor)
        if(!mounted.get(actor)?.prepared)throw fail('platform_schedule_prepared_tools_required')
        try{await actor.whenIdle()}catch(error){if(!['platform_schedule_settled','platform_schedule_superseded'].includes(error.code))throw error}
        const latest=store.getPlatformSchedule(record.sessionId)
        if(closed||latest.outcome||(binding.everySeconds&&latest.lastOccurrenceAt&&record.lastDelivery.scheduledAt<=latest.lastOccurrenceAt))continue
        const original=actor.admission.lookupPacket(record.lastDelivery.messageId)
        if(!original)continue
        if(!await schedule.authorizeInput(original,actor))throw fail('platform_schedule_delivery_unproven')
        const status=actor.admission.status(original.id)
        if(status==='pending')continue
        if(status==='cancelled')continue
        if(status!=='admitted')throw fail('platform_schedule_delivery_unproven')
        recovered.add(record.id+':'+record.lastDelivery.messageId)
        const packet=recoveryInput(binding,record)
        assertTarget(binding.groupId)
        const sendRecovery=async()=>{
          if(closed)return
          await actor.whenIdle().catch(()=>{})
          const saved=store.getPlatformSchedule(record.sessionId)
          if(closed||saved.outcome||(binding.everySeconds&&saved.lastOccurrenceAt&&record.lastDelivery.scheduledAt<=saved.lastOccurrenceAt))return
          await enqueueBusinessNotice(actor,packet)
          try{await actor.input.deliver(packet.id,{deliverAs:'followUp'});await actor.whenIdle()}catch(error){if(!['platform_schedule_settled','platform_schedule_superseded'].includes(error.code))throw error}
        }
        if(binding.everySeconds)await schedule.runtime.serializePlatformDelivery(record.sessionId,sendRecovery)
        else await sendRecovery()
        }finally{recoveryGroups.delete(binding.groupId)}
      }
  }
  const recover = () => {
    if(closed)return
    recoveryRequested=true
    if(recoveryRunning)return
    recoveryRunning=true
    recovery=hostScheduler(async()=>{while(recoveryRequested&&!closed){recoveryRequested=false;await recoverOnce()}}).finally(()=>{recoveryRunning=false;if(recoveryRequested&&!closed)recover()})
    void recovery.catch(error=>ctx.logger?.warn?.(`platform schedule recovery: ${error.message}`))
  }
  const stopChanged = ctx.on?.('schedule/changed', recover)
  ctx.inject?.(['schedule'], () => { recover() })
  async function prepare(binding, {acceptedReplacement=false}={}) {
    assertTarget(binding.groupId)
    const schedule = ctx.get('schedule')
    if (!schedule?.create || !ctx.get('sessionController')) throw new Error('platform_native_schedule_unavailable')
    if (!source(binding)) throw new Error('platform_schedule_source_stale')
    // Recover a native create committed before its local receipt, including an
    // already-fired entry. Never recreate a deleted, previously accepted record.
    const existing = store.getPlatformSchedule(binding.sessionId)
    if (existing && ['title', 'prompt', 'at', 'timezone','everySeconds','stopWhen'].some(key => !isDeepStrictEqual(existing[key],binding[key]))) throw new Error('platform_schedule_identity_conflict')
    if(existing?.replacementOfSessionId){
      const parent=store.getPlatformSchedule(existing.replacementOfSessionId)
      if(!parent?.managementKey||parent.replacementSessionId!==existing.sessionId||
        (await schedule.catalog()).some(row=>row.sessionId===parent.sessionId))throw fail('platform_schedule_replacement_pending')
    }
    if(existing?.outcome)return {status:existing.outcome,scheduleId:existing.scheduleId}
    const native = existing ? (await schedule.catalog()).find(item => item.sessionId === binding.sessionId) : null
    if (native) {
      if (!matchesNative(existing, native)) throw new Error('platform_schedule_identity_conflict')
      await store.updatePlatformSchedule(binding.sessionId, { scheduleId: native.id })
      return { status: native.status === 'active' ? 'scheduled' : 'triggered', scheduleId: native.id, at: native.scheduledAt,...(binding.everySeconds?{every_seconds:binding.everySeconds,stopWhen:binding.stopWhen??null}:{}) }
    }
    if (existing?.scheduleId || existing?.outcome) return { status: existing.outcome ?? 'cancelled', scheduleId: existing.scheduleId }
    if (Date.parse(binding.at) <= now()) {
      if(!acceptedReplacement)return {status:'expired',at:binding.at}
      // Preserve the requested instant in the binding/prompt. Native creation
      // requires a future clock target; a committed replacement missed during
      // downtime is admitted promptly instead of silently losing the request.
      binding={...binding,nativeAt:new Date(now()+1000).toISOString()}
      await store.updatePlatformSchedule(binding.sessionId,{nativeAt:binding.nativeAt})
    }
    assertTarget(binding.groupId)
    await store.preparePlatformSchedule(binding)
    if (!await ctx.sessionPersistence.stat(binding.sessionId)) {
      const cwd = await sessionWorkspace(root, 'platform')
      // A new ordinary official session retains its own durable business metadata.
      // The calling actor keeps its original delegation identity.
      const handle = await ctx.agents.withoutInitiator(() => ctx.agents.create({ sessionId: binding.sessionId,
        meta: { cwd, agentPreset: legacy.getAgentConfig().agentPreset, runtimeOwner:'platform-schedule' },
        agentOptions: typeof models === 'function' ? models() : models,
        authorizeInput:(packet,actor)=>ctx.get('schedule').authorizeInput(packet,actor),
        setup:async(agentCtx,actor)=>{
          await agentCtx.get('agentPresets').mount(agentCtx,legacy.getAgentConfig().agentPreset)
          await agentCtx.get('permissionPresets').set(actor,'danger-full-access')
        } }))
      try {
        handle.session.setSessionName(sessionTitle('platform',binding.title))
        await handle.actor.receipts.commit()
      } finally { await handle.dispose() }
    }
    if (!source(binding)) throw new Error('platform_schedule_source_stale')
    const record = await schedule.create(binding.sessionId, { title: binding.title, prompt: deliveryPrompt(binding), ...(binding.everySeconds?{every_seconds:binding.everySeconds}:{at:binding.nativeAt??binding.at}) })
    await store.updatePlatformSchedule(binding.sessionId, { scheduleId: record.id })
    return { status: 'scheduled', scheduleId: record.id, at: record.scheduledAt,...(binding.everySeconds?{every_seconds:binding.everySeconds,stopWhen:binding.stopWhen??null}:{}) }
  }
  async function validate(sourceBinding, { title, prompt, at, every_seconds, stopWhen }) {
      if((at!==undefined)+(every_seconds!==undefined)!==1)throw fail('platform_schedule_timing_required')
      if(every_seconds!==undefined&&(!Number.isSafeInteger(every_seconds)||every_seconds<60))throw fail('platform_schedule_interval_invalid')
      if(stopWhen!==undefined){
        if(every_seconds===undefined||!stopWhen||Object.keys(stopWhen).length!==1||!Array.isArray(stopWhen.taskIds)||!stopWhen.taskIds.length||stopWhen.taskIds.length>30||new Set(stopWhen.taskIds).size!==stopWhen.taskIds.length||stopWhen.taskIds.some(id=>typeof id!=='string'||!id))throw fail('platform_schedule_stop_invalid')
        const tasks=await readTasks(sourceBinding.groupId)
        if(stopWhen.taskIds.some(id=>!tasks.some(task=>task.taskId===id&&task.groupId===sourceBinding.groupId)))throw fail('platform_schedule_task_forbidden')
      }
      if (every_seconds===undefined&&(typeof at !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at)))) throw new Error('platform_schedule_time_requires_offset')
      if (every_seconds===undefined&&!z.string().datetime({ offset: true }).safeParse(at).success) throw new Error('platform_schedule_time_invalid')
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 120 || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('platform_schedule_invalid')
      const binding = { ...sourceBinding, sessionId: sessionKey(sourceBinding.requestId), title: title.trim(), prompt: prompt.trim(), ...(every_seconds!==undefined?{everySeconds:every_seconds,...(stopWhen?{stopWhen}:{})}:{at:new Date(at).toISOString()}) }
      return binding
  }
  async function serialize(sessionId, run) {
    const groupId=store.getPlatformSchedule(sessionId)?.groupId
    const previous=flights.get(sessionId)??Promise.resolve()
    const work=previous.catch(()=>{}).then(run)
    flights.set(sessionId,work);if(groupId)flightGroups.set(work,groupId)
    try{return await work}finally{if(flights.get(sessionId)===work)flights.delete(sessionId);flightGroups.delete(work)}
  }
  async function finishManagement(binding) {
    binding=store.getPlatformSchedule(binding.sessionId)
    if(!binding?.managementKey)return
    const schedule=ctx.get('schedule')
    // Tombstone is durable before deletion. Pending/admitted old packets cannot
    // pass platform source/preflight checks even if native delivery already won.
    if(binding.scheduleId){
      await schedule.delete({sessionId:binding.sessionId,id:binding.scheduleId})
      if((await schedule.catalog()).some(row=>row.id===binding.scheduleId&&row.sessionId===binding.sessionId))throw fail('platform_schedule_cancel_incomplete')
    }
    const actor=ctx.get('agents')?.get(binding.sessionId)
    if(actor){await schedule.cancelAccepted?.(actor);await actor.dispose()}
    if(binding.replacementSessionId){
      const replacement=store.getPlatformSchedule(binding.replacementSessionId)
      if(!replacement)throw fail('platform_schedule_replacement_missing')
      const result=replacement.outcome?{status:replacement.outcome,scheduleId:replacement.scheduleId}:await prepare(replacement,{acceptedReplacement:true})
      await store.updatePlatformSchedule(binding.sessionId,{managementCompleted:true})
      return result
    }
    await store.updatePlatformSchedule(binding.sessionId,{managementCompleted:true})
    return {status:'cancelled',scheduleId:binding.scheduleId}
  }
  async function manage(sourceBinding,args,action){
    if(closed)throw fail('platform_schedule_closed')
    assertTarget(sourceBinding.groupId)
    const native=(await ctx.get('schedule').catalog()).find(row=>row.id===args.scheduleId)
    const binding=store.listPlatformSchedules(sourceBinding.groupId).find(row=>row.scheduleId===args.scheduleId||!row.scheduleId&&native?.sessionId===row.sessionId)
    if(binding&&!binding.scheduleId)await store.updatePlatformSchedule(binding.sessionId,{scheduleId:args.scheduleId})
    if(!binding)throw fail('platform_schedule_not_found')
    return serialize(binding.sessionId,async()=>{
      const current=store.getPlatformSchedule(binding.sessionId)
      const key=JSON.stringify([sourceBinding.requestId,action,args])
      if(current.managementKey){
        if(current.managementKey!==key)throw fail('platform_schedule_already_changed')
        return {...await finishManagement(current),replacesScheduleId:action==='update'?current.scheduleId:undefined}
      }
      if(current.outcome)throw fail('platform_schedule_settled')
      if(!source({...sourceBinding,sessionId:sessionKey(sourceBinding.requestId)}))throw fail('platform_schedule_source_stale')
      let replacement
      if(action==='update'){
        const change=args.change
        if(!change||!Object.keys(change).length||Object.keys(change).some(key=>!['title','prompt','at','every_seconds','stopWhen'].includes(key)))throw fail('platform_schedule_update_invalid')
        const timing=change.at!==undefined||change.every_seconds!==undefined
          ? {at:change.at,every_seconds:change.every_seconds}
          : current.everySeconds?{every_seconds:current.everySeconds}:{at:current.at}
        replacement=await validate(sourceBinding,{title:current.title,prompt:current.prompt,...timing,
          ...(current.stopWhen&&timing.every_seconds!==undefined?{stopWhen:current.stopWhen}:{}),...change})
        if(replacement.at&&Date.parse(replacement.at)<=now())throw fail('platform_schedule_time_past')
        if(replacement.sessionId===current.sessionId)throw fail('platform_schedule_operation_reused')
        replacement={...replacement,replacementOfSessionId:current.sessionId}
        await store.preparePlatformSchedule(replacement)
      }
      await store.updatePlatformSchedule(current.sessionId,{outcome:action==='delete'?'cancelled':'superseded',completedAt:new Date(now()).toISOString(),managementKey:key,...(replacement?{replacementSessionId:replacement.sessionId}:{})})
      const result=await finishManagement(store.getPlatformSchedule(current.sessionId))
      return {...result,...(replacement?{replacesScheduleId:current.scheduleId}:{})}
    })
  }
  return {
    async list(groupId){
      assertTarget(groupId)
      const catalog=await ctx.get('schedule').catalog()
      return store.listPlatformSchedules(groupId).filter(binding=>!binding.outcome).map(binding=>{
        const native=catalog.find(row=>row.sessionId===binding.sessionId&&(!binding.scheduleId||row.id===binding.scheduleId))
        return {scheduleId:binding.scheduleId??native?.id,title:binding.title,prompt:binding.prompt,timezone:binding.timezone,
          ...(binding.everySeconds?{every_seconds:binding.everySeconds,stopWhen:binding.stopWhen??null}:{at:binding.at}),
          status:native?.status==='active'?'scheduled':native?'triggered':'cancelled',scheduledAt:native?.scheduledAt}
      }).filter(row=>row.scheduleId)
    },
    update:(sourceBinding,args)=>manage(sourceBinding,args,'update'),
    delete:(sourceBinding,args)=>manage(sourceBinding,args,'delete'),
    hasInflight:groupId=>[...flightGroups.values()].includes(groupId)||recoveryGroups.has(groupId),
    async submit(sourceBinding, args) {
      const binding = await validate(sourceBinding,args)
      assertTarget(binding.groupId)
      const previous = flights.get(binding.sessionId) ?? Promise.resolve()
      const work = previous.catch(() => {}).then(() => prepare(binding))
      flights.set(binding.sessionId, work);flightGroups.set(work,binding.groupId)
      try { return await work } finally { if (flights.get(binding.sessionId) === work) flights.delete(binding.sessionId);flightGroups.delete(work) }
    },
    async close() {
      closed = true;for(const detach of watchers.values())detach();watchers.clear(); stopPrepared?.(); stopCreated?.(); stopDisposed?.(); stopChanged?.()
      const draining=Promise.allSettled([...mounted.keys()].map(actor=>actor.dispose()))
      await Promise.allSettled([...flights.values(),recovery])
      const failed=(await draining).filter(result=>result.status==='rejected').map(result=>result.reason)
      if(failed.length)throw new AggregateError(failed,'Platform schedule drain failed')
      for(const {disposers}of mounted.values())for(const dispose of disposers)await dispose?.()
      mounted.clear()
    },
  }
}
