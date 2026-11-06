import test from 'node:test'
import assert from 'node:assert/strict'
import {restartDrainHost} from './fixtures/official-restart-drain.js'

// The retired Windows execution_restart_scope_probe driver is not installed in
// the default Single product. Windows command-plan/provider-hash pure tests are
// separate; these Linux cases prove registered-owned-provider-ranges only, not
// Windows kernel parity or containment of arbitrary escaped descendants.
// Owner/team drain is mapped to the sole actor's actual SDK/tool/process join.
test('actual owned Linux range and unjoined tool block HTTP drain attestation until cancellation joins',{timeout:20000,skip:process.platform!=='linux'},async t=>{
 const h=await restartDrainHost(t,{processGate:true}),created=await h.create();await h.entered.promise
 const task=await h.query('task.get',{taskId:created.taskId}),intent=await h.intent(task);assert.equal(task.drained,false);assert.ok(h.ctx.agents.get(task.sessionId));assert.equal(h.terminal.status,'running');assert.ok(h.ctx.get('subprocess').live.size>0)
 const commands=h.commands;assert.equal((await h.post(task,intent,'inspect')).body.error,'TASK_EFFECT_TASK_NOT_QUIESCENT');assert.equal(h.commands,commands)
 assert.equal((await h.native(task)).audit.filter(receipt=>receipt.kind==='owner-drained'||receipt.kind==='owner-drained-inputs').length,0)
 const cancelling=h.service.cancelTask({taskId:task.taskId,requestId:'operator-stop-for-maintenance'})
 // Abort is only a request. The admitted tool remains joined by its actual gate.
 await new Promise(resolve=>setImmediate(resolve));assert.equal((await h.post(task,intent,'inspect')).body.error,'TASK_EFFECT_TASK_NOT_QUIESCENT');assert.equal((await h.query('task.get',{taskId:task.taskId})).drained,false)
 h.release.resolve();await cancelling;await h.service.whenIdle()
 const drained=await h.query('task.get',{taskId:task.taskId});assert.equal(drained.drained,true);assert.equal(h.ctx.agents.get(task.sessionId),undefined);assert.equal(h.ctx.get('subprocess').live.size,0)
 const checked=await h.post(task,intent,'inspect');assert.equal(checked.status,200,JSON.stringify(checked));assert.equal(checked.body.proofScope,'registered-owned-provider-ranges');assert.equal(checked.body.outcome,'unknown')
 const evidence=await h.evidence(checked.body);assert.equal((await h.post(task,intent,'close',evidence.proposal)).status,200);assert.equal(h.effects,1)
})

test('operator JSON zero counts and another task scope cannot replace real Single maintenance proof',{timeout:20000},async t=>{
 const h=await restartDrainHost(t),task=await h.uncertain(await h.create()),intent=await h.intent(task),checked=await h.post(task,intent,'inspect');assert.equal(checked.status,200)
 const evidence=await h.evidence(checked.body),count=h.f.requests.length
 let attempt=0;for(const [extra,code]of [[{proof:{processes:0,jobs:0,modelIdle:true,toolsIdle:true}},'TASK_EFFECT_OPERATOR_REQUEST_INVALID'],[{scopeDigest:'0'.repeat(64)},'TASK_EFFECT_PROPOSAL_STALE'],[{currentBinding:{...evidence.proposal.currentBinding,sessionId:'another-session'}},'TASK_EFFECT_PROPOSAL_STALE']])assert.equal((await h.post(task,intent,'close',{...evidence.proposal,requestId:'rejected-maintenance-'+(++attempt),...extra})).body.error,code)
 assert.equal((await h.post(task,intent,'close',evidence.proposal)).status,200);assert.equal(h.f.requests.length,count);assert.equal(h.effects,1)
 const native=await h.native(task);assert.equal(native.audit.filter(receipt=>receipt.kind==='effect-reconciled').length,1);assert.equal(native.audit.filter(receipt=>receipt.kind==='effect-result').length,0)
})
