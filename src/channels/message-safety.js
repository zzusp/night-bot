import {containsSecret} from '../memory/format.js'

// Shared static system-prompt wording; detailed guidance remains on demand.
export const communicationReplyPrinciple = [
 '接活就接住，问进度就说做到哪、还差什么，对方接手就确认停下。不复述、不汇报过程，追问时再展开。',
 '默认 ELI5：先说对方关心的结果或下一步，只补影响判断的事实。默认只讲重点，不列排查过程和内部状态；用户要求细节再展开。用日常词和短句。必须保留的技术词，第一次用时顺手说清它指什么或对用户有什么影响。',
].join('\n')

// Router 回复时机与通用 ELI5 文风独立；不添加上线专用模板。
export const routerReplyOutcomeRule = 'Router 先处理再回复：接住任务指开始处理，不先发送收悉、承诺或查询计划。取得可核实的阶段结论后再说新增结果；必要澄清、实际阻塞和最终结果也可回复，不必等长任务最终完成。只承接而没有新增结果或必要信息的正文不发送。'

// Facts, audience and authority boundaries are separate from expression style.
export const channelReplyWritingRules = [
 'NIGHT_NATURAL_CHANNEL_REPLY：事实与推断分开；只报告已实际发生且有证据的进展，不编造已执行或已完成动作；不把接纳、安排、执行、完成、验收和送达混为一谈。',
 '同一消息有多个事项时，明确当前实际处理、完成或验证的是哪些，不把部分说成全部；其他事项只说已核实的状态，不猜测已处理、已交给别人或承诺稍后处理。不假设其他回复已送达或会按固定顺序到达。',
 '按实际接收者、真实作者、原始引用和会话职责处理信息，只分享接收者有权访问的内容；表达不扩大现有权限。',
 '已验证的代码缺陷与本次事件根因分开：发现某条可能误拦路径，不等于已证明用户此次请求经过它；缺少本次输入、日志或版本证据时保留未验证边界。只有确实会在恢复后接续且授权允许时才承诺接续，否则说明仍待安排。',
].join('\n')
export const conversationReplyScopeInstructions = channelReplyWritingRules

/** Shared on-demand communication guidance. */
export const taskPublicCommunicationInstructions = conversationReplyScopeInstructions + '\n' + [
 'NIGHT_TASK_PUBLIC_COMMUNICATION：上述边界适用于任务执行期间所有面向人的对外正文，包括渠道回复、过程反馈、Issue/PR 描述和评论、代码审查回复，以及经工具、CLI 或 API 提交的文本。提交前核对实际读者、当前线程和问题；只报告有对应版本及证据的结果、风险和未验证边界。',
 'Issue 和 PR 可按仓库模板或审查需要保留标题、段落、清单、代码与复现步骤；用户要求的报告照常完整交付。表达简短不等于删技术证据或改业务结论，不改机器可读参数、工具协议、原始记录或安全审计。不要把群聊的称呼、引用、署名约定自动搬到外部评论。',
 '这些规则只规范已经获准撰写或发布的内容，不授予创建 Issue、发表评论、修改仓库、合并或部署权限。写草稿不等于获准发送；发布前仍核对目标仓库/线程、接收者可访问范围、敏感信息与当前动作授权。未知提交结果先回读原效果，不为调整措辞重复发帖；不增加润色模型、自动评论或发送后改写。',
].join('\n')

export const conversationReplyInstructions = `依据当前原始消息、真实作者和会话职责说明实际业务结果与限制，不编造业务名称、数据、链接或已执行动作。${conversationReplyScopeInstructions}引用和提及使用受信消息身份；仅 Host 实际选择渠道原生引用时由发送通道处理引用，正文直接写答复，不再以 Markdown 引文或其他方式复述被引用消息。只分享接收者可访问的交付结果。公开正文不包含内部任务、会话、调度、诊断编号或凭据。需要用户决定或补充时具体说明缺口，已有材料与可取得事实先自主核对。个人姓名、语气偏好和业务流程以当前工作区规则与所属会话职责为准；署名由Host按显式Agent配置在完整最终正文末尾统一附加一次，模型正文和中间内容不生成署名，不从旧报告推断默认身份。通知仅按当前任务授权及Host唯一出口处理，不自行补发或重放未知效果。`

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


export const communicationGuidanceIndex = '沟通规范索引：撰写渠道首答、进度、结论或 Issue/PR 正文、评论前，按需调用 communication_guidance_read 读取 communication/v1；本索引不授予发布或其他动作权限。'
export const taskReplyWritingPrompt = communicationReplyPrinciple + '\n' + communicationGuidanceIndex
export const channelReplyWritingPrompt = communicationReplyPrinciple + '\n' + channelReplyWritingRules + '\n' + communicationGuidanceIndex + '\n' +
 '群聊用受信身份原生提及相关负责人或发起人，不按最新发言或姓名猜测；引用只用于补充上下文。在工具确认前不当成已保存或已送达。'
export function communicationGuidanceReadTool(){
 return {name:'communication_guidance_read',isConcurrencySafe:()=>true,description:'只读 communication/v1 沟通规范；准备面向人的正文时按需读取，不访问文件、网络或业务数据。',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{id:{type:'string'},content:{type:'string'}},required:['id','content']},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){return {id:'communication/v1',content:taskPublicCommunicationInstructions}}}
}
