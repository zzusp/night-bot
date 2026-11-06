import {randomUUID,createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {scopeOf} from '../native-scope.js'
import {TRIAGE_BATCH_LIMIT,triageParameters,validateTriageDecision} from './triage.js'
import {sessionWorkspace} from '../../packages/dingtalk-core/session-workspaces.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const output={schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]}
export const residentOperationId=(conversationId,key)=>'router-operation:'+createHash('sha256').update(JSON.stringify([conversationId,key])).digest('hex')

/** A short official Pi turn, with no task tools or long-history reads. */
export function createChannelTriage({ctx,root,models,legacy,commit}){
  const handles=new Set(),entries=new Map()
  let closed=false
  async function run(conversationId,messages){
    if(closed)fail('TRIAGE_CLOSED')
    if(!messages.length||messages.length>TRIAGE_BATCH_LIMIT)fail('TRIAGE_BATCH_LIMIT')
    const sessionId='session-triage-'+randomUUID(),snapshot=structuredClone(messages),entry={messages:snapshot,packets:new Map(),sealed:false,superseded:false}
    entries.set(conversationId,entry)
    const packet=()=>{const value={id:'triage:'+randomUUID(),source:{kind:'channel-triage',conversationId},content:[{type:'text',text:'一级分诊请求：'+JSON.stringify({conversationId,messages:snapshot})}]};entry.packets.set(value.id,value);return value}
    entry.packet=packet
    let submitted=false,handle
    try{
      handle=await ctx.get('agents').create({sessionId,agentOptions:typeof models==='function'?models():models,
        meta:{cwd:await sessionWorkspace(root,'route'),runtimeOwner:'channel-triage',agentPreset:legacy.getAgentConfig().agentPreset},
        authorizeInput:(candidate,actor)=>actor.id===sessionId&&!closed&&!entry.superseded&&isDeepStrictEqual(candidate,entry.packets.get(candidate.id)),
        beforeRequest:()=>{if(closed||submitted||entry.superseded)fail('TRIAGE_INACTIVE')},
        setup:async(agentCtx,agent)=>{
          await agentCtx.get('agentPresets').mount(agentCtx,legacy.getAgentConfig().agentPreset)
          agentCtx.get('tools').register({name:'channel_triage_submit',description:'按原消息逐条提交是否需要Router处理及可选简短回复；完整覆盖本批，不拆事项、不创建或安排任务。',parameters:triageParameters,output,
            execute:async(input,exec)=>{
              if(exec.agent!==agent||closed||entry.superseded)fail('TRIAGE_WRONG_SESSION')
              const decision=validateTriageDecision(snapshot,input)
              entry.sealed=true
              try{const result=await commit(conversationId,decision,snapshot);submitted=true;exec.concludeTurn();return result}
              catch(error){entry.sealed=false;throw error}
            }})
          agentCtx.get('tools').restrict({allow:[]})
          agentCtx.get('tools').guard(exec=>exec.name==='channel_triage_submit'?undefined:'TRIAGE_TOOL_FORBIDDEN')
          agentCtx.get('systemPrompt').section({name:'channel-triage',order:150,text:'你是轻量一级分诊，只依据当前批次原消息、已附带引用/提及和可快速获得的信息判断needsHandling与可选reply。需要深入理解、查询、执行、补充、调整或取消的原消息交Router；不拆分事项，不匹配taskId，不决定任务控制，不承诺未执行的结果。无需处理且无需回复时needsHandling=false且省略reply，保持静默；简单问候可短答，不强制使用暂定前缀；需处理也可省略reply。调用channel_triage_submit完整覆盖本批≤15条来源版本。自然语言不会发送，缺少事实不等于无需处理。'})
        }})
      handles.add(handle);entry.handle=handle
      if(entry.superseded)return
      const initial=packet()
      try{await handle.enqueue(initial);await handle.deliver(initial.id);await handle.whenIdle()}
      catch(error){if(!entry.superseded)throw error}
      if(!submitted&&!entry.superseded)fail('TRIAGE_NO_DISPOSITION')
    }finally{
      try{await entry.cancellation}finally{if(handle){await handle.dispose();handles.delete(handle)}if(entries.get(conversationId)===entry)entries.delete(conversationId)}
    }
  }
  async function append(conversationId,messages){
    const entry=entries.get(conversationId)
    if(!entry||closed||entry.superseded)return false
    if(messages.some(source=>entry.messages.some(old=>old.messageId===source.messageId&&old.version<source.version))){
      // 新版本已可靠入队；排空旧快照后由 Host 重新读取当前批次。
      entry.superseded=true
      if(entry.handle)await (entry.cancellation=entry.handle.cancel({kind:'source-version-superseded'}))
      return true
    }
    if(entry.sealed)return false
    const added=messages.filter(source=>!entry.messages.some(old=>old.sourceId===source.sourceId)).slice(0,TRIAGE_BATCH_LIMIT-entry.messages.length)
    if(!added.length)return false
    entry.messages.push(...structuredClone(added))
    if(entry.handle){const packet=entry.packet();await entry.handle.enqueue(packet);await entry.handle.deliver(packet.id,{deliverAs:'steer'})}
    return true
  }
  return {run,append,async close(){closed=true;const results=await Promise.allSettled([...handles].map(handle=>handle.dispose()));const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);if(errors.length)throw new AggregateError(errors,'Triage drain failed')}}
}

