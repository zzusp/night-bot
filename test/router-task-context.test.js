import test from 'node:test'
import assert from 'node:assert/strict'
import {conversationContext} from '../src/channels/conversation-context.js'
import {routerTaskContext,completionReplyId} from '../src/channels/router-task-context.js'
import {routerPacketViews,sameRouterPacket} from '../src/channels/router-lifecycle.js'
const task={taskId:'task',groupId:'room',conversationId:'room',sessionId:'original-session',request:'Read only; no deployment',requirements:['Preserve the original scope'],sourceRefs:['source'],status:'completed',requirementRevision:2,controlRevision:3,completion:{commandId:'complete-command',requirementRevision:2,controlRevision:3,summary:'Verified fixture',result:{summary:'Verified fixture',evidence:['proof:fixture'],limitations:['No live check']}}}
const event={id:'inbox',kind:'task.completed',taskId:'task',taskEventId:'event',taskEvent:{id:'event',kind:'task.completed',taskId:'task',commandId:'complete-command',requirementRevision:2,controlRevision:3,result:task.completion.result}}
const fixture=({links=[{sourceId:'source',messageVersion:1,taskId:'task',conversationId:'room'}],patch={}}={})=>async(kind,args)=>{
 if(kind==='router.source-links')return links
 if(kind==='router.task-index')return {tasks:[task],total:1}
 if(kind==='task.get')return {...structuredClone(task),...patch}
 if(kind==='router.dependencies')return []
 if(kind==='router.source-current')return {sourceId:args.sourceId,conversationId:'room',version:1,messageId:'message',actorId:'actor'}
 if(kind==='router.reply-history')return {replies:[],hasMore:false,nextCursor:null}
 throw Error(kind)
}
test('current unique source bindings project original continuation evidence; absent/ambiguous/stale bindings never guess',async()=>{
 const args={router:true,sources:[{sourceId:'source',version:1}]}
 const current=await conversationContext(fixture(),'room',args)
 assert.equal(current.taskMatches[0].status,'matched');assert.equal(current.taskHandoffs[0].task.sessionId,'original-session');assert.equal(current.taskHandoffs[0].request,task.request)
 for(const [links,status] of [[[],'unmatched'],[[{sourceId:'source',messageVersion:2,taskId:'task',conversationId:'room'}],'unmatched'],[[{sourceId:'source',messageVersion:1,taskId:'task',conversationId:'room'},{sourceId:'source',messageVersion:1,taskId:'other',conversationId:'room'}],'ambiguous']]){
  const context=await conversationContext(fixture({links}),'room',args);assert.equal(context.taskMatches[0].status,status);assert.deepEqual(context.taskHandoffs,[])
 }
 const forbidden=await routerTaskContext(fixture({patch:{groupId:'other'}}),'room','task');assert.equal(forbidden.status,'unavailable');assert.equal(forbidden.request,undefined)
 const truncated=await routerTaskContext(fixture({patch:{request:'x'.repeat(5000)}}),'room','task');assert.equal(truncated.request.length,2048);assert.equal(truncated.requiresFullRead,true)
})
test('completion evidence binds exact current command and versions, exposes limits and exact source receipt selector',async()=>{
 const view=await routerTaskContext(fixture(),'room','task',{completionEvent:event})
 assert.equal(view.completion.status,'current');assert.deepEqual(view.completion.result.limitations,['No live check'])
 assert.equal(view.completion.sources[0].completionReply.notificationId,completionReplyId('room','event','source',1))
 for(const patch of [{groupId:'other'},{status:'active'},{archiveRestoreHold:true},{archivedAt:'fixture-archive'},{requirementRevision:3},{controlRevision:4},{completion:{...task.completion,commandId:'another'}}]){
  const invalid=await routerTaskContext(fixture({patch}),'room','task',{completionEvent:event});assert.notEqual(invalid.completion?.status,'current')
 }
})
test('new completion packets are bounded projections; old v1 remains reconstructible and hidden-field mutation stays fenced',()=>{
 const original=structuredClone(event);original.taskEvent.result={...original.taskEvent.result,evidence:Array.from({length:100},(_,i)=>'ref:'+i+'x'.repeat(1000)),privateExtra:'not-needed'.repeat(1000)}
 const views=routerPacketViews({id:'room',generation:1},[original])
 assert.equal(views.length,4);assert.equal(views[0].source.modelViewVersion,2);assert.equal(views[1].source.modelViewVersion,1)
 assert.ok(Buffer.byteLength(views[0].content[0].text)<10000);assert.ok(views[0].content[0].text.includes('truncated'))
 assert.ok(views[1].content[0].text.includes('privateExtra'),'retained v1 packet is reconstructible, never rewritten')
 const changed=structuredClone(original);changed.taskEvent.result.privateExtra='different'
 assert.equal(sameRouterPacket(views[0],routerPacketViews({id:'room',generation:1},[changed])[0]),false)
 assert.deepEqual(event.taskEvent.result,task.completion.result)
})
