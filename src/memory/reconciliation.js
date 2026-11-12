import {isDeepStrictEqual} from 'node:util'
import {hash,checkedText,renderMemoryContent} from './format.js'
import {memoryScope} from './scope.js'
import {failure} from '../runtime/files.js'

export async function reconcileCompletion(memory,agent,proof,args,validate){
 const {task,event}=proof
 if(!['keep','update','delete'].includes(args.decision)||!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<1)throw failure('MEMORY_RECONCILIATION_INVALID')
 const reason=checkedText(args.reason),channel=memory.host.get('channels')?.groupContext(task.groupId)
 const binding=structuredClone(channel?.memoryBinding)
 const check=async()=>{
  await validate()
  const ports=memory.officialActors.get(agent)
  if(!ports||!ports.isLive(agent)||!await memory.binding(agent)||await ports.authorizeWrite?.(agent,args)!==true)throw failure('MEMORY_READ_ONLY')
  for(const source of proof.sources)memory.channelSourceContext(source)
  if(!binding||!isDeepStrictEqual(binding,memory.host.get('channels')?.groupContext(task.groupId)?.memoryBinding))throw failure('MEMORY_CHANNEL_SOURCE_INVALID')
 }
 await check()
 const scope=memoryScope({...binding,actorId:memory.actorId(agent)},{},true)
 const reconciliation={id:hash(JSON.stringify([task.sessionId??task.taskId,event.id,args.topic,args.key])),inputHash:hash(JSON.stringify({taskId:args.taskId,completionEventId:args.completionEventId,topic:args.topic,key:args.key,expectedRevision:args.expectedRevision,decision:args.decision,reason,content:args.content?{summary:args.content.summary,why:args.content.why,howToApply:args.content.howToApply}:null}))}
 const receipt=await memory.store.reconciliationReceipt(scope,reconciliation.id)
 if(receipt&&receipt.inputHash!==reconciliation.inputHash)throw failure('MEMORY_RECONCILIATION_CONFLICT')
 const prior=(await memory.store.read(scope,{topic:args.topic,key:args.key,includeSources:true})).entries[0]
 if(!prior&&!receipt)throw failure('MEMORY_NOT_FOUND')
 if(!receipt&&prior.revision!==args.expectedRevision)throw failure('MEMORY_REVISION_CONFLICT')
 // Keep is a semantic decision retained in the official Pi tool journal, not a
 // new version or a claim that any memory was written.
 if(args.decision==='keep'){await check();const latest=(await memory.store.read(scope,{topic:args.topic,key:args.key})).entries[0];if(latest?.revision!==prior.revision)throw failure('MEMORY_REVISION_CONFLICT');return {ok:true,persisted:false,decision:'keep',revision:prior.revision}}
 const source={sessionId:task.sessionId??task.taskId,messageId:event.id,quoteSha256:hash(JSON.stringify(event.result)),observedAt:event.recordedAt}
 const provenance={...memory.provenance({task}),memoryReview:{kind:'task-completion',completionEventId:event.id,requirementRevision:task.requirementRevision,controlRevision:task.controlRevision,sourceRefs:proof.sources.map(source=>({sourceId:source.sourceId,messageVersion:source.version})),resultSha256:hash(JSON.stringify(event.result)),reason}}
 let result,text,context
 if(args.decision==='update'){
  text=renderMemoryContent(args.content??{})
  // Preserve the original observations and applicability rather than allowing
  // completion output to become a synthetic human quote or a new scope.
  context=prior?.context?.version===3?{...prior.context,...args.content}:undefined
  if(prior?.context&&prior.context.version!==3)throw failure('MEMORY_RECONCILIATION_CONTEXT_UNSUPPORTED')
  if(!receipt)result=await memory.store.remember(scope,{topic:args.topic,key:args.key,expectedRevision:args.expectedRevision,text,content:args.content,context,source,originSource:prior.originSource??prior.source,provenance,...prior.expiresAt?{expiresAt:prior.expiresAt}:{},validate:check,reconciliation})
 }else if(!receipt)result=await memory.store.forget(scope,{topic:args.topic,key:args.key,expectedRevision:args.expectedRevision,source,validate:check,reconciliation})
 try{
  await check()
  const saved=(await memory.store.read(scope,{topic:args.topic,key:args.key,includeSources:true})).entries[0]
  if(args.decision==='delete'?!!saved:!saved||saved.revision!==args.expectedRevision+1||saved.text!==text||saved.source.messageId!==event.id||!isDeepStrictEqual(saved.context,context))throw failure('MEMORY_WRITE_UNCONFIRMED')
  if(args.topic==='experience')await memory.host.get('reflection')?.forget(scope,args.key)
  return {...result,...receipt?{duplicate:true}:{},ok:true,persisted:true,decision:args.decision,...saved?{entry:saved}:{}}
 }catch(cause){throw Object.assign(failure('MEMORY_WRITE_UNCONFIRMED'),{committed:true,cause})}
}
