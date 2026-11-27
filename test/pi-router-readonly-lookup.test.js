import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {decodePiJournal,piJournalFilename} from '../src/runtime/pi-journal.js'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText,eventually} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
const call=(tool,args)=>({tool,args})
const input=body=>requestEnvelope(body,'Router 请求：')
const system=body=>body.messages.filter(row=>['system','developer'].includes(row.role)).map(row=>row.content).join('\n')
const done=body=>body.messages.at(-1)?.role==='tool'&&body.messages.findLast(row=>row.role==='assistant')?.tool_calls?.at(-1)?.function?.name==='resident_router_settle'

test('real readonly lookup returns asynchronously to same Router after second message; no task execution or direct subagent send',{timeout:nativeTestTimeout(45000)},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let h,requested=false,lookupCalls=0,secondHandled=false,completion,lookupId
 h=await residentRouterHost(t,async body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){lookupCalls++;assert.match(system(body),/快照没有原始依据时，不写成已确认的门槛/);assert.deepEqual(requestTools(body),[]);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_OTHER_ROOM|PRIVATE_USER_SOURCE/);entered.resolve();await release.promise;return {text:JSON.stringify({summary:'The retained task is paused; no execution was started.',limitations:[]})}}
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  const result=packet.events.find(event=>event.kind==='router.lookup.completed')
  if(result&&!completion){
   const prompt=body.messages.filter(row=>['system','developer'].includes(row.role)).map(row=>row.content).join('\n')
   assert.match(prompt,/结合当前可见的新消息判断快照是否仍适用。仍适用就短答，已过时不要当现状转达/u)
  }
  if(result){assert.equal(secondHandled,true,JSON.stringify(result));assert.equal(result.sourceId,undefined);assert.equal(result.source,undefined);if(!completion){completion=result;return call('resident_router_reply',{operationId:'answer-result',sourceId:result.lookupResult.sourceId,messageVersion:result.lookupResult.messageVersion,text:'The retained task is paused; no execution was started.',replyPurpose:'task-update'})}return call('resident_router_settle',{operationId:'settle-result',eventIds:packet.events.map(event=>event.id)})}
  const event=packet.events.find(event=>event.source)
  if(event?.source.messageId==='lookup'&&!requested){assert.match(system(body),/线上排查、需查\/分析代码/);assert.match(system(body),/缺少某人同意的记录，不等于需要那个人批准/);assert.match(system(body),/不要在回复、派发或后续汇报中继承/);requested=true;return call('resident_task_lookup_async',{operationId:'lookup-existing',sourceId:event.sourceId,messageVersion:event.messageVersion,taskIds:['existing-task']})}
  if(event?.source.messageId==='lookup'){
   const value=JSON.parse(body.messages.at(-1).content);lookupId=value.lookupId
   return call('resident_router_settle',{operationId:'settle-request',eventIds:packet.events.map(event=>event.id),noTaskDispositions:[{eventId:event.id,outcome:'async-query',lookupId,sourceQuote:event.source.text,reason:'Accepted durable read-only lookup; result follows separately'}]})
  }
  if(event?.source.messageId==='second')secondHandled=true
  return call('resident_router_settle',{operationId:'settle:'+packet.events.map(event=>event.id),eventIds:packet.events.map(event=>event.id)})
 })
 await h.receive(channelMessage('register'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('register')).sessionId
 await h.store.command({id:'seed-existing',kind:'task.create',args:{taskId:'existing-task',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'seed-paused',kind:'task.control',args:{taskId:'existing-task',control:'paused',expectedControlRevision:1}})
 await h.service.whenIdle()
 const before=await h.query('task.get',{taskId:'existing-task'}),executions=(await h.query('execution.list')).length
 await h.receive(channelMessage('lookup',{text:'Please read the existing task status. PRIVATE_USER_SOURCE'}));await entered.promise
 await h.service.whenIdle();assert.equal(lookupCalls,1);assert.equal(h.sent.length,0)
 await h.receive(channelMessage('second',{text:'Unrelated background while the slow lookup is pending.'}));await h.service.whenIdle();assert.equal(secondHandled,true)
 assert.equal(completion,undefined);release.resolve()
 await eventually(()=>completion,'durable lookup result returned without new input');await h.service.whenIdle()
 assert.equal(completion.lookupResult.state,'completed');assert.match(completion.lookupResult.summary,/paused/);assert.equal(completion.lookupResult.snapshots,undefined);const stored=await h.query('router.action',{conversationId,operationId:(await import('../src/channels/resident-router-business.js')).residentOperationId(conversationId,'lookup-existing')});assert.equal(stored.result.lookup.result.snapshots[0].leaseEpoch,before.leaseEpoch)
 assert.equal((await h.query('task.list')).length,1);assert.equal((await h.query('execution.list')).length,executions);assert.deepEqual(await h.query('task.get',{taskId:'existing-task'}),before);assert.equal(h.sent.length,1);assert.equal(h.results.filter(row=>row.name==='resident_router_reply'&&!row.result.isError).length,1)
 const count=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,count);assert.equal(lookupCalls,1)
})

