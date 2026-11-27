import {projectInterruptedRouterCalls} from './pi-router-recovery-view.js'
import {SAFE_TOOL_PARALLELISM_POLICY} from './parallel-read.js'
import {CONTEXT_RETENTION_POLICY} from './context-retention-policy.js'
import {roleCompactionExtension} from './pi-role-compaction.js'
import {DefaultResourceLoader,SettingsManager,estimateTokens} from '@earendil-works/pi-coding-agent'
import {createPiProjectionRequest} from './pi-request-context.js'
import {currentSkillVersionNotice,skillVersionPromptSection} from '../../packages/dingtalk-core/session-skill-refresh.js'

const error=(code,message)=>Object.assign(new Error(message),{code})
/** Official extension/resource seam. These ports supply business facts, never a
 * replacement history, message-role mapper, tool catalog or compaction engine.
 * getActor is lazy: createAgentSession loads extensions before returning itself. */
export function createNightOfficialContext({cwd,agentDir,getActor,systemPrompt,instructions,runInstructions,skills,memory,currentDirectory,measurePhase=(_phase,run)=>run(),settingsManager=SettingsManager.inMemory({packages:[]}),compactionRole,hasTools=()=>false}){
 let runInstructionFiles=[],resources={agentsFiles:[],skills:[]},lastOutcome,lastPolicyFailure,resourceFailure,runPromptOptions
 const actor=()=>{const value=getActor();if(!value?.id||!value.piSession||value.session)throw error('PI_OFFICIAL_ACTOR_REQUIRED','An official AgentSession actor without a Session facade is required');return value}
 const assertActive=current=>current.lifecycle?.signal?.throwIfAborted()
 const bindActor=()=>{const current=actor();assertActive(current);return measurePhase('memory-bind',()=>memory?.bindActor?.(current))}
 async function refreshResources({startRun=false}={}){
  const current=actor();assertActive(current)
  await bindActor();assertActive(current)
  const [agentsFiles,skillList,roleFiles]=await Promise.all([measurePhase('instructions',()=>instructions?.(current)??[]),measurePhase('skills',()=>skills?.(current)??[]),startRun&&runInstructions?runInstructions(current):runInstructionFiles])
  assertActive(current)
  if(!Array.isArray(agentsFiles)||!Array.isArray(skillList)||!Array.isArray(roleFiles))throw error('PI_OFFICIAL_RESOURCES_INVALID','Official resource arrays required')
  // Commit both snapshots together; a failed scoped read keeps neither half.
  runInstructionFiles=roleFiles
  resources={agentsFiles:[...agentsFiles,...roleFiles],skills:skillList}
  return resources
 }
 const refreshPolicyResources=(current,startRun,reload)=>measurePhase(startRun?'resources-before-run':'resources-turn-end',async()=>{
  await refreshResources({startRun});assertActive(current)
  if(reload){await reloadResources();assertActive(current)}
 })
 async function refreshRunResources(current,startRun){
  try{await refreshPolicyResources(current,startRun,!startRun)}catch(cause){
   if(lastPolicyFailure===undefined)resourceFailure={cause,startRun}
   throw cause
  }
 }
 // 下一条空闲输入只恢复确实失败的资源阶段，不清除其他策略错误。
 async function recoverInputResources(){
  const failed=resourceFailure
  if(!failed||lastPolicyFailure!==failed.cause)return
  await refreshPolicyResources(actor(),failed.startRun,true)
  if(lastPolicyFailure===failed.cause){lastPolicyFailure=undefined;resourceFailure=undefined}
 }
 // Pi reports extension errors and continues other handlers. Security policy
 // failures must additionally abort the official run, never merely throw.
 // Pi may call another hook after a rejection. Its cancellation must not
 // replace a real policy failure, and a later real failure must still surface.
 const guarded=handler=>async(event,ctx)=>{try{return await handler(event,ctx)}catch(cause){
  if(lastPolicyFailure===undefined||lastPolicyFailure===getActor()?.lifecycle?.signal?.reason)lastPolicyFailure=cause
  ctx.abort();throw cause
 }}
 const extensionFactory=pi=>{
  pi.on('before_agent_start',guarded((event,ctx)=>measurePhase('before-run',async()=>{
   const current=actor();lastOutcome=undefined;lastPolicyFailure=undefined;resourceFailure=undefined;assertActive(current)
   await measurePhase('memory-before-run',()=>memory?.beforeRun?.(current,ctx));assertActive(current)
   await refreshRunResources(current,true)
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
   const current=actor();assertActive(current)
   if(['channel-triage','conversation-router'].includes(compactionRole)){
    await measurePhase('memory-before-request',()=>memory?.refreshPrompt?.(current));assertActive(current)
   }
   if(!memory?.filter)return compactionRole==='conversation-router'?{messages:projectInterruptedRouterCalls(event.messages)}:undefined
   const projection=ctx.sessionManager.buildSessionProjection(),request=createPiProjectionRequest(projection,event.messages)
   const result=await measurePhase('context-projection',()=>memory.filter(current,request,ctx));assertActive(current)
   return {messages:compactionRole==='conversation-router'?projectInterruptedRouterCalls(result.messages):result.messages}
  }))
  pi.on('context_with_system',guarded(async event=>{
   const current=actor(),resident=['channel-triage','conversation-router'].includes(compactionRole)
   if(!resident){
    const notice=currentSkillVersionNotice(current)
    // 清掉后续系统增量中的旧提醒，否则 Pi 合并系统段落时会覆盖当前版本。
    let first=true,changed=false
    const messages=event.messages.map(message=>{
     if(message.role!=='system')return message
     const next=first?notice:'';first=false
     const sections=message.sections??{}
     if(next?sections[skillVersionPromptSection]===next:!Object.hasOwn(sections,skillVersionPromptSection))return message
     const updated={...sections};changed=true
     if(next)updated[skillVersionPromptSection]=next
     else delete updated[skillVersionPromptSection]
     return {...message,sections:updated}
    })
    if(first&&notice)throw error('PI_SKILL_VERSION_CONTEXT_REQUIRED','An official system message is required for the current skill version notice')
    if(changed)return {messages}
    return
   }
   const sections=await systemPrompt?.officialSections(current)??{},policy=await memory?.prompt?.(current);assertActive(current)
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
   await refreshRunResources(current,false)
   if(runPromptOptions){runPromptOptions.contextFiles=resources.agentsFiles;runPromptOptions.skills=resources.skills;if(currentDirectory)runPromptOptions.cwd=await currentDirectory(current)}
  }))
  pi.on('agent_settled',async(event,ctx)=>{
   const current=actor()
   if(!current.lifecycle?.signal.aborted)await memory?.settled?.(current,{...event,outcome:lastOutcome},ctx)
  })
 }
 const roleExtension=roleCompactionExtension({role:compactionRole,getSession:()=>actor().piSession})
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'night-business-context',factory:extensionFactory},...roleExtension?[roleExtension]:[]],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'',appendSystemPrompt:[],agentsFilesOverride:()=>({agentsFiles:resources.agentsFiles}),skillsOverride:()=>({skills:resources.skills,diagnostics:[]})})
 // 首次请求尚无原生系统条目，先计入应用即将在 before_agent_start 注入的正文。
 const estimateInputPromptTokens=async()=>{
  const current=actor();await refreshResources();assertActive(current)
  const sections=await systemPrompt?.officialSections(current)??{},policy=await memory?.prompt?.(current)
  if(hasTools())sections.night_tool_parallelism=SAFE_TOOL_PARALLELISM_POLICY
  const nextRunFiles=await runInstructions?.(current)??[];assertActive(current)
  const contextFiles=resources.agentsFiles.filter(file=>!runInstructionFiles.includes(file)).concat(nextRunFiles)
  return estimateTokens({role:'system',sections,content:policy??'',toolsAdded:{contextFiles,skills:resources.skills}})
 }
 const reloadResources=()=>measurePhase('sdk-reload',()=>resourceLoader.reload())
 return {extensionFactory,resourceLoader,bindActor,refreshResources,reloadResources,recoverInputResources,estimateInputPromptTokens,get policyFailure(){return lastPolicyFailure}}
}
