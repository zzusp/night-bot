import test from 'node:test'
import assert from 'node:assert/strict'
import {cp,mkdtemp,readFile,rm,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {Worker} from 'node:worker_threads'
import {Context} from '@deepseek-ai/cordis'
import LegacyIo from '../src/legacy-v4/dsh-session-persistence-jsonl/lib/index.js'
import OriginalIo from './fixtures/legacy-jsonl-reference/lib/index.js'
const golden=new URL('./fixtures/released-legacy-golden/',import.meta.url)
const digest=b=>createHash('sha256').update(b).digest('hex')
async function fixture(t){const root=await mkdtemp('/tmp/night-legacy-formats-');t.after(()=>rm(root,{recursive:true,force:true}));return root}
async function inspect(Impl,root,id,compression){const ctx=new Context();try{const backend=new Impl(ctx,{root,compression}),handle=await backend.open(id,'read');try{return{header:handle.header,snapshot:await handle.read()}}finally{await handle.close()}}finally{await ctx.fiber.dispose()}}
async function verify(data){const worker=new Worker(new URL('../src/legacy-v4/dsh-session-persistence-jsonl/lib/worker.js',import.meta.url),{workerData:data,execArgv:[]});try{return await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error('verifier exit '+code))})})}finally{await worker.terminate()}}
test('original release-generated plain and zstd logs remain readable without rewriting evidence',async t=>{
 const root=await fixture(t),manifest=JSON.parse(await readFile(new URL('manifest.json',golden)))
 assert.notEqual(LegacyIo,OriginalIo)
 for(const compression of ['none','zstd']){
  const path=join(root,compression);await cp(new URL(compression+'/',golden),path,{recursive:true})
  const actual=await inspect(LegacyIo,path,'golden-'+compression,compression),original=await inspect(OriginalIo,path,'golden-'+compression,compression)
  assert.deepEqual(actual,original);assert.match(JSON.stringify(actual),/ORIGINAL_LEGACY_GOLDEN_NO_REPLAY/)
 }
 for(const file of manifest.files){assert.equal(digest(await readFile(join(root,file.path))),file.sha256,file.path)}
})
test('isolated native verifier checks physical bytes, logical count and identity for both legacy encodings',async()=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',golden)))
 for(const compression of ['none','zstd']){
  const file=manifest.files.find(f=>f.path.startsWith(compression+'/')&&f.size>0),path=fileURLToPath(new URL(file.path,golden))
  const request={path,compression,expectedId:'golden-'+compression,expectedEventCount:1}
  const result=await verify(request);assert.equal(result.ok,true,result.message);assert.equal(result.result.digest,file.sha256)
  const wrongId=await verify({...request,expectedId:'foreign'});assert.equal(wrongId.ok,false)
  const wrongCount=await verify({...request,expectedEventCount:2});assert.equal(wrongCount.ok,false)
  const wrongPrefix=await verify({...request,expectedPrefix:{bytes:file.size,digest:'0'.repeat(64)}});assert.equal(wrongPrefix.ok,false)
 }
})
test('native verifier rejects malformed requests before reading any caller path',async()=>{
 await assert.rejects(verify({path:'/never-read',compression:'invalid',expectedId:'fixture',expectedEventCount:1}),/malformed/)
})
test('application legacy verification worker excludes the old bundled model runtime',async()=>{
 const text=await readFile(new URL('../src/legacy-v4/dsh-session-persistence-jsonl/lib/worker.js',import.meta.url),'utf8')
 assert.match(text,/verifyJsonlCurrentGeneration/);assert.doesNotMatch(text,/class LlmRuntime|TypertRemoteService|require\(/)
})
test('all released v0 through v4 catalogs retain complete empty-history migration and reject future versions',async()=>{
 const {createSessionFormatCatalogWithChildren}=await import('../src/legacy-v4/dsh-session-format-catalog/lib/index.js'),catalog=createSessionFormatCatalogWithChildren([])
 for(let version=0;version<=4;version++){
  const header={type:'session',version,id:'historic-'+version,createdAt:1,delegationDepth:0,cwd:'/fixture',...(version>=2?{isSeeded:false}:{})}
  const status=catalog.readHeader(header);assert.notEqual(status.status,'malformed')
  const restored=catalog.createRestore(header,{recovery:'strict',validation:'current'}).finish()
  assert.equal(restored.header.version,4);assert.equal(restored.header.id,header.id)
  assert.deepEqual(restored.events,[]);assert.equal(restored.inheritedEventCount,0)
 }
 assert.equal(catalog.readHeader({type:'session',version:5,id:'future',createdAt:1}).status,'unsupported')
})
