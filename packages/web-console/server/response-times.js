import {visibleText} from './session-view.js'
// 计时只认 Host 接收和可靠送达；共同回复的来源覆盖由 Host 历史快照证明。
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null
const stamp=value=>instant(value)===null?null:value
const phaseNames={ingress:'消息已接纳',queue:'排队结束',turn:'消息处理完成',host:'安排已提交',send:'发送阶段完成',readback:'可见性核对完成',triage:'消息分流完成',router:'消息处理完成'}
export function responseTiming(message,sources,notifications,routing,{secrets=[],taskReplySources=[]}={}){
 const matches=sources.filter(row=>row.messageId===message.messageId&&row.version===(message.messageVersion??1))
 if(matches.length!==1)return {messageId:message.messageId,status:'unavailable',reason:'历史接收时间或唯一来源关联缺失',receivedAt:null,firstReplyAt:null,durationMs:null,steps:[]}
 const source=matches[0],receivedAt=stamp(source.receivedAt)
 const direct=row=>row.payload?.sourceId===source.sourceId
  &&(row.payload.sourceVersion??row.payload.sourceRef?.messageVersion)===source.version
  &&(row.payload.sourceRef?.messageId??row.payload.sourceMessageId)===source.messageId
 const associated=notifications.filter(row=>row.payload?.conversationId===source.groupId&&(direct(row)
  ||taskReplySources.some(ref=>ref.notificationId===row.id&&ref.taskId===row.taskId&&ref.sourceId===source.sourceId&&ref.messageVersion===source.version)))
 const confirmed=associated.filter(row=>row.state==='delivered'&&stamp(row.deliveredAt)).sort((a,b)=>Date.parse(a.deliveredAt)-Date.parse(b.deliveredAt))
 const first=confirmed[0],firstReplyAt=first?.deliveredAt??null
 // Missing timestamps cannot prove a competing reply happened later. A known
 // later delivery, however, does not invalidate the already confirmed first one.
 const uncertain=associated.filter(row=>['unknown','starting'].includes(row.state)||row.state==='delivered'&&!stamp(row.deliveredAt))
 const earlierUnknown=Boolean(first&&uncertain.some(row=>{
  if(row===first||['prepared','failed'].includes(row.state))return false
  const at=row.state==='delivered'?stamp(row.deliveredAt):null
  const earliest=at??stamp(row.sendStartedAt)??stamp(row.createdAt)
  return !earliest||Date.parse(earliest)<=Date.parse(firstReplyAt)
 }))
 const duration=receivedAt&&firstReplyAt?Date.parse(firstReplyAt)-Date.parse(receivedAt):null
 const steps=[]
 let measuredTriage=false
 if(receivedAt)steps.push({kind:'received',label:'接收消息',at:receivedAt,timingType:'milestone'})
 for(const stage of source.stages??[]){
  if(!phaseNames[stage.stage]||stage.phase)continue
  const start=stamp(stage.startedAt),end=stamp(stage.completedAt),shared=stage.shared===true
  if(['triage','router'].includes(stage.stage)){
   // A completed Host span is measured, not the gap between adjacent milestones.
   // A reply can become visible while the Router continues; retain only the
   // observed overlap, without claiming the entire run ended at that receipt.
   if(!start||firstReplyAt&&Date.parse(start)>Date.parse(firstReplyAt))continue
   const measured=end&&Date.parse(end)>=Date.parse(start)
   const clipped=measured&&firstReplyAt&&Date.parse(end)>Date.parse(firstReplyAt)
   const at=clipped?firstReplyAt:end??start
   const label=stage.stage==='triage'?'消息分流':'Router 处理'
   if(stage.stage==='router')steps.push({kind:'stage-router-started',label:'Router 开始准备'+(shared?'（批次共享）':''),at:start,shared,timingType:'milestone'})
   steps.push({kind:`stage-${stage.stage}-completed`,label:label+(clipped?'（截至回复可见）':'')+(shared?'（批次共享）':''),at,shared,timingType:'span',
    ...(measured?{durationMs:Date.parse(at)-Date.parse(start)}:{})})
   if(stage.stage==='triage'&&measured)measuredTriage=true
   continue
  }
  if(stage.stage==='turn'&&start)steps.push({kind:'stage-turn-started',label:'开始处理'+(shared?'（批次共享）':''),at:start,shared,timingType:'milestone'})
  if(end)steps.push({kind:`stage-${stage.stage}-completed`,label:phaseNames[stage.stage]+(shared?'（批次共享）':''),at:end,shared,timingType:'span',
   ...(start&&Date.parse(end)>=Date.parse(start)?{durationMs:Date.parse(end)-Date.parse(start)}:{})})
 }
 if(!measuredTriage&&stamp(source.routedAt))steps.push({kind:'triage-completed',label:'消息分流完成',at:source.routedAt,timingType:'milestone'})
 if(stamp(routing?.event?.consumedAt))steps.push({kind:'routing-completed',label:'本条消息安排已提交',at:routing.event.consumedAt,timingType:'milestone'})
 const attempt=[...associated].filter(row=>stamp(row.createdAt)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))[0]
 if(attempt){steps.push({kind:'reply-prepared',label:'回复已准备',at:attempt.createdAt,timingType:'milestone'});if(stamp(attempt.sendStartedAt))steps.push({kind:'send-started',label:'开始发送',at:attempt.sendStartedAt,timingType:'milestone'})}
 if(first)steps.push({kind:'reply-visible',label:earlierUnknown?'一条后续回复已确认可见':'首条回复已确认可见',at:firstReplyAt,timingType:'milestone'})
 steps.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))
 const decision=routing?.triage?.state==='committed'?routing.triage.decision:null
 const missingDeliveryTime=associated.some(row=>row.state==='delivered'&&!stamp(row.deliveredAt))
 let status
 if(earlierUnknown)status='unconfirmed'
 else if(duration!==null&&duration>=0)status='confirmed'
 else if(!receivedAt)status='unavailable'
 else if(first)status='invalid-time'
 else if(associated.some(row=>['unknown','starting'].includes(row.state)))status='unconfirmed'
 else if(associated.some(row=>row.state==='failed'))status='failed'
 else if(associated.some(row=>row.state==='prepared'))status='pending'
 else if(missingDeliveryTime)status='unconfirmed'
 else if(!associated.length&&decision?.needsHandling===false&&!decision.reply)status='no-reply'
 else if(decision)status=decision.needsHandling&&routing?.event?.state!=='consumed'?'awaiting-handling':'awaiting-reply'
 else status=routing?.triage?.state==='pending'?'awaiting-handling':'unavailable'
 const shared=first&&!direct(first)
 const reason=earlierUnknown?'较早回复可见性未知，无法确认首答':status==='confirmed'&&shared?'此回复通过精确来源绑定及回复前已提交的任务快照关联，为共同任务回复。':status==='no-reply'?'一级分诊明确无需处理且无需回复。':status==='awaiting-handling'?'消息仍待分诊或 Router 处理，尚未取得首答回执。':status==='awaiting-reply'?'消息安排已提交，尚未找到本条消息或明确关联任务的回复回执。':status==='unavailable'?!receivedAt?'历史接收时间缺失':missingDeliveryTime?'回复已送达，但历史确认时间缺失':'缺少明确处置记录，无法判定首答状态':null
 return {messageId:message.messageId,messageVersion:source.version,status,receivedAt,firstReplyAt:status==='confirmed'?firstReplyAt:null,durationMs:status==='confirmed'?duration:null,
  replyPreview:status==='confirmed'?visibleText(first.payload.text??'',secrets,{maxLength:160}).text:null,
  replyMessageId:typeof first?.receipt?.messageId==='string'?first.receipt.messageId:null,
  replyAssociation:status==='confirmed'?shared?'task':'direct':null,reason,
  steps:steps.filter(row=>!firstReplyAt||Date.parse(row.at)<=Date.parse(firstReplyAt))}
}

