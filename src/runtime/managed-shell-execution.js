import {deadline} from './deadlines.js'

const emptyReader=Object.freeze({readFrom:()=>({text:'',nextOffset:0,lossy:false})})
const collected=reader=>{const value=reader.readFrom(0);return {text:value.text,truncated:value.lossy,...value.spillPath===undefined?{}:{spillPath:value.spillPath}}}

/** Application orchestration over an owned subprocess range. The provider's
 * direct outcome and explicit range drain are both required for completion.
 * No shell is spawned here and no PID or output text is treated as ownership. */
export async function runManagedShell({spec,prepare,spawn,onStarted,onSettled,timeoutCode='BASH_TIMEOUT'}){
 const timer=spec.onExpiry==='kill'?deadline(undefined,spec.timeoutMs,timeoutCode):undefined
 const signal=timer?(spec.signal?AbortSignal.any([spec.signal,timer.signal]):timer.signal):spec.signal
 const causes=()=>({timedOut:timer?.signal.aborted===true&&signal.reason===timer.signal.reason,aborted:signal?.aborted===true&&!(timer?.signal.aborted===true&&signal.reason===timer.signal.reason)})
 const disarm=()=>timer?.[Symbol.dispose]()
 let argv,preparationExpired=false
 try{
  signal?.throwIfAborted()
  // Await the admitted preparation itself even after cancellation. Racing an
  // abort would leave confinement work alive after the caller believes it joined.
  argv=typeof prepare==='function'?await prepare(signal??new AbortController().signal):prepare
  signal?.throwIfAborted()
 }catch(error){
  if(!causes().timedOut){disarm();throw error}
  preparationExpired=true
 }
 let running,failure,failed=false
 const remember=error=>{if(!failed){failed=true;failure=error}}
 try{if(!preparationExpired)running=spawn(argv,signal)}catch(error){remember(error)}
 const readers={stdout:running?.collected?.stdout??emptyReader,stderr:running?.collected?.stderr??emptyReader}
 if(running&&(!running.collected?.stdout||!running.collected?.stderr))remember(new Error('Managed shell provider omitted collected output'))
 let outcome={exitCode:null,signal:null},settledCauses,finished=false,stopRequested=false,termination
 let stdoutOffset=0,stderrOffset=0,failureRead=false,result
 const diagnostic='Managed subprocess failed before proving its outcome.'
 const terminal={
  status:'running',exitCode:null,signal:null,
  observed:{stdout:readers.stdout,stderr:{readFrom(offset){return failed?{text:Buffer.from(diagnostic).subarray(offset).toString('utf8'),nextOffset:Buffer.byteLength(diagnostic),lossy:false}:readers.stderr.readFrom(offset)}}},
  kill(){
   if(finished||stopRequested)return false
   stopRequested=true;terminal.status='killed'
   try{termination=Promise.resolve(running?.terminate());termination.catch(remember)}catch(error){remember(error)}
   return true
  },
  readOutput(){
   const out=readers.stdout.readFrom(stdoutOffset),err=readers.stderr.readFrom(stderrOffset)
   stdoutOffset=out.nextOffset;stderrOffset=err.nextOffset
   let errorText=err.text
   if(failed&&!failureRead){failureRead=true;errorText+=(errorText&&!errorText.endsWith('\n')?'\n':'')+diagnostic}
   return {delta:out.text+(errorText?(out.text&&!out.text.endsWith('\n')?'\n':'')+'[stderr]\n'+errorText:''),lossy:out.lossy||err.lossy,...out.spillPath===undefined?{}:{stdoutSpillPath:out.spillPath},...err.spillPath===undefined?{}:{stderrSpillPath:err.spillPath}}
  },
  result(){return result??=terminal.done.then(()=>{if(failed)throw failure;return {...outcome,...settledCauses,timeoutMs:spec.timeoutMs,stdout:collected(readers.stdout),stderr:collected(readers.stderr)}})},
 }
 terminal.done=Promise.resolve().then(async()=>{
  try{if(running){const observed=await running.done;if(!observed||!Object.hasOwn(observed,'exitCode')||!Object.hasOwn(observed,'signal'))throw new Error('Managed shell provider returned an invalid outcome');outcome=observed}}catch(error){remember(error)}
  // Direct command exit is not descendant quiescence. Keep the deadline and
  // cancellation authority until the provider proves its entire owned range.
  if(running)try{if(typeof running.waitForExit!=='function'||await running.waitForExit()!==true)throw new Error('Managed shell range drain is unproven')}catch(error){remember(error)}
  if(termination)await termination.catch(remember)
  settledCauses=causes();finished=true
  terminal.exitCode=outcome.exitCode;terminal.signal=outcome.signal
  terminal.status=failed||preparationExpired||stopRequested||signal?.aborted||outcome.signal!==null?'killed':'completed'
  try{onSettled?.(terminal,failed?diagnostic:readers.stderr.readFrom(0).text,failed,failure)}catch(error){remember(error);terminal.status='killed'}finally{disarm()}
 })
 // Install sandbox facts before an already-settled provider can notify observers.
 try{if(!preparationExpired)onStarted?.(terminal)}catch(error){remember(error);terminal.kill()}
 if(failed&&running&&!stopRequested)terminal.kill()

 return terminal
}
