import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {z} from 'zod'
import {sessionWorkspace} from '../../packages/dingtalk-core/session-workspaces.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const routerHandoffLimits=Object.freeze({maxBytes:32768,maxIntentCharacters:4000,maxSectionItems:16,maxItemCharacters:2000,maxReferences:128,maxReferenceCharacters:512})
const nonemptyText=max=>z.string().max(max).refine(value=>value.trim().length>0,{message:'交接内容不能为空'})
const section=z.array(nonemptyText(routerHandoffLimits.maxItemCharacters)).max(routerHandoffLimits.maxSectionItems)
const reference=nonemptyText(routerHandoffLimits.maxReferenceCharacters)
export const routerHandoffSchema=z.object({currentIntent:nonemptyText(routerHandoffLimits.maxIntentCharacters),unresolvedQuestions:section,referents:section,assumptions:section,evidenceRefs:z.array(z.object({sourceId:reference.optional(),taskId:reference.optional()}).strict().refine(row=>!!row.sourceId||!!row.taskId)).max(routerHandoffLimits.maxReferences),cutoff:z.number().int().nonnegative()}).strict().refine(value=>Buffer.byteLength(JSON.stringify(value),'utf8')<=routerHandoffLimits.maxBytes,{message:'ROUTER_HANDOFF_BUDGET_EXCEEDED'})

