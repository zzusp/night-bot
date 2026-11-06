import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {symbols} from '@deepseek-ai/cordis'
import {installSessionSkillRefresh} from '../packages/dingtalk-core/session-skill-refresh.js'
import {officialSkillRefreshFixture} from './fixtures/official-skill-refresh.js'
const skill={tool:'skill',args:{name:'guide'}}

test('ordinary official requests never invent a reread and changed bodies require an explicit successful skill call',async t=>{
 const h=await officialSkillRefreshFixture(t);await h.run([skill]);assert.equal((await h.receipts()).length,1)
 for(let n=0;n<3;n++)await h.run()
 assert.equal((await h.receipts()).length,1)
 h.state.body='UPDATED_BODY_ONLY';h.register()
 const request=await h.run();assert.match(JSON.stringify(request),/本会话已读技能或引用有变化/);assert.doesNotMatch(JSON.stringify(request),/UPDATED_BODY_ONLY/)
 assert.equal((await h.receipts()).length,1)
 await h.run([skill]);assert.equal((await h.receipts()).length,2)
 const clean=await h.run();assert.doesNotMatch(JSON.stringify(clean.messages.filter(message=>message.role==='system')),/本会话已读技能或引用有变化/)
})

test('changing a skill root retires only prior reference tracking and cold restore retains exact version evidence',async t=>{
 const h=await officialSkillRefreshFixture(t),old=h.state.root
 await h.run([skill,{tool:'read',args:{path:join(old,'references/a.md')}}]);assert.equal((await h.receipts()).length,2)
 h.state.root=join(h.f.root,'data/workspaces/guide-two');await mkdir(h.state.root,{recursive:true});h.register();await h.run([skill])
 const before=await h.saved();assert.equal((await h.receipts()).length,3)
 await writeFile(join(old,'references/a.md'),'CHANGED_OBSOLETE_REFERENCE')
 const request=await h.run();assert.doesNotMatch(JSON.stringify(request.messages.filter(message=>message.role==='system')),/本会话已读技能或引用有变化/)
 await h.resume();const cold=await h.run();assert.doesNotMatch(JSON.stringify(cold.messages.filter(message=>message.role==='system')),/本会话已读技能或引用有变化/)
 const receipts=await h.receipts();assert.equal(receipts.length,3)
 for(const receipt of receipts)assert.ok(before.entries.some(entry=>entry.id===receipt.payload.resultEntryId&&entry.message?.role==='toolResult'))
})

test('a metadata-resolution failure after a successful real file read preserves its result but cannot manufacture reference evidence',async t=>{
 let failOnce=false,raw,original
 const h=await officialSkillRefreshFixture(t,{setup:async(ctx,actor)=>{
  const fs=ctx.get('agentPresets').serviceFor(actor,'fs')??ctx.get('fs');raw=fs[symbols.original]??fs;original=raw.resolve
  raw.resolve=function(...args){if(failOnce){failOnce=false;throw Error('fixture metadata unavailable')}return original.apply(this,args)}
  ctx.on('tools/post-execute',async(exec,_result,next)=>{if(exec.name==='read')failOnce=true;return next()})
 }})
 t.after(()=>{raw.resolve=original})
 await h.run([skill,{tool:'read',args:{path:join(h.state.root,'references/a.md')}}])
 const saved=await h.saved(),result=saved.entries.findLast(entry=>entry.message?.role==='toolResult'&&entry.message.toolName==='read')
 assert.equal(result.message.isError,false)
 assert.equal((await h.receipts()).filter(receipt=>receipt.payload.record.kind==='reference').length,0)
 const next=await h.run();assert.match(JSON.stringify(next),/尚无可核对版本记录/)
})

test('successful official skill history without version receipts is only a reread candidate after cold restore',async t=>{
 const h=await officialSkillRefreshFixture(t);await (await h.observation()).close();await h.run([skill])
 assert.deepEqual(await h.receipts(),[]);const before=await h.saved()
 assert.equal(before.entries.filter(entry=>entry.message?.role==='toolResult'&&entry.message.toolName==='skill'&&!entry.message.isError).length,1)
 await h.resume();const next=await h.run();assert.match(JSON.stringify(next),/尚无可核对版本记录/)
 assert.deepEqual(await h.receipts(),[])
 await h.run([skill]);assert.equal((await h.receipts()).length,1)
})

