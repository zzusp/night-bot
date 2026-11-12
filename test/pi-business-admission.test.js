import {tmpdir} from 'node:os'
import {nativeSessionHeader} from './fixtures/native-session-header.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'

import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {createBusinessAdmission,admissionAuditKinds} from '../src/runtime/pi-business-admission.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-admission-')),ctx=new Context();await ctx.plugin(Authority)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')}),options={auditKinds:admissionAuditKinds}
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const store=await backend.createNative(nativeSessionHeader('admission',{cwd:root}),options)
 return {store,backend,options}
}
const packet={id:'input',source:{kind:'coordinator',taskId:'task'},content:'work'}
test('admission is durable before SDK delivery and duplicate IDs cannot change source or body',async t=>{
 const {store,backend}=await fixture(t),queue=await createBusinessAdmission({store,authorize:()=>true})
 await queue.enqueue(packet)
 assert.equal((await backend.readNative(store.id)).audit[0].kind,'enqueued')
 assert.deepEqual(await queue.enqueue(packet),{id:'input',duplicate:true,admitted:false})
 await assert.rejects(queue.enqueue({...packet,content:'different'}),{code:'PI_BUSINESS_ADMISSION_ID_CONFLICT'})
 const copy=queue.lookupPacket('input');copy.source.taskId='foreign';assert.equal(queue.lookupPacket('input').source.taskId,'task')
 let calls=0
 const sdk={async sendCustomMessage(message){calls++;store.manager.appendCustomMessageEntry(message.customType,message.content,message.display,message.details);await queue.beforeRequest()}}
 await queue.deliver(sdk,'input');await queue.deliver(sdk,'input')
 assert.equal(calls,1);assert.deepEqual(queue.pending(),[])
 assert.deepEqual((await backend.readNative(store.id)).audit.map(r=>r.kind),['enqueued','admitted'])
})
test('restored committed SDK input without caller acknowledgment repairs only receipt and never redelivers',async t=>{
 const f=await fixture(t),q=await createBusinessAdmission({store:f.store,authorize:()=>true});await q.enqueue(packet)
 f.store.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source});await f.store.close()
 const store=await f.backend.openNative('admission',f.options),restored=await createBusinessAdmission({store,authorize:()=>true})
 let dispatches=0;await restored.deliver({sendCustomMessage(){dispatches++;throw Error('replay')}},packet.id)
 assert.equal(dispatches,0);assert.deepEqual(restored.pending(),[])
})
test('revoked source and paused admission cannot dispatch; queued facts remain for review',async t=>{
 const {store}=await fixture(t);let allowed=true
 const queue=await createBusinessAdmission({store,authorize:()=>allowed});await queue.enqueue(packet)
 let calls=0;const sdk={sendCustomMessage(){calls++}}
 allowed=false;await assert.rejects(queue.deliver(sdk,packet.id),{code:'PI_BUSINESS_ADMISSION_DENIED'})
 allowed=true;queue.pause();await assert.rejects(queue.deliver(sdk,packet.id),{code:'PI_BUSINESS_ADMISSION_PAUSED'})
 await assert.rejects(queue.beforeRequest(),{code:'PI_BUSINESS_ADMISSION_PAUSED'})
 assert.equal(calls,0);assert.deepEqual(queue.pending(),[packet.id])
})
test('concurrent deliveries share durable ID admission rather than publishing two SDK messages',async t=>{
 const {store}=await fixture(t),release=Promise.withResolvers(),entered=Promise.withResolvers()
 const queue=await createBusinessAdmission({store,authorize:()=>true});await queue.enqueue(packet)
 let calls=0;const sdk={async sendCustomMessage(message){calls++;entered.resolve();await release.promise;store.manager.appendCustomMessageEntry(message.customType,message.content,message.display,message.details)}}
 const first=queue.deliver(sdk,packet.id);await entered.promise
 assert.deepEqual(await queue.deliver(sdk,packet.id),{id:packet.id,duplicate:true});release.resolve();await first
 assert.equal(calls,1)
})
test('an original SDK input with a conflicting body is never accepted as a delivery receipt',async t=>{
 const {store}=await fixture(t),queue=await createBusinessAdmission({store,authorize:()=>true});await queue.enqueue(packet)
 store.manager.appendCustomMessageEntry('night.business-input','forged',false,{packetId:packet.id,source:packet.source})
 await assert.rejects(queue.beforeRequest(),{code:'PI_BUSINESS_ADMISSION_ENTRY_CONFLICT'})
 assert.deepEqual(queue.pending(),[packet.id])
})
test('private notice origin survives restart without granting authority to a forged source string',async t=>{
 const f=await fixture(t);let publish
 const queue=await createBusinessAdmission({store:f.store,authorize:()=>false,bindInternal:port=>{publish=port}})
 const notice={id:'job:one:terminal',source:{kind:'job-completion'},content:'finished'}
 await assert.rejects(queue.enqueue(notice),{code:'PI_BUSINESS_ADMISSION_DENIED'})
 assert.equal('enqueueInternal' in queue,false);await publish(notice);await f.store.close()
 const store=await f.backend.openNative('admission',f.options),restored=await createBusinessAdmission({store,authorize:()=>false})
 let calls=0;await restored.deliver({async sendCustomMessage(message){calls++;store.manager.appendCustomMessageEntry(message.customType,message.content,message.display,message.details)}},notice.id)
 assert.equal(calls,1);assert.deepEqual(restored.pending(),[])
})


