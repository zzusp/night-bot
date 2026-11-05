import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createHost} from '../src/host.js'
import {createUserMessage} from '../src/native-message-protocol.js'
import {createEveryScheduleRecord,resolveDailyOccurrence,createDailyScheduleRecord,createCronScheduleRecord,resolveCronOccurrence} from '../src/native-schedule-protocol.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {createPlatformSchedules} from '../packages/dingtalk-core/platform-schedule.js'
import {fixedUnitRequestId} from '../packages/dingtalk-core/fixed-topics.js'

async function until(check,label){for(let n=0;n<300;n++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,20))}throw new Error('timeout: '+label)}
async function fixture(t,decide=()=>undefined){
  const root=await mkdtemp('/tmp/night-schedule-wire-'),requests=[],errors=[];let host
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk
    const body=JSON.parse(text);requests.push(body)
    res.writeHead(200,{'content-type':'text/event-stream'})
    const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'schedule-fixture',object:'chat.completion.chunk',created:1,model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
    const call=await decide(body)
    if(call){chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]});chunk({},'tool_calls')}
    else{chunk({role:'assistant',content:'local schedule verified'});chunk({},'stop')}
    res.end('data: [DONE]\n\n')
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const config={stateDir:join(root,'state'),workspaceDir:join(root,'work'),skillWatch:false,credentialsWatch:false,
    model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'NIGHT_SCHEDULE_TEST_KEY',models:['m','second'].map(id=>({id,input:['text'],contextWindow:32000,maxTokens:1024}))}}}
  process.env.NIGHT_SCHEDULE_TEST_KEY='local-fixture-only'
  const boot=async(options)=>{host=await createHost(config,options);host.ctx.on('agent/error',e=>errors.push(e.error));return host}
  const close=async()=>{await host?.close();host=undefined}
  t.after(async()=>{try{await close()}finally{delete process.env.NIGHT_SCHEDULE_TEST_KEY;await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}})
  await boot()
  return {root,requests,errors,config,get host(){return host},boot,close,
    async session(id,meta={},model=config.model){return host.ctx.agents.create({sessionId:id,meta:{cwd:config.workspaceDir,agentPreset:'night-bot',...meta},agentOptions:model,
      setup:async ctx=>{await ctx.get('agentPresets').mount(ctx,'night-bot')}})},
    async delivered(id){return until(async()=>{const row=(await host.ctx.schedule.catalog()).find(r=>r.id===id);if(row?.status!=='inactive')return;const found=await host.ctx.sessionController.resolveAgent(row.sessionId);if(found.error)throw found.error;await found.agent.whenIdle();return row},'durable delivery '+id)},
  }
}
const rule=(prompt,ms=180)=>({title:'local validation',prompt,at:new Date(Date.now()+ms).toISOString()})

test('default production Host delivers a real Pi request and native file effect at due time',{timeout:20000},async t=>{
  let writes=0
  const f=await fixture(t,body=>{
    if(!body.messages.some(m=>String(m.content).includes('DUE_FILE_PROOF')))return
    if(!body.messages.some(m=>m.role==='tool')){writes++;return {name:'write',args:{file_path:'scheduled-proof.txt',content:'due-file-by-native-tool'}}}
  })
  const h=await f.session('due-file');const record=await f.host.ctx.schedule.create('due-file',rule('DUE_FILE_PROOF'))
  for(const capability of ['agentPresets','attachments','fs','jobs','llm','permissionPresets','sandboxPolicy','schedule','sessionController','sessionPersistence','sessionProjections','sessionTitle','sessions','skills','subprocess','workspaceRegistry'])assert.ok(f.host.ctx.get(capability),capability)
  assert.equal(f.requests.length,0)
  const saved=await f.delivered(record.id)
  assert.ok(Date.parse(saved.lastDelivery.deliveredAt)>=Date.parse(record.scheduledAt))
  assert.equal(await readFile(join(f.config.workspaceDir,'scheduled-proof.txt'),'utf8'),'due-file-by-native-tool')
  assert.equal(writes,1);assert.deepEqual(f.errors,[])
  assert.equal((await f.host.ctx.schedule.history({sessionId:'due-file',id:record.id,limit:10})).records.length,1)
  await h.dispose()
})

