import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,writeFile,appendFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {Context} from '@deepseek-ai/cordis'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {portablePaths} from '../src/runtime/portable.js'
import {acquireLock} from '../src/runtime/files.js'
import {jobReceiptKinds,unresolvedNativeJobReceipts} from '../src/runtime/job-ledger.js'
import {taskAuditKinds} from '../src/tasks/session-audit.js'
import {registerTaskSession} from '../src/tasks/session-routes.js'
import {inspectNativeJob,reconcileNativeJob} from '../src/tasks/job-reconciliation.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {initializeTaskDirectories} from '../packages/dingtalk-core/session-workspaces.js'
import {nativeRuntimeHost,latestInput,topicTaskCalls} from './fixtures/runtime-official-host.js'
const exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-job-operator-')),config={installRoot:root,permissionMode:'full',model:{provider:'fixture',model:'fixture'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1',apiKeyEnv:'LOCAL_FIXTURE_KEY',models:[{id:'fixture'}]}},resident:{taskSessions:{instanceId:'native-test',webActorId:'native-user',ownerActorId:'native-user',ingressEpoch:'2026-01-01T00:00:00Z'}}},paths=runtimePaths(config),options={...config.resident.taskSessions,dbPath:join(paths.state,'tasks.sqlite')}
 await prepareRuntimePaths(paths)
 let store=await openDynamicTaskStore({...options,initialize:true}),n=0
 const command=(kind,args,id=kind+':'+(++n))=>store.command({kind,args,id})
 await command('task.create',{taskId:'lost-job',groupId:'native-group',ownerActorId:'native-user',request:'Continue the original local objective; do not replay the old invocation'})
 let task=await store.query({kind:'task.get',taskId:'lost-job'})
 if(task.workspaceInitialization){const b={taskId:task.taskId,creationCommandId:task.workspaceInitialization.creationCommandId,sessionId:task.sessionId},begin=await command('task.workspace.begin',b,b.creationCommandId+':workspace-begin');const observation=await initializeTaskDirectories(paths.workspaces,begin.result.task);await command('task.workspace.finish',{...b,state:'ready',observation},b.creationCommandId+':workspace-finish')}
 const {binding}= (await command('task.claim',{taskId:task.taskId})).result
 await command('task.sessionBound',{binding});await command('task.sessionFailed',{binding})
 task=await store.query({kind:'task.get',taskId:task.taskId});await store.close()
 const ctx=new Context();authority(ctx);ctx.provide('portablePaths',portablePaths(paths));const routes=new Map();ctx.provide('taskSessionRoutes',routes)
 const route=await registerTaskSession(paths,routes,task),backend=new PiPersistence(ctx,{root:join(paths.state,'sessions')}),writer=await backend.createNative({version:4,id:task.sessionId,createdAt:Date.now(),isSeeded:false,cwd:route.root,agentPreset:'night-bot-task'},{auditKinds:{...jobReceiptKinds,...taskAuditKinds}})
 writer.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:task.taskId,sessionId:task.sessionId}})
 const bound={version:1,jobId:'pwsh-lost-fixture',owner:task.sessionId,kind:'pwsh',label:'Original fixture producer; never replay',startedAt:1,toolCall:{callId:'old-call',rootCallId:'old-call',toolName:'pwsh'}}
 writer.appendAudit({version:1,domain:'job',kind:'registered',payload:{...bound,state:'admitted'}})
 await writer.close()
 const evidence=join(route.root,'work/readback.txt');await writeFile(evidence,'Original producer absent; exit unknown; no success claimed\n')
 const note={operatorText:'Inspected the original local producer and retained output. No original producer observed; partial effects remain possible; never replay.',producerAbsent:true,partialEffectsPossible:true,noReplay:true,evidenceFiles:[{path:'work/readback.txt',sha256:hash(await readFile(evidence))}]}
 const configFile=join(paths.config,'config.json');await writeFile(configFile,JSON.stringify(config))
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {root,paths,options,config,configFile,task,backend,bound,note,route,evidence}
}
const cli=async(f,...args)=>JSON.parse((await exec(process.execPath,['bin/night-bot-jobs.js',f.configFile,...args],{encoding:'utf8'})).stdout)
test('real CLI inspect/check are zero-write; closure is append-only and preserves ledger, inputs and unknown exit',{timeout:60000},async t=>{
 const f=await fixture(t),journal=await readFile(f.route.path),db=await readFile(join(f.paths.state,'tasks.sqlite'))
 const {proposal}=await cli(f,'inspect',f.task.taskId,f.bound.jobId),proposalFile=join(f.root,'proposal.json'),noteFile=join(f.root,'note.json')
 await writeFile(proposalFile,JSON.stringify(proposal));await writeFile(noteFile,JSON.stringify(f.note))
 assert.equal((await cli(f,'close',proposalFile,noteFile,'--check')).state,'checked')
 assert.deepEqual(await readFile(f.route.path),journal);assert.deepEqual(await readdir(join(f.route.root,'materials')),[])
 const result=await cli(f,'close',proposalFile,noteFile);assert.equal(result.state,'committed');assert.equal(result.exitStatus,'unknown')
 let stored=await f.backend.readNative(f.task.sessionId,{requireComplete:true})
 assert.deepEqual(unresolvedNativeJobReceipts(stored.audit,f.task.sessionId),[])
 assert.deepEqual(await readFile(join(f.paths.state,'tasks.sqlite')),db)
 assert.deepEqual((await readFile(f.route.path)).subarray(0,journal.length),journal)
 assert.equal(stored.audit.filter(row=>row.domain==='job'&&row.kind==='registered').length,1)
 assert.equal(stored.audit.filter(row=>row.domain==='job'&&row.kind==='settled').length,0)
 const receipt=stored.audit.find(row=>row.domain==='job'&&row.kind==='reconciled')
 assert.equal(receipt.payload.noReplay,true);assert.equal(receipt.payload.producerReported,undefined)
 const registered=stored.audit.find(row=>row.domain==='job'&&row.kind==='registered')
 assert.equal(unresolvedNativeJobReceipts([registered,{...receipt,payload:{...receipt.payload,registrationDigest:'0'.repeat(64)}}],f.task.sessionId)[0].uncertain,true)
 assert.throws(()=>unresolvedNativeJobReceipts([registered,{...receipt,payload:{...receipt.payload,noReplay:false}}],f.task.sessionId),{code:'NIGHT_JOB_RECEIPT_INVALID'})
 assert.equal(hash(await readFile(join(f.route.root,result.evidence.path))),result.evidence.sha256)
 const committed=await readFile(f.route.path);assert.equal((await cli(f,'close',proposalFile,noteFile)).entryId,result.entryId);assert.deepEqual(await readFile(f.route.path),committed)
})
test('live Host/session ownership, stale journal and changed readback cannot be closed',{timeout:30000},async t=>{
 const f=await fixture(t),{proposal}=await inspectNativeJob(f.config,f.task.taskId,f.bound.jobId),before=await readFile(f.route.path)
 const release=await acquireLock(join(f.paths.runtime,'.host.lock'),{timeoutMs:0})
 await assert.rejects(reconcileNativeJob(f.config,proposal,f.note,{check:true}),{code:'NIGHT_JOB_RECONCILIATION_HOST_LIVE'})
 await assert.rejects(reconcileNativeJob(f.config,proposal,f.note),{code:'NIGHT_DATA_IN_USE'});await release()
 const writer=await f.backend.openNative(f.task.sessionId,{auditKinds:jobReceiptKinds})
 await assert.rejects(reconcileNativeJob(f.config,proposal,f.note),/owned|PI_SESSION_ALREADY/i);await writer.close()
 await writeFile(f.evidence,'changed')
 await assert.rejects(reconcileNativeJob(f.config,proposal,f.note,{check:true}),{code:'NIGHT_JOB_EVIDENCE_CHANGED'})
 await assert.rejects(reconcileNativeJob(f.config,{...proposal,taskRevision:'0'.repeat(64)},f.note,{check:true}),{code:'NIGHT_JOB_RECONCILIATION_STALE'})
 await appendFile(f.route.path,'{"torn":')
 await assert.rejects(reconcileNativeJob(f.config,proposal,f.note,{check:true}),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 assert.equal((await readFile(f.route.path)).toString(),before.toString()+'{"torn":')
 await writeFile(f.route.path,before)
})
test('foreign installation and retained resources reject rather than forge a producer terminal',{timeout:30000},async t=>{
 const f=await fixture(t)
 await assert.rejects(inspectNativeJob({...f.config,resident:{taskSessions:{...f.options,instanceId:'foreign'}}},f.task.taskId,f.bound.jobId),{code:'NIGHT_JOB_INSTALLATION_MISMATCH'})
 const writer=await f.backend.openNative(f.task.sessionId,{auditKinds:jobReceiptKinds})
 // Typed resource lifecycle is real application evidence, never replaceable by an operator absence claim.
 const {parseWindowsResourceOwnership}=await import('../src/process/contracts.js')
 const resource=parseWindowsResourceOwnership({kind:'windows-lpac',version:1,profileName:'nightbot-'+'1'.repeat(32),profileSid:null,status:'planned',scopeCount:2,scopeEffects:0,retainedHandles:0,retainedAllocations:0,preparationPending:true,threadRestored:false,childSettled:false,jobEmpty:false,nativeHandlesClosed:false,scopeReleased:false,profileAbsent:false})
 writer.appendAudit({version:1,domain:'job',kind:'resource-ownership',payload:{...f.bound,seq:1,resource}});await writer.close()
 await assert.rejects(inspectNativeJob(f.config,f.task.taskId,f.bound.jobId),{code:'NIGHT_JOB_RECONCILIATION_UNSUPPORTED'})
})
test('real Host cold resumes the same task/session after operator closure without rerunning the old producer',{timeout:60000},async t=>{
 const f=await fixture(t),{proposal}=await inspectNativeJob(f.config,f.task.taskId,f.bound.jobId)
 await reconcileNativeJob(f.config,proposal,f.note,{check:true});await reconcileNativeJob(f.config,proposal,f.note)
 const store=await openDynamicTaskStore(f.options);let turns=0
 const h=await nativeRuntimeHost(f.root,async request=>{
  if(!request.tools.some(tool=>tool.name==='task_result'))return topicTaskCalls(request)
  turns++;const input=latestInput(request);assert.equal(input.task.taskId,f.task.taskId)
  assert.equal(input.jobReconciliations.length,1);assert.equal(input.jobReconciliations[0].noReplay,true);assert.equal(input.jobReconciliations[0].exitStatus,'unknown')
  return [{name:'task_result',args:{decision:{action:'wait',summary:'The original objective continued after readback; no old producer was replayed.',evidence:['original operator evidence'],limitations:['Old build exit remains unknown']}}}]
 },{store,permissionMode:'full'})
 try{
  await h.service.recover();await h.service.whenIdle()
  const task=await h.query('task.get',{taskId:f.task.taskId}),stored=await h.ctx.sessionPersistence.readNative(f.task.sessionId,{requireComplete:true})
  assert.equal(turns,1);assert.equal(task.sessionId,f.task.sessionId);assert.equal(task.drained,true);assert.equal(task.sessionFailure,null)
  assert.match(task.lastDecision.summary,/objective continued/)
  assert.equal(stored.audit.filter(row=>row.domain==='job'&&row.kind==='registered').length,1)
  assert.equal(stored.audit.filter(row=>row.domain==='job'&&row.kind==='settled').length,0)
  assert.ok((await h.query('wake.list',{taskId:f.task.taskId})).every(wake=>wake.state==='acked'))
  assert.equal(h.toolResults.some(row=>['pwsh','bash'].includes(row.name)),false)
 }finally{try{await h.close()}finally{await store.close()}}
})

test('a registered job outside the selected Pi branch cannot be reconciled',{timeout:30000},async t=>{
 const f=await fixture(t),stored=await f.backend.readNative(f.task.sessionId,{requireComplete:true}),registered=stored.auditEntries.find(row=>row.data.domain==='job'&&row.data.kind==='registered')
 const writer=await f.backend.openNative(f.task.sessionId,{auditKinds:jobReceiptKinds})
 writer.manager.branch(stored.entries.find(row=>row.id===registered.entryId).parentId);await writer.close()
 await assert.rejects(inspectNativeJob(f.config,f.task.taskId,f.bound.jobId),{code:'NIGHT_JOB_RECONCILIATION_BRANCH_INVALID'})
})
