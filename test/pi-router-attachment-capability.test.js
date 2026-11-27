import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {taskWorkspace} from '../packages/dingtalk-core/session-workspaces.js'
import {join} from 'node:path'
import {piJournalFilename} from '../src/runtime/pi-journal.js'
import {backupTask,validateTaskArchive} from '../src/tasks/archive.js'
import {ledgerDigest,validateTaskLedger} from '../src/tasks/ledger-archive.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {taskNotificationRecovery} from '../packages/dingtalk-core/notification-delivery.js'
import {blockUnsupportedAttachment,withoutAttachmentPromise} from '../packages/dingtalk-core/group-notification.js'

const contents='# 现场核对草稿\n合成测试内容。\n'
const reply='核对已完成，见附件。'
const call=(tool,args)=>({tool,args})
const result=(body,name)=>body.messages.at(-1)?.role==='tool'&&body.messages.findLast(m=>m.role==='assistant')?.tool_calls?.at(-1)?.function?.name===name

test('attachment preflight never replaces a claimed send or an existing receipt',()=>{
 assert.equal(withoutAttachmentPromise(reply),'核对已完成。\n\n文件已保留，当前会话不支持发送附件。')
 for(const notification of [{state:'unknown'},{state:'delivered',receipt:{messageId:'actual'}},{state:'prepared',sendStartedAt:'now'},{state:'prepared',sendPermit:{attempt:1}}]){
  const before=structuredClone(notification)
  assert.equal(blockUnsupportedAttachment(notification,'later'),false)
  assert.deepEqual(notification,before)
 }
})

