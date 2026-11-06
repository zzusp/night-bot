import {nativeSessionHeader} from './fixtures/native-session-header.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {Context} from '@deepseek-ai/cordis'

import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {admissionAuditKinds} from '../src/runtime/pi-business-admission.js'
import {taskToolInputOrigin,taskEffectIntentOrigin} from '../src/tasks/input-origin.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
async function fixture(t){const root=await mkdtemp('/tmp/night-invocation-identity-'),ctx=new Context();await ctx.plugin(Authority);const persistence=new PiPersistence(ctx,{root}),writer=await persistence.createNative(nativeSessionHeader('session',{cwd:root}),{auditKinds:{...admissionAuditKinds,'task/effect-intent':()=>true}});t.after(async()=>{await writer.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})});const binding={taskId:'task',sessionId:'session',requirementRevision:1,controlRevision:1,contextRevision:0,leaseEpoch:1},args={value:'same'},packet={id:'original',source:{kind:'task-input',taskSession:binding},content:[{type:'text',text:'Two independently requested actions may have identical arguments'}]};writer.appendAudit({version:1,domain:'admission',kind:'enqueued',payload:packet});const inputEntryId=writer.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source});writer.appendAudit({version:1,domain:'admission',kind:'admitted',payload:{id:packet.id,entryId:inputEntryId}});const callEntryId=writer.manager.appendMessage({role:'assistant',content:['one','two'].map(id=>({type:'toolCall',id,name:'effect',arguments:args})),api:'openai-completions',provider:'fixture',model:'fixture',usage,stopReason:'toolUse',timestamp:1});await writer.commit();const origin=id=>taskToolInputOrigin(writer.manager,{callId:id,name:'effect',args,taskId:'task',sessionId:'session',atEntryId:callEntryId});const payload=id=>{const proof=origin(id);return {version:2,key:proof.invocationKey,name:'effect',callId:id,invocation:{callEntryId:proof.callEntryId,inputEntryId:proof.inputEntryId,packetId:proof.packetId,inputDigest:proof.inputDigest,originBinding:proof.binding}}};return{writer,origin,payload,identity:{taskId:'task',sessionId:'session'}}}
test('official distinct calls in one admitted input have different stable invocation identities despite identical arguments',async t=>{
 const f=await fixture(t),one=f.origin('one'),two=f.origin('two');assert.equal(one.key,two.key,'the old argument key cannot distinguish intentional independent calls');assert.equal(one.callEntryId,two.callEntryId);assert.equal(one.packetId,two.packetId);assert.notEqual(one.invocationKey,two.invocationKey);assert.equal(f.origin('one').invocationKey,one.invocationKey)
 for(const id of ['one','two']){const intent=f.payload(id);f.writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:intent});await f.writer.commit();const resolved=taskEffectIntentOrigin(f.writer.manager,intent,f.identity);assert.equal(resolved.invocationKey,intent.key);assert.equal(resolved.inputDigest,intent.invocation.inputDigest)}
})
test('persisted invocation identity cannot be reassigned to another packet or official call',async t=>{
 const f=await fixture(t),intent=f.payload('one');f.writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:intent});await f.writer.commit()
 for(const change of [{callEntryId:'foreign-call'},{inputEntryId:'foreign-input'},{packetId:'foreign-packet'},{inputDigest:'0'.repeat(64)},{originBinding:{...intent.invocation.originBinding,contextRevision:1}}])assert.throws(()=>taskEffectIntentOrigin(f.writer.manager,{...intent,invocation:{...intent.invocation,...change}},f.identity),{code:'TASK_EFFECT_AUDIT_INVALID'})
})
test('a Night v1 intent resolves its original invocation without rewriting the official journal',async t=>{
 const f=await fixture(t),origin=f.origin('one'),intent={key:origin.key,name:'effect',callId:'one'};f.writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:intent});await f.writer.commit();const before=f.writer.manager.getEntries(),resolved=taskEffectIntentOrigin(f.writer.manager,{...intent,settled:true},f.identity);assert.equal(resolved.invocationKey,origin.invocationKey);assert.deepEqual(f.writer.manager.getEntries(),before)
})

