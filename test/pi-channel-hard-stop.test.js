import test from 'node:test'
import assert from 'node:assert/strict'
import {fork,spawn,execFile} from 'node:child_process'
import {mkdtemp,rm,mkdir,symlink,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {once} from 'node:events'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const role of ['router','query','reply-query','unknown','unfrozen','fails','unreadable','slow','retry-new'])test(`${role}: SIGKILL recovery uses the original session and does not replay effects`,{timeout:nativeTestTimeout(60000)},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-hard-stop-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let oldRoot
 if(role==='unfrozen'){
  oldRoot=join(root,'old-code');await mkdir(oldRoot)
  const repo=fileURLToPath(new URL('../',import.meta.url))
  const {stdout}=await promisify(execFile)('git',['archive','523430099caf08224ea8343ada9e7cc7025887c7'],{cwd:repo,encoding:'buffer',maxBuffer:64*1024*1024})
  const unpack=spawn('tar',['-x','-C',oldRoot]);unpack.stdin.end(stdout);assert.equal((await once(unpack,'exit'))[0],0)
  await symlink(join(repo,'node_modules'),join(oldRoot,'node_modules'),'dir')
 }
 const children=[];t.after(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL')})
 const start=phase=>{
  const child=fork(new URL('./fixtures/channel-hard-stop-child.js',import.meta.url),[root,role,phase,...phase==='seed'&&oldRoot?[oldRoot]:[]],{stdio:['ignore','pipe','pipe','ipc']});children.push(child)
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk)
  const message=new Promise((resolve,reject)=>{child.on('message',value=>value.type==='error'?reject(Error(value.error)):resolve(value));child.once('exit',(code,signal)=>reject(Error(`Child exited ${code}/${signal}: ${stderr}`)))})
  return {child,message}
 }
 const first=start('seed'),before=await first.message
 assert.equal(before.type,'held');assert.ok(!before.entries.some(entry=>entry.message?.stopReason==='aborted'))
 assert.equal(before.sent.length,['unknown','reply-query'].includes(role)?1:0)
 const death=once(first.child,'exit');first.child.kill('SIGKILL');assert.deepEqual(await death,[null,'SIGKILL'])
 let damaged
 if(role==='unreadable'){damaged=(await readFile(before.file,'utf8'))+'corrupt-tail\n';await writeFile(before.file,damaged)}
 const second=start('recover'),after=await second.message
 if(role==='slow'){assert.equal(after.type,'ready-isolated');assert.equal(after.other.cursor,1);assert.equal(after.sent.length,0);assert.equal((await once(second.child,'exit'))[0],0);return}
 assert.equal(after.type,'recovered');if(role==='retry-new'){assert.notEqual(after.sessionId,before.sessionId);assert.equal(after.inbox.length,0);assert.equal(after.rotations.length,1);assert.equal(after.rotations[0].recovery.reason,'ROUTER_CONTINUATION_FAILED');assert.equal(after.sent.length,0);assert.equal((await once(second.child,'exit'))[0],0);return}
 if(role==='unreadable'){
  assert.notEqual(after.sessionId,before.sessionId);assert.equal(await readFile(before.file,'utf8'),damaged,'unreadable original retained byte for byte')
  assert.equal(after.rotations.length,1);assert.equal(after.rotations[0].state,'published');assert.equal(after.rotations[0].oldSessionId,before.sessionId)
  assert.equal(after.inbox.length,0);assert.equal(after.tasks.length,1);assert.equal(after.tasks[0].status,'completed');assert.equal(after.routerRows.length,2);assert.equal(after.sent.length,0);assert.ok(after.requests.some(body=>body.tools?.some(tool=>tool.function.name==='resident_router_settle')))
  assert.equal((await once(second.child,'exit'))[0],0);return
 }
 assert.equal(after.sessionId,before.sessionId)
 assert.deepEqual(after.entries.slice(0,before.entries.length),before.entries,'durable original history preserved')

 assert.equal(after.pending.length,0);assert.equal(after.inbox.length,role==='fails'?1:0);assert.equal(after.sent.length,0)
 if(role==='unfrozen'){const call=before.entries.findLast(entry=>entry.message?.role==='assistant').message.content.find(block=>block.type==='toolCall');assert.equal(call.name,'resident_router_reply');assert.ok(!before.entries.some(entry=>entry.message?.role==='toolResult'&&entry.message.toolCallId===call.id));assert.ok(oldRoot,'seed uses archived old main');assert.ok(!after.entries.some(entry=>entry.message?.role==='toolResult'&&entry.message.toolCallId===call.id),'no synthetic old tool result');assert.equal(before.notifications.length,0);assert.equal(before.inbox.length,12);assert.equal(after.routerRows.length,2);assert.equal(after.notifications.length,0);
  const inputEvents=after.entries.filter(entry=>entry.customType==='night.business-input').flatMap(entry=>entry.content.filter(block=>block.type==='text'&&block.text.startsWith('Router 请求：')).flatMap(block=>JSON.parse(block.text.slice('Router 请求：'.length)).events))
  const expected=before.inbox.map(event=>event.id);assert.deepEqual(inputEvents.slice(0,12).map(event=>event.id),expected);assert.equal(new Set(inputEvents.slice(0,12).map(event=>event.id)).size,12)
 }
 if(role!=='triage'){
  assert.equal(after.entries.filter(entry=>entry.customType==='night.business-input').length,role==='unfrozen'?3:1,'no replay or fabricated business input')
  const turns=after.entries.filter(entry=>entry.customType==='night.router-resume-turn')
  assert.equal(turns.length,1);assert.equal(turns[0].content,'继续处理未完成的事项')
  assert.equal(after.entries.filter(entry=>entry.customType==='night.router-resume-claim').length,1)
  assert.equal(after.entries.find(entry=>entry.customType==='night.router-resume-claim').content,'')
  const queries=after.entries.flatMap(entry=>entry.message?.role==='assistant'?entry.message.content:[]).filter(block=>block.type==='toolCall'&&block.name==='resident_task_query')
  assert.equal(queries.length,['query','reply-query'].includes(role)?1:0,'completed query is not repeated')
 }
 if(role==='unfrozen'){
  const view=JSON.stringify(after.requests)
  assert.match(view,/interrupted-tool-call/);assert.match(view,/ROUTER_PRIOR_EFFECT_UNRESOLVED/)
  const calls=after.entries.filter(entry=>entry.message?.role==='toolResult'&&entry.message.toolName==='resident_router_reply');assert.ok(calls.some(entry=>entry.message.isError))
 }
 const exit=await once(second.child,'exit');assert.equal(exit[0],0)
 if(role==='fails'){
  assert.equal(after.requests.length,1,'one failed continuation only')
  const third=start('recover'),again=await third.message
  assert.equal(again.requests.length,0,'consumed automatic continuation stays consumed across another process restart')
  assert.equal(again.sessionId,before.sessionId);assert.equal(again.inbox.length,1)
  assert.equal((await once(third.child,'exit'))[0],0)
 }
})
