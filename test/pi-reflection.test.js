import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import {memoryHost,initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {memoryScope} from '../src/memory/scope.js'
import {readUsage} from '../src/memory/evolution.js'
import {createPiProjectionRequest} from '../src/runtime/pi-request-context.js'

async function completed(store,workspaceRoot,id,groupId){let seq=0;const command=(kind,args)=>store.command({id:id+'-'+(++seq),kind,args});await command('task.create',{taskId:id,request:'bounded local task',ownerActorId:'owner',...groupId?{groupId}:{}});await initializeMemoryTaskWorkspace(store,workspaceRoot,id);const binding=(await command('task.claim',{taskId:id})).result.binding;return (await command('task.complete',{binding,summary:'Verified bounded task result'})).completionEvent}
const lesson=input=>({text:JSON.stringify({lessons:[{key:'inspect-first',summary:'Read evidence before changing files',why:'The completion record depends on the observed current state',howToApply:'Inspect current state before choosing a write',evidenceIds:[input.eventId],skill:{steps:['Inspect current state','Make the smallest authorized change','Read back the result'],reason:'Evidence from this bounded task is reusable',applicability:'Local evidence-first edits: inspect state before writes',evidenceBacked:true}}]})})
test('real default Host learns completed SQLite task evidence, deduplicates, creates evidence-justified scoped skills without a fixed repetition threshold and cold reopens',async t=>{
  let store,service,fixtureHost
  t.after(async()=>{await service?.close();await fixtureHost?.close();await store?.close()})
  let analyses=0
  const f=fixtureHost=await memoryHost(t,body=>{if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){analyses++;return lesson(JSON.parse(body.messages.findLast(m=>m.role==='user').content))}})
  store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'learning',initialize:true});
  await completed(store,f.host.ctx.runtimePaths.workspaces,'one');let detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});await f.host.ctx.reflection.whenIdle()
  const a=await f.agent('owner-session',{actorId:'owner'}),other=await f.agent('other-session',{actorId:'other'})
  const saved=(await f.host.ctx.memory.read(a.agent,{topic:'experience'})).entries;assert.equal(saved.length,1);for(const header of ['Summary:','**Why:**','**How to apply:**'])assert.ok(saved[0].text.includes(header));assert.doesNotMatch(saved[0].text,/Hypothesis|Possible direct path|Model observation|Evidence:/)
  assert.equal(saved[0].key,'inspect-first');assert.equal(saved[0].provenance.taskId,'one');assert.ok(saved[0].source.messageId)
  assert.equal((await f.host.ctx.skills.list({scope:a.agent})).filter(s=>s.provider==='learned').length,1)
  await completed(store,f.host.ctx.runtimePaths.workspaces,'two');f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle()
  const available=await f.host.ctx.skills.list({scope:a.agent});assert.equal(available.find(s=>s.name==='learned-inspect-first')?.description,'Local evidence-first edits: inspect state before writes')
  const skill=await f.host.ctx.skills.get('learned-inspect-first',{scope:a.agent});assert.doesNotMatch(skill.content,/Observed in tasks:|Skill revision:|Current instructions and permissions prevail|Applicability:|not authority/);assert.match(skill.content,/Inspect current state/);assert.match(skill.content,/description: "Local evidence-first edits: inspect state before writes"/)
  const learnedFile=join(f.host.ctx.reflection.directory(await f.host.ctx.memory.scope(a.agent,{})),'skills','inspect-first','SKILL.md');assert.equal(await readFile(learnedFile,'utf8'),skill.content)
  const usageScope=await f.host.ctx.memory.scope(a.agent,{})
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).readCount,1)
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).loadCount,1)
  await f.host.ctx.memory.search(a.agent,{query:'Summary'})
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).searchCount,1)
  assert.equal((await f.host.ctx.memory.read(a.agent,{scope:'group',topic:'experience'})).entries.length,2)
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).readCount,2)
  assert.equal((await f.host.ctx.skills.list({scope:other.agent})).filter(s=>s.provider==='learned').length,1)
  f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle();assert.equal(analyses,2)
  const scope=await f.host.ctx.memory.scope(a.agent,{}),state=JSON.parse(await readFile(join(f.host.ctx.reflection.directory(scope),'state.json'),'utf8'));assert.equal(Object.keys(state.reviews).length,2);assert.ok(Object.values(state.reviews).every(r=>r.lessons[0].evidenceIds.length&&r.lessons[0].summary&&!Object.hasOwn(r.lessons[0],'hypothesis')));assert.ok(state.skills['inspect-first'].taskIds.includes('one'))
  assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries.map(row=>row.key),['inspect-first','inspect-first-2'])
  for(const id of ['one','two']){
    const report=Object.values(state.reviews).find(row=>row.taskId===id),task=await store.query({kind:'task.get',taskId:id})
    assert.equal(report.destinations[0].memory.key,report.lessons[0].memoryKey)
    const detail=await f.host.ctx.reflection.inspectTask(task,{actorId:'owner'},{store}),change=detail.changes.find(row=>row.kind==='memory')
    assert.equal(change.name,report.lessons[0].memoryKey);assert.equal(change.status,'applied');assert.equal(change.source.eventId,report.eventId)
    const body=await f.host.ctx.reflection.inspectTask(task,{actorId:'owner'},{store,changeId:change.id,version:change.version})
    assert.match(body.text,/Read evidence before changing files/)
  }
  await assert.rejects(f.host.ctx.agents.withInitiator(a.agent,()=>f.host.ctx.memory.inspectEvolution({actorId:'owner'})),{code:'EVOLUTION_HOST_REQUIRED'})
  const usagePath=join(f.host.ctx.memory.store.directory(scope),'usage.json'),savedUsage=await readFile(usagePath,'utf8')
  await writeFile(usagePath,'invalid telemetry data')
  try{
    assert.ok((await f.host.ctx.memory.read(a.agent,{topic:'experience'})).entries.length)
    assert.doesNotMatch((await f.host.ctx.skills.get('learned-inspect-first',{scope:a.agent})).content,/Observed in tasks:|Skill revision:|Current instructions and permissions prevail/)
    await assert.rejects(f.host.ctx.memory.inspectEvolution({actorId:'owner'}))
  }finally{await writeFile(usagePath,savedUsage)}
  const rememberedSkill=skill.content
  const key=(await f.host.ctx.memory.read(a.agent,{topic:'experience'})).entries[0].key
  const manager=a.session.sessionManager
  const historicalId=manager.appendCustomMessageEntry('night.tool-context',[{type:'text',text:rememberedSkill}],false)
  await f.say(a.agent,'忘记 experience/'+key)
  assert.equal((await f.host.ctx.skills.list({scope:a.agent})).filter(s=>s.provider==='learned').length,0)
  const projection=manager.buildSessionProjection(),historical=projection.entries.find(entry=>entry.sourceEntry.id===historicalId).messages[0]
  const filtered=await f.host.ctx.memory.filterRequest(createPiProjectionRequest(projection),a.agent)
  assert.match(filtered.messages[projection.messages.indexOf(historical)].content[0].text,/revoked/)
  assert.equal(manager.buildSessionProjection().entries.find(entry=>entry.sourceEntry.id===historicalId).messages[0].content[0].text,rememberedSkill)
  const forgotten=await f.host.ctx.reflection.state(scope)
  assert.ok(Object.values(forgotten.reviews).every(review=>review.lessons.every(lesson=>lesson.memoryKey!==key)&&review.destinations.every(row=>row.memory?.key!==key)))
  assert.equal(Object.values(forgotten.reviews).find(review=>review.taskId==='two').lessons[0].memoryKey,'inspect-first-2')
  detach();await f.close();await store.close();await f.boot();store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'learning'});detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});await f.host.ctx.reflection.whenIdle();assert.equal(analyses,2);detach()
})
test('invalid reflection evidence cannot invent memory or block committed task delivery; retry state is durable',async t=>{
  let store,service,fixtureHost
  t.after(async()=>{await service?.close();await fixtureHost?.close();await store?.close()})
  const f=fixtureHost=await memoryHost(t,body=>JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')?{text:JSON.stringify({lessons:[{key:'bad',summary:'invented',why:'unknown',howToApply:'unknown',evidenceIds:['forged']}]})}:undefined)
  store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'learning-fail',initialize:true});;await completed(store,f.host.ctx.runtimePaths.workspaces,'bad','group-a')
  const detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});t.after(detach);await f.host.ctx.reflection.whenIdle()
  assert.equal((await store.query({kind:'task.get',taskId:'bad'})).status,'completed')
  const scope=memoryScope({actorId:'owner',groupId:'group-a',groupWrite:true},{scope:'group'}),state=await f.host.ctx.reflection.state(scope)
  assert.equal(Object.values(state.reviews)[0].code,'REFLECTION_EVIDENCE_INVALID');assert.equal((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries.length,0)
})
test('actual task service attaches the default Host reflection consumer and recovers preexisting durable completion events',async t=>{
  let store,service,fixtureHost
  t.after(async()=>{await service?.close();await fixtureHost?.close();await store?.close()})
  let analyses=0
  const f=fixtureHost=await memoryHost(t,body=>{if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){analyses++;return lesson(JSON.parse(body.messages.findLast(m=>m.role==='user').content))}}),ctx=f.host.ctx
  const residentStore=await openResidentStore(ctx.storageDomain);store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'service-learning',initialize:true});
  await completed(store,f.host.ctx.runtimePaths.workspaces,'already-delivered','group-a')
  const config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:store.info.dbPath,instanceId:'service-learning',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot'}
  service=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no real notifications')},readback:async()=>{throw Error('no real notifications')}}});
  await ctx.reflection.whenIdle();assert.equal(analyses,1);assert.equal((await store.query({kind:'task.get',taskId:'already-delivered'})).status,'completed')
})

