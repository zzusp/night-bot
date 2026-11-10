import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {hash} from '../src/memory/format.js'

test('actual full-access model shell cannot read another principal raw Markdown or original state',{skip:process.platform!=='linux',timeout:20000},async t=>{
  let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'isolated privacy probe'}}}})
  const a=await f.agent('private-owner',{actorId:'alice'}),b=await f.agent('private-reader',{actorId:'bob'})
  await f.say(a.agent,'记住 facts/value：KERNEL_PRIVATE_MARKER')
  const scope=await f.host.ctx.memory.scope(a.agent,{}),path=join(f.host.ctx.memory.store.directory(scope),'topics',hash('facts')+'.md')
  await b.agent.ctx.get('permissionPresets').set(b.agent,'danger-full-access')
  const script='const fs=require("node:fs");try{process.stdout.write(fs.readFileSync(process.argv[1],"utf8"))}catch(e){process.stdout.write("PRIVATE_READ_BLOCKED:"+e.code)}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'"
  command=[process.execPath,'-e',script,path].map(quote).join(' ')
  attempt=true;await f.say(b.agent,'read the privacy fixture from a real shell')
  const last=JSON.stringify(f.requests.at(-1));assert.doesNotMatch(last,/KERNEL_PRIVATE_MARKER/)
  assert.match(last,/PRIVATE_READ_BLOCKED/,'the real program must execute under the privacy kernel mask')
})

for(const preset of ['workspace-write','danger-full-access','read-only'])test('portable '+preset+' shell confines business writes to its installation workspace',{skip:process.platform!=='linux',timeout:20000},async t=>{
  let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'installation boundary probe'}}}}),h=await f.agent('boundary-'+preset,{actorId:'owner'})
  await h.agent.ctx.get('permissionPresets').set(h.agent,preset)
  const outside=join(f.root,'outside-business.txt'),inside=join(f.host.ctx.runtimePaths.workspaces,'inside-business.txt')
  const script='const fs=require("node:fs");for(const p of process.argv.slice(1)){try{fs.writeFileSync(p,"proof");console.log("WROTE:"+p)}catch(e){console.log("DENIED:"+p)}}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";command=[process.execPath,'-e',script,outside,inside].map(quote).join(' ')
  attempt=true;await f.say(h.agent,'run the local boundary fixture')
  const last=JSON.stringify(f.requests.at(-1));assert.ok(last.includes('DENIED:'+outside),last);assert.ok(last.includes((preset==='read-only'?'DENIED:':'WROTE:')+inside),last)
})

test('portable model processes cannot read the vault or inherit provider/environment credential values',{skip:process.platform!=='linux',timeout:20000},async t=>{
  const {writeFile}=await import('node:fs/promises');let command,attempt=false
  const f=await memoryHost(t,()=>{if(attempt){attempt=false;return {tool:'bash',args:{command,description:'private credential boundary probe'}}}}),h=await f.agent('vault-reader',{actorId:'owner'})
  await writeFile(join(f.host.ctx.runtimePaths.secrets,'.env'),'FIXTURE_ONLY_SECRET=VAULT_VALUE_MUST_NOT_APPEAR\n',{mode:0o600})
  process.env.NIGHT_FIXTURE_PROVIDER_TOKEN='ENV_VALUE_MUST_NOT_APPEAR';t.after(()=>delete process.env.NIGHT_FIXTURE_PROVIDER_TOKEN)
  await h.agent.ctx.get('permissionPresets').set(h.agent,'danger-full-access')
  assert.equal(f.host.ctx.get('toolPermissions').mode,'ask');assert.equal(f.host.ctx.runtimePaths.mode,'portable')
  const script='const fs=require("node:fs");console.log(process.env.NIGHT_FIXTURE_PROVIDER_TOKEN??"ENV_BLOCKED");try{console.log(fs.readFileSync(process.argv[1],"utf8"))}catch{console.log("VAULT_BLOCKED")}'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";command=[process.execPath,'-e',script,join(f.host.ctx.runtimePaths.secrets,'.env')].map(quote).join(' ')
  attempt=true;await f.say(h.agent,'run the isolated credential probe');const response=JSON.stringify(f.requests.at(-1));assert.match(response,/ENV_BLOCKED/);assert.match(response,/VAULT_BLOCKED/);assert.doesNotMatch(response,/VAULT_VALUE_MUST_NOT_APPEAR|ENV_VALUE_MUST_NOT_APPEAR/)
})

test('portable capped grep exposes only its own durable spill and read recovers the omitted tail',{skip:process.platform!=='linux',timeout:20000},async t=>{
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
  await f.close();await f.boot();const other=await f.agent('another-spill-reader',{actorId:'another'});await f.say(other.agent,'Try reading the other owner spill fixture');const denied=f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1);assert.match(JSON.stringify(denied),/PERMISSION_PRIVATE_PATH_DENIED/);assert.doesNotMatch(JSON.stringify(denied),/PORTABLE_SPILL_LINE_251/)
})

