import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {decodePiJournal} from '../src/runtime/pi-journal.js'
import NativeWorkingDirectory from '../src/native-working-directory.js'
import {nativeBusinessPolicyFixture} from './fixtures/native-business-policy.js'
const gate=()=>Promise.withResolvers()
async function fixture(t){
 const h=await nativeBusinessPolicyFixture(t),directories=new Set(['/project','/project/sub','/other']),notices=[],contexts=[]
 h.ctx.provide('fs',{resolve:async(path,{cwd='/project',signal}={})=>{signal?.throwIfAborted();return resolve(cwd,path)},stat:async path=>directories.has(path)?{type:'directory'}:undefined,processPath:path=>path})
 h.ctx.provide('systemPrompt',{context:row=>contexts.push(row),getContextOrder:()=>10});new NativeWorkingDirectory(h.ctx,{defaultDirectory:'/project'})
 let id=0;return {...h,directories,notices,contexts,agent:options=>h.actor('directory-'+ ++id,{admitNotice:async notice=>notices.push(notice),...options})}
}
test('native directory canonical changes, reliable notices and original-project recovery have explicit outcomes',async t=>{
 const h=await fixture(t),a=await h.agent(),before=h.ctx.workingDirectory.get(a.actor),after=await h.ctx.workingDirectory.set(a.actor,'sub'),context=h.ctx.workingDirectory.contextText(a.actor)
 h.directories.delete('/project/sub');const restored=await h.ctx.workingDirectory.ensure(a.actor)
 assert.deepEqual({before,after,context,restored},{before:'/project',after:'/project/sub',context:'Current working directory: "/project/sub".',restored:'/project'})
 assert.deepEqual((await a.facts()).map(({domain,kind,payload})=>({domain,kind,payload})),[{domain:'directory',kind:'changed',payload:{cwd:'/project/sub',recovered:false}},{domain:'directory',kind:'changed',payload:{cwd:'/project',recovered:true}}])
 assert.deepEqual(h.notices,[{previous:'/project',cwd:'/project/sub',recovered:false},{previous:'/project/sub',cwd:'/project',recovered:true}]);assert.equal(a.actor.session,undefined)
})
test('actor directories remain independent from immutable origin and missing paths never append',async t=>{
 const h=await fixture(t),a=await h.agent(),b=await h.agent();await h.ctx.workingDirectory.set(a.actor,'/other');assert.equal(a.store.header.cwd,'/project');assert.equal(h.ctx.workingDirectory.get(b.actor),'/project');const before=await a.facts()
 await assert.rejects(async()=>h.ctx.workingDirectory.set({id:a.actor.id,session:{header:{cwd:'/project'}}},'/other'),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
 await assert.rejects(h.ctx.workingDirectory.set(a.actor,'missing'),/does not exist/);await assert.rejects(h.ctx.workingDirectory.set(a.actor,''),/empty/);h.directories.delete('/other');h.directories.delete('/project');await assert.rejects(h.ctx.workingDirectory.ensure(a.actor),/does not exist/);assert.deepEqual(await a.facts(),before)
})
test('directory operations serialize per actor and sample previous committed cwd after earlier changes',async t=>{
 const h=await fixture(t),a=await h.agent(),entered=gate(),release=gate();h.directories.add('/other/sub');const original=h.ctx.fs.stat;let count=0;h.ctx.fs.stat=async(path,signal)=>{if(++count===1){entered.resolve();await release.promise}return original(path,signal)}
 const first=h.ctx.workingDirectory.set(a.actor,'/other');await entered.promise;const second=h.ctx.workingDirectory.set(a.actor,'sub');release.resolve();assert.equal(await first,'/other');assert.equal(await second,'/other/sub')
})
test('caller cancellation and owner retirement after filesystem work prevent durable cwd changes',async t=>{
 const h=await fixture(t),a=await h.agent(),entered=gate(),release=gate(),controller=new AbortController();h.ctx.fs.stat=async()=>{entered.resolve();await release.promise;return{type:'directory'}}
 const pending=h.ctx.workingDirectory.set(a.actor,'/other',controller.signal);await entered.promise;controller.abort(new Error('fixture cancel'));release.resolve();await assert.rejects(pending,/fixture cancel/);assert.deepEqual(await a.facts(),[])
 a.control.live=false;await assert.rejects(async()=>h.ctx.workingDirectory.set(a.actor,'/other'),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'});assert.deepEqual(await a.facts(),[])
})
test('directory service close aborts and drains filesystem work; notice failure cannot undo committed cwd',async t=>{
 const h=await fixture(t),a=await h.agent({admitNotice:async()=>{throw Error('notice failed')}});await assert.rejects(h.ctx.workingDirectory.set(a.actor,'/other'),/notice failed/);assert.equal(h.ctx.workingDirectory.get(a.actor),'/other')
 const entered=gate(),release=gate();h.ctx.fs.stat=async()=>{entered.resolve();await release.promise;return{type:'directory'}};const pending=h.ctx.workingDirectory.set(a.actor,'/project');await entered.promise;const rejected=assert.rejects(pending,/disposed/),closing=h.ctx.fiber.dispose();release.resolve();await rejected;await closing
 // Read committed native evidence through the backend, not a disposed store.
 assert.equal(decodePiJournal(await readFile(h.backend.path(a.actor.id)),a.actor.id,{requireComplete:true}).audit.filter(row=>row.domain==='directory').length,1)
})
test('initial directory is one durable native business fact; rejected operations do not poison later changes',async t=>{
 const h=await fixture(t),a=await h.agent();assert.equal(await h.ctx.workingDirectory.ensure(a.actor),'/project');assert.equal(a.store.header.cwd,'/project');assert.deepEqual((await a.facts()).at(-1),{version:1,domain:'directory',kind:'changed',payload:{cwd:'/project',recovered:false}})
 await assert.rejects(h.ctx.workingDirectory.set(a.actor,'missing'));assert.equal(await h.ctx.workingDirectory.set(a.actor,'sub'),'/project/sub')
})
test('directory validation retains caller attribution through injected filesystem service',async t=>{
 const h=await fixture(t),a=await h.agent(),{createScope,scopeOf}=await import('../src/native-scope.js'),{symbols}=await import('@deepseek-ai/cordis'),owner={},scope=createScope(h.ctx,owner),fs=h.ctx.fs;fs.ctx=h.ctx;Object.defineProperty(fs,symbols.tracker,{value:{property:'ctx'}})
 fs.resolve=function(path,{cwd='/project'}={}){if(scopeOf(this.ctx)===owner)throw Error('scoped filesystem denied');return resolve(cwd,path)};await assert.rejects(scope.ctx.workingDirectory.set(a.actor,'/other'),/scoped filesystem denied/);assert.deepEqual(await a.facts(),[]);await scope.dispose()
})
test('official directory context samples current committed cwd without a legacy assembly or Session projection',async t=>{
 const h=await fixture(t),a=await h.agent(),context=h.contexts.find(row=>row.name==='working-directory:current');await h.ctx.workingDirectory.set(a.actor,'/other')
 assert.equal(await context.officialText({actor:a.actor}),'Current working directory: "/other".');assert.equal(context.interpolate,false);assert.equal(h.ctx.get('sessions'),undefined);assert.equal(h.ctx.get('sessionProjections'),undefined)
})
