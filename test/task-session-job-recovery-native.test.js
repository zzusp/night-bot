import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {nativeRuntimeHost,nativeShell,latestInput,topicTaskCalls,waitUntil} from './fixtures/runtime-official-host.js'
import {handleRequest} from '../packages/dingtalk-core/http.js'
import {createEffectOperatorAuth,readEffectOperatorToken} from '../src/tasks/effect-operator-auth.js'
const call=(name,args)=>({name,args})
const result=(action='wait',summary='Recorded the original evidence without replay')=>call('task_result',{decision:{action,summary,evidence:['original native receipts'],limitations:[]}})
const quote=value=>nativeShell==='pwsh'?"'"+value.replaceAll("'","''")+"'":"'"+value.replaceAll("'","'\\''")+"'"
const command=script=>(nativeShell==='pwsh'?'& ':'')+[process.execPath,'-e',script].map(quote).join(' ')
const shell=(script,options={})=>call(nativeShell,{command:command(script),description:'Run the one owned fixture process',...options})
async function fixture(t,decide,options={}){
 const root=options.root??await mkdtemp(join(tmpdir(),'night-single-job-'))
 const h=await nativeRuntimeHost(root,async(request,host)=>request.tools.some(tool=>tool.name==='task_result')?decide(request,host):topicTaskCalls(request),options)
 t.after(async()=>{await h.close();if(!options.root)await rm(root,{recursive:true,force:true})});return h
}
async function snapshot(h,taskId){const task=await h.query('task.get',{taskId});return {task,...await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})}}
const facts=(stored,kind)=>stored.audit.filter(receipt=>receipt.domain==='job'&&receipt.kind===kind).map(receipt=>receipt.payload)
const readCall=(request,path)=>{const properties=request.tools.find(tool=>tool.name==='read')?.parameters.properties,key=['path','file_path'].find(name=>Object.hasOwn(properties??{},name));assert.ok(key,'read exposes its actual registered path parameter');return call('read',{[key]:path})}
const modelCount=h=>h.requests.filter(request=>request.tools.some(tool=>tool.name==='task_result')).length
const lastJob=h=>h.toolResults.findLast(row=>row.name===nativeShell)?.result.value?.jobId
const taskRoot=(h,id)=>join(h.ctx.runtimePaths.workspaces,'tasks',id)
async function create(h,id='job-case'){const created=await h.service.createTask({groupId:'native-group',requestId:id,objective:'Execute only the original authorized local work and retain exact process evidence'});return created.taskId}
async function idle(h){await h.service.whenIdle()}
function single(stored){assert.equal(stored.task.drained,true);assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='identity').length,1);const proof=stored.audit.filter(r=>r.domain==='task'&&r.kind==='owner-drained').at(-1)?.payload.proof;if(proof){assert.equal(proof.processes,0);assert.equal(proof.jobs,0)}for(const registered of facts(stored,'registered'))assert.equal(facts(stored,'settled').filter(row=>row.jobId===registered.jobId).length,1)}

test('historical job text is read as data and never launches or settles a native job',{timeout:20000},async t=>{
 let step=0
 const h=await fixture(t,async(request,host)=>{
  const input=latestInput(request)
  if(step++===0){const file=join(taskRoot(host,input.task.taskId),'work/history.jsonl');await writeFile(file,[{type:'job/registered',data:{jobId:'historical-draft',owner:'foreign'}},{type:'tool/result',data:{nativeJobReceipt:{jobId:'historical-material',status:'running'}}}].map(row=>JSON.stringify(row)).join('\n'));return [readCall(request,'work/history.jsonl')]}
  assert.match(JSON.stringify(request),/historical-draft/);assert.match(JSON.stringify(request),/historical-material/);return [result()]
 })
 const id=await create(h);await idle(h);const stored=await snapshot(h,id);single(stored);assert.equal(step,2);assert.equal(facts(stored,'registered').length,0);assert.equal((await h.query('operation.list')).length,0);assert.equal((await h.query('execution.list')).length,0)
})

