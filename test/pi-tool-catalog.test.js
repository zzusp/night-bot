import test from 'node:test'
import assert from 'node:assert/strict'
import {getCurrentTools,normalizeContext} from '@earendil-works/pi-ai'
import {piToolCatalog} from '../src/runtime/pi-tool-catalog.js'
import {piProviderContext} from '../src/pi-provider-context.js'
const tool=(name,extra={})=>({name,description:name,parameters:{type:'object',properties:{}},...extra})
const dev=(id,...content)=>({id,role:'developer',content})
const add=toolName=>({type:'tool-addition',toolName}),remove=toolName=>({type:'tool-removal',toolName})
const replay=catalog=>getCurrentTools([{role:'system',content:'',toolsAdded:catalog.tools},...[...catalog.updates.values()].flat()])
const a=tool('a'),b=tool('b'),deferred=tool('deferred',{deferLoading:true})
const history={tools:[a,deferred],updates:[{messageId:'add',additions:[b]},{messageId:'remove',additions:[]},{messageId:'readd',additions:[a]}]}
const messages=[dev('add',add('b'),add('b'),add('deferred')),dev('remove',remove('a'),remove('a')),dev('readd',add('a'))]
test('in-history routes use Pi deltas for deferred additions, duplicate suppression and historical removal/re-add',()=>{
 const before=JSON.stringify({messages,history})
 const catalog=piToolCatalog(messages,[a,b,deferred],'in-history',history)
 assert.deepEqual(catalog.tools,[a]);assert.equal(catalog.updates.get('add').length,2)
 assert.deepEqual(catalog.updates.get('remove')[0].toolsRemoved,[{name:'a'}])
 assert.deepEqual(replay(catalog).map(t=>t.name),['b','deferred','a'])
 assert.equal(JSON.stringify({messages,history}),before)
 catalog.tools[0].parameters.properties.changed={type:'string'};assert.deepEqual(a.parameters.properties,{})
})
test('addition-only routes prune no-longer-active declarations and never emit removal operations',()=>{
 const catalog=piToolCatalog(messages,[b,deferred],'addition-only',history)
 assert.deepEqual(catalog.tools,[])
 assert.deepEqual(replay(catalog).map(t=>t.name),['b','deferred'])
 assert.ok([...catalog.updates.values()].flat().every(update=>!update.toolsRemoved.length))
})
test('unsupported, missing-history and auxiliary-prefix requests offer only current eligible schemas',()=>{
 const tools=[a,deferred]
 assert.deepEqual(piToolCatalog(messages,tools,undefined,history).tools,[a,tool('deferred')])
 for(const catalog of [piToolCatalog(messages,tools,'in-history'),piToolCatalog(messages.slice(1),tools,'in-history',history)]){
  assert.deepEqual(catalog.tools,[a]);assert.equal(catalog.updates.size,0)
 }
})
test('ordered operations within one message and schema changes use actual Pi replay semantics',()=>{
 const changed=tool('a',{description:'new schema'}),message=dev('ordered',add('a'),remove('a'),add('a'))
 const catalog=piToolCatalog([message],[changed],'in-history',{tools:[a],updates:[{messageId:'ordered',additions:[changed]}]})
 assert.deepEqual(catalog.updates.get('ordered').map(delta=>[delta.toolsAdded.map(t=>t.name),delta.toolsRemoved.map(t=>t.name)]),[[['a'],['a']],[[],['a']],[['a'],[]]])
 assert.deepEqual(replay(catalog),[changed])
})
test('provider projection preserves signed assistant replay while resolving tool schemas from historical additions',async()=>{
 const {capturePiReplay}=await import('../src/pi-provider-events.js')
 const native={role:'assistant',provider:'fixture',model:'m',api:'openai-responses',responseId:'signed-response',stopReason:'stop',content:[{type:'text',text:'signed',textSignature:'signature'}]}
 const assistant={role:'assistant',source:{provider:'fixture',model:'m',replayState:capturePiReplay(native)},content:[{type:'text',text:'signed'}]}
 const context=await piProviderContext({messages:[{role:'user',content:[{type:'text',text:'hello'}]},dev('add',add('b')),assistant],tools:[b],toolHistory:{tools:[],updates:[{messageId:'add',additions:[b]}]}},
  {profile:{},model:{input:['text'],api:'openai-responses'},ctx:{get:()=>undefined},alreadyProjected:true,toolUpdate:'addition-only'})
 assert.equal(context.messages.at(-1).responseId,'signed-response');assert.equal(context.messages.at(-1).content[0].textSignature,'signature')
 assert.deepEqual(getCurrentTools(normalizeContext(context).messages),[b]);assert.equal(assistant.content[0].textSignature,undefined)
})
test('actual pinned Pi transports encode addition-only and in-history catalog changes on local wire',async t=>{
 const {createServer}=await import('node:http')
 const {resolvePiProfiles,configuredPiModels}=await import('../src/pi-provider-catalog.js')
 const {piConversationUpdates}=await import('../src/native-pi-provider.js')
 const requests=[]
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw))
  res.writeHead(200,{'content-type':'text/event-stream'})
  if(req.url.includes('messages')){
   const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n')
   send('message_start',{message:{id:'wire-anthropic',type:'message',role:'assistant',model:'m',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}})
   send('content_block_start',{index:0,content_block:{type:'text',text:''}})
   send('content_block_delta',{index:0,delta:{type:'text_delta',text:'wire verified'}})
   send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}});send('message_stop',{});res.end()
  }else{
   for(const [delta,finish_reason]of [[{role:'assistant',content:'wire verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'wire-openai',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
   res.end('data: [DONE]\n\n')
  }
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 for(const api of ['openai-completions','anthropic-messages']){
  const baseURL=`http://127.0.0.1:${server.address().port}`+(api==='openai-completions'?'/v1':'')
  const profiles=resolvePiProfiles({fixture:{api,baseURL,models:[{id:'m'}]}})
  const models=configuredPiModels(profiles),model={...models.getModel('fixture','m'),compat:{supportsMidConvoSystemMessages:true,...api==='openai-completions'?{supportsMidConvoToolAdditions:true}:{supportsMidConvoToolChanges:true}}}
  const request={messages:[{role:'user',content:[{type:'text',text:'before changes'}]},dev('add',add('b')),dev('remove',remove('a')),{role:'assistant',source:{provider:'fixture',model:'m'},content:[{type:'text',text:'catalog accepted'}]},{role:'user',content:[{type:'text',text:'after changes'}]}],tools:[b],toolHistory:{tools:[a],updates:[{messageId:'add',additions:[b]},{messageId:'remove',additions:[]}]}}
  const context=await piProviderContext(request,{profile:profiles.get('fixture'),model,ctx:{get:()=>undefined},alreadyProjected:true,toolUpdate:piConversationUpdates(model).toolUpdate})
  const output=await models.streamSimple(model,context,{apiKey:'local-fixture-only',maxRetries:0}).result()
  assert.equal(output.stopReason,'stop',output.errorMessage);assert.equal(output.content[0].text,'wire verified')
  const wire=requests.at(-1)
  const before=wire.messages.findIndex(message=>JSON.stringify(message).includes('before changes'))
  const after=wire.messages.findIndex(message=>JSON.stringify(message).includes('after changes'))
  const addition=wire.messages.findIndex(message=>api==='openai-completions'?message.tools?.some(item=>item.function.name==='b'):Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_addition'&&block.tool.definition.name==='b'))
  assert.ok(before>=0&&addition>before&&after>addition,'tool declaration remains between the original conversation steps: '+api)
  if(api==='openai-completions'){
   assert.ok(wire.messages.some(message=>message.role==='system'&&message.tools?.some(item=>item.function.name==='b')))
   assert.ok(!(wire.tools??[]).some(item=>item.function.name==='a'))
  }else{
   assert.ok(wire.tools.some(item=>item.name==='a'))
   assert.ok(wire.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_addition'&&block.tool.definition.name==='b')))
   assert.ok(wire.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_removal'&&block.tool.name==='a')))
  }
 }
 assert.equal(requests.length,2)
})
test('Anthropic empty baseline still enables native historical additions without reviving removed tools',async()=>{
 const context=await piProviderContext({messages:[{role:'user',content:[{type:'text',text:'start'}]},dev('add',add('b')),dev('remove',remove('b'))],tools:[],toolHistory:{tools:[],updates:[{messageId:'add',additions:[b]},{messageId:'remove',additions:[]}]}},
  {profile:{},model:{input:['text'],api:'anthropic-messages'},ctx:{get:()=>undefined},alreadyProjected:true,toolUpdate:'in-history'})
 assert.deepEqual(context.tools.map(tool=>tool.name),['DeferredToolPlaceholder'])
 assert.ok(context.messages.some(message=>message.toolsAdded?.some(tool=>tool.name==='b')))
 assert.ok(context.messages.some(message=>message.toolsRemoved?.some(tool=>tool.name==='b')))
 assert.equal(getCurrentTools(normalizeContext(context).messages).some(tool=>tool.name==='b'),false)
 assert.throws(()=>piToolCatalog([],[], 'unknown'),TypeError)
})
