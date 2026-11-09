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
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(row=>({sourceId:row.sourceId,messageVersion:row.version??row.messageVersion,needsHandling:row.text.includes('DIRECT'),reason:'本地首答验证',...row.text.includes('SILENT')||row.text.includes('DIRECT')?{}:{reply:'已收到 '+row.text}}))}}}
  if(tools.includes('resident_router_reply')){const input=requestEnvelope(body,'Router 请求：');if(!input)return {text:'等待真实输入'};const key=input.events.map(row=>row.id).join(',');if(settled.has(key))return {text:'本批已结清'};const event=input.events.find(row=>row.source);if(event&&!replied.has(event.source.sourceId)){replied.add(event.source.sourceId);return {tool:'resident_router_reply',args:{operationId:'direct-'+event.source.sourceId,sourceId:event.source.sourceId,messageVersion:event.source.version,text:'这条消息无需建立任务，可直接答复。',replyPurpose:'direct-answer'}}}if(body.messages.at(-1)?.role!=='tool')return {text:'已提交'};settled.add(key);return {tool:'resident_router_settle',args:{operationId:'settle-'+input.events.map(row=>row.id).join(','),eventIds:input.events.map(row=>row.id)}}}
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
  for(const [messageId,text] of [['reply-two','FIRST_TWO'],['reply-direct','DIRECT'],['reply-unknown','UNKNOWN'],['reply-silent','SILENT']]){await h.receive(channelMessage(messageId,{text}));await h.service.whenIdle()}
  const result=await api(endpoint);assert.equal(result.status,200,JSON.stringify(result.body));const row=id=>result.body.items.find(row=>row.messageId===id)
  for(const id of ['reply-one','reply-two','reply-direct','batch-one','batch-two']){assert.equal(row(id).status,'confirmed',JSON.stringify(row(id)));assert.ok(row(id).durationMs>=0);assert.ok(row(id).steps.some(step=>step.label==='首条回复已确认可见'))}
  assert.match(row('reply-direct').replyPreview,/无需建立任务/);
  assert.equal(row('reply-unknown').durationMs,null);assert.equal(row('reply-unknown').status,'unconfirmed');assert.equal(row('reply-silent').status,'no-reply');assert.equal((await h.query('task.list',{groupId:id})).length,0)
  assert.equal((await api('/api/conversations/foreign/response-times')).status,404)
  const count=h.requests.length;await api(endpoint);assert.equal(h.requests.length,count)
  const csrf=(await api('/api/session')).body.csrfToken,current=(await api('/api/chat-current')).body.conversationId
  const posted=await fetch(web.origin+'/api/chat',{method:'POST',headers:{origin:web.origin,cookie,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({conversationId:current,requestId:'web-first-answer',text:'WEB_FIRST'})});assert.equal(posted.status,202,await posted.text());await h.service.whenIdle()
  const webTiming=await api('/api/chat/'+current+'/response-times');assert.equal(webTiming.status,200);assert.equal(webTiming.body.items[0].status,'confirmed',JSON.stringify(webTiming.body));assert.ok(webTiming.body.items[0].durationMs>=0)
  t.diagnostic(JSON.stringify(result.body.items.map(({messageId,status,durationMs})=>({messageId,status,durationMs}))))
 }finally{await web?.close()}
})
