import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,link,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {restartDrainHost} from './fixtures/official-restart-drain.js'

// The former Owner/execution restart reply is replaced by the actual Single
// operator capability + committed effect/drain receipts. No execution driver or
// successful result is reconstructed from an operator acknowledgement.
test('actual HTTP inspection is zero-write and partial-effect closure is capability/digest bound and idempotent',{timeout:20000},async t=>{
 const h=await restartDrainHost(t),created=await h.create(),task=await h.uncertain(created),intent=await h.intent(task),before=await h.native(task),commands=h.commands,count=h.f.requests.length
 for(const headers of [{},{authorization:'Bearer '+'0'.repeat(64)},{authorization:'Bearer '+h.token,origin:'https://outside.invalid'}])assert.equal((await h.post(task,intent,'inspect',{},headers)).status,403)
 const checked=await h.post(task,intent,'inspect');assert.equal(checked.status,200);assert.equal(checked.body.outcome,'unknown');assert.equal(checked.body.noReplay,true);assert.equal(h.commands,commands);assert.deepEqual((await h.native(task)).entries,before.entries)
 const evidence=await h.evidence(checked.body)
 assert.equal((await h.post(task,intent,'close',{...evidence.proposal,requestId:'stale-scope-attempt',scopeDigest:'f'.repeat(64)})).body.error,'TASK_EFFECT_PROPOSAL_STALE')
 assert.equal((await h.post(task,intent,'close',{...evidence.proposal,requestId:'invalid-success-attempt',operatorText:'Caller claims success',outcome:'succeeded'})).body.error,'TASK_EFFECT_OPERATOR_REQUEST_INVALID')
 const closed=await h.post(task,intent,'close',evidence.proposal);assert.equal(closed.status,200,JSON.stringify(closed));assert.equal(closed.body.state,'committed');assert.equal((await h.post(task,intent,'close',evidence.proposal)).status,200)
 assert.equal((await h.post(task,intent,'close',{...evidence.proposal,operatorText:'changed review scope'})).body.error,'DYNAMIC_COMMAND_ID_CONFLICT')
 const row=await h.query('task.get',{taskId:task.taskId}),after=await h.native(task);assert.equal(row.control,'paused');assert.equal(row.effectReconciliations[0].receipt.payload.partialEffectsPossible,true);assert.equal(row.effectReconciliations[0].receipt.payload.noReplay,true)
 for(const entry of before.entries.filter(entry=>entry.type==='message'))assert.deepEqual(after.entries.find(item=>item.id===entry.id),entry)
 assert.equal(after.audit.filter(receipt=>receipt.kind==='effect-result').length,0,'no successful tool receipt is fabricated');assert.equal(h.effects,1);assert.equal(h.f.requests.length,count)
})

test('HTTP reconciliation survives cold restart without replay and rejects changed or multiply linked maintenance evidence',{timeout:20000},async t=>{
 const h=await restartDrainHost(t),task=await h.uncertain(await h.create()),intent=await h.intent(task),original=await h.native(task)
 await h.cold();await h.service.recover();await h.service.whenIdle();assert.equal(h.effects,1);assert.equal(h.f.requests.length,1);assert.deepEqual((await h.native(task)).entries,original.entries)
 const checked=await h.post(task,intent,'inspect');assert.equal(checked.status,200);const evidence=await h.evidence(checked.body)
 await writeFile(evidence.absolute,'changed bytes');assert.equal((await h.post(task,intent,'close',evidence.proposal)).body.error,'TASK_EFFECT_EVIDENCE_HASH_MISMATCH');await writeFile(evidence.absolute,evidence.bytes)
 const alias=evidence.absolute+'.alias';await link(evidence.absolute,alias);assert.equal((await h.post(task,intent,'close',evidence.proposal)).body.error,'TASK_EFFECT_EVIDENCE_PATH_UNSAFE');await unlink(alias)
 assert.equal((await h.post(task,intent,'close',evidence.proposal)).status,200);await h.service.recover();await h.service.whenIdle();assert.equal(h.effects,1);assert.equal(h.f.requests.length,1);assert.equal(await readFile(join(checked.body.scope.taskRoot,'work/uncertain.txt'),'utf8'),'one partial effect')
})