test('accepted-but-not-launched lookup becomes one interrupted event on restart without new input or model work',{timeout:nativeTestTimeout(30000)},async t=>{
 let lookupCalls=0,result
 const h=await residentRouterHost(t,body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){lookupCalls++;return {text:'Should not run'}}
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  result??=packet.events.find(event=>event.kind==='router.lookup.completed')
  return call('resident_router_settle',{operationId:'settle:'+packet.events.map(event=>event.id).join(','),eventIds:packet.events.map(event=>event.id)})
 })
 await h.receive(channelMessage('orphan'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('orphan')).sessionId,source=(await h.query('source.list')).find(source=>source.messageId==='orphan'),row=await h.query('router.get',{conversationId})
 await h.store.command({id:'orphan-task',kind:'task.create',args:{taskId:'retained-orphan',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'orphan-task-paused',kind:'task.control',args:{taskId:'retained-orphan',control:'paused',expectedControlRevision:1}})
 await h.store.command({id:'accepted-before-crash',kind:'router.lookup.submit',args:{conversationId,generation:row.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'orphan-lookup',taskIds:['retained-orphan']}})
 await h.restart();await h.service.whenIdle()
 assert.equal(result.lookupResult.state,'interrupted');assert.equal(lookupCalls,0);assert.equal(h.sent.length,0)
 const requests=h.requests.length;await h.restart();await h.service.whenIdle();assert.equal(h.requests.length,requests)
})

test('lookup timeout cancels its isolated provider, returns a durable result and ignores a late response',{timeout:nativeTestTimeout(30000)},async t=>{
 const {createRouterReadonlyLookups}=await import('../src/channels/router-readonly-lookup.js')
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());let fire,queryTurns=0
 const h=await residentRouterHost(t,async body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){queryTurns++;entered.resolve();await release.promise;return {text:JSON.stringify({summary:'Must not replace timeout',limitations:[]})}}
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  return call('resident_router_settle',{operationId:'settle:'+packet.events.map(event=>event.id),eventIds:packet.events.map(event=>event.id)})
 })
 await h.receive(channelMessage('timeout-source'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('timeout-source')).sessionId,source=(await h.query('source.list')).find(row=>row.messageId==='timeout-source'),row=await h.query('router.get',{conversationId})
 await h.store.command({id:'timeout-task',kind:'task.create',args:{taskId:'timeout-existing',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'timeout-paused',kind:'task.control',args:{taskId:'timeout-existing',control:'paused',expectedControlRevision:1}})
 const query=(kind,args={})=>h.query(kind,args),command=(kind,args,id)=>h.store.command({kind,args,id})
 let notices=0
 const worker=createRouterReadonlyLookups({ctx:h.host.ctx,query,command,models:()=>h.config.model,schedule:()=>{notices++;return Promise.resolve()},setTimer:fn=>{fire=fn;return {unref(){}}},clearTimer:()=>{}})
 t.after(()=>worker.close())
 const receipt=await worker.submit({conversationId,generation:row.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'timeout-operation',taskIds:['timeout-existing']})
 await entered.promise;fire()
 await eventually(async()=> (await h.query('router.action',{conversationId,operationId:'timeout-operation'})).result.lookup.state==='timed-out','fixed timeout completion')
 const retry=await worker.submit({conversationId,generation:row.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'timeout-operation',taskIds:['timeout-existing']});assert.equal(retry.status,'timed-out')
 await worker.close();release.resolve()
 assert.equal(queryTurns,1);assert.equal(notices,1)
 const action=await h.query('router.action',{conversationId,operationId:'timeout-operation'});assert.equal(action.result.lookup.result,undefined);assert.equal(action.result.lookup.id,receipt.lookupId)
 assert.equal(h.sent.length,0)
})

