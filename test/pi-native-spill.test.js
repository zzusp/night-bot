import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,mkdir,readFile,rm,stat,utimes,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,relative,isAbsolute} from 'node:path'
import NativeSpill,{saveTextFile,encodeSegment,sessionDir} from '../src/native-spill.js'
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-spill-test-')),ctx=new Context();await ctx.plugin(NativeSpill,{root:join(root,'active'),cleanupPeriodDays:0});t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})});return{root,ctx,store:ctx.get('spillStore')}}
const input=(sessionId='owner',content='full content 汉字😀')=>({owner:{sessionId},source:{kind:'tool',toolName:'grep',callId:'fixture',label:'result'},suggestedName:'../../unsafe/name.txt',content})
test('owned spill writes preserve exact UTF-8 bytes and private traversal-safe names',async t=>{
 const h=await fixture(t),inputs=['','.', '..','../a','汉字😀','C:\\path\\name','a'.repeat(1000),'~002E','\u0000']
 const encoded=inputs.map(encodeSegment);assert.equal(new Set(encoded).size,inputs.length);for(const value of encoded){assert.ok(value.length>0);assert.ok(!/[\\/\u0000]/.test(value));assert.notEqual(value,'.');assert.notEqual(value,'..')}
 assert.equal(encodeSegment('..'),'~002E~002E');assert.equal(encodeSegment('A_z-1.txt'),'A_z-1.txt');assert.equal(encodeSegment('~'),'~007E')
 const content='full content 汉字😀',saved=await saveTextFile({root:join(h.root,'files'),sessionId:'../owner',suggestedName:'../../name',content});assert.equal(saved.bytes,Buffer.byteLength(content));assert.equal(await readFile(saved.path,'utf8'),content);assert.ok(!relative(join(h.root,'files'),saved.path).startsWith('..'));if(process.platform!=='win32')assert.equal((await stat(saved.path)).mode&0o777,0o600)
})
test('native spill session paths are traversal-safe and reject a symlinked session directory',async t=>{const h=await fixture(t),saved=await h.store.saveText(input('../owner'));const rel=relative(h.store.root,saved.locator);assert.equal(isAbsolute(rel),false);assert.equal(rel.startsWith('..'),false);assert.equal(await readFile(saved.locator,'utf8'),input().content);assert.equal((await stat(h.store.root)).mode&0o777,0o700);const outsider=join(h.root,'outside');await mkdir(outsider);await symlink(outsider,sessionDir(h.store.root,'different-owner'));await assert.rejects(h.store.saveText(input('different-owner')));})
test('native spill cleanup covers only active app root and leaves unrelated prior roots intact',async t=>{const h=await fixture(t),active=await h.store.saveText(input()),other=await saveTextFile({root:join(h.root,'dsh-spill-unrelated'),sessionId:'owner',suggestedName:'old',content:'unrelated old content'}),old=new Date(Date.now()-40*86400000);await utimes(active.locator,old,old);await utimes(other.path,old,old);h.store.config.cleanupPeriodDays=30;const roots=await h.store.gatherRoots(()=>{});assert.deepEqual(roots,[{path:h.store.root,pruneWhenEmpty:false}]);await h.store.runCleanup(()=>{});await assert.rejects(stat(active.locator),e=>e.code==='ENOENT');assert.equal(await readFile(other.path,'utf8'),'unrelated old content')})
test('native spill close drains admitted real file writes and rejects future admission',async t=>{const h=await fixture(t),content='complete durable text\n'.repeat(10000),saving=h.store.saveText(input('owner',content));assert.equal(h.store.pending.size,1);await h.ctx.fiber.dispose();const saved=await saving;assert.equal(h.store.pending.size,0);assert.equal(h.store.closed,true);assert.equal(await readFile(saved.locator,'utf8'),content);await assert.rejects(h.store.saveText(input()),/SPILL_STORE_CLOSED/)})

test('spill roots are explicit absolute paths and invalid configuration publishes no service',async t=>{
 const ctx=new Context();t.after(()=>ctx.fiber.dispose())
 for(const root of [undefined,'','relative','~/outside'])assert.throws(()=>new NativeSpill(ctx,{root}),error=>error.code==='NIGHT_SPILL_ROOT_REQUIRED')
 assert.equal(ctx.get('spillStore'),undefined)
})

test('a linked active spill root cannot redirect writes or cleanup into another directory',async t=>{
 const h=await fixture(t),outside=join(h.root,'outside'),saved=await saveTextFile({root:outside,sessionId:'owner',suggestedName:'old',content:'keep outside'}),old=new Date(Date.now()-40*86400000)
 await utimes(saved.path,old,old);await symlink(outside,h.store.root,'dir');await assert.rejects(h.store.saveText(input()),/SPILL_ROOT_INVALID/);h.store.config.cleanupPeriodDays=30;assert.deepEqual(await h.store.gatherRoots(()=>{}),[]);await h.store.runCleanup(()=>{});assert.equal(await readFile(saved.path,'utf8'),'keep outside')
})
