import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import Reflection from '../src/memory/reflection.js'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {atomicWrite} from '../src/runtime/files.js'

test('forget commits authoritative review and skill removal before a failing archive callback',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-forget-')),store=new MarkdownMemoryStore(root)
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 const scope=memoryScope({actorId:'actor'}),id=hash('event'),key='lesson'
 const reflection=Object.create(Reflection.prototype)
 let invalidated=false
 reflection.host={memory:{store},skills:{invalidateCache(){invalidated=true}}}
 reflection.sources=new Set([{onReview:async()=>{throw new Error('archive unavailable')}}])
 const directory=reflection.directory(scope),state={version:1,skills:{lesson:{active:true,memoryKeys:[key]}},reviews:{[id]:{status:'done',eventId:'event',taskId:'task',lessons:[{key:'lesson',memoryKey:key,observation:'Forgotten observation'}],destinations:[{memory:{key}}]}}}
 await atomicWrite(join(directory,'state.json'),JSON.stringify(state))
 await atomicWrite(join(directory,'skills','lesson','SKILL.md'),'Forgotten derived skill')
 await assert.rejects(reflection.forget(scope,key),/archive unavailable/)
 const restarted=await reflection.state(scope)
 assert.deepEqual(restarted.skills,{})
 assert.deepEqual(restarted.reviews[id].lessons,[])
 assert.deepEqual(restarted.reviews[id].destinations,[])
 assert.equal(restarted.reviews[id].forgotten,true)
 assert.equal(invalidated,true)
 assert.doesNotMatch(await readFile(join(directory,'reviews',id+'.json'),'utf8'),/Forgotten observation/)
})

test('Router skill receipts repair current derived content, reject input reuse and never resurrect deleted versions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-router-skill-')),store=new MarkdownMemoryStore(root),scope=memoryScope({actorId:'actor'})
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 const reflection=Object.create(Reflection.prototype)
 reflection.host={memory:{store},skills:{invalidateCache(){}}}
 const source={sessionId:'router-session',messageId:'current-message',actor:hash('actor'),quoteSha256:hash('Current authenticated message')}
 const args={action:'upsert',key:'inspect-first',operationId:'create',source,steps:['读取当前证据'],reason:'当前工作可复用',applicability:'类似排障',expectedRevision:0}
 assert.equal((await reflection.mutateSkill(scope,args)).revision,1)
 const path=join(reflection.directory(scope),'skills','inspect-first','SKILL.md')
 assert.match(await readFile(path,'utf8'),/读取当前证据/)
 const update={...args,operationId:'update',steps:['先保留现有改动再读取证据'],expectedRevision:1}
 assert.equal((await reflection.mutateSkill(scope,update)).revision,2)
 const duplicate=await reflection.mutateSkill(scope,args)
 assert.equal(duplicate.duplicate,true);assert.equal(duplicate.currentRevision,2)
 assert.match(await readFile(path,'utf8'),/先保留现有改动/)
 await assert.rejects(reflection.mutateSkill(scope,{...args,steps:['覆盖旧操作']}),{code:'REFLECTION_OPERATION_CONFLICT'})
 await assert.rejects(reflection.mutateSkill(scope,{...update,operationId:'stale-update'}),{code:'REFLECTION_REVISION_CONFLICT'})
 const remove={action:'delete',key:args.key,operationId:'delete',source,expectedRevision:2}
 assert.equal((await reflection.mutateSkill(scope,remove)).revision,3)
 const oldCreate=await reflection.mutateSkill(scope,args)
 assert.equal(oldCreate.duplicate,true);assert.equal(oldCreate.active,false);assert.equal(oldCreate.currentRevision,3)
 await assert.rejects(readFile(path),{code:'ENOENT'})
 assert.deepEqual(await reflection.readSkills(scope,{key:args.key}),{revision:3,entries:[]})
 await assert.rejects(reflection.mutateSkill(scope,{...args,operationId:'stale-create'}),{code:'REFLECTION_REVISION_CONFLICT'})
 assert.equal((await reflection.mutateSkill(scope,{...args,operationId:'recreate',expectedRevision:3})).revision,4)
 const oldDelete=await reflection.mutateSkill(scope,remove)
 assert.equal(oldDelete.duplicate,true);assert.equal(oldDelete.active,true);assert.equal(oldDelete.currentRevision,4)
 assert.match(await readFile(path,'utf8'),/读取当前证据/)
 const reopened=Object.create(Reflection.prototype);reopened.host=reflection.host
 assert.equal((await reopened.readSkills(scope,{key:args.key})).entries[0].revision,4)
 assert.equal((await reopened.mutateSkill(scope,args)).currentRevision,4)
})

test('Router skill reports committed uncertainty until derived readback succeeds and rechecks authority after lock wait',async t=>{
 const {mkdir}=await import('node:fs/promises'),{withLock,failure}=await import('../src/runtime/files.js')
 const root=await mkdtemp(join(tmpdir(),'night-router-skill-fault-')),store=new MarkdownMemoryStore(root),scope=memoryScope({actorId:'actor'})
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})})
 const reflection=Object.create(Reflection.prototype);reflection.host={memory:{store},skills:{invalidateCache(){}}}
 const args={action:'upsert',key:'read-evidence',operationId:'create',source:{sessionId:'router',messageId:'message',actor:hash('actor'),quoteSha256:hash('source')},steps:['读取证据'],reason:'可复用',applicability:'排障'}
 const path=join(reflection.directory(scope),'skills',args.key,'SKILL.md')
 await mkdir(path,{recursive:true})
 for(let retry=0;retry<2;retry++)await assert.rejects(reflection.mutateSkill(scope,args),error=>error.code==='REFLECTION_WRITE_UNCONFIRMED'&&error.committed===true)
 assert.equal((await reflection.state(scope)).skills[args.key].revision,1)
 await rm(path,{recursive:true})
 const repaired=await reflection.mutateSkill(scope,args)
 assert.equal(repaired.duplicate,true);assert.equal(repaired.persisted,true)
 assert.match(await readFile(path,'utf8'),/读取证据/)
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const lock=withLock(join(reflection.directory(scope),'.lock'),async()=>{entered.resolve();await release.promise})
 await entered.promise
 let authorized=true
 const pending=reflection.mutateSkill(scope,{...args,key:'denied-after-wait',operationId:'revoked',validate:async()=>{if(!authorized)throw failure('MEMORY_READ_ONLY')}})
 authorized=false;release.resolve();await lock
 await assert.rejects(pending,{code:'MEMORY_READ_ONLY'})
 assert.equal((await reflection.state(scope)).skills['denied-after-wait'],undefined)
})
