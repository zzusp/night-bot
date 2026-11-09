import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,appendFile,mkdir,cp,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {SessionManager,buildSessionProjection} from '@earendil-works/pi-coding-agent'
import PiPersistence from '../src/pi-session-persistence.js'
import * as Authority from '../src/pi-authority.js'
import {decodePiJournal} from '../src/runtime/pi-journal.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-native-store-')),ctx=new Context();await ctx.plugin(Authority)
 const backend=new PiPersistence(ctx,{root:join(root,'sessions')})
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {root,ctx,backend,header:id=>({version:4,id,createdAt:Date.now(),isSeeded:false,cwd:root})}
}
const message=text=>({role:'user',content:[{type:'text',text}],timestamp:Date.now()})
test('official native entries persist directly with branch leaf and no Host history',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('native'))
 h.manager.appendMessage(message('first'));const first=h.manager.getLeafId()
 h.manager.appendMessage(message('second'));await h.commit()
 assert.throws(()=>h.enqueue({type:'user/message'}),{code:'PI_SESSION_NATIVE_HOST_EVENT_FORBIDDEN'})
 h.manager.branch(first);await h.commit()
 const path=f.backend.path(h.id),bytes=await readFile(path),data=decodePiJournal(bytes,h.id,{requireComplete:true})
 assert.equal(data.format,'pi-native-v1');assert.equal('events' in data,false)
 assert.deepEqual(buildSessionProjection(data.entries,data.entries.at(-1).id).messages.map(m=>m.content[0].text),['first'])
 assert.equal(data.entries.filter(e=>e.type==='message').length,2)
 assert.equal((await f.backend.stat(h.id)).nativeEntryCount,data.entries.length)
 assert.deepEqual((await f.backend.list()).map(row=>row.format),['pi-native-v1'])
 await h.close();const restored=await f.backend.openNative('native')
 assert.deepEqual(restored.manager.buildSessionProjection().messages.map(m=>m.content[0].text),['first'])
 restored.manager.appendMessage(message('third'));await restored.close()
 assert.ok((await readFile(path)).subarray(0,bytes.length).equals(bytes))
})
test('native typed receipts require registered business schema; no generic events',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('audit'),{auditKinds:{'approval/asked':v=>typeof v.id==='string'}})
 assert.throws(()=>h.appendAudit({version:1,domain:'approval',kind:'asked',payload:{}}))
 assert.throws(()=>h.appendAudit({version:1,domain:'approval',kind:'user',payload:{}}))
 h.appendAudit({version:1,domain:'approval',kind:'asked',payload:{id:'request'}});await h.commit()
 assert.deepEqual(await h.readAudit(),[{version:1,domain:'approval',kind:'asked',payload:{id:'request'}}]);await h.close()
})
test('native open rejects uncommitted tails without mutation and rejects legacy upgrade',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('tail'));h.manager.appendMessage(message('safe'));await h.close()
 const path=f.backend.path('tail');await appendFile(path,'{"torn":');const bytes=await readFile(path)
 await assert.rejects(f.backend.openNative('tail'),{code:'PI_SESSION_UNCOMMITTED_TAIL'})
 assert.deepEqual(await readFile(path),bytes)
 const foreign=SessionManager.inMemory(f.root);foreign.newSession({id:'old'});foreign.appendCustomEntry('night.header',{header:f.header('old'),inheritedEventCount:0})
 await writeFile(f.backend.path('old'),[foreign.getHeader(),...foreign.getEntries()].map(entry=>JSON.stringify(entry)).join('\n')+'\n')
 const before=await readFile(f.backend.path('old'))
 await assert.rejects(f.backend.openNative('old'),{code:'PI_SESSION_FORMAT_UNSUPPORTED'})
 assert.deepEqual(await readFile(f.backend.path('old')),before)
 assert.equal(f.backend.create,undefined);assert.equal(f.backend.open,undefined)
})
test('native owner shares lease with old writer and abort never publishes',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('lease'))
 await assert.rejects(f.backend.openNative('lease'))
 await assert.rejects(f.backend.createNative(f.header('lease')),{name:'SessionAlreadyOwnedError'})
 const controller=new AbortController();controller.abort()
 await assert.rejects(h.commit({signal:controller.signal}),{name:'AbortError'})
 h.manager.appendMessage(message('after abort'));await h.close()
 assert.equal(decodePiJournal(await readFile(f.backend.path('lease')),'lease',{requireComplete:true}).entries.filter(e=>e.type==='message').length,1)
})

