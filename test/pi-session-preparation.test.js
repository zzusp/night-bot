import test from 'node:test'
import assert from 'node:assert/strict'
import {residentRouterHost,channelMessage,requestEnvelope,requestTools,requestText} from './fixtures/resident-router-host.js'
import {nativeTestTimeout} from './fixtures/native-lifecycle.js'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
const triage=body=>requestEnvelope(body,'一级分诊请求：')
const router=body=>requestEnvelope(body,'Router 请求：')
const submit=input=>({tool:'channel_triage_submit',args:{dispositions:input.messages.map(s=>({sourceId:s.sourceId,messageVersion:s.version,needsHandling:true,reason:'Synthetic current request',handoff:{assignment:'explicit',summary:'明确只读合成事项，优先匹配原任务。'}}))}})
const settle=input=>({tool:'resident_router_settle',args:{operationId:'settle:'+input.events.map(e=>e.id).join(','),eventIds:input.events.map(e=>e.id)}})

test('real task preparation overlaps independent ledger reads after claim while retaining a single execution session',{timeout:nativeTestTimeout(30000)},async t=>{
 let claimed=false,active=0,peak=0,planned=false;const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(names.includes('channel_triage_submit'))return submit(triage(body))
  if(names.includes('resident_router_settle')){const input=router(body);if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Synthetic settled'};if(!planned){planned=true;const event=input.events[0];return {tool:'resident_task_plan',args:{operationId:'plan',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'overlap-task',handoff:'Check the synthetic fixture without writing.',title:'Synthetic preparation',objective:'Synthetic read only',requirements:[]}],dependencies:[]}}}return settle(input)}
  if(names.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic task completed',evidence:['fixture'],limitations:[]}}}
  return {text:'No other work'}
 },{hostOptions:{hostConfig:{maxParallelToolCalls:2}},wrapStore:store=>({...store,command:async c=>{const result=await store.command(c);if(c.kind==='task.claim'&&c.args.taskId==='overlap-task')claimed=true;return result},query:async q=>{
  if(claimed&&q.taskId==='overlap-task'&&['operation.list','execution.list'].includes(q.kind)){
   active++;peak=Math.max(peak,active);if(active===2)entered.resolve();await release.promise;active--
  }
  return store.query(q)
 }})})
 t.signal.addEventListener('abort',()=>release.resolve(),{once:true})
 const received=h.receive(channelMessage('prepare'));await entered.promise;assert.equal(active,2);release.resolve();await received;await h.service.whenIdle()
 assert.equal(peak,2);const task=await h.query('task.get',{taskId:'overlap-task'});assert.equal(task.status,'completed');assert.equal(task.runSequence,1)
 assert.deepEqual(await h.query('execution.list',{taskId:task.taskId}),[])
})

test('a claimed task revalidates the journal route after preparing its sources', {timeout:nativeTestTimeout(30000)}, async t=>{
 const taskId='changed-journal-route';let h,planned=false,claimed=false,changed=false,taskRequests=0
 h=await residentRouterHost(t,body=>{
  const names=requestTools(body)
  if(names.includes('task_result')){taskRequests++;return {text:'Unexpected task request'}}
  if(!names.includes('resident_router_settle'))return {text:'No other work'}
  if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Synthetic settled'}
  const input=router(body),event=input.events.find(row=>row.source)
  if(event&&!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'changed-route-plan',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId,title:'Check synthetic task',objective:'Read only',requirements:[],handoff:event.source.text}],dependencies:[]}}}
  return settle(input)
 },{config:{retryIntervalMs:600000},wrapStore:store=>({...store,
  command:async c=>{const receipt=await store.command(c);if(c.kind==='task.claim'&&c.args.taskId===taskId)claimed=true;return receipt},
  query:async q=>{
   if(claimed&&!changed&&q.taskId===taskId&&q.kind==='operation.list'){
    changed=true
    const marker=join(h.host.ctx.runtimePaths.workspaces,'tasks',taskId,'.task-session.json')
    await writeFile(marker,JSON.stringify({taskId,sessionId:'unrelated-session'}))
   }
   return store.query(q)
  },
 })})
 await h.receive(channelMessage('route-check',{text:'Check the synthetic task without writing.'}));await h.service.whenIdle()
 assert.ok(changed)
 const task=await h.query('task.get',{taskId})
 assert.equal(task.sessionBound,false);assert.equal(task.drained,true);assert.equal(taskRequests,0)
 assert.equal(task.inspection?.reason,'execution-failed')
 assert.deepEqual(task.lastDecision.limitations,['TASK_SESSION_START_FAILED'])
 assert.ok((await h.query('wake.list',{taskId})).some(row=>row.state!=='acked'))
 assert.equal((await h.service.taskDialogue(taskId)).error,'TASK_ARCHIVE_SESSION_CONFLICT')
})

