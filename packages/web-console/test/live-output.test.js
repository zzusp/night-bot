import test from 'node:test'
import assert from 'node:assert/strict'
import {createPiLiveOutputBuffer,bindPiLiveOutput,readPiLiveOutput} from '../../../src/runtime/pi-live-output.js'
import {taskSessionView,visibleLiveText} from '../server/session-view.js'
import {officialToolsFixture} from '../../../test/fixtures/pi-official-tools.js'
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai'
const task={taskId:'task-live',session:{sessionId:'pi-live',sessionBound:true}}
const row=(id,message)=>({sourceEntry:{id,type:'message'},messages:[message]})
const fixture=()=>({header:{id:'pi-live'},entries:[{id:'base'}],audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'task-live',sessionId:'pi-live'}}],context:{projection:{entries:[row('call',{role:'assistant',content:[{type:'toolCall',id:'call',name:'bash',arguments:{command:'echo live'}}]})]}}})
const update=(text,complete=false)=>({type:'message_update',message:{role:'assistant',timestamp:1,content:[{type:'text',text}]},assistantMessageEvent:{type:complete?'text_end':'text_delta',contentIndex:0}})

test('cumulative live redaction buffers short tails and credential-shaped unfinished content',()=>{
 const secret='private-multiline\ncredential-value'
 for(const text of ['key sk-','Bearer abc','{"api_key":"one\nsecond','-----BEGIN PRIVATE KEY-----\nabc','safe\n'+secret.slice(0,18)])assert.equal(visibleLiveText(text,[secret],false),'')
 const prefix='已完成步骤一\n',padding='x'.repeat(600)
 assert.equal(visibleLiveText(prefix+padding,[],false),prefix)
 assert.equal(visibleLiveText('safe\n'+secret+'\n'+padding,[secret],false),'')
 assert.ok(!visibleLiveText('secret='+secret,[secret],true).includes(secret))
 assert.equal(visibleLiveText('短文本',[],false),'')
 assert.equal(visibleLiveText('短文本',[],true),'短文本')
})

test('live snapshot replaces cumulative outputs, preserves official checkpoint and removes completed duplicates',async()=>{
 const snapshot=fixture(),buffer=createPiLiveOutputBuffer('pi-live')
 buffer.accept({type:'agent_start'})
 const persistence={readNative:async()=>snapshot,readLive:()=>buffer.snapshot()}
 const first=await taskSessionView({task,persistence,stream:true})
 assert.equal(first.live.active,true);assert.deepEqual(first.live.items,[])
 buffer.accept(update('第一段\n'))
 let next=await taskSessionView({task,persistence,stream:true,checkpoint:first.checkpoint})
 assert.deepEqual(next.items,[]);assert.equal(next.checkpoint,first.checkpoint)
 assert.equal(next.live.items[0].text,'第一段\n');const stable=next.live.items[0].id
 buffer.accept(update('第一段\n第二段\n'))
 next=await taskSessionView({task,persistence,stream:true,checkpoint:first.checkpoint})
 assert.equal(next.live.items[0].id,stable);assert.equal(next.live.items[0].text,'第一段\n第二段\n')
 buffer.accept({type:'message_end',message:{role:'assistant'}})
 buffer.accept({type:'tool_execution_start',toolCallId:'call',toolName:'bash'})
 buffer.accept({type:'tool_execution_update',toolCallId:'call',toolName:'bash',partialResult:{content:[{type:'text',text:'工具第一行\n'+'x'.repeat(600)}],details:{secret:'NO_DETAILS'}}})
 next=await taskSessionView({task,persistence,stream:true,checkpoint:first.checkpoint})
 assert.equal(next.live.items[0].text,'工具第一行\n');assert.equal(next.live.items[0].callId,first.items[0].callId);assert.equal(next.live.items[0].status,'running');assert.equal(next.live.items[0].transient,true)
 assert.ok(!JSON.stringify(next).includes('NO_DETAILS'))
 snapshot.entries.push({id:'result'});snapshot.context.projection.entries.push(row('result',{role:'toolResult',toolCallId:'call',toolName:'bash',content:[{type:'text',text:'最终输出'}]}))
 buffer.accept({type:'message_end',message:{role:'toolResult',toolCallId:'call'}})
 next=await taskSessionView({task,persistence,stream:true,checkpoint:first.checkpoint})
 assert.equal(next.items.length,1);assert.equal(next.items[0].text,'最终输出');assert.deepEqual(next.live.items,[])
 buffer.accept({type:'agent_end'});assert.equal((await taskSessionView({task,persistence,stream:true})).live.active,false)
})

