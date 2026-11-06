import {createAgentSession,SessionManager} from '@earendil-works/pi-coding-agent'
import {officialToolsFixture} from './pi-official-tools.js'
import {bindBusinessInputAuthority} from '../../src/runtime/pi-business-inputs.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}

// A real SDK session and native entries only. This fixture does not implement
// Session.append, event publication, a surface or a projection reader.
export async function visibilityFixture(t,snapshot){
 const f=await officialToolsFixture(t,()=>{})
 let manager=f.manager,session=f.session
 if(snapshot){
  manager=SessionManager.inMemory(f.root,undefined,structuredClone(snapshot.entries))
  ;({session}=await createAgentSession({cwd:f.root,agentDir:f.agentDir,modelRuntime:f.runtime,model:f.model,settingsManager:f.settings,resourceLoader:f.loader,sessionManager:manager,noTools:'all'}))
  t.after(()=>session.dispose())
 }
 const pendingIds=[],packets=new Map(snapshot?.packets??[]),actor={id:session.sessionId,piSession:session}
 const unbind=bindBusinessInputAuthority(actor,{lookupPacket:id=>packets.get(id),isLive:value=>value===actor,pending:()=>pendingIds})
 t.after(unbind)
 actor.admission={status:id=>packets.has(id)?'admitted':undefined}
 return {actor,manager,session,packets,pendingIds}
}
export function appendVisible(f,message){
 if(message.role==='user'){
  const id=message.id??'visible-'+f.manager.getEntries().length,source=structuredClone(message.source??{kind:'coordinator'}),content=structuredClone(message.content)
  f.packets.set(id,{id,source,content})
  return f.manager.appendCustomMessageEntry('night.business-input',content,false,{packetId:id,source})
 }
 const content=message.content.map(block=>block.type==='tool-call'?{type:'toolCall',id:block.id,name:block.name,arguments:JSON.parse(block.arguments)}:block)
 const value={...message,role:message.role==='tool'?'toolResult':message.role,content,timestamp:Date.now()}
 if(value.role==='assistant')Object.assign(value,{api:'openai-completions',provider:'fixture',model:'m',usage,stopReason:content.some(block=>block.type==='toolCall')?'toolUse':'stop'})
 if(value.role==='toolResult')value.toolName='fixture'
 return f.manager.appendMessage(value)
}
export function compactVisible(f){const anchor=f.manager.appendMessage({role:'user',content:'COMPACTION_ANCHOR',timestamp:Date.now()});return f.manager.appendCompaction('Summary does not retain the original body.',anchor,0)}
export function restoreVisibility(f,t){return visibilityFixture(t,{entries:f.manager.getEntries(),packets:[...f.packets]})}
export const visibilityAgent=f=>f.actor