test('serial native results stay in one task journal; explicit stage and final result do not create member executions',{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:25000},async t=>{
 let step=0
 const h=await fixture(t,async(request)=>{
  const current=step++
  if(current===2)return [result('wait','First two local operations were read back; a further instruction is needed for the final stage')]
  if(current===4){assert.match(JSON.stringify(request),/SERIAL_3/);return [result('complete','Three original serial operations were independently read back')]}
  const n=current<2?current+1:3
  return [shell(`require('node:fs').appendFileSync('work/serial.txt','SERIAL_${n}\\n');console.log(require('node:fs').readFileSync('work/serial.txt','utf8'))`)]
 })
 const id=await create(h);await idle(h);const first=await snapshot(h,id),before=modelCount(h);single(first);await h.service.recover();await idle(h);assert.equal(modelCount(h),before,'ordinary tool results do not schedule an extra model owner')
 await h.service.appendTaskContext({taskId:id,requestId:'continue-final-stage',progressImpact:'replan',context:'Complete the third local stage and verify the original file.'});await idle(h)
 const stored=await snapshot(h,id);single(stored);assert.equal(stored.task.sessionId,first.task.sessionId);assert.equal(stored.task.status,'completed');assert.equal(step,5);assert.equal(facts(stored,'registered').length,3);assert.equal(facts(stored,'settled').length,3);assert.equal((await h.query('execution.list')).length,0);assert.equal((await readFile(join(taskRoot(h,id),'work/serial.txt'),'utf8')).trim(),'SERIAL_1\nSERIAL_2\nSERIAL_3')
})

for(const background of [false,true])test(`original ${background?'background':'promoted foreground'} process is retained through terminal output`,{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:20000},async t=>{
 let step=0,jobId
 const h=await fixture(t,async(request,host)=>{
  if(step++===0)return [shell("console.log('before');setTimeout(()=>{require('node:fs').writeFileSync('work/result.txt','after');console.log('after')},1200)",{timeoutMs:500,...background?{run_in_background:true}:{}})]
  if(step===2){jobId=lastJob(host);assert.ok(jobId,JSON.stringify(host.toolResults));assert.ok(JSON.stringify(request).includes(jobId));return [call('job_output',{job_id:jobId,wait:true,timeout_ms:10000})]}
  const output=host.toolResults.findLast(row=>row.name==='job_output');assert.equal(output.result.isError,false);assert.match(output.result.value.text,/after/);assert.match(JSON.stringify(output.result.content),/after/);return [result('complete')]
 })
 const id=await create(h);await idle(h);const stored=await snapshot(h,id);single(stored);assert.equal(step,3);const registered=facts(stored,'registered'),settled=facts(stored,'settled');assert.equal(registered.length,1);assert.equal(registered[0].jobId,jobId);assert.equal(registered[0].owner,stored.task.sessionId);assert.equal(settled.length,1);assert.equal(settled[0].producerReported,true);assert.equal(settled[0].status,'completed');assert.equal(await readFile(join(taskRoot(h,id),'work/result.txt'),'utf8'),'after')
})

