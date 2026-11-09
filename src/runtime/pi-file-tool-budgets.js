import {AgentSession} from '@earendil-works/pi-coding-agent'

const fail=code=>Object.assign(new Error(code),{code})
const positive=value=>Number.isSafeInteger(value)&&value>0
/** Resource accounting for admitted file-tool results in one official assistant
 * batch. This does not replace the full-context request image transform. */
export function createPiFileToolBudgets({actor,maxBatchTransportBytes=33554432}={}){
 if(!actor?.ctx||!positive(maxBatchTransportBytes))throw fail('PI_FILE_BUDGET_CONFIGURATION_INVALID')
 const states=new Map();let session,closed=false
 function state(input){
  const {callId,toolName,signal}=input
  signal?.throwIfAborted()
  if(closed)throw fail('PI_FILE_BUDGET_CLOSED')
  if(input.actor!==actor||!(actor.piSession instanceof AgentSession)||actor.ctx.get('agents')?.get(actor.id)!==actor||actor.ctx.get('agents').currentInitiator()!==actor||actor.lifecycle?.signal.aborted||!actor.lifecycle?.isLive())throw fail('PI_FILE_BUDGET_ACTOR_REQUIRED')
  if(session&&session!==actor.piSession)throw fail('PI_FILE_BUDGET_SESSION_CHANGED')
  session??=actor.piSession
  const assistant=session.sessionManager.getBranch().findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
  const calls=assistant?.message.content.filter(block=>block.type==='toolCall'&&block.id===callId&&block.name===toolName)
  if(calls?.length!==1)throw fail('PI_FILE_BUDGET_CALL_REQUIRED')
  let value=states.get(assistant.id)
  if(!value){states.clear();value={images:0,imageBytes:0,transportBytes:0,imageCalls:new Set(),transportCalls:new Set()};states.set(assistant.id,value)}
  return value
 }
 const imageBudget=Object.freeze({accept(input){
  const value=state(input),limits=actor.ctx.get('attachments')?.imageLimits,images=input.images
  if(!limits||!positive(limits.maxImagesPerMessage)||!positive(limits.maxMessageImageBytes)||!positive(limits.maxImageBytes)||!Array.isArray(images)||!images.length||images.some(image=>!positive(image.bytes)))throw fail('PI_FILE_IMAGE_BUDGET_REQUIRED')
  if(images.some(image=>image.bytes>limits.maxImageBytes))return false
  if(value.imageCalls.has(input.callId))throw fail('PI_FILE_BUDGET_DUPLICATE_RESULT')
  const count=value.images+images.length,bytes=value.imageBytes+images.reduce((total,image)=>total+image.bytes,0)
  if(count>limits.maxImagesPerMessage||bytes>limits.maxMessageImageBytes)return false
  value.images=count;value.imageBytes=bytes;value.imageCalls.add(input.callId);return true
 }})
 const transportBudget=Object.freeze({accept(input){
  const value=state(input),actual=Buffer.byteLength(JSON.stringify(input.result))
  if(!Number.isSafeInteger(input.bytes)||input.bytes!==actual)throw fail('PI_FILE_TRANSPORT_ACCOUNTING_INVALID')
  if(value.transportCalls.has(input.callId))throw fail('PI_FILE_BUDGET_DUPLICATE_RESULT')
  if(value.transportBytes+actual>maxBatchTransportBytes)return false
  value.transportBytes+=actual;value.transportCalls.add(input.callId);return true
 }})
 return Object.freeze({imageBudget,transportBudget,close(){closed=true;states.clear()}})
}
