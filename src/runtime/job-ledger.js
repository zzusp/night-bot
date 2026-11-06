import {z} from 'zod'
import {officialWorkingDirectoryOrigin} from '../native-working-directory.js'
import {HarnessError} from '../native-llm-errors.js'

export const JOB_REGISTERED='plugin:night-bot/job-registered'
export const JOB_SETTLED='plugin:night-bot/job-settled'
export const JOB_NOT_STARTED='plugin:night-bot/job-not-started'
export const JOB_START_UNCERTAIN='plugin:night-bot/job-start-uncertain'
export class JobLedgerError extends HarnessError{constructor(code,cause){super(code,code,{cause});this.name='JobLedgerError'}}
const failure=(code,cause)=>new JobLedgerError(code,cause)

const nonempty=z.string().min(1),time=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const base={version:z.literal(1),jobId:nonempty,owner:nonempty,kind:nonempty,label:nonempty,startedAt:time,toolCall:z.strictObject({callId:nonempty,rootCallId:nonempty,toolName:nonempty})}
const receiptSchemas={
 registered:z.strictObject({...base,state:z.literal('admitted')}),
 settled:z.strictObject({...base,status:z.enum(['completed','failed','killed']),detail:z.string().optional(),cause:nonempty,producerReported:z.boolean(),finishedAt:time,completionNotice:z.enum(['pending','suppressed']).optional(),outputLimitBytes:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional()}).refine(value=>value.finishedAt>=value.startedAt),
 'not-started':z.strictObject({...base,reason:nonempty}),
 'start-uncertain':z.strictObject({...base,reason:nonempty,externalEffectsPossible:z.literal(true)}),
}
export const jobReceiptKinds=Object.freeze(Object.fromEntries(Object.entries(receiptSchemas).map(([kind,schema])=>['job/'+kind,value=>schema.safeParse(value).success])))
const nativeKinds={registered:JOB_REGISTERED,settled:JOB_SETTLED,'not-started':JOB_NOT_STARTED,'start-uncertain':JOB_START_UNCERTAIN}
/** Actor identity is authenticated by live ownership and private business ports,
 * never an id in tool arguments or messages. Drain/check callers need no active
 * tool; effect admission additionally requires the existing initiator slot. */
export function assertOfficialJobOwner(ctx,actor,{requireInitiator=false}={}){
 if(!actor?.piSession||ctx.get('agents')?.get(actor.id)!==actor||requireInitiator&&ctx.get('agents')?.currentInitiator()!==actor)throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 try{officialWorkingDirectoryOrigin(actor);ctx.get('sandboxPolicy').resolve({actor})}catch(cause){throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED',cause)}
 return actor
}
export function officialJobEvents(receipts,owner){
 if(!Array.isArray(receipts)||typeof owner!=='string'||!owner)throw failure('NIGHT_JOB_RECEIPTS_REQUIRED')
 const events=[]
 for(const receipt of receipts){
  if(receipt?.domain!=='job')continue
  if(Object.keys(receipt).some(key=>!['version','domain','kind','payload'].includes(key))||receipt.version!==1||!Object.hasOwn(receiptSchemas,receipt.kind)||!receiptSchemas[receipt.kind].safeParse(receipt.payload).success)throw failure('NIGHT_JOB_RECEIPT_INVALID')
  if(receipt.payload.owner===owner)events.push({type:nativeKinds[receipt.kind],data:receipt.payload})
 }
 return events
}
export function unresolvedNativeJobReceipts(receipts,owner){return unresolvedJobReceipts(officialJobEvents(receipts,owner),owner)}
async function prepareOfficialJobJournal(ctx,exec,spec,{id,startedAt},identity){
 const owner=assertOfficialJobOwner(ctx,exec.agent,{requireInitiator:true}),port=owner.receipts
 if(identity.owner!==owner.id||spec.owner!==owner.id||!port||!['append','read','commit'].every(key=>typeof port[key]==='function'))throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 const bound={version:1,jobId:id,owner:owner.id,kind:spec.kind,label:spec.label,startedAt,toolCall:{callId:identity.callId,rootCallId:identity.rootCallId,toolName:identity.name}}
 const commit=async()=>{try{await port.commit()}catch(cause){throw failure('NIGHT_JOB_JOURNAL_UNCERTAIN',cause)}}
 await commit();exec.signal.throwIfAborted()
 const active=ctx.get('tools')?.executionIdentity(exec)
 if(!active||!['callId','rootCallId','name','owner'].every(key=>active[key]===identity[key]))throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 const write=async(kind,data)=>{try{const receipt={version:1,domain:'job',kind,payload:{...bound,...data}};if(!jobReceiptKinds['job/'+kind](receipt.payload))throw failure('NIGHT_JOB_RECEIPT_INVALID');const entryId=await port.append(receipt);if(typeof entryId!=='string'||!entryId)throw failure('NIGHT_JOB_RECEIPT_ID_REQUIRED');await commit();return entryId}catch(cause){throw failure('NIGHT_JOB_JOURNAL_UNCERTAIN',cause)}}
 await write('registered',{state:'admitted'})
 let terminal=false,terminalReceiptId
 return {registered:bound,get terminalReceiptId(){return terminalReceiptId},
  async notStarted(reason){if(terminal)return;terminal=true;terminalReceiptId=await write('not-started',{reason})},
  async startUncertain(error){if(terminal)return;terminal=true;terminalReceiptId=await write('start-uncertain',{reason:String(error?.message??error)||'uncertain producer start',externalEffectsPossible:true})},
  async settle(outcome,cause,{producerReported,finishedAt,completionNotice,outputLimitBytes}){if(terminal)throw failure('NIGHT_JOB_JOURNAL_TERMINAL_DUPLICATE');terminal=true;terminalReceiptId=await write('settled',{status:outcome.status,...outcome.detail===undefined?{}:{detail:outcome.detail},cause,producerReported,finishedAt,...completionNotice===undefined?{}:{completionNotice},...outputLimitBytes===undefined?{}:{outputLimitBytes}})},
 }
}

/** A job receipt is an application event, not a DSH producer ABI or an exit proof.
 * Registration commits before producer invocation. Only an actual producer's done
 * result may mark producerReported; teardown errors never acquire that fact.
 */
export async function prepareJobJournal(ctx,exec,spec,{id,startedAt}){
 const identity=ctx.get('tools')?.executionIdentity(exec)
 if(!identity||!exec?.agent?.piSession)throw failure('NIGHT_JOB_CALL_OWNERSHIP_REQUIRED')
 return prepareOfficialJobJournal(ctx,exec,spec,{id,startedAt},identity)
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