test('same controlled follow-up avoids one model query/request when exact current quote/task bindings are already projected',{timeout:nativeTestTimeout(60000)},async t=>{
 const results=[]
 for(const legacyProjection of [true,false]){
  const phases=new Map();let planned=false,routerRequests=0,h
  h=await residentRouterHost(t,body=>{
   const names=requestTools(body)
   if(names.includes('channel_triage_submit'))return submit(triage(body))
   if(names.includes('task_result'))return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic work complete',evidence:['fixture'],limitations:[]}}}
   if(names.includes('resident_router_settle')){
    const input=router(body),event=input.events.find(e=>e.source)
    if(event?.source.messageId==='pause')routerRequests++
    if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Synthetic settled'}
    if(event?.source.messageId==='start'&&!planned){planned=true;return {tool:'resident_task_plan',args:{operationId:'initial',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'bound-task',handoff:'Check the existing synthetic fixture.',title:'Synthetic existing task',objective:'Synthetic check',requirements:[]}],dependencies:[]}}}
    if(event?.source.messageId!=='pause')return settle(input)
    const phase=phases.get('pause')??0
    const lines=requestText(body).flatMap(text=>text.split('\n')),line=lines.find(line=>line.startsWith('{"asOf":')&&line.includes('"sourceTaskLinks"'))
    const context=line?JSON.parse(line):null
    const quote=context?.sourceQuoteLinks?.find(link=>link.sourceId===event.sourceId&&link.messageVersion===event.messageVersion)
    const link=context?.sourceTaskLinks?.find(link=>link.sourceId===quote?.quoteSourceId&&link.messageVersion===quote?.quoteMessageVersion)
    let task=context?.taskIndex?.tasks.find(task=>task.taskId===link?.taskId)
    if(phase===0&&!task){phases.set('pause',1);return {tool:'resident_task_query',args:{taskId:'bound-task'}}}
    if(phase<=1){
     if(!task){const result=JSON.parse(body.messages.at(-1).content);task=result.task}
     phases.set('pause',2);return {tool:'resident_task_action',args:{operationId:'pause',kind:'control',taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,control:'paused',sourceId:event.sourceId,messageVersion:event.messageVersion}}
    }
    return settle(input)
   }
   return {text:'No other work'}
  },{wrapStore:store=>({...store,query:async q=>{const value=await store.query(q);return legacyProjection&&q.kind==='router.source-links'?value.map(({messageVersion,...old})=>old):value}})})
  await h.receive(channelMessage('start',{text:'执行这项合成检查。'}));await h.service.whenIdle()
  await h.receive(channelMessage('pause',{text:'暂停刚才这项合成任务。',quotedMessage:{messageId:'start',senderId:'alice',text:'执行这项合成检查。'}}));await h.service.whenIdle()
  const task=await h.query('task.get',{taskId:'bound-task'});assert.equal(task.control,'paused');assert.equal((await h.query('task.list')).length,1)
  results.push({legacyProjection,routerRequests,queries:h.results.filter(r=>r.name==='resident_task_query').length})
  await h.close()
 }
 assert.deepEqual(results,[{legacyProjection:true,routerRequests:4,queries:1},{legacyProjection:false,routerRequests:3,queries:0}])
 t.diagnostic(JSON.stringify({syntheticOnly:true,results,realLatencyMeasured:false}))
})