test('default preset exposes working session-bound schedule tools through actual Pi wire',{timeout:20000},async t=>{
  let created=false
  const f=await fixture(t,body=>{
    if(!created){created=true;assert.ok(body.tools.some(t=>t.function.name==='schedule_create'));return {name:'schedule_create',args:{title:'tool reminder',prompt:'TOOL_DUE',after_seconds:1}}}
  })
  const h=await f.session('model-create')
  h.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'create a local reminder'}]}))
  await h.agent.whenIdle()
  const [row]=await f.host.ctx.schedule.catalog();assert.equal(row.sessionId,'model-create')
  await f.delivered(row.id)
  assert.equal((await f.host.ctx.schedule.catalog()).length,1)
  assert.equal(f.requests.filter(r=>r.messages.some(m=>String(m.content).includes('[SCHEDULE REMINDER]'))).length,1)
  assert.deepEqual(f.errors,[])
})

test('cold restart delivers overdue durable schedule once and subsequent restart does not replay',{timeout:20000},async t=>{
  const f=await fixture(t);await f.session('cold')
  const record=await f.host.ctx.schedule.create('cold',rule('COLD_DUE',600))
  await f.close();await new Promise(r=>setTimeout(r,650));await f.boot()
  await f.delivered(record.id);assert.equal(f.requests.length,1)
  const agent=f.host.ctx.agents.get('cold');assert.equal(agent.constructor.name,'PiLoopAgent')
  assert.equal(agent.session.header.agentPreset,'night-bot')
  await f.close();await f.boot();await f.host.ctx.schedule.runtime.running
  assert.equal(f.requests.length,1)
  assert.equal((await f.host.ctx.schedule.history({sessionId:'cold',id:record.id,limit:10})).records.length,1)
})

test('crash between durable Pi inbox and schedule receipt reuses the original message without effects replay',{timeout:20000},async t=>{
  const f=await fixture(t);await f.session('commit-gap')
  const runtime=f.host.ctx.schedule.runtime,commit=runtime.commit
  let failOnce=true
  runtime.commit=async task=>{if(failOnce){failOnce=false;throw new Error('injected receipt failure')}return commit(task)}
  const record=await f.host.ctx.schedule.create('commit-gap',rule('COMMIT_GAP'))
  await until(()=>!failOnce,'first delivery persists inbox')
  assert.equal(f.requests.length,0,'model must wait for receipt commit')
  await f.close();await f.boot();await f.delivered(record.id)
  assert.equal(f.requests.length,1)
  const events=f.host.ctx.agents.get('commit-gap').session.snapshotEvents()
  const ids=events.filter(e=>e.type==='agent/inbox/spliced').flatMap(e=>e.data.inserted??[]).filter(m=>m.source?.kind==='schedule').map(m=>m.id)
  assert.equal(ids.length,1)
})

test('receipt committed before process wake is recovered from the durable inbox once',{timeout:20000},async t=>{
  const f=await fixture(t),h=await f.session('wake-gap')
  const wake=h.agent.wakeDriver;h.agent.wakeDriver=()=>{}
  const record=await f.host.ctx.schedule.create('wake-gap',rule('WAKE_GAP'))
  await until(async()=>(await f.host.ctx.schedule.catalog())[0]?.status==='inactive','receipt committed')
  assert.equal(f.requests.length,0)
  // Disposing keeps the pending inbox; the next real Host owns activation.
  await f.close();await f.boot();await f.delivered(record.id)
  await until(()=>f.requests.length===1,'pending inbox resumed');assert.equal(f.requests.length,1)
})

