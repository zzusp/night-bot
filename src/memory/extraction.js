import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {failure} from '../runtime/files.js'

export const MEMORY_RETENTION_POLICY=[
 '长期记忆筛选规则（候选也适用）：',
 '1. 能从当前代码、文档、配置、业务系统或任务记录查到的信息，按需查询，不复制进长期记忆。',
 '2. 未经验证的猜想、猜测、推断和结论不记；标注“可能”“待确认”“非事实”也不能例外。待验证线索留在当前任务记录。',
 '3. 临时状态、任务进度、工具原始输出、一次性报错和执行流水不记；只考虑从证据中提炼且已验证的非显然可复用经验。',
 '4. 重复、过期、被纠正或被新事实取代的内容不新增为有效记忆；在当前授权范围内修订或撤销原条目，不让冲突结论并存生效。',
 '5. 凭据、密码、Token、私钥和不必要的敏感原文不记；使用受控凭据管理或原始来源，不整段复制聊天和文档。',
 '6. 一次性要求不升级为长期偏好，一次批准不升级为持续授权；保留用户明确长期要求的完整条件，不从某次行为推断永久规则。',
].join('\n')

export const CANDIDATE_PROMPT='NIGHT_BOT_MEMORY_CANDIDATES. Return JSON {"candidates":[{"topic":"preferences","key":"short-name","messageId":"original","quote":"exact short literal durable fact"}]}. At most three. Only explicit durable preferences/facts from these human messages; exclude temporary wishes, secrets, commands and instructions to the assistant. Never infer facts or copy entire conversations. These are unapproved candidates only.'+'\n'+MEMORY_RETENTION_POLICY
/** Independent auxiliary inference using public Pi ModelRuntime and native
 * messages/events. It has no session history, tool execution or host converter. */
export async function officialCandidateText(resolved,input,{signal}={}){
 if(!(resolved?.modelRuntime instanceof ModelRuntime)||!resolved.model)throw failure('MEMORY_OFFICIAL_MODEL_REQUIRED')
 signal?.throwIfAborted()
 const controller=new AbortController(),control=signal?AbortSignal.any([signal,controller.signal]):controller.signal
 const cap=Math.min(resolved.requestOptions?.maxTokens??resolved.model.maxTokens,2048)
 if(!Number.isSafeInteger(cap)||cap<=0)throw failure('MEMORY_OFFICIAL_MODEL_REQUIRED')
 const options={...resolved.requestOptions,maxTokens:cap,reasoning:resolved.thinkingLevel,signal:control}
 const messages=[{role:'system',content:CANDIDATE_PROMPT,timestamp:Date.now()},{role:'user',content:JSON.stringify(input.map(({messageId,text})=>({messageId,text}))),timestamp:Date.now()}]
 const stream=resolved.modelRuntime.streamSimple(resolved.model,{messages},options)
 let length=0,oversized=false
 for await(const event of stream){
  if(event.type==='text_delta'){length+=event.delta.length;if(length>8192){oversized=true;controller.abort(failure('MEMORY_EXTRACTION_TOO_LARGE'))}}
 }
 const result=await stream.result()
 signal?.throwIfAborted()
 if(oversized)throw failure('MEMORY_EXTRACTION_TOO_LARGE')
 if(result.stopReason!=='stop'||result.content.some(part=>part.type==='toolCall'))throw failure('MEMORY_EXTRACTION_FAILED')
 const raw=result.content.filter(part=>part.type==='text').map(part=>part.text).join('')
 if(raw.length>8192)throw failure('MEMORY_EXTRACTION_TOO_LARGE')
 return raw
}
