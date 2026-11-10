import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
async function fixture(t){
 const f=await memoryHost(t),owner=(await f.agent('fs-observer-owner',{actorId:'owner'})).actor,other=(await f.agent('fs-observer-other',{actorId:'other'})).actor
 let sequence=0
 const runBatch=async(actor,calls)=>{
  const admitted=calls.map(call=>({...call,id:'file-observation-'+ ++sequence}))
  // Trusted Host test input uses the real public official journal, not a second
  // event format. NativeTools and the factory's per-assistant budget see these
  // exact calls; no model or legacy Session facade is installed.
  actor.piSession.sessionManager.appendMessage({role:'assistant',content:admitted.map(call=>({type:'toolCall',id:call.id,name:call.name,arguments:call.args})),api:'openai-completions',provider:'fixture',model:'m',stopReason:'toolUse',timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
  return Promise.all(admitted.map(call=>f.host.ctx.agents.withInitiator(actor,()=>actor.ctx.get('tools').execute({agent:actor,name:call.name,arguments:call.args,callId:call.id,businessAudit:actor.audit,signal:new AbortController().signal}))))
 }
 return {...f,owner,other,root:f.host.ctx.runtimePaths.workspaces,run:async(actor,name,args)=>(await runBatch(actor,[{name,args}]))[0],runBatch}
}
test('actual official file tools keep actor observations private and enforce read before edit/write',async t=>{
 const h=await fixture(t),path=join(h.root,'observed.txt');await writeFile(path,'original contents')
 assert.equal((await h.run(h.owner,'edit',{path,edits:[{oldText:'original',newText:'invalid'}]})).isError,true)
 assert.equal((await h.run(h.owner,'read',{path})).isError,false)
 const foreignEdit=await h.run(h.other,'edit',{path,edits:[{oldText:'original',newText:'cross-actor'}]});assert.equal(foreignEdit.isError,true);assert.match(JSON.stringify(foreignEdit),/not.*read|reading|observed/i)
 assert.equal((await h.run(h.other,'write',{path,content:'cross-actor overwrite'})).isError,true)
 assert.equal((await h.run(h.owner,'edit',{path,edits:[{oldText:'original',newText:'owned'}]})).isError,false)
 assert.equal(await readFile(path,'utf8'),'owned contents')
 assert.equal(h.owner.session,undefined);assert.equal(h.other.session,undefined)
 assert.equal(h.requests.length,0,'Host-level observation checks never invoke a model')
})
test('actual provider preserves digest/CAS staleness, concurrent guards and canonical symlink isolation',async t=>{
 const h=await fixture(t),path=join(h.root,'guarded.txt'),aliasRoot=join(h.root,'alias'),alias=join(aliasRoot,'guarded.txt');await writeFile(path,'original');await symlink(h.root,aliasRoot,'dir')
 await h.run(h.owner,'read',{path:alias});await writeFile(path,'external')
 const stale=await h.run(h.owner,'edit',{path,edits:[{oldText:'original',newText:'stale'}]});assert.equal(stale.isError,true);assert.match(JSON.stringify(stale),/changed|version|stale/i);assert.equal(await readFile(path,'utf8'),'external')
 await h.run(h.owner,'read',{path})
 const results=await h.runBatch(h.owner,['one','two'].map(content=>({name:'write',args:{path,content}})))
 assert.equal(results.filter(result=>!result.isError).length,1);assert.equal(results.filter(result=>result.isError).length,1)
 const other=await h.run(h.other,'edit',{path:alias,edits:[{oldText:await readFile(path,'utf8'),newText:'foreign alias'}]});assert.equal(other.isError,true)
})
test('foreign same-id and unbound official observation actors fail closed instead of acquiring shared ownership',async t=>{
 const h=await fixture(t),path=join(h.root,'authority.txt');await writeFile(path,'content');await h.run(h.owner,'read',{path})
 const foreign={...h.owner},target=await h.host.ctx.fs.resolve(path)
 await assert.rejects(h.host.ctx.agents.withInitiator(foreign,()=>h.host.ctx.waterfall('fs/edit-intent',target,{agent:foreign},()=>undefined)),error=>error.code==='FS_ACTOR_AUTHORITY_REQUIRED')
 await assert.rejects(h.host.ctx.waterfall('fs/write-intent',target,{agent:h.owner},()=>undefined),error=>error.code==='FS_ACTOR_AUTHORITY_REQUIRED')
 assert.equal(await readFile(path,'utf8'),'content')
})

test('actual Host file writes capture the immediate prior skill even before the watcher settles',async t=>{
 const h=await fixture(t),paths=h.host.ctx.runtimePaths,file=join(paths.skills,'latest-check.md')
 await writeFile(join(paths.config,'config.json'),JSON.stringify(h.config))
 await h.host.ctx.get('toolPermissions').setMode('full')
 await h.host.ctx.memory.installedPrevious.watcher.close()
 const content=value=>'---\nname: latest-check\ndescription: Local test resource\n---\n'+value+'\n'
 for(const value of ['FIRST','SECOND','THIRD']){
  const result=await h.run(h.owner,'write',{path:file,content:content(value)})
  assert.equal(result.isError,false,JSON.stringify(result))
 }
 const view=await h.host.ctx.memory.inspectEvolution({actorId:'reader'},{kind:'skill'}),item=view.items.find(row=>row.name==='latest-check')
 const result=await h.host.ctx.memory.inspectEvolutionItem({actorId:'reader'},{id:item.id,revision:item.revision})
 assert.match(result.current.text,/THIRD/);assert.match(result.previous.text,/SECOND/)
 assert.doesNotMatch(await readFile(h.host.ctx.memory.installedPrevious.file,'utf8'),/FIRST/)
})
