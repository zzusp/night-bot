import {traceSourcesMetadata,traceTaskEventsMetadata} from '../runtime/pi-agent-observation.js'
import {sourceStageTiming} from './source-stage-timing.js'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {sessionWorkspace} from '../../packages/dingtalk-core/session-workspaces.js'
import {conversationSource} from './message-safety.js'
import {routerModelBody,routerModelBatch,routerModelEvent,followUpSettlementArgs} from './router-model-input.js'
import {pendingBusinessInputs} from '../runtime/pi-business-inputs.js'
import {residentOperationId} from './resident-router-business.js'
import {independentRouterFileEffect,unresolvedRouterCalls} from '../runtime/pi-router-recovery-view.js'
import {classifyPiFailure} from '../pi-provider-events.js'

const fail=(code,recoveryReason)=>{throw Object.assign(new Error(code),{code,...recoveryReason?{recoveryReason}:{}})}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const routerCheckpointTail=branch=>branch.findLast(entry=>entry.type==='message'||entry.type==='custom_message'&&entry.customType==='night.business-input')
const routerTimedOut=entry=>entry?.message?.role==='assistant'&&classifyPiFailure(entry.message)?.code==='TIMEOUT'
const operatorInput=event=>{if(event.kind!=='operator.message')return event;const {operatorReply,...input}=event;return input}
const withoutTiming=source=>{if(!source)return source;const {stages,...value}=source;return value}
const triageDeliveryFields=new Set('state ack ackedAt deliveredAt deliveryError dispatchToken evidenceRef lastReadbackError nextAttemptAt readbackAttemptCount receipt recoveryToken sendAttemptCount sendPermit sendStartedAt updatedAt'.split(' '))
const triageReplyIdentity=reply=>reply?.kind==='triage-reply'?Object.fromEntries(Object.entries(reply).filter(([key])=>!triageDeliveryFields.has(key))):reply
// 观测计时与首答发送/回读进度不改变原输入身份；冻结载荷及撤销状态仍须完全一致。
// 仅比较副本，原 journal/packet 和投递账本继续保留真实原貌。
function comparableRouterPacket(packet){
  if(packet?.source?.kind!=='conversation-router')return packet
  const copy=structuredClone(packet)
  delete copy.source.traceSources;delete copy.source.traceTaskEvents
  for(const block of copy.content??[]){
    if(block.type!=='text'||!block.text.startsWith('Router 请求：'))continue
    try{const body=JSON.parse(block.text.slice('Router 请求：'.length));if(!Array.isArray(body.events))continue;body.events=body.events.map(event=>({...event,...event.source?{source:withoutTiming(event.source)}:{},...event.triageReply?{triageReply:triageReplyIdentity(event.triageReply)}:{}}));block.text='Router 请求：'+JSON.stringify(body)}catch{}
  }
  return copy
}
export const sameRouterPacket=(left,right)=>isDeepStrictEqual(comparableRouterPacket(left),comparableRouterPacket(right))
function buildRouterPacketViews(row,batch,legacyProgressIdentity=false){
    const id=`router-input:${hash([row.id,batch.map(event=>event.id),...batch.some(event=>event.reviewedPacketIds?.length)?[batch.map(event=>event.reviewedPacketIds??[])]:[]])}`
    const body={conversationId:row.id,generation:row.generation,events:batch.map(event=>{
      // The lookup receipt can make a source read-only after admission. Business
      // tools enforce that flag from the live ledger; it is not input identity.
      const original=operatorInput(event)
      const {progressOnly,...input}=original
      return {...legacyProgressIdentity?original:input,...event.source?{source:withoutTiming(event.source)}:{}}
    })}
    const packet={id,source:{kind:'conversation-router',conversationId:row.id,generation:row.generation,eventIds:batch.map(event=>event.id),...(batch.every(event=>event.kind==='operator.message')?{webOnly:true}:{}),...(batch[0]?.kind==='router.follow-up'?{followUpOnly:true}:{}),...traceSourcesMetadata(batch.filter(event=>event.kind==='source.message'&&event.source).map(event=>event.source)),...traceTaskEventsMetadata(batch)},content:[{type:'text',text:'Router 请求：'+JSON.stringify({...body,events:body.events.map(event=>event.source===undefined?event:{...event,source:conversationSource(event.source)})})}]}
    // Bind the compact view to every immutable ledger field, including fields
    // omitted from model text. Delivery progress alone may change during recovery.
    const identityBody={...body,events:body.events.map(event=>({...event,...event.triageReply?{triageReply:triageReplyIdentity(event.triageReply)}:{}}))}
    const compact={...packet,source:{...packet.source,modelViewVersion:1,ledgerIdentity:hash(identityBody)},content:[{type:'text',text:'Router 请求：'+JSON.stringify(routerModelBody(row,batch))}]}
    const current=batch.some(event=>event.taskEvent?.kind==='task.completed')?{...compact,source:{...compact.source,modelViewVersion:2},content:[{type:'text',text:'Router 请求：'+JSON.stringify(routerModelBody(row,batch,{compactCompletion:true}))}]}:undefined
    return [...current?[current]:[],compact,packet,{...packet,content:[{type:'text',text:'Router 请求：'+JSON.stringify(body)}]}]
  }

export function routerPacketViews(row,batch){
  const current=buildRouterPacketViews(row,batch)
  // Only the first view is written for new input. The additional views exactly
  // reconstruct pre-upgrade packets using the current ledger, not the saved hash.
  return batch.some(event=>event.progressOnly===true)
    ? [...current,...buildRouterPacketViews(row,batch,true)]
    : current
}