test('unknown, mismatched, independent memory tools and uncommitted identities never expose live bodies',async()=>{
 const snapshot=fixture(),buffer=createPiLiveOutputBuffer('pi-live')
 buffer.accept({type:'agent_start'})
 for(const [toolCallId,toolName] of [['orphan','bash'],['call','memory_read'],['call','wrong']])buffer.accept({type:'tool_execution_end',toolCallId,toolName,result:{content:[{type:'text',text:'PRIVATE_BODY'}]}})
 const persistence={readNative:async()=>snapshot,readLive:()=>buffer.snapshot()}
 let view=await taskSessionView({task,persistence,stream:true});assert.deepEqual(view.live.items,[])
 persistence.readLive=()=>({...buffer.snapshot(),sessionId:'foreign'});view=await taskSessionView({task,persistence,stream:true});assert.deepEqual(view.live.items,[])
 snapshot.audit=[];await assert.rejects(taskSessionView({task,persistence,stream:true}),{code:'SESSION_IDENTITY_INVALID'})
})

test('raw live buffer has aggregate bounds, idle expiry, immutable reads, and no signature/details copies',()=>{
 let now=0;const buffer=createPiLiveOutputBuffer('pi-live',{clock:()=>now})
 buffer.accept({type:'agent_start'})
 buffer.accept({type:'message_update',message:{role:'assistant',content:Array.from({length:100},()=>({type:'thinking',thinking:'x'.repeat(20000),thinkingSignature:'PRIVATE_SIGNATURE'}))}})
 for(let i=0;i<100;i++)buffer.accept({type:'tool_execution_update',toolCallId:String(i),toolName:'bash',partialResult:{content:[{type:'text',text:'y'.repeat(20000)}],details:{private:'PRIVATE_DETAILS'}}})
 const snapshot=buffer.snapshot(),text=[...snapshot.assistant.message.content.map(b=>b.thinking),...snapshot.tools.flatMap(t=>t.content.map(b=>b.text))].join('')
 assert.ok(text.length<=262144);assert.ok(snapshot.assistant.message.content.length<=64);assert.ok(snapshot.tools.length<=64);assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_'))
 snapshot.assistant.message.content[0].thinking='MUTATED';assert.notEqual(buffer.snapshot().assistant.message.content[0].thinking,'MUTATED')
 now=120001;assert.deepEqual({...buffer.snapshot(),revision:''},{sessionId:'pi-live',active:false,revision:'',assistant:null,tools:[]})
 buffer.close();assert.equal(buffer.snapshot().active,false)
})

test('real official SDK text events provide in-flight snapshot then disappear on native completion',async t=>{
 const f=await officialToolsFixture(t,()=>{}),actor=f.owner,binding=bindPiLiveOutput(actor),release=Promise.withResolvers(),entered=Promise.withResolvers()
 t.after(()=>{release.resolve();binding.close()})
 const model=f.session.agent.state.model
 f.session.agent.streamFunction=()=>{
  const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'text',text:'实际增量输出'}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  queueMicrotask(async()=>{stream.push({type:'start',partial:message});stream.push({type:'text_start',contentIndex:0,partial:message});stream.push({type:'text_delta',contentIndex:0,delta:'实际增量输出',partial:message});stream.push({type:'text_end',contentIndex:0,content:'实际增量输出',partial:message});await new Promise(r=>setTimeout(r,0));entered.resolve();await release.promise;stream.push({type:'done',reason:'stop',message});stream.end(message)})
  return stream
 }
 const running=f.run([]);await entered.promise
 assert.equal(readPiLiveOutput(actor).active,true);assert.equal(readPiLiveOutput(actor).assistant.message.content[0].text,'实际增量输出');assert.equal(readPiLiveOutput(actor).assistant.message.content[0].complete,true)
 release.resolve();await running
 assert.equal(readPiLiveOutput(actor).active,false);assert.equal(readPiLiveOutput(actor).assistant,null)
 binding.close();assert.equal(readPiLiveOutput(actor),null)
})

