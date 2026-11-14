import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {readFile,mkdir,rm} from 'node:fs/promises'
import {assignReflectionMemoryKeys,reflectionMemoryKey,reviewMemoryKeys,reviewLessonMemoryKey,reflectionRetrySupported} from '../src/memory/reflection-keys.js'
import {hash} from '../src/memory/format.js'
import {memoryScope} from '../src/memory/scope.js'
import {atomicWrite} from '../src/runtime/files.js'
import {memoryHost,initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'

test('semantic keys reserve every existing record and review and disambiguate within a batch',()=>{
 const long='a'.repeat(60)
 const entries=[...Array.from({length:55},(_,n)=>({key:'unrelated-'+n})),{key:'lesson'},{key:'lesson-2'}, {key:long}]
 const reviews={other:{lessons:[{key:'lesson',memoryKey:'lesson-3'}]}}
 const chosen=assignReflectionMemoryKeys([{key:'lesson'},{key:'lesson-4'},{key:long}],entries,reviews)
 assert.deepEqual(chosen.map(row=>row.memoryKey),['lesson-4','lesson-4-2',long+'-2'])
 assert.throws(()=>reflectionMemoryKey({key:'legacy'}),{code:'REFLECTION_MEMORY_KEY_INVALID'})
 assert.equal(reflectionMemoryKey({key:'old',memoryKey:'readable'}),'readable')
 for(const memoryWrite of ['committed','uncertain'])assert.equal(assignReflectionMemoryKeys([{key:'lesson',memoryKey:'lesson',memoryWrite}],entries,{})[0].memoryKey,'lesson')
})

test('historical keys come only from explicit references and unsupported lessons cannot poison reservations',()=>{
 const historical={lessons:[{key:'legacy'}],destinations:[{memory:{topic:'experience',key:'reserved'}}]}
 const unsupported={lessons:[{key:'legacy'},{key:'unpaired'}],destinations:[{memory:{topic:'experience',key:'other'}}]}
 assert.deepEqual(reviewMemoryKeys(historical),['reserved'])
 assert.equal(reviewLessonMemoryKey(historical,0),'reserved')
 assert.equal(reviewLessonMemoryKey(unsupported,0),undefined)
 assert.deepEqual(reviewMemoryKeys({lessons:[{key:'missing'}],destinations:[{memory:{topic:'facts',key:'foreign'}},{memory:{topic:'experience',key:'../invalid'}}]}),[])
 assert.deepEqual(assignReflectionMemoryKeys([{key:'reserved'},{key:'legacy'}],[],{historical,unsupported,missing:{lessons:[{key:'missing'}]}}).map(row=>row.memoryKey),['reserved-2','legacy'])
 assert.equal(reflectionRetrySupported({status:'failed'}),false)
 assert.equal(reflectionRetrySupported({memoryKeyVersion:1,status:'failed'}),true)
 assert.equal(reflectionRetrySupported({...historical,memoryKeyVersion:1}),false)
})

async function fixture(t,makeLessons){
 let analyses=0,detach,f,store
 const cleanups=[]
 t.after(async()=>{detach?.();try{await f?.close()}finally{try{await store?.close()}finally{for(const cleanup of cleanups.reverse())await cleanup()}}})
 f=await memoryHost({after:cleanup=>cleanups.push(cleanup)},async body=>{
  if(!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return
  analyses++;const input=JSON.parse(body.messages.findLast(row=>row.role==='user').content)
  return {text:JSON.stringify({lessons:await makeLessons(input)})}
 })
 const ctx=f.host.ctx,scope=memoryScope({actorId:'owner'})
 store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'keys.sqlite'),instanceId:'keys',initialize:true})
 let seq=0
 const command=(kind,args)=>store.command({id:'key-'+(++seq),kind,args})
 await command('task.create',{taskId:'task-one',request:'Bounded local evidence',ownerActorId:'owner'})
 await initializeMemoryTaskWorkspace(store,ctx.runtimePaths.workspaces,'task-one')
 const binding=(await command('task.claim',{taskId:'task-one'})).result.binding
 const event=(await command('task.complete',{binding,summary:'Verified local evidence'})).completionEvent
 return {ctx,scope,store,event,command,get analyses(){return analyses},start:async()=>{detach=ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});await ctx.reflection.whenIdle()},retry:async()=>{
  const state=await ctx.reflection.state(scope);state.reviews[hash(event.id)].retryAt=0
  await atomicWrite(join(ctx.reflection.directory(scope),'state.json'),JSON.stringify(state))
  ctx.reflection.scan();await ctx.reflection.whenIdle()
 }}
}
const lesson=(input,key)=>({key,summary:'Verified lesson '+key,why:'The completion record contains the result',howToApply:'Inspect local evidence before changes',evidenceIds:[input.eventId]})