test('a real default Host task turn completes through the native submit tool and automatically schedules a review',{timeout:20000},async t=>{
  let store,service,fixtureHost
  t.after(async()=>{await service?.close();await fixtureHost?.close();await store?.close()})
  let analyses=0,submits=0
  const f=fixtureHost=await memoryHost(t,body=>{
    if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){analyses++;return lesson(JSON.parse(body.messages.findLast(m=>m.role==='user').content))}
    if(body.tools?.some(t=>t.function.name==='task_result')){submits++;return {tool:'task_result',args:{decision:{action:'complete',summary:'Literal local request resolved',evidence:[],limitations:[]}}}}
  }),ctx=f.host.ctx,residentStore=await openResidentStore(ctx.storageDomain)
  await residentStore.subscribe({groupId:'group-a',responsibility:'isolated test'})
  store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'live-learning',initialize:true});

  const config={...f.config.model,workspaceDir:ctx.runtimePaths.workspaces,dbPath:store.info.dbPath,instanceId:'live-learning',ownerActorId:'owner',webActorId:'owner',agentPreset:'night-bot',reasoningMode:'model-default'}
  service=await openTaskSessionService({ctx,config,store,residentStore,legacy:{getAgentConfig:()=>({...config,agentNames:[]}),getGroup:id=>residentStore.getGroup(id)},notifications:{send:async()=>{throw Error('no external sends')},readback:async()=>{throw Error('no external sends')}}});
  const created=await service.createTask({requestId:'new-live-task',objective:'Reply with the literal word verified; no external work'}),taskId=created.taskId
  for(let n=0;n<160;n++){if((await store.query({kind:'task.get',taskId})).status==='completed')break;await new Promise(r=>setTimeout(r,25))}
  assert.equal((await store.query({kind:'task.get',taskId})).status,'completed',JSON.stringify({errors:f.errors,recovery:await service.recover(),task:await store.query({kind:'task.get',taskId}),requests:f.requests.map(r=>r.tools?.map(t=>t.function.name))}))
  await ctx.reflection.whenIdle();assert.ok(submits>0);assert.equal(analyses,1);assert.equal((await store.query({kind:'execution.list'})).length,0)
  assert.equal((await ctx.sessionPersistence.list()).filter(row=>row.header.agentPreset==='night-bot-task').length,1)
  for(const request of f.requests)assert.ok(!request.tools?.some(t=>/^(subagent|task_delegate)/.test(t.function.name)))
})

