import test from 'node:test'
import assert from 'node:assert/strict'
import {hash} from '../src/memory/format.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestText,requestTools} from './fixtures/resident-router-host.js'

const scope={kind:'bot',id:hash('bot:shared')}
const result=body=>JSON.parse(body.messages.at(-1).content)
const cases=[
  {key:'slow-readiness',initialHandoff:'核验首次加载变慢时是否发生副本扩容，不能先认定扩容就是原因。',supplementHandoff:'补充线索是只有冷启动慢；按这条线索继续核验。',decision:'update',initial:'现场反馈：首次加载慢，可能与副本扩容有关。',supplement:'补充：只有冷启动慢。请继续核实之前那条现场线索。',summary:'冷启动先等待 readiness；副本扩容是否为根因仍未确认。'},
  {key:'obsolete-retry',initialHandoff:'核验首次加载失败后固定重试三次是否能恢复。',supplementHandoff:'补充反馈是重试无效，核对原先认为重试能恢复的建议。',decision:'delete',initial:'现场反馈：固定重试三次可以解决首次加载失败。',supplement:'补充：重试无效。请核实之前的重试建议。',summary:'验证表明固定重试三次无效，不能再作为修复建议。'},
  {key:'unrelated-timeout',initialHandoff:'核对导出服务超时时导出队列的情况。',supplementHandoff:'验证另一个超时现象，范围是登录服务，不是导出队列。',decision:'keep',initial:'现场反馈：导出服务超时需要核对导出队列。',supplement:'另外验证登录服务的超时，和此前导出队列不是同一个问题。',summary:'此次登录服务验证与原导出服务线索无关。'},
]
function handoff(body){
 const input=requestEnvelope(body,'Router 交接请求：')
 if(input&&!requestTools(body).length)return {text:JSON.stringify({currentIntent:'Preserve original source and task evidence',unresolvedQuestions:[],referents:[],assumptions:[],evidenceRefs:input.requiredSourceIds.map(sourceId=>({sourceId})),cutoff:input.cutoff})}
}
function settle(input,key){return {tool:'resident_router_settle',args:{eventIds:input.events.map(event=>event.id),operationId:'reconciliation-settle:'+key}}}

