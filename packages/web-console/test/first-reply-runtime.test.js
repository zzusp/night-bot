import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from '../../../test/fixtures/resident-router-host.js'
import {createWebConsole} from '../server/plugin.js'
test('真实 Host 接收到无任务首答、Router直接答复、未知投递与静默，经HTTP逐消息核验',{timeout:45000},async t=>{
 const replied=new Set(),settled=new Set()
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body),handoff=requestEnvelope(body,'Router 交接请求：')
  if(handoff&&!tools.length)return {text:JSON.stringify({currentIntent:'保持真实来源',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(row=>({sourceId:row.sourceId,messageVersion:row.version??row.messageVersion,needsHandling:row.text.includes('DIRECT')||row.text.includes('WAIT'),reason:'本地首答验证',...row.text.includes('SILENT')||row.text.includes('DIRECT')||row.text.includes('WAIT')?{}:{reply:'已收到 '+row.text}}))}}}
  if(tools.includes('resident_router_reply')){const input=requestEnvelope(body,'Router 请求：');if(!input)return {text:'等待真实输入'};const key=input.events.map(row=>row.id).join(',');if(settled.has(key))return {text:'本批已结清'};const event=input.events.find(row=>row.source);if(event&&!event.source.text.includes('WAIT')&&!replied.has(event.source.sourceId)){replied.add(event.source.sourceId);return {tool:'resident_router_reply',args:{operationId:'direct-'+event.source.sourceId,sourceId:event.source.sourceId,messageVersion:event.source.version,text:'这条消息无需建立任务，可直接答复。'}}}if(body.messages.at(-1)?.role!=='tool'&&!(event?.source?.text??'').includes('WAIT'))return {text:'已提交'};settled.add(key);return {tool:'resident_router_settle',args:{operationId:'settle-'+input.events.map(row=>row.id).join(','),eventIds:input.events.map(row=>row.id)}}}
  return {text:'完成'}
 },{readback:envelope=>envelope.text.includes('UNKNOWN')?undefined:{messageId:'confirmed-'+envelope.deliveryKey,visible:true}})
 let web
 try{
  const input=channelMessage('reply-one',{text:'FIRST_ONE',senderName:'成员甲',conversationName:'首答验证'})
  await h.receive(input);await h.service.whenIdle()
  web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'web-first-reply',senderId:'operator',port:0},getApplication:()=>({config:{},tasks:h.service}),getSessionPersistence:()=>h.host.ctx.sessionPersistence})
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0]
  const api=async path=>{const r=await fetch(web.origin+path,{headers:{origin:web.origin,cookie}});return {status:r.status,body:await r.json()}}
  const id=h.host.ctx.channels.identity(input).sessionId,endpoint='/api/conversations/'+id+'/response-times'
  await Promise.all([h.receive(channelMessage('batch-one',{text:'BATCH_TOPIC_ONE'})),h.receive(channelMessage('batch-two',{text:'BATCH_TOPIC_TWO'}))]);await h.service.whenIdle()
  for(const [messageId,text] of [['reply-two','FIRST_TWO'],['reply-direct','DIRECT'],['reply-unknown','UNKNOWN'],['reply-silent','SILENT'],['reply-wait','WAIT']]){await h.receive(channelMessage(messageId,{text}));await h.service.whenIdle()}
  const result=await api(endpoint);assert.equal(result.status,200,JSON.stringify(result.body));const row=id=>result.body.items.find(row=>row.messageId===id)
  for(const id of ['reply-one','reply-two','reply-direct','batch-one','batch-two']){assert.equal(row(id).status,'confirmed',JSON.stringify(row(id)));assert.ok(row(id).durationMs>=0);assert.ok(row(id).steps.some(step=>step.label==='首条回复已确认可见'))}
  for (const id of ['reply-one','reply-two','reply-direct','batch-one','batch-two']) {
   const stage=row(id).steps.find(step=>step.kind==='stage-triage-completed')
   assert.ok(stage&&Number.isFinite(stage.durationMs)&&stage.durationMs>=0,JSON.stringify(row(id)))
  }
  const routerStage=row('reply-direct').steps.find(step=>step.kind==='stage-router-completed')
  assert.ok(routerStage&&Number.isFinite(routerStage.durationMs)&&routerStage.durationMs>=0,JSON.stringify(row('reply-direct')))
  const routerStart=row('reply-direct').steps.find(step=>step.kind==='stage-router-started')
  assert.ok(routerStart&&routerStart.timingType==='milestone'&&Date.parse(routerStart.at)<=Date.parse(routerStage.at))
  assert.match(routerStart.label,/Router 开始准备/)
  assert.equal(row('reply-direct').steps.find(step=>step.kind==='reply-visible').timingType,'milestone')
  assert.match(row('reply-direct').replyPreview,/无需建立任务/);
  const direct=(await h.query('notification.list')).find(notice=>notice.payload?.sourceRef?.messageId==='reply-direct');assert.equal(direct.payload.replyPurpose,undefined,'真实 Router 未标用途的送达回执也必须进入 HTTP 首答结果');
  assert.equal(row('reply-unknown').durationMs,null);assert.equal(row('reply-unknown').status,'unconfirmed');assert.equal(row('reply-silent').status,'no-reply');assert.equal(row('reply-wait').status,'awaiting-reply');assert.equal((await h.query('task.list',{groupId:id})).length,0)
  assert.equal((await api('/api/conversations/foreign/response-times')).status,404)
  const selectedUser=await api(endpoint+'?selectedMessageId=reply-direct&selectedMessageVersion=1');assert.equal(selectedUser.body.items.length,1);assert.equal(selectedUser.body.items[0].messageId,'reply-direct')
  const channelMessages=await api('/api/conversations/'+id+'/messages');const assistant=channelMessages.body.items.find(message=>message.role==='assistant'&&message.id===direct.id);assert.ok(assistant)
  assert.equal(channelMessages.body.items.find(message=>message.id==='reply-direct').messageVersion,1)
  const selectedAssistant=await api(endpoint+'?selectedMessageId='+encodeURIComponent(assistant.id));assert.equal(selectedAssistant.body.items[0].messageId,'reply-direct')
  assert.equal((await api(endpoint+'?selectedMessageId=missing')).body.status,'unavailable')
  assert.equal((await api(endpoint+'?selectedMessageId=reply-direct&selectedMessageVersion=2')).body.status,'unavailable')
  assert.equal((await api(endpoint+'?selectedMessageId=reply-direct&offset=0')).status,400)
  const count=h.requests.length;await api(endpoint);assert.equal(h.requests.length,count)
  const csrf=(await api('/api/session')).body.csrfToken,current=(await api('/api/chat-current')).body.conversationId
  const posted=await fetch(web.origin+'/api/chat',{method:'POST',headers:{origin:web.origin,cookie,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({conversationId:current,requestId:'web-first-answer',text:'WEB_FIRST'})});assert.equal(posted.status,202,await posted.text());await h.service.whenIdle()
  const webTiming=await api('/api/chat/'+current+'/response-times');assert.equal(webTiming.status,200);assert.equal(webTiming.body.items[0].status,'confirmed',JSON.stringify(webTiming.body));assert.ok(webTiming.body.items[0].durationMs>=0)
  const webSelected=await api('/api/chat/'+current+'/response-times?selectedMessageId=web-first-answer');assert.equal(webSelected.body.items[0].messageId,'web-first-answer')
  const webChat=await api('/api/chat/'+current),webReply=webChat.body.messages.find(message=>message.role==='assistant');assert.ok(webReply)
  const webAssistant=await api('/api/chat/'+current+'/response-times?selectedMessageId='+encodeURIComponent(webReply.id));assert.equal(webAssistant.body.items[0].messageId,'web-first-answer')
  assert.equal((await api(endpoint+'?selectedMessageId='+encodeURIComponent(webReply.id))).body.status,'unavailable')
  t.diagnostic(JSON.stringify(result.body.items.map(({messageId,status,durationMs})=>({messageId,status,durationMs}))))
 }finally{await web?.close()}
})

