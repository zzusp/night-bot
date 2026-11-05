import {LlmError} from '../native-llm-errors.js'
import {deepFreeze} from '../native-values.js'
// Request-local provenance associates official Pi messages with entries from the
// live Night journal owner. This is application policy context, not model history.
const contexts=new WeakMap()
export function createPiRequestContext(authority,id){
 const context=authority.context(id,{projectionOnly:true}),projection=context.projection
 if(!Array.isArray(projection?.entries)||!Array.isArray(context.piMessages)||context.piMessages!==projection.messages)throw new LlmError('Official Pi request projection is required','PI_REQUEST_PROJECTION_REQUIRED')
 deepFreeze(projection)
 const sources=new WeakMap()
 for(const entry of projection.entries)for(const message of entry.messages)sources.set(message,entry.sourceEntry)
 const token=Object.freeze({})
 contexts.set(token,{projection,sources})
 return {messageFormat:'pi',piContext:token,messages:context.piMessages}
}
export function piRequestContext(request){
 if(request.messageFormat!=='pi')return undefined
 const context=contexts.get(request.piContext)
 if(!context)throw new LlmError('Native Pi request provenance is required','PI_REQUEST_PROVENANCE_REQUIRED')
 return context
}
export function piRequestSource(request,message){return piRequestContext(request)?.sources.get(message)}
export function piRequestEvent(request,message){
 const entry=piRequestSource(request,message)
 return entry?.type==='custom_message'?entry.details?.event:entry?.type==='message'?entry.message.night?.event:undefined
}
export function bindPiPolicyMessage(request,original,replacement){
 const context=piRequestContext(request),source=context?.sources.get(original)
 if(source)context.sources.set(replacement,source)
 return replacement
}