for(const fails of [false,true])test(`a busy Pi driver cannot execute queued reminder input before its durable receipt: failure=${fails}`,{timeout:20000},async t=>{
  const firstEntered=Promise.withResolvers(),finishFirst=Promise.withResolvers(),commitEntered=Promise.withResolvers(),finishCommit=Promise.withResolvers()
  let first=true,host
  const f=await fixture(t,async()=>{if(first){first=false;firstEntered.resolve();await finishFirst.promise}})
  t.after(()=>{finishFirst.resolve();finishCommit.resolve()})
  const h=await f.session('busy')
  h.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'ordinary first turn'}]}))
  await firstEntered.promise
  const runtime=f.host.ctx.schedule.runtime,commit=runtime.commit
  runtime.commit=async task=>{commitEntered.resolve();await finishCommit.promise;if(fails)throw new Error('injected busy receipt failure');return commit(task)}
  const record=await f.host.ctx.schedule.create('busy',rule('BUSY_DUE'))
  await commitEntered.promise;finishFirst.resolve()
  await new Promise(r=>setTimeout(r,70));assert.equal(f.requests.length,1,'no scheduled model call before durable acknowledgment')
  finishCommit.resolve()
  if(fails){await runtime.running;await h.agent.whenIdle();assert.equal(f.requests.length,1);await f.close();await f.boot()}
  await f.delivered(record.id);assert.equal(f.requests.length,2)
})

test('explicit cancellation during receipt admission clears the reminder and cold restart does not resurrect it',{timeout:20000},async t=>{
  const entered=Promise.withResolvers(),releaseModel=Promise.withResolvers(),committing=Promise.withResolvers(),releaseCommit=Promise.withResolvers()
  let first=true
  const f=await fixture(t,async()=>{if(first){first=false;entered.resolve();await releaseModel.promise}})
  t.after(()=>{releaseModel.resolve();releaseCommit.resolve()})
  const h=await f.session('cancel-busy')
  h.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'first turn'}]}));await entered.promise
  const runtime=f.host.ctx.schedule.runtime,commit=runtime.commit
  runtime.commit=async task=>{committing.resolve();await releaseCommit.promise;return commit(task)}
  const row=await f.host.ctx.schedule.create('cancel-busy',rule('CANCEL_BUSY'))
  await committing.promise;releaseModel.resolve();await new Promise(r=>setTimeout(r,50))
  h.agent.cancel({kind:'user'});releaseCommit.resolve();await runtime.running;await h.agent.whenIdle()
  assert.equal(h.agent.inbox.hasPending,false);assert.equal(f.requests.length,1)
  await f.close();await f.boot();await f.host.ctx.schedule.runtime.running
  assert.equal(f.requests.length,1)
  assert.equal((await f.host.ctx.schedule.catalog()).find(r=>r.id===row.id).status,'inactive')
})

test('delete, exact-session ownership, cancellation, optimistic edits and archive do not activate a model',{timeout:20000},async t=>{
  const f=await fixture(t),h=await f.session('managed');await f.session('foreign')
  const schedule=f.host.ctx.schedule
  const r=await schedule.create('managed',rule('CANCELLED',2000))
  assert.equal((await schedule.delete({sessionId:'foreign',id:r.id})).deleted,false)
  assert.equal((await schedule.history({sessionId:'foreign',id:r.id,limit:10})).code,'schedule_not_found')
  await assert.rejects(schedule.create('managed',rule('ABORTED'),AbortSignal.abort()),/abort/i)
  const changed=await schedule.update({sessionId:'managed',id:r.id,expected:r,title:'renamed'})
  assert.equal(changed.updated,true);assert.equal(changed.record.scheduledAt,r.scheduledAt)
  assert.equal((await schedule.update({sessionId:'managed',id:r.id,expected:r,title:'stale'})).code,'schedule_conflict')
  assert.equal((await schedule.delete({sessionId:'managed',id:r.id})).deleted,true)
  await schedule.create('managed',rule('ARCHIVE',2000))
  await assert.rejects(f.host.ctx.workspaceRegistry.archiveSession('managed'),/session is active/)
  await f.host.ctx.workspaceRegistry.archiveSession('managed',{stopActivity:true})
  assert.deepEqual(await schedule.list({sessionId:'managed'}),[])
  await assert.rejects(schedule.create('managed',rule('ARCHIVED')),/Archived/)
  assert.equal(f.requests.length,0)
})

test('cold delegated sessions are refused without resuming or scheduling them',{timeout:20000},async t=>{
  const f=await fixture(t),h=await f.session('delegated',{origin:'subagent',parentSession:'parent',delegationDepth:1})
  await h.dispose()
  await assert.rejects(f.host.ctx.schedule.create('delegated',rule('CHILD')),e=>e.code==='subagent_session')
  assert.equal(f.host.ctx.agents.get('delegated'),undefined)
  assert.deepEqual(await f.host.ctx.schedule.catalog(),[])
  assert.equal(f.requests.length,0)
})

