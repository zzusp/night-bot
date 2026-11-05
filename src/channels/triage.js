import {z} from 'zod'
import {checkedText,hash} from '../memory/format.js'
export const TRIAGE_BATCH_LIMIT=15
const ref=z.object({messageId:z.string().min(1),messageVersion:z.number().int().positive(),quote:z.string().min(1)}).strict()
const feedback=z.object({requestId:z.string(),replies:z.array(z.object({topicKey:z.string().min(1).max(120),source:ref,body:z.string().min(1).max(1000),certainty:z.literal('tentative')}).strict()).max(45),silent:z.array(z.object({messageId:z.string(),messageVersion:z.number().int(),reason:z.string().min(1)}).strict()).max(15)}).strict()
export const feedbackParameters={type:'object',additionalProperties:false,required:['requestId','replies','silent'],properties:{requestId:{type:'string'},replies:{type:'array',maxItems:45,items:{type:'object',required:['topicKey','source','body','certainty'],additionalProperties:false,properties:{topicKey:{type:'string'},source:{type:'object',additionalProperties:false,required:['messageId','messageVersion','quote'],properties:{messageId:{type:'string'},messageVersion:{type:'integer'},quote:{type:'string'}}},body:{type:'string'},certainty:{type:'string',enum:['tentative']}}}},silent:{type:'array',maxItems:15,items:{type:'object',additionalProperties:false,required:['messageId','messageVersion','reason'],properties:{messageId:{type:'string'},messageVersion:{type:'integer'},reason:{type:'string'}}}}}}
export function triageState(request){return {messages:request.messages.map(m=>({messageId:m.messageId,messageVersion:m.messageVersion,epoch:m.routingEpoch??0})),sessionId:request.sessionId,appendGeneration:request.appendGeneration??0,startedAt:request.startedAt,...request.firstReplyAt?{firstReplyAt:request.firstReplyAt}: {},feedbackRefs:request.feedbackRefs??[],sealed:request.sealed===true}}
export function createTriageFeedback({store,appendOutbox,persist}){
  return async(request,input)=>{
    const args=feedback.parse(input);if(!request?.firstTierFeedback||request.sealed)throw Error('triage_batch_unavailable')
    const covered=new Set(),keys=new Set(),outbounds=[]
    const sourceOf=value=>{const source=request.messages.find(m=>m.messageId===value.messageId&&m.messageVersion===value.messageVersion);if(!source)throw Error('triage_source_outside_batch');return source}
    for(const reply of args.replies){const source=sourceOf(reply.source),quote=reply.source.quote;if(!source.text.includes(quote)||source.text.split(quote).length!==2)throw Error('triage_quote_not_unique')
      const body=checkedText(reply.body);if(!/(?:初步|可能|似乎|待核实|待确认|might|may |possibly|tentative)/i.test(body)||/(?:已经完成|已完成|已解决|保证|肯定|确定无误|definitely|certainly|has been completed|is resolved)/i.test(body))throw Error('triage_feedback_too_certain')
      const key=hash(JSON.stringify([request.groupId,source.messageId,source.messageVersion,reply.topicKey]));if(keys.has(key))throw Error('triage_duplicate_topic_reply');keys.add(key);covered.add(source.messageId)
      const outboundId='triage-'+key
      const previous=store.getGroup(request.groupId)?.outbox.find(row=>row.outboundId===outboundId)
      if(previous){if(previous.text!=='初步判断，尚待结合话题进一步核实：'+body)throw Error('triage_feedback_already_frozen');}
      outbounds.push({args:{groupId:request.groupId,outboundId,triage:{topicKey:reply.topicKey,quote},sourceMessageId:'triage:'+source.messageId+':'+source.messageVersion,text:'初步判断，尚待结合话题进一步核实：'+body,replyKind:'confirmation',taskIds:[],topicRefs:[],matterSourceMessageIds:[source.messageId],sourceRef:{messageId:source.messageId,messageVersion:source.messageVersion,actorId:source.senderOpenDingTalkId},replyToMessageId:source.messageId,replyToSenderOpenDingTalkId:source.senderOpenDingTalkId,atOpenDingTalkIds:[source.senderOpenDingTalkId]}})
    }
    for(const silent of args.silent){sourceOf(silent);if(covered.has(silent.messageId))throw Error('triage_feedback_conflicting_coverage');covered.add(silent.messageId)}
    if(request.messages.some(m=>!covered.has(m.messageId)))throw Error('triage_feedback_batch_incomplete')
    // Validate every reference before preparing any effect. Existing outbox receipts
    // own send/readback recovery; an uncertain send is never a fresh send here.
    const accepted=[]
    for(const row of outbounds){if(row.args){const source=row.args.sourceRef;const prepared=await appendOutbox({...row.args,preflight:()=>{const current=store.getGroup(request.groupId)?.messages.find(m=>m.messageId===source.messageId);if(current?.messageVersion!==source.messageVersion)return {status:'source-stale'}}});if(prepared?.status)throw Error('triage_feedback_prepare_'+prepared.status);accepted.push({outboundId:row.args.outboundId})}else accepted.push(row)}
    request.feedbackRefs=[...covered];request.firstReplyAt??=Date.now();await persist(request,{triageBatch:triageState(request)})
    return {status:'accepted',preliminary:true,outbounds:accepted,latencyMs:request.firstReplyAt-request.startedAt}
  }
}
export function appendTriagePacket(request,messages){
  if(request.messages.length>TRIAGE_BATCH_LIMIT)throw Error('triage_batch_limit')
  const existing=new Set(request.messages.map(m=>m.messageId)),added=messages.filter(m=>!existing.has(m.messageId)).slice(0,TRIAGE_BATCH_LIMIT-request.messages.length)
  if(!added.length||request.sealed||!request.envelope)return undefined
  const visible=[]
  for(const message of added){request.messages.push(structuredClone(message));const text=message.text??'',{text:_text,...metadata}=message;request.metadataPages.set(message.messageId,{text:JSON.stringify(metadata),offset:0});const count=Math.min(600,text.length);request.readOffsets.set(message.messageId,count);visible.push({messageId:message.messageId,messageVersion:message.messageVersion,text:text.slice(0,count),...(count<text.length?{textOffset:0,textTotal:text.length,textHasMore:true}:{}),metadataReadCall:{name:'group_topic_route_context_get',arguments:{requestId:request.requestId,messageId:message.messageId,section:'messageMetadata',offset:0}}})}
  request.appendGeneration=(request.appendGeneration??0)+1;request.roundUpdate=true;request.envelope.messages.push(...visible);request.envelope.totalMessages=request.messages.length;request.envelope.hasMoreMessages=request.envelope.messages.some(m=>m.textHasMore)
  return '[GROUP_TOPIC_ROUTE]\n同一初诊批次追加，保持原会话，不重启。以当前完整批次为准；已冻结的初步回复不得重复发送。单批最多15条，后续消息另排批次。\nTopic 请求：'+JSON.stringify(request.envelope)
}