test('automatic review preserves an existing semantic name and its provenance, and commits the actual destination',async t=>{
 const f=await fixture(t,input=>[lesson(input,'inspect-first')]),memory=f.ctx.memory.store
 await memory.remember(f.scope,{topic:'experience',key:'inspect-first',text:'Existing Router-owned memory',source:{sessionId:'router',messageId:'user-message'},provenance:{taskId:'another-task'}})
 const original=(await memory.read(f.scope,{topic:'experience',key:'inspect-first'})).entries[0]
 await f.start()
 const rows=(await memory.read(f.scope,{topic:'experience'})).entries
 assert.deepEqual(rows[0],original);assert.equal(rows[1].key,'inspect-first-2');assert.equal(rows[1].provenance.taskId,'task-one')
 const report=(await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)]
 assert.equal(report.status,'done');assert.equal(report.lessons[0].memoryKey,'inspect-first-2');assert.equal(report.destinations[0].memory.key,'inspect-first-2')
 assert.equal(rows[1].source.messageId,report.eventId)
 const projection=await f.ctx.reflection.inspectTask(await f.store.query({kind:'task.get',taskId:'task-one'}),{actorId:'owner'},{store:f.store})
 assert.deepEqual(projection.changesComplete,{memory:true,skill:true})
 assert.ok(projection.changes.find(row=>row.kind==='memory').entryId)
 const again=await f.ctx.reflection.inspectTask(await f.store.query({kind:'task.get',taskId:'task-one'}),{actorId:'owner'},{store:f.store})
 assert.equal(again.changes[0].entryId,projection.changes[0].entryId)
 const task=await f.store.query({kind:'task.get',taskId:'task-one'}),change=projection.changes.find(row=>row.kind==='memory')
 const body=await f.ctx.reflection.inspectTask(task,{actorId:'owner'},{store:f.store,changeId:change.id,version:change.version})
 assert.equal(body.text,rows[1].text,'UI removal does not alter the complete stored body or paragraph boundaries')
 await assert.rejects(f.ctx.reflection.inspectTask(task,{actorId:'owner'},{store:f.store,changeId:change.id,version:'0'.repeat(64)}),{code:'LEARNING_VERSION_STALE'})
 // Authenticated actors share the Bot namespace; do not invent actor-private scopes.
 const shared=await f.ctx.reflection.inspectTask(task,{actorId:'another-authenticated-reader'},{store:f.store,changeId:change.id,version:change.version})
 assert.equal(shared.text,body.text)

})

test('interrupted commits retry their reserved names without new inference, overwrite or duplication',async t=>{
 const f=await fixture(t,input=>[lesson(input,'first'),lesson(input,'second')]),memory=f.ctx.memory.store
 let writes=0;memory.beforeApply=()=>{if(++writes===2)throw Object.assign(new Error('injected interrupted commit'),{code:'INJECTED'})}
 await f.start();memory.beforeApply=undefined
 const failed=(await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)]
 assert.equal(failed.code,'MEMORY_COMMIT_UNCERTAIN');assert.deepEqual(failed.lessons.map(row=>row.memoryKey),['first','second'])
 const before=(await memory.read(f.scope,{topic:'experience'})).entries
 assert.equal(before.length,2)
 await f.retry()
 assert.equal(f.analyses,1);assert.deepEqual((await memory.read(f.scope,{topic:'experience'})).entries,before)
 assert.equal((await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)].status,'done')
})

