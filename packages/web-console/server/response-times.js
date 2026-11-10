import {visibleText} from './session-view.js'
// Source/version and delivered notification receipts are the only timing authority.
// The Host ingress timestamp is not the external message's sent timestamp.
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null
const stamp=value=>instant(value)===null?null:value
const phaseNames={ingress:'消息已接纳',queue:'排队结束',turn:'消息处理完成',host:'安排已提交',send:'发送阶段完成',readback:'可见性核对完成'}
export function responseTiming(message,sources,notifications,routing,{secrets=[]}={}){
 const matches=sources.filter(row=>row.messageId===message.messageId&&row.version===(message.messageVersion??1))
 if(matches.length!==1)return {messageId:message.messageId,status:'unavailable',reason:'历史接收时间或唯一来源关联缺失',receivedAt:null,firstReplyAt:null,durationMs:null,steps:[]}
 const source=matches[0],receivedAt=stamp(source.receivedAt)
 const associated=notifications.filter(row=>row.payload?.conversationId===source.groupId&&row.payload?.sourceId===source.sourceId
  && (row.payload.sourceVersion??row.payload.sourceRef?.messageVersion)===source.version
  && (row.payload.sourceRef?.messageId??row.payload.sourceMessageId)===source.messageId)
 const replies=associated.filter(row=>!row.taskId&&!row.payload.taskDelivery&&['triage-reply','platform-reply','router-reply'].includes(row.kind))
 const unclassified=replies.filter(row=>row.kind==='router-reply'&&!row.payload.replyPurpose)
 const eligible=replies.filter(row=>row.kind!=='router-reply'||['acknowledgement','direct-answer'].includes(row.payload.replyPurpose))
 const confirmed=eligible.filter(row=>row.state==='delivered'&&stamp(row.deliveredAt)).sort((a,b)=>Date.parse(a.deliveredAt)-Date.parse(b.deliveredAt))
 const first=confirmed[0],firstReplyAt=first?.deliveredAt??null
 // Missing timestamps cannot prove a competing reply happened later. A known
 // later delivery, however, does not invalidate the already confirmed first one.
 const uncertain=[...unclassified.filter(row=>!['prepared','failed'].includes(row.state)),...eligible.filter(row=>['unknown','starting'].includes(row.state)||row.state==='delivered'&&!stamp(row.deliveredAt))]
 const earlierUnknown=Boolean(first&&uncertain.some(row=>{
  if(row===first||['prepared','failed'].includes(row.state))return false
  const at=row.state==='delivered'?stamp(row.deliveredAt):null
  const earliest=at??stamp(row.sendStartedAt)??stamp(row.createdAt)
  return !earliest||Date.parse(earliest)<=Date.parse(firstReplyAt)
 }))
 const duration=receivedAt&&firstReplyAt?Date.parse(firstReplyAt)-Date.parse(receivedAt):null
 const steps=[]
 if(receivedAt)steps.push({kind:'received',label:'接收消息',at:receivedAt})
 for(const stage of source.stages??[]){
  if(!phaseNames[stage.stage]||stage.phase)continue
  const start=stamp(stage.startedAt),end=stamp(stage.completedAt),shared=stage.shared===true
  if(stage.stage==='turn'&&start)steps.push({kind:'stage-turn-started',label:'开始处理'+(shared?'（批次共享）':''),at:start,shared})
  if(end)steps.push({kind:`stage-${stage.stage}-completed`,label:phaseNames[stage.stage]+(shared?'（批次共享）':''),at:end,shared,
   ...(start&&Date.parse(end)>=Date.parse(start)?{durationMs:Date.parse(end)-Date.parse(start)}:{})})
 }
 if(stamp(source.routedAt))steps.push({kind:'triage-completed',label:'消息分流完成',at:source.routedAt})
 if(stamp(routing?.event?.consumedAt))steps.push({kind:'routing-completed',label:'本条消息安排已提交',at:routing.event.consumedAt})
 const attempt=[...eligible].filter(row=>stamp(row.createdAt)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0]
 if(attempt){steps.push({kind:'reply-prepared',label:'回复已准备',at:attempt.createdAt});if(stamp(attempt.sendStartedAt))steps.push({kind:'send-started',label:'开始发送',at:attempt.sendStartedAt})}
 if(first)steps.push({kind:'reply-visible',label:earlierUnknown?'一条后续回复已确认可见':'首条回复已确认可见',at:firstReplyAt})
 steps.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
 const status=earlierUnknown?'unconfirmed':duration!==null&&duration>=0?'confirmed':!receivedAt?'unavailable':first?'invalid-time':uncertain.length?'unconfirmed':eligible.some(row=>row.state==='failed')?'failed':eligible.some(row=>row.state==='prepared')?'pending':'no-reply'
 return {messageId:message.messageId,messageVersion:source.version,status,receivedAt,firstReplyAt:status==='confirmed'?firstReplyAt:null,durationMs:status==='confirmed'?duration:null,
  replyPreview:status==='confirmed'?visibleText(first.payload.text??'',secrets,{maxLength:160}).text:null,
  replyMessageId:typeof first?.receipt?.messageId==='string'?first.receipt.messageId:null,
  reason:earlierUnknown?'较早回复用途或可见性未确认，无法确认首答':status==='unavailable'?'历史接收时间缺失':unclassified.length&&!first?'历史 Router 回复用途未记录，不能判定首答':null,
  steps:steps.filter(row=>!firstReplyAt||Date.parse(row.at)<=Date.parse(firstReplyAt))}
}
