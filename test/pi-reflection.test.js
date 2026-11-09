import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import {memoryHost} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {openResidentStore} from '../packages/dingtalk-core/store.js'
import {openTaskSessionService} from '../packages/dingtalk-core/task-session-service.js'
import {memoryScope} from '../src/memory/scope.js'
import {readUsage} from '../src/memory/evolution.js'
import {createPiProjectionRequest} from '../src/runtime/pi-request-context.js'

async function completed(store,id,groupId){let seq=0;const command=(kind,args)=>store.command({id:id+'-'+(++seq),kind,args});await command('task.create',{taskId:id,request:'bounded local task',ownerActorId:'owner',...groupId?{groupId}:{}});const binding=(await command('task.claim',{taskId:id})).result.binding;return (await command('task.complete',{binding,summary:'Verified bounded task result'})).completionEvent}
const lesson=input=>({text:JSON.stringify({lessons:[{key:'inspect-first',observation:'Read evidence before changing files',hypothesis:'Preflight may avoid detours for similar local tasks',shortcut:'Inspect current state before choosing a write',evidenceIds:[input.eventId],skill:{steps:['Inspect current state','Make the smallest authorized change','Read back the result'],reason:'Evidence from this bounded task is reusable',applicability:'Similar local evidence-first edits',evidenceBacked:true}}]})})
test('real default Host learns completed SQLite task evidence, deduplicates, creates evidence-justified scoped skills without a fixed repetition threshold and cold reopens',async t=>{
  let store,service,fixtureHost
  t.after(async()=>{await service?.close();await fixtureHost?.close();await store?.close()})
  let analyses=0
  const f=fixtureHost=await memoryHost(t,body=>{if(JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')){analyses++;return lesson(JSON.parse(body.messages.findLast(m=>m.role==='user').content))}})
  store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'learning',initialize:true});
  await completed(store,'one');let detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});await f.host.ctx.reflection.whenIdle()
  const a=await f.agent('owner-session',{actorId:'owner'}),other=await f.agent('other-session',{actorId:'other'})
  assert.equal((await f.host.ctx.memory.read(a.agent,{topic:'experience'})).entries.length,1)
  assert.equal((await f.host.ctx.skills.list({scope:a.agent})).filter(s=>s.provider==='learned').length,1)
  await completed(store,'two');f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle()
  const available=await f.host.ctx.skills.list({scope:a.agent});assert.ok(available.some(s=>s.name==='learned-inspect-first'))
  const skill=await f.host.ctx.skills.get('learned-inspect-first',{scope:a.agent});assert.match(skill.content,/not authority/)
  const usageScope=await f.host.ctx.memory.scope(a.agent,{})
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).readCount,1)
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).loadCount,1)
  await f.host.ctx.memory.search(a.agent,{query:'Model'})
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).searchCount,1)
  await assert.rejects(f.host.ctx.memory.read(a.agent,{scope:'group',topic:'experience'}))
  assert.equal((await readUsage(f.host.ctx.memory.store,usageScope)).readCount,1)
  assert.equal((await f.host.ctx.skills.list({scope:other.agent})).filter(s=>s.provider==='learned').length,0)
  f.host.ctx.reflection.scan();await f.host.ctx.reflection.whenIdle();assert.equal(analyses,2)
  const scope=await f.host.ctx.memory.scope(a.agent,{}),state=JSON.parse(await readFile(join(f.host.ctx.reflection.directory(scope),'state.json'),'utf8'));assert.equal(Object.keys(state.reviews).length,2)
  await assert.rejects(f.host.ctx.agents.withInitiator(a.agent,()=>f.host.ctx.memory.inspectEvolution({actorId:'owner'})),{code:'EVOLUTION_HOST_REQUIRED'})
  const usagePath=join(f.host.ctx.memory.store.directory(scope),'usage.json'),savedUsage=await readFile(usagePath,'utf8')
  await writeFile(usagePath,'invalid telemetry data')
  try{
    assert.ok((await f.host.ctx.memory.read(a.agent,{topic:'experience'})).entries.length)
    assert.match((await f.host.ctx.skills.get('learned-inspect-first',{scope:a.agent})).content,/not authority/)
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
  assert.doesNotMatch(await readFile(join(f.host.ctx.reflection.directory(scope),'state.json'),'utf8'),new RegExp(key))
  detach();await f.close();await store.close();await f.boot();store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'learning'});detach=f.host.ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});await f.host.ctx.reflection.whenIdle();assert.equal(analyses,2);detach()
})
test('invalid reflection evidence cannot invent memory or block committed task delivery; retry state is durable',async t=>{
  let store,service,fixtureHost
  t.after(async()=>{await service?.close();await fixtureHost?.close();await store?.close()})
  const f=fixtureHost=await memoryHost(t,body=>JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION')?{text:JSON.stringify({lessons:[{key:'bad',observation:'invented',hypothesis:'unknown',shortcut:'unknown',evidenceIds:['forged']}]})}:undefined)
  store=await openDynamicTaskStore({dbPath:join(f.host.ctx.runtimePaths.state,'tasks.sqlite'),instanceId:'learning-fail',initialize:true});;await completed(store,'bad','group-a')
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
  await completed(store,'already-delivered','group-a')
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
