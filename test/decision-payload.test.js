import assert from 'node:assert/strict'
import test from 'node:test'
import {routerTaskSummary,routerTaskReceipt} from '../src/channels/router-task-view.js'
import { compactReplyReviewCandidates } from '../packages/dingtalk-core/decision.js'
import {registerResidentRouterTools} from '../src/channels/resident-router-business.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {createScope} from '../src/native-scope.js'

const expand = data => data.candidates.map(({ sourceMessageRefs, taskFactRefs, ...candidate }) => ({ ...candidate,
  sourceMessages: sourceMessageRefs.map(ref => data.sourceMessages.find(item => item.ref === ref).value),
  tasks: taskFactRefs.map(ref => data.tasks.find(item => item.ref === ref).value),
}))
test('shared review wire format preserves every fact and distinguishes same identity with changed content', () => {
  const source={messageId:'m',text:'fact '.repeat(100)}, task={taskId:'t',objective:'scope '.repeat(60),state:'running'}
  const candidates=Array.from({length:6},(_,i)=>({outboundId:'o'+i,reply:'reply',sourceMessages:[source],tasks:[task]}))
  const compact=compactReplyReviewCandidates(candidates)
  assert.deepEqual(expand(compact),candidates)
  assert.equal(compact.sourceMessages.length,1);assert.equal(compact.tasks.length,1)
  assert.ok(JSON.stringify(compact).length<JSON.stringify(candidates).length)
  const variants=compactReplyReviewCandidates([...candidates,{outboundId:'changed',sourceMessages:[{...source,text:'new version'}],tasks:[{...task,state:'completed'}]}])
  assert.equal(variants.sourceMessages.length,2);assert.equal(variants.tasks.length,2)
  assert.deepEqual(expand(variants).at(-1).sourceMessages[0].text,'new version')
})
async function routerQuery(t,{hold,taskCount=1}={}){
  const state={generation:2,phase:'active'},calls=[],entered=Promise.withResolvers(),released=Promise.withResolvers()
  const task={taskId:'t',groupId:'g',requirementRevision:2,controlRevision:1}
  let scope
  const f=await officialToolsFixture(t,({ctx,owner})=>{
    scope=createScope(ctx,owner);owner.ctx=scope.ctx
    return registerResidentRouterTools(scope.ctx,{conversationId:'g',generation:2,sessionId:owner.id},{
    responsibilityFor:()=>'',command(){assert.fail('read-only query cannot command')},
    async query(kind,args){
      calls.push(kind)
      if(kind===hold){entered.resolve();await released.promise}
      if(kind==='router.get')return state
      if(kind==='task.get')return args.taskId==='t'?task:{...task,groupId:'foreign'}
      if(kind==='router.dependencies')return [{dependencyId:'d',taskId:'t'}]
      if(kind==='task.list')return Array.from({length:taskCount},(_,i)=>i?{...task,taskId:'t-'+i}:task)
      assert.fail('Unexpected read '+kind)
    },
  })})
  f.deferCleanup(()=>scope.dispose())
  t.after(()=>released.resolve())
  return {...f,state,task,calls,entered,released,tool:f.ctx.tools.get('resident_task_query',f.owner)}
}

test('current Router task query preserves conversation isolation, dependencies and strict official arguments',async t=>{
  const f=await routerQuery(t),exec={agent:f.owner}
  assert.deepEqual(await f.tool.execute({taskId:'t'},exec),{task:routerTaskSummary(f.task),dependencies:[{dependencyId:'d',taskId:'t'}]})
  assert.deepEqual(await f.tool.execute({taskId:'t',detail:'full'},exec),{task:f.task,dependencies:[{dependencyId:'d',taskId:'t'}]})
  await assert.rejects(f.tool.execute({detail:'full'},exec),{code:'ROUTER_TASK_DETAIL_REQUIRES_ID'})
  await assert.rejects(f.tool.execute({taskId:'foreign'},exec),{code:'ROUTER_TASK_FORBIDDEN'})
  assert.equal(f.calls.filter(kind=>kind==='router.dependencies').length,2)
  f.calls.length=0
  await f.run([{id:'old-review-flag',name:'resident_task_query',args:{taskId:'t',includeReplyReview:true}}])
  assert.equal(f.results.at(-1).isError,true)
  assert.equal(f.calls.length,0,'unknown legacy review flag is rejected before any business query')
  assert.equal(f.tool.parameters.properties.includeReplyReview,undefined)
})

for(const boundary of ['task.get','router.dependencies','task.list'])for(const change of ['ended','generation','session'])test('Router read rejects stale '+change+' after awaited '+boundary,async t=>{
  const f=await routerQuery(t,{hold:boundary}),exec={agent:f.owner}
  const pending=f.tool.execute(boundary==='task.list'?{}:{taskId:'t'},exec)
  await f.entered.promise
  if(change==='ended')f.state.phase='handoff'
  else if(change==='generation')f.state.generation++
  else exec.agent={id:'foreign-session'}
  f.released.resolve()
  await assert.rejects(pending,{code:'ROUTER_GENERATION_STALE'})
})


