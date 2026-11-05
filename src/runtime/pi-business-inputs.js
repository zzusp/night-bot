import {AgentSession} from '@earendil-works/pi-coding-agent'
import {isDeepStrictEqual} from 'node:util'

const bindings=new WeakMap()
const fail=code=>Object.assign(new Error(code),{code})

/** Read official context; application source authority is separately bound to
 * exact actor identity and the application's durable admission records. */
export function officialBusinessProjection(actor){
 if(!(actor?.piSession instanceof AgentSession)||actor.id!==actor.piSession.sessionId)throw fail('BUSINESS_PI_ACTOR_REQUIRED')
 return actor.piSession.sessionManager.buildSessionProjection()
}

export function bindBusinessInputAuthority(actor,port){
 officialBusinessProjection(actor)
 if(typeof port?.lookupPacket!=='function'||typeof port.isLive!=='function')throw new TypeError('Durable admission lookup and live actor capability required')
 const previous=bindings.get(actor)
 if(previous){if(previous.port!==port)throw fail('BUSINESS_INPUT_AUTHORITY_ALREADY_BOUND');return()=>{}}
 const bound={port,lookupPacket:port.lookupPacket.bind(port),isLive:port.isLive.bind(port)}
 bindings.set(actor,bound)
 return()=>{if(bindings.get(actor)===bound)bindings.delete(actor)}
}

/** Return application facts whose exact original body is in current official
 * context. Summaries, edited bodies and injected/provider metadata prove none.
 * This does not reconstruct or cache a second message/context projection. */
export function visibleBusinessInputs(actor){
 const projection=officialBusinessProjection(actor),bound=bindings.get(actor)
 if(!bound)throw fail('BUSINESS_INPUT_AUTHORITY_REQUIRED')
 if(bound.isLive(actor)!==true)throw fail('BUSINESS_INPUT_ACTOR_NOT_LIVE')
 const result=[]
 for(const {sourceEntry:entry,messages}of projection.entries){
  if(entry.type!=='custom_message'||entry.customType!=='night.business-input')continue
  const details=entry.details
  if(!details||typeof details.packetId!=='string'||!details.packetId||Object.keys(details).length!==2||!Object.hasOwn(details,'source'))continue
  const packet=bound.lookupPacket(details.packetId)
  if(packet?.then)throw fail('BUSINESS_INPUT_SYNC_LOOKUP_REQUIRED')
  if(!packet||packet.id!==details.packetId||!isDeepStrictEqual(packet.source,details.source)||!isDeepStrictEqual(packet.content,entry.content))continue
  if(messages.length!==1||messages[0].role!=='custom'||messages[0].customType!=='night.business-input'||!isDeepStrictEqual(messages[0].details,details)||!isDeepStrictEqual(messages[0].content,entry.content))continue
  result.push({entryId:entry.id,packetId:packet.id,source:structuredClone(packet.source),content:structuredClone(packet.content)})
 }
 return result
}

/** Exclude only authenticated application input entries using Pi's public edit
 * operation. Original evidence remains in the tree; no assistant/tool is edited.
 * The caller owns the awaited durability boundary before another request. */
export function retireBusinessInputs(actor,matches){
 if(typeof matches!=='function')throw new TypeError('Business input selector required')
 const selected=visibleBusinessInputs(actor).filter(matches)
 for(const entry of selected)actor.piSession.sessionManager.appendContextEdit(entry.entryId,null)
 return selected.map(entry=>entry.entryId)
}
