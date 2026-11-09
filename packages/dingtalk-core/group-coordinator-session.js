import {assertSupportedJsonSchema,validateJsonSchemaValue} from '../../src/native-tool-protocol.js'
import {createOfficialModelContentIndex} from './model-context.js'
import {groupReplyInstructions} from './group-message.js'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {realpath} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
import {z} from 'zod'

const SUBMIT='group_coordinator_submit'
const fail=code=>Object.assign(new Error(code),{code})
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id=z.string().min(1),lease=z.number().int().positive()
const identity=z.strictObject({version:z.literal(1),conversationId:id,sessionId:id,creationLease:lease})
const runBinding=z.strictObject({conversationId:id,sessionId:id,turnId:id,leaseEpoch:lease})
const schemas={
 'identity':identity,
 'run-started':runBinding,
 'candidate-intent':runBinding.extend({candidateId:id,attemptId:id,callId:id,decisionDigest:id}),
 'candidate-result':runBinding.extend({candidateId:id,attemptId:id,outcome:z.enum(['accepted','rejected','unknown']),errorCode:id.optional()}),
 'run-settled':runBinding.extend({outcome:z.enum(['submitted','no_submission','stale','cancelled','failed'])}),
}
export const groupCoordinatorAuditKinds=Object.freeze(Object.fromEntries(Object.entries(schemas).map(([kind,schema])=>['group-coordinator/'+kind,value=>schema.safeParse(value).success])))
const receipt=(kind,payload)=>({version:1,domain:'group-coordinator',kind,payload:schemas[kind].parse(payload)})
const bindingFact=({conversationId,sessionId,turnId,leaseEpoch})=>({conversationId,sessionId,turnId,leaseEpoch})
function checkHistory(audit,binding,{next=true}={}){
 const facts=audit.filter(item=>item.domain==='group-coordinator')
 for(const item of facts){
  if(!schemas[item.kind]||!schemas[item.kind].safeParse(item.payload).success)throw fail('GROUP_COORDINATOR_AUDIT_INVALID')
  if(item.payload.conversationId!==binding.conversationId||item.payload.sessionId!==binding.sessionId)throw fail('GROUP_COORDINATOR_SESSION_IDENTITY_MISMATCH')
 }
 const identities=facts.filter(item=>item.kind==='identity')
 if(identities.length!==1||identities[0].payload.conversationId!==binding.conversationId||identities[0].payload.sessionId!==binding.sessionId)throw fail('GROUP_COORDINATOR_SESSION_IDENTITY_MISMATCH')
 const leases=[identities[0].payload.creationLease,...facts.filter(item=>item.kind==='run-started').map(item=>item.payload.leaseEpoch)]
 if(leases.some(value=>next?value>=binding.leaseEpoch:value>binding.leaseEpoch))throw fail('GROUP_COORDINATOR_SESSION_LEASE_NOT_ADVANCED')
 const outcomes=new Map(facts.filter(item=>item.kind==='candidate-result').map(item=>[item.payload.attemptId,item.payload.outcome]))
 if(facts.some(item=>item.kind==='candidate-intent'&&(!outcomes.has(item.payload.attemptId)||outcomes.get(item.payload.attemptId)==='unknown')))throw fail('GROUP_COORDINATOR_CANDIDATE_RECONCILIATION_REQUIRED')
}
const knownRejection=code=>['TASK_UAT_SOURCE_INVALID','WORKFLOW_TASK_FORBIDDEN','TASK_STAGE_AUTHORIZATION_SOURCE_INVALID','GROUP_COORDINATOR_CLARIFICATION_INVALID','GROUP_COORDINATOR_REVISE_DECISION','GROUP_COORDINATOR_READ_MATERIAL_FIRST','GROUP_COORDINATOR_UNKNOWN_TARGET','GROUP_COORDINATOR_BATCH_TARGET_DISPOSITION_INVALID','GROUP_COORDINATOR_SOURCE_COVERAGE_INVALID','GROUP_COORDINATOR_CONTINUATION_INVALID','GROUP_COORDINATOR_DUPLICATE_UNIT','GROUP_COORDINATOR_MATERIAL_SOURCE_UNBOUND','GROUP_COORDINATOR_MATERIAL_REFERENCE_INVALID','GROUP_COORDINATOR_TOPIC_PRESENTATION_DUPLICATE','GROUP_COORDINATOR_EXISTING_TASK_REQUIRES_UPDATE','MESSAGE_STALE','MESSAGE_COORDINATOR_STALE','GROUP_COORDINATOR_SOURCE_STALE'].includes(code)||/^(?:MESSAGE_(?:TOPIC_STALE|TASK_FACTS_STALE|SCOPE_PROOF_INVALID)|TASK_.*STALE|GROUP_COORDINATOR_.*STALE)$/u.test(code)

