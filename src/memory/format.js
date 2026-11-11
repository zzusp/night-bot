import {z} from 'zod'
import {createHash} from 'node:crypto'
import {failure} from '../runtime/files.js'
export const hash=value=>createHash('sha256').update(value).digest('hex')
export const label=value=>typeof value==='string'&&/^[\p{L}\p{N}][\p{L}\p{N}_. -]{0,79}$/u.test(value)
export function checkedText(text){return checkedTextWithLimit(text,2048)}
export function checkedTextWithLimit(text,limit){
  if(typeof text!=='string'||!text.trim()||text.length>limit||/<!--\s*\/?memory:|\0/.test(text))throw failure('MEMORY_TEXT_INVALID')
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
    if(entry.context!==undefined){const context=checkedMemoryContext(entry.context);if(hash(JSON.stringify(context))!==contextSha256)throw failure('MEMORY_CONTEXT_CONTENT_CHANGED');if((context.version===2||context.version===3)&&body!==renderRouterMemory(context))throw failure('MEMORY_CONTEXT_CONTENT_CHANGED');fields.context=context}
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
  if(value?.version===2||value?.version===3)return checkedRouterContext(value)
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
  if(context.version===3)return renderRouterMemory(context)+' '+context.subject.description
  if(context.version===2)return renderRouterMemory(context)
  return [context.background.quote,context.interpretation.scenario,...context.interpretation.boundaries??[]].filter(Boolean).join(' ')
}

const evidenceId=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/)
const observation=z.object({
  kind:z.enum(['user-request','user-statement','quoted-statement']),
  text:contextText,evidenceIds:z.array(evidenceId).min(1).max(16),
}).strict()
const evidenceRef=z.object({
  id:evidenceId,source:z.enum(['message','quote']),sourceId:contextText,
  messageVersion:z.number().int().positive(),quote:contextText,
}).strict()
const memoryContent={summary:contextText,why:contextText,howToApply:contextText}
const routerMemoryInput=z.object({
  ...memoryContent,
  appliesTo:z.object({kind:z.enum(['actor','context']),description:contextText}).strict(),
  evidence:z.array(evidenceRef).min(1).max(16),
}).strict()
const {$schema,...routerParameters}=z.toJSONSchema(routerMemoryInput)
export const routerMemoryParameters=routerParameters
const routerContext=z.object({
  version:z.literal(2),
  subject:z.union([z.object({kind:z.literal('actor'),actor:digest,description:contextText}).strict(),z.object({kind:z.literal('context'),description:contextText}).strict()]),
  observations:z.array(observation).min(1).max(16),hypothesis:contextText.optional(),directPath:contextText.optional(),
  evidence:z.array(evidenceRef.extend({messageId:contextText,actorId:contextText.optional(),quoteSha256:digest})).min(1).max(16),
}).strict()
const lightweightContext=routerContext.omit({observations:true,hypothesis:true,directPath:true}).extend({version:z.literal(3),...memoryContent}).strict()
function checkedRouterContext(value){
  const parsed=(value?.version===3?lightweightContext:routerContext).safeParse(value)
  if(!parsed.success)throw failure('MEMORY_CONTEXT_INVALID')
  const context=parsed.data,ids=new Map()
  checkedText(context.subject.description)
  for(const item of context.evidence){
    if(ids.has(item.id))throw failure('MEMORY_EVIDENCE_INVALID')
    for(const text of [item.sourceId,item.messageId,item.actorId,item.quote].filter(value=>value!==undefined))checkedText(text)
    if(hash(item.quote)!==item.quoteSha256)throw failure('MEMORY_CONTEXT_CONTENT_CHANGED')
    ids.set(item.id,item)
  }
  for(const item of context.observations??[]){
    checkedText(item.text)
    if(new Set(item.evidenceIds).size!==item.evidenceIds.length||item.evidenceIds.some(id=>!ids.has(id)))throw failure('MEMORY_EVIDENCE_INVALID')
    if(!item.evidenceIds.some(id=>ids.get(id).source===(item.kind==='quoted-statement'?'quote':'message')))throw failure('MEMORY_EVIDENCE_KIND_INVALID')
  }
  for(const text of [context.hypothesis,context.directPath,context.summary,context.why,context.howToApply].filter(value=>value!==undefined))checkedText(text)
  return context
}
export function buildRouterMemory(value,{actor,message,sources}={}){
  const parsed=routerMemoryInput.safeParse(value)
  if(!parsed.success)throw failure('MEMORY_CONTEXT_INVALID')
  const input=parsed.data,evidence=input.evidence.map(ref=>{
    const original=sources.find(item=>item.sourceId===ref.sourceId&&item.version===ref.messageVersion)
    const selected=ref.source==='quote'?original?.quote:original
    if(typeof selected?.text!=='string'||!selected.messageId||!selected.text.includes(ref.quote))throw failure('MEMORY_CONTEXT_SOURCE_REQUIRED')
    return {...ref,messageId:selected.messageId,...selected.actorId?{actorId:selected.actorId}:{},quoteSha256:hash(ref.quote)}
  })
  // 背景仅证明语义来源；本批维护来源始终单独绑定当前认证原消息。
  if(!evidence.some(item=>item.source==='message'&&item.sourceId===message.id&&item.quote===message.content.trim()))throw failure('MEMORY_SOURCE_QUOTE_REQUIRED')
  const context=checkedRouterContext({version:3,subject:{kind:input.appliesTo.kind,...input.appliesTo.kind==='actor'?{actor}:{},description:input.appliesTo.description},summary:input.summary,why:input.why,howToApply:input.howToApply,evidence})
  return {context,text:renderRouterMemory(context)}
}
export function renderMemoryContent({summary,why,howToApply}){
  return ['Summary: '+checkedText(summary),'**Why:** '+checkedText(why),'**How to apply:** '+checkedText(howToApply)].join('\n\n')
}
export function renderRouterMemory(context){
  if(context.version===3)return renderMemoryContent(context)
  const kinds={'user-request':'用户要求','user-statement':'用户陈述','quoted-statement':'引用说明'}
  return [
    'Model observation:',...context.observations.map(item=>`- [${kinds[item.kind]}; ${item.evidenceIds.join(', ')}] ${item.text}`),
    `适用范围（模型整理，非授权）: ${context.subject.description}`,
    'Hypothesis (not fact):',context.hypothesis??'无额外假设。',
    'Possible direct path (not permission):',context.directPath??'无额外行动建议。',
    'Evidence:',...context.evidence.map(item=>`- ${item.id} [${item.source}; ${item.sourceId}@${item.messageVersion}; message=${item.messageId}${item.actorId?`; actor=${item.actorId}`:''}]: ${item.quote}`),
  ].join('\n')
}
