import test from 'node:test'
import assert from 'node:assert/strict'
import {residentTaskToolInput as input, residentTaskToolOutput as output} from '../server/resident-task-activity.js'
const identity={sessionId:'router',conversationId:'conversation',generation:1}
const value=result=>JSON.parse(result.text)
test('plan retains actual handoffs and dependency edges, resolving only unique disclosed titles',()=>{
 const args={tasks:[{taskId:'a',title:'核查',objective:'核查结果',handoff:'只核对当前状态',quote:'PRIVATE_QUOTE',sourceRefs:['PRIVATE_SOURCE']},{taskId:'b',title:'发布',requirements:['核查通过']}],dependencies:[{taskId:'b',prerequisiteTaskId:'a',condition:'通过核查'}]}
 const actual=value(input('resident_task_plan',args,identity))
 assert.equal(actual.tasks[0].handoff,'只核对当前状态')
 assert.deepEqual(actual.dependencies,[{taskId:'b',prerequisiteTaskId:'a',condition:'通过核查',taskTitle:'发布',prerequisiteTitle:'核查'}])
 assert.doesNotMatch(JSON.stringify(actual),/PRIVATE_/)
 const receipt=value(output('resident_task_plan',{replayed:true,result:{tasks:args.tasks,dependencies:[{...args.dependencies[0],state:'pending'}]}},identity))
 assert.equal(receipt.replayed,true);assert.equal(receipt.result.dependencies[0].state,'pending')
 const ambiguous=value(input('resident_task_plan',{...args,tasks:[...args.tasks,{taskId:'a',title:'另一个标题'}]},identity))
 assert.equal(ambiguous.dependencies[0].prerequisiteTitle,undefined)
})
test('evaluation exposes real dependency/evaluation receipt, not invented result.decision',()=>{
 const raw={dispatchEligible:false,result:{dependency:{id:'dep',taskId:'b',prerequisiteTaskId:'a',condition:'验收通过',state:'pending',authorizationSourceId:'PRIVATE_SOURCE'},evaluation:{dependencyId:'dep',decision:'wait',condition:'验收通过',evidence:['未完成验收','https://private.example/token'],conversationId:'PRIVATE_CONVERSATION'},task:{taskId:'b',title:'发布',status:'active',dependenciesReady:false}}}
 const actual=value(output('resident_dependency_evaluate',raw,identity))
 assert.equal(actual.result.evaluation.decision,'wait');assert.equal(actual.result.dependency.prerequisiteTaskId,'a')
 assert.equal(actual.result.task.dependenciesReady,false);assert.doesNotMatch(JSON.stringify(actual),/PRIVATE_|https:/)
 assert.equal(actual.result.decision,undefined)
})
test('task action includes resume, handoff and current result summary',()=>{
 assert.equal(value(input('resident_task_action',{kind:'resume',taskId:'a',handoff:'继续核查',sourceQuote:'PRIVATE'},identity)).kind,'resume')
 const actual=value(output('resident_task_action',{result:{task:{taskId:'a',title:'核查',status:'active',control:'active',requirementRevision:3,lastDecision:{action:'blocked',summary:'缺少现场日志'},sessionId:'PRIVATE',request:'PRIVATE',quote:'PRIVATE'}}},identity))
 assert.equal(actual.result.task.lastDecision.summary,'缺少现场日志');assert.equal(actual.result.task.requirementRevision,3);assert.doesNotMatch(JSON.stringify(actual),/PRIVATE/)
})
test('query covers pages, summary completion and progress without forwarding raw tool previews',()=>{
 const actual=value(output('resident_task_query',{tasks:[{taskId:'a',title:'核查',completion:{summary:'核对完成',resultAvailable:true}}],total:8,hasMore:true,nextOffset:1,activities:[{kind:'toolResult',toolName:'read',textPreview:'PRIVATE_BODY',toolCalls:[{name:'read',arguments:{token:'PRIVATE'}}]}]},identity))
 assert.equal(actual.tasks[0].completion.summary,'核对完成');assert.equal(actual.total,8);assert.equal(actual.activities[0].toolName,'read');assert.doesNotMatch(JSON.stringify(actual),/PRIVATE/)
})
test('attachment selects safe basename/media type/observed size only and never opens body getters',()=>{
 const raw={name:'C:\\private\\report.txt',mediaType:'text/plain',bytes:12}
 for(const key of ['text','image','url','note','details','quote'])Object.defineProperty(raw,key,{enumerable:true,get(){throw Error('private body read')}})
 assert.deepEqual(value(output('resident_web_attachment',raw,identity)),{name:'report.txt',mediaType:'text/plain',bytes:12})
 assert.deepEqual(value(output('resident_web_attachment',{name:'https://private/token',mediaType:'bad type',size:-1},identity)),{})
 assert.deepEqual(value(output('resident_web_attachment',{name:'image.png',mediaType:'image/png'},identity)),{name:'image.png',mediaType:'image/png'})
})
test('lookup retains narrow accepted-versus-completed contract and no child payload',()=>{
 assert.deepEqual(value(input('resident_task_lookup_async',{taskIds:['a','b']},identity)),{taskCount:2})
 assert.deepEqual(value(output('resident_task_lookup_async',{status:'pending',readOnly:true,summary:'PRIVATE'},identity)),{status:'pending',readOnly:true})
 assert.equal(output('resident_task_lookup_async',{status:'completed',readOnly:false},identity),null)
})
test('all six tools reject non-router identities and unknown tools',()=>{
 for(const name of ['resident_dependency_evaluate','resident_task_action','resident_task_lookup_async','resident_task_plan','resident_task_query','resident_web_attachment']){
  for(const bad of [{}, {...identity,taskId:'task'}, {...identity,generation:0}]){assert.equal(input(name,{},bad),null);assert.equal(output(name,{},bad),null)}
 }
 assert.equal(input('resident_other',{},identity),null)
})
