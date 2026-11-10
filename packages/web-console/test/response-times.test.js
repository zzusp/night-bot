import test from 'node:test'
import assert from 'node:assert/strict'
import {responseTiming} from '../server/response-times.js'
const source={sourceId:'s1',groupId:'room',messageId:'m1',version:2,receivedAt:'2026-11-09T00:00:00Z'}
const notice=(extra={})=>({id:'n1',kind:'triage-reply',taskId:null,state:'delivered',createdAt:'2026-11-09T00:00:01Z',sendStartedAt:'2026-11-09T00:00:02Z',deliveredAt:'2026-11-09T00:00:03Z',payload:{conversationId:'room',sourceId:'s1',sourceRef:{messageId:'m1',messageVersion:2}},...extra})
const message={messageId:'m1',messageVersion:2}
test('首答按来源版本关联，仅确认送达后计算，排除其他消息与后续任务交付',()=>{
 const notices=[notice({id:'other',payload:{...notice().payload,sourceId:'other'}}),notice({id:'old-version',payload:{...notice().payload,sourceRef:{messageId:'m1',messageVersion:1}}}),notice({id:'task',kind:'completion',taskId:'task-one',deliveredAt:'2026-11-09T00:00:01Z'}),notice()]
 const value=responseTiming(message,[source],notices);assert.equal(value.durationMs,3000);assert.equal(value.status,'confirmed');assert.equal(value.firstReplyAt,notice().deliveredAt)
 const redacted=responseTiming(message,[source],[notice({payload:{...notice().payload,text:'apiKey=PRIVATE_VALUE literal-secret'}})],null,{secrets:['literal-secret']});assert.doesNotMatch(redacted.replyPreview,/PRIVATE_VALUE|literal-secret/)
 assert.equal(responseTiming(message,[source],[notice({state:'unknown'}),notice({id:'later',deliveredAt:'2026-11-09T00:00:04Z'})]).durationMs,null)
 assert.equal(responseTiming(message,[source],[notice({state:'unknown'})]).status,'unconfirmed');assert.equal(responseTiming(message,[source],[notice({state:'failed'})]).status,'failed');assert.equal(responseTiming(message,[source],[]).durationMs,null)
 assert.equal(responseTiming(message,[{...source,receivedAt:null}],[notice()]).status,'unavailable');assert.equal(responseTiming(message,[{...source,receivedAt:'2026-11-10T00:00:00Z'}],[notice()]).status,'invalid-time')
})
test('历史 Router 回复用途不猜测，多条回复选最早确认，批次共享不按消息均分',()=>{
 const router=notice({kind:'router-reply',payload:{...notice().payload,replyPurpose:'direct-answer'}})
 assert.equal(responseTiming(message,[source],[router]).durationMs,3000)
 assert.equal(responseTiming(message,[source],[{...router,payload:{...router.payload,replyPurpose:'task-update'}}]).durationMs,null)
 assert.match(responseTiming(message,[source],[notice({kind:'router-reply'})]).reason,/用途未记录/)
 const value=responseTiming(message,[{...source,stages:[{stage:'turn',shared:true,completedAt:'2026-11-09T00:00:02Z'}]}],[notice({deliveredAt:'2026-11-09T00:00:08Z'}),router]);assert.equal(value.durationMs,3000);assert.ok(value.steps.some(row=>row.label.includes('批次共享')))
 assert.equal(responseTiming(message,[source,{...source,sourceId:'ambiguous'}],[router]).status,'unavailable')
})

test('更早回复用途或可见时间缺失时，不把后续回复当成可靠首答',()=>{
 const later=notice({id:'later',createdAt:'2026-11-09T00:00:04Z',sendStartedAt:'2026-11-09T00:00:05Z',deliveredAt:'2026-11-09T00:00:06Z'})
 for(const earlier of [notice({kind:'router-reply'}),notice({deliveredAt:null}),notice({deliveredAt:'invalid'}),notice({state:'unknown',sendStartedAt:null}),notice({state:'starting',sendStartedAt:null,createdAt:null})]){
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