// Scripted semantic choices exercise the real channel -> Pi Router -> task ->
// completion -> memory path. They do not claim a live model always picks them.
test('the global Router reconciles an existing memory after task verification without a repeated command or internal key',{timeout:nativeTestTimeout(180000)},async t=>{
 const steps=new Map(),completionSteps=new Map(),continued=new Set(),outcomes=new Map(),reads=new Map(),sources=new Map(),taskSessions=new Map(),completionCalls=new Map(),taskHandoffs=new Map()
 let h
 h=await residentRouterHost(t,async body=>{
  const transfer=handoff(body);if(transfer)return transfer
  const tools=requestTools(body)
  if(tools.includes('channel_triage_submit')){
   const input=requestEnvelope(body,'一级分诊请求：')
   return {tool:'channel_triage_submit',args:{dispositions:input.messages.map(source=>({sourceId:source.sourceId,messageVersion:source.version,needsHandling:true,reason:'Read the new evidence in its original context'}))}}
  }
  if(tools.includes('resident_router_settle')){
   const input=requestEnvelope(body,'Router 请求：'),source=input.events.find(event=>event.source)?.source
   if(source){
    const item=cases.find(row=>source.messageId===row.key+'-initial'||source.messageId===row.key+'-followup')
    const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
    if(source.messageId.endsWith('-initial')){
     sources.set(item.key,source)
     if(step===0)return {tool:'resident_memory_remember',args:{sourceId:source.sourceId,messageVersion:source.version,topic:'projects',key:item.key,expectedRevision:0,sourceQuote:source.text,memory:{summary:item.initial,why:'来源为现场反馈，尚未经独立验证。',howToApply:'仅作为同一问题的待核验排查线索，不作为已确认根因。',appliesTo:{kind:'context',description:'同一服务同一现象的排查'},evidence:[{id:'initial',source:'message',sourceId:source.sourceId,messageVersion:source.version,quote:source.text}]}}}
     if(step===1){assert.equal(result(body).persisted,true);return {tool:'resident_task_plan',args:{operationId:'plan-'+item.key,sourceId:source.sourceId,messageVersion:source.version,tasks:[{taskId:'verify-'+item.key,handoff:item.initialHandoff,title:'Verify reported symptom',objective:'Verify the reported symptom and retained evidence',requirements:['Do not treat the original report as a verified conclusion']}],dependencies:[]}}}
     if(step===2)return settle(input,source.messageId)
    }else{
     if(step===0){
      continued.add(item.key)
      const task=await h.query('task.get',{taskId:'verify-'+item.key})
      return {tool:'resident_task_action',args:{operationId:'continue-'+item.key,kind:'resume',handoff:item.supplementHandoff,taskId:task.taskId,sourceId:source.sourceId,messageVersion:source.version,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,reason:'Follow-up evidence continues the same verification'}}
     }
     if(step===1)return settle(input,source.messageId)
    }
    return {text:'Source handling committed.'}
   }
   const completion=input.events.find(event=>event.kind==='task.completed')
   if(completion){
    const item=cases.find(row=>completion.taskId==='verify-'+row.key)
    // The first round preserves the report without verifying it; only the follow-up supplies evidence.
    if(!continued.has(item.key)){
     if(body.messages.at(-1)?.role==='tool')return {text:'Initial result settled without changing memory.'}
     return settle(input,completion.id)
    }
    const step=completionSteps.get(completion.id)??0
    completionSteps.set(completion.id,step+1)
    if(step===0){
     assert.ok(tools.includes('resident_memory_review')&&tools.includes('resident_memory_reconcile'),'the production Router must expose completion-based memory maintenance')
     return {tool:'resident_memory_review',args:{taskId:completion.taskId,completionEventId:completion.taskEventId??completion.eventId,topic:'projects',key:item.key}}
    }
    if(step===1){
     const reviewed=result(body);assert.equal(reviewed.ok,true,JSON.stringify(reviewed));const read=reviewed.memory;reads.set(item.key,read)
     assert.equal(read.entries[0].key,item.key)
     const call={tool:'resident_memory_reconcile',args:{taskId:completion.taskId,completionEventId:completion.taskEventId??completion.eventId,topic:'projects',key:item.key,expectedRevision:read.entries[0].revision,decision:item.decision,reason:item.summary,...item.decision==='update'?{title:'Cold start troubleshooting',indexSummary:'Use readiness to distinguish a slow startup from a replica event.',content:{summary:item.summary,why:'后续验证区分冷启动等待与扩容根因，尚未确认后者。',howToApply:'先检查 readiness；保留原现场反馈，不把未确认扩容原因写成事实。'}}:{}}}
     completionCalls.set(item.key,call)
     return item.decision==='update'?{...call,args:{...call.args,expectedRevision:999}}:call
    }
    if(step===2&&item.decision==='update'){
     assert.equal(result(body).ok,false,'stale revision cannot overwrite existing memory')
     const current=(await h.host.ctx.memory.store.read(scope,{topic:'projects',key:item.key})).entries[0]
     assert.equal(current.revision,1,'failed update leaves the old record intact')
     return completionCalls.get(item.key)
    }
    if(step===(item.decision==='update'?3:2)){outcomes.set(item.key,result(body));return settle(input,completion.id)}
    return {text:'Reconciliation receipt inspected.'}
   }
   if(body.messages.at(-1)?.role!=='tool')return settle(input,input.events.map(event=>event.id).join(','))
   return {text:'Internal event settled.'}
  }
  if(tools.includes('task_result')){
   const input=requestText(body).toReversed().map(text=>{try{return JSON.parse(text)}catch{return null}}).find(value=>value?.task)
   const item=cases.find(row=>input.task.taskId==='verify-'+row.key)
   const ids=taskSessions.get(item.key)??new Set();ids.add(input.task.sessionId);taskSessions.set(item.key,ids)
   const handoffs=taskHandoffs.get(item.key)??[];handoffs.push(input.handoffs?.map(handoff=>handoff.text));taskHandoffs.set(item.key,handoffs)
   if(!continued.has(item.key))return {tool:'task_result',args:{decision:{action:'wait',summary:'Original report preserved; awaiting observation',evidence:['Original report is unverified'],limitations:['No validation result yet']}}}
   return {tool:'task_result',args:{decision:{action:'complete',summary:item.summary,evidence:['Read-only verification: '+item.summary],limitations:item.decision==='update'?['Expansion is not established as the root cause']:[]}}}
  }
  return {text:JSON.stringify({lessons:[]})}
 },{config:{globalRouter:true}})
 for(const item of cases){
  await h.receive(channelMessage(item.key+'-initial',{text:'记住这条现场线索，并继续核验。'+item.initial}));await h.service.whenIdle()
  const initial=await h.query('task.get',{taskId:'verify-'+item.key})
  assert.equal(initial.status,'completed');assert.deepEqual(initial.completion.result.limitations,['No validation result yet']);assert.equal(outcomes.has(item.key),false)
  const before=(await h.host.ctx.memory.store.read(scope,{topic:'projects',key:item.key,includeSources:true})).entries[0]
  assert.equal(before.revision,1)
  await h.receive(channelMessage(item.key+'-followup',{text:item.supplement,quotedMessage:{messageId:'saved-'+item.key,senderId:'assistant',text:'已保存这条现场线索。'+item.initial}}));await h.service.whenIdle()
  const outcome=outcomes.get(item.key);assert.ok(outcome,item.key);assert.equal(outcome.ok,true,JSON.stringify(outcome))
  const after=(await h.host.ctx.memory.store.read(scope,{topic:'projects',key:item.key,includeSources:true})).entries[0]
  assert.deepEqual(taskHandoffs.get(item.key),[[item.initialHandoff],[item.supplementHandoff]])
  assert.equal(taskSessions.get(item.key).size,1,'follow-up retains the original task execution session')
  assert.equal((await h.query('task.get',{taskId:'verify-'+item.key})).status,'completed')
  if(item.decision==='update'){
   assert.equal(outcome.persisted,true);assert.equal(after.revision,2);assert.match(after.text,/readiness/)
   assert.equal(outcome.entry.title,'Cold start troubleshooting');assert.match(outcome.entry.indexSummary,/readiness/)
   assert.match((await h.host.ctx.memory.store.index(scope)).markdown,/Cold start troubleshooting/)
   assert.equal(after.context.evidence[0].sourceId,sources.get(item.key).sourceId,'original report remains attributable')
   assert.notEqual(after.source.messageId,sources.get(item.key).sourceId,'completion is not impersonated as a fresh human message')
   assert.equal(after.originSource.messageId,sources.get(item.key).sourceId)
   assert.equal(after.provenance.memoryReview.kind,'task-completion')
   assert.equal(after.provenance.memoryReview.completionEventId,after.source.messageId)
   assert.equal(after.previous,undefined,'public read does not expose a full historical archive')
  }else if(item.decision==='delete'){assert.equal(outcome.persisted,true);assert.equal(after,undefined)}
  else assert.deepEqual(after,before,'surface similarity cannot modify an unrelated record')
 }
 const requests=h.requests.length
 await h.restart();await h.service.whenIdle()
 assert.equal(h.requests.length,requests,'completed reconciliation is not replayed after cold recovery')
 assert.equal((await h.host.ctx.memory.store.read(scope,{topic:'projects',key:cases[0].key})).entries[0].revision,2)
 assert.equal((await h.host.ctx.memory.store.read(scope,{topic:'projects',key:cases[1].key})).entries.length,0)
 assert.equal((await h.host.ctx.memory.store.read(scope,{topic:'projects',key:cases[2].key})).entries[0].revision,1)
})