test('two lookups from one Router run together; overflow is durable and skips expired work',{timeout:nativeTestTimeout(55000)},async t=>{
 const {createRouterReadonlyLookups}=await import('../src/channels/router-readonly-lookup.js')
 const started=[],released=Array.from({length:3},()=>Promise.withResolvers())
 let active=0,peak=0
 t.after(()=>{for(const gate of released)gate.resolve()})
 const h=await residentRouterHost(t,async body=>{
  if(requestText(body).some(text=>text.includes('NIGHT_ROUTER_TASK_LOOKUP'))){
   const index=started.length;started.push(index);active++;peak=Math.max(peak,active)
   assert.deepEqual(requestTools(body),[]);await released[index].promise;active--
   return {text:JSON.stringify({summary:'Current snapshot '+index,limitations:[]})}
  }
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  return call('resident_router_settle',{operationId:'queue-settle:'+packet.events.map(event=>event.id).join(','),eventIds:packet.events.map(event=>event.id)})
 })
 const conversationId=h.host.ctx.channels.identity(channelMessage('queue-a')).sessionId
 for(const id of ['queue-a','queue-b','queue-c','queue-d'])await h.receive(channelMessage(id));await h.service.whenIdle()
 const sources=(await h.query('source.list')).filter(s=>['queue-a','queue-b','queue-c','queue-d'].includes(s.messageId)).sort((a,b)=>a.messageId.localeCompare(b.messageId))
 const router=await h.query('router.get',{conversationId})
 await h.store.command({id:'queue-task',kind:'task.create',args:{taskId:'queue-existing',groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'queue-paused',kind:'task.control',args:{taskId:'queue-existing',control:'paused',expectedControlRevision:1}})
 const task=await h.query('task.get',{taskId:'queue-existing'}),notifications=[]
 const query=(kind,args={})=>h.query(kind,args),command=(kind,args,id)=>h.store.command({kind,args,id})
 let clockOffset=0
 const worker=createRouterReadonlyLookups({ctx:h.host.ctx,query,command,models:()=>h.config.model,schedule:cid=>notifications.push(cid),now:()=>Date.now()+clockOffset})
 t.after(()=>worker.close())
 const args=sources.map((source,i)=>({conversationId,generation:router.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'queue-operation-'+i,taskIds:['queue-existing']}))
 const receipts=[];for(const arg of args)receipts.push(await worker.submit(arg))
 assert.equal(receipts.length,4);assert.equal(new Set(receipts.map(r=>r.lookupId)).size,4);assert.ok(receipts.every(r=>r.readOnly&&r.status==='pending'))
 await eventually(()=>started.length===2,'two queries reached the provider')
 await worker.recover();assert.equal((await query('router.lookup.pending')).length,4);assert.equal(started.length,2)
 assert.deepEqual(await worker.submit(args[2]),receipts[2])
 released[0].resolve();await eventually(()=>started.length===3,'third query started when its slot freed')
 assert.equal(peak,2);clockOffset=31000;released[1].resolve();released[2].resolve()
 await eventually(()=>notifications.length===4,'all completion events durably enqueued')
 assert.equal(started.length,3);assert.ok(notifications.every(cid=>cid===conversationId));assert.deepEqual(await query('router.lookup.pending'),[])
 for(const [index,arg] of args.entries()){
  const row=await query('router.action',{conversationId,operationId:arg.operationId})
  assert.equal(row.result.lookup.id,receipts[index].lookupId);assert.equal(row.result.lookup.sourceId,arg.sourceId)
  if(index===3){assert.equal(row.result.lookup.state,'timed-out');assert.equal(row.result.lookup.result,undefined)}
  else{assert.equal(row.result.lookup.state,'completed');assert.equal(row.result.lookup.result.snapshots[0].taskId,'queue-existing')}
 }
 await worker.close();assert.deepEqual(await query('task.get',{taskId:'queue-existing'}),task);assert.equal(h.sent.length,0)
})

test('queued lookups time out independently and an unresponsive read does not hang shutdown',{timeout:nativeTestTimeout(55000)},async t=>{
 const {createRouterReadonlyLookups}=await import('../src/channels/router-readonly-lookup.js')
 const h=await residentRouterHost(t,async body=>{
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  return call('resident_router_settle',{operationId:'deadline-settle:'+packet.events.map(event=>event.id).join(','),eventIds:packet.events.map(event=>event.id)})
 })
 const gate=Promise.withResolvers(),lateAdmission=Promise.withResolvers(),admissionReading=Promise.withResolvers(),started=[],notifications=[],timers=[]
 t.after(()=>{gate.resolve();lateAdmission.resolve()})
 const ids=['deadline-a','deadline-b','deadline-c','deadline-d','deadline-e']
 const conversationId=h.host.ctx.channels.identity(channelMessage(ids[0])).sessionId
 for(const id of ids)await h.receive(channelMessage(id))
 await h.service.whenIdle()
 const sources=(await h.query('source.list')).filter(s=>ids.includes(s.messageId)).sort((a,b)=>a.messageId.localeCompare(b.messageId))
 const router=await h.query('router.get',{conversationId})
 const worker=createRouterReadonlyLookups({ctx:h.host.ctx,
  query:async(kind,args)=>{
   if(kind==='router.source-current'){started.push(args.sourceId);return gate.promise}
   if(kind==='router.action'&&args.operationId==='deadline-operation-4'){admissionReading.resolve();await lateAdmission.promise}
   return h.query(kind,args)
  },
  command:(kind,args,id)=>h.store.command({kind,args,id}),
  models:()=>h.config.model,schedule:cid=>notifications.push(cid),
  setTimer:fire=>{const timer={fire,cleared:false};timers.push(timer);return timer},
  clearTimer:timer=>{timer.cleared=true},
 })
 t.after(()=>worker.close())
 const args=sources.map((s,i)=>({conversationId,generation:router.generation,sourceId:s.sourceId,messageVersion:s.version,operationId:'deadline-operation-'+i}))
 for(const a of args.slice(0,4))assert.equal((await worker.submit(a)).status,'pending')
 assert.deepEqual(started,args.slice(0,2).map(a=>a.sourceId))
 assert.equal(timers.length,4)
 timers[0].fire();timers[2].fire()
 await eventually(()=>notifications.length===2,'the first lookup and waiting lookup both publish timeouts')
 const status=a=>h.query('router.action',{conversationId,operationId:a.operationId}).then(row=>row.result.lookup.state)
 assert.deepEqual(await Promise.all(args.slice(0,4).map(status)),['timed-out','pending','timed-out','pending'])
 assert.deepEqual(started,args.slice(0,2).map(a=>a.sourceId),'timed-out work retains its execution slots until exit')
 const late=worker.submit(args[4]);await admissionReading.promise
 const closing=worker.close();lateAdmission.resolve()
 assert.equal((await late).status,'pending')
 await closing
 assert.deepEqual(await Promise.all(args.map(status)),['timed-out','interrupted','timed-out','interrupted','interrupted'])
 assert.equal(timers[3].cleared,true)
 assert.equal(h.host.ctx.get('jobs').list().filter(job=>job.kind==='router-readonly-lookup').length,0)
 gate.resolve({version:1,text:'a delayed result'})
 await Promise.resolve()
 assert.equal(notifications.length,2)
})

const hash=value=>createHash('sha256').update(value).digest('hex')

async function installLegacyLookupCheckpoint(file,sessionId,packetId,legacyIdentity){
 const lines=(await readFile(file,'utf8')).trimEnd().split('\n').map(JSON.parse)
 const [header,...entries]=lines
 let previous=null, batch=[], found=0
 for(const entry of entries){
  const receipt=entry.customType==='night.audit'&&entry.data.domain==='admission'&&entry.data.kind==='enqueued'&&entry.data.payload.id===packetId
  const input=entry.customType==='night.business-input'&&entry.details.packetId===packetId
  if(receipt||input){
   const source=receipt?entry.data.payload.source:entry.details.source
   assert.notEqual(source.ledgerIdentity,legacyIdentity)
   source.ledgerIdentity=legacyIdentity
   found++
  }
  if(entry.customType==='night.commit'){
   entry.data.entriesHash=hash((previous===null?JSON.stringify(header)+'\n':'')+batch.map(row=>JSON.stringify(row)).join('\n'))
   previous=entry.id
   batch=[]
  }else batch.push(entry)
 }
 assert.equal(found,2,'the admission receipt and Pi input both carry the old identity')
 const contents=Buffer.from(lines.map(row=>JSON.stringify(row)).join('\n')+'\n')
 decodePiJournal(contents,sessionId,{requireComplete:true})
 await writeFile(file,contents)
}

for(const legacy of [false,true])test(legacy
 ? 'Router cold recovery accepts a committed old lookup packet with its progress-only identity'
 : 'Router resumes its original timed-out lookup batch without another message or repeated effects',{timeout:nativeTestTimeout(45000)},async t=>{
 const taskId='timeout-retained-task',answer='The retained task is still paused.',operationId='lookup-before-router-timeout'
 let h,source,lookupId,completedId,reads=0,timeouts=0,submits=0,replies=0
 h=await residentRouterHost(t,async body=>{
  if(system(body).includes('NIGHT_ROUTER_TASK_LOOKUP。')){reads++;return {text:JSON.stringify({summary:answer,limitations:[]})}}
  if(!requestTools(body).includes('resident_router_settle')||done(body))return {text:'Done'}
  const packet=input(body),event=packet.events.find(e=>e.source?.messageId==='timeout-question')
  if(requestText(body).some(text=>text.includes('继续处理未完成的事项'))){
   const prefix='Router 请求：'
   const result=requestText(body).flatMap(text=>text.split('\n')).filter(line=>line.startsWith(prefix))
    .flatMap(line=>JSON.parse(line.slice(prefix.length)).events).find(e=>e.kind==='router.lookup.completed')
   assert.equal(result?.id,completedId);assert.equal(result.lookupResult.lookupId,lookupId)
   if(!replies++)return call('resident_router_reply',{operationId:'reply-after-timeout',sourceId:source.sourceId,messageVersion:source.messageVersion,text:result.lookupResult.summary,replyPurpose:'task-update'})
   return call('resident_router_settle',{operationId:'settle-after-timeout',eventIds:[source.id,completedId],noTaskDispositions:[{eventId:source.id,outcome:'async-query',lookupId,sourceQuote:source.source.text,reason:'Completed the already accepted lookup'}]})
  }
  if(event){
   source=event
   if(!submits++)return call('resident_task_lookup_async',{operationId,sourceId:source.sourceId,messageVersion:source.messageVersion,taskIds:[taskId]})
   lookupId??=JSON.parse(body.messages.at(-1).content).lookupId
   assert.ok(lookupId)
   const result=await eventually(async()=> (await h.query('router.inbox',{conversationId,deliverable:true})).find(e=>e.lookupResult?.lookupId===lookupId),'lookup completes before Router timeout')
   completedId=result.id
   timeouts++;return {errorStatus:504,error:'fixture gateway timeout'}
  }
  return call('resident_router_settle',{operationId:'settle:'+packet.events[0].id,eventIds:packet.events.map(e=>e.id)})
 },{hostOptions:{hostConfig:config=>{
  config.providers.fixture.retry={enabled:true,maxRetries:1,baseDelayMs:1,provider:{maxRetries:0}}
  return config
 }}})
 const conversationId=h.host.ctx.channels.identity(channelMessage('register-timeout')).sessionId
 await h.receive(channelMessage('register-timeout'));await h.service.whenIdle()
 await h.store.command({id:'seed-timeout-task',kind:'task.create',args:{taskId,groupId:conversationId,conversationId,ownerActorId:'alice',request:'Retained task'}})
 await h.store.command({id:'pause-timeout-task',kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:1}})
 await h.service.recover();await h.service.whenIdle()
 assert.deepEqual(await h.query('router.inbox',{conversationId,deliverable:true}),[])
 const before=await h.query('task.get',{taskId}),executions=await h.query('execution.list')
 await h.receive(channelMessage('timeout-question'))
 const router=await eventually(async()=>{const row=await h.query('router.get',{conversationId});return row?.timeoutContinuation&&row},'Router defers its timed-out input')
 const events=()=>h.query('router.batch-events',{conversationId,eventIds:[source.id,completedId]})
 const waiting=await events()
 assert.deepEqual(waiting.map(e=>e.state),['pending','pending']);assert.equal(waiting[0].progressOnly,true)
 assert.equal(timeouts,2)
 await h.service.whenIdle().catch(error=>{assert.equal(error.code,'ROUTER_BATCH_UNSETTLED')})
 const {packetId,failedEntryId}=router.timeoutContinuation
 let legacyIdentity
 if(legacy){
  const {stages,...originalSource}=waiting[0].source
  assert.equal(waiting[0].triageReply,undefined)
  // Former compact-packet identity, when the ledger flag was already present
  // at enqueue. Only the durable admission and Pi envelope encoding differs.
  legacyIdentity=hash(JSON.stringify({conversationId,generation:router.generation,events:[{...waiting[0],source:originalSource}]}))
  const file=join(h.host.ctx.runtimePaths.state,'sessions',piJournalFilename(router.activeSessionId))
  await h.close();await h.host.close()
  await installLegacyLookupCheckpoint(file,router.activeSessionId,packetId,legacyIdentity)
  await h.restart()
 }else{
  // Periodic service recovery, without a new inbound message.
  const recovered=await h.service.recover()
  assert.deepEqual((await events()).map(e=>e.state),['consumed','consumed'],JSON.stringify(recovered))
 }
 await h.service.whenIdle()
 const after=await h.query('router.get',{conversationId})
 const notices=(await h.query('notification.list')).filter(n=>n.payload?.sourceId===source.sourceId)
 assert.equal(notices.length,1);assert.equal(notices[0].state,'delivered');assert.ok(notices[0].receipt)
 assert.deepEqual(h.sent.map(e=>e.text),[answer]);assert.equal(reads,1)
 assert.equal(h.results.filter(row=>row.name==='resident_task_lookup_async'&&!row.result.isError).length,1)
 assert.equal(after.activeSessionId,router.activeSessionId);assert.equal(after.generation,router.generation);assert.equal(after.timeoutContinuation,undefined)
 assert.deepEqual(await h.query('task.get',{taskId}),before);assert.deepEqual(await h.query('execution.list'),executions)
 const {entries}=await h.host.ctx.sessionPersistence.readNative(after.activeSessionId,{requireComplete:true})
 assert.deepEqual((await events()).map(e=>e.state),['consumed','consumed'])
 const originalInputs=entries.filter(e=>e.customType==='night.business-input'&&e.details?.packetId===packetId)
 assert.equal(originalInputs.length,1)
 if(legacy)assert.equal(originalInputs[0].details.source.ledgerIdentity,legacyIdentity,'recovery keeps the original journal input')
 assert.equal(entries.filter(e=>e.customType==='night.router-resume-claim'&&e.details?.failedEntryId===failedEntryId).length,1)
})

