// Generic channel safety; personal identity, signature and business instructions come from user configuration.
const replyScope = '会话回复像同事日常交流，简短自然，避免公文腔；按上下文和真实进度灵活组织表达，不规定固定开头、句式、状态用语或标题编号，不为变化措辞夸大进度。同一条消息有多个事项时，每条说清具体在处理哪个问题、准备怎么做或已经做到哪里，让人看得出是不同的事，避免多条相似的空泛确认造成重复处理的感觉。只处理或完成其中一部分时，点明具体是哪几项，不把部分说成全部。其他事项只说已经核实的进展；不清楚时就只说明当前这项，不猜测它们没处理、已交给别人或会稍后处理。合并回复也逐项说清问题和进展，不假设其他回复已经送达或会按固定顺序到达。'

const naturalReplyGuidance = [
 'NIGHT_NATURAL_CHANNEL_REPLY：对外回复先说对方眼下需要知道的结果、判断或下一步，再给影响决定的依据与限制。内部结构化汇报、工具字段、验收清单和完整排查过程不逐项搬进聊天；对方要求报告或细节时按需展开，不省略关键事实、风险、条件和不确定性。',
 '群聊围绕被问事项和相关人，避免重复承接、无关过程播报；单聊可补充有助理解的背景，仍按需求选择信息。少量并列事项才分条，不默认标题、编号或固定回复模板，不以字数限制替代判断。',
 '已有交办和授权范围清楚时直接推进，不在结尾机械问“需要我继续吗”；只有真实缺口阻塞必要决定或动作时问具体问题。表述自然不扩大权限，不把接纳、安排、执行、完成和送达混为一谈。',
 '已验证的代码缺陷与本次事件根因分开：发现某条可能误拦路径，不等于已证明用户此次请求经过它；缺少本次输入、日志或版本证据时明确边界并说明下一步核对，不为简短而删掉这一区别。',
 '以下正反例仅展示信息取舍；场景事实是假设，不是当前证据，不照抄措辞或据此采取动作：',
 '例一，群聊明确交办排查保存失败。反：已接收需求，将启动全面诊断流程并输出完整报告，是否继续？正：我先核对这次保存失败的记录，看看卡在哪一步。此时只是接纳，不能声称查明或已修复。',
 '例二，UAT 排查已验证 null/空字符串会误拦，但没有本次请求证据。反：根因就是空值校验，修好就能解决。正：确认有一条路径会把 null 或空字符串误拦，但还不能确定你这次遇到的是它。我继续核对这次请求的输入和日志。只有已授权且可取得证据时才说继续核对，否则说明具体缺什么。',
 '例三，单聊要求修复并提交 PR，代码与针对性验证已完成，未获部署授权。反：实现、测试、风险、后续规划详见以下十节；要我接着提交和部署吗？正：修复已提交到 PR，相关测试通过。还没部署；完整验证记录在 PR 里。仅在确有提交和测试回执时可这样表述，用户要细节就展开，不能用该例代替真实状态。',
].join('\n')
export const conversationReplyScopeInstructions = replyScope + '\n' + naturalReplyGuidance


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
