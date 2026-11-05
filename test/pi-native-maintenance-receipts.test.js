import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeSessions from '../src/native-sessions.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {maintenanceAuditKinds,readNativeDrainReceipts} from '../src/tasks/native-maintenance-receipts.js'
import {isolationDigest as hash} from '../packages/dingtalk-core/native-restart-isolation.js'

// Scripted Host attestations exercise the strict reader; these are not evidence
// that the production factory can observe/process-drain or emit a terminal yet.
async function fixture(t,{mutate=()=>{},afterTerminal=false,branchBeforeTerminal=false,unknown=true}={}){
 const root=await mkdtemp('/tmp/night-native-drain-'),binding={taskId:'task',executionId:'execution',sessionId:'session',requirementRevision:2,controlRevision:3,inputVersion:4,inputDigest:'input-digest',leaseEpoch:5}
 const ctx=new Context();new NativeSessions(ctx);authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(root,'tasks','task','.dsh','sessions')}),header=ctx.sessions.prepare(binding.sessionId,{meta:{cwd:root}}).header
 // The permissive fixture writer deliberately allows malformed domain payloads
 // so that the independently strict consumer must reject committed bad records.
 const writer=await backend.createNative(header,{auditKinds:Object.fromEntries(Object.keys(maintenanceAuditKinds).map(key=>[key,()=>true]))})
 const operation={operationId:'operation',taskId:'task',executionId:'execution',state:'unknown',dispatchBinding:binding,definition:{argumentsDigest:'a'.repeat(64)},key:'native:execution:4:5:call'}
 const receipts=[{kind:'bound',payload:{binding}},{kind:'admission-paused',payload:{binding,pauseId:'pause',turnId:'turn'}}]
 for(const receipt of receipts)writer.appendAudit({version:1,domain:'execution',...receipt})
 writer.manager.appendMessage({role:'user',content:[{type:'text',text:'not proof of drain'}],timestamp:Date.now()})
 const terminal={binding,pauseId:'pause',turnId:'turn',cutLeafId:writer.manager.getLeafId(),reason:'cancelled',active:{model:0,tools:0,processes:0,jobs:0},effects:{state:'held',unknown:unknown?[{operationId:operation.operationId,operationDigest:hash(operation),callId:'call',argumentsDigest:operation.definition.argumentsDigest}]:[]}}
 mutate(terminal)
 const terminalEntryId=writer.appendAudit({version:1,domain:'execution',kind:'terminal',payload:terminal})
 if(branchBeforeTerminal)writer.manager.branch(terminal.cutLeafId)
 if(afterTerminal)writer.manager.appendMessage({role:'user',content:[{type:'text',text:'late input'}],timestamp:Date.now()})
 await writer.close()
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {root,binding,operation,terminalEntryId,path:backend.path(binding.sessionId)}
}

test('native receipt schemas require exact business binding, paused admission and zero active resources',()=>{
 const valid={taskId:'task',executionId:'execution',sessionId:'session',requirementRevision:1,controlRevision:1,inputVersion:1,inputDigest:'digest',leaseEpoch:1}
 assert.equal(maintenanceAuditKinds['execution/bound']({binding:valid}),true)
 assert.equal(maintenanceAuditKinds['execution/bound']({binding:{...valid,leaseEpoch:0}}),false)
 assert.equal(maintenanceAuditKinds['execution/admission-paused']({binding:valid,pauseId:'pause',turnId:'turn',fake:true}),false)
})
test('strict native journal yields attestations and held effect references, never a final maintenance proof',async t=>{
 const f=await fixture(t),bytes=await readFile(f.path),result=readNativeDrainReceipts(f.root,f.binding,{operations:[f.operation],terminalEntryId:f.terminalEntryId})
 assert.equal(result.kind,'native-drain-receipts');assert.equal(result.terminalEntryId,f.terminalEntryId);assert.equal(result.pendingOperations[0].operationDigest,hash(f.operation));assert.equal(result.noReplay,true)
 assert.equal('processesExited' in result,false);assert.deepEqual(await readFile(f.path),bytes)
 assert.throws(()=>readNativeDrainReceipts(f.root,{...f.binding,sessionId:'missing'},{records:[result]}),{code:'ENOENT'})
})
for(const [name,options] of [
 ['active model',{mutate:value=>value.active.model=1}],['active tool',{mutate:value=>value.active.tools=1}],['active process',{mutate:value=>value.active.processes=1}],['active job',{mutate:value=>value.active.jobs=1}],
 ['different pause',{mutate:value=>value.pauseId='forged'}],['different turn',{mutate:value=>value.turnId='forged'}],['stale binding',{mutate:value=>value.binding={...value.binding,leaseEpoch:6}}],
 ['wrong cut',{mutate:value=>value.cutLeafId='forged'}],['settled effects',{mutate:value=>value.effects.state='settled'}],['unreviewed unknown',{unknown:false}],['late input',{afterTerminal:true}],['terminal removed from selected branch',{branchBeforeTerminal:true}],
])test('native drain attestations reject '+name,async t=>{
 const f=await fixture(t,options)
 assert.throws(()=>readNativeDrainReceipts(f.root,f.binding,{operations:[f.operation]}),{code:'DYNAMIC_MAINTENANCE_NATIVE_DRAIN_RECEIPTS_REQUIRED'})
})
test('native drain attestations reject changed effects, stale entry selection and uncommitted tails',async t=>{
 const f=await fixture(t)
 for(const options of [{operations:[]},{operations:[{...f.operation,state:'starting'}]},{operations:[{...f.operation,key:'different'}]},{operations:[f.operation],terminalEntryId:'different'}])assert.throws(()=>readNativeDrainReceipts(f.root,f.binding,options),{code:'DYNAMIC_MAINTENANCE_NATIVE_DRAIN_RECEIPTS_REQUIRED'})
 await appendFile(f.path,'{"torn":');const bytes=await readFile(f.path)
 assert.throws(()=>readNativeDrainReceipts(f.root,f.binding,{operations:[f.operation]}),{code:'PI_SESSION_UNCOMMITTED_TAIL'});assert.deepEqual(await readFile(f.path),bytes)
})
