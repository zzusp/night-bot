/** In-process queue for trusted read-only producers, never jobs with side effects.
 * The caller owns business persistence and delivery. Producers are not replayed. */
export function createJobDeadlineQueue(jobs,{kind,label,outputLimitBytes,concurrency,timeoutMs,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TypeError('Invalid deadline queue limits')
 const waiting=new Map(),running=new Map(),settling=new Map()
 const stopController=jobs.attachController(kind)
 let closed=false,closing
 const report=error=>jobs.warn(error?.code??'NATIVE_DEADLINE_JOB_FAILED')
 const remaining=entry=>entry.deadlineAt-now()
 const has=id=>waiting.has(id)||running.has(id)||settling.has(id)
 const timer=(fn,delay)=>{const value=setTimer(fn,delay);value?.unref?.();return value}
 const complete=async(entry,status,value)=>entry.settle({status,...status==='completed'?{value}:{}})
 function finishWaiting(entry,status){
  if(waiting.get(entry.id)!==entry)return
  waiting.delete(entry.id)
  if(entry.timer!==undefined)clearTimer(entry.timer)
  const finished=Promise.resolve().then(()=>complete(entry,status)).finally(()=>settling.delete(entry.id))
  settling.set(entry.id,finished);void finished.catch(report)
 }
 function pump(){
  while(!closed&&running.size<concurrency&&waiting.size){
   const entry=waiting.values().next().value
   if(remaining(entry)<=0){finishWaiting(entry,'timed-out');continue}
   waiting.delete(entry.id)
   if(entry.timer!==undefined)clearTimer(entry.timer)
   start(entry)
  }
 }
 function start(entry){
  const controller=new AbortController(),stop=Promise.withResolvers(),detach=Promise.withResolvers(),finished=Promise.withResolvers()
  let jobId,work
  const cancel=(status='interrupted')=>{if(!controller.signal.aborted){stop.resolve({status});controller.abort()}}
  async function produce(){
   const timeout=timer(()=>cancel('timed-out'),Math.min(timeoutMs,remaining(entry)))
   const operation=(async()=>entry.run(controller.signal))()
   const outcome=operation.then(value=>({status:'completed',value}),()=>({status:'failed'}))
   const {status,value}=await Promise.race([stop.promise,outcome])
   clearTimer(timeout)
   try{await complete(entry,status,value)}finally{
    // Report timeouts promptly, but do not free the slot until the producer exits.
    // Shutdown may detach an already aborted producer; its outcome is discarded.
    await Promise.race([outcome,detach.promise])
   }
   return {status:['timed-out','interrupted','cancelled'].includes(status)?'killed':'completed',detail:status}
  }
  running.set(entry.id,{cancel,detach:detach.resolve,finished:finished.promise})
  void finished.promise.catch(report)
  try{jobId=jobs.start({kind,label,outputLimitBytes,run:()=>{work=produce();return {done:work,cancel:()=>cancel('cancelled')}}})}
  catch(error){report(error);cancel();work??=complete(entry,'failed')}
  void work.finally(async()=>{
   try{if(jobId){await jobs.wait(jobId);jobs.remove(jobId)}}finally{running.delete(entry.id);pump()}
  }).then(finished.resolve,finished.reject)
 }
 return {
  has,
  enqueue(id,spec){
   if(closed)return false
   if(has(id))return true
   if(!Number.isFinite(spec.deadlineAt))throw new TypeError('Invalid job deadline')
   const entry={...spec,id};waiting.set(id,entry);pump()
   if(waiting.get(id)===entry){
    const delay=remaining(entry)
    if(delay<=0)finishWaiting(entry,'timed-out')
    else entry.timer=timer(()=>finishWaiting(entry,'timed-out'),delay)
   }
   return true
  },
  close(){
   if(closing)return closing
   closed=true
   return closing=Promise.resolve().then(async()=>{
    for(const entry of [...waiting.values()])finishWaiting(entry,'interrupted')
    for(const job of running.values()){job.cancel();job.detach()}
    try{
     const results=await Promise.allSettled([...settling.values(),...Array.from(running.values(),job=>job.finished)])
     const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason)
     if(errors.length)throw new AggregateError(errors,'Native job queue drain failed')
    }finally{stopController?.()}
   })
  },
 }
}
