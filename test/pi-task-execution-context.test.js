import test from 'node:test'
import assert from 'node:assert/strict'
import {executionContext,executionTaskBrief,retainExecutionPacket} from '../src/tasks/execution-context.js'
const source=(id,text,version=1)=>({sourceId:id,text,version,actorId:'user',groupId:'group'})
const audit=body=>[{domain:'admission',kind:'enqueued',payload:{id:'one',source:{kind:'task-input'},content:[{text:JSON.stringify(body)}]}},{domain:'admission',kind:'admitted',payload:{id:'one'}}]
test('execution brief excludes histories, raw effects and accumulated diagnostics',()=>{
 const task={taskId:'a',request:'Current brief',requirements:['Current target'],supplements:[{text:'OLD'}],liveSupplements:[{}],effectReconciliations:[{secret:'NOT_MODEL_CONTEXT'}],metadata:{secret:'HOST_ONLY'},dependencies:[{evidence:'keep'}],archiveRestore:{reviewRequired:true}}
 const brief=executionTaskBrief(task)
 assert.equal(brief.request,'Current brief');assert.deepEqual(brief.dependencies,task.dependencies);assert.deepEqual(brief.archiveRestore,task.archiveRestore)
 assert.equal(brief.supplements,undefined);assert.equal(brief.metadata,undefined);assert.equal(brief.effectReconciliations,undefined)
})
test('continuation includes unseen and updated original sources plus unapplied deltas, not previously admitted bodies',()=>{
 const old={task:{contextRevision:1},sources:[source('a','old')],currentInput:{id:'old'}}
 const input={task:{taskId:'t',request:'brief',contextRevision:3,supplements:[{id:'1',text:'old',contextRevision:1},{id:'2',text:'new delta',contextRevision:2}],currentInput:{id:'new',text:'current directive'}},sources:[source('a','old'),source('b','exact original')],materials:[{sourceId:'a'},{sourceId:'b'}]}
 const body=executionContext(input,audit(old))
 assert.deepEqual(body.sources.map(x=>x.sourceId),['b']);assert.deepEqual(body.materials.map(x=>x.sourceId),['b']);assert.deepEqual(body.updates.map(x=>x.id),['2','new'])
 assert.equal(executionContext({...input,sources:[source('a','changed',2)]},audit(old)).sources[0].text,'changed')
 assert.equal(executionContext(input,audit(old).slice(0,1)).sources.length,2,'unadmitted history must not suppress evidence')
 assert.equal(executionContext({...input,humanReview:{}},audit(old)).sources.length,2)
})
test('explicit revised constraints replace historical requirements without heuristic suppression',()=>{
 const previous={task:{contextRevision:0,request:'All six UAT checks',requirements:['old uncertain effect']} ,sources:[source('a','All six UAT checks')]}
 const body=executionContext({task:{taskId:'t',request:'Only two targeted UAT checks',requirements:['Do not replay call X'],contextRevision:1,currentInput:{id:'revise',text:'Old effect reconciled; perform two checks'}},sources:[source('a','All six UAT checks')]},audit(previous))
 assert.deepEqual(body.task.requirements,['Do not replay call X']);assert.equal(body.task.request,'Only two targeted UAT checks');assert.equal(body.sources.length,0)
})

test('a live-admitted delta is not injected again on cold continuation',()=>{
 const currentInput={id:'live-one',text:'Already handled'}
 const body=executionContext({task:{taskId:'t',contextRevision:1,currentInput,supplements:[{id:'live-one',text:currentInput.text,contextRevision:1}]},sources:[]},audit({task:{contextRevision:1},supplement:{messageId:'live-one',text:currentInput.text}}))
 assert.deepEqual(body.updates,[])
})
test('explicit requirement revision does not replay unconsumed superseded supplementary instructions',()=>{
 const body=executionContext({task:{taskId:'t',contextRevision:1,requirementRevision:2,requirements:['Current scope'],supplements:[{id:'old',text:'Previous scope',contextRevision:1,requirementRevision:1}]},sources:[]})
 assert.deepEqual(body.updates,[])
})


test('pending live and legacy packets keep byte-exact bodies after current brief/material changes',()=>{
 for(const id of ['task-supplement:one','task-input:legacy']){
  const source={kind:'task-input',taskSession:{taskId:'t',sessionId:'s',contextRevision:1}}
  const retained={id,source:{...source,traceSources:[{id:'original'}]},content:[{type:'text',text:'{ "task": { "request": "original cumulative body" }, "materials": [{"path":"old"}] }'}]}
  const regenerated={id,source,content:[{type:'text',text:'{"task":{"request":"new brief"},"materials":[]}'}]}
  assert.deepEqual(retainExecutionPacket(regenerated,retained),retained)
  assert.throws(()=>retainExecutionPacket({...regenerated,source:{kind:'task-input',taskSession:{...source.taskSession,contextRevision:2}}},retained),{code:'TASK_LIVE_SUPPLEMENT_ENTRY_CONFLICT'})
 }
})
