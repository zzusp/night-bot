import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,readFile,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {createAgentSession,SessionManager} from '@earendil-works/pi-coding-agent'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import NativeAgents from '../src/native-agents.js'
import NativeSessions from '../src/native-sessions.js'
import NativeProjections from '../src/native-projections.js'
import NativePolicy,{bindSandboxPolicyActor} from '../src/native-policy.js'
import {bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import NativeFS from '../src/native-fs-sandbox.js'
import {apply as observations} from '../src/native-fs-observation-policy.js'
import {apply as files} from '../src/native-tool-fs.js'
async function fixture(t){
 const h=await officialToolsFixture(t,({ctx,owner,root})=>{
  new NativeSessions(ctx);new NativeProjections(ctx);new NativeAgents(ctx);new NativePolicy(ctx,{mode:'workspace-write',workspaceRoot:root});new NativeFS(ctx,{cwd:root,diffBasisMaxBytes:1048576});ctx.provide('workingDirectory',{ensure:async()=>root})
  observations(ctx);files(ctx,{readLimit:100,readMaxLineLength:1000,readMaxBytes:10000,readStreamMinSize:10000})
 })
 const {session:otherSession}=await createAgentSession({cwd:h.root,agentDir:h.agentDir,modelRuntime:h.runtime,model:h.model,settingsManager:h.settings,resourceLoader:h.loader,sessionManager:SessionManager.inMemory(h.root),noTools:'all'})
 const other={id:otherSession.sessionId,ctx:h.ctx,piSession:otherSession}
 for(const actor of [h.owner,other]){
  const detach=h.ctx.agents.enter(actor);h.deferCleanup(detach)
  bindWorkingDirectoryActor(actor,{initialDirectory:h.root,isLive:()=>h.ctx.agents.get(actor.id)===actor,readDirectory:()=>h.root,appendChange(){throw Error('unused')},admitNotice(){}})
  bindSandboxPolicyActor(actor,{initialDirectory:h.root,isLive:()=>h.ctx.agents.get(actor.id)===actor,readPolicy:()=>({mode:'workspace-write',artifactRoot:null}),appendPolicy(){throw Error('unused')}})
 }
 h.deferCleanup(()=>otherSession.dispose());let call=0
 return {...h,other,run:(actor,name,args)=>h.ctx.agents.withInitiator(actor,()=>h.ctx.tools.execute({agent:actor,name,arguments:args,callId:'file-call-'+ ++call,businessAudit:h.businessAudit,signal:new AbortController().signal}))}
}
test('actual native file tools keep official actor observations private and enforce read before edit/write',async t=>{
 const h=await fixture(t),path=join(h.root,'observed.txt');await writeFile(path,'original contents')
 assert.equal((await h.run(h.owner,'edit',{file_path:path,old_string:'original',new_string:'invalid'})).isError,true)
 assert.equal((await h.run(h.owner,'read',{file_path:path})).isError,false)
 const foreignEdit=await h.run(h.other,'edit',{file_path:path,old_string:'original',new_string:'cross-actor'});assert.equal(foreignEdit.isError,true);assert.match(JSON.stringify(foreignEdit),/not.*read|reading|observed/i)
 assert.equal((await h.run(h.other,'write',{file_path:path,content:'cross-actor overwrite'})).isError,true)
 assert.equal((await h.run(h.owner,'edit',{file_path:path,old_string:'original',new_string:'owned'})).isError,false)
 assert.equal(await readFile(path,'utf8'),'owned contents')
 assert.equal(h.owner.session,undefined);assert.equal(h.other.session,undefined)
})
test('actual provider preserves digest/CAS staleness, concurrent guards and canonical symlink isolation',async t=>{
 const h=await fixture(t),path=join(h.root,'guarded.txt'),alias=join(h.root,'alias.txt');await writeFile(path,'original');await symlink(path,alias)
 await h.run(h.owner,'read',{file_path:alias});await writeFile(path,'external')
 const stale=await h.run(h.owner,'edit',{file_path:path,old_string:'original',new_string:'stale'});assert.equal(stale.isError,true);assert.match(JSON.stringify(stale),/changed|version|stale/i);assert.equal(await readFile(path,'utf8'),'external')
 await h.run(h.owner,'read',{file_path:path})
 const results=await Promise.all(['one','two'].map(content=>h.run(h.owner,'write',{file_path:path,content})))
 assert.equal(results.filter(result=>!result.isError).length,1);assert.equal(results.filter(result=>result.isError).length,1)
 const other=await h.run(h.other,'edit',{file_path:alias,old_string:await readFile(path,'utf8'),new_string:'foreign alias'});assert.equal(other.isError,true)
})
test('foreign same-id and unbound official observation actors fail closed instead of acquiring shared ownership',async t=>{
 const h=await fixture(t),path=join(h.root,'authority.txt');await writeFile(path,'content');await h.run(h.owner,'read',{file_path:path})
 const foreign={...h.owner},target=await h.ctx.fs.resolve(path)
 await assert.rejects(h.ctx.agents.withInitiator(foreign,()=>h.ctx.waterfall('fs/edit-intent',target,{agent:foreign},()=>undefined)),error=>error.code==='FS_ACTOR_AUTHORITY_REQUIRED')
 await assert.rejects(h.ctx.waterfall('fs/write-intent',target,{agent:h.owner},()=>undefined),error=>error.code==='FS_ACTOR_AUTHORITY_REQUIRED')
 assert.equal(await readFile(path,'utf8'),'content')
})