// Selection starts from a real visible ledger/inbox/outbox row, not adjacent text.
export async function selectedResponseTiming({selected,selectedMessageId,selectedMessageVersion,conversationId,store,secrets=[]}) {
 const base={selectedMessageId,items:[],total:0,nextOffset:null,coverage:'selected-message',scope:'host-received-to-first-confirmed-source-reply'}
 const unavailable=reason=>({...base,status:'unavailable',reason})
 if(!selected)return unavailable('未找到该消息的唯一历史关联')
 let context,rows
 if(selected.role==='user'){
  const version=selected.messageVersion
  if(!Number.isSafeInteger(version)||version<1||selectedMessageVersion!==undefined&&version!==selectedMessageVersion)return unavailable('消息版本已变化或历史版本缺失')
  rows=[selected]
  context=await store.query({kind:'observer.message-contexts',groupId:conversationId,messageIds:[selected.messageId],messages:[{messageId:selected.messageId,version}]})
 }else{
  context=await store.query({kind:'observer.notification-sources',groupId:conversationId,notificationId:selected.notificationId})
  rows=context.sources.map(source=>({messageId:source.messageId,messageVersion:source.version,text:source.text}))
 }
 // Fail closed on duplicate source/version identities. Never choose an arbitrary one.
 if(!rows.length||rows.length>100||rows.some(row=>context.sources.filter(source=>source.groupId===conversationId&&source.messageId===row.messageId&&source.version===row.messageVersion).length!==1))return unavailable('历史来源或唯一版本关联不足')
 const items=await Promise.all(rows.map(async row=>{
  const source=context.sources.find(source=>source.groupId===conversationId&&source.messageId===row.messageId&&source.version===row.messageVersion)
  const routing=await store.query({kind:'router.source-status',sourceId:source.sourceId})
  return {...responseTiming(row,context.sources,context.notifications,routing,{secrets,taskReplySources:context.taskReplySources}),preview:visibleText(row.text??'',secrets,{maxLength:120}).text}
 }))
 return {...base,status:'ready',items,total:items.length}
}