test('real official SDK tool callback emits partial update before final result',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers()
 const f=await officialToolsFixture(t,()=>{},[{name:'bash',label:'bash',description:'fixture',parameters:{type:'object',properties:{}},async execute(id,args,signal,onUpdate){onUpdate({content:[{type:'text',text:'native partial\n'+'x'.repeat(600)}],details:{private:'NEVER_COPY'}});await new Promise(r=>setTimeout(r,0));entered.resolve();await release.promise;return {content:[{type:'text',text:'native final'}],details:{}}}}]),binding=bindPiLiveOutput(f.owner)
 t.after(()=>{release.resolve();binding.close()})
 const running=f.run([{id:'real-call',name:'bash'}]);await entered.promise
 const live=readPiLiveOutput(f.owner);assert.equal(live.tools[0].toolCallId,'real-call');assert.ok(live.tools[0].content[0].text.startsWith('native partial'));assert.ok(!JSON.stringify(live).includes('NEVER_COPY'))
 release.resolve();await running;assert.deepEqual(readPiLiveOutput(f.owner).tools,[])
})

test('cross-block configured credentials are withheld in live and committed views; invalid identity never reads live',async()=>{
 const snapshot=fixture(),secret='private-credential-value',content=[{type:'text',text:'private-credential-'},{type:'text',text:'value'}]
 snapshot.context.projection.entries.push(row('split',{role:'assistant',content}))
 let reads=0
 const persistence={readNative:async()=>snapshot,readLive:()=>{reads++;return {sessionId:'pi-live',active:true,revision:'1',assistant:{id:'live',message:{role:'assistant',content:content.map(b=>({...b,complete:true}))}},tools:[]}}}
 const view=await taskSessionView({task,persistence,stream:true,secrets:[secret]});assert.ok(!JSON.stringify(view).includes('private-credential-'));assert.deepEqual(view.live.items,[])
 assert.equal(visibleLiveText('private-credential-',[secret],true),'')
 reads=0;snapshot.audit=[];await assert.rejects(taskSessionView({task,persistence,stream:true}),{code:'SESSION_IDENTITY_INVALID'});assert.equal(reads,0)
})

test('short model prose grows before block completion while all structured credential prefixes remain buffered',()=>{
 const live=(s,secrets=[])=>visibleLiveText(s,secrets,false,{shortProse:true})
 assert.equal(live('正在检查'),'正在检查');assert.equal(live('正在检查完整链路'),'正在检查完整链路')
 assert.equal(live('公开中文隐藏前半',['隐藏前半后半']),'公开中文')
 for(const secret of ['https://user:password@host','{"env":{"X":"opaque"}}','{"api_key":"value"}','Authorization: Bearer abc','-----BEGIN PRIVATE KEY-----\nabc','sk-abcdefghijklmn','ghp_abcdefghijklmnopqrst','eyJabc.def.ghi','\\u53e3\\u4ee4']){
  for(let end=1;end<=secret.length;end++)assert.equal(live(secret.slice(0,end)), '',secret.slice(0,end))
 }
 assert.equal(live('English generation'),'')
})

test('native thinking and text deltas expose short cumulative prose with real phases before text_end',async t=>{
 const f=await officialToolsFixture(t,()=>{}),binding=bindPiLiveOutput(f.owner),first=Promise.withResolvers(),next=Promise.withResolvers(),second=Promise.withResolvers(),finish=Promise.withResolvers()
 t.after(()=>{next.resolve();finish.resolve();binding.close()})
 const model=f.session.agent.state.model
 f.session.agent.streamFunction=()=>{
  const stream=createAssistantMessageEventStream(),message={role:'assistant',content:[{type:'thinking',thinking:'正在分析',thinkingSignature:'NO_SIGNATURE'},{type:'thinking',thinking:'NO_HIDDEN',redacted:true}],api:model.api,provider:model.provider,model:model.id,timestamp:1,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}
  queueMicrotask(async()=>{
   stream.push({type:'start',partial:message});stream.push({type:'thinking_delta',contentIndex:0,delta:'正在分析',partial:message});await new Promise(r=>setTimeout(r,0));first.resolve();await next.promise
   message.content[0].thinking='正在分析完整链路';message.content.push({type:'text',text:'已经找到'})
   stream.push({type:'thinking_delta',contentIndex:0,delta:'完整链路',partial:message});stream.push({type:'text_delta',contentIndex:2,delta:'已经找到',partial:message});await new Promise(r=>setTimeout(r,0));second.resolve();await finish.promise
   stream.push({type:'done',reason:'stop',message});stream.end(message)
  });return stream
 }
 const running=f.run([]);await first.promise
 const makeView=async()=>{const snapshot=fixture();snapshot.header.id=f.owner.id;snapshot.audit[0].payload.sessionId=f.owner.id;return taskSessionView({task:{...task,session:{sessionId:f.owner.id,sessionBound:true}},persistence:{readNative:async()=>snapshot,readLive:()=>readPiLiveOutput(f.owner)},stream:true})}
 let view=await makeView();assert.equal(view.live.phase,'thinking');assert.ok(Number.isFinite(Date.parse(view.live.phaseStartedAt)));assert.equal(view.live.items[0].text,'正在分析');assert.ok(!JSON.stringify(view.live).includes('NO_'))
 next.resolve();await second.promise;view=await makeView();assert.equal(view.live.phase,'text');assert.equal(view.live.items[0].text,'正在分析完整链路');assert.equal(view.live.items[1].text,'已经找到');assert.ok(!JSON.stringify(view.live).includes('NO_'))
 finish.resolve();await running;assert.equal(readPiLiveOutput(f.owner).active,false)
})