test('completion memory tools reject missing, stale, foreign and revoked event authority before reading memory',async()=>{
 const {routerMemoryReconciliation}=await import('../src/channels/router-memory-reconciliation.js')
 const binding={conversationId:'room',generation:2,sessionId:'router-2'},agent={id:binding.sessionId,admission:{current:async()=>admission}}
 const proof={id:'completion-1',kind:'task.completed',taskId:'task-1',requirementRevision:1,controlRevision:1,commandId:'complete-command'}
 const task={taskId:'task-1',groupId:'room',sourceRefs:['source-1'],status:'completed',control:'active',requirementRevision:1,controlRevision:1,completion:{requirementRevision:1,controlRevision:1,commandId:'complete-command'}}
 const source={sourceId:'source-1',groupId:'room',actorId:'alice',messageId:'human-1',version:1,text:'original request'}
 const event={id:'inbox-1',taskId:task.taskId,kind:'task.completed',taskEventId:proof.id,taskEvent:proof}
 let admission,currentTask,currentSource,inbox,sourceVersions,reads=0,writes=0,stale=false
 const reset=()=>{admission={messages:[{source:{kind:'conversation-router',conversationId:'room',generation:2,eventIds:['inbox-1']}}]};currentTask=structuredClone(task);currentSource=structuredClone(source);inbox=[structuredClone(event)];sourceVersions=[currentSource];stale=false}
 const memory={read:async()=>{reads++;return {entries:[]}},index:async()=>{reads++;return {topics:[]}},reconcileCompletion:async(_actor,_proof,_args,validate)=>{await validate();writes++;return {ok:true}}}
 const tools=routerMemoryReconciliation({get:()=>memory},binding,{
  current:async()=>{if(stale)throw Object.assign(Error('stale'),{code:'ROUTER_GENERATION_STALE'})},
  currentEvents:async actor=>{const packet=(await actor.admission.current()).messages[0]?.source;return packet?.conversationId===binding.conversationId&&packet.generation===binding.generation?inbox.filter(row=>packet.eventIds.includes(row.id)):[]},
  query:async kind=>kind==='task.get'?currentTask:kind==='source.get'?currentSource:kind==='source.list'?sourceVersions:kind==='router.source-links'?[]:null,
 })
 const read=tools.find(t=>t.name==='resident_memory_review'),write=tools.find(t=>t.name==='resident_memory_reconcile')
 const args={taskId:task.taskId,completionEventId:proof.id,topic:'projects',key:'original',expectedRevision:1,decision:'delete',reason:'verified contradiction'}
 for(const alter of [
  ()=>{admission.messages=[]},
  ()=>{admission.messages[0].source.generation=1},
  ()=>{admission.messages[0].source.conversationId='other-room'},
  ()=>{inbox=[]},
  ()=>{currentTask.groupId='other-room'},
  ()=>{currentTask.status='running'},
  ()=>{currentTask.requirementRevision=2},
  ()=>{currentTask.controlRevision=2},
  ()=>{currentTask.completion.commandId='new-completion-command'},
  ()=>{currentTask.archiveRestoreHold=true},
  ()=>{currentSource.authorizationRevoked=true},
  ()=>{currentSource.triageHold=true},
  ()=>{currentSource.archiveRestoreHold=true},
  ()=>{sourceVersions.push({...source,sourceId:'source-2',version:2})},
  ()=>{stale=true},
 ]){
  reset();alter()
  assert.equal((await read.execute(args,{agent})).ok,false)
  assert.equal((await write.execute(args,{agent})).ok,false)
 }
 assert.equal(reads,0,'invalid evidence never reaches the memory reader')
 assert.equal(writes,0,'invalid evidence never mutates memory')
 reset();assert.equal((await read.execute(args,{agent})).ok,true);assert.equal((await write.execute(args,{agent})).ok,true)
 assert.equal(reads,1);assert.equal(writes,1)
})