test('Router Skill增改删的无提及最终回复经真实Web送达，清单与正文同步当前支持状态',async t=>{
 const {memoryScope}=await import('../../../src/memory/scope.js')
 const stages=new Map(),outcomes=new Map(),key='web-router-evidence'
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body),handoff=requestEnvelope(body,'Router 交接请求：')
  if(handoff&&!tools.length)return {text:JSON.stringify({currentIntent:'以当前账本为准',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:handoff.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:handoff.cutoff})}
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(row=>({sourceId:row.sourceId,messageVersion:row.version??row.messageVersion,needsHandling:true,reason:'直接维护学习Skill，无需承接或任务'}))}}}
  if(tools.includes('resident_skill_mutate')){
   const input=requestEnvelope(body,'Router 请求：'),source=input?.events.find(row=>row.source)?.source
   if(!source)return {text:'等待输入'}
   const step=stages.get(source.messageId)??0;stages.set(source.messageId,step+1)
   const revision={CREATE:0,UPDATE:1,DELETE:2}[source.text],action=source.text==='DELETE'?'delete':'upsert'
   if(step===0)return {tool:'resident_skill_mutate',args:{operationId:'mutate-'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,sourceQuote:source.text,action,key,expectedRevision:revision,...action==='upsert'?{steps:[source.text==='CREATE'?'读取当前来源':'同时核对来源与复验结果'],reason:'复用证据核对流程',applicability:'仅本地验证文字记录'}:{}}}
   if(step===1){outcomes.set(source.text,JSON.parse(body.messages.at(-1).content));return {tool:'resident_router_reply',args:{operationId:'reply-'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,recipientActorIds:[],text:'已完成 '+source.text+' 并回读确认。'}}}
   if(step===2)return {tool:'resident_router_settle',args:{operationId:'settle-'+source.messageId,eventIds:input.events.map(row=>row.id)}}
  }
  return {text:'本批已完成'}
 })
 let web
 try{
  web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,config:{channelId:'web-router-learning',senderId:'operator',port:0},getApplication:()=>({config:{},tasks:h.service}),getMemory:()=>h.host.ctx.memory,getReflection:()=>h.host.ctx.reflection,getSessionPersistence:()=>h.host.ctx.sessionPersistence})
  const login=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken
  const api=async(path,body)=>{const r=await fetch(web.origin+path,{method:body?'POST':'GET',headers:{origin:web.origin,cookie,...body?{'x-csrf-token':csrf,'content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});assert.equal(r.status,body?202:200,await r.clone().text());return r.json()}
  const current=(await api('/api/chat-current')).conversationId,scope=memoryScope({actorId:'reader'})
  for(const [stage,revision]of [['CREATE',1],['UPDATE',2],['DELETE',3]]){
   const requestId='router-skill-'+stage.toLowerCase()
   await api('/api/chat',{conversationId:current,requestId,text:stage});await h.service.whenIdle()
   assert.equal(outcomes.get(stage)?.persisted,true);assert.equal(outcomes.get(stage)?.revision,revision)
   const source=(await h.query('source.list')).find(row=>row.messageId===requestId)
   const notification=(await h.query('notification.list')).find(row=>row.kind==='router-reply'&&row.payload.sourceId===source.sourceId)
   assert.ok(notification);assert.equal(notification.state,'delivered',JSON.stringify(notification))
   assert.equal(notification.sendAttemptCount,1);assert.deepEqual(notification.payload.recipientActorIds,[])
   assert.equal(notification.payload.actorId,undefined,'显式空受众不伪造引用作者')
   assert.equal(notification.payload.sourceRef.actorId,source.actorId)
   const envelope=h.host.ctx.channels.deliveryEnvelope(notification)
   assert.equal(envelope.senderId,'operator');assert.deepEqual(envelope.recipientIds,[]);assert.equal(envelope.replyToMessageId,undefined)
   const chat=await api('/api/chat/'+current)
   assert.equal(chat.messages.filter(row=>row.role==='assistant').length,revision,'每次只发一次最终回复，无分诊承接')
   assert.ok(chat.messages.some(row=>row.role==='assistant'&&row.text.includes('已完成 '+stage)))
   const timing=await api('/api/chat/'+current+'/response-times?selectedMessageId='+requestId)
   assert.equal(timing.items[0].status,'confirmed')
   const view=await api('/api/evolution?kind=skill&limit=50&refresh=1'),item=view.items.find(row=>row.name==='learned-'+key)
   assert.equal(view.skills.activeCount,stage==='DELETE'?0:1)
   if(stage==='DELETE')assert.equal(item,undefined)
   else{
    assert.equal(item.status,'applied');assert.equal(item.revision,revision)
    const body=await api('/api/evolution/items/'+item.id+'?revision='+revision)
    assert.match(body.current.text,stage==='CREATE'?/读取当前来源/:/同时核对来源与复验结果/)
   }
   assert.deepEqual((await h.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,[])
   assert.deepEqual(await h.query('task.list'),[])
  }
  assert.equal((await h.host.ctx.reflection.state(scope)).skillRevisions[key],3)
  t.diagnostic(JSON.stringify({webFinalReplies:3,singleSend:true,skillVersions:[1,2,3],activeCounts:[1,1,0],emptyTasks:0,manufacturedExperience:0,realVendorCalls:0}))
 }finally{await web?.close()}
})
