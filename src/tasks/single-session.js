import {groupReplyScopeInstructions} from '../../packages/dingtalk-core/group-message.js'
import {preflightNativeFileMutation} from '../native-tool-fs.js'
import {unresolvedNativeJobReceipts,isJobOutcomeUncertain,jobReceiptKinds} from '../runtime/job-ledger.js'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {taskAuditKinds,validateTaskIdentity} from './session-audit.js'
const fail=code=>Object.assign(new Error(code),{code})
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex')
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const key=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export const singleTaskAuditKinds=Object.freeze({...taskAuditKinds,...jobReceiptKinds,
  'task/effect-intent':value=>exact(value,['key','name','callId'])&&key(value.key)&&typeof value.name==='string'&&value.name.length>0&&typeof value.callId==='string'&&value.callId.length>0,
  'task/effect-result':value=>exact(value,['key','isError'])&&key(value.key)&&typeof value.isError==='boolean',
})
const observational=new Set(['read','read_image','glob','grep','skill','web_search','web_fetch','memory_read','memory_search','memory_status','memory_candidates','job_output','job_list','task_result'])
const instructions='You are the sole execution session for this task. Directly use the available tools to complete the current authorized objective. There is no task coordinator, delegation or child execution session. Do not create another agent. Write process files and artifacts in work/ under this task workspace; tmp/ is temporary. materials/, outputs/, sessions/, reviews/ and task metadata are Host-owned, not writable. Report work/ artifact paths; the Host freezes selected delivery files into outputs/. Current user requirements and permissions prevail over memory and learned skills. Read current evidence, avoid unnecessary detours and never replay an already attempted effect. Unknown effects require reconciliation; do not claim success. Submit task_result with verified summary/evidence/limitations; use wait with a specific question when required information or authority is missing. Task completion does not depend on notification delivery or the separate tool-free retrospective. Do not send channel messages yourself.'
function effectState(receipts){
  const intents=new Map()
  for(const receipt of receipts){
    if(receipt.domain!=='task'||!['effect-intent','effect-result'].includes(receipt.kind))continue
    if(receipt.version!==1||!singleTaskAuditKinds['task/'+receipt.kind](receipt.payload))throw fail('TASK_EFFECT_AUDIT_INVALID')
    const data=receipt.payload
    if(receipt.kind==='effect-intent'){
      if(intents.has(data.key))throw fail('TASK_EFFECT_AUDIT_INVALID')
      intents.set(data.key,{...data,settled:false})
    }else{
      const intent=intents.get(data.key)
      if(!intent||intent.settled)throw fail('TASK_EFFECT_AUDIT_INVALID')
      // An error does not establish absence of external effects.
      if(data.isError===false)intent.settled=true
    }
  }
  return intents
}
/** One task owns one official AgentSession. These receipts are business effect
 * and admission facts; Pi alone owns messages, queue delivery and model context. */
