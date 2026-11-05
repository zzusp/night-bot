import {registerPiFileTools} from './pi-file-tool-registration.js'
import {createPiFileToolBudgets} from './runtime/pi-file-tool-budgets.js'
import PiSessionNames from './pi-session-names.js'
import {join,resolve} from 'node:path'
import OfficialAgentFactory from './pi-official-agent-factory.js'
import {createOfficialHostResourceResolver} from './pi-official-host-resources.js'
import {installOfficialProcessOwnership} from './runtime/pi-process-ownership.js'
import {createOfficialBusinessDrain} from './runtime/pi-business-drain.js'

export const name='night-pi-official-runtime'
export const inject=['agents','sessionPersistence','nativePiProvider','runtimePaths','agentPresets','permissionPresets','systemPrompt','tools','jobs','subprocess','agentDefaultModel']
export function apply(ctx,config={}){
 const paths=ctx.get('runtimePaths')
 // Absolute-root installs get explicit application-owned global directories;
 // resource discovery never falls back to the process user's home.
 const resourcesPaths={...paths,agentsHome:paths.agentsHome??join(paths.runtime,'configured-agents'),harnessHome:paths.harnessHome??join(paths.runtime,'configured-harness')}
 const resolveResources=createOfficialHostResourceResolver(ctx,{paths:resourcesPaths,model:config.model??ctx.agentDefaultModel.currentSelection(),memoryModel:config.memoryModel??config.model??ctx.agentDefaultModel.currentSelection(),maxParallelToolCalls:config.maxParallelToolCalls??4,skillRoots:(config.skillDirs??[]).map(path=>resolve(paths.installRoot,path))})
 const names=new PiSessionNames({readCommitted:actor=>ctx.get('sessionPersistence').readNative(actor.id,{requireComplete:true})})
 ctx.provide('sessionNames',names)
 ctx.effect(()=>()=>names.close(),'official Pi session names ownership')
 const ownership=installOfficialProcessOwnership(ctx)
 const factory=new OfficialAgentFactory(ctx,{
  resolveResources,
  drainBusiness:createOfficialBusinessDrain(ctx,ownership),
  async authorizeInput(packet,actor){const schedule=ctx.get('schedule');return typeof schedule?.authorizeInput==='function'&&await schedule.authorizeInput(packet,actor)===true},
  createMetadata(meta={}){
   return {...meta,agentPreset:meta.agentPreset??ctx.get('agentPresets').defaultId}
  },
  async mount(actorCtx,actor,options){
   const presets=actorCtx.get('agentPresets'),wanted=actor.metadata.agentPreset
   if(options.parentAgent){
    const inherited=presets.composeFrom(actorCtx,options.parentAgent.ctx)
    if(inherited!==wanted)throw Object.assign(new Error('Declared preset differs from inherited parent composition'),{code:'NATIVE_PRESET_HEADER_MISMATCH'})
   }else await presets.mount(actorCtx,wanted)
   await actorCtx.get('permissionPresets').pinInitialPermission(actor)
  },
  prepareTools(actorCtx,actor){
   const presets=actorCtx.get('agentPresets')
   // A preset without its own file capability does not gain model file tools.
   if(!presets.serviceFor(actor,'fs'))return
   const services=Object.fromEntries(['fs','workingDirectory','sandboxPolicy','approval','attachments'].map(name=>[name,presets.serviceFor(actor,name)??actorCtx.get(name)]))
   const budgets=createPiFileToolBudgets({actor,maxBatchTransportBytes:config.fileTools?.maxTransportBytes??33554432})
   const files=registerPiFileTools({ctx:actorCtx,actor,services,sourceConfig:config.fileTools,onlyMissing:true,...budgets})
   actorCtx.effect(()=>async()=>{await files.close();budgets.close()},'official Pi file capability ownership')
  },
  validatePreparedActor(actor){
   const presets=actor.ctx.get('agentPresets')
   if(presets.composedPreset(actor.ctx)!==actor.metadata.agentPreset)throw Object.assign(new Error('Declared preset differs from the mounted startup composition'),{code:'NATIVE_PRESET_HEADER_MISMATCH'})
   presets.seal(actor)
  },
 })
 ctx.provide('officialAgentFactory',factory)
 ctx.effect(()=>ctx.agents.setFactory(factory),'official Pi factory publication')
 ctx.effect(()=>()=>ownership.close(),'official Pi process ownership')
 const provider=({agent})=>agent?.options.provider
 provider.official=({actor})=>actor.options.provider
 const model=({agent})=>agent?.options.model
 model.official=({actor})=>actor.options.model
 ctx.systemPrompt.variable('provider',provider);ctx.systemPrompt.variable('model',model)
}