test('completion reconciliation retains the existing live-actor and write-permission boundary',async()=>{
 const {reconcileCompletion}=await import('../src/memory/reconciliation.js')
 const agent={id:'router'},task={taskId:'task',groupId:'room'},proof={task,event:{id:'completed'},sources:[{sourceId:'original'}]}
 let live=true,write=true,bound=true,sourceValid=true,reads=0,validation=0
 const ports={isLive:()=>live,authorizeWrite:async()=>write}
 const memory={channelSourceContext:()=>{if(!sourceValid)throw Object.assign(Error('invalid channel source'),{code:'MEMORY_CHANNEL_SOURCE_INVALID'})},officialActors:new WeakMap([[agent,ports]]),binding:async()=>bound,actorId:()=>agent.id,host:{get:()=>({groupContext:()=>({memoryBinding:{actorId:'alice',groupId:'room',groupWrite:true}})})},store:{reconciliationReceipt:async()=>undefined,read:async()=>{reads++;return {entries:[{revision:1}]}}}}
 const args={topic:'projects',key:'record',expectedRevision:1,decision:'keep',reason:'unrelated verification'}
 for(const boundary of ['live','write','bound','actor']){
  live=true;write=true;bound=true;memory.officialActors.set(agent,ports)
  if(boundary==='live')live=false
  if(boundary==='write')write=false
  if(boundary==='bound')bound=false
  if(boundary==='actor')memory.officialActors.delete(agent)
  await assert.rejects(reconcileCompletion(memory,agent,proof,args,async()=>{validation++}),{code:'MEMORY_READ_ONLY'},boundary)
 }
 assert.equal(reads,0);assert.equal(validation,4)
 live=true;write=true;bound=true;memory.officialActors.set(agent,ports)
 sourceValid=false
 await assert.rejects(reconcileCompletion(memory,agent,proof,args,async()=>{}),{code:'MEMORY_CHANNEL_SOURCE_INVALID'})
 assert.equal(reads,0,'invalid authenticated source cannot read or modify memory')
 sourceValid=true
 assert.deepEqual(await reconcileCompletion(memory,agent,proof,args,async()=>{}),{ok:true,persisted:false,decision:'keep',revision:1})
})

