import test from 'node:test'
import assert from 'node:assert/strict'
import {responseTiming,selectedResponseTiming} from '../server/response-times.js'
const source={sourceId:'s1',groupId:'room',messageId:'m1',version:2,receivedAt:'2026-11-09T00:00:00Z'}
const notice=(extra={})=>({id:'n1',kind:'triage-reply',taskId:null,state:'delivered',createdAt:'2026-11-09T00:00:01Z',sendStartedAt:'2026-11-09T00:00:02Z',deliveredAt:'2026-11-09T00:00:03Z',payload:{conversationId:'room',sourceId:'s1',sourceRef:{messageId:'m1',messageVersion:2}},...extra})
const message={messageId:'m1',messageVersion:2}
const handling={triage:{state:'committed',decision:{needsHandling:true,reply:null}},event:{state:'consumed'}}
test('首答严格按会话、来源及消息版本关联，不套用同批其他消息的回复',()=>{
 const notices=[notice({id:'other',payload:{...notice().payload,sourceId:'other'}}),notice({id:'old-version',payload:{...notice().payload,sourceRef:{messageId:'m1',messageVersion:1}}}),notice({id:'foreign',payload:{...notice().payload,conversationId:'foreign'}}),notice({id:'other-message',payload:{...notice().payload,sourceRef:{messageId:'other',messageVersion:2}}})]
 assert.equal(responseTiming(message,[source],notices,handling).status,'awaiting-reply')
 const value=responseTiming(message,[source],[...notices,notice()]);assert.equal(value.durationMs,3000);assert.equal(value.status,'confirmed');assert.equal(value.firstReplyAt,notice().deliveredAt)
 const redacted=responseTiming(message,[source],[notice({payload:{...notice().payload,text:'apiKey=PRIVATE_VALUE literal-secret'}})],null,{secrets:['literal-secret']});assert.doesNotMatch(redacted.replyPreview,/PRIVATE_VALUE|literal-secret/)
 assert.equal(responseTiming(message,[source,{...source,sourceId:'ambiguous'}],[notice()]).status,'unavailable')
})
test('已有回复不受用途或任务类型限制，任务结果作为首条回复也计时',()=>{
 for(const replyPurpose of [undefined,'acknowledgement','direct-answer','task-update']){
  const router=notice({kind:'router-reply',payload:{...notice().payload,replyPurpose}})
  assert.equal(responseTiming(message,[source],[router]).durationMs,3000)
  const taskResult=notice({kind:'status',taskId:'task-one',payload:{...router.payload,taskDelivery:{taskId:'task-one',requirementRevision:1,artifactIds:['artifact']}}})
  assert.equal(responseTiming(message,[source],[taskResult]).durationMs,3000)
 }
 assert.equal(responseTiming(message,[source],[notice({kind:'completion',taskId:'task-one'})]).durationMs,3000)
})
test('按最早可靠送达计时，定时安排确认早于到点提醒，批次阶段不均分',()=>{
 const arranged=notice({kind:'router-reply',payload:{...notice().payload,text:'已安排定时提醒'}})
 const reminder=notice({kind:'platform-reply',deliveredAt:'2026-11-09T00:03:00Z'})
 const value=responseTiming(message,[{...source,stages:[{stage:'turn',shared:true,completedAt:'2026-11-09T00:00:02Z'}]}],[reminder,arranged,notice({deliveredAt:'2026-11-09T00:00:08Z'})])
 assert.equal(value.durationMs,3000);assert.equal(value.replyPreview,'已安排定时提醒');assert.ok(value.steps.some(row=>row.label.includes('批次共享')))
 assert.equal(responseTiming(message,[source],[reminder]).durationMs,180000,'若此前确实没有回复，到点提醒本身也可作为第一条已送达回复')
})
test('发送尝试、未知回读、无回执与异常时间不能生成首答耗时',()=>{
 assert.equal(responseTiming(message,[source],[notice({state:'unknown'}),notice({id:'later',kind:'status',taskId:'task-one',deliveredAt:'2026-11-09T00:00:04Z'})]).durationMs,null)
 assert.equal(responseTiming(message,[source],[notice({state:'unknown'})]).status,'unconfirmed');assert.equal(responseTiming(message,[source],[notice({state:'failed'})]).status,'failed');assert.equal(responseTiming(message,[source],[notice({state:'prepared'})]).status,'pending')
 const missing=responseTiming(message,[source],[],handling);assert.equal(missing.durationMs,null);assert.equal(missing.status,'awaiting-reply');assert.match(missing.reason,/尚未找到/)
 assert.equal(responseTiming(message,[{...source,receivedAt:null}],[notice()]).status,'unavailable');assert.equal(responseTiming(message,[{...source,receivedAt:'2026-11-10T00:00:00Z'}],[notice()]).status,'invalid-time')
})

