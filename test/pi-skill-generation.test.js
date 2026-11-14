import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost,initializeMemoryTaskWorkspace,scriptedSkillGeneration} from './fixtures/memory-host.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {bundledSkillDir} from '../src/runtime/paths.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
const args={action:'upsert',key:'inspect-first',operationId:'create',expectedRevision:0,source:{sessionId:'router',messageId:'authenticated-source',actor:hash('owner'),quoteSha256:hash('Read evidence')},steps:['Read observed evidence'],reason:'Evidence supports this bounded method',applicability:'Local evidence inspection'}
const isGeneration=body=>JSON.stringify(body.messages).includes('NIGHT_BOT_SKILL_GENERATION')
const draft=body=>{const result=scriptedSkillGeneration(body);return result?.text?{text:JSON.stringify({description:'Inspect local evidence before changes',body:'# Evidence-first inspection\n\nVerify the observation and retain a readback.\n\n'+JSON.parse(result.text).body})}:result}

test('Router create/update load bundled creator and publish generated output; CAS, duplicate and cold restart do not regenerate',async t=>{
 const f=await memoryHost(t,body=>isGeneration(body)?draft(body):undefined),scope=memoryScope({actorId:'owner'}),reflection=f.host.ctx.reflection
 const result=await reflection.mutateSkill(scope,{...args,model:f.config.model})
 assert.equal(result.persisted,true)
 const requests=f.requests.filter(isGeneration);assert.equal(requests.length,2)
 assert.deepEqual(requests[0].tools.map(tool=>tool.function.name),['skill'])
 assert.match(requests[1].messages.find(message=>message.role==='tool').content,/Night Bot 适配（本仓修改）/)
 const state=await reflection.state(scope),skill=state.skills[args.key],path=join(reflection.directory(scope),'skills',args.key,'SKILL.md')
 assert.equal(skill.generation.creator.sha256,hash(await readFile(join(bundledSkillDir,'skill-creator','SKILL.md'),'utf8')))
 assert.equal(skill.generation.creator.source,'bundled');assert.equal(skill.generation.creator.name,'skill-creator');assert.ok(skill.generation.creator.callId)
 assert.equal(skill.generation.inputSha256,hash(requests[0].messages.find(message=>message.role==='user').content.map(part=>part.text??'').join('')))
 assert.equal(skill.generation.outputSha256,hash(JSON.stringify({description:skill.applicability,body:skill.body})))
 assert.match(await readFile(path,'utf8'),/# Evidence-first inspection/);assert.notEqual(skill.body,args.steps.join('\n'));assert.deepEqual(result.generation,skill.generation)
 const update=await reflection.mutateSkill(scope,{...args,operationId:'update',expectedRevision:1,steps:['Read current evidence and compare'],model:f.config.model})
 assert.equal(update.revision,2);assert.equal(f.requests.filter(isGeneration).length,4)
 const current=await readFile(path,'utf8');assert.match(current,/Read current evidence and compare/)
 const calls=f.requests.length;await reflection.mutateSkill(scope,args)
 await assert.rejects(reflection.mutateSkill(scope,{...args,operationId:'stale'}),{code:'REFLECTION_REVISION_CONFLICT'});assert.equal(f.requests.length,calls)
 await f.close();await f.boot();await f.host.ctx.reflection.mutateSkill(scope,args);assert.equal(f.requests.length,calls);assert.equal(await readFile(path,'utf8'),current)
})

for(const missing of [false,true])test('committed task review stays tool-free and creator failure never rolls back delivery: '+missing,async t=>{
 const cleanups=[];let store
 t.after(async()=>{await store?.close();for(const cleanup of cleanups.reverse())await cleanup()})
 const f=await memoryHost({after:cleanup=>cleanups.push(cleanup)},body=>{
  if(isGeneration(body))return draft(body)
  if(JSON.stringify(body.messages).includes('NIGHT_BOT_TASK_REFLECTION')){
   assert.ok(!body.tools?.length,'the retrospective stays tool-free')
   const input=JSON.parse(body.messages.findLast(message=>message.role==='user').content)
   return {text:JSON.stringify({lessons:[{key:args.key,summary:'Inspect evidence',why:'Completion is bounded',howToApply:'Read evidence before edits',evidenceIds:[input.eventId],skill:{steps:args.steps,reason:args.reason,applicability:args.applicability,evidenceBacked:true}}]})}
  }
 }),ctx=f.host.ctx,scope=memoryScope({actorId:'owner'})
 if(missing)t.mock.method(ctx.reflection,'creator',async()=>{throw Object.assign(new Error('missing'),{code:'SKILL_CREATOR_UNAVAILABLE'})})
 store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'creator.sqlite'),instanceId:'creator',initialize:true})
 await store.command({id:'create',kind:'task.create',args:{taskId:'one',request:'isolated bounded task',ownerActorId:'owner'}})
 await initializeMemoryTaskWorkspace(store,ctx.runtimePaths.workspaces,'one')
 const {binding}=(await store.command({id:'claim',kind:'task.claim',args:{taskId:'one'}})).result
 const {completionEvent}=await store.command({id:'complete',kind:'task.complete',args:{binding,summary:'Verified readback'}})
 const detach=ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});t.after(detach);await ctx.reflection.whenIdle()
 const state=await ctx.reflection.state(scope),report=state.reviews[hash(completionEvent.id)],skill=state.skills[args.key]
 if(missing){assert.equal(report.status,'failed');assert.equal(report.code,'SKILL_CREATOR_UNAVAILABLE');assert.equal(skill,undefined);assert.equal((await store.query({kind:'task.get',taskId:'one'})).status,'completed');return}
 assert.equal(report.status,'done',ctx.reflection.lastError);assert.equal(skill.generation.creator.source,'bundled')
 assert.deepEqual(report.lessons[0].evidenceIds,[completionEvent.id]);assert.deepEqual(report.lessons[0].generated.generation,skill.generation)
 assert.match(await readFile(join(ctx.reflection.directory(scope),'skills',args.key,'SKILL.md'),'utf8'),/Evidence-first inspection/)
 const count=f.requests.length;ctx.reflection.scan();await ctx.reflection.whenIdle();assert.equal(f.requests.length,count)
 assert.equal((await store.query({kind:'task.get',taskId:'one'})).status,'completed')
})