test('completion write and readback failures never report a successful persisted update',async()=>{
 const {reconcileCompletion}=await import('../src/memory/reconciliation.js')
 const agent={id:'router'},proof={task:{taskId:'task',groupId:'room',sessionId:'task-session',requirementRevision:2,controlRevision:3},event:{id:'completion',result:{summary:'new verified result'}},sources:[]}
 let committed=false,failWrite=false,reads=0
 const prior={revision:1,source:{sessionId:'router-old',messageId:'source-1'},text:'old report'}
 const memory={officialActors:new WeakMap([[agent,{isLive:()=>true,authorizeWrite:async()=>true}]]),binding:async()=>true,actorId:()=>agent.id,provenance:()=>({taskId:'task'}),host:{get:()=>({groupContext:()=>({memoryBinding:{actorId:'alice',groupId:'room',groupWrite:true}})})},store:{reconciliationReceipt:async()=>undefined,read:async()=>{reads++;return {entries:[prior]}},remember:async(_scope,args)=>{await args.validate();if(failWrite)throw Object.assign(Error('storage failed'),{code:'MEMORY_WRITE_FAILED'});committed=true;return {ok:true}}}}
 const args={topic:'projects',key:'record',expectedRevision:1,decision:'update',reason:'new verification corrects the old report',content:{summary:'New verified finding',why:'Read-only check established this result',howToApply:'Use the new finding within the verified scope'}}
 failWrite=true
 await assert.rejects(reconcileCompletion(memory,agent,proof,args,async()=>{}),{code:'MEMORY_WRITE_FAILED'})
 assert.equal(committed,false);assert.equal(reads,1)
 failWrite=false;reads=0
 await assert.rejects(reconcileCompletion(memory,agent,proof,args,async()=>{}),{code:'MEMORY_WRITE_UNCONFIRMED',committed:true})
 assert.equal(committed,true);assert.equal(reads,2,'successful store receipt is checked against actual persisted content')
})

