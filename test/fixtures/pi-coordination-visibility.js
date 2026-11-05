import {SessionManager} from '@earendil-works/pi-coding-agent'
import {tmpdir} from 'node:os'
const managers=new WeakMap()
const zeroUsage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
export function visibilityManager(session){
 if(!managers.has(session))managers.set(session,SessionManager.inMemory(tmpdir()))
 return managers.get(session)
}
export function visibilityAuthority(session){return {context(){const projection=visibilityManager(session).buildSessionProjection();return {projection,piMessages:projection.messages}}}}
export function visibilityContext(messages){
 const session={};for(const message of messages)appendVisible(session,message)
 return visibilityAuthority(session).context()
}
export function visibilityAgent(session){return {id:session.id,session,ctx:{get:name=>name==='piAuthority'?visibilityAuthority(session):undefined}}}
export function appendVisible(session,message){
 const content=message.content.map(block=>block.type==='tool-call'?{type:'toolCall',id:block.id,name:block.name,arguments:JSON.parse(block.arguments)}:block.type==='reasoning'?{type:'thinking',thinking:block.text}:block)
 const value={...message,role:message.role==='tool'?'toolResult':message.role,content,night:{event:{type:message.role==='user'?'user/message':message.role==='assistant'?'assistant/message':'tool/result',data:message.role==='user'?message:{message}}},timestamp:Date.now()}
 if(value.role==='assistant')Object.assign(value,{api:'openai-completions',provider:'fixture',model:'m',usage:zeroUsage,stopReason:content.some(b=>b.type==='toolCall')?'toolUse':'stop'})
 if(value.role==='toolResult')value.toolName='fixture'
 return visibilityManager(session).appendMessage(value)
}
export function compactVisible(session){return visibilityManager(session).appendCompaction('之前曾经读取正文，此摘要没有原文。',null,0)}
export function restoreVisibility(source,target){managers.set(target,SessionManager.inMemory(tmpdir(),undefined,structuredClone(visibilityManager(source).getEntries())))}
