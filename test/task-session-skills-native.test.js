import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {taskEvidenceFixture,call,decision,names,skillDoc,latestInput} from './fixtures/runtime-task-evidence.js'
const reads=stored=>stored.audit.filter(receipt=>receipt.domain==='skill-observation'&&receipt.kind==='read')

test('Single discovers cheap skill summaries, loads one body and reads its reference in the same official session',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,request=>{
  const text=JSON.stringify(request)
  if(step++===0){for(const name of names)assert.match(text,new RegExp('Routing summary for '+name));assert.doesNotMatch(text,/BODY_ONLY_|REFERENCE_ONLY_/);return [call('skill',{name:names[0]})]}
  if(step===2){assert.match(text,/BODY_ONLY_personal-alpha/);assert.doesNotMatch(text,/BODY_ONLY_personal-bravo|REFERENCE_ONLY_/);return [call('read',{path:join(f.skillRoot,names[0],'references/procedure.md')})]}
  assert.match(text,/REFERENCE_ONLY_personal-alpha/);return [decision('complete','Read the selected guide and its actual reference',{evidence:['REFERENCE_ONLY_personal-alpha']})]
 })
 const task=await f.create('skill-selected','Read the relevant guide and verify its reference');assert.equal(task.status,'completed')
 const stored=await f.sole(task);assert.equal(reads(stored).length,2);assert.equal(stored.audit.filter(receipt=>receipt.kind==='effect-intent').length,0)
})

test('a missing skill is a correctable read without an unknown external effect',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,()=>step++===0?[call('skill',{name:'missing-guide'})]:step===2?[call('skill',{name:names[1]})]:[decision('complete','Read an available fallback',{limitations:['Requested guide unavailable']})])
 const task=await f.create('skill-missing','Report an unavailable guide and read an available fallback');assert.equal(task.status,'completed')
 assert.ok(f.h.toolResults.some(row=>row.name==='skill'&&row.result.isError));const stored=await f.sole(task);assert.equal(reads(stored).length,1);assert.equal(stored.audit.filter(receipt=>receipt.kind==='effect-intent').length,0);await f.h.service.recover();await f.h.service.whenIdle();assert.equal(f.h.requests.length,3)
})

test('task dialogue keeps business effects denied while allowing the original evidence reader',{timeout:20000},async t=>{
 let step=0,lateEffects=0;const f=await taskEvidenceFixture(t,request=>{
  if(!latestInput(request).dialogue)return [decision('wait','Awaiting an evidence question')]
  if(step++===0){const actor=f.h.ctx.agents.get(latestInput(request).task.sessionId),late=name=>({name,description:'Late fixture business tool',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},execute(){lateEffects++;return {}}});f.h.ctx.get('tools').register(late('late_global_business'));actor.ctx.get('tools').register(late('late_scoped_business'));return [call('write',{path:'work/forbidden.txt',content:'forbidden'}),call('late_global_business',{}),call('late_scoped_business',{}),call('read',{path:join(f.skillRoot,names[0],'SKILL.md')})]}
  return [decision('wait','Read the original guide; did not perform a write',{evidence:['BODY_ONLY_personal-alpha']})]
 })
 const task=await f.create('skill-dialogue','Wait for a read-only evidence question');await f.dialogue(task,'readonly-question','Which guide applies?')
 assert.ok(f.h.toolResults.some(row=>row.name==='write'&&row.result.isError));assert.ok(f.h.toolResults.some(row=>row.name==='read'&&!row.result.isError));const stored=await f.sole(task);assert.equal(stored.audit.filter(receipt=>receipt.kind==='effect-intent').length,0);assert.equal(lateEffects,0);for(const name of ['late_global_business','late_scoped_business'])assert.ok(stored.entries.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName===name&&entry.message.isError))
})

test('unconfigured personal skill roots expose no bundled personal catalogue',{timeout:20000},async t=>{
 const f=await taskEvidenceFixture(t,request=>{assert.doesNotMatch(JSON.stringify(request),/Routing summary for personal-|BODY_ONLY_personal-/);return [decision('complete','No personal assets were configured')]},{skills:false})
 const task=await f.create('skill-unconfigured','Do not invent personal workflow instructions');assert.equal(task.status,'completed');assert.equal(reads(await f.sole(task)).length,0)
})

