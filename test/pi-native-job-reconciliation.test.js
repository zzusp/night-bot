import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile,writeFile,appendFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {Context} from '@deepseek-ai/cordis'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {portablePaths} from '../src/runtime/portable.js'
import {acquireLock} from '../src/runtime/files.js'
import {nativeBusinessAuditKinds} from '../src/runtime/pi-business-state.js'
import {admissionAuditKinds} from '../src/runtime/pi-business-admission.js'
import {taskEffectBinding,taskEffectDigest,taskEffectInvocationKey,verifyTaskEffectClosures} from '../src/tasks/effect-reconciliation.js'
import {singleTaskAuditKinds} from '../src/tasks/single-session.js'
import {jobReceiptKinds,unresolvedNativeJobReceipts} from '../src/runtime/job-ledger.js'
import {taskAuditKinds} from '../src/tasks/session-audit.js'
import {registerTaskSession} from '../src/tasks/session-routes.js'
import {inspectNativeJob,reconcileNativeJob} from '../src/tasks/job-reconciliation.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {initializeTaskDirectories,taskDirectories} from '../packages/dingtalk-core/session-workspaces.js'
import {nativeRuntimeHost,nativeShell,latestInput,topicTaskCalls} from './fixtures/runtime-official-host.js'
const exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(t,{effect=false,historicalShell='pwsh',objective='Continue the original local objective; do not replay the old invocation'}={}){
 const root=await mkdtemp(join(tmpdir(),'night-job-operator-')),config={installRoot:root,permissionMode:'full',model:{provider:'fixture',model:'fixture'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1',apiKeyEnv:'LOCAL_FIXTURE_KEY',models:[{id:'fixture'}]}},resident:{taskSessions:{instanceId:'native-test',webActorId:'native-user',ownerActorId:'native-user',ingressEpoch:'2026-01-01T00:00:00Z'}}},paths=runtimePaths(config),options={...config.resident.taskSessions,dbPath:join(paths.state,'tasks.sqlite')}
 await prepareRuntimePaths(paths)
 let store=await openDynamicTaskStore({...options,initialize:true}),n=0
 const command=(kind,args,id=kind+':'+(++n))=>store.command({kind,args,id})
 await command('task.create',{taskId:'lost-job',groupId:'native-group',ownerActorId:'native-user',request:objective})
 let task=await store.query({kind:'task.get',taskId:'lost-job'})
 if(task.workspaceInitialization){const b={taskId:task.taskId,creationCommandId:task.workspaceInitialization.creationCommandId,sessionId:task.sessionId},begin=await command('task.workspace.begin',b,b.creationCommandId+':workspace-begin');const observation=await initializeTaskDirectories(paths.workspaces,begin.result.task);await command('task.workspace.finish',{...b,state:'ready',observation:observation.native},b.creationCommandId+':workspace-finish')}
 const {binding}= (await command('task.claim',{taskId:task.taskId})).result
 await command('task.sessionBound',{binding});await command('task.sessionFailed',{binding})
 task=await store.query({kind:'task.get',taskId:task.taskId});await store.close()
 // Linux tasks have no Windows initialization transaction; materialize the
 // current archive layout before writing this offline operator evidence.
 await taskDirectories(paths.workspaces,task.taskId,{task})
 // The historical session must retain the authenticated Host memory binding.
 // Operator job closure cannot invent a missing authorization scope.
 const seed=await nativeRuntimeHost(root,()=>[],{resident:true,permissionMode:'full'})
 try{await seed.ctx.memory.bindSession(task.sessionId,{actorId:task.ownerActorId,groupId:task.groupId,groupWrite:true})}finally{await seed.close()}
 const ctx=new Context();authority(ctx);ctx.provide('portablePaths',portablePaths(paths));const routes=new Map();ctx.provide('taskSessionRoutes',routes)
 const route=await registerTaskSession(paths,routes,task),backend=new PiPersistence(ctx,{root:join(paths.state,'sessions')}),writer=await backend.createNative({version:4,id:task.sessionId,createdAt:Date.now(),isSeeded:false,cwd:route.root,agentPreset:'night-bot-task'},{auditKinds:{...nativeBusinessAuditKinds,...jobReceiptKinds,...taskAuditKinds,...singleTaskAuditKinds,...admissionAuditKinds}})
 writer.appendAudit({version:1,domain:'permission',kind:'selected',payload:{preset:'danger-full-access',sandbox:'danger-full-access',approval:'never'}})
 writer.appendAudit({version:1,domain:'task',kind:'identity',payload:{taskId:task.taskId,sessionId:task.sessionId}})
 const bound={version:1,jobId:'pwsh-lost-fixture',owner:task.sessionId,kind:historicalShell,label:'Original fixture producer; never replay',startedAt:1,toolCall:{callId:'old-call',rootCallId:'old-call',toolName:historicalShell}}
 let intentEntryId
 if(effect){
  const originBinding=taskEffectBinding(binding),packet={id:'original-input',source:{kind:'task-input',taskSession:originBinding},content:[{type:'text',text:'Original bounded local work; retain unknown effects without replay'}]}
  writer.appendAudit({version:1,domain:'admission',kind:'enqueued',payload:packet})
  const inputEntryId=writer.manager.appendCustomMessageEntry('night.business-input',packet.content,false,{packetId:packet.id,source:packet.source})
  writer.appendAudit({version:1,domain:'admission',kind:'admitted',payload:{id:packet.id,entryId:inputEntryId}})
  const callEntryId=writer.manager.appendMessage({role:'assistant',content:[{type:'toolCall',id:bound.toolCall.callId,name:historicalShell,arguments:{command:'echo old-producer-must-never-run'}}],api:'openai-completions',provider:'fixture',model:'fixture',timestamp:1,stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
  intentEntryId=writer.appendAudit({version:1,domain:'task',kind:'effect-intent',payload:{version:2,key:taskEffectInvocationKey({sessionId:task.sessionId,callEntryId,callId:bound.toolCall.callId}),name:historicalShell,callId:bound.toolCall.callId,invocation:{callEntryId,inputEntryId,packetId:packet.id,inputDigest:taskEffectDigest(packet),originBinding}}})
 }
 writer.appendAudit({version:1,domain:'job',kind:'registered',payload:{...bound,state:'admitted'}})
 await writer.close()
 const evidence=join(route.root,'work/readback.txt');await writeFile(evidence,'Original producer absent; exit unknown; no success claimed\n')
 const note={operatorText:'Inspected the original local producer and retained output. No original producer observed; partial effects remain possible; never replay.',producerAbsent:true,partialEffectsPossible:true,noReplay:true,evidenceFiles:[{path:'work/readback.txt',sha256:hash(await readFile(evidence))}]}
 const configFile=join(paths.config,'config.json');await writeFile(configFile,JSON.stringify(config))
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {intentEntryId,root,paths,options,config,configFile,task,backend,bound,note,route,evidence}
}
const cli=async(f,...args)=>JSON.parse((await exec(process.execPath,['bin/night-bot-jobs.js',f.configFile,...args],{encoding:'utf8'})).stdout)
async function resumeFromOperatorAfterColdDrain(h,taskId){
 await h.service.recover();await h.service.whenIdle()
 const task=await h.query('task.get',{taskId})
 assert.equal(task.drained,true);assert.equal(task.sessionFailure,null)
 assert.equal(h.requests.filter(request=>request.tools.some(tool=>tool.name==='task_result')).length,0,'restart alone must not clear a retained drain failure')
 assert.equal(task.inspection?.pending,true,'consuming the inspection does not authorize continuation')
 await h.service.appendTaskContext({taskId,requestId:'operator-cold-job-readback',expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,
  progressImpact:'preserve',authorizationChange:'none',context:'Continue the original task using the retained operator readback; do not replay the old producer.'})
 await h.service.whenIdle()
}
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
test('real Host cold drains and resumes the same task/session on operator input without rerunning the old producer',{timeout:60000},async t=>{
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
  await resumeFromOperatorAfterColdDrain(h,f.task.taskId)
  const task=await h.query('task.get',{taskId:f.task.taskId}),stored=await h.ctx.sessionPersistence.readNative(f.task.sessionId,{requireComplete:true})
  assert.equal(turns,1);assert.equal(task.sessionId,f.task.sessionId);assert.equal(task.drained,true);assert.equal(task.sessionFailure,null)
  assert.match(task.lastDecision.summary,/objective continued/)
  assert.equal(stored.audit.filter(row=>row.domain==='job'&&row.kind==='registered').length,1)
  assert.equal(stored.audit.filter(row=>row.domain==='job'&&row.kind==='settled').length,0)
  assert.ok((await h.query('wake.list',{taskId:f.task.taskId})).every(wake=>wake.state==='acked'))
  assert.equal(h.toolResults.some(row=>['pwsh','bash'].includes(row.name)),false)
 }finally{try{await h.close()}finally{await store.close()}}
})

test('new input wakes the original task with a cold unresolved shell job, without operator closure or replay',{timeout:60000},async t=>{
 const f=await fixture(t,{effect:true}),store=await openDynamicTaskStore(f.options);let turns=0
 const h=await nativeRuntimeHost(f.root,request=>{
  if(!request.tools.some(tool=>tool.name==='task_result'))return topicTaskCalls(request)
  turns++;assert.equal(latestInput(request).task.taskId,f.task.taskId)
  if(turns%2===1)return [{name:'read',args:{path:'work/readback.txt'}}]
  assert.match(JSON.stringify(request),/exit unknown; no success claimed/)
  return [{name:'task_result',args:{decision:{action:'wait',summary:'Evidence read on the original session',evidence:['Retained local evidence'],limitations:[]}}}]
 },{store,permissionMode:'full'})
 try{
  await h.service.recover();await h.service.whenIdle()
  assert.equal(turns,0)
  for(const requestId of ['first-explicit-input','later-explicit-input']){
   const task=await h.query('task.get',{taskId:f.task.taskId})
   await h.service.appendTaskContext({taskId:task.taskId,requestId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,progressImpact:'preserve',authorizationChange:'none',context:'Read the retained evidence; do not replay the old work.'})
   await h.service.whenIdle()
   const after=await h.query('task.get',{taskId:task.taskId})
   assert.equal(after.sessionId,f.task.sessionId);assert.equal(after.drained,true);assert.equal(after.sessionFailure,null)
   assert.equal(after.lastDecision.summary,'Evidence read on the original session');assert.ok(after.lastDecision.limitations.includes('TASK_HISTORICAL_JOB_OUTCOME_UNKNOWN'));assert.ok(!after.lastDecision.limitations.includes('TASK_JOB_UNCERTAIN_NO_REPLAY'))
  }
  assert.equal(turns,4);assert.equal(h.toolResults.some(row=>['pwsh','bash'].includes(row.name)),false)
  const saved=await h.ctx.sessionPersistence.readNative(f.task.sessionId,{requireComplete:true})
  assert.deepEqual(saved.audit.filter(row=>row.domain==='job').map(row=>row.kind),['registered'])
  assert.deepEqual(unresolvedNativeJobReceipts(saved.audit,f.task.sessionId).map(row=>row.jobId),[f.bound.jobId])
 }finally{try{await h.close()}finally{await store.close()}}
})

test('historical unknown shell does not prevent a new independent read-only shell in the same task',{timeout:60000},async t=>{
 const f=await fixture(t,{effect:true,historicalShell:nativeShell,objective:'Verify the current retained evidence file independently; do not assume the historical command succeeded.'}),store=await openDynamicTaskStore(f.options)
 let userTurns=0
 const h=await nativeRuntimeHost(f.root,request=>{
  if(!request.tools.some(tool=>tool.name==='task_result'))return topicTaskCalls(request)
  assert.equal(latestInput(request).task.taskId,f.task.taskId)
  if(++userTurns===1)return [{name:nativeShell,args:{command:nativeShell==='bash'?'cat work/readback.txt':'Get-Content -LiteralPath work/readback.txt',description:'Read independent retained local evidence without replaying the historical command'}}]
  const verified=request.messages.some(message=>message.role==='toolResult'&&!message.isError&&JSON.stringify(message.content).includes('exit unknown; no success claimed'))
  return [{name:'task_result',args:{decision:{action:verified?'complete':'wait',summary:verified?'Independent evidence verified; original shell outcome still unknown':'No new evidence; original shell outcome still unknown',evidence:verified?['work/readback.txt']:[],limitations:[]}}}]
 },{store,permissionMode:'full'})
 try{
  await resumeFromOperatorAfterColdDrain(h,f.task.taskId)
  const task=await h.query('task.get',{taskId:f.task.taskId}),saved=await h.ctx.sessionPersistence.readNative(f.task.sessionId,{requireComplete:true})
  assert.equal(task.sessionId,f.task.sessionId);assert.equal(task.drained,true);assert.equal(task.sessionFailure,null)
  assert.deepEqual(saved.audit.filter(row=>row.domain==='job'&&row.payload.jobId===f.bound.jobId).map(row=>row.kind),['registered'])
  assert.deepEqual(unresolvedNativeJobReceipts(saved.audit,f.task.sessionId).map(row=>row.jobId),[f.bound.jobId])
  const effects=saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent'),oldEffect=effects.find(row=>row.payload.callId===f.bound.toolCall.callId),newEffect=effects.find(row=>row!==oldEffect)
  assert.equal(effects.length,2);assert.ok(oldEffect&&newEffect)
  assert.ok(!saved.audit.some(row=>row.domain==='task'&&['effect-result','effect-reconciled'].includes(row.kind)&&row.payload.key===oldEffect.payload.key))
  assert.equal(newEffect.payload.invocation.originBinding.leaseEpoch,task.leaseEpoch)
  assert.equal(saved.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.key===newEffect.payload.key&&!row.payload.isError).length,1)
  const result=h.toolResults.filter(row=>row.name===nativeShell)
  assert.equal(result.length,1,'only the new read-only shell should be invoked')
  assert.equal(result[0].result.isError,false,JSON.stringify(result[0].result))
  assert.match(JSON.stringify(result[0].result.value),/exit unknown; no success claimed/)
  assert.equal(task.status,'completed');assert.equal(task.completion.result.summary,'Independent evidence verified; original shell outcome still unknown')
  assert.ok(task.completion.result.limitations.includes('TASK_HISTORICAL_JOB_OUTCOME_UNKNOWN'));assert.ok(task.completion.result.limitations.includes('TASK_HISTORICAL_EFFECT_OUTCOME_UNKNOWN'))
 }finally{try{await h.close()}finally{await store.close()}}
})

test('a registered job outside the selected Pi branch cannot be reconciled',{timeout:30000},async t=>{
 const f=await fixture(t),stored=await f.backend.readNative(f.task.sessionId,{requireComplete:true}),registered=stored.auditEntries.find(row=>row.data.domain==='job'&&row.data.kind==='registered')
 const writer=await f.backend.openNative(f.task.sessionId,{auditKinds:jobReceiptKinds})
 writer.manager.branch(stored.entries.find(row=>row.id===registered.entryId).parentId);await writer.close()
 await assert.rejects(inspectNativeJob(f.config,f.task.taskId,f.bound.jobId),{code:'NIGHT_JOB_RECONCILIATION_BRANCH_INVALID'})
})

test('cold shell effect closes through real job CLI and Host readback, then a new shell runs without old-call replay',{timeout:60000},async t=>{
 const f=await fixture(t,{effect:true}),original=await readFile(f.route.path)
 const lastOriginal=(await f.backend.readNative(f.task.sessionId,{requireComplete:true})).entries.at(-1)
 const {proposal}=await cli(f,'inspect',f.task.taskId,f.bound.jobId),proposalFile=join(f.root,'proposal.json'),noteFile=join(f.root,'note.json')
 await writeFile(proposalFile,JSON.stringify(proposal));await writeFile(noteFile,JSON.stringify(f.note))
 assert.equal((await cli(f,'close',proposalFile,noteFile,'--check')).noWrites,true)
 assert.deepEqual(await readFile(f.route.path),original)
 await cli(f,'close',proposalFile,noteFile)
 const store=await openDynamicTaskStore(f.options);let phase='readback',shellIssued=false
 const h=await nativeRuntimeHost(f.root,async request=>{
  if(!request.tools.some(tool=>tool.name==='task_result'))return topicTaskCalls(request)
  if(phase==='continue'&&!shellIssued){shellIssued=true;return [{name:nativeShell,args:{description:'Run a new independent local shell after exact old-effect closure',command:'echo independent-shell-ok'}}]}
  return [{name:'task_result',args:{decision:{action:'wait',summary:phase==='continue'?'Independent shell finished':'Original output retained; no old shell replay',evidence:['retained operator readback'],limitations:['Original exit and effects remain unknown']}}}]
 },{store,permissionMode:'full'})
 try{
  await resumeFromOperatorAfterColdDrain(h,f.task.taskId)
  const task=await h.query('task.get',{taskId:f.task.taskId}),inspection=await h.service.inspectTaskEffect({taskId:task.taskId,intentEntryId:f.intentEntryId})
  assert.equal(task.drained,true);assert.equal(task.sessionId,f.task.sessionId)
  assert.ok(inspection.coldJobReconciliation.entryId);assert.ok(inspection.currentBinding.leaseEpoch>inspection.originBinding.leaseEpoch)
  const timed=(await h.service.taskDetail(task.taskId)).durations.execution
  assert.equal(timed.estimated,true);assert.ok(timed.milliseconds>=0)
  assert.deepEqual(await h.query('observer.timing.missing',{taskId:task.taskId}),[])
  const records=new DatabaseSync(f.options.dbPath,{readOnly:true})
  try{
   const rows=records.prepare("SELECT body FROM dynamic_receipts WHERE id GLOB 'observer-timing:*'").all()
   assert.equal(rows.length,1)
   const receipt=JSON.parse(rows[0].body)
   assert.equal(receipt.dispatchEligible,false)
   assert.deepEqual(receipt.result.interruptedTimings,[{leaseEpoch:f.task.leaseEpoch,at:lastOriginal.timestamp,entryId:lastOriginal.id}])
  }finally{records.close()}
  const doc={version:1,kind:'task-effect-readback',...Object.fromEntries(['taskId','sessionId','intentEntryId','intentDigest','callEntryId','argumentsDigest','originBinding','currentBinding','scopeDigest'].map(key=>[key,inspection[key]])),observedAt:new Date().toISOString(),summary:'Original local readback retained; producer absent after offline operator check, exit unknown.',outcome:'partial-or-unknown',noReplay:true}
  const bytes=Buffer.from(JSON.stringify(doc)),sha256=hash(bytes),path='materials/runtime-evidence/effects/'+sha256+'.json'
  await mkdir(join(f.route.root,'materials/runtime-evidence/effects'),{recursive:true});await writeFile(join(f.route.root,path),bytes)
  const request={...Object.fromEntries(['taskId','intentEntryId','intentDigest','currentBinding','journalRevision','scopeDigest'].map(key=>[key,inspection[key]])),requestId:'close-cold-effect',evidenceRefs:[{path,sha256}],outcome:'closed-with-possible-partial-effects',noReplay:true,operatorText:'I read the retained evidence; close this exact original attempt with unknown partial effects, never replay.'}
  assert.equal((await h.service.reconcileTaskEffect(request)).state,'committed')
  const closed=await h.query('task.get',{taskId:task.taskId}),stored=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
  assert.equal(closed.control,'paused');assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='owner-drained').length,1)
  assert.equal(verifyTaskEffectClosures({task:closed,stored,closedIntentEntryIds:[f.intentEntryId]}).length,1)
  assert.deepEqual((await readFile(f.route.path)).subarray(0,original.length),original)
  phase='continue'
  await store.command({id:'continue-after-cold-effect',kind:'task.control',args:{taskId:task.taskId,control:'active',expectedControlRevision:closed.controlRevision}})
  await h.service.recover();await h.service.whenIdle()
  const result=h.toolResults.find(row=>row.name===nativeShell)
  assert.ok(result,'A new real shell must actually execute');assert.equal(result.result.error,undefined)
  assert.match(JSON.stringify(result.result),/independent-shell-ok/)
  const final=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
  assert.equal(final.audit.filter(row=>row.domain==='job'&&row.kind==='registered'&&row.payload.toolCall.callId===f.bound.toolCall.callId).length,1)
  assert.equal(final.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,2)
  assert.equal((await h.query('task.get',{taskId:task.taskId})).lastDecision.summary,'Independent shell finished')
 }finally{try{await h.close()}finally{await store.close()}}
})
