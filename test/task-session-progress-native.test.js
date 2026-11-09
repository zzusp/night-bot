import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {taskEvidenceFixture,call,decision,latestInput} from './fixtures/runtime-task-evidence.js'
const hash=value=>createHash('sha256').update(value).digest('hex')
const toolEntries=stored=>stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult')

test('Single running progress stays on the same live actor and cancellation joins it without replacement',{timeout:20000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await taskEvidenceFixture(t,async()=>{entered.resolve();await release.promise;return [decision('complete','Late completion must be cancelled')]},{skills:false})
 const created=await f.h.service.createTask({requestId:'live-progress',objective:'Keep one real task turn running until cancelled'})
 try{
  await entered.promise;const running=await f.h.query('task.get',{taskId:created.taskId});assert.equal(running.drained,false);assert.ok(f.h.ctx.agents.get(running.sessionId));const count=f.h.requests.length
  await f.h.service.recover();assert.equal(f.h.requests.length,count);assert.equal((await f.h.query('execution.list')).length,0)
  const cancelling=f.h.service.cancelTask({taskId:created.taskId,requestId:'cancel-live-progress'});release.resolve();await cancelling
  const cancelled=await f.h.query('task.get',{taskId:created.taskId});assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.drained,true);assert.equal(cancelled.sessionId,running.sessionId);assert.equal(f.h.ctx.agents.get(running.sessionId),undefined)
 }finally{release.resolve()}
})

test('Single preserves round evidence and native decision entries without rewriting prior work',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,request=>{
  if(!latestInput(request).dialogue){if(step++===0)return [call('write',{path:'work/proof.txt',content:'ROUND_ONE_VERIFIED_PROOF'})];return [decision('wait','ROUND_ONE_PLAN_AND_RESULT',{evidence:['work/proof.txt'],limitations:['Awaiting the second evidence question']})]}
  if(step++===2)return [call('read',{path:'work/proof.txt'})]
  assert.match(JSON.stringify(request),/ROUND_ONE_VERIFIED_PROOF/);return [decision('wait','ROUND_TWO_REVIEW_RESULT',{evidence:['work/proof.txt'],limitations:['No additional work authorized']})]
 },{skills:false})
 const task=await f.create('round-progress','Create proof once then await evidence review'),before=await f.sole(task),path=join(task.workspaceDir??before.header.cwd,'work/proof.txt'),bytes=await readFile(path),prefix=before.entries.filter(entry=>entry.type==='message')
 await f.dialogue(task,'round-two','Review the original proof without changing it')
 const after=await f.sole(task);assert.equal(hash(await readFile(path)),hash(bytes));for(const entry of prefix)assert.deepEqual(after.entries.find(item=>item.id===entry.id),entry)
 assert.match(JSON.stringify(after.entries),/ROUND_ONE_PLAN_AND_RESULT/);assert.match(JSON.stringify(after.entries),/ROUND_TWO_REVIEW_RESULT/)
 assert.equal(after.audit.filter(receipt=>receipt.kind==='effect-intent').length,1);assert.equal(after.audit.filter(receipt=>receipt.kind==='effect-result').length,1)
})

test('waiting progress with no new evidence neither repeats effects nor fabricates a new execution after cold recovery',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,()=>step++===0?[call('write',{path:'work/once.txt',content:'EXACTLY_ONCE_PROGRESS'})]:[decision('wait','Evidence exists; there is no authority for another effect',{evidence:['work/once.txt'],limitations:['Awaiting an actual new requirement']})],{skills:false})
 const task=await f.create('no-new-progress','Write one proof and wait'),before=await f.sole(task),count=f.h.requests.length
 for(let n=0;n<2;n++){await f.h.service.recover();await f.h.service.whenIdle()}
 assert.equal(f.h.requests.length,count);await f.cold();await f.h.service.recover();await f.h.service.whenIdle();assert.equal(f.h.requests.length,0)
 const after=await f.sole(task);assert.equal(after.audit.filter(receipt=>receipt.kind==='effect-intent').length,1);assert.equal(after.audit.filter(receipt=>receipt.kind==='effect-result').length,1);assert.equal(hash(await readFile(join(after.header.cwd,'work/once.txt'))),hash(Buffer.from('EXACTLY_ONCE_PROGRESS')));assert.equal(after.header.id,before.header.id)
})

test('human-wait progress answers only from actual evidence and cannot authorize a business write',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,request=>{
  if(!latestInput(request).dialogue)return [decision('blocked','Need the allowed environment before proceeding',{question:'Which environment is authorized?',audience:'operator',attemptedActions:['Inspected the original requirement']})]
  if(step++===0)return [call('write',{path:'work/forbidden-progress.txt',content:'must not write'})]
  return [decision('wait','The original environment question remains unanswered',{evidence:['The original pending question'],limitations:['A progress question grants no execution permission']})]
 },{skills:false})
 const task=await f.create('human-progress','Wait for an explicit environment authorization'),before=await f.h.query('task.get',{taskId:task.taskId}),pending=before.humanRequests.find(item=>item.status==='waiting-reply')
 assert.ok(pending);const count=f.h.requests.length;await f.h.service.recover();await f.h.service.whenIdle();assert.equal(f.h.requests.length,count)
 const after=await f.dialogue(task,'human-progress-question','What is blocking progress?');assert.equal(after.humanRequests.find(item=>item.requestId===pending.requestId).status,'waiting-reply')
 assert.ok(f.h.toolResults.some(row=>row.name==='write'&&row.result.isError));assert.equal((await f.sole(task)).audit.filter(receipt=>receipt.kind==='effect-intent').length,0)
})

test('final progress verifies a real file, freezes the reported artifact and retains the official read evidence',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,request=>{
  if(step++===0)return [call('write',{path:'work/final.txt',content:'VERIFIED_FINAL_ARTIFACT'})]
  if(step===2)return [call('read',{path:'work/final.txt'})]
  assert.match(JSON.stringify(request),/VERIFIED_FINAL_ARTIFACT/);return [decision('complete','Read back and reviewed the final artifact',{evidence:['work/final.txt: VERIFIED_FINAL_ARTIFACT'],limitations:['Local fixture only'],artifacts:['work/final.txt'],deliveryFiles:[{path:'work/final.txt',caption:'Reviewed final proof'}]})]
 },{skills:false})
 const task=await f.create('artifact-progress','Write and read back one final file before reporting it');assert.equal(task.status,'completed');assert.equal(task.drained,true)
 const stored=await f.sole(task),result=task.completion.result;assert.equal(result.artifactFiles.length,1);assert.equal(result.artifactFiles[0].artifact.fileName,'final.txt');assert.equal(result.artifactFiles[0].artifact.sha256,hash(Buffer.from('VERIFIED_FINAL_ARTIFACT')))
 assert.ok(toolEntries(stored).some(entry=>entry.message.toolName==='read'&&!entry.message.isError&&JSON.stringify(entry.message.content).includes('VERIFIED_FINAL_ARTIFACT')))
 const saved=structuredClone(result.artifactFiles);await writeFile(join(stored.header.cwd,'work/final.txt'),'later editable change');assert.deepEqual((await f.h.query('task.get',{taskId:task.taskId})).completion.result.artifactFiles,saved)
 const count=f.h.requests.length;await f.h.service.recover();await f.h.service.whenIdle();assert.equal(f.h.requests.length,count)
})
