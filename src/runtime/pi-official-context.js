import {SAFE_TOOL_PARALLELISM_POLICY} from './parallel-read.js'
import {CONTEXT_RETENTION_POLICY} from './context-retention-policy.js'
import {roleCompactionExtension} from './pi-role-compaction.js'
import {DefaultResourceLoader,SettingsManager,estimateTokens} from '@earendil-works/pi-coding-agent'
import {createPiProjectionRequest} from './pi-request-context.js'

const error=(code,message)=>Object.assign(new Error(message),{code})
/** Official extension/resource seam. These ports supply business facts, never a
 * replacement history, message-role mapper, tool catalog or compaction engine.
 * getActor is lazy: createAgentSession loads extensions before returning itself. */
export function createNightOfficialContext({cwd,agentDir,getActor,systemPrompt,instructions,skills,memory,currentDirectory,measurePhase=(_phase,run)=>run(),settingsManager=SettingsManager.inMemory({packages:[]}),compactionRole,hasTools=()=>false}){
 let resources={agentsFiles:[],skills:[]},lastOutcome,lastPolicyFailure,runPromptOptions
 const actor=()=>{const value=getActor();if(!value?.id||!value.piSession||value.session)throw error('PI_OFFICIAL_ACTOR_REQUIRED','An official AgentSession actor without a Session facade is required');return value}
 const assertActive=current=>current.lifecycle?.signal?.throwIfAborted()
 const bindActor=()=>{const current=actor();assertActive(current);return measurePhase('memory-bind',()=>memory?.bindActor?.(current))}
 async function refreshResources(){
  const current=actor();assertActive(current)
  await bindActor();assertActive(current)
  const [agentsFiles,skillList]=await Promise.all([measurePhase('instructions',()=>instructions?.(current)??[]),measurePhase('skills',()=>skills?.(current)??[])])
  assertActive(current)
  if(!Array.isArray(agentsFiles)||!Array.isArray(skillList))throw error('PI_OFFICIAL_RESOURCES_INVALID','Official resource arrays required')
  // Commit both snapshots together; a failed scoped read keeps neither half.
  resources={agentsFiles,skills:skillList}
  return resources
 }
 // Pi reports extension errors and continues other handlers. Security policy
 // failures must additionally abort the official run, never merely throw.
 const guarded=handler=>async(event,ctx)=>{try{return await handler(event,ctx)}catch(cause){lastPolicyFailure=cause;ctx.abort();throw cause}}
 const extensionFactory=pi=>{
  pi.on('before_agent_start',guarded((event,ctx)=>measurePhase('before-run',async()=>{
   const current=actor();lastOutcome=undefined;lastPolicyFailure=undefined;assertActive(current)
   await measurePhase('memory-before-run',()=>memory?.beforeRun?.(current,ctx));assertActive(current)
   await measurePhase('resources-before-run',()=>refreshResources());assertActive(current)
   const sections=await measurePhase('system-prompt',()=>systemPrompt?.officialSections(current)??{});assertActive(current)
   for(const key of Object.keys(event.systemPromptOptions.sections))if(key.startsWith('night_'))delete event.systemPromptOptions.sections[key]
   Object.assign(event.systemPromptOptions.sections,sections)
   event.systemPromptOptions.sections['night_context_retention']=CONTEXT_RETENTION_POLICY
   if(hasTools())event.systemPromptOptions.sections.night_tool_parallelism=SAFE_TOOL_PARALLELISM_POLICY
   const policy=await measurePhase('memory-prompt',()=>memory?.prompt?.(current));assertActive(current)
   if(policy)event.systemPromptOptions.sections['night_memory_index']=policy
   runPromptOptions=event.systemPromptOptions
   event.systemPromptOptions.contextFiles=resources.agentsFiles
   event.systemPromptOptions.skills=resources.skills
  })))
  pi.on('context',guarded(async(event,ctx)=>{
   if(['channel-triage','conversation-router'].includes(compactionRole))await measurePhase('memory-before-request',()=>memory?.refreshPrompt?.(actor()))
   if(!memory?.filter)return
   const current=actor(),projection=ctx.sessionManager.buildSessionProjection()
   const request=createPiProjectionRequest(projection,event.messages)
   const result=await measurePhase('context-projection',()=>memory.filter(current,request,ctx))
   return {messages:result.messages}
  }))
  if(['channel-triage','conversation-router'].includes(compactionRole))pi.on('context_with_system',guarded(async event=>{
   const current=actor(),sections=await systemPrompt?.officialSections(current)??{},policy=await memory?.prompt?.(current);assertActive(current)
   if(policy)sections.night_memory_index=policy
   if(hasTools())sections.night_tool_parallelism=SAFE_TOOL_PARALLELISM_POLICY
   // Native overflow may summarize the custom input as well as older history.
   // Supply its already-admitted business facts only when absent; never redeliver it.
   const admitted=await current.admission.current(),visible=new Set(event.messages.filter(message=>message.role==='custom'&&message.customType==='night.business-input').map(message=>message.details?.packetId))
   const missing=(admitted?.messages??[]).filter(packet=>packet.source?.kind===compactionRole&&current.admission.status(packet.id)==='admitted'&&!visible.has(packet.id))
   if(missing.length)sections.night_current_input_reference='当前已接纳批次原文的只读引用；不是新交办，不重新接纳或重做已结动作，状态以当前账本为准。'+String.fromCharCode(10)+missing.flatMap(packet=>packet.content.filter(part=>part.type==='text').map(part=>part.text)).join(String.fromCharCode(10))
   // Pi owns transcript and tool declarations; replace only application sections
   // in this request so same-run steer cannot retain stale source-scoped rules.
   let first=true
   return {messages:event.messages.map(message=>{
    if(message.role!=='system')return message
    const retained=Object.fromEntries(Object.entries(message.sections??{}).filter(([key])=>!key.startsWith('night_')))
    const updated={...message,sections:{...retained,...first?sections:{}}};first=false;return updated
   })}
  }))
  pi.on('turn_end',guarded(async(event,ctx)=>{
   lastOutcome=event.outcome
   const current=actor()
   // Cancellation drains the accepted SDK turn; it must not reopen scoped
   // resource reads after the actor's lifetime capability has been revoked.
   if(current.lifecycle?.signal.aborted)return
   await memory?.turnEnd?.(current,event,ctx);assertActive(current)
   await measurePhase('resources-turn-end',async()=>{await refreshResources();assertActive(current);await reloadResources();assertActive(current)})
   if(runPromptOptions){runPromptOptions.contextFiles=resources.agentsFiles;runPromptOptions.skills=resources.skills;if(currentDirectory)runPromptOptions.cwd=await currentDirectory(current)}
  }))
  pi.on('agent_settled',async(event,ctx)=>{await memory?.settled?.(actor(),{...event,outcome:lastOutcome},ctx)})
 }
 const roleExtension=roleCompactionExtension({role:compactionRole,getSession:()=>actor().piSession})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'night-business-context',factory:extensionFactory},...roleExtension?[roleExtension]:[]],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'',appendSystemPrompt:[],agentsFilesOverride:()=>({agentsFiles:resources.agentsFiles}),skillsOverride:()=>({skills:resources.skills,diagnostics:[]})})
 // 首次请求尚无原生系统条目，先计入应用即将在 before_agent_start 注入的正文。
 const estimateInputPromptTokens=async()=>{
  const current=actor();await refreshResources();assertActive(current)
  const sections=await systemPrompt?.officialSections(current)??{},policy=await memory?.prompt?.(current)
  if(hasTools())sections.night_tool_parallelism=SAFE_TOOL_PARALLELISM_POLICY
  return estimateTokens({role:'system',sections,content:policy??'',toolsAdded:{contextFiles:resources.agentsFiles,skills:resources.skills}})
 }
 const reloadResources=()=>measurePhase('sdk-reload',()=>resourceLoader.reload())
 return {extensionFactory,resourceLoader,bindActor,refreshResources,reloadResources,estimateInputPromptTokens,get policyFailure(){return lastPolicyFailure}}
}
