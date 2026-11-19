// Read-only model projection: no journal mutation and no synthetic toolResult.
// A fresh Pi prompt never executes these historical calls. Their unknown state
// remains explicit data so the Router can inspect the original Host receipts.
export function unresolvedRouterCalls(messages){
 const calls=new Map()
 for(const message of messages){
  if(message.role==='assistant'&&message.stopReason!=='aborted')for(const block of message.content??[])if(block.type==='toolCall')calls.set(block.id,block)
  if(message.role==='toolResult'&&calls.get(message.toolCallId)?.name===message.toolName)calls.delete(message.toolCallId)
 }
 return [...calls.values()]
}
export function projectInterruptedRouterCalls(messages){
 const results=new Set(messages.filter(message=>message.role==='toolResult').map(message=>JSON.stringify([message.toolCallId,message.toolName])))
 return messages.map(message=>{
  if(message.role!=='assistant'||!message.content?.some(block=>block.type==='toolCall'&&!results.has(JSON.stringify([block.id,block.name]))))return message
  return {...message,content:message.content.map(block=>block.type==='toolCall'&&!results.has(JSON.stringify([block.id,block.name]))?{type:'text',text:JSON.stringify({kind:'interrupted-tool-call',status:'unknown',callId:block.id,toolName:block.name,arguments:block.arguments})}:block)}
 })
}
