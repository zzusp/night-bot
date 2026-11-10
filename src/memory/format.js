import {createHash} from 'node:crypto'
import {failure} from '../runtime/files.js'
export const hash=value=>createHash('sha256').update(value).digest('hex')
export const label=value=>typeof value==='string'&&/^[\p{L}\p{N}][\p{L}\p{N}_. -]{0,79}$/u.test(value)
export function checkedText(text){
  if(typeof text!=='string'||!text.trim()||text.length>2048||/<!--\s*\/?memory:|\0/.test(text))throw failure('MEMORY_TEXT_INVALID')
  if(containsSecret(text))throw failure('MEMORY_SECRET_REFUSED')
  return text.trim()
}
export function containsSecret(text){
  if(/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(text))return true
  if(/(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|authorization|credentials?|secret|密码|口令|密钥|验证码)[\"']?\s*(?:[=:：]|是)|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{12,})\b/i.test(text))return true
  return false
}
export const temporary=text=>/(?:这次|本次|今天|暂时|仅限本轮|当前任务|just this time|for now|today only|this task only)/i.test(text)
export function encodeTopic(topic,revision,entries,scope){
  const meta={format:'night-bot-memory-v1',topic,scope,revision,entries:entries.map(({text,...item})=>({...item,textSha256:hash(text)}))}
  return '---\n'+JSON.stringify(meta,null,2)+'\n---\n\n# '+topic+'\n\n'+entries.map(entry=>`## ${entry.key}\n\n<!-- memory:${entry.id} -->\n${entry.text}\n<!-- /memory:${entry.id} -->\n`).join('\n')
}
export function decodeTopic(text){
  const match=/^---\n([\s\S]*?)\n---\n/.exec(text??'');if(!match)throw failure('MEMORY_MARKDOWN_INVALID')
  let meta;try{meta=JSON.parse(match[1])}catch{throw failure('MEMORY_MARKDOWN_INVALID')}
  if(meta.format!=='night-bot-memory-v1'||!label(meta.topic)||!Number.isSafeInteger(meta.revision)||!Array.isArray(meta.entries))throw failure('MEMORY_MARKDOWN_INVALID')
  const ids=new Set(),keys=new Set()
  const entries=meta.entries.map(entry=>{
    const logicalKey=(entry.topic??meta.topic)+'\0'+entry.key
    if(!/^[a-f0-9-]{36}$/.test(entry.id)||!label(entry.key)||ids.has(entry.id)||keys.has(logicalKey)||!Number.isSafeInteger(entry.revision)||!entry.source?.messageId)throw failure('MEMORY_MARKDOWN_INVALID')
    ids.add(entry.id);keys.add(logicalKey)
    const start=`<!-- memory:${entry.id} -->\n`,end=`\n<!-- /memory:${entry.id} -->`,at=text.indexOf(start)
    if(at<0||text.indexOf(start,at+start.length)>=0)throw failure('MEMORY_MARKDOWN_INVALID')
    const until=text.indexOf(end,at+start.length);if(until<0)throw failure('MEMORY_MARKDOWN_INVALID')
    const body=text.slice(at+start.length,until);if(hash(body)!==entry.textSha256)throw failure('MEMORY_CONTENT_CHANGED')
    const {textSha256,...fields}=entry;return {...fields,text:body}
  })
  return {...meta,entries}
}
