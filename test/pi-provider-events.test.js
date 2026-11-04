import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {observePiEvents,capturePiReplay,classifyPiFailure} from '../src/pi-provider-events.js'
import {restorePiReplay} from '../src/pi-replay.js'
import {resolvePiProfiles,configuredPiModels} from '../src/pi-provider-catalog.js'
const usage={input:2,output:3,cacheRead:0,cacheWrite:0,totalTokens:5,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
const message=(extra={})=>({role:'assistant',api:'openai-completions',provider:'fixture',model:'m',timestamp:1,content:[{type:'text',text:'ACTUAL'}],usage,stopReason:'stop',...extra})
async function* source(events){yield* events}
test('native events retain identity and produce one-way ordered audit without altering model output',async()=>{
 const final=message(),events=[{type:'start',partial:final},{type:'text_start',contentIndex:0,partial:final},{type:'text_delta',contentIndex:0,delta:'ACTUAL',partial:final},{type:'text_end',contentIndex:0,content:'ACTUAL',partial:final},{type:'done',reason:'stop',message:final}],audit=[]
 const stream=observePiEvents(source(events),{model:'m',onChunk:e=>audit.push(e)}),received=[];for await(const event of stream)received.push(event)
 assert.equal(received[2],events[2]);assert.equal((await stream.result()).content,final.content);assert.deepEqual(audit.map(e=>e.type),['block-start','text-delta','block-end','usage','finish']);assert.equal(audit.at(-1).replayState.response.api,'openai-completions')
})
test('native terminal metadata roundtrips through durable replay',()=>{
 const original=message({content:[{type:'thinking',thinking:'reason',thinkingSignature:'signed',redacted:false},{type:'toolCall',id:'call',name:'read',arguments:{path:'a'},thoughtSignature:'tool-signature',namespace:'ns'}],stopReason:'toolUse',responseId:'response'})
 const restored=restorePiReplay({...original,api:'host',content:original.content.map(({thinkingSignature,redacted,thoughtSignature,namespace,...b})=>b)},{provider:original.provider,model:original.model,replayState:capturePiReplay(original)})
 assert.deepEqual(restored.content,original.content);assert.equal(restored.responseId,'response')
})
for(const [stopReason,errorMessage,code]of [['stop',undefined,'EMPTY_RESPONSE'],['error','HTTP 401','AUTH'],['error','429 rate limit','RATE_LIMIT'],['error','insufficient_quota','QUOTA'],['error','400 invalid request','INVALID_REQUEST'],['error','413 payload too large','CONTEXT_WINDOW_EXCEEDED'],['error','HTTP 503','SERVER'],['error','connection closed','TRANSPORT'],['error','maximum context length exceeded','CONTEXT_WINDOW_EXCEEDED'],['pending',undefined,'PI_AI_ERROR'],['deferred',undefined,'PI_AI_ERROR']])test('native failure classification '+code+': '+stopReason,()=>assert.equal(classifyPiFailure(message({stopReason,errorMessage,content:[]})).code,code))
test('idle timeout, caller abort, closed source and audit failure always settle the native stream',async()=>{
 const stuck=()=>({[Symbol.asyncIterator](){return{next:()=>new Promise(()=>{}),return:async()=>({done:true})}}}),audit=[]
 const timeout=observePiEvents(stuck(),{idleTimeoutMs:5,onChunk:e=>audit.push(e)});assert.equal((await timeout.result())._hostFailure.code,'TIMEOUT');assert.equal(audit.at(-1).reason.failure.code,'TIMEOUT')
 const controller=new AbortController(),aborted=observePiEvents(stuck(),{signal:controller.signal,idleTimeoutMs:500});controller.abort();assert.equal((await aborted.result()).stopReason,'aborted')
 assert.equal((await observePiEvents(source([])).result())._hostFailure.code,'STREAM_CLOSED')
 const broken=observePiEvents(source([{type:'done',reason:'stop',message:message()}]),{onChunk:()=>{throw new Error('audit failed')}});assert.equal((await broken.result())._hostFailure.code,'PI_AUDIT_FAILED')
})
test('native Pi Models sends a real local wire request without DSH provider or stream translation',async t=>{
 let body
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'native-response',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{role:'assistant',content:'NATIVE_WIRE'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'native-response',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const profiles=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,models:[{id:'m'}]}}),models=configuredPiModels(profiles),model=models.getModel('fixture','m')
 const upstream=models.streamSimple(model,{messages:[{role:'user',content:'ACTUAL_NATIVE_INPUT',timestamp:1}]},{apiKey:'isolated-local-fixture',maxRetries:0})
 const output=await observePiEvents(upstream,{provider:'fixture',model:'m',contextWindow:model.contextWindow}).result()
 assert.equal(output.stopReason,'stop');assert.equal(output.content[0].text,'NATIVE_WIRE');assert.ok(body.messages.some(m=>m.content==='ACTUAL_NATIVE_INPUT'));assert.equal(body.model,'m')
})

test('quota and request-rate failures retain distinct recovery categories',()=>{
 for(const detail of ['insufficient balance','quota exhausted','usage-limit reached','exceeded your current quota','credits depleted','out of budget'])assert.equal(classifyPiFailure(message({stopReason:'error',errorMessage:detail})).code,'QUOTA',detail)
 for(const detail of ['429 tokens per minute','429 request quota rate limit'])assert.equal(classifyPiFailure(message({stopReason:'error',errorMessage:detail})).code,'RATE_LIMIT',detail)
 assert.equal(classifyPiFailure(message({stopReason:'error',errorMessage:'Unable to read context length setting'})).code,'PI_AI_ERROR')
})
test('provider overflow wording supported by the existing recovery boundary stays classified as context overflow',()=>{
 for(const detail of ['context_length_exceeded','context_window_limit_exceeded','maximum allowed context length is 100','request is too large for this model context','input too long for the model','request exceeds the model context window'])assert.equal(classifyPiFailure(message({stopReason:'error',errorMessage:detail})).code,'CONTEXT_WINDOW_EXCEEDED',detail)
})