const reportedPath='work/report.md', importName='合成资料归档'
const cleanupHash=createHash('sha256').update(contents).digest('hex')
const cleanupPath=reportedPath, neighborPath='work/keep.md'
const cleanupCommand=`set -eu; digest=$(sha256sum -- '${cleanupPath}'); test "\${digest%% *}" = '${cleanupHash}'; rm -- '${cleanupPath}'; test ! -e '${cleanupPath}'`
async function attachmentFixture(t,files=['chat-room'],holdCompletion=false){
 let h,phase='open'
 const setPhase=value=>{phase=value}
 t.after(()=>{if(phase!=='verified')t.diagnostic('Last attachment test phase: '+phase)})
 const planned=new Map(),replied=new Set(),receipts=new Map(),attempts=[]
 let acceptedImport, crossChannelRead
 const capabilities={conversationTypes:['chat','chat-room'],files,standaloneMarkdown:true}
 let holdOldFile=true, failResumeId
 h=await residentRouterHost(t,async body=>{
  const names=requestTools(body)
  if(names.includes('task_result')){
   if(result(body,'task_result'))return {text:'Done'}
   const texts=requestText(body)
   if(texts.some(text=>text.includes('按原交办清理已核对的旧原件'))){
    if(result(body,'bash')){
     const ok=h.results.findLast(row=>row.name==='bash')?.result.value?.exitCode===0
     return call('task_result',{decision:ok
      ?{action:'complete',summary:'合成原件已入库，旧文件已清理。',evidence:[cleanupHash],limitations:[]}
      :{action:'blocked',summary:'旧文件未清理。',evidence:[],limitations:['清理命令未成功。']}})
    }
    assert.ok(texts.some(text=>text.includes(cleanupHash)&&text.includes(cleanupPath)))
    return call('bash',{description:'核对摘要后清理指定合成旧文件',command:cleanupCommand})
   }
   if(texts.some(text=>text.includes('并留一份不清理的旁文件'))&&!body.messages.some(msg=>msg.tool_calls?.some(call=>call.function.name==='write'))){
    return call('write',{path:neighborPath,content:'保留这份合成旁文件'})
   }
   if(result(body,'write')&&JSON.parse(body.messages.findLast(msg=>msg.tool_calls).tool_calls.at(-1).function.arguments).path===neighborPath){
    return call('write',{path:cleanupPath,content:contents})
   }
   if(requestText(body).some(text=>text.includes('跨渠道读取合成资料'))){
    if(!result(body,'shared_resource_lookup'))return call('shared_resource_lookup',{action:'search',query:importName,kind:'file'})
    const reply=JSON.parse(body.messages.at(-1).content)
    if(!reply.contentBase64){const match=reply.matches[0];return call('shared_resource_lookup',{action:'read',id:match.id,version:match.version,byteOffset:0})}
    crossChannelRead=reply
    return call('task_result',{decision:{action:'complete',summary:'已读共享原件。',evidence:[],limitations:[]}})
   }
   if(!result(body,'write'))return call('write',{path:'work/report.md',content:contents})
   return call('task_result',{decision:{action:'complete',summary:'核对已完成。',evidence:[],limitations:[],artifacts:['work/report.md'],deliveryFiles:requestText(body).some(text=>text.includes('仅记录原件'))?[]:[{path:'work/report.md',caption:'核对草稿'}]}})
  }
  if(!names.includes('resident_router_settle'))return {text:'No work'}
  if(result(body,'resident_router_settle'))return {text:'Settled'}
  const packet=requestEnvelope(body,'Router 请求：'),event=packet.events.find(row=>row.source)
  if(event?.source.messageId==='import-cleanup'){
   if(result(body,'resident_task_action'))return call('resident_router_settle',{operationId:'settle-cleanup',eventIds:packet.events.map(row=>row.id)})
   const task=await h.query('task.get',{taskId:'task-cleanup-draft'})
   if(result(body,'resident_router_shared_import')){
    acceptedImport=JSON.parse(body.messages.at(-1).content)
    assert.equal(acceptedImport.verified,true)
    assert.equal(acceptedImport.visibility,'bot-instance')
    assert.equal(acceptedImport.originalDisposition,'retained')
    return call('resident_task_action',{operationId:'cleanup-original',sourceId:event.sourceId,messageVersion:event.messageVersion,kind:'reopen',
     taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,sameGoal:true,
     handoff:`按原交办清理已核对的旧原件 ${cleanupPath}；已入库的文件版本 ${acceptedImport.file.version}，SHA-256 ${acceptedImport.file.sha256}。只清理这一份。`})
   }
   return call('resident_router_shared_import',{sourceId:event.sourceId,messageVersion:event.messageVersion,sourceQuote:event.source.text,
    taskId:task.taskId,requirementRevision:task.requirementRevision,path:cleanupPath,name:importName})
  }
  if(['import-existing','import-other-room','import-stale','import-unreported'].includes(event?.source.messageId)){
   const negative=event.source.messageId!=='import-existing'
   if(negative&&result(body,'resident_router_shared_import'))return call('resident_router_settle',{operationId:'settle-'+event.source.messageId,eventIds:packet.events.map(row=>row.id),
    noTaskDispositions:[{eventId:event.id,outcome:'context-only',reason:'File selection rejected.',sourceQuote:event.source.text}]})
   if(result(body,'resident_router_reply'))return call('resident_router_settle',{operationId:'settle-import',eventIds:packet.events.map(row=>row.id),
    noTaskDispositions:[{eventId:event.id,outcome:'handled-inline',reason:'Original saved.',sourceQuote:event.source.text}]})
   if(result(body,'resident_router_shared_import')){
    acceptedImport=JSON.parse(body.messages.at(-1).content)
    return call('resident_router_reply',{operationId:'import-reply',sourceId:event.sourceId,messageVersion:event.messageVersion,text:'草稿已收入知识库。'})
   }
   const task=await h.query('task.get',{taskId:'task-reported'})
   return call('resident_router_shared_import',{sourceId:event.sourceId,messageVersion:event.messageVersion,sourceQuote:event.source.text,
     taskId:task.taskId,requirementRevision:task.requirementRevision+Number(event.source.messageId==='import-stale'),path:event.source.messageId==='import-unreported'?'work/../materials/source.md':reportedPath,name:importName})
  }
  if(['send-existing','send-reported','send-bound-account','send-other-room','send-other-author'].includes(event?.source.messageId)){
   const fromReported=event.source.messageId!=='send-existing'
   if(result(body,'resident_router_reply'))return call('resident_router_settle',{operationId:'settle-'+event.source.messageId,eventIds:packet.events.map(row=>row.id),
    noTaskDispositions:[{eventId:event.id,outcome:event.source.messageId.startsWith('send-other-')?'context-only':'handled-inline',reason:'Request checked through Router.',sourceQuote:event.source.text}]})
   const task=await h.query('task.get',{taskId:fromReported?'task-reported':'task-private'})
   return call('resident_router_reply',{operationId:event.source.messageId,sourceId:event.sourceId,messageVersion:event.messageVersion,...fromReported?{completionEventId:'irrelevant-historical-event'}:{},text:'原文件见附件。',replyPurpose:'direct-answer',
    taskDelivery:{taskId:task.taskId,requirementRevision:task.requirementRevision,...(fromReported?{reportedFiles:[{path:reportedPath,caption:'原草稿'}]}:{artifactIds:task.completion.result.artifactFiles.map(file=>file.artifact.artifactId)})}})
  }
  if(event&&!planned.has(event.source.messageId)){
   const id='task-'+event.source.messageId
   planned.set(event.source.messageId,{id,source:event.source})
   return call('resident_task_plan',{operationId:id,sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:id,title:id,objective:'创建一次合成测试草稿',requirements:[],handoff:'在 work/report.md 保留合成测试草稿'+(id==='task-cleanup-draft'?'，仅记录原件并留一份不清理的旁文件':id==='task-reported'?'，仅记录原件':id==='task-lookup'?'，跨渠道读取合成资料':'')}],dependencies:[]})
  }
  const done=packet.events.find(row=>row.kind==='task.completed')
  if(done?.taskId==='task-reported'&&holdCompletion)return {text:'Leave this completed event pending for cold recovery.'}
  if(done&&!replied.has(done.taskId)){
   replied.add(done.taskId)
   const {source}=[...planned.values()].find(row=>row.id===done.taskId)
   const task=await h.query('task.get',{taskId:done.taskId})
   if(task.completion.result.artifactFiles?.length)return call('resident_router_reply',{operationId:'reply-'+done.taskId,sourceId:source.sourceId,messageVersion:source.version,text:reply,completionEventId:done.taskEventId,replyPurpose:'task-update',
    taskDelivery:{taskId:done.taskId,requirementRevision:task.requirementRevision,artifactIds:task.completion.result.artifactFiles.map(file=>file.artifact.artifactId)}})
  }
  return call('resident_router_settle',{operationId:'settle-'+packet.events.map(row=>row.id).join(','),eventIds:packet.events.map(row=>row.id)})
 },{
  wrapStore:store=>{
   if(failResumeId){
    const agents=h.host.ctx.agents,resume=agents.resume.bind(agents),oldId=failResumeId
    failResumeId=undefined
    agents.resume=(...inputs)=>{
     if(inputs[0]?.resumeSessionId===oldId)throw Object.assign(Error('Fixture skill authorization changed'),{code:'PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED'})
     return resume(...inputs)
    }
   }
   return store
  },
  strictModelDecisions:true,transportCapabilities:capabilities,channelIds:['resident-fixture','other-fixture'],
  privatePeer:input=>input.channelId==='resident-fixture'&&input.conversationId==='private-room'&&input.type==='chat'&&['alice','bound-account'].includes(input.senderId)?'alice':undefined,
  canSend:row=>!(holdOldFile&&row.payload.artifact&&row.payload.sourceRef.messageId==='old'),
  async send(envelope){
   const receipt={messageId:'text-proof-'+attempts.length,visible:true}
   attempts.push({kind:'text',envelope});receipts.set(envelope.deliveryKey,receipt);return {ack:true}
  },
  readback:envelope=>receipts.get(envelope.deliveryKey),
  async sendFile(envelope,notification,file){
   assert.equal(await readFile(file.path,'utf8'),contents)
   const receipt={messageId:'file-proof-'+attempts.length,visible:true,artifactId:notification.payload.artifact.artifactId}
   attempts.push({kind:'file',envelope});receipts.set(envelope.deliveryKey,receipt);return {ack:true}
  },
  readbackFile:envelope=>receipts.get(envelope.deliveryKey)
 })
 const parts=async messageId=>(await h.query('notification.list')).filter(row=>row.payload.sourceRef?.messageId===messageId)
 async function deliver(message,attachmentState){
  phase=message.messageId
  await h.receive(message)
  await eventually(async()=>{
   const rows=await parts(message.messageId),parent=rows.find(row=>!row.payload.artifact),file=rows.find(row=>row.payload.artifact)
   return parent?.state==='delivered'&&file?.state===attachmentState?true:undefined
  },`${message.messageId} delivery states`).catch(async error=>{t.diagnostic(JSON.stringify({results:h.results.map(x=>[x.name,x.result.error??x.result.value]),parts:await parts(message.messageId),alerts:h.service.listAlerts()}));throw error})
  phase=message.messageId+' settled'
  await h.service.whenIdle()
  return parts(message.messageId)
 }
 return {h,attempts,capabilities,parts,deliver,setPhase,recoverFromSkillChange:async oldId=>{holdCompletion=false;failResumeId=oldId;await h.restart()},releaseFile:()=>{holdOldFile=false},
  get acceptedImport(){return acceptedImport},get crossChannelRead(){return crossChannelRead}}
}

