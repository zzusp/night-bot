import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {OfficialPiModelRuntime} from '../src/pi-official-model-runtime.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {piAuthentication} from '../src/pi-provider-auth.js'
for(const api of ['anthropic-messages','openai-responses'])test('official runtime uses real local '+api+' protocol with auth and native usage',async t=>{
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
 const profiles=resolvePiProfiles({fixture:{api,baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'FIXTURE_KEY',headers:{'x-profile':'retained'},models:[{id:'m',maxTokens:256}]}}),auth=piAuthentication({getEnvironment:name=>name==='FIXTURE_KEY'?'isolated-fixture-key':undefined}),runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,auth)
 const resolved=await runtime.resolve({provider:'fixture',model:'m'}),native=await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'ACTUAL_INPUT',timestamp:1}]},resolved.requestOptions).result()
 assert.equal(native.api,api);assert.equal(native.content[0].text,'NATIVE_PROTOCOL')
 assert.equal(native.stopReason,'stop');assert.equal(native.usage.output,3);assert.equal(received.headers['x-profile'],'retained');assert.ok(received.headers['user-agent']);assert.ok(JSON.stringify(received.body).includes('ACTUAL_INPUT'));assert.equal(api==='anthropic-messages'?received.headers['x-api-key']:received.headers.authorization,api==='anthropic-messages'?'isolated-fixture-key':'Bearer isolated-fixture-key')
 await runtime.close()

})
test('official runtime refuses missing configured credentials before network dispatch',async()=>{
 const profiles=resolvePiProfiles({fixture:{api:'openai-completions',apiKeyEnv:'MISSING_KEY',baseURL:'http://127.0.0.1:1/v1',models:[{id:'m'}]}}),runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=>undefined}))
 const resolved=await runtime.resolve({provider:'fixture',model:'m'}),result=await resolved.modelRuntime.streamSimple(resolved.model,{messages:[{role:'user',content:'no credentials',timestamp:1}]},resolved.requestOptions).result()
 assert.equal(result.stopReason,'error');assert.match(result.errorMessage,/credential|MISSING_KEY/i)
 await runtime.close()
})
