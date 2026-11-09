import {AgentSession} from '@earendil-works/pi-coding-agent'

/** Business effect admission over the complete official assistant batch. Pi
 * still owns argument validation, scheduling, result creation and iteration.
 * Inspect every callback, including parallel callbacks, without modifying the
 * native message or its replay/signature metadata. */
export function inspectPiToolCallBatch({assistantMessage,toolCall}={}){
 if(assistantMessage?.role!=='assistant'||!Array.isArray(assistantMessage.content))return 'PI_TOOL_BATCH_INVALID'
 const calls=assistantMessage.content.filter(block=>block?.type==='toolCall'),ids=new Set()
 if(!calls.length||!calls.includes(toolCall))return 'PI_TOOL_BATCH_CALL_MISMATCH'
 for(const call of calls){
  if(typeof call.id!=='string'||!call.id.trim())return 'PI_TOOL_BATCH_CALL_ID_INVALID'
  if(ids.has(call.id))return 'PI_TOOL_BATCH_CALL_ID_DUPLICATE'
  ids.add(call.id)
  if(typeof call.name!=='string'||!call.name.trim())return 'PI_TOOL_BATCH_CALL_NAME_INVALID'
 }
}

export function createPiToolCallBatchGuard(previous){
 if(previous!==undefined&&typeof previous!=='function')throw new TypeError('Official beforeToolCall hook must be a function')
 return async function(context,signal){
  const reason=inspectPiToolCallBatch(context)
  if(reason)return {block:true,terminate:true,reason}
  return previous?.call(this,context,signal)
 }
}

/** Install after SDK/extensions have configured their public hook and before
 * the first prompt. Invalid batches never reach the previous business hook. */
export function bindPiToolCallBatchGuard(session){
 if(!(session instanceof AgentSession))throw new TypeError('Actual official AgentSession required')
 const agent=session.agent,previous=agent.beforeToolCall,guard=createPiToolCallBatchGuard(previous)
 agent.beforeToolCall=guard
 return {close(){if(agent.beforeToolCall===guard)agent.beforeToolCall=previous}}
}