test('a pasted answer about work in another conversation does not select a merely similar local task',{timeout:nativeTestTimeout(30000)},async t=>{
 const foreignTask='foreign-roster-audit',localTask='local-gateway-audit',quotedAnswer='值班表核对因超时中断。还缺每个仓库的值班人。'
 let question,result,lookupId,selected=0,summarized=0
 const h=await residentRouterHost(t,body=>{
  if(system(body).includes('NIGHT_ROUTER_TASK_LOOKUP_SELECT')){selected++;return {text:JSON.stringify({taskIds:[localTask]})}}
  if(system(body).includes('NIGHT_ROUTER_TASK_LOOKUP。')){summarized++;return {text:JSON.stringify({summary:'网关日志检查仍在等待。',limitations:[]})}}
  if(!requestTools(body).includes('resident_router_settle')||done(body))return {text:'Done'}
  const packet=input(body),event=packet.events[0]
  if(event.lookupResult){
   if(!result){result=event.lookupResult;return call('resident_router_reply',{sourceId:result.sourceId,messageVersion:result.messageVersion,operationId:'answer-pasted-quote',text:result.summary,replyPurpose:'task-update'})}
  }else if(event.source?.messageId==='copied-answer'){
   if(!question){question=event;return call('resident_task_lookup_async',{operationId:'lookup-pasted-quote',sourceId:event.sourceId,messageVersion:event.messageVersion})}
   lookupId=JSON.parse(body.messages.at(-1).content).lookupId
   return call('resident_router_settle',{operationId:'settle-pasted-quote',eventIds:[event.id],noTaskDispositions:[{eventId:event.id,outcome:'async-query',lookupId,sourceQuote:event.source.text,reason:'Resolve the referenced task'}]})
  }
  return call('resident_router_settle',{operationId:'settle:'+event.id,eventIds:packet.events.map(e=>e.id)})
 })
 const foreign=channelMessage('foreign-notice',{conversationId:'other-room',text:quotedAnswer}),local=channelMessage('register-local')
 const foreignId=h.host.ctx.channels.identity(foreign).sessionId,conversationId=h.host.ctx.channels.identity(local).sessionId
 for(const [taskId,groupId,title] of [[foreignTask,foreignId,'值班表核对'],[localTask,conversationId,'排查网关请求超时']]){
  await h.store.command({id:'seed:'+taskId,kind:'task.create',args:{taskId,groupId,conversationId:groupId,ownerActorId:'alice',title,request:title}})
  await h.store.command({id:'pause:'+taskId,kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:1}})
 }
 await h.receive(foreign);await h.receive(local);await h.service.whenIdle()
 assert.equal(h.sent.length,0)
 await h.receive(channelMessage('copied-answer',{text:`“${quotedAnswer}”这条消息对应的超时也是模型超时吗？`}))
 await eventually(()=>h.sent.length===1,'the copied question receives a source-bound reply')
 await h.service.whenIdle()
 const lookup=await h.query('router.action',{conversationId,operationId:(await import('../src/channels/resident-router-business.js')).residentOperationId(conversationId,'lookup-pasted-quote')})
 assert.equal(result.state,'completed');assert.equal(result.lookupId,lookupId)
 assert.deepEqual(lookup.result.lookup.result.snapshots,[])
 assert.match(h.sent[0].text,/任务名或链接/)
 assert.equal(selected,0);assert.equal(summarized,0)
})