test('只有明确无需处理及回复才无首答，其余区分处理、回复与历史不足',()=>{
 const triage=decision=>({triage:{state:'committed',decision},event:{state:'consumed'}})
 assert.equal(responseTiming(message,[source],[],triage({needsHandling:false,reply:null})).status,'no-reply')
 assert.equal(responseTiming(message,[source],[],triage({needsHandling:false,reply:'已准备短答'})).status,'awaiting-reply')
 assert.equal(responseTiming(message,[source],[],handling).status,'awaiting-reply')
 assert.equal(responseTiming(message,[source],[],{...handling,event:{state:'pending'}}).status,'awaiting-handling')
 assert.equal(responseTiming(message,[source],[],{triage:{state:'pending'}}).status,'awaiting-handling')
 assert.equal(responseTiming(message,[source],[]).status,'unavailable')
 assert.equal(responseTiming(message,[source],[notice({deliveredAt:null})],handling).status,'unconfirmed')
})
test('明确关联的共同任务回复按各来源接收时间计时，并保留未知较早发送守卫',()=>{
 const shared=notice({taskId:'task-one',kind:'status',payload:{...notice().payload,sourceId:'main',sourceRef:{messageId:'main-message',messageVersion:1}}})
 const taskReplySources=[{notificationId:shared.id,taskId:'task-one',sourceId:source.sourceId,messageVersion:source.version}]
 const value=responseTiming(message,[source],[shared],handling,{taskReplySources})
 assert.equal(value.durationMs,3000);assert.equal(value.replyAssociation,'task');assert.match(value.reason,/共同任务回复/)
 assert.equal(responseTiming(message,[{...source,receivedAt:'2026-11-09T00:00:01Z'}],[shared],handling,{taskReplySources}).durationMs,2000)
 for(const changed of [{sourceId:'other'},{messageVersion:1},{taskId:'other'},{notificationId:'other'}]){
  assert.equal(responseTiming(message,[source],[shared],handling,{taskReplySources:[{...taskReplySources[0],...changed}]}).status,'awaiting-reply')
 }
 assert.equal(responseTiming(message,[source],[{...shared,state:'unknown',sendStartedAt:null},notice({id:'later',deliveredAt:'2026-11-09T00:00:04Z'})],handling,{taskReplySources}).status,'unconfirmed')
})

test('更早回复可见时间缺失时，不把后续回复当成可靠首答',()=>{
 const later=notice({id:'later',createdAt:'2026-11-09T00:00:04Z',sendStartedAt:'2026-11-09T00:00:05Z',deliveredAt:'2026-11-09T00:00:06Z'})
 for(const earlier of [notice({deliveredAt:null}),notice({deliveredAt:'invalid'}),notice({state:'unknown',sendStartedAt:null}),notice({state:'starting',sendStartedAt:null,createdAt:null})]){
  const value=responseTiming(message,[source],[earlier,later]);assert.equal(value.status,'unconfirmed');assert.equal(value.durationMs,null);assert.equal(value.firstReplyAt,null);assert.equal(value.replyPreview,null)
 }
 assert.equal(responseTiming(message,[source],[notice({deliveredAt:null})]).status,'unconfirmed')
 assert.equal(responseTiming(message,[source],[notice(),{...later,kind:'router-reply'}]).durationMs,3000)
 assert.equal(responseTiming(message,[source],[notice(),{...later,state:'unknown'}]).durationMs,3000)
})

