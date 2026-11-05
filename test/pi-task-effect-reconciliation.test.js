import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,rm,readFile,writeFile,appendFile,symlink,link} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {SessionStore} from '../packages/capability-compat/session/index.js'
import * as Authority from '../src/pi-authority.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {singleTaskAuditKinds} from '../src/tasks/single-session.js'
import {admissionAuditKinds} from '../src/runtime/pi-business-admission.js'
import {createTaskEffectReconciliation,effectReconciliationAuditKinds,ownerDrainedReceipt,taskEffectDigest,taskEffectScopeDigest,taskEffectReconciliationIdentity} from '../src/tasks/effect-reconciliation.js'

const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
// The records below are deliberately injected Host attestations. These tests
// verify strict native storage and business evidence binding, never kernel exit
// or that a production factory already emits an authentic drain attestation.
async function fixture(t,{mutate=async()=>{},withDrain=true}={}){
 const root=await mkdtemp('/tmp/night-effect-reconcile-'),ctx=new Context();new SessionStore(ctx);await ctx.plugin(Authority)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')}),bindings={taskId:'task',sessionId:'session',requirementRevision:1,controlRevision:1,contextRevision:0,leaseEpoch:1}
 const task={...bindings,status:'active',control:'active',drained:true,recovering:false,ownerActorId:'owner',groupId:'group'},scope={taskId:'task',sessionId:'session',taskRoot:root,workingDirectory:root,ownerActorId:'owner',groupId:'group',channelDigest:taskEffectDigest({channel:'fixture'}),authorizationDigest:taskEffectDigest({mode:'workspace-write',memory:'fixture-group'})}
 const state={task,scope,live:false,operators:new Map()},auditKinds={...singleTaskAuditKinds,...admissionAuditKinds,...effectReconciliationAuditKinds}
 // Malformed payload tests require a permissive fixture writer so the real
 // independent reader, rather than the producer's schema, must reject them.
 const writer=await backend.createNative(ctx.sessions.prepare('session',{meta:{cwd:root}}).header,{auditKinds:Object.fromEntries(Object.keys(auditKinds).map(name=>[name,()=>true]))})
 const receipt=(kind,payload,domain='task')=>writer.appendAudit({version:1,domain,kind,payload})
 receipt('identity',{taskId:'task',sessionId:'session'})
 const packet={id:'input',source:{kind:'task-input',taskSession:bindings},content:[{type:'text',text:'Only the original scoped objective is authorized.'}]}
 receipt('enqueued',packet,'admission')
 const inputEntryId=writer.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source})
 receipt('admitted',{id:packet.id,entryId:inputEntryId},'admission')
 const args={file_path:'work/proof.txt',content:'possible partial effect'},callId='call-one',toolName='write'
 const assistant={role:'assistant',content:[{type:'toolCall',id:callId,name:toolName,arguments:args}],api:'openai-completions',provider:'fixture',model:'m',timestamp:1,stopReason:'toolUse',usage}
 const callEntryId=writer.manager.appendMessage(assistant)
 const intent={key:taskEffectDigest({requirementRevision:1,contextRevision:0,controlRevision:1,name:toolName,args}),name:toolName,callId},intentEntryId=receipt('effect-intent',intent)
 writer.manager.appendMessage({role:'toolResult',toolCallId:callId,toolName,isError:true,content:[{type:'text',text:'Unknown external outcome'}],timestamp:1})
 const data={root,ctx,backend,writer,bindings,intent,intentEntryId,callEntryId,inputEntryId,assistant,args,receipt,state,auditKinds}
 if(withDrain){
  const drain=await ownerDrainedReceipt({binding:bindings,scopeDigest:taskEffectScopeDigest(scope),cutEntryId:writer.manager.getLeafId()},async()=>({issuer:'night-owned-provider-drain-v1',scope:'registered-owned-provider-ranges',ownerId:'session',modelIdle:true,toolsIdle:true,processes:0,jobs:0,observedAt:new Date().toISOString(),evidenceDigest:taskEffectDigest({fixture:'not-kernel-proof'})}))
  data.ownerDrainEntryId=writer.appendAudit(drain)
 }
 await mutate(data);await writer.commit();data.nativeRevision=writer.snapshot().revision;await writer.close()
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const core=createTaskEffectReconciliation({persistence:backend,readTask:async()=>structuredClone(state.task),readScope:async()=>structuredClone(state.scope),isSessionLive:async()=>state.live,readOperatorSource:async id=>{await state.onOperatorRead?.();return structuredClone(state.operators.get(id))},operatorActorId:'local-operator'})
 const inspect=()=>core.inspect({taskId:'task',intentEntryId})
 return {...data,core,inspect,path:backend.path('session')}
}
async function proposal(f,{changeEvidence=value=>{},changeIdentity=value=>{},changeSource=value=>{}}={}){
 const inspected=await f.inspect(),doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspected[key]])),observedAt:new Date().toISOString(),summary:'Host readback retained observations; partial effects remain possible.',outcome:'partial-or-unknown',noReplay:true}
 changeEvidence(doc)
 const bytes=Buffer.from(JSON.stringify(doc)),sha256=createHash('sha256').update(bytes).digest('hex'),path='materials/runtime-evidence/effects/'+sha256+'.json'
 await mkdir(join(f.root,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(f.root,path),bytes)
 const identity=taskEffectReconciliationIdentity({taskId:'task',intentEntryId:f.intentEntryId,intentDigest:inspected.intentDigest,currentBinding:inspected.currentBinding,journalRevision:inspected.journalRevision,scopeDigest:inspected.scopeDigest,requestId:'review-one',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true})
 changeIdentity(identity)
 const source={sourceId:'operator-source',actorId:'local-operator',groupId:'group',channel:'web',text:'Close only as a failed partial attempt. Never replay it.',timestamp:new Date().toISOString(),requestIdentity:{effectReconciliation:structuredClone(identity)}}
 changeSource(source);f.state.operators.set(source.sourceId,source)
 return {identity,request:{...identity,operatorSourceId:source.sourceId},doc,path:join(f.root,path)}
}

