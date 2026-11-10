import {symlink} from './fixtures/filesystem-link.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises'
import {createHost} from '../src/host.js'
import {backupData,restoreData} from '../src/runtime/backup.js'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {requestEnvelope,requestTools,residentRouterHost,channelMessage,eventually} from './fixtures/resident-router-host.js'
import {readTaskEffectScope} from '../src/tasks/effect-scope.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
async function until(fn){for(let n=0;n<500;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,20))}throw Error('single task timeout')}
async function closeAll(steps){
  const errors=[]
  for(const close of steps){try{await close()}catch(error){errors.push(error)}}
  if(errors.length)throw new AggregateError(errors,'Single task fixture cleanup failed')
}
function cleanupContext(t){
  const steps=[]
  // Node 在前一个 after 失败后不会执行后续 after；统一释放资源并保留全部原始错误。
  t.after(async()=>{
    try{await closeAll(steps)}catch(error){
      const detail=value=>({message:value?.message,code:value?.code,stack:value?.stack,cause:value?.cause&&detail(value.cause),errors:value?.errors?.map(detail)})
      t.diagnostic(JSON.stringify({singleTaskCleanup:detail(error)}));throw error
    }
  })
  return {after:close=>steps.push(close)}
}
async function serviceFor(f,initialize=true){const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'single-test',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit'},residentStore=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore({...config,initialize});const service=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external notifications')},readback:async()=>{throw Error('no external notifications')}}});return {service,store,async close(){await closeAll([()=>service.close(),()=>store.close(),()=>residentStore.close()])}}}
const result={tool:'task_result',args:{decision:{action:'complete',summary:'Read back local result',evidence:['local file evidence'],limitations:[]}}}
test('one task preserves its effect through a held missing result and explicit cold continuation, then completes and reflects',{timeout:nativeTestTimeout(20000)},async t=>{
  t=cleanupContext(t)
  let phase='write',readBack=false,reviews=0,h
  t.after(()=>h?.close())
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){reviews++;return {text:'{"lessons":[]}'}}
    if(!body.tools?.some(t=>t.function.name==='task_result'))return
    if(phase==='write'){phase='pause';return {tool:'write',args:{path:'work/proof.txt',content:'single-session-proof'}}}
    if(phase==='pause')return {text:'temporary provider interruption before final submission'}
    if(!readBack){readBack=true;return {tool:'read',args:{path:'work/proof.txt'}}}
    return {...result,args:{decision:{...result.args.decision,artifacts:["work/proof.txt"],deliveryFiles:[{path:"work/proof.txt",caption:"isolated proof"}]}}}
  })
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'direct-write',objective:'Create a local proof and read it back'})
  const interrupted=await until(async()=>{const taskNow=await h.store.query({kind:'task.get',taskId:task.taskId});return taskNow.drained&&taskNow.lastDecision?.limitations?.includes('TASK_SESSION_NO_SUBMISSION')&&taskNow})
  assert.equal(await readFile(join(task.session.workspaceDir,'work/proof.txt'),'utf8'),'single-session-proof')
  const sessionId=interrupted.sessionId;await h.close();await f.close();phase='finish';await f.boot();h=await serviceFor(f,false)
  const heldCalls=f.requests.length;await h.service.recover();await h.service.whenIdle();assert.equal(f.requests.length,heldCalls,'cold recovery cannot restart the exhausted/unfinished turn')
  assert.equal(interrupted.providerRecovery??null,null)
  // An explicit trusted Host continuation retains the original authorization
  // revisions. It is not an automatic provider retry or a fabricated user reply.
  await h.store.command({id:'explicit-host-continuation',kind:'task.wake',args:{taskId:task.taskId,kind:'operator.continue',payload:{requestId:'explicit-continuation'}}})
  await h.service.recover()
  const completed=await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.status==='completed'&&row.drained&&row})
  assert.equal(completed.completion.result.artifactFiles.length,1);assert.equal(completed.completion.result.artifactFiles[0].artifact.fileName,'proof.txt');
  assert.equal(completed.sessionId,sessionId);assert.equal((await h.store.query({kind:'execution.list'})).length,0)
  assert.ok(readBack,'continuation reads the completed original effect rather than issuing a new write');assert.match(JSON.stringify(f.requests),/single-session-proof/)
  assert.equal((await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,1)
  for(const body of f.requests)assert.ok(!body.tools?.some(t=>/^(subagent|task_delegate)/.test(t.function.name)))
  const stored=await f.host.ctx.sessionPersistence.readNative(sessionId,{requireComplete:true})
  const officialResults=stored.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message);assert.equal(officialResults.filter(message=>message.toolName==='write'&&!message.isError).length,1);assert.ok(officialResults.some(message=>message.toolName==='read'&&!message.isError&&message.content.some(block=>block.type==='text'&&block.text.includes('single-session-proof'))),'continuation verifies the original file through an official read result')
  assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,1);assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-result').length,1)
  await f.host.ctx.reflection.whenIdle();assert.equal(reviews,1)
  const resume=await f.host.ctx.sessionController.resolveAgent(sessionId);assert.match(resume.error?.message??'',/TASK_OWNED/)
  await h.close();await f.close();const backup=join(f.root,'backups','single');await backupData(f.config,backup)
  const relocated=await mkdtemp(join(tmpdir(),'night-single-restored-'));t.after(()=>rm(relocated,{recursive:true,force:true}));const nextConfig={...f.config,installRoot:relocated};await restoreData(nextConfig,backup)
  const nextHost=await createHost(nextConfig,{environmentOptions:{inherited:{MEMORY_FIXTURE_KEY:'local-fixture'}}});const next=await serviceFor({host:nextHost,config:nextConfig},false);try{await next.service.recover();await nextHost.ctx.reflection.whenIdle();assert.equal((await next.store.query({kind:'task.get',taskId:task.taskId})).status,'completed');const header=(await nextHost.ctx.sessionPersistence.stat(sessionId)).header;assert.ok(header.cwd.startsWith(relocated));assert.equal(await readFile(join(header.cwd,'work/proof.txt'),'utf8'),'single-session-proof');assert.equal(reviews,1)}finally{await next.close();await nextHost.close()}
})
test('single task cancellation aborts the active turn, drains it and never creates a replacement execution',{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let h;t.after(()=>h?.close())
  const entered=Promise.withResolvers(),release=Promise.withResolvers()
  const f=await memoryHost(t,async body=>{if(body.tools?.some(t=>t.function.name==='task_result')){entered.resolve();await release.promise;return result}})
  h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'cancel-live',objective:'Wait for the local fixture'})
  await entered.promise;const cancelling=h.service.cancelTask({taskId:task.taskId,requestId:'cancel-1'});release.resolve();await cancelling
  const row=await h.store.query({kind:'task.get',taskId:task.taskId});assert.equal(row.status,'cancelled');assert.equal(row.drained,true)
  await h.service.recover();assert.equal((await h.store.query({kind:'execution.list'})).length,0);assert.equal((await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,1)
})

