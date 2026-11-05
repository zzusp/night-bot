// Application lifecycle for an admitted ordinary process. Launch policy and
// ownership proofs remain with the caller; this module never invents a receipt.
import {OutputCollector,prepareManagedProcessBinding} from './output.js'

function streamFinished(stream,mode) {
  if(mode === 'inherit' || stream == null || stream.readableEnded || stream.destroyed)return Promise.resolve()
  return new Promise(resolve=>{
    const finish=()=>{for(const event of ['end','close','error'])stream.off(event,finish);resolve()}
    for(const event of ['end','close','error'])stream.once(event,finish)
  })
}
async function cancellableWait(pending,signal) {
  // Cancellation stops this reader's wait, never the process or another reader.
  if(signal?.aborted){pending.catch(()=>{});return false}
  if(!signal){await pending;return true}
  let abort
  const interrupted=new Promise(resolve=>{abort=()=>resolve(false);signal.addEventListener('abort',abort,{once:true})})
  try {return await Promise.race([pending.then(()=>true),interrupted])}
  finally {signal.removeEventListener('abort',abort)}
}
export function bindManagedProcess(spec,launch,internals={}) {
  const binding=prepareManagedProcessBinding(internals)
  const streams={stdout:launch.stdout,stderr:launch.stderr}
  const collected={}
  for(const name of ['stdout','stderr']) {
    const mode=spec.stdio[name],stream=streams[name]
    if(mode !== 'pipe' && mode !== 'inherit' && stream != null) {
      const spill=mode.spill === undefined ? undefined : {maxBytes:mode.spill.maxBytes,dir:binding.spillDir,onFailure:binding.onSpillFailure}
      const collector=new OutputCollector(mode.maxBytes,name,spill)
      collected[name]=collector
      stream.on('data',chunk=>collector.push(chunk))
    }
  }
  const outputsFinished=Promise.all(['stdout','stderr'].map(name=>streamFinished(streams[name],spec.stdio[name])))
  let resultSettled=false,rangeStopped=false,terminationStarted=false
  let escalation,outputDeadline,observation,signalFailure
  let cleanupScheduled=false
  const completion=Promise.withResolvers()
  const done=completion.promise
  function cleanupOwner() {
    if(cleanupScheduled || !launch.owner.cleanup)return
    cleanupScheduled=true
    done.finally(()=>launch.owner.cleanup()).catch(()=>{})
  }
  function clearEscalation() {if(escalation!==undefined)clearTimeout(escalation);escalation=undefined}
  function observeRange() {
    if(observation)return observation
    const pending=(async()=>{
      await launch.owner.waitForExit()
      if(signalFailure)throw signalFailure
      rangeStopped=true
      clearEscalation()
      spec.signal?.removeEventListener('abort',onAbort)
      cleanupOwner()
    })()
    observation=pending.catch(error=>{
      // After direct settlement cleanup may remove startup evidence. Retain the
      // rejection so a later observer cannot mistake missing evidence for exit.
      if(resultSettled && launch.owner.cleanup)cleanupOwner()
      else observation=undefined
      throw error
    })
    return observation
  }
  function send(signal,reason) {if(!rangeStopped)launch.owner.signal(signal,reason)}
  function terminateWithReason(reason) {
    if(terminationStarted || rangeStopped)return
    terminationStarted=true
    observeRange().catch(()=>{})
    let initialFailure
    try {send('SIGTERM',reason)} catch(error) {signalFailure=error;initialFailure=error}
    escalation=setTimeout(()=>{
      escalation=undefined
      try {send('SIGKILL')}
      catch(error) {signalFailure=error}
    },spec.graceMs)
    if(initialFailure)throw initialFailure
  }
  function onAbort() {try {terminateWithReason(spec.signal?.reason)} catch(error) {signalFailure=error}}
  spec.signal?.addEventListener('abort',onAbort,{once:true})
  if(typeof spec.stdio.stdin === 'object' && launch.stdin != null) {
    launch.stdin.on('error',()=>{})
    launch.stdin.end(spec.stdio.stdin.data)
  }
  function finish(error,outcome,failed=false) {
    if(resultSettled)return
    resultSettled=true
    if(outputDeadline!==undefined)clearTimeout(outputDeadline)
    for(const name of Object.keys(collected)) {streams[name]?.destroy();collected[name].seal()}
    if(failed)completion.reject(error)
    else completion.resolve(outcome)
  }
  Promise.resolve(launch.direct).then(outcome=>{
    outputDeadline=setTimeout(()=>finish(undefined,outcome),spec.graceMs)
    outputsFinished.then(()=>finish(undefined,outcome))
  },error=>{
    try {terminateWithReason(new Error('subprocess terminated before target start'))}
    catch(terminationError) {signalFailure=terminationError}
    finish(error,undefined,true)
  })
  return {
    stdin:spec.stdio.stdin === 'pipe' ? launch.stdin ?? undefined : undefined,
    stdout:spec.stdio.stdout === 'pipe' ? launch.stdout ?? undefined : undefined,
    stderr:spec.stdio.stderr === 'pipe' ? launch.stderr ?? undefined : undefined,
    control:launch.control,collected,done,
    terminate:()=>terminateWithReason(new Error('subprocess terminated before target start')),
    terminateForHostExit:()=>launch.owner.terminateForHostExit(),
    waitForExit:signal=>rangeStopped ? Promise.resolve(true) : cancellableWait(observeRange(),signal)
  }
}
