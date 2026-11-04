import {createHash} from 'node:crypto'
import {snapshotJsonValue} from '@deepseek-ai/dsh-util-values'
import {AsyncLocalStorage} from 'node:async_hooks'
import {isDeepStrictEqual} from 'node:util'
import {AssistantMessageEventStream} from '@earendil-works/pi-ai'
import {piFailureStream,bridgeDshStream} from './pi-messages.js'
import {createAssistantMessage} from '@deepseek-ai/dsh-llm'
import {capturePiReplay} from './pi-provider-events.js'
const captures=new AsyncLocalStorage()
const semantic=message=>message.content.map(block=>block.type==='toolCall'?{type:'tool-call',id:block.id,name:block.name,arguments:JSON.stringify(block.arguments)}:block.type==='thinking'?{type:'reasoning',text:block.thinking}:{type:'text',text:block.text})
const usageEqual=(message,audit)=>audit&&['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalTokens'].every((key,i)=>(audit[key]??0)===(message.usage[['input','output','cacheRead','cacheWrite','totalTokens'][i]]??0))
/** Each provider invocation owns a distinct token. Nested model invocations or
 * transformed legacy output force compatibility handling; they cannot borrow
 * another invocation's native terminal message. */
const snapshotChunk=chunk=>{const value=snapshotJsonValue(chunk);if(value===undefined)throw new TypeError('Pi audit chunk must be lossless JSON');return value}
function fingerprint(hash,chunk){const text=JSON.stringify(chunk);hash.update(String(Buffer.byteLength(text))+':');hash.update(text)}
export function nativePiEventSink(){
 const capture=captures.getStore(),token=Symbol('native Pi invocation')
 const sink=event=>{if(capture?.active){if(capture.tokens.size<2)capture.tokens.add(token);capture.last=event;if(capture.overflow||capture.events.length>=4096){capture.overflow=true;capture.events.length=0}else capture.events.push(event)}}
 sink.chunk=chunk=>{if(capture?.active)fingerprint(capture.nativeHash,snapshotChunk(chunk))}
 return sink
}

/** Keep generic policy/middleware admission while preserving Pi's actual event
 * protocol as execution output whenever the admitted audit semantics agree.
 * Legacy or output-transforming plugins retain the explicit compatibility path.
 */
export function nativeExecutionStream(sourceFactory,request,live){
 const output=new AssistantMessageEventStream(),capture={active:true,tokens:new Set(),events:[],nativeHash:createHash('sha256'),admittedHash:createHash('sha256')}
 void captures.run(capture,async()=>{
  try{
   // Buffer the admitted stream once. A fallback replays immutable in-memory
   // observations only; it never makes a second provider request or tool call.
   request.signal?.throwIfAborted()
   live.start()
   for await(const chunk of sourceFactory()){request.signal?.throwIfAborted();const admitted=snapshotChunk(chunk);fingerprint(capture.admittedHash,admitted);live.push(admitted)}
   capture.active=false
   const terminal=capture.last,message=terminal?.type==='done'?terminal.message:terminal?.type==='error'?terminal.error:undefined
   // Feed the same audit once, before any terminal can advance the agent loop.
   const finish=live.finish,reason=message?.stopReason==='length'?'max-tokens':message?.stopReason==='toolUse'?'tool-calls':message?.stopReason
   const auditUnchanged=capture.nativeHash.digest('hex')===capture.admittedHash.digest('hex')
   const matches=auditUnchanged&&!capture.overflow&&capture.tokens.size===1&&message&&isDeepStrictEqual(semantic(message),live.blocks())&&usageEqual(message,live.usage)&&isDeepStrictEqual(capturePiReplay(message,request.model),live.replayState)&&reason===finish.kind&&(!['error','aborted'].includes(reason)||message._hostFailure?.code===finish.failure?.code)
   if(matches){
    // Metadata is an audit view. The content, signatures, response identity and
    // operational events retain Pi's native structures.
    const source=capture.events,final={...message,_hostNative:true,_hostLive:live,_hostUsage:live.usage,_hostStream:live.stream,_hostMessage:createAssistantMessage({content:live.blocks(),source:{provider:request.provider,model:request.model,...live.replayState===undefined?{}:{replayState:live.replayState}}})}
    for(const event of source)output.push(event===terminal?(event.type==='done'?{...event,message:final}:{...event,error:final}):event)
    output.end(final)
   }else{
    // The audit has already observed these chunks. Preserve final assembly but
    // suppress duplicate public start/chunk frames during compatibility encoding.
    const shadow=Object.create(live);shadow.start=()=>{};shadow.push=()=>{}
    if(message&&!isDeepStrictEqual(semantic(message),live.blocks()))Object.defineProperty(shadow,'replayState',{get:()=>undefined})
    const fallback=bridgeDshStream((async function*(){})(),request,shadow)
    for await(const event of fallback){if(event.type==='done')event.message._hostLive=live;else if(event.type==='error')event.error._hostLive=live;output.push(event)}
    const final=await fallback.result();final._hostLive=live;output.end(final)
   }
  }catch(error){capture.active=false;const failed=piFailureStream(error,request.signal?.aborted?'aborted':'error');for await(const event of failed)output.push(event);output.end(await failed.result())}
  finally{capture.active=false}
 })
 return output
}
