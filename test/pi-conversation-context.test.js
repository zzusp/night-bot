import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {queryTaskIndex,queryReplyHistory} from '../src/channels/conversation-context.js'
import {routerTaskProgress} from '../src/channels/router-progress.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools} from './fixtures/resident-router-host.js'

function database(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close())
 for(const name of ['tasks','archived_tasks','source_links','notifications'])db.exec(`CREATE TABLE dynamic_${name}(id TEXT PRIMARY KEY,body TEXT)`)
 const put=(name,id,body)=>db.prepare(`INSERT OR REPLACE INTO dynamic_${name}(id,body) VALUES (?,?)`).run(id,JSON.stringify(body))
 return {db,put}
}
test('task index pages live tasks and directly related terminal archives with conversation isolation',t=>{
 const {db,put}=database(t)
 for(let i=0;i<12;i++)put('tasks','task-'+i,{taskId:'task-'+i,groupId:'a',status:'running',title:'Title',requirementRevision:2,updatedAt:String(i).padStart(2,'0'),request:'PRIVATE_FULL_BODY',requirements:['FULL_REQUIREMENT']})
 put('archived_tasks','done',{taskId:'done',groupId:'a',status:'completed',archivedAt:'old',updatedAt:'99'})
 put('tasks','foreign',{taskId:'foreign',groupId:'b',status:'running',updatedAt:'99'})
 put('source_links','link',{conversationId:'a',taskId:'done',sourceId:'current'})
 const first=queryTaskIndex(db,{conversationId:'a',sourceIds:['current']})
 assert.equal(first.total,13);assert.equal(first.tasks.length,10);assert.equal(first.tasks[0].taskId,'done');assert.equal(first.hasMore,true)
 const next=queryTaskIndex(db,{conversationId:'a',sourceIds:['current'],offset:first.nextOffset})
 assert.equal(next.tasks.length,3);assert.equal(next.hasMore,false)
 assert.doesNotMatch(JSON.stringify([first,next]),/PRIVATE_FULL_BODY|FULL_REQUIREMENT|foreign/)
 assert.equal(queryTaskIndex(db,{conversationId:'a'}).total,12)
})
test('reply keyset query reads current state and complete body without tokens or foreign notices',t=>{
 const {db,put}=database(t),text='frozen '.repeat(100)
 const notice=(id,extra={})=>({id,kind:'router-reply',state:'prepared',payload:{conversationId:'a',sourceId:'source',sourceVersion:2,taskIds:['task'],text},recoveryToken:'PRIVATE_TOKEN',sendPermit:'PRIVATE_PERMIT',...extra})
 put('notifications','n1',notice('n1'));put('notifications','n2',notice('n2'))
 put('notifications','other',notice('other',{payload:{conversationId:'b',sourceId:'source',text:'FOREIGN_BODY'}}))
 const first=queryReplyHistory(db,{conversationId:'a',taskId:'task',limit:1})
 assert.equal(first.replies[0].notificationId,'n2');assert.equal(first.replies[0].truncated,true);assert.ok(first.nextCursor)
 assert.equal(queryReplyHistory(db,{conversationId:'a',sourceId:'source',limit:1,cursor:first.nextCursor}).replies[0].notificationId,'n1')
 put('notifications','n1',notice('n1',{state:'delivered',deliveredAt:'verified-at'}))
 const full=queryReplyHistory(db,{conversationId:'a',notificationId:'n1'})
 assert.equal(full.replies[0].text,text);assert.equal(full.replies[0].state,'delivered')
 assert.doesNotMatch(JSON.stringify(full),/PRIVATE_TOKEN|PRIVATE_PERMIT|FOREIGN_BODY/)
 assert.equal(queryReplyHistory(db,{conversationId:'b',notificationId:'n1'}).replies.length,0)
 assert.throws(()=>queryReplyHistory(db,{conversationId:'a',sourceId:'source',taskId:'task'}),{code:'ROUTER_REPLY_SELECTOR_REQUIRED'})
})