test('scripted Host drain plus strict evidence yields only a failed-partial/noReplay receipt, without writing history',async t=>{
 const f=await fixture(t),before=await readFile(f.path),inspection=await f.inspect()
 assert.equal(inspection.journalRevision,f.nativeRevision);assert.equal(inspection.proofScope,'registered-owned-provider-ranges');assert.equal('kernelIsolation' in inspection,false)
 assert.equal(inspection.callEntryId,f.callEntryId);assert.equal(inspection.inputEntryId,f.inputEntryId)
 const p=await proposal(f),receipt=await f.core.prepare(p.request)
 assert.equal(effectReconciliationAuditKinds['task/effect-reconciled'](receipt.payload),true)
 assert.equal(receipt.payload.outcome,'closed-with-possible-partial-effects');assert.equal(receipt.payload.partialEffectsPossible,true);assert.equal(receipt.payload.noReplay,true)
 assert.equal('success' in receipt.payload,false);assert.equal('noEffect' in receipt.payload,false)
 assert.deepEqual(await readFile(f.path),before);assert.equal(f.backend.writers.size,0)
 const writer=await f.backend.openNative('session',{auditKinds:f.auditKinds});writer.appendAudit(receipt);await writer.close()
 const stored=await f.backend.readNative('session',{requireComplete:true})
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result').length,0,'closing never invents a successful tool result')
 assert.deepEqual(stored.entries.find(entry=>entry.id===f.callEntryId).message,f.assistant)
 await assert.rejects(f.inspect(),{code:'TASK_EFFECT_ALREADY_RECONCILED'})
})
test('a drain receipt constructor requires an awaited Host capability, not JSON zero counts',async()=>{
 const binding={taskId:'task',sessionId:'session',requirementRevision:1,controlRevision:1,contextRevision:0,leaseEpoch:1}
 await assert.rejects(ownerDrainedReceipt({binding,scopeDigest:'a'.repeat(64),cutEntryId:'cut'}, {processes:0,jobs:0}),TypeError)
 await assert.rejects(ownerDrainedReceipt({binding,scopeDigest:'a'.repeat(64),cutEntryId:'cut'},async()=>({processes:0,jobs:0})))
})
for(const [name,options,code] of [
 ['missing owner attestation',{withDrain:false},'TASK_EFFECT_DRAIN_ATTESTATION_REQUIRED'],
 ['foreign branch attestation',{mutate:f=>{f.writer.manager.branch(f.inputEntryId);const payload=structuredClone(f.writer.manager.getEntry(f.ownerDrainEntryId).data.payload);payload.cutEntryId=f.writer.manager.getLeafId();f.receipt('owner-drained',payload)}},'TASK_EFFECT_DRAIN_BRANCH_MISMATCH'],
 ['commit-only branch change after attestation',{mutate:f=>{f.writer.manager.branch(f.inputEntryId)}},'TASK_EFFECT_DRAIN_BRANCH_MISMATCH'],
 ['wrong attestation cut',{mutate:f=>{f.writer.manager.getEntry(f.ownerDrainEntryId).data.payload.cutEntryId=f.callEntryId}},'TASK_EFFECT_DRAIN_ATTESTATION_REQUIRED'],
 ['wrong attestation scope',{mutate:f=>{f.writer.manager.getEntry(f.ownerDrainEntryId).data.payload.scopeDigest='f'.repeat(64)}},'TASK_EFFECT_DRAIN_ATTESTATION_REQUIRED'],
 ['self-reported active process',{mutate:f=>{f.writer.manager.getEntry(f.ownerDrainEntryId).data.payload.proof.processes=1}},'TASK_EFFECT_DRAIN_ATTESTATION_INVALID'],
 ['different attestation owner',{mutate:f=>{f.writer.manager.getEntry(f.ownerDrainEntryId).data.payload.proof.ownerId='foreign'}},'TASK_EFFECT_DRAIN_ATTESTATION_REQUIRED'],
 ['new model content after drain',{mutate:f=>f.writer.manager.appendMessage({role:'user',content:'late input',timestamp:1})},'TASK_EFFECT_DRAIN_CUT_CHANGED'],
 ['new business work after drain',{mutate:f=>f.receipt('effect-intent',{...f.intent,key:'e'.repeat(64),callId:'another-call'})},'TASK_EFFECT_DRAIN_CUT_CHANGED'],
 ['duplicate intent',{mutate:f=>f.receipt('effect-intent',f.intent)},'TASK_EFFECT_INTENT_AMBIGUOUS'],
 ['changed original arguments',{mutate:f=>{f.writer.manager.getEntry(f.callEntryId).message.content[0].arguments.content='different'}},'TASK_EFFECT_ARGUMENTS_MISMATCH'],
 ['ambiguous tool call ids',{mutate:f=>{f.writer.manager.getEntry(f.callEntryId).message.content.push(structuredClone(f.assistant.content[0]))}},'TASK_EFFECT_CALL_AMBIGUOUS'],
 ['missing durable admission',{mutate:f=>{const entry=f.writer.manager.getEntries().find(e=>e.data?.domain==='admission'&&e.data.kind==='admitted');entry.data.payload.entryId='foreign'}},'TASK_EFFECT_ADMISSION_REQUIRED'],
 ['already successful effect',{mutate:f=>f.receipt('effect-result',{key:f.intent.key,isError:false})},'TASK_EFFECT_ALREADY_SETTLED'],
])test('native reconciliation rejects '+name,async t=>{const f=await fixture(t,options);await assert.rejects(f.inspect(),{code})})
for(const [name,change] of [
 ['live actor',state=>state.live=true],['unproven SQL drain',state=>state.task.drained=false],['scope owner change',state=>state.scope.ownerActorId='foreign'],['foreign task identity',state=>state.task.taskId='foreign'],
])test('inspection refuses '+name,async t=>{const f=await fixture(t);change(f.state);await assert.rejects(f.inspect())})
for(const [name,options,code] of [
 ['foreign operator',{changeSource:s=>s.actorId='foreign'},'TASK_EFFECT_OPERATOR_SOURCE_REQUIRED'],
 ['model/channel source',{changeSource:s=>s.channel='im'},'TASK_EFFECT_OPERATOR_SOURCE_REQUIRED'],
 ['operator source for another task',{changeSource:s=>s.requestIdentity.effectReconciliation.taskId='other'},'TASK_EFFECT_OPERATOR_SOURCE_REQUIRED'],
 ['old current lease',{changeIdentity:i=>i.currentBinding.leaseEpoch++},'TASK_EFFECT_PROPOSAL_STALE'],
 ['old journal cut',{changeIdentity:i=>i.journalRevision='f'.repeat(64)},'TASK_EFFECT_PROPOSAL_STALE'],
 ['old scope digest',{changeIdentity:i=>i.scopeDigest='f'.repeat(64)},'TASK_EFFECT_PROPOSAL_STALE'],
 ['evidence for other arguments',{changeEvidence:e=>e.argumentsDigest='f'.repeat(64)},'TASK_EFFECT_EVIDENCE_SCOPE'],
 ['evidence for other intent',{changeEvidence:e=>e.intentEntryId='foreign'},'TASK_EFFECT_EVIDENCE_SCOPE'],
])test('reconciliation preparation rejects '+name,async t=>{const f=await fixture(t),p=await proposal(f,options);await assert.rejects(f.core.prepare(p.request),{code})})
test('evidence cannot claim success, noEffect or a new replay permission',async t=>{
 const f=await fixture(t)
 for(const patch of [{outcome:'success'},{noReplay:false},{noEffect:true}]){const p=await proposal(f,{changeEvidence:e=>Object.assign(e,patch)});await assert.rejects(f.core.prepare(p.request))}
})
test('Host-owned evidence verifies exact bytes and refuses symbolic and hard links',async t=>{
 const f=await fixture(t),p=await proposal(f)
 await appendFile(p.path,' ');await assert.rejects(f.core.prepare(p.request),{code:'TASK_EFFECT_EVIDENCE_HASH_MISMATCH'})
 await rm(p.path);await writeFile(join(f.root,'outside.json'),JSON.stringify(p.doc));await symlink(join(f.root,'outside.json'),p.path)
 await assert.rejects(f.core.prepare(p.request),{code:'TASK_EFFECT_EVIDENCE_PATH_UNSAFE'})
 await rm(p.path);await link(join(f.root,'outside.json'),p.path)
 await assert.rejects(f.core.prepare(p.request),{code:'TASK_EFFECT_EVIDENCE_PATH_UNSAFE'})
})
test('prepare rechecks current task and committed cut after asynchronous evidence/operator reads',async t=>{
 const f=await fixture(t),p=await proposal(f)
 f.state.onOperatorRead=async()=>{f.state.task.leaseEpoch++}
 await assert.rejects(f.core.prepare(p.request),{code:'TASK_EFFECT_PROPOSAL_STALE'})
 f.state.task.leaseEpoch--;f.state.onOperatorRead=async()=>{const writer=await f.backend.openNative('session',{auditKinds:f.auditKinds});writer.manager.appendCustomEntry('other-app-metadata',{version:1});await writer.close()}
 await assert.rejects(f.core.prepare(p.request),{code:'TASK_EFFECT_DRAIN_CUT_CHANGED'})
})
test('strict journal decoding rejects an uncommitted physical tail without repairing it',async t=>{
 const f=await fixture(t);await appendFile(f.path,'{"torn":');const bytes=await readFile(f.path)
 await assert.rejects(f.inspect(),{code:'PI_SESSION_UNCOMMITTED_TAIL'});assert.deepEqual(await readFile(f.path),bytes)
})
