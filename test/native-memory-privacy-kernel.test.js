import test from 'node:test'
import assert from 'node:assert/strict'
import {join,dirname} from 'node:path'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {entryPath} from '../src/memory/layered-format.js'
import {memoryHost} from './fixtures/memory-host.js'
import {hash} from '../src/memory/format.js'

test('the memory index excludes retained private history even though trusted OS-account shell access can read it',{skip:process.platform!=='linux',timeout:20000},async t=>{
  let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'isolated raw-memory privacy probe'}}}})
  const a=await f.agent('memory-owner',{actorId:'alice'}),b=await f.agent('memory-reader',{actorId:'bob'})
  await f.say(a.agent,'记住 facts/value：KERNEL_SHARED_MEMORY_MARKER')
  const scope=await f.host.ctx.memory.scope(a.agent,{}),other=await f.host.ctx.memory.scope(b.agent,{})
  assert.equal(scope.kind,'bot');assert.equal(other.id,scope.id);assert.notEqual(other.actor,scope.actor)
  const path=join(f.host.ctx.memory.store.directory(scope),entryPath('facts','value'))
  assert.match(await readFile(path,'utf8'),/KERNEL_SHARED_MEMORY_MARKER/,'the probe targets actual current layered Markdown, not a removed topics path')
  const original=join(f.host.ctx.runtimePaths.memory,'v1','personal',hash('alice'),'topics',hash('facts')+'.md')
  await mkdir(dirname(original),{recursive:true});await writeFile(original,'RETAINED_PRIVATE_HISTORY_MARKER')
  // A legacy native preset cannot override the authenticated application mode.
  await b.agent.ctx.get('permissionPresets').set(b.agent,'danger-full-access')
  assert.equal(f.host.ctx.get('toolPermissions').mode,'full')
  const script='const fs=require("node:fs");for(const path of process.argv.slice(1)){try{console.log(fs.readFileSync(path,"utf8"))}catch{console.log("PRIVATE_READ_BLOCKED")}}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
  command=[process.execPath,'-e',script,path,original].map(quote).join(' ')
  attempt=true;await f.say(b.agent,'Read the shared fixture through its normal index; probe raw application files with the real shell.')
  const request=f.requests.at(-1),last=JSON.stringify(request),tool=JSON.stringify(request.messages.filter(message=>message.role==='tool').at(-1))
  assert.match(last,/KERNEL_SHARED_MEMORY_MARKER/,'shared recall is available to the second authenticated actor')
  assert.doesNotMatch(JSON.stringify(request.messages.filter(message=>message.role!=='tool')),/RETAINED_PRIVATE_HISTORY_MARKER/,'old private history is never imported into shared recall')
  assert.match(tool,/KERNEL_SHARED_MEMORY_MARKER/)
  assert.match(tool,/RETAINED_PRIVATE_HISTORY_MARKER/)
  assert.equal(await readFile(original,'utf8'),'RETAINED_PRIVATE_HISTORY_MARKER')
})

for(const preset of ['workspace-write','danger-full-access','read-only'])test('portable shell uses OS access under historical preset '+preset,{skip:process.platform!=='linux',timeout:20000},async t=>{
  let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'installation boundary probe'}}}}),h=await f.agent('boundary-'+preset,{actorId:'owner'})
  await h.agent.ctx.get('permissionPresets').set(h.agent,preset)
  const outside=join(f.root,'outside-business.txt'),inside=join(f.host.ctx.runtimePaths.workspaces,'inside-business.txt')
  const script='const fs=require("node:fs");for(const p of process.argv.slice(1)){try{fs.writeFileSync(p,"proof");console.log("WROTE:"+p)}catch(e){console.log("DENIED:"+p)}}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";command=[process.execPath,'-e',script,outside,inside].map(quote).join(' ')
  attempt=true;await f.say(h.agent,'run the local boundary fixture')
  const last=JSON.stringify(f.requests.at(-1));assert.ok(last.includes('WROTE:'+outside),last);assert.ok(last.includes('WROTE:'+inside),last)
})

