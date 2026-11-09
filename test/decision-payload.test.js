import assert from 'node:assert/strict'
import test from 'node:test'
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
async function routerQuery(t,{hold}={}){
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
      if(kind==='task.list')return [task]
      assert.fail('Unexpected read '+kind)
    },
  })})
  f.deferCleanup(()=>scope.dispose())
  t.after(()=>released.resolve())
  return {...f,state,task,calls,entered,released,tool:f.ctx.tools.get('resident_task_query',f.owner)}
}

test('current Router task query preserves conversation isolation, dependencies and strict official arguments',async t=>{
  const f=await routerQuery(t),exec={agent:f.owner}
  assert.deepEqual(await f.tool.execute({taskId:'t'},exec),{task:f.task,dependencies:[{dependencyId:'d',taskId:'t'}]})
  await assert.rejects(f.tool.execute({taskId:'foreign'},exec),{code:'ROUTER_TASK_FORBIDDEN'})
  assert.equal(f.calls.filter(kind=>kind==='router.dependencies').length,1)
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
