import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {taskSessionView} from '../packages/web-console/server/session-view.js'
import {executionContext} from '../src/tasks/execution-context.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestText,requestTools,eventually} from './fixtures/resident-router-host.js'

for(const mode of ['completed','waiting','running','racing'])test('operator input is accepted once into the exact existing '+mode+' Pi task, with native files and no channel reply',{timeout:nativeTestTimeout(60000)},async t=>{
 const taskId='direct-input-task',followup='  Follow up directly in the existing execution, using the local note.\n'
 const active=['running','racing'].includes(mode)
 const content='synthetic task note',requestId='direct-input-1'
 const started=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 let original,runs=0,modelAttachment,muted=0,initialReply=false,h
 const routed=[]
 h=await residentRouterHost(t,async body=>{
  const tools=requestTools(body)
  if(tools.includes('task_result')){
   const messages=requestText(body)
   runs++
   if(runs===1&&active){started.resolve();await release.promise;return {tool:'read',args:{path:'work/synthetic-missing.txt'}}}
   if(runs>1&&!modelAttachment){
    const input=messages.filter(text=>text.startsWith('{')).map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.updates?.some(row=>row.text===followup))
    if(mode==='racing'&&!input)return {text:'Return from the old turn without a conclusion.'}
    assert.ok(input,'actual Pi receives the direct Web update')
    modelAttachment=input.materials?.flatMap(mat=>mat.resources??[]).find(resource=>resource.file?.name==='note.txt')
    assert.equal(modelAttachment?.status,'read')
   }
   if(runs===1&&mode==='waiting')return {error:'400 litellm.ContentPolicyViolationError: fixture content policy'}
   return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic result',evidence:[],limitations:[]}}}
  }
  if(!tools.includes('resident_router_settle'))return {text:'No Router action'}
  const input=requestEnvelope(body,'Router 请求：')
  routed.push(...input.events.filter(event=>event.source).map(event=>event.source.text))
  const last=body.messages.findLast(message=>message.role==='assistant')
  if(body.messages.at(-1)?.role==='tool'&&last?.tool_calls?.at(-1)?.function?.name==='resident_router_settle')return {text:'Settled'}
  if(!original){
   original=input.events.find(event=>event.source).source
   return {tool:'resident_task_plan',args:{operationId:'plan',sourceId:original.sourceId,messageVersion:original.version,
    tasks:[{taskId,title:'Isolated input check',objective:'Check fixture',requirements:[],handoff:'Check fixture.'}],dependencies:[]}}
  }
  const initial=input.events.find(event=>event.kind==='task.completed'&&!event.suppressChannelOutcome)
  if(initial&&!initialReply){
    initialReply=true
    return {tool:'resident_router_reply',args:{operationId:'baseline-outcome',outcomeEventId:initial.taskEventId,sourceId:original.sourceId,messageVersion:original.version,text:'Initial verification complete'}}
  }
  const quiet=input.events.find(event=>event.suppressChannelOutcome)
  if(quiet&&muted++===0)return {tool:'resident_router_reply',args:{operationId:'blocked-original-channel',outcomeEventId:quiet.taskEventId,sourceId:original.sourceId,messageVersion:original.version,text:'Must stay web only'}}
  return {tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(event=>event.id).join(','),eventIds:input.events.map(event=>event.id)}}
 },{strictModelDecisions:true})
 await h.receive(channelMessage('direct-input-original'));if(active)await started.promise;else await h.service.whenIdle()
 const task=await h.query('task.get',{taskId}); assert.equal(runs,1);assert.equal(task.status,mode==='completed'?'completed':'active');const originalCount=h.sent.length
 const attachment=await h.host.ctx.attachments.saveFile({name:'note.txt',data:Buffer.from(content)})
 const args={taskId,sessionId:task.sessionId,requestId,text:followup,attachments:[{type:'file',name:'note.txt',mediaType:'text/plain',attachment}]}
 await assert.rejects(h.service.sendTaskInput({...args,sessionId:'different-pi'}),{code:'TASK_INPUT_SESSION_STALE'})
 const acceptance=h.service.sendTaskInput(args)
 let receipt
 try{
  if(mode==='racing'){
   await eventually(async()=>await h.service.taskInputReceipt({taskId,requestId}),'direct input durably committed before existing model finishes',t.signal)
   release.resolve()
  }
  receipt=await acceptance
 }finally{release.resolve()}
 assert.deepEqual(receipt,{taskId,requestId,sessionId:task.sessionId,status:'accepted'})
 assert.deepEqual(await h.service.sendTaskInput(args),receipt)
 assert.deepEqual(await h.service.taskInputReceipt({taskId,requestId}),receipt)
 await assert.rejects(h.service.sendTaskInput({...args,text:'different payload'}),{code:'DYNAMIC_COMMAND_ID_CONFLICT'})
 await h.service.whenIdle()
 const finished=await h.query('task.get',{taskId})
 assert.equal(finished.sessionId,task.sessionId)
 assert.equal(finished.status,'completed')
 if(mode==='running')assert.equal(finished.leaseEpoch,task.leaseEpoch,'live follow-up uses the active Pi lease without restart')
 if(mode==='racing')assert.ok(runs>=2)
 else assert.equal(runs,2)
 assert.equal(await readFile(modelAttachment.path,'utf8'),content)
 assert.ok(!routed.includes(followup),'direct operator message is never submitted to Router')
 assert.equal(h.sent.length,originalCount)
 assert.ok(h.results.some(row=>row.name==='resident_router_reply'&&row.result.isError&&JSON.stringify(row.result).includes('ROUTER_CHANNEL_OUTCOME_SUPPRESSED')))
 const history=()=>taskSessionView({task:finished,persistence:h.host.ctx.sessionPersistence,
   readTaskInputIds:sessionId=>h.query('task.web-input-history',{taskId,sessionId})})
 const projected=await history()
 assert.deepEqual(projected.items.filter(row=>row.requestId).map(row=>[row.requestId,row.text]),[[requestId,followup]])
 assert.deepEqual(await h.query('task.web-input-history',{taskId,sessionId:'different-pi'}),[])
 assert.deepEqual(await h.query('task.web-input-history',{taskId:'unrelated-task',sessionId:task.sessionId}),[])
 await h.restart();assert.deepEqual(await h.service.taskInputReceipt({taskId,requestId}),receipt)
})

