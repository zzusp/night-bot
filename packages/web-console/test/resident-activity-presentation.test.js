import test from 'node:test'
import assert from 'node:assert/strict'
import {residentTaskToolInput,residentTaskToolOutput} from '../server/resident-task-activity.js'
import {mergeResidentTaskAction,residentSettlement,residentTaskActionLabel} from '../src/resident-activity-presentation.ts'
import {specializedToolPresentation,specializedToolSummary} from '../src/specialized-tool-content.ts'

const identity={sessionId:'test-session',conversationId:'test-conversation',generation:1}
const name='resident_task_action', callId='paired'
const args={taskId:'verify-release',kind:'supplement',handoff:'补充验收要求。',objective:'提交的完整目标。',requirements:['具体要求'] }
const task={taskId:args.taskId,title:'核对上线清单',objective:'回执中的目标。',requirements:['不同的要求'],state:'running',control:'paused',requirementRevision:4,contextRevision:8}
const request={...residentTaskToolInput(name,args,identity),callId,source:{sessionId:identity.sessionId}}
const receipt={...residentTaskToolOutput(name,{replayed:false,dispatchEligible:false,result:{task}},identity),callId,status:'completed',source:{sessionId:identity.sessionId}}

test('paired disclosed action separates task status, submitted differences without promoting technical receipt fields',()=>{
 const view=mergeResidentTaskAction(request,receipt)
 assert.equal(view.title,task.title)
 assert.equal(residentTaskActionLabel(request),'补充任务')
 assert.equal(view.state,'执行中')
 assert.equal(view.control,'已暂停')
 assert.deepEqual(view.copy,[
  {label:'交接',text:args.handoff},{label:'目标',text:task.objective},{label:'提交的目标',text:args.objective},
  {label:'要求',list:task.requirements},{label:'提交的要求',list:args.requirements},
 ])
 assert.equal(Object.hasOwn(view,'technical'),false)
 assert.doesNotMatch(JSON.stringify(view),/任务编号|需求版本|上下文版本|verify-release/)
 for (const output of [{...receipt,isError:true},{...receipt,truncated:true},{...receipt,source:{sessionId:'another'}},{...receipt,callId:'orphan'},
  {...receipt,text:JSON.stringify({accepted:false,result:{task}})},{...receipt,text:JSON.stringify({result:{task:{...task,taskId:'another-task'}}})}]) {
   assert.equal(mergeResidentTaskAction(request,output),null)
 }
 assert.equal(mergeResidentTaskAction({...request,source:undefined},{...receipt,source:undefined}),null)
})

test('settlement counts submitted events and categories without implying a new effect or a hidden failure',()=>{
 const output={requestedEventCount:2,settled:true,dispositions:{'context-only':1},inspectionReviews:{wait:1}}
 assert.deepEqual(residentSettlement(output,true),{requested:2,dispositions:[{label:'仅作背景',count:1}],reviews:[{label:'等待',count:1}]})
 assert.equal(residentSettlement({...output,requestedEventCount:31},true),null)
 assert.equal(residentSettlement({...output,settled:false},true),null)
 assert.equal(residentSettlement({...output,dispositions:{'context-only':0}},true),null)
 assert.equal(residentSettlement({...output,extra:'preserve fallback field'},true),null)
 const toolName='resident_router_settle', text=JSON.stringify(output)
 assert.deepEqual(specializedToolSummary(toolName,{text,status:'completed'}),{label:'已结清',tone:'success'})
 assert.equal(specializedToolPresentation({toolName,phase:'output',text,status:'completed',complete:false}).text,text)
 assert.equal(specializedToolPresentation({toolName,phase:'output',text,status:'error',isError:true}).text,text)
})

test('settlement shows verified events in requested order and presents unmatched classifications only once',()=>{
 const at='2026-11-24T01:00:00Z'
 const output={settled:true,requestedEventCount:3,dispositions:{'context-only':1},inspectionReviews:{wait:1},events:[
   {recorded:true,kind:'task.completed'},{recorded:false},{recorded:true,kind:'source.message',at,disposition:'context-only'},
 ]}
 const view=residentSettlement(output,true)
 assert.deepEqual(view.events.map(event=>event.label),['任务完成','未核对到原事件','渠道消息'])
 assert.equal(view.events[2].at,at)
 assert.equal(view.events[2].disposition,'仅作背景')
 assert.deepEqual(view.dispositions,[])
 assert.deepEqual(view.reviews,[{label:'等待',count:1}])
 assert.equal(residentSettlement({...output,events:output.events.slice(0,2)},true).events,undefined)
 assert.equal(residentSettlement({...output,events:[...output.events.slice(0,2),{recorded:false,kind:'source.message'}]},true).events,undefined)
 assert.equal(residentSettlement({...output,events:[...output.events.slice(0,2),{recorded:true,kind:'wrong'}]},true).events,undefined)
 const matchedReview=residentSettlement({...output,events:[{recorded:true,kind:'task.inspection',inspectionReview:'wait'},...output.events.slice(1)]},true)
 assert.equal(matchedReview.events[0].inspectionReview,'等待')
 assert.deepEqual(matchedReview.reviews,[])
})

test('settlement only displays allowlisted presentation fields on the appropriate events',()=>{
 const event=(wire)=>residentSettlement({settled:true,requestedEventCount:1,events:[wire]},true).events?.[0]
 assert.equal(event({recorded:true,kind:'task.completed',title:'核对上线清单'}).title,'核对上线清单')
 assert.equal(event({recorded:true,kind:'source.message',snippet:'请检查交付',snippetTruncated:true}).snippetTruncated,true)
 assert.equal(event({recorded:false,title:'do not show'}),undefined)
 assert.equal(event({recorded:true,kind:'task.completed',eventId:'do not show'}),undefined)
 assert.equal(event({recorded:true,kind:'source.message',title:'do not show'}),undefined)
 assert.equal(event({recorded:true,kind:'task.completed',snippet:'do not show'}),undefined)
 assert.equal(event({recorded:true,kind:'source.message',snippetTruncated:true}),undefined)
})
