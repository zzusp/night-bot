import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {NativePiProvider} from '../src/native-pi-provider.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {nativeExecutionStream} from '../src/pi-native-stream.js'
import {createLiveAttempt} from './fixtures/pi-live-attempt.js'
import {piAuthentication} from '../src/pi-provider-auth.js'
for(const api of ['anthropic-messages','openai-responses'])test('native provider uses real local '+api+' protocol with auth, usage and replay',async t=>{
 let received
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;received={path:req.url,headers:req.headers,body:JSON.parse(raw)};res.writeHead(200,{'content-type':'text/event-stream'})
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n')
  if(api==='anthropic-messages'){
   send('message_start',{message:{id:'msg_fixture',type:'message',role:'assistant',model:'m',content:[],usage:{input_tokens:2,output_tokens:0}}});send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'NATIVE_PROTOCOL'}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:3}});send('message_stop',{})
  }else{
   send('response.created',{response:{id:'resp_fixture',model:'m',status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{id:'item_fixture',type:'message',role:'assistant',content:[],status:'in_progress'}});send('response.content_part.added',{item_id:'item_fixture',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:'item_fixture',output_index:0,content_index:0,delta:'NATIVE_PROTOCOL'});send('response.output_text.done',{item_id:'item_fixture',output_index:0,content_index:0,text:'NATIVE_PROTOCOL'});send('response.output_item.done',{output_index:0,item:{id:'item_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'NATIVE_PROTOCOL',annotations:[]}]}});send('response.completed',{response:{id:'resp_fixture',model:'m',status:'completed',output:[],usage:{input_tokens:2,output_tokens:3,total_tokens:5,input_tokens_details:{cached_tokens:0}}}})
  }
  res.end()
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const profiles=resolvePiProfiles({fixture:{api,baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'FIXTURE_KEY',headers:{'x-profile':'retained'},models:[{id:'m',maxTokens:256}]}}),auth=piAuthentication({getEnvironment:name=>name==='FIXTURE_KEY'?'isolated-fixture-key':undefined}),adapter=new NativePiProvider({get:()=>undefined},()=>profiles,auth)
 const request={provider:'fixture',model:'m',messages:[{role:'user',source:{kind:'user'},content:[{type:'text',text:'ACTUAL_INPUT'}]}]},chunks=[];const output=nativeExecutionStream(()=>(async function*(){for await(const chunk of adapter.stream(request)){chunks.push(chunk);yield chunk}})(),request,createLiveAttempt());const native=await output.result();assert.equal(native._hostNative,true);assert.equal(native.api,api);assert.equal(native.content[0].text,'NATIVE_PROTOCOL')
 assert.equal(chunks.at(-1).reason.kind,'stop',JSON.stringify(chunks.at(-1)));assert.ok(chunks.some(c=>c.type==='text-delta'&&c.text==='NATIVE_PROTOCOL'));assert.equal(chunks.at(-1).replayState.response.api,api);assert.equal(chunks.find(c=>c.type==='usage').usage.outputTokens,3);assert.equal(received.headers['x-profile'],'retained');assert.ok(received.headers['user-agent']);assert.ok(JSON.stringify(received.body).includes('ACTUAL_INPUT'));assert.equal(api==='anthropic-messages'?received.headers['x-api-key']:received.headers.authorization,api==='anthropic-messages'?'isolated-fixture-key':'Bearer isolated-fixture-key')
})
test('a direct native adapter call cannot send images to a text-only model or bypass a missing credential',async()=>{
 const profiles=resolvePiProfiles({fixture:{api:'openai-completions',baseURL:'https://invalid.example/v1',models:[{id:'m'}]}}),ctx={get:()=>{throw new Error('must refuse before attachment access')}},adapter=new NativePiProvider(ctx,()=>profiles,piAuthentication({getEnvironment:()=>undefined})),request={provider:'fixture',model:'m',messages:[{role:'user',content:[{type:'image',attachment:{attachmentId:'not-read'}}]}]}
 await assert.rejects(async()=>{for await(const chunk of adapter.stream(request))void chunk},e=>e.code==='UNSUPPORTED_CONTENT')
 const protectedProfiles=resolvePiProfiles({fixture:{api:'openai-completions',apiKeyEnv:'MISSING_KEY',baseURL:'https://invalid.example/v1',models:[{id:'m'}]}}),protectedAdapter=new NativePiProvider(ctx,()=>protectedProfiles,piAuthentication({getEnvironment:()=>undefined}))
 await assert.rejects(async()=>{for await(const chunk of protectedAdapter.stream({...request,messages:[]}))void chunk},e=>e.code==='MISSING_CREDENTIAL')
})
test('a prepared native call binds one profile generation while subsequent calls adopt the new endpoint',async t=>{
 const paths=[],server=createServer(async(req,res)=>{for await(const _ of req){}paths.push(req.url);res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'snapshot-fixture',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{role:'assistant',content:'snapshot'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'snapshot-fixture',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const route=path=>resolvePiProfiles({fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_KEY',baseURL:`http://127.0.0.1:${server.address().port}/${path}/v1`,models:[{id:'m'}]}});let profiles=route('old');const adapter=new NativePiProvider({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=> 'local-only-fixture'})),prepared=await adapter.prepareCall('fixture','m');profiles=route('new');const request={provider:'fixture',model:'m',messages:[{role:'user',content:[{type:'text',text:'actual'}]}]};for await(const _ of prepared.stream(request)){}for await(const _ of adapter.stream(request)){}assert.deepEqual(paths,['/old/v1/chat/completions','/new/v1/chat/completions'])
})
