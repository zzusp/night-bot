import {routerTriageConclusion} from './triage-conclusion.js'
import {conversationSource} from './message-safety.js'

const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))

/** Model input is a business view, never a replacement for the durable inbox.
 * Keep user text, quotes and attachments exact. Delivery receipts, retry tokens,
 * duplicate identifiers and source-processing bookkeeping stay with the Host.
 */
export function routerModelEvent(event){
  const view=pick(event,['id','kind','sourceId','messageVersion','taskId','taskEventId','directRouter'])
  if(event.kind==='operator.message')view.operator=pick(event.operator,['requestId','actorId','text','destination'])
  if(event.source){
    const source=conversationSource(event.source)
    view.source=pick(source,['sourceId','conversationId','messageId','version','actorId','senderName','channel','text','quote','resources','timestamp','retracted','authorizationRevoked','triageHold','archiveRestoreHold'])
  }else Object.assign(view,pick(event,['sourceId','messageVersion']))
  const conclusion=routerTriageConclusion(event)
  if(conclusion)view.triageConclusion=conclusion
  if(event.triageReply){
    const reply=event.triageReply
    // State must not be interpreted as a receipt: prepared/unknown is not sent.
    view.triageReply={id:reply.id,kind:reply.kind,state:reply.state,payload:{text:reply.payload?.text}}
  }
  // Task event payloads carry completion/effect evidence, not source delivery
  // bookkeeping. Preserve their exact semantics until a dedicated DTO exists.
  if(event.taskEvent!==undefined)view.taskEvent=event.taskEvent
  return view
}

export function routerModelBody(row,batch){
  return {conversationId:row.id,generation:row.generation,events:batch.map(routerModelEvent)}
}

/** 128 KiB packing target, not a truncation limit. A single larger original is
 * delivered intact and alone; never silently drop the tail of user instructions.
 */
export function routerModelBatch(row,inbox){
  const batch=[]
  let users=0
  for(const event of inbox){
    if(batch.length&&(event.kind==='operator.message')!==(batch[0].kind==='operator.message'))break
    if(['source.message','operator.message'].includes(event.kind)&&users>=15)break
    const candidate=[...batch,event]
    if(batch.length&&Buffer.byteLength(JSON.stringify(routerModelBody(row,candidate)))>131072)break
    batch.push(event)
    if(['source.message','operator.message'].includes(event.kind))users++
  }
  return batch
}
