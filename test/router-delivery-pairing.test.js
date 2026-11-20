import test from 'node:test'
import assert from 'node:assert/strict'
import {registerResidentRouterTools} from '../src/channels/resident-router-business.js'
import {completionReplyId} from '../src/channels/router-task-context.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {createScope} from '../src/native-scope.js'
for(const variant of ['both-completions','only-a','explicit-mismatch','retained-mismatch','explicit-retained-mismatch'])test('attachment task B and completion binding: '+variant,async t=>{
 const source={sourceId:'shared',groupId:'g',conversationId:'g',messageId:'original',version:1,actorId:'requester',channel:'im',text:'Synthetic common source'}
 const task=id=>({taskId:id,groupId:'g',conversationId:'g',ownerActorId:id==='a'?'alice':'bob',sourceRefs:['shared'],status:'completed',control:'active',requirementRevision:1,controlRevision:1,completion:{commandId:'completed-'+id,requirementRevision:1,controlRevision:1,result:{summary:'Synthetic '+id}}})
 const event=id=>({id:'inbox-'+id,kind:'task.completed',taskId:id,taskEventId:'event-'+id,taskEvent:{id:'event-'+id,kind:'task.completed',taskId:id,commandId:'completed-'+id,requirementRevision:1,controlRevision:1}})
 const events=variant==='both-completions'?[event('a'),event('b')]:[event('a')],selection={taskId:'b',requirementRevision:1,artifactIds:['b-file']}
 const binding={eventId:'event-a',taskId:'a',commandId:'completed-a',requirementRevision:1,controlRevision:1}
 const id=completionReplyId('g','event-a','shared',1),frozen={id,kind:'status',payload:{sourceId:'shared',taskDelivery:selection,completionBinding:binding,text:'Synthetic frozen legacy reply'},requestDigest:'UNCHANGED'}
 let scope;const calls=[]
 const f=await officialToolsFixture(t,({ctx,owner})=>{
  scope=createScope(ctx,owner);owner.ctx=scope.ctx
  registerResidentRouterTools(scope.ctx,{conversationId:'g',generation:1,sessionId:owner.id},{responsibilityFor:()=>'',query:async(kind,args)=>{
   if(kind==='router.get')return {generation:1,phase:'active'}
   if(kind==='source.get'||kind==='router.source-current')return source
   if(kind==='router.source-latest')return true
   if(kind==='router.inbox')return events
   if(kind==='task.get')return task(args.taskId)
   if(kind==='router.reply-history')return {replies:[]}
   if(kind==='notification.get')return variant.includes('retained-mismatch')&&args.notificationId===id?frozen:null
   return []
  },prepareReply:async args=>{calls.push(args);return {notification:variant.includes('retained-mismatch')?frozen:{id:args.outboundId,payload:{completionBinding:args.completionBinding,taskDelivery:args.taskDelivery}}}}})
 });f.deferCleanup(()=>scope.dispose());f.owner.admission={current:()=>({messages:[{source:{kind:'conversation-router',conversationId:'g',generation:1,modelViewVersion:2,eventIds:events.map(e=>e.id)}}]})}
 const before=structuredClone(frozen),args={operationId:'delivery-b',sourceId:'shared',messageVersion:1,text:'Synthetic delivery',taskDelivery:selection,...variant.startsWith('explicit-')?{completionEventId:'event-a'}:{}}
 if(variant==='explicit-mismatch'){
  await assert.rejects(f.ctx.tools.get('resident_router_reply',f.owner).execute(args,{agent:f.owner}),{code:'TASK_DELIVERY_COMPLETION_MISMATCH'});assert.equal(calls.length,0);return
 }
 const result=await f.ctx.tools.get('resident_router_reply',f.owner).execute(args,{agent:f.owner})
 assert.equal(calls.length,1)
 if(variant==='both-completions')assert.equal(calls[0].completionBinding.taskId,'b')
 if(variant==='only-a')assert.equal(calls[0].completionBinding,undefined,'B attachment must never auto-bind A')
 if(variant.includes('retained-mismatch')){assert.equal(calls[0].outboundId,id);assert.deepEqual(result.notification,before);assert.deepEqual(frozen,before)}
})
