import z from '@deepseek-ai/schemastery'
export const name='night-native-subagent-providers',inject=['subagents']
export const Config=z.object({spawnName:z.string().default('spawn'),forkName:z.string().default('fork')})
/** Application-owned local provider declarations. Agent construction, scopes,
 * policy delegation and lifecycle remain in the explicitly retained manager;
 * every constructed Agent runs PiLoop with its own Pi journal/context. */
export function localSubagentProvider(name,inheritsParentContext=false){
 return{name,capabilities:{agentOptions:true,outputSchema:true,depthLimit:true,toolFilter:true,persona:true},inheritsParentContext,
  async prepareContinuable({parent}={}){
   if(!inheritsParentContext)return{}
   // Only a completed, balanced prefix may seed the child's Pi-backed journal.
   // The parent's in-flight tool/request turn is excluded, including its effects.
   const events=parent.session.snapshotEvents(),last=events.findLast(e=>e.type==='turn/end')
   const seed=last===undefined?[]:events.slice(0,last.seq+1)
   return seed.length?{seed}:{}
  },
 }
}
export function apply(ctx,config){
 ctx.subagents.registerProvider(localSubagentProvider(config.spawnName))
 ctx.subagents.registerProvider(localSubagentProvider(config.forkName,true))
 ctx.provide('nativeSubagentProviders',Object.freeze({owner:name}))
}
