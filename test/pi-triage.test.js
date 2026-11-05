import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
const strings=body=>body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).filter(p=>p.type==='text').map(p=>p.text))
function envelope(body){for(const text of strings(body).reverse()){const line=text.split('\n').find(line=>line.startsWith('Topic 请求：'));if(line)return JSON.parse(line.slice('Topic 请求：'.length))}}
const has=(body,name)=>body.tools?.some(t=>t.function.name===name)
async function until(fn){for(let n=0;n<700;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,20))}throw Error('triage timeout')}
async function serviceFor(f){const ctx=f.host.ctx,config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'triage',initialize:true,ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'inherit'},residentStore=await openResidentStore(ctx.storageDomain),store=await openDynamicTaskStore(config),service=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:['assistant']}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('wrong transport')},readback:async()=>{throw Error('wrong transport')}}});return {service,store,residentStore,async close(){await service.close();await store.close()}}}
const input=(id,type='chat-room')=>({type,channelId:'local-fixture',conversationId:'room',senderId:Number(id)%2?'alice':'bob',messageId:'source-'+id,text:(Number(id)%2?'A':'B')+' subject '+id})
function feedback(env){return {tool:'group_topic_initial_reply',args:{requestId:env.requestId,replies:env.messages.map(m=>({topicKey:m.text.startsWith('A')?'subject-a':'subject-b',source:{messageId:m.messageId,messageVersion:m.messageVersion,quote:m.text},body:'可能需要核对 '+m.text+' 的具体范围；目前只是初步判断。',certainty:'tentative'})),silent:[]}}}
function routes(env){return {tool:'group_topic_route_submit',args:{requestId:env.requestId,routes:env.messages.map(m=>({messageId:m.messageId,messageVersion:m.messageVersion,ignoredRefs:[],units:[{unitKey:'subject',summary:m.text,sourceRefs:[{quote:m.text}],topics:[{...([...env.topics??[],...env.relatedTopics??[],...env.recalledTopics??[]].find(t=>t.title===(m.text.startsWith('A')?'甲事项范围核对':'乙事项范围核对'))?{topicId:[...env.topics??[],...env.relatedTopics??[],...env.recalledTopics??[]].find(t=>t.title===(m.text.startsWith('A')?'甲事项范围核对':'乙事项范围核对')).topicId}:{newTopicKey:m.text.startsWith('A')?'subject-a':'subject-b',title:m.text.startsWith('A')?'甲事项范围核对':'乙事项范围核对'}),reason:'Separate subject with explicit context',candidateComparisons:[...(env.topics??[]),...(env.relatedTopics??[]),...(env.recalledTopics??[])].filter((v,i,a)=>a.findIndex(x=>x.topicId===v.topicId)===i).map(t=>({topicId:t.topicId,revision:t.revision,reason:'This message identifies its current subject'}))}]}]}))}}}
function routeRead(body,env){const pages=strings(body).flatMap(text=>{try{return [JSON.parse(text)]}catch{return []}});for(const m of env.messages){if(m.metadataReadCall&&!pages.some(p=>p.section==='messageMetadata'&&p.contentFingerprint&&p.requestId===env.requestId&&p.messageId===m.messageId))return {tool:'group_topic_route_context_get',args:m.metadataReadCall.arguments}}
}

