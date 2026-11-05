const guardians=new WeakMap()
const fail=cause=>Object.assign(new Error('Platform schedule source guardian is not ready',{cause}),{code:'PI_PLATFORM_SOURCE_NOT_READY'})
const needsGuardian=actor=>typeof actor?.id==='string'&&actor.id.startsWith('session-platform-schedule-')||actor?.metadata?.runtimeOwner==='platform-schedule'

/** Only the trusted platform bridge binds this exact actor. Source strings,
 * accepted schedule packets and SDK admission alone confer no readiness. */
export function bindPlatformScheduleSource(actor,port){
 if(!actor||typeof actor!=='object'||typeof port?.isReady!=='function')throw fail()
 if(guardians.has(actor))throw fail()
 const cell=Object.freeze({isReady:port.isReady.bind(port)})
 guardians.set(actor,cell)
 return()=>{if(guardians.get(actor)===cell)guardians.delete(actor)}
}

/** Reserved historical platform ids also require a guardian, including native
 * headers created before runtimeOwner was introduced. Ordinary actors pass. */
export function assertPlatformScheduleSource(actor){
 if(!needsGuardian(actor))return
 try{
  const cell=guardians.get(actor)
  if(!cell)throw fail()
  const ready=cell.isReady()
  if(ready&&typeof ready.then==='function'){void Promise.resolve(ready).catch(()=>{});throw fail()}
  if(ready!==true)throw fail()
 }catch(cause){if(cause?.code==='PI_PLATFORM_SOURCE_NOT_READY')throw cause;throw fail(cause)}
}
