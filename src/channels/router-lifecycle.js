import {traceSourcesMetadata,traceTaskEventsMetadata} from '../runtime/pi-agent-observation.js'
import {sourceStageTiming} from './source-stage-timing.js'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {sessionWorkspace} from '../../packages/dingtalk-core/session-workspaces.js'
import {conversationSource} from './message-safety.js'
import {pendingBusinessInputs} from '../runtime/pi-business-inputs.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
/** 串行调度只负责 Host 生命周期；推理、队列和历史始终由官方 Pi 执行。 */
export function openRouterLifecycle({ctx,store,root,models,setupBusiness,agentPreset='night-bot',recordStage}){
  const handles=new Map(),tails=new Map(),inflight=new Set(),packets=new Map(),errors=new Map(),interruptions=new Map(),cancellationReasons=new Set()
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
  async function bindMemory(id,conversationId,previous){
    const memory=ctx.get('memory')
    if(!memory)return
    const channel=ctx.get('channels')?.groupContext(conversationId)
    if(channel?.type==='chat'){
      const principals=Object.keys(channel.participants??{})
      if(principals.length!==1)fail('ROUTER_PRIVATE_IDENTITY_INVALID')
      await memory.bindSession(id,{actorId:principals[0]})
    }else if(channel?.type==='chat-room'){
      if(!channel.memoryGroupId)fail('ROUTER_ROOM_IDENTITY_INVALID')
      await memory.bindSession(id,{actorId:'channel-room-actor-'+hash([channel.channelId,channel.conversationId]),groupId:channel.memoryGroupId,groupWrite:false})
    }else{
      // 可选旧渠道只有群作用域；不从最近发送人推断个人记忆权限。
      await memory.bindSession(id,{actorId:'router-room-'+hash(conversationId),groupId:conversationId,groupWrite:false})
    }
  }
  async function open(row,{handoff,previous}={}){
    assertOpen()
    const id=handoff?sessionId(row.id,row.generation+1):row.activeSessionId
    if(handles.has(id))return handles.get(id)
    const existing=await persistence.stat(id);assertOpen()
    const expectedGeneration=handoff?row.generation+1:row.generation
    if(existing&&(existing.header.conversationId!==row.id||existing.header.generation!==expectedGeneration||existing.header.runtimeOwner!=='conversation-router'))fail('ROUTER_NATIVE_IDENTITY_INVALID')
    await bindMemory(id,row.id,previous);assertOpen()
    const workspace=await sessionWorkspace(root,'resident');assertOpen()
    const generation=handoff?row.generation+1:row.generation
    const authorizeInput=async(packet,actor)=>{
      assertOpen()
      const current=await query('router.get',{conversationId:row.id});assertOpen()
      return actor.id===id&&current?.activeSessionId===id&&current.generation===generation&&current.phase==='active'&&isDeepStrictEqual(packets.get(packet.id),packet)
    }
    const options={agentOptions:typeof models==='function'?models():models,authorizeInput,
      beforeRequest:async actor=>{
        assertOpen()
        const current=await query('router.get',{conversationId:row.id});assertOpen()
        if(current?.activeSessionId!==id||current.generation!==generation||!['active','handoff'].includes(current.phase)||actor.id!==id)fail('ROUTER_GENERATION_STALE')
      },
      setup:async(agentCtx,agent)=>{
        await agentCtx.get('agentPresets').mount(agentCtx,agentPreset)
        await setupBusiness(agentCtx,{conversationId:row.id,generation,sessionId:id})
      }}
    const handle=existing?await agents.resume({...options,resumeSessionId:id}):await agents.create({...options,sessionId:id,meta:{cwd:workspace,runtimeOwner:'conversation-router',agentPreset,conversationId:row.id,generation},...(handoff?{routerHandoff:{...handoff,conversationId:row.id}}:{})})
    handles.set(id,handle)
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
      await verifyCommit(row.activeSessionId,rotation.oldCommit,undefined,{conversationId:row.id,generation:row.generation});assertOpen()
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
  function packetViews(row,batch){
    const id=`router-input:${hash([row.id,batch.map(event=>event.id)])}`
    const body={conversationId:row.id,generation:row.generation,events:batch.map(event=>({...event,...event.source?{source:withoutTiming(event.source)}:{}}))}
    const packet={id,source:{kind:'conversation-router',conversationId:row.id,generation:row.generation,eventIds:batch.map(event=>event.id),...traceSourcesMetadata(batch.filter(event=>event.kind==='source.message'&&event.source).map(event=>event.source)),...traceTaskEventsMetadata(batch)},content:[{type:'text',text:'Router 请求：'+JSON.stringify({...body,events:body.events.map(event=>event.source===undefined?event:{...event,source:conversationSource(event.source)})})}]}
    return [packet,{...packet,content:[{type:'text',text:'Router 请求：'+JSON.stringify(body)}]}]
  }
  async function drain(conversationId){
    assertOpen();ctx.get('channels').assertGroupTarget(conversationId)
    let row=await query('router.get',{conversationId})
    const events=await query('router.inbox',{conversationId,limit:30});assertOpen()
    if(!row){if(!events.length)return;row=(await command('router.ensure',{conversationId,sessionId:sessionId(conversationId,1)})).result.conversation}
    assertOpen()
    if(row.phase!=='active'){await recoverConversation(row);row=await query('router.get',{conversationId});assertOpen()}
    // 恢复和旧 owner 释放共享本会话队列，不把仍在途的交接当作冷中断。
    const rotations=await query('router.rotations',{conversationId});assertOpen()
    for(const rotation of rotations)if(rotation.state==='published'&&rotation.candidateSessionId===row.activeSessionId){const old=handles.get(rotation.oldSessionId);if(old){await old.dispose();handles.delete(rotation.oldSessionId)}}
    let handle
    for(;;){
      const inbox=await query('router.inbox',{conversationId,limit:30});assertOpen()
      if(!inbox.length)break
      const startedAt=new Date().toISOString()
      handle??=await open(row);assertOpen()
      const admittedInput=handle.session.sessionManager.getBranch().findLast(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input')
      const admittedPacket=admittedInput&&handle.agent.admission.lookupPacket(admittedInput.details?.packetId)
      // 正常停机中止的生成沿原历史领取一次；原生 error 仍需显式 Host 续办。
      if(admittedPacket?.source.kind==='conversation-router'&&handle.agent.admission.status(admittedPacket.id)==='admitted'&&admittedPacket.source.eventIds.some(id=>inbox.some(event=>event.id===id))){
        const failed=handle.session.sessionManager.getBranch().findLast(entry=>entry.type==='message')
        if(failed?.message.role!=='assistant'||failed.message.stopReason!=='aborted')fail('ROUTER_BATCH_UNSETTLED')
        try{await continueBatch(row,handle,admittedPacket,failed.id)}catch(error){
          if(/^(?:PI_ROUTER_RESUME_|ROUTER_RESUME_|ROUTER_PACKET_ID_CONFLICT)/.test(error.code??''))fail('ROUTER_BATCH_UNSETTLED')
          throw error
        }
        row=await query('router.get',{conversationId});continue
      }
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
        let users=0,bytes=0
        for(const event of inbox){if(event.kind==='source.message'&&users>=15)break;const size=Buffer.byteLength(JSON.stringify({...event,...event.source?{source:withoutTiming(event.source)}:{}}));if(batch.length&&bytes+size>131072)break;batch.push(event);bytes+=size;if(event.kind==='source.message')users++}
      }
      const [currentPacket,legacyPacket]=packetViews(row,batch),id=currentPacket.id
      if(persistedPacket&&!sameRouterPacket(persistedPacket,currentPacket)&&!sameRouterPacket(persistedPacket,legacyPacket))fail('ROUTER_PACKET_ID_CONFLICT')
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
      const pending=await query('router.inbox',{conversationId,limit:30});assertOpen()
      if(batch.some(event=>pending.some(item=>item.id===event.id)))fail('ROUTER_BATCH_UNSETTLED')
      row=await query('router.get',{conversationId})
    }
    // Keep the same Pi owner even when the inbox and tasks are idle. Pi's
    // native compaction handles bounded context; idle is not a semantic cutoff.
    // recoverConversation above still completes a pre-upgrade committed handoff.

  }
  function schedule(conversationId){
    if(closed)return Promise.reject(closeError)
    try{ctx.get('channels').assertGroupTarget(conversationId)}catch(error){return Promise.reject(error)}
    const previous=tails.get(conversationId)??Promise.resolve()
    const work=previous.catch(()=>{}).then(()=>drain(conversationId))
    return trackTail(conversationId,work)
  }
  function trackTail(conversationId,work){
    tails.set(conversationId,work);inflight.add(work)
    void work.then(()=>errors.delete(conversationId),error=>errors.set(conversationId,error)).finally(()=>{inflight.delete(work);if(tails.get(conversationId)===work)tails.delete(conversationId)}).catch(()=>{})
    return work
  }
  async function continueBatch(row,handle,packet,failedEntryId,onAttempt=()=>{}){
    const conversationId=row.id,packetId=packet.id,ids=packet.source.eventIds,startedAt=new Date().toISOString()
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('ROUTER_PACKET_ID_CONFLICT')
    const inbox=await query('router.inbox',{conversationId,limit:30});assertOpen()
    const pendingCount=await query('router.inbox-count',{conversationId});assertOpen()
    // 不漏掉分页外的后续取消；联合续轮仍受原批次消息数与编码预算约束。
    if(pendingCount!==inbox.length||inbox.filter(event=>event.kind==='source.message').length>15||!isDeepStrictEqual(ids,inbox.slice(0,ids.length).map(event=>event.id))||inbox.reduce((bytes,event)=>bytes+Buffer.byteLength(JSON.stringify({...event,...event.source?{source:withoutTiming(event.source)}:{}})),0)>131072)fail('ROUTER_RESUME_BATCH_STALE')
    if(!packetViews(row,inbox.slice(0,ids.length)).some(value=>sameRouterPacket(value,packet)))fail('ROUTER_PACKET_ID_CONFLICT')
    const supplements=inbox.length>ids.length?[packetViews(row,inbox.slice(ids.length))[0]]:[]
    const snapshot=packetViews(row,inbox)[0],allIds=inbox.map(event=>event.id)
    const validate=async()=>{
      assertOpen()
      const current=await query('router.get',{conversationId});assertOpen()
      if(!current||current.phase!=='active'||current.generation!==row.generation||current.activeSessionId!==row.activeSessionId||agents.get(row.activeSessionId)!==handle.agent||handle.agent.lifecycle.signal.aborted)fail('ROUTER_RESUME_STALE')
      const pending=await query('router.inbox',{conversationId,limit:30});assertOpen()
      if(await query('router.inbox-count',{conversationId})!==allIds.length||!sameRouterPacket(packetViews(current,pending)[0],snapshot))fail('ROUTER_RESUME_BATCH_STALE')
    }
    await validate();assertOpen()
    for(const input of [packet,...supplements])packets.set(input.id,input)
    const observed=timing(row,`${packetId}:resume:${failedEntryId}`,1),stopObserving=observed.observe(handle.session)
    observed.start(inbox.filter(event=>event.sourceId).map(event=>({sourceId:event.sourceId,messageId:event.source?.messageId,version:event.messageVersion})),startedAt)
    try{const resumed=handle.resumeRouterBatch({packet,failedEntryId,supplements},validate);onAttempt();await resumed;await handle.whenIdle();assertOpen()}finally{
      for(const input of [packet,...supplements])packets.delete(input.id)
      try{await handle.whenIdle();await observed.finish()}catch{await observed.finishIfSettled()}finally{stopObserving()}
    }
    const pending=await query('router.inbox',{conversationId,limit:30});assertOpen()
    if(pending.some(event=>allIds.includes(event.id)))fail('ROUTER_BATCH_UNSETTLED')
  }
  async function resumeRouterBatch({conversationId,generation,sessionId:activeSessionId,packetId,failedEntryId}={}){
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
      await continueBatch(row,handle,packet,failedEntryId,()=>{attempted=true})
      await drain(conversationId)
      return {conversationId,generation,sessionId:activeSessionId,packetId,resumed:true,settled:true}
    })
    tails.set(conversationId,work);inflight.add(work)
    void work.then(()=>errors.delete(conversationId),error=>{if(attempted)errors.set(conversationId,error)}).finally(()=>{inflight.delete(work);if(tails.get(conversationId)===work)tails.delete(conversationId)}).catch(()=>{})
    return work
  }
  return {schedule,resumeRouterBatch,errors,hasInflight:conversationId=>tails.has(conversationId),
    async whenIdle(){for(;;){const work=[...tails.values()];await Promise.all(work);if(!tails.size)break}},
    async recover(){
      const conversations=new Set((await query('router.list')).map(row=>row.id))
      for(const id of await query('router.pending-conversations'))conversations.add(id)
      const failures=[]
      for(const id of conversations){
        try{await schedule(id)}catch(error){if(error.code!=='ROUTER_BATCH_UNSETTLED')throw error;failures.push({conversationId:id,code:error.code})}
      }
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
