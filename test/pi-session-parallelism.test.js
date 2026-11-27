import test from 'node:test'
import assert from 'node:assert/strict'
import {mapIndependentReads} from '../src/runtime/parallel-read.js'
import {conversationContext} from '../src/channels/conversation-context.js'
import {registerResidentRouterTools} from '../src/channels/resident-router-business.js'
import {createScope} from '../src/native-scope.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'

test('independent read stages overlap within capacity, preserve order and join failures without starting queued reads',async()=>{
 const gates=Array.from({length:3},()=>Promise.withResolvers()),entered=Promise.withResolvers(),started=[]
 const work=mapIndependentReads([0,1,2],2,async n=>{started.push(n);if(started.length===2)entered.resolve();await gates[n].promise;return n})
 await entered.promise;assert.deepEqual(started,[0,1]);gates[1].resolve();await Promise.resolve();await Promise.resolve();assert.deepEqual(started,[0,1,2]);gates[2].resolve();gates[0].resolve();assert.deepEqual(await work,[0,1,2])
 const failed=Promise.withResolvers(),release=Promise.withResolvers(),all=Promise.withResolvers();let settled=false,calls=0
 const broken=mapIndependentReads([0,1,2],2,async n=>{calls++;if(n===0){await all.promise;failed.resolve();throw Error('read failed')}all.resolve();await release.promise;return n}).finally(()=>{settled=true})
 await failed.promise;await Promise.resolve();assert.equal(settled,false);assert.equal(calls,2);release.resolve();await assert.rejects(broken,/read failed/);assert.equal(calls,2)
})

test('conversation projection stages overlap with exact source/version links, deterministic reply order and no foreign binding',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let active=0,peak=0,count=0
 const query=async(kind,args)=>{
  count++
  if(kind==='router.source-current'){active++;peak=Math.max(peak,active);if(active===2)entered.resolve();await release.promise;active--;return {quote:{currentSourceId:'q-'+args.sourceId}}}
  if(kind==='router.source-links')return [{conversationId:'room',sourceId:args.sourceId,messageVersion:2,taskId:'task-'+args.sourceId,relation:'original'},{conversationId:'foreign',taskId:'secret'}]
  if(kind==='router.task-index')return {tasks:args.taskIds.map(taskId=>({taskId,requirementRevision:2,controlRevision:3})),total:args.taskIds.length}
  return {replies:[],hasMore:false}
 }
 const run=conversationContext(query,'room',{sources:[{sourceId:'a',quote:{messageId:'qa'}},{sourceId:'b',quote:{messageId:'qb'}}],router:true,readConcurrency:2})
 await entered.promise;assert.equal(peak,2);release.resolve();const result=await run
 assert.equal(result.sourceTaskLinks.length,4);assert.ok(result.sourceTaskLinks.every(x=>x.messageVersion===2));assert.equal(result.taskIndex.total,4)
 assert.deepEqual(result.replyIndex.map(x=>x.sourceId??x.taskId),['a','b','q-a','q-b','task-a','task-b','task-q-a','task-q-b'])
 assert.doesNotMatch(JSON.stringify(result),/secret|foreign/);assert.equal(count,15)
})

test('actual Router read tools overlap through Pi and Host leases; writer barrier and capacity remain enforced', {timeout:10000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let active=0,peak=0,reads=0,writes=0
 const f=await officialToolsFixture(t,async({ctx,owner})=>{
  owner.admission={current:()=>undefined}
  const query=async kind=>{
   if(kind==='router.get')return {generation:1,phase:'active'}
   if(['router.reply-history','router.source-history'].includes(kind)){
    active++;peak=Math.max(peak,active);reads++;if(reads===2)entered.resolve();if(reads<=2)await release.promise;else assert.equal(writes,1);active--;return {replies:[],sources:[]}
   }
   return []
  }
  const scoped=createScope(ctx,owner);owner.ctx=scoped.ctx
  registerResidentRouterTools(scoped.ctx,{conversationId:'room',generation:1,sessionId:owner.id},{query,command:async()=>{assert.equal(active,0);writes++;return {result:{}}},platformQuery:async()=>({}),platformConfig:()=>({}),platformScheduleList:()=>[],responsibilityFor:()=>''})
  for(const name of ['resident_task_query','resident_reply_query','resident_source_query','resident_source_get','platform_config_query','platform_schedule_list'])assert.equal(ctx.tools.executionMode({name,agent:owner,arguments:{}}).kind,'parallel')
  for(const name of ['resident_task_action','resident_router_reply','resident_router_settle','resident_dependency_evaluate','platform_task_query'])assert.equal(ctx.tools.executionMode({name,agent:owner,arguments:{}}).kind,'exclusive')
 })
 const calls=[{id:'r1',name:'resident_reply_query',args:{sourceId:'one'}},{id:'r2',name:'resident_source_query'},
  {id:'w',name:'resident_dependency_evaluate',args:{operationId:'eval',dependencyId:'d',completionEventId:'c',prerequisiteRequirementRevision:1,requirementRevision:1,controlRevision:1,arrangementRevision:1,decision:'wait',evidence:[]}},
  {id:'r3',name:'resident_reply_query',args:{sourceId:'two'}}]
 const work=f.run(calls)
 await Promise.race([entered.promise,work.then(()=>assert.fail('Router tools stopped before both reads entered: '+JSON.stringify(f.results.map(result=>result.result?.content))))])
 assert.equal(active,2);assert.equal(writes,0);assert.equal(reads,2);release.resolve();await work
 assert.equal(peak,2);assert.equal(writes,1);assert.equal(reads,3);assert.ok(f.results.every(r=>!r.isError))
})

test('Router context reuses the admitted event list and indexed source checks without rescanning the conversation',async t=>{
 let context,counts=new Map()
 const f=await officialToolsFixture(t,({ctx,owner})=>{
  const scoped=createScope(ctx,owner);owner.ctx=scoped.ctx
  ctx.get('systemPrompt').context=spec=>{context=spec}
  ctx.provide('officialAgentFactory',{parallelReadLimit:2})
  owner.admission={current:async()=>({messages:[{source:{kind:'conversation-router',conversationId:'room',generation:1,eventIds:['event']}}]})}
  registerResidentRouterTools(scoped.ctx,{conversationId:'room',generation:1,sessionId:owner.id},{query:async(kind,args)=>{
   counts.set(kind,(counts.get(kind)??0)+1)
   if(kind==='router.inbox')return [{id:'event',sourceId:'source',messageVersion:2}]
   if(kind==='source.get')return {sourceId:'source',groupId:'room',version:2,text:'Current source'}
   if(kind==='router.source-latest')return true
   if(kind==='router.source-links')return [{conversationId:'room',sourceId:'source',messageVersion:2,taskId:'task',relation:'original'}]
   if(kind==='router.task-index')return {tasks:[{taskId:'task',requirementRevision:3,controlRevision:4}],total:1}
   if(kind==='router.reply-history')return {replies:[]}
   if(kind==='task.get')return {taskId:args.taskId,groupId:'room',request:'Existing request',requirements:[],sourceRefs:[],requirementRevision:1,controlRevision:1}
  if(kind==='router.dependencies')return []
  throw Error('Unexpected '+kind)
  },responsibilityFor:()=>''})
 })
 const text=await context.officialText({actor:f.owner})
 assert.match(text,/sourceTaskLinks/);assert.equal(counts.get('router.inbox'),1);assert.equal(counts.get('source.list'),undefined);assert.equal(counts.get('router.source-latest'),1)
})