test('forgetting a partially applied review removes its reserved lesson and does not resurrect it on retry',async t=>{
 const f=await fixture(t,input=>[lesson(input,'first'),lesson(input,'second')]),memory=f.ctx.memory.store
 let writes=0;memory.beforeApply=()=>{if(++writes===2)throw new Error('injected interruption')}
 await f.start();memory.beforeApply=undefined
 await memory.forget(f.scope,{topic:'experience',key:'first'})
 await f.ctx.reflection.forget(f.scope,'first')
 await f.retry()
 assert.equal(f.analyses,1);assert.deepEqual((await memory.read(f.scope,{topic:'experience'})).entries.map(row=>row.key),['second'])
 const report=(await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)]
 assert.deepEqual(report.lessons.map(row=>row.memoryKey),['second'])
})

test('duplicate model lesson keys fail before any memory writes',async t=>{
 const f=await fixture(t,input=>[lesson(input,'same'),lesson(input,'same')])
 await f.start()
 assert.equal((await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)].code,'REFLECTION_DUPLICATE_KEY')
 assert.deepEqual((await f.ctx.memory.store.read(f.scope,{topic:'experience'})).entries,[])
})

test('a Router collision during inference is fenced, then retried under a free name without overwriting',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await fixture(t,async input=>{entered.resolve();await release.promise;return [lesson(input,'same-name')]})
 const pending=f.start();await entered.promise
 await f.ctx.memory.store.remember(f.scope,{topic:'experience',key:'same-name',text:'Concurrent Router memory',source:{sessionId:'router',messageId:'current'}})
 release.resolve();await pending
 const before=(await f.ctx.memory.store.read(f.scope,{topic:'experience'})).entries[0]
 const failed=(await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)]
 assert.equal(failed.code,'MEMORY_SCOPE_CHANGED');assert.equal(failed.lessons[0].memoryWrite,'not-applied')
 await f.retry()
 const rows=(await f.ctx.memory.store.read(f.scope,{topic:'experience'})).entries
 assert.deepEqual(rows[0],before);assert.equal(rows[1].key,'same-name-2');assert.equal(f.analyses,1)
 assert.equal((await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)].destinations[0].memory.key,'same-name-2')
})

test('partial retries reassign only rejected keys and never replay a completed skill over later Router changes',async t=>{
 for(const action of ['upsert','delete'])await t.test(action,async t=>{
  const f=await fixture(t,input=>[{...lesson(input,'first'),skill:{steps:['Original learned step'],reason:'Verified result',applicability:'Local evidence checks',evidenceBacked:true}},lesson(input,'second')])
  const memory=f.ctx.memory.store,remember=memory.remember.bind(memory);let collided=false
  memory.remember=async(scope,args)=>{
   if(args.key==='second'&&!collided){collided=true;await remember(scope,{topic:'experience',key:'second',text:'Router-owned second name',source:{sessionId:'router',messageId:'collision'}});throw Object.assign(new Error('scope changed'),{code:'MEMORY_SCOPE_CHANGED'})}
   return remember(scope,args)
  }
  await f.start()
  const state=await f.ctx.reflection.state(f.scope),review=state.reviews[hash(f.event.id)]
  assert.equal(review.lessons[0].applied,true);assert.equal(review.lessons[1].memoryWrite,'not-applied');assert.equal(state.skills.first.revision,1)
  await f.ctx.reflection.mutateSkill(f.scope,{action,key:'first',operationId:'router-'+action,expectedRevision:1,source:{sessionId:'router',messageId:action,actor:hash('owner'),quoteSha256:hash(action)},steps:['Later Router instruction'],reason:'Current source',applicability:'Current local checks'})
  const edited=await f.ctx.reflection.state(f.scope),before=(await memory.read(f.scope,{topic:'experience'})).entries
  await f.retry()
  const after=await f.ctx.reflection.state(f.scope),rows=(await memory.read(f.scope,{topic:'experience'})).entries
  assert.deepEqual(after.skills,edited.skills);assert.deepEqual(after.skillRevisions,edited.skillRevisions)
  assert.deepEqual(rows.slice(0,2),before);assert.equal(rows[2].key,'second-2');assert.equal(f.analyses,1)
  assert.equal(after.reviews[hash(f.event.id)].status,'done')
 })
})

