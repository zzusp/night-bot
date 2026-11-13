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
  store:{query:async q=>{calls.push(q);if(q.kind==='observer.message-contexts')return {sources:[source,...(duplicate?[{...source,sourceId:'other-source',messageId:'other'}]:[])],notifications:missing?[]:[notice],taskReplySources:[]};if(q.kind==='router.source-status')return {triage:{state:'committed',decision:{needsHandling:true,reply:'SECRET'}},event:{state:'consumed',consumedAt:at(950)}};if(q.kind==='router.source-links')return [{taskId:'private-task',sourceId:source.sourceId,messageVersion:2,conversationId:source.groupId},{taskId:'unrelated',sourceId:source.sourceId,messageVersion:1,conversationId:source.groupId}];if(q.kind==='task.get')return {taskId:'private-task',groupId:source.groupId,status:'completed',sessionId:'private-session',title:'SECRET_TASK',createdAt:at(0)};throw new Error('unexpected')}},
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
 for(const action of ['message','trace','task'])await assert.rejects(collect(action,undefined,{alias:'private-source'}),/SCOPE/)
})
test('missing delivery is not fabricated; failed scopes and offsets are rejected',async()=>{
 const {collect}=fixture({missing:true}),found=await collect('discover'),alias=found.candidates[0].alias
 const result=await collect('message',undefined,{alias});assert.equal(result.durationMs,null);assert.equal(result.firstReplyAt,null)
 await assert.rejects(collect('trace',undefined,{alias,offset:-1}),/SCOPE/)
 await assert.rejects(collect('execute'),/SCOPE/)
})
test('query must be a user description fragment; abort and call budget stop reads',async()=>{
 const {collect}=fixture();await assert.rejects(collect('discover',undefined,{query:'unrelated private message'}),/SCOPE/)
 const ac=new AbortController();ac.abort();await assert.rejects(collect('discover',ac.signal))
 const found=await collect('discover',undefined,{query:'原消息首答很慢'});assert.equal(found.candidates.length,1)
 for(let i=0;i<22;i++)try{await collect('discover')}catch{}
 await assert.rejects(collect('discover'),/LIMIT/)
})
test('discovery performs bounded page reads and reports partial coverage',async()=>{
 const {collect,tasks}=fixture();let reads=0;tasks.observerGroupPage=async(_id,{offset,limit})=>{reads++;assert.equal(limit,50);return {items:Array.from({length:50},(_,i)=>({messageId:String(i),text:'irrelevant'})),nextOffset:offset+50}}
 const found=await collect('discover');assert.equal(reads,2);assert.equal(found.inspected,100);assert.equal(found.complete,false);assert.equal(found.truncated,true)
})

test('journal requires associated owner and pairs only ancestor calls; redacts diagnostic lines',async()=>{
 const snapshot={header:{id:'private-session'},audit:[{domain:'task',kind:'identity',version:1,payload:{taskId:'private-task',sessionId:'private-session'}}],entries:[
  {id:'a',type:'message',timestamp:at(10),message:{role:'assistant',content:[{type:'text',text:'PRIVATE_THINKING'},{type:'toolCall',id:'call-private',name:'bash',arguments:{command:'PRIVATE_COMMAND',timeoutMs:1000}}]}},
  {id:'b',parentId:'a',type:'message',timestamp:at(20),message:{role:'toolResult',toolCallId:'call-private',isError:true,content:[{type:'text',text:'Error: SECRET at /home/user/private.txt\nPRIVATE_NORMAL_OUTPUT'}]}},
  {id:'c',parentId:null,type:'message',timestamp:at(30),message:{role:'toolResult',toolCallId:'call-private',isError:true,content:[{type:'text',text:'Error: WRONG_BRANCH'}]}}
 ]}
 const {collect}=fixture({persistence:{readNative:async(id,options)=>{assert.equal(id,'private-session');assert.equal(options.requireComplete,true);return snapshot}}})
 const found=await collect('discover'),message=await collect('message',undefined,{alias:found.candidates[0].alias}),task=await collect('task',undefined,{alias:message.tasks[0]})
 const journal=await collect('journal',undefined,{alias:task.session});assert.equal(journal.items.length,1);assert.equal(journal.items[0].input.timeoutMs,1000);assert.match(journal.items[0].diagnostic,/已脱敏/)
 assert.doesNotMatch(JSON.stringify(journal),/SECRET|PRIVATE_|WRONG_BRANCH|call-private|\/home\/user/)
 snapshot.audit=[];assert.equal((await collect('journal',undefined,{alias:task.session})).reason,'native-journal-owner-unproven')
 await assert.rejects(collect('journal',undefined,{alias:'private-session'}),/SCOPE/)
})
test('three narrowed discoveries reuse cached message pages',async()=>{
 const {collect,tasks}=fixture();let reads=0;const original=tasks.observerGroupPage;tasks.observerGroupPage=async(...args)=>{reads++;return original(...args)}
 await collect('discover');assert.equal((await collect('discover',undefined,{query:'原消息首答'})).candidates.length,1)
 await collect('discover',undefined,{query:'消息首答很慢'});assert.equal(reads,1)
 await assert.rejects(collect('discover',undefined,{query:'原消息首答'}),/DISCOVERY_LIMIT/)
})
