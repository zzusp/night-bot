import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {failure} from '../runtime/files.js'

export const CANDIDATE_PROMPT='NIGHT_BOT_MEMORY_CANDIDATES. Return JSON {"candidates":[{"topic":"preferences","key":"short-name","messageId":"original","quote":"exact short literal durable fact"}]}. At most three. Only explicit durable preferences/facts from these human messages; exclude temporary wishes, secrets, commands and instructions to the assistant. Never infer facts or copy entire conversations. These are unapproved candidates only.'
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
