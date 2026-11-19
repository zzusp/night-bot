import test from 'node:test'
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {once} from 'node:events'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const role of ['triage','router','query','reply-query','unknown','fails'])test(`${role}: SIGKILL recovery uses the original session and does not replay effects`,{timeout:nativeTestTimeout(60000)},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-hard-stop-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const children=[];t.after(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL')})
 const start=phase=>{
  const child=fork(new URL('./fixtures/channel-hard-stop-child.js',import.meta.url),[root,role,phase],{stdio:['ignore','pipe','pipe','ipc']});children.push(child)
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk)
  const message=new Promise((resolve,reject)=>{child.on('message',value=>value.type==='error'?reject(Error(value.error)):resolve(value));child.once('exit',(code,signal)=>reject(Error(`Child exited ${code}/${signal}: ${stderr}`)))})
  return {child,message}
 }
 const first=start('seed'),before=await first.message
 assert.equal(before.type,'held');assert.ok(!before.entries.some(entry=>entry.message?.stopReason==='aborted'))
 assert.equal(before.sent.length,['unknown','reply-query'].includes(role)?1:0)
 const death=once(first.child,'exit');first.child.kill('SIGKILL');assert.deepEqual(await death,[null,'SIGKILL'])
 const second=start('recover'),after=await second.message
 assert.equal(after.type,'recovered');assert.equal(after.sessionId,before.sessionId)
 assert.deepEqual(after.entries.slice(0,before.entries.length),before.entries,'durable original history preserved')
 assert.equal(after.pending.length,0);assert.equal(after.inbox.length,['unknown','fails'].includes(role)?1:0);assert.equal(after.sent.length,0)
 if(role==='unknown'){assert.equal(after.requests.length,0,'unknown external effect is never replayed or inferred away');assert.ok(after.alerts.some(alert=>alert.detail==='PI_ROUTER_RESUME_EFFECT_UNRESOLVED'));return}
 if(role!=='triage'){
  assert.equal(after.entries.filter(entry=>entry.customType==='night.business-input').length,1,'no replay or fabricated business input')
  const turns=after.entries.filter(entry=>entry.customType==='night.router-resume-turn')
  assert.equal(turns.length,1);assert.equal(turns[0].content,'继续处理未完成的事项')
  assert.equal(after.entries.filter(entry=>entry.customType==='night.router-resume-claim').length,1)
  assert.equal(after.entries.find(entry=>entry.customType==='night.router-resume-claim').content,'')
  const queries=after.entries.flatMap(entry=>entry.message?.role==='assistant'?entry.message.content:[]).filter(block=>block.type==='toolCall'&&block.name==='resident_task_query')
  assert.equal(queries.length,['query','reply-query'].includes(role)?1:0,'completed query is not repeated')
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
