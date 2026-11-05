import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {providerHost,result} from './fixtures/provider-official-host.js'
const effect={name:'provider_effect_once',args:{}}
test('a verified new source may intentionally repeat identical arguments while duplicate input and cold recovery never replay its call',{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-effect-call-identity-'));let h,cold,step=0;t.after(async()=>{await cold?.close();await h?.close();await rm(root,{recursive:true,force:true})})
 const text='Explicit authorized request: execute the same provider_effect_once with the same empty arguments again as a second intentional action.'
 h=await providerHost(t,{root,decide:request=>{step++;if(step===3)assert.ok(JSON.stringify(request.messages).includes(text),'the second action must follow the exact admitted new source');return step%2===1?[effect]:[result('wait','Requested action recorded')]}})
 const id=await h.create('intentional-repeat');await h.service.whenIdle();assert.equal(h.effects,1)
 const before=await h.stored(id),args={taskId:id,requestId:'explicit-second-action',progressImpact:'preserve',context:text,expectedRequirementRevision:1,expectedControlRevision:1}
 await h.service.appendTaskContext(args);await h.service.whenIdle();assert.equal(h.effects,2,'identical arguments are a legitimate second action under a real new source')
 const after=await h.stored(id);assert.equal(after.task.taskId,before.task.taskId);assert.equal(after.task.sessionId,before.task.sessionId);assert.equal(after.task.requirementRevision,1);assert.equal(after.task.contextRevision,1)
 const sources=await Promise.all(after.task.sourceRefs.map(sourceId=>h.query('source.get',{sourceId}))),source=sources.find(source=>source.text===text);assert.ok(source);assert.equal(source.channel,'web');assert.equal(source.actorId,'native-user');assert.equal(source.version,1)
 const packets=after.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued'),admitted=after.audit.filter(row=>row.domain==='admission'&&row.kind==='admitted');assert.equal(packets.length,2);assert.equal(new Set(packets.map(row=>row.payload.id)).size,2)
 const inputs=packets.map(packet=>{const ack=admitted.find(row=>row.payload.id===packet.payload.id);assert.ok(ack);const entry=after.entries.find(entry=>entry.id===ack.payload.entryId);assert.equal(entry.customType,'night.business-input');return entry});assert.ok(JSON.stringify(inputs[1]).includes(text))
 const calls=after.entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').flatMap(entry=>entry.message.content.filter(part=>part.type==='toolCall'&&part.name===effect.name).map(part=>({entryId:entry.id,callId:part.id,args:part.arguments})));assert.equal(calls.length,2);assert.notEqual(calls[0].entryId,calls[1].entryId);assert.notEqual(calls[0].callId,calls[1].callId);assert.deepEqual(calls.map(call=>call.args),[{},{}])
 const count=h.taskRequests().length;await h.service.appendTaskContext(args);await h.service.whenIdle();assert.equal(h.effects,2);assert.equal(h.taskRequests().length,count);await h.service.recover();await h.service.whenIdle();assert.equal(h.effects,2);assert.equal(h.taskRequests().length,count)
 const originalHistory=after.entries;await h.close();cold=await providerHost(t,{root,initialize:false,decide:()=>assert.fail('cold recovery must not invoke the model for an already acknowledged input')});for(let n=0;n<2;n++){await cold.service.recover();await cold.service.whenIdle()};assert.equal(cold.effects,0);assert.equal(cold.taskRequests().length,0);assert.deepEqual((await cold.stored(id)).entries,originalHistory)
})

test('an explicit verified source requesting identical unknown effects cannot authorize replay before reconciliation',{timeout:20000},async t=>{
 let effects=0
 const h=await providerHost(t,{decide:()=>[{name:'identity_unknown_effect',args:{value:'exact-original'}}]})
 h.ctx.get('tools').register({name:'identity_unknown_effect',description:'Fixture effect followed by a genuinely uncertain ordinary error',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},output:{schema:{type:'object'},render:()=>[{type:'text',text:'Unexpected success'}]},async execute({value},exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/identity-unknown-effect.txt'),value);throw new Error('The effect happened before its ordinary error; outcome must be reconciled')}})
 const id=await h.create('unknown-explicit-repeat');await h.service.whenIdle();assert.equal(effects,1)
 const before=await h.stored(id),requests=h.taskRequests().length;assert.ok(before.task.lastDecision.limitations.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY'));assert.equal(before.task.drained,true)
 const text='I explicitly request another execution of identity_unknown_effect with identical value exact-original. This is a new request, not evidence establishing what the first operation did.'
 await h.service.appendTaskContext({taskId:id,requestId:'unknown-explicit-second-action',progressImpact:'preserve',context:text,expectedRequirementRevision:1,expectedControlRevision:1});await h.service.whenIdle()
 const after=await h.stored(id),sources=await Promise.all(after.task.sourceRefs.map(sourceId=>h.query('source.get',{sourceId}))),source=sources.find(item=>item.text===text)
 assert.ok(source);assert.equal(source.channel,'web');assert.equal(source.actorId,'native-user');assert.equal(source.version,1)
 assert.equal(after.task.contextRevision,1);assert.equal(after.task.requirementRevision,1);assert.equal(effects,1,'new source does not prove the previous unknown effect absent or reconciled');assert.equal(h.taskRequests().length,requests,'unknown effects fence the model before it can repeat its tool call')
 assert.ok(after.task.lastDecision.limitations.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY'));assert.equal(after.task.lastDecision.action,'blocked');assert.equal(after.task.status,'active');assert.equal(after.task.drained,true)
 assert.equal(after.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,1);assert.equal(after.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,0);assert.equal(after.audit.filter(row=>row.domain==='task'&&row.kind==='effect-reconciled').length,0)
 const calls=after.entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').flatMap(entry=>entry.message.content.filter(part=>part.type==='toolCall'&&part.name==='identity_unknown_effect'));assert.equal(calls.length,1)
 await h.service.recover();await h.service.whenIdle();assert.equal(effects,1);assert.equal(h.taskRequests().length,requests)
})
