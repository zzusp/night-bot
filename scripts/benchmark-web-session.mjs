// Synthetic CPU/event-loop diagnostic; never reads an installation's journals.
// node scripts/benchmark-web-session.mjs [path/to/session-view.js]
import {resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {performance} from 'node:perf_hooks'
const modulePath = process.argv[2] ?? fileURLToPath(new URL('../packages/web-console/server/session-view.js', import.meta.url))
const {taskSessionView} = await import(pathToFileURL(resolve(modulePath)))
const task = {taskId:'task-one',session:{sessionId:'pi-one',sessionBound:true}}
for (const count of [1000,5000]) {
  const entries = Array.from({length:count},(_,i)=>({sourceEntry:{id:'entry-'+i},messages:[{role:'assistant',content:[{type:'text',text:'安全合成测试内容。'.repeat(100)}]}]}))
  const snapshot = {header:{id:'pi-one'},entries:[{id:'base'}],audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-one',sessionId:'pi-one'}}],context:{projection:{entries}}}
  const persistence = {readNative:async()=>snapshot,readLive:()=>({sessionId:'pi-one',active:true,revision:'1',phase:'text',assistant:{id:'live',message:{role:'assistant',content:[{type:'text',text:'正在检查。',complete:true}]}},tools:[]})}
  for(let run=0;run<3;run++) {
    let last=performance.now(),maxGap=0,ticks=0
    const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++},1)
    const start=performance.now()
    await taskSessionView({task,persistence,stream:true,limit:30})
    const elapsed=performance.now()-start
    await new Promise(resolve=>setTimeout(resolve,2));clearInterval(timer)
    console.log(JSON.stringify({synthetic:true,includesNativeDecode:false,count,run,projectionMs:+elapsed.toFixed(1),maxTimerGapMs:+maxGap.toFixed(1),ticks}))
  }
}
