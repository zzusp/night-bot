import {routerTaskSummary,routerTaskReceipt} from './router-task-view.js'
import {recentSourceBackground} from './source-history.js'
import {traceSourcesMetadata} from '../runtime/pi-agent-observation.js'
import {routerMemoryReconciliation} from './router-memory-reconciliation.js'
import {createAgentPhaseTimer} from '../runtime/pi-agent-observation.js'
import {sourceStageTiming} from './source-stage-timing.js'
import {routerMemoryParameters,hash as memoryHash} from '../memory/format.js'
import {conversationSource} from './message-safety.js'
import {randomUUID,createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {scopeOf} from '../native-scope.js'
import {TRIAGE_BATCH_LIMIT,triageSessionId,triageParameters,validateTriageDecision} from './triage.js'
import {sessionWorkspace} from '../../packages/dingtalk-core/session-workspaces.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const output={schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]}
export const residentOperationId=(conversationId,key)=>'router-operation:'+createHash('sha256').update(JSON.stringify([conversationId,key])).digest('hex')

/** One durable Pi session per authenticated conversation; each input batch is fenced. */
export function createChannelTriage({ctx,root,models,legacy,responsibilityFor,commit,recordStage,observe,query}){
  const handles=new Map(),entries=new Map()
  let closed=false
  const idFor=triageSessionId
  const active=conversationId=>{
    const entry=entries.get(conversationId)
    if(closed||!entry||entry.submitted||entry.superseded)fail('TRIAGE_INACTIVE')
    return entry
  }
  async function open(conversationId){
    const sessionId=idFor(conversationId)
    if(handles.has(conversationId))return handles.get(conversationId)
    const persistence=ctx.get('sessionPersistence')
    const existing=typeof persistence?.stat==='function'?await persistence.stat(sessionId):undefined
    if(closed)fail('TRIAGE_CLOSED')
    if(existing&&(existing.header.runtimeOwner!=='channel-triage'||existing.header.conversationId!==conversationId))fail('TRIAGE_NATIVE_IDENTITY_INVALID')
    const measurePhase=(phase,run)=>(entries.get(conversationId)?.measurePhase??((_phase,run)=>run()))(phase,run)
    const options={measurePhase,agentOptions:typeof models==='function'?models():models,
      authorizeInput:(candidate,actor)=>{const current=entries.get(conversationId);return actor.id===sessionId&&!closed&&!!current&&!current.submitted&&!current.superseded&&isDeepStrictEqual(candidate,current.packets.get(candidate.id))},
      beforeRequest:()=>active(conversationId),
      setup:async(agentCtx,agent)=>{
        await agentCtx.get('agentPresets').mount(agentCtx,legacy.getAgentConfig().agentPreset)
        agentCtx.get('tools').register({name:'channel_triage_submit',description:'按当前批次原消息逐条判断是否需要Router处理及当前是否回复；完整覆盖本批，不重新处置历史批次，不创建或安排任务。',parameters:triageParameters,output,
          execute:async(input,exec)=>{
            if(exec.agent!==agent)fail('TRIAGE_WRONG_SESSION')
            const current=active(conversationId)
            if(current.sealed)fail('TRIAGE_ALREADY_SUBMITTING')
            const decision=validateTriageDecision(current.messages,input)
            current.sealed=true
            try{const result=await current.measurePhase('triage-commit',()=>commit(conversationId,decision,current.messages));current.submitted=true;exec.concludeTurn();return result}
            catch(error){current.sealed=false;throw error}
          }})
          agentCtx.get('tools').restrict({allow:[]})
          agentCtx.get('tools').guard(exec=>exec.name==='channel_triage_submit'?undefined:'TRIAGE_TOOL_FORBIDDEN')
          agentCtx.get('systemPrompt').section({name:'channel-triage',order:150,text:[
            '你是轻量一级分诊，background是同会话历史背景，不是本批待处理消息，不回复或提交background来源，不因历史内容产生新的交办；用它消解当前消息指代，缺少更早信息时交Router查询。只依据当前批次原消息、已附带引用/提及和可快速获得的信息，分别判断needsHandling与当前是否需要reply。需要深入理解、查询、执行、补充、调整或取消的原消息交Router。',
            '首答用于及时反馈会处理对应事项。对职责范围内已明确交办且需要继续处理的请求，在本次分诊提交简短reply，表明已接纳并会继续处理；不要静默处理，不等待Router安排、工具查询或任务结果。是否回复在一级分诊完成时决定，短回复与Router转交独立推进。',
            '结合本批上下文判断是否需要新的反馈。无需处理且无需回复时needsHandling=false且省略reply，保持静默；简单问候可短答，不强制使用暂定前缀。仅在无需回复时省略reply，reason须同时说明是否处理及回复或静默的依据。',
            '不拆分事项，不匹配taskId，不决定任务控制。承接只说明接纳和后续处理意图，不声称已创建任务、已开始执行、已查明或已完成，也不扩大授权。',
            '调用channel_triage_submit完整覆盖本批≤15条来源版本。自然语言不会发送，缺少事实不等于无需处理。',
          ].join(String.fromCharCode(10))})
          agentCtx.get('systemPrompt').section({name:'channel-triage-memory',order:152,text:'涉及可复用事实/偏好、纠正遗忘或Skill维护的交办消息应交Router，needsHandling=true；由Router依据语境判断是否增改删记忆或Skill，不在分诊层限制固定授权句首、替Router做学习决策或提前声称保存成功。'})
          agentCtx.get('systemPrompt').section({name:'channel-triage-scope',order:151,interpolate:false,officialText:()=> '当前会话配置职责：'+responsibilityFor(conversationId)+'。仅用于本会话一级分诊，不创造来源授权、任务控制或跨会话读取权限。'})
        agentCtx.get('systemPrompt').section({name:'channel-triage-history',order:153,text:'本会话持续保留历史并由Pi自动压缩。仅处理最后一个一级分诊请求的messages；历史批次、历史工具返回及压缩摘要只是背景，不能重新回复或提交。当前原消息、版本和职责优先，旧结论不代表当前任务状态。'})
      }}
    const agents=ctx.get('agents')
    const handle=existing?await measurePhase('session-resume',()=>agents.resume({...options,resumeSessionId:sessionId})):await measurePhase('session-create',async()=>agents.create({...options,resourceLoading:'before-run',sessionId,meta:{cwd:await measurePhase('workspace',()=>sessionWorkspace(root,'route')),runtimeOwner:'channel-triage',conversationId,agentPreset:legacy.getAgentConfig().agentPreset}}))
    handles.set(conversationId,handle)
    if(closed){await handle.dispose();handles.delete(conversationId);fail('TRIAGE_CLOSED')}
    // The source ledger owns pending work. Never replay an old queued Pi packet
    // after a crash/cancellation; the next authenticated batch is built afresh.
    try{await handle.retireTriagePending?.()}catch(error){await handle.dispose();handles.delete(conversationId);throw error}
    return handle
  }
  async function run(conversationId,messages){
    if(closed)fail('TRIAGE_CLOSED')
    if(entries.has(conversationId))fail('TRIAGE_BATCH_BUSY')
    if(!messages.length||messages.length>TRIAGE_BATCH_LIMIT)fail('TRIAGE_BATCH_LIMIT')
    const sessionId=idFor(conversationId),requestId='triage:'+randomUUID(),snapshot=structuredClone(messages),entry={messages:snapshot,packets:new Map(),sealed:false,superseded:false,submitted:false}
    entries.set(conversationId,entry)
    try{entry.background=await recentSourceBackground(query,conversationId,snapshot)}catch{entry.background={backgroundOnly:true,status:'unavailable',sources:[]};ctx.logger?.warn?.('Triage optional history unavailable')}
    if(closed){entries.delete(conversationId);fail('TRIAGE_CLOSED')}
    entry.timing=sourceStageTiming({recordStage,stage:'triage',sessionId,requestId,groupId:conversationId,onError:error=>ctx.logger?.warn?.(`message timing: ${error.code??error.message}`)})
    entry.timing.start(snapshot)
    const measurePhase=observe?createAgentPhaseTimer({ownerId:sessionId,runId:()=>requestId,emit:record=>observe(conversationId,record),onError:()=>ctx.logger?.warn?.('Triage phase observation failed')}):(_phase,run)=>run()
    entry.measurePhase=measurePhase
    const packet=()=>{const value={id:'triage:'+randomUUID(),source:{kind:'channel-triage',conversationId,...traceSourcesMetadata(snapshot)},content:[{type:'text',text:'一级分诊请求：'+JSON.stringify({conversationId,background:{...entry.background,sources:entry.background.sources.filter(old=>!snapshot.some(current=>current.messageId===old.messageId))},messages:snapshot.map(({stages,...source})=>conversationSource(source))})}]};entry.packets.set(value.id,value);return value}
    entry.packet=packet
    let handle,completed=false
    return measurePhase('triage-total',async()=>{try{
      handle=await open(conversationId);entry.handle=handle;entry.stopObserving=entry.timing.observe(handle.session)
      if(entry.superseded)return
      const initial=packet()
      try{await measurePhase('input-enqueue',()=>handle.enqueue(initial));await handle.deliver(initial.id);await handle.whenIdle()}
      catch(error){if(!entry.superseded)throw error}
      if(!entry.submitted&&!entry.superseded)fail('TRIAGE_NO_DISPOSITION')
      completed=entry.submitted&&!entry.superseded
    }finally{
      try{await entry.cancellation}finally{try{
        // Success leaves the Pi owner alive; failed/cancelled owners are drained
        // and lazily resumed from the same journal, not copied into a new history.
        if(handle&&!completed){await measurePhase('session-dispose',()=>handle.dispose());handles.delete(conversationId)}
        await entry.timing.finish()
      }catch(error){await entry.timing.finishIfSettled();throw error}finally{entry.stopObserving?.();if(entries.get(conversationId)===entry)entries.delete(conversationId)}}
    }})
  }
  async function append(conversationId,messages){
    const entry=entries.get(conversationId)
    if(!entry||closed||entry.superseded)return false
    if(messages.some(source=>entry.messages.some(old=>old.messageId===source.messageId&&old.version<source.version))){
      entry.superseded=true
      if(entry.handle)await (entry.cancellation=entry.handle.cancel({kind:'source-version-superseded'}))
      return true
    }
    if(entry.sealed)return false
    const added=messages.filter(source=>!entry.messages.some(old=>old.sourceId===source.sourceId)).slice(0,TRIAGE_BATCH_LIMIT-entry.messages.length)
    if(!added.length)return false
    entry.messages.push(...structuredClone(added))
    entry.timing?.start(added)
    if(entry.handle){const packet=entry.packet();await entry.measurePhase('input-enqueue',()=>entry.handle.enqueue(packet));await entry.handle.deliver(packet.id,{deliverAs:'steer'})}
    return true
  }
  return {run,append,async close(){closed=true;const results=await Promise.allSettled([...handles.values()].map(handle=>handle.dispose()));const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);if(errors.length)throw new AggregateError(errors,'Triage drain failed');handles.clear()}}
}

