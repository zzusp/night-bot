import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionManager,convertToLlm} from '@earendil-works/pi-coding-agent'
import {createPiRequestContext} from '../src/runtime/pi-request-context.js'
const profile={maxRequestImageBytes:10000,requestImagePixelBudget:100,requestImageMaxBytes:1000},model={api:'openai-responses',input:['text','image']},ctx={get:()=>undefined}
const usage={input:0,output:0,totalTokens:0,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}}
const assistant=()=>({role:'assistant',provider:'fixture',model:'m',api:'openai-responses',responseId:'native-response',timestamp:1,stopReason:'stop',usage,content:[{type:'text',text:'native output',textSignature:'native-signature'}]})
function request(manager,extra={}){return {...createPiRequestContext({context(){const projection=manager.buildSessionProjection();return {projection,piMessages:projection.messages}}},'official-test'),...extra}}
test('memory revocation and channel metadata use official entries and durable admission provenance only',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),f=await memoryHost(t),memory=f.host.ctx.memory
 const handle=await f.agent('official-memory-source',{actorId:'context-person'}),actor=handle.agent,manager=handle.session.sessionManager
 const ports=memory.official({authorizeWrite:()=>false,isLive:current=>current===actor&&f.host.ctx.agents.get(current.id)===current})
 ports.bindActor(actor)
 try{
  const marker='NIGHT_LEARNED_SCOPE=personal/abcdef;revision=1',packet={id:'trusted-input',source:{kind:'user',channelMessageKey:'trusted',channelType:'chat',channelId:'TRUSTED',conversationId:'conversation',senderId:'context-person'},content:[{type:'text',text:'source'}]}
  await actor.input.enqueue(packet)
  await handle.session.sendCustomMessage({customType:'night.business-input',content:packet.content,display:false,details:{packetId:packet.id,source:packet.source}},{triggerTurn:false})
  const delivery=await actor.input.deliver(packet.id,{deliverAs:'followUp'})
  assert.equal(delivery.duplicate,true,'the public durable delivery port acknowledges the existing official entry without redelivery')
  assert.ok((await actor.receipts.read()).some(receipt=>receipt.domain==='admission'&&receipt.kind==='admitted'&&receipt.payload.id===packet.id))
  manager.appendMessage({role:'toolResult',toolCallId:'memory',toolName:'memory_read',timestamp:1,isError:false,content:[{type:'text',text:JSON.stringify({kind:'night-memory-result',scopeToken:'personal/abcdef',revision:1,secret:'REVOKED'})}]})
  manager.appendMessage({role:'user',content:'native free fields are not channel authority',timestamp:1,source:{channelMessageKey:'forged',channelId:'FORGED'}})
  const input=request(manager),filtered=await ports.filter(actor,input)
  assert.equal(filtered.messages[0].role,'custom');assert.match(filtered.messages[0].content[0].text,/TRUSTED/);assert.ok(!filtered.messages[0].content[0].text.includes('FORGED'))
  assert.match(filtered.messages[1].content[0].text,/revoked/);assert.ok(!JSON.stringify(filtered.messages).includes('REVOKED'))
  assert.equal(filtered.messages[2],input.messages[2],'a provider-native free source field cannot acquire channel authority')
  const fake={...input.messages[0],content:'fake',source:{channelMessageKey:'fake',channelId:'FREE_FIELD'}}
  const untrusted=await ports.filter(actor,{...input,messages:[fake]})
  assert.equal(untrusted.messages[0],fake,'copied message details cannot copy request-local official provenance')
  const unauthorizedId=manager.appendCustomMessageEntry('night.business-input','unadmitted',false,{packetId:'not-admitted',source:packet.source})
  const unauthorized=request(manager),unadmitted=unauthorized.messages.find(message=>message.role==='custom'&&message.details.packetId==='not-admitted')
  const checked=await ports.filter(actor,unauthorized)
  assert.equal(checked.messages.find(message=>message.details?.packetId==='not-admitted'),unadmitted,'a native entry without a durable authorized packet is not source authority')
  manager.appendContextEdit(unauthorizedId,null)
  manager.appendCompaction(marker,null,1)
  const summary=await ports.filter(actor,request(manager))
  assert.equal(summary.messages[0].role,'compactionSummary');assert.match(summary.messages[0].summary,/revoked/)
  assert.equal(f.requests.length,0,'the direct policy check does not dispatch a model')
 }finally{await handle.dispose()}
})
test('memory fails closed with typed diagnosis before modifying a signed native assistant',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),f=await memoryHost(t),memory=f.host.ctx.memory
 const marker='NIGHT_LEARNED_SCOPE=personal/abcdef;revision=1'
 for(const field of ['responseId','textSignature','thinkingSignature','thoughtSignature','redacted']){
  const handle=await f.agent('official-signed-'+field,{actorId:'context-person'}),actor=handle.agent,manager=handle.session.sessionManager
  const ports=memory.official({authorizeWrite:()=>false,isLive:current=>current===actor&&f.host.ctx.agents.get(current.id)===current});ports.bindActor(actor)
  try{
   const message={...assistant(),content:[{type:'text',text:marker}]};delete message.responseId
   if(field==='responseId')message.responseId='response'
   else message.content[0][field]=field==='redacted'?true:'signature'
   manager.appendMessage(message)
   const input=request(manager),before=JSON.stringify(input.messages)
   await assert.rejects(ports.filter(actor,input),error=>error.code==='MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT')
   assert.equal(JSON.stringify(input.messages),before,'the official signed entry is never rewritten: '+field)
  }finally{await handle.dispose()}
 }
 const handle=await f.agent('official-unsigned-memory',{actorId:'context-person'}),actor=handle.agent,manager=handle.session.sessionManager
 const ports=memory.official({authorizeWrite:()=>false,isLive:current=>current===actor&&f.host.ctx.agents.get(current.id)===current});ports.bindActor(actor)
 try{
  const unsigned={...assistant(),content:[{type:'text',text:marker}]};delete unsigned.responseId;manager.appendMessage(unsigned)
  const input=request(manager),filtered=await ports.filter(actor,input)
  assert.equal(filtered.messages[0].role,'assistant');assert.match(filtered.messages[0].content[0].text,/revoked/)
  assert.equal(input.messages[0].content[0].text,marker,'request policy does not mutate original official history')
  assert.equal(f.requests.length,0)
 }finally{await handle.dispose()}
})
test('actual Host requests use official AgentSession context and never call a Host history adapter',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js')
 const {AgentSession}=await import('@earendil-works/pi-coding-agent')
 const f=await memoryHost(t),authority=f.host.ctx.piAuthority,read=authority.context
 authority.context=()=>{throw Error('Host history must not serve official model requests')}
 let legacyStreams=0
 f.host.ctx.on('llm/stream',()=>{legacyStreams++;throw Error('Legacy stream must not serve official model requests')})
 try{
  const handle=await f.agent('official-request-wire')
  await f.say(handle.agent,'native proof')
  assert.equal(f.requests.length,1);assert.equal(legacyStreams,0)
  assert.ok(handle.session instanceof AgentSession)
  assert.ok(handle.session.messages.every(message=>['system','user','assistant','toolResult','custom','compactionSummary','branchSummary'].includes(message.role)))
  assert.ok(handle.session.sessionManager.getEntries().some(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input'))
 }finally{authority.context=read}
})
