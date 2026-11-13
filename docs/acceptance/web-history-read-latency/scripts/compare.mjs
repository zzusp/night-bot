// 只读真实 journal；仅启动可选 Web 插件，不启动模型、业务 Host 或渠道发送。
import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2].slice(2),process.argv[3+i*2]]))
for(const key of ['code','install','journal','session','task'])assert.ok(args[key],`Missing --${key}`)
const moduleAt=path=>import(pathToFileURL(resolve(args.code,path)).href)
const [{default:Persistence},{runtimePaths},{portablePaths},{createWebConsole},{Context},{apply:authority}]=await Promise.all([
 moduleAt('src/pi-session-persistence.js'),moduleAt('src/runtime/paths.js'),moduleAt('src/runtime/portable.js'),moduleAt('packages/web-console/server/plugin.js'),moduleAt('node_modules/@deepseek-ai/cordis/lib/index.js'),moduleAt('src/pi-authority.js')])
const root=await mkdtemp(join(tmpdir(),'night-web-latency-')),ctx=new Context()
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await readFile(args.journal))
let web
try{
 ctx.provide('portablePaths',portablePaths(runtimePaths({installRoot:resolve(args.install)})))
 ctx.provide('taskSessionRoutes',new Map([[args.session,resolve(args.journal)]]));authority(ctx)
 const persistence=new Persistence(ctx,{root:join(root,'sessions')})
 const nativeMs=[],readNative=persistence.readNative.bind(persistence)
 persistence.readNative=async(...args)=>{const start=performance.now(),value=await readNative(...args);nativeMs.push(Math.round(performance.now()-start));return value}
 const task={taskId:args.task,session:{sessionId:args.session,sessionBound:true}}
 const paths={secrets:join(root,'secrets'),state:join(root,'state'),cache:join(root,'cache')}
 for(const path of Object.values(paths))await mkdir(path)
 const channels={identity:()=>({binding:{actorId:'local-operator'}}),transports:new Map(),plugins:new Map(),registerTransport(id,value){this.transports.set(id,value);return()=>this.transports.delete(id)},registerPlugin(id,value){this.plugins.set(id,value);return()=>this.plugins.delete(id)}}
 const secrets=Object.entries(process.env).filter(([key])=>/token|secret|password|api.?key/i.test(key)).map(([,value])=>value).filter(Boolean)
 web=await createWebConsole({channels,paths,config:{channelId:'latency-fixture',senderId:'local-operator',port:0},getApplication:()=>({config:{},tasks:{taskDetail:async id=>id===args.task?task:undefined}}),getSessionPersistence:()=>persistence,getRedactionSecrets:async()=>secrets,dist:resolve(args.code,'packages/web-console/dist')})
 const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],{csrfToken}=await login.json()
 const get=async path=>{const start=performance.now(),res=await fetch(web.origin+path,{headers:{origin:web.origin,cookie}}),value=await res.json();assert.equal(res.status,200);return{ms:Math.round(performance.now()-start),value}}
 const endpoint='/api/tasks/'+encodeURIComponent(args.task)+'/session?stream=1&limit=200'
 const probe=new Worker(`const {parentPort,workerData}=require('node:worker_threads');let running=true;parentPort.on('message',()=>{running=false});(async()=>{const times=[];parentPort.postMessage({ready:true});while(running){const start=performance.now(),res=await fetch(workerData.origin+'/api/session',{headers:{origin:workerData.origin,cookie:workerData.cookie}});await res.arrayBuffer();if(res.status!==200)throw new Error('Probe failed');times.push(Math.round(performance.now()-start));await new Promise(r=>setTimeout(r,20))}parentPort.postMessage({times});parentPort.close()})()`,{eval:true,workerData:{origin:web.origin,cookie}})
 const completed=new Promise((res,rej)=>{probe.on('message',v=>{if(v.times)res(v.times)});probe.on('error',rej)})
 await new Promise(res=>probe.once('message',res))
 const cold=await get(endpoint);assert.equal(cold.value.status,'ready')
 const unchanged=endpoint+'&checkpoint='+encodeURIComponent(cold.value.checkpoint),warm=[]
 for(let round=0;round<5;round++){
  const result=await get(unchanged)
  assert.deepEqual(result.value.items,[]);warm.push(result.ms)
 }
 probe.postMessage('stop');const light=await completed
 const page=await fetch(web.origin+'/');assert.equal(page.status,200);assert.match(await page.text(),/<html/)
 await fetch(web.origin+'/api/logout',{method:'POST',headers:{origin:web.origin,cookie,'x-csrf-token':csrfToken}})
 assert.equal(hash(await readFile(args.journal)),before,'Read-only evidence changed during benchmark')
 console.log(JSON.stringify({bytes:(await readFile(args.journal)).length,coldMs:cold.ms,unchangedMs:warm,nativeMs,lightMs:light,unchangedItems:0,journalUnchanged:true}))
}finally{await web?.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
