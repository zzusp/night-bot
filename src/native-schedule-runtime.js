import {createHash} from 'node:crypto'
import {freezeMessage} from './native-message-protocol.js'
import {appendDelivery,isRecurringScheduleRecord,resolveRecurringOccurrence,renderReminderFraming,renderRecurringReminderBatchFraming} from './native-schedule-protocol.js'

const MAX_DELAY=2147483647
const identity=(task,occurrence)=>'schedule-message-'+createHash('sha256').update(JSON.stringify([task.record.id,occurrence])).digest('hex')

/** One timer and a FIFO shared with mutations. An occurrence's immutable
 * message id bridges the two durable commits (Pi inbox, then schedule receipt).
 * Recovery acknowledges an existing message; it never enqueues it again. */
export class ScheduleRuntime {
  constructor(ctx,tasks,transact,commit,retention){Object.assign(this,{ctx,tasks,transact,commit,retention});this.stopping=false;this.requested=false}
  requestDrive(){
    if(this.stopping)return
    this.requested=true;clearTimeout(this.timer)
    if(this.running)return
    this.running=this.ctx.agents.withoutInitiator(async()=>{
      while(this.requested&&!this.stopping){this.requested=false;await this.transact(()=>this.drive())}
    }).catch(error=>this.ctx.logger.warn('schedule: dispatch stopped: '+error.message)).finally(()=>{this.running=undefined;if(this.requested&&!this.stopping)this.requestDrive()})
  }
  async dispose(){this.stopping=true;clearTimeout(this.timer);await this.running}
  async drive(){
    clearTimeout(this.timer)
    const now=Date.now(),failed=new Set()
    const due=this.tasks().filter(task=>task.status==='active'&&Date.parse(task.record.scheduledAt)<=now),handled=new Set()
    for(const task of due){
      if(this.stopping)return
      if(handled.has(task.record.id))continue
      let members=[task]
      try{
        const resolved=await this.ctx.sessionController.resolveAgent(task.sessionId)
        if(resolved.error)throw resolved.error
        if(this.stopping)return
        const {agent}=resolved,recurring=isRecurringScheduleRecord(task.record)
        const messages=agent.session.snapshotEvents().flatMap(event=>event.type==='agent/inbox/spliced'?event.data.inserted??[]:event.type==='user/message'?[event.data]:[])
        const prior=member=>messages.find(message=>message.source?.kind==='schedule'&&message.source.occurrences?.some(item=>item.id===member.record.id&&item.target===member.record.scheduledAt))
        let message=prior(task)
        if(message){
          // A partially committed batch after a crash retains its original
          // frozen occurrence set, text, next targets and message identity.
          members=due.filter(member=>member.sessionId===task.sessionId&&message.source.occurrences.some(item=>item.id===member.record.id&&item.target===member.record.scheduledAt))
        }else{
          members=recurring?due.filter(member=>member.sessionId===task.sessionId&&isRecurringScheduleRecord(member.record)&&!handled.has(member.record.id)&&!prior(member)):[task]
          const occurrences=members.map(member=>({id:member.record.id,target:member.record.scheduledAt,
            ...(isRecurringScheduleRecord(member.record)?resolveRecurringOccurrence(member.record,Date.now()):{occurrenceAt:member.record.scheduledAt})}))
          const id=identity(task,occurrences)
          message=freezeMessage({id,role:'user',source:{kind:'schedule',occurrences},content:[{type:'text',text:recurring?
            renderRecurringReminderBatchFraming(members.map((member,index)=>({record:member.record,occurrenceAt:occurrences[index].occurrenceAt}))):renderReminderFraming(task.record)}]})
          agent.send(message,'next-turn',false)
        }
        for(const member of members)handled.add(member.record.id)
        // The model never observes an occurrence before its durable receipt.
        if(!await this.ctx.sessions.flush(agent.session))throw new Error('NIGHT_SCHEDULE_INBOX_UNACKNOWLEDGED')
        for(const member of members){
          const occurrence=message.source.occurrences.find(item=>item.id===member.record.id)
          await this.commit({...member,record:{...member.record,scheduledAt:occurrence.nextScheduledAt??occurrence.occurrenceAt},
            status:occurrence.nextScheduledAt?'active':'inactive',
            ...appendDelivery(member,{scheduledAt:occurrence.occurrenceAt,deliveredAt:new Date().toISOString(),messageId:message.id},this.retention)})
        }
        if(agent.inbox.hasPending)agent.wakeDriver()
      }catch(error){
        for(const member of members){handled.add(member.record.id);failed.add(member.record.id)}
        this.ctx.logger.warn(`schedule: reminder ${task.record.id} not acknowledged: ${error.message}`)
      }
    }
    // A receipt can have committed immediately before shutdown, before wakeup.
    // Only an unclaimed durable inbox is eligible; completed turns never replay.
    for(const task of this.tasks())if(!this.stopping&&task.lastDelivery){
      try{
        const existing=this.ctx.agents.get(task.sessionId)
        const cold=existing?undefined:await this.ctx.sessionPersistence.open(task.sessionId,'read')
        let pending
        try{
          const events=existing?.session.snapshotEvents()??(await cold.read()).events
          const inserted=events.find(event=>event.type==='agent/inbox/spliced'&&event.data.inserted?.some(message=>message.id===task.lastDelivery.messageId))
          const claimed=events.some(event=>event.type==='user/message'&&event.data.id===task.lastDelivery.messageId)
          pending=inserted&&!claimed
        }finally{await cold?.close()}
        if(pending&&!failed.has(task.record.id)){const resolved=await this.ctx.sessionController.resolveAgent(task.sessionId);if(resolved.error)throw resolved.error;if(resolved.agent.inbox.hasPending)resolved.agent.wakeDriver()}
      }catch(error){this.ctx.logger.warn('schedule: pending delivery recovery stopped: '+error.message)}
    }
    if(this.stopping)return
    const targets=this.tasks().filter(t=>t.status==='active'&&!failed.has(t.record.id)).map(t=>Date.parse(t.record.scheduledAt))
    if(targets.length){this.timer=setTimeout(()=>this.requestDrive(),Math.max(0,Math.min(Math.min(...targets)-Date.now(),MAX_DELAY)));this.timer.unref()}
  }
}