test('official Host validates multiple cached attachment bytes without refetch; tampering prevents another task model run',{timeout:nativeTestTimeout(60000)},async t=>{
 const {taskDirectories}=await import('../packages/dingtalk-core/session-workspaces.js'),{readdir,readFile,writeFile}=await import('node:fs/promises'),{join}=await import('node:path')
 let h,planned=false,reads=0,taskRuns=0;const handled=new Set()
 h=await residentRouterHost(t,async body=>{
  const names=requestTools(body)
  if(names.includes('channel_triage_submit'))return submit(triage(body))
  if(names.includes('task_result')){taskRuns++;return {tool:'task_result',args:{decision:{action:'complete',summary:'Synthetic attachments checked',evidence:['fixture'],limitations:[]}}}}
  if(names.includes('resident_router_settle')){
   const input=router(body),event=input.events.find(e=>e.source)
   if(body.messages.at(-1)?.role==='tool'&&h.results.at(-1)?.name==='resident_router_settle')return {text:'Synthetic settled'}
   if(!planned&&event){planned=true;handled.add(event.id);return {tool:'resident_task_plan',args:{operationId:'create-material',sourceId:event.sourceId,messageVersion:event.messageVersion,tasks:[{taskId:'cached-material-task',handoff:'Read and verify both uploaded attachments.',title:'Synthetic attachments',objective:'Read isolated attachment bytes',requirements:[]}],dependencies:[]}}}
   if(event&&!handled.has(event.id)){handled.add(event.id);const task=await h.query('task.get',{taskId:'cached-material-task'});return {tool:'resident_task_action',args:{operationId:'reopen-'+event.id,kind:'reopen',handoff:'Verify those same attachments again, with the same requirements.',sameGoal:true,taskId:task.taskId,expectedRequirementRevision:task.requirementRevision,expectedControlRevision:task.controlRevision,sourceId:event.sourceId,messageVersion:event.messageVersion}}}
   return settle(input)
  }
  return {text:'No other synthetic work'}
 },{config:{retryIntervalMs:600000},readResource:async(_group,_message,resource)=>{reads++;return {text:'Synthetic attachment '+resource.resourceId,complete:true}}})
 await h.receive(channelMessage('material-start',{text:'核对两份合成附件。',resourceRefs:[{resourceId:'one',kind:'file'},{resourceId:'two',kind:'file'}]}));await h.service.whenIdle()
 assert.equal(reads,2);assert.equal(taskRuns,1)
 await h.receive(channelMessage('material-reuse',{text:'按相同要求再核对一次。'}));await h.service.whenIdle()
 assert.equal(reads,2);assert.equal(taskRuns,2)
 const task=await h.query('task.get',{taskId:'cached-material-task'}),dirs=await taskDirectories(h.host.ctx.runtimePaths.workspaces,task.taskId,{task}),files=await readdir(dirs.materials)
 const snapshots=await Promise.all(files.filter(name=>name.startsWith('source-')&&name.endsWith('.json')).map(async name=>JSON.parse(await readFile(join(dirs.materials,name),'utf8'))))
 const cached=snapshots.find(value=>value.resources.length===2);assert.ok(cached);const bytes=await readFile(cached.resources[0].path)
 await writeFile(cached.resources[0].path,Buffer.alloc(bytes.length))
 await h.receive(channelMessage('material-tamper',{text:'再次核对同一份合成附件。'}));await h.service.whenIdle().catch(()=>{})
 assert.equal(reads,2);assert.equal(taskRuns,2,'corrupt cache must fail before model dispatch')
 assert.equal((await h.service.taskDialogue(task.taskId)).error,'TASK_MATERIAL_CONTENT_CHANGED')
})
