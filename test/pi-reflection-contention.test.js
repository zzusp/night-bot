import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {lstat,mkdir} from 'node:fs/promises'
import {memoryHost,initializeMemoryTaskWorkspace} from './fixtures/memory-host.js'
import {openDynamicTaskStore} from '../packages/dingtalk-core/dynamic-task-store.js'
import {memoryScope} from '../src/memory/scope.js'
import {readEvolutionInventory} from '../packages/web-console/server/evolution-inventory.js'
import {openEvolutionCache,EVOLUTION_REFRESH_MS} from '../packages/web-console/server/evolution-cache.js'
import {withLock} from '../src/runtime/files.js'

async function completed(store,root,id){
 let n=0;const command=(kind,args)=>store.command({id:id+'-'+(++n),kind,args})
 await command('task.create',{taskId:id,request:'Verify isolated local evidence',ownerActorId:'owner'})
 await initializeMemoryTaskWorkspace(store,root,id)
 const binding=(await command('task.claim',{taskId:id})).result.binding
 return (await command('task.complete',{binding,summary:'Verified isolated result'})).completionEvent
}
test('slow reflection inference and archive do not block consistent inventory; completed events are not rescanned',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),archiving=Promise.withResolvers(),archiveRelease=Promise.withResolvers()
 t.after(()=>{release.resolve();archiveRelease.resolve()})
 let analyses=0,archives=0,store,failArchive=false,lastArchive
 const f=await memoryHost(t,async body=>{
  if(!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return
  analyses++;entered.resolve();await release.promise
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content)
  return {text:JSON.stringify({lessons:[{key:'inspect-first',summary:'Inspect current evidence',why:'Avoid stale assumptions',howToApply:'Read current state before editing',evidenceIds:[input.eventId]}]})}
 })
 t.after(async()=>{await f.close();await store?.close()})
 const ctx=f.host.ctx,scope=memoryScope({actorId:'owner'}),directory=ctx.reflection.directory(scope)
 store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'contention.sqlite'),instanceId:'contention',initialize:true})
 await completed(store,ctx.runtimePaths.workspaces,'one')
 const after=[],query=store.query.bind(store);const observedStore={...store,query:async args=>{if(args.kind==='task.events')after.push(args.after);return query(args)}}
 const detach=ctx.reflection.attachStore(observedStore,{ownerActorId:'owner',model:f.config.model,onReview:async(_task,report)=>{archives++;if(failArchive)throw new Error('archive temporarily unavailable');lastArchive=report;archiving.resolve();await archiveRelease.promise}});t.after(detach)
 await entered.promise
 const inventory=()=>readEvolutionInventory({memory:ctx.memory,reflection:ctx.reflection,binding:{actorId:'owner'}})
 let now=1000
 await mkdir(join(ctx.runtimePaths.state,'test-evolution-cache'),{mode:0o700})
 const cache=await openEvolutionCache({directory:join(ctx.runtimePaths.state,'test-evolution-cache'),identity:'owner',now:()=>now,collect:async()=>{const {items,memory,skills}=await inventory();return {status:'ready',items,memory,skills,usageCoverage:{status:'partial',sessionsRead:52,sessionsDiscovered:56,reasons:['SESSION_UNAVAILABLE']}}}})
 t.after(()=>cache.close())
 const before=await cache.read();assert.equal(before.snapshot.memory.acceptedCount,0)
 await assert.rejects(lstat(join(directory,'.lock')),{code:'ENOENT'})
 for(let i=0;i<30;i++)ctx.reflection.scan()
 release.resolve();await archiving.promise
 now+=EVOLUTION_REFRESH_MS
 const fresh=await cache.read({force:true});assert.equal(fresh.snapshot.memory.acceptedCount,1);assert.equal(fresh.cache.stale,false);assert.notEqual(fresh.cache.updatedAt,before.cache.updatedAt)
 assert.equal(fresh.snapshot.usageCoverage.status,'partial');assert.equal(fresh.snapshot.usageCoverage.sessionsRead,52)
 await assert.rejects(lstat(join(directory,'.lock')),{code:'ENOENT'})
 archiveRelease.resolve();await ctx.reflection.whenIdle()
 for(let i=0;i<3;i++){ctx.reflection.scan();await ctx.reflection.whenIdle()}
 assert.equal(analyses,1);assert.equal(archives,1);assert.equal(after[0],0);assert.ok(after.slice(1).every(value=>value>0))
 // Actual commit contention is still refused; no active lock is removed.
 await withLock(join(directory,'.lock'),async()=>{
  await assert.rejects(inventory(),{code:'EVOLUTION_BUSY'});assert.ok((await lstat(join(directory,'.lock'))).isDirectory())
 })
 assert.equal((await inventory()).memory.acceptedCount,1)
 failArchive=true
 await assert.rejects(ctx.reflection.forget(scope,'inspect-first'),/archive temporarily unavailable/)
 failArchive=false;ctx.reflection.scan();await ctx.reflection.whenIdle()
 assert.equal(analyses,1);assert.equal(lastArchive.forgotten,true);assert.deepEqual(lastArchive.lessons,[])
})

