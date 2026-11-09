import {visibleText} from './session-view.js'
// Source/version and delivered notification receipts are the only timing authority.
// The Host ingress timestamp is not the external message's sent timestamp.
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null
const stamp=value=>instant(value)===null?null:value
const phaseNames={ingress:'接收与入库',queue:'排队',turn:'处理批次',host:'提交安排',send:'回复发送',readback:'回复可见性核对'}
export function responseTiming(message,sources,notifications,routing,{secrets=[]}={}){
 const matches=sources.filter(row=>row.messageId===message.messageId&&row.version===(message.messageVersion??1))
 if(matches.length!==1)return {messageId:message.messageId,status:'unavailable',reason:'历史接收时间或唯一来源关联缺失',receivedAt:null,firstReplyAt:null,durationMs:null,steps:[]}
 const source=matches[0],receivedAt=stamp(source.receivedAt)
 const associated=notifications.filter(row=>row.payload?.conversationId===source.groupId&&row.payload?.sourceId===source.sourceId
  && (row.payload.sourceVersion??row.payload.sourceRef?.messageVersion)===source.version
  && (row.payload.sourceRef?.messageId??row.payload.sourceMessageId)===source.messageId)
 const eligible=associated.filter(row=>!row.taskId&&!row.payload.taskDelivery&&['triage-reply','platform-reply','router-reply'].includes(row.kind)
  &&(row.kind!=='router-reply'||['acknowledgement','direct-answer'].includes(row.payload.replyPurpose)))
 const confirmed=eligible.filter(row=>row.state==='delivered'&&stamp(row.deliveredAt)).sort((a,b)=>Date.parse(a.deliveredAt)-Date.parse(b.deliveredAt))
 const first=confirmed[0],firstReplyAt=first?.deliveredAt??null
 const earlierUnknown=first&&eligible.some(row=>row!==first&&['unknown','starting'].includes(row.state)&&stamp(row.sendStartedAt)&&Date.parse(row.sendStartedAt)<=Date.parse(firstReplyAt))
 const duration=receivedAt&&firstReplyAt?Date.parse(firstReplyAt)-Date.parse(receivedAt):null
 const steps=[]
 if(receivedAt)steps.push({label:'Host 接收消息',at:receivedAt})
 for(const stage of source.stages??[]){if(!phaseNames[stage.stage]||stage.phase)continue;const at=stamp(stage.completedAt);if(at)steps.push({label:phaseNames[stage.stage]+(stage.shared?'（批次共享）':''),at})}
 if(stamp(source.routedAt))steps.push({label:'分诊已提交',at:source.routedAt})
 if(stamp(routing?.event?.consumedAt))steps.push({label:'本条消息安排已提交',at:routing.event.consumedAt})
 const attempt=[...eligible].filter(row=>stamp(row.createdAt)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0]
 if(attempt){steps.push({label:'回复已准备',at:attempt.createdAt});if(stamp(attempt.sendStartedAt))steps.push({label:'发送尝试开始',at:attempt.sendStartedAt})}
 if(first)steps.push({label:earlierUnknown?'一条后续回复已确认可见':'首条回复已确认可见',at:firstReplyAt})
 steps.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
 const status=earlierUnknown?'unconfirmed':duration!==null&&duration>=0?'confirmed':!receivedAt?'unavailable':first?'invalid-time':eligible.some(row=>['unknown','starting'].includes(row.state))?'unconfirmed':eligible.some(row=>row.state==='failed')?'failed':eligible.some(row=>row.state==='prepared')?'pending':'no-reply'
 return {messageId:message.messageId,messageVersion:source.version,status,receivedAt,firstReplyAt:status==='confirmed'?firstReplyAt:null,durationMs:status==='confirmed'?duration:null,
  replyPreview:status==='confirmed'?visibleText(first.payload.text??'',secrets,{maxLength:160}).text:null,
  replyMessageId:typeof first?.receipt?.messageId==='string'?first.receipt.messageId:null,
  reason:earlierUnknown?'较早回复可见性未知，无法确认首答':status==='unavailable'?'历史接收时间缺失':associated.some(row=>row.kind==='router-reply'&&!row.payload.replyPurpose)&&!first?'历史 Router 回复用途未记录，不能判定首答':null,
  steps:steps.filter(row=>!firstReplyAt||Date.parse(row.at)<=Date.parse(firstReplyAt))}
}