for(const killed of [false,true])test(`original producer terminal receipt is durable before a job read or task result: killed=${killed}`,{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:20000},async t=>{
 let step=0,jobId
 const h=await fixture(t,async(request,host)=>{
  if(step++===0)return [shell(`require('node:fs').appendFileSync('work/once.txt','once\\n');setTimeout(()=>console.log('terminal'),${killed?10000:500})`,{run_in_background:true})]
  if(step===2){jobId=lastJob(host);assert.ok(jobId);const id=latestInput(request).task.taskId;await waitUntil(async()=>{try{return (await readFile(join(taskRoot(host,id),'work/once.txt'),'utf8')).trim()==='once'}catch{return false}},'producer has one actual effect')
   if(killed){const jobs=host.ctx.get('jobs'),unrelated=jobs.start({kind:'fixture',label:'unrelated producer',run:()=>({cancel(){},done:Promise.resolve({status:'completed'})})});await jobs.wait(unrelated,1000);assert.equal(facts(await snapshot(host,id),'settled').length,0,'unowned terminal event cannot settle the owned producer');jobs.kill(jobId,(await host.query('task.get',{taskId:id})).sessionId,'explicit fixture stop')}
   const terminal=await waitUntil(async()=>facts(await snapshot(host,id),'settled').find(row=>row.jobId===jobId),'owned terminal receipt before model read');assert.equal(terminal.status,killed?'killed':'completed');assert.equal(terminal.producerReported,true);assert.ok(host.ctx.agents.get(terminal.owner));assert.equal(host.toolResults.some(row=>row.name==='job_output'),false);return [call('job_output',{job_id:jobId,wait:true,timeout_ms:1000})]}
  return [result()]
 })
 const id=await create(h);await idle(h);const stored=await snapshot(h,id);single(stored);assert.equal(facts(stored,'registered').length,1);assert.equal(facts(stored,'settled').length,1);assert.equal((await readFile(join(taskRoot(h,id),'work/once.txt'),'utf8')).trim(),'once')
})

test('missing-job read remains a real error, leaves no effect intent and permits a later observational tool',{timeout:20000},async t=>{
 let step=0
 const h=await fixture(t,async request=>{if(step++===0)return [call('job_output',{job_id:'bash-777777'})];if(step===2){assert.match(JSON.stringify(request),/unknown job bash-777777/);return [call('job_list',{})]}return [result('complete')]})
 const id=await create(h);await idle(h);const stored=await snapshot(h,id);single(stored);assert.equal(stored.task.status,'completed');assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent').length,0);assert.ok(h.toolResults.some(row=>row.name==='job_output'&&row.result.isError));assert.ok(h.toolResults.some(row=>row.name==='job_list'&&!row.result.isError))
})

for(const explicitStop of [false,true])test(`background HTTP service serves a later real tool and its original process drains: explicitStop=${explicitStop}`,{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:20000},async t=>{
 let step=0,jobId,port
 const h=await fixture(t,async(request,host)=>{
  const id=latestInput(request).task.taskId
  if(step++===0)return [shell("const fs=require('node:fs');fs.writeFileSync('work/heartbeat.txt',String(Date.now()));setInterval(()=>fs.writeFileSync('work/heartbeat.txt',String(Date.now())),20);const s=require('node:http').createServer((q,r)=>r.end('original-service'));s.listen(0,'127.0.0.1',()=>fs.writeFileSync('work/ready.json',JSON.stringify({pid:process.pid,port:s.address().port})))",{run_in_background:true})]
  if(step===2){jobId=lastJob(host);const ready=await waitUntil(async()=>{try{return JSON.parse(await readFile(join(taskRoot(host,id),'work/ready.json'),'utf8'))}catch{return false}},'original HTTP producer ready');port=ready.port;return [shell(`require('node:http').get('http://127.0.0.1:${ready.port}',r=>r.pipe(process.stdout))`)]}
  const response=host.toolResults.filter(row=>row.name===nativeShell).at(-1);assert.equal(response.result.isError,false);assert.match(response.result.value.stdout.text,/original-service/)
  if(explicitStop&&step===3)return [call('job_kill',{job_id:jobId})]
  if(explicitStop&&step===4)return [call('job_output',{job_id:jobId,wait:true,timeout_ms:1000})]
  return [result('wait','The original HTTP read succeeded; release the owned service')]
 })
 const id=await create(h);await idle(h);const stored=await snapshot(h,id);single(stored);const terminal=facts(stored,'settled').find(row=>row.jobId===jobId);assert.ok(terminal);assert.ok(['killed','failed','completed'].includes(terminal.status));assert.equal(terminal.producerReported,true);await assert.rejects(fetch('http://127.0.0.1:'+port));const heartbeat=await readFile(join(taskRoot(h,id),'work/heartbeat.txt'),'utf8');await new Promise(resolve=>setTimeout(resolve,120));assert.equal(await readFile(join(taskRoot(h,id),'work/heartbeat.txt'),'utf8'),heartbeat)
})

