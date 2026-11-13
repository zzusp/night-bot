// Synthetic native journal + actual Web HTTP server. No installation data.
import {mkdtemp,mkdir,readFile,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import {Context} from '@deepseek-ai/cordis'
import PiPersistence from '../src/pi-session-persistence.js'
import * as Authority from '../src/pi-authority.js'
import {createWebConsole} from '../packages/web-console/server/plugin.js'
const count=Number(process.argv[2]??1000),clients=Number(process.argv[3]??1),duration=Number(process.argv[4]??5000),light=process.argv[5]==='live'
const root=await mkdtemp(join(process.cwd(),'.perf-http-')),ctx=new Context()
let web
try {
 await ctx.plugin(Authority)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 const writer=await backend.createNative({version:4,id:'pi-one',createdAt:Date.now(),isSeeded:false,cwd:root},{auditKinds:{'task/identity':()=>true}})
 writer.appendAudit({domain:'task',kind:'identity',version:1,payload:{taskId:'task-one',sessionId:'pi-one'}})
 for(let i=0;i<count;i++)writer.manager.appendMessage({role:'user',timestamp:Date.now(),content:[{type:'text',text:'安全合成性能样本。'.repeat(100)+i}]})
 await writer.close()
 const paths={secrets:join(root,'secrets'),state:join(root,'state'),cache:join(root,'cache')}
 for(const path of Object.values(paths))await mkdir(path)
 const channels={transports:new Map(),plugins:new Map(),identity:()=>({sessionId:'room-one',binding:{actorId:'benchmark'}}),registerTransport(){return()=>{}},registerPlugin(){return()=>{}}}
 const app={tasks:{listObserverGroups:()=>[{groupId:'room-one'}],store:{query:async()=>({taskId:'task-one',groupId:'room-one',sessionId:'pi-one',sessionBound:true})}}}
 const persistence={readNativeDigest:(...args)=>backend.readNativeDigest(...args),readNative:(...args)=>backend.readNative(...args),readLive:()=>({sessionId:'pi-one',active:true,revision:'1',phase:'text',assistant:{id:'live',message:{role:'assistant',content:[{type:'text',text:'正在检查。',complete:true}]}},tools:[]})}
 web=await createWebConsole({channels,paths,config:{channelId:'web',senderId:'benchmark',port:0},getApplication:()=>app,getSessionPersistence:()=>persistence})
 const token=(await readFile(web.credentialPath,'utf8')).trim()
 const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token})})
 const cookie=login.headers.get('set-cookie').split(';')[0],headers={origin:web.origin,cookie}
 const endpoint='/api/conversations/room-one/tasks/task-one/session?stream=1&limit=30'
 const sanity=await fetch(web.origin+endpoint,{headers});if(sanity.status!==200)throw Error('fixture failed '+sanity.status+' '+await sanity.text());const initial=await sanity.json();if(light&&!initial.liveProof)throw Error('missing live proof')
 let stop=false,last=performance.now(),gap=0,polls=0,failures=0
 const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now},1)
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),latencies=[],begin=performance.now()
 const tasks=Array.from({length:clients},async()=>{let proof=initial.liveProof,nextFull=performance.now()+2500;while(!stop){const full=!light||performance.now()>=nextFull;const url=full?endpoint:endpoint.split('?')[0]+'?live='+encodeURIComponent(proof);const r=await fetch(web.origin+url,{headers});const page=await r.json();if(full){proof=page.liveProof;nextFull=performance.now()+2500}else if(page.historyChanged)nextFull=0;polls++;if(r.status!==200)failures++;await sleep(250)}})
 while(performance.now()-begin<duration){const start=performance.now();const r=await fetch(web.origin+'/api/session',{headers});await r.arrayBuffer();if(r.status!==200)failures++;latencies.push(performance.now()-start);await sleep(25)}
 stop=true;await Promise.all(tasks);clearInterval(timer);latencies.sort((a,b)=>a-b)
 console.log(JSON.stringify({synthetic:true,count,clients,light,journalBytes:(await stat(backend.path('pi-one'))).size,ordinaryApiSamples:latencies.length,ordinaryP50Ms:latencies[Math.floor(latencies.length*.5)],ordinaryP95Ms:latencies[Math.floor(latencies.length*.95)],maxEventLoopGapMs:gap,polls,failures}))
}finally{await web?.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