for(const decision of ['update','delete'])test(`committed ${decision} reconciliation recovers readback without replaying over later memory`,async t=>{
 const {reconcileCompletion}=await import('../src/memory/reconciliation.js')
 const {MarkdownMemoryStore}=await import('../src/memory/store.js')
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const root=await mkdtemp(join(tmpdir(),'memory-reconcile-recovery-')),store=new MarkdownMemoryStore(root)
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 const agent={id:'router'},proof={task:{taskId:'task',groupId:'room',sessionId:'task-session',requirementRevision:1,controlRevision:1},event:{id:'completion-'+decision,result:{summary:'verified result'}},sources:[]}
 const memory={officialActors:new WeakMap([[agent,{isLive:()=>true,authorizeWrite:async()=>true}]]),binding:async()=>true,actorId:()=>agent.id,provenance:()=>({taskId:'task'}),host:{get:name=>name==='channels'?{groupContext:()=>({memoryBinding:{actorId:'alice',groupId:'room',groupWrite:true}})}:undefined},store}
 await store.remember(scope,{topic:'projects',key:'record',text:'Original unverified report',source:{sessionId:'initial-router',messageId:'human-1'}})
 const args={topic:'projects',key:'record',expectedRevision:1,decision,reason:'new verification',...decision==='update'?{content:{summary:'Corrected current conclusion',why:'Evidence verified it',howToApply:'Within the verified conditions only'}}:{}}
 const read=store.read.bind(store),remember=store.remember.bind(store),forget=store.forget.bind(store)
 let reads=0,writes=0
 store.read=async(...input)=>{if(++reads===2)throw Object.assign(Error('transient readback failure'),{code:'EBUSY'});return read(...input)}
 store.remember=async(...input)=>{writes++;return remember(...input)}
 store.forget=async(...input)=>{writes++;return forget(...input)}
 await assert.rejects(reconcileCompletion(memory,agent,proof,args,async()=>{}),{code:'MEMORY_WRITE_UNCONFIRMED',committed:true})
 assert.equal(writes,1)
 store.read=read
 const recovered=await reconcileCompletion(memory,agent,proof,args,async()=>{})
 assert.equal(recovered.persisted,true);assert.equal(recovered.duplicate,true);assert.equal(writes,1,'recovery verifies the receipt rather than replaying effects')
 const reordered=Object.fromEntries(Object.entries(args).reverse())
 if(reordered.content)reordered.content=Object.fromEntries(Object.entries(reordered.content).reverse())
 assert.equal((await reconcileCompletion(memory,agent,proof,reordered,async()=>{})).duplicate,true,'JSON property order does not change retry identity')
 let entries=(await read(scope,{topic:'projects',key:'record'})).entries
 if(decision==='update')assert.equal(entries[0].revision,2)
 else assert.equal(entries.length,0)
 await assert.rejects(reconcileCompletion(memory,agent,proof,{...args,reason:'changed command'},async()=>{}),{code:'MEMORY_RECONCILIATION_CONFLICT'})
 await remember(scope,{topic:'projects',key:'record',text:'Later independent correction',source:{sessionId:'later-router',messageId:'human-2'},expectedRevision:decision==='update'?2:0})
 const later=(await read(scope,{topic:'projects',key:'record'})).entries[0]
 await assert.rejects(reconcileCompletion(memory,agent,proof,args,async()=>{}),{code:'MEMORY_WRITE_UNCONFIRMED',committed:true})
 entries=(await read(scope,{topic:'projects',key:'record'})).entries
 assert.deepEqual(entries,[later],'old completion may not replace or delete a later correction')
 assert.equal(writes,1)
})