/** 串行调度只负责 Host 生命周期；推理、队列和历史始终由官方 Pi 执行。 */
export function openRouterLifecycle({ctx,store,root,models,setupBusiness,settle,agentPreset='night-bot',recordStage}){
  const handles=new Map(),tails=new Map(),inflight=new Set(),packets=new Map(),errors=new Map(),interruptions=new Map(),cancellationReasons=new Set(),coldSessions=new Set()
  const closeError=Object.assign(new Error('ROUTER_CLOSED'),{code:'ROUTER_CLOSED'})
  let closed=false,closing
  const assertOpen=()=>{if(closed)throw closeError}
  const interrupt=handle=>{
    if(!interruptions.has(handle)){
      const signal=handle.agent.lifecycle.signal,wasAborted=signal.aborted
      const nativeSignal=handle.session.agent.signal,nativeWasAborted=nativeSignal?.aborted
      const operation=handle.interrupt()
      if(!wasAborted&&signal.aborted)cancellationReasons.add(signal.reason)
      if(nativeWasAborted===false&&nativeSignal.aborted)cancellationReasons.add(nativeSignal.reason)
      interruptions.set(handle,operation)
      void operation.catch(()=>{})
    }
    return interruptions.get(handle)
  }
  const timing=(row,requestId,attempt=0)=>sourceStageTiming({recordStage,stage:'router',sessionId:row.activeSessionId,requestId,groupId:row.id,attempt,onError:error=>ctx.logger?.warn?.(`message timing: ${error.code??error.message}`)})
  const query=(kind,args={})=>store.query({kind,...args})
  const command=(kind,args,id)=>store.command({kind,args,id:id??`${kind}:${hash(args)}`})
  const agents=ctx.get('agents'),persistence=ctx.get('sessionPersistence')
  const sessionId=(id,generation)=>`router-${hash(id)}-g${generation}`
  async function verifyCommit(id,proof,handoffId,identity){
    if(!proof||proof.sessionId!==id)fail('ROUTER_NATIVE_COMMIT_INVALID')
    const native=await persistence.readNative(id,{requireComplete:true})
    const commit=native.entries.find(entry=>entry.id===proof.commitId&&entry.type==='custom'&&entry.customType==='night.commit')
    if(identity&&(native.header.conversationId!==identity.conversationId||native.header.generation!==identity.generation||native.header.runtimeOwner!=='conversation-router'))fail('ROUTER_NATIVE_IDENTITY_INVALID')
    if(!commit||native.header.id!==id)fail('ROUTER_NATIVE_COMMIT_INVALID')
    if(handoffId&&!native.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff'&&entry.details?.handoffId===handoffId))fail('ROUTER_NATIVE_HANDOFF_MISSING')
    return native
  }
  async function independentFileEffect(conversationId,rotation,name,args,signal){
    if(rotation.state!=='published'||rotation.conversationId!==conversationId||agents.get(rotation.oldSessionId))return false
    let native
    try{native=await persistence.readNative(rotation.oldSessionId,{requireComplete:true,signal})}
    catch(error){signal?.throwIfAborted();ctx.logger?.warn?.(`router file recovery evidence unavailable: ${error.code??error.name}`);return false}
    assertOpen();signal?.throwIfAborted()
    if(agents.get(rotation.oldSessionId)||native.header.id!==rotation.oldSessionId||native.header.runtimeOwner!=='conversation-router'
      ||native.header.conversationId!==conversationId||native.header.generation!==rotation.oldGeneration)return false
    return independentRouterFileEffect(native,{name,args})
  }
  const reviewKind='conversation-router-held-review',reviewTool='resident_review_held_source'
  async function heldSourceNoEffect(event){
    const rotation=(await query('router.rotations',{conversationId:event.conversationId})).find(item=>item.id===event.deliveryHold.handoffId)
    if(rotation?.state!=='published'||rotation.recovery?.reason!=='ROUTER_BATCH_NO_PROGRESS'||agents.get(rotation.oldSessionId))return false
    let native
    try{native=await persistence.readNative(rotation.oldSessionId,{requireComplete:true})}
    catch(error){ctx.logger?.warn?.(`router held evidence unavailable: ${error.code??error.name}`);return false}
    assertOpen()
    if(native.header.id!==rotation.oldSessionId||native.header.runtimeOwner!=='conversation-router'||native.header.conversationId!==event.conversationId||native.header.generation!==rotation.oldGeneration)return false
    const inputs=native.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'
      &&entry.details?.source?.kind==='conversation-router'&&entry.details.source.eventIds?.includes(event.id))
    if(inputs.length!==1)return false
    const input=inputs[0],receipt=native.audit.find(item=>item.domain==='admission'&&item.kind==='admitted'&&item.payload?.id===input.details.packetId)
    if(receipt?.payload.entryId!==input.id)return false
    // 未找到回执不能证明无动作，必须核验旧进程退出后严格提交的只读轮。
    const readonly=new Set(['resident_task_query','resident_source_query','resident_source_get','resident_reply_query','platform_task_query','platform_config_query','platform_schedule_list'])
    return native.entries.slice(native.entries.indexOf(input)+1).every(entry=>{
      if(entry.type==='message'&&entry.message.role==='assistant')return entry.message.content.every(block=>block.type!=='toolCall'||readonly.has(block.name))
      if(entry.type==='message'&&entry.message.role==='toolResult')return readonly.has(entry.message.toolName)
      return entry.type!=='custom'||entry.customType!=='night.audit'||!['task','job'].includes(entry.data?.domain)
    })
  }
  function recordHeldReview(packet,decision,evidenceId,coverage){
    const {conversationId,generation,eventId,sourceId,messageVersion,handoffId,reviewCount,noEffect,evidenceHash}=packet.source
    return command('router.held-review.record',{conversationId,generation,eventId,sourceId,messageVersion,handoffId,reviewCount,decision,noEffect,...evidenceId===undefined?{}:{evidenceId},...coverage===undefined?{}:{coverage,evidenceHash}})
  }
  const nextHeldReview=(conversationId,reviewed)=>query('router.held-review.next',{conversationId,...reviewed?{includeReviewed:true,excludeEventIds:[...reviewed]}:{}})
  const heldReviewForEvent=(conversationId,eventId)=>query('router.held-review.next',{conversationId,eventId,includeReviewed:true})
  async function reviewHeldSource(row,handle,persisted,reviewed){
    const candidate=await (persisted?heldReviewForEvent(row.id,persisted.source.eventId):nextHeldReview(row.id,reviewed));assertOpen()
    if(!candidate){if(persisted)await handle.retireHeldReview(persisted.id);return !!persisted}
    const {row:event,source,evidence,mayRelease,reviewCount}=candidate
    const noEffect=!evidence.tasks.length&&!evidence.replies.length&&mayRelease&&await heldSourceNoEffect(event)
    const identity={kind:reviewKind,conversationId:row.id,generation:row.generation,eventId:event.id,sourceId:source.sourceId,messageVersion:source.version,handoffId:event.deliveryHold.handoffId,reviewCount,noEffect,evidenceHash:hash(evidence)}
    const body={eventId:event.id,source:routerModelEvent({...event,source}).source,evidence,noEffect}
    const packet={id:'router-held-review:'+hash([identity,body]),source:identity,content:[{type:'text',text:'Router 挂起来源复查：'+JSON.stringify(body)}]}
    if(persisted&&!isDeepStrictEqual(packet,persisted)){await handle.retireHeldReview(persisted.id);return true}
    if(handle.agent.admission.status(packet.id)!=='admitted'){
      const tools=handle.session.getActiveToolNames()
      packets.set(packet.id,packet)
      try{
        handle.session.setActiveToolsByName([reviewTool])
        await handle.enqueue(packet);assertOpen();await handle.deliver(packet.id);await handle.whenIdle();assertOpen()
      }finally{
        packets.delete(packet.id)
        try{await handle.whenIdle()}finally{handle.session.setActiveToolsByName(tools)}
      }
    }
    // 模型未给出有效判断时保留原挂起，不让该轮占住普通消息队列。
    const remaining=await heldReviewForEvent(row.id,event.id);assertOpen()
    if(remaining?.row.deliveryHold.handoffId===identity.handoffId&&remaining.reviewCount===reviewCount)await recordHeldReview(packet,'no-decision')
    reviewed?.add(event.id)
    return true
  }
  async function bindMemory(id,conversationId,previous){
    const memory=ctx.get('memory')
    if(!memory)return
    const channels=ctx.get('channels'),channel=channels?.groupContext(conversationId)
    if(channel?.type==='chat'){
      const actorId=channels.privateScopeActor(channel,conversationId)
      if(!actorId)fail('ROUTER_PRIVATE_IDENTITY_INVALID')
      await memory.bindSession(id,{actorId})
    }else if(channel?.type==='chat-room'){
      if(!channel.memoryGroupId)fail('ROUTER_ROOM_IDENTITY_INVALID')
      await memory.bindSession(id,{actorId:'channel-room-actor-'+hash([channel.channelId,channel.conversationId]),groupId:channel.memoryGroupId,groupWrite:false})
    }else{
      // 可选旧渠道只有群作用域；不从最近发送人推断个人记忆权限。
      await memory.bindSession(id,{actorId:'router-room-'+hash(conversationId),groupId:conversationId,groupWrite:false})
    }
  }
  async function open(row,{handoff,previous,existingOnly=false}={}){
    assertOpen()
    const id=handoff?sessionId(row.id,row.generation+1):row.activeSessionId
    if(handles.has(id))return handles.get(id)
    const existing=await persistence.stat(id);assertOpen()
    const expectedGeneration=handoff?row.generation+1:row.generation
    if((existingOnly&&!existing)||existing&&(existing.header.conversationId!==row.id||existing.header.generation!==expectedGeneration||existing.header.runtimeOwner!=='conversation-router'))fail('ROUTER_NATIVE_IDENTITY_INVALID')
    await bindMemory(id,row.id,previous);assertOpen()
    const workspace=await sessionWorkspace(root,'resident');assertOpen()
    const generation=handoff?row.generation+1:row.generation
    const authorizeInput=async(packet,actor)=>{
      assertOpen()
      const current=await query('router.get',{conversationId:row.id});assertOpen()
      if(actor.id!==id||current?.activeSessionId!==id||current.generation!==generation||current.phase!=='active'||!isDeepStrictEqual(packets.get(packet.id),packet))return false
      if(packet.source.kind!==reviewKind)return true
      const candidate=await heldReviewForEvent(row.id,packet.source.eventId);assertOpen()
      return candidate?.row.deliveryHold.handoffId===packet.source.handoffId&&candidate.source.sourceId===packet.source.sourceId&&candidate.source.version===packet.source.messageVersion&&candidate.reviewCount===packet.source.reviewCount
    }
    const options={agentOptions:typeof models==='function'?models():models,authorizeInput,
      beforeRequest:async actor=>{
        assertOpen()
        const current=await query('router.get',{conversationId:row.id});assertOpen()
        if(current?.activeSessionId!==id||current.generation!==generation||!['active','handoff'].includes(current.phase)||actor.id!==id)fail('ROUTER_GENERATION_STALE')
      },
      setup:async(agentCtx,agent)=>{
        await agentCtx.get('agentPresets').mount(agentCtx,agentPreset)
        await setupBusiness(agentCtx,{conversationId:row.id,generation,sessionId:id,
          independentFileEffect:(...args)=>independentFileEffect(row.id,...args),
          reviewHeld:async(packet,{eventId,decision,evidenceId,coverage})=>{
            assertOpen();ctx.get('channels').assertGroupTarget(row.id)
            if(packet.source.kind!==reviewKind||packet.source.eventId!==eventId||!isDeepStrictEqual(packet,packets.get(packet.id)))fail('ROUTER_HELD_REVIEW_SCOPE')
            return recordHeldReview(packet,decision,evidenceId,coverage)
          }})
      }}
    const handle=existing?await agents.resume({...options,resumeSessionId:id}):await agents.create({...options,sessionId:id,meta:{cwd:workspace,runtimeOwner:'conversation-router',agentPreset,conversationId:row.id,generation},...(handoff?{routerHandoff:{...handoff,conversationId:row.id}}:{})})
    handles.set(id,handle)
    if(existing)coldSessions.add(id)
    if(closed){await interrupt(handle);throw closeError}
    return handle
  }
  async function publishCandidate(row,rotation,old,releaseOld=true){
    assertOpen()
    const candidateId=sessionId(row.id,row.generation+1)
    const candidate=await open(row,{handoff:{handoffId:rotation.id,...rotation.handoff},previous:old});assertOpen()
    const proof=await candidate.routerCommitProof();assertOpen()
    await verifyCommit(candidateId,proof,rotation.id,{conversationId:row.id,generation:row.generation+1});assertOpen()
    if(rotation.state==='summarized'){
      const receipt=await command('router.candidate.commit',{conversationId:row.id,generation:row.generation,handoffId:rotation.id,sessionId:candidateId,commitProof:proof})
      assertOpen();rotation=receipt.result.rotation
    }else if(rotation.candidateSessionId!==candidateId)fail('ROUTER_CANDIDATE_SCOPE')
    await verifyCommit(candidateId,rotation.candidateCommit,rotation.id,{conversationId:row.id,generation:row.generation+1});assertOpen()
    await command('router.publish',{conversationId:row.id,generation:row.generation,handoffId:rotation.id})
    if(old&&releaseOld){await old.dispose();handles.delete(old.agent.id)}
    return candidate
  }
  async function recoverConversation(row,recoveryReason='interrupted-handoff'){
    assertOpen()
    if(row.phase==='active')return
    const rotation=(await query('router.rotations',{conversationId:row.id})).find(item=>item.id===row.rotationId);assertOpen()
    if(!rotation)fail('ROUTER_ROTATION_MISSING')
    if(['summarized','candidate-committed'].includes(rotation.state)){
      if(!rotation.recovery)await verifyCommit(row.activeSessionId,rotation.oldCommit,undefined,{conversationId:row.id,generation:row.generation});assertOpen()
      const old=handles.get(row.activeSessionId)
      await publishCandidate(row,rotation,old)
      return
    }
    if(rotation.state==='handoff'){
      // 模型轮中断不能猜摘要成功；严格重开原journal，只恢复输入权，不重放旧轮。
      let old=handles.get(row.activeSessionId)
      if(old){await old.dispose();handles.delete(row.activeSessionId)}
      await persistence.readNative(row.activeSessionId,{requireComplete:true})
      old=await open(row)
      await old.routerRecoveryProof(rotation.id);assertOpen()
      await command('router.handoff.abort',{conversationId:row.id,generation:row.generation,handoffId:rotation.id,safeToResume:true,error:recoveryReason})
    }else fail('ROUTER_RECOVERY_BLOCKED')
  }

  async function replaceOwner(row,reason,handle,unknownEventIds,unknownTaskIds,unknownSourceIds,freshEventId,knownEventIds){
    if(handle){await handle.dispose();handles.delete(row.activeSessionId)}
    if(agents.get(row.activeSessionId))fail('ROUTER_RESUME_BUSY')
    await command('router.handoff.recover',{conversationId:row.id,generation:row.generation,sessionId:row.activeSessionId,handoffId:'router-recovery:'+hash([row.id,row.generation]),reason,...freshEventId?{freshEventId}:{},...knownEventIds?{knownEventIds}:{},...unknownEventIds===undefined?{}:{unknownEventIds,...unknownTaskIds===undefined?{}:{unknownTaskIds},...unknownSourceIds===undefined?{}:{unknownSourceIds}}})
    row=await query('router.get',{conversationId:row.id});await recoverConversation(row)
    return query('router.get',{conversationId:row.id})
  }
  async function drain(conversationId,reviewDeferred){
    const reviewed=reviewDeferred?new Set():undefined
    assertOpen();ctx.get('channels').assertGroupTarget(conversationId)
    let row=await query('router.get',{conversationId})
    const events=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
    if(!row){if(!events.length)return;row=(await command('router.ensure',{conversationId,sessionId:sessionId(conversationId,1)})).result.conversation}
    assertOpen()
    if(row.phase!=='active'){await recoverConversation(row);row=await query('router.get',{conversationId});assertOpen()}
    // 恢复和旧 owner 释放共享本会话队列，不把仍在途的交接当作冷中断。
    const rotations=await query('router.rotations',{conversationId});assertOpen()
    for(const rotation of rotations)if(rotation.state==='published'&&rotation.candidateSessionId===row.activeSessionId){const old=handles.get(rotation.oldSessionId);if(old){await old.dispose();handles.delete(rotation.oldSessionId)}}
    let handle,reviewTurn=false
    for(;;){
      const inbox=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
      if(!inbox.length&&!await nextHeldReview(conversationId,reviewed))break
      const startedAt=new Date().toISOString()
      if(!handle)try{handle=await open(row)}catch(error){
        // No active old owner may be abandoned. Failed opens clean up their own
        // resources; a live/still-draining owner keeps its existing fence.
        if(agents.get(row.activeSessionId))throw error
        row=await replaceOwner(row,error.code??'ROUTER_SESSION_OPEN_FAILED')
        handle=await open(row)
      }
      assertOpen()
      const queued=pendingBusinessInputs(handle.agent)[0]
      if(queued?.source.kind===reviewKind||!queued&&(!inbox.length||reviewTurn)){
        reviewTurn=false
        if(await reviewHeldSource(row,handle,queued,reviewed)){row=await query('router.get',{conversationId});continue}
      }
      if(!inbox.length)break
      const admittedInput=handle.session.sessionManager.getBranch().findLast(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input')
      const admittedPacket=admittedInput&&handle.agent.admission.lookupPacket(admittedInput.details?.packetId)
      if(admittedPacket?.source.kind==='conversation-router'){
        let recovered
        try{recovered=await handle.recoverRouterSettlement({packet:admittedPacket},async(args,call)=>{
          const validate=async()=>{
            assertOpen();ctx.get('channels').assertGroupTarget(conversationId)
            const current=await query('router.get',{conversationId});assertOpen()
            if(current?.phase!=='active'||current.generation!==row.generation||current.activeSessionId!==row.activeSessionId||agents.get(row.activeSessionId)!==handle.agent)fail('ROUTER_GENERATION_STALE')
          }
          await validate()
          const operationId=residentOperationId(conversationId,args.operationId)
          const prior=await query('router.action',{conversationId,operationId});assertOpen()
          if(!prior){
            const pending=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
            const batch=pending.filter(event=>args.eventIds.includes(event.id))
            if(!isDeepStrictEqual(batch.map(event=>event.id),args.eventIds)||!routerPacketViews(row,batch).some(view=>sameRouterPacket(admittedPacket,view)))fail('ROUTER_PACKET_ID_CONFLICT')
            for(const event of batch)if(event.sourceId){
              const source=await query('router.source-current',{conversationId,sourceId:event.sourceId});assertOpen()
              if(source.sourceId!==event.sourceId||source.version!==event.messageVersion)fail('ROUTER_PACKET_ID_CONFLICT')
            }
          }
          await validate()
          const scoped=admittedPacket.source.followUpOnly?followUpSettlementArgs(admittedPacket.source,args):args
          if(!scoped)fail('ROUTER_PACKET_ID_CONFLICT')
          const receipt=await settle({conversationId,generation:row.generation,...scoped,...admittedPacket.source.webOnly?{webOnly:true}:{},operationId},'router-settle-recovery:'+hash([row.activeSessionId,call.callEntryId,call.callId]))
          await validate();return receipt
        })}catch(error){
          try{await handle.dispose()}catch(cleanup){throw new AggregateError([error,cleanup],'Router settlement recovery cleanup failed')}
          handles.delete(row.activeSessionId);handle=undefined
          if(error.code==='PI_ROUTER_RESUME_EFFECT_UNRESOLVED'){handle=await open(row)}
          else if(/^(?:PI_ROUTER_RESUME_|ROUTER_PACKET_ID_CONFLICT)/.test(error.code??''))fail('ROUTER_BATCH_UNSETTLED')
          else throw error
        }
        if(recovered){
          await handle.dispose();handles.delete(row.activeSessionId);handle=undefined
          row=await query('router.get',{conversationId});assertOpen();continue
        }
      }
      // 冷中断或已登记的超时从原生检查点续办；其它 error/stop 仍需显式续办。
      if(admittedPacket?.source.kind==='conversation-router'&&handle.agent.admission.status(admittedPacket.id)==='admitted'&&admittedPacket.source.eventIds.some(id=>inbox.some(event=>event.id===id))){
        const branch=handle.session.sessionManager.getBranch()
        const failed=routerCheckpointTail(branch)
        const cold=coldSessions.delete(row.activeSessionId)
        const unexpectedStop=cold&&(failed?.id===admittedInput.id||failed?.message?.role==='toolResult'||failed?.message?.stopReason==='toolUse')
        // Partial settlement changes the pending prefix, not the immutable admitted
        // packet. Retire only a proven effect-complete checkpoint; never re-admit
        // the consumed prefix or weaken the ordinary continuation's identity guard.
        if(admittedPacket.source.eventIds.some(id=>!inbox.some(event=>event.id===id))){
          try{
            const isolation=await checkPartialSettlement(row,handle,admittedPacket,failed?.id)
            if(isolation?.unpairedReplies){
              row=await replaceOwner(row,'ROUTER_CONTINUATION_REPLY_UNRESOLVED',handle,isolation.heldEventIds,isolation.unknownTaskIds,undefined,isolation.freshEventId,admittedPacket.source.eventIds)
            }else row=await replaceOwner(row,isolation?'ROUTER_BATCH_ISOLATED':'ROUTER_BATCH_PARTIALLY_SETTLED',handle,isolation?admittedPacket.source.eventIds:[],isolation?.unknownTaskIds,isolation?.unknownSourceIds)
            handle=undefined;continue
          }catch(error){
            if(/^(?:PI_ROUTER_RESUME_|ROUTER_RESUME_|ROUTER_PACKET_ID_CONFLICT|ROUTER_EVENT_SCOPE)/.test(error.code??''))fail('ROUTER_BATCH_UNSETTLED',error.code)
            throw error
          }
        }
        // 补充输入夹在原续办的 claim 和 turn 之间，不是新的续办起点。
        const inputIndex=branch.indexOf(admittedInput)
        const resumeTurn=branch.slice(inputIndex+1).find(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-turn')
        const resumeProof=resumeTurn?.details
        let consumedWithSupplements=false
        if(resumeProof?.sessionId===row.activeSessionId&&resumeProof.conversationId===row.id&&resumeProof.generation===row.generation){
          const claimIndex=branch.findLastIndex((entry,index)=>index<inputIndex&&entry.type==='custom_message'&&entry.customType==='night.router-resume-claim'&&isDeepStrictEqual(entry.details,resumeProof))
          consumedWithSupplements=claimIndex>0&&branch.some((entry,index)=>index<claimIndex&&entry.id===resumeProof.inputEntryId&&entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.packetId===resumeProof.packetId)
        }
        // A consumed continuation is not another automatic retry, even after reboot.
        if(consumedWithSupplements||branch.some(entry=>entry.customType==='night.router-resume-claim'&&entry.details?.packetId===admittedPacket.id)){
          const known=new Set(branch.filter(entry=>entry.customType==='night.business-input').flatMap(entry=>entry.details?.source?.eventIds??[]))
          if(!inbox.some(event=>!known.has(event.id)))fail('ROUTER_BATCH_UNSETTLED')
          const checkpointIds=admittedPacket.source.eventIds
          const suffix=branch.slice(inputIndex+1).filter(entry=>entry.type==='message')
          const replies=unresolvedRouterCalls(suffix.map(entry=>entry.message))
          if(replies.length&&replies.every(call=>call.name==='resident_router_reply')){
            // A consumed inspection is not evidence that an unmatched reply took
            // effect. Preserve only its exact source on hold, never the new source
            // or unrelated rows from the earlier batch.
            const batch=await query('router.batch-events',{conversationId,eventIds:checkpointIds});assertOpen()
            if(batch.some(event=>event.state!=='pending'||event.deliveryHold)||!routerPacketViews(row,batch).some(view=>sameRouterPacket(admittedPacket,view)))fail('ROUTER_BATCH_UNSETTLED','ROUTER_RESUME_BATCH_STALE')
            const matches=(call,event)=>event.kind==='source.message'&&call.arguments?.sourceId===event.sourceId&&call.arguments?.messageVersion===event.messageVersion
            const held=batch.filter(event=>replies.some(call=>matches(call,event)))
            if(held.length&&replies.every(call=>held.some(event=>matches(call,event)))){
              const knownPending=inbox.filter(event=>known.has(event.id)).map(event=>event.id)
              const freshEventId=await query('router.independent-source',{conversationId,eventIds:knownPending});assertOpen()
              if(!freshEventId)fail('ROUTER_BATCH_UNSETTLED')
              const native=await persistence.readNative(row.activeSessionId,{requireComplete:true});assertOpen()
              const durable=new Map(native.entries.map(entry=>[entry.id,entry]))
              if(!isDeepStrictEqual(durable.get(admittedInput.id),admittedInput)||suffix.some(entry=>!isDeepStrictEqual(durable.get(entry.id),entry)))fail('ROUTER_BATCH_UNSETTLED','ROUTER_NATIVE_COMMIT_INVALID')
              row=await replaceOwner(row,'ROUTER_CONTINUATION_REPLY_UNRESOLVED',handle,held.map(event=>event.id),[...new Set(replies.map(call=>call.arguments?.taskDelivery?.taskId).filter(id=>typeof id==='string'))],undefined,freshEventId,knownPending);handle=undefined;continue
            }
          }
          row=await replaceOwner(row,'ROUTER_CONTINUATION_FAILED',handle,checkpointIds);handle=undefined;continue
        }
        const timedOut=routerTimedOut(failed)&&!admittedPacket.source.webOnly
        const deferred=row.timeoutContinuation
        if(timedOut&&!deferred){
          const {id:packetId,source:{eventIds}}=admittedPacket
          await command('router.timeout.defer',{conversationId,generation:row.generation,sessionId:row.activeSessionId,packetId,failedEntryId:failed.id,eventIds})
          fail('ROUTER_BATCH_UNSETTLED')
        }
        const deferredTimeout=timedOut&&deferred?.packetId===admittedPacket.id&&deferred.failedEntryId===failed.id
        const inspection=inbox.some(event=>event.kind==='task.inspection')
        const mayResume=deferredTimeout||unexpectedStop||failed?.message?.role==='assistant'&&(failed.message.stopReason==='aborted'||inspection&&['error','stop'].includes(failed.message.stopReason))
        let resumeFailure
        if(mayResume){
          try{await continueBatch(row,handle,admittedPacket,failed.id,()=>{},undefined,unexpectedStop);row=await query('router.get',{conversationId});continue}
          catch(error){
            if(!/^(?:PI_ROUTER_RESUME_|ROUTER_RESUME_|ROUTER_PACKET_ID_CONFLICT)/.test(error.code??''))throw error
            resumeFailure=error
          }
        }
        const ids=admittedPacket.source.eventIds
        const freshEventId=await query('router.independent-source',{conversationId,eventIds:ids})
        if(freshEventId){
          try{
            const proof=await checkStalledBatch(row,handle,admittedPacket,failed?.id)
            row=await replaceOwner(row,'ROUTER_BATCH_NO_PROGRESS',handle,ids,proof.unknownTaskIds,proof.unknownSourceIds,freshEventId);handle=undefined;continue
          }catch(error){
            if(/^(?:PI_ROUTER_RESUME_|ROUTER_RESUME_|ROUTER_PACKET_ID_CONFLICT|ROUTER_EVENT_SCOPE)/.test(error.code??''))fail('ROUTER_BATCH_UNSETTLED',error.code)
            throw error
          }
        }
        fail('ROUTER_BATCH_UNSETTLED',unexpectedStop?resumeFailure?.code:errors.get(conversationId)?.recoveryReason)
      }
      // Once a cold owner starts fresh work it is no longer a cold checkpoint.
      coldSessions.delete(row.activeSessionId)
      const persistedPacket=pendingBusinessInputs(handle.agent)[0]
      let batch=[]
      if(persistedPacket){
        // 冷恢复先续原批次；迟到事件留下一批，持久正文只接受旧原样或确定性中性投影。
        const ids=persistedPacket.source.eventIds
        if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('ROUTER_PACKET_ID_CONFLICT')
        batch=inbox.slice(0,ids.length)
        if(!isDeepStrictEqual(ids,batch.map(event=>event.id)))fail('ROUTER_PACKET_ID_CONFLICT')
      }else{
        // 每批用户来源不超过15；内部事件另受总量和编码预算约束。
        batch=routerModelBatch(row,inbox)
      }
      const views=routerPacketViews(row,batch),currentPacket=views[0],id=currentPacket.id
      if(persistedPacket&&!views.some(view=>sameRouterPacket(persistedPacket,view)))fail('ROUTER_PACKET_ID_CONFLICT')
      const packet=persistedPacket??currentPacket
      packets.set(id,packet)
      const observed=timing(row,id)
      const stopObserving=observed.observe(handle.session)
      observed.start(batch.filter(event=>event.sourceId).map(event=>({sourceId:event.sourceId,messageId:event.source?.messageId,version:event.messageVersion})),startedAt)
      try{await handle.enqueue(packet);assertOpen();await handle.deliver(id);await handle.whenIdle();assertOpen()}finally{
        packets.delete(id)
        // A failed delivery may still be draining SDK retries or cancellation.
        // Keep an open span if the official join itself cannot be established.
        try{await handle.whenIdle();await observed.finish()}catch{await observed.finishIfSettled()}finally{stopObserving()}
      }
      const pending=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
      if(batch.some(event=>pending.some(item=>item.id===event.id))){
        if(!packet.source.webOnly&&routerTimedOut(routerCheckpointTail(handle.session.sessionManager.getBranch())))continue
        fail('ROUTER_BATCH_UNSETTLED')
      }
      row=await query('router.get',{conversationId})
      reviewTurn=true
    }
    // Keep the same Pi owner even when the inbox and tasks are idle. Pi's
    // native compaction handles bounded context; idle is not a semantic cutoff.
    // recoverConversation above still completes a pre-upgrade committed handoff.

  }
  function schedule(conversationId,reviewDeferred=false){
    if(closed)return Promise.reject(closeError)
    try{ctx.get('channels').assertGroupTarget(conversationId)}catch(error){return Promise.reject(error)}
    const previous=tails.get(conversationId)??Promise.resolve()
    const work=previous.catch(()=>{}).then(()=>drain(conversationId,reviewDeferred))
    return trackTail(conversationId,work)
  }
  function trackTail(conversationId,work){
    tails.set(conversationId,work);inflight.add(work)
    void work.then(()=>errors.delete(conversationId),error=>errors.set(conversationId,error)).finally(()=>{inflight.delete(work);if(tails.get(conversationId)===work)tails.delete(conversationId)}).catch(()=>{})
    return work
  }
  async function checkStalledBatch(row,handle,packet,failedEntryId){
    const conversationId=row.id,eventIds=packet.source.eventIds
    const events=await query('router.batch-events',{conversationId,eventIds});assertOpen()
    if(events.some(event=>event.state!=='pending'||event.deliveryHold)||!routerPacketViews(row,events).some(value=>sameRouterPacket(value,packet)))fail('ROUTER_RESUME_BATCH_STALE')
    const proof=await handle.checkRouterBatch({packet,failedEntryId,isolationOnly:true})
    const current=await query('router.get',{conversationId});assertOpen()
    if(!current||current.phase!=='active'||current.generation!==row.generation||current.activeSessionId!==row.activeSessionId||current.cursor!==row.cursor||agents.get(row.activeSessionId)!==handle.agent||handle.agent.lifecycle.signal.aborted)fail('ROUTER_RESUME_STALE')
    if(!isDeepStrictEqual(events,await query('router.batch-events',{conversationId,eventIds})))fail('ROUTER_RESUME_BATCH_STALE')
    assertOpen();return proof
  }
  async function checkPartialSettlement(row,handle,packet,failedEntryId){
    const ids=packet.source.eventIds,conversationId=row.id
    const events=await query('router.batch-events',{conversationId,eventIds:ids});assertOpen()
    const consumed=events.filter(event=>event.state==='consumed'),remaining=events.filter(event=>event.state==='pending')
    if(!consumed.length||!remaining.length||consumed.length+remaining.length!==ids.length)fail('ROUTER_RESUME_BATCH_STALE')
    for(const event of consumed){
      const receipt=typeof event.operationId==='string'&&await query('router.action',{conversationId,operationId:event.operationId})
      const settled=receipt?.result?.conversation
      if(event.processedGeneration!==row.generation||!Number.isSafeInteger(event.processedCursor)||event.processedCursor<=0||event.processedCursor>row.cursor||settled?.id!==conversationId||settled.generation!==row.generation||settled.activeSessionId!==row.activeSessionId||!Number.isSafeInteger(settled.cursor)||settled.cursor<event.processedCursor)fail('ROUTER_RESUME_BATCH_STALE')
    }
    const original=events.map(event=>{
      if(event.state!=='consumed')return event
      const {operationId,processedGeneration,processedCursor,noTaskDisposition,inspectionDisposition,outcomeDisposition,...input}=event
      return {...input,state:'pending'}
    })
    if(!routerPacketViews(row,original).some(value=>sameRouterPacket(value,packet)))fail('ROUTER_PACKET_ID_CONFLICT')
    // Strict native validation retains unknown/missing/error tool-result fences.
    // This is not the relaxed wake-only inference path.
    let isolation
    try{await handle.checkRouterBatch({packet,failedEntryId})}
    catch(error){
      if(!['PI_ROUTER_RESUME_EFFECT_UNRESOLVED','PI_ROUTER_RESUME_CHECKPOINT_INVALID'].includes(error.code))throw error
      const freshEventId=await query('router.independent-source',{conversationId,eventIds:ids});assertOpen()
      if(!freshEventId)throw error
      // Certify partial settlement and the unmatched reply separately. This
      // never makes the original checkpoint eligible to resume or replay.
      const unpaired=await Promise.resolve().then(()=>handle.checkRouterBatch({packet,failedEntryId,isolationOnly:true,isolateUnpairedReplies:true})).catch(cause=>{
        if(cause.code==='PI_ROUTER_RESUME_EFFECT_UNRESOLVED')return
        throw cause
      })
      if(unpaired){
        const matches=(call,event)=>event.kind==='source.message'&&call.sourceId===event.sourceId&&call.messageVersion===event.messageVersion
        const heldEventIds=remaining.filter(event=>unpaired.unpairedReplies.some(call=>matches(call,event))).map(event=>event.id)
        if(!unpaired.unpairedReplies.every(call=>remaining.some(event=>matches(call,event))))throw error
        isolation={...unpaired,heldEventIds,freshEventId,unknownTaskIds:[...new Set(unpaired.unpairedReplies.map(call=>call.taskId).filter(id=>typeof id==='string'))]}
      }else{
        if(error.code!=='PI_ROUTER_RESUME_EFFECT_UNRESOLVED')throw error
        // Exact paired old failures remain unknown and fenced.
        isolation=await handle.checkRouterBatch({packet,failedEntryId,isolationOnly:true})
      }
    }
    const current=await query('router.get',{conversationId}),pending=await query('router.inbox',{conversationId,limit:30,deliverable:true})
    if(!current||current.phase!=='active'||current.generation!==row.generation||current.activeSessionId!==row.activeSessionId||current.cursor!==row.cursor||agents.get(row.activeSessionId)!==handle.agent||handle.agent.lifecycle.signal.aborted)fail('ROUTER_RESUME_STALE')
    if(!isDeepStrictEqual(remaining.map(event=>event.id),pending.slice(0,remaining.length).map(event=>event.id))||!isDeepStrictEqual(events,await query('router.batch-events',{conversationId,eventIds:ids})))fail('ROUTER_RESUME_BATCH_STALE')
    assertOpen();return isolation
  }
  async function prepareResume(row,handle,packet){
    const conversationId=row.id,ids=packet.source.eventIds
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('ROUTER_PACKET_ID_CONFLICT')
    const pendingInbox=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
    const inbox=pendingInbox.filter(event=>(event.kind==='operator.message')===(packet.source.webOnly===true))
    const pendingCount=await query('router.inbox-count',{conversationId,deliverable:true});assertOpen()
    // 不漏掉分页外的后续取消；联合续轮仍受原批次消息数与编码预算约束。
    if(pendingCount!==pendingInbox.length||inbox.filter(event=>['source.message','operator.message'].includes(event.kind)).length>15||!isDeepStrictEqual(ids,inbox.slice(0,ids.length).map(event=>event.id))||routerModelBatch(row,inbox).length!==inbox.length)fail('ROUTER_RESUME_BATCH_STALE')
    if(!routerPacketViews(row,inbox.slice(0,ids.length)).some(value=>sameRouterPacket(value,packet)))fail('ROUTER_PACKET_ID_CONFLICT')
    const supplements=inbox.length>ids.length?[routerPacketViews(row,inbox.slice(ids.length))[0]]:[]
    const snapshot=routerPacketViews(row,pendingInbox)[0],allIds=inbox.map(event=>event.id)
    const validate=async()=>{
      assertOpen()
      const current=await query('router.get',{conversationId});assertOpen()
      if(!current||current.phase!=='active'||current.generation!==row.generation||current.activeSessionId!==row.activeSessionId||agents.get(row.activeSessionId)!==handle.agent||handle.agent.lifecycle.signal.aborted)fail('ROUTER_RESUME_STALE')
      const pending=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
      if(await query('router.inbox-count',{conversationId,deliverable:true})!==pendingInbox.length||!sameRouterPacket(routerPacketViews(current,pending)[0],snapshot))fail('ROUTER_RESUME_BATCH_STALE')
    }
    await validate();assertOpen()
    return {inbox,supplements,allIds,validate,inboxDigest:hash(comparableRouterPacket(snapshot))}
  }
  async function inspectBatch(row,handle){
    const branch=handle.session.sessionManager.getBranch()
    const input=branch.findLast(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input')
    const failed=branch.findLast(entry=>entry.type==='message')
    const packet=handle.agent.admission.lookupPacket(input?.details?.packetId)
    if(!packet||packet.source.kind!=='conversation-router')fail('ROUTER_PACKET_ID_CONFLICT')
    const prepared=await prepareResume(row,handle,packet)
    const checkpoint=await handle.checkRouterBatch({packet,failedEntryId:failed?.id,supplements:prepared.supplements})
    await prepared.validate()
    const {inputEntryId,...proof}=checkpoint
    return {proposal:{...proof,inboxDigest:prepared.inboxDigest},eventIds:prepared.allIds,pendingCount:prepared.inbox.length}
  }
  async function inspectRouterBatch({conversationId}={}){
    assertOpen();ctx.get('channels').assertGroupTarget(conversationId)
    if(agents.currentInitiator?.()!==undefined)fail('ROUTER_RESUME_HOST_ONLY')
    if(tails.has(conversationId))fail('ROUTER_RESUME_BUSY')
    const row=await query('router.get',{conversationId});assertOpen()
    const handle=row&&handles.get(row.activeSessionId)
    // 只读检查不能为冷 session 创建 owner、提交历史或清除恢复错误。
    if(!row||row.phase!=='active'||!handle)fail('ROUTER_RESUME_OWNER_UNAVAILABLE')
    return inspectBatch(row,handle)
  }
  async function checkRouterBatch(proposal){
    const result=await inspectRouterBatch(proposal)
    if(!isDeepStrictEqual(result.proposal,proposal))fail('ROUTER_RESUME_STALE')
    return {...result,checkOnly:true}
  }
  async function continueBatch(row,handle,packet,failedEntryId,onAttempt=()=>{},expected,wakeOnly=false){
    const conversationId=row.id,packetId=packet.id,startedAt=new Date().toISOString()
    const {inbox,supplements,allIds,validate,inboxDigest}=await prepareResume(row,handle,packet)
    if(expected){
      const checkpoint=await handle.checkRouterBatch({packet,failedEntryId,supplements})
      if(checkpoint.checkpointRevision!==expected.checkpointRevision||inboxDigest!==expected.inboxDigest)fail('ROUTER_RESUME_STALE')
      await validate()
    }
    for(const input of [packet,...supplements])packets.set(input.id,input)
    const observed=timing(row,`${packetId}:resume:${failedEntryId}`,1),stopObserving=observed.observe(handle.session)
    observed.start(inbox.filter(event=>event.sourceId).map(event=>({sourceId:event.sourceId,messageId:event.source?.messageId,version:event.messageVersion})),startedAt)
    try{const resumed=handle.resumeRouterBatch({packet,failedEntryId,supplements,wakeOnly},validate);onAttempt();await resumed;await handle.whenIdle();assertOpen()}finally{
      for(const input of [packet,...supplements])packets.delete(input.id)
      try{await handle.whenIdle();await observed.finish()}catch{await observed.finishIfSettled()}finally{stopObserving()}
    }
    const pending=await query('router.inbox',{conversationId,limit:30,deliverable:true});assertOpen()
    if(pending.some(event=>allIds.includes(event.id)))fail('ROUTER_BATCH_UNSETTLED')
  }
  async function resumeRouterBatch({conversationId,generation,sessionId:activeSessionId,packetId,failedEntryId,checkpointRevision,inboxDigest}={}){
    assertOpen();ctx.get('channels').assertGroupTarget(conversationId)
    if(agents.currentInitiator?.()!==undefined)fail('ROUTER_RESUME_HOST_ONLY')
    if(![conversationId,activeSessionId,packetId,failedEntryId].every(value=>typeof value==='string'&&value.length)||!Number.isSafeInteger(generation)||generation<1)fail('ROUTER_RESUME_REQUEST_INVALID')
    if(tails.has(conversationId))fail('ROUTER_RESUME_BUSY')
    let attempted=false
    // 显式入口和普通恢复共用校验；同步占有原会话队列，拒绝并发重复模型轮。
    const work=Promise.resolve().then(async()=>{
      assertOpen()
      const row=await query('router.get',{conversationId});assertOpen()
      if(!row||row.phase!=='active'||row.generation!==generation||row.activeSessionId!==activeSessionId||activeSessionId!==sessionId(conversationId,generation))fail('ROUTER_RESUME_STALE')
      if(!await persistence.stat(activeSessionId))fail('ROUTER_NATIVE_IDENTITY_INVALID')
      const handle=await open(row),packet=handle.agent.admission.lookupPacket(packetId)
      if(packet?.id!==packetId)fail('ROUTER_PACKET_ID_CONFLICT')
      await continueBatch(row,handle,packet,failedEntryId,()=>{attempted=true},checkpointRevision!==undefined||inboxDigest!==undefined?{checkpointRevision,inboxDigest}:undefined)
      await drain(conversationId)
      return {conversationId,generation,sessionId:activeSessionId,packetId,resumed:true,settled:true}
    })
    tails.set(conversationId,work);inflight.add(work)
    void work.then(()=>errors.delete(conversationId),error=>{if(attempted)errors.set(conversationId,error)}).finally(()=>{inflight.delete(work);if(tails.get(conversationId)===work)tails.delete(conversationId)}).catch(()=>{})
    return work
  }
  async function restoreIdle(rows,failures){
    for(const expected of rows){
      if(closed)return
      const id=expected.id
      if(handles.has(expected.activeSessionId))continue
      const previous=tails.get(id)??Promise.resolve()
      const work=previous.catch(()=>{}).then(async()=>{
        assertOpen()
        const row=await query('router.get',{conversationId:id});assertOpen()
        if(row?.phase!=='active'||row.generation!==expected.generation||row.activeSessionId!==expected.activeSessionId)return
        if(row.activeSessionId!==sessionId(id,row.generation))fail('ROUTER_NATIVE_IDENTITY_INVALID')
        ctx.get('channels').assertGroupTarget(id)
        await open(row,{existingOnly:true})
      })
      try{await trackTail(id,work)}catch(error){
        if(closed)return
        const code=error.code??'ROUTER_IDLE_RESTORE_FAILED'
        failures.push({conversationId:id,code});ctx.logger?.warn?.(`Idle Router restore: ${code}`)
      }
    }
  }
  return {schedule,inspectRouterBatch,checkRouterBatch,resumeRouterBatch,errors,hasInflight:conversationId=>tails.has(conversationId),
    async whenIdle(){for(;;){const work=[...tails.values()];await Promise.all(work);if(!tails.size)break}},
    async recover({wait=true,restoreIdleRouters=false}={}){
      const conversations=new Set((await query('router.list')).map(row=>row.id))
      for(const id of await query('router.pending-conversations'))conversations.add(id)
      const failures=[],fatal=[],work=[],idle=[]
      for(const id of conversations){
        if(tails.has(id))continue
        const row=await query('router.get',{conversationId:id}),inbox=await query('router.inbox',{conversationId:id,limit:30,deliverable:true})
        if(restoreIdleRouters&&row?.phase==='active'&&!inbox.length&&!await nextHeldReview(id,new Set())){idle.push(row);continue}
        const inspection=inbox.some(event=>event.kind==='task.inspection')
        const key=hash([row?.generation,inbox.map(event=>event.id)]),retry=row?.recoveryRetry
        if(row?.phase==='active'&&retry?.key===key&&Date.parse(retry.nextAttemptAt)>Date.now()){
          failures.push({conversationId:id,code:retry.exhausted?'ROUTER_RECOVERY_EXHAUSTED':'ROUTER_RECOVERY_BACKOFF'});continue
        }
        const recovering=schedule(id,restoreIdleRouters).catch(async error=>{
          failures.push({conversationId:id,code:error.recoveryReason??error.code??error.message})
          if(error.code!=='ROUTER_BATCH_UNSETTLED')fatal.push(error)
          // 技能仍在变化时，原批次也沿用现有恢复退避，不在每次巡检重读。
          if(row&&(inspection||error.code==='PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED'))await command('router.recovery-attempt',{conversationId:id,generation:row.generation,key},'router.recovery-attempt:'+hash([id,row.generation,key,retry??null]))
        })
        work.push(recovering)
      }
      if(idle.length){
        const restoring=restoreIdle(idle,failures)
        inflight.add(restoring)
        void restoring.finally(()=>inflight.delete(restoring)).catch(()=>{})
        work.push(restoring)
      }
      if(wait)await Promise.all(work)
      else void Promise.all(work).catch(error=>ctx.logger?.warn?.(error.code??'ROUTER_RECOVERY_FAILED'))

      if(fatal.length)throw fatal[0]
      return {failures}
    },
    close(){
      if(closing)return closing
      closed=true
      return closing=(async()=>{
        // 先使当前 Pi 推理可取消；在途 open 也须纳入同一次 join，不伪造旧代失效。
        // 最新 tail 可覆盖仍在途的前轮；两者的真实失败都必须参加关停。
        const joining=Promise.allSettled([...inflight])
        for(const handle of handles.values())interrupt(handle)
        const running=await joining
        const interrupted=await Promise.allSettled([...interruptions.values()])
        const stopped=await Promise.allSettled([...handles.values()].map(handle=>handle.dispose()))
        handles.clear()
        // 只识别原取消对象；既有维护失败和真实 join/commit 失败仍须上报。
        const failures=[...running.filter(item=>item.status==='rejected'&&item.reason!==closeError&&!cancellationReasons.has(item.reason)&&item.reason.routerSafeToResume!==true),...interrupted.filter(item=>item.status==='rejected'),...stopped.filter(item=>item.status==='rejected')].map(item=>item.reason)
        if(failures.length)throw new AggregateError([...new Set(failures)],'Router shutdown failed')
      })()
    },
  }
}