test('real Router reads committed sole-execution progress without waking another run',{timeout:nativeTestTimeout(120000)},async t=>{
 const steps=new Map();let h,checked=false
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(s=>({sourceId:s.sourceId,messageVersion:s.version,needsHandling:true,reason:'Current request'}))}}}
  if(tools.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source,key=source?.messageId??input.events[0].id,step=steps.get(key)??0;steps.set(key,step+1)
   if(source?.messageId==='start'&&step===0)return {tool:'resident_task_plan',args:{operationId:'start',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'context-progress-task',title:'Local verification',objective:'Check the local fixture',requirements:['Use fixture only']}],dependencies:[]}}
   if(source?.messageId==='progress'&&step===0){const system=JSON.stringify(body.messages.filter(message=>message.role==='system'));assert.match(system,/不自动安排业务复测/);assert.match(system,/不得把一般经验、模型建议/);assert.ok(system.includes('taskIndex'));return {tool:'resident_task_query',args:{taskId:'context-progress-task',detail:'progress'}}}
   if(source?.messageId==='progress'&&step===1){const raw=body.messages.at(-1).content;assert.ok(raw.startsWith('{'),raw);const result=JSON.parse(raw);assert.equal(result.coverage,'committed-current-run');assert.ok(result.activities.some(row=>row.toolCalls.some(call=>call.name==='task_result')));checked=true}
   if(body.messages.at(-1)?.role!=='tool'||step<2)return {tool:'resident_router_settle',args:{operationId:'settle-'+key,eventIds:input.events.map(event=>event.id)}}
   return {text:'Committed.'}
  }
  if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Local fixture checked',evidence:['fixture-only'],limitations:[]}}}
  return {text:'Done.'}
 })
 await h.receive(channelMessage('start'));await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:'context-progress-task'});assert.equal(task.status,'completed')
 await h.receive(channelMessage('progress',{text:'查询刚才任务的实际进度'}));await h.service.whenIdle();assert.equal(checked,true)
 const after=await h.query('task.get',{taskId:task.taskId});assert.equal(after.leaseEpoch,task.leaseEpoch);assert.equal(after.runSequence,task.runSequence)
 const missing=await routerTaskProgress({...task,leaseEpoch:task.leaseEpoch+1},{persistence:h.host.ctx.sessionPersistence})
 assert.equal(missing.coverage,'unavailable');assert.equal(missing.reason,'TASK_CURRENT_RUN_HISTORY_UNAVAILABLE')
})


test('real reply tool and quoted-source index use delivered ledger state after cold recovery',{timeout:nativeTestTimeout(90000)},async t=>{
 let h,notice,queried=false
 const steps=new Map()
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Fixture only',...source.messageId==='original'?{reply:'Frozen accepted reply.'}:{}}))}}}
  const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
  if(!source)return {text:'Done.'}
  const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
  if(source.messageId==='lookup'&&step===0){assert.match(JSON.stringify(body.messages.filter(message=>message.role==='system')),/Frozen accepted reply/);return {tool:'resident_reply_query',args:{notificationId:notice.id}}}
  if(source.messageId==='lookup'&&step===1){const raw=body.messages.at(-1).content;assert.ok(raw.startsWith('{'),raw);const result=JSON.parse(raw);assert.equal(result.replies[0].text,'Frozen accepted reply.');assert.equal(result.replies[0].state,'delivered');queried=true}
  if(step<2)return {tool:'resident_router_settle',args:{operationId:'reply-settle-'+source.messageId,eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'handled-inline',reason:'Isolated history lookup only; no business execution requested',sourceQuote:event.source.text}))}}
  return {text:'Done.'}
 })
 await h.receive(channelMessage('original'));await h.service.whenIdle()
 notice=(await h.query('notification.list')).find(row=>row.kind==='triage-reply');assert.equal(notice.state,'delivered')
 await h.restart()
 await h.receive(channelMessage('lookup',{text:'核实此前已回复的内容',quotedMessage:{messageId:'original',senderId:'alice',text:'Original request original'}}));await h.service.whenIdle()
 assert.equal(queried,true);assert.equal(h.sent.length,1,'history lookup never resends the frozen reply')
})