test('Router summary bounds accumulated task histories without changing authoritative evidence or receipts',()=>{
  const task={taskId:'t',groupId:'g',sessionId:'s',status:'completed',control:'active',drained:true,
    requirementRevision:7,controlRevision:3,contextRevision:90,arrangementRevision:2,
    title:'title',objective:'objective '.repeat(1000),requirements:Array.from({length:40},()=> 'constraint '.repeat(1000)),
    sourceRefs:Array.from({length:100},(_,i)=>'source-'+i),request:'request '.repeat(20000),liveSupplements:[{text:'history '.repeat(20000)}],
    completion:{commandId:'completion-7',requirementRevision:7,at:'2026-11-13T00:00:00Z',summary:'done '.repeat(1000),result:{evidence:['private complete evidence '.repeat(10000)],artifactFiles:[{artifactId:'file-1'}]}},
    providerRecovery:{failure:{code:'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY',raw:'raw details'},attempts:1},
    humanRequests:[{requestId:'q',status:'waiting-reply',question:'missing evidence',requirementRevision:7}],
  }
  const frozen=structuredClone(task),summary=routerTaskSummary(task)
  assert.equal(summary.completion.commandId,'completion-7');assert.equal(summary.completion.resultAvailable,true)
  assert.equal(summary.providerRecovery.failure.code,'NIGHT_JOB_OUTCOME_UNCERTAIN_NO_REPLAY')
  assert.equal(summary.pendingQuestions[0].requestId,'q')
  assert.equal(summary.sourceCount,100);assert.equal(summary.sourceRefs.length,5)
  assert.ok(summary.truncatedFields.includes('objective'));assert.ok(summary.truncatedFields.includes('requirements'))
  assert.equal(summary.request,undefined);assert.equal(summary.liveSupplements,undefined);assert.equal(summary.completion.result,undefined)
  assert.ok(JSON.stringify(summary).length<5000)
  const receipt={replayed:true,dispatchEligible:false,result:{task,tasks:[task],dependencies:[{id:'d',requirementRevision:7}]}}
  const compact=routerTaskReceipt(receipt)
  assert.deepEqual(compact.result.task,summary);assert.deepEqual(compact.result.tasks,[summary]);assert.equal(compact.replayed,true)
  assert.deepEqual(compact.result.dependencies,receipt.result.dependencies)
  assert.deepEqual(task,frozen);assert.equal(receipt.result.task,task,'projection must not mutate the stored receipt')
})

test('Router task list uses 10 summaries by default; full detail remains explicitly scoped to one task',async t=>{
  const f=await routerQuery(t,{taskCount:12}),exec={agent:f.owner}
  Object.assign(f.task,{request:'old history '.repeat(30000),completion:{commandId:'completed',result:{evidence:['complete-evidence']}}})
  const summary=await f.tool.execute({taskId:'t'},exec),full=await f.tool.execute({taskId:'t',detail:'full'},exec),list=await f.tool.execute({},exec)
  assert.equal(summary.task.request,undefined);assert.equal(summary.task.completion.result,undefined)
  assert.equal(full.task.request,f.task.request);assert.deepEqual(full.task.completion.result.evidence,['complete-evidence'])
  assert.equal(list.tasks[0].projection,'summary');assert.equal(list.tasks[0].request,undefined)
  assert.equal(list.total,12);assert.equal(list.tasks.length,10);assert.equal(list.hasMore,true);assert.equal(list.nextOffset,10)
  const tail=await f.tool.execute({offset:10},exec);assert.equal(tail.tasks.length,2);assert.equal(tail.hasMore,false)
  await assert.rejects(f.tool.execute({taskId:'foreign',detail:'full'},exec),{code:'ROUTER_TASK_FORBIDDEN'})
})

test('Router action projects only the model receipt while host receives the full source and keeps full task data',async t=>{
  const task={taskId:'t',groupId:'g',sourceRefs:['source-1'],requirementRevision:2,controlRevision:1,request:'accumulated '.repeat(30000)}
  const source={sourceId:'source-1',groupId:'g',version:1,text:'additional constraint'},receipt={replayed:false,result:{task}}
  let scope,received
  const f=await officialToolsFixture(t,({ctx,owner})=>{
    scope=createScope(ctx,owner);owner.ctx=scope.ctx
    return registerResidentRouterTools(scope.ctx,{conversationId:'g',generation:2,sessionId:owner.id},{responsibilityFor:()=>'',
      async query(kind){if(kind==='router.get')return {generation:2,phase:'active'};if(kind==='task.get')return task;if(kind==='source.get')return source;assert.fail(kind)},
      async applyTaskAction(args){received=args;return receipt},
    })
  })
  f.deferCleanup(()=>scope.dispose())
  const tool=f.ctx.tools.get('resident_task_action',f.owner)
  const projected=await tool.execute({operationId:'supplement',kind:'supplement',taskId:'t',expectedRequirementRevision:2,expectedControlRevision:1,text:'new context'},{agent:f.owner})
  assert.equal(received.source,source);assert.equal(received.text,'new context')
  assert.equal(projected.result.task.request,undefined);assert.equal(projected.result.task.requirementRevision,2)
  assert.equal(receipt.result.task.request,task.request);assert.equal(projected.replayed,false)
})
