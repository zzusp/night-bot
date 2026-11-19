import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestText,requestTools,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {hash} from '../src/memory/format.js'
import {STANDING_TOPIC,instructionSources} from '../src/memory/standing-instructions.js'

function currentInstructions(body){
 const system=requestText({...body,messages:body.messages.filter(message=>message.role==='system')}).join('\n')
 const line=system.split('\n').find(line=>line.startsWith('standingInstructions: '))
 return line?JSON.parse(line.slice('standingInstructions: '.length)):[]
}
const initial='以后汇报先给结论，再列关键阻断。',revised='以后汇报先列关键阻断，再给结论。'
test('standing instruction CRUD is source-bound, reloads in Router and cold sessions, and cannot be changed by another author',{timeout:nativeTestTimeout(180000)},async t=>{
 const steps=new Map(),seen=new Set();let h
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
   if(!source)return {text:'No source.'}
   const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
   if(step===0){
    const rules=currentInstructions(body)
    if(['recall','cold','exception','revised'].includes(source.messageId)){assert.equal(rules.length,1);assert.equal(rules[0].text,['exception','revised'].includes(source.messageId)?revised:initial);seen.add('router-'+source.messageId)}
    if(['foreign','gone'].includes(source.messageId)){assert.deepEqual(rules,[]);seen.add('router-'+source.messageId)}
    if(['save','update','foreign-update'].includes(source.messageId))return {tool:'resident_memory_remember',args:{sourceId:source.sourceId,messageVersion:source.version,topic:STANDING_TOPIC,key:'report-style',sourceQuote:source.text,expectedRevision:source.messageId==='save'?0:1,instruction:{text:source.messageId==='save'?initial:revised}}}
    if(source.messageId==='delete')return {tool:'resident_memory_forget',args:{sourceId:source.sourceId,messageVersion:source.version,topic:STANDING_TOPIC,key:'report-style',sourceQuote:source.text,expectedRevision:2}}
   }
   if(step===1&&['save','update','delete','foreign-update'].includes(source.messageId)){
    const result=JSON.parse(body.messages.at(-1).content)
    if(source.messageId==='foreign-update'){assert.equal(result.ok,false);assert.equal(result.code,'MEMORY_INSTRUCTION_SCOPE_FORBIDDEN')}
    else{assert.equal(result.ok,true);assert.equal(result.persisted,true)}
   }
   if(step<2)return {tool:'resident_router_settle',args:{operationId:'settle-'+source.messageId,eventIds:input.events.map(event=>event.id)}}
   return {text:'Committed.'}
  }
  return {text:'Done.'}
 })
 const send=async(id,text='检查当前规则',extra={})=>{await h.receive(channelMessage(id,{text,...extra}));await h.service.whenIdle()}
 await send('save',initial);await send('recall');await h.restart();await send('cold')
 await send('foreign','检查当前规则',{senderId:'bob'});await send('foreign-update',revised,{senderId:'bob'})
 await send('update',revised);await send('revised');await send('exception','本次只给结论，不改长期指令。')
 await send('delete','删除我之前的汇报顺序长期指令。');await send('gone')
 assert.equal(seen.size,6)
 const scope={kind:'bot',id:hash('bot:shared')};assert.equal((await h.host.ctx.memory.store.index(scope,{topic:STANDING_TOPIC})).entries.length,0)
})

test('mixed-source scope selects exact authors and conversations, never an entire batch',()=>{
 const subjects=[{actor:hash('alice'),messageId:'a',conversationId:'room'},{actor:hash('bob'),messageId:'b',conversationId:'room'}]
 assert.deepEqual(instructionSources({kind:'actor',id:hash('alice')},subjects),['a'])
 assert.deepEqual(instructionSources({kind:'conversation',id:'room'},subjects),['a','b'])
 assert.deepEqual(instructionSources({kind:'conversation',id:'other'},subjects),[])
 assert.deepEqual(instructionSources({kind:'bot'},subjects),['a','b'])
})

test('next-batch Router source reloads exact source-scoped instructions',{timeout:nativeTestTimeout(90000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 let held=false,refreshed=false,h
 h=await residentRouterHost(t,async body=>{
  if(!held){held=true;entered.resolve();await release.promise;return {tool:'resident_task_query',args:{detail:'index'}}}
  const rules=currentInstructions(body)
  const admitted=await h.host.ctx.agents.list().find(actor=>actor.metadata.runtimeOwner==='conversation-router')?.admission.current()
  const eventIds=(admitted?.messages??[]).flatMap(packet=>packet.source.eventIds??[])
  const events=(await h.query('router.inbox',{conversationId:h.host.ctx.channels.identity(channelMessage('first')).sessionId})).filter(event=>eventIds.includes(event.id))
  if(events.some(event=>event.source?.messageId==='late')){assert.ok(rules.some(rule=>rule.key==='bob-rule'));refreshed=true}
  if(!events.length)return {text:'Settled.'}
  return {tool:'resident_router_settle',args:{operationId:'steer-'+eventIds.join('-'),eventIds}}
 })
 const scope={kind:'bot',id:hash('bot:shared'),actor:hash('fixture-writer')}
 for(const senderId of ['alice','bob'])await h.host.ctx.memory.store.remember(scope,{topic:STANDING_TOPIC,key:senderId+'-rule',text:'以后保留 '+senderId+' 的限定条件。',expectedRevision:0,instructionScope:{kind:'actor',id:hash(h.host.ctx.channels.identity(channelMessage('seed',{senderId})).principal)},source:{sessionId:'fixture-seed',messageId:senderId}})
 await h.receive(channelMessage('first'));await entered.promise
 await h.receive(channelMessage('late',{senderId:'bob'}))
 await eventually(async()=>(await h.query('router.inbox',{conversationId:h.host.ctx.channels.identity(channelMessage('first')).sessionId})).some(event=>event.source?.messageId==='late'),'late source reaches active Router',t.signal)
 release.resolve();await h.service.whenIdle();assert.equal(refreshed,true)
})