test('阶段只投影已记录端点，共享阶段不均分，不从相邻事件推算耗时',()=>{
 const stages=[{stage:'turn',startedAt:'2026-11-09T00:00:01Z',completedAt:'2026-11-09T00:00:02Z',shared:true,sessionId:'private',requestId:'private'},
  {stage:'queue',completedAt:'2026-11-09T00:00:01Z'},
  {stage:'host',startedAt:'2026-11-09T00:00:02Z',completedAt:'2026-11-09T00:00:01Z'},
  {stage:'ingress',phase:'source-record',startedAt:source.receivedAt,completedAt:'2026-11-09T00:00:01Z'}]
 const value=responseTiming(message,[{...source,stages}],[notice()])
 assert.equal(value.steps.find(row=>row.kind==='stage-turn-completed').durationMs,1000)
 assert.equal(value.steps.find(row=>row.kind==='stage-turn-completed').shared,true)
 assert.ok(value.steps.every(row=>typeof row.kind==='string'))
 for(const kind of ['stage-queue-completed','stage-host-completed'])assert.equal(Object.hasOwn(value.steps.find(row=>row.kind===kind),'durationMs'),false)
 assert.doesNotMatch(JSON.stringify(value),/private|source-record/)
 assert.equal(value.steps.filter(row=>Object.hasOwn(row,'durationMs')).length,1)
})


test('selected timing fails closed for missing/ambiguous versions and scopes; sources stay distinct',async()=>{
 const run=(selected,sources=[source],extra={})=>selectedResponseTiming({selected,selectedMessageId:'clicked',conversationId:'room',store:{query:async q=>q.kind==='router.source-status'?null:{sources,notifications:[notice()],taskReplySources:[]}},...extra})
 assert.equal((await run(null)).status,'unavailable')
 assert.equal((await run({role:'user',...message},[source,{...source,sourceId:'duplicate'}])).status,'unavailable')
 assert.equal((await run({role:'user',messageId:'m1'})).status,'unavailable')
 assert.equal((await run({role:'user',...message},[{...source,groupId:'foreign'}])).status,'unavailable')
 assert.equal((await run({role:'user',...message},[source],{selectedMessageVersion:1})).status,'unavailable')
 const multiple=await run({role:'assistant',notificationId:'n1'},[source,{...source,sourceId:'version-one',version:1}])
 assert.deepEqual(multiple.items.map(row=>row.messageVersion),[2,1]);assert.equal(multiple.total,2);assert.equal(multiple.nextOffset,null)
})


test('分诊与Router只用真实Host跨度，首答先于轮结束时展示已观测交集',()=>{
 const end='2026-11-09T00:00:04Z'
 const stages=[{stage:'triage',startedAt:source.receivedAt,completedAt:'2026-11-09T00:00:01Z'},
  {stage:'router',startedAt:'2026-11-09T00:00:01Z',completedAt:end,shared:true}]
 const value=responseTiming(message,[{...source,routedAt:'2026-11-09T00:00:00.950Z',stages}],[notice()])
 assert.equal(value.durationMs,3000)
 assert.equal(value.steps.find(row=>row.kind==='stage-triage-completed').durationMs,1000)
 const router=value.steps.find(row=>row.kind==='stage-router-completed')
 assert.equal(router.durationMs,2000);assert.equal(router.at,notice().deliveredAt)
 assert.match(router.label,/截至回复可见/);assert.equal(router.shared,true)
 assert.equal(value.steps.some(row=>row.kind==='triage-completed'),false)
 assert.equal(stages[1].completedAt,end,'投影不修改存储的真实结束时间')
})