test('portable capped grep follows the reported file path and recovers its omitted tail after restart',{skip:process.platform!=='linux',timeout:20000},async t=>{
  const {writeFile,readdir}=await import('node:fs/promises');let phase=0,spill
  const f=await memoryHost(t,async body=>{
    if(phase++===0)return {tool:'grep',args:{pattern:'PORTABLE_SPILL_LINE',include:'many.txt'}}
    if(phase===2){const entries=await readdir(f.host.ctx.runtimePaths.spills,{recursive:true,withFileTypes:true}),file=entries.find(entry=>entry.isFile());assert.ok(file);spill=join(file.parentPath,file.name);assert.ok(JSON.stringify(body).includes(spill));return {tool:'read',args:{path:spill,offset:245,limit:30}}}
    if(phase===4)return {tool:'read',args:{path:spill}}
    return {text:'portable tail verified'}
  }),h=await f.agent('portable-spill-owner',{actorId:'owner'})
  await writeFile(join(f.host.ctx.runtimePaths.workspaces,'many.txt'),Array.from({length:251},(_,i)=>'PORTABLE_SPILL_LINE_'+(i+1)).join('\n'))
  await f.say(h.agent,'Find all the fixture lines, then recover the omitted tail')
  assert.equal(phase,3);assert.match(JSON.stringify(f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1)),/PORTABLE_SPILL_LINE_251/)
  await f.close();await f.boot();const other=await f.agent('another-spill-reader',{actorId:'another'});await f.say(other.agent,'Try reading the other owner spill fixture');const denied=f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1);assert.match(JSON.stringify(denied),/PORTABLE_SPILL_LINE_251/)
})

test('a real task-scoped capped grep stores and recovers its complete output within that task archive',{skip:process.platform!=='linux',timeout:15000},async t=>{
  const {taskDirectories}=await import('../packages/dingtalk-core/session-workspaces.js'),{registerTaskSession}=await import('../src/tasks/session-routes.js'),{writeFile,readdir}=await import('node:fs/promises');let phase=0,spill
  const f=await memoryHost(t,async body=>{if(phase++===0)return {tool:'grep',args:{pattern:'TASK_LOCAL_SPILL',path:'work',include:'many.txt'}};if(phase===2){assert.match(JSON.stringify(body.messages.filter(message=>message.role==='tool').at(-1)),/Full grep result stored at:/);const entries=await readdir(join(root,'materials/runtime-evidence/tools'),{recursive:true,withFileTypes:true}),file=entries.find(entry=>entry.isFile());assert.ok(file);spill=join(file.parentPath,file.name);assert.ok(JSON.stringify(body).includes(spill));return {tool:'read',args:{path:spill,offset:245,limit:30}}}return {text:'task-local full output verified'}})
  const paths=f.host.ctx.runtimePaths,task={taskId:'task-local-spill',sessionId:'task-local-spill-session'},root=(await taskDirectories(paths.workspaces,task.taskId)).root;await registerTaskSession(paths,f.host.ctx.get('taskSessionRoutes'),task);await writeFile(join(root,'sessions/many.txt'),'TASK_LOCAL_SPILL_PRIVATE_JOURNAL');await writeFile(join(root,'work/many.txt'),Array.from({length:251},(_,n)=>'TASK_LOCAL_SPILL_'+(n+1)).join('\n'))
  const handle=await f.host.ctx.agents.create({sessionId:task.sessionId,meta:{cwd:root,agentPreset:'night-bot-task'},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup:async ctx=>{await f.host.ctx.agentPresets.mount(ctx,'night-bot-task')}});await f.host.ctx.memory.bindSession(task.sessionId,{actorId:'owner'});await f.say(handle.agent,'Search the task fixture and recover its omitted tail');assert.equal(phase,3);assert.ok(spill.startsWith(join(root,'materials/runtime-evidence/tools')));assert.doesNotMatch(JSON.stringify(f.requests),/TASK_LOCAL_SPILL_PRIVATE_JOURNAL/);assert.match(JSON.stringify(f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1)),/TASK_LOCAL_SPILL_251/)
})