test('filtered thinking keeps following text identity stable and phases follow native tool completion',async()=>{
 let now=1000;const buffer=createPiLiveOutputBuffer('pi-live',{clock:()=>now}),snapshot=fixture(),persistence={readNative:async()=>snapshot,readLive:()=>buffer.snapshot()}
 buffer.accept({type:'agent_start'});const started=buffer.snapshot().phaseStartedAt
 now=2000;buffer.accept({type:'message_update',message:{role:'assistant',content:[{type:'thinking',thinking:'English pending'},{type:'text',text:'公开正文'}]},assistantMessageEvent:{type:'text_delta',contentIndex:1}})
 let view=await taskSessionView({task,persistence,stream:true});const textId=view.live.items[0].id;assert.equal(view.live.phase,'text');assert.notEqual(view.live.phaseStartedAt,started)
 buffer.accept({type:'message_update',message:{role:'assistant',content:[{type:'thinking',thinking:'已完成思考'},{type:'text',text:'公开正文继续'}]},assistantMessageEvent:{type:'text_delta',contentIndex:1}})
 view=await taskSessionView({task,persistence,stream:true});assert.equal(view.live.items[1].id,textId)
 buffer.accept({type:'tool_execution_start',toolCallId:'one',toolName:'bash'});buffer.accept({type:'tool_execution_start',toolCallId:'two',toolName:'bash'})
 buffer.accept({type:'message_end',message:{role:'toolResult',toolCallId:'one'}});assert.equal(buffer.snapshot().phase,'tool')
 buffer.accept({type:'message_end',message:{role:'toolResult',toolCallId:'two'}});assert.equal(buffer.snapshot().phase,'waiting');buffer.close()
})

test('live tool IDs match nonzero official block positions and reject ambiguous reused pending IDs',async()=>{
 const snapshot=fixture(),buffer=createPiLiveOutputBuffer('pi-live')
 snapshot.context.projection.entries[0].messages[0].content.unshift({type:'text',text:'先核对材料'})
 buffer.accept({type:'agent_start'});buffer.accept({type:'tool_execution_start',toolCallId:'call',toolName:'bash'})
 buffer.accept({type:'tool_execution_update',toolCallId:'call',toolName:'bash',partialResult:{content:[{type:'text',text:'授权输出\n'+'x'.repeat(600)}]}})
 const persistence={readNative:async()=>snapshot,readLive:()=>buffer.snapshot()}
 let view=await taskSessionView({task,persistence,stream:true})
 assert.equal(view.live.items[0].callId,view.items.find(item=>item.kind==='tool-call').callId)
 snapshot.context.projection.entries.push(row('duplicate',{role:'assistant',content:[{type:'toolCall',id:'call',name:'bash',arguments:{command:'echo duplicate'}}]}))
 view=await taskSessionView({task,persistence,stream:true});assert.deepEqual(view.live.items,[])
 snapshot.context.projection.entries.splice(1,0,row('settled',{role:'toolResult',toolCallId:'call',toolName:'bash',content:[{type:'text',text:'此前调用已结束'}]}))
 view=await taskSessionView({task,persistence,stream:true})
 assert.equal(view.live.items[0].callId,view.items.filter(item=>item.kind==='tool-call').at(-1).callId)
})
