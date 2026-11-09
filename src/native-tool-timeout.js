import {deadline} from './runtime/deadlines.js'
export const name='night-native-tool-timeout',inject=['tools'],TOOL_TIMEOUT='TOOL_TIMEOUT'
export function toolTimeoutResult(timeoutMs){
  const message=`tool call timed out after ${timeoutMs}ms`
  return{content:[{type:'text',text:`Error: ${message}`}],isError:true,error:{message,info:{name:'ToolTimeoutError',code:TOOL_TIMEOUT}}}
}
/** Restore the cooperative declaration budget. Await the delegated promise;
 * cancellation is not evidence that a tool or its admitted effects exited. */
export function apply(ctx){
  ctx.provide('nativeToolTimeout',Object.freeze({owner:name}))
  ctx.on('tools/execute',async(exec,next)=>{
    const timeoutMs=ctx.tools.get(exec.name,exec.agent)?.timeoutMs
    if(timeoutMs===undefined)return next()
    const upstream=exec.signal,own=deadline(undefined,timeoutMs,TOOL_TIMEOUT)
    const fused=AbortSignal.any([upstream,own.signal])
    exec.signal=fused
    try{
      const result=await next()
      // An ancestor may use the same public code. Identity, not the code alone,
      // identifies this wrapper's timer and preserves foreign cancellation.
      return own.signal.aborted&&fused.reason===own.signal.reason?toolTimeoutResult(timeoutMs):result
    }finally{
      exec.signal=upstream
      own[Symbol.dispose]()
    }
  })
}
