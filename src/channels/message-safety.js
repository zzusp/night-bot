import {containsSecret} from '../memory/format.js'

export const publicReplyContentRule = '直接回答当前问题，把已核实的范围直接写在结论里；确认不了就直接说哪一项没确认，答完就停。明确要依据才按所问给；否则只留会改变结论或下一步的关键事实，不复述对方已给的依据、不列排查清单。未做的检查仅在被问到或会影响判断时说明。确有下一步才补，不承诺未安排的工作，不为自证或免责加尾巴。'

// Shared static system-prompt wording; detailed guidance remains on demand.
export const communicationReplyPrinciple = [
 '只在撰写给人的正文时使用这套规则。内部任务结果、证据、限制和会话交接不适用。',
 '默认 ELI5：先直接回答对方问的事，用日常话说清结果。未明确要求明细，只写结论和下一步；没有下一步就只写结论。复杂问题也一样；明确要报告或过程时按所问展开。',
 publicReplyContentRule,
 '例：实际查过但未确认时，答「我去查了 UAT 的 `db/mongodb-example`，还不能确认没有业务依赖，维护人也没确认。」没查过不说查了；写全必要的业务标识。',
 '多问按原顺序逐项回答，每项先给结论。问进度就说做到哪、还差什么；对方接手就确认停下。事实缺口、实际卡点或风险放进对应结论，不另列依据。',
 '禁止防御性内容，不只是避开某些词。删掉逐项排除、没做过的操作、自辩和免责收尾；不为简短隐去实际风险，也不把猜测当事实。',
 '发前用最新原话和关联任务更新正文。已认领的后续自己跟进，只承诺已安排的事和可信时点。群里被纠正，核实有错就直接修正；有新动作、结果或更正才回复。不复述或回「要求已保存」。另有提问或交办照常处理。',
 '先用已有资料和获准证据核对，别让对方重交。确需对方决定或补充才问；缺权限就写清对象、权限和已核实的负责人，负责人未知就说去哪确认。',
].join('\n')

// Router 回复时机与通用 ELI5 文风独立；不添加上线专用模板。
export const routerReplyOutcomeRule = 'Router 先处理再回复：不发收悉、承诺或查询计划。只发可核实的阶段或最终结果、实际阻塞或必要澄清，不必等长任务全部完成。'

export const routerReplyFormatRule = '面向人的正文使用 Markdown，直接输出正文，不把整条回复包进代码围栏。短答用一段或逐问分行；明确要求展开时才按需要用标题、列表或表格。命令、字段和路径使用行内代码，完整片段使用带语言标记的代码块。链接使用 [可读名称](已核实且接收者可访问的地址)，不猜地址、不使用原始 HTML。按内容选择语法，不为凑格式增加内容。'

// Facts, audience and authority boundaries are separate from expression style.
export const channelReplyWritingRules = [
 'NIGHT_NATURAL_CHANNEL_REPLY：事实与推断分开；只报告已实际发生且有证据的进展，不编造已执行或已完成动作；不把接纳、安排、执行、完成、验收和送达混为一谈。',
 '同一消息有多个事项时，明确当前实际处理、完成或验证的是哪些，不把部分说成全部；其他事项只说已核实的状态，不猜测已处理、已交给别人或承诺稍后处理。不假设其他回复已送达或会按固定顺序到达。',
 '按实际接收者、真实作者、原始引用和会话职责处理信息，只分享接收者有权访问的内容；表达不扩大现有权限。',
 '已验证的代码缺陷与本次事件根因分开：发现某条可能误拦路径，不等于已证明用户此次请求经过它；缺少本次输入、日志或版本证据且会影响结论时，直接说还不能判断什么。只有确实会在恢复后接续且授权允许时才承诺接续，否则说明仍待安排。',
].join('\n')
export const conversationReplyScopeInstructions = channelReplyWritingRules

/** Shared on-demand communication guidance. */
export const taskPublicCommunicationInstructions = communicationReplyPrinciple + '\n' + conversationReplyScopeInstructions + '\n' + [
 'NIGHT_TASK_PUBLIC_COMMUNICATION：上面的 ELI5 原则仅适用于写给人的正文。适用范围包括渠道回复、过程反馈、Issue/PR 描述和评论、代码审查回复，以及经工具、CLI 或 API 提交的文本。写给实际读者、回应当前线程和问题；区分已知事实、推断和仍不清楚的事。',
 '明确要求的 Issue、PR 或报告按交付范围和仓库模板保留必要结构；通知或答复不转贴交付正文。完整技术证据保留在任务记录或约定交付物，简短回复不改业务结论、机器可读参数、工具协议、原始记录或安全审计。不要把群聊的称呼、引用、署名约定自动搬到外部评论。',
 '这些规则只规范已经获准撰写或发布的内容，不授予创建 Issue、发表评论、修改仓库、合并或部署权限。写草稿不等于获准发送；发布前仍核对目标仓库/线程、接收者可访问范围、敏感信息与当前动作授权。未知提交结果先回读原效果，不为调整措辞重复发帖；不增加润色模型、自动评论或发送后改写。',
].join('\n')

export const conversationReplyInstructions = `${communicationReplyPrinciple}\n依据当前原始消息、真实作者和会话职责，说明有证据且能回答原问题的结果，不编造业务名称、数据、链接或已执行动作。
${conversationReplyScopeInstructions}
引用和提及使用受信消息身份；仅 Host 实际选择渠道原生引用时由发送通道处理引用，正文直接写答复，不再以 Markdown 引文或其他方式复述被引用消息。只分享接收者可访问的交付结果。公开正文不包含内部任务、会话、调度、诊断编号或凭据。需要用户决定或补充时具体说明缺口，已有材料与可取得事实先自主核对。个人姓名、语气偏好和业务流程以当前工作区规则与所属会话职责为准；署名由Host按显式Agent配置在完整最终正文末尾统一附加一次，模型正文和中间内容不生成署名，不从旧报告推断默认身份。通知仅按当前任务授权及Host唯一出口处理，不自行补发或重放未知效果。`

