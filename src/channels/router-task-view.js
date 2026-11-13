// Model-facing projection only. Durable tasks and command receipts remain complete.
// A summary is never evidence for dependency acceptance or a replacement for the
// source/task version fences enforced by the host.
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,structuredClone(value[key])]))
const identity=['taskId','groupId','conversationId','sessionId','ownerActorId','status','control','drained','dependenciesReady','restartRecoveryEligible','requirementRevision','controlRevision','contextRevision','arrangementRevision','runSequence','leaseEpoch','createdAt','updatedAt','archivedAt']
export function routerTaskSummary(task){
  if(!task)return task
  const value=pick(task,identity),truncated=[]
  const preview=(text,path,max=512)=>{if(typeof text!=='string')return text;if(text.length<=max)return text;truncated.push(path);return text.slice(0,max)+'…'}
  const list=(items,path,map=x=>x,limit=5)=>{if(!Array.isArray(items))return undefined;if(items.length>limit)truncated.push(path);return items.slice(0,limit).map(map)}
  for(const key of ['title','objective'])if(task[key]!==undefined)value[key]=preview(task[key],key)
  if(task.requirements!==undefined)value.requirements=list(task.requirements,'requirements',(x)=>preview(x,'requirements[]',256))
  if(task.sourceRefs!==undefined){value.sourceRefs=list(task.sourceRefs,'sourceRefs');value.sourceCount=task.sourceRefs.length}
  if(task.completion===null)value.completion=null
  else if(task.completion){
    value.completion={...pick(task.completion,['at','commandId','runSequence','requirementRevision','controlRevision','contextRevision','leaseEpoch']),summary:preview(task.completion.summary,'completion.summary'),
      resultAvailable:!!task.completion.result}
  }
  if(task.lastDecision)value.lastDecision={...pick(task.lastDecision,['action','at','requirementRevision','controlRevision']),summary:preview(task.lastDecision.summary,'lastDecision.summary')}
  if(task.providerRecovery)value.providerRecovery={...pick(task.providerRecovery,['attempts','requirementRevision','controlRevision','nextAttemptAt','exhausted']),failure:pick(task.providerRecovery.failure,['code','kind'])}
  if(task.archiveRestore)value.archiveRestore=pick(task.archiveRestore,['reviewRequired'])
  if(task.restartRecoveryOperations){value.restartRecoveryOperations=list(task.restartRecoveryOperations,'restartRecoveryOperations');value.restartRecoveryOperationCount=task.restartRecoveryOperations.length}
  if(task.humanRequests){const pending=task.humanRequests.filter(row=>row.status==='waiting-reply');value.pendingQuestions=list(pending,'pendingQuestions',row=>({...pick(row,['requestId','status','requirementRevision','contextRevision','controlRevision']),question:preview(row.question,'pendingQuestions[].question')}));value.pendingQuestionCount=pending.length}
  return {...value,projection:'summary',detailAvailable:true,...truncated.length?{truncatedFields:[...new Set(truncated)]}:{}}
}
export function routerTaskReceipt(receipt){
  if(!receipt?.result)return receipt
  const result={...receipt.result}
  if(result.task)result.task=routerTaskSummary(result.task)
  if(Array.isArray(result.tasks))result.tasks=result.tasks.map(routerTaskSummary)
  return {...receipt,result}
}
