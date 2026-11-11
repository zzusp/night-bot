import {temporary} from './format.js'

export const messageText=message=>typeof message.content==='string'?message.content:(message.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n')
export const human=message=>message?.role==='user'&&message.source?.kind==='user'
/** Unambiguous commands execute before inference. Flexible natural language is
 * handled by the same guarded model tools; a summary is never implicit consent. */
export function parseCommand(text){
  const match=/^(?:请)?(记住候选|记住|修改记忆|更新记忆|忘记|remember|update memory|forget)\s*(?:(公共|个人|本群)\s+|项目\[([^\]\r\n]+)\]\s+)?([^\s/:：]+)\/([^\s/:：]+)(?:\s*[:：]\s*([\s\S]+))?\s*$/i.exec(text.trim())
  if(!match)return
  const [,verb,scopeWord,projectId,topic,key,textBody]=match
  const action=/忘记|forget/i.test(verb)?'forget':verb==='记住候选'?'promote':'remember'
  if(action==='remember'&&!textBody)return
  return {action,topic,key,text:textBody,scope:projectId?'project':scopeWord==='公共'?'bot':scopeWord==='本群'?'group':scopeWord==='个人'?'personal':undefined,projectId,temporary:textBody&&temporary(textBody)}
}
// 明确要求长期调整行为也是写入同意；普通将来陈述和疑问不产生授权。
export function durablePreferenceRequest(text){
  const value=text.trim(),request=/^(?:请)?(?:以后|今后|往后|后续|从现在起|从今以后|from now on\b|going forward\b)[，,:：\s]*([\s\S]+)$/i.exec(value)
  return !!request&&!/[?？]|(?:吗|么|呢)[。！!]*$/.test(value)
    && /^(?:[^。！？?!\r\n]+?[,，]\s*(?:就)?)?(?:请|不要|不用|无需|不必|默认|优先|一律|直接|必须|always\b|never\b|please\b|do not\b|don't\b|use\b|prefer\b)/i.test(request[1])
}
// 仅识别当前原话中的直接请求；转述或条件前缀不能作为称呼剥除。
function explicitRememberRequest(text){
  const addressed=/^([\p{L}\p{N}_-]+)[,，]\s*((?:请)?你(?:要|需要|务必)?(?:记住|修改记忆|更新记忆)[\s\S]*)$/u.exec(text)
  const request=addressed&&!/(?:说|表示|告诉|提到|提及|回复|声称|认为|要求|转述|引用|原话|例如|比如|示例|假设|假如|如果)/.test(addressed[1])?addressed[2]:text
  if(/[?？]|(?:吗|么|呢)[。！!]*$/.test(request.split(/[:：\r\n]/,1)[0]))return false
  return /^(?:请)?你(?:要|需要|务必)?(?:记住|修改记忆|更新记忆)\s*/.test(request)
    || /^我(?:明确)?(?:授权|同意|允许)你(?:将|把)(?:以下|上述|这(?:个|条|些))?(?:习惯|偏好|要求|内容|信息|事实)(?:保存|写入|存入)(?:为|到|至)?(?:长期)?记忆(?=[:：，,\s]|$)/.test(request)
}
export function authorizes(text,action){
  const trimmed=text.trim()
  return action==='forget'?/^(?:请)?(?:忘记|forget\b)\s*/i.test(trimmed):action==='promote'?/^(?:请)?(?:记住候选|remember candidate\b)\s*/i.test(trimmed):(/^(?:请)?(?:记住|修改记忆|更新记忆|remember\b|update memory\b)\s*/i.test(trimmed)||explicitRememberRequest(trimmed)||durablePreferenceRequest(trimmed))
}
