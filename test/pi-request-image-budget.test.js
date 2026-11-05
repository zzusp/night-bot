import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createAgentSession,SessionManager,SettingsManager,DefaultResourceLoader} from '@earendil-works/pi-coding-agent'
import {OfficialPiModelRuntime} from '../src/pi-official-model-runtime.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {piAuthentication} from '../src/pi-provider-auth.js'
import {limitPiRequestImages,bindPiRequestImageBudget} from '../src/runtime/pi-request-image-budget.js'
const limits={requestImagePixelBudget:128,requestImageMaxBytes:1000,maxRequestImageBytes:10000},model={input:['text','image']}
const image=async()=>({type:'image',mimeType:'image/png',data:(await sharp({create:{width:32,height:16,channels:3,background:'#4488cc'}}).png().toBuffer()).toString('base64')})
test('request derivatives retain native history, signed text and original attachments',async()=>{
 const block=Object.freeze(await image()),signed=Object.freeze({role:'assistant',responseId:'response',content:Object.freeze([{type:'text',text:'signed',textSignature:'signature'}])}),summary=Object.freeze({role:'compactionSummary',summary:'official summary'}),user=Object.freeze({role:'user',content:Object.freeze([block]),timestamp:1}),messages=Object.freeze([summary,signed,user])
 const result=await limitPiRequestImages(messages,{model,limits}),output=result.messages[2].content[0],metadata=await sharp(Buffer.from(output.data,'base64')).metadata()
 assert.ok(metadata.width*metadata.height<=128);assert.ok(Buffer.from(output.data,'base64').length<=1000);assert.notEqual(output.data,block.data);assert.equal(result.messages[0],summary);assert.equal(result.messages[1],signed);assert.equal(user.content[0],block);assert.equal((await sharp(Buffer.from(block.data,'base64')).metadata()).width,32)
})
test('aggregate counts every native image occurrence and refuses malformed or unsupported requests',async()=>{
 const block=await image(),one=await limitPiRequestImages([{role:'user',content:[block]}],{model,limits})
 await assert.rejects(limitPiRequestImages([{role:'toolResult',content:[block,block]}],{model,limits:{...limits,maxRequestImageBytes:one.usage.base64Bytes*2-1}}),{code:'IMAGE_OFFLOAD_REQUIRED'})
 await assert.rejects(limitPiRequestImages([{role:'user',content:[block]}],{model:{input:['text']},limits}),{code:'PI_REQUEST_MODEL_IMAGE_UNSUPPORTED'})
 await assert.rejects(limitPiRequestImages([{role:'user',content:[{...block,data:'not base64'}]}],{model,limits}),{code:'PI_REQUEST_IMAGE_DATA_INVALID'})
 await assert.rejects(limitPiRequestImages([{role:'assistant',responseId:'signed',content:[block]}],{model,limits}),{code:'PI_SIGNED_ASSISTANT_IMAGE_POLICY_CONFLICT'})
 const abort=new AbortController();abort.abort();await assert.rejects(limitPiRequestImages([{role:'user',content:[block]}],{model,limits,signal:abort.signal}),{name:'AbortError'})
})
test('real official SDK dispatches bounded wire derivatives and gates aggregate before HTTP',async t=>{
 const requests=[],server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(JSON.parse(body));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'image-budget',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{role:'assistant',content:'ok'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r))})
 const root=await mkdtemp(join(tmpdir(),'night-image-budget-')),agentDir=join(root,'agent');await mkdir(agentDir);t.after(()=>rm(root,{recursive:true,force:true}))
 const profiles=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'KEY',models:[{id:'m',input:['text','image'],contextWindow:8192,maxTokens:64}]}},{deferred:true}),runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=> 'fixture'})),resolved=await runtime.resolve({provider:'fixture',model:'m'})
 const settings=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,disabledBuiltinExtensions:['mcp'],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload()
 const manager=SessionManager.inMemory(root),{session}=await createAgentSession({cwd:root,agentDir,modelRuntime:resolved.modelRuntime,model:resolved.model,settingsManager:settings,resourceLoader:loader,sessionManager:manager,noTools:'all'});t.after(()=>session.dispose())
 let policy=limits;const binding=bindPiRequestImageBudget({session,getLimits:()=>policy});t.after(()=>binding.close());const original=await image()
 await session.prompt('inspect',{images:[original]});assert.equal(binding.failure,undefined);assert.equal(requests.length,1)
 const wire=requests[0].messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='image_url'),data=wire.image_url.url.split(',')[1],metadata=await sharp(Buffer.from(data,'base64')).metadata();assert.ok(metadata.width*metadata.height<=128);assert.ok(Buffer.from(data,'base64').length<=1000)
 assert.ok(manager.getEntries().some(e=>e.type==='message'&&e.message.role==='user'&&e.message.content.some(b=>b.type==='image'&&b.data===original.data)))
 policy={...limits,maxRequestImageBytes:1};await session.prompt('must not dispatch').catch(()=>{});assert.equal(requests.length,1);assert.equal(binding.failure?.code,'IMAGE_OFFLOAD_REQUIRED')
 policy=limits;binding.close();const signedMessage={role:'assistant',responseId:'native-signed',content:[{type:'text',text:'signed diagnostic',textSignature:'opaque-signature'},original]};session.agent.transformContext=async()=>[signedMessage];const signedBinding=bindPiRequestImageBudget({session,getLimits:()=>policy});t.after(()=>signedBinding.close());await session.prompt('signed image conflict').catch(()=>{});assert.equal(requests.length,1);assert.equal(signedBinding.failure?.code,'PI_SIGNED_ASSISTANT_IMAGE_POLICY_CONFLICT');assert.equal(signedMessage.responseId,'native-signed');assert.equal(signedMessage.content[0].textSignature,'opaque-signature')
})