test('task result drains only internal job notices, keeps user input and rejects replay across late settlement and restart',async t=>{
 const f=await fixture(t);let publish,clears=0
 const queue=await createBusinessAdmission({store:f.store,authorize:()=>true,bindInternal:port=>{publish=port}})
 const job={id:'job-before',source:{kind:'job-completion'},content:'finished'},external={id:'user-job-string',source:{kind:'job-completion'},content:'not an internal notice'}
 await publish(job);await queue.enqueue(packet);await queue.enqueue(external)
 await queue.finishTaskRun({clearQueue(){clears++}})
 assert.equal(clears,1);assert.equal(queue.status(job.id),'cancelled')
 assert.deepEqual(queue.pending(),[packet.id,external.id])
 const late={...job,id:'job-after'};await publish(late);await publish(late)
 assert.equal(queue.status(late.id),'cancelled')
 assert.deepEqual(await queue.deliver({sendCustomMessage(){throw Error('must never dispatch')}},late.id),{id:late.id,retired:true})
 await queue.close();await f.store.close()
 const store=await f.backend.openNative('admission',f.options),restored=await createBusinessAdmission({store,authorize:()=>true})
 assert.equal(restored.status(job.id),'cancelled');assert.equal(restored.status(late.id),'cancelled')
 assert.deepEqual(restored.pending(),[packet.id,external.id])
 assert.equal((await store.readAudit()).filter(row=>row.kind==='cancelled'&&row.payload.id===late.id).length,1)
 await restored.close();await store.close()
})

test('effect hold preserves pending external inputs, retires late internal notices and is durable across restart',async t=>{
 const f=await fixture(t);let publish
 const queue=await createBusinessAdmission({store:f.store,authorize:()=>true,bindInternal:port=>{publish=port}})
 const internal={id:'job:held',source:{kind:'job-completion'},content:'terminal fact'},external={id:'external-job-kind',source:{kind:'job-completion'},content:'user input is not a trusted job notification'}
 await queue.enqueue(packet);await queue.enqueue(external);await publish(internal)
 await queue.holdTaskRun({clearQueue(){}})
 const late={...internal,id:'job:late'};await publish(late);await publish(late)
 for(const notice of [internal,late])assert.deepEqual(await queue.deliver({sendCustomMessage(){assert.fail('held notices must not restart inference')}},notice.id),{id:notice.id,retired:true})
 assert.deepEqual(queue.pending(),[packet.id,external.id])
 assert.equal(queue.paused,true)
 await assert.rejects(queue.deliver({sendCustomMessage(){assert.fail('user input stays pending')}},packet.id),{code:'PI_BUSINESS_ADMISSION_PAUSED'})
 await queue.close();await f.store.close()
 const store=await f.backend.openNative('admission',f.options),restored=await createBusinessAdmission({store,authorize:()=>true})
 assert.deepEqual(restored.pending(),[packet.id,external.id])
 assert.equal(restored.status(internal.id),'cancelled');assert.equal(restored.status(late.id),'cancelled')
 const cancelled=(await store.readAudit()).filter(row=>row.kind==='cancelled')
 assert.equal(cancelled.length,2);assert.ok(cancelled.every(row=>row.payload.reason==='task-effect-held'))
 await restored.close();await store.close()
})