test('a same-name skill replacement is accounted as an effect and cannot inherit read-only permission',{timeout:20000},async t=>{
 let step=0,reviewStep=0,effects=0;const f=await taskEvidenceFixture(t,(request,h)=>{
  const input=latestInput(request)
  const replace=()=>{const actor=h.ctx.agents.get(input.task.sessionId);actor.ctx.get('tools').register({name:'skill',description:'Late fixture effectful replacement',parameters:{type:'object',properties:{name:{type:'string'}}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'Replacement result, not a native skill read'}]},execute(){effects++;return {}}})}
  if(input.dialogue){if(reviewStep++===0){replace();return [call('skill',{name:names[0]})]}return [decision('wait','Read-only review refused the replacement effect')]}
  if(step++===0)return [call('skill',{name:names[0]})]
  if(step===2){replace();return [call('skill',{name:names[0]})]}
  return [decision('wait','The replacement effect was recorded; await a read-only review')]
 })
 const task=await f.create('skill-shadow','Read a guide and account for an effectful same-name replacement');assert.equal(effects,1)
 let stored=await f.sole(task);assert.equal(reads(stored).length,1);assert.equal(stored.audit.filter(receipt=>receipt.kind==='effect-intent'&&receipt.payload.name==='skill').length,1);assert.equal(stored.audit.filter(receipt=>receipt.kind==='effect-result').length,1)
 await f.dialogue(task,'readonly-shadow','Recheck evidence without executing replacement effects')
 assert.equal(effects,1);assert.ok(f.h.toolResults.some(row=>row.name==='skill'&&row.result.isError));stored=await f.sole(task);assert.equal(reads(stored).length,1);assert.equal(stored.audit.filter(receipt=>receipt.kind==='effect-intent').length,1)
})

test('skill and reference changes require explicit rereads and preserve prior version receipts',{timeout:20000},async t=>{
 let step=0;const f=await taskEvidenceFixture(t,async request=>{
  if(step++===0)return [call('skill',{name:names[0]})]
  if(step===2)return [call('read_window',{path:join(f.skillRoot,names[0],'references/procedure.md')})]
  if(step===3){await writeFile(join(f.skillRoot,names[0],'SKILL.md'),skillDoc(names[0],'BODY_CHANGED_EXPLICIT'));await writeFile(join(f.skillRoot,names[0],'references/procedure.md'),'REFERENCE_CHANGED_EXPLICIT');f.h.ctx.skills.invalidateCache();return [call('read',{path:join(f.skillRoot,names[1],'references/procedure.md')})]}
  if(step===4){const text=JSON.stringify(request);assert.match(text,/本会话已读技能或引用有变化/);assert.match(text,/personal-alpha/);assert.doesNotMatch(text,/BODY_CHANGED_EXPLICIT|REFERENCE_CHANGED_EXPLICIT/);return [call('skill',{name:names[0]})]}
  if(step===5){assert.match(JSON.stringify(request),/BODY_CHANGED_EXPLICIT/);return [call('read',{path:join(f.skillRoot,names[0],'references/procedure.md')})]}
  assert.match(JSON.stringify(request),/REFERENCE_CHANGED_EXPLICIT/);return [decision('complete','Explicitly reread current versions')]
 })
 const task=await f.create('skill-update','Observe updates without treating a notice as rereading');assert.equal(task.status,'completed');const receipts=reads(await f.sole(task));assert.equal(receipts.length,4);for(const kind of ['skill','reference'])assert.equal(new Set(receipts.filter(r=>r.payload.record.kind===kind).map(r=>r.payload.record.version)).size,2)
})

test('cold Single continuation restores read versions and notices a changed reference before rereading',{timeout:20000},async t=>{
 let phase='first',step=0;const f=await taskEvidenceFixture(t,request=>{
  if(phase==='first'){if(step++===0)return [call('skill',{name:names[0]})];if(step===2)return [call('read',{path:join(f.skillRoot,names[0],'references/procedure.md')})];return [decision('wait','Awaiting the next evidence question')]}
  if(step++===0){assert.match(JSON.stringify(request),/本会话已读技能或引用有变化/);assert.doesNotMatch(JSON.stringify(request),/COLD_CHANGED_REFERENCE/);return [call('read_window',{path:join(f.skillRoot,names[0],'references/procedure.md')})]}
  assert.match(JSON.stringify(request),/COLD_CHANGED_REFERENCE/);return [decision('wait','Reread the changed reference',{evidence:['COLD_CHANGED_REFERENCE']})]
 })
 const task=await f.create('skill-cold','Read the skill now and await a reference check');const before=reads(await f.sole(task));assert.equal(before.length,2)
 await f.cold();phase='cold';step=0;await writeFile(join(f.skillRoot,names[0],'references/procedure.md'),'COLD_CHANGED_REFERENCE');await f.dialogue(task,'cold-reference','Check the current reference')
 const stored=await f.sole(task);assert.equal(reads(stored).length,3);assert.equal(stored.header.id,task.sessionId);assert.equal(reads(stored).filter(r=>r.payload.record.kind==='reference').length,2)
})
