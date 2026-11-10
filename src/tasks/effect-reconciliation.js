import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {isAbsolute,resolve,relative,dirname,join} from 'node:path'
import {lstat,open,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {z} from 'zod'
import {validateTaskIdentity} from './session-audit.js'
import {admissionAuditKinds} from '../runtime/pi-business-admission.js'
import {unresolvedNativeJobReceipts} from '../runtime/job-ledger.js'

const text=z.string().min(1).max(2000),hex=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const timestamp=z.iso.datetime({offset:true}).refine(value=>Number.isFinite(Date.parse(value)))
const absolute=z.string().refine(isAbsolute)
const bindingSchema=z.strictObject({taskId:text,sessionId:text,requirementRevision:positive,controlRevision:positive,contextRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),leaseEpoch:positive})
const scopeSchema=z.strictObject({taskId:text,sessionId:text,taskRoot:absolute,workingDirectory:absolute,ownerActorId:text,groupId:text.nullable(),channelDigest:hex,authorizationDigest:hex})
const proofSchema=z.strictObject({issuer:z.literal('night-owned-provider-drain-v1'),scope:z.literal('registered-owned-provider-ranges'),ownerId:text,modelIdle:z.literal(true),toolsIdle:z.literal(true),processes:z.literal(0),jobs:z.literal(0),observedAt:timestamp,evidenceDigest:hex})
const drainIdentitySchema=z.strictObject({binding:bindingSchema,scopeDigest:hex,cutEntryId:text})
const drainSchema=drainIdentitySchema.extend({proof:proofSchema})
const coveredIntentSchema=z.strictObject({intentEntryId:text,intentDigest:hex,originBinding:bindingSchema})
const inputsDrainSchema=drainIdentitySchema.extend({version:z.literal(1),inputs:z.array(coveredIntentSchema).min(1).max(128),proof:proofSchema}).superRefine((value,ctx)=>{
 if(new Set(value.inputs.map(item=>item.intentEntryId)).size!==value.inputs.length)ctx.addIssue({code:'custom',message:'Duplicate covered intent'})
 for(const item of value.inputs)if(['taskId','sessionId','requirementRevision','controlRevision','leaseEpoch'].some(key=>item.originBinding[key]!==value.binding[key])||item.originBinding.contextRevision>value.binding.contextRevision)ctx.addIssue({code:'custom',message:'Covered intent belongs to another owner authority'})
})
const evidenceRefSchema=z.strictObject({path:z.string().regex(/^materials\/runtime-evidence\/effects\/[a-f0-9]{64}\.json$/),sha256:hex})
const evidenceRefsSchema=z.array(evidenceRefSchema).min(1).max(8).refine(values=>new Set(values.map(value=>value.path)).size===values.length)
const outcome='closed-with-possible-partial-effects'
const identitySchema=z.strictObject({taskId:text,intentEntryId:text,intentDigest:hex,currentBinding:bindingSchema,journalRevision:hex,scopeDigest:hex,requestId:text,evidenceRefs:evidenceRefsSchema,outcome:z.literal(outcome),noReplay:z.literal(true)})
const receiptSchema=z.strictObject({taskId:text,sessionId:text,intentEntryId:text,intentDigest:hex,key:hex,toolName:text,callId:text,callEntryId:text,argumentsDigest:hex,inputEntryId:text,packetId:text,inputDigest:hex,originBinding:bindingSchema,currentBinding:bindingSchema,ownerDrainEntryId:text,ownerDrainDigest:hex,scopeDigest:hex,journalRevision:hex,evidenceRefs:evidenceRefsSchema,operatorSourceId:text,operatorActorId:text,operatorTextDigest:hex,requestId:text,outcome:z.literal(outcome),partialEffectsPossible:z.literal(true),noReplay:z.literal(true)})
const evidenceSchema=z.strictObject({version:z.literal(1),kind:z.literal('task-effect-readback'),taskId:text,sessionId:text,intentEntryId:text,intentDigest:hex,callEntryId:text,argumentsDigest:hex,originBinding:bindingSchema,currentBinding:bindingSchema,scopeDigest:hex,observedAt:timestamp,summary:z.string().min(1).max(16000),outcome:z.literal('partial-or-unknown'),noReplay:z.literal(true)})
const invocationSchema=z.strictObject({callEntryId:text,inputEntryId:text,packetId:text,inputDigest:hex,originBinding:bindingSchema})
const legacyIntentSchema=z.strictObject({key:hex,name:text,callId:text})
export const taskEffectIntentPayloadSchema=z.union([legacyIntentSchema,legacyIntentSchema.extend({version:z.literal(2),invocation:invocationSchema})])
const intentSchema=taskEffectIntentPayloadSchema
export const validateTaskEffectIntent=value=>intentSchema.safeParse(value).success
const actionAuthorizationSchema=z.strictObject({taskId:text,requestId:text,closedIntentEntryIds:z.array(text).min(1).max(128).refine(ids=>new Set(ids).size===ids.length).transform(ids=>[...ids].sort()),objective:z.string().trim().min(1).max(16000),expectedRequirementRevision:positive,expectedControlRevision:positive})
export const taskEffectActionAuthorizationIdentity=value=>actionAuthorizationSchema.parse(value)
const resultSchema=z.union([z.strictObject({key:hex,isError:z.boolean()}),z.strictObject({key:hex,isError:z.literal(true),effect:z.literal('not-started')})])
export const validateTaskEffectResult=value=>resultSchema.safeParse(value).success
export const effectReconciliationAuditKinds=Object.freeze({
 'task/owner-drained':value=>drainSchema.safeParse(value).success,
 'task/owner-drained-inputs':value=>inputsDrainSchema.safeParse(value).success,
 'task/effect-reconciled':value=>receiptSchema.safeParse(value).success,
})
export const taskEffectDigest=value=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex')
export const taskEffectInvocationKey=({sessionId,callEntryId,callId})=>taskEffectDigest({sessionId,callEntryId,callId})
export const taskEffectScopeDigest=value=>taskEffectDigest(scopeSchema.parse(value))
export const taskEffectBinding=value=>bindingSchema.parse(Object.fromEntries(Object.keys(bindingSchema.shape).map(key=>[key,key==='contextRevision'?value?.[key]??0:value?.[key]])))
export const taskEffectReconciliationIdentity=value=>identitySchema.parse(value)
const fail=code=>{throw Object.assign(new Error(code),{code})}
const assert=(condition,code)=>{if(!condition)fail(code)}
const inside=(root,path)=>{const suffix=relative(root,path);return suffix===''||suffix!=='..'&&!suffix.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(suffix)}
const audit=entry=>entry.type==='custom'&&entry.customType==='night.audit'?entry.data:undefined
const stableTask=value=>value&&value.drained===true&&!value.recovering&&!value.archivedAt&&['active','cancelled'].includes(value.status)

