import {isDeepStrictEqual} from 'node:util'
import {deepFreeze} from '../native-values.js'
import {LlmError} from '../native-llm-errors.js'
// Request-local provenance associates official Pi messages with entries from the
// live Night journal owner. This is application policy context, not model history.
const contexts=new WeakMap()
export function createPiRequestContext(authority,id){
 const context=authority.context(id,{projectionOnly:true}),projection=context.projection
 if(!Array.isArray(projection?.entries)||!Array.isArray(context.piMessages)||context.piMessages!==projection.messages)throw new LlmError('Official Pi request projection is required','PI_REQUEST_PROJECTION_REQUIRED')
 deepFreeze(projection)
 return createPiProjectionRequest(projection,context.piMessages)
}
/** Sources are obtained from the official readonly SessionManager projection,
 * never message-supplied provider metadata. Hook-added messages stay untrusted. */
export function createPiProjectionRequest(projection,messages=projection.messages){
 if(!Array.isArray(projection?.entries)||!Array.isArray(messages))throw new LlmError('Official Pi projection required','PI_REQUEST_PROJECTION_REQUIRED')
 const sources=new WeakMap()
 for(const entry of projection.entries)for(const message of entry.messages)sources.set(message,entry.sourceEntry)
 // Pi extension runner clones the transcript and removes system messages before
 // context hooks. Bind that official clone only when its complete sequence is
 // identical; an earlier extension edit cannot invent source authority.
 const visible=projection.messages.filter(message=>message.role!=='system')
 if(messages!==projection.messages&&isDeepStrictEqual(messages,visible))for(let index=0;index<messages.length;index++){
  const source=sources.get(visible[index]);if(source)sources.set(messages[index],source)
 }
 const token=Object.freeze({})
 contexts.set(token,{projection,sources})
 return {messageFormat:'pi',piContext:token,messages}
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
