import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,readdir,mkdir,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {OutputCollector,prepareManagedProcessBinding} from '../src/process/output.js'
async function root(t){const path=await mkdtemp(join(tmpdir(),'night-output-proof-'));t.after(()=>rm(path,{recursive:true,force:true}));return path}
test('byte ring agrees with an independent complete-stream suffix for every wrap and cursor',()=>{
 for(const cap of [0,1,2,7,32,127]){
  const output=new OutputCollector(cap,'stdout');let full=Buffer.alloc(0)
  for(let n=0;n<80;n++){
   const chunk=Buffer.from(Array.from({length:n%19},(_,i)=>(i*73+n)%256));full=Buffer.concat([full,chunk]);output.push(chunk)
   assert.deepEqual(output.snapshot(),{bytes:full.subarray(Math.max(0,full.length-cap)),totalBytes:full.length})
   const start=Math.max(0,full.length-cap)
   for(const offset of [0,start,full.length,full.length+1])assert.deepEqual(output.readFrom(offset),{text:full.subarray(Math.max(start,offset)).toString('utf8'),nextOffset:full.length,lossy:offset<start})
  }
  assert.equal(output.finalize().truncated,full.length>cap)
 }
})
test('collector copies ingress bytes and result snapshots; reads have independent cursors',()=>{
 const output=new OutputCollector(5,'stderr'),chunk=Buffer.from('abc');output.push(chunk);chunk.fill(0)
 const snapshot=output.snapshot();snapshot.bytes.fill(0);assert.equal(output.readFrom(0).text,'abc');output.push(Buffer.from('def'))
 assert.deepEqual(output.readFrom(3),{text:'def',nextOffset:6,lossy:false});assert.deepEqual(output.readFrom(0),{text:'bcdef',nextOffset:6,lossy:true});assert.equal(output.readFrom(0).text,'bcdef')
})
test('overflow recovers every original byte in a private file and sealing is idempotent',async t=>{
 const dir=await root(t),errors=[],output=new OutputCollector(5,'stdout',{dir,maxBytes:10000,onFailure:error=>errors.push(error)}),first=Buffer.from('abc'),second=Buffer.from('汉😀end')
 output.push(first);assert.equal(output.readFrom(0).spillPath,undefined);output.push(second);const done=output.finalize();assert.ok(done.spillPath);assert.deepEqual(await readFile(done.spillPath),Buffer.concat([first,second]));if(process.platform!=='win32')assert.equal((await stat(done.spillPath)).mode&0o777,0o600)
 assert.deepEqual(output.finalize(),done);assert.deepEqual(errors,[]);assert.throws(()=>output.push(Buffer.from('late')),/sealed/)
})
test('exceeding the full-file budget retires the partial file and continues bounded collection',async t=>{
 const dir=await root(t),output=new OutputCollector(3,'stdout',{dir,maxBytes:8})
 output.push(Buffer.from('abcde'));const path=output.readFrom(0).spillPath;assert.ok(path);output.push(Buffer.from('fghij'));assert.equal(output.readFrom(0).spillPath,undefined);await assert.rejects(readFile(path),error=>error.code==='ENOENT');assert.deepEqual(output.finalize(),{text:'hij',truncated:true});assert.deepEqual(await readdir(dir),[])
})
test('linked or missing spill roots report once, never redirect writes, and preserve the tail',async t=>{
 if(process.platform==='win32')return t.skip('Windows symlink admission requires actual Windows validation')
 const dir=await root(t),outside=join(dir,'outside');await mkdir(outside);await symlink(outside,join(dir,'linked'),'dir')
 for(const selected of [join(dir,'linked'),join(dir,'missing')]){
  const errors=[],output=new OutputCollector(2,'stdout',{dir:selected,maxBytes:100,onFailure:(error,label)=>errors.push([error,label])});output.push(Buffer.from('abcd'));output.push(Buffer.from('ef'));assert.equal(errors.length,1);assert.equal(errors[0][1],'stdout');assert.deepEqual(output.finalize(),{text:'ef',truncated:true})
 }
 assert.deepEqual(await readdir(outside),[])
})
test('output construction rejects unsafe labels/limits and fallback binding uses a private process directory',async()=>{
 for(const cap of [-1,1.5,NaN,Infinity])assert.throws(()=>new OutputCollector(cap,'stdout'),TypeError)
 for(const label of ['../outside','a/b','a\\b',''])assert.throws(()=>new OutputCollector(1,label),TypeError)
 assert.throws(()=>new OutputCollector(1,'stdout',{dir:'relative',maxBytes:10}),TypeError)
 const binding=prepareManagedProcessBinding();if(process.platform!=='win32')assert.equal((await stat(binding.spillDir)).mode&0o777,0o700)
 assert.equal(typeof binding.onSpillFailure,'function')
})
