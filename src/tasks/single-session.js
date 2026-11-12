import {taskToolInputOrigin,unresolvedTaskInputOrigins,taskEffectIntentOrigin} from './input-origin.js'
import {conversationReplyScopeInstructions,conversationSource} from '../channels/message-safety.js'
import {preflightPiFileMutation,isPiFileObservationalTool,isPiFileMutationNotStarted} from '../pi-file-tool-registration.js'
import {isNativeSearchObservationalTool} from '../native-tool-fs-search.js'
import {unresolvedNativeJobReceipts,isJobOutcomeUncertain,jobReceiptKinds} from '../runtime/job-ledger.js'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {taskAuditKinds,validateTaskIdentity} from './session-audit.js'
import {effectReconciliationAuditKinds,ownerDrainedReceipt,ownerDrainedInputsReceipt,taskEffectScopeDigest,validateTaskEffectIntent,validateTaskEffectResult} from './effect-reconciliation.js'
const fail=code=>Object.assign(new Error(code),{code})
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex')
const taskInputSnapshot=value=>{if(value===undefined)return;const {liveSupplements,...task}=value;return task}
export const singleTaskAuditKinds=Object.freeze({...taskAuditKinds,...jobReceiptKinds,...effectReconciliationAuditKinds,
  'task/effect-intent':validateTaskEffectIntent,
  'task/effect-result':validateTaskEffectResult,
})
const observational=new Set(['read','read_image','read_window','skill','web_search','web_fetch','memory_index','memory_read','memory_search','memory_status','memory_candidates','job_output','job_list','task_result'])
const instructions='You are the sole execution session for this task. Directly use the available tools to complete the current authorized objective. There is no task coordinator, delegation or child execution session. Do not create another agent. Write process files and artifacts in work/ under this task workspace; tmp/ is temporary. materials/, outputs/, sessions/, reviews/ and task metadata are Host-owned, not writable. Report work/ artifact paths; the Host freezes selected delivery files into outputs/. Current user requirements and permissions prevail over memory and learned skills. Read current evidence and avoid unnecessary detours. Never replay a recorded invocation. Independent calls may intentionally use identical arguments when the current authorized objective requires repeated actions. Unknown effects require reconciliation; do not claim success. Submit task_result with verified summary/evidence/limitations; use wait with a specific question when required information or authority is missing. Technical failures, runtime configuration, accounts and environment questions go to audience=operator (the default); only a business question for the original requester uses audience=requester. Do not infer a technical answer from a business reply or forward technical details to the conversation. Task completion does not depend on notification delivery or the separate tool-free retrospective. Do not send channel messages yourself.'
function effectState(receipts){
  const intents=new Map()
  for(const receipt of receipts){
    if(receipt.domain==='task'&&receipt.kind==='effect-reconciled'){
      if(receipt.version!==1||!effectReconciliationAuditKinds['task/effect-reconciled'](receipt.payload))throw fail('TASK_EFFECT_AUDIT_INVALID')
      const intent=intents.get(receipt.payload.key)
      if(!intent||intent.settled||intent.name!==receipt.payload.toolName||intent.callId!==receipt.payload.callId)throw fail('TASK_EFFECT_AUDIT_INVALID')
      intent.settled=true;intent.reconciled=true;intent.argumentsDigest=receipt.payload.argumentsDigest;continue
    }
    if(receipt.domain!=='task'||!['effect-intent','effect-result'].includes(receipt.kind))continue
    if(receipt.version!==1||!singleTaskAuditKinds['task/'+receipt.kind](receipt.payload))throw fail('TASK_EFFECT_AUDIT_INVALID')
    const data=receipt.payload
    if(receipt.kind==='effect-intent'){
      if(intents.has(data.key))throw fail('TASK_EFFECT_AUDIT_INVALID')
      intents.set(data.key,{...data,settled:false})
    }else{
      const intent=intents.get(data.key)
      if(!intent||intent.settled)throw fail('TASK_EFFECT_AUDIT_INVALID')
      // 仅认可受信文件适配器在实际排空后提交的未开始写入证明。
      if(data.effect==='not-started'&&!['write','edit'].includes(intent.name))throw fail('TASK_EFFECT_AUDIT_INVALID')
      if(data.isError===false||data.effect==='not-started')intent.settled=true
    }
  }
  return intents
}
/** One task owns one official AgentSession. These receipts are business effect
 * and admission facts; Pi alone owns messages, queue delivery and model context. */