test('real Pi first-tier steers arrivals into the same 15-message batch; 16 queues, topic replies quote exact sources before second-tier ends',{timeout:30000},async t=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),decisionGate=Promise.withResolvers();let held=false,firstSentAt,secondEndedAt,modelErrors=[];const feedbackDone=new Set(),delivered=[],receipts=new Map()
  const f=await memoryHost(t,async body=>{
    const env=envelope(body)
    if(has(body,'group_topic_route_submit')){
      if(!held){held=true;entered.resolve();await release.promise}
      // Appended source metadata pages are consumed through real tools.
      const pages=strings(body).flatMap(text=>{try{return [JSON.parse(text)]}catch{return []}})
      for(const m of env.messages){if(m.metadataReadCall&&!pages.some(p=>p.section==='messageMetadata'&&p.text?.includes('"messageId":"'+m.messageId+'"')&&p.requestId===env.requestId))return {tool:'group_topic_route_context_get',args:m.metadataReadCall.arguments}}
      const key=env.requestId+':'+env.messages.map(m=>m.messageId).join(',')
      if(!feedbackDone.has(key)){feedbackDone.add(key);return feedback(env)}
      return routes(env)
    }
    if(has(body,'group_decision_submit')){await decisionGate.promise;secondEndedAt=Date.now();const pages=strings(body).flatMap(text=>{try{return [JSON.parse(text)]}catch{return []}});if(!pages.some(p=>p.topic?.topicId===env.topicId||p.topicId===env.topicId&&p.messages))return {tool:'group_topic_context_get',args:{}};return {tool:'group_decision_submit',args:{requestId:env.requestId,topicId:env.topicId,revision:env.revision,decision:{basisMessageIds:[...new Set(env.messages.map(m=>m.messageId))],basisUnitRefs:env.messages.map(m=>({unitId:m.unitId,unitRevision:m.unitRevision})),actions:[],reason:'No task requested; follow-up topic context retained',topicUpdate:{summary:'Topics await further facts; no business conclusion.'}}}}}
  })
  const h=await serviceFor(f);t.after(async()=>{release.resolve();decisionGate.resolve();await h.close()})
  f.host.ctx.on('tools/result',(exec,result)=>{if(result.isError){modelErrors.push({name:exec.name,error:result.error})}})
  f.host.ctx.channels.registerTransport('local-fixture',{async send(envelope){firstSentAt??=Date.now();delivered.push(envelope);const receipt={messageId:'receipt-'+delivered.length};receipts.set(envelope.deliveryKey,receipt);return receipt},async readback(envelope){return {...receipts.get(envelope.deliveryKey),visible:true}}})
  await f.host.ctx.channels.receive(input(1));await entered.promise
  await Promise.all(Array.from({length:15},(_,n)=>f.host.ctx.channels.receive(input(n+2))))
  const groupId=f.host.ctx.channels.identity(input(1)).sessionId
  await until(()=>Object.values(h.residentStore.getGroup(groupId).coordinationRequests).some(row=>row.triageBatch?.messages.length===15))
  const active=f.host.ctx.agents.list().filter(a=>a.session.snapshotEvents().some(e=>e.type==='plugin:dingtalk/coordination'&&e.data.role==='route'));assert.equal(active.length,1);const firstSessionId=active[0].id
  const saved=Object.values(h.residentStore.getGroup(groupId).coordinationRequests).find(row=>row.triageBatch?.messages.length===15);assert.equal(saved.triageBatch.sessionId,firstSessionId);assert.ok(saved.triageBatch.appendGeneration>0)
  release.resolve();try{await until(()=>delivered.length>=15)}catch(error){throw Error(JSON.stringify({cause:error.message,delivered:delivered.length,modelErrors,requests:f.requests.length,notifications:await h.store.query({kind:'notification.list'}),group:h.residentStore.getGroup(groupId).coordinationRequests}))}
  assert.equal(secondEndedAt,undefined,'preliminary delivery must not await the second tier')
  decisionGate.resolve();await until(()=>h.residentStore.getGroup(groupId).messages.every(m=>m.routingStatus==='routed'))
  await until(()=>delivered.length===16)
  assert.equal(new Set(delivered.map(row=>row.replyToMessageId)).size,16);assert.ok(delivered.every(row=>row.type==='chat-room'&&row.text.startsWith('初步判断')&&row.mentions.includes(row.senderId)))
  const batches=Object.values(h.residentStore.getGroup(groupId).coordinationRequests).filter(row=>row.triageBatch).map(row=>row.triageBatch.messages.length);assert.deepEqual(batches.sort((a,b)=>b-a),[15,1],JSON.stringify({batches,modelErrors}))
  try{await until(()=>secondEndedAt)}catch(error){throw Error(JSON.stringify({modelErrors,tools:f.requests.slice(-4).map(r=>r.tools?.map(t=>t.function.name)),topics:h.residentStore.getGroup(groupId).topics,requests:h.residentStore.getGroup(groupId).coordinationRequests}))};assert.ok(firstSentAt<=secondEndedAt);assert.equal((await h.store.query({kind:'execution.list'})).length,0);t.diagnostic(JSON.stringify({firstTierSendBeforeSecondTierMs:secondEndedAt-firstSentAt,batchSizes:batches,delivered:delivered.length}));await h.service.whenIdle();await h.close()
})