/** Router has business capabilities, never arbitrary process or external-write tools. */
export function registerResidentRouterTools(agentCtx,binding,{query,command,applyTaskAction,prepareReply,platformQuery,platformSchedule,platformConfig}){
  const {conversationId,generation}=binding
  const current=async exec=>{
    const state=await query('router.get',{conversationId})
    if(exec.agent.id!==binding.sessionId||state?.generation!==generation||state.phase!=='active')fail('ROUTER_GENERATION_STALE')
  }
  const source=async(sourceId,messageVersion)=>{
    const value=await query('source.get',{sourceId})
    if(!value||value.groupId!==conversationId||value.version!==messageVersion||value.channel==='internal')fail('ROUTER_SOURCE_FORBIDDEN')
    const all=await query('source.list',{groupId:conversationId})
    if(all.some(item=>item.messageId===value.messageId&&item.version>value.version))fail('ROUTER_SOURCE_STALE')
    return value
  }
  const string={type:'string'},integer={type:'integer',minimum:1},strings={type:'array',items:string}
  const identity={operationId:string,sourceId:string,messageVersion:integer}
  const tools=[
    {name:'resident_task_query',description:'读取当前conversation的事项、版本、证据与依赖，不跨群。',parameters:{type:'object',additionalProperties:false,properties:{taskId:string,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}},execute:async(args)=>{
      if(args.taskId){const task=await query('task.get',{taskId:args.taskId});if(!task||task.groupId!==conversationId)fail('ROUTER_TASK_FORBIDDEN');return {task,dependencies:await query('router.dependencies',{conversationId,taskId:args.taskId})}}
      const tasks=await query('task.list',{groupId:conversationId,archived:'all'}),offset=args.offset??0,limit=args.limit??50
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('ROUTER_TASK_PAGE_INVALID')
      return {tasks:tasks.slice(offset,offset+limit),total:tasks.length,hasMore:offset+limit<tasks.length,nextOffset:Math.min(offset+limit,tasks.length)}
    }},
    {name:'resident_source_get',description:'回查当前conversation的完整原文、引用、附件引用和真实作者。',parameters:{type:'object',additionalProperties:false,required:['sourceId'],properties:{sourceId:string}},execute:async args=>{const value=await query('source.get',args);if(!value||value.groupId!==conversationId)fail('ROUTER_SOURCE_FORBIDDEN');return value}},
    {name:'resident_task_plan',description:'依据当前真实授权来源原子创建事项及先后依赖。B在依赖评估满足前不可执行。operationId使用稳定来源动作键。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','tasks','dependencies'],properties:{...identity,tasks:{type:'array',minItems:1,maxItems:15,items:{type:'object',additionalProperties:false,required:['taskId','title','objective','requirements'],properties:{taskId:string,title:string,objective:string,request:string,requirements:strings,quote:string}}},dependencies:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['taskId','prerequisiteTaskId','condition'],properties:{taskId:string,prerequisiteTaskId:string,condition:string}}}}},execute:async args=>{
      const original=await source(args.sourceId,args.messageVersion)
      const tasks=args.tasks.map(task=>{if(task.quote&&!original.text.includes(task.quote))fail('ROUTER_SOURCE_QUOTE_INVALID');return {...task,groupId:conversationId,ownerActorId:original.actorId,sourceRefs:[original.sourceId],request:task.request??original.text,metadata:{authorizationSourceId:original.sourceId,...(()=>{const context=agentCtx.get('channels').groupContext(conversationId);return context?{channelType:context.type,memoryGroupId:context.memoryGroupId}:{}})()}}})
      const result=await command('router.plan',{conversationId,generation,...args,tasks,operationId:residentOperationId(conversationId,args.operationId)})
      await applyTaskAction({kind:'materialize',tasks:result.result?.tasks??tasks,source:original});return result
    }},
    {name:'resident_task_action',description:'补充原唯一执行会话，或按来源权限和当前版本修订、重开、暂停、恢复、取消；arrange须expectedArrangementRevision及dependencies全集（[]清空）。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','kind','taskId','expectedRequirementRevision','expectedControlRevision'],properties:{...identity,kind:{enum:['supplement','revise','reopen','control','arrange']},taskId:string,expectedRequirementRevision:integer,expectedControlRevision:integer,text:string,objective:string,title:string,requirements:strings,sameGoal:{type:'boolean'},expectedArrangementRevision:integer,dependencies:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['prerequisiteTaskId','condition'],properties:{prerequisiteTaskId:string,condition:string}}},control:{enum:['active','paused','cancelled']},reason:string}},execute:async args=>{const original=await source(args.sourceId,args.messageVersion);return applyTaskAction({...args,conversationId,generation,operationId:residentOperationId(conversationId,args.operationId),source:original})}},
    {name:'resident_dependency_evaluate',description:'核对当前完成事件、验收与证据后评估依赖。只有satisfied且当前权限/版本有效才释放后续；continue/wait保持阻塞。',parameters:{type:'object',additionalProperties:false,required:['operationId','dependencyId','completionEventId','prerequisiteRequirementRevision','requirementRevision','controlRevision','arrangementRevision','decision','evidence'],properties:{operationId:string,dependencyId:string,completionEventId:string,prerequisiteRequirementRevision:integer,requirementRevision:integer,controlRevision:integer,arrangementRevision:integer,decision:{enum:['satisfied','continue','wait']},evidence:strings}},execute:args=>command('router.evaluate',{conversationId,generation,...args,operationId:residentOperationId(conversationId,args.operationId)})},
    {name:'resident_router_reply',description:'冻结并可靠发送澄清、进度或结果；任务附件须先query核对完成证据，再用taskDelivery显式选择该任务当前版本的已冻结artifactIds。可用atOpenDingTalkIds显式选择同会话受信成员，空数组不提及；不按姓名猜ID，不默认通知所有参与人。冻结或接纳不代表送达；先检查分诊已回复内容，避免重复确认。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','text'],properties:{...identity,text:{type:'string',minLength:1,maxLength:8000},atOpenDingTalkIds:{type:'array',items:{type:'string',minLength:1}},taskDelivery:{type:'object',additionalProperties:false,required:['taskId','requirementRevision','artifactIds'],properties:{taskId:string,requirementRevision:integer,artifactIds:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}}},execute:async args=>{const original=await source(args.sourceId,args.messageVersion);return prepareReply({...args,source:original,conversationId,generation,outboundId:residentOperationId(conversationId,args.operationId)})}},
    {name:'resident_router_settle',description:'本批必要动作已有持久收据后结清原消息/内部事件，不表示任务完成或通知送达。',parameters:{type:'object',additionalProperties:false,required:['eventIds','operationId'],properties:{eventIds:{type:'array',minItems:1,maxItems:30,items:string},operationId:string}},execute:async args=>command('router.settle',{conversationId,generation,...args,operationId:residentOperationId(conversationId,args.operationId)})},
    {name:'platform_task_query',description:'只读本conversation真实事项，按声明时区分页查询状态与日期，不创建空业务任务。',parameters:{type:'object',additionalProperties:false,properties:{state:{enum:['running','completed','all']},day:string,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}},execute:args=>platformQuery(conversationId,args)},
    {name:'platform_config_query',description:'只读当前会话职责、时区、模型与并发配置；不返回密钥、路径或其它会话配置，修改仍走已认证管理入口。',parameters:{type:'object',additionalProperties:false,properties:{}},execute:()=>platformConfig(conversationId)},
    {name:'platform_schedule_submit',description:'按原来源授权创建一次未来平台事项，at须带时区偏移；过期不改排明天，返回scheduled后才确认安排。',parameters:{type:'object',additionalProperties:false,required:['operationId','sourceId','messageVersion','title','prompt','at'],properties:{...identity,title:{type:'string',minLength:1,maxLength:120},prompt:{type:'string',minLength:1,maxLength:8000},at:string}},execute:async args=>{const original=await source(args.sourceId,args.messageVersion);return platformSchedule({...args,source:original,conversationId,requestId:residentOperationId(conversationId,args.operationId)})}},
  ]
  for(const tool of tools){const execute=tool.execute;agentCtx.get('tools').register({...tool,output,execute:async(args,exec)=>{await current(exec);return execute(args,exec)}})}
  const names=[...tools.map(tool=>tool.name),...['skill','memory_read','memory_search','memory_status'].filter(name=>agentCtx.get('tools').get(name))]
  agentCtx.get('tools').restrict({allow:names.filter(name=>agentCtx.get('tools').view(scopeOf(agentCtx)).restrictableNames.has(name))})
  agentCtx.get('tools').guard(exec=>names.includes(exec.name)?undefined:'ROUTER_TOOL_FORBIDDEN')
  agentCtx.get('systemPrompt').section({name:'resident-router',order:150,text:'你是该conversation的常驻Router，负责理解真实来源、关联或拆分事项、安排调整并核验执行结果。每事项只有一个执行会话，没有Owner或执行团队。不得运行业务脚本或外部写操作；经受控事项动作由唯一执行会话完成。原消息真实发送人及版本是授权依据，引用/摘要/任务完成不能创造授权。先查原任务避免重复新建；问候、平台查询和定时汇报不建空业务任务。先A后B必须原子保存依赖；A完成后核对验收、当前版本、结果、证据与限制再评估，不能见completed自动释放B。用户取消/修订及时处理，补充保留原执行会话，改目标需排空旧执行。已有任务的前置条件或安排变更用resident_task_action的arrange并提供当前expectedArrangementRevision和dependencies全集；空数组明确清除依赖，plan仅新建任务，不能追加既有任务依赖。检查triage冻结回复避免重复确认。任务完成有附件时，读取completion.result.artifactFiles，以resident_router_reply.taskDelivery明确选择taskId、requirementRevision和artifactIds；仅冻结不代表交付，不能用文字答复替代原请求要求的附件。每次交付只选择一个任务的当前完成版本，Host保留原文件名、说明和父先子后回读。按原需求和明确交付对象选择atOpenDingTalkIds中的同会话受信成员，可选多人；不按姓名猜ID、不默认全体参与人，空数组表示不提及。显式受众发送普通Markdown，不另引用原作者造成额外通知；普通结果不支持atAll。必要动作提交后调用resident_router_settle结清本批事件。交接摘要不是权威，后续经受控查询恢复事实。'})
  agentCtx.get('systemPrompt').section({name:'resident-conversation-scope',order:151,text:'当前会话配置职责：'+(binding.responsibility??'')+'。职责外且未交办给助手的对话保持静默；不得仅因提及人名、@或引用就推断交办。平台状态查询、配置问询和一次原生排期保留独立能力，不建业务Topic或空任务。'})
  return names
}
