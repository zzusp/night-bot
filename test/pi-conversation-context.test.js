import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {queryTaskIndex,queryReplyHistory} from '../src/channels/conversation-context.js'
import {routerTaskProgress} from '../src/channels/router-progress.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,eventually} from './fixtures/resident-router-host.js'

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

test('reply history includes requester questions and task status without exposing operator or foreign notices',t=>{
 const {db,put}=database(t)
 for(const [id,kind] of [['question','question'],['status','status']])put('notifications',id,{id,kind,taskId:'task',state:'delivered',deliveredAt:'verified-at',
  payload:{conversationId:'a',sourceId:'source',sourceVersion:1,audience:'requester',text:'Please provide the page address.'}})
 put('notifications','operator',{id:'operator',kind:'question',taskId:'task',state:'delivered',payload:{audience:'operator',recipientUserId:'operator',text:'PRIVATE_OPERATOR_QUESTION'}})
 put('notifications','foreign',{id:'foreign',kind:'question',taskId:'foreign-task',state:'delivered',payload:{conversationId:'b',sourceId:'source',text:'FOREIGN_QUESTION'}})
 for(const selector of [{taskId:'task'},{sourceId:'source'}]){
  const result=queryReplyHistory(db,{conversationId:'a',...selector})
  assert.deepEqual(result.replies.map(reply=>reply.notificationId),['status','question'])
  assert.ok(result.replies.every(reply=>reply.state==='delivered'&&reply.deliveredAt==='verified-at'))
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_OPERATOR_QUESTION|FOREIGN_QUESTION/)
 }
 assert.equal(queryReplyHistory(db,{conversationId:'a',notificationId:'question'}).replies[0].text,'Please provide the page address.')
 assert.equal(queryReplyHistory(db,{conversationId:'a',notificationId:'operator'}).replies.length,0)
 put('notifications','question',{id:'question',kind:'question',taskId:'task',state:'unknown',payload:{conversationId:'a',sourceId:'source',text:'Please provide the page address.'}})
 assert.equal(queryReplyHistory(db,{conversationId:'a',notificationId:'question'}).replies[0].state,'unknown')
})

test('real Router reads committed sole-execution progress without waking another run',{timeout:nativeTestTimeout(120000)},async t=>{
 const steps=new Map();let h,checked=false,forwarded=false
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(JSON.stringify(body).includes('NIGHT_ROUTER_TASK_LOOKUP。')){
   const parsed=JSON.parse(body.messages.findLast(message=>message.role==='user').content)
   assert.equal(parsed.tasks[0].progress.coverage,'committed-current-run')
   checked=true
   return {text:'{"summary":"Local fixture checked","limitations":[]}'}
  }
  if(tools.includes('channel_triage_submit')){const input=requestEnvelope(body,'一级分诊请求：');return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(s=>({sourceId:s.sourceId,messageVersion:s.version,needsHandling:true,reason:'Current request'}))}}}
  if(tools.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source,key=source?.messageId??input.events[0].id,step=steps.get(key)??0;steps.set(key,step+1)
   if(source?.messageId==='start'&&step===0)return {tool:'resident_task_plan',args:{operationId:'start',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'context-progress-task',handoff:'Verify the local fixture only.',title:'Local verification',objective:'Check the local fixture',requirements:['Use fixture only']}],dependencies:[]}}
   if(source?.messageId==='progress'&&step===0){const system=JSON.stringify(body.messages.filter(message=>message.role==='system'));assert.match(system,/不自动安排业务复测/);assert.match(system,/不得把一般经验、模型建议/);assert.ok(system.includes('taskIndex'));return {tool:'resident_task_lookup_async',args:{operationId:'context-progress',sourceId:source.sourceId,messageVersion:source.version,taskIds:['context-progress-task']}}}
   if(source?.messageId==='progress'&&step===1){const value=JSON.parse(body.messages.at(-1).content);return {tool:'resident_router_settle',args:{operationId:'settle-progress-accepted',eventIds:input.events.map(event=>event.id),noTaskDispositions:[{eventId:input.events.find(event=>event.source?.messageId==='progress').id,outcome:'async-query',lookupId:value.lookupId,sourceQuote:source.text,reason:'Delegated'}]}}}
   const result=input.events.find(event=>event.kind==='router.lookup.completed')
   if(result){assert.equal(result.lookupResult.snapshots,undefined);forwarded=result.lookupResult.summary==='Local fixture checked'}
   if(body.messages.at(-1)?.role!=='tool'||step<2)return {tool:'resident_router_settle',args:{operationId:'settle-'+key,eventIds:input.events.map(event=>event.id)}}
   return {text:'Committed.'}
  }
  if(tools.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Local fixture checked',evidence:['fixture-only'],limitations:[]}}}
  return {text:'Done.'}
 })
 await h.receive(channelMessage('start'));await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:'context-progress-task'});assert.equal(task.status,'completed')
 await h.receive(channelMessage('progress',{text:'查询刚才任务的实际进度'}));await eventually(()=>forwarded,'lookup result reaches Router',t.signal);await h.service.whenIdle();assert.equal(checked,true)
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
  if(source.messageId==='original'&&step===0)return {tool:'resident_router_reply',args:{operationId:'frozen-original',sourceId:source.sourceId,messageVersion:source.version,text:'Frozen accepted reply.'}}
  if(source.messageId==='lookup'&&step===0){assert.match(JSON.stringify(body.messages.filter(message=>message.role==='system')),/Frozen accepted reply/);return {tool:'resident_reply_query',args:{notificationId:notice.id}}}
  if(source.messageId==='lookup'&&step===1){const raw=body.messages.at(-1).content;assert.ok(raw.startsWith('{'),raw);const result=JSON.parse(raw);assert.equal(result.replies[0].text,'Frozen accepted reply.');assert.equal(result.replies[0].state,'delivered');queried=true}
  if(step<2)return {tool:'resident_router_settle',args:{operationId:'reply-settle-'+source.messageId,eventIds:input.events.map(event=>event.id),noTaskDispositions:input.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'context-only',reason:'Isolated history lookup only; no business execution requested',sourceQuote:event.source.text}))}}
  return {text:'Done.'}
 })
 await h.receive(channelMessage('original'));await h.service.whenIdle()
 notice=(await h.query('notification.list')).find(row=>row.kind==='router-reply');assert.equal(notice.state,'delivered')
 await h.restart()
 await h.receive(channelMessage('lookup',{text:'核实此前已回复的内容',quotedMessage:{messageId:'original',senderId:'alice',text:'Original request original'}}));await h.service.whenIdle()
 assert.equal(queried,true);assert.equal(h.sent.length,1,'history lookup never resends the frozen reply')
})


