import {checkedTextWithLimit} from './format.js'

// Only committed ledger facts enter this input. No transcript expansion, tool
// argument scraping, or inference of missing evidence from task status.
export function reflectionInput(task,event,executions=[],operations=[]){
 const coverage={truncatedFields:[],omittedCounts:{executions:Math.max(0,executions.length-12),operations:Math.max(0,operations.length-24)},taskContext:'unavailable-version-mismatch'}
 let remaining=24000
 const field=(value,path)=>{
  if(typeof value!=='string'||!value.trim())return
  // Check the entire source before clipping, including secrets beyond the budget.
  const clean=checkedTextWithLimit(value,1024*1024),limit=Math.min(1800,remaining)
  if(clean.length>limit)coverage.truncatedFields.push(path)
  if(!limit)return
  const text=clean.slice(0,limit);remaining-=text.length;return text
 }
 const list=(values,path)=>{
  if(!Array.isArray(values))return
  const selected=values.slice(0,8).map((value,index)=>field(value,path+'.'+index)).filter(Boolean)
  coverage.omittedCounts[path]=values.length-selected.length
  return selected
 }
 const result=event.result??(task.completion?.commandId&&task.completion.commandId===event.commandId?task.completion.result:undefined)
 const completed={id:event.id,kind:'task.completed',summary:field(typeof result==='string'?result:result?.summary,'completion.summary')??'completed',verification:'recorded-task-result-not-independent-verification'}
 const limitations=list(result?.limitations,'completion.limitations'),evidence=list(result?.evidence,'completion.evidence')
 if(limitations)completed.limitations=limitations
 if(evidence)completed.evidence=evidence
 const facts=[completed]
 const sameVersion=['requirementRevision','controlRevision','contextRevision','runSequence'].every(key=>Number.isSafeInteger(event[key])&&event[key]===(task[key]??(key==='contextRevision'?0:undefined)))
 if(sameVersion){
  completed.request=field(task.request,'task.request');completed.objective=field(task.objective,'task.objective');coverage.taskContext='matching-completion-version'
 }
 for(const row of executions.slice(-12))facts.push({id:row.executionId,kind:'execution',status:row.status,summary:field(row.result?.summary??row.error??row.stageProgress?.summary,'execution.'+row.executionId)??''})
 for(const row of operations.slice(-24))facts.push({id:row.operationId??row.id,kind:'operation',status:row.state,tool:row.toolName??row.name??''})
 return {taskId:task.taskId,eventId:event.id,facts,coverage}
}
