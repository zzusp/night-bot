import {DefaultResourceLoader,SettingsManager} from '@earendil-works/pi-coding-agent'
import {createPiProjectionRequest} from './pi-request-context.js'

const error=(code,message)=>Object.assign(new Error(message),{code})
/** Official extension/resource seam. These ports supply business facts, never a
 * replacement history, message-role mapper, tool catalog or compaction engine.
 * getActor is lazy: createAgentSession loads extensions before returning itself. */
export function createNightOfficialContext({cwd,agentDir,getActor,systemPrompt,instructions,skills,memory,currentDirectory,measurePhase=(_phase,run)=>run(),settingsManager=SettingsManager.inMemory({packages:[]})}){
 let resources={agentsFiles:[],skills:[]},lastOutcome,lastPolicyFailure,runPromptOptions
 const actor=()=>{const value=getActor();if(!value?.id||!value.piSession||value.session)throw error('PI_OFFICIAL_ACTOR_REQUIRED','An official AgentSession actor without a Session facade is required');return value}
 async function refreshResources(){
  const current=actor()
  await measurePhase('memory-bind',()=>memory?.bindActor?.(current))
  const [agentsFiles,skillList]=await Promise.all([measurePhase('instructions',()=>instructions?.(current)??[]),measurePhase('skills',()=>skills?.(current)??[])])
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
   const current=actor();lastOutcome=undefined;lastPolicyFailure=undefined
   await measurePhase('memory-before-run',()=>memory?.beforeRun?.(current,ctx))
   await measurePhase('resources-before-run',()=>refreshResources())
   const sections=await measurePhase('system-prompt',()=>systemPrompt?.officialSections(current)??{})
   for(const key of Object.keys(event.systemPromptOptions.sections))if(key.startsWith('night_'))delete event.systemPromptOptions.sections[key]
   Object.assign(event.systemPromptOptions.sections,sections)
   const policy=await measurePhase('memory-prompt',()=>memory?.prompt?.(current))
   if(policy)event.systemPromptOptions.sections['night_memory_index']=policy
   runPromptOptions=event.systemPromptOptions
   event.systemPromptOptions.contextFiles=resources.agentsFiles
   event.systemPromptOptions.skills=resources.skills
  })))
  pi.on('context',guarded(async(event,ctx)=>{
   if(!memory?.filter)return
   const current=actor(),projection=ctx.sessionManager.buildSessionProjection()
   const request=createPiProjectionRequest(projection,event.messages)
   const result=await measurePhase('context-projection',()=>memory.filter(current,request,ctx))
   return {messages:result.messages}
  }))
  pi.on('turn_end',guarded(async(event,ctx)=>{
   lastOutcome=event.outcome
   const current=actor()
   // Cancellation drains the accepted SDK turn; it must not reopen scoped
   // resource reads after the actor's lifetime capability has been revoked.
   if(current.lifecycle?.signal.aborted)return
   await memory?.turnEnd?.(current,event,ctx)
   await measurePhase('resources-turn-end',async()=>{await refreshResources();await reloadResources()})
   if(runPromptOptions){runPromptOptions.contextFiles=resources.agentsFiles;runPromptOptions.skills=resources.skills;if(currentDirectory)runPromptOptions.cwd=await currentDirectory(current)}
  }))
  pi.on('agent_settled',async(event,ctx)=>{await memory?.settled?.(actor(),{...event,outcome:lastOutcome},ctx)})
 }
 const resourceLoader=new DefaultResourceLoader({cwd,agentDir,settingsManager,extensionFactories:[{name:'night-business-context',factory:extensionFactory}],noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'',appendSystemPrompt:[],agentsFilesOverride:()=>({agentsFiles:resources.agentsFiles}),skillsOverride:()=>({skills:resources.skills,diagnostics:[]})})
 const reloadResources=()=>measurePhase('sdk-reload',()=>resourceLoader.reload())
 return {extensionFactory,resourceLoader,refreshResources,reloadResources,get policyFailure(){return lastPolicyFailure}}
}
