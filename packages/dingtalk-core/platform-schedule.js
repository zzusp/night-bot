import {AsyncLocalStorage} from 'node:async_hooks'
import {bindPlatformScheduleSource} from '../../src/runtime/pi-platform-source.js'
import {scopeOf} from '../../src/native-scope.js'
import {officialWorkingDirectoryOrigin} from '../../src/native-working-directory.js'
import {isDeepStrictEqual} from 'node:util'
import {enqueueBusinessNotice} from '../../src/runtime/pi-business-notices.js'
import { fixedUnitRequestId, platformTaskPage, platformScheduleSessionId as sessionKey, platformScheduleOutboundId as outboundKey } from './fixed-topics.js'
import { sessionWorkspace, sessionTitle } from './session-workspaces.js'
import { groupReplyInstructions } from './group-message.js'
import { z } from 'zod'
import { createPlatformNotifier, platformNotificationContext, platformReplyParameters } from './platform-notification.js'
import { groupNotificationInstructions } from './group-notification.js'

const fail=code=>Object.assign(new Error(code),{code})
const output = { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
const deliveryPrompt = binding => `执行原群已授权的一次平台事项：${binding.prompt}\n约定时间 ${binding.at}，原群 ${binding.groupId}。必须先使用 platform_task_query 核对本群事实，再用 platform_reply_submit 提交；这两个工具未就绪时等待宿主恢复，不自行发群、不改排时间、不创建业务任务。已过期时判断补报或失去意义而静默，不能把入站提醒当已交付。`
const matchesNative = (binding, record) => record?.kind === 'at' && record.sessionId === binding.sessionId && record.scheduledAt === binding.at
  && record.prompt === deliveryPrompt(binding) && record.title === binding.title && (!binding.scheduleId || binding.scheduleId === record.id)

const recoveryInput=(binding,record)=>({id:`${record.id}-platform-recovery:${record.lastDelivery.messageId}`,source:{kind:'platform-schedule-recovery',scheduleId:record.id,originalPacketId:record.lastDelivery.messageId,requestId:binding.requestId},content:`[SCHEDULE REMINDER]\n原生定时已在 ${record.lastDelivery.deliveredAt} 投入本会话，平台工具现已就绪。沿原事项补报或判断过期，只通过 platform_reply_submit 结清；不要创建新的 schedule。`})

// Native Schedule owns timing, storage and cold-session delivery. This bridge
// owns only the accepted source binding and its existing outbox identity.
export function createPlatformSchedules({ ctx, store, legacy, root, models, readTasks, appendOutbox, notify = createPlatformNotifier({ store, root, appendOutbox }), now = Date.now }) {
  if(ctx.get?.('agents')?.currentInitiator?.()!==undefined)throw fail('platform_schedule_host_context_required')
  const hostScheduler=AsyncLocalStorage.snapshot(),watchers=new Map()
  let closed = false
  const watch=actor=>{if(watchers.has(actor)||!actor.piSession)return;watchers.set(actor,actor.piSession.subscribe(event=>{if(event.type==='agent_settled')recover()}))}
  const flights = new Map(), mounted = new Map(), recovered = new Set()
  let recovery = Promise.resolve(),recoveryRunning=false,recoveryRequested=false
  const source = binding => {
    if (closed) return null
    const message = store.getGroup(binding.groupId)?.messages.find(item => item.messageId === binding.messageId && item.messageVersion === binding.messageVersion)
    const unit = message?.units?.find(item => item.unitId === binding.unitId && item.unitRevision === binding.unitRevision && item.fixedTopic === 'agent-platform')
    return unit && message.activeUnitRefs?.some(ref => ref.unitId === unit.unitId && ref.unitRevision === unit.unitRevision)
      && fixedUnitRequestId(binding.groupId, message, unit) === binding.requestId ? { message, unit } : null
  }
  const settle = (binding, outcome) => store.updatePlatformSchedule(binding.sessionId, { outcome, completedAt: new Date(now()).toISOString() })
  async function deliver(binding, decision) {
    const current = source(binding)
    if (!current) throw new Error('platform_schedule_source_stale')
    const outboundId = outboundKey(binding.requestId), message = current.message
    await notify({ groupId: binding.groupId, outboundId, message, unit: current.unit, decision, sessionId: binding.sessionId,
      preflight: () => { if (!source(binding)) throw new Error('platform_schedule_source_stale') } })
    await settle(binding, 'replied')
  }
  const mount = async agent => {
    const binding = store.getPlatformSchedule?.(agent.id)
    if (!binding || binding.sessionId !== sessionKey(binding.requestId) || closed || mounted.has(agent)) return
    if(agent.metadata?.id!==agent.id||scopeOf(agent.ctx)!==agent||agent.lifecycle?.isLive()!==true||officialWorkingDirectoryOrigin(agent)!==agent.metadata.cwd||agent.metadata.origin==='subagent'||(agent.metadata.delegationDepth??0)>0)throw fail('platform_schedule_actor_unbound')
    if(agent.piSession&&ctx.get('agents').get(agent.id)!==agent)throw fail('platform_schedule_actor_unbound')
    const agentCtx = agent.ctx, disposers = [], pages = new Map()
    let snapshot, submission = Promise.resolve()
    disposers.push(bindPlatformScheduleSource(agent,{isReady:()=>!closed&&mounted.get(agent)?.prepared===true}))
    const assert = exec => {
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
        return page
      } }))
    disposers.push(agentCtx.get('tools').register({ name: 'platform_reply_submit', description: '提交本次到期结果到原群可靠发件箱。仅失去意义的过期提醒用 text=null 静默结清；有价值的汇报仍补报并注明实际时间。',
      parameters: platformReplyParameters, output,
      execute: (decision, exec) => submission = submission.catch(() => {}).then(async () => {
        const { text } = decision
        assert(exec)
        const saved = store.getPlatformSchedule(binding.sessionId)
        if (saved.outcome) {exec.concludeTurn();return { status: saved.outcome }}
        if (text === null) { await settle(binding, 'expired'); exec.concludeTurn(); return { status: 'expired' } }
        if (typeof text !== 'string' || !text.trim()) throw new Error('platform_reply_empty')
        if ([...pages.values()].some(page => page.consumed < page.total)) throw new Error('platform_task_pages_unread')
        await deliver(binding, decision)
        exec.concludeTurn()
        return { status: 'accepted', outboundId: outboundKey(binding.requestId) }
      }) }))
    if(typeof agent.requestPolicy?.addBeforeRequest!=='function')throw fail('platform_schedule_request_policy_required')
    disposers.push(agent.requestPolicy.addBeforeRequest(async ({actor,signal})=>{
      signal?.throwIfAborted()
      if(actor!==agent||closed)throw fail('platform_schedule_closed')
      let saved=store.getPlatformSchedule(binding.sessionId)
      if(!saved||saved.outcome)throw fail('platform_schedule_settled')
      if(!source(binding)){await settle(binding,'superseded');throw fail('platform_schedule_superseded')}
      if(Date.parse(binding.at)>now())throw fail('platform_schedule_not_due')
      const schedule=ctx.get('schedule'),native=(await schedule.catalog()).find(record=>matchesNative(saved,record))
      if(!native){await settle(binding,'superseded');throw fail('platform_schedule_superseded')}
      if(!saved.scheduleId){await store.updatePlatformSchedule(binding.sessionId,{scheduleId:native.id});saved=store.getPlatformSchedule(binding.sessionId)}
      const originalId=native.lastDelivery?.messageId,original=agent.admission.lookupPacket(originalId)
      if(!originalId||!original||!await schedule.authorizeInput(original,agent))throw fail('platform_schedule_delivery_unproven')
      const current=await agent.admission.current(),packet=current?.messages?.length===1?current.messages[0]:undefined
      if(!packet||!isDeepStrictEqual(packet,agent.admission.lookupPacket(packet.id)))throw fail('platform_schedule_delivery_unproven')
      if(packet.id!==originalId){
        const recoveryPacket=recoveryInput(binding,native)
        if(!isDeepStrictEqual(packet,recoveryPacket)||!(await agent.receipts.read()).some(receipt=>receipt.domain==='admission'&&receipt.kind==='enqueued-internal'&&isDeepStrictEqual(receipt.payload,packet)))throw fail('platform_schedule_delivery_unproven')
      }
      const previous=store.getGroup(binding.groupId).outbox.find(item=>item.outboundId===outboundKey(binding.requestId))
      if(previous){await deliver(binding);throw fail('platform_schedule_settled')}
    }))
    disposers.push(agentCtx.get('systemPrompt').section({ name: 'dingtalk-platform-schedule', order: 120, officialText: ({actor}) => {if(actor!==agent)throw fail('platform_schedule_actor_mismatch');return `这是宿主持有的独立平台定时会话，仅执行原用户已交办的一次事项，不创建业务任务，不重新安排同一提醒。原群=${binding.groupId}；约定时间=${binding.at}；默认时区=${binding.timezone}；本次恢复时刻=${new Date(now()).toISOString()}。原消息=${JSON.stringify(source(binding)?.unit.sourceRanges ?? [])}。事项：${binding.prompt}。到期汇报先调用 platform_task_query 读取本群最新事实，分页读全，再调用 platform_reply_submit 提交原群答复，普通自然语言不会发送。结合原消息的明确时区与实际执行时刻重新核对目标；已过期的有价值汇报补报一次并注明实际时间和延迟，失去意义的定点提醒可 text=null 静默结清，不得改排明天。只有不确定且影响执行才澄清。宿主的 schedule 送入会话回执不代表汇报已发送；只有原群通知账确认才称送达。`} }))
    disposers.push(agentCtx.get('systemPrompt').section({ name: 'dingtalk-group-reply', order: 119, officialText: ({actor}) => actor===agent?groupReplyInstructions:'' }))
    disposers.push(agentCtx.get('systemPrompt').section({ name: 'dingtalk-notification', order: 121,
      officialText: ({actor}) => {if(actor!==agent)throw fail('platform_schedule_actor_mismatch');return `${groupNotificationInstructions}\n受信原请求与近期群上下文（不代表全部都要通知）：${JSON.stringify(platformNotificationContext(store.getGroup(binding.groupId), source(binding)?.message ?? {}))}`} }))
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
      for (const record of await schedule.catalog()) {
        const binding = store.getPlatformSchedule?.(record.sessionId)
        if (!binding || binding.outcome || !matchesNative(binding, record) || record.status !== 'inactive' || !record.lastDelivery || recovered.has(record.id)) continue
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
        if(closed||store.getPlatformSchedule(record.sessionId).outcome)continue
        const original=actor.admission.lookupPacket(record.lastDelivery.messageId)
        if(!original)continue
        if(!await schedule.authorizeInput(original,actor))throw fail('platform_schedule_delivery_unproven')
        const status=actor.admission.status(original.id)
        if(status==='pending')continue
        if(status==='cancelled')continue
        if(status!=='admitted')throw fail('platform_schedule_delivery_unproven')
        recovered.add(record.id)
        const packet=recoveryInput(binding,record)
        await enqueueBusinessNotice(actor,packet)
        try{await actor.input.deliver(packet.id,{deliverAs:'followUp'})}catch(error){if(!['platform_schedule_settled','platform_schedule_superseded'].includes(error.code))throw error}

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
  async function prepare(binding) {
    const schedule = ctx.get('schedule')
    if (!schedule?.create || !ctx.get('sessionController')) throw new Error('platform_native_schedule_unavailable')
    if (!source(binding)) throw new Error('platform_schedule_source_stale')
    // Recover a native create committed before its local receipt, including an
    // already-fired entry. Never recreate a deleted, previously accepted record.
    const existing = store.getPlatformSchedule(binding.sessionId)
    if (existing && ['title', 'prompt', 'at', 'timezone'].some(key => existing[key] !== binding[key])) throw new Error('platform_schedule_identity_conflict')
    const native = existing ? (await schedule.catalog()).find(item => item.sessionId === binding.sessionId) : null
    if (native) {
      if (!matchesNative(existing, native)) throw new Error('platform_schedule_identity_conflict')
      await store.updatePlatformSchedule(binding.sessionId, { scheduleId: native.id })
      return { status: native.status === 'active' ? 'scheduled' : 'triggered', scheduleId: native.id, at: native.scheduledAt }
    }
    if (existing?.scheduleId || existing?.outcome) return { status: existing.outcome ?? 'cancelled', scheduleId: existing.scheduleId }
    if (Date.parse(binding.at) <= now()) return { status: 'expired', at: binding.at }
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
    const record = await schedule.create(binding.sessionId, { title: binding.title, prompt: deliveryPrompt(binding), at: binding.at })
    await store.updatePlatformSchedule(binding.sessionId, { scheduleId: record.id })
    return { status: 'scheduled', scheduleId: record.id, at: record.scheduledAt }
  }
  return {
    async submit(sourceBinding, { title, prompt, at }) {
      if (typeof at !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) throw new Error('platform_schedule_time_requires_offset')
      if (!z.string().datetime({ offset: true }).safeParse(at).success) throw new Error('platform_schedule_time_invalid')
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 120 || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('platform_schedule_invalid')
      const binding = { ...sourceBinding, sessionId: sessionKey(sourceBinding.requestId), title: title.trim(), prompt: prompt.trim(), at: new Date(at).toISOString() }
      const previous = flights.get(binding.sessionId) ?? Promise.resolve()
      const work = previous.catch(() => {}).then(() => prepare(binding))
      flights.set(binding.sessionId, work)
      try { return await work } finally { if (flights.get(binding.sessionId) === work) flights.delete(binding.sessionId) }
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