test('real SDK independently committed identical calls in one input execute twice with separate invocation receipts',{timeout:20000},async t=>{
 const {providerHost,result}=await import('./fixtures/provider-official-host.js');let step=0
 const h=await providerHost(t,{decide:()=>++step===1?[{name:'provider_effect_once',args:{}},{name:'provider_effect_once',args:{}}]:[result('wait','Two explicitly requested independent actions completed')]})
 const objective='Perform exactly two independently requested provider_effect_once actions with identical args';const id=(await h.service.createTask({groupId:'native-group',requestId:'two-independent-calls-one-input',objective})).taskId;await h.service.whenIdle();assert.equal(h.effects,2)
 const stored=await h.stored(id);const input=stored.entries.find(entry=>entry.id===stored.audit.find(row=>row.domain==='admission'&&row.kind==='admitted').payload.entryId);assert.ok(input?.content.some(block=>block.type==='text'&&block.text.includes(objective)),'the actual admitted official packet carries the explicit two-action objective');const intents=stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').map(row=>row.payload);assert.equal(intents.length,2);assert.ok(intents.every(row=>row.version===2));assert.notEqual(intents[0].key,intents[1].key);assert.notEqual(intents[0].callId,intents[1].callId);assert.equal(intents[0].invocation.callEntryId,intents[1].invocation.callEntryId);assert.equal(intents[0].invocation.packetId,intents[1].invocation.packetId);assert.equal(intents[0].invocation.inputEntryId,intents[1].invocation.inputEntryId);assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,2)
 const requests=h.taskRequests().length;await h.service.recover();await h.service.whenIdle();assert.equal(h.effects,2);assert.equal(h.taskRequests().length,requests)
})
test('a real SDK call re-entered through its exact execution middleware cannot repeat its effect',{timeout:20000},async t=>{
 const {providerHost,result}=await import('./fixtures/provider-official-host.js');let step=0,reentered,original
 const h=await providerHost(t,{decide:()=>++step===1?[{name:'provider_effect_once',args:{}}]:[result('wait','Original call completed once')]})
 h.ctx.on('tools/execute',async(exec,next)=>{if(exec.name!=='provider_effect_once')return next();const first=await next();original=first;reentered=await next();return first})
 const id=await h.create('same-official-call-reentry');await h.service.whenIdle();assert.equal(h.effects,1);assert.equal(reentered,original,'the same execution reuses its actual canonical result')
 const stored=await h.stored(id);assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,1);assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,1)
})

test('overlapping continuations of one real SDK execution share one effect and canonical result',{timeout:20000},async t=>{
 const {providerHost,result}=await import('./fixtures/provider-official-host.js');let step=0,outputs
 const h=await providerHost(t,{decide:()=>++step===1?[{name:'provider_effect_once',args:{}}]:[result('wait','Concurrent continuations completed once')]})
 h.ctx.on('tools/execute',async(exec,next)=>{if(exec.name!=='provider_effect_once')return next();outputs=await Promise.all([next(),next()]);return outputs[0]})
 const id=await h.create('same-official-call-concurrent-reentry');await h.service.whenIdle();assert.equal(h.effects,1);assert.equal(outputs[0],outputs[1]);
 const stored=await h.stored(id);assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,1);assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,1)
})

async function appendReusedCall(f,{contextRevision=1,args={value:'changed'},packetId='later'}={}){
 const binding={...f.origin('one').binding,contextRevision},packet={id:packetId,source:{kind:'task-input',taskSession:binding},content:[{type:'text',text:'A separately admitted authorized input'}]}
 f.writer.appendAudit({version:1,domain:'admission',kind:'enqueued',payload:packet})
 const inputEntryId=f.writer.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId,source:packet.source})
 f.writer.appendAudit({version:1,domain:'admission',kind:'admitted',payload:{id:packetId,entryId:inputEntryId}})
 const callEntryId=f.writer.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id:'one',name:'effect',arguments:args}],api:'openai-completions',provider:'fixture',model:'fixture',usage,stopReason:'toolUse',timestamp:2})
 const origin=taskToolInputOrigin(f.writer.manager,{callId:'one',name:'effect',args,...f.identity,atEntryId:callEntryId})
 return {origin,intent:{key:origin.key,name:'effect',callId:'one'}}
}
test('Night v1 reused call IDs resolve only the unique official legacy-key and admitted-input match',async t=>{
 for(const second of [{contextRevision:1,args:{value:'same'}},{contextRevision:0,args:{value:'different'}}]){
  const f=await fixture(t),first=f.origin('one'),original={key:first.key,name:'effect',callId:'one'}
  f.writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:original});await f.writer.commit()
  const later=await appendReusedCall(f,second);f.writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:later.intent});await f.writer.commit()
  const before=f.writer.manager.getEntries(),resolved=taskEffectIntentOrigin(f.writer.manager,later.intent,f.identity)
  assert.equal(resolved.callEntryId,later.origin.callEntryId);assert.equal(resolved.packetId,'later');assert.notEqual(resolved.callEntryId,first.callEntryId)
  assert.equal(taskEffectIntentOrigin(f.writer.manager,original,f.identity).callEntryId,first.callEntryId);assert.deepEqual(f.writer.manager.getEntries(),before)
 }
})
test('Night v1 reused call IDs with indistinguishable legacy keys remain rejected',async t=>{
 const f=await fixture(t),later=await appendReusedCall(f,{contextRevision:0,args:{value:'same'}})
 f.writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:later.intent});await f.writer.commit()
 assert.throws(()=>taskEffectIntentOrigin(f.writer.manager,later.intent,f.identity),{code:'TASK_EFFECT_CALL_AMBIGUOUS'})
})