test('an uncertain commit keeps its identity even if another writer replaces its name before retry',async t=>{
 const f=await fixture(t,input=>[lesson(input,'uncertain')]),memory=f.ctx.memory.store
 memory.beforeApply=()=>{throw new Error('interrupted journal apply')}
 await f.start();memory.beforeApply=undefined
 assert.equal((await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)].lessons[0].memoryWrite,'uncertain')
 await memory.remember(f.scope,{topic:'experience',key:'uncertain',text:'Later Router replacement',source:{sessionId:'router',messageId:'replacement'}})
 const before=(await memory.read(f.scope,{topic:'experience'})).entries
 await f.retry()
 assert.deepEqual((await memory.read(f.scope,{topic:'experience'})).entries,before)
 assert.equal((await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)].lessons[0].memoryKey,'uncertain')
})

test('a failed derived skill publication cannot replay its committed content over a later Router change',async t=>{
 for(const action of ['upsert','delete'])await t.test(action,async t=>{
  const f=await fixture(t,input=>[{...lesson(input,'first'),skill:{steps:['Original learned step'],reason:'Verified result',applicability:'Local evidence checks',evidenceBacked:true}}])
  const path=join(f.ctx.reflection.directory(f.scope),'skills','first','SKILL.md')
  await mkdir(path,{recursive:true});await f.start()
  const failed=await f.ctx.reflection.state(f.scope)
  assert.equal(failed.reviews[hash(f.event.id)].status,'failed');assert.equal(failed.reviews[hash(f.event.id)].lessons[0].applied,true)
  assert.equal(failed.skills.first.revision,1)
  await rm(path,{recursive:true})
  await f.ctx.reflection.mutateSkill(f.scope,{action,key:'first',operationId:'router-'+action,expectedRevision:1,source:{sessionId:'router',messageId:action,actor:hash('owner'),quoteSha256:hash(action)},steps:['Later Router instruction'],reason:'Current source',applicability:'Current local checks'})
  const edited=await f.ctx.reflection.state(f.scope)
  await f.retry()
  const after=await f.ctx.reflection.state(f.scope)
  assert.deepEqual(after.skills,edited.skills);assert.deepEqual(after.skillRevisions,edited.skillRevisions)
  if(action==='upsert')assert.match(await readFile(path,'utf8'),/Later Router instruction/)
  else await assert.rejects(readFile(path),{code:'ENOENT'})
  assert.equal(f.analyses,1);assert.equal(after.reviews[hash(f.event.id)].status,'done')
 })
})

test('persisted key associations inspect and forget without rewriting current data or invoking inference',async t=>{
 const f=await fixture(t,()=>[]),id=hash(f.event.id),key='readable-memory'
 await f.ctx.memory.store.remember(f.scope,{topic:'experience',key,text:'Historical retained lesson',source:{sessionId:'old-session',messageId:f.event.id},provenance:{taskId:'task-one'}})
 const directory=f.ctx.reflection.directory(f.scope),state={version:1,skills:{},reviews:{[id]:{status:'done',eventId:f.event.id,taskId:'task-one',lessons:[{key:'legacy',memoryKey:key,summary:'Historical retained lesson'}]}}}
 await atomicWrite(join(directory,'state.json'),JSON.stringify(state));const before=await readFile(join(directory,'state.json'))
 await f.start()
 const task=await f.store.query({kind:'task.get',taskId:'task-one'}),detail=await f.ctx.reflection.inspectTask(task,{actorId:'owner'},{store:f.store})
 assert.equal(f.analyses,0);assert.deepEqual(await readFile(join(directory,'state.json')),before)
 assert.equal(detail.changes[0].name,key);assert.equal(detail.changes[0].status,'applied')
 await f.ctx.memory.store.forget(f.scope,{topic:'experience',key});await f.ctx.reflection.forget(f.scope,key)
 assert.deepEqual((await f.ctx.reflection.state(f.scope)).reviews[id].lessons,[])
})