for(const background of [false,true])test(`task cancellation joins the original ${background?'background':'foreground'} process and retains unknown effects`,{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:20000},async t=>{
 let jobId
 const h=await fixture(t,async(_request,host)=>{if(!jobId){jobId='starting';return [shell("const fs=require('node:fs');fs.writeFileSync('work/started.json',JSON.stringify({pid:process.pid}));fs.writeFileSync('work/heartbeat.txt',String(Date.now()));setInterval(()=>fs.writeFileSync('work/heartbeat.txt',String(Date.now())),20);console.log('started');setTimeout(()=>require('node:fs').writeFileSync('work/forbidden.txt','late'),30000)",{timeoutMs:500,...background?{run_in_background:true}:{}})]}await new Promise(resolve=>setTimeout(resolve,200));return [result('wait')]})
 const id=await create(h),started=await waitUntil(async()=>{try{return JSON.parse(await readFile(join(taskRoot(h,id),'work/started.json'),'utf8'))}catch{return false}},'owned process entered');await waitUntil(async()=>facts(await snapshot(h,id),'registered').length,'registered original job');await h.service.cancelTask({taskId:id,requestId:'cancel',reason:'Stop the original process'});await idle(h)
 const stored=await snapshot(h,id);single(stored);assert.equal(facts(stored,'registered').length,1);const terminal=facts(stored,'settled');assert.equal(terminal.length,1);assert.ok(['killed','failed'].includes(terminal[0].status));assert.equal(terminal[0].producerReported,true);const heartbeat=await readFile(join(taskRoot(h,id),'work/heartbeat.txt'),'utf8');await new Promise(resolve=>setTimeout(resolve,120));assert.equal(await readFile(join(taskRoot(h,id),'work/heartbeat.txt'),'utf8'),heartbeat);await assert.rejects(readFile(join(taskRoot(h,id),'work/forbidden.txt')),{code:'ENOENT'});assert.equal(stored.task.completion??null,null)
})

async function unknown(t){
 let calls=0
 const h=await fixture(t,async(request)=>JSON.stringify(request).includes('TASK_EFFECT_ALREADY_ATTEMPTED')?[result()]:[call('uncertain_native',{})])
 h.ctx.get('tools').register({name:'uncertain_native',description:'Original local effect loses its acknowledgement',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){calls++;await writeFile(join(exec.agent.metadata.cwd,'work/evidence.txt'),'Original partial effect');throw Error('lost acknowledgement')}})
 const id=await create(h);await idle(h);return {h,id,get calls(){return calls},stored:await snapshot(h,id)}
}
test('unknown effect holds all future execution while Host readback remains available and cannot authorize replay',{timeout:20000},async t=>{
 const f=await unknown(t),{h,id,stored}=f,intent=stored.auditEntries.find(e=>e.data.domain==='task'&&e.data.kind==='effect-intent'),before=modelCount(h)
 const inspection=await h.service.inspectTaskEffect({taskId:id,intentEntryId:intent.entryId});assert.equal(inspection.outcome,'unknown');assert.equal(inspection.noReplay,true);assert.equal(await readFile(join(taskRoot(h,id),'work/evidence.txt'),'utf8'),'Original partial effect')
 await h.service.appendTaskContext({taskId:id,requestId:'investigate',progressImpact:'replan',context:'Read the existing evidence; this is not effect reconciliation.'});await idle(h);assert.equal(f.calls,1);assert.equal(modelCount(h),before,'unknown receipt cannot reopen a model executor');assert.equal((await snapshot(h,id)).audit.filter(r=>r.domain==='task'&&r.kind==='effect-reconciled').length,0)
})

