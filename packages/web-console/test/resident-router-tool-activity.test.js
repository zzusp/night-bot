import assert from 'node:assert/strict'
import test from 'node:test'
import {routerSessionView,routerSessionMessageView} from '../server/session-view.js'

const router={id:'conversation',activeSessionId:'pi-router',generation:7,phase:'active'}
const project=(id,message)=>({sourceEntry:{id,type:'message',timestamp:'2026-11-24T01:00:00Z',message},messages:[message]})
const call=(id,name,args)=>project('call-'+id,{role:'assistant',content:[{type:'toolCall',name,id,arguments:args}]})
const result=(id,toolName,value,isError=false)=>project('result-'+id,{role:'toolResult',toolName,toolCallId:id,isError,content:[{type:'text',text:JSON.stringify(value)}]})
const makeOptions=entries=>{
  const snapshot={header:{id:router.activeSessionId,runtimeOwner:'conversation-router',conversationId:router.id,generation:7},entries:[{id:'commit'}],context:{projection:{entries}}}
  return {conversationId:router.id,readRouter:async()=>router,persistence:{readNative:async()=>snapshot}}
}
const rows=page=>page.items.filter(row=>row.kind==='tool-result')
const settle='resident_router_settle'

test('historical settle projects a successful same-generation receipt and requested counts, not task/delivery or submitted text',async()=>{
  const details={eventIds:['PRIVATE_FIRST','PRIVATE_FIRST','PRIVATE_SECOND'],operationId:'PRIVATE_OP',
    noTaskDispositions:[{eventId:'PRIVATE_FIRST',outcome:'handled-inline',sourceQuote:'PRIVATE_ORIGINAL',reason:'PRIVATE_REASON'},{eventId:'PRIVATE_SECOND',outcome:'context-only'}],
    inspectionReviews:[{taskId:'PRIVATE_TASK',decision:'wait',reason:'PRIVATE_INSPECTION'}]}
  const envelope={result:{conversation:{id:router.id,generation:7,cursor:42,secret:'PRIVATE_CONVERSATION',activeSessionId:'PRIVATE_SESSION'}},
    dispatchEligible:false}
  const options=makeOptions([call('ok',settle,details),result('ok',settle,envelope),call('wrong',settle,details),result('wrong',settle,{result:{conversation:{...envelope.result.conversation,generation:8}}}),
    result('orphan',settle,envelope),call('failed',settle,details),result('failed',settle,envelope,true)])
  const page=await routerSessionView(options)
  const [success,wrong,orphan,failure]=rows(page)
  const expected={requestedEventCount:2,dispositions:{'handled-inline':1,'context-only':1},inspectionReviews:{wait:1}}
  assert.deepEqual(JSON.parse(page.items.find(row=>row.kind==='tool-call').text),expected)
  assert.deepEqual(JSON.parse(success.text),{settled:true,...expected})
  assert.match(wrong.text,/缺少可核对的回执/); assert.match(orphan.text,/没有唯一配对/); assert.equal(failure.status,'error')
  assert.doesNotMatch(JSON.stringify(page),/PRIVATE_|dispatchEligible|cursor|generation\\"|已送达/)
  const full=await routerSessionMessageView({...options,messageId:success.id,revision:page.revision})
  assert.deepEqual(JSON.parse(full.text),{settled:true,...expected})
  await assert.rejects(routerSessionView({...options,guard:async()=>{throw Object.assign(new Error('revoked'),{code:'SESSION_PAGE_STALE'})}}),{code:'SESSION_PAGE_STALE'})
})

test('Router communication tools expose statuses and counts without queried messages, quotes, identities or pagination cursors',async()=>{
  const list='resident_source_query',get='resident_source_get',query='resident_reply_query',reply='resident_router_reply',operator='resident_operator_reply'
  const entries=[
    call('source-list',list,{keyword:'PRIVATE_SEARCH',limit:10,cursor:12}),
    result('source-list',list,{backgroundOnly:true,sources:[{conversationId:router.id,timestamp:'2026-11-24T01:00:00Z',text:'PRIVATE_SOURCE',quote:{text:'PRIVATE_QUOTE'},hasAttachments:true},{conversationId:'foreign',timestamp:'2020-01-01T00:00:00Z'}],hasMore:true,nextCursor:53}),
    call('source-get',get,{sourceId:'PRIVATE_ORIGINAL'}),
    result('source-get',get,{conversationId:router.id,sourceId:'PRIVATE_SOURCE_ID',text:'PRIVATE_SOURCE',resources:[{path:'PRIVATE_PATH'}],taskIds:['PRIVATE_TASK'],quote:{status:'current',text:'PRIVATE_QUOTE'}}),
    call('query',query,{notificationId:'PRIVATE_NOTIFICATION',limit:10}),
    result('query',query,{hasMore:false,replies:[{kind:'router-reply',state:'delivered',text:'PRIVATE_QUERY_TEXT',deliveredAt:'2026-11-24T01:03:00.000Z'}]}),
    call('reply',reply,{sourceId:'PRIVATE_ID',text:'已经核对',recipientActorIds:['PRIVATE_ACTOR'],replyPurpose:'task-update'}),
    result('reply',reply,{notification:{state:'prepared',payload:{conversationId:router.id,replyPurpose:'task-update',recipientActorIds:['PRIVATE_ACTOR'],text:'PRIVATE_FROZEN'}}}),
    call('unsafe',reply,{text:'不应变成业务消息'}),
    result('unsafe',reply,{notification:{state:'prepared',payload:{conversationId:'foreign',text:'PRIVATE_OTHER'}}}),
    call('operator',operator,{eventId:'PRIVATE_EVENT',text:'网页回复'}),
    result('operator',operator,{result:{accepted:true,webOnly:true,reused:true,text:'原网页回复',secret:'PRIVATE_SECRET'}}),
  ]
  const page=await routerSessionView(makeOptions(entries)), [listed,got,queried,replied,foreign,web]=rows(page)
  assert.deepEqual(JSON.parse(listed.text),{sourceCount:1,hasMore:true,sources:[{timestamp:'2026-11-24T01:00:00Z',hasAttachments:true}]})
  assert.deepEqual(JSON.parse(got.text),{status:'current',attachmentCount:1,associatedTaskCount:1,quoteStatus:'current'})
  assert.deepEqual(JSON.parse(queried.text),{replyCount:1,hasMore:false,replies:[{kind:'router-reply',state:'delivered',deliveredAt:'2026-11-24T01:03:00.000Z'}]})
  assert.deepEqual(JSON.parse(replied.text),{accepted:true,state:'prepared',replyPurpose:'task-update',recipientCount:1})
  assert.match(foreign.text,/缺少可核对/)
  assert.deepEqual(JSON.parse(web.text),{result:{accepted:true,webOnly:true,reused:true,text:'原网页回复'}})
  assert.deepEqual(page.items.filter(row=>row.kind==='router-reply').map(row=>row.text),['已经核对','原网页回复'])
  assert.doesNotMatch(JSON.stringify(page),/PRIVATE_|nextCursor|2020-01-01/)
})

test('malformed Router reply and mixed attachment blocks do not break history or expose attachment payload',async()=>{
  const reply='resident_router_reply', operator='resident_operator_reply', attachment='resident_web_attachment'
  const malformed=call('malformed',reply,null)
  const malformedOperator=call('malformed-operator',operator,['PRIVATE_RAW_ARGUMENT'])
  const image=project('image-result',{role:'toolResult',toolName:attachment,toolCallId:'image',isError:false,content:[
    {type:'text',text:JSON.stringify({name:'C:\\private\\evidence.png',mediaType:'image/png',text:'PRIVATE_BODY',note:'PRIVATE_NOTE'})},
    {type:'image',data:'PRIVATE_BASE64',mimeType:'image/png'},
  ]})
  const page=await routerSessionView(makeOptions([malformed,malformedOperator,call('image',attachment,{index:0,messageVersion:3,sourceId:'PRIVATE_SOURCE'}),image]))
  assert.equal(page.status,'ready')
  assert.equal(page.items.filter(row=>row.kind==='tool-call').length,3)
  assert.equal(page.items.filter(row=>row.kind==='router-reply').length,0)
  assert.deepEqual(JSON.parse(rows(page)[0].text),{name:'evidence.png',mediaType:'image/png'})
  assert.doesNotMatch(JSON.stringify(page),/PRIVATE_|\\\\private/)
})

test('only exact admitted Router packet contributes ordered types to settlement',async()=>{
  const op='private-settle-operation', sourceId='private-message', missing='private-missing', taskId='private-task-event', actualTaskId='private-task', foreignTaskId='private-foreign-task'
  const events=[{id:sourceId,kind:'source.message',sourceId:'private-source-id',messageVersion:1,source:{conversationId:router.id,text:'channel input',sourceId:'private-source-id',version:1,timestamp:'2026-11-24T01:00:00Z'}},
    {id:taskId,kind:'task.completed',taskId:actualTaskId,taskEventId:'private-completed',taskEvent:{id:'private-completed',taskId:actualTaskId,result:{summary:'PRIVATE_COMPLETION_BODY'}}},
    {id:'foreign',kind:'task.completed',taskId:foreignTaskId,taskEventId:'private-foreign-completed',taskEvent:{id:'private-foreign-completed',taskId:foreignTaskId}}]
  const source={kind:'conversation-router',conversationId:router.id,generation:7,eventIds:events.map(event=>event.id)}
  const details={source,packetId:'private-packet'}
  const content=[{type:'text',text:'Router 请求：'+JSON.stringify({conversationId:router.id,generation:7,events})}]
  const packet={sourceEntry:{type:'custom_message',customType:'night.business-input',details,content,id:'entry'},messages:[{role:'custom',customType:'night.business-input',details,content}]}
  const receipt={result:{conversation:{id:router.id,generation:7,cursor:5}}}
  const args={operationId:op,eventIds:[taskId,missing,sourceId,'foreign'],noTaskDispositions:[{eventId:sourceId,outcome:'context-only',reason:'PRIVATE_REASON'}]}
  const options=makeOptions([packet,call('same',settle,args),result('same',settle,receipt)])
  options.readRouterTasks=async()=>[{taskId:actualTaskId,groupId:router.id,title:'Visible work'},{taskId:foreignTaskId,groupId:'other-room',title:'PRIVATE_FOREIGN_TITLE'}]
  const snapshot=await options.persistence.readNative()
  snapshot.audit=[
    {domain:'admission',version:1,kind:'enqueued',payload:{id:details.packetId,source,content}},
    {domain:'admission',version:1,kind:'admitted',payload:{id:details.packetId,entryId:'entry'}},
  ]
  const projected=rows(await routerSessionView(options))[0]
  assert.deepEqual(JSON.parse(projected.text).events,[{recorded:true,kind:'task.completed',title:'Visible work'},{recorded:false},
    {recorded:true,kind:'source.message',at:'2026-11-24T01:00:00Z',snippet:'channel input',disposition:'context-only'},
    {recorded:true,kind:'task.completed'}])
  assert.doesNotMatch(projected.text,/private-|PRIVATE_/)
  events[0].source.authorizationRevoked=true
  content[0].text='Router 请求：'+JSON.stringify({conversationId:router.id,generation:7,events})
  assert.equal(JSON.parse(rows(await routerSessionView(options))[0].text).events[2].snippet,undefined)
  snapshot.audit[1].payload.entryId='not-this-entry'
  assert.equal(JSON.parse(rows(await routerSessionView(options))[0].text).events,undefined)
})
