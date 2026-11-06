import {nativeSessionHeader} from './fixtures/native-session-header.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,appendFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'

import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {maintenanceAuditKinds} from '../src/tasks/native-maintenance-receipts.js'
import {executionInputAuditKinds,readNativeExecutionInputs} from '../src/tasks/execution-audit.js'

async function fixture(t,{mutate=()=>{},omitBound=false,after=()=>{}}={}){
 const root=await mkdtemp('/tmp/night-execution-audit-'),ctx=new Context();authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')}),binding={taskId:'task',executionId:'execution',sessionId:'session',requirementRevision:2,controlRevision:3,inputVersion:4,inputDigest:'digest',leaseEpoch:5}
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const writer=await backend.createNative(nativeSessionHeader(binding.sessionId,{cwd:root}),{auditKinds:Object.fromEntries(Object.keys({...maintenanceAuditKinds,...executionInputAuditKinds}).map(key=>[key,()=>true]))})
 const start=writer.manager.getLeafId()
 if(!omitBound)writer.appendAudit({version:1,domain:'execution',kind:'bound',payload:{binding}})
 const entryId=writer.manager.appendCustomMessageEntry('night.business-input',[{type:'text',text:'authored business input'}],false,{packetId:'input-one',source:{kind:'coordinator',executionSession:{sessionId:'session',inputVersion:4,inputDigest:'digest',leaseEpoch:5}}})
 const admission={version:1,domain:'execution',kind:'input-admitted',payload:{inputId:'input-one',entryId,binding}}
 mutate(admission,writer)
 writer.appendAudit(admission)
 const feedbackEntryId=writer.manager.appendCustomMessageEntry('night.business-input','feedback',false,{packetId:'feedback-one',source:{kind:'coordinator',executionFeedback:{messageId:'feedback-one',executionId:'execution'}}})
 writer.appendAudit({version:1,domain:'execution',kind:'feedback-admitted',payload:{messageId:'feedback-one',entryId:feedbackEntryId,binding}})
 await after(writer,{start,entryId,admission,binding})
 await writer.close()
 return{backend,binding,path:backend.path(binding.sessionId),entryId}
}

test('typed input and feedback schemas have exact business fields and existing strict execution binding',()=>{
 const binding={taskId:'t',executionId:'e',sessionId:'s',requirementRevision:1,controlRevision:1,inputVersion:1,inputDigest:'d',leaseEpoch:1}
 assert.equal(executionInputAuditKinds['execution/input-admitted']({inputId:'i',entryId:'entry',binding}),true)
 assert.equal(executionInputAuditKinds['execution/input-admitted']({inputId:'i',entryId:'entry',binding:{...binding,kind:'task-execution'}}),false)
 assert.equal(executionInputAuditKinds['execution/feedback-admitted']({messageId:'i',entryId:'entry',binding,seq:1}),false)
})
test('cold native input evidence uses original Pi entries without claiming terminal/effect state or activating writer',async t=>{
 const f=await fixture(t),before=await readFile(f.path),result=await readNativeExecutionInputs(f.backend,f.binding)
 assert.equal(result.inputs[0].entryId,f.entryId);assert.equal(result.feedback[0].messageId,'feedback-one')
 assert.equal('events' in result,false);assert.equal('drained' in result,false);assert.equal('submitted' in result,false)
 assert.equal(f.backend.writers.size,0);assert.deepEqual(await readFile(f.path),before)
 result.inputs[0].source.kind='forged'
 assert.equal((await readNativeExecutionInputs(f.backend,f.binding)).inputs[0].source.kind,'coordinator')
})
for(const mode of ['branch','context-edit','compaction'])test('permanent admissions survive official '+mode+' without redelivery or invented context',async t=>{
 const f=await fixture(t,{after(writer,{start,entryId}){
  if(mode==='branch')writer.manager.branchWithSummary(start,'official branch summary')
  if(mode==='context-edit')writer.manager.appendContextEdit(entryId,null)
  if(mode==='compaction'){writer.manager.appendMessage({role:'user',content:'retained',timestamp:1});writer.manager.appendCompaction('official compacted summary',writer.manager.getLeafId(),100)}
 }})
 const result=await readNativeExecutionInputs(f.backend,f.binding)
 assert.equal(result.inputs.length,1);assert.equal(result.inputs[0].entryId,f.entryId);assert.equal(result.feedback.length,1)
 assert.ok(!JSON.stringify(result.context.piMessages).includes('authored business input'))
})
for(const [name,options,code] of [
 ['missing binding',{omitBound:true},'EXECUTION_NATIVE_IDENTITY_MISMATCH'],
 ['wrong owner',{mutate:r=>r.payload.binding={...r.payload.binding,taskId:'other'}},'EXECUTION_NATIVE_IDENTITY_MISMATCH'],
 ['wrong lease',{mutate:r=>r.payload.binding={...r.payload.binding,leaseEpoch:6}},'EXECUTION_NATIVE_ADMISSION_BINDING_CHANGED'],
 ['wrong input digest',{mutate:r=>r.payload.binding={...r.payload.binding,inputDigest:'other'}},'EXECUTION_NATIVE_ADMISSION_BINDING_CHANGED'],
 ['missing original entry',{mutate:r=>r.payload.entryId='absent'},'EXECUTION_NATIVE_ADMISSION_LINK_INVALID'],
 ['wrong packet id',{mutate:r=>r.payload.inputId='other'},'EXECUTION_NATIVE_ADMISSION_LINK_INVALID'],
 ['model-authored receipt lookalike',{mutate:(r,writer)=>{r.payload.entryId=writer.manager.appendMessage({role:'assistant',content:[{type:'text',text:JSON.stringify(r)}],api:'fixture',provider:'fixture',model:'fixture',timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})}},'EXECUTION_NATIVE_ADMISSION_LINK_INVALID'],
 ['foreign custom message type',{mutate:(r,writer)=>{writer.manager.getEntry(r.payload.entryId).customType='untrusted.message'}},'EXECUTION_NATIVE_ADMISSION_LINK_INVALID'],
 ['missing source record',{mutate:(r,writer)=>{delete writer.manager.getEntry(r.payload.entryId).details.source}},'EXECUTION_NATIVE_ADMISSION_LINK_INVALID'],
 ['extra field',{mutate:r=>r.payload.seq=1},'EXECUTION_NATIVE_ADMISSION_INVALID'],
 ['duplicate admission',{after:(writer,{admission})=>writer.appendAudit(admission)},'EXECUTION_NATIVE_ADMISSION_DUPLICATE'],
])test('native admission reader rejects '+name,async t=>{
 const f=await fixture(t,options)
 await assert.rejects(readNativeExecutionInputs(f.backend,f.binding),{code})
})
test('native cold read exposes only committed original entries and rejects a torn physical tail',async t=>{
 const f=await fixture(t),first=await f.backend.readNative('session')
 assert.ok(first.entries.some(entry=>entry.id===f.entryId));assert.equal(first.auditEntries[0].data.kind,'bound')
 first.entries.length=0;assert.ok((await f.backend.readNative('session')).entries.length>0)
 await appendFile(f.path,'{"torn":');const bytes=await readFile(f.path)
 await assert.rejects(readNativeExecutionInputs(f.backend,f.binding),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 assert.deepEqual(await readFile(f.path),bytes)
})
