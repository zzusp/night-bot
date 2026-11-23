import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {residentRouterHost,requestEnvelope,requestTools,requestText,eventually} from '../../../test/fixtures/resident-router-host.js'
import {createWebConsole} from '../server/plugin.js'
import {parseWebChatAttachments} from '../server/chat-attachments.js'

const screenshot='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQy7vzHwAEfgJodQLI1QAAAABJRU5ErkJggg=='
const doc='Synthetic uploaded UTF-8 record'
test('Web attachment guards reject invalid byte encodings, arbitrary paths and over-limit aggregates',()=>{
 const valid={name:'../nested\\test.txt',mediaType:'text/plain',data:'eA=='}
 assert.equal(parseWebChatAttachments([valid])[0].name,'test.txt')
 assert.throws(()=>parseWebChatAttachments([{...valid, data:' !!!!'}]),{code:'CHAT_ATTACHMENTS_INVALID'})
 assert.throws(()=>parseWebChatAttachments([{...valid, path:'/not-a-browser-file'}]),{code:'CHAT_ATTACHMENTS_INVALID'})
 assert.throws(()=>parseWebChatAttachments(Array(9).fill(valid)),{code:'CHAT_ATTACHMENTS_INVALID'})
 const big={...valid,data:Buffer.alloc(4*1024*1024+1).toString('base64')}
 assert.throws(()=>parseWebChatAttachments([big,big]),{code:'CHAT_ATTACHMENTS_TOO_LARGE'})
})

test('authenticated Web POST stores a screenshot and file under one durable receipt, and Router reads both', {timeout:45000}, async t=>{
 let h,web,step=0,readImage=false,readText=false
 h=await residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_web_attachment'))return {text:'No operation'}
  const input=requestEnvelope(body,'Router 请求：'),event=input?.events.find(row=>row.source?.messageId==='attachment-message')
  if(!event)return {text:'No attachment request'}
  const source=event.source
  const args={sourceId:source.sourceId,messageVersion:source.version}
  if(step===0){step++;return {tool:'resident_web_attachment',args:{...args,index:0}}}
  if(step===1){step++;readImage=JSON.stringify(body.messages).includes('data:image/png;base64,');return {tool:'resident_web_attachment',args:{...args,index:1}}}
  if(step===2){step++;readText=requestText(body).some(row=>row.includes(doc));return {tool:'resident_router_reply',args:{operationId:'upload-reply',...args,text:'附件已读取。'}}}
  if(step===3){step++;return {tool:'resident_router_settle',args:{operationId:'upload-settle',eventIds:input.events.map(row=>row.id),noTaskDispositions:[{eventId:event.id,outcome:'handled-inline',sourceQuote:source.text,reason:'Verified attached material.'}]}}}
  return {text:'Settled'}
 },{hostOptions:{hostConfig:config=>{config.providers.fixture.models[0].input=['text','image'];return {}}}})
 t.after(()=>web?.close())
 web=await createWebConsole({channels:h.host.ctx.channels,paths:h.host.ctx.runtimePaths,
  config:{channelId:'web-attachments',senderId:'operator',port:0},getApplication:()=>({config:{},tasks:h.service}),getAttachments:()=>h.host.ctx.get('attachments')})
 const auth=await fetch(web.origin+'/api/login',{method:'POST',headers:{origin:web.origin,'content-type':'application/json'},body:JSON.stringify({token:(await readFile(web.credentialPath,'utf8')).trim()})})
 assert.equal(auth.status,200)
 const headers={origin:web.origin,cookie:auth.headers.get('set-cookie').split(';')[0],'x-csrf-token':(await auth.json()).csrfToken,'content-type':'application/json'}
 const send=(payload,overrides={})=>fetch(web.origin+'/api/chat',{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(payload)})
 const payload={requestId:'attachment-message',text:'',attachments:[{name:'screenshot.png',mediaType:'image/png',data:screenshot},{name:'details.txt',mediaType:'text/plain',data:Buffer.from(doc).toString('base64')}]}
 assert.equal((await send(payload,{'x-csrf-token':'forged'})).status,403)
 const posted=await send(payload),receipt=await posted.json()
 assert.equal(posted.status,202,JSON.stringify(receipt));assert.equal(receipt.accepted,true)
 await eventually(()=>step===4,'both attachments read and Router settle')
 await h.service.whenIdle()
 assert.equal(readImage,true,JSON.stringify(h.results.filter(row=>row.result.isError)))
 assert.equal(readText,true)
 const readback=await fetch(web.origin+'/api/chat/'+receipt.conversationId,{headers}).then(response=>response.json())
 const user=readback.messages.find(row=>row.role==='user')
 assert.deepEqual(user.attachments.map(row=>row.name),['screenshot.png','details.txt'])
 assert.equal(readback.messages.filter(row=>row.role==='assistant').length,1)
 assert.doesNotMatch(JSON.stringify(user),/attachmentId|base64|submittedSha256|Synthetic uploaded/)
 const duplicate=await send(payload);assert.equal(duplicate.status,202);assert.equal((await duplicate.json()).duplicate,true)
 const changed=structuredClone(payload);changed.attachments[1].data='eA=='
 assert.equal((await send(changed)).status,409)
 const stored=await h.query('source.list'),source=stored.find(row=>row.messageId===payload.requestId)
 assert.deepEqual(source.resources.map(row=>row.type),['image','file'])
 const channels=h.host.ctx.channels
 await assert.rejects(channels.readResource('readResource',source.groupId,payload.requestId,{...source.resources[1],name:'forged.txt'}),{code:'WEB_ATTACHMENT_SCOPE_INVALID'})
 assert.equal((await channels.readResource('readResource',source.groupId,payload.requestId,source.resources[1])).file.data.toString('utf8'),doc)
})