test('all original timing selectors and strict invalid-rule boundaries use native durable storage',{timeout:20000},async t=>{
  const f=await fixture(t);await f.session('rules')
  const requests=[{after_seconds:120},{every_seconds:60},{daily:{time:'09:00:00',time_zone:'Asia/Shanghai'}},{weekly:{time:'09:00:00',time_zone:'America/New_York',weekdays:[1,5]}},{cron:{expression:'*/15 9-17 * * 1-5',time_zone:'Europe/London'}},{at:{date:'2099-01-01',time:'00:00:00',time_zone:'UTC'}}]
  for(const selector of requests){const r=await f.host.ctx.schedule.create('rules',{title:'rule',prompt:'local validation',...selector});assert.ok(Date.parse(r.scheduledAt)>Date.now());await f.host.ctx.schedule.delete({sessionId:'rules',id:r.id})}
  for(const selector of [{every_seconds:1},{at:'2020-01-01T00:00:00Z'},{daily:{time:'bad',time_zone:'UTC'}},{cron:{expression:'* * *',time_zone:'bad'}}])await assert.rejects(f.host.ctx.schedule.create('rules',{title:'rule',prompt:'local',...selector}))
  assert.equal(f.requests.length,0)
})

test('read-only permissions survive cold reminder activation',{timeout:20000},async t=>{
  const f=await fixture(t),h=await f.session('read-only')
  h.agent.ctx.get('permissionPresets').set(h.agent.session,'read-only');await f.host.ctx.sessions.flush(h.agent.session)
  const record=await f.host.ctx.schedule.create('read-only',rule('READ_ONLY',600))
  await f.close();await f.boot();await f.delivered(record.id)
  const agent=f.host.ctx.agents.get('read-only')
  assert.equal(agent.ctx.get('permissionPresets').current(agent.session),'read-only')
  assert.deepEqual(f.errors,[])
})

test('cold activation preserves the committed session model instead of replacing it with the Host default',{timeout:20000},async t=>{
  const f=await fixture(t),h=await f.session('model-route',{}, {provider:'fixture',model:'second'})
  h.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'save session model'}]}));await h.agent.whenIdle()
  const record=await f.host.ctx.schedule.create('model-route',rule('MODEL_ROUTE',600))
  await f.close();await f.boot();await f.delivered(record.id)
  assert.equal(f.requests.length,2);assert.ok(f.requests.every(request=>request.model==='second'))
})

test('model tools refuse delegated callers before creating any schedule',{timeout:20000},async t=>{
  let first=true
  const f=await fixture(t,()=>{if(first){first=false;return {name:'schedule_create',args:{title:'child reminder',prompt:'must refuse',after_seconds:1}}}})
  const h=await f.session('child-caller',{origin:'subagent',parentSession:'parent',delegationDepth:1})
  h.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'try reminder'}]}));await h.agent.whenIdle()
  assert.deepEqual(await f.host.ctx.schedule.catalog(),[])
  assert.ok(f.requests[1].messages.some(message=>message.role==='tool'&&String(message.content).includes('subagent_session')))
})

test('overdue recurring reminders coalesce missed occurrences into one actual Pi batch',{timeout:20000},async t=>{
  const f=await fixture(t);await f.session('recurring')
  const domain=await f.host.ctx.schedule.ready
  for(const [id,seconds]of [['recurring-a',60],['recurring-b',120]]){
    const record=createEveryScheduleRecord(id,id,seconds,Date.now()-180000,'recurring rule')
    await domain.table('tasks').put(id,{sessionId:'recurring',record,status:'active',deliveryHistory:{records:[],earlierRecordsUnavailable:false}})
  }
  f.host.ctx.schedule.start()
  await until(async()=>(await f.host.ctx.schedule.catalog()).every(r=>r.lastDelivery),'recurring acknowledgments')
  await f.host.ctx.agents.get('recurring').whenIdle()
  assert.equal(f.requests.length,1)
  const rows=await f.host.ctx.schedule.catalog()
  assert.equal(rows[0].lastDelivery.messageId,rows[1].lastDelivery.messageId)
  assert.ok(rows.every(r=>r.status==='active'&&Date.parse(r.scheduledAt)>Date.now()))
  for(const row of rows)await f.host.ctx.schedule.delete({sessionId:'recurring',id:row.id})
})