test('Router respects file capabilities and preserves independently proven attachment and text receipts',{timeout:nativeTestTimeout(65000)},async t=>{
 const {h,attempts,capabilities,parts,deliver,setPhase,releaseFile}=await attachmentFixture(t)
 const privateParts=await deliver(channelMessage('private',{type:'chat',conversationId:'private-room'}),'failed')
 const parent=privateParts.find(row=>!row.payload.artifact),file=privateParts.find(row=>row.payload.artifact)
 assert.match(parent.payload.text,/核对已完成/)
 assert.match(parent.payload.text,/当前会话不支持发送附件/)
 assert.doesNotMatch(parent.payload.text,/见附件/)
 assert.equal(file.deliveryError.code,'CHANNEL_FILE_DELIVERY_UNSUPPORTED')
 assert.equal(file.deliveryError.knownNotSent,true)
 assert.equal(file.deliveryError.retryable,false)
 assert.equal(file.sendPermit,undefined)
 assert.equal(taskNotificationRecovery(file).action,null)
 assert.equal((await h.query('task.get',{taskId:'task-private'})).completion.result.artifactFiles[0].artifact.sha256,file.payload.artifact.sha256)
 assert.deepEqual(attempts.map(row=>row.kind),['text'])
 const groupParts=await deliver(channelMessage('group'),'delivered')
 assert.ok(groupParts.every(row=>row.receipt?.messageId))
 assert.equal(groupParts.find(row=>!row.payload.artifact).payload.text,reply)
 assert.deepEqual(attempts.map(row=>row.kind),['text','text','file'])
 const oldParts=await deliver(channelMessage('old',{conversationId:'other-group'}),'prepared')
 assert.ok(oldParts.find(row=>row.payload.artifact))
 capabilities.files=[]
 releaseFile()
 await h.restart();await h.service.whenIdle()
 const recovered=(await parts('old')).find(row=>row.payload.artifact)
 assert.equal(recovered.state,'failed')
 assert.equal(recovered.deliveryError.code,'CHANNEL_FILE_DELIVERY_UNSUPPORTED')
 assert.equal(recovered.sendPermit,undefined)
 assert.deepEqual(attempts.map(row=>row.kind),['text','text','file','text'])
 assert.match((await parts('old')).find(row=>!row.payload.artifact).receipt.messageId,/text-proof-/)
 capabilities.files=['chat-room']
 await h.restart();await h.service.whenIdle()
 assert.equal((await parts('old')).find(row=>row.payload.artifact).state,'failed')
 assert.deepEqual(attempts.map(row=>row.kind),['text','text','file','text'])
 capabilities.files=['chat-room','chat']
 const before=(await h.query('task.list')).length
 const resend=await deliver(channelMessage('send-existing',{type:'chat',conversationId:'private-room',text:'请把原草稿文件发给我。'}),'delivered')
 assert.equal(resend.find(row=>row.payload.artifact).payload.artifact.sha256,file.payload.artifact.sha256)
 assert.equal((await h.query('task.list')).length,before)
 assert.deepEqual(attempts.slice(-2).map(row=>[row.kind,row.envelope.type,row.envelope.conversationId]),[['text','chat','private-room'],['file','chat','private-room']])
 setPhase('verified')
})

