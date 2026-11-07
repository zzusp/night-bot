import test from 'node:test'
import {createServer} from 'node:http'
import {readFile,readdir,realpath} from 'node:fs/promises'
import {resolve,join,relative} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {parseArgs,isDeepStrictEqual} from 'node:util'
import {loadConfig} from '../../../../src/config.js'
import {runtimePaths} from '../../../../src/runtime/paths.js'
import {portablePaths} from '../../../../src/runtime/portable.js'
import {decodePiJournal} from '../../../../src/runtime/pi-journal.js'
import {taskSessionRoutes} from '../../../../src/tasks/session-routes.js'
import {createHost} from '../../../../src/host.js'
import {apply as application,inject} from '../../../../src/application.js'
import {requestEnvelope,requestTools} from '../../../../test/fixtures/resident-router-host.js'
import {nativeTestTimeout} from '../../../../test/fixtures/native-lifecycle.js'

// 原批次已结清且失败proof已消费；此入口只普通恢复其未完成handoff，不再续办业务轮。
const requireValue=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code})}
const hash=value=>createHash('sha256').update(value).digest('hex')
const {values:v}=parseArgs({options:{config:{type:'string'},skill:{type:'string'},task:{type:'string'},check:{type:'boolean'},run:{type:'boolean'}}})
requireValue(v.config&&v.skill&&/^[a-z0-9-]+$/.test(v.task??'')&&!!v.check!==!!v.run,'SG10_SKILL_ARGUMENTS_REQUIRED')
const file=resolve(v.config),config=await loadConfig(file),paths=runtimePaths(config),directory=resolve(v.skill)
requireValue(paths.mode==='portable'&&file===join(paths.secrets,'config.json'),'SG10_SKILL_ORIGINAL_CONFIG_REQUIRED')
requireValue(relative(paths.skills,directory)==='review-technical-plan'&&await realpath(directory)===directory,'SG10_SKILL_TARGET_BINDING_INVALID')
const supervisor=JSON.parse(await readFile(join(paths.runtime,'sg9-supervisor.json'),'utf8'))
requireValue(supervisor.phase==='closed'&&supervisor.code===0&&supervisor.ipcShutdownSent===true,'SG10_SKILL_ORIGINAL_INSTANCE_NOT_CLOSED')
const snapshot=JSON.parse(await readFile(join(paths.workspaces,'tasks',v.task,'task.json'),'utf8')),targetTask=snapshot.ledger?.tables?.tasks?.[0]?.body
requireValue(snapshot.taskId===v.task&&targetTask?.taskId===v.task&&snapshot.sessionId===targetTask.sessionId&&targetTask.status==='completed'&&targetTask.drained&&targetTask.runSequence===1&&targetTask.conversationId?.startsWith('local-private-skill-'),'SG10_EXISTING_SKILL_TASK_REQUIRED')
const expected={'SKILL.md':'560c5ac2e82588f17337b69dd29af478b403542b6733cee83a0cd1db054c07ce','references/checklist.md':'058769a15c33397ab2fba6988e7127aaa84bc99a2833db82cfd4c778a6080b3a'}
const sourceFiles=['src/channels/service.js','src/channels/router-lifecycle.js','src/channels/plugins/dingtalk-dws.js','src/channels/router-ledger.js','packages/dingtalk-core/task-message-projections.js','packages/dingtalk-core/dynamic-task-store.js','packages/dingtalk-core/group-message.js','src/channels/message-safety.js','src/channels/resident-router-business.js','src/tasks/single-session.js','packages/dingtalk-core/task-session-service.js','packages/dingtalk-core/group-notification.js','packages/dingtalk-core/group-reply-format.js','packages/dingtalk-core/platform-notification.js','packages/dingtalk-core/platform-schedule.js','src/tasks/input-origin.js','src/host.js','src/application.js','src/pi-official-agent-factory.js','src/runtime/pi-official-session.js','src/runtime/pi-business-admission.js','src/runtime/pi-business-inputs.js','src/native-skill-filesystem.js','src/native-tool-skill.js','src/memory/private-fs.js','packages/dingtalk-core/session-skill-refresh.js','test/fixtures/resident-router-host.js','test/fixtures/memory-host.js','docs/acceptance/resident-conversation-routing/scripts/private-skill-check.mjs']
const fingerprints=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,hash(await readFile(name))])))
async function privateBoundaries(){
  for(const [name,digest]of Object.entries(expected)){
    const target=join(directory,name),bytes=await readFile(target)
    requireValue(hash(bytes)===digest,'SG10_SKILL_PRIVATE_BYTES_CHANGED')
    requireValue(spawnSync('git',['check-ignore','-q',target]).status===0,'SG10_SKILL_TARGET_NOT_IGNORED')
    for(const args of [['ls-files','--',target],['diff','--cached','--name-only','--',target]]){
      const result=spawnSync('git',args,{encoding:'utf8'});requireValue(result.status===0&&!result.stdout.trim(),'SG10_SKILL_TARGET_IN_GIT')
    }
  }
}
const codec=portablePaths(paths),prior=new Map(),candidates=[]
const routes=await taskSessionRoutes(paths)
for(const name of await readdir(join(paths.state,'sessions')))if(name.endsWith('.pi.jsonl')){
  const target=join(paths.state,'sessions',name),bytes=await readFile(target),id=JSON.parse(bytes.toString('utf8').split('\n')[0]).id
  requireValue(!routes.has(id),'SG10_DUPLICATE_JOURNAL_ROUTE');routes.set(id,target)
}
let execution
for(const [id,target]of routes){
  const bytes=await readFile(target),native=decodePiJournal(bytes,id,{codec,requireComplete:true})
  prior.set(id,{target,digest:hash(bytes)})
  if(id===targetTask.sessionId)execution=native
  if(native.header.runtimeOwner==='conversation-router'&&native.header.conversationId===targetTask.conversationId)candidates.push({native,bytes,target})
}
requireValue(execution&&candidates.length===1,'SG10_EXISTING_SKILL_HISTORY_REQUIRED')
const originalRouter=candidates[0],business=originalRouter.native.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.source.kind==='conversation-router')
const claims=originalRouter.native.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-claim'),turns=originalRouter.native.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-turn')
requireValue(business.length===1&&claims.length===1&&turns.length===1&&isDeepStrictEqual(claims[0].details,turns[0].details),'SG10_CONSUMED_ROUTER_CHECKPOINT_REQUIRED')
const proof=claims[0].details,failed=originalRouter.native.entries.find(entry=>entry.id===proof.failedEntryId)
requireValue(proof.conversationId===targetTask.conversationId&&proof.generation===originalRouter.native.header.generation&&proof.sessionId===originalRouter.native.header.id&&proof.packetId===business[0].details.packetId&&proof.inputEntryId===business[0].id&&failed?.message.stopReason==='error','SG10_ORIGINAL_ROUTER_CONTROL_BINDING_INVALID')
requireValue(originalRouter.native.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='resident_router_settle'&&!entry.message.isError).length===1&&originalRouter.native.entries.findLast(entry=>entry.type==='message'&&entry.message.role==='assistant')?.message.stopReason==='stop','SG10_ORIGINAL_ROUTER_SETTLED_HISTORY_REQUIRED')
requireValue(hash(originalRouter.bytes)==='186082fdd9c38d719927b0f676000a53e22fb7a372cd4eaeba20dd4795cd3c16','SG10_SETTLED_ROUTER_BASELINE_CHANGED')
// 绑定本轮已immutable/query_only核实的离线断点；运行仍以Host/SQLite为权威，不重放快照。
const stateFiles=await readdir(paths.state)
for(const name of ['tasks.sqlite-wal','tasks.sqlite-shm'])if(stateFiles.includes(name))requireValue((await readFile(join(paths.state,name))).length===0,'SG10_SETTLED_ROUTER_LIVE_SIDECAR')
const ledgerDigest=hash(await readFile(join(paths.state,'tasks.sqlite')))
requireValue(ledgerDigest==='23f161f8b6f07dc468df70cf62436d4eb2888df432e3d113c8666e726b1ceef2','SG10_SETTLED_ROUTER_LEDGER_CHANGED')
for(const kind of ['enqueued','admitted'])requireValue(originalRouter.native.audit.filter(row=>row.domain==='admission'&&row.kind===kind&&row.payload.id===proof.packetId).length===1,'SG10_ORIGINAL_ROUTER_ADMISSION_INVALID')
const tools=execution.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message),reads=execution.audit.filter(row=>row.domain==='skill-observation'&&row.kind==='read')
requireValue(tools.length===3&&tools.every(tool=>!tool.isError)&&tools.map(tool=>tool.toolName).join(',')==='skill,read,task_result','SG10_COMPLETED_SKILL_TOOLS_INVALID')
requireValue(reads.length===2&&reads.some(row=>row.payload.record.kind==='skill'&&row.payload.record.name==='review-technical-plan'&&row.payload.record.resourceBase?.path===directory)&&reads.some(row=>row.payload.record.kind==='reference'&&row.payload.record.path===join(directory,'references/checklist.md')),'SG10_PRIVATE_SKILL_RECEIPTS_MISSING')
for(const row of reads){const result=execution.entries.find(entry=>entry.id===row.payload.resultEntryId);requireValue(result?.type==='message'&&result.message.role==='toolResult'&&!result.message.isError&&result.message.toolCallId===row.payload.callId,'SG10_SKILL_RESULT_BINDING_INVALID')}
requireValue(!execution.audit.some(row=>row.kind==='effect-intent')&&!originalRouter.native.audit.some(row=>row.kind==='effect-intent'),'SG10_PRIVATE_SKILL_UNEXPECTED_EFFECT')
await privateBoundaries()
const configBefore=hash(await readFile(file)),before=await fingerprints()
console.log('SG10_PRIVATE_SKILL_START '+JSON.stringify({at:new Date().toISOString(),mode:v.check?'check':'run',originalInstallBound:true,taskId:targetTask.taskId,sessionId:targetTask.sessionId,priorJournals:prior.size,protectedJournals:prior.size-1,proof,privateFiles:expected,sources:before,uncommitted:true}))
if(v.check)console.log('SG10_PRIVATE_SKILL_CHECK '+JSON.stringify({effects:0,ignored:true,tracked:false,staged:false,network:false,instanceStarted:false,strictPriorJournals:prior.size,existingCompletedTask:true,originalCheckpointPreviouslyConsumed:true,settledHandoffRecoveryOnly:true,ledgerDigest,executionWillNotReplay:true}))
else await test('the completed private skill task recovers only its settled Router handoff through the original default application',{timeout:nativeTestTimeout(90000)},async t=>{
  let host,app,modelError,requests=0,handoffRequests=0
  const events=[],endpoint=createServer((req,res)=>{void respond(req,res).catch(error=>{modelError??=error;if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'SG10_LOCAL_MODEL_DECISION_FAILED',type:'invalid_request_error'}}))})})
  async function respond(req,res){
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw),names=requestTools(body);requests++
    requireValue(!names.includes('task_result'),'SG10_COMPLETED_EXECUTION_REPLAYED')
    const handoff=requestEnvelope(body,'Router 交接请求：')
    requireValue(handoff&&!names.length,'SG10_SETTLED_ROUTER_BUSINESS_REPLAYED')
    requireValue(handoff.conversationId===proof.conversationId&&handoff.generation===proof.generation&&handoff.cutoff===1,'SG10_UNEXPECTED_HANDOFF_SCOPE');handoffRequests++
    const decision={text:JSON.stringify({currentIntent:'The original private skill verification is complete; retain its task reference without re-executing it',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:[...handoff.requiredSourceIds.map(sourceId=>({sourceId})),{taskId:targetTask.taskId}],cutoff:handoff.cutoff})}
    res.writeHead(200,{'content-type':'text/event-stream'})
    const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'sg10-private-local',object:'chat.completion.chunk',created:1,model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
    chunk({role:'assistant',content:decision.text});chunk({},'stop')
    res.end('data: [DONE]\n\n')
  }
  t.after(async()=>{
    const errors=[]
    for(const close of [()=>app?.close(),()=>host?.close(),()=>new Promise(resolve=>endpoint.close(resolve))])try{await close()}catch(error){errors.push(error)}
    requireValue(hash(await readFile(file))===configBefore,'SG10_ORIGINAL_CONFIG_CHANGED');await privateBoundaries()
    for(const [id,{target,digest}]of prior){const bytes=await readFile(target);decodePiJournal(bytes,id,{codec,requireComplete:true});if(id===proof.sessionId)requireValue(bytes.subarray(0,originalRouter.bytes.length).equals(originalRouter.bytes),'SG10_ORIGINAL_ROUTER_PREFIX_CHANGED');else requireValue(hash(bytes)===digest,'SG10_PRIOR_JOURNAL_CHANGED')}
    const after=await fingerprints();requireValue(isDeepStrictEqual(after,before),'SG10_SKILL_SOURCE_DRIFT')
    t.diagnostic(JSON.stringify({case:'private-skill-final-boundaries',sourceStable:true,originalConfigUnchanged:true,protectedJournalsUnchanged:prior.size-1,completedExecutionUnchanged:true,originalRouterPrefixUnchanged:true,privateFiles:expected,ignored:true,tracked:false,staged:false,realModelExecuted:false,realVendorExecuted:false}))
    if(errors.length)throw new AggregateError(errors,'SG10 private skill cleanup failed')
  })
  await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve))
  const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve))
  const local={...config,plugins:[],channelPlugins:(config.channelPlugins??[]).map(plugin=>({...plugin,enabled:false})),skillWatch:false,credentialsWatch:false,memory:{...config.memory,background:false},reflection:{...config.reflection,enabled:false},model:{provider:'sg10-local',model:'m'},providers:{'sg10-local':{api:'openai-completions',baseURL:`http://127.0.0.1:${endpoint.address().port}/v1`,apiKeyEnv:'SG10_LOCAL_MODEL_KEY',models:[{id:'m',input:['text'],contextWindow:65536,maxTokens:1024}]}},resident:{...config.resident,host:'127.0.0.1',port,taskSessions:{...config.resident.taskSessions,provider:'sg10-local',model:'m',reasoningMode:'inherit'}}}
  host=await createHost(local,{deferScheduledDelivery:true,environmentOptions:{inherited:{...process.env,SG10_LOCAL_MODEL_KEY:'local-fixture'}}})
  host.ctx.on('tools/result',(execution,result)=>events.push({name:execution.name,sessionId:execution.agent?.id,isError:!!result.isError}))
  await host.ctx.plugin({inject,apply:ctx=>application(ctx,local)});app=host.ctx.get('application')
  if(modelError)throw modelError
  requireValue(app&&requests===1&&handoffRequests===1,'SG10_SETTLED_HANDOFF_STARTUP_PROTOCOL_INVALID')
  requireValue(host.ctx.channels.transports.size===0&&host.ctx.channels.plugins.size===0,'SG10_CHANNEL_WAS_ACTIVATED')
  const current=await app.tasks.store.query({kind:'router.get',conversationId:proof.conversationId})
  requireValue(current?.activeSessionId!==proof.sessionId&&current.generation===proof.generation+1&&current.cursor===1&&current.lastHandoffCursor===1&&current.phase==='active','SG10_ROUTER_CHECKPOINT_NO_LONGER_CURRENT')
  const base=`http://127.0.0.1:${port}`,readTask=async()=>{const response=await fetch(base+'/state/tasks/'+targetTask.taskId+'/detail',{signal:t.signal});requireValue(response.status===200,'SG10_EXISTING_TASK_NOT_READABLE');return response.json()}
  const taskBefore=await readTask(),initialHealth=await(await fetch(base+'/health',{signal:t.signal})).json(),tasksBefore=await app.tasks.store.query({kind:'task.list',archived:'all'}),noticesBefore=await app.tasks.store.query({kind:'notification.list'})
  requireValue(taskBefore.status==='completed'&&taskBefore.drained&&taskBefore.runSequence===1&&taskBefore.session.sessionId===targetTask.sessionId,'SG10_EXISTING_TASK_TERMINAL_CHANGED')
  requireValue(initialHealth.status==='ok'&&!app.tasks.listAlerts().some(row=>row.detail==='ROUTER_BATCH_UNSETTLED'),'SG10_SETTLED_ROUTER_STILL_DEGRADED')
  const startupRequests=requests
  await app.tasks.recover();await app.tasks.whenIdle();if(modelError)throw modelError
  requireValue(requests===startupRequests,'SG10_SETTLED_ROUTER_RECOVERY_REPLAYED')
  const taskAfter=await readTask(),router=await app.tasks.store.query({kind:'router.get',conversationId:proof.conversationId}),inbox=await app.tasks.store.query({kind:'router.inbox',conversationId:proof.conversationId})
  requireValue(taskAfter.status==='completed'&&taskAfter.drained&&taskAfter.runSequence===1&&taskAfter.session.sessionId===targetTask.sessionId&&isDeepStrictEqual(taskAfter.completion,taskBefore.completion),'SG10_COMPLETED_EXECUTION_CHANGED')
  requireValue(inbox.length===0&&router.cursor===1&&router.generation===proof.generation+1&&router.phase==='active','SG10_ROUTER_NOT_SETTLED_AND_ROTATED')
  const candidate=await host.ctx.sessionPersistence.readNative(router.activeSessionId,{requireComplete:true})
  requireValue(candidate.header.conversationId===proof.conversationId&&candidate.header.generation===router.generation&&candidate.entries.some(entry=>entry.type==='custom_message'&&entry.customType==='night.router-handoff'&&entry.details.conversationId===proof.conversationId),'SG10_ROUTER_HANDOFF_SEED_MISSING')
  requireValue(isDeepStrictEqual(await app.tasks.store.query({kind:'task.list',archived:'all'}),tasksBefore)&&isDeepStrictEqual(await app.tasks.store.query({kind:'notification.list'}),noticesBefore),'SG10_EXISTING_BUSINESS_LEDGER_CHANGED')
  requireValue(events.length===0&&requests===1&&handoffRequests===1,'SG10_RESUME_MODEL_PROTOCOL_INVALID')
  const continued=await host.ctx.sessionPersistence.readNative(proof.sessionId,{requireComplete:true})
  requireValue(isDeepStrictEqual(continued.entries.slice(0,originalRouter.native.entries.length),originalRouter.native.entries),'SG10_ROUTER_ENTRIES_CHANGED')
  for(const kind of ['enqueued','admitted'])requireValue(continued.audit.filter(row=>row.domain==='admission'&&row.kind===kind&&row.payload.id===proof.packetId).length===1,'SG10_ROUTER_ADMISSION_REPLAYED')
  requireValue(continued.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details.packetId===proof.packetId).length===1,'SG10_ROUTER_INPUT_REPLAYED')
  requireValue(continued.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-claim').length===1&&continued.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.router-resume-turn').length===1,'SG10_CONSUMED_CHECKPOINT_REUSED')
  const health=await(await fetch(base+'/health',{signal:t.signal})).json()
  requireValue(health.status==='ok'&&health.recoveryIssueCount===0&&health.outboundAuthorized===false,'SG10_FINAL_PRIVATE_HOST_NOT_HEALTHY')
  t.diagnostic(JSON.stringify({case:'original-install-settled-private-skill-handoff-recovered',taskId:targetTask.taskId,sessionId:targetTask.sessionId,status:taskAfter.status,drained:taskAfter.drained,runSequence:taskAfter.runSequence,initialHealth:initialHealth.status,finalHealth:health.status,requests,businessRequests:0,handoffRequests,executionRequests:0,originalReadReceipts:reads.length,nativeReadResultBindings:true,originalPacketUnique:true,settled:true,legalHandoff:true,consumedCheckpointNotCalled:true,ordinaryRecoveryNoReplay:true,channelTransports:0,originalInstallBound:true,realModelExecuted:false,realVendorExecuted:false}))
})
