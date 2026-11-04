import { AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { isContextOverflow } from '@earendil-works/pi-ai/utils/overflow'
const emptyUsage=()=>({input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}})
export function capturePiReplay(message,model=message.model) {
  const response={kind:'pi-ai',version:2,api:message.api,provider:message.provider,model,stopReason:message.stopReason}
  for(const key of ['responseModel','responseId','providerThinkingLevel'])if(message[key]!==undefined)response[key]=message[key]
  return{response,blocks:message.content.map(block=>{
    const metadata={type:block.type==='thinking'?'reasoning':block.type==='toolCall'?'tool-call':block.type}
    for(const key of block.type==='text'?['textSignature']:block.type==='thinking'?['thinkingSignature','redacted']:['thoughtSignature','namespace'])if(block[key]!==undefined)metadata[key]=block[key]
    return metadata
  })}
}
export function classifyPiFailure(message,contextWindow) {
  if(isContextOverflow(message,contextWindow)||message.stopReason==='error'&&/context[ _-](?:length|window)[ _-](?:exceed(?:ed|s)?|overflow(?:ed)?|limit[ _-]exceeded)|\b(?:max|maximum)(?: allowed| supported)? context (?:length|window)\b|\b(?:request|prompt|input|messages?) (?:is |are )?too (?:long|large) for (?:this |the )?(?:model(?:'s)? )?context|\b(?:input|prompt|request) (?:is )?too (?:long|large) for (?:this|the) model\b|\b(?:input|prompt|request|messages?)\b.{0,40}\b(?:exceeds?|exceeded|overflows?|is larger than)\b.{0,40}\b(?:the )?(?:model(?:'s)? )?context\b/i.test(message.errorMessage??''))return{code:'CONTEXT_WINDOW_EXCEEDED',message:message.errorMessage??'Model context window exceeded'}
  if(message.stopReason==='aborted')return{code:'ABORTED',message:message.errorMessage??'Request aborted'}
  if(message.stopReason==='stop'&&!message.content.length)return{code:'EMPTY_RESPONSE',message:'Model returned a completed response with no content'}
  if(['pending','deferred'].includes(message.stopReason))return{code:'PI_AI_ERROR',message:'Unsupported provider terminal state: '+message.stopReason}
  if(message.stopReason!=='error')return undefined
  const text=message.errorMessage??'Pi provider error'
  const patterns=[['AUTH',/\b(?:401|403)\b/],['QUOTA',/\binsufficient[ _-]+(?:quota|balance|credits?)\b|\b(?:quota|usage[ _-]+limit)[ _-]+(?:exceeded|exhausted|reached)\b|\bexceed(?:ed|s)?[ _-]+(?:(?:your|the)[ _-]+)?(?:current[ _-]+)?quota\b|\b(?:balance|credits?)[ _-]+(?:exhausted|depleted)\b|\bout[ _-]+of[ _-]+(?:credits?|budget)\b/i],['RATE_LIMIT',/\b429\b|rate.?limit/i],['INVALID_REQUEST',/\b(?:400|413)\b|invalid.?request|payload too large|request body too large|failed to buffer the request body/i],['SERVER',/\b5\d\d\b/],['TIMEOUT',/time(?:d)?\s*out|timeout/i],['TRANSPORT',/stream ended (?:before|without)|network|connection|socket|fetch|ECONN[A-Z]+|other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly|terminated|premature close/i]]
  return{code:patterns.find(([,pattern])=>pattern.test(text))?.[0]??'PI_AI_ERROR',message:text}
}
const usageOf=u=>({inputTokens:u.input,outputTokens:u.output,totalTokens:u.totalTokens,...u.cacheRead>0?{cacheReadTokens:u.cacheRead}:{},...u.cacheWrite>0?{cacheWriteTokens:u.cacheWrite}:{}})
/** Native events remain the execution stream. Audit chunks are a one-way observer
 * for existing application logs; no DSH stream controls model input or output.
 */