test('Router sends, imports and seals an original reported by a completed task',{timeout:nativeTestTimeout(65000)},async t=>{
 const fixture=await attachmentFixture(t,['chat-room','chat'],true)
 const {h,attempts,parts,deliver,setPhase,recoverFromSkillChange}=fixture
 async function receive(message){setPhase(message.messageId);await h.receive(message);await h.service.whenIdle()}
 setPhase('leave completion pending')
 await h.receive(channelMessage('reported',{type:'chat',conversationId:'private-room',text:'留一份草稿，暂时不用发。'}))
 await assert.rejects(h.service.whenIdle(),{code:'ROUTER_BATCH_UNSETTLED'})
 const original=await h.query('task.get',{taskId:'task-reported'})
 assert.deepEqual(original.completion.result.artifacts,[reportedPath]);assert.equal(original.completion.result.artifactFiles,undefined)
 const old=await h.query('router.get',{conversationId:original.groupId})
 const oldFile=join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(old.activeSessionId))
 const beforeRotation=await readFile(oldFile)
 assert.ok((await h.query('router.inbox',{conversationId:original.groupId})).some(event=>event.kind==='task.completed'))
 setPhase('recover old skill owner')
 await recoverFromSkillChange(old.activeSessionId)
 await h.service.whenIdle()
 const rotation=(await h.query('router.rotations',{conversationId:original.groupId})).find(row=>row.oldSessionId===old.activeSessionId)
 assert.equal(rotation?.state,'published');assert.equal(rotation.recovery.reason,'PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED')
 assert.ok(rotation.recovery.unknownTaskIds.includes(original.taskId))
 assert.deepEqual(await readFile(oldFile),beforeRotation)
 const file=(await deliver(channelMessage('send-reported',{type:'chat',conversationId:'private-room',text:'把刚才留的原稿发我。'}),'delivered')).find(row=>row.payload.artifact)
 const sha256=file.payload.artifact.sha256
 assert.deepEqual(attempts.map(row=>[row.kind,row.envelope.type,row.envelope.conversationId]),[['text','chat','private-room'],['file','chat','private-room']])
 assert.deepEqual((await h.query('task.get',{taskId:'task-reported'})).completion,original.completion)
 const replyFromAccount=channelMessage('send-bound-account',{type:'chat',conversationId:'private-room',senderId:'bound-account',text:'把刚才留的草稿原件发回这个私聊。'})
 const throughPeer=await deliver(replyFromAccount,'delivered')
 for(const part of throughPeer){
  assert.notEqual(part.payload.sourceRef.actorId,original.ownerActorId)
  assert.deepEqual(part.payload.recipientActorIds,[original.ownerActorId])
  assert.equal(part.payload.privateFileRecipientActorId,original.ownerActorId)
  assert.ok(part.receipt.messageId)
 }
 assert.equal(throughPeer.find(part=>part.payload.artifact).payload.artifact.sha256,sha256)
 assert.deepEqual((await h.query('task.get',{taskId:'task-reported'})).completion,original.completion)
 await receive(channelMessage('import-existing',{type:'chat',conversationId:'private-room',text:'刚才那份草稿也收录到我们的知识库吧。'}))
 const {acceptedImport}=fixture
 assert.equal(acceptedImport?.verified,true,JSON.stringify(h.results.filter(row=>row.name==='resident_router_shared_import').map(row=>row.result)))
 assert.equal(acceptedImport.file.sha256,sha256)
 assert.equal(acceptedImport.visibility,'bot-instance')
 assert.equal(acceptedImport.originalDisposition,'retained')
 const originalDirectory=await taskWorkspace(h.host.ctx.runtimePaths.workspaces,original.taskId,original)
 assert.equal(await readFile(join(originalDirectory,reportedPath),'utf8'),contents)
 assert.deepEqual((await h.query('task.get',{taskId:'task-reported'})).completion,original.completion)
 assert.equal((await h.query('task.list')).length,1)
 const sentBeforeRepeat=attempts.length
 await receive(channelMessage('send-reported',{type:'chat',conversationId:'private-room',text:'把刚才留的原稿发我。'}))
 assert.equal(attempts.length,sentBeforeRepeat)
 for(const id of ['send-other-room','send-other-author','import-other-room','import-stale','import-unreported']){
  const wrongRoom=id.endsWith('other-room')
  await receive(channelMessage(id,{type:'chat',conversationId:wrongRoom?'unrelated-room':'private-room',...id==='send-other-author'?{senderId:'other-authenticated-actor'}:{},text:'测试无效的原文件请求。'}))
  const tool=id.startsWith('send')?'resident_router_reply':'resident_router_shared_import'
  assert.match(JSON.stringify(h.results.findLast(row=>row.name===tool)?.result),/TASK_DELIVERY_SOURCE_STALE|SHARED_REPORTED_FILE_UNAVAILABLE/)
  assert.deepEqual(await parts(id),[])
 }
 assert.equal(attempts.length,sentBeforeRepeat)
 await receive(channelMessage('lookup',{channelId:'other-fixture',conversationId:'other-read-room',senderId:'bob',text:'查找并读取合成资料归档。'}))
 const {crossChannelRead}=fixture
 assert.deepEqual([crossChannelRead?.id,crossChannelRead?.version,crossChannelRead?.sha256],[acceptedImport.file.id,acceptedImport.file.version,acceptedImport.file.sha256])
 assert.equal(Buffer.from(crossChannelRead.contentBase64,'base64').toString('utf8'),contents)
 setPhase('close Host before offline seal')
 await h.close();await h.host.close()
 setPhase('offline seal')
 const config={...h.config,resident:{taskSessions:{instanceId:'resident-router-fixture'}}}
 const {destination}=await backupTask(config,'task-reported',join(h.root,'backups','reported-file'))
 const sealed=await validateTaskArchive(destination)
 assert.ok(sealed.manifest.files.some(row=>row.path.startsWith('outputs/')&&row.sha256===sha256))
 const ledger=sealed.snapshot.ledger
 const request=ledger.tables.sources.find(row=>row.body.messageId==='send-reported')
 assert.ok(request)
 assert.ok(!ledger.tables.tasks[0].body.sourceRefs.includes(request.id))
 const wrong=structuredClone(ledger);wrong.tables.sources.find(row=>row.id===request.id).body.actorId='other-actor'
 wrong.digest=ledgerDigest({version:wrong.version,taskId:wrong.taskId,tables:wrong.tables})
 assert.throws(()=>validateTaskLedger(wrong),/TASK_ARCHIVE_ROW_SCOPE_INVALID/)
 const wrongRecipient=structuredClone(ledger)
 const crossed=wrongRecipient.tables.notifications.find(row=>row.body.payload.sourceRef?.messageId==='send-bound-account'&&row.body.payload.artifact)
 assert.ok(crossed)
 crossed.body.payload.recipientActorIds=[crossed.body.payload.sourceRef.actorId]
 wrongRecipient.digest=ledgerDigest({version:wrongRecipient.version,taskId:wrongRecipient.taskId,tables:wrongRecipient.tables})
 assert.throws(()=>validateTaskLedger(wrongRecipient),/TASK_ARCHIVE_ROW_SCOPE_INVALID/)
 setPhase('verified')
})

