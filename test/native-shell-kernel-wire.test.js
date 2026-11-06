import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {AgentSession} from '@earendil-works/pi-coding-agent'
const quote=text=>"'"+text.replaceAll("'","'\\''")+"'"
for(const promote of [false,true])test('actual Pi native confined bash retains one managed effect through '+(promote?'timeout promotion':'explicit background')+' and job collection',{timeout:20000,skip:process.platform!=='linux'},async t=>{
 let command,parent;const captured=[]
 const f=await memoryHost(t,()=>{
  if(f.requests.length===1)return {tool:'bash',args:{description:'Run one isolated managed fixture',command,...promote?{timeoutMs:20}:{run_in_background:true}}}
  if(f.requests.length===2){const job=f.host.ctx.jobs.list(parent.id)[0];assert.ok(job);return {tool:'job_output',args:{job_id:job.id,wait:true}}}
  return {text:'managed native shell verified'}
 })
 const effect=join(f.host.ctx.runtimePaths.workspaces,'effect.txt'),script='setTimeout(()=>{require("node:fs").appendFileSync('+JSON.stringify(effect)+',"effect\\n");process.stdout.write("SHELL_MANAGED_MARKER")},120)'
 command=quote(process.execPath)+' -e '+quote(script)
 assert.equal(f.host.ctx.get('shell').constructor.name,'NativeSandboxBashExecutor')
 const handle=await f.host.ctx.agents.create({sessionId:'native-shell-'+(promote?'promoted':'background'),meta:{cwd:f.host.ctx.runtimePaths.workspaces},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='managed-shell-fixture',setup:async ctx=>ctx.get('agentPresets').mount(ctx,'night-bot')});parent=handle.actor;t.after(()=>handle.dispose())
 f.host.ctx.on('tools/result',(exec,result)=>{if(exec.agent===parent&&exec.name==='bash')captured.push(result)})
 const packet={id:'managed-shell-input',source:{kind:'managed-shell-fixture'},content:'Run and collect the one isolated managed effect'}
 await handle.enqueue(packet);await handle.deliver(packet.id);await handle.whenIdle()
 assert.equal(f.requests.length,3);assert.equal(f.host.ctx.get('shell').processFacts.size,0);assert.equal(captured.length,1);assert.equal(captured[0].isError,false,JSON.stringify(captured));assert.equal(captured[0].value.kind,promote?'promoted':'background');assert.equal(await readFile(effect,'utf8'),'effect\n');assert.match(JSON.stringify(f.requests[2]),/SHELL_MANAGED_MARKER/)
 const saved=await f.host.ctx.sessionPersistence.readNative(parent.id,{requireComplete:true}),registered=saved.audit.filter(row=>row.domain==='job'&&row.kind==='registered'),settled=saved.audit.filter(row=>row.domain==='job'&&row.kind==='settled')
 assert.equal(registered.length,1);assert.equal(settled.length,1);assert.equal(registered[0].payload.version,1);assert.equal(registered[0].payload.toolCall.toolName,'bash');assert.equal(registered[0].payload.toolCall.callId,saved.context.piMessages.find(message=>message.role==='assistant'&&message.content.some(block=>block.type==='toolCall'&&block.name==='bash')).content.find(block=>block.type==='toolCall'&&block.name==='bash').id);assert.equal(registered[0].payload.label,command);assert.equal(registered[0].payload.owner,parent.id)
 assert.equal(settled[0].payload.jobId,registered[0].payload.jobId);assert.equal(settled[0].payload.producerReported,true);assert.equal(settled[0].payload.status,'completed');assert.equal(settled[0].payload.detail,'exit code: 0')
 const results=saved.context.piMessages.filter(message=>message.role==='toolResult');assert.equal(results.length,2);assert.ok(results.every(message=>!message.isError));assert.deepEqual(results.map(message=>message.toolName),['bash','job_output'])
 const inputs=saved.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input');assert.equal(inputs.length,1);assert.deepEqual(inputs[0].details,{packetId:packet.id,source:packet.source});assert.equal(saved.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued').length,1);assert.equal(saved.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted').length,1);assert.equal(saved.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued-internal'&&row.payload.source.kind==='tool-jobs').length,0)
 assert.ok(parent.piSession instanceof AgentSession);assert.equal(parent.session,undefined)
})
