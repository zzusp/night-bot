import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {boundedRead,CONTENT_LIMIT} from '../src/memory/previous.js'

async function fixture(t){
 const base=await fs.mkdtemp(join(tmpdir(),'night-evolution-path-')),root=join(base,'install'),outside=join(base,'outside')
 await fs.mkdir(join(root,'nested'),{recursive:true});await fs.mkdir(outside)
 await fs.writeFile(join(root,'nested','SKILL.md'),'AUTHORIZED');await fs.writeFile(join(outside,'SKILL.md'),'OUTSIDE_MUST_NOT_BE_READ')
 t.after(()=>fs.rm(base,{recursive:true,force:true}))
 return {base,root,outside,file:join(root,'nested','SKILL.md')}
}

test('bounded reads enforce root, all symlink components, hardlinks and byte limits',async t=>{
 const f=await fixture(t)
 assert.equal((await boundedRead(f.file,CONTENT_LIMIT,{root:f.root})).text,'AUTHORIZED')
 assert.equal(await boundedRead(join(f.root,'missing','SKILL.md'),CONTENT_LIMIT,{root:f.root}),null)
 await assert.rejects(boundedRead(join(f.outside,'SKILL.md'),CONTENT_LIMIT,{root:f.root}),{code:'EVOLUTION_BODY_FORBIDDEN'})
 await fs.symlink(f.outside,join(f.root,'redirect'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(boundedRead(join(f.root,'redirect','SKILL.md'),CONTENT_LIMIT,{root:f.root}),{code:'EVOLUTION_BODY_FORBIDDEN'})
 await fs.symlink(f.root,join(f.base,'root-link'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(boundedRead(join(f.base,'root-link','nested','SKILL.md'),CONTENT_LIMIT,{root:join(f.base,'root-link')}),{code:'EVOLUTION_BODY_FORBIDDEN'})
 await fs.link(f.file,join(f.root,'hard.md'))
 await assert.rejects(boundedRead(f.file,CONTENT_LIMIT,{root:f.root}),{code:'EVOLUTION_BODY_FORBIDDEN'})
 await fs.writeFile(join(f.root,'large.md'),'a'.repeat(CONTENT_LIMIT+1))
 await assert.rejects(boundedRead(join(f.root,'large.md'),CONTENT_LIMIT,{root:f.root}),{code:'EVOLUTION_CONTENT_TOO_LARGE'})
})

for(const phase of ['before-directory-open','after-directory-open'])test(`Linux anchored traversal rejects directory replacement ${phase} without reading content`,{skip:process.platform!=='linux'},async t=>{
 const f=await fixture(t),originalOpen=fs.open;let swapped=false,readCalls=0
 const replace=async()=>{await fs.rename(join(f.root,'nested'),join(f.root,'held'));await fs.symlink(f.outside,join(f.root,'nested'),'dir');swapped=true}
 t.mock.method(fs,'open',async(path,...args)=>{
  const target=String(path),isNested=target.startsWith('/proc/self/fd/')&&target.endsWith('/nested')
  if(isNested&&phase==='before-directory-open'&&!swapped)await replace()
  const handle=await originalOpen(path,...args)
  if(isNested&&phase==='after-directory-open'&&!swapped)await replace()
  if(target.endsWith('/SKILL.md')){const read=handle.read.bind(handle);handle.read=(...args)=>{readCalls++;return read(...args)}}
  return handle
 })
 syncBuiltinESMExports()
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()})
 await assert.rejects(boundedRead(f.file,CONTENT_LIMIT,{root:f.root}),error=>['EVOLUTION_BODY_FORBIDDEN','EVOLUTION_VERSION_STALE'].includes(error.code))
 assert.equal(swapped,true);assert.equal(readCalls,0)
})

test('bounded reader completes partial file reads rather than recording a truncated snapshot',async t=>{
 const f=await fixture(t),originalOpen=fs.open
 t.mock.method(fs,'open',async(...args)=>{
  const handle=await originalOpen(...args)
  if(String(args[0]).endsWith('/SKILL.md')){const read=handle.read.bind(handle);handle.read=(buffer,offset,length,position)=>read(buffer,offset,Math.min(length,2),position)}
  return handle
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()})
 assert.equal((await boundedRead(f.file,CONTENT_LIMIT,{root:f.root})).text,'AUTHORIZED')
})