for(const fault of ['missing','not-used','invalid','model-error'])test('creator failure cannot publish a formal skill: '+fault,async t=>{
 const f=await memoryHost(t,body=>{
  if(!isGeneration(body))return
  if(fault==='not-used')return {text:JSON.stringify({description:'fake',body:'not generated'})}
  if(fault==='model-error')return {error:'synthetic generator failure'}
  const result=scriptedSkillGeneration(body);return result?.text?{text:'invalid output'}:result
 }),reflection=f.host.ctx.reflection,scope=memoryScope({actorId:'owner'})
 if(fault==='missing')t.mock.method(reflection,'creator',async()=>{throw Object.assign(new Error('missing'),{code:'SKILL_CREATOR_UNAVAILABLE'})})
 await assert.rejects(reflection.mutateSkill(scope,{...args,model:f.config.model}),error=>Boolean(error.code))
 const state=await reflection.state(scope);assert.deepEqual(state.skills,{});assert.equal(state.mutations,undefined);assert.ok(state.generationFailures[hash(args.operationId)].code)
 await assert.rejects(readFile(join(reflection.directory(scope),'skills',args.key,'SKILL.md')),{code:'ENOENT'})
})

for(const change of ['authority','forget'])test('unlocked generation cannot publish after '+change+' changes',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await memoryHost(t,async body=>{
  if(!isGeneration(body))return
  const result=draft(body)
  if(result?.text){entered.resolve();await release.promise}
  return result
 }),reflection=f.host.ctx.reflection,scope=memoryScope({actorId:'owner'})
 let allowed=true
 const pending=reflection.mutateSkill(scope,{...args,model:f.config.model,validate:async()=>{if(!allowed)throw Object.assign(new Error('revoked'),{code:'MEMORY_READ_ONLY'})}})
 await entered.promise
 const {lstat}=await import('node:fs/promises')
 await assert.rejects(lstat(join(reflection.directory(scope),'.lock')),{code:'ENOENT'})
 if(change==='authority')allowed=false
 else await reflection.forget(scope,'unrelated')
 release.resolve()
 await assert.rejects(pending,{code:change==='authority'?'MEMORY_READ_ONLY':'REFLECTION_REVISION_CONFLICT'})
 assert.equal((await reflection.state(scope)).skills[args.key],undefined)
})

for(const cancellation of ['caller','host'])test('generation aborts and drains on '+cancellation+' cancellation',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const f=await memoryHost(t,async body=>{
  if(!isGeneration(body))return
  const result=draft(body)
  if(result?.text){entered.resolve();await release.promise}
  return result
 }),reflection=f.host.ctx.reflection,scope=memoryScope({actorId:'owner'}),controller=new AbortController()
 const pending=reflection.mutateSkill(scope,{...args,model:f.config.model,signal:controller.signal})
 const rejected=assert.rejects(pending,{name:'AbortError'})
 await entered.promise
 if(cancellation==='caller')controller.abort()
 else reflection.abort.abort()
 await rejected
 release.resolve()
 const state=await reflection.state(scope)
 assert.equal(state.skills[args.key],undefined);assert.equal(state.mutations,undefined)
 assert.ok(state.generationFailures[hash(args.operationId)].code)
})
