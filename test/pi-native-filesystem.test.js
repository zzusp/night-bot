import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,readFile,writeFile,stat,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import NativeLocal from '../src/native-fs-local.js'
import NativeSandbox from '../src/native-fs-sandbox.js'
import * as observation from '../src/native-fs-observation-policy.js'
async function fixture(t,Impl=NativeLocal){const root=await mkdtemp(join(tmpdir(),'night-native-fs-')),ctx=new Context();ctx.provide('sandboxPolicy',{defaultMode:'workspace-write',resolve:()=>({mode:'workspace-write',workspaceRoot:root})});await ctx.plugin(Impl,{cwd:root,diffBasisMaxBytes:1024*1024});t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})});return{root,ctx,fs:ctx.get('fs')}}
async function contract(t,Impl){const h=await fixture(t,Impl),target=await h.fs.resolve('fixture.txt');await h.fs.writeText(target,'alpha\r\nbeta\r\n',{kind:'createIfAbsent'});const info=await h.fs.stat(target);assert.equal(await h.fs.readText(target),'alpha\r\nbeta\r\n');const result=await h.fs.writeText(target,'ALPHA\r\nbeta\r\n',{kind:'replaceIfVersion',version:info.version});const errors=[];for(const action of [()=>h.fs.writeText(target,'clobber',{kind:'createIfAbsent'}),()=>h.fs.writeText(target,'ALPHA\r\nBETA\r\n',{kind:'replaceIfVersion',version:info.version})])try{await action()}catch(e){errors.push(e.code)}return{before:result.before,after:result.after,raw:await readFile(join(h.root,'fixture.txt'),'utf8'),errors,bytes:Buffer.from(await h.fs.readBytes(target)).toString()}}
test('independent local IO atomically replaces CRLF bytes and enforces observation/CAS guards',async t=>{assert.deepEqual(await contract(t,NativeLocal),{before:'alpha\nbeta\n',after:'ALPHA\nbeta\n',raw:'ALPHA\r\nbeta\r\n',errors:['FS_NOT_OBSERVED','FS_STALE_VERSION'],bytes:'ALPHA\r\nbeta\r\n'})})
test('native local filesystem serializes competing CAS writes and preserves destination mode',async t=>{const h=await fixture(t),target=await h.fs.resolve('cas.txt');await writeFile(join(h.root,'cas.txt'),'initial',{mode:0o640});await chmod(join(h.root,'cas.txt'),0o640);const mode=(await stat(join(h.root,'cas.txt'))).mode&0o777,version=(await h.fs.stat(target)).version;const results=await Promise.allSettled(['first winner','second rejected'].map(content=>h.fs.writeText(target,content,{kind:'replaceIfVersion',version})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'FS_STALE_VERSION');assert.equal(await h.fs.readText(target),'first winner');assert.equal((await stat(join(h.root,'cas.txt'))).mode&0o777,mode)})
test('native local filesystem handles byte windows, binary refusal and pre-abort without mutation',async t=>{const h=await fixture(t),target=await h.fs.resolve('bytes.bin');await writeFile(join(h.root,'bytes.bin'),Buffer.from([0,1,2,3,4]));assert.deepEqual(Buffer.from(await h.fs.readByteRange(target,{offset:1,length:3})),Buffer.from([1,2,3]));await assert.rejects(h.fs.readText(target),e=>/binary file/.test(e.message));const c=new AbortController();c.abort();await assert.rejects(h.fs.writeText(target,'overwrite',undefined,c.signal),e=>e.code==='FS_ABORTED');assert.deepEqual(await readFile(join(h.root,'bytes.bin')),Buffer.from([0,1,2,3,4]))})
test('native filesystem policy rechecks canonical symlinks and denies read-only mutation',async t=>{const h=await fixture(t,NativeSandbox),target=await h.fs.resolve('inside.txt');await h.fs.writeText(target,'inside',{kind:'createIfAbsent'});await assert.rejects(h.fs.writeText(target,'denied',undefined,undefined,{mode:'read-only',workspaceRoot:h.root}),e=>e.code==='FS_SANDBOX_DENIED');const {mkdir}=await import('node:fs/promises'),{fileURLToPath}=await import('node:url'),base=fileURLToPath(new URL('../data/workspaces/',import.meta.url));await mkdir(base,{recursive:true});const outside=await mkdtemp(join(base,'night-fs-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await symlink(outside,join(h.root,'alias'));const alias=await h.fs.resolve('alias/outside.txt');await assert.rejects(h.fs.writeText(alias,'denied',undefined,undefined,{mode:'workspace-write',workspaceRoot:h.root,tempRoot:join(h.root,'temp')}),e=>e.code==='FS_SANDBOX_DENIED')})
test('native observation gate isolates official actor state, absence and version guards and clears on unload',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),host=await memoryHost(t),a={agent:(await host.agent('fs-gate-a')).actor},b={agent:(await host.agent('fs-gate-b')).actor}
 const hooks=new Map(),close=[],ctx={get:name=>host.host.ctx.get(name),on:(name,fn)=>hooks.set(name,fn),effect:fn=>close.push(fn())};observation.apply(ctx)
 const target={targetKey:'canonical',displayPath:'display'},invoke=(name,actor,...args)=>host.host.ctx.agents.withInitiator(actor.agent,()=>hooks.get(name)(target,...args,actor)),write=()=>invoke('fs/write-intent',a),edit=()=>invoke('fs/edit-intent',a)
 assert.deepEqual(await write(),{kind:'createIfAbsent'});await assert.rejects(edit(),e=>e.code==='FS_NOT_OBSERVED')
 const fact={kind:'present',version:'version1'};await invoke('fs/observed',a,fact);fact.version='forged-after-observation'
 assert.deepEqual(await write(),{kind:'replaceIfVersion',version:'version1'});assert.deepEqual(await edit(),{version:'version1'})
 assert.deepEqual(await invoke('fs/write-intent',b),{kind:'createIfAbsent'})
 await invoke('fs/observed',a,{kind:'absent'});await assert.rejects(edit(),e=>e.code==='FS_NOT_FOUND')
 for(const fn of close)fn();await assert.rejects(edit(),e=>e.code==='FS_NOT_OBSERVED')
})
test('native atomic filesystem abort after staging preserves old bytes and removes private staging files',async t=>{const h=await fixture(t),target=await h.fs.resolve('staged.txt'),file=join(h.root,'staged.txt');await writeFile(file,'old bytes');const c=new AbortController();let staged;h.fs.internals.inspectTemp=async paths=>{staged=paths;if(process.platform!=='win32'){assert.equal((await stat(paths.stagingDir)).mode&0o777,0o700);assert.equal((await stat(paths.tempPath)).mode&0o777,0o600)}c.abort()};await assert.rejects(h.fs.writeText(target,'new bytes',undefined,c.signal),e=>e.code==='FS_ABORTED');assert.equal(await readFile(file,'utf8'),'old bytes');await assert.rejects(stat(staged.stagingDir),e=>e.code==='ENOENT')})
test('native filesystem watcher observes actual changes and explicit close drains its backend',async t=>{const h=await fixture(t),target=await h.fs.resolve('watched.txt');await writeFile(join(h.root,'watched.txt'),'old');const noticed=Promise.withResolvers(),c=new AbortController(),close=await h.fs.watch(target,noticed.resolve,c.signal);t.after(close);await writeFile(join(h.root,'watched.txt'),'updated watcher bytes');await Promise.race([noticed.promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('watcher not notified')),3000);timer.unref()})]);await close();c.abort();await assert.rejects(h.fs.watch(target,()=>{},c.signal));})
test('independent publication preserves a concurrent creator and cleans its private staging directory',async t=>{
 const h=await fixture(t),target=await h.fs.resolve('creation-race.txt');let staging
 h.fs.internals.inspectTemp=async paths=>{staging=paths.stagingDir;await writeFile(join(h.root,'creation-race.txt'),'external winner')}
 await assert.rejects(h.fs.writeText(target,'must not publish',{kind:'createIfAbsent'}),e=>e.code==='FS_NOT_OBSERVED')
 assert.equal(await readFile(join(h.root,'creation-race.txt'),'utf8'),'external winner')
 await assert.rejects(stat(staging),e=>e.code==='ENOENT')
})
test('independent IO uses physical parent traversal and bounds complete reads across post-stat growth',async t=>{
 const h=await fixture(t),{mkdir}=await import('node:fs/promises');await mkdir(join(h.root,'physical','nested'),{recursive:true});await symlink(join(h.root,'physical','nested'),join(h.root,'alias'))
 const target=await h.fs.resolve('alias/../physical-parent.txt');assert.equal(target.targetKey,process.platform==='win32'?join(h.root,'physical-parent.txt'):join(h.root,'physical','physical-parent.txt'))
 await h.fs.writeText(target,'small',{kind:'createIfAbsent'})
 h.fs.internals.inspectReadBytesAfterStat=()=>writeFile(target.targetKey,'x'.repeat(2048))
 await assert.rejects(h.fs.readBytes(target,undefined,16),e=>e.code==='FS_TOO_LARGE')
 const canceled=new AbortController();canceled.abort();await assert.rejects(h.fs.readByteRange(target,{offset:0,length:1},canceled.signal),e=>e.code==='FS_ABORTED')
})
test('independent staging collision never cleans up an unowned pre-existing directory',async t=>{
 const h=await fixture(t),{mkdir}=await import('node:fs/promises'),staging=join(h.root,'pre-existing-stage');await mkdir(staging);await writeFile(join(staging,'keep.txt'),'not this writer')
 h.fs.internals.tempDirName=()=> 'pre-existing-stage'
 await assert.rejects(h.fs.writeText(await h.fs.resolve('never-created.txt'),'new',{kind:'createIfAbsent'}),e=>e.code==='EEXIST')
 assert.equal(await readFile(join(staging,'keep.txt'),'utf8'),'not this writer');await assert.rejects(stat(join(h.root,'never-created.txt')),e=>e.code==='ENOENT')
})
