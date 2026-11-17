import {progressTaskView} from './conversation-context.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const sameRun=(binding,task)=>binding?.taskId===task.taskId&&binding.sessionId===task.sessionId&&binding.requirementRevision===task.requirementRevision&&binding.controlRevision===task.controlRevision&&binding.leaseEpoch===task.leaseEpoch
const text=content=>typeof content==='string'?content:(content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n')
/** Strict committed Pi history, projected by Pi itself, never a progress mirror. */
export async function routerTaskProgress(task,{persistence,cursor,limit=10}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('ROUTER_CONTEXT_PAGE_INVALID')
 const base=progressTaskView(task)
 if(!persistence||!await persistence.stat(task.sessionId))return {...base,coverage:'unavailable',reason:'TASK_NATIVE_HISTORY_UNAVAILABLE',activities:[]}
 const native=await persistence.readNative(task.sessionId,{requireComplete:true})
 if(!native.audit.some(row=>row.domain==='task'&&row.kind==='identity'&&row.payload.taskId===task.taskId&&row.payload.sessionId===task.sessionId))fail('ROUTER_TASK_NATIVE_IDENTITY_INVALID')
 const branch=native.entries,projection=native.context.projection
 const boundary=branch.findIndex(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.source?.kind==='task-input'&&sameRun(entry.details.source.taskSession,task))
 if(boundary<0)return {...base,coverage:'unavailable',reason:'TASK_CURRENT_RUN_HISTORY_UNAVAILABLE',activities:[]}
 const positions=new Map(branch.map((entry,index)=>[entry.id,index]))
 const entries=projection.entries.filter(entry=>positions.get(entry.sourceEntry.id)>=boundary&&entry.sourceEntry.type==='message'&&['assistant','toolResult'].includes(entry.sourceEntry.message.role)&&entry.messages.length)
 let before=entries.length
 if(cursor!==undefined){before=entries.findIndex(entry=>entry.sourceEntry.id===cursor);if(before<0)fail('ROUTER_PROGRESS_CURSOR_STALE')}
 const selected=entries.slice(Math.max(0,before-limit),before).reverse(),activities=selected.map(({sourceEntry,messages})=>{
  const message=messages.at(-1),body=text(message?.content),calls=Array.isArray(message?.content)?message.content.filter(part=>part.type==='toolCall').map(part=>({callId:part.id,name:part.name})):[]
  return {entryId:sourceEntry.id,at:sourceEntry.timestamp,kind:message.role,...Object.fromEntries(['toolName','toolCallId','isError'].filter(key=>message[key]!==undefined).map(key=>[key,message[key]])),textPreview:body.slice(0,1200),truncated:body.length>1200,toolCalls:calls,verification:message.role==='toolResult'?'recorded-tool-result':'model-statement-not-independent-evidence'}
 })
 return {...base,coverage:'committed-current-run',activities,hasMore:before>limit,nextCursor:before>limit?selected.at(-1).sourceEntry.id:null}
}