test('cold projection delivers accepted reopen and follow-up in order, excluding already admitted or unsigned inputs',()=>{
 const taskId='task-1'
 const origin=(id,task=taskId)=>({sourceId:id,version:1,text:id+' message',channel:'web',requestIdentity:{kind:'task-input',action:{taskId:task}}})
 const update=(id,contextRevision)=>({id,text:id+' message',contextRevision,requirementRevision:2,webTaskInput:{sourceId:id,messageVersion:1,controlRevision:3}})
 const updates=[update('reopen',1),update('supplement',2),update('other-task',3)]
 const task={taskId,requirementRevision:2,controlRevision:3,contextRevision:3,metadata:{routerInputPolicy:'faithful-handoff-v1'},supplements:updates}
 const inputs={task,sources:[origin('reopen'),origin('supplement'),origin('other-task','different-task')]}
 const {updates:both}=executionContext(inputs)
 assert.deepEqual(both.map(row=>[row.id,row.text]),[['reopen','reopen message'],['supplement','supplement message']])
 const audit=[{domain:'admission',kind:'enqueued',payload:{id:'already-admitted',source:{kind:'task-input'},
  content:[{text:JSON.stringify({task:{contextRevision:1},updates:both.slice(0,1)})}]}},
 {domain:'admission',kind:'admitted',payload:{id:'already-admitted'}}]
 assert.deepEqual(executionContext(inputs,audit).updates,both.slice(1))
})