test('store rejects conflicting concurrent reconciliation receipts inside the write transaction',async t=>{
 const {MarkdownMemoryStore}=await import('../src/memory/store.js')
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const root=await mkdtemp(join(tmpdir(),'memory-reconcile-conflict-')),store=new MarkdownMemoryStore(root)
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 for(const action of ['remember','forget']){
  const key='record-'+action
  await store.remember(scope,{topic:'projects',key,text:'Initial evidence',source:{sessionId:'initial',messageId:key}})
  const args={topic:'projects',key,text:'Revised evidence',expectedRevision:1,source:{sessionId:'task-session',messageId:'completion-'+action}}
  const outcomes=await Promise.allSettled(['a','b'].map(inputHash=>store[action](scope,{...args,reconciliation:{id:hash(key),inputHash:hash(inputHash)}})))
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1)
  assert.equal(outcomes.find(row=>row.status==='rejected')?.reason?.code,'MEMORY_RECONCILIATION_CONFLICT')
 }
})

test('authenticated Router edits only the existing memory index and refreshes its direct link',{timeout:nativeTestTimeout(90000)},async t=>{
 const topic='projects',key='fixture-memory',title='Verify release state',indexSummary='Before reporting a release, verify the exact version.'
 const steps=new Map(),outcomes=new Map()
 const h=await residentRouterHost(t,request=>{
  if(!requestTools(request).includes('resident_router_settle'))return {text:'No additional action'}
  const {events}=requestEnvelope(request,'Router 请求：'),event=events.find(item=>item.source),source=event?.source
  assert.ok(source)
  const step=steps.get(source.messageId)??0;steps.set(source.messageId,step+1)
  const create=source.messageId==='seed-index'
  if(step===0)return {tool:'resident_memory_remember',args:{topic,key,sourceId:source.sourceId,messageVersion:source.version,sourceQuote:source.text,expectedRevision:create?0:1,...create?{memory:{summary:'Report only verified release state.',why:'Avoid confusing merge with deployment.',howToApply:'Check the release state before reporting.',appliesTo:{kind:'context',description:'Release reporting'},evidence:[{id:'source',source:'message',sourceId:source.sourceId,messageVersion:source.version,quote:source.text}]}}:{title,indexSummary}}}
  if(step===1){outcomes.set(source.messageId,result(request));return {tool:'resident_router_reply',args:{operationId:'reply:'+source.messageId,sourceId:source.sourceId,messageVersion:source.version,text:'已处理这条记忆。'}}}
  if(step===2)return {tool:'resident_router_settle',args:{operationId:'settle:'+source.messageId,eventIds:events.map(item=>item.id),noTaskDispositions:[{eventId:event.id,outcome:'handled-inline',reason:'直接维护并核对记忆，无需创建任务。',sourceQuote:source.text}]}}
  return {text:'Completed directly'}
 },{strictModelDecisions:true})
 await h.receive(channelMessage('seed-index',{text:'记住发布状态只报告已核实的结果。'}));await h.service.whenIdle()
 const first=outcomes.get('seed-index')
 assert.equal(first?.persisted,true)
 const before=(await h.host.ctx.memory.store.index(scope,{topic})).entries[0]
 await h.receive(channelMessage('edit-index',{text:'把刚才的记忆标题改得清楚些，索引提示要说明核对版本，正文别改。'}));await h.service.whenIdle()
 const edit=outcomes.get('edit-index')
 assert.equal(edit?.persisted,true,JSON.stringify(edit))
 assert.equal(edit.entry.title,title)
 assert.equal(edit.entry.indexSummary,indexSummary)
 assert.equal(edit.entry.id,first.entry.id)
 assert.equal(edit.entry.path,before.path)
 assert.equal(edit.entry.text,first.entry.text)
 assert.deepEqual(edit.entry.context,first.entry.context)
 assert.deepEqual(await h.query('task.list'),[])
 await h.restart()
 const index=await h.host.ctx.memory.store.index(scope,{topic})
 assert.match(index.markdown,/Verify release state/)
 assert.equal(index.entries[0].revision,2)
})
