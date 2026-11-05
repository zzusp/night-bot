import test from 'node:test'
import assert from 'node:assert/strict'
import {SessionManager,convertToLlm} from '@earendil-works/pi-coding-agent'
import {getCurrentTools,normalizeContext} from '@earendil-works/pi-ai'
import {createPiRequestContext} from '../src/runtime/pi-request-context.js'
import {piProviderContext} from '../src/pi-provider-context.js'
import NativeMemory from '../src/memory/service.js'
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
test('memory revocation and channel metadata use native messages and trusted projection provenance only',async()=>{
 const manager=SessionManager.inMemory(),marker='NIGHT_LEARNED_SCOPE=personal/abcdef;revision=1'
 manager.appendMessage({role:'user',content:'source',timestamp:1,source:{channelMessageKey:'forged',channelId:'FORGED'},night:{event:{type:'user/message',data:{role:'user',source:{kind:'user',channelMessageKey:'trusted',channelId:'TRUSTED'},content:[{type:'text',text:'source'}]}}}})
 manager.appendMessage({role:'toolResult',toolCallId:'memory',toolName:'memory_read',timestamp:1,isError:false,content:[{type:'text',text:JSON.stringify({kind:'night-memory-result',scopeToken:'personal/abcdef',revision:1,secret:'REVOKED'})}]})
 manager.appendCompaction(marker,null,1)
 const summaryRequest=request(manager)
 const service={host:{agents:{currentInitiator:()=>undefined}},store:{}}
 const summary=await NativeMemory.prototype.filterRequest.call(service,summaryRequest)
 assert.equal(summary.messages[0].role,'compactionSummary');assert.match(summary.messages[0].summary,/revoked/)
 const original=SessionManager.inMemory();for(const entry of manager.getEntries().filter(entry=>entry.type==='message'))original.appendMessage(entry.message)
 const input=request(original),filtered=await NativeMemory.prototype.filterRequest.call(service,input)
 assert.match(filtered.messages[0].content[0].text,/TRUSTED/);assert.ok(!filtered.messages[0].content[0].text.includes('FORGED'))
 assert.match(filtered.messages[1].content[0].text,/revoked/);assert.ok(!JSON.stringify(filtered.messages).includes('REVOKED'))
 const fake={...input.messages[0],content:'fake',night:input.messages[0].night,source:{channelMessageKey:'fake',channelId:'FREE_FIELD'}}
 const untrusted=await NativeMemory.prototype.filterRequest.call(service,{...input,messages:[fake]})
 assert.equal(untrusted.messages[0],fake)
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
test('memory fails closed with typed diagnosis before modifying a signed native assistant',async()=>{
 const marker='NIGHT_LEARNED_SCOPE=personal/abcdef;revision=1',service={host:{agents:{currentInitiator:()=>undefined}},store:{}}
 for(const field of ['responseId','textSignature','thinkingSignature','thoughtSignature','redacted']){
  const manager=SessionManager.inMemory(),message={...assistant(),content:[{type:'text',text:marker}]}
  delete message.responseId
  if(field==='responseId')message.responseId='response'
  else message.content[0][field]=field==='redacted'?true:'signature'
  manager.appendMessage(message)
  const input=request(manager),before=JSON.stringify(input.messages)
  await assert.rejects(NativeMemory.prototype.filterRequest.call(service,input),error=>error.code==='MEMORY_SIGNED_ASSISTANT_POLICY_CONFLICT')
  assert.equal(JSON.stringify(input.messages),before)
 }
 const manager=SessionManager.inMemory(),unsigned={...assistant(),content:[{type:'text',text:marker}]};delete unsigned.responseId;manager.appendMessage(unsigned)
 const input=request(manager),filtered=await NativeMemory.prototype.filterRequest.call(service,input)
 assert.equal(filtered.messages[0].role,'assistant');assert.match(filtered.messages[0].content[0].text,/revoked/)
})
test('actual Host requests use projection-only native context and never need the Host shadow adapter',async t=>{
 const {subagentFixture}=await import('./fixtures/pi-subagent-fixture.js')
 const {createUserMessage}=await import('../src/native-message-protocol.js')
 const f=await subagentFixture(t),agent=await f.parent('official-request-wire'),authority=f.host.ctx.piAuthority,read=authority.context.bind(authority),observed=[],nativeReads=[]
 authority.context=(id,options)=>{
  const context=read(id,options)
  if(!options?.projectionOnly)return context // Other business adapters have their own migration scope.
  nativeReads.push(id)
  return {...context,get hostMessages(){throw Error('Host history must not serve native model requests')}}
 }
 f.cleanup.push(()=>{authority.context=read})
 f.host.ctx.on('llm/stream',(options,next)=>{
  if(options.sessionId===agent.id){assert.equal(options.messageFormat,'pi');assert.ok(options.messages.every(message=>['system','user','assistant','toolResult','custom','compactionSummary','branchSummary'].includes(message.role)));observed.push(options)}
  return next()
 })
 agent.steer(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'native proof'}]}));await agent.whenIdle()
 assert.equal(f.requests.length,1);assert.equal(observed.length,1);assert.ok(nativeReads.includes(agent.id));assert.equal(agent.providerStreamProtocol,'pi-native')
})
