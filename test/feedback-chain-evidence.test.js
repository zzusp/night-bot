import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import NativeSchedule from '../src/native-schedule.js'
import NativeAgents from '../src/native-agents.js'
import {openNativeDomains} from '../src/native-domain.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {diagnosticQueryFailure} from '../src/feedback/diagnostic-contract.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createChainEvidence} from '../src/feedback/chain-evidence.js'
const at=n=>new Date(1700000000000+n).toISOString()
function fixture({duplicate=false,missing=false,persistence}={}){
 const source={sourceId:'private-source',groupId:'private-room',messageId:'private-message',version:2,text:'原消息首答很慢',timestamp:at(-100),receivedAt:at(0),stages:[{stage:'router',startedAt:at(100),completedAt:at(900),shared:true}]}
 const notice={id:'private-notice',state:'delivered',createdAt:at(1000),sendStartedAt:at(1100),deliveredAt:at(1200),payload:{conversationId:source.groupId,sourceId:source.sourceId,sourceVersion:2,sourceMessageId:source.messageId,text:'SECRET_REPLY'}}
 const calls=[]
 const tasks={
  listObserverGroups:()=>[{groupId:source.groupId,name:'PRIVATE_NAME'}],
  observerGroupPage:async()=>({items:[{messageId:source.messageId,messageVersion:2,text:source.text},...(duplicate?[{messageId:'other',messageVersion:2,text:source.text}]:[])],nextOffset:null}),
  store:{query:async q=>{calls.push(q);if(q.kind==='task.list')return [];if(q.kind==='source.get')return q.sourceId===source.sourceId?source:null;if(q.kind==='observer.message-contexts')return {sources:[source,...(duplicate?[{...source,sourceId:'other-source',messageId:'other'}]:[])],notifications:missing?[]:[notice],taskReplySources:[]};if(q.kind==='router.source-status')return {triage:{state:'committed',decision:{needsHandling:true,reply:'SECRET'}},event:{state:'consumed',consumedAt:at(950)}};if(q.kind==='router.source-links')return [{taskId:'private-task',sourceId:source.sourceId,messageVersion:2,conversationId:source.groupId},{taskId:'unrelated',sourceId:source.sourceId,messageVersion:1,conversationId:source.groupId}];if(q.kind==='task.get')return {taskId:'private-task',groupId:source.groupId,status:'completed',sessionId:'private-session',title:'SECRET_TASK',createdAt:at(0)};throw new Error('unexpected')}},
  listExecutionTrace:async q=>{calls.push(q);return {items:[{spanId:'private-span',sessionId:'private-session',kind:'phase',phase:'session-create',startedAt:1700000000000,endedAt:1700000000100,status:'observed',sourceLinks:[{shared:true}],raw:'SECRET_TRACE',args:{key:'SECRET'}}],nextOffset:null,total:1,retention:{dropped:2,private:'SECRET'}}}
 }
 return {collect:createChainEvidence({application:{tasks},description:'分析“原消息首答很慢”',secrets:['SECRET'],getSessionPersistence:()=>persistence}),calls,tasks}
}
test('discovers locally; exact version timing, safe tasks and trace metadata only',async()=>{
 const {collect,calls}=fixture(),found=await collect('discover'),alias=found.candidates[0].alias
 const message=await collect('message',undefined,{alias})
 assert.equal(message.durationMs,1200);assert.equal(message.tasks.length,1);assert.equal(message.steps.find(row=>row.kind==='stage-router-started').at,at(100))
 const trace=await collect('trace',undefined,{alias});assert.equal(trace.items[0].phase,'session-create');assert.equal(trace.items[0].durationMs,100);assert.equal(trace.ledger.scope,'this-trace-page-only')
 const task=await collect('task',undefined,{alias:message.tasks[0]});assert.equal(task.state,'completed')
 const output=JSON.stringify([found,message,trace,task]);for(const privateText of ['private-source','private-room','private-message','private-task','private-session','private-span','SECRET','原消息','PRIVATE_NAME'])assert.equal(output.includes(privateText),false)
 assert.ok(calls.some(q=>q.sourceVersion===2&&q.limit===15))
})
test('multiple matches remain ambiguous and invalid aliases cannot inspect other data',async()=>{
 const {collect}=fixture({duplicate:true});assert.equal((await collect('discover')).ambiguous,true)
 for(const action of ['message','trace','task'])await assert.rejects(collect(action,undefined,{alias:'private-source'}),/ALIAS_INVALID/)
})
test('missing delivery is not fabricated; failed scopes and offsets are rejected',async()=>{
 const {collect}=fixture({missing:true}),found=await collect('discover'),alias=found.candidates[0].alias
 const result=await collect('message',undefined,{alias});assert.equal(result.durationMs,null);assert.equal(result.firstReplyAt,null)
 await assert.rejects(collect('trace',undefined,{alias,offset:-1}),/OFFSET_INVALID/)
 await assert.rejects(collect('execute'),/SCOPE/)
})
test('query must be a user description fragment; abort and call budget stop reads',async()=>{
 const {collect}=fixture();await assert.rejects(collect('discover',undefined,{query:'unrelated private message'}),/QUERY_INVALID/)
 const ac=new AbortController();ac.abort();await assert.rejects(collect('discover',ac.signal))
 const found=await collect('discover',undefined,{query:'原消息首答很慢'});assert.equal(found.candidates.length,1)
 for(let i=0;i<22;i++)try{await collect('discover')}catch{}
 await assert.rejects(collect('discover'),/LIMIT/)
})
test('discovery performs bounded page reads and reports partial coverage',async()=>{
 const {collect,tasks}=fixture();let reads=0;tasks.observerGroupPage=async(_id,{offset,limit})=>{reads++;assert.equal(limit,50);return {items:Array.from({length:50},(_,i)=>({messageId:String(i),text:'irrelevant'})),nextOffset:offset+50}}
 const found=await collect('discover');assert.equal(reads,2);assert.equal(found.inspected,100);assert.equal(found.complete,false);assert.equal(found.truncated,true)
})

