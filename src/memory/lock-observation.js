import {AsyncLocalStorage} from 'node:async_hooks'
import {performance} from 'node:perf_hooks'

// Optional request-scoped aggregate. No scope, path or identity is observed.
const observers=new AsyncLocalStorage()
export const observeMemoryLock=(observe,work)=>observers.run(observe,work)
export async function measuredMemoryLock(acquire){
 const observe=observers.getStore()
 if(!observe)return acquire(()=>{})
 const started=performance.now()
 let observed=false
 const report=()=>{if(!observed){observed=true;observe(performance.now()-started)}}
 try{return await acquire(report)}finally{report()}
}