/** Schema for a Host lifecycle attestation only, never a kernel-exit verifier.
 * Production emission must be inside the real awaited model/tool/job/process
 * drain boundary. Copying zero counts from a message or operator form is invalid.
 */
export async function ownerDrainedReceipt(value,observeDrain){
 const identity=drainIdentitySchema.parse(value)
 if(typeof observeDrain!=='function')throw new TypeError('An awaited Host-owned drain observer is required; zero counts from JSON are not a capability')
 return {version:1,domain:'task',kind:'owner-drained',payload:drainSchema.parse({...identity,proof:await observeDrain()})}
}


/** One actual owner join can cover effects admitted from several preserve
 * inputs. Every covered intent is independently checked by the offline reader. */
export async function ownerDrainedInputsReceipt(value,observeDrain){
 if(typeof observeDrain!=='function')throw new TypeError('An awaited Host-owned drain observer is required')
 return {version:1,domain:'task',kind:'owner-drained-inputs',payload:inputsDrainSchema.parse({...value,version:1,proof:await observeDrain()})}
}
function inputOrigin(branch,task,currentBinding){
 const input=branch.findLast(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.source?.kind==='task-input')
 assert(input&&Object.keys(input.details).length===2&&typeof input.details.packetId==='string','TASK_EFFECT_ORIGIN_INPUT_REQUIRED')
 const originBinding=taskEffectBinding(input.details.source.taskSession)
 assert(originBinding.taskId===task.taskId&&originBinding.sessionId===task.sessionId&&originBinding.leaseEpoch<=currentBinding.leaseEpoch,'TASK_EFFECT_ORIGIN_BINDING_MISMATCH')
 const queue=branch.filter(entry=>audit(entry)?.domain==='admission').map(entry=>entry.data)
 const packet=queue.find(receipt=>receipt.kind==='enqueued'&&receipt.payload.id===input.details.packetId)
 assert(packet?.version===1&&admissionAuditKinds['admission/enqueued'](packet.payload)&&isDeepStrictEqual(packet.payload.source,input.details.source)&&isDeepStrictEqual(packet.payload.content,input.content)
  &&queue.some(receipt=>receipt.version===1&&receipt.kind==='admitted'&&admissionAuditKinds['admission/admitted'](receipt.payload)&&receipt.payload.id===packet.payload.id&&receipt.payload.entryId===input.id),'TASK_EFFECT_ADMISSION_REQUIRED')
 return {input,packet,originBinding}
}
function intentOrigin(entries,receipts,manager,task,currentBinding,intentEntryId){
 const target=entries.find(entry=>entry.id===intentEntryId),intent=audit(target??{})
 assert(intent?.version===1&&intent.domain==='task'&&intent.kind==='effect-intent'&&intentSchema.safeParse(intent.payload).success,'TASK_EFFECT_INTENT_INVALID')
 assert(receipts.filter(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-intent'&&entry.data.payload.key===intent.payload.key).length===1,'TASK_EFFECT_INTENT_AMBIGUOUS')
 const branch=manager.getBranch(target.id);let candidates=branch.flatMap(entry=>entry.type==='message'&&entry.message.role==='assistant'&&(intent.payload.version!==2||entry.id===intent.payload.invocation.callEntryId)?entry.message.content.filter(block=>block.type==='toolCall'&&block.id===intent.payload.callId&&block.name===intent.payload.name).map(block=>({entry,block})):[])
 if(intent.payload.version!==2&&candidates.length>1)candidates=candidates.filter(call=>{
  const {originBinding}=inputOrigin(manager.getBranch(call.entry.id),task,currentBinding)
  return taskEffectDigest({requirementRevision:originBinding.requirementRevision,contextRevision:originBinding.contextRevision,controlRevision:originBinding.controlRevision,name:intent.payload.name,args:call.block.arguments})===intent.payload.key
 })
 assert(candidates.length===1,'TASK_EFFECT_CALL_AMBIGUOUS')
 const call=candidates[0],source=inputOrigin(manager.getBranch(call.entry.id),task,currentBinding)
 if(intent.payload.version===2){
  assert(isDeepStrictEqual(intent.payload.invocation,{callEntryId:call.entry.id,inputEntryId:source.input.id,packetId:source.packet.payload.id,inputDigest:taskEffectDigest(source.packet.payload),originBinding:source.originBinding}),'TASK_EFFECT_INVOCATION_MISMATCH')
  assert(taskEffectInvocationKey({sessionId:task.sessionId,callEntryId:call.entry.id,callId:intent.payload.callId})===intent.payload.key,'TASK_EFFECT_INVOCATION_MISMATCH')
 }else assert(taskEffectDigest({requirementRevision:source.originBinding.requirementRevision,contextRevision:source.originBinding.contextRevision,controlRevision:source.originBinding.controlRevision,name:intent.payload.name,args:call.block.arguments})===intent.payload.key,'TASK_EFFECT_ARGUMENTS_MISMATCH')
 return {target,intent,call,...source}
}

/** Read already committed Night closures against the original official calls.
 * This verifies durable identities; it neither closes an effect nor grants a
 * model authority. Callers must independently authenticate the new action. */
export function verifyTaskEffectClosures({task,stored,closedIntentEntryIds}){
 assert(stored?.format==='pi-native-v1'&&stored.header.id===task.sessionId,'TASK_EFFECT_NATIVE_HISTORY_REQUIRED')
 const rows=task.effectReconciliations??[],requested=[...closedIntentEntryIds].sort()
 assert(rows.length>0&&rows.every(row=>row.state==='committed')&&new Set(requested).size===requested.length&&isDeepStrictEqual(requested,rows.map(row=>row.intentEntryId).sort()),'TASK_EFFECT_AUTHORIZATION_CLOSURES_MISMATCH')
 const entries=stored.entries,receipts=entries.filter(entry=>audit(entry)),manager=SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(entries)),currentBinding=taskEffectBinding(task)
 const identities=receipts.filter(entry=>entry.data.domain==='task'&&entry.data.kind==='identity')
 assert(identities.length===1&&identities[0].data.version===1&&validateTaskIdentity(identities[0].data.payload)&&identities[0].data.payload.taskId===task.taskId&&identities[0].data.payload.sessionId===task.sessionId,'TASK_EFFECT_IDENTITY_MISMATCH')
 const branch=manager.getBranch(),native=receipts.filter(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-reconciled')
 assert(native.length===rows.length,'TASK_EFFECT_RECONCILIATION_JOURNAL_CONFLICT')
 return rows.map(row=>{
  const matches=native.filter(entry=>entry.id===row.entryId&&entry.data.payload.intentEntryId===row.intentEntryId)
  assert(matches.length===1,'TASK_EFFECT_RECONCILIATION_JOURNAL_CONFLICT')
  const entry=matches[0],receipt=entry.data,payload=receipt.payload
  assert(receipt.version===1&&receiptSchema.safeParse(payload).success&&taskEffectDigest(receipt)===row.receiptDigest&&isDeepStrictEqual(receipt,row.receipt)&&payload.taskId===task.taskId&&payload.sessionId===task.sessionId&&branch.some(item=>item.id===entry.id),'TASK_EFFECT_RECONCILIATION_JOURNAL_CONFLICT')
  const origin=intentOrigin(entries,receipts,manager,task,currentBinding,row.intentEntryId)
  assert(taskEffectDigest(origin.target)===payload.intentDigest&&origin.intent.payload.key===payload.key&&origin.intent.payload.name===payload.toolName&&origin.intent.payload.callId===payload.callId&&origin.call.entry.id===payload.callEntryId&&taskEffectDigest(origin.call.block.arguments)===payload.argumentsDigest&&origin.input.id===payload.inputEntryId&&origin.packet.payload.id===payload.packetId&&taskEffectDigest(origin.packet.payload)===payload.inputDigest&&isDeepStrictEqual(origin.originBinding,payload.originBinding),'TASK_EFFECT_INVOCATION_MISMATCH')
  const closureBranch=manager.getBranch(entry.id),drain=closureBranch.find(item=>item.id===payload.ownerDrainEntryId),drainReceipt=audit(drain??{})
  assert(drain&&taskEffectDigest(drain)===payload.ownerDrainDigest&&drainReceipt?.version===1&&drainReceipt.domain==='task'&&['owner-drained','owner-drained-inputs'].includes(drainReceipt.kind)&&(drainReceipt.kind==='owner-drained'?drainSchema:inputsDrainSchema).safeParse(drainReceipt.payload).success&&drainReceipt.payload.proof.ownerId===task.sessionId&&drainReceipt.payload.scopeDigest===payload.scopeDigest&&drain.parentId===drainReceipt.payload.cutEntryId,'TASK_EFFECT_DRAIN_ATTESTATION_INVALID')
  assert(closureBranch.some(item=>item.id===row.intentEntryId),'TASK_EFFECT_DRAIN_BRANCH_MISMATCH')
  assert(closureBranch.slice(closureBranch.indexOf(drain)+1,-1).every(item=>item.type==='custom'&&item.customType==='night.commit'),'TASK_EFFECT_DRAIN_CUT_CHANGED')
  return {entryId:entry.id,parentId:entry.parentId,receipt:structuredClone(receipt)}
 })
}

async function safeEvidence(root,ref,signal){
 signal?.throwIfAborted()
 assert(ref.path.endsWith('/'+ref.sha256+'.json'),'TASK_EFFECT_EVIDENCE_INVALID')
 const path=resolve(root,ref.path)
 assert(inside(root,path),'TASK_EFFECT_EVIDENCE_SCOPE')
 async function checkedPath(){
  for(let cursor=path;;cursor=dirname(cursor)){
   const info=await lstat(cursor)
   assert(!info.isSymbolicLink()&&(cursor===path?info.isFile()&&info.nlink===1:info.isDirectory()),'TASK_EFFECT_EVIDENCE_PATH_UNSAFE')
   if(dirname(cursor)===cursor)break
  }
  assert(await realpath(path)===path,'TASK_EFFECT_EVIDENCE_PATH_UNSAFE')
 }
 await checkedPath();const before=await lstat(path)
 assert(before.size<=262144,'TASK_EFFECT_EVIDENCE_TOO_LARGE')
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
 try{
  const initial=await file.stat()
  assert(initial.isFile()&&initial.nlink===1&&initial.ino===before.ino&&initial.dev===before.dev&&initial.size<=262144,'TASK_EFFECT_EVIDENCE_CHANGED')
  const bytes=Buffer.alloc(initial.size+1),read=await file.read(bytes,0,bytes.length,0),after=await file.stat()
  assert(read.bytesRead===initial.size&&after.size===initial.size&&after.mtimeMs===initial.mtimeMs&&after.ctimeMs===initial.ctimeMs,'TASK_EFFECT_EVIDENCE_CHANGED')
  await checkedPath();const current=await lstat(path)
  assert(current.ino===initial.ino&&current.dev===initial.dev,'TASK_EFFECT_EVIDENCE_CHANGED')
  const data=bytes.subarray(0,read.bytesRead)
  assert(createHash('sha256').update(data).digest('hex')===ref.sha256,'TASK_EFFECT_EVIDENCE_HASH_MISMATCH')
  signal?.throwIfAborted()
  let decoded
  try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data))}catch{fail('TASK_EFFECT_EVIDENCE_INVALID')}
  return evidenceSchema.parse(decoded)
 }finally{await file.close()}
}