test('a partially committed recurring batch resumes its frozen message once after restart',{timeout:20000},async t=>{
  const f=await fixture(t);await f.session('partial-batch');await f.host.ctx.schedule.runtime.running
  const domain=await f.host.ctx.schedule.ready,runtime=f.host.ctx.schedule.runtime,commit=runtime.commit
  let commits=0,failed=false
  runtime.commit=async task=>{if(++commits===2){failed=true;throw new Error('second member receipt failed')}return commit(task)}
  for(const id of ['batch-a','batch-b'])await domain.table('tasks').put(id,{sessionId:'partial-batch',record:createEveryScheduleRecord(id,id,60,Date.now()-120000,'batch rule'),status:'active',deliveryHistory:{records:[],earlierRecordsUnavailable:false}})
  f.host.ctx.schedule.start();await until(()=>failed,'partial receipt failure');await runtime.running
  assert.equal(f.requests.length,0)
  await f.close();await f.boot()
  await until(async()=>(await f.host.ctx.schedule.catalog()).every(r=>r.lastDelivery),'all batch members acknowledged')
  await f.host.ctx.agents.get('partial-batch').whenIdle();assert.equal(f.requests.length,1)
  const rows=await f.host.ctx.schedule.catalog();assert.equal(rows[0].lastDelivery.messageId,rows[1].lastDelivery.messageId)
  for(const row of rows){assert.equal((await f.host.ctx.schedule.history({sessionId:'partial-batch',id:row.id,limit:10})).records.length,1);await f.host.ctx.schedule.delete({sessionId:'partial-batch',id:row.id})}
})

test('calendar rules retain DST gap/overlap semantics and cron missed-occurrence coalescing',()=>{
  const gap=createDailyScheduleRecord('gap','local',{time:'02:30:00',time_zone:'America/New_York'},Date.parse('2026-03-07T08:00:00Z'),'gap')
  assert.equal(gap.scheduledAt,'2026-03-09T06:30:00.000Z')
  const overlap=createDailyScheduleRecord('overlap','local',{time:'01:30:00',time_zone:'America/New_York'},Date.parse('2026-10-31T12:00:00Z'),'overlap')
  assert.equal(overlap.scheduledAt,'2026-11-01T05:30:00.000Z')
  assert.equal(resolveDailyOccurrence(overlap,Date.parse('2026-11-01T06:45:00Z')).nextScheduledAt,'2026-11-02T06:30:00.000Z')
  const cron=createCronScheduleRecord('cron','local',{expression:'*/15 * * * *',time_zone:'UTC'},Date.parse('2026-11-05T00:00:01Z'),'cron')
  assert.deepEqual(resolveCronOccurrence(cron,Date.parse('2026-11-05T01:44:00Z')),{occurrenceAt:'2026-11-05T01:30:00.000Z',nextScheduledAt:'2026-11-05T01:45:00.000Z'})
})