test('an explicit task name in the question can override the quoted task',{timeout:nativeTestTimeout(30000)},async t=>{
 const quotedTask='quoted-task-a',namedTask='named-task-b',origin=channelMessage('plan-quoted',{text:'创建甲任务'})
 let h,lookupId,result,selection,submitted=false
 h=await residentRouterHost(t,body=>{
  if(system(body).includes('NIGHT_ROUTER_TASK_LOOKUP_SELECT')){
   selection=JSON.parse(body.messages.at(-1).content)
   return {text:JSON.stringify({taskIds:[namedTask]})}
  }
  if(system(body).includes('NIGHT_ROUTER_TASK_LOOKUP。'))return {text:JSON.stringify({summary:'Task snapshot.',limitations:[]})}
  if(requestTools(body).includes('task_result'))return call('task_result',{decision:{action:'complete',summary:'A completed.',evidence:['fixture'],limitations:[]}})
  if(!requestTools(body).includes('resident_router_settle')||done(body))return {text:'Done'}
  const packet=input(body),e=packet.events.find(event=>event.source?.messageId==='ask-about-b')??packet.events[0]
  result??=packet.events.find(event=>event.lookupResult)?.lookupResult
  if(e.source?.messageId==='plan-quoted'&&body.messages.at(-1)?.role!=='tool'){
   return call('resident_task_plan',{operationId:'plan-quoted-task',sourceId:e.sourceId,messageVersion:e.messageVersion,
    tasks:[{taskId:quotedTask,title:'甲发布',objective:'Run fixture A',handoff:'Run fixture A.',requirements:[]}],dependencies:[]})
  }
  if(e.source?.messageId==='ask-about-b'){
   if(!submitted){submitted=true;return call('resident_task_lookup_async',{operationId:'lookup-named',sourceId:e.sourceId,messageVersion:e.messageVersion})}
   const receipt=h.results.findLast(row=>row.name==='resident_task_lookup_async')
   assert.equal(receipt?.result.isError,false,JSON.stringify(receipt))
   lookupId=receipt.result.value.lookupId
   return call('resident_router_settle',{operationId:'settle-named',eventIds:packet.events.map(event=>event.id),noTaskDispositions:[{eventId:e.id,outcome:'async-query',lookupId,sourceQuote:e.source.text,reason:'Query task named in the question'}]})
  }
  return call('resident_router_settle',{operationId:'settle:'+e.id,eventIds:packet.events.map(event=>event.id)})
 })
 const conversationId=h.host.ctx.channels.identity(origin).sessionId
 await h.receive(origin);await h.service.whenIdle()
 const original=(await h.query('source.list')).find(s=>s.messageId===origin.messageId)
 assert.deepEqual((await h.query('router.source-current',{conversationId,sourceId:original.sourceId,includeTaskIds:true})).taskIds,[quotedTask])
 await h.store.command({id:'seed-named-task',kind:'task.create',args:{taskId:namedTask,groupId:conversationId,conversationId,ownerActorId:'alice',title:'乙迁移',request:'乙迁移'}})
 await h.store.command({id:'pause-named-task',kind:'task.control',args:{taskId:namedTask,control:'paused',expectedControlRevision:1}})
 await eventually(async()=>(await h.query('task.get',{taskId:quotedTask})).status==='completed','quoted task completes')
 await h.service.recover();await h.service.whenIdle()
 await h.receive(channelMessage('ask-about-b',{text:'不是引用的那个，我问乙迁移做到哪了？',
  quotedMessage:{messageId:origin.messageId,senderId:origin.senderId,text:origin.text}}))
 await eventually(()=>result,'named task lookup result reaches Router')
 await h.service.whenIdle()
 assert.equal(result.lookupId,lookupId)
 const {residentOperationId}=await import('../src/channels/resident-router-business.js')
 const record=await h.query('router.action',{conversationId,operationId:residentOperationId(conversationId,'lookup-named')})
 assert.deepEqual(record.result.lookup.result.snapshots.map(({taskId})=>taskId),[namedTask])
 assert.deepEqual(new Set(selection.candidates.map(({taskId})=>taskId)),new Set([quotedTask,namedTask]))
})