test('readNative uses committed cut without flushing live manager or copying authority',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('cut'))
 h.manager.appendMessage(message('committed'));await h.commit();h.manager.appendMessage(message('inflight'))
 const path=f.backend.path(h.id),bytes=await readFile(path),data=await f.backend.readNative(h.id)
 assert.deepEqual(data.context.piMessages.map(m=>m.content[0].text),['committed'])
 data.context.piMessages[0].content[0].text='tamper'
 assert.equal((await f.backend.readNative(h.id)).context.piMessages[0].content[0].text,'committed')
 assert.deepEqual(await readFile(path),bytes);assert.equal(h.manager.buildSessionProjection().messages.length,2)
 await h.close()
})

test('native task router requires existing binding, exact cwd and Host writer scope',async t=>{
 const {installTaskSessionPersistence}=await import('../packages/dingtalk-core/task-session-persistence.js')
 const f=await fixture(t);f.ctx.provide('agents',{create(){},resume(){},get(){}})
 const router=await installTaskSessionPersistence(f.ctx,{root:f.root}),taskId='task',id='routed-native',cwd=join(f.root,'tasks',taskId,'work')
 await router.register({taskId,sessionId:id,cwd})
 const header={...f.header(id),cwd}
 await assert.rejects(f.backend.createNative(header),{code:'TASK_SESSION_HOST_WRITER_REQUIRED'})
 await assert.rejects(router.runOwned({taskId,sessionId:id},()=>f.backend.createNative({...header,cwd:f.root})),{code:'TASK_SESSION_CWD_MISMATCH'})
 const h=await router.runOwned({taskId,sessionId:id},()=>f.backend.createNative(header))
 h.manager.appendMessage(message('task-only'));await h.close()
 await assert.rejects(f.backend.openNative(id),{code:'TASK_SESSION_HOST_WRITER_REQUIRED'})
 assert.deepEqual((await f.backend.readNative(id)).context.piMessages.map(m=>m.content[0].text),['task-only'])
 const reopened=await router.runOwned({taskId,sessionId:id},()=>f.backend.openNative(id));await reopened.close()
 await router.close()
})

test('official compaction and branch summary survive direct commit unchanged',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('summary'))
 h.manager.appendMessage(message('old'));h.manager.appendMessage(message('keep'));const keep=h.manager.getLeafId()
 h.manager.appendCompaction('official summary',keep,100)
 h.manager.branchWithSummary(keep,'official branch summary')
 const expected=structuredClone(h.manager.buildSessionProjection().messages)
 await h.commit();await h.close()
 const actual=await f.backend.readNative('summary')
 assert.deepEqual(actual.context.piMessages,expected)
 assert.ok(actual.context.projection.entries.some(e=>e.sourceEntry.type==='branch_summary'))
 const reopened=await f.backend.openNative('summary');assert.deepEqual(reopened.manager.buildSessionProjection().messages,expected);await reopened.close()
})


test('native portable copy restores logical cwd without rewriting original Pi bytes or user text',async t=>{
 const {runtimePaths}=await import('../src/runtime/paths.js'),{portablePaths}=await import('../src/runtime/portable.js')
 const root=await mkdtemp(join(tmpdir(),'night-native-portable-')),contexts=[]
 t.after(async()=>{for(const ctx of contexts)await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 async function setup(installRoot){const paths=runtimePaths({installRoot});await mkdir(paths.workspaces,{recursive:true});const ctx=new Context();contexts.push(ctx);ctx.provide('portablePaths',portablePaths(paths));await ctx.plugin(Authority);return {paths,ctx,backend:new PiPersistence(ctx,{root:join(paths.state,'sessions')})}}
 const source=await setup(join(root,'source')),header={version:4,id:'portable',createdAt:Date.now(),isSeeded:false,cwd:source.paths.workspaces}
 const h=await source.backend.createNative(header);h.manager.appendMessage(message(source.paths.workspaces));await h.close()
 const bytes=await readFile(source.backend.path('portable'));await source.ctx.fiber.dispose();await cp(source.paths.installRoot,join(root,'target'),{recursive:true})
 const target=await setup(join(root,'target')),read=await target.backend.readNative('portable')
 assert.equal(read.header.cwd,target.paths.workspaces);assert.equal(read.context.piMessages[0].content[0].text,source.paths.workspaces)
 const reopened=await target.backend.openNative('portable');assert.equal(reopened.manager.getCwd(),target.paths.workspaces);await reopened.close()
 assert.deepEqual(await readFile(target.backend.path('portable')),bytes)
})

test('native context edits retain original evidence and use official projection on restore',async t=>{
 const f=await fixture(t),h=await f.backend.createNative(f.header('edit'))
 const target=h.manager.appendMessage(message('original'))
 await h.commit();h.manager.appendContextEdit(target,{content:[{type:'text',text:'replacement'}]});await h.close()
 const data=decodePiJournal(await readFile(f.backend.path('edit')),'edit',{requireComplete:true})
 assert.equal(data.entries.find(e=>e.id===target).message.content[0].text,'original')
 assert.equal((await f.backend.readNative('edit')).context.piMessages[0].content[0].text,'replacement')
})
