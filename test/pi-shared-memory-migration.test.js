import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {MarkdownMemoryStore} from '../src/memory/store.js'
import {migrateSharedMemory} from '../src/memory/shared-migration.js'
import {memoryScope} from '../src/memory/scope.js'
import {hash} from '../src/memory/format.js'
import {recordUsage,readUsage} from '../src/memory/evolution.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-shared-migrate-')),store=new MarkdownMemoryStore(root);t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true})});return {root,store}}
test('旧个人/群组记录无损汇入公共库，冲突留为候选，计数只迁一次，删除后重启不复活',async t=>{
 const {root,store}=await fixture(t),a={kind:'personal',id:hash('personal:alice'),actor:hash('alice')},b={kind:'group',id:hash('group:one'),actor:hash('bob')},shared=memoryScope({actorId:'any'})
 const remember=(scope,id,key,text)=>store.remember(scope,{topic:'facts',key,text,source:{sessionId:'retained-session',messageId:id}})
 await remember(a,'a','style','First retained value');await remember(b,'b','style','Conflicting retained value');await remember(b,'c','unique','Unique retained value')
 await recordUsage(store,a,'readCount');await recordUsage(store,b,'readCount');await recordUsage(store,b,'searchCount')
 const before=await readFile(join(store.directory(a),'topics',hash('facts')+'.md'))
 const result=await migrateSharedMemory(store);assert.equal(result.conflicts,1)
 const accepted=await store.read(shared,{topic:'facts'}),candidates=await store.read(shared,{candidates:true});assert.equal(accepted.entries.length,2);assert.equal(candidates.entries.length,1);assert.equal(candidates.entries[0].text,'Conflicting retained value');assert.equal(candidates.entries[0].migration.conflict,true);assert.equal(candidates.entries[0].source.messageId,'b')
 assert.deepEqual(await readFile(join(store.directory(a),'topics',hash('facts')+'.md')),before)
 assert.equal((await readUsage(store,shared)).readCount,2);assert.equal((await readUsage(store,shared)).searchCount,1)
 await rm(join(store.directory(shared),'migration.json'));await migrateSharedMemory(store);assert.equal((await store.read(shared,{candidates:true})).entries.length,1);assert.equal((await readUsage(store,shared)).readCount,2)
 await store.forget(shared,{topic:'facts',key:'style'});await migrateSharedMemory(store);assert.equal((await store.read(shared,{topic:'facts',key:'style'})).entries.length,0)
 assert.equal(JSON.parse(await readFile(join(root,'v2','bot','migration.json'),'utf8')).legacyOriginalsRetained,true)
})
test('迁移保留不同旧技能与复盘依据；拒绝链接目录，不读取安装外文件',async t=>{
 const {root,store}=await fixture(t),scope={kind:'group',id:hash('room'),actor:hash('member')},shared=memoryScope({actorId:'any'})
 await store.remember(scope,{topic:'experience',key:'lesson-one',text:'Evidence-linked old observation',source:{sessionId:'task-session',messageId:'completed-event'}})
 const state={version:1,reviews:{[hash('completed-event')]:{status:'done',taskId:'task-one',eventId:'completed-event',lessons:[]}},skills:{check:{active:true,signature:'signature',steps:['Check evidence'],reason:'Direct observation',applicability:'Local checks',revision:1,taskIds:['task-one'],supports:[{taskId:'task-one',memoryKey:'lesson-one'}]}}}
 await mkdir(join(store.directory(scope),'evolution'),{recursive:true});await writeFile(join(store.directory(scope),'evolution','state.json'),JSON.stringify(state))
 await symlink('/tmp',join(root,'v1','group',hash('escape')),'dir');await assert.rejects(migrateSharedMemory(store),{code:'MEMORY_MIGRATION_PATH_UNSAFE'});await rm(join(root,'v1','group',hash('escape')))
 await migrateSharedMemory(store);const current=JSON.parse(await readFile(join(store.directory(shared),'evolution','state.json'),'utf8'));assert.equal(current.skills.check.supports[0].memoryKey,'lesson-one');assert.equal(current.reviews[hash('completed-event')].taskId,'task-one')
 await rm(join(store.directory(shared),'evolution','reviews',hash('completed-event')+'.json'));await rm(join(store.directory(shared),'migration.json'));await migrateSharedMemory(store);assert.equal(JSON.parse(await readFile(join(store.directory(shared),'evolution','reviews',hash('completed-event')+'.json'),'utf8')).taskId,'task-one')
})