test('chat and chat-room task creation binds the correct memory scope without creating a coordinator',{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let h;t.after(()=>h?.close())
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
    if(requestTools(body).includes('task_result'))return result
    if(requestTools(body).includes('resident_router_settle')){
      const input=requestEnvelope(body,'Router 请求：')
      return body.messages.at(-1)?.role==='tool'?{text:'本批任务事件已可靠结清'}:{tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'scope-settle:'+input.events.map(event=>event.id).join(',')}}
    }
    const handoff=requestEnvelope(body,'Router 交接请求：')
    if(handoff&&!requestTools(body).length)return {text:JSON.stringify({currentIntent:'按当前会话与事项账本继续，不创建协调任务',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  });h=await serviceFor(f)
  for(const type of ['chat','chat-room']){
    const task=await h.service.createTask({requestId:'scope-'+type,objective:'Return the literal word verified',channel:{type,channelId:'local-adapter',conversationId:'conversation',senderId:'person',messageId:'request-'+type,text:'Return the literal word verified'}})
    const row=await until(async()=>{const row=await h.store.query({kind:'task.get',taskId:task.taskId});return row.status==='completed'&&row.drained&&row})
    const binding=f.host.ctx.memory.bindings.get(row.sessionId);assert.equal(!!binding.groupId,type==='chat-room');assert.equal(row.metadata.channelType,type);assert.equal(row.metadata.senderId,'person')
    assert.equal((await h.store.query({kind:'execution.list',taskId:row.taskId})).length,0)
  }
  await h.service.whenIdle()
  assert.equal((await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,2)
})

test('single-task delivery freezes only explicitly reported workspace files and rejects escapes',async t=>{
  const {mkdir,writeFile}=await import('node:fs/promises'),{freezeSingleTaskFiles}=await import('../src/tasks/delivery.js'),{createTaskArtifactFiles}=await import('../packages/dingtalk-core/task-artifact-files.js')
  const root=await mkdtemp(join(tmpdir(),'night-single-files-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'task');await mkdir(directory)
  await writeFile(join(directory,'proof.txt'),'immutable proof');await writeFile(join(root,'outside.txt'),'outside');await symlink(root,join(directory,'alias'),'dir')
  const files=createTaskArtifactFiles({root:join(root,'managed')}),task={taskId:'single-files',sessionId:'sole-session',requirementRevision:1},base={task,directory,files}
  await assert.rejects(freezeSingleTaskFiles({...base,reported:[],selected:[{path:'proof.txt'}]}),/NOT_REPORTED/)
  await assert.rejects(freezeSingleTaskFiles({...base,reported:['../outside.txt'],selected:[{path:'../outside.txt'}]}),/OUTSIDE_TASK/)
  await assert.rejects(freezeSingleTaskFiles({...base,reported:['alias/outside.txt'],selected:[{path:'alias/outside.txt'}]}),/SCOPE_DENIED/)
  const [frozen]=await freezeSingleTaskFiles({...base,reported:['proof.txt'],selected:[{path:'proof.txt'}]});await writeFile(join(directory,'proof.txt'),'changed later');assert.equal(await readFile((await files.resolve(frozen.artifact)).path,'utf8'),'immutable proof')
})

test('an uncertain default task effect releases its physically drained actor and writer while keeping reconciliation held',{timeout:nativeTestTimeout(15000)},async()=>{
  const cleanups=[],f=await memoryHost({after:fn=>cleanups.push(fn)},body=>body.tools?.some(tool=>tool.function.name==='fault_after_write')?{tool:'fault_after_write',args:{}}:undefined)
  const ctx=f.host.ctx;let h,task,effects=0
  ctx.get('tools').register({name:'fault_after_write',description:'Local fixture effect with an uncertain response.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){
    effects++;await writeFile(join(exec.agent.metadata.cwd,'work','uncertain.txt'),'effect happened before response failed');throw Error('local effect response failed')
  }})
  try{
    h=await serviceFor(f)
    task=await h.service.createTask({requestId:'uncertain-effect',objective:'Record the local proof once'})
    await until(async()=>!!(await h.service.taskDialogue(task.taskId)).error)
    await h.service.whenIdle()
    const row=await h.store.query({kind:'task.get',taskId:task.taskId}),dialogue=await h.service.taskDialogue(task.taskId),stored=await ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true})
    assert.equal(await readFile(join(stored.header.cwd,'work','uncertain.txt'),'utf8'),'effect happened before response failed')
    assert.equal(effects,1);assert.equal(f.requests.length,1)
    assert.equal(row.drained,true,JSON.stringify({error:dialogue.error,actorLive:!!ctx.agents.get(row.sessionId),writerLive:!!ctx.piAuthority.describe(row.sessionId)}))
    assert.equal(ctx.agents.get(row.sessionId),undefined);assert.equal(ctx.piAuthority.describe(row.sessionId),undefined)
    await assert.rejects(stat(ctx.sessionPersistence.path(row.sessionId)+'.lock'),{code:'ENOENT'})
    assert.equal(dialogue.error,'TASK_EFFECT_UNCERTAIN_NO_REPLAY')
    assert.equal(row.lastDecision.action,'blocked');assert.ok(row.lastDecision.limitations.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY'))
    assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-intent').length,1)
    assert.equal(stored.audit.filter(receipt=>receipt.domain==='task'&&receipt.kind==='effect-result').length,0)
    await h.service.recover();await h.service.whenIdle()
    assert.equal(effects,1);assert.equal(f.requests.length,1)
  }finally{
    const id=task?.session?.sessionId
    await closeAll([()=>id?ctx.agents.get(id)?.dispose():undefined,()=>h?.close(),...cleanups.reverse()])
  }
})

test('a task rejects forged archive output and can still submit a legitimate work artifact',{timeout:nativeTestTimeout(15000)},async t=>{
  t=cleanupContext(t)
  let step=0,h;t.after(()=>h?.close())
  const f=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return {text:'{"lessons":[]}'}
    if(!body.tools?.some(tool=>tool.function.name==='task_result'))return
    if(step++===0)return {tool:'write',args:{path:'outputs/forged.txt',content:'forged archive'}}
    if(step===2)return {tool:'write',args:{path:'work/proof.txt',content:'legitimate work'}}
    return {...result,args:{decision:{...result.args.decision,artifacts:['work/proof.txt'],deliveryFiles:[{path:'work/proof.txt'}]}}}
  });h=await serviceFor(f)
  const task=await h.service.createTask({requestId:'archive-forgery-denied',objective:'Return a legitimate work artifact'})
  await h.service.whenIdle()
  const row=await h.store.query({kind:'task.get',taskId:task.taskId}),dialogue=await h.service.taskDialogue(task.taskId)
  assert.equal(row.status,'completed',JSON.stringify({status:row.status,error:dialogue.error,decision:row.lastDecision}))
  assert.match(JSON.stringify(f.requests),/PERMISSION_PRIVATE_PATH_DENIED/)
  await assert.rejects(stat(join(task.session.workspaceDir,'outputs/forged.txt')),{code:'ENOENT'})
  assert.equal(await readFile(join(task.session.workspaceDir,'work/proof.txt'),'utf8'),'legitimate work')
  assert.equal(row.completion.result.artifactFiles.length,1)
})
test('single task native searches stay observational while a real write retains its effect receipts',async t=>{
 t=cleanupContext(t);let h,step=0;t.after(()=>h?.close())
 const calls=[{tool:'find',args:{pattern:'missing.txt'}},{tool:'write',args:{path:'work/search-proof.txt',content:'search-proof'}},{tool:'find',args:{pattern:'work/*.txt'}},...(process.platform==='win32'?[{tool:'grep',args:{pattern:'proof',path:'work'}}]:[]),{tool:'read',args:{path:'work/search-proof.txt'}},result]
 const f=await memoryHost(t,body=>requestTools(body).includes('task_result')?calls[step++]:{text:'{"lessons":[]}'})
 h=await serviceFor(f);const created=await h.service.createTask({requestId:'native-search-effects',objective:'Discover local files, observe any search refusal, then create and read back the bounded proof'})
 await h.service.whenIdle();const row=await h.store.query({kind:'task.get',taskId:created.taskId});assert.equal(row.status,'completed',JSON.stringify({status:row.status,drained:row.drained,step,decision:row.lastDecision,error:(await h.service.taskDialogue(row.taskId)).error,modelRequests:f.requests.length}));assert.equal(row.drained,true)
 const stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),effects=stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-intent')
 assert.deepEqual(effects.map(r=>r.payload.name),['write']);assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='effect-result').length,1);assert.equal((await readTaskEffectScope(f.host.ctx,row,stored)).groupId,null)
 assert.equal(await readFile(join(stored.header.cwd,'work/search-proof.txt'),'utf8'),'search-proof')
 if(process.platform==='win32'){assert.match(JSON.stringify(f.requests),/MEMORY_PROCESS_PRIVACY_UNAVAILABLE/);assert.doesNotMatch(JSON.stringify(f.requests),/TASK_EFFECT_UNCERTAIN_NO_REPLAY/)}
})
test('a pre-write Pi edit error preserves its original result, accepts a corrected call and stays settled across cold continuation',{timeout:nativeTestTimeout(20000)},async t=>{
 t=cleanupContext(t);let h,task,step=0;t.after(()=>h?.close())
 const original='first = str(row[0])\nsecond = str(row[0])\n',corrected='first = str(row[1])\nsecond = str(row[0])\n'
 const calls=[{tool:'write',args:{path:'work/check.txt',content:original}},{tool:'read',args:{path:'work/check.txt'}},{tool:'edit',args:{path:'work/check.txt',edits:[{oldText:'str(row[0])',newText:'str(row[1])'}]}},{tool:'read',args:{path:'work/check.txt'}},{tool:'edit',args:{path:'work/check.txt',edits:[{oldText:'first = str(row[0])',newText:'first = str(row[1])'}]}},{tool:'task_result',args:{decision:{action:'wait',summary:'Corrected the ambiguous edit; wait for an explicit continuation',evidence:['read back original text and applied a unique edit'],limitations:[]}}},{tool:'read',args:{path:'work/check.txt'}},result]
 const f=await memoryHost(t,async body=>{
  if(!requestTools(body).includes('task_result'))return {text:'{"lessons":[]}'}
  if(step===3){assert.match(JSON.stringify(body),/Found 2 occurrences/);assert.doesNotMatch(JSON.stringify(body),/Error: TASK_EFFECT_UNCERTAIN_NO_REPLAY/);assert.equal(await readFile(join(task.session.workspaceDir,'work/check.txt'),'utf8'),original)}
  assert.ok(step<calls.length,'the task must finish without replaying an invocation');return calls[step++]
 })
 h=await serviceFor(f);task=await h.service.createTask({requestId:'ambiguous-edit',objective:'Correct one specific line, then wait for an explicit continuation'})
 await h.service.whenIdle();const paused=await h.store.query({kind:'task.get',taskId:task.taskId})
 assert.equal(paused.lastDecision.action,'wait');assert.deepEqual(paused.lastDecision.limitations,[]);assert.equal(paused.drained,true);assert.equal(step,6)
 assert.equal(await readFile(join(task.session.workspaceDir,'work/check.txt'),'utf8'),corrected)
 const before=await f.host.ctx.sessionPersistence.readNative(paused.sessionId,{requireComplete:true}),intent=before.auditEntries.find(row=>row.data.domain==='task'&&row.data.kind==='effect-intent'&&row.data.payload.name==='edit')
 const failed=before.entries.find(row=>row.type==='message'&&row.message.role==='toolResult'&&row.message.toolCallId===intent.data.payload.callId).message
 assert.equal(failed.isError,true);assert.match(failed.content[0].text,/Found 2 occurrences/)
 assert.deepEqual(before.audit.find(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.key===intent.data.payload.key).payload,{key:intent.data.payload.key,isError:true,effect:'not-started'})
 await assert.rejects(h.service.inspectTaskEffect({taskId:task.taskId,intentEntryId:intent.entryId}),{code:'TASK_EFFECT_ALREADY_SETTLED'})
 await h.close();await f.close();await f.boot();h=await serviceFor(f,false)
 await h.service.recover();await h.service.whenIdle();assert.equal(step,6,'cold recovery must not replay a failed edit')
 await h.store.command({id:'explicit-edit-continuation',kind:'task.wake',args:{taskId:task.taskId,kind:'operator.continue',payload:{requestId:'read-corrected-file'}}});await h.service.recover();await h.service.whenIdle()
 const done=await h.store.query({kind:'task.get',taskId:task.taskId}),stored=await f.host.ctx.sessionPersistence.readNative(paused.sessionId,{requireComplete:true})
 assert.equal(done.status,'completed',JSON.stringify(done.lastDecision));assert.equal(done.sessionId,paused.sessionId);assert.equal(done.drained,true);assert.equal(step,8)
 assert.equal(await readFile(join(task.session.workspaceDir,'work/check.txt'),'utf8'),corrected)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-intent').length,3)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.isError===false).length,2)
 assert.equal(stored.audit.filter(row=>row.domain==='task'&&row.kind==='effect-result'&&row.payload.effect==='not-started').length,1)
})
test('Router room unknown effect drains and inspects with distinct conversation and memory groups',async t=>{
 let f,effects=0
 f=await residentRouterHost(t,async body=>{
  const names=requestTools(body),triage=requestEnvelope(body,'一级分诊请求：')
  if(names.includes('channel_triage_submit'))return {tool:'channel_triage_submit',args:{dispositions:triage.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Perform the explicitly requested bounded local action'}))}}
  const handoff=requestEnvelope(body,'Router 交接请求：')
  if(!names.length&&handoff)return {text:JSON.stringify({currentIntent:'Retain authorized task evidence',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(names.includes('task_result'))return {tool:'room_partial_effect',args:{}}
  if(names.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),task=await f.query('task.get',{taskId:'room-effect-scope'})
   if(!task){const source=(await f.query('source.list')).find(source=>source.messageId==='scope-request');return {tool:'resident_task_plan',args:{operationId:'scope-plan',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'room-effect-scope',title:'Bounded room effect',objective:'Perform one local action without replay',requirements:[]}],dependencies:[]}}}
   if(body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Current batch settled'}
   return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'scope-settle:'+input.events.map(event=>event.id).join(',')}}
  }
 })
 f.host.ctx.tools.register({name:'room_partial_effect',description:'Write one isolated proof then lose its response',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:()=>[]},async execute(_args,exec){effects++;await writeFile(join(exec.agent.metadata.cwd,'work/unknown.txt'),'one bounded partial effect');throw Error('response lost after local write')}})
 await f.receive(channelMessage('scope-request',{text:'Perform the bounded local scope verification'}))
 const row=await eventually(async()=>{const row=await f.query('task.get',{taskId:'room-effect-scope'});return row?.drained&&row.lastDecision?.limitations?.includes('TASK_EFFECT_UNCERTAIN_NO_REPLAY')&&row},'room unknown effect drain')
 await f.service.whenIdle();const stored=await f.host.ctx.sessionPersistence.readNative(row.sessionId,{requireComplete:true}),intent=stored.auditEntries.find(e=>e.data.domain==='task'&&e.data.kind==='effect-intent')
 const binding=f.host.ctx.memory.bindings.get(row.sessionId);assert.equal(binding.actorId,row.ownerActorId);assert.equal(binding.groupId,row.metadata.memoryGroupId);assert.notEqual(binding.groupId,row.groupId)
 assert.equal(effects,1);assert.equal(stored.audit.filter(r=>r.domain==='task'&&r.kind==='owner-drained').length,1)
 const inspection=await f.service.inspectTaskEffect({taskId:row.taskId,intentEntryId:intent.entryId});assert.equal(inspection.scope.groupId,row.groupId)
 await assert.rejects(readTaskEffectScope(f.host.ctx,{...row,ownerActorId:'foreign-owner'},stored),{code:'TASK_EFFECT_MEMORY_SCOPE_MISMATCH'})
 await assert.rejects(readTaskEffectScope(f.host.ctx,{...row,metadata:{...row.metadata,memoryGroupId:'foreign-memory'}},stored),{code:'TASK_EFFECT_MEMORY_SCOPE_MISMATCH'})
 const count=f.requests.length;await f.service.recover();await f.service.whenIdle();assert.equal(effects,1);assert.equal(f.requests.length,count)
 t.diagnostic(JSON.stringify({case:'router-room-effect-scope',taskId:row.taskId,drained:row.drained,distinctMemoryGroup:true,ownerDrained:1,inspectSucceeded:true,effects}))
})
