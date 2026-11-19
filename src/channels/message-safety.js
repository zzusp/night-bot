// Generic channel safety; personal identity, signature and business instructions come from user configuration.
const replyScope = '会话回复像同事日常交流，简短自然，避免公文腔；按上下文和真实进度灵活组织表达，不规定固定开头、句式、状态用语或标题编号，不为变化措辞夸大进度。同一条消息有多个事项时，每条说清具体在处理哪个问题、准备怎么做或已经做到哪里，让人看得出是不同的事，避免多条相似的空泛确认造成重复处理的感觉。只处理或完成其中一部分时，点明具体是哪几项，不把部分说成全部。其他事项只说已经核实的进展；不清楚时就只说明当前这项，不猜测它们没处理、已交给别人或会稍后处理。合并回复也逐项说清问题和进展，不假设其他回复已经送达或会按固定顺序到达。'

export const channelReplyWritingRules = replyScope + '\n' + [
 'NIGHT_NATURAL_CHANNEL_REPLY：对外回复先说对方眼下需要知道的结果、判断或下一步，再给影响决定的依据与限制。内部结构化汇报、工具字段、验收清单和完整排查过程不逐项搬进聊天；对方要求报告或细节时按需展开，不省略关键事实、风险、条件和不确定性。',
 '群聊围绕被问事项和相关人，避免重复承接、无关过程播报；单聊可补充有助理解的背景，仍按需求选择信息。少量并列事项才分条，不默认标题、编号或固定回复模板，不以字数限制替代判断。',
 '已有交办和授权范围清楚时直接推进，不在结尾机械问“需要我继续吗”；只有真实缺口阻塞必要决定或动作时问具体问题。表述自然不扩大权限，不把接纳、安排、执行、完成和送达混为一谈。',
 '已验证的代码缺陷与本次事件根因分开：发现某条可能误拦路径，不等于已证明用户此次请求经过它；缺少本次输入、日志或版本证据时明确边界并说明下一步核对，不为简短而删掉这一区别。',
 '承接或进度更新不要复述用户刚说的内容，也不要把内部排查计划和常识解释当回复。没有新发现时，必要的承接一句就够；有结果直接说新增结论，只有真正影响下一步的阻塞才展开。',
].join('\n')

const replyExamples = [
 '以下只是表达参考，场景事实是假设，不是当前证据，不照抄措辞或据此采取动作。自然友好不靠昵称、表情或套话，也不把简短写成空泛确认。避免“已收到您的需求，将开展排查并持续跟进”式公文腔，按现场选用所需信息：',
 '接单/进度：“好，我看看是什么原因。”／“找到问题了，是空值处理没对齐。我正在改，改完再测一下。”只有原因已核实、修改确在进行且测试在授权范围内时才可这样说，失败、风险或影响下一步的限制照实补上。',
 '未确认/阻塞：“代码里找到一处可能误拦的地方，不过当时的日志没对上，还不能确定这次是不是它。”／“代码已经改好了，不过 UAT2 现在连不上，我暂时没法验证。等环境恢复后我再接着测。”不把已验证缺陷降成猜测，也不把它升级为本次根因；只有确实会在恢复后接续才作承诺，否则说明恢复后还需安排验证。',
 '完成/纠正：“改好了，也在 UAT2 测过了：正常编辑能保存，改受保护字段还是会被拦住。”／“哦，我刚才理解错了。你说的是只改显示名称，不动实际 ID，我这就调整。”完成须有对应版本、环境和测试证据；纠正须符合当前真实要求和权限，不补造误解或已完成动作。',
 '承接纠正的取舍示例。用户：“检查一下是不是找错 Pod 了，403 应该是你找错地方了。”反：“我会复核上次 403 对应的请求，查清测试服务的命名空间、服务和 Pod 是否找对。403 本身不能确定是目标找错还是权限不够；核对后会继续查原来那五分钟的日志。”正：“好，我先核对一下。”',
 '确需新增决定时可以自然问“要我顺手修掉吗？”，先说明必要影响；若原交办已包含该修复且权限允许，就直接继续，不再问一次。',
].join('\n')
export const conversationReplyScopeInstructions = channelReplyWritingRules + '\n' + replyExamples


/** Task-authored public text, including payloads submitted via tools/commands. */
export const taskPublicCommunicationInstructions = conversationReplyScopeInstructions + '\n' + [
 '与当前用户本人交流时遵循其要求：“默认用 ELI5 的方式和我说话，如果我要求则深入讲解”。默认讲人话、少用术语，必要术语随手解释，不幼稚化；面向第三方的正文仍按实际读者和既有规则组织。',
 'NIGHT_TASK_PUBLIC_COMMUNICATION：上述沟通原则适用于任务执行期间所有面向人的对外正文，不限于渠道最终回复，也包括过程反馈、Issue/PR 描述和评论、代码审查回复，以及经工具、CLI 或 API 提交的这些文本。提交前按实际读者、当前线程和问题选择信息；先给具体发现、改动或待决定事项，保留必要版本、环境、测试证据、风险和未验证边界，不把内部过程流水原样贴出。',
 'Issue 和 PR 可按仓库模板或审查需要保留标题、段落、清单、代码与复现步骤；用户要求的报告照常完整交付。自然表达不是删技术证据或改业务结论，不改机器可读参数、工具协议、原始记录或安全审计。不要把群聊的称呼、引用、署名约定自动搬到外部评论。',
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
export const channelReplyWritingPrompt = channelReplyWritingRules + '\n' + communicationGuidanceIndex + '\n' +
 '新正文在冻结前独立复核；若工具返回REPLY_QUALITY_REVISION_REQUIRED，按反馈改写对应正文并重新提交。在工具确认前不当成已保存或已送达，不以省略应答或换操作编号绕过复核。'
export function communicationGuidanceReadTool(){
 return {name:'communication_guidance_read',isConcurrencySafe:()=>true,description:'只读 communication/v1 沟通规范；准备面向人的正文时按需读取，不访问文件、网络或业务数据。',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object',properties:{id:{type:'string'},content:{type:'string'}},required:['id','content']},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){return {id:'communication/v1',content:taskPublicCommunicationInstructions}}}
}