test('retained main-format reviews do not block new lessons, inspect explicit destinations and forget only the selected association',async t=>{
 const f=await fixture(t,input=>[lesson(input,'reserved')]),memory=f.ctx.memory.store,directory=f.ctx.reflection.directory(f.scope)
 const eventId='historical-completion',id=hash(eventId),missingId=hash('missing-completion'),unpairedId=hash('unpaired-completion')
 const historical={status:'done',attempts:1,eventId,taskId:'task-one',recordedAt:'2026-01-01T00:00:00Z',lessons:[{key:'old-first',summary:'Retained original fields'},{key:'old-second',summary:'Unrelated retained lesson'}],destinations:['reserved','second-retained'].map(key=>({memory:{scope:f.scope,topic:'experience',key}}))}
 const missing={status:'done',eventId:'missing-completion',taskId:'task-one',lessons:[{key:'unknown-legacy-name',summary:'No explicit destination'}]}
 const unpaired={status:'done',eventId:'unpaired-completion',taskId:'task-one',lessons:[{key:'unknown-one'},{key:'unknown-two'}],destinations:[{memory:{scope:f.scope,topic:'experience',key:'reserved'}}]}
 const state={version:1,skills:{},reviews:{[id]:historical,[missingId]:missing,[unpairedId]:unpaired}}
 await atomicWrite(join(directory,'state.json'),JSON.stringify(state))
 await atomicWrite(join(directory,'reviews',id+'.json'),JSON.stringify(historical))
 const oldArchive=await readFile(join(directory,'reviews',id+'.json'))
 for(const key of ['reserved','second-retained'])await memory.remember(f.scope,{topic:'experience',key,text:'Original memory '+key,source:{sessionId:'old-session',messageId:eventId},provenance:{taskId:'task-one'}})
 const original=(await memory.read(f.scope,{topic:'experience'})).entries
 await f.start()
 const saved=await f.ctx.reflection.state(f.scope)
 assert.equal(f.analyses,1);assert.equal(saved.reviews[hash(f.event.id)].status,'done')
 assert.equal(saved.reviews[hash(f.event.id)].lessons[0].memoryKey,'reserved-2')
 assert.deepEqual(saved.reviews[id],historical);assert.deepEqual(saved.reviews[missingId],missing);assert.deepEqual(saved.reviews[unpairedId],unpaired)
 assert.deepEqual(await readFile(join(directory,'reviews',id+'.json')),oldArchive)
 assert.deepEqual((await memory.read(f.scope,{topic:'experience'})).entries.slice(0,2),original)
 const task=await f.store.query({kind:'task.get',taskId:'task-one'}),detail=await f.ctx.reflection.inspectTask(task,{actorId:'owner'},{store:f.store})
 assert.deepEqual(detail.changes.filter(row=>row.reviewId===id).map(row=>[row.name,row.status]),[['reserved','applied'],['second-retained','applied']])
 assert.equal(detail.changes.some(row=>row.reviewId===missingId),false)
 assert.equal(f.analyses,1)
 await memory.forget(f.scope,{topic:'experience',key:'reserved'})
 await f.ctx.reflection.forget(f.scope,'reserved')
 const forgotten=await f.ctx.reflection.state(f.scope)
 assert.deepEqual(forgotten.reviews[id].lessons,[historical.lessons[1]])
 assert.deepEqual(forgotten.reviews[id].destinations,[historical.destinations[1]])
 assert.deepEqual(forgotten.reviews[missingId],missing);assert.deepEqual(forgotten.reviews[unpairedId],unpaired)
 assert.deepEqual((await memory.read(f.scope,{topic:'experience'})).entries.map(row=>row.key),['second-retained','reserved-2'])
 assert.deepEqual(JSON.parse(await readFile(join(directory,'reviews',id+'.json'),'utf8')),forgotten.reviews[id])
})

