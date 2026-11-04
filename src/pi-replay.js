/** Rehydrate provider-native signatures into the authoritative Pi message.
 * Invalid/foreign envelopes stay provider-neutral; the compatibility provider
 * still performs its own diagnostics and never receives invented signatures.
 */
export function restorePiReplay(message, source) {
  const state=source.replayState, response=state?.response
  if(response?.kind!=='pi-ai'||response.version!==2||response.provider!==source.provider||response.model!==source.model||typeof response.api!=='string'||!response.api||!Array.isArray(state.blocks)||state.blocks.length!==message.content.length)return message
  if(!['stop','length','toolUse','error','aborted'].includes(response.stopReason))return message
  const content=[]
  for(let index=0;index<message.content.length;index++) {
    const block=message.content[index],metadata=state.blocks[index]
    const expected=block.type==='thinking'?'reasoning':block.type==='toolCall'?'tool-call':block.type
    if(!metadata||metadata.type!==expected)return message
    const copy={...block}
    for(const key of block.type==='text'?['textSignature']:block.type==='thinking'?['thinkingSignature']:block.type==='toolCall'?['thoughtSignature','namespace']:[]) {
      if(metadata[key]!==undefined){if(typeof metadata[key]!=='string')return message;copy[key]=metadata[key]}
    }
    if(block.type==='thinking'&&metadata.redacted!==undefined){if(typeof metadata.redacted!=='boolean')return message;copy.redacted=metadata.redacted}
    content.push(copy)
  }
  const result={...message,content,api:response.api,stopReason:response.stopReason}
  for(const key of ['responseModel','responseId','providerThinkingLevel'])if(response[key]!==undefined){if(typeof response[key]!=='string')return message;result[key]=response[key]}
  return result
}