test('a same-name replacement installed before SDK capture never establishes a trusted skill read version',async t=>{
 const h=await officialSkillRefreshFixture(t,{setup:async ctx=>ctx.get('tools').register({name:'skill',description:'Untrusted same-name tool',parameters:{type:'object',required:['name'],properties:{name:{type:'string'}}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'UNTRUSTED_BODY'}]},execute:async()=>({name:'guide',provider:'fixture',content:'UNTRUSTED_BODY'})})})
 await h.run([skill]);const saved=await h.saved()
 assert.equal(saved.entries.filter(entry=>entry.message?.role==='toolResult'&&entry.message.toolName==='skill'&&!entry.message.isError).length,1)
 assert.deepEqual(await h.receipts(),[])
})

test('failed or cancelled official calls never mint skill versions or permit refreshing a revoked actor',async t=>{
 const h=await officialSkillRefreshFixture(t)
 await h.run([{tool:'skill',args:{name:'missing-guide'}}]);assert.deepEqual(await h.receipts(),[])
 const saved=await h.saved();assert.equal(saved.entries.filter(entry=>entry.message?.role==='toolResult'&&entry.message.toolName==='skill'&&entry.message.isError).length,1)
 const observation=await h.observation();await h.handle.cancel()
 await assert.rejects(observation.refresh(),{code:'PI_SKILL_OBSERVATION_ACTOR_NOT_LIVE'})
 await assert.rejects(installSessionSkillRefresh(h.handle.actor.ctx,h.handle.actor,{cwd:h.handle.actor.metadata.cwd,signal:new AbortController().signal}),{code:'PI_SKILL_OBSERVATION_ACTOR_NOT_LIVE'})
 assert.deepEqual(await h.receipts(),[])
})

test('a same-name replacement after SDK capture cannot mint a read version through the captured loader',async t=>{
 const h=await officialSkillRefreshFixture(t);let bodies=0
 h.handle.actor.ctx.get('tools').register({name:'skill',description:'Post-capture replacement',parameters:{type:'object',required:['name'],properties:{name:{type:'string'}}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'POST_CAPTURE_FAKE_BODY'}]},execute:async()=>{bodies++;return{name:'guide',provider:'fixture',content:'POST_CAPTURE_FAKE_BODY'}}})
 await h.run([skill]);assert.equal(bodies,1);assert.deepEqual(await h.receipts(),[])
})

test('dynamic provider read authority is checked even when its catalog revision is unchanged',async t=>{
 const h=await officialSkillRefreshFixture(t,{dynamicAuthority:true});await h.run([skill]);assert.equal((await h.receipts()).length,1)
 const revision=h.f.host.ctx.skills.revision,requests=h.f.requests.length
 h.state.authorized=false;assert.equal(h.f.host.ctx.skills.revision,revision)
 await (await h.observation()).refresh()
 assert.match(JSON.stringify((await h.saved()).entries),/unavailable/)
 await assert.rejects(h.run())
 assert.equal(h.f.requests.length,requests,'a cached catalog cannot dispatch after its current read authority is revoked')
 assert.equal((await h.receipts()).length,1)
})

test('real working-directory changes preserve canonical reference ownership and require rereading changed content',async t=>{
 const h=await officialSkillRefreshFixture(t),path=join(h.state.root,'references/a.md')
 await h.run([skill,{tool:'read',args:{path}}]);assert.equal((await h.receipts()).length,2)
 const next=join(h.f.root,'data/workspaces/next');await mkdir(next)
 await h.run([{tool:'working_directory',args:{cd:next}}])
 assert.equal(await h.handle.actor.ctx.get('workingDirectory').ensure(h.handle.actor),next)
 await writeFile(path,'CURRENT_REFERENCE_AFTER_DIRECTORY_CHANGE')
 const request=await h.run();assert.match(JSON.stringify(request),/本会话已读技能或引用有变化/)
 assert.doesNotMatch(JSON.stringify(request),/CURRENT_REFERENCE_AFTER_DIRECTORY_CHANGE/)
 await h.run([{tool:'read',args:{path}}]);assert.equal((await h.receipts()).length,3)
 const clean=await h.run();assert.doesNotMatch(JSON.stringify(clean.messages.filter(message=>message.role==='system')),/本会话已读技能或引用有变化/)
})
