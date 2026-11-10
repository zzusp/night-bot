import {z} from 'zod'
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
  const meta={format:'night-bot-memory-v1',topic,scope,revision,entries:entries.map(({text,context,...item})=>({...item,...context?{context:checkedMemoryContext(context),contextSha256:hash(JSON.stringify(checkedMemoryContext(context)))}:{},textSha256:hash(text)}))}
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
    const {textSha256,contextSha256,...fields}=entry
    if(entry.context!==undefined){const context=checkedMemoryContext(entry.context);if(hash(JSON.stringify(context))!==contextSha256)throw failure('MEMORY_CONTEXT_CONTENT_CHANGED');fields.context=context}
    else if(contextSha256!==undefined)throw failure('MEMORY_CONTEXT_CONTENT_CHANGED')
    return {...fields,text:body}
  })
  return {...meta,entries}
}

const contextText=z.string().min(1).max(2048)
const contextInput=z.object({
  background:z.object({source:z.enum(['message','quote']),quote:contextText}).strict().optional(),
  scenario:contextText,
  boundaries:z.array(contextText).min(1).max(16),
}).strict()
const contextString={type:'string',minLength:1,maxLength:2048,required:true}
export const memoryContextParameters={type:'object',additionalProperties:false,properties:{
  background:{type:'object',additionalProperties:false,properties:{source:{type:'string',enum:['message','quote'],required:true},quote:contextString}},
  scenario:contextString,boundaries:{type:'array',items:{type:'string',minLength:1,maxLength:2048},minItems:1,maxItems:16,required:true},
}}
const digest=z.string().regex(/^[a-f0-9]{64}$/)
const storedContext=z.object({
  version:z.literal(1),subject:z.object({kind:z.literal('actor'),actor:digest}).strict(),
  background:z.union([
    z.object({status:z.literal('unavailable')}).strict(),
    z.object({status:z.literal('source-excerpt'),source:z.enum(['message','quote']),messageId:contextText,quote:contextText,quoteSha256:digest}).strict(),
  ]),
  interpretation:z.union([
    z.object({status:z.literal('unspecified')}).strict(),
    z.object({status:z.literal('inference'),scenario:contextText,boundaries:z.array(contextText).min(1).max(16)}).strict(),
  ]),
}).strict()
export function checkedMemoryContext(value){
  const parsed=storedContext.safeParse(value)
  if(!parsed.success)throw failure('MEMORY_CONTEXT_INVALID')
  const context=parsed.data
  if(context.background.status==='source-excerpt'){
    checkedText(context.background.messageId)
    checkedText(context.background.quote)
    if(hash(context.background.quote)!==context.background.quoteSha256)throw failure('MEMORY_CONTEXT_CONTENT_CHANGED')
  }
  if(context.interpretation.status==='inference'){
    checkedText(context.interpretation.scenario)
    for(const boundary of context.interpretation.boundaries)checkedText(boundary)
  }
  return context
}
export function buildMemoryContext(value,{actor,message,quote}={}){
  let input
  if(value!==undefined){const parsed=contextInput.safeParse(value);if(!parsed.success)throw failure('MEMORY_CONTEXT_INVALID');input=parsed.data}
  let background={status:'unavailable'}
  if(input?.background){
    const selected=input.background.source==='quote'?quote:{text:message?.content,messageId:message?.id}
    const excerpt=checkedText(input.background.quote)
    if(typeof selected?.text!=='string'||!selected.messageId||!selected.text.includes(excerpt))throw failure('MEMORY_CONTEXT_SOURCE_REQUIRED')
    background={status:'source-excerpt',source:input.background.source,messageId:selected.messageId,quote:excerpt,quoteSha256:hash(excerpt)}
  }
  return checkedMemoryContext({version:1,subject:{kind:'actor',actor},background,interpretation:input?{status:'inference',scenario:input.scenario,boundaries:input.boundaries}:{status:'unspecified'}})
}
export function memoryContextText(context){
  if(!context)return ''
  return [context.background.quote,context.interpretation.scenario,...context.interpretation.boundaries??[]].filter(Boolean).join(' ')
}
