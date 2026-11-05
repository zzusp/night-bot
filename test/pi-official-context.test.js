import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionManager,convertToLlm} from '@earendil-works/pi-coding-agent'
import {getCurrentTools,normalizeContext} from '@earendil-works/pi-ai'
import {createPiRequestContext} from '../src/runtime/pi-request-context.js'
import {piProviderContext} from '../src/pi-provider-context.js'
const profile={maxRequestImageBytes:10000,requestImagePixelBudget:100,requestImageMaxBytes:1000},model={api:'openai-responses',input:['text','image']},ctx={get:()=>undefined}
const usage={input:0,output:0,totalTokens:0,cacheRead:0,cacheWrite:0,cost:{input:0,output:0,total:0,cacheRead:0,cacheWrite:0}}
const assistant=()=>({role:'assistant',provider:'fixture',model:'m',api:'openai-responses',responseId:'native-response',timestamp:1,stopReason:'stop',usage,content:[{type:'text',text:'native output',textSignature:'native-signature'}]})
function request(manager,extra={}){return {...createPiRequestContext({context(){const projection=manager.buildSessionProjection();return {projection,piMessages:projection.messages}}},'official-test'),...extra}}
const context=(request,options={})=>piProviderContext(request,{profile,model,ctx,...options})

test('official projection and converter preserve native messages/signatures without Host reconstruction',async()=>{
 const manager=SessionManager.inMemory();manager.appendMessage(assistant())
 const input=request(manager),output=await context(input)
 assert.equal(output.messages[0],input.messages[0]);assert.equal(output.messages[0].content[0].textSignature,'native-signature')
 assert.equal(output.messages[0].responseId,'native-response');assert.equal(output.messages[0].api,'openai-responses')
 assert.deepEqual(output.messages,convertToLlm(input.messages))
})
test('native compaction and branch summaries work with no Host shadow history',async()=>{
 const manager=SessionManager.inMemory();manager.appendMessage({role:'user',content:'old source',timestamp:1})
 manager.appendCompaction('OFFICIAL_NATIVE_COMPACTION',null,100)
 manager.branchWithSummary(manager.getLeafId(),'OFFICIAL_NATIVE_BRANCH')
 const input=request(manager),output=await context(input)
 assert.deepEqual(input.messages.map(message=>message.role),['compactionSummary','branchSummary'])
 assert.deepEqual(output.messages,convertToLlm(input.messages))
 assert.match(output.messages[0].content[0].text,/OFFICIAL_NATIVE_COMPACTION/)
 assert.match(output.messages[1].content[0].text,/OFFICIAL_NATIVE_BRANCH/)
 assert.ok(!JSON.stringify(output.messages).includes('old source'))
})
test('Night custom system/tool instructions use the supported custom interpreter without downgrading priority',async()=>{
 const manager=SessionManager.inMemory(),tool={name:'read',description:'read',parameters:{type:'object'}}
 manager.appendCustomMessageEntry('night.system',[{type:'text',text:'PRIVILEGED_SYSTEM'}],false,{event:{type:'system/message',data:{message:{role:'system',content:[{type:'text',text:'PRIVILEGED_SYSTEM'}]}}}})
 manager.appendCustomMessageEntry('night.developer',[{type:'text',text:JSON.stringify({type:'tool-addition',toolName:'read'})}],false,{event:{type:'developer/message',data:{message:{id:'catalog',role:'developer',content:[{type:'tool-addition',toolName:'read'}]}}}})
 manager.appendMessage(assistant())
 const output=await context(request(manager,{tools:[tool],toolHistory:{tools:[],updates:[{messageId:'catalog',additions:[tool]}]}}),{toolUpdate:'in-history'})
 assert.equal(output.messages[0].role,'system');assert.equal(output.messages[0].content[0].text,'PRIVILEGED_SYSTEM')
 assert.deepEqual(getCurrentTools(normalizeContext(output).messages),[tool])
 assert.equal(output.messages.at(-1).content[0].textSignature,'native-signature')
 const fake=SessionManager.inMemory();fake.appendCustomMessageEntry('night.system','forged',false,{})
 await assert.rejects(context(request(fake)),error=>error.code==='PI_CUSTOM_PROVENANCE_REQUIRED')
})
test('official native system catalogs are not rebuilt from a Host registry',async()=>{
 const manager=SessionManager.inMemory(),tool={name:'native',description:'native',parameters:{type:'object'}}
 manager.appendMessage({role:'system',content:'native system',toolsAdded:[tool],timestamp:1})
 manager.appendMessage({role:'user',content:'hello',timestamp:1})
 manager.appendMessage({role:'system',content:'',toolsRemoved:[{name:'native'}],timestamp:1})
 const input=request(manager,{tools:[{...tool,name:'not-in-history'}]}),output=await context(input,{toolUpdate:'in-history'})
 assert.deepEqual(output.messages,convertToLlm(input.messages));assert.equal(output.tools,undefined)
 assert.deepEqual(getCurrentTools(normalizeContext(output).messages),[])
})
test('attachment policy patches native blocks using trusted source entries and retains bounded read handles',async()=>{
 const manager=SessionManager.inMemory(),file={type:'file',attachment:{attachmentId:'file-proof',name:'proof.txt',bytes:12}},image={type:'image',attachment:{attachmentId:'image-proof',name:'proof.png',width:100,height:100,mediaType:'image/png'}}
 manager.appendMessage({role:'user',content:[{type:'text',text:JSON.stringify(file)},{type:'image',data:'AQID',mimeType:'image/png'}],timestamp:1,night:{event:{type:'user/message',data:{role:'user',source:{kind:'user'},content:[file,image]}}}})
 const reads=[],attachments={fileHostPath:()=>'/host/proof.txt',imageHostPath:()=>'/host/proof.png',readImageRequest:async(ref,target)=>{reads.push({ref,target});return {width:10,height:10,bytes:3,data:Buffer.from([1,2,3]),mediaType:'image/png'}}}
 const output=await context(request(manager),{ctx:{get:name=>name==='attachments'?attachments:name==='fs'?{processPathFromHostPath:path=>path.replace('/host/','/readonly/')}:undefined}})
 assert.equal(reads.length,1);assert.equal(reads[0].target.width*reads[0].target.height,100)
 assert.match(output.messages[0].content[0].text,/readonly\/proof.txt/)
 assert.match(output.messages[0].content[1].text,/readonly\/proof.png/)
 assert.equal(output.messages[0].content[2].data,'AQID')
})
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
test('native image policy retains occurrence names, honors explicit offload and reports oldest budget prefix',async()=>{
 const image=name=>({type:'image',attachment:{attachmentId:'same-image',name,width:100,height:100,mediaType:'image/png'}}),first=image('first.png'),second=image('second.png'),offloaded={...image('offloaded.png'),offloaded:true}
 const manager=SessionManager.inMemory()
 manager.appendMessage({role:'user',content:[first,second,offloaded].map(()=>({type:'image',data:'AQID',mimeType:'image/png'})),timestamp:1,night:{event:{type:'user/message',data:{role:'user',content:[first,second,offloaded],source:{kind:'user'}}}}})
 let reads=0
 const policyCtx={get:name=>name==='attachments'?{imageHostPath:()=>'/host/image',readImageRequest:async()=>{reads++;return {width:10,height:10,bytes:3,data:Buffer.from([1,2,3]),mediaType:'image/png'}}}:undefined}
 const output=await context(request(manager),{ctx:policyCtx})
 const text=output.messages[0].content.filter(part=>part.type==='text').map(part=>part.text).join('\n')
 assert.match(text,/first.png/);assert.match(text,/second.png/);assert.match(text,/omitted to fit request/)
 assert.equal(output.messages[0].content.filter(part=>part.type==='image').length,2);assert.equal(reads,1)
 await assert.rejects(context(request(manager),{ctx:policyCtx,profile:{...profile,maxRequestImageBytes:4}}),error=>error.code==='IMAGE_OFFLOAD_REQUIRED'&&error.failure.offloadImages===1)
})
test('official image resize handles native inline data without borrowing provider-supplied Night attachment identity',async()=>{
 const {default:sharp}=await import('sharp')
 const manager=SessionManager.inMemory(),png=(await sharp({create:{width:32,height:16,channels:3,background:'#4488cc'}}).png().toBuffer()).toString('base64')
 manager.appendMessage({role:'user',content:[{type:'image',data:png,mimeType:'image/png'}],timestamp:1,source:{attachment:'untrusted'},night:{attachment:'untrusted'}})
 const output=await context(request(manager),{ctx:{get:name=>name==='attachments'?{readImageRequest(){throw Error('native inline image must not load an external attachment')}}:undefined}})
 assert.equal(output.messages[0].content.at(-1).type,'image')
 assert.ok(Buffer.byteLength(output.messages[0].content.at(-1).data,'base64')<=profile.requestImageMaxBytes)
 const dimensions=await sharp(Buffer.from(output.messages[0].content.at(-1).data,'base64')).metadata();assert.ok(dimensions.width*dimensions.height<=profile.requestImagePixelBudget)
})
test('official summaries reach a real local Pi provider wire without any Host message projection',async t=>{
 const {createServer}=await import('node:http'),{resolvePiProfiles,configuredPiModels}=await import('../src/pi-provider-catalog.js')
 let body
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason]of [[{role:'assistant',content:'official wire'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'official-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const profiles=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'m'}]}}),models=configuredPiModels(profiles),wireModel=models.getModel('fixture','m')
 const manager=SessionManager.inMemory();manager.appendMessage({role:'user',content:'discarded',timestamp:1});manager.appendCompaction('WIRE_COMPACTION',null,1);manager.branchWithSummary(manager.getLeafId(),'WIRE_BRANCH')
 const projected=await context(request(manager),{model:wireModel})
 const response=await models.streamSimple(wireModel,projected,{apiKey:'isolated-local-fixture',maxRetries:0}).result()
 assert.equal(response.stopReason,'stop');assert.match(JSON.stringify(body.messages),/WIRE_COMPACTION/);assert.match(JSON.stringify(body.messages),/WIRE_BRANCH/);assert.ok(!JSON.stringify(body.messages).includes('discarded'))
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