test('explicit import and cleanup reuses the original execution and removes only the verified file',{timeout:nativeTestTimeout(65000),
 skip:process.platform!=='linux'&&'实际清理由 Linux 安装沙箱验证；其他系统不提供该受限 shell 合同'},async t=>{
 const fixture=await attachmentFixture(t),{h,setPhase}=fixture
 const originalInput=channelMessage('cleanup-draft',{text:'留一份合成草稿和一份不清理的旁文件，先不用发。'})
 await h.receive(originalInput);await h.service.whenIdle()
 const taskId='task-cleanup-draft',original=await h.query('task.get',{taskId})
 assert.equal(original.status,'completed')
 const directory=await taskWorkspace(h.host.ctx.runtimePaths.workspaces,taskId,original)
 assert.equal(await readFile(join(directory,cleanupPath),'utf8'),contents)
 setPhase('import-cleanup')
 await h.receive(channelMessage('import-cleanup',{text:'把刚才留的草稿收录到知识库，确认收录后只清理这份旧草稿。'}))
 await h.service.whenIdle().catch(error=>{
  const detail=e=>e&&{message:e.message,code:e.code,cause:detail(e.cause),businessFailure:detail(e.businessFailure),errors:e.errors?.map(detail)}
  t.diagnostic(JSON.stringify({error:detail(error),agentErrors:h.errors.map(detail),toolResults:h.results.slice(-6).map(row=>[row.name,row.result.error?.code??row.result.value?.exitCode??row.result.error]),alerts:h.service.listAlerts()}))
  throw error
 })
 const final=await h.query('task.get',{taskId})
 const execution=h.results.findLast(row=>row.name==='bash')?.result
 assert.equal(execution?.value?.exitCode,0,JSON.stringify({execution,errors:h.errors.map(error=>error.message),alerts:h.service.listAlerts()}))
 assert.equal(final.sessionId,original.sessionId)
 assert.equal(final.status,'completed')
 assert.equal(final.completion.result.summary,'合成原件已入库，旧文件已清理。')
 assert.equal(fixture.acceptedImport.file.sha256,cleanupHash)
 await assert.rejects(readFile(join(directory,cleanupPath)),{code:'ENOENT'})
 assert.equal(await readFile(join(directory,neighborPath),'utf8'),'保留这份合成旁文件')
 setPhase('verified')
})