export function createSingleTaskSessions({ctx,isCurrent,getWorkspaceDir,withPersistenceWriter=(_binding,action)=>action()}){
  const active=new Map();let closed=false
  async function run({binding,input,provider,model,reasoningEffort,onSessionBound,resolveHuman,submit}){
    if(closed||active.has(binding.taskId))throw fail('TASK_SESSION_BUSY')
    const entry={abort:new AbortController(),done:Promise.withResolvers(),submitted:false};active.set(binding.taskId,entry)
    const current=()=>!closed&&!entry.abort.signal.aborted&&isCurrent(binding)
    const readOnly=!!(input.humanReview||input.dialogue)
    try{
      const cwd=await getWorkspaceDir({binding});let stored
      try{stored=await ctx.sessionPersistence.readNative(binding.sessionId,{requireComplete:true,signal:entry.abort.signal})}catch(error){if(error.name!=='SessionPersistenceNotFoundError'||error.sessionId!==binding.sessionId)throw error}
      if(binding.sessionBound&&!stored)throw fail('TASK_SESSION_MISSING')
      if(stored){
        const identity=stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='identity')
        if(stored.header.cwd!==cwd||identity.length!==1||identity[0].version!==1||!validateTaskIdentity(identity[0].payload)
          ||identity[0].payload.taskId!==binding.taskId||identity[0].payload.sessionId!==binding.sessionId)throw fail('TASK_SESSION_IDENTITY_MISMATCH')
      }
      const intents=effectState(stored?.audit??[]),uncertain=()=>[...intents.values()].some(value=>!value.settled)
      entry.effectUncertain=uncertain
      if(unresolvedNativeJobReceipts(stored?.audit??[],binding.sessionId).length)return {status:'no_submission',reason:'TASK_JOB_UNCERTAIN_NO_REPLAY'}
      if(uncertain())return {status:'no_submission',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY'}
      const source={kind:'task-input',taskSession:structuredClone(binding)},content=[{type:'text',text:JSON.stringify({task:input.task,sources:input.sources,materials:input.materials,dialogue:input.dialogue,humanReview:input.humanReview,blockers:input.blockers})}]
      const packet={id:'task-input:'+fingerprint({taskId:binding.taskId,sessionId:binding.sessionId,requirementRevision:binding.requirementRevision,contextRevision:binding.contextRevision??0,controlRevision:binding.controlRevision,leaseEpoch:binding.leaseEpoch}),source,content}
      const setup=async(agentCtx,actor)=>{
        await ctx.get('agentPresets').mount(agentCtx,'night-bot-task')
        const tools=agentCtx.get('tools'),systemPrompt=agentCtx.get('systemPrompt')
        const denied=tools.schemas(actor).map(tool=>tool.name).filter(name=>/^(?:subagent|task_delegate|task_execution|agent_create|schedule_create|schedule_update)/.test(name))
        if(denied.length)tools.restrict({deny:denied})
        systemPrompt.section({name:'task:single-execution',order:0,text:instructions})
        systemPrompt.section({name:'task:reply-scope',order:1,text:groupReplyScopeInstructions})
        if(input.humanReview)systemPrompt.section({name:'task:human-review',order:1,text:'本轮只读核对人工业务答复。读取原待答问题、候选来源的完整原文和引用，核对真实作者的业务角色、权限、对应事项和全部限制；模型摘要与推断不是授权。事实追问使用 task_result(wait, replySourceId)，以 summary/evidence/limitations 记录事实，保持原问题待答，不为回复事实追问解除实施限制。只有真实来源已回答同一问题、角色与条件证据齐备时，才用 task_human_resolve 记录原答复；SQL再次核验来源及版本。解除成功后本轮仍保持只读并以无新问题的 wait 结束，由下一普通轮在原有授权范围继续。不得在本轮执行写入、命令、记忆写入、委派、扩大目标或完成任务。'})
        if(input.dialogue)systemPrompt.section({name:'task:dialogue',order:1,text:'本轮仅只读回答当前任务对话。以 task_result 的 wait 和 summary 给出基于已有证据的答复，不执行外部效果，不创建新问题，不完成或扩大原任务。'})
        const reviewTool=name=>observational.has(name)||!!input.humanReview&&name==='task_human_resolve'
        if(readOnly)tools.guard(exec=>reviewTool(exec.name)?undefined:input.humanReview?'DYNAMIC_HUMAN_REVIEW_READ_ONLY':'TASK_DIALOGUE_REPLY_ONLY')
        agentCtx.on('tools/pre-execute',async(exec,next)=>!await current()?{kind:'deny',reason:'TASK_SESSION_STALE'}:uncertain()?{kind:'deny',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY'}:readOnly&&!reviewTool(exec.name)?{kind:'deny',reason:input.humanReview?'DYNAMIC_HUMAN_REVIEW_READ_ONLY':'TASK_DIALOGUE_REPLY_ONLY'}:next())
        agentCtx.on('tools/execute',async(exec,next)=>{
          if(observational.has(exec.name)||input.humanReview&&exec.name==='task_human_resolve')return next()
          if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          await preflightNativeFileMutation(exec,tools.get(exec.name,actor))
          const effectKey=fingerprint({requirementRevision:binding.requirementRevision,contextRevision:binding.contextRevision??0,controlRevision:binding.controlRevision,name:exec.name,args:exec.arguments})
          if(intents.has(effectKey))return {isError:true,content:[{type:'text',text:'TASK_EFFECT_ALREADY_ATTEMPTED: inspect original evidence; do not replay.'}],error:{message:'TASK_EFFECT_ALREADY_ATTEMPTED'}}
          const intent={key:effectKey,name:exec.name,callId:exec.callId}
          actor.receipts.append({version:1,domain:'task',kind:'effect-intent',payload:intent});intents.set(effectKey,{...intent,settled:false});await actor.receipts.commit()
          const result=await next()
          // Even an ordinary body error can follow an external write. Hold it
          // for reconciliation; neither Pi retry nor a new claim may repeat it.
          if(exec.signal.aborted||result.isError||isJobOutcomeUncertain(result)||['ABORTED','TOOL_OUTCOME_UNKNOWN'].includes(result.error?.info?.code))throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          actor.receipts.append({version:1,domain:'task',kind:'effect-result',payload:{key:effectKey,isError:false}});await actor.receipts.commit();intents.get(effectKey).settled=true
          return result
        })
        if(input.humanReview)tools.register({name:'task_human_resolve',description:'Record that this review’s real candidate source has answered the pending business question. Read the original question, complete reply, author role and all conditions first. This changes only the reviewed business record; the current run remains read-only and must end with task_result(wait).',parameters:{type:'object',properties:{requestId:{type:'string',minLength:1},sourceId:{type:'string',minLength:1},reason:{type:'string',minLength:1},evidence:{type:'array',minItems:1,items:{type:'string',minLength:1}}},required:['requestId','sourceId','reason','evidence'],additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args){
          if(!await current())throw fail('TASK_SESSION_STALE')
          if(args.requestId!==input.humanReview.requestId||!input.humanReview.sourceIds?.includes(args.sourceId)||!input.sources?.some(source=>source.sourceId===args.sourceId))throw fail('DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID')
          if(!args.reason.trim()||!args.evidence.length||args.evidence.some(item=>!item.trim()))throw fail('DYNAMIC_ARGUMENT_INVALID')
          if(typeof resolveHuman!=='function')throw fail('TASK_HUMAN_RESOLUTION_UNAVAILABLE')
          return resolveHuman(args,binding)
        }})
        tools.register({name:'task_result',description:'Commit this single task execution result, or wait for a specific missing input. This concludes the turn.',parameters:{type:'object',required:['decision'],additionalProperties:false,properties:{decision:{type:'object',properties:{action:{type:'string',enum:['complete','wait','blocked']},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}},limitations:{type:'array',items:{type:'string'}},artifacts:{type:'array',items:{type:'string'}},deliveryFiles:{type:'array',items:{type:'object',properties:{path:{type:'string'},caption:{type:'string'}},required:['path'],additionalProperties:false}},question:{type:'string'},audience:{type:'string',enum:['topic','operator','requester']},replySourceId:{type:'string',minLength:1,description:'Only humanReview: the current candidate source for a factual follow-up; wait with read evidence, keep the original question pending.'},attemptedActions:{type:'array',items:{type:'string'}}},required:['action','summary','evidence','limitations'],additionalProperties:false}}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute({decision},exec){
          if(!await current())throw fail('TASK_SESSION_STALE')
          if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          if(!decision.summary.trim())throw fail('TASK_SESSION_DECISION_INVALID')
          if(input.humanReview&&(decision.action!=='wait'||decision.question?.trim()))throw fail('DYNAMIC_HUMAN_REVIEW_READ_ONLY')
          if(input.dialogue&&(decision.action!=='wait'||decision.question?.trim()))throw fail('TASK_DIALOGUE_REPLY_ONLY')
          if(decision.replySourceId!==undefined&&(!input.humanReview||decision.action!=='wait'||!input.humanReview.sourceIds?.includes(decision.replySourceId)||!decision.evidence.some(item=>item.trim())))throw fail('DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID')
          if(decision.action==='blocked'&&!decision.question?.trim())throw fail('TASK_QUESTION_REQUIRED')
          const jobs=ctx.get('jobs')
          if(typeof jobs?.list!=='function')throw fail('TASK_JOB_DRAIN_UNPROVEN')
          if(decision.action==='complete'&&(jobs.list(actor.id).some(job=>['running','stopping'].includes(job.status))||unresolvedNativeJobReceipts(await actor.receipts.read(),actor.id).length))throw fail('TASK_NOT_QUIESCENT')
          const result=await submit(decision,binding);entry.submitted=true;exec.concludeTurn();return {received:true,...result}
        }})
      }
      const options={agentOptions:{provider,model,...reasoningEffort?{reasoningEffort}:{}},setup,signal:entry.abort.signal,auditKinds:singleTaskAuditKinds,readOnly,
        initialReceipts:stored?[]:[{version:1,domain:'task',kind:'identity',payload:{taskId:binding.taskId,sessionId:binding.sessionId}}],
        authorizeInput:async(candidate,actor)=>actor.id===binding.sessionId&&await current()&&isDeepStrictEqual(candidate,packet),
        beforeRequest:async()=>{if(entry.submitted)throw fail('TASK_RESULT_ALREADY_COMMITTED');if(!await current())throw fail('TASK_SESSION_STALE');if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')},
        drainBusiness:async actor=>{const jobs=ctx.get('jobs');if(typeof jobs?.drainOwner!=='function')throw fail('TASK_JOB_DRAIN_UNPROVEN');await jobs.drainOwner(actor,{reason:'single task execution ended'})},
      }
      entry.handle=await withPersistenceWriter(binding,()=>stored?ctx.agents.resume({...options,resumeSessionId:binding.sessionId}):ctx.agents.create({...options,sessionId:binding.sessionId,meta:{cwd,agentPreset:'night-bot-task'}}))
      await entry.handle.agent.receipts.commit();await onSessionBound(binding)
      if(!await current())return {status:'stale'}
      await entry.handle.agent.input.enqueue(packet)
      await entry.handle.agent.input.deliver(packet.id,{deliverAs:'followUp'})
      await entry.handle.agent.whenIdle()
      if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
      if(!entry.submitted&&await current())throw Object.assign(fail('TASK_SESSION_NO_SUBMISSION'),{phase:'decision'})
      return {status:entry.submitted?'submitted':'cancelled'}
    }catch(cause){
      entry.outcomeError=cause
      if(entry.effectUncertain?.())return {status:'no_submission',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY',effectDisposition:'held',failure:{code:cause.code??'TASK_EFFECT_UNCERTAIN_NO_REPLAY',message:cause.message}}
      throw cause
    }finally{
      let idleOutcome;const drainErrors=[]
      try{
        if(entry.handle){
          // The public SDK can already be physically idle while its application
          // request policy reports a rejection. Preserve that outcome, but do
          // not let it skip the actual producer drain and writer release.
          try{await entry.handle.agent.whenIdle()}catch(cause){idleOutcome=cause}
          try{await entry.handle.agent.receipts.commit()}catch(cause){drainErrors.push(cause)}
          try{await entry.handle.dispose()}catch(cause){drainErrors.push(cause)}
        }
      }finally{
        if(drainErrors.length)entry.drainError=Object.assign(fail('TASK_SESSION_DRAIN_FAILED'),{taskSessionDrained:false,cause:drainErrors.length===1?drainErrors[0]:new AggregateError(drainErrors,'Task receipts or producer drain failed'),...((entry.outcomeError??idleOutcome)?{businessFailure:entry.outcomeError??idleOutcome}:{})})
        else active.delete(binding.taskId)
        entry.done.resolve()
      }
      if(entry.drainError)throw entry.drainError
      if(idleOutcome&&!entry.outcomeError)throw idleOutcome
    }
  }
  async function cancel(taskId){
    const entry=active.get(taskId);if(!entry)return
    entry.abort.abort();let error
    try{await entry.handle?.agent.cancel({kind:'user'})}catch(cause){error=cause}
    await entry.done.promise
    if(entry.drainError)throw entry.drainError
    if(error)throw error
  }
  return {run,cancel,async close(){closed=true;await Promise.all([...active.keys()].map(cancel))}}
}
export const disabledExecutionSessions=()=>({run:async()=>{throw fail('TASK_SPLIT_EXECUTION_REMOVED')},cancel:async()=>{},feedback:async()=>{throw fail('TASK_SPLIT_EXECUTION_REMOVED')},close:async()=>{}})