test('execution cannot send a requester question; a valid wait is stored as an internal round result',{timeout:nativeTestTimeout(30000)},async t=>{
 const steps=new Map(),question='Please provide the exact page address.'
 const internalResult={action:'wait',summary:'The fixture does not contain the exact address.',evidence:['The local input has no address.'],limitations:['The page was not checked.']}
 let h,resultCalls=0,validationResult
 h=await residentRouterHost(t,body=>{
  const tools=requestTools(body)
  if(tools.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source,key=input.events.map(event=>event.id).join(','),step=steps.get(key)??0;steps.set(key,step+1)
   if(source?.messageId==='ask'&&step===0)return {tool:'resident_task_plan',args:{operationId:'ask',sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'requester-question',handoff:'Inspect the local page using the fixture.',title:'Inspect local page',objective:'Inspect the local fixture',requirements:[]}],dependencies:[]}}
   if(step<2)return {tool:'resident_router_settle',args:{operationId:'settle-'+key,eventIds:input.events.map(event=>event.id)}}
   return {text:'Settled.'}
  }
  if(tools.includes('task_result')){
   if(resultCalls++===0)return {tool:'task_result',args:{decision:{...internalResult,question,audience:'requester'}}}
   if(resultCalls===2){validationResult=body.messages.findLast(message=>message.role==='tool');return {tool:'task_result',args:{decision:internalResult}}}
   return {text:'No more work.'}
  }
  return {text:'Done.'}
 })
 await h.receive(channelMessage('ask'));await h.service.whenIdle()
 assert.ok(validationResult)
 const rejection=JSON.stringify(validationResult.content)
 assert.match(rejection,/decision\.question[^;]*unknown field/u)
 assert.match(rejection,/decision\.audience[^;]*unknown field/u)
 assert.equal(resultCalls,2)
 const read=()=>h.query('task.get',{taskId:'requester-question'})
 const task=await read()
 // The round is finished, but its business result is still wait. The
 // current Host stores ordinary results under completion, not lastDecision.
 assert.equal(task.status,'completed');assert.equal(task.drained,true)
 assert.equal(task.completion.summary,internalResult.summary)
 assert.deepEqual(task.completion.result,internalResult)
 assert.equal(task.humanRequests?.length??0,0);assert.equal(h.sent.length,0)
 assert.equal((await h.query('notification.list')).some(row=>row.kind==='question'),false)
 await h.restart();await h.service.whenIdle()
 assert.deepEqual((await read()).completion.result,internalResult)
 assert.equal(h.sent.length,0)
 assert.equal((await h.query('notification.list')).some(row=>row.kind==='question'),false)
})