test('task archive fences absolute writes, symlink escapes and private journals in an actual model shell; task temporary files stay local',{skip:process.platform!=='linux',timeout:20000},async t=>{
  const {taskDirectories}=await import('../packages/dingtalk-core/session-workspaces.js'),{writeFile,symlink,readFile}=await import('node:fs/promises');let command,first=true
  const f=await memoryHost(t,()=>{if(first){first=false;return {tool:'bash',args:{command,description:'task archive kernel boundary probe'}}}}),p=f.host.ctx.runtimePaths,a=await taskDirectories(p.workspaces,'kernel-task'),b=await taskDirectories(p.workspaces,'other-task')
  await writeFile(join(a.root,'task.json'),'HOST_METADATA');await writeFile(join(a.root,'sessions','private.txt'),'JOURNAL_PRIVATE_VALUE');await writeFile(join(b.work,'other.txt'),'OTHER_TASK_PRIVATE_VALUE');await symlink(b.work,join(a.work,'escape'))
  const h=await f.host.ctx.agents.create({sessionId:'task-archive-kernel',meta:{cwd:a.root,agentPreset:'night-bot'},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup:async ctx=>{await f.host.ctx.agentPresets.mount(ctx,'night-bot')}});await f.host.ctx.memory.bindSession(h.agent.id,{actorId:'owner'});await h.agent.ctx.get('permissionPresets').set(h.agent,'danger-full-access')
  assert.equal(f.host.ctx.get('toolPermissions').mode,'ask');assert.equal(f.host.ctx.runtimePaths.mode,'portable')
  const script='const fs=require("node:fs"),p=require("node:path");for(const [label,file]of JSON.parse(process.argv[1])){try{fs.writeFileSync(file,"probe");console.log("WROTE:"+label)}catch{console.log("DENIED:"+label)}}for(const file of process.argv.slice(2)){try{console.log(fs.readFileSync(file,"utf8"))}catch{console.log("READ_BLOCKED")}}fs.writeFileSync(p.join(process.env.TMPDIR,"task-tmp-proof"),"TMP_IS_LOCAL");'
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'",targets=[['metadata',join(a.root,'task.json')],['outputs',join(a.outputs,'forged.txt')],['other',join(b.work,'forged.txt')],['escape',join(a.work,'escape','forged.txt')],['work',join(a.work,'proof.txt')]]
  command=[process.execPath,'-e',script,JSON.stringify(targets),join(a.root,'sessions','private.txt'),join(b.work,'other.txt')].map(quote).join(' ')
  await f.say(h.agent,'run the authorized isolated task boundary probe');const response=JSON.stringify(f.requests.at(-1));for(const label of ['metadata','outputs','other','escape'])assert.match(response,new RegExp('DENIED:'+label));assert.match(response,/WROTE:work/);assert.doesNotMatch(response,/JOURNAL_PRIVATE_VALUE|OTHER_TASK_PRIVATE_VALUE/);assert.equal(await readFile(join(a.tmp,'task-tmp-proof'),'utf8'),'TMP_IS_LOCAL');assert.equal(await readFile(join(a.root,'task.json'),'utf8'),'HOST_METADATA')
})

test('a real task-scoped capped grep stores and recovers its complete output within that task archive',{skip:process.platform!=='linux',timeout:15000},async t=>{
  const {taskDirectories}=await import('../packages/dingtalk-core/session-workspaces.js'),{registerTaskSession}=await import('../src/tasks/session-routes.js'),{writeFile,readdir}=await import('node:fs/promises');let phase=0,spill
  const f=await memoryHost(t,async body=>{if(phase++===0)return {tool:'grep',args:{pattern:'TASK_LOCAL_SPILL',include:'many.txt'}};if(phase===2){assert.match(JSON.stringify(body.messages.filter(message=>message.role==='tool').at(-1)),/Full grep result stored at:/);const entries=await readdir(join(root,'materials/runtime-evidence/tools'),{recursive:true,withFileTypes:true}),file=entries.find(entry=>entry.isFile());assert.ok(file);spill=join(file.parentPath,file.name);assert.ok(JSON.stringify(body).includes(spill));return {tool:'read',args:{path:spill,offset:245,limit:30}}}return {text:'task-local full output verified'}})
  const paths=f.host.ctx.runtimePaths,task={taskId:'task-local-spill',sessionId:'task-local-spill-session'},root=(await taskDirectories(paths.workspaces,task.taskId)).root;await registerTaskSession(paths,f.host.ctx.get('taskSessionRoutes'),task);await writeFile(join(root,'sessions/many.txt'),'TASK_LOCAL_SPILL_PRIVATE_JOURNAL');await writeFile(join(root,'work/many.txt'),Array.from({length:251},(_,n)=>'TASK_LOCAL_SPILL_'+(n+1)).join('\n'))
  const handle=await f.host.ctx.agents.create({sessionId:task.sessionId,meta:{cwd:root,agentPreset:'night-bot-task'},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup:async ctx=>{await f.host.ctx.agentPresets.mount(ctx,'night-bot-task')}});await f.host.ctx.memory.bindSession(task.sessionId,{actorId:'owner'});await f.say(handle.agent,'Search the task fixture and recover its omitted tail');assert.equal(phase,3);assert.ok(spill.startsWith(join(root,'materials/runtime-evidence/tools')));assert.doesNotMatch(JSON.stringify(f.requests),/TASK_LOCAL_SPILL_PRIVATE_JOURNAL/);assert.match(JSON.stringify(f.requests.at(-1).messages.filter(message=>message.role==='tool').at(-1)),/TASK_LOCAL_SPILL_251/)
})
