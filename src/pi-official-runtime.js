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
 const ownership=installOfficialProcessOwnership(ctx)
 const factory=new OfficialAgentFactory(ctx,{
  resolveResources,
  drainBusiness:createOfficialBusinessDrain(ctx,ownership),
  async authorizeInput(packet,actor){const schedule=ctx.get('schedule');return typeof schedule?.authorizeInput==='function'&&await schedule.authorizeInput(packet,actor)===true},
  async mount(actorCtx,actor,options){
   // A business setup can mount its task/coordinator preset. Plain ordinary
   // sessions use their persisted preset before resources are captured.
   if(!options.setup)await actorCtx.get('agentPresets').mount(actorCtx,actor.metadata.agentPreset??'night-bot')
   await actorCtx.get('permissionPresets').pinInitialPermission(actor)
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