test('forgetting during unlocked inference revokes that generation and never replays its lessons',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 let analyses=0,store
 const f=await memoryHost(t,async body=>{
  if(!JSON.stringify(body).includes('NIGHT_BOT_TASK_REFLECTION'))return
  analyses++;entered.resolve();await release.promise
  const input=JSON.parse(body.messages.findLast(m=>m.role==='user').content)
  return {text:JSON.stringify({lessons:[{key:'forgotten',summary:'Old result',why:'Old evidence',howToApply:'Inspect before editing',evidenceIds:[input.eventId]}]})}
 })
 t.after(async()=>{await f.close();await store?.close()})
 const ctx=f.host.ctx,scope=memoryScope({actorId:'owner'})
 store=await openDynamicTaskStore({dbPath:join(ctx.runtimePaths.state,'revoke.sqlite'),instanceId:'revoke',initialize:true})
 await completed(store,ctx.runtimePaths.workspaces,'one')
 const detach=ctx.reflection.attachStore(store,{ownerActorId:'owner',model:f.config.model});t.after(detach)
 await entered.promise
 await ctx.memory.store.forget(scope,{topic:'experience',key:'forgotten'})
 await ctx.reflection.forget(scope,'forgotten')
 release.resolve();await ctx.reflection.whenIdle()
 const report=Object.values((await ctx.reflection.state(scope)).reviews)[0]
 assert.equal(report.status,'skipped');assert.equal(report.code,'REFLECTION_SCOPE_REVOKED')
 ctx.reflection.scan();await ctx.reflection.whenIdle()
 assert.equal(analyses,1);assert.deepEqual((await ctx.memory.store.read(scope,{topic:'experience'})).entries,[])
})

test('incremental scans process each page promptly and retry only unfinished events',async()=>{
 const {default:Reflection}=await import('../src/memory/reflection.js')
 const reflection=Object.create(Reflection.prototype),queries=[],reviewed=[]
 reflection.closed=false;reflection.jobs=new Set();reflection.sources=new Set()
 reflection.host={agents:{withoutInitiator:callback=>callback()},logger:{warn(){}}}
 const events=Array.from({length:205},(_,index)=>({id:index+1,kind:'task.completed'}))
 const source={after:0,pending:new Map(),store:{query:async({after,limit})=>{
  queries.push(after);const page=events.filter(event=>event.id>after).slice(0,limit)
  return {events:page,nextCursor:page.at(-1)?.id??after,hasMore:(page.at(-1)?.id??after)<205}
 }}}
 reflection.sources.add(source)
 reflection.review=async(_source,event)=>{if(!reviewed.length)assert.equal(queries.length,1);reviewed.push(event.id);return event.id!==1}
 await reflection.scanSource(source)
 assert.deepEqual(queries,[0,100,200]);assert.equal(reviewed.length,205);assert.deepEqual([...source.pending.keys()],[1])
 await reflection.scanSource(source)
 assert.deepEqual(queries,[0,100,200,205]);assert.equal(reviewed.length,206);assert.equal(reviewed.at(-1),1)
})