test('historical failed reviews stay unchanged and never replay, while later completions still learn',async t=>{
 for(const savedLessons of [undefined,[],[{key:'old-name',summary:'Possibly committed before the historical failure'}]])await t.test(savedLessons===undefined?'unknown effects':savedLessons.length?'unversioned lessons':'unversioned empty lessons',async t=>{
  const f=await fixture(t,input=>[lesson(input,'new-only')]),directory=f.ctx.reflection.directory(f.scope),id=hash(f.event.id)
  const historical={status:'failed',attempts:1,retryAt:0,eventId:f.event.id,taskId:'task-one',code:'MEMORY_COMMIT_UNCERTAIN',...savedLessons?{lessons:savedLessons}: {},destinations:[{memory:{scope:f.scope,topic:'experience',key:'historical-destination'}}]}
  const initial=JSON.stringify({version:1,skills:{},reviews:{[id]:historical}})
  await atomicWrite(join(directory,'state.json'),initial)
  await f.start()
  assert.equal(f.analyses,0);assert.equal(await readFile(join(directory,'state.json'),'utf8'),initial)
  assert.deepEqual((await f.ctx.memory.store.read(f.scope,{topic:'experience'})).entries,[])
  await f.command('task.create',{taskId:'task-two',request:'New evidence after retained failure',ownerActorId:'owner'})
  await initializeMemoryTaskWorkspace(f.store,f.ctx.runtimePaths.workspaces,'task-two')
  const binding=(await f.command('task.claim',{taskId:'task-two'})).result.binding
  const event=(await f.command('task.complete',{binding,summary:'Verified new evidence'})).completionEvent
  f.ctx.reflection.scan();await f.ctx.reflection.whenIdle()
  const state=await f.ctx.reflection.state(f.scope)
  assert.equal(f.analyses,1);assert.deepEqual(state.reviews[id],historical)
  assert.equal(state.reviews[hash(event.id)].status,'done')
  assert.equal(state.reviews[hash(event.id)].memoryKeyVersion,1)
  assert.deepEqual((await f.ctx.memory.store.read(f.scope,{topic:'experience'})).entries.map(row=>row.key),['new-only'])
 })
})

test('new pre-effect failures retain the retry protocol and can infer again without a reserved key',async t=>{
 let attempt=0
 const f=await fixture(t,input=>[++attempt===1?{...lesson(input,'retry'),summary:undefined}:lesson(input,'retry')])
 await f.start()
 const failed=(await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)]
 assert.equal(failed.code,'MEMORY_TEXT_INVALID');assert.equal(failed.memoryKeyVersion,1);assert.equal(failed.lessons,undefined)
 await f.retry()
 assert.equal(f.analyses,2);assert.equal((await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)].status,'done')
 assert.deepEqual((await f.ctx.memory.store.read(f.scope,{topic:'experience'})).entries.map(row=>row.key),['retry'])
})

test('descriptor-only review key reservations still include expired occupied names',async t=>{
 const f=await fixture(t,input=>[lesson(input,'expired-name')]),memory=f.ctx.memory.store
 let now=Date.now();memory.now=()=>now
 await memory.remember(f.scope,{topic:'experience',key:'expired-name',text:'Retained expired fact',expiresAt:new Date(now+1000).toISOString(),source:{sessionId:'prior',messageId:'prior'}})
 now+=2000
 await f.start()
 const review=(await f.ctx.reflection.state(f.scope)).reviews[hash(f.event.id)]
 assert.equal(review.status,'done');assert.equal(review.lessons[0].memoryKey,'expired-name-2')
 assert.deepEqual((await memory.index(f.scope,{topic:'experience'})).entries.map(entry=>entry.key),['expired-name-2'])
 assert.equal((await memory.index(f.scope,{topic:'experience',includeExpired:true})).entries.length,2)
})