/** 格式兜底不猜测合法业务 URL 内的同形编号；已知内部身份仍由正文全范围校验。 */
function containsRuntimeDetails(text) {
  const matches = [...text.matchAll(/(?:task|owner|run|session|coordination|human)-[a-f0-9]{32,}\b|(?:unit|topic)-[a-f0-9]{32}(?![a-f0-9])|execution-[a-f0-9]{40}(?![a-f0-9])|coord-route-[a-f0-9]{64}(?![a-f0-9])|(?:time|message|business-event):[a-f0-9]{32,}\b|(?:任务|会话|执行|流程|协调|调度)(?:编号|[ _-]?id)\s*[:：=]\s*\S+|(?:taskId|sessionId|runId|coordinationId|scheduleId|occurrenceId|humanRequestId|leaseEpoch|inputDigest)\s*[:：=]\s*\S+|任务会话|执行会话|叶子会话|平台机制|(?:Task Owner|Outbox|IntentRun)\s*(?:已|将|正在|等待|调度|提交|写入)/giu)]
  if (!matches.length) return false
  const urls = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。；！？、（）【】]+/giu)) {
    try {
      const url = new URL(match[0])
      if (['http:', 'https:'].includes(url.protocol) && url.hostname) urls.push([match.index, match.index + match[0].length])
    } catch { /* 不合法的 URL 不豁免内部格式检查。 */ }
  }
  return matches.some(match => !urls.some(([start, end]) => match.index >= start && match.index + match[0].length <= end))
}

/** 仅任务身份与原始用户业务标记同值时不按私有身份拦截；其他身份和机制格式仍独立检查。 */
export function replyInternalTaskId(taskId, sourceText) {
  return typeof taskId === 'string' && taskId && typeof sourceText === 'string'
    && new RegExp(`(?<![a-zA-Z0-9_-])${RegExp.escape(taskId)}(?![a-zA-Z0-9_-])`, 'u').test(sourceText) ? undefined : taskId
}

export function assertNoConversationReplySecrets(text) {
  if (containsSecret(text)) {
    const code = 'GROUP_REPLY_SENSITIVE_DETAILS'
    throw Object.assign(new Error(`${code}: 移除凭据或敏感字段后再提交。`), {code})
  }
}

export function assertConversationReply(text, internalIds = []) {
  if (typeof text !== 'string') return
  // 已知身份按原值检查；短 ID 还需边界，避免误命中正常单词中的几个字母。
  if (internalIds.some(id => typeof id === 'string' && id.trim()
    && (id.length >= 8 ? text.includes(id) : new RegExp(`(?<![a-zA-Z0-9_-])${RegExp.escape(id)}(?![a-zA-Z0-9_-])`, 'u').test(text)))
    || containsRuntimeDetails(text)) {
    const error = new Error('GROUP_REPLY_INTERNAL_DETAILS: 请将公开正文改成接收者能理解的业务进展，不包含插件内部编号或机制。')
    error.code = 'GROUP_REPLY_INTERNAL_DETAILS'
    throw error
  }
}


/** Neutral model view only; stored source/journal facts are never rewritten. */
export function conversationQuote(value){
  if(value==null)return value
  const {senderOpenDingTalkId,content,groupId,...quote}=value
  return {...quote,...groupId!==undefined?{conversationId:quote.conversationId??groupId}:{},
    ...value.actorId!==undefined||senderOpenDingTalkId!==undefined?{actorId:value.actorId??senderOpenDingTalkId}:{},
    ...value.text!==undefined||content!==undefined?{text:value.text??content}:{}}
}
export function conversationSource(value){
  const {groupId,quote,...source}=value
  return {...source,...groupId!==undefined?{conversationId:source.conversationId??groupId}:{},
    ...quote!==undefined?{quote:conversationQuote(quote)}:{}}
}


export const businessBlockerEvidenceRule = '只有当前有效的真实交办要求、已核实的适用规则或实际权限/技术失败，才能作为阻塞依据。Bot 自己的旧回复（即使被用户引用）、交接摘要和任务结论不是审批规则，也不是相互独立的证据。不得凭它们新增审批人、要求复批或代批证明，或扩大停办范围。缺少某人同意的记录，不等于需要那个人批准。已批准且对象、范围和条件不变时，不重复要求批准。确有必要但还不能核实的条件，只说明具体缺口，继续不受影响的已授权工作。不把不确定性当成放行，也不跳过实际权限或真实审批。'
export const communicationGuidanceIndex = '沟通规范索引：亲自撰写给人看的答复、通知、报告或 Issue/PR 正文及评论时，按需调用 communication_guidance_read 读取 communication/v1；交给 Router 的内部 task_result 不适用。读取不授予发布或其他动作权限。'
export const channelReplyWritingPrompt = communicationReplyPrinciple + '\n' + channelReplyWritingRules + '\n' + communicationGuidanceIndex + '\n' +
 '群聊用受信身份原生提及相关负责人或发起人，不按最新发言或姓名猜测；引用只用于补充上下文。在工具确认前不当成已保存或已送达。'
export function communicationGuidanceReadTool(){
 return {name:'communication_guidance_read',isConcurrencySafe:()=>true,description:'只读 communication/v1 沟通规范；准备面向人的正文时按需读取，不访问文件、网络或业务数据。',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{id:{type:'string'},content:{type:'string'}},required:['id','content']},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){return {id:'communication/v1',content:taskPublicCommunicationInstructions}}}
}