export function observePiEvents(source,{provider,model,contextWindow,signal,onChunk=()=>{},onCancel=()=>{},idleTimeoutMs=300000}={}) {
  const output=new AssistantMessageEventStream(),toolCalls=new Map()
  void(async()=>{
    let terminal=false,iterator,timer
    const fallback=error=>({role:'assistant',provider,model,api:'native-pi',content:[],usage:emptyUsage(),timestamp:Date.now(),stopReason:signal?.aborted?'aborted':'error',errorMessage:error.message})
    function finish(message,reason,explicitFailure) {
      /* Audit failures must also settle the native stream; never recursively
       * invoke a failing observer while reporting its failure. */
      const chunks=[]
      chunks.push({type:'usage',usage:usageOf(message.usage)})
      let failure=signal?.aborted?{code:'ABORTED',message:'Request aborted'}:explicitFailure??classifyPiFailure(message,contextWindow)
      let failed=failure!==undefined
      let result={...message,...failed?{stopReason:failure.code==='ABORTED'?'aborted':'error',errorMessage:failure.message,_hostFailure:failure}:{},_hostUsage:usageOf(message.usage)}
      chunks.push({type:'finish',reason:failed?{kind:result.stopReason,failure}: {kind:message.stopReason==='length'?'max-tokens':message.stopReason==='toolUse'?'tool-calls':'stop'},...failed?{}:{replayState:capturePiReplay(message,model)}})
      try{for(const chunk of chunks)onChunk(chunk)}catch(error){failure={code:'PI_AUDIT_FAILED',message:error.message};failed=true;result={...message,stopReason:'error',errorMessage:error.message,_hostFailure:failure}}
      output.push(failed?{type:'error',reason:result.stopReason,error:result}:{type:'done',reason:reason??result.stopReason,message:result});output.end(result);terminal=true
    }
    try {
      if(!Number.isFinite(idleTimeoutMs)||idleTimeoutMs<=0||idleTimeoutMs>2147483647)throw Object.assign(new Error('Invalid Pi stream idle timeout'),{code:'INVALID_CONFIG'})
      iterator=source[Symbol.asyncIterator]()
      while(!terminal){
        signal?.throwIfAborted()
        let abort
        const interrupted=new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(Object.assign(new Error('Pi stream idle timeout'),{code:'TIMEOUT'})),idleTimeoutMs)
          if(signal){abort=()=>reject(Object.assign(new Error('Request aborted'),{code:'ABORTED'}));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()}
        })
        let next
        try{next=await Promise.race([iterator.next(),interrupted])}finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort)}
        if(next.done)throw Object.assign(new Error('Pi stream ended without done/error'),{code:'STREAM_CLOSED'})
        const event=next.value,index=event.contentIndex
        if(event.type==='done'){finish(event.message,event.reason);continue}
        if(event.type==='error'){finish(event.error,event.reason);continue}
        if(event.type==='text_start'||event.type==='thinking_start'||event.type==='toolcall_start'){
          const blockType=event.type==='text_start'?'text':event.type==='thinking_start'?'reasoning':'tool-call'
          onChunk({type:'block-start',index,blockType})
          if(event.type==='toolcall_start')toolCalls.set(index,event.partial.content[index])
        }else if(event.type==='text_delta'||event.type==='thinking_delta')onChunk({type:event.type==='text_delta'?'text-delta':'reasoning-delta',index,text:event.delta})
        else if(event.type==='toolcall_delta'){const call=toolCalls.get(index);onChunk({type:'tool-call-delta',index,id:call?.id??'',...call?.name?{name:call.name}:{},argumentsDelta:event.delta})}
        else if(event.type==='text_end'||event.type==='thinking_end')onChunk({type:'block-end',index,block:event.type==='text_end'?{type:'text',text:event.content}:{type:'reasoning',text:event.content}})
        else if(event.type==='toolcall_end')onChunk({type:'block-end',index,block:{type:'tool-call',id:event.toolCall.id,name:event.toolCall.name,arguments:JSON.stringify(event.toolCall.arguments)}})
        output.push(event)
      }
    }catch(error){
      if(!terminal)finish(fallback(error),undefined,error.code?{code:error.code,message:error.message}:undefined)
    }finally{
      clearTimeout(timer)
      try{onCancel()}catch{}
      if(!terminal)output.end(fallback(new Error('Pi stream was closed')))
      if(iterator?.return)Promise.resolve(iterator.return()).catch(()=>{})
    }
  })()
  return output
}