/** No HTTP, SQLite mutation, journal append, producer invocation or model call.
 * All ports are Host capabilities. readScope must capture current authorization
 * and channel/Memory-binding digests, not model-supplied fields. The eventual
 * writer must continuously hold task admission and the native writer lease and
 * recheck these expected cuts; this module cannot create a cross-store transaction.
 */
export function createTaskEffectReconciliation({persistence,readTask,readScope,isSessionLive,readOperatorSource,operatorActorId}){
 if(typeof persistence?.readNative!=='function'||![readTask,readScope,isSessionLive,readOperatorSource].every(value=>typeof value==='function')||!text.safeParse(operatorActorId).success)throw new TypeError('Strict native storage and explicit Host task/scope/operator capabilities required')
 async function inspect({taskId,intentEntryId,signal}){
  text.parse(taskId);text.parse(intentEntryId);signal?.throwIfAborted()
  const task=await readTask(taskId)
  assert(stableTask(task),'TASK_EFFECT_TASK_NOT_QUIESCENT')
  const currentBinding=taskEffectBinding(task)
  assert(currentBinding.taskId===taskId&&await isSessionLive(task.sessionId)===false,'TASK_EFFECT_OWNER_LIVE')
  const stored=await persistence.readNative(task.sessionId,{requireComplete:true,signal})
  assert(stored.format==='pi-native-v1'&&stored.header.id===task.sessionId&&Array.isArray(stored.entries),'TASK_EFFECT_NATIVE_HISTORY_REQUIRED')
  const scope=scopeSchema.parse(await readScope(task,stored)),scopeDigest=taskEffectScopeDigest(scope)
  assert(scope.taskId===taskId&&scope.sessionId===task.sessionId&&resolve(scope.taskRoot)===scope.taskRoot&&scope.taskRoot===stored.header.cwd&&inside(scope.taskRoot,scope.workingDirectory)&&scope.ownerActorId===task.ownerActorId&&scope.groupId===(task.groupId??null),'TASK_EFFECT_SCOPE_MISMATCH')
  const entries=stored.entries,receipts=entries.filter(entry=>audit(entry)),identities=receipts.filter(entry=>entry.data.domain==='task'&&entry.data.kind==='identity')
  assert(identities.length===1&&identities[0].data.version===1&&validateTaskIdentity(identities[0].data.payload)&&identities[0].data.payload.taskId===taskId&&identities[0].data.payload.sessionId===task.sessionId,'TASK_EFFECT_IDENTITY_MISMATCH')
  const manager=SessionManager.inMemory(stored.header.cwd,{id:stored.header.id},structuredClone(entries))
  const {target,intent,call,input,packet,originBinding}=intentOrigin(entries,receipts,manager,task,currentBinding,intentEntryId)
  for(const entry of receipts.filter(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-result')){
   assert(resultSchema.safeParse(entry.data.payload).success,'TASK_EFFECT_RESULT_INVALID')
   assert(!(entry.data.payload.key===intent.payload.key&&(entry.data.payload.isError===false||entry.data.payload.effect==='not-started')),'TASK_EFFECT_ALREADY_SETTLED')
  }
  assert(!receipts.some(entry=>entry.data.domain==='task'&&entry.data.kind==='effect-reconciled'&&entry.data.payload.intentEntryId===intentEntryId),'TASK_EFFECT_ALREADY_RECONCILED')
  const drains=receipts.filter(entry=>entry.data.domain==='task'&&['owner-drained','owner-drained-inputs'].includes(entry.data.kind))
  assert(drains.every(entry=>entry.data.version===1&&(entry.data.kind==='owner-drained'?drainSchema:inputsDrainSchema).safeParse(entry.data.payload).success),'TASK_EFFECT_DRAIN_ATTESTATION_INVALID')
  const drain=drains.findLast(entry=>entry.data.kind==='owner-drained'?isDeepStrictEqual(entry.data.payload.binding,originBinding):entry.data.payload.inputs.some(item=>item.intentEntryId===intentEntryId&&item.intentDigest===taskEffectDigest(target)&&isDeepStrictEqual(item.originBinding,originBinding)))
  if(drain?.data.kind==='owner-drained-inputs'){
   const branch=manager.getBranch(drain.id),owner=inputOrigin(branch,task,currentBinding)
   assert(isDeepStrictEqual(owner.originBinding,drain.data.payload.binding),'TASK_EFFECT_DRAIN_OWNER_INPUT_MISMATCH')
   for(const covered of drain.data.payload.inputs){
    const checked=intentOrigin(entries,receipts,manager,task,currentBinding,covered.intentEntryId)
    assert(taskEffectDigest(checked.target)===covered.intentDigest&&isDeepStrictEqual(checked.originBinding,covered.originBinding),'TASK_EFFECT_DRAIN_INPUT_MISMATCH')
    assert(branch.some(entry=>entry.id===covered.intentEntryId),'TASK_EFFECT_DRAIN_BRANCH_MISMATCH')
   }
  }
  assert(drain&&drain.data.payload.scopeDigest===scopeDigest&&drain.parentId===drain.data.payload.cutEntryId&&drain.data.payload.proof.ownerId===task.sessionId,'TASK_EFFECT_DRAIN_ATTESTATION_REQUIRED')
  assert(manager.getBranch(drain.id).some(entry=>entry.id===intentEntryId),'TASK_EFFECT_DRAIN_BRANCH_MISMATCH')
  assert(manager.getBranch(entries.at(-1).id).some(entry=>entry.id===drain.id),'TASK_EFFECT_DRAIN_BRANCH_MISMATCH')
  const later=entries.slice(entries.findIndex(entry=>entry.id===drain.id)+1)
  // A new business receipt can admit work or change a producer's state even
  // without adding a model message. Only physical commit markers may follow
  // the attested cut; a later business write needs a fresh real drain.
  assert(later.every(entry=>entry.type==='custom'&&entry.customType==='night.commit'),'TASK_EFFECT_DRAIN_CUT_CHANGED')
  assert(unresolvedNativeJobReceipts(stored.audit,task.sessionId).length===0,'TASK_EFFECT_JOB_UNRESOLVED')
  const again=await readTask(taskId),againScope=scopeSchema.parse(await readScope(again,stored))
  assert(stableTask(again)&&isDeepStrictEqual(taskEffectBinding(again),currentBinding)&&taskEffectScopeDigest(againScope)===scopeDigest&&await isSessionLive(task.sessionId)===false,'TASK_EFFECT_CURRENT_BINDING_CHANGED')
  return {kind:'single-task-effect-inspection',taskId,sessionId:task.sessionId,intentEntryId,intentDigest:taskEffectDigest(target),key:intent.payload.key,toolName:intent.payload.name,callId:intent.payload.callId,callEntryId:call.entry.id,argumentsDigest:taskEffectDigest(call.block.arguments),inputEntryId:input.id,packetId:packet.payload.id,inputDigest:taskEffectDigest(packet.payload),originBinding,currentBinding,ownerDrainEntryId:drain.id,ownerDrainDigest:taskEffectDigest(drain),scopeDigest,journalRevision:createHash('sha256').update(JSON.stringify(entries.at(-1))).digest('hex'),scope,drainedAt:drain.data.payload.proof.observedAt,proofScope:'registered-owned-provider-ranges',outcome:'unknown',noReplay:true}
 }
 async function prepare({operatorSourceId,signal,...input}){
  const identity=identitySchema.parse(input),inspection=await inspect({taskId:identity.taskId,intentEntryId:identity.intentEntryId,signal})
  assert(identity.intentDigest===inspection.intentDigest&&identity.journalRevision===inspection.journalRevision&&identity.scopeDigest===inspection.scopeDigest&&isDeepStrictEqual(identity.currentBinding,inspection.currentBinding),'TASK_EFFECT_PROPOSAL_STALE')
  let latest=Date.parse(inspection.drainedAt)
  for(const ref of identity.evidenceRefs){
   const evidence=await safeEvidence(inspection.scope.taskRoot,ref,signal)
   assert(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','scopeDigest'].every(key=>evidence[key]===inspection[key])&&isDeepStrictEqual(evidence.originBinding,inspection.originBinding)&&isDeepStrictEqual(evidence.currentBinding,inspection.currentBinding)&&Date.parse(evidence.observedAt)>=Date.parse(inspection.drainedAt),'TASK_EFFECT_EVIDENCE_SCOPE')
   latest=Math.max(latest,Date.parse(evidence.observedAt))
  }
  const source=await readOperatorSource(text.parse(operatorSourceId))
  assert(source?.sourceId===operatorSourceId&&source.channel==='web'&&source.actorId===operatorActorId&&source.groupId===(inspection.scope.groupId??'task:'+inspection.taskId)&&typeof source.text==='string'&&source.text.trim()&&timestamp.safeParse(source.timestamp).success&&Date.parse(source.timestamp)>=latest&&isDeepStrictEqual(source.requestIdentity?.effectReconciliation,identity),'TASK_EFFECT_OPERATOR_SOURCE_REQUIRED')
  const fresh=await inspect({taskId:identity.taskId,intentEntryId:identity.intentEntryId,signal})
  assert(fresh.journalRevision===inspection.journalRevision&&fresh.scopeDigest===inspection.scopeDigest&&isDeepStrictEqual(fresh.currentBinding,inspection.currentBinding),'TASK_EFFECT_PROPOSAL_STALE')
  const {scope,drainedAt,proofScope,kind,...data}=inspection
  return {version:1,domain:'task',kind:'effect-reconciled',payload:receiptSchema.parse({...data,evidenceRefs:identity.evidenceRefs,operatorSourceId,operatorActorId,operatorTextDigest:taskEffectDigest(source.text),requestId:identity.requestId,outcome,partialEffectsPossible:true,noReplay:true})}
 }
 return {inspect,prepare}
}