test('journal requires associated owner and pairs only ancestor calls; withholds arbitrary business prose',async()=>{
 const snapshot={header:{id:'private-session'},audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'private-task',sessionId:'private-session'}}],entries:[
  {id:'a',type:'message',timestamp:at(10),message:{role:'assistant',content:[{type:'text',text:'PRIVATE_THINKING'},{type:'toolCall',id:'call-private',name:'bash',arguments:{command:'PRIVATE_COMMAND',timeoutMs:1000}}]}},
  {id:'b',parentId:'a',type:'message',timestamp:at(20),message:{role:'toolResult',toolName:'bash',toolCallId:'call-private',isError:true,content:[{type:'text',text:'Error: 原始聊天正文：测试客户商业计划，预算五十万元 ETIMEDOUT HTTP 503 exit code 1\nPRIVATE_NORMAL_OUTPUT'}]}},
  {id:'c',parentId:null,type:'message',timestamp:at(30),message:{role:'toolResult',toolName:'bash',toolCallId:'call-private',isError:true,content:[{type:'text',text:'Error: WRONG_BRANCH'}]}}
 ]}
 const {collect}=fixture({persistence:{readNative:async(id,options)=>{assert.equal(id,'private-session');assert.equal(options.requireComplete,true);return snapshot}}})
 const found=await collect('discover'),message=await collect('message',undefined,{alias:found.candidates[0].alias}),task=await collect('task',undefined,{alias:message.tasks[0]})
 const journal=await collect('journal',undefined,{alias:task.session});assert.equal(journal.items.length,1);assert.equal(journal.items[0].input.timeoutMs,1000);assert.deepEqual(journal.items[0].diagnostic.errorCodes,['ETIMEDOUT']);assert.equal(journal.items[0].diagnostic.httpStatus,503);assert.equal(journal.items[0].diagnostic.exitCode,1)
 assert.doesNotMatch(JSON.stringify(journal),/SECRET|PRIVATE_|WRONG_BRANCH|call-private|\/home\/user|测试客户|商业计划|五十万元/)
 snapshot.entries[1].message.toolName='read';assert.equal((await collect('journal',undefined,{alias:task.session})).items.length,0);snapshot.entries[1].message.toolName='bash';snapshot.entries[0].message.content.push({...snapshot.entries[0].message.content[1]});assert.equal((await collect('journal',undefined,{alias:task.session})).items.length,0);snapshot.entries[0].message.content.pop();
 snapshot.audit=[];assert.equal((await collect('journal',undefined,{alias:task.session})).reason,'native-journal-owner-unproven')
 await assert.rejects(collect('journal',undefined,{alias:'private-session'}),/ALIAS_INVALID/)
})
test('narrowed discoveries reuse cached pages and can continue beyond three scans',async()=>{
 const {collect,tasks}=fixture();let reads=0;const original=tasks.observerGroupPage;tasks.observerGroupPage=async(...args)=>{reads++;return original(...args)}
 await collect('discover');assert.equal((await collect('discover',undefined,{query:'原消息首答'})).candidates.length,1)
 await collect('discover',undefined,{query:'消息首答很慢'});assert.equal(reads,1)
 assert.equal((await collect('discover',undefined,{query:'原消息首答'})).candidates.length,1);assert.equal(reads,1)
})

