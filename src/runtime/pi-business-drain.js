const fail=cause=>Object.assign(new Error('PI_BUSINESS_DRAIN_UNPROVEN',{cause}),{code:'PI_BUSINESS_DRAIN_UNPROVEN'})
/** Called after official abort and awaited custom-tool drain, with admission
 * continuously paused and the actor's ownership bindings still attached. */
export function createOfficialBusinessDrain(ctx,processOwnership){
 if(typeof processOwnership?.drainOwner!=='function')throw new TypeError('Owned process provider drain required')
 const maintenanceHolds=new WeakMap()
 return async(actor,{phase='dispose'}={})=>{
  const jobs=ctx.get('jobs')
  if(typeof jobs?.drainOwner!=='function'||typeof jobs.list!=='function')throw fail()
  const errors=[];let processes
  try{await jobs.drainOwner(actor,{reason:'official session drained'})}catch(cause){errors.push(cause)}
  // A job receipt failure cannot excuse abandoning an admitted process range.
  try{processes=await processOwnership.drainOwner(actor)}catch(cause){errors.push(cause)}
  if(errors.length)throw fail(new AggregateError(errors))
  if(processes?.processes!==0||processes.scope!=='registered-owned-provider-ranges')throw fail()
  if(jobs.list(actor.id).some(job=>job.owner===actor.id&&['running','stopping'].includes(job.status)))throw fail()
  if(phase==='maintenance'){
   if(typeof jobs.resumeOwner!=='function'||typeof processOwnership.resumeOwner!=='function')throw fail()
   let hold=maintenanceHolds.get(actor)
   if(!hold){
    hold={}
    hold.resume=()=>hold.resuming??=(async()=>{await processOwnership.resumeOwner(actor);await jobs.resumeOwner(actor);if(maintenanceHolds.get(actor)===hold)maintenanceHolds.delete(actor)})()
    maintenanceHolds.set(actor,hold)
   }
   return {...processes,jobs:0,resume:hold.resume}
  }
  return {...processes,jobs:0}
 }
}
