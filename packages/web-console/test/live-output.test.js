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
 buffer.accept(update('第一段\n'+'x'.repeat(600)))
 let next=await taskSessionView({task,persistence,stream:true,checkpoint:first.checkpoint})
 assert.deepEqual(next.items,[]);assert.equal(next.checkpoint,first.checkpoint)
 assert.equal(next.live.items[0].text,'第一段\n');const stable=next.live.items[0].id
 buffer.accept(update('第一段\n第二段\n'+'x'.repeat(600)))
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