/** One official logical session per conversation. Pi owns context, compaction,
 * tools and queues; Night owns lease-bound admission and candidate receipts. */
export function createGroupCoordinatorSessions({ctx,isCurrent,getWorkspaceDir,getGroupName,contentRoot}){
 if(typeof isCurrent!=='function')throw fail('GROUP_COORDINATOR_CURRENT_CHECK_REQUIRED')
 const entries=new Map()
 let closed=false
 async function inspect(sessionId){
  try{return await ctx.sessionPersistence.readNative(sessionId,{requireComplete:true})}
  catch(error){if(error.name!=='SessionPersistenceNotFoundError'||error.sessionId!==sessionId)throw error}
 }
 async function workspace(binding,stored){
  const requested=getWorkspaceDir?await getWorkspaceDir({binding}):stored?.header.cwd??ctx.get?.('workingDirectory')?.defaultDirectory
  if(!isAbsolute(requested??''))throw fail('GROUP_COORDINATOR_WORKSPACE_REQUIRED')
  return realpath(requested)
 }
 const current=async entry=>!closed&&!entry.cancelled&&!entry.uncertain&&await isCurrent(entry.binding)
 async function attachWorkspace(actor){
  const cwd=actor.piSession.sessionManager.getCwd(),registry=ctx.get('workspaceRegistry')
  if(!registry)throw fail('GROUP_COORDINATOR_WORKSPACE_REGISTRY_REQUIRED')
  const target=await registry.resolveByPath(cwd)??await registry.create(cwd)
  await target.attachSession(actor.id)
 }
 async function drain(entry){
  return entry.draining??=(async()=>{
   try{if(entry.handle)await entry.handle.dispose()}
   catch(cause){entry.drainError=Object.assign(fail('GROUP_COORDINATOR_DRAIN_FAILED'),{cause,coordinatorDrained:false});throw entry.drainError}
   finally{entry.drained.resolve()}
  })()
 }
 async function prepare(binding){
  if(closed)throw fail('GROUP_COORDINATOR_CLOSED')
  if(!binding.sessionId)return null
  if(entries.has(binding.conversationId)||ctx.agents.get(binding.sessionId))throw fail('GROUP_COORDINATOR_SESSION_ALREADY_LIVE')
  const stored=await inspect(binding.sessionId)
  if(!stored){if(binding.sessionBound)throw fail('GROUP_COORDINATOR_SESSION_MISSING');return null}
  checkHistory(stored.audit,binding,{next:false})
  const cwd=await workspace(binding,stored)
  if(cwd!==stored.header.cwd)throw fail('GROUP_COORDINATOR_NATIVE_RELOCATION_REQUIRED')
  return null
 }
 async function run({binding,input,provider,model,reasoningEffort,decisionSchema,onSessionBound,onCandidate,readTools=[],instructions,dynamic=false}){
  if(!binding||!['conversationId','sessionId','turnId'].every(key=>typeof binding[key]==='string'&&binding[key])||!Number.isSafeInteger(binding.leaseEpoch)||binding.leaseEpoch<1||typeof binding.sessionBound!=='boolean'||!provider||!model||typeof onCandidate!=='function'||typeof onSessionBound!=='function')throw fail('GROUP_COORDINATOR_RUN_INVALID')
  assertSupportedJsonSchema(decisionSchema)
  if(Array.isArray(input?.sources)&&input.sources.length>15)throw fail('GROUP_COORDINATOR_BATCH_LIMIT')
  if(readTools.some(tool=>tool.effectClass!=='read'||typeof tool.execute!=='function'||tool.name===SUBMIT)||new Set(readTools.map(tool=>tool.name)).size!==readTools.length)throw fail('GROUP_COORDINATOR_READ_TOOL_REQUIRED')
  if(closed)throw fail('GROUP_COORDINATOR_CLOSED')
  if(entries.has(binding.conversationId))throw fail('GROUP_COORDINATOR_BUSY')
  const entry={binding:Object.freeze(structuredClone(binding)),abort:new AbortController(),drained:Promise.withResolvers()}
  entries.set(binding.conversationId,entry)
  const append=async(kind,payload)=>{entry.handle.agent.receipts.append(receipt(kind,payload));await entry.handle.agent.receipts.commit()}
  async function acceptCandidate(decision,callId){
   const fact=bindingFact(binding),decisionDigest=digest(decision),candidateId=digest([binding.conversationId,binding.sessionId,binding.turnId,decisionDigest]),attemptId=digest([candidateId,callId])
   await append('candidate-intent',{...fact,candidateId,attemptId,callId,decisionDigest})
   let acceptance
   try{acceptance=await onCandidate(structuredClone(decision),entry.binding)}
   catch(cause){
    const errorCode=String(cause.code??cause.message??'unknown'),outcome=knownRejection(errorCode)?'rejected':'unknown'
    if(outcome==='unknown')entry.uncertain=true
    try{await append('candidate-result',{...fact,candidateId,attemptId,outcome,errorCode})}catch(commitError){entry.uncertain=true;throw commitError}
    throw cause
   }
   try{await append('candidate-result',{...fact,candidateId,attemptId,outcome:'accepted'})}catch(cause){entry.uncertain=true;throw cause}
   return acceptance
  }
    const setup = async (agentCtx, agent) => {
      const tools=agentCtx.get('tools'),systemPrompt=agentCtx.get('systemPrompt')
      if(!tools||!systemPrompt)throw fail('GROUP_COORDINATOR_SCOPED_SERVICES_REQUIRED')
      entry.content = createOfficialModelContentIndex(agent, contentRoot ? { root: contentRoot } : undefined)
      systemPrompt.section({ name: 'group:coordinator', order: 0,
        text: instructions ?? `你是本群常驻协调助手。根据当前身份别名、群职责、原消息和连续上下文一次完成是否介入、任务关联、查询、补充、新建或必要澄清。群聊中的“你”不自动指助手，但明确点名助手和明确交办不得忽略。units=[]表示完全忽略来源，不会将其并入Task；需要承接的补充、附件来源和阶段条件应使用fact单元绑定同批source:<runId>且replyPolicy:none。初次承接时非空units的spans合计必须覆盖sourceLength完整原文；存在continuation时仅提交指定待续办单元的原unitId和原spans，其他单元不重提。requiredExecutionMaterials只接受真实resourceRef，待取得证据或表结构属于调查objective而不是发起前置条件。附件与后续请求结合阅读，原需求方更正应更新同一任务；同一目标的准备、审批、测试、原发送者验证、正式执行属于同一Task的阶段，不重复建任务。职责止于消息承接、事项关联和交办条件整理。请求提供任务、随后提供文档、点名和明确开发可以逐步补足同一交办链；根据语义、引用和已知话题事实续接同一topic，不因每条消息信息不完整拆成新话题，也不按时间相邻或同群强行合并无关事项。同批同一链选择一个source:<runId>为共同话题锚点，fact与create/research都用conversation绑定该锚点；跨轮复用当前已有话题candidateId。创建Task不等于新建话题：已有无Task话题可承接create，只有已有Task才禁止再次create；new/null只用于独立新话题。不同作者可以讨论同一话题，但逐条保留来源身份、分别核验授权，话题关联不继承别人的权限。公共讨论补充用fact且scope=conversation、replyPolicy=none关联当前已有话题，不读取或控制Task。需求方明确补齐已有Task缺少的执行字段时，用revise携带对应结构化参数更新原需求，不仅记fact；依据连续问答解释省略表达，不新增任务或部署授权。若当前确认省略环境全名，revise填写uatEnvironment及uatSourceRefs，按问答顺序引用同话题当前sourceKey/sourceVersion/sourceQuote，sourceQuote必须是完整原文、末条必须是当前有权确认消息；上下文仅作解释不授予权限，不覆盖当前明确不同环境。只有材料加单纯点名、尚未表达要做什么时，记录为同话题fact和处理指向，等待后续明确动作；不得自行推断需要评审、调查或实施建议而创建research。“授权不明按分析”仅限制已表达动作的执行范围，不能凭空生成分析任务。初次命名或新增实质信息时，在一个unit的topicPresentation提交累计事项的title和summary（不是仅复述最新一句）；同topic每批最多一个显式更新，其他unit省略该字段。名称概括事项，摘要反映当前目标、已给材料和明确约束；不臆造文档正文，不把承接写成完成。新建任务的arguments.title用8–20字、最多30字的业务短名称，直接概括动作和对象，不以“针对某人要求”起头；完整需求放objective。业务objective可以完整概括需求；stageAuthorizations[].objective是授权依据，必须使用sourceQuote中的逐字来源片段，不得改写、扩展或借其他作者的原文补足授权。明确交办且原文与附件元数据足够时，立即提交create/research，由Task Owner继续调查、工作簿核验、SQL审核和交付；不要先在群协调会话完成这些业务工作再发起Task。“边做边修”等是工作方式约束；已有事项则关联，没有具体事项则保留对话事实，不虚构插件专项任务、不要求先提供插件bug。任务准入由Host核验，actorPermissions为空不表示无权；提出明确交办候选，不自行要求负责人确认。needs_clarification仅用于target_conflict、scope_conflict、required_parameter_missing、no_actionable_target，必须给出missingField、blockedAction和checkedSourceRefs（使用当前原消息sourceKey及实际检查的resourceRef，不使用source:<runId>候选ID）；先读已有必要材料，权限、读取故障、能力缺失不能作为需求澄清。只读材料工具仅用于确需查明的消息含义、任务关联或缺失业务条件，不把整个附件审查当成承接前置。使用本轮只读工具核验相关任务事实，不猜测数据或读取权限。仅人际闲聊静默处理，不主动追问；已经提供的材料不可重复索取。提交动作只代表候选，Host接纳后由已有任务后端执行；received:true仅表示协调决定已落账，不能据此认定Task存在或执行完成。每轮sources.processing为当前后端权威事实，旧superseded命令且taskExists=false不能作为忽略重放来源的依据；不得声称已执行或替人审批。长任务交给既有Task，不等待其完成来阻塞群消息。严格保留来源身份、版本、原文约束和授权边界；历史工具结果是当时事实，当前版本冲突时重新读取相关任务。不要重复通知或自行发送群消息，所有通知由唯一出口处理。${groupReplyInstructions}最后调用 ${SUBMIT} 提交协调决定。` })
      if (dynamic) tools.presentAs('native')
      tools.restrict({ allow: [] })
      if (!dynamic) systemPrompt.section({ name: 'group:progress', order: 1, text: '已有任务的催促或进度询问不启动新的调查回答：确需回复时使用 status/result 查询已有任务当前事实；只含情绪反馈且没有查询或交办时作为 fact 静默关联。answer.objective 填真正要调查的问题，不能填你拟发送的回复。群里仅通知简洁的实际进度，详细业务分析留在任务产物，不复述原文、不道歉铺垫、不说“已收到”或“不用重复提交材料”。' })
      if (!dynamic) systemPrompt.section({ name: 'group:mixed-input', order: 2, text: '一条消息可包含多个独立任务、对旧问题的补答和闲聊。逐项分段承接：clarification仅绑定facts.quotedRequest或clarificationRequests中当前pending且有权回答的请求，只覆盖补答原文；独立新任务正常建单元，闲聊用no_action单元完成覆盖。同一句表达不同目标可以共享跨度，但相同跨度和相同动作不得重复提交。引用已resolved/superseded请求不会再次回答旧问题，不得因此忽略同条新交办。sources[].continuation存在时，仅提交其中每个unit的原unitId和原spans；其他已接纳单元保持，不重新提交，也不要求覆盖整条sourceLength。续办沿原话题，只有明确核验了已有候选目标才改绑；新消息的额外任务在新来源中承接，不塞入旧请求的答案。' })
      entry.content.install(agentCtx, () => current(entry))
      const allowed = new Set([SUBMIT, 'model_content_read', ...readTools.map(t => t.name)])
      tools.guard(exec => !allowed.has(exec.name) || entry.submitted || entry.staleReason || entry.cancelled || entry.uncertain || closed ? 'group_coordinator_tool_not_allowed' : undefined)
      agentCtx.on('tools/pre-execute', async (_exec, next) => !await current(entry) ? { kind: 'deny', reason: 'group_coordinator_stale' } : next())
      agentCtx.on('tools/result', (exec, result) => { if (exec.name === SUBMIT && exec.callId === entry.submitCallId && !result.isError) entry.accepted = true })
      for (const tool of readTools) {
        const { effectClass, execute, ...definition } = tool
        tools.register({ ...definition, output: entry.content.wrapOutput(definition.output), execute: async (args, exec) => {
          if (!await current(entry)) throw fail('GROUP_COORDINATOR_STALE')
          exec.signal.throwIfAborted()
          return execute(args, exec)
        } })
      }
      tools.register({ name: SUBMIT, description: '提交本轮群消息协调候选；不直接执行任务或发送消息。',
        parameters: { type: 'object', properties: { decision: decisionSchema }, required: ['decision'], additionalProperties: false },
        output: { schema: { type: 'object', properties: { received: { type: 'boolean' }, feedback: { type: 'string' }, acceptance: { type: 'object', additionalProperties: true } }, required: ['received'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute({ decision }, exec) {
          if (!await current(entry)) throw fail('GROUP_COORDINATOR_STALE')
          exec.signal.throwIfAborted()
          if (dynamic) entry.submissionAttempts = (entry.submissionAttempts ?? 0) + 1
          const schemaProblems = validateJsonSchemaValue(decisionSchema, decision)
          if (schemaProblems.length) return { received: false, feedback: `决定不符合当前提交合同：${schemaProblems.join('; ')}。请按具体字段路径修正完整decisions；澄清字段放在units[].intent内，constraints、requiredExecutionMaterials和replyPolicy只属于kind=intent分支，不放在decision顶层。` }
          let acceptance
          try { acceptance = await acceptCandidate(decision, exec.callId) }
          catch (error) {
            const code = error.code ?? error.message
            if (code === 'TASK_UAT_SOURCE_INVALID')
              return { received: false, feedback: error.message + ' 请核对完整原文与当前版本，保留原Task并修正环境来源引用；不得猜环境或借第三人授权。' }
            if (code === 'WORKFLOW_TASK_FORBIDDEN')
              return { received: false, feedback: '当前来源没有读取或操作该Task的权限。不得改绑新话题规避权限；公共事实可用原话题候选提交仅fact、scope=conversation、replyPolicy=none，不读取Task详情、不改变需求。其他合法来源的明确需求补充仍在原Task用revise更新，不能把整批退为新话题；禁止借别人的身份或授权执行。' }
            if (code === 'TASK_STAGE_AUTHORIZATION_SOURCE_INVALID')
              return { received: false, feedback: `${code}：请核对stageAuthorizations[].sourceQuote和objective；授权objective必须是该sourceQuote中的逐字来源片段，业务动作arguments.objective可以完整概括。保留真实来源、作者和授权范围，不自动扩权，不改成向用户澄清；修正完整候选后在本会话重新提交，Host仍会校验。` }
            if (code === 'GROUP_COORDINATOR_CLARIFICATION_INVALID')
              return { received: false, feedback: `${error.message} 请核对当前原文及已有材料，修正完整决定；明确交办提交动作由Host判断准入，工作方式记录为fact，不能把权限或待调查细节包装成澄清。` }
            if (code === 'GROUP_COORDINATOR_REVISE_DECISION')
              return { received: false, feedback: `${error.message} 请直接在本轮修正units的分段、binding和intent并重新提交完整decisions；不能提交needs_relink或needs_resegmentation作为最终决定。本轮batchCandidates可作为新事项目标，按其中binding使用。` }
            if (code === 'GROUP_COORDINATOR_READ_MATERIAL_FIRST')
              return { received: false, feedback: `${error.message} 请先调用group_coordinator_read_material读取本轮真实resourceRef，再提交intent；needs_context不是协调最终决定。若是尚待调查的事实，将其写入objective交由Task调查。` }
            if (['GROUP_COORDINATOR_UNKNOWN_TARGET', 'GROUP_COORDINATOR_BATCH_TARGET_DISPOSITION_INVALID'].includes(code))
              return { received: false, feedback: `${error.message} 请仅修正错误绑定：已有目标用当前candidates，批次source:<runId>用当前batchCandidates且disposition为conversation或new；不要凭旧历史构造引用。` }
            if (code === 'GROUP_COORDINATOR_SOURCE_COVERAGE_INVALID')
              return { received: false, feedback: `${error.message}：非空units的spans合计必须完整覆盖sourceLength，不能省略后续条件；请修正完整决定。` }
            if (['GROUP_COORDINATOR_CONTINUATION_INVALID', 'GROUP_COORDINATOR_DUPLICATE_UNIT'].includes(code))
              return { received: false, feedback: `${error.message} 续办仅提交sources[].continuation.units的原unitId和原spans，不重放其他单元；初次承接保留所有独立目标、补答和闲聊，并删除完全重复的动作单元。` }
            if (code === 'GROUP_COORDINATOR_MATERIAL_SOURCE_UNBOUND')
              return { received: false, feedback: `${error.message} 请提交对应来源完整fact单元，绑定同一source候选且replyPolicy:none，再提交整批决定。` }
            if (code === 'GROUP_COORDINATOR_MATERIAL_REFERENCE_INVALID')
              return { received: false, feedback: 'requiredExecutionMaterials只能填本轮真实resourceRef；待取得证据、表结构等属于调查objective，不是Task发起前置材料。请修正完整决定。' }
            if (code === 'GROUP_COORDINATOR_TOPIC_PRESENTATION_DUPLICATE')
              return { received: false, feedback: '同一topic本批只能有一个topicPresentation。请基于累计有效消息提交一个最终名称和摘要，其他关联unit省略topicPresentation，再提交完整决定。' }
            if (code === 'GROUP_COORDINATOR_EXISTING_TASK_REQUIRES_UPDATE')
              return { received: false, feedback: '同一事项只能创建一个Task，请将create/research合并为一个创建动作；已有Task的补充请使用fact/revise，再提交完整决定。' }
            if (['MESSAGE_STALE', 'MESSAGE_COORDINATOR_STALE', 'GROUP_COORDINATOR_SOURCE_STALE'].includes(code)) {
              entry.staleReason = code
              exec.concludeTurn()
              return { received: false, feedback: '本轮来源或领取身份已失效，本轮结束，Host将重新领取当前来源。' }
            }
            if (/^(?:MESSAGE_(?:STALE|TOPIC_STALE|TASK_FACTS_STALE|SCOPE_PROOF_INVALID)|TASK_.*STALE|GROUP_COORDINATOR_.*STALE)$/u.test(code) && await current(entry))
              return { received: false, feedback: `${code}：当前来源或任务版本已改变，请重新读取受影响事实后修正决定。` }
            throw error
          }
          if (!await current(entry)) throw fail('GROUP_COORDINATOR_STALE')
          entry.decision = structuredClone(decision); entry.submitCallId = exec.callId; entry.submitted = true
          exec.concludeTurn()
          return { received: true, acceptance: acceptance ?? { authority: 'not_observed', meaning: '候选已接纳；未提供Task创建或执行证明。' } }
        } })
    }
    let outcome='failed'
    try{
      if(!await current(entry)){outcome=entry.cancelled||closed?'cancelled':'stale';return{status:outcome}}
      if(ctx.agents.get(binding.sessionId))throw Object.assign(fail('GROUP_COORDINATOR_SESSION_ALREADY_LIVE'),{coordinatorDrained:false})
      const stored=await inspect(binding.sessionId)
      if(binding.sessionBound&&!stored)throw fail('GROUP_COORDINATOR_SESSION_MISSING')
      if(stored)checkHistory(stored.audit,binding)
      const cwd=await workspace(binding,stored)
      if(stored&&stored.header.cwd!==cwd)throw fail('GROUP_COORDINATOR_NATIVE_RELOCATION_REQUIRED')
      const packetId='group-'+digest([binding.conversationId,binding.sessionId,binding.turnId,binding.leaseEpoch])
      let expectedPacket
      const options={sessionId:binding.sessionId,agentOptions:{provider,model,...reasoningEffort===undefined?{}:{reasoningEffort}},meta:{cwd},auditKinds:groupCoordinatorAuditKinds,
        initialReceipts:stored?[]:[receipt('identity',{version:1,conversationId:binding.conversationId,sessionId:binding.sessionId,creationLease:binding.leaseEpoch})],
        setup,signal:entry.abort.signal,
        authorizeInput:async packet=>await current(entry)&&expectedPacket!==undefined&&isDeepStrictEqual(packet,expectedPacket),
        beforeRequest:async()=>{
          if(entry.uncertain)throw fail('GROUP_COORDINATOR_CANDIDATE_RECONCILIATION_REQUIRED')
          if(!await current(entry)){entry.staleReason='GROUP_COORDINATOR_STALE';throw fail(entry.staleReason)}
          if(entry.submitted)throw fail('GROUP_COORDINATOR_RUN_FINISHED')
          if(dynamic&&(entry.submissionAttempts??0)>=3){entry.limitReached=true;throw fail('GROUP_COORDINATOR_SUBMISSION_LIMIT')}
        },
      }
      entry.handle=stored?await ctx.agents.resume({...options,resumeSessionId:binding.sessionId}):await ctx.agents.create(options)
      const actor=entry.handle.agent
      if(!actor.piSession||actor.session)throw fail('GROUP_COORDINATOR_OFFICIAL_FACTORY_REQUIRED')
      if(!dynamic){const permissions=actor.ctx.get('permissionPresets');if(!permissions)throw fail('GROUP_COORDINATOR_PERMISSION_PRESETS_REQUIRED');await permissions.set(actor,'danger-full-access')}
      const name=getGroupName?.(binding.conversationId),manager=actor.piSession.sessionManager
      if(name&&manager.getSessionName()!==name)manager.appendSessionInfo(name)
      await actor.receipts.commit();await attachWorkspace(actor)
      if(!await current(entry)){outcome=entry.cancelled||closed?'cancelled':'stale';return{status:outcome}}
      await onSessionBound(binding)
      if(!await current(entry)){outcome=entry.cancelled||closed?'cancelled':'stale';return{status:outcome}}
      await append('run-started',bindingFact(binding))
      const content=[{type:'text',text:JSON.stringify(entry.content.host(input,{reuseVisible:false}))}]
      expectedPacket={id:packetId,source:{kind:'coordinator',groupCoordinator:entry.binding},content}
      const start=manager.getEntries().length
      await actor.admission.enqueue(expectedPacket)
      await entry.handle.deliver(packetId)
      await actor.whenIdle()
      if(entry.uncertain)throw fail('GROUP_COORDINATOR_CANDIDATE_RECONCILIATION_REQUIRED')
      if(entry.cancelled||closed){outcome='cancelled';return{status:outcome}}
      if(entry.staleReason||!await current(entry)){outcome='stale';return{status:outcome,...entry.staleReason?{reason:entry.staleReason}:{}}}
      if(entry.accepted){outcome='submitted';return{status:outcome,decision:structuredClone(entry.decision)}}
      const last=manager.getEntries().slice(start).findLast(item=>item.type==='message'&&item.message.role==='assistant')?.message
      if(last?.stopReason==='error')throw Object.assign(fail('GROUP_COORDINATOR_PROVIDER_FAILED'),{cause:new Error(last.errorMessage??'Official coordinator provider request failed')})
      outcome='no_submission';return{status:outcome}
    }catch(error){
      if(entry.cancelled||closed){outcome='cancelled';return{status:outcome}}
      if(entry.limitReached&&!entry.uncertain){outcome='no_submission';return{status:outcome}}
      if(entry.staleReason&&!entry.uncertain){outcome='stale';return{status:outcome,reason:entry.staleReason}}
      throw error
    }finally{
      try{if(entry.handle)await append('run-settled',{...bindingFact(binding),outcome})}
      finally{await drain(entry);if(!entry.drainError)entries.delete(binding.conversationId)}
    }
  }
  async function cancel(conversationId){
    const entry=entries.get(conversationId)
    if(!entry)return
    entry.cancelled=true;entry.abort.abort(fail('GROUP_COORDINATOR_CANCELLED'))
    await entry.handle?.agent.cancel({kind:'user'})
    await entry.drained.promise
    if(entry.drainError)throw entry.drainError
  }
  return{prepare,run,cancel,async close(){closed=true;await Promise.all([...entries.keys()].map(cancel))}}
}
