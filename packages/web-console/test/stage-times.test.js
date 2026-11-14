import test from 'node:test'
import assert from 'node:assert/strict'
import {sourceStageMetric,stageTiming} from '../server/stage-times.js'
const at=n=>new Date(Date.UTC(2026,10,14,0,0,n)).toISOString()
const span=(start,end,extra={})=>({stage:'router',startedAt:at(start),completedAt:end===null?null:at(end),...extra})
test('full host spans include post-reply work and union shared/overlapping intervals without double counting',()=>{
 const stages=[span(1,8,{spanId:'a',shared:true}),span(1,8,{spanId:'a',shared:true}),span(6,10),span(12,15),span(0,99,{phase:'materialize'})]
 assert.deepEqual(sourceStageMetric({stages},'router'),{status:'recorded',durationMs:12000,shared:true})
})
test('missing, skipped, open, malformed and genuine zero are distinct',()=>{
 assert.equal(sourceStageMetric({},'router').status,'missing')
 assert.equal(sourceStageMetric({},'router',{triage:{state:'committed',decision:{needsHandling:false}}}).status,'missing')
 assert.equal(sourceStageMetric({},'triage',{triage:{state:'committed',decision:{needsHandling:false}}}).status,'missing')
 for(const stages of [[span(1,null)],[span(1,2),span(2,null)]])assert.deepEqual(sourceStageMetric({stages},'router'),{status:'running',durationMs:null,shared:false})
 for(const stages of [[span(3,1)],[{...span(1,2),startedAt:'bad'}],[span(1,2,{spanId:'x'}),span(1,3,{spanId:'x'})]])assert.equal(sourceStageMetric({stages},'router').status,'invalid')
 assert.equal(sourceStageMetric({stages:[span(1,1)]},'router').durationMs,0)
})
test('exact conversation, source version and unique identity; only safe timing fields leave server',()=>{
 const source={sourceId:'SECRET',text:'PRIVATE',messageId:'m',groupId:'g',version:2,receivedAt:at(0),stages:[span(1,9)]}
 const result=stageTiming({messageId:'m',messageVersion:2},[source],'g')
 assert.equal(result.router.durationMs,8000);assert.doesNotMatch(JSON.stringify(result),/SECRET|PRIVATE|messageId/)
 for(const rows of [[source,{...source}],[{...source,version:1}],[{...source,groupId:'other'}]])assert.equal(stageTiming({messageId:'m',messageVersion:2},rows,'g').router.status,'missing')
})