/** 串行调度只负责 Host 生命周期；推理、队列和历史始终由官方 Pi 执行。 */
export function openRouterLifecycle({ctx,store,root,models,setupBusiness,agentPreset='night-bot'}){
  const handles=new Map(),tails=new Map(),packets=new Map(),errors=new Map()
  let closed=false
  const query=(kind,args={})=>store.query({kind,...args})
  const command=(kind,args,id)=>store.command({kind,args,id:id??`${kind}:${hash(args)}`})
  const agents=ctx.get('agents'),persistence=ctx.get('sessionPersistence')
  const sessionId=(id,generation)=>`router-${hash(id)}-g${generation}`
  async function validateHandoff(text,row,requiredSourceIds){
    if(Buffer.byteLength(text,'utf8')>routerHandoffLimits.maxBytes)fail('ROUTER_HANDOFF_BUDGET_EXCEEDED')
    let parsed
    try{parsed=JSON.parse(text)}catch{fail('ROUTER_HANDOFF_INVALID')}
    const value=routerHandoffSchema.parse(parsed)
    if(value.cutoff!==row.cursor)fail('ROUTER_HANDOFF_CUTOFF_INVALID')
    const covered=new Set()
    for(const ref of value.evidenceRefs){
      if(ref.sourceId){const source=await query('source.get',{sourceId:ref.sourceId});if(!source||source.groupId!==row.id||source.triageHold||source.archiveRestoreHold)fail('ROUTER_HANDOFF_REFERENCE_INVALID');covered.add(ref.sourceId)}
      if(ref.taskId){const task=await query('task.get',{taskId:ref.taskId});if(!task||task.groupId!==row.id)fail('ROUTER_HANDOFF_REFERENCE_INVALID')}
    }
    if(requiredSourceIds.some(id=>!covered.has(id)))fail('ROUTER_HANDOFF_SOURCE_MISSING')
    return value
  }
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
    const id=handoff?sessionId(row.id,row.generation+1):row.activeSessionId
    if(handles.has(id))return handles.get(id)
    const existing=await persistence.stat(id)
    const expectedGeneration=handoff?row.generation+1:row.generation
    if(existing&&(existing.header.conversationId!==row.id||existing.header.generation!==expectedGeneration||existing.header.runtimeOwner!=='conversation-router'))fail('ROUTER_NATIVE_IDENTITY_INVALID')
    await bindMemory(id,row.id,previous)
    const workspace=await sessionWorkspace(root,'resident')
    const generation=handoff?row.generation+1:row.generation
    const authorizeInput=async(packet,actor)=>{
      const current=await query('router.get',{conversationId:row.id})
      return actor.id===id&&current?.activeSessionId===id&&current.generation===generation&&current.phase==='active'&&isDeepStrictEqual(packets.get(packet.id),packet)
    }
    const options={agentOptions:typeof models==='function'?models():models,authorizeInput,
      beforeRequest:async actor=>{
        const current=await query('router.get',{conversationId:row.id})
        if(current?.activeSessionId!==id||current.generation!==generation||!['active','handoff'].includes(current.phase)||actor.id!==id)fail('ROUTER_GENERATION_STALE')
      },
      setup:async(agentCtx,agent)=>{
        await agentCtx.get('agentPresets').mount(agentCtx,agentPreset)
        await setupBusiness(agentCtx,{conversationId:row.id,generation,sessionId:id})
      }}
    const handle=existing?await agents.resume({...options,resumeSessionId:id}):await agents.create({...options,sessionId:id,meta:{cwd:workspace,runtimeOwner:'conversation-router',agentPreset,conversationId:row.id,generation},...(handoff?{routerHandoff:{...handoff,conversationId:row.id}}:{})})
    handles.set(id,handle)
    return handle
  }
  async function publishCandidate(row,rotation,old,releaseOld=true){
    const candidateId=sessionId(row.id,row.generation+1)
    const candidate=await open(row,{handoff:{handoffId:rotation.id,...rotation.handoff},previous:old})
    const proof=await candidate.routerCommitProof()
    await verifyCommit(candidateId,proof,rotation.id,{conversationId:row.id,generation:row.generation+1})
    if(rotation.state==='summarized'){
      const receipt=await command('router.candidate.commit',{conversationId:row.id,generation:row.generation,handoffId:rotation.id,sessionId:candidateId,commitProof:proof})
      rotation=receipt.result.rotation
    }else if(rotation.candidateSessionId!==candidateId)fail('ROUTER_CANDIDATE_SCOPE')
    await verifyCommit(candidateId,rotation.candidateCommit,rotation.id,{conversationId:row.id,generation:row.generation+1})
    await command('router.publish',{conversationId:row.id,generation:row.generation,handoffId:rotation.id})
    if(old&&releaseOld){await old.dispose();handles.delete(old.agent.id)}
    return candidate
  }
  async function rotate(row,handle){
    const beforeCommit=await handle.routerCommitProof()
    const handoffId=`router-handoff:${hash([row.id,row.generation,row.cursor,beforeCommit.commitId])}`
    await handle.whenIdle()
    if(handle.session.pendingMessageCount||handle.session.isRetrying||handle.session.isStreaming)fail('ROUTER_NOT_IDLE')
    const begun=await command('router.handoff.begin',{conversationId:row.id,generation:row.generation,handoffId})
    const requiredSourceIds=begun.result.rotation.requiredSourceIds
    const packet={id:handoffId,source:{kind:'router-handoff',conversationId:row.id,generation:row.generation,handoffId},content:[{type:'text',text:'Router 交接请求：'+JSON.stringify({conversationId:row.id,generation:row.generation,handoffId,cutoff:row.cursor,requiredSourceIds,limits:routerHandoffLimits})+'\n仅输出JSON {currentIntent,unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:[{sourceId或taskId}],cutoff}。覆盖本代最后一批与前代交接中仍有效的意图、未决问题、指代和假设；引用必须存在，推测只进assumptions。不要工具、不要复制日志/附件/Skill/长期记忆全文。'}]}
    let summarized=false
    try{
      const result=await handle.runToolFreeHandoff(packet,text=>validateHandoff(text,row,requiredSourceIds))
      const receipt=await command('router.handoff.ready',{conversationId:row.id,generation:row.generation,handoffId,handoff:result.handoff,commitProof:result.commitProof})
      summarized=true
      await handle.runMaintenance(()=>publishCandidate(row,receipt.result.rotation,handle,false))
      await handle.dispose();handles.delete(handle.agent.id)
    }catch(error){
      if(!summarized&&error.routerSafeToResume===true)await command('router.handoff.abort',{conversationId:row.id,generation:row.generation,handoffId,safeToResume:true,error:error.code??error.message})
      throw error
    }
  }
  async function recoverConversation(row){
    if(row.phase==='active')return
    const rotation=(await query('router.rotations',{conversationId:row.id})).find(item=>item.id===row.rotationId)
    if(!rotation)fail('ROUTER_ROTATION_MISSING')
    if(['summarized','candidate-committed'].includes(rotation.state)){
      await verifyCommit(row.activeSessionId,rotation.oldCommit,undefined,{conversationId:row.id,generation:row.generation})
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
      await old.routerRecoveryProof(rotation.id)
      await command('router.handoff.abort',{conversationId:row.id,generation:row.generation,handoffId:rotation.id,safeToResume:true,error:'interrupted-handoff'})
    }else fail('ROUTER_RECOVERY_BLOCKED')
  }
  async function drain(conversationId){
    let row=await query('router.get',{conversationId})
    const events=await query('router.inbox',{conversationId,limit:30})
    if(!row){if(!events.length)return;row=(await command('router.ensure',{conversationId,sessionId:sessionId(conversationId,1)})).result.conversation}
    if(row.phase!=='active'){await recoverConversation(row);row=await query('router.get',{conversationId})}
    let handle
    for(;;){
      const inbox=await query('router.inbox',{conversationId,limit:30})
      if(!inbox.length)break
      // 每批用户来源不超过15；内部事件另受总量和编码预算约束。
      let users=0,bytes=0;const batch=[]
      for(const event of inbox){if(event.kind==='source.message'&&users>=15)break;const size=Buffer.byteLength(JSON.stringify(event));if(batch.length&&bytes+size>131072)break;batch.push(event);bytes+=size;if(event.kind==='source.message')users++}
      handle??=await open(row)
      const id=`router-input:${hash([conversationId,batch.map(event=>event.id)])}`
      const packet={id,source:{kind:'conversation-router',conversationId,generation:row.generation,eventIds:batch.map(event=>event.id)},content:[{type:'text',text:'Router 请求：'+JSON.stringify({conversationId,generation:row.generation,events:batch})}]}
      packets.set(id,packet)
      try{await handle.enqueue(packet);await handle.deliver(id);await handle.whenIdle()}finally{packets.delete(id)}
      const pending=await query('router.inbox',{conversationId,limit:30})
      if(batch.some(event=>pending.some(item=>item.id===event.id)))fail('ROUTER_BATCH_UNSETTLED')
      row=await query('router.get',{conversationId})
    }
    if(row.cursor>row.lastHandoffCursor){handle??=await open(row);await rotate(row,handle)}
  }
  function schedule(conversationId){
    if(closed)return Promise.reject(Object.assign(new Error('ROUTER_CLOSED'),{code:'ROUTER_CLOSED'}))
    const previous=tails.get(conversationId)??Promise.resolve()
    const work=previous.catch(()=>{}).then(()=>drain(conversationId))
    tails.set(conversationId,work)
    void work.then(()=>errors.delete(conversationId),error=>errors.set(conversationId,error)).finally(()=>{if(tails.get(conversationId)===work)tails.delete(conversationId)}).catch(()=>{})
    return work
  }
  return {schedule,errors,
    async whenIdle(){for(;;){const work=[...tails.values()];await Promise.all(work);if(!tails.size)break}},
    async recover(){
      for(const row of await query('router.list')){
        if(row.phase!=='active')await recoverConversation(row)
        else for(const rotation of await query('router.rotations',{conversationId:row.id}))if(rotation.state==='published'&&rotation.candidateSessionId===row.activeSessionId){const old=handles.get(rotation.oldSessionId);if(old){await old.dispose();handles.delete(rotation.oldSessionId)}}
      }
      for(const id of await query('router.pending-conversations'))await schedule(id)
    },
    async close(){
      // 先拒绝新调度，已接纳轮次仍按当前 generation 排空，不能伪造成过时代际。
      closed=true
      const running=await Promise.allSettled([...tails.values()])
      const stopped=await Promise.allSettled([...handles.values()].map(handle=>handle.dispose()))
      handles.clear()
      // 已安全恢复的摘要拒绝仍保留在 errors；它不是资源排空失败。
      const failures=[...running.filter(item=>item.status==='rejected'&&item.reason.routerSafeToResume!==true),...stopped.filter(item=>item.status==='rejected')].map(item=>item.reason)
      if(failures.length)throw new AggregateError(failures,'Router shutdown failed')
    },
  }
}