test('cold recovery keeps the same triage session; an uncertain private-chat send is read back and never sent again',{timeout:30000},async t=>{
  let mode='pause',feedbackSent=false,sendCalls=0,sendEnvelope;const receipts=new Map()
  const f=await memoryHost(t,body=>{
    const env=envelope(body)
    if(has(body,'group_topic_route_submit')){if(mode==='pause')return {text:'Continue classification after restart'};if(!feedbackSent){feedbackSent=true;return feedback(env)}return routes(env)}
    if(has(body,'group_decision_submit')){const pages=strings(body).flatMap(text=>{try{return [JSON.parse(text)]}catch{return []}});if(!pages.some(p=>p.topic?.topicId===env.topicId||p.topicId===env.topicId&&p.messages))return {tool:'group_topic_context_get',args:{}};return {tool:'group_decision_submit',args:{requestId:env.requestId,topicId:env.topicId,revision:env.revision,decision:{basisMessageIds:env.messages.map(m=>m.messageId),basisUnitRefs:env.messages.map(m=>({unitId:m.unitId,unitRevision:m.unitRevision})),actions:[],reason:'No execution requested',topicUpdate:{summary:'Awaiting more facts.'}}}}}
  })
  let h=await serviceFor(f);t.after(()=>h.close());const original=input(101,'chat')
  await f.host.ctx.channels.receive(original)
  const groupId=f.host.ctx.channels.identity(original).sessionId
  const before=await until(()=>{const row=Object.values(h.residentStore.getGroup(groupId)?.coordinationRequests??{}).find(row=>row.triageBatch);return row&&f.host.ctx.agents.get(row.triageBatch.sessionId)?.status==='idle'&&row})
  const sessionId=before.triageBatch.sessionId;await h.close();await f.close();mode='finish';await f.boot();h=await serviceFor(f)
  f.host.ctx.channels.registerTransport('local-fixture',{async send(envelope){sendCalls++;sendEnvelope=envelope;receipts.set(envelope.deliveryKey,{messageId:'external-proof'});throw Error('simulated lost acknowledgement after sending')},async readback(){throw Error('readback temporarily unavailable')}})
  await h.service.recover()
  const unknown=await until(async()=>{const row=(await h.store.query({kind:'notification.list'})).find(row=>row.kind==='triage-reply');return row?.state==='unknown'&&row})
  assert.equal(sendCalls,1);assert.equal(sendEnvelope.type,'chat');assert.deepEqual(sendEnvelope.mentions,[]);assert.equal(sendEnvelope.replyToMessageId,original.messageId)
  assert.equal(Object.values(h.residentStore.getGroup(groupId).coordinationRequests).find(row=>row.triageBatch).triageBatch.sessionId,sessionId)
  await h.service.whenIdle();await h.close();await f.close();await f.boot();h=await serviceFor(f)
  f.host.ctx.channels.registerTransport('local-fixture',{async send(){sendCalls++;throw Error('must not repeat an uncertain send')},async readback(envelope){return {...receipts.get(envelope.deliveryKey),visible:true}}})
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(unknown.nextAttemptAt)-Date.now()+30)));await h.service.recover()
  await until(async()=>(await h.store.query({kind:'notification.get',notificationId:unknown.id})).state==='delivered')
  await f.host.ctx.channels.receive(original);await h.service.whenIdle();assert.equal(sendCalls,1)
  const sessions=(await f.host.ctx.sessionPersistence.list()).filter(row=>row.header.id===sessionId);assert.equal(sessions.length,1)
  await h.close()
})
