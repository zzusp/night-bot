import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm,stat,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs,isDeepStrictEqual} from 'node:util'
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {parse} from 'yaml'
import {createHost} from '../../../../src/host.js'
import {openResidentStore} from '../../../../packages/dingtalk-core/store.js'
import {openDynamicTaskStore} from '../../../../packages/dingtalk-core/dynamic-task-store.js'
import {openTaskSessionService} from '../../../../packages/dingtalk-core/task-session-service.js'

import test from 'node:test'
const {values}=parseArgs({options:{config:{type:'string'},case:{type:'string',default:'all'},attempt:{type:'string',default:'initial'},check:{type:'boolean',default:false}}})
const cases=values.case==='all'?['router','web-continuation']:[values.case]
const feature=fileURLToPath(new URL('../',import.meta.url)),hash=value=>createHash('sha256').update(value).digest('hex')
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n')
const redactions=[]
let diagnosticsReady=false
const safeText=value=>redactions.reduce((text,secret)=>text.split(secret).join('[redacted]'),String(value)).replace(/https?:\/\/[^\s"'<>]+/g,'[redacted-url]')
let suppressedLogs=0
for(const method of ['log','info','warn','error','debug'])console[method]=()=>{suppressedLogs++}
const errorInfo=error=>({name:typeof error?.name==='string'?error.name:'Error',message:typeof error?.message==='string'?safeText(error.message):undefined,code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)?error.code:undefined,status:Number.isInteger(error?.status)?error.status:undefined,issues:error?.issues?.map(issue=>({code:issue.code,path:issue.path,message:safeText(issue.message)})),errors:error?.errors?.map(errorInfo),cause:error?.cause&&errorInfo(error.cause)})
function requireBusiness(condition,code){if(!condition)throw Object.assign(new Error(code),{code})}
function requireReadBack(journal,file,expected,after=0){
  const entries=journal.entries.slice(after),target=resolve(journal.header.cwd,file)
  const ids=new Set(entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').flatMap(entry=>(entry.message.content??[]).filter(part=>part.type==='toolCall'&&part.name==='read'&&typeof part.arguments?.path==='string'&&resolve(journal.header.cwd,part.arguments.path)===target).map(part=>part.id)))
  requireBusiness(entries.some(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName==='read'&&!entry.message.isError&&ids.has(entry.message.toolCallId)&&entry.message.content.some(part=>part.type==='text'&&part.text.includes(expected))),'LIVE_TARGET_FILE_NOT_READ_BACK')
}
const artifactProof=artifact=>({artifactId:artifact.artifactId,taskId:artifact.taskId,requirementRevision:artifact.requirementRevision,sha256:artifact.sha256,size:artifact.size,descriptorSha256:hash(JSON.stringify(artifact))})
function requireFileDeliveries(tasks,notices,sent,readbacks){
  return tasks.flatMap(task=>task.completion.result.artifactFiles.map(({artifact})=>{
    const matches=notices.filter(row=>row.taskId===task.taskId&&row.requirementRevision===task.requirementRevision&&row.payload.artifact?.artifactId===artifact.artifactId)
    requireBusiness(matches.length===1,'LIVE_FILE_NOTIFICATION_NOT_UNIQUE')
    const notice=matches[0],parent=notices.find(row=>row.id===notice.payload.deliveryId),selection=parent?.payload.taskDelivery
    requireBusiness(notice.state==='delivered'&&parent?.state==='delivered'&&selection?.taskId===task.taskId&&selection.requirementRevision===task.requirementRevision&&selection.artifactIds.includes(artifact.artifactId),'LIVE_FILE_NOT_DELIVERED')
    requireBusiness(isDeepStrictEqual(notice.payload.artifact,artifact)&&isDeepStrictEqual(notice.payload.taskDelivery,selection),'LIVE_FILE_DESCRIPTOR_SELECTION_MISMATCH')
    requireBusiness(parent.payload.artifactFiles.some(file=>isDeepStrictEqual(file.artifact,artifact)),'LIVE_FILE_PARENT_DESCRIPTOR_MISMATCH')
    const sends=sent.filter(row=>row.kind==='file'&&row.deliveryKey===notice.id),proof=artifactProof(artifact)
    requireBusiness(sends.length===1,'LIVE_FILE_SEND_NOT_UNIQUE')
    const send=sends[0],readback=readbacks.find(row=>row.kind==='file'&&row.deliveryKey===notice.id&&row.messageId===send.messageId)
    for(const observed of [send,readback,notice.receipt])requireBusiness(observed&&Object.entries(proof).every(([key,value])=>observed[key]===value),'LIVE_FILE_PROOF_MISMATCH')
    requireBusiness(send.notificationId===notice.id&&send.deliveryId===parent.id&&notice.ack?.messageId===send.messageId&&notice.receipt.messageId===send.messageId,'LIVE_FILE_RECEIPT_IDENTITY_MISMATCH')
    return {...proof,notificationId:notice.id,parentNotificationId:parent.id,state:notice.state,send:structuredClone(send),readback:structuredClone(readback),ackMessageId:notice.ack.messageId,receiptMessageId:notice.receipt.messageId}
  }))
}
async function readHandoffDiagnostics(host,store){
  const diagnostics=[]
  for(const rotation of (await store.query({kind:'router.rotations'})).filter(row=>row.state==='aborted')){
    const row={handoffId:rotation.id,conversationId:rotation.conversationId,sessionId:rotation.oldSessionId,generation:rotation.oldGeneration,cutoff:rotation.cutoff,requiredSourceIds:rotation.requiredSourceIds,state:rotation.state,abortCode:typeof rotation.error==='string'&&/^ROUTER_[A-Z0-9_]+$/.test(rotation.error)?rotation.error:undefined,abortCodeUnavailable:typeof rotation.error!=='string'||!/^ROUTER_[A-Z0-9_]+$/.test(rotation.error)}
    diagnostics.push(row)
    try{
      const native=await host.ctx.sessionPersistence.readNative(rotation.oldSessionId,{requireComplete:true})
      requireBusiness(native.header.id===rotation.oldSessionId&&native.header.conversationId===rotation.conversationId&&native.header.generation===rotation.oldGeneration&&native.header.runtimeOwner==='conversation-router','LIVE_HANDOFF_NATIVE_HEADER_MISMATCH')
      const packet=native.audit.find(entry=>entry.domain==='admission'&&entry.kind==='enqueued-internal'&&entry.payload.id===rotation.id)?.payload
      requireBusiness(packet?.source.kind==='router-handoff'&&packet.source.handoffId===rotation.id&&packet.source.conversationId===rotation.conversationId&&packet.source.generation===rotation.oldGeneration,'LIVE_HANDOFF_PACKET_NOT_PAIRED')
      const indices=native.entries.flatMap((entry,index)=>entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.packetId===packet.id?[index]:[])
      requireBusiness(indices.length===1,'LIVE_HANDOFF_NATIVE_INPUT_NOT_UNIQUE')
      const request=native.entries[indices[0]]
      assert.deepEqual(request.details.source,packet.source)
      assert.deepEqual(request.content,packet.content)
      const firstLine=packet.content.find(part=>part.type==='text')?.text.split(String.fromCharCode(10))[0],prefix='Router 交接请求：'
      requireBusiness(firstLine?.startsWith(prefix),'LIVE_HANDOFF_REQUEST_METADATA_MISSING')
      const input=JSON.parse(firstLine.slice(prefix.length))
      requireBusiness(input.conversationId===rotation.conversationId&&input.generation===rotation.oldGeneration&&input.handoffId===rotation.id&&input.cutoff===rotation.cutoff&&isDeepStrictEqual(input.requiredSourceIds,rotation.requiredSourceIds),'LIVE_HANDOFF_REQUEST_METADATA_MISMATCH')
      row.requestMetadataMatches=true
      const response=native.entries.slice(indices[0]+1).find(entry=>entry.type==='message'&&entry.message.role==='assistant'||entry.type==='custom_message'&&entry.customType==='night.business-input')
      requireBusiness(response?.type==='message'&&response.message.role==='assistant'&&response.message.stopReason==='stop'&&!response.message.content.some(part=>part.type==='toolCall'),'LIVE_HANDOFF_RESPONSE_NOT_PAIRED')
      const value=JSON.parse(response.message.content.filter(part=>part.type==='text').map(part=>part.text).join('\n'))
      row.packetId=packet.id;row.requestEntryId=request.id;row.responseEntryId=response.id;row.responseCutoff=Number.isSafeInteger(value.cutoff)?value.cutoff:undefined;row.responseCutoffMatches=value.cutoff===rotation.cutoff;row.nativeCommitted=true;row.evidenceRefs=[]
      requireBusiness(Array.isArray(value.evidenceRefs),'LIVE_HANDOFF_REFERENCE_SHAPE_INVALID')
      for(const ref of value.evidenceRefs){
        const proof={}
        for(const field of ['sourceId','taskId']){
          if(typeof ref[field]!=='string')continue
          const id=ref[field],found=await store.query({kind:field==='sourceId'?'source.get':'task.get',[field]:id}),same=!!found&&found.groupId===rotation.conversationId
          proof[field]={sha256:hash(id),...(same?{id}:{}),exists:!!found,scopeMatches:same,...found?{groupIdSha256:hash(found.groupId??''),...same?{groupId:found.groupId}:{},...field==='sourceId'?{version:found.version,triageHold:!!found.triageHold,archiveRestoreHold:!!found.archiveRestoreHold}:{}}:{}}
        }
        row.evidenceRefs.push(proof)
      }
    }catch(error){row.diagnosticError={code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)?error.code:'LIVE_HANDOFF_DIAGNOSTIC_FAILED'}}
  }
  return diagnostics
}
async function runCase(kind,settings){
  const evidence=join(feature,'round-4',values.attempt+'-'+kind+'-result.json')
  const report={version:1,case:kind,mode:'real-model-with-fake-channel',startedAt:new Date().toISOString(),errors:[],model:{configuredModelSha256:hash(settings.model),protocol:settings.api,backendIdentity:'Authorized endpoint only; upstream deployment identity is not independently attested.'}}
  const toolRows=[],toolStarts=[],agentErrors=[]
  let toolSequence=0
  let root,host,residentStore,store,service,stage='configuration',completedTasks=[],deduplicate,readDelivery
  const {source:profileSource,key,baseURL,model,api}=settings
async function close(){
  const errors=[]
  for(const action of [()=>service?.close(),()=>store?.close(),()=>residentStore?.close(),()=>host?.close()]){
    try{await action()}catch(error){errors.push(error)}
  }
  service=store=residentStore=host=undefined
  if(errors.length)throw new AggregateError(errors,'LIVE_CLEANUP_FAILED')
}
async function journalState(){
  const rows=[]
  for(const row of await host.ctx.sessionPersistence.list()){
    const snapshot=await host.ctx.sessionPersistence.readNative(row.header.id,{requireComplete:true})
    rows.push({sessionId:row.header.id,preset:row.header.agentPreset,assistantMessages:snapshot.entries.filter(entry=>entry.type==='message'&&entry.message.role==='assistant').length})
  }
  return rows
}
  try{
    root=await mkdtemp(join(tmpdir(),'night-real-router-'))
    const profile={api,baseURL,apiKeyEnv:'NIGHT_LIVE_ACCEPTANCE_KEY',models:[{id:model,input:['text'],contextWindow:profileSource.contextWindow??262144,maxTokens:profileSource.maxTokens??32768}],...(profileSource.compat?{compat:profileSource.compat}:{})}
    const config={installRoot:root,dataDir:'data',model:{provider:'live-acceptance',model},providers:{'live-acceptance':profile},memory:{background:false},skillWatch:false,credentialsWatch:false}
    const sent=[],readbacks=[],visible=new Map()
    function publish(envelope,proof={}){
      requireBusiness(!visible.has(envelope.deliveryKey),'LIVE_FAKE_DUPLICATE_SEND')
      const message={deliveryKey:envelope.deliveryKey,messageId:'fake-visible-'+(sent.length+1),...proof}
      visible.set(envelope.deliveryKey,message);sent.push(message)
      return {messageId:message.messageId}
    }
    function readVisible(envelope,notification,file=false){
      const message=visible.get(envelope.deliveryKey)
      requireBusiness(message&&message.messageId===notification.ack?.messageId,'LIVE_FAKE_READBACK_IDENTITY_MISMATCH')
      if(file){const proof=artifactProof(notification.payload.artifact);requireBusiness(message.notificationId===notification.id&&message.deliveryId===notification.payload.deliveryId&&Object.entries(proof).every(([key,value])=>message[key]===value),'LIVE_FAKE_FILE_READBACK_MISMATCH')}
      readbacks.push({...message,kind:file?'file':'text'})
      return {...message,visible:true}
    }
    const transport={
      async send(envelope){return publish(envelope)},
      async readback(envelope,notification){return readVisible(envelope,notification)},
      async sendFile(envelope,notification,file){
        const bytes=await readFile(file.path),artifact=notification.payload.artifact
        requireBusiness(file.artifactId===artifact.artifactId&&hash(bytes)===artifact.sha256&&bytes.length===artifact.size,'LIVE_FAKE_FROZEN_FILE_MISMATCH')
        return publish(envelope,{kind:'file',notificationId:notification.id,deliveryId:notification.payload.deliveryId,...artifactProof(artifact)})
      },
      async readbackFile(envelope,notification){return readVisible(envelope,notification,true)}
    }
    readDelivery=async()=>({observedAfterSequence:toolSequence,sends:sent.length,readbacks:readbacks.length,fileSends:sent.filter(row=>row.artifactId).length,sent:structuredClone(sent),readbackProofs:structuredClone(readbacks),expectedFiles:(await store.query({kind:'task.list'})).flatMap(task=>(task.completion?.result?.artifactFiles??[]).map(file=>artifactProof(file.artifact))),notifications:(await store.query({kind:'notification.list'})).map(row=>({id:row.id,kind:row.kind,state:row.state,taskId:row.taskId,requirementRevision:row.requirementRevision,deliveryId:row.payload?.deliveryId,artifact:row.payload?.artifact?artifactProof(row.payload.artifact):undefined,ackMessageId:row.ack?.messageId,receipt:row.receipt?{messageId:row.receipt.messageId,artifactId:row.receipt.artifactId,sha256:row.receipt.sha256,size:row.receipt.size,descriptorSha256:row.receipt.descriptorSha256}:undefined,errorCode:row.deliveryError?.code}))})
    async function boot(initialize){
      host=await createHost(config,{environmentOptions:{inherited:{NIGHT_LIVE_ACCEPTANCE_KEY:key}}})
      const ctx=host.ctx
      ctx.on('agent/error',event=>agentErrors.push(errorInfo(event.error)))
      ctx.on('tools/execute',async(execution,next)=>{
        toolStarts.push({sequence:toolSequence++,callId:execution.callId,name:execution.name,sessionId:execution.agent?.id,...execution.name==='resident_dependency_evaluate'?{dependencyId:execution.arguments.dependencyId,decision:execution.arguments.decision}:{}})
        return next()
      })
      ctx.on('tools/result',(execution,result)=>{const row={index:toolRows.length,sequence:toolSequence++,callId:execution.callId,name:execution.name,sessionId:execution.agent?.id,isError:!!result.isError,...execution.name==='resident_dependency_evaluate'?{dependencyId:execution.arguments.dependencyId,decision:execution.arguments.decision}:{},...result.isError?{error:errorInfo(result.error)}:{},...execution.name==='resident_router_reply'?{reply:{operationIdSha256:hash(JSON.stringify(execution.arguments.operationId??null)),sourceIdSha256:hash(JSON.stringify(execution.arguments.sourceId??null)),messageVersion:execution.arguments.messageVersion,selection:execution.arguments.taskDelivery?{taskIdSha256:hash(JSON.stringify(execution.arguments.taskDelivery.taskId??null)),requirementRevision:execution.arguments.taskDelivery.requirementRevision,artifactIdHashes:execution.arguments.taskDelivery.artifactIds?.map(id=>hash(JSON.stringify(id)))}:undefined,notificationId:result.value?.notification?.id,state:result.value?.notification?.state,preparedNotificationIds:result.value?.notifications?.map(row=>row.id)}}:{}};toolRows.push(row);emit({event:'tool-result',case:kind,...row})})
      ctx.channels.registerTransport('live-fake',transport)
      const taskConfig={...config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'real-router-acceptance',ownerActorId:'synthetic-owner',webActorId:'synthetic-owner',agentPreset:'night-bot',reasoningMode:'inherit',initialize}
      residentStore=await openResidentStore(ctx.storageDomain)
      store=await openDynamicTaskStore(taskConfig)
      service=await openTaskSessionService({ctx,config:taskConfig,store,residentStore,legacy:{getAgentConfig:()=>({...taskConfig,agentNames:['assistant']}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Object.assign(new Error('LIVE_VENDOR_SEND_FORBIDDEN'),{code:'LIVE_VENDOR_SEND_FORBIDDEN'})},readback:async()=>{throw Object.assign(new Error('LIVE_VENDOR_READBACK_FORBIDDEN'),{code:'LIVE_VENDOR_READBACK_FORBIDDEN'})}}})
    }
    const query=(kind,args={})=>store.query({kind,...args})
    stage='host-boot';emit({event:'phase',case:kind,stage});await boot(true)
    stage='business';emit({event:'phase',case:kind,stage})
    if(kind==='router'){
    const marker='SYNTHETIC-'+randomUUID()
    const input={type:'chat-room',channelId:'live-fake',conversationId:'synthetic-room',senderId:'synthetic-user',messageId:'synthetic-ordered-work',text:`本条是隔离合成验收，不涉及真实人或生产系统。请只安排两个事项，标题分别为“合成核算A”和“合成报告B”。A：核算17+25，用write写work/a-proof.txt，内容严格为SUM=<计算值>，再用read核验，随后task_result complete；evidence包含核验值与真实路径，把该文件列为artifacts和deliveryFiles。B：只有Router读取A当前完成结果并确认数值正确且无未决限制后才能开始。请在同一个原子计划中保存B依赖A及验收条件，不得只在摘要里描述先后，不得仅凭completed放行。B使用当前核验值写work/b-report.txt，严格两行VERIFIED_SUM=<核验值>与MARKER=${marker}，再read核验，列为artifacts和deliveryFiles并提交complete。每事项只用自己的唯一执行会话。已授权的业务仅为任务work内读写；禁止网络、进程、其他文件、另建协调任务或额外事项。完成后只向当前会话说明结果。`}
    stage='business';emit({event:'phase',stage});stage='router-ingress';await host.ctx.channels.receive(input);stage='router-idle';await service.whenIdle();stage='router-reflection';await host.ctx.reflection.whenIdle();stage='router-validation'
    const tasks=await query('task.list'),a=tasks.find(task=>task.title==='合成核算A'),b=tasks.find(task=>task.title==='合成报告B')
    report.tasks=tasks.map(task=>({taskId:task.taskId,title:task.title,status:task.status,drained:task.drained,requirementRevision:task.requirementRevision,sessionId:task.sessionId}))
    requireBusiness(tasks.length===2&&!!a&&!!b,'LIVE_TWO_TASKS_REQUIRED')
    requireBusiness(a.status==='completed'&&b.status==='completed'&&a.drained&&b.drained,'LIVE_TASKS_NOT_COMPLETED_AND_DRAINED')
    requireBusiness(a.sessionId!==b.sessionId,'LIVE_TASK_SESSION_NOT_UNIQUE')
    const dependency=(await query('router.dependencies',{taskId:b.taskId})).find(row=>row.prerequisiteTaskId===a.taskId)
    requireBusiness(dependency?.state==='satisfied'&&dependency.prerequisiteRequirementRevision===a.requirementRevision,'LIVE_CURRENT_DEPENDENCY_NOT_SATISFIED')
    const evaluations=await query('router.evaluations',{taskId:b.taskId})
    requireBusiness(evaluations.some(row=>row.decision==='satisfied'&&row.prerequisiteRequirementRevision===a.requirementRevision),'LIVE_CURRENT_EVIDENCE_NOT_EVALUATED')
    const evaluate=toolRows.find(row=>row.name==='resident_dependency_evaluate'&&!row.isError&&row.dependencyId===dependency.id&&row.decision==='satisfied'),bTool=toolStarts.find(row=>row.sessionId===b.sessionId)
    requireBusiness(evaluate&&bTool&&evaluate.sequence<bTool.sequence,'LIVE_B_STARTED_BEFORE_ASSESSMENT')
    requireBusiness(toolRows.some(row=>row.name==='resident_task_query'&&!row.isError),'LIVE_ROUTER_DID_NOT_QUERY_EVIDENCE')
    for(const task of [a,b]){
      const journal=await host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
      if(task===b){
        const packets=journal.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued'&&row.payload.source.kind==='task-input').map(row=>JSON.parse(row.payload.content.find(part=>part.type==='text').text))
        const current=packets.find(input=>input.task.taskId===b.taskId&&input.task.requirementRevision===b.requirementRevision)?.task.dependencies
        requireBusiness(current?.length===1&&current[0].id===dependency.id&&current[0].evaluation.id===dependency.evaluationId&&current[0].evaluation.decision==='satisfied'&&current[0].prerequisite.taskId===a.taskId&&current[0].prerequisite.requirementRevision===a.requirementRevision,'LIVE_B_CURRENT_EVIDENCE_NOT_ADMITTED')
        assert.deepEqual(current[0].prerequisite.completion,a.completion)
      }
      const file=task===a?'work/a-proof.txt':'work/b-report.txt',bytes=await readFile(join(journal.header.cwd,file),'utf8')
      requireBusiness(bytes.trim()===(task===a?'SUM=42':`VERIFIED_SUM=42\nMARKER=${marker}`),'LIVE_FILE_BYTES_WRONG')
      requireReadBack(journal,file,task===a?'SUM=42':marker)
      requireBusiness(task.completion?.result?.artifactFiles?.length===1,'LIVE_FROZEN_OUTPUT_MISSING')
      const artifact=task.completion.result.artifactFiles[0].artifact
      requireBusiness(artifact.taskId===task.taskId&&artifact.requirementRevision===task.requirementRevision&&artifact.sha256===hash(bytes)&&artifact.size===Buffer.byteLength(bytes),'LIVE_FROZEN_OUTPUT_IDENTITY_WRONG')
      requireBusiness(!host.ctx.agents.get(task.sessionId),'LIVE_TASK_ACTOR_NOT_RELEASED')
    }
    requireBusiness((await query('execution.list')).length===0,'LIVE_SPLIT_EXECUTION_PRESENT')
    const sources=await query('source.list'),source=sources.find(row=>row.messageId===input.messageId)
    requireBusiness(source?.routed===true,'LIVE_SOURCE_NOT_DURABLY_ROUTED')
    const router=await query('router.get',{conversationId:source.groupId})
    requireBusiness(router?.generation>=2&&router.phase==='active','LIVE_ROUTER_HANDOFF_NOT_COMMITTED')
    requireBusiness((await query('router.inbox',{conversationId:source.groupId})).length===0,'LIVE_ROUTER_INPUT_PENDING')
    const notices=await query('notification.list')
    report.delivery=await readDelivery()
    requireBusiness(sent.length>0,'LIVE_FAKE_SEND_MISSING')
    requireBusiness(readbacks.length>0,'LIVE_FAKE_READBACK_MISSING')
    requireBusiness(notices.every(row=>['delivered','cancelled'].includes(row.state)),'LIVE_FAKE_DELIVERY_NOT_TERMINAL')
    report.delivery.files=requireFileDeliveries([a,b],notices,sent,readbacks)
    requireBusiness(agentErrors.length===0,'LIVE_AGENT_ERROR')
    report.business={tasksCompletedAndDrained:true,filesReadBack:true,frozenOutputs:2,dependencyState:dependency.state,acceptedCurrentEvidence:true,dependencyEvidenceInNativeInput:true,evaluationBeforeBTool:true,ordering:{dependencyId:dependency.id,evaluationCallId:evaluate.callId,evaluationResultSequence:evaluate.sequence,bFirstToolCallId:bTool.callId,bFirstToolStartSequence:bTool.sequence},routerGeneration:router.generation,pendingInputs:0,fakeDelivered:notices.filter(row=>row.state==='delivered').length}
    completedTasks=[a,b];deduplicate=()=>host.ctx.channels.receive(input)
    }else{
    const nonce='SYNTHETIC-'+randomUUID()
    const created=await service.createTask({requestId:'real-web-initial',objective:`隔离合成任务。仅在work/resume.txt写入BASE=${nonce}，用read核验后提交task_result action=wait（不是complete，不需要追问）。等真实后续输入再继续。不要网络、进程、外部文件或创建其他任务。`})
    stage='web-idle-1';await service.whenIdle();stage='web-reflection-1';await host.ctx.reflection.whenIdle();stage='web-state-1'
    const held=await query('task.get',{taskId:created.taskId})
    requireBusiness(held.drained&&held.lastDecision?.action==='wait'&&held.status!=='completed','LIVE_WEB_INITIAL_NOT_HELD')
    const initial=await host.ctx.sessionPersistence.readNative(held.sessionId,{requireComplete:true})
    requireReadBack(initial,'work/resume.txt',`BASE=${nonce}`)
    requireBusiness((await readFile(join(initial.header.cwd,'work/resume.txt'),'utf8')).trim()===`BASE=${nonce}`,'LIVE_WEB_INITIAL_BYTES_WRONG')
    const args={taskId:held.taskId,requestId:'real-web-preserve',progressImpact:'preserve',context:`这是认证Web后续输入，保持已完成BASE行的原字节，只在同一work/resume.txt后追加NEXT=${nonce}，用read核验两行后提交complete。文件作为artifacts和deliveryFiles。使用原任务执行会话，不重做原初始效果，不执行网络、进程或其他业务。`,expectedRequirementRevision:held.requirementRevision,expectedControlRevision:held.controlRevision}
    stage='web-append';await service.appendTaskContext(args);stage='web-idle-2';await service.whenIdle();stage='web-reflection-2';await host.ctx.reflection.whenIdle();stage='web-state-2'
    const task=await query('task.get',{taskId:held.taskId}),journal=await host.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true})
    requireBusiness(task.status==='completed'&&task.drained&&task.sessionId===held.sessionId,'LIVE_WEB_SAME_SESSION_NOT_COMPLETED')
    requireBusiness(task.requirementRevision===held.requirementRevision&&task.contextRevision===(held.contextRevision??0)+1,'LIVE_WEB_PRESERVE_VERSION_CHANGED')
    requireBusiness((await readFile(join(journal.header.cwd,'work/resume.txt'),'utf8')).trim()===`BASE=${nonce}\nNEXT=${nonce}`,'LIVE_WEB_CONTINUATION_BYTES_WRONG')
    assert.deepEqual(journal.entries.slice(0,initial.entries.length),initial.entries)
    requireReadBack(journal,'work/resume.txt',`NEXT=${nonce}`,initial.entries.length)
    const sources=await Promise.all(task.sourceRefs.map(sourceId=>query('source.get',{sourceId})))
    requireBusiness(sources.some(row=>row.channel==='web'&&row.actorId==='synthetic-owner'&&row.text===args.context),'LIVE_WEB_EXACT_SOURCE_MISSING')
    requireBusiness(task.completion?.result?.artifactFiles?.length===1,'LIVE_WEB_FROZEN_OUTPUT_MISSING')
    requireBusiness(sent.length===0&&readbacks.length===0&&(await query('notification.list')).length===0,'LIVE_WEB_UNAUTHORIZED_DELIVERY')
    requireBusiness((await query('execution.list')).length===0&&!host.ctx.agents.get(task.sessionId),'LIVE_WEB_EXECUTION_NOT_RELEASED')
    requireBusiness(agentErrors.length===0,'LIVE_WEB_AGENT_ERROR')
    report.business={initialWait:true,exactNewWebSource:true,sameSession:true,initialJournalPrefixPreserved:true,originalProgressBytesPreserved:true,completedAndDrained:true,frozenOutputs:1,noChannelDelivery:true}
    report.tasks=[{taskId:task.taskId,status:task.status,drained:task.drained,requirementRevision:task.requirementRevision,sessionId:task.sessionId}]
    completedTasks=[task];deduplicate=()=>service.appendTaskContext(args)
    }
    const historyBefore=await journalState(),taskHashes=[]
    for(const task of completedTasks)taskHashes.push({taskId:task.taskId,sha256:hash(await readFile(host.ctx.sessionPersistence.path(task.sessionId)))})
    const before={sends:sent.length,readbacks:readbacks.length,tools:toolRows.length,assistantMessages:historyBefore.reduce((n,row)=>n+row.assistantMessages,0)}
    report.business.modelAssistantMessages=before.assistantMessages
    stage='cold-recovery';emit({event:'phase',case:kind,stage});await close();await boot(false);await service.recover();await service.whenIdle();await host.ctx.reflection.whenIdle()
    await deduplicate();await service.whenIdle();await host.ctx.reflection.whenIdle()
    requireBusiness((await query('task.list')).length===completedTasks.length,'LIVE_DUPLICATE_TASK_CREATED')
    for(const saved of taskHashes){const task=await query('task.get',{taskId:saved.taskId});requireBusiness(task.status==='completed'&&task.drained,'LIVE_COLD_TASK_STATE_CHANGED');requireBusiness(hash(await readFile(host.ctx.sessionPersistence.path(task.sessionId)))===saved.sha256,'LIVE_COLD_TASK_JOURNAL_REPLAYED')}
    const historyAfter=await journalState()
    requireBusiness(historyAfter.reduce((n,row)=>n+row.assistantMessages,0)===before.assistantMessages&&toolRows.length===before.tools,'LIVE_COLD_MODEL_OR_TOOL_REPLAYED')
    requireBusiness(sent.length===before.sends&&readbacks.length===before.readbacks,'LIVE_COLD_DELIVERY_REPLAYED')
    requireBusiness(agentErrors.length===0,'LIVE_COLD_AGENT_ERROR')
    report.coldRecovery={duplicateSourceDidNotDispatch:true,taskJournalBytesUnchanged:true,modelAssistantMessagesUnchanged:true,toolsUnchanged:true,fakeDeliveryUnchanged:true}
    report.passed=true
  }catch(error){
    report.passed=false;report.failureSequence=toolSequence;report.errors.push({stage,...errorInfo(error)});emit({event:'failure',case:kind,stage,...errorInfo(error)})
    if(store){try{report.failureTasks=(await store.query({kind:'task.list'})).map(task=>({taskId:task.taskId,title:task.title,status:task.status,drained:task.drained,requirementRevision:task.requirementRevision,lastDecision:task.lastDecision?{action:task.lastDecision.action,summary:safeText(task.lastDecision.summary),limitations:task.lastDecision.limitations?.map(safeText)}:undefined}))}catch(snapshotError){report.failureSnapshotError=errorInfo(snapshotError)}}
    report.failedTools=toolRows.filter(row=>row.isError)
    if(store&&readDelivery){try{report.delivery={snapshot:'failure-before-close',...await readDelivery()}}catch(snapshotError){report.deliverySnapshotError=errorInfo(snapshotError)}}
    if(store&&host&&kind==='router'){try{report.handoffDiagnostics=await readHandoffDiagnostics(host,store)}catch(snapshotError){report.handoffSnapshotError=errorInfo(snapshotError)}}
  }
  finally{
    try{await close();report.cleanup={closed:true};if(root){await rm(root,{recursive:true,force:true});report.cleanup.isolatedRootRemoved=true}}catch(error){report.passed=false;report.errors.push({stage:'cleanup',...errorInfo(error)});report.cleanup={closed:false,isolatedRootRetained:!!root}}
    report.finishedAt=new Date().toISOString();report.agentErrors=agentErrors;report.replyReceipts=toolRows.filter(row=>row.reply);report.toolCounts=Object.fromEntries([...new Set(toolRows.map(row=>row.name))].map(name=>[name,toolRows.filter(row=>row.name===name).length]));report.head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
    await writeFile(evidence,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
    emit({event:'case-result',case:kind,passed:report.passed,evidence:relative(process.cwd(),evidence),errors:report.errors,cleanup:report.cleanup})
  }
  return report
}
try{
  requireBusiness(typeof values.config==='string'&&!!values.config&&(await stat(values.config)).isFile(),'LIVE_CONFIG_REQUIRED')
  requireBusiness(/^[a-z0-9-]+$/.test(values.attempt),'LIVE_ATTEMPT_INVALID')
  requireBusiness(cases.every(kind=>['router','web-continuation'].includes(kind)),'LIVE_CASE_INVALID')
  const controlled=await realpath(join(feature,'round-4'))
  requireBusiness(controlled===resolve(feature,'round-4'),'LIVE_EVIDENCE_DIRECTORY_ALIAS')
  for(const kind of cases){try{await stat(join(controlled,values.attempt+'-'+kind+'-result.json'));throw Object.assign(new Error('LIVE_EVIDENCE_EXISTS'),{code:'LIVE_EVIDENCE_EXISTS'})}catch(error){if(error.code!=='ENOENT')throw error}}
  if(values.check){emit({check:true,effects:0,configFileExists:true,networkRequests:0,temporaryRootsCreated:0,concurrency:Math.min(cases.length,2),cases})}
  else{
    const configTree=parse(await readFile(values.config,'utf8')),candidates=[]
    function visit(value){
      if(!value||typeof value!=='object')return
      if(!Array.isArray(value)&&['apiKey','api_key','apiKeyEnv','api_key_env'].some(key=>typeof value[key]==='string'&&!!value[key].trim()))candidates.push(value)
      for(const item of Object.values(value))visit(item)
    }
    visit(configTree);requireBusiness(candidates.length===1,'LIVE_CONFIG_AMBIGUOUS')
    const source=candidates[0],reference=source.apiKeyEnv??source.api_key_env
    const key=source.apiKey??source.api_key??(reference?process.env[reference]:undefined)
    const baseURL=source.baseURL??source.baseUrl??source.base_url??source.endpoint
    const model=source.model??source.modelId??source.model_id??source.models?.[0]?.id
    let api=source.api??source.protocol??'openai-completions'
    if(api==='openai')api='openai-completions'
    if(api==='anthropic')api='anthropic-messages'
    requireBusiness(typeof key==='string'&&!!key.trim(),'LIVE_CREDENTIAL_MISSING')
    requireBusiness(typeof baseURL==='string'&&!!baseURL&&typeof model==='string'&&!!model,'LIVE_CONFIG_CONNECTION_MISSING')
    requireBusiness(['openai-completions','openai-responses','anthropic-messages'].includes(api),'LIVE_CONFIG_API_UNSUPPORTED')
    redactions.push(key,baseURL,model,new URL(baseURL).hostname)
    diagnosticsReady=true
    const settings={source,key,baseURL,model,api}
    await test('real-model independent acceptance',{concurrency:Math.min(cases.length,2)},async t=>{
      await Promise.all(cases.map(kind=>t.test(kind,async()=>{
        emit({event:'case-start',case:kind,at:new Date().toISOString(),pid:process.pid})
        const result=await runCase(kind,settings)
        requireBusiness(result.passed,'LIVE_CASE_FAILED')
      })))
    })
  }
}catch(error){emit({event:'runner-failure',...diagnosticsReady?errorInfo(error):{name:'Error',code:'LIVE_CONFIGURATION_INVALID'}});process.exitCode=1}
