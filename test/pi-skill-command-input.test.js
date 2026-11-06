import {nativeSessionHeader} from './fixtures/native-session-header.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'

import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {createBusinessAdmission,admissionAuditKinds} from '../src/runtime/pi-business-admission.js'
import {skillCommand} from '../src/runtime/pi-skill-command-input.js'
const packet={id:'command',source:{kind:'direct-user'},content:[{type:'text',text:'/skill:verified do work'}]}
async function fixture(t){
 const root=await mkdtemp('/tmp/night-command-'),ctx=new Context();await ctx.plugin(Authority)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')}),options={auditKinds:admissionAuditKinds}
 const store=await backend.createNative(nativeSessionHeader('commands',{cwd:root}),options)
 t.after(async()=>{await store.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {store,backend,options}
}
// Public delivery-port contract double. It never expands a skill; integration
// tests exercise actual AgentSession expansion and the real provider boundary.
function sdk(store,admission,body=[{type:'text',text:'official expanded body'}]){
 const listeners=new Set();return {subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},async prompt(){
  for(const fn of listeners)fn({type:'message_end',message:{role:'user',content:body}})
  store.manager.appendMessage({role:'user',content:body,timestamp:1})
  await admission.beforeRequest()
 }}
}
test('only public skill prefix is a command; prose and ambiguous mixed content do not gain command authority',()=>{
 assert.equal(skillCommand({...packet,content:'please /verified now'}),undefined)
 assert.equal(skillCommand({...packet,content:'/verified now'}),undefined)
 assert.equal(skillCommand(packet).name,'verified')
 assert.throws(()=>skillCommand({...packet,content:[...packet.content,{type:'text',text:'second text'}]}),{code:'PI_SKILL_COMMAND_CONTENT_INVALID'})
})
test('command ACK is durable before request and binds original source to exact native user body; duplicate cannot replay',async t=>{
 const f=await fixture(t);let checks=0
 const q=await createBusinessAdmission({store:f.store,authorize:()=>true,authorizeSkillCommand:()=>{checks++;return true}}),session=sdk(f.store,q)
 await q.enqueue(packet);await q.deliver(session,packet.id)
 assert.equal(q.status(packet.id),'admitted');assert.deepEqual(q.pending(),[])
 const saved=await f.backend.readNative('commands'),ack=saved.audit.find(r=>r.kind==='command-admitted')
 assert.equal(saved.entries.find(e=>e.id===ack.payload.entryId).message.role,'user')
 const proof=q.lookupCommandEntry(ack.payload.entryId);assert.deepEqual(proof.packet,packet);assert.equal(checks,2)
 proof.packet.source.kind='forged';assert.equal(q.lookupCommandEntry(ack.payload.entryId).packet.source.kind,'direct-user')
 await q.deliver(session,packet.id);assert.equal(f.store.manager.getEntries().filter(e=>e.type==='message'&&e.message.role==='user').length,1)
 await assert.rejects(q.enqueue({...packet,content:'/skill:verified changed'}),{code:'PI_BUSINESS_ADMISSION_ID_CONFLICT'})
 await q.close()
})
test('missing command ACK after strict cold reopen remains uncertain and never guesses a body or replays',async t=>{
 const f=await fixture(t),q=await createBusinessAdmission({store:f.store,authorize:()=>true,authorizeSkillCommand:()=>true})
 await q.enqueue(packet)
 await assert.rejects(q.deliver({subscribe(){return()=>{}},async prompt(){}},packet.id),{code:'PI_SKILL_COMMAND_UNCERTAIN'})
 await q.close();await f.store.close()
 const reopened=await f.backend.openNative('commands',f.options),cold=await createBusinessAdmission({store:reopened,authorize:()=>true,authorizeSkillCommand:()=>true})
 assert.equal(cold.status(packet.id),'uncertain')
 await assert.rejects(cold.beforeRequest(),{code:'PI_SKILL_COMMAND_UNCERTAIN'})
 let calls=0;await assert.rejects(cold.deliver({subscribe(){return()=>{}},async prompt(){calls++}},packet.id),{code:'PI_SKILL_COMMAND_UNCERTAIN'});assert.equal(calls,0)
 await cold.close();await reopened.close()
})
test('internal notice source strings cannot obtain a native user command; revoked policy cannot dispatch',async t=>{
 const f=await fixture(t);let publish,calls=0
 const q=await createBusinessAdmission({store:f.store,authorize:()=>true,authorizeSkillCommand:()=>false,bindInternal:fn=>{publish=fn}})
 await q.enqueue(packet);await assert.rejects(q.deliver({subscribe(){return()=>{}},prompt(){calls++}},packet.id),{code:'PI_SKILL_COMMAND_DENIED'});assert.equal(calls,0)
 await publish({...packet,id:'internal'})
 await q.deliver({async sendCustomMessage(value){f.store.manager.appendCustomMessageEntry(value.customType,value.content,value.display,value.details);await q.beforeRequest()}},'internal')
 assert.equal(q.status('internal'),'admitted');assert.equal(calls,0);await q.close()
})
test('extra or modified native user entry fails correlation instead of issuing a command ACK',async t=>{
 const f=await fixture(t),q=await createBusinessAdmission({store:f.store,authorize:()=>true,authorizeSkillCommand:()=>true}),listeners=[]
 await q.enqueue(packet)
 await assert.rejects(q.deliver({subscribe(fn){listeners.push(fn);return()=>{}},async prompt(){
  listeners.forEach(fn=>fn({type:'message_end',message:{role:'user',content:'observed'}}))
  f.store.manager.appendMessage({role:'user',content:'modified',timestamp:1});await q.beforeRequest()
 }},packet.id),{code:'PI_SKILL_COMMAND_CORRELATION_INVALID'})
 assert.equal((await f.store.readAudit()).filter(r=>r.kind==='command-admitted').length,0);await q.close()
})
