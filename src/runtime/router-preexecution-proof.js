import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
const marked=new WeakSet(),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function routerPreexecutionFailure(code){const error=Object.assign(new Error(code),{code});marked.add(error);return error}
export const isRouterPreexecutionFailure=error=>marked.has(error)
// Only trusted Host code calls this; ordinary tool error details are not proofs.
export function recordRouterNotStarted(owner,{toolName,callId,args,content,stage}){
 if(owner?.metadata?.runtimeOwner!=='conversation-router'||!owner.piSession||owner.ctx.get('agents')?.get(owner.id)!==owner)return
 const manager=owner.piSession.sessionManager,branch=manager.getBranch(),assistant=branch.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')
 const calls=assistant?.message.content.filter(block=>block.type==='toolCall'&&block.name===toolName&&(callId===undefined||block.id===callId)&&isDeepStrictEqual(block.arguments,args))??[]
 const current=owner.admission.current()
 if(calls.length!==1||typeof current?.id!=='string'||manager.getSessionId()!==owner.id)return
 if(args===undefined||!['router-guard','schema-validation'].includes(stage))return
 const proof={version:1,sessionId:owner.id,packetId:current.id,assistantEntryId:assistant.id,callId:calls[0].id,toolName,argsHash:hash(args),contentHash:hash(content),stage}
 if(manager.getEntries().some(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data?.domain==='router-tool'&&entry.data.kind==='not-started'&&isDeepStrictEqual(entry.data.payload,proof)))return
 owner.audit.append('router-tool/not-started',proof)
}
export function routerCallNotStarted(entries,{sessionId,packetId,assistant,call,result}){
 if(!call||!result?.message?.isError||result.message.toolCallId!==call.id||result.message.toolName!==call.name)return false
 const before=entries.indexOf(assistant),after=entries.indexOf(result)
 const proofs=entries.filter((entry,index)=>index>before&&index<after&&entry.type==='custom'&&entry.customType==='night.audit'&&entry.data?.domain==='router-tool'&&entry.data.kind==='not-started'&&entry.data.payload?.sessionId===sessionId&&entry.data.payload?.assistantEntryId===assistant.id&&entry.data.payload?.callId===call.id)
 if(proofs.length!==1)return false
 const p=proofs[0].data.payload
 return p.version===1&&p.packetId===packetId&&p.toolName===call.name&&p.argsHash===hash(call.arguments)&&p.contentHash===hash(result.message.content)&&['router-guard','schema-validation'].includes(p.stage)
}