test('cold restart reads the original durable terminal receipt and the same task file without replaying its producer',{skip:process.platform!=='linux'?'Requires Linux portable model-process privacy namespace; Windows remains fail-closed':false,timeout:25000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-single-job-reopen-'));let first,second,firstStep=0;t.after(async()=>{await second?.close();await first?.close();await rm(root,{recursive:true,force:true})})
 first=await fixture(t,async(request,host)=>{if(firstStep++===0)return [shell("require('node:fs').appendFileSync('work/once.txt','once\\n');setTimeout(()=>console.log('done'),500)",{run_in_background:true})];const id=latestInput(request).task.taskId;await waitUntil(async()=>facts(await snapshot(host,id),'settled').length,'durable terminal before interruption');throw Error('Fixture interruption after native job terminal commit')},{root})
 const id=await create(first);await idle(first);const before=await snapshot(first,id),job=facts(before,'registered')[0];assert.equal(facts(before,'settled')[0].status,'completed');await first.close()
 let step=0;second=await fixture(t,async request=>{if(step++===0)return [readCall(request,'work/once.txt')];assert.match(JSON.stringify(request),/once/);return [result()]},{root,initialize:false})
 await second.service.appendTaskContext({taskId:id,requestId:'read-retained-job',progressImpact:'replan',context:'Read original output, without rerunning the command.'});await idle(second);const after=await snapshot(second,id);single(after);assert.equal(after.task.sessionId,before.task.sessionId);assert.equal(facts(after,'registered').length,1);assert.equal(facts(after,'registered')[0].jobId,job.jobId);assert.equal(facts(after,'settled').length,1);assert.equal(await readFile(join(taskRoot(second,id),'work/once.txt'),'utf8'),'once\n');assert.equal(second.toolResults.some(row=>row.name===nativeShell),false)
})

test('operator inspection is zero-write and exact native reconciliation retains partial effects, stays paused and never replays',{timeout:20000},async t=>{
 const f=await unknown(t),{h,id,stored}=f,intent=stored.auditEntries.find(e=>e.data.domain==='task'&&e.data.kind==='effect-intent'),auth=await createEffectOperatorAuth(h.ctx.runtimePaths),token=await readEffectOperatorToken(h.ctx.runtimePaths),sources=await h.query('source.list')
 const server=createServer((req,res)=>handleRequest(req,res,h.service,{effectOperatorAuth:auth}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const url=`http://127.0.0.1:${server.address().port}/tasks/${id}/effects/${intent.entryId}`,post=(suffix,body)=>fetch(url+suffix,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
 const checked=await post('/inspect',{});assert.equal(checked.status,200);const inspection=await checked.json();assert.deepEqual(await h.query('source.list'),sources)
 const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Operator read the actual retained partial effect.',outcome:'partial-or-unknown',noReplay:true},bytes=Buffer.from(JSON.stringify(doc)),sha256=createHash('sha256').update(bytes).digest('hex'),path='materials/runtime-evidence/effects/'+sha256+'.json';await mkdir(join(inspection.scope.taskRoot,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(inspection.scope.taskRoot,path),bytes)
 const proposal={...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'job-operator-close',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'Read back the exact retained effect; close with possible partial effects. Do not replay or resume.'},requests=modelCount(h)
 assert.equal((await post('/close',proposal)).status,200);assert.equal((await post('/close',proposal)).status,200);assert.equal((await post('/close',{...proposal,operatorText:'changed scope'})).status,409)
 const after=await snapshot(h,id);assert.equal(after.task.control,'paused');assert.equal(after.task.completion??null,null);assert.equal(after.audit.filter(r=>r.domain==='task'&&r.kind==='effect-reconciled').length,1);assert.equal(after.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,0);assert.equal(f.calls,1);assert.equal(modelCount(h),requests);assert.deepEqual(after.entries.find(e=>e.id===inspection.callEntryId),stored.entries.find(e=>e.id===inspection.callEntryId))
})
