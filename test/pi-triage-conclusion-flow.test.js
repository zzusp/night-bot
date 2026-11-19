import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'

test('real Host carries reply-free explicit/uncertain handoffs; Router branches through original matching/verification, restart never replays',{timeout:nativeTestTimeout(60000)},async t=>{
 const seen=[],steps=new Map()
 const h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){
   const input=requestEnvelope(body,'一级分诊请求：')
   return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:source.messageId!=='silent',reason:'Synthetic current-batch triage',handoff:{assignment:source.messageId==='uncertain'?'uncertain':'explicit',summary:source.messageId==='uncertain'?'受话对象未清，核对原引用。':'明确只读查询，先匹配既有事项。'}}))}}
  }
  if(tools.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),key=input.events.map(e=>e.id).join(','),step=steps.get(key)??0;steps.set(key,step+1)
   if(step===0){
    const event=input.events.find(e=>e.source),prompt=requestText(body).join('\n')
    seen.push(structuredClone(event));assert.match(prompt,/不逐条重新分诊/);assert.match(prompt,/不是用户原话、权限或投递\/建任务证据/)
    assert.equal(event.triageReply,undefined);assert.equal(event.source.quote.text,'原始引用：请先核对对象，不执行写操作。')
    return event.triageConclusion.assignment==='explicit'?{tool:'resident_task_query',args:{limit:10}}:{tool:'resident_source_get',args:{sourceId:event.sourceId}}
   }
   if(step===1)return {tool:'resident_router_settle',args:{operationId:'settle:'+key,eventIds:input.events.map(e=>e.id)}}
   return {text:'Synthetic read-only disposition committed'}
  }
  return {text:'No other synthetic work'}
 })
 const messages=['explicit','uncertain','silent'].map(messageId=>channelMessage(messageId,{text:'合成请求 '+messageId,quotedMessage:{messageId:'original-quote',senderId:'bob',text:'原始引用：请先核对对象，不执行写操作。'}}))
 for(const message of messages){await h.receive(message);await h.service.whenIdle()}
 assert.deepEqual(seen.map(e=>e.triageConclusion.assignment),['explicit','uncertain'])
 assert.ok(h.results.some(r=>r.name==='resident_task_query'));assert.ok(h.results.some(r=>r.name==='resident_source_get'))
 assert.equal(h.sent.length,0);assert.equal((await h.query('task.list')).length,0)
 const before=h.requests.length;await h.restart();for(const message of messages)await h.receive(message);await h.service.whenIdle()
 assert.equal(h.requests.length,before);assert.equal(seen.length,2);assert.equal(h.sent.length,0)
 for(const row of await h.query('router.list'))assert.deepEqual(await h.query('router.inbox',{conversationId:row.id}),[])
})