for(const superseded of [false,true])test(`real platform bridge restores original source and gates actual due delivery: superseded=${superseded}`,{timeout:20000},async t=>{
  let dueStep=0,store,bridge
  const notifications=[]
  const f=await fixture(t,body=>{
    if(!body.tools.some(tool=>tool.function.name==='platform_task_query'))return
    if(dueStep++===0)return {name:'platform_task_query',args:{state:'all'}}
    return {name:'platform_reply_submit',args:{text:'local current task report'}}
  })
  const mount=async()=>{
    store=await openResidentStore(f.host.ctx.storageDomain)
    bridge=createPlatformSchedules({ctx:f.host.ctx,store,legacy:{getAgentConfig:()=>({agentPreset:'night-bot'})},root:f.config.workspaceDir,models:f.config.model,
      readTasks:async()=>store.listTasks(),notify:async input=>{input.preflight();notifications.push(input)}})
  }
  t.after(async()=>{await bridge?.close();await store?.close()})
  await mount();await store.subscribe({groupId:'local-group',timezone:'UTC'})
  const text='report current tasks later'
  await store.ingest({groupId:'local-group',messageId:'source',text,senderOpenDingTalkId:'local-owner',occurredAt:new Date().toISOString()})
  await store.routeMessages({groupId:'local-group',routeId:'route',routingRevision:0,routes:[{messageId:'source',messageVersion:1,units:[{unitKey:'report',summary:text,sourceRefs:[{quote:text}],topics:[],fixedTopic:'agent-platform',reason:'scheduled report'}]}]})
  const message=store.getGroup('local-group').messages[0],unit=message.units[0],requestId=fixedUnitRequestId('local-group',message,unit)
  const result=await bridge.submit({groupId:'local-group',messageId:'source',messageVersion:1,unitId:unit.unitId,unitRevision:unit.unitRevision,requestId,timezone:'UTC'},rule(text,650))
  assert.equal(result.status,'scheduled')
  assert.equal(f.requests.length,0)
  if(superseded)await store.ingest({groupId:'local-group',messageId:'source',messageVersion:2,text:'withdraw prior request',senderOpenDingTalkId:'local-owner',occurredAt:new Date().toISOString()})
  await bridge.close();bridge=undefined;await store.close();store=undefined;await f.close()
  await f.boot({deferScheduledDelivery:true});await mount();f.host.ctx.schedule.start()
  const [row]=await f.host.ctx.schedule.catalog()
  await until(()=>store.getPlatformSchedule(row.sessionId)?.outcome===(superseded?'superseded':'replied'),'original source outcome')
  await f.delivered(row.id)
  assert.equal(notifications.length,superseded?0:1)
  assert.equal((await f.host.ctx.schedule.history({sessionId:row.sessionId,id:row.id,limit:10})).records.length,1)
  await bridge.close();bridge=undefined;await store.close();store=undefined
  assert.deepEqual(f.errors,[])
})

test('actual CLI process restart executes a persisted reminder and never repeats its file effect',{timeout:30000},async t=>{
  let writes=0,child,exited
  const f=await fixture(t,body=>{
    if(!body.messages.some(m=>String(m.content).includes('CLI_RESTART_PROOF')))return
    if(!body.messages.some(m=>m.role==='tool')){writes++;return {name:'write',args:{file_path:'cli-schedule-proof.txt',content:'one process effect'}}}
  })
  await f.session('cli-schedule')
  await f.host.ctx.schedule.create('cli-schedule',rule('CLI_RESTART_PROOF',700))
  await f.close()
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r))
  const path=join(f.root,'cli-config.json')
  await writeFile(path,JSON.stringify({...f.config,resident:{host:'127.0.0.1',port,groups:[],dws:{enabled:false,writesAuthorized:false},taskSessions:{instanceId:'cli-schedule-test',ownerActorId:'fixture-owner',webActorId:'fixture-owner',ingressEpoch:new Date().toISOString(),initialize:true}}}))
  let output=''
  const start=async()=>{
    child=spawn(process.execPath,['bin/night-bot.js',path],{stdio:['ignore','pipe','pipe']});exited=once(child,'exit')
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d)
    await until(async()=>{assert.equal(child.exitCode,null,output);try{return (await fetch(`http://127.0.0.1:${port}/health`)).ok}catch{}},'CLI health')
  }
  const stop=async()=>{child.kill('SIGTERM');const [code]=await exited;assert.equal(code,0,output)}
  t.after(async()=>{if(child?.exitCode===null&&child.signalCode===null)await stop()})
  await start();await until(()=>writes===1,'CLI scheduled effect');await until(async()=>{try{return await readFile(join(f.config.workspaceDir,'cli-schedule-proof.txt'),'utf8')==='one process effect'}catch{}},'file readback')
  await until(async()=>{const bytes=await readFile(join(f.config.stateDir,'storage','schedule.json'),'utf8');return bytes.includes('"inactive"')},'CLI receipt')
  await stop();await start()
  await new Promise(r=>setTimeout(r,250))
  assert.equal(writes,1);await stop()
})
