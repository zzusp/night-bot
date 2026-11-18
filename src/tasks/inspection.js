// Only positive lifecycle evidence is actionable. Silence is never a timeout.
export const WAIT_REVIEW_INTERVAL_MS=24*60*60*1000
export const MIN_WAIT_RECHECK_MS=60*60*1000
export const inspectionVersion=task=>Object.fromEntries(['requirementRevision','controlRevision','contextRevision','leaseEpoch','drained','recovering'].map(key=>[key,task[key]??(key==='contextRevision'?0:null)]))
export const taskWaitIdentity=task=>JSON.stringify([task.requirementRevision,task.controlRevision,task.contextRevision??0,task.leaseEpoch,task.lastDecision?.at,task.lastDecision?.action])
export function inspectionIsCurrent(task){
  const record=task.inspection
  return !!record&&record.requirementRevision===task.requirementRevision&&record.controlRevision===task.controlRevision
    &&(record.contextRevision??0)===(task.contextRevision??0)&&(!record.waitIdentity||record.waitIdentity===taskWaitIdentity(task))
}
export const inspectionHoldsExecution=task=>task.inspection?.pending&&task.inspection.reason!=='wait-overdue'&&inspectionIsCurrent(task)
export function taskInspectionReason(task,{live=false,inflight=false,now=Date.now()}={}){
  if(!task.conversationId||task.archivedAt||task.status!=='active'||task.control!=='active')return
  if(task.effectReconciliations?.some(row=>row.state==='prepared'))return
  if(task.sessionFailure)return 'drain-failed'
  if(live||inflight)return
  if(task.recovering)return 'host-restart'
  if(!task.drained)return 'execution-absent'
  const decisionCurrent=task.lastDecision?.requirementRevision===task.requirementRevision&&task.lastDecision?.controlRevision===task.controlRevision&&(task.lastDecision?.contextRevision??task.claimContextRevision??0)===(task.contextRevision??0)
  if((task.technicalFailure&&decisionCurrent)||task.providerRecovery?.requirementRevision===task.requirementRevision)return 'execution-failed'
  if(decisionCurrent&&task.lastDecision?.limitations?.some(code=>['TASK_SESSION_NO_SUBMISSION','TASK_EFFECT_UNCERTAIN_NO_REPLAY','TASK_JOB_UNCERTAIN_NO_REPLAY'].includes(code)))return 'execution-unresolved'
  const decision=task.lastDecision
  if(!['wait','blocked'].includes(decision?.action)||decision.requirementRevision!==task.requirementRevision||decision.controlRevision!==task.controlRevision||(decision.contextRevision??task.claimContextRevision??0)!==(task.contextRevision??0))return
  const since=Date.parse(decision.at)
  if(!Number.isFinite(since)||now<since+WAIT_REVIEW_INTERVAL_MS)return
  const prior=task.inspection
  if(prior?.reason==='wait-overdue'&&prior.waitIdentity===taskWaitIdentity(task)){
    if(prior.pending||!prior.nextCheckAt||now<Date.parse(prior.nextCheckAt))return
  }
  // Aged waits are advisory Router reviews, never execution wakes. The Router
  // checks user replies, external facts and future schedules before any action.
  return 'wait-overdue'
}
