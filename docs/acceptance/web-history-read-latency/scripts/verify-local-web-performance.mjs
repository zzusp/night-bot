import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {Worker} from 'node:worker_threads'
const [install,taskId,routerId,expectedSha]=process.argv.slice(2)
assert.ok(install&&taskId&&routerId&&expectedSha)
const metadata=JSON.parse(await readFile(install+'/data/runtime/local-launcher.json','utf8'));assert.equal(metadata.release,expectedSha)
const c=JSON.parse(await readFile(install+'/data/config/config.json','utf8')),web=c.channelPlugins.find(row=>row.type==='web-console'&&row.enabled),origin='http://127.0.0.1:'+web.config.port
const channelHash=createHash('sha256').update(web.channelId).digest('hex').slice(0,16)
const token=(await readFile(install+'/data/secrets/web-console-'+channelHash+'/access-token','utf8')).trim()
const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200)
const cookie=login.headers.get('set-cookie').split(';')[0],{csrfToken}=await login.json()
try{
 const get=async path=>{const start=performance.now(),res=await fetch(origin+path,{headers:{origin,cookie}}),body=await res.json();assert.equal(res.status,200,path);return{ms:Math.round(performance.now()-start),body}}
 const small={}
 for(const path of ['/api/session','/api/overview','/api/tasks','/api/channels','/api/recent-conversations','/api/chat-current','/api/settings']){const value=await get(path);small[path]=value.ms;if(path==='/api/overview')assert.deepEqual(value.body.sectionErrors,{})}
 const history={}
 for(const [label,path]of [['task','/api/tasks/'+encodeURIComponent(taskId)+'/session'],['router','/api/conversations/'+encodeURIComponent(routerId)+'/session']]){
  const first=await get(path+'?stream=1&limit=200');assert.equal(first.body.status,'ready')
  const probe=new Worker(`const {parentPort,workerData}=require('node:worker_threads');let run=true;parentPort.on('message',()=>run=false);(async()=>{const times=[];parentPort.postMessage('ready');while(run){const start=performance.now(),res=await fetch(workerData.url,{headers:{connection:'close'}});await res.arrayBuffer();if(res.status!==200)throw Error('health failed');times.push(Math.round(performance.now()-start));await new Promise(r=>setTimeout(r,20))}parentPort.postMessage(times);parentPort.close()})()`,{eval:true,workerData:{url:'http://127.0.0.1:'+c.resident.port+'/health'}})
  const result=new Promise((res,rej)=>{probe.on('message',v=>{if(Array.isArray(v))res(v)});probe.on('error',rej)});result.catch(()=>{});await new Promise(res=>probe.once('message',res))
  const unchanged=[];let lightProof=first.body.liveProof
  for(let i=0;i<5;i++){const next=await get(path+'?stream=1&limit=200&checkpoint='+encodeURIComponent(first.body.checkpoint));assert.deepEqual(next.body.items,[]);unchanged.push(next.ms);lightProof=next.body.liveProof}
  console.log(JSON.stringify({stage:'before-light',label,firstMs:first.ms,unchangedMs:unchanged}));assert.ok(lightProof,label+' lacks light proof')
  const light=[],changed=[]
  for(let i=0;i<12;i++){const next=await get(path+'?live='+encodeURIComponent(lightProof));assert.equal(next.body.status,'ready');assert.deepEqual(next.body.items??[],[]);assert.equal(next.body.historyChanged,false,label+' must reuse its valid proof');light.push(next.ms);changed.push(next.body.historyChanged);await new Promise(r=>setTimeout(r,250))}
  probe.postMessage('stop');history[label]={firstMs:first.ms,unchangedMs:unchanged,lightMs:light,lightHistoryChanged:changed,healthMs:await result,live:first.body.live?.active}
 }
 const health=await(await fetch('http://127.0.0.1:'+c.resident.port+'/health')).json()
 const page=await fetch(origin+'/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/<html/)
 const asset=html.match(/src="([^"]+\.js)"/)?.[1];assert.ok(asset);const served=await fetch(origin+asset);assert.equal(served.status,200);const digest=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(digest(Buffer.from(await served.arrayBuffer())),digest(await readFile(metadata.codeRoot+'/packages/web-console/dist'+asset)))
 const tasks=(await get('/api/tasks')).body,rows=tasks.items??tasks,unfinished=[]
 for(const row of rows.filter(r=>r.state!=='completed')){const detail=(await get('/api/tasks/'+encodeURIComponent(row.taskId))).body;unfinished.push({taskId:row.taskId,state:detail.state,session:detail.session,blockers:detail.blockers?.map(b=>({kind:b.kind,status:b.status,drained:b.drained,recovering:b.recovering}))})}
 console.log(JSON.stringify({release:metadata.release,small,history,health:{status:health.status,recoveryIssueCount:health.recoveryIssueCount},taskCounts:{total:rows.length,completed:rows.filter(r=>r.state==='completed').length},unfinished,htmlAndAsset:200}))
}finally{const logout=await fetch(origin+'/api/logout',{method:'POST',headers:{origin,cookie,'x-csrf-token':csrfToken,'content-type':'application/json'},body:'{}'});assert.equal(logout.status,200);console.log(JSON.stringify({logout:logout.status}))}
