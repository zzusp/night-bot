import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {nativeSessionHeader} from './fixtures/native-session-header.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {Context} from '@deepseek-ai/cordis'
import {SessionManager} from '@earendil-works/pi-coding-agent'

import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {admissionAuditKinds} from '../src/runtime/pi-business-admission.js'
import {taskToolInputOrigin,committedLiveSupplementAdmissions} from '../src/tasks/input-origin.js'
import {taskEffectDigest} from '../src/tasks/effect-reconciliation.js'
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-input-origin-')),ctx=new Context();await ctx.plugin(Authority);const persistence=new PiPersistence(ctx,{root}),writer=await persistence.createNative(nativeSessionHeader('session',{cwd:root}),{auditKinds:admissionAuditKinds});t.after(async()=>{await writer.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})});const binding={taskId:'task',sessionId:'session',requirementRevision:1,controlRevision:1,contextRevision:0,leaseEpoch:1};function append(packet,{admitted=true}={}){writer.appendAudit({version:1,domain:'admission',kind:'enqueued',payload:packet});const entryId=writer.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source});if(admitted)writer.appendAudit({version:1,domain:'admission',kind:'admitted',payload:{id:packet.id,entryId}});return entryId}return{writer,persistence,binding,append}}
test('an original tool call keeps its official input binding after a later source is admitted',async t=>{
 const f=await fixture(t),args={path:'work/exact',content:'original'},source={kind:'task-input',taskSession:f.binding};f.append({id:'original',source,content:[{type:'text',text:'Original authority'}]})
 const callEntryId=f.writer.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id:'call',name:'write',arguments:args}],api:'openai-completions',provider:'fixture',model:'fixture',usage,stopReason:'toolUse',timestamp:1})
 f.append({id:'new',source:{kind:'task-input',taskSession:{...f.binding,contextRevision:1}},content:[{type:'text',text:'New source'}]});await f.writer.commit()
 const stored=await f.persistence.readNative('session',{requireComplete:true}),manager=SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(stored.entries))
 const origin=taskToolInputOrigin(manager,{callId:'call',name:'write',args,taskId:'task',sessionId:'session'});assert.equal(origin.callEntryId,callEntryId);assert.equal(origin.binding.contextRevision,0);assert.equal(origin.key,taskEffectDigest({requirementRevision:1,controlRevision:1,contextRevision:0,name:'write',args}))
 assert.throws(()=>taskToolInputOrigin(manager,{callId:'call',name:'write',args:{...args,content:'foreign'},taskId:'task',sessionId:'session'}),{code:'TASK_EFFECT_CALL_AMBIGUOUS'})
})
for(const format of ['legacy','neutral'])test('cold supplemental repair accepts exact committed '+format+' sources without rewriting history or queueing input',async t=>{
 const f=await fixture(t),sources=[{sourceId:'source',version:1,groupId:'original-room',messageId:'original-message',actorId:'original-actor',text:'Keep DingTalk as literal user text',quote:{messageId:'quoted-message',senderOpenDingTalkId:'quoted-actor',content:'Original quoted text'},resourceRefs:[{resourceId:'original-resource',kind:'file'}]}]
 const neutral=[{sourceId:'source',version:1,conversationId:'original-room',messageId:'original-message',actorId:'original-actor',text:'Keep DingTalk as literal user text',quote:{messageId:'quoted-message',actorId:'quoted-actor',text:'Original quoted text'},resourceRefs:[{resourceId:'original-resource',kind:'file'}]}]
 const row={messageId:'supplement',wakeId:'wake',state:'pending',sourceSnapshots:sources,request:'Same objective with source',leaseEpoch:1,requirementRevision:1,controlRevision:1,contextRevision:1},task={...f.binding,contextRevision:1,liveSupplements:[row]}
 const packet={id:'task-supplement:wake',source:{kind:'task-input',taskSession:{...f.binding,contextRevision:1}},content:[{type:'text',text:JSON.stringify({task:{request:row.request,contextRevision:1},sources:format==='neutral'?neutral:sources,supplement:{messageId:row.messageId,contextRevision:1}})}]}
 const entryId=f.append(packet);await f.writer.commit();const stored=await f.persistence.readNative('session',{requireComplete:true})
 const manager=()=>SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(stored.entries)),native=manager(),before=structuredClone(native.getEntries()),snapshot=structuredClone(task)
 assert.deepEqual(committedLiveSupplementAdmissions(native,task),[{messageId:'supplement',entryId,packetId:packet.id,binding:{kind:'task-session',...f.binding,contextRevision:1}}])
 assert.deepEqual(native.getEntries(),before);assert.deepEqual(task,snapshot)
 for(const changed of [{version:2},{actorId:'foreign-actor'},{text:'Tampered original text'},{sourceId:'foreign-source'},{groupId:'foreign-room'},{quote:{...sources[0].quote,senderOpenDingTalkId:'foreign-quoted-actor'}}]){
  assert.throws(()=>committedLiveSupplementAdmissions(native,{...task,liveSupplements:[{...row,sourceSnapshots:[{...sources[0],...changed}]}]}),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'})
 }
 const mismatched=manager(),input=mismatched.getEntries().find(entry=>entry.id===entryId)
 input.content=[{type:'text',text:packet.content[0].text+' '}]
 assert.throws(()=>committedLiveSupplementAdmissions(mismatched,task),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'},'enqueued packet and native input bytes must still match')
 const foreign=manager(),enqueued=foreign.getEntries().find(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data.kind==='enqueued')
 enqueued.data.payload.source.taskSession.taskId='foreign-task'
 assert.throws(()=>committedLiveSupplementAdmissions(foreign,task),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'},'neutral projection cannot weaken the admitted task/session identity')
 const ack=native.getEntries().find(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data.kind==='admitted');native.branch(ack.parentId)
 assert.deepEqual(committedLiveSupplementAdmissions(native,task),[],'a branch without committed admission cannot ACK SQL')
 assert.deepEqual((await f.persistence.readNative('session',{requireComplete:true})).entries,stored.entries,'offline proof must not rewrite the durable journal')
})

for(const directWeb of [false,true])test(`cold faithful supplement repairs only matching persisted ${directWeb?'signed Web update':'Router handoff'}`,async t=>{
 const f=await fixture(t),policy='faithful-handoff-v1',metadataSource={sourceId:'source',messageId:'original-message',version:1,actorId:'original-actor',conversationId:'original-room',channel:directWeb?'web':'im'}
 const {conversationId,...sourceFact}=metadataSource
 const sourceSnapshot={...sourceFact,groupId:conversationId,text:'Original text not republished by the handoff',...directWeb?{requestIdentity:{action:{kind:'task.supplement'}}}:{}}
 const update={id:'supplement',sourceId:'source',messageVersion:1,text:'Explicit direct update'}
 const handoff={id:'supplement',sourceId:'source',messageVersion:1,requirementRevision:1,contextRevision:1,text:'Faithful task handoff'}
 const row={messageId:'supplement',wakeId:'wake',state:'pending',inputPolicy:policy,sourceRefs:['source'],sourceSnapshots:[sourceSnapshot],request:'Task title not sent to the model',leaseEpoch:1,requirementRevision:1,controlRevision:1,contextRevision:1,...directWeb?{currentInput:update}:{}}
 const binding={...f.binding,contextRevision:1},task={...binding,metadata:{routerInputPolicy:policy,routerHandoffs:directWeb?[]:[handoff]},liveSupplements:[row]}
 const body={task:{...binding,inputPolicy:policy,sourceRefs:row.sourceRefs},sources:[metadataSource],materials:[{taskId:'task',sourceId:'source',messageId:'original-message',version:1,actorId:'original-actor',resources:[]}],supplement:{messageId:row.messageId,contextRevision:1},handoffs:directWeb?[]:[handoff],updates:directWeb?[update]:[]}
 const packet={id:'task-supplement:wake',source:{kind:'task-input',taskSession:binding},content:[{type:'text',text:JSON.stringify(body)}]}
 const entryId=f.append(packet);await f.writer.commit();const stored=await f.persistence.readNative('session',{requireComplete:true})
 const manager=()=>SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(stored.entries)),native=manager()
 assert.deepEqual(committedLiveSupplementAdmissions(native,task),[{messageId:row.messageId,entryId,packetId:packet.id,binding:{kind:'task-session',...binding}}])
 assert.deepEqual(native.getEntries(),stored.entries)
 for(const change of [
  value=>{value.sources[0].text=sourceSnapshot.text},value=>{value.sources[0].version++},value=>{value.materials[0].actorId='other'},value=>{value.task.contextRevision++},
  value=>{delete value.task.inputPolicy},value=>{value.supplement.messageId='other'},
  directWeb?value=>{value.updates[0].text='Fabricated update'}:value=>{value.handoffs[0].text='Fabricated handoff'},
  directWeb?value=>{value.updates=[]}:value=>{value.handoffs=[]}]){
  const changed=structuredClone(body);change(changed);const tampered=manager(),entries=tampered.getEntries(),content=[{type:'text',text:JSON.stringify(changed)}]
  entries.find(entry=>entry.id===entryId).content=content
  entries.find(entry=>entry.type==='custom'&&entry.customType==='night.audit'&&entry.data.kind==='enqueued').data.payload.content=content
  assert.throws(()=>committedLiveSupplementAdmissions(tampered,task),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'})
 }
 assert.deepEqual((await f.persistence.readNative('session',{requireComplete:true})).entries,stored.entries)
})
