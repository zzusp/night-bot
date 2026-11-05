import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import NativeCredentials from '../src/native-credentials.js'
import NativeAttachments from '../src/native-attachments.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-owned-storage-')),foreign=join(root,'foreign'),owned=join(root,'owned'),contexts=[],prior=process.env.DSH_HOME
 await mkdir(foreign);await mkdir(owned)
 process.env.DSH_HOME=foreign
 t.after(async()=>{try{for(const ctx of contexts)await ctx.fiber.dispose()}finally{if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;await rm(root,{recursive:true,force:true})}})
 return {root,foreign,owned,context(){const ctx=new Context();contexts.push(ctx);return ctx}}
}

test('storage services require explicit locations and cannot select the DSH process home',async t=>{
 const f=await fixture(t),foreign=join(f.foreign,'.credentials.yaml'),bytes='version: 1\nrefs: {FOREIGN_REF: do-not-use}\n'
 await writeFile(foreign,bytes,{mode:0o600})
 const missing=f.context()
 assert.throws(()=>new NativeCredentials(missing),error=>error.code==='NIGHT_CREDENTIAL_PATH_REQUIRED')
 assert.throws(()=>new NativeAttachments(missing),error=>error.code==='NIGHT_ATTACHMENT_ROOT_REQUIRED')
 assert.equal(missing.get('credentials'),undefined);assert.equal(missing.get('attachments'),undefined)
 const ctx=f.context(),path=join(f.owned,'credentials.yaml')
 await ctx.plugin(NativeCredentials,{path,watch:false})
 await ctx.plugin(NativeAttachments,{storageRoot:f.owned})
 assert.equal(await ctx.credentials.resolve('FOREIGN_REF'),undefined)
 await ctx.credentials.set('OWNED_REF','local-proof')
 const ref=await ctx.attachments.saveFile({name:'proof.txt',data:new TextEncoder().encode('LOCAL_ATTACHMENT_PROOF')})
 assert.ok(ctx.attachments.fileHostPath(ref).startsWith(f.owned))
 assert.equal((await ctx.credentials.resolve('OWNED_REF')).value,'local-proof')
 assert.equal(await readFile(foreign,'utf8'),bytes)
 assert.deepEqual(await readdir(f.foreign),['.credentials.yaml'])
})

test('flat foreign credential files are refused without migration, lock creation or byte changes',async t=>{
 const f=await fixture(t),filename=join(f.owned,'credentials.yaml'),flat='# foreign flat layout\nFOREIGN_REF: "keep exact bytes" # comment\n'
 await writeFile(filename,flat,{mode:0o600})
 await assert.rejects(async()=>await f.context().plugin(NativeCredentials,{path:filename,watch:false}),/unsupported version/)
 assert.equal(await readFile(filename,'utf8'),flat)
 assert.deepEqual(await readdir(f.owned),['credentials.yaml'])
})
