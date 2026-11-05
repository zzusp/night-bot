import {createHash} from 'node:crypto'
import {deepFreeze} from './native-values.js'
import {appendDelivery,isRecurringScheduleRecord,resolveRecurringOccurrence,renderReminderFraming,renderRecurringReminderBatchFraming} from './native-schedule-protocol.js'

const MAX_DELAY=2147483647
const identity=occurrences=>'schedule-message-'+createHash('sha256').update(JSON.stringify(occurrences)).digest('hex')

/** Application reminder ledger only. A single accepted row freezes an entire
 * batch before task receipts or the official business input outbox are touched.
 * Pi owns custom-message queueing, inference and admitted-entry recovery. */
export class ScheduleRuntime {
 constructor(ctx,tasks,transact,commit,retention,{deliveries,saveDelivery}){Object.assign(this,{ctx,tasks,transact,commit,retention,deliveries,saveDelivery});this.stopping=false;this.requested=false}
 requestDrive(){
  if(this.stopping)return
  this.requested=true;clearTimeout(this.timer)
  if(this.running)return
  this.running=this.ctx.agents.withoutInitiator(async()=>{
   while(this.requested&&!this.stopping){
    this.requested=false
    const sends=await this.transact(()=>this.drive())
    // Never hold the schedule mutation FIFO across a model turn: the model may
    // legitimately create/update/delete reminders through these same tools.
    for(const send of sends)void send()
   }
  }).catch(error=>this.ctx.logger.warn('schedule: dispatch stopped: '+error.message)).finally(()=>{this.running=undefined;if(this.requested&&!this.stopping)this.requestDrive()})
 }
 async dispose(){this.stopping=true;clearTimeout(this.timer);await this.running}
 async acknowledged(row){
  const live=this.ctx.agents.get(row.sessionId)
  if(live){const status=live.admission.status?.(row.packet.id);return status==='admitted'||status==='cancelled'||live.admission.has(row.packet.id)&&!live.admission.pending().includes(row.packet.id)}
  const saved=await this.ctx.sessionPersistence.readNative(row.sessionId)
  return saved.audit.some(receipt=>receipt.domain==='admission'&&['admitted','cancelled'].includes(receipt.kind)&&receipt.payload.id===row.packet.id)
 }
 async drive(){
  clearTimeout(this.timer)
  const now=Date.now(),failed=new Set(),sends=[],accepted=this.deliveries()
  const covered=new Set(accepted.flatMap(row=>row.packet.source.occurrences.map(item=>JSON.stringify([row.sessionId,item.id,item.target]))))
  const due=this.tasks().filter(task=>task.status==='active'&&Date.parse(task.record.scheduledAt)<=now&&!covered.has(JSON.stringify([task.sessionId,task.record.id,task.record.scheduledAt]))),handled=new Set()
  for(const task of due){
   if(this.stopping)break
   if(handled.has(task.record.id))continue
   const recurring=isRecurringScheduleRecord(task.record),members=recurring?due.filter(member=>member.sessionId===task.sessionId&&isRecurringScheduleRecord(member.record)&&!handled.has(member.record.id)):[task]
   try{
    this.ctx.sessionController.assertOrdinary(await this.ctx.sessionController.header(task.sessionId))
    const occurrences=members.map(member=>({id:member.record.id,target:member.record.scheduledAt,...(isRecurringScheduleRecord(member.record)?resolveRecurringOccurrence(member.record,now):{occurrenceAt:member.record.scheduledAt})}))
    const packet=deepFreeze({id:identity([task.sessionId,occurrences]),source:{kind:'schedule',occurrences},content:[{type:'text',text:recurring?renderRecurringReminderBatchFraming(members.map((member,index)=>({record:member.record,occurrenceAt:occurrences[index].occurrenceAt}))):renderReminderFraming(task.record)}]})
    const row={sessionId:task.sessionId,acceptedAt:new Date().toISOString(),queued:false,packet}
    await this.saveDelivery(row);accepted.push(row)
    for(const member of members)handled.add(member.record.id)
   }catch(error){for(const member of members){handled.add(member.record.id);failed.add(member.record.id)}this.warn(task.record.id,error)}
  }
  for(const row of accepted){
   if(this.stopping)break
   try{
    // Complete partial task-row commits using the accepted snapshot. Changes or
    // deletion after acceptance do not reconstruct or retract the queued input.
    for(const occurrence of row.packet.source.occurrences){
     const member=this.tasks().find(task=>task.record.id===occurrence.id&&task.sessionId===row.sessionId)
     if(!member||member.lastDelivery?.messageId===row.packet.id||member.deliveryHistory?.records.some(receipt=>receipt.messageId===row.packet.id))continue
     if(member.record.scheduledAt!==occurrence.target)continue
     if(row.cancelled){await this.commit({...member,record:{...member.record,scheduledAt:occurrence.nextScheduledAt??occurrence.occurrenceAt},status:occurrence.nextScheduledAt?'active':'inactive'});continue}
     await this.commit({...member,record:{...member.record,scheduledAt:occurrence.nextScheduledAt??occurrence.occurrenceAt},status:occurrence.nextScheduledAt?'active':'inactive',...appendDelivery(member,{scheduledAt:occurrence.occurrenceAt,deliveredAt:row.acceptedAt,messageId:row.packet.id},this.retention)})
    }
    if(row.cancelled)continue
    if(row.queued&&await this.acknowledged(row))continue
    const resolved=await this.ctx.sessionController.resolveAgent(row.sessionId);if(resolved.error)throw resolved.error
    const agent=resolved.agent
    if(agent.admission.status?.(row.packet.id)==='cancelled')continue
    if(typeof agent.input?.enqueue!=='function'||typeof agent.input?.deliver!=='function')throw new Error('NIGHT_SCHEDULE_OFFICIAL_INPUT_REQUIRED')
    await agent.input.enqueue(row.packet)
    if(!row.queued)await this.saveDelivery({...row,queued:true})
    sends.push(async()=>{if(this.stopping)return;try{await agent.input.deliver(row.packet.id,{deliverAs:'followUp'})}catch(error){this.warn(row.packet.id,error)}})
   }catch(error){for(const item of row.packet.source.occurrences)failed.add(item.id);this.warn(row.packet.id,error)}
  }
  if(!this.stopping){const targets=this.tasks().filter(task=>task.status==='active'&&!failed.has(task.record.id)&&!covered.has(JSON.stringify([task.sessionId,task.record.id,task.record.scheduledAt]))).map(task=>Date.parse(task.record.scheduledAt));if(targets.length){this.timer=setTimeout(()=>this.requestDrive(),Math.max(0,Math.min(Math.min(...targets)-Date.now(),MAX_DELAY)));this.timer.unref()}}
  return sends
 }
 warn(id,error){this.ctx.logger.warn(`schedule: reminder ${id} not acknowledged: ${error.message}`)}
}