test('real task ledger and native schedule catalog are discoverable without matching recent messages',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feedback-catalog-')),ctx=new Context()
 const store=await openDynamicTaskStore({dbPath:join(root,'tasks.sqlite'),initialize:true,instanceId:'feedback-test',ownerActorId:'operator'})
 const domains=await openNativeDomains({root:join(root,'domains')})
 ctx.provide('storageDomain',domains);new NativeAgents(ctx);ctx.provide('sessionController',{header:async()=>({})});ctx.provide('workspaceRegistry',{archivedSessionIds:[]})
 const schedule=new NativeSchedule(ctx,{});await schedule.initialized
 t.after(async()=>{await ctx.fiber.dispose();await domains.closeAll();await store.close();await rm(root,{recursive:true,force:true})})
 const title='核对测试事项',conversationId='private-conversation',sourceId='private-creation-source'
 await store.command({id:'source',kind:'source.record-direct',args:{source:{sourceId,groupId:conversationId,messageId:'private-creation-message',actorId:'private-actor',version:1,text:'创建 '+title},conversation:{conversationId}}})
 await store.command({id:'router',kind:'router.ensure',args:{conversationId,sessionId:'private-router-session'}})
 const router=await store.query({kind:'router.get',conversationId})
 await store.command({id:'plan',kind:'router.plan',args:{conversationId,generation:router.generation,sourceId,messageVersion:1,operationId:'private-plan',tasks:[{taskId:'private-business-task',request:title,ownerActorId:'private-actor',groupId:conversationId}],dependencies:[]}})
 const once=await schedule.create('private-schedule-session',{title,prompt:'PRIVATE_BODY 停止条件在指令内',after_seconds:3600})
 await schedule.create('private-schedule-session',{title,prompt:'PRIVATE_BODY 停止条件在指令内',every_seconds:3600})
 await schedule.create('private-schedule-session',{title,prompt:'PRIVATE_BODY',weekly:{time:'10:30:00',time_zone:'UTC',weekdays:[7]}})
 const tasks={store,listObserverGroups:()=>[],observerGroupPage:()=>assert.fail('no message page expected')}
 const collect=createChainEvidence({application:{tasks},getSchedule:()=>schedule,title,description:'这个定时应循环执行并有停止条件'})
 const found=await collect('discover');assert.equal(found.candidates.length,0);assert.equal(found.taskCandidates.length,1);assert.equal(found.scheduleCandidates.length,3);assert.deepEqual(found.failures,[])
 const task=await collect('task',undefined,{alias:found.taskCandidates[0].alias});assert.equal(task.sources.length,1)
 assert.equal((await collect('message',undefined,{alias:task.sources[0].alias})).alias,task.sources[0].alias)
 const details=[]
 for(const row of found.scheduleCandidates)details.push(await collect('schedule',undefined,{alias:row.alias}))
 assert.equal(details.find(row=>row.kind==='after').recurring,false);assert.equal(details.find(row=>row.kind==='every').recurring,true);assert.equal(details.find(row=>row.kind==='every').timing.everySeconds,3600)
 assert.deepEqual(details.find(row=>row.kind==='weekly').timing.weekdays,[7]);assert.equal(details.find(row=>row.kind==='weekly').timing.time,'10:30:00.000')
 for(const row of details)assert.equal(row.stopCondition,'not-a-structured-schedule-field')
 assert.doesNotMatch(JSON.stringify([found,task,details]),/private-conversation|private-creation|private-actor|private-router|private-business|private-schedule|PRIVATE_BODY|停止条件在指令内|核对测试事项/)
 await schedule.delete({sessionId:'private-schedule-session',id:once.id})
 assert.equal((await collect('schedule',undefined,{alias:found.scheduleCandidates.find(row=>row.kind==='after').alias})).reason,'selected-schedule-no-longer-retained')
 assert.equal((await schedule.catalog()).length,2,'diagnostic reads do not alter schedules')
})
test('message discovery resumes older windows and keeps candidate overflow reachable',async()=>{
 const {collect,tasks}=fixture(),source=(await tasks.store.query({kind:'observer.message-contexts'})).sources[0]
 const rows=Array.from({length:125},(_,i)=>({messageId:'old-'+i,messageVersion:2,text:i>=105?source.text:'irrelevant'}))
 tasks.observerGroupPage=async(_group,{offset,limit})=>({items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null})
 const original=tasks.store.query;tasks.store.query=q=>q.kind==='observer.message-contexts'?{sources:q.messages.map(ref=>({...source,messageId:ref.messageId,sourceId:ref.messageId}))}:original(q)
 const first=await collect('discover',undefined,{target:'messages'});assert.equal(first.candidates.length,0);assert.equal(first.continuations[0].offset,100)
 const second=await collect('discover',undefined,first.continuations[0]);assert.equal(second.candidates.length,10);assert.equal(second.continuations[0].offset,115)
 const third=await collect('discover',undefined,second.continuations[0]);assert.equal(third.candidates.length,10);assert.deepEqual(third.continuations,[])
 assert.equal(new Set([...second.candidates,...third.candidates].map(row=>row.alias)).size,20)
})
test('short original fragments work; source failure preserves other catalogs and does not disclose errors',async()=>{
 const {collect,tasks}=fixture()
 assert.equal((await collect('discover',undefined,{query:'首答'})).candidates.length,1)
 tasks.observerGroupPage=async()=>{throw new Error('PRIVATE_ERROR person@example.com')}
 const lookup=createChainEvidence({application:{tasks},description:'核对测试事项',getSchedule:()=>({catalog:async()=>[{id:'private-schedule',sessionId:'private-session',kind:'every',title:'核对测试事项',status:'active',scheduledAt:at(0),everySeconds:60,lastDelivery:{scheduledAt:at(0),deliveredAt:at(5),messageId:'private-delivery'}}]})})
 const found=await lookup('discover');assert.equal(found.scheduleCandidates.length,1);assert.equal(found.failures.find(row=>row.target==='messages').reason,'EVIDENCE_QUERY_FAILED');assert.doesNotMatch(JSON.stringify(found),/PRIVATE_ERROR|person@example.com/)
 const detail=await lookup('schedule',undefined,{alias:found.scheduleCandidates[0].alias});assert.equal(detail.recurring,true);assert.deepEqual(detail.lastDelivery,{scheduledAt:at(0),deliveredAt:at(5)});assert.doesNotMatch(JSON.stringify(detail),/private-delivery/)
 const failure=await collect('task',undefined,{alias:'invented-task'}).catch(diagnosticQueryFailure)
 assert.equal(failure.reason,'FEEDBACK_ALIAS_INVALID');assert.match(failure.correction,/discover/)
 const error=Object.assign(new Error('PRIVATE_ERROR'),{code:'SQLITE_BUSY'});assert.equal(diagnosticQueryFailure(error).reason,'SQLITE_BUSY')
})

