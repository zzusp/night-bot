import {AgentSession,resizeImage} from '@earendil-works/pi-coding-agent'
import {createHash} from 'node:crypto'
import {inspectImage} from '../native-attachment-codec.js'
import {piRequestImageDimensions} from '../pi-provider-image.js'
import {LlmError} from '../native-llm-errors.js'

const fail=(code,message=code,details)=>new LlmError(message,code,details)
const defaults={maxSourceImageBytes:20971520,maxSourceImagePixels:64000000}
function limitsOf(input){
 if(!input||typeof input!=='object')throw fail('PI_REQUEST_IMAGE_LIMITS_REQUIRED')
 const limits={...defaults,...input}
 for(const name of ['requestImagePixelBudget','requestImageMaxBytes','maxRequestImageBytes','maxSourceImageBytes','maxSourceImagePixels'])if(!Number.isSafeInteger(limits[name])||limits[name]<1)throw fail('PI_REQUEST_IMAGE_LIMITS_REQUIRED','Invalid '+name)
 return limits
}
const signed=message=>message.responseId!==undefined||message.content.some(block=>block.textSignature!==undefined||block.thinkingSignature!==undefined||block.thoughtSignature!==undefined||block.redacted===true)
const canonicalMime=value=>typeof value==='string'?value.split(';')[0].trim().toLowerCase().replace('image/jpg','image/jpeg'):undefined
function decode(block,limit){
 if(typeof block.data!=='string'||!block.data||block.data.length>Math.ceil(limit/3)*4)throw fail('PI_REQUEST_IMAGE_SOURCE_LIMIT')
 const bytes=Buffer.from(block.data,'base64')
 if(bytes.byteLength>limit)throw fail('PI_REQUEST_IMAGE_SOURCE_LIMIT')
 if(bytes.toString('base64')!==block.data)throw fail('PI_REQUEST_IMAGE_DATA_INVALID')
 return bytes
}
/** Narrow request-only policy over official native messages. No conversion of
 * roles, tools, summaries, history or provenance; durable entries stay intact.
 * Aggregate bytes mean base64 wire bytes, counting every image occurrence. */
export async function limitPiRequestImages(messages,{model,limits:input,signal}={}){
 const limits=limitsOf(input),cache=new Map(),derived=[];let imageCount=0,base64Bytes=0,encodedBytes=0,changed=false
 if(!Array.isArray(messages))throw fail('PI_REQUEST_IMAGE_MESSAGES_REQUIRED')
 for(const message of messages){
  signal?.throwIfAborted()
  if(!Array.isArray(message.content)||!message.content.some(block=>block.type==='image')){derived.push(message);continue}
  if(message.role==='assistant')throw fail(signed(message)?'PI_SIGNED_ASSISTANT_IMAGE_POLICY_CONFLICT':'PI_REQUEST_IMAGE_ROLE_UNSUPPORTED')
  if(!['user','toolResult','custom'].includes(message.role))throw fail('PI_REQUEST_IMAGE_ROLE_UNSUPPORTED')
  if(!model?.input?.includes('image'))throw fail('PI_REQUEST_MODEL_IMAGE_UNSUPPORTED')
  const content=[];let messageChanged=false
  for(const block of message.content){
   if(block.type!=='image'){content.push(block);continue}
   signal?.throwIfAborted()
   const bytes=decode(block,limits.maxSourceImageBytes),key=createHash('sha256').update(bytes).update('\0'+block.mimeType).digest('hex')
   let image=cache.get(key)
   if(!image){
    const source=await inspectImage(bytes,{maxPixels:limits.maxSourceImagePixels})
    if(source.mediaType!==canonicalMime(block.mimeType))throw fail('PI_REQUEST_IMAGE_TYPE_MISMATCH')
    if(source.width*source.height<=limits.requestImagePixelBudget&&bytes.byteLength<=limits.requestImageMaxBytes)image={data:block.data,mimeType:block.mimeType,bytes:bytes.byteLength}
    else{
     const target=piRequestImageDimensions(source.width,source.height,limits.requestImagePixelBudget),resized=await resizeImage(bytes,source.mediaType,{maxWidth:target.width,maxHeight:target.height,maxBytes:limits.requestImageMaxBytes})
     signal?.throwIfAborted()
     if(!resized)throw fail('PI_REQUEST_IMAGE_DERIVATIVE_UNAVAILABLE')
     const output=decode(resized,limits.requestImageMaxBytes),verified=await inspectImage(output,{maxPixels:limits.requestImagePixelBudget})
     if(output.byteLength>limits.requestImageMaxBytes||verified.width*verified.height>limits.requestImagePixelBudget||verified.mediaType!==canonicalMime(resized.mimeType))throw fail('PI_REQUEST_IMAGE_DERIVATIVE_LIMIT')
     image={data:resized.data,mimeType:resized.mimeType,bytes:output.byteLength}
    }
    cache.set(key,image)
   }
   imageCount++;base64Bytes+=Buffer.byteLength(image.data);encodedBytes+=image.bytes
   if(base64Bytes>limits.maxRequestImageBytes)throw fail('IMAGE_OFFLOAD_REQUIRED','Request image budget exceeded',{imageCount,base64Bytes,maxRequestImageBytes:limits.maxRequestImageBytes})
   const next=image.data===block.data&&image.mimeType===block.mimeType?block:{...block,data:image.data,mimeType:image.mimeType}
   messageChanged||=next!==block;content.push(next)
  }
  derived.push(messageChanged?{...message,content}:message);changed||=messageChanged
 }
 signal?.throwIfAborted()
 return {messages:changed?derived:messages,usage:Object.freeze({imageCount,base64Bytes,encodedBytes})}
}
/** Public Agent transform runs before official convertToLlm and dispatch. Unlike
 * before_provider_request, its rejection is not absorbed by ExtensionRunner.
 * Factory callers should inspect failure after prompt/whenIdle to retain the
 * original typed reason if AgentSession renders an inference error message. */
export function bindPiRequestImageBudget({session,getLimits}={}){
 if(!(session instanceof AgentSession)||typeof getLimits!=='function')throw fail('PI_REQUEST_IMAGE_BINDING_REQUIRED')
 const agent=session.agent,previous=agent.transformContext;let failure,usage,closed=false
 const unsubscribe=agent.subscribe(event=>{if(event.type==='agent_start')failure=undefined})
 const transform=async(messages,signal)=>{
  if(closed)throw fail('PI_REQUEST_IMAGE_BUDGET_CLOSED')
  try{
   const current=previous?await previous(messages,signal):messages
   const result=await limitPiRequestImages(current,{model:session.model,limits:await getLimits(session.model),signal})
   usage=result.usage;return result.messages
  }catch(cause){failure=cause;throw cause}
 }
 agent.transformContext=transform
 return {get failure(){return failure},get usage(){return usage},close(){closed=true;unsubscribe();if(agent.transformContext===transform)agent.transformContext=previous}}
}
