import {HarnessError} from '../native-llm-errors.js'
import {appendPluginRecord,isApplicationSession} from '../native-session-protocol.js'

export const JOB_REGISTERED='plugin:night-bot/job-registered'
export const JOB_SETTLED='plugin:night-bot/job-settled'
export const JOB_NOT_STARTED='plugin:night-bot/job-not-started'
export const JOB_START_UNCERTAIN='plugin:night-bot/job-start-uncertain'
export class JobLedgerError extends HarnessError{constructor(code,cause){super(code,code,{cause});this.name='JobLedgerError'}}
const failure=(code,cause)=>new JobLedgerError(code,cause)

/** A job receipt is an application event, not a DSH producer ABI or an exit proof.
 * Registration commits before producer invocation. Only an actual producer's done
 * result may mark producerReported; teardown errors never acquire that fact.
 */
export async function prepareJobJournal(ctx,exec,spec,{id,startedAt}){
 const identity=ctx.get('tools')?.executionIdentity(exec),owner=exec?.agent,session=owner?.session,sessions=ctx.get('sessions')
 if(!identity||!owner||identity.owner!==spec.owner||!isApplicationSession(session)||sessions?.get(spec.owner)!==session
   ||ctx.get('agents')?.get(spec.owner)!==owner)throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 const bound={version:1,jobId:id,owner:spec.owner,kind:spec.kind,label:spec.label,startedAt,
  toolCall:{callId:identity.callId,rootCallId:identity.rootCallId,toolName:identity.name}}
 const flush=async()=>{let accepted;try{accepted=await sessions.flush(session)}catch(cause){throw failure('NIGHT_JOB_JOURNAL_UNCERTAIN',cause)}if(accepted!==true)throw failure('NIGHT_JOB_PERSISTENCE_REQUIRED')}
 // A missing sink must be refused before even accepting a registration event.
 await flush()
 exec.signal.throwIfAborted()
 if(!ctx.get('tools')?.executionIdentity(exec))throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 const write=async(type,data)=>{
  try{appendPluginRecord(session,type,{...bound,...data});await flush()}
  catch(cause){throw failure('NIGHT_JOB_JOURNAL_UNCERTAIN',cause)}
 }
 await write(JOB_REGISTERED,{state:'admitted'})
 let terminal=false
 return{
  registered:bound,
  async notStarted(reason){if(terminal)return;terminal=true;await write(JOB_NOT_STARTED,{reason})},
  async startUncertain(error){if(terminal)return;terminal=true;await write(JOB_START_UNCERTAIN,{reason:String(error?.message??error),externalEffectsPossible:true})},
  async settle(outcome,cause,{producerReported,finishedAt}){
   if(terminal)throw failure('NIGHT_JOB_JOURNAL_TERMINAL_DUPLICATE')
   terminal=true
   await write(JOB_SETTLED,{status:outcome.status,...outcome.detail===undefined?{}:{detail:outcome.detail},cause,producerReported,finishedAt})
  },
 }
}

const sameBinding=(a,b)=>a?.version===1&&b?.version===1&&['jobId','owner','kind','label','startedAt'].every(key=>a[key]===b[key])
 &&['callId','rootCallId','toolName'].every(key=>a.toolCall?.[key]===b.toolCall?.[key])
/** Cold journals are observations, never instructions to restart a producer. */
export function unresolvedJobReceipts(events,owner){
 const pending=new Map(),seen=new Set()
 for(const event of events){
  const data=event.data
  if(event.type===JOB_REGISTERED&&data?.owner===owner){
   const invalid=data.version!==1||typeof data.jobId!=='string'||!data.jobId||typeof data.kind!=='string'||!data.kind||typeof data.label!=='string'||!data.label
    ||!Number.isSafeInteger(data.startedAt)||data.startedAt<0||!['callId','rootCallId','toolName'].every(key=>typeof data.toolCall?.[key]==='string'&&data.toolCall[key].length>0)||seen.has(data.jobId)
   seen.add(data.jobId);pending.set(data.jobId,{...data,uncertain:invalid})
  }else if([JOB_SETTLED,JOB_NOT_STARTED,JOB_START_UNCERTAIN].includes(event.type)&&data?.owner===owner){
   const registered=pending.get(data.jobId)
   if(!registered){pending.set(data.jobId,{...data,uncertain:true});seen.add(data.jobId);continue}
   if(registered.uncertain||!sameBinding(registered,data)){registered.uncertain=true;continue}
   if(event.type===JOB_NOT_STARTED&&typeof data.reason==='string'&&data.reason.length>0||event.type===JOB_SETTLED&&data.producerReported===true&&['completed','failed','killed'].includes(data.status)&&Number.isSafeInteger(data.finishedAt)&&data.finishedAt>=data.startedAt)pending.delete(data.jobId)
   else registered.uncertain=true
  }
 }
 return [...pending.values()]
}
export const isJobOutcomeUncertain=result=>['NIGHT_JOB_JOURNAL_UNCERTAIN','NIGHT_JOB_START_UNCERTAIN','NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN'].includes(result?.error?.info?.code)
