import {symbols} from '@deepseek-ai/cordis'
import {officialWorkingDirectoryOrigin} from '../native-working-directory.js'
const fail=(code,cause)=>Object.assign(new Error(code,{cause}),{code})

/** Associate actual provider range handles with the trusted dynamic actor.
 * This never kills a PID or expands a provider's containment guarantees. A
 * successful drain means registered owned ranges passed their provider drain;
 * it is not proof that an unsupported platform contains every descendant.
 */
export function installOfficialProcessOwnership(ctx){
 const service=ctx.get('subprocess'),runtime=service?.[symbols.original]??service
 if(!runtime||typeof runtime.spawn!=='function'||typeof runtime.spawnTerminal!=='function')throw fail('PI_PROCESS_RUNTIME_REQUIRED')
 const records=new Set(),launches=new Set(),held=new WeakSet(),originalSpawn=runtime.spawn,originalTerminal=runtime.spawnTerminal
 let closed=false
 const assertActor=actor=>{
  if(!actor?.piSession||ctx.get('agents')?.get(actor.id)!==actor)throw fail('PI_PROCESS_ACTOR_UNBOUND')
  officialWorkingDirectoryOrigin(actor)
 }
 const initiator=()=>{const actor=ctx.get('agents')?.currentInitiator();if(!actor?.piSession)return;assertActor(actor);if(closed)throw fail('PI_PROCESS_OWNERSHIP_CLOSED');if(held.has(actor))throw fail('PI_PROCESS_OWNER_DRAINING');return actor}
 function register(actor,handle,terminal){
  if(!actor)return handle
  const record={actor,handle,terminal};records.add(record)
  if(!terminal){
   const exit=Promise.resolve().then(()=>handle.waitForExit())
   record.completion=Promise.all([Promise.resolve(handle.done).catch(()=>{}),exit]).then(()=>records.delete(record),cause=>{record.failure=cause})
  }
  return handle
 }
 const spawn=function(...args){const actor=initiator();return register(actor,Reflect.apply(originalSpawn,this,args),false)}
 const spawnTerminal=function(...args){
  const actor=initiator()
  const operation=Promise.resolve().then(()=>Reflect.apply(originalTerminal,this,args)).then(handle=>register(actor,handle,true))
  if(actor){const launch={actor,operation};launches.add(launch);void operation.then(()=>launches.delete(launch),()=>launches.delete(launch))}
  return operation
 }
 runtime.spawn=spawn;runtime.spawnTerminal=spawnTerminal
 const port={
  async drainOwner(actor){
   assertActor(actor);held.add(actor)
   await Promise.all([...launches].filter(item=>item.actor===actor).map(item=>item.operation))
   const owned=[...records].filter(item=>item.actor===actor)
   const outcomes=await Promise.allSettled(owned.map(async record=>{
    await record.handle.terminate()
    if(!record.terminal){await record.handle.waitForExit();await record.completion}
    if(record.failure)throw record.failure
    records.delete(record)
   }))
   const errors=outcomes.filter(item=>item.status==='rejected').map(item=>item.reason)
   if(errors.length)throw fail('PI_PROCESS_DRAIN_UNPROVEN',new AggregateError(errors))
   if([...records,...launches].some(item=>item.actor===actor))throw fail('PI_PROCESS_DRAIN_UNPROVEN')
   return {processes:0,scope:'registered-owned-provider-ranges'}
  },
  resumeOwner(actor){assertActor(actor);if(closed||!held.has(actor)||[...records,...launches].some(item=>item.actor===actor))throw fail('PI_PROCESS_DRAIN_UNPROVEN');held.delete(actor)},
  inspectOwner(actor){assertActor(actor);return {ranges:[...records].filter(item=>item.actor===actor).length,launches:[...launches].filter(item=>item.actor===actor).length,uncertain:[...records].some(item=>item.actor===actor&&item.failure!==undefined)}},
  close(){closed=true;if(records.size||launches.size)throw fail('PI_PROCESS_DRAIN_UNPROVEN');if(runtime.spawn===spawn)runtime.spawn=originalSpawn;if(runtime.spawnTerminal===spawnTerminal)runtime.spawnTerminal=originalTerminal},
 }
 return port
}
