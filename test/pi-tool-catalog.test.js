import test from 'node:test'
import assert from 'node:assert/strict'
import {getCurrentTools,normalizeContext} from '@earendil-works/pi-ai'
import {convertToLlm} from '@earendil-works/pi-coding-agent'
import {catalogSession,catalogTool,usage} from './fixtures/pi-tool-catalog-official.js'
const current=context=>getCurrentTools(normalizeContext(context).messages)

test('official AgentSession loadout deduplicates names, ignores unknown tools and applies removal/re-add on the next request',async t=>{
 const h=await catalogSession(t),before=JSON.stringify(h.tools)
 await h.session.prompt('before changes')
 h.session.setActiveToolsByName(['b','b','not-registered']);assert.deepEqual(h.session.getActiveToolNames(),['b'])
 await h.session.prompt('after removal')
 h.session.setActiveToolsByName(['a','b']);await h.session.prompt('after re-add')
 assert.deepEqual(h.requests.map(request=>current(request).map(tool=>tool.name)),[['a'],['b'],['b','a']])
 assert.equal(JSON.stringify(h.tools),before)
 assert.deepEqual(h.manager.buildSessionProjection().messages.filter(message=>message.role==='user').map(message=>message.content[0].text),['before changes','after removal','after re-add'])
})
test('official empty loadout never revives historical tools or invents a placeholder',async t=>{
 const h=await catalogSession(t)
 await h.session.prompt('tool initially available');h.session.setActiveToolsByName([]);await h.session.prompt('no tools admitted')
 assert.deepEqual(h.session.getActiveToolNames(),[]);assert.deepEqual(current(h.requests.at(-1)),[])
 assert.ok(!JSON.stringify(current(h.requests.at(-1))).includes('DeferredToolPlaceholder'))
 h.session.setActiveToolsByName(['b']);await h.session.prompt('one newly admitted tool')
 assert.deepEqual(current(h.requests.at(-1)).map(tool=>tool.name),['b'])
})
test('official tool schema sent to model matches its registered active schema and leaves unrelated definitions unchanged',async t=>{
 const tools=[catalogTool('a'),catalogTool('b')];tools[1].description='CURRENT REGISTERED SCHEMA';tools[1].parameters.properties.value.enum=['allowed']
 const before=structuredClone(tools.map(({execute,...tool})=>tool)),h=await catalogSession(t,{tools,active:['b']})
 await h.session.prompt('use current schema')
 const declarations=current(h.requests[0]);assert.equal(declarations.length,1);assert.equal(declarations[0].description,'CURRENT REGISTERED SCHEMA');assert.deepEqual(declarations[0].parameters.properties.value.enum,['allowed'])
 assert.deepEqual(tools.map(({execute,...tool})=>tool),before)
})
test('official execution rejects a hallucinated removed tool without running its registered body',async t=>{
 let effects=0
 const a={...catalogTool('a'),async execute(){effects++;return {content:[{type:'text',text:'unexpected effect'}],details:{}}}}
 const h=await catalogSession(t,{tools:[a,catalogTool('b')],active:['b'],reply:(_context,index)=>index===0?{content:[{type:'toolCall',id:'removed-call',name:'a',arguments:{}}],stopReason:'toolUse'}:{}})
 await h.session.prompt('only b is admitted')
 assert.equal(effects,0)
 const result=h.manager.buildSessionProjection().messages.find(message=>message.role==='toolResult'&&message.toolCallId==='removed-call')
 assert.equal(result.isError,true)
 assert.deepEqual(current(h.requests[0]).map(tool=>tool.name),['b'])
})
test('native signed assistant replay survives official SessionManager, converter and SDK requests with catalog changes',async t=>{
 const native={role:'assistant',provider:'catalog-fixture',model:'m',api:'openai-completions',responseId:'signed-response',stopReason:'stop',content:[{type:'text',text:'signed',textSignature:'original-signature'}],usage,timestamp:1}
 const original=structuredClone(native),h=await catalogSession(t,{prepare:manager=>{manager.appendMessage({role:'user',content:[{type:'text',text:'hello'}],timestamp:0});manager.appendMessage(native)}})
 h.session.setActiveToolsByName(['b']);await h.session.prompt('continue signed history')
 const replay=h.requests[0].messages.find(message=>message.role==='assistant'&&message.responseId==='signed-response')
 assert.equal(replay.content[0].textSignature,'original-signature');assert.deepEqual(native,original)
 assert.equal(convertToLlm(h.manager.buildSessionProjection().messages).find(message=>message.responseId==='signed-response').content[0].textSignature,'original-signature')
 assert.deepEqual(current(h.requests[0]).map(tool=>tool.name),['b'])
})

test('actual official SDK OpenAI and Anthropic transports keep current catalogs and original conversation order on local wire',async t=>{
 const {createServer}=await import('node:http'),{OfficialPiModelRuntime}=await import('../src/pi-official-model-runtime.js'),{resolvePiProfiles}=await import('../src/pi-provider-catalog.js'),{piAuthentication}=await import('../src/pi-provider-auth.js')
 const requests=[],server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'})
  if(req.url.includes('messages')){
   const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n')
   send('message_start',{message:{id:'wire-anthropic',type:'message',role:'assistant',model:'m',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'wire verified'}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}});send('message_stop',{});res.end()
  }else{
   for(const [delta,finish_reason]of [[{role:'assistant',content:'wire verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'wire-openai',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
   res.end('data: [DONE]\n\n')
  }
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 for(const api of ['openai-completions','anthropic-messages'])await t.test(api,async t=>{
  const baseURL=`http://127.0.0.1:${server.address().port}`+(api==='openai-completions'?'/v1':'')
  const profiles=resolvePiProfiles({fixture:{api,baseURL,apiKeyEnv:'LOCAL_CATALOG_KEY',models:[{id:'m',contextWindow:8192,maxTokens:64}]}}),runtime=new OfficialPiModelRuntime({get:()=>undefined},()=>profiles,piAuthentication({getEnvironment:()=> 'local-fixture-only'}));t.after(()=>runtime.close())
  const resolved=await runtime.resolve({provider:'fixture',model:'m'}),h=await catalogSession(t,{resolved})
  await h.session.prompt('before catalog changes');h.session.setActiveToolsByName(['b']);await h.session.prompt('after catalog changes')
  const wire=requests.at(-1),declarations=wire.tools??[]
  assert.deepEqual(declarations.map(item=>item.function?.name??item.name),['b'])
  const before=wire.messages.findIndex(message=>JSON.stringify(message).includes('before catalog changes')),after=wire.messages.findIndex(message=>JSON.stringify(message).includes('after catalog changes'))
  assert.ok(before>=0&&after>before);assert.equal(h.session.messages.at(-1).content[0].text,'wire verified')
  h.session.setActiveToolsByName([]);await h.session.prompt('catalog now empty')
  assert.deepEqual(requests.at(-1).tools??[],[])
 })
 assert.equal(requests.length,6)
})