test('历史缺失、未关闭、负跨度与首答后开始的分诊/Router不生成估计耗时',()=>{
 for(const span of [{stage:'triage',startedAt:source.receivedAt},
  {stage:'router',startedAt:'2026-11-09T00:00:02Z',completedAt:'2026-11-09T00:00:01Z'},
  {stage:'router',completedAt:'2026-11-09T00:00:02Z'}]){
  const value=responseTiming(message,[{...source,routedAt:'2026-11-09T00:00:01Z',stages:[span]}],[notice()])
  assert.ok(value.steps.every(row=>!Object.hasOwn(row,'durationMs')))
  assert.equal(value.durationMs,3000)
 }
 const after=responseTiming(message,[{...source,stages:[{stage:'router',startedAt:'2026-11-09T00:00:04Z',completedAt:'2026-11-09T00:00:05Z'}]}],[notice()])
 assert.equal(after.steps.some(row=>row.kind==='stage-router-completed'),false)
 const historical=responseTiming(message,[{...source,routedAt:'2026-11-09T00:00:01Z'}],[notice()])
 assert.equal(historical.steps.find(row=>row.kind==='triage-completed').durationMs,undefined)
})


test('Router starts at its observed Host preparation boundary before the clipped reply checkpoint',()=>{
 const time=ms=>new Date(Date.parse(source.receivedAt)+ms).toISOString()
 const stages=[{stage:'triage',startedAt:time(100),completedAt:time(31000)},
  {stage:'router',startedAt:time(26000),completedAt:time(93000),shared:true}]
 const value=responseTiming(message,[{...source,stages}],[notice({createdAt:time(25900),sendStartedAt:time(26100),deliveredAt:time(29000)})])
 const start=value.steps.find(row=>row.kind==='stage-router-started')
 const end=value.steps.find(row=>row.kind==='stage-router-completed')
 assert.equal(start.label,'Router 开始准备（批次共享）')
 assert.equal(start.at,time(26000));assert.equal(start.timingType,'milestone');assert.equal(start.durationMs,undefined)
 assert.equal(end.at,time(29000));assert.equal(end.durationMs,3000);assert.equal(end.timingType,'span')
 assert.equal(value.steps.find(row=>row.kind==='stage-triage-completed').durationMs,28900)
 assert.equal(value.durationMs,29000,'overlapping spans are not added or repartitioned')
 assert.ok(value.steps.indexOf(start)<value.steps.indexOf(end))
 assert.equal(stages[1].completedAt,time(93000),'the original completed span remains unchanged')
 for(const row of value.steps.filter(row=>['received','reply-prepared','send-started','reply-visible'].includes(row.kind)))assert.equal(row.timingType,'milestone')
})

test('missing Router starts stay unknown; open spans expose only their real start without a guessed duration',()=>{
 const historical=responseTiming(message,[{...source,routedAt:'2026-11-09T00:00:01Z'}],[notice()])
 assert.equal(historical.steps.some(row=>row.kind==='stage-router-started'),false)
 const value=responseTiming(message,[{...source,stages:[{stage:'router',startedAt:'2026-11-09T00:00:01Z'}]}],[notice()])
 assert.equal(value.steps.find(row=>row.kind==='stage-router-started').at,'2026-11-09T00:00:01Z')
 assert.equal(value.steps.find(row=>row.kind==='stage-router-completed').durationMs,undefined)
 assert.equal(value.steps.find(row=>row.kind==='stage-router-completed').timingType,'span')
 const invalid=responseTiming(message,[{...source,stages:[{stage:'router',completedAt:'2026-11-09T00:00:02Z'}]}],[notice()])
 assert.equal(invalid.steps.some(row=>row.kind==='stage-router-started'),false)
})
