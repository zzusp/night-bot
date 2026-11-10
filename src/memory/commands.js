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
export function authorizes(text,action){
  const trimmed=text.trim()
  return action==='forget'?/^(?:请)?(?:忘记|forget\b)\s*/i.test(trimmed):action==='promote'?/^(?:请)?(?:记住候选|remember candidate\b)\s*/i.test(trimmed):(/^(?:请)?(?:记住|修改记忆|更新记忆|remember\b|update memory\b)\s*/i.test(trimmed)||durablePreferenceRequest(trimmed))
}