test('closing lookup service ignores a rejected submit but reports a late accepted result write failure',async t=>{
 const {Context}=await import('@deepseek-ai/cordis')
 const {default:NativeJobs}=await import('../src/native-jobs.js')
 const {createRouterReadonlyLookups}=await import('../src/channels/router-readonly-lookup.js')
 for(const accepted of [false,true]){
  const ctx=new Context();ctx.logger={warn(){}};new NativeJobs(ctx)
  t.after(()=>ctx.fiber.dispose())
  const gate=Promise.withResolvers(),failure=Object.assign(new Error('fixture'),{code:accepted?'FIXTURE_LOOKUP_WRITE_FAILED':'ROUTER_LOOKUP_SOURCE_ALREADY_SUBMITTED'})
  const work=createRouterReadonlyLookups({ctx,command:async(kind,args)=>{
   if(kind==='router.lookup.submit'){await gate.promise;if(!accepted)throw failure;return}
   assert.equal(kind,'router.lookup.complete');assert.equal(args.status,'interrupted')
   throw failure
  },query:async kind=>{
   assert.equal(kind,'router.action')
   return {result:{lookup:{id:'late-lookup',conversationId:'room',state:'pending',deadlineAt:new Date(Date.now()+30000).toISOString()}}}
  },schedule:()=>assert.fail('closing cannot wake Router')})
  const submitted=work.submit({conversationId:'room',operationId:'before-close'})
  const closing=work.close()
  const submitRejected=assert.rejects(submitted,error=>error===failure)
  const drained=accepted?assert.rejects(closing,error=>error.message==='ROUTER_LOOKUP_DRAIN_FAILED'&&error.errors[0]===failure):closing
  gate.resolve()
  await Promise.all([submitRejected,drained])
  assert.deepEqual(ctx.jobs.list(),[])
 }
})

