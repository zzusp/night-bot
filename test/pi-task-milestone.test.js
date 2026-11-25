import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestTools,requestText,requestEnvelope,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

for(const strict of [true,false])test(`planned milestone ${strict?'waits across restart for verified delivery':'does not block later work'}`,{timeout:nativeTestTimeout(60000)},async t=>{
  let h, allowReadback=false, first=0, verified=0, originalSession, verificationSawDelivery
  const notificationText='Version 42 is deployed to the test environment. Business verification has not been run.'
  const decide=async body=>{
    const tools=requestTools(body)
    if(tools.includes('task_result')){
      const input=requestText(body).map(text=>{try{return JSON.parse(text)}catch{return null}}).findLast(x=>x?.task?.taskId==='fixture-milestone')
      assert.ok(input?.task?.milestone)
      if(input.task.milestone.state==='not-reached'&&first===0){
        first++; originalSession=input.task.sessionId
        return {tool:'task_milestone_notify',args:{text:notificationText}}
      }
      assert.equal(input.task.sessionId,originalSession)
      verificationSawDelivery=(await h.query('task.milestone',{taskId:'fixture-milestone'})).state==='delivered'
      verified++
      return {tool:'task_result',args:{decision:{action:'complete',summary:'Business verification passed.',evidence:['Business check passed'],limitations:[]}}}
    }
    if(!tools.includes('resident_router_settle'))return {text:'No actions'}
    const packet=requestEnvelope(body,'Router 请求：')
    const incoming=packet.events.find(event=>event.source?.text?.startsWith('Deploy'))
    if(incoming&&!(await h.query('task.get',{taskId:'fixture-milestone'}))){
      const {sourceId,version:messageVersion}=incoming.source
      return {tool:'resident_task_plan',args:{operationId:'plan-milestone',sourceId,messageVersion,tasks:[{taskId:'fixture-milestone',title:'Deploy test version',objective:'Deploy and verify',requirements:[],handoff:'Deploy, notify the original requester at rollout, then verify.',milestone:{trigger:'The test environment is running version 42',waitForDelivery:strict}}],dependencies:[]}}
    }
    if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Done with the current Router input'}
    return {tool:'resident_router_settle',args:{operationId:'settle-'+packet.events.map(event=>event.id).join('-'),eventIds:packet.events.map(event=>event.id)}}
  }
  h=await residentRouterHost(t,decide,{strictModelDecisions:true,readback:async()=>allowReadback?{messageId:'visible-1',visible:true}:null,
    wrapStore:store=>({...store,command:input=>store.command(input.kind==='notification.diagnostic'?{...input,args:{...input.args,nextAttemptAt:new Date(Date.now()+80).toISOString()}}:input)})})
  await h.receive(channelMessage('deploy',{text:'Deploy version 42, notify me when it is deployed, and run the business check.'}))
  await eventually(()=>h.sent.length===1,'milestone sent',t.signal)
  assert.equal(h.sent[0].text.includes(notificationText),true)
  assert.deepEqual(h.sent[0].recipientIds,['alice'])
  if(strict){
    await eventually(async()=>{const task=await h.query('task.get',{taskId:'fixture-milestone'});return task.drained&&task.milestoneNotification.notificationId},'parked task released its runner',t.signal)
    await h.restart()
    assert.equal(verified,0)
    allowReadback=true
    await h.service.recover()
    await eventually(async()=>{
      if((await h.query('task.milestone',{taskId:'fixture-milestone'})).state==='delivered')return true
      await h.service.recover({waitForRouter:false})
    },'transport readback confirms original message',t.signal)
  }
  await eventually(async()=> (await h.query('task.get',{taskId:'fixture-milestone'}))?.status==='completed','original task completed',t.signal)
  assert.equal(first,1)
  assert.equal(verified,1)
  assert.equal(verificationSawDelivery,strict)
  assert.equal(h.sent.filter(row=>row.text.includes(notificationText)).length,1)
})
