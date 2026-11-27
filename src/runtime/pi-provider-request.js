import {randomUUID} from 'node:crypto'
import {estimateTokens} from '@earendil-works/pi-coding-agent'
import {classifyPiFailure} from '../pi-provider-events.js'

const httpApis=new Set(['openai-completions','openai-responses','anthropic-messages'])
const networkCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ECONNABORTED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ERR_HTTP2_STREAM_CANCEL','ABORT_ERR'])
function networkCode(error){
 for(let depth=0;error&&depth<5;depth++,error=error.cause)if(networkCodes.has(error.code))return error.code
}
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)?value:undefined

/** Estimate the final Pi transcript, including injected system sections and
 * tool declarations. This is preflight, not a provider tokenizer. */
export function estimateProviderInput(context){
 let tokens=3
 for(const message of context.messages){
  tokens+=4+estimateTokens(message)
  // Pi's chars/4 can substantially undercount CJK-heavy task/tool transcripts.
  // Account for Han, Kana and Hangul using a 1-token-per-character floor.
  const text=typeof message.content==='string'?[message.content]:(message.content??[]).flatMap(block=>block.type==='text'?[block.text]:block.type==='thinking'?[block.thinking]:[])
  if(message.role==='system'){
   text.push(...Object.values(message.sections??{}).filter(value=>typeof value==='string'))
   if(message.toolsAdded)text.push(JSON.stringify(message.toolsAdded))
  }
  if(message.role==='assistant')for(const block of message.content)if(block.type==='toolCall')text.push(JSON.stringify(block.arguments))
  for(const value of text){
   if(!/[\u2e80-\u9fff\uac00-\ud7af]/u.test(value))continue
   let count=0
   for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0x2e80&&c<=0x9fff||c>=0xac00&&c<=0xd7af)count++}
   tokens+=Math.floor(count*0.75)
  }
 }
 return tokens
}

export function providerRequestDiagnostics(model,options,log){
 const requestId=randomUUID(),started=performance.now()
 let attempts=0,status,upstreamRequestId,code,stage='provider-setup',firstOutput=false
 const capture=response=>{
  status=response.status
  const headers=response.headers
  const get=name=>typeof headers?.get==='function'?headers.get(name):headers?.[name]
  upstreamRequestId=safeId(get('x-request-id'))??safeId(get('request-id'))
  stage='response-headers'
 }
 const fetch=async(...args)=>{
  attempts++;status=undefined;upstreamRequestId=undefined;code=undefined;stage='awaiting-http-response'
  try{const response=await (options.fetch??globalThis.fetch)(...args);capture(response);return response}
  catch(error){code=networkCode(error);throw error}
 }
 const supported=httpApis.has(model.api)
 const details=extra=>({
  requestId,...safeId(options.sessionId)?{sessionId:options.sessionId}:{},
  provider:model.provider,model:model.id,api:model.api,stage,elapsedMs:Math.round((performance.now()-started)*10)/10,
  ...supported?{httpAttempts:attempts}:{},...Number.isInteger(status)?{httpStatus:status}:{},
  ...upstreamRequestId?{upstreamRequestId}:{},...code?{transportCode:code}:{},...extra,
 })
 return {
  requestId,
  options:{...supported?{fetch}:{},onResponse:async(response,current)=>{capture(response);return options.onResponse?.(response,current)}},
  preflight(){stage='before-dispatch'},
  async *observe(source,{idleExpired,externallyAborted}){
   for await(const event of source){
    if(['text_delta','thinking_delta','toolcall_delta'].includes(event.type)){firstOutput=true;stage='receiving-output'}
    if(event.type==='error'&&idleExpired()&&!externallyAborted()){
     // Only our idle timer is retryable. Pi still owns retries, and caller or
     // shutdown cancellation must never become a new request.
     const error={...event.error,stopReason:'error',errorMessage:'Provider stream idle timeout'}
     yield {...event,reason:'error',error};continue
    }
    yield event
   }
  },
  record(result,extra={}){
   if(result?.stopReason!=='error')return
   try{
    const record=details({firstOutput,failureCode:classifyPiFailure(result,model.contextWindow)?.code,...extra})
    log?.('NIGHT_MODEL_REQUEST_FAILED '+JSON.stringify(record))
   }catch{}
  },
 }
}