test('cancelling a live lookup writes its result and immediately wakes only the original Router',{timeout:nativeTestTimeout(30000)},async t=>{
 const {createRouterReadonlyLookups}=await import('../src/channels/router-readonly-lookup.js')
 const h=await residentRouterHost(t,body=>{
  if(!requestTools(body).includes('resident_router_settle')||done(body))return {text:'Done'}
  const packet=input(body)
  return call('resident_router_settle',{operationId:'settle:'+packet.events[0].id,eventIds:packet.events.map(event=>event.id)})
 })
 const message=channelMessage('cancel-live-lookup'),conversationId=h.host.ctx.channels.identity(message).sessionId
 await h.receive(message);await h.service.whenIdle()
 const source=(await h.query('source.list')).find(s=>s.messageId===message.messageId)
 const router=await h.query('router.get',{conversationId}),gate=Promise.withResolvers(),wakes=[]
 const jobs=h.host.ctx.get('jobs')
 const worker=createRouterReadonlyLookups({ctx:h.host.ctx,query:(kind,args)=>kind==='router.source-current'?gate.promise:h.query(kind,args),
  command:(kind,args,id)=>h.store.command({kind,args,id}),schedule:id=>wakes.push(id)})
 t.after(async()=>{gate.resolve({version:source.version,text:source.text});await worker.close()})
 const receipt=await worker.submit({conversationId,generation:router.generation,sourceId:source.sourceId,messageVersion:source.version,operationId:'cancel-live'})
 const [job]=jobs.list().filter(job=>job.kind==='router-readonly-lookup')
 assert.equal(jobs.kill(job.id,undefined,'fixture live cancellation'),'requested')
 const event=await eventually(async()=>(await h.query('router.inbox',{conversationId})).find(e=>e.lookupResult?.lookupId===receipt.lookupId),'cancelled lookup enters original inbox')
 assert.equal(event.lookupResult.sourceId,source.sourceId)
 assert.equal(event.lookupResult.messageVersion,source.version)
 assert.equal(event.lookupResult.state,'timed-out')
 await eventually(()=>wakes.length===1,'live cancellation wakes Router without waiting for polling')
 assert.deepEqual(wakes,[conversationId])
 gate.resolve({version:source.version,text:source.text})
 await worker.close()
 assert.equal((await h.query('router.inbox',{conversationId})).filter(e=>e.lookupResult?.lookupId===receipt.lookupId).length,1)
 assert.equal(wakes.length,1)
})

