import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {nativeLifecycle,nativeLifecycleTimeout,nativeTemporaryDirectory as mkdtemp,nativeRemove as rm} from './fixtures/native-lifecycle.js'
import {nativeRuntimeHost} from './fixtures/runtime-official-host.js'
import {platformScheduleSessionId,platformScheduleOutboundId} from '../packages/dingtalk-core/fixed-topics.js'

for(const state of ['prepared','failed','unknown','cancel-before-send','forged-cancel'])test(`cancelled platform notification ${state} preserves cold send/readback boundary`,
 {timeout:nativeLifecycleTimeout(30000)},nativeLifecycle(30000,async t=>{
  const root=await mkdtemp(join(tmpdir(),'schedule-notification-fence-'))
  let h,sequence=0,sends=0,reads=0,cancelAtDisclosure
  const open=async()=>{h=await nativeRuntimeHost(root,()=>[],{notifications:{
    async canDisclose(){await cancelAtDisclosure?.();return true},
    async send(){sends++;if(state==='forged-cancel')throw Object.assign(new Error('external claimed cancellation'),{code:'PLATFORM_SCHEDULE_CANCELLED',knownNotSent:true,retryable:false});return {messageId:'unexpected-send'}},
    async readback(){reads++;if(state==='forged-cancel')return undefined;return {messageId:'already-sent',visible:true}},
  }})}
  t.after(async()=>{await h?.close();await rm(root,{recursive:true,force:true})})
  await t.beginBusiness();await open()
  const command=(kind,args)=>h.service.store.command({id:'fence-'+(++sequence),kind,args})
  const groupId='native-group',messageId='original-schedule',actorId='native-user',sourceId='schedule-source',requestId='frozen-schedule-request'
  await h.residentStore.ingest({groupId,messageId,senderOpenDingTalkId:actorId,text:'稍后汇报进展',occurredAt:new Date().toISOString()})
  await command('source.record',{sourceId,groupId,messageId,actorId,version:1,text:'稍后汇报进展'})
  await command('source.routed',{sourceId,receipt:{kind:'frozen-fixture'}})
  const sessionId=platformScheduleSessionId(requestId)
  await h.residentStore.preparePlatformSchedule({sourceMode:'direct',sourceId,actorId,groupId,messageId,messageVersion:1,requestId,sessionId,
    title:'Progress',prompt:'Report progress',timezone:'Asia/Shanghai',at:'2099-01-01T00:00:00.000Z'})
  const notificationId=platformScheduleOutboundId(requestId+':2026-11-13T01:00:00.000Z')
  await command('notification.prepare',{notificationId,taskId:null,requirementRevision:1,kind:'platform-reply',payload:{
    conversationId:groupId,sourceId,sourceVersion:1,sourceMessageId:messageId,actorId,text:'已准备但尚未发送的旧排期汇报',
    sourceRef:{messageId,messageVersion:1,actorId},replyKind:'substantive',taskIds:[],topicRefs:[],
  }})
  if(['failed','unknown'].includes(state)){
    const started=(await command('notification.start',{notificationId})).result.notification
    await command('notification.receipt',{notificationId,dispatchToken:started.dispatchToken,state,phase:'send',
      error:{message:'fixture interrupted send',knownNotSent:state==='failed',retryable:true},nextAttemptAt:null})
  }
  const cancel=()=>h.residentStore.updatePlatformSchedule(sessionId,{managementKey:'cancel-operation',outcome:'cancelled',completedAt:new Date().toISOString()})
  if(state==='cancel-before-send')cancelAtDisclosure=cancel
  else if(state!=='forged-cancel'){await cancel();await h.close();h=undefined;await open()}
  await h.service.recover();await h.service.whenIdle()
  assert.equal(sends,state==='forged-cancel'?1:0,'a persisted old notification must never be sent after schedule cancellation')
  assert.equal(reads,state==='unknown'?1:0,'only an already unknown external effect may be read back')
  const saved=await h.query('notification.get',{notificationId})
  assert.equal(saved.state,state==='unknown'?'delivered':state==='cancel-before-send'?'failed':state==='forged-cancel'?'unknown':state)
  if(state==='forged-cancel')assert.equal(saved.deliveryError.knownNotSent,false)
  if(state==='cancel-before-send'){assert.equal(saved.deliveryError.knownNotSent,true);assert.equal(saved.deliveryError.retryable,false)}
}))
