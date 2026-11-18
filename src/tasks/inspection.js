// Only positive lifecycle evidence is actionable. Silence is never a timeout.
export const inspectionVersion=task=>Object.fromEntries(['requirementRevision','controlRevision','contextRevision','leaseEpoch','drained','recovering'].map(key=>[key,task[key]??(key==='contextRevision'?0:null)]))
export function taskInspectionReason(task,{live=false,inflight=false}={}){
  if(!task.conversationId||task.archivedAt||task.status!=='active'||task.control!=='active')return
  if(task.effectReconciliations?.some(row=>row.state==='prepared'))return
  if(task.sessionFailure)return 'drain-failed'
  if(live||inflight)return
  if(task.recovering)return 'host-restart'
  if(!task.drained)return 'execution-absent'
  if(task.technicalFailure||task.providerRecovery)return 'execution-failed'
  if(task.lastDecision?.requirementRevision===task.requirementRevision&&task.lastDecision?.controlRevision===task.controlRevision&&task.lastDecision?.limitations?.some(code=>['TASK_SESSION_NO_SUBMISSION','TASK_EFFECT_UNCERTAIN_NO_REPLAY','TASK_JOB_UNCERTAIN_NO_REPLAY'].includes(code)))return 'execution-unresolved'
  // Human, external-event and time waits are owned by existing input/schedule
  // admission. Their age alone cannot manufacture a new execution wake.
}