export function createSingleTaskSessions({ctx,isCurrent,isOwnerCurrent=isCurrent,getWorkspaceDir,readEffectScope,withPersistenceWriter=(_binding,action)=>action()}){
  const active=new Map();let closed=false
  async function run({binding,input,provider,model,reasoningEffort,groupResponsibility,onSessionBound,onSupplementAdmitted,resolveHuman,authorizeEffectInvocation,submit}){
    if(closed||active.has(binding.taskId))throw fail('TASK_SESSION_BUSY')
    const entry={abort:new AbortController(),done:Promise.withResolvers(),submitted:false,binding,pending:new Map(),readOnly:!!(input.humanReview||input.dialogue)};active.set(binding.taskId,entry)
    const current=()=>!closed&&!entry.abort.signal.aborted&&isOwnerCurrent(binding)
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
      const seenInvocations=new Set();let historyBound=false,priorReconciliations=[]
      const bindInvocationHistory=actor=>{
        if(historyBound)return
        const origins=new Map(),manager=actor.piSession.sessionManager
        for(const intent of intents.values()){
          const origin=taskEffectIntentOrigin(manager,intent,binding)
          if(seenInvocations.has(origin.invocationKey))throw fail('TASK_EFFECT_INVOCATION_DUPLICATE')
          seenInvocations.add(origin.invocationKey);origins.set(intent.key,origin)
        }
        priorReconciliations=(stored?.auditEntries??[]).filter(row=>row.data.domain==='task'&&row.data.kind==='effect-reconciled').map(row=>{
          const receipt=row.data,payload=receipt.payload,origin=origins.get(payload.key),entry=manager.getEntries().find(entry=>entry.id===row.entryId)
          if(!origin||!entry||entry.type!=='custom'||entry.customType!=='night.audit'||!isDeepStrictEqual(entry.data,receipt)||!manager.getBranch(entry.id).some(item=>item.id===origin.intentEntryId)||['intentEntryId','intentDigest','callEntryId','inputEntryId','packetId','inputDigest','argumentsDigest'].some(key=>payload[key]!==origin[key])||!isDeepStrictEqual(payload.originBinding,origin.binding))throw fail('TASK_EFFECT_RECONCILIATION_IDENTITY_MISMATCH')
          return {entryId:row.entryId,parentId:row.parentId,receipt:structuredClone(receipt)}
        })
        historyBound=true
      }
      entry.effectUncertain=uncertain
      if(unresolvedNativeJobReceipts(stored?.audit??[],binding.sessionId).length)return {status:'no_submission',reason:'TASK_JOB_UNCERTAIN_NO_REPLAY'}
      if(uncertain())return {status:'no_submission',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY'}
      // SQL processing stages are Host diagnostics, not user text or authority.
      // Keep them in their store/materials rather than copying an ever-growing
      // telemetry graph into every new business input packet.
      const sources=Array.isArray(input.sources)?input.sources.map(({stages,...source})=>conversationSource(source)):input.sources
      const source={kind:'task-input',taskSession:structuredClone(binding)},content=[{type:'text',text:JSON.stringify({task:taskInputSnapshot(input.task),sources,materials:input.materials?.map(conversationSource),dialogue:input.dialogue,humanReview:input.humanReview,blockers:input.blockers})}]
      const packet={id:'task-input:'+fingerprint({taskId:binding.taskId,sessionId:binding.sessionId,requirementRevision:binding.requirementRevision,contextRevision:binding.contextRevision??0,controlRevision:binding.controlRevision,leaseEpoch:binding.leaseEpoch}),source,content}
      const packets=new Map([[packet.id,packet]])
      entry.packets=packets
      const syncAdmissions=actor=>{const operation=(entry.admissionTail??Promise.resolve()).then(async()=>{if(entry.admissionFailure)throw entry.admissionFailure;for(const [id,item]of entry.pending){
        const admitted=(await actor.receipts.read()).filter(row=>row.domain==='admission'&&row.kind==='admitted'&&row.payload.id===id)
        if(!admitted.length)continue
        if(admitted.length!==1||admitted[0].version!==1)throw fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')
        const entries=actor.piSession.sessionManager.getEntries().filter(row=>row.type==='custom_message'&&row.customType==='night.business-input'&&row.details?.packetId===id)
        if(entries.length!==1||admitted[0].payload.entryId!==entries[0].id||!isDeepStrictEqual(entries[0].details,{packetId:id,source:item.packet.source})||!isDeepStrictEqual(entries[0].content,item.packet.content))throw fail('TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT')
        if(typeof onSupplementAdmitted!=='function')throw fail('TASK_LIVE_SUPPLEMENT_UNAVAILABLE')
        await onSupplementAdmitted({messageId:item.messageId,packetId:id,entryId:entries[0].id,binding:item.binding})
        entry.pending.delete(id)
      }});entry.admissionTail=operation.catch(cause=>{entry.admissionFailure??=cause});return operation}
      entry.syncAdmissions=syncAdmissions
      let executionRegistry,observationalDefinitions
      const isObservational=exec=>observationalDefinitions?.get(exec.name)!==undefined&&observationalDefinitions.get(exec.name)===executionRegistry.get(exec.name,exec.agent)
      const setup=async(agentCtx,actor)=>{
        await ctx.get('agentPresets').mount(agentCtx,'night-bot-task')
        const tools=agentCtx.get('tools'),systemPrompt=agentCtx.get('systemPrompt');executionRegistry=tools
        const forbidden=/^(?:subagent|task_delegate|task_execution|agent_create|schedule_create|schedule_update|group_)/
        const inherited=tools.view(actor).restrictableNames
        const allowed=tools.schemas(actor).map(tool=>tool.name).filter(name=>name!=='run_code'&&inherited.has(name)&&!forbidden.test(name))
        // The execution role cannot inherit coordinator tools published later.
        // Same-named replacements still face the exact-definition effect gate.
        tools.restrict({allow:allowed})
        tools.guard(exec=>forbidden.test(exec.name)?'TASK_TOOL_ROLE_FORBIDDEN':undefined)
        systemPrompt.section({name:'task:single-execution',order:0,text:instructions})
        if(typeof groupResponsibility==='string'&&groupResponsibility.trim())systemPrompt.section({name:'task:group-responsibility',order:1,interpolate:false,text:'Configured conversation responsibility: '+groupResponsibility+'. Apply within the current task and source authorization only; this configuration grants no new permissions or cross-conversation access.'})
        systemPrompt.section({name:'task:reply-scope',order:1,text:conversationReplyScopeInstructions})
        if(input.humanReview)systemPrompt.section({name:'task:human-review',order:1,text:'本轮只读核对人工业务答复。读取原待答问题、候选来源的完整原文和引用，核对真实作者的业务角色、权限、对应事项和全部限制；模型摘要与推断不是授权。事实追问使用 task_result(wait, replySourceId)，以 summary/evidence/limitations 记录事实，保持原问题待答，不为回复事实追问解除实施限制。只有真实来源已回答同一问题、角色与条件证据齐备时，才用 task_human_resolve 记录原答复；SQL再次核验来源及版本。解除成功后本轮仍保持只读并以无新问题的 wait 结束，由下一普通轮在原有授权范围继续。不得在本轮执行写入、命令、记忆写入、委派、扩大目标或完成任务。'})
        if(input.dialogue)systemPrompt.section({name:'task:dialogue',order:1,text:'本轮仅只读回答当前任务对话。以 task_result 的 wait 和 summary 给出基于已有证据的答复，不执行外部效果，不创建新问题，不完成或扩大原任务。'})
        const reviewTool=exec=>isObservational(exec)
        if(readOnly)tools.guard(exec=>reviewTool(exec)?undefined:input.humanReview?'DYNAMIC_HUMAN_REVIEW_READ_ONLY':'TASK_DIALOGUE_REPLY_ONLY')
        agentCtx.on('tools/pre-execute',async(exec,next)=>!await current()?{kind:'deny',reason:'TASK_SESSION_STALE'}:uncertain()?{kind:'deny',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY'}:readOnly&&!reviewTool(exec)?{kind:'deny',reason:input.humanReview?'DYNAMIC_HUMAN_REVIEW_READ_ONLY':'TASK_DIALOGUE_REPLY_ONLY'}:next())
        agentCtx.on('tools/execute',async(exec,next)=>{
          if(isObservational(exec))return next()
          if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          await preflightPiFileMutation(exec,tools.get(exec.name,actor))
          const origin=taskToolInputOrigin(actor.piSession.sessionManager,{callId:exec.callId,name:exec.name,args:exec.arguments,taskId:binding.taskId,sessionId:binding.sessionId})
          bindInvocationHistory(actor)
          const effectKey=origin.invocationKey
          if(seenInvocations.has(effectKey))return {isError:true,content:[{type:'text',text:'TASK_EFFECT_ALREADY_ATTEMPTED: inspect original evidence; do not replay.'}],error:{message:'TASK_EFFECT_ALREADY_ATTEMPTED'}}
          if(priorReconciliations.length&&(typeof authorizeEffectInvocation!=='function'||await authorizeEffectInvocation({binding:structuredClone(binding),origin:structuredClone(origin),priorReconciliations:structuredClone(priorReconciliations)})!==true))throw fail('TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED')
          const intent={version:2,key:effectKey,name:exec.name,callId:exec.callId,invocation:{callEntryId:origin.callEntryId,inputEntryId:origin.inputEntryId,packetId:origin.packetId,inputDigest:origin.inputDigest,originBinding:origin.binding}}
          seenInvocations.add(effectKey)
          actor.receipts.append({version:1,domain:'task',kind:'effect-intent',payload:intent});intents.set(effectKey,{...intent,settled:false});await actor.receipts.commit()
          const result=await next()
          if(exec.signal.aborted||isJobOutcomeUncertain(result)||['ABORTED','TOOL_OUTCOME_UNKNOWN'].includes(result.error?.info?.code))throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          const notStarted=result.isError&&isPiFileMutationNotStarted(exec,tools.get(exec.name,actor))
          // 普通失败仍可能发生在外部写入之后，不能凭文案、返回字段或同名工具放行。
          if(result.isError&&!notStarted)throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          actor.receipts.append({version:1,domain:'task',kind:'effect-result',payload:{key:effectKey,isError:!!result.isError,...notStarted?{effect:'not-started'}:{}}});await actor.receipts.commit();intents.get(effectKey).settled=true
          return result
        })
        if(input.humanReview)tools.register({name:'task_human_resolve',description:'Record that this review’s real candidate source has answered the pending business question. Read the original question, complete reply, author role and all conditions first. This changes only the reviewed business record; the current run remains read-only and must end with task_result(wait).',parameters:{type:'object',properties:{requestId:{type:'string',minLength:1},sourceId:{type:'string',minLength:1},reason:{type:'string',minLength:1},evidence:{type:'array',minItems:1,items:{type:'string',minLength:1}}},required:['requestId','sourceId','reason','evidence'],additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args){
          if(!await current())throw fail('TASK_SESSION_STALE')
          if(args.requestId!==input.humanReview.requestId||!input.humanReview.sourceIds?.includes(args.sourceId)||!input.sources?.some(source=>source.sourceId===args.sourceId))throw fail('DYNAMIC_HUMAN_REVIEW_SOURCE_INVALID')
          if(!args.reason.trim()||!args.evidence.length||args.evidence.some(item=>!item.trim()))throw fail('DYNAMIC_ARGUMENT_INVALID')
          if(typeof resolveHuman!=='function')throw fail('TASK_HUMAN_RESOLUTION_UNAVAILABLE')
          return resolveHuman(args,binding)
        }})
        tools.register({name:'task_result',description:'Commit this single task execution result, or wait for a specific missing input. This concludes the turn.',parameters:{type:'object',required:['decision'],additionalProperties:false,properties:{decision:{type:'object',properties:{action:{type:'string',enum:['complete','wait','blocked']},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}},limitations:{type:'array',items:{type:'string'}},artifacts:{type:'array',items:{type:'string'}},deliveryFiles:{type:'array',items:{type:'object',properties:{path:{type:'string'},caption:{type:'string'}},required:['path'],additionalProperties:false}},question:{type:'string'},audience:{type:'string',enum:['operator','requester'],description:'Technical/runtime/account/environment questions: operator (default). Explicit business input from the requester: requester. No automatic conversation fallback.'},replySourceId:{type:'string',minLength:1,description:'Only humanReview: the current candidate source for a factual follow-up; wait with read evidence, keep the original question pending.'},attemptedActions:{type:'array',items:{type:'string'}}},required:['action','summary','evidence','limitations'],additionalProperties:false}}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute({decision},exec){
          await syncAdmissions(actor)
          if(!await current())throw fail('TASK_SESSION_STALE')
          const origin=taskToolInputOrigin(actor.piSession.sessionManager,{callId:exec.callId,name:exec.name,args:exec.arguments,taskId:binding.taskId,sessionId:binding.sessionId})
          if(!await isCurrent({...binding,contextRevision:origin.binding.contextRevision}))throw fail('TASK_CONTEXT_NOT_CONSUMED')
          if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
          bindInvocationHistory(actor)
          if(decision.action==='complete'&&priorReconciliations.length&&(typeof authorizeEffectInvocation!=='function'||await authorizeEffectInvocation({binding:structuredClone(binding),origin:structuredClone(origin),priorReconciliations:structuredClone(priorReconciliations)})!==true))throw fail('TASK_EFFECT_NEW_AUTHORIZATION_REQUIRED')
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
        // Capture business read capabilities before agent-created listeners
        // can replace a same-named registration. File tools are mounted by the
        // factory afterwards and are admitted only through their private marker.
        observationalDefinitions=new Map([...observational,...input.humanReview?['task_human_resolve']:[]].filter(name=>!['read','read_image','read_window'].includes(name)).map(name=>[name,tools.get(name,actor)]).filter(([,definition])=>definition!==undefined))
      }
      const options={agentOptions:{provider,model,...reasoningEffort?{reasoningEffort}:{}},setup,signal:entry.abort.signal,auditKinds:singleTaskAuditKinds,readOnly,
        initialReceipts:stored?[]:[{version:1,domain:'task',kind:'identity',payload:{taskId:binding.taskId,sessionId:binding.sessionId}}],
        authorizeInput:async(candidate,actor)=>actor.id===binding.sessionId&&await current()&&isDeepStrictEqual(candidate,packets.get(candidate.id)),
        beforeRequest:async actor=>{bindInvocationHistory(actor);await syncAdmissions(actor);if(entry.submitted)throw fail('TASK_RESULT_ALREADY_COMMITTED');if(!await current())throw fail('TASK_SESSION_STALE');if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY');
          // A later same-named registration is not the read-only capability
          // captured for this execution. It needs ordinary effect admission.
          for(const name of ['read','read_image','read_window','find','grep'])if(!observationalDefinitions.has(name)){const definition=executionRegistry.get(name,actor);if(isPiFileObservationalTool(definition,actor)||isNativeSearchObservationalTool(definition,actor))observationalDefinitions.set(name,definition)}
        },
        drainBusiness:async(actor,{phase,proof}={})=>{
          const jobs=ctx.get('jobs');if(typeof jobs?.drainOwner!=='function')throw fail('TASK_JOB_DRAIN_UNPROVEN');await jobs.drainOwner(actor,{reason:'single task execution ended'})
          if(phase!=='dispose'||!uncertain())return
          if(typeof readEffectScope!=='function'||proof?.modelIdle!==true||proof?.toolsIdle!==true||proof?.processes!==0||proof?.jobs!==0||proof?.scope!=='registered-owned-provider-ranges')throw fail('TASK_EFFECT_DRAIN_UNPROVEN')
          await actor.receipts.commit()
          const stored=await ctx.sessionPersistence.readNative(binding.sessionId,{requireComplete:true}),scope=await readEffectScope(binding,stored)
          const inputs=unresolvedTaskInputOrigins(actor.piSession.sessionManager,intents,binding),identity={binding:Object.fromEntries(['taskId','sessionId','requirementRevision','controlRevision','contextRevision','leaseEpoch'].map(name=>[name,binding[name]??0])),scopeDigest:taskEffectScopeDigest(scope),cutEntryId:actor.piSession.sessionManager.getLeafId()}
          const differentOrigin=inputs.some(item=>!isDeepStrictEqual(item.originBinding,identity.binding))
          actor.receipts.append(await (differentOrigin?ownerDrainedInputsReceipt:ownerDrainedReceipt)({...identity,...differentOrigin?{inputs}:{}},async()=>({issuer:'night-owned-provider-drain-v1',scope:proof.scope,ownerId:actor.id,modelIdle:proof.modelIdle,toolsIdle:proof.toolsIdle,processes:proof.processes,jobs:proof.jobs,observedAt:new Date().toISOString(),evidenceDigest:fingerprint({phase,proof:{scope:proof.scope,processes:proof.processes,jobs:proof.jobs,modelIdle:proof.modelIdle,toolsIdle:proof.toolsIdle},binding})})))
          await actor.receipts.commit()
        },
      }
      entry.handle=await withPersistenceWriter(binding,()=>stored?ctx.agents.resume({...options,resumeSessionId:binding.sessionId}):ctx.agents.create({...options,sessionId:binding.sessionId,meta:{cwd,agentPreset:'night-bot-task'}}))
      await entry.handle.agent.receipts.commit();await onSessionBound(binding)
      if(!await current())return {status:'stale'}
      await entry.handle.agent.input.enqueue(packet)
      await entry.handle.agent.input.deliver(packet.id,{deliverAs:'followUp'})
      await entry.handle.agent.whenIdle()
      if(uncertain())throw fail('TASK_EFFECT_UNCERTAIN_NO_REPLAY')
      if(!entry.submitted&&await current()){
        const native=entry.handle.agent.piSession.messages.findLast(message=>message.role==='assistant')
        throw Object.assign(fail(native?.stopReason==='error'?'TASK_PI_PROVIDER_ERROR':'TASK_SESSION_NO_SUBMISSION'),{phase:'decision',...native?.stopReason?{nativeAssistantStopReason:native.stopReason}:{}})
      }
      return {status:entry.submitted?'submitted':'cancelled'}
    }catch(cause){
      entry.outcomeError=cause
      if(entry.effectUncertain?.())return {status:'no_submission',reason:'TASK_EFFECT_UNCERTAIN_NO_REPLAY',effectDisposition:'held',failure:{code:cause.code??'TASK_EFFECT_UNCERTAIN_NO_REPLAY',message:cause.message}}
      // Supersession is a business outcome, independent of which official SDK
      // cancellation point observed it. Finally must still prove real disposal.
      if(!await current())return {status:'cancelled',reason:'TASK_BINDING_SUPERSEDED',failure:{code:typeof cause.code==='string'?cause.code:cause.name}}
      throw cause
    }finally{
      entry.finishing=true
      let idleOutcome,admissionOutcome;const drainErrors=[]
      if(!entry.handle&&entry.outcomeError?.cleanupFailure)drainErrors.push(entry.outcomeError.cleanupFailure)
      try{
        if(entry.handle){
          // The public SDK can already be physically idle while its application
          // request policy reports a rejection. Preserve that outcome, but do
          // not let it skip the actual producer drain and writer release.
          try{await entry.handle.agent.whenIdle()}catch(cause){idleOutcome=cause}
          try{await entry.syncAdmissions?.(entry.handle.agent)}catch(cause){admissionOutcome=cause}
          try{await entry.handle.agent.receipts.commit()}catch(cause){drainErrors.push(cause)}
          try{await entry.handle.dispose()}catch(cause){drainErrors.push(cause)}
        }
      }finally{
        if(drainErrors.length)entry.drainError=Object.assign(fail('TASK_SESSION_DRAIN_FAILED'),{taskSessionDrained:false,cause:drainErrors.length===1?drainErrors[0]:new AggregateError(drainErrors,'Task receipts or producer drain failed'),...((entry.outcomeError??idleOutcome)?{businessFailure:entry.outcomeError??idleOutcome}:{})})
        else active.delete(binding.taskId)
        entry.done.resolve()
      }
      if(entry.drainError)throw entry.drainError
      if(admissionOutcome)throw admissionOutcome
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
  function liveBinding(taskId){const entry=active.get(taskId);return entry?.handle&&!entry.readOnly&&!entry.submitted&&!entry.finishing&&!entry.abort.signal.aborted?structuredClone(entry.binding):undefined}
  async function supplement({task,sources,materials}){
    const entry=active.get(task.taskId);if(!liveBinding(task.taskId))return {delivered:false}
    if(!await isOwnerCurrent(entry.binding))throw fail('TASK_LIVE_SUPPLEMENT_STALE')
    for(const row of task.liveSupplements??[]){
      if(row.leaseEpoch!==entry.binding.leaseEpoch||row.state!=='pending'||entry.pending.has('task-supplement:'+row.wakeId))continue
      const nextBinding={...structuredClone(entry.binding),contextRevision:row.contextRevision}
      const source={kind:'task-input',taskSession:structuredClone(nextBinding)}
      if(!Array.isArray(row.sourceSnapshots))throw fail('TASK_LIVE_SUPPLEMENT_SOURCE_REQUIRED')
      const selected=row.sourceSnapshots.map(({stages,...item})=>conversationSource(item))
      const packet={id:'task-supplement:'+row.wakeId,source,content:[{type:'text',text:JSON.stringify({task:{...taskInputSnapshot(task),request:row.request,contextRevision:row.contextRevision,sourceRefs:row.sourceRefs},sources:selected,materials:materials.map(({resources,...item})=>({...conversationSource(item),resources:resources.map(({value,...resource})=>resource)})),supplement:{messageId:row.messageId,contextRevision:row.contextRevision}})}]}
      entry.packets.set(packet.id,packet);entry.pending.set(packet.id,{packet,binding:nextBinding,messageId:row.messageId})
      await entry.handle.agent.input.enqueue(packet)
      await entry.handle.agent.input.deliver(packet.id,{deliverAs:'steer'})
      await entry.syncAdmissions(entry.handle.agent)
    }
    return {delivered:true}
  }
  return {run,cancel,liveBinding,supplement,async close(){closed=true;await Promise.all([...active.keys()].map(cancel))}}
}
export const disabledExecutionSessions=()=>({run:async()=>{throw fail('TASK_SPLIT_EXECUTION_REMOVED')},cancel:async()=>{},feedback:async()=>{throw fail('TASK_SPLIT_EXECUTION_REMOVED')},close:async()=>{}})
