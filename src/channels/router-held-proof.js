const readOnly=new Set(['resident_task_query','resident_source_query','resident_source_get','resident_reply_query','platform_task_query','platform_config_query','platform_schedule_list'])
export function noEffectRouterPacket(native,{conversationId,generation,eventId,packetId}){
  const entries=native.entries
  const inputs=entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'
    &&entry.details?.source?.kind==='conversation-router'&&entry.details.source.conversationId===conversationId
    &&entry.details.source.generation===generation&&entry.details.source.eventIds?.includes(eventId)
    &&(!packetId||entry.details.packetId===packetId))
  if(inputs.length!==1)return
  const input=inputs[0],id=input.details.packetId
  const receipts=native.audit.filter(item=>item.domain==='admission'&&item.kind==='admitted'&&item.payload?.id===id)
  if(receipts.length!==1||receipts[0].payload.entryId!==input.id)return
  // Bound the check to the original turn. Later channels may have advanced
  // this shared journal and their work says nothing about the held event.
  for(const entry of entries.slice(entries.indexOf(input)+1)){
    if(entry.type==='custom_message'&&entry.customType==='night.business-input')break
    if(entry.type==='message'&&entry.message.role==='assistant'
      &&entry.message.content.some(block=>block.type==='toolCall'&&!readOnly.has(block.name)))return
    if(entry.type==='message'&&entry.message.role==='toolResult'&&!readOnly.has(entry.message.toolName))return
    if(entry.type==='custom'&&entry.customType==='night.audit'&&['task','job'].includes(entry.data?.domain))return
  }
  return id
}
