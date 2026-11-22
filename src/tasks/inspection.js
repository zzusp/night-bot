// Only positive lifecycle evidence is actionable. Silence is never a timeout.
export const taskProviderFailureLabels=Object.freeze({
  TIMEOUT:'模型请求超时。',
  CONTEXT_WINDOW_EXCEEDED:'本轮输入超过模型服务允许的大小。',
  POLICY_REFUSAL:'模型服务因内容策略拒绝了本轮请求。',
})
export const MIN_WAIT_RECHECK_MS=60*60*1000
const executionIdentity=['requirementRevision','controlRevision','contextRevision','leaseEpoch']
export const inspectionVersion=task=>Object.fromEntries([...executionIdentity,'drained','recovering'].map(key=>[key,task[key]??(key==='contextRevision'?0:null)]))
export const taskWaitIdentity=task=>JSON.stringify([task.requirementRevision,task.controlRevision,task.contextRevision??0,task.leaseEpoch,task.lastDecision?.at,task.lastDecision?.action])
const matchesExecution=(task,record)=>!!record&&executionIdentity.every(key=>(record[key]??0)===(task[key]??0))
export const interruptionIsCurrent=task=>matchesExecution(task,task.interruption)
export function inspectionIsCurrent(task){
  const record=task.inspection
  return matchesExecution(task,record)&&(!record.waitIdentity||record.waitIdentity===taskWaitIdentity(task))
}
export const inspectionHoldsExecution=task=>task.inspection?.pending&&task.inspection.reason!=='wait-overdue'&&inspectionIsCurrent(task)
export function taskInspectionReason(task,{inflight=false}={}){
  if(!task.conversationId||task.archivedAt||task.status!=='active'||task.control!=='active')return
  if(task.sessionFailure?.code==='TASK_SESSION_DRAIN_FAILED')return 'drain-failed'
  if(inflight)return
  if(task.recovering)return 'host-restart'
  if(interruptionIsCurrent(task))return 'execution-failed'
  if(!task.drained)return 'execution-absent'
}