/** Router has business capabilities, never arbitrary process or external-write tools. */
export function registerResidentRouterTools(agentCtx,binding,{query,command,responsibilityFor,applyTaskAction,prepareReply,platformQuery,platformSchedule,platformScheduleList,platformScheduleUpdate,platformScheduleDelete,platformConfig}){
  const {conversationId,generation}=binding
  const current=async exec=>{
    const state=await query('router.get',{conversationId})
    if(exec.agent.id!==binding.sessionId||state?.generation!==generation||state.phase!=='active')fail('ROUTER_GENERATION_STALE')
  }
  const source=async(sourceId,messageVersion,scheduling=false)=>{
    const value=await query('source.get',{sourceId})
    if(!value||value.groupId!==conversationId||value.version!==messageVersion||value.channel==='internal')fail('ROUTER_SOURCE_FORBIDDEN')
    const all=await query('source.list',{groupId:conversationId})
    if(!scheduling&&all.some(item=>item.messageId===value.messageId&&item.version>value.version))fail('ROUTER_SOURCE_STALE')
    return value
  }
  const learningSource=async(args,exec)=>{
    const original=await source(args.sourceId,args.messageVersion)
    if(original.authorizationRevoked||original.triageHold||original.archiveRestoreHold)fail('ROUTER_SOURCE_STALE')
    const admitted=await exec.agent.admission.current()
    const eventIds=new Set((admitted?.messages??[]).filter(packet=>packet.source?.kind==='conversation-router'&&packet.source.conversationId===conversationId&&packet.source.generation===generation).flatMap(packet=>packet.source.eventIds))
    const inbox=await query('router.inbox',{conversationId})
    if(!inbox.some(event=>eventIds.has(event.id)&&event.sourceId===original.sourceId&&event.messageVersion===original.version))fail('MEMORY_CURRENT_SOURCE_REQUIRED')
    await current(exec)
    return original
  }
  const learningMutation=run=>async(args,exec)=>{
    try{return await run(exec.agent,await learningSource(args,exec),args,()=>learningSource(args,exec))}
    catch(error){return {ok:false,code:error.code??'MEMORY_OPERATION_FAILED',...error.committed?{committed:true}:{}}}
  }
  agentCtx.get('memory')?.bindRecallSources(scopeOf(agentCtx),async actor=>{
    const active=async()=>{const state=await query('router.get',{conversationId});return actor.id===binding.sessionId&&state?.generation===generation&&state.phase==='active'}
    // 结清后的无工具交接不再有可适用的人类来源，但仍需过滤历史结果。
    if(!await active())return []
    const admitted=await actor.admission.current()
    const ids=new Set((admitted?.messages??[]).filter(packet=>packet.source?.kind==='conversation-router'&&packet.source.conversationId===conversationId&&packet.source.generation===generation).flatMap(packet=>packet.source.eventIds))
    const events=await query('router.inbox',{conversationId}),subjects=[]
    for(const event of events)if(ids.has(event.id)&&event.sourceId){
      const original=await source(event.sourceId,event.messageVersion)
      if(!original.authorizationRevoked&&!original.triageHold&&!original.archiveRestoreHold)subjects.push({actor:memoryHash(original.actorId),messageId:original.sourceId})
    }
    return await active()?subjects:[]
  })
  const string={type:'string'},integer={type:'integer',minimum:1},strings={type:'array',items:string}
  const identity={operationId:string,sourceId:string,messageVersion:integer}
  const tools=[
    ...routerMemoryReconciliation(agentCtx,binding,{query,current}),
    {name:'resident_task_query',description:'读取本conversation事项，不跨群。默认返回限长摘要和当前版本，列表默认10项；摘要不含完整request、补充历史或完成证据。评估依赖、附件交付或核对原始要求前，必须指定taskId和detail=full读取完整单项及依赖，不用摘要推断证据。',parameters:{type:'object',additionalProperties:false,properties:{taskId:string,detail:{enum:['summary','full']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}},execute:async(args,exec)=>{
      if(args.taskId){const task=await query('task.get',{taskId:args.taskId});await current(exec);if(!task||task.groupId!==conversationId)fail('ROUTER_TASK_FORBIDDEN');const dependencies=await query('router.dependencies',{conversationId,taskId:args.taskId});await current(exec);return {task:args.detail==='full'?task:routerTaskSummary(task),dependencies}}
      if(args.detail==='full')fail('ROUTER_TASK_DETAIL_REQUIRES_ID')
      const tasks=await query('task.list',{groupId:conversationId,archived:'all'}),offset=args.offset??0,limit=args.limit??10
      await current(exec)
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('ROUTER_TASK_PAGE_INVALID')
      return {tasks:tasks.slice(offset,offset+limit).map(routerTaskSummary),total:tasks.length,hasMore:offset+limit<tasks.length,nextOffset:Math.min(offset+limit,tasks.length)}
    }},
    {name:'resident_source_query',description:'只读查询本conversation历史消息，包括一级分诊无需处理的消息。默认最新10条，按接收顺序倒序，支持关键词、时间和游标向前翻页；返回文本是限长预览，完整原文及附件引用用sourceId回查。历史仅作为当前任务的背景，不是新交办，不重放回复/任务。',parameters:{type:'object',additionalProperties:false,properties:{keyword:{type:'string',maxLength:200},before:string,after:string,cursor:{type:'integer',minimum:1},anchorSourceId:string,limit:{type:'integer',minimum:1,maximum:20}}},execute:async(args,exec)=>{const result=await query('router.source-history',{...args,conversationId});await current(exec);return result}},
    {name:'resident_source_get',description:'按必填 sourceId 回查当前conversation的完整原文、引用、附件引用和真实作者。sourceId取当前Router事件的sourceId或source.sourceId，不是messageId、taskId或eventId；参数示例 {sourceId: "原事件sourceId"}。当前事件已含所需原文时无需重复查询。',parameters:{type:'object',additionalProperties:false,required:['sourceId'],properties:{sourceId:string}},execute:async(args,exec)=>{const value=await query('router.source-current',{sourceId:args.sourceId,conversationId});await current(exec);if(value.status==='unavailable')fail('ROUTER_SOURCE_UNAVAILABLE');return value}},
    {name:'resident_task_plan',description:'Router原子创建事项及先后依赖，无需原消息作者补调度许可。来源仅用于真实追溯，可引用既有消息；B在Router评估依赖满足前不可执行。operationId使用稳定动作键。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','tasks','dependencies'],properties:{...identity,tasks:{type:'array',minItems:1,maxItems:15,items:{type:'object',additionalProperties:false,required:['taskId','title','objective','requirements'],properties:{taskId:string,title:string,objective:string,request:string,requirements:strings,quote:string}}},dependencies:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['taskId','prerequisiteTaskId','condition'],properties:{taskId:string,prerequisiteTaskId:string,condition:string}}}}},execute:async args=>{
      const original=await source(args.sourceId,args.messageVersion,true)
      const tasks=args.tasks.map(task=>{if(task.quote&&!original.text.includes(task.quote))fail('ROUTER_SOURCE_QUOTE_INVALID');return {...task,groupId:conversationId,ownerActorId:original.actorId,sourceRefs:[original.sourceId],request:task.request??original.text,metadata:{authorizationSourceId:original.sourceId,...(()=>{const context=agentCtx.get('channels').groupContext(conversationId);return context?{channelType:context.type,memoryGroupId:context.memoryGroupId}:{}})()}}})
      const result=await command('router.plan',{conversationId,generation,...args,tasks,operationId:residentOperationId(conversationId,args.operationId)})
      await applyTaskAction({kind:'materialize',tasks:result.result?.tasks??tasks,source:original});return routerTaskReceipt(result)
    }},
    {name:'resident_task_action',description:'Router拥有原唯一执行会话的完整调度权，无需原作者或安装操作者补授权。control(active)及无humanRequestId的resume可直接唤起、解除等待、恢复暂停或重启取消/完成任务。先用resident_task_query读取当前status/control及修订号。reopen重开原会话；sameGoal=true仅限reopen且objective/title/requirements完全不变（建议省略这些字段），更改目标时不得传true。request仅用于revise/reopen，是当前完整有效任务简报，不是历史追加日志；text仅本轮增量。变更目标或约束时用revise/reopen并显式更新request、objective、requirements全集，移除已失效要求；保留仍有效约束，不用进度催促重述历史，不把旧效果noReplay误当新任务授权门槛。终态任务优先reopen；supplement仅补充活动任务上下文并保留等待，终态不要supplement。来源仅追溯，可省略并复用原任务来源。只有明确结清一条实际答复时提供humanRequestId、expectedContextRevision和reason；arrange须expectedArrangementRevision及dependencies全集（[]清空）。',parameters:{type:'object',additionalProperties:false,required:['operationId','kind','taskId','expectedRequirementRevision','expectedControlRevision'],properties:{...identity,kind:{enum:['supplement','resume','revise','reopen','control','arrange']},taskId:string,expectedRequirementRevision:integer,expectedControlRevision:integer,expectedContextRevision:{type:'integer',minimum:0},humanRequestId:string,text:string,request:string,objective:string,title:string,requirements:strings,sameGoal:{type:'boolean'},expectedArrangementRevision:integer,dependencies:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['prerequisiteTaskId','condition'],properties:{prerequisiteTaskId:string,condition:string}}},control:{enum:['active','paused','cancelled']},reason:string}},execute:async args=>{
      const task=await query('task.get',{taskId:args.taskId})
      if(!task||task.groupId!==conversationId)fail('ROUTER_TASK_FORBIDDEN')
      if((args.sourceId===undefined)!==(args.messageVersion===undefined))fail('ROUTER_ARGUMENT_INVALID')
      const original=args.sourceId===undefined?await query('source.get',{sourceId:task.sourceRefs[0]}):await source(args.sourceId,args.messageVersion,true)
      return routerTaskReceipt(await applyTaskAction({...args,conversationId,generation,operationId:residentOperationId(conversationId,args.operationId),source:original}))
    }},
    {name:'resident_dependency_evaluate',description:'核对当前完成事件、验收与证据后评估依赖。只有satisfied且当前权限/版本有效才释放后续；continue/wait保持阻塞。',parameters:{type:'object',additionalProperties:false,required:['operationId','dependencyId','completionEventId','prerequisiteRequirementRevision','requirementRevision','controlRevision','arrangementRevision','decision','evidence'],properties:{operationId:string,dependencyId:string,completionEventId:string,prerequisiteRequirementRevision:integer,requirementRevision:integer,controlRevision:integer,arrangementRevision:integer,decision:{enum:['satisfied','continue','wait']},evidence:strings}},execute:args=>command('router.evaluate',{conversationId,generation,...args,operationId:residentOperationId(conversationId,args.operationId)})},
    {name:'resident_memory_remember',description:'结合上下文提炼简洁、可独立使用的记忆。memory.summary写结论/决定/偏好，why只写来源支持的原因（未说明则明确未说明），howToApply写具体用法和必要范围，三项必填。不写推测、假设、会话流水或通用免责声明。原话与引用只放evidence元数据，不重复铺进正文。sourceQuote为本批完整原话；evidence逐字摘录同会话可回查来源，sourceId/messageVersion指承载消息，source=quote指该消息引用内容；必须有message证据保留本批完整原话。appliesTo.kind=actor用于个人偏好，由Host绑定原作者；项目背景用context说明场景，作者不自动等于适用对象。核对来源不等于核验陈述。只有ok=true且persisted=true才可确认保存。',parameters:{type:'object',additionalProperties:false,required:['sourceId','messageVersion','topic','key','memory','sourceQuote'],properties:{sourceId:string,messageVersion:integer,topic:string,key:string,memory:routerMemoryParameters,sourceQuote:string,expiresAt:string,expectedRevision:{type:'integer',minimum:0}}},execute:learningMutation(async(actor,original,args,validate)=>{
      const resolve=async()=>{const values=[];for(const ref of args.memory.evidence){const value=await source(ref.sourceId,ref.messageVersion);if(value.authorizationRevoked||value.triageHold||value.archiveRestoreHold)fail('ROUTER_SOURCE_STALE');values.push(value)}return values}
      const evidenceSources=await resolve()
      return agentCtx.get('memory').mutateChannelSource(actor,original,{...args,action:'remember'},async()=>{await validate();if(!isDeepStrictEqual(await resolve(),evidenceSources))fail('ROUTER_SOURCE_STALE')},evidenceSources)
    })},
    {name:'resident_memory_forget',description:'Router判断记忆过时、错误或不再需要时直接删除，清理候选与派生学习内容。先读回确认目标topic/key和版本；当前原消息无需包含内部key或固定删除句式，sourceQuote必须为本批完整原话。成功后回读确认，不重放旧来源。',parameters:{type:'object',additionalProperties:false,required:['sourceId','messageVersion','topic','key','sourceQuote'],properties:{sourceId:string,messageVersion:integer,topic:string,key:string,sourceQuote:string,expectedRevision:{type:'integer',minimum:0}}},execute:learningMutation((actor,original,args,validate)=>agentCtx.get('memory').mutateChannelSource(actor,original,{...args,action:'forget'},validate))},
    {name:'resident_skill_query',description:'读取Bot共享学习Skill的key、版本、来源与适用范围；提供key时读取步骤及理由，供Router判断新增、更新或删除。只读，不暴露私有文件路径，不包含安装模板。',parameters:{type:'object',additionalProperties:false,properties:{key:string}},execute:async(args,exec)=>agentCtx.get('memory').readSkills(exec.agent,args)},
    {name:'resident_skill_mutate',description:'由Router直接新增/更新(upsert)或删除(delete)Bot共享学习Skill，无需创建任务、等待复盘或先写experience。先query确认目标与expectedRevision；upsert提供steps、reason、applicability作为候选，Host实际加载内置skill-creator生成正文后发布；生成失败不得声称保存。内容标为模型指导而非权限。使用稳定operationId，sourceQuote为当前批次完整原话。只维护受控learned命名空间，不写安装模板、不执行脚本、不保存秘密；只有persisted=true才确认完成，duplicate不代表恢复已删除内容。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','action','key','sourceQuote'],properties:{...identity,action:{enum:['upsert','delete']},key:string,sourceQuote:string,steps:strings,reason:string,applicability:string,expectedRevision:{type:'integer',minimum:0}}},execute:learningMutation((actor,original,args,validate)=>agentCtx.get('memory').mutateChannelSkill(actor,original,{...args,operationId:residentOperationId(conversationId,args.operationId)},validate))},
    {name:'resident_router_reply',description:'冻结并可靠发送澄清、进度或结果；任务附件须先query核对完成证据，再用taskDelivery显式选择该任务当前版本的已冻结artifactIds。可用recipientActorIds显式选择同会话受信成员，空数组不提及；不按姓名猜ID，不默认通知所有参与人。仅原请求明确要求原生引用当前原消息时使用replyToSource=true，必须显式选择包含原作者的受众；可与taskDelivery组合，仅引用父说明，文件消息不继承引用。冻结或接纳不代表送达；先检查分诊已回复内容，避免重复确认；replyPurpose仅作可选用途记录，不影响发送或首答计时。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','text'],properties:{...identity,replyPurpose:{enum:['acknowledgement','direct-answer','task-update'],description:'可选记录本条回复用途：承接、直接答复或任务后续进展/结果；不作为首答计时条件。'},text:{type:'string',minLength:1,maxLength:8000},recipientActorIds:{type:'array',items:{type:'string',minLength:1}},replyToSource:{type:'boolean',enum:[true],description:'显式原生引用本次sourceId/messageVersion指定的原消息；Host绑定消息与作者，recipientActorIds须显式包含该作者。省略时保留默认行为。仅作用于父说明，不给文件消息增加引用或提及能力。'},taskDelivery:{type:'object',additionalProperties:false,required:['taskId','requirementRevision','artifactIds'],properties:{taskId:string,requirementRevision:integer,artifactIds:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}}},execute:async args=>{const original=await source(args.sourceId,args.messageVersion);return prepareReply({...args,source:original,conversationId,generation,outboundId:residentOperationId(conversationId,args.operationId)})}},
    {name:'resident_router_settle',description:'本批必要动作已有持久收据后结清原消息/内部事件，不表示任务完成或通知送达。已有分诊首答的来源须有实际task plan/action关联；不需任务时逐条提交noTaskDispositions，依据原消息说明已当场处理、具体缺失信息或未交办给助手。重复询问是否接单不是具体澄清或已处理。' ,parameters:{type:'object',additionalProperties:false,required:['eventIds','operationId'],properties:{eventIds:{type:'array',minItems:1,maxItems:30,items:string},operationId:string,noTaskDispositions:{type:'array',maxItems:15,items:{type:'object',additionalProperties:false,required:['eventId','outcome','reason','sourceQuote'],properties:{eventId:string,outcome:{enum:['handled-inline','clarification','not-assigned']},reason:string,notificationId:{...string,description:'clarification必填：resident_router_reply返回的同来源版本notification.id，不能使用分诊首答。'},sourceQuote:{...string,description:'对应当前来源完整原文；分诊首答不是原文或授权。'},missingInformation:{type:'array',minItems:1,items:string,description:'clarification必填：具体缺少的目标、范围或输入，不是是否愿意接单。'}}}}}},execute:async args=>command('router.settle',{conversationId,generation,...args,operationId:residentOperationId(conversationId,args.operationId)})},
    {name:'platform_task_query',description:'只读本conversation真实事项，按声明时区分页查询状态与日期，不创建空业务任务。',parameters:{type:'object',additionalProperties:false,properties:{state:{enum:['running','completed','all']},day:string,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}},execute:args=>platformQuery(conversationId,args)},
    {name:'platform_config_query',description:'只读当前会话职责、时区、模型与并发配置；不返回密钥、路径或其它会话配置，修改仍走已认证管理入口。',parameters:{type:'object',additionalProperties:false,properties:{}},execute:()=>platformConfig(conversationId)},
    {name:'platform_schedule_list',description:'查询当前conversation的平台定时事项及准确scheduleId，修改/删除前先查询；不可猜测ID或只在任务正文标记取代。',parameters:{type:'object',additionalProperties:false,properties:{}},execute:()=>platformScheduleList(conversationId)},
    {name:'platform_schedule_update',description:'修改已有排期：物理撤销旧定时并持久化替代排期，返回新scheduleId；只改提供字段，at须含时区偏移，every_seconds保持真实周期。返回scheduled才确认新安排。已开始的不可逆外发不能撤回。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','scheduleId','change'],properties:{...identity,scheduleId:string,change:{type:'object',additionalProperties:false,properties:{title:{type:'string',minLength:1,maxLength:120},prompt:{type:'string',minLength:1,maxLength:8000},at:string,every_seconds:{type:'integer',minimum:60},stopWhen:{type:'object',additionalProperties:false,required:['taskIds'],properties:{taskIds:{type:'array',minItems:1,maxItems:30,items:string}}}}}}},execute:async args=>platformScheduleUpdate({...args,source:await source(args.sourceId,args.messageVersion),conversationId,requestId:residentOperationId(conversationId,args.operationId)})},
    {name:'platform_schedule_delete',description:'真实取消当前conversation已建排期，停止后续触发并阻止旧排期未发出的平台回复；返回cancelled才确认。不能撤回已经开始或完成的不可逆外发。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','scheduleId'],properties:{...identity,scheduleId:string}},execute:async args=>platformScheduleDelete({...args,source:await source(args.sourceId,args.messageVersion),conversationId,requestId:residentOperationId(conversationId,args.operationId)})},
    {name:'platform_schedule_submit',description:'创建平台定时事项：at为一次性（须时区偏移），every_seconds为持续间隔（每10分钟用600），二者必须且只能选一项。不要把“每/定期/直到完成”降为一次性at或链式单次提醒。持续检查指定工作直到完成时先确定本conversation真实taskIds，提供stopWhen:{taskIds:[...]}；完成仅指这些任务当前版本有完成记录，等待/失败不是完成。prompt保留原检查范围与汇报要求，不创建空检查任务。返回scheduled后才确认安排。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','title','prompt'],properties:{...identity,title:{type:'string',minLength:1,maxLength:120},prompt:{type:'string',minLength:1,maxLength:8000},at:string,every_seconds:{type:'integer',minimum:60},stopWhen:{type:'object',additionalProperties:false,required:['taskIds'],properties:{taskIds:{type:'array',minItems:1,maxItems:30,items:string}}}}},execute:async args=>{const original=await source(args.sourceId,args.messageVersion);return platformSchedule({...args,source:original,conversationId,requestId:residentOperationId(conversationId,args.operationId)})}},
  ]
  for(const tool of tools){const execute=tool.execute;agentCtx.get('tools').register({...tool,output,execute:async(args,exec)=>{await current(exec);return execute(args,exec)}})}
  const names=[...tools.map(tool=>tool.name),...['skill','memory_index','memory_read','memory_search','memory_status'].filter(name=>agentCtx.get('tools').get(name,scopeOf(agentCtx)))]
  agentCtx.get('tools').restrict({allow:names.filter(name=>agentCtx.get('tools').view(scopeOf(agentCtx)).restrictableNames.has(name))})
  agentCtx.get('tools').guard(exec=>names.includes(exec.name)?undefined:'ROUTER_TOOL_FORBIDDEN')
  agentCtx.get('systemPrompt').section({name:'resident-router',order:150,text:'你是该conversation的常驻Router，负责理解真实来源、关联或拆分事项、安排调整并核验执行结果。每事项只有一个执行会话，没有Owner或执行团队。不得运行业务脚本或外部写操作；经受控事项动作由唯一执行会话完成。原消息真实发送人及版本用于追溯；你对所属conversation的执行会话拥有完整调度权，不按来源作者或额外操作者许可设门槛。任务执行工具和实际外部副作用仍遵循应用权限与业务授权。先查原任务避免重复新建；任务查询默认为摘要，plan/action回执也仅返回任务摘要；需要完整要求、来源列表、等待问题、完成证据和附件时，用resident_task_query(taskId,detail=full)读回，摘要不能作为依赖完成评估依据；问候、平台查询和定时汇报不建空业务任务。先A后B必须原子保存依赖；A完成后核对验收、当前版本、结果、证据与限制再评估，不能见completed自动释放B。用户取消/修订及时处理，补充保留原执行会话，改目标需排空旧执行。任务等待时可直接用resume或control(active)唤起原会话，不要求新人工回复、问题ID或新目标许可；Host将旧等待记为superseded，不伪造人已回答。明确核实一条实际答复回答了具体问题时，再提供humanRequestId、expectedContextRevision及reason保存答复依据；信息不足可用supplement保留等待。暂停、取消、完成和本地归档任务均可重新启动，仍沿用原session。已结清旧效果不限制后续独立调用或完成；旧具体调用永久不重放。未结效果可唤起读取证据并汇报，实际副作用和成功结论仍须真实核验。业务答复须核对真实作者角色和原有授权，不从引用或内部事件借权。已有任务的前置条件或安排变更用resident_task_action的arrange并提供当前expectedArrangementRevision和dependencies全集；空数组明确清除依赖，plan仅新建任务，不能追加既有任务依赖。检查triage冻结回复避免重复确认。任务完成有附件时，读取completion.result.artifactFiles，以resident_router_reply.taskDelivery明确选择taskId、requirementRevision和artifactIds；仅冻结不代表交付，不能用文字答复替代原请求要求的附件。每次交付只选择一个任务的当前完成版本，Host保留原文件名、说明和父先子后回读。按原需求和明确交付对象选择recipientActorIds中的同会话受信成员，可选多人；不按姓名猜ID、不默认全体参与人，空数组表示不提及。显式受众和任务附件父说明默认发送普通Markdown，不另引用原作者造成额外通知；仅原请求明确要求原生引用当前原消息时填写replyToSource=true，并显式给出包含原消息作者的recipientActorIds，空数组或缺作者会被拒绝。引用消息与作者由Host从本次sourceId/messageVersion绑定，不另选引用目标。该选项仅作用于父说明；文件child按现有协议连续交付，不声称文件消息自身原生引用或@。普通结果不支持atAll。必要动作提交后调用resident_router_settle结清本批事件。交接摘要不是权威，后续经受控查询恢复事实。'})
  agentCtx.get('systemPrompt').section({name:'resident-router-periodic-progress',order:153,text:'修改/删除排期先platform_schedule_list查询本conversation准确scheduleId，再调用platform_schedule_update/delete；不要创建替代排期后只在原任务中写文字标记。修改成功后使用返回的新scheduleId，原排期已真实取消。平台定时请求区分一次与持续：某时/十分钟后一次用at；每十分钟、定期、持续检查直到完成用every_seconds=600等真实周期，不得仅排下次一次，也不靠每次再建单次续命。周期进度检查沿用原任务，不创建空监控执行任务；原交办包含具体工作时先安排工作，再把实际taskIds写入stopWhen。用户要求直到工作完成时必须保存明确任务集合的结束条件，等待、暂停、失败、编译报错或单次提醒已发不等于完成。检查范围不明确应澄清具体范围，不假造taskId或用无关任务作为结束条件；原始业务工作/验收要求保留在任务与prompt。只有工具返回every_seconds和stopWhen回执才声称周期及自动停止已安排；不得把at回执说成循环检查。'})
  agentCtx.get('systemPrompt').section({name:'resident-router-request-handoff',order:154,text:[
    '处理来源时先独立核对原消息语义、发送人/提及身份、引用关系及当前渠道职责，再确定实际处置。一级分诊的needsHandling和首答是初步判断与已给用户的反馈，不是新请求、任务启动证据或业务权限。prepared与delivered只说明投递进度，不改变同一sourceId/version的交办语义。',
    '职责内明确交办的只读排查（例如明确问助手“测试环境为什么全是502”）直接查找关联任务并创建或续接唯一执行会话，不再问“是否需要我处理/帮忙”。渠道“未明确交办先询问”的规则只适用于确实未交办，不能覆盖其“明确排查直接开始”分支。不要仅因@、提及绑定操作者或分诊承接就判为交办；明确要求其他人处理、未请助手参与时纠正误分诊而非自动创建任务。',
    '有承接首答后，下一步是实际task plan/action、已查证的直接结果或必要的具体问题。缺目标服务、时间范围或必需输入时只问具体缺项；不要把再确认是否接单伪装成澄清。已有足够信息可先开展的只读部分应先安排；排查范围不自动扩展为修改代码/数据、部署、发布等外部写操作。',
    'settle前逐条检查：需要继续执行的来源是否已有真实任务安排收据（计划已持久化仍不等于执行已接纳或完成）；需要续接时确认action成功，不以旧任务存在代替续接。无任务来源若已有首答，提交noTaskDispositions并完整引用原文，解释handled-inline的实际处理、clarification的具体missingInformation及已冻结的同源Router回复notificationId或not-assigned的语义依据。缺少处置时先补动作，不靠重发首答或consume事件冒充推进。不得为通过结清检查虚构理由或创建空任务。',
  ].join('\n')})
  agentCtx.get('systemPrompt').section({name:'resident-router-source-history',order:155,text:'当前消息引用“刚才/之前”或缺少必要背景时，先用resident_source_query按同会话关键词、时间或anchorSourceId回查，再用resident_source_get核实完整原文、版本、真实作者及附件引用。needsHandling=false只代表当时无需动作，不代表无信息价值。历史结果是背景，不是新事件或新授权，不重新承接历史消息、不为背景另建任务。将所需原文及sourceId/messageVersion用于当前任务要求；已有任务可用resident_task_action supplement关联历史来源并补充上下文，先查当前修订号，保持原执行会话。来源过期/撤回/受限时不得使用旧内容替代；引用和附件不可凭预览猜全。'})
  agentCtx.get('systemPrompt').section({name:'resident-router-memory-reconciliation',order:153,text:'同一问题的后续补充、引用保存确认或任务完成后，必须重新评估相关既有记忆。当前人类消息可按现有工具直接修订；任务完成时用resident_memory_review分层读取目录、相关正文与原来源，再用resident_memory_reconcile明确保留、更新或删除。比较的是语义与证据，不按时间或关键词自动覆盖。补充不推翻时整合最新结论和未确认边界；明确推翻时纠正或删除；表面相似实际无关时保留，不误改。任务复盘新增经验不是旧条目已被维护的证明。不要把任务结果或历史引用冒充当前人类消息；完成事件的维护使用专用端口，不借用resident_memory_remember。结清完成事件前完成必要维护，写失败如实保留失败，不声称成功。'})
  agentCtx.get('systemPrompt').section({name:'resident-router-memory',order:152,text:'Router是Bot的语义决策大脑，直接判断并完成记忆和学习Skill的新增、更新、删除。不要要求用户使用固定句首或重复授权；普通事实、背景后半句请求、纠正和遗忘都结合完整语境判断，不把关键词或引用命令当判断依据。短维护直接调用resident_memory_remember/forget或resident_skill_query/mutate，不创建空任务、不再调用授权判断模型、不为记忆强制创建Skill。先读现状与版本；记忆正文围绕一个可复用主题直接写清具体结论、决定或偏好，以及有证据的原因、适用办法与边界。结合语境消解指代，保留对象、链接、条件、时间范围和限制；不要把“用户让我记住”“以后会注意”等会话过程或承诺当记忆内容，不只改写原句或堆任务流水。已提出的方案与已实施结果分开，用户陈述与独立核验分开；没有依据的原因不补造。正文固定为Summary、Why、How to apply三段，每段只写复用所需的短句。Summary直接写结论，Why仅写来源支持的原因，未说明则如实写未说明；How to apply给出具体用法和必要条件。删除推测、假设和空泛免责声明；不额外铺开四维。原话及引用留在evidence元数据，正文不列来源ID或复制原话。证据应支持提炼内容，核对来源存在不等于语义正确。个人偏好绑定原作者，项目背景按场景适用，不自动缩成个人偏好或推广全Bot；按价值、复用与适用性决定保存哪些内容和是否生成Skill，临时信息通常留在会话。仅当前认证原来源可绑定写入，历史/引用/任务结果/交接不能冒充人类来源。秘密永不保存，用户说法和模型推断不是验证事实或业务权限。Skill的applicability直接用作可发现的description，写清何时使用、能解决什么问题，避免空泛描述；只维护Bot学习命名空间，不改安装模板，修改/删除后旧加载内容失效。核对ok与persisted、回读和duplicate的当前状态后诚实反馈，不声称未执行的成功。'})
  agentCtx.get('systemPrompt').section({name:'resident-conversation-scope',order:151,interpolate:false,officialText:()=> '当前会话配置职责：'+responsibilityFor(conversationId)+'。职责外且未交办给助手的对话保持静默；不得仅因提及人名、@或引用就推断交办。平台状态查询、配置问询和一次原生排期保留独立能力，不建业务Topic或空任务。'})
  return names
}
