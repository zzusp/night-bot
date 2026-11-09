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