test('catalog continuations retain their query and candidate order across scheduler ticks and task archival',async()=>{
 for(const target of ['tasks','schedules']){
  let rows=Array.from({length:11},(_,i)=>({id:'schedule-'+i,sessionId:'private-session',taskId:'task-'+i,groupId:'private-room',title:'发布',kind:'every',status:'active',scheduledAt:at(i),createdAt:at(i)})),reads=0
  const catalog=async()=>{reads++;return rows}
  const collect=createChainEvidence({title:'发布检查',application:{tasks:{store:{query:async q=>q.kind==='task.list'?catalog():rows.find(r=>r.taskId===q.taskId)}}},getSchedule:()=>({catalog})})
  const field=target==='tasks'?'taskCandidates':'scheduleCandidates'
  const first=await collect('discover',undefined,{target,query:'发布'})
  assert.equal(first[field].length,10)
  const continuation=first.continuations[0]
  rows=[...rows.slice(1),rows[0]] // recurring due time or archive moves the first row
  await collect('discover',undefined,{target,query:'检查'})
  const last=await collect('discover',undefined,continuation)
  assert.equal(last[field].length,1);assert.equal(new Set([...first[field],...last[field]].map(row=>row.alias)).size,11)
  assert.deepEqual(last.continuations,[]);assert.equal(reads,2,'one catalog snapshot per distinct query')
  await assert.rejects(collect('discover',undefined,{...continuation,query:'检查'}),/FEEDBACK_CURSOR_INVALID/)
  await assert.rejects(collect('discover',undefined,{...continuation,offset:0}),/FEEDBACK_CURSOR_INVALID/)
  await assert.rejects(collect('discover',undefined,{cursor:'cursor-invented'}),/FEEDBACK_CURSOR_INVALID/)
  if(target==='schedules'){
   rows=rows.filter(row=>row.id!=='schedule-10')
   assert.equal((await collect('schedule',undefined,{alias:last[field][0].alias})).reason,'selected-schedule-no-longer-retained','detail still checks live existence')
  }
  assert.doesNotMatch(JSON.stringify([first,last]),/发布|检查|private-room|private-session/)
 }
})

test('message continuation retains its original narrowed query after another discovery',async()=>{
 const {tasks}=fixture(),source=(await tasks.store.query({kind:'observer.message-contexts'})).sources[0]
 const rows=Array.from({length:110},(_,i)=>({messageId:'old-'+i,messageVersion:2,text:i>=100?'发布':'unrelated'}))
 tasks.observerGroupPage=async(_group,{offset,limit})=>({items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null})
 const original=tasks.store.query;tasks.store.query=q=>q.kind==='observer.message-contexts'?{sources:q.messages.map(ref=>({...source,messageId:ref.messageId,sourceId:ref.messageId}))}:original(q)
 const collect=createChainEvidence({application:{tasks},description:'发布检查'})
 const first=await collect('discover',undefined,{target:'messages',query:'发布'})
 await collect('discover',undefined,{target:'messages',query:'检查'})
 const last=await collect('discover',undefined,first.continuations[0])
 assert.equal(last.candidates.length,10);assert.deepEqual(last.continuations,[])
 const other=createChainEvidence({application:{tasks},description:'发布检查'})
 await assert.rejects(other('discover',undefined,first.continuations[0]),/FEEDBACK_CURSOR_INVALID/)
})