test('automatic reviews replace only the prior learned body and forgetting removes that comparison',async t=>{
 let step=0,store,detach,f
 t.after(async()=>{detach?.();await f?.close();await store?.close()})
 f=await memoryHost(t,body=>{
  if(!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content),value=JSON.parse(lesson(input).text)
  value.lessons[0].skill.steps=['Distinct revision '+(++step)];return {text:JSON.stringify(value)}
 })
 store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'latest-review.sqlite'),instanceId:'latest-review',initialize:true})
 detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model})
 for(const id of ['one','two','three']){await completed(store,f.host.ctx.runtimePaths.workspaces,id);f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle()}
 const list=await f.host.ctx.memory.inspectEvolution({actorId:'reader'},{kind:'skill'}),item=list.items.find(row=>row.name==='learned-inspect-first')
 const body=await f.host.ctx.memory.inspectEvolutionItem({actorId:'reader'},{id:item.id,revision:String(item.revision)})
 assert.match(body.current.text,/Distinct revision 3/);assert.match(body.previous.text,/Distinct revision 2/);assert.doesNotMatch(JSON.stringify(body),/Distinct revision 1/)
 const scope=memoryScope({actorId:'reader'}),state=await f.host.ctx.reflection.state(scope)
 assert.equal(state.skills['inspect-first'].previous.previous,undefined)
 const agent=await f.agent('forget-latest',{actorId:'owner'}),key=state.skills['inspect-first'].memoryKeys[0]
 await f.say(agent.actor,'忘记 experience/'+key)
 await assert.rejects(f.host.ctx.memory.inspectEvolutionItem({actorId:'reader'},{id:item.id,revision:String(item.revision)}),{code:'EVOLUTION_ITEM_NOT_FOUND'})
 assert.deepEqual((await f.host.ctx.reflection.state(scope)).skills,{})
})


test('task reflection refuses a missing reason instead of storing speculative filler',async t=>{
 let f,store,detach
 t.after(async()=>{detach?.();await f?.close();await store?.close()})
 f=await memoryHost(t,body=>{
  if(!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content),output=JSON.parse(lesson(input).text)
  delete output.lessons[0].why;output.lessons[0].hypothesis='An unsupported guess'
  return {text:JSON.stringify(output)}
 })
 store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'missing-reason.sqlite'),instanceId:'missing-reason',initialize:true})
 await completed(store,f.host.ctx.runtimePaths.workspaces,'one')
 detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});await f.host.ctx.reflection.whenIdle()
 const scope=memoryScope({actorId:'owner'}),state=await f.host.ctx.reflection.state(scope)
 assert.equal(Object.values(state.reviews)[0].code,'MEMORY_TEXT_INVALID')
 assert.deepEqual((await f.host.ctx.memory.store.read(scope,{topic:'experience'})).entries,[]);assert.deepEqual(state.skills,{})
 assert.equal((await store.query({kind:'task.get',taskId:'one'})).status,'completed')
})