test('date-based arrangement question without a task reference uses the durable readonly lookup',{timeout:nativeTestTimeout(45000)},async t=>{
 const completions=new Map(),replied=new Set();let workers=0
 const timezone='Asia/Shanghai',localDay=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'short'}).format(new Date())
 const h=await residentRouterHost(t,body=>{
  if(system(body).includes('NIGHT_ROUTER_ARRANGEMENT_LOOKUP')){
   workers++
   const facts=JSON.parse(requestText(body).at(-1))
   assert.deepEqual(requestTools(body),[])
   assert.deepEqual(facts.range,{day:localDay,through:localDay,timezone})
   assert.deepEqual(facts.records.map(row=>row.title),facts.question.includes('归档核对')?['客户巡检安排','另一个任务']:['客户巡检安排'])
   assert.equal(facts.records[0].kind,'created')
   return {text:JSON.stringify({matches:facts.question.includes('巡检')?[1]:[],uncertain:false})}
  }
  if(!requestTools(body).includes('resident_router_settle'))return {text:'No work'}
  const packet=input(body);if(done(body))return {text:'Settled'}
  const result=packet.events.find(event=>event.kind==='router.lookup.completed')?.lookupResult
  if(result&&!replied.has(result.sourceId)){
   completions.set(result.sourceId,result);replied.add(result.sourceId)
   return call('resident_router_reply',{operationId:'arrangement-answer:'+result.sourceId,sourceId:result.sourceId,messageVersion:result.messageVersion,text:result.summary,replyPurpose:'task-update'})
  }
  const event=packet.events.find(event=>['today-matching','today-no-match','today-partial','empty-day'].includes(event.source?.messageId))
  if(event){
   const last=body.messages.at(-1)
   if(last.role==='tool'){
    const {lookupId}=JSON.parse(last.content)
    return call('resident_router_settle',{operationId:'arrangement-settle:'+event.sourceId,eventIds:packet.events.map(row=>row.id),noTaskDispositions:[{eventId:event.id,outcome:'async-query',lookupId,sourceQuote:event.source.text,reason:'Read arrangement records without task dispatch.'}]})
   }
   assert.match(system(body),/按日期|日期范围/)
   return call('resident_task_lookup_async',{operationId:'arrangement:'+event.sourceId,sourceId:event.sourceId,messageVersion:event.messageVersion,arrangement:{day:event.source.messageId==='empty-day'?'2020-01-01':'today'}})
  }
  return call('resident_router_settle',{operationId:'settle-date:'+packet.events.map(event=>event.id).join(','),eventIds:packet.events.map(event=>event.id),noTaskDispositions:packet.events.filter(event=>event.source).map(event=>({eventId:event.id,outcome:'context-only',sourceQuote:event.source.text,reason:'Setup message not requesting work.'}))})
 },{config:{timezone},strictModelDecisions:true})

 await h.receive(channelMessage('register-date'));await h.service.whenIdle()
 const conversationId=h.host.ctx.channels.identity(channelMessage('register-date')).sessionId
 for(const [taskId,groupId,title] of [['arranged-task',conversationId,'客户巡检安排'],['other-room','private-room','PRIVATE_OTHER_ROOM']]){
  await h.store.command({id:'seed-'+taskId,kind:'task.create',args:{taskId,groupId,ownerActorId:'alice',request:title}})
  await h.store.command({id:'pause-'+taskId,kind:'task.control',args:{taskId,control:'paused',expectedControlRevision:1}})
 }
 await h.service.whenIdle()
 const tasks=await h.query('task.list'),executions=await h.query('execution.list')
 await h.receive(channelMessage('today-matching',{text:'今天有没有安排过巡检？'}))
 await eventually(()=>h.sent.length===1,'matching arrangement response')
 await h.receive(channelMessage('today-no-match',{text:'今天有没有安排过费用汇总？'}))
 await eventually(()=>h.sent.length===2,'nonmatching arrangement response')
 await h.service.whenIdle()
 assert.deepEqual(await h.query('task.list'),tasks);assert.deepEqual(await h.query('execution.list'),executions)
 await h.store.command({id:'seed-clipped',kind:'task.create',args:{taskId:'clipped',groupId:conversationId,ownerActorId:'alice',title:'另一个任务',request:'不完整的目标。'.repeat(100)}})
 await h.store.command({id:'pause-clipped',kind:'task.control',args:{taskId:'clipped',control:'paused',expectedControlRevision:1}})
 await h.service.whenIdle()
 const moreTasks=await h.query('task.list'),moreExecutions=await h.query('execution.list')
 await h.receive(channelMessage('today-partial',{text:'今天有没有安排过归档核对？'}))
 await eventually(()=>h.sent.length===3,'partial arrangement response')
 await h.receive(channelMessage('empty-day',{text:'2020年1月1日有没有安排过任务？'}))
 await eventually(()=>h.sent.length===4,'empty date response')
 await h.service.whenIdle()
 assert.equal(workers,3,'a date with no records is answered from the store without a model call')
 assert.deepEqual(await h.query('task.list'),moreTasks);assert.deepEqual(await h.query('execution.list'),moreExecutions)
 const results=[...completions.values()]
 assert.deepEqual(results.map(result=>result.state),['completed','completed','completed','completed'])
 assert.match(results[0].summary,/查到1条.*客户巡检安排/)
 assert.match(results[1].summary,/没有查到匹配/)
 assert.match(results[2].summary,/已查记录没有明确匹配，不能确认没有安排/)
 assert.match(results[2].limitations[0],/缺少完整/)
 assert.match(results[3].summary,/2020-01-01.*本渠道没有记录到任务安排/)
 assert.deepEqual([results[0],results[1],results[3]].map(result=>result.limitations),[[],[],[]])
})
