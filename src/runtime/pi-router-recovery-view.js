import {routerCallNotStarted} from './router-preexecution-proof.js'

// Read-only model projection: no journal mutation and no synthetic toolResult.
// A fresh Pi prompt never executes these historical calls. Their unknown state
// remains explicit data so the Router can inspect the original Host receipts.
export function unresolvedRouterCalls(messages){
 const calls=new Map()
 for(const message of messages){
  if(message.role==='assistant'&&message.stopReason!=='aborted')for(const block of message.content??[])if(block.type==='toolCall')calls.set(block.id,block)
  if(message.role==='toolResult'&&calls.get(message.toolCallId)?.name===message.toolName)calls.delete(message.toolCallId)
 }
 return [...calls.values()]
}
export function projectInterruptedRouterCalls(messages){
 const results=new Set(messages.filter(message=>message.role==='toolResult').map(message=>JSON.stringify([message.toolCallId,message.toolName])))
 return messages.map(message=>{
  if(message.role!=='assistant'||!message.content?.some(block=>block.type==='toolCall'&&!results.has(JSON.stringify([block.id,block.name]))))return message
  return {...message,content:message.content.map(block=>block.type==='toolCall'&&!results.has(JSON.stringify([block.id,block.name]))?{type:'text',text:JSON.stringify({kind:'interrupted-tool-call',status:'unknown',callId:block.id,toolName:block.name,arguments:block.arguments})}:block)}
 })
}

/** The rotation scope identifies candidates, not proven effects. */
export function independentRouterFileEffect({header,entries},{name,args}){
 const importing=name==='resident_router_shared_import'
 const taskId=importing?args.taskId:args.taskDelivery?.taskId
 if(!taskId||!args.sourceId)return false
 const byId=new Map(entries.map(e=>[e.id,e])),results=new Map(),admissions=new Map()
 for(const entry of entries){
  if(entry.type==='custom'&&entry.customType==='night.audit'&&entry.data?.domain==='admission'&&entry.data.kind==='admitted'){
   const p=entry.data.payload
   if(admissions.has(p.entryId))return false
   admissions.set(p.entryId,p)
  }
  if(entry.type==='message'&&entry.message.role==='toolResult'){
   const {toolName,toolCallId}=entry.message,key=JSON.stringify([toolName,toolCallId])
   if(!results.has(key))results.set(key,[])
   results.get(key).push(entry)
  }
 }
 const parent=(entry,predicate)=>{
  for(let current=byId.get(entry.parentId);current;current=byId.get(current.parentId))if(predicate(current))return current
 }
 for(const assistant of entries){
  if(assistant.type!=='message'||assistant.message.role!=='assistant')continue
  for(const call of assistant.message.content??[]){
   if(call.type!=='toolCall'||call.name!==name||!importing&&!call.arguments?.taskDelivery)continue
   const prior=call.arguments??{},otherTask=importing?prior.taskId:prior.taskDelivery.taskId
   if(otherTask&&otherTask!==taskId)continue
   if(!otherTask||prior.sourceId===args.sourceId&&prior.messageVersion===args.messageVersion)return false
   const paired=(results.get(JSON.stringify([name,call.id]))??[]).filter(e=>parent(e,p=>p.type==='message'&&p.message.role==='assistant')===assistant)
   if(paired.length!==1)return false
   const [result]=paired
   // A verified import is committed. A successful reply may only be queued.
   if(importing&&!result.message.isError&&result.message.details?.nativeResult?.value?.verified===true)continue
   const input=parent(assistant,e=>e.type==='custom_message'&&e.customType==='night.business-input'),packet=input&&admissions.get(input.id)
   if(!packet||packet.id!==input.details?.packetId||!routerCallNotStarted(entries,{sessionId:header.id,packetId:packet.id,assistant,call,result}))return false
  }
 }
 return true
}
