import test from 'node:test'
import assert from 'node:assert/strict'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {bundledSkillDir} from '../src/runtime/paths.js'
import {memoryHost} from './fixtures/memory-host.js'
import {visibleBusinessInputs} from '../src/runtime/pi-business-inputs.js'
import {subagentFixture,eventually} from './fixtures/pi-subagent-fixture.js'
async function actorFixture(t,respond=()=>({text:'skill catalog verified'})){
 const f=await subagentFixture(t,respond),remove=f.host.ctx.skills.register({name:'wire-skill',description:'WIRE_SKILL_SUMMARY',content:'WIRE_SKILL_FULL_BODY',source:'fixture',invocation:{modelInvocable:true,userInvocable:true}}),handle=await f.host.ctx.agents.create({sessionId:'skill-tool-catalog',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:f.host.config?.workspaceDir??f.root+'/work'},authorizeInput:packet=>packet.source.kind==='fixture-user',authorizeSkillCommand:async(packet,name,actor)=>packet.source.kind==='fixture-user'&&(await actor.ctx.get('skills').get(name,{scope:actor,cwd:actor.piSession.sessionManager.getCwd()}))?.invocation?.userInvocable===true,setup:async ctx=>{await f.host.ctx.agentPresets.mount(ctx,'night-bot')}})
 f.handles.push(handle)
 const send=async(id,text)=>{await handle.enqueue({id,source:{kind:'fixture-user'},content:[{type:'text',text}]});await handle.deliver(id);await handle.whenIdle()}
 return {f,handle,remove,send}
}
test('actual official Pi skill catalog is unique and removal replaces the next request catalog',{timeout:20000},async t=>{
 const {f,handle,remove,send}=await actorFixture(t)
 await send('catalog','show available skills');assert.ok(handle.session instanceof AgentSession);assert.equal(handle.agent.session,undefined);assert.match(JSON.stringify(f.requests[0]),/WIRE_SKILL_SUMMARY/);assert.equal(JSON.stringify(f.requests[0]).match(/WIRE_SKILL_SUMMARY/g).length,1);assert.doesNotMatch(JSON.stringify(f.requests[0]),/WIRE_SKILL_FULL_BODY/)
 assert.equal(handle.session.resourceLoader.getSkills().skills.filter(s=>s.name==='wire-skill').length,1)
 await remove();await send('removed','refresh available names');assert.doesNotMatch(JSON.stringify(f.requests[1]),/WIRE_SKILL_SUMMARY/);assert.deepEqual(handle.session.resourceLoader.getSkills().skills.filter(s=>s.name==='wire-skill'),[])
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id);assert.equal(saved.entries.filter(e=>e.type==='custom_message'&&e.customType==='night.business-input').length,2);assert.equal(saved.entries.filter(e=>e.type==='message').flatMap(e=>e.message.role==='assistant'?e.message.content:[]).filter(b=>b.type==='toolCall').length,0)
})
test('authenticated direct skill gesture loads body without model tool execution',{timeout:20000},async t=>{
 const {f,handle,send}=await actorFixture(t)
 await send('gesture','/skill:wire-skill now');assert.match(JSON.stringify(f.requests[0]),/WIRE_SKILL_FULL_BODY/)
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id);assert.equal(saved.entries.filter(e=>e.type==='message').flatMap(e=>e.message.role==='assistant'?e.message.content:[]).filter(b=>b.type==='toolCall').length,0)
})

test('official busy command queue preserves images and ACK commits before its provider request',{timeout:20000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const {f,handle,send}=await actorFixture(t,async(_request,state)=>{if(state.requests.length===1){entered.resolve();await release.promise}return {text:'verified'}})
 const first=send('busy','ordinary first input');await entered.promise
 const image={type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ahtoAAAAASUVORK5CYII='}
 const packet={id:'queued-command',source:{kind:'fixture-user'},content:[{type:'text',text:'/skill:wire-skill inspect image'},image]}
 await handle.enqueue(packet);const queued=handle.deliver(packet.id);queued.catch(()=>{})
 await eventually(async()=>(await handle.agent.receipts.read()).some(r=>r.kind==='command-started'))
 assert.equal(f.requests.length,1);release.resolve();await first;await queued;await handle.whenIdle()
 assert.equal(f.requests.length,2);assert.match(JSON.stringify(f.requests[1]),/WIRE_SKILL_FULL_BODY/)
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id),ack=saved.audit.find(r=>r.kind==='command-admitted')
 assert.ok(ack);const native=saved.entries.find(e=>e.id===ack.payload.entryId);assert.deepEqual(native.message.content.filter(p=>p.type==='image'),[image])
 assert.deepEqual(visibleBusinessInputs(handle.agent).find(input=>input.packetId===packet.id).content,packet.content)
 handle.session.sessionManager.appendContextEdit(ack.payload.entryId,{content:[{type:'text',text:'modified command'}]})
 assert.equal(visibleBusinessInputs(handle.agent).some(input=>input.packetId===packet.id),false,'edited model content cannot retain original source authority')
})
test('revoking a queued skill before native user admission blocks the next provider request',{timeout:20000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const {f,handle,send,remove}=await actorFixture(t,async(_request,state)=>{if(state.requests.length===1){entered.resolve();await release.promise}return {text:'verified'}})
 const first=send('busy-revoke','ordinary first input');first.catch(()=>{});await entered.promise
 await handle.enqueue({id:'revoked-command',source:{kind:'fixture-user'},content:'/skill:wire-skill now'})
 const pending=handle.deliver('revoked-command');pending.catch(()=>{})
 await eventually(async()=>(await handle.agent.receipts.read()).some(r=>r.kind==='command-started'))
 await remove();release.resolve();await first.catch(()=>{})
 await assert.rejects(pending,{code:'PI_SKILL_COMMAND_DENIED'});assert.equal(f.requests.length,1)
 assert.equal((await handle.agent.receipts.read()).some(r=>r.kind==='command-admitted'),false)
})
test('official cancellation releases a queued unacknowledged command without replay or an owned actor leak',{timeout:20000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve())
 const {f,handle,send}=await actorFixture(t,async(_request,state)=>{if(state.requests.length===1){entered.resolve();await release.promise}return {text:'verified'}})
 const first=send('cancel-first','ordinary first input');first.catch(()=>{});await entered.promise
 await handle.enqueue({id:'cancel-command',source:{kind:'fixture-user'},content:'/skill:wire-skill now'})
 const queued=handle.deliver('cancel-command');queued.catch(()=>{})
 await eventually(async()=>(await handle.agent.receipts.read()).some(r=>r.kind==='command-started'))
 const cancel=handle.cancel({kind:'user'});cancel.catch(()=>{})
 await assert.rejects(queued,{code:'PI_SKILL_COMMAND_CANCELLED'});release.resolve();await cancel;await first.catch(()=>{});await handle.dispose()
 assert.equal(f.host.ctx.agents.get(handle.agent.id),undefined);assert.equal(f.requests.length,1)
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id)
 assert.equal(saved.audit.some(r=>r.kind==='command-admitted'),false)
})

for(const portable of [true,false])for(const preset of ['night-bot','night-bot-task'])test(`default ${portable?'portable':'absolute-root'} ${preset} loads bundled skill and reference through official Pi`,{timeout:40000},async t=>{
 let index=0
 const f=await memoryHost(t,body=>{
  index++
  if(index===1){
   const request=JSON.stringify(body)
   assert.match(request,/skill-creator/);assert.match(request,/work-log-writing/)
   assert.doesNotMatch(request,/Night Bot 适配（本仓修改）/)
   return {tool:'skill',args:{name:'skill-creator'}}
  }
  if(index===2){assert.match(JSON.stringify(body),/Night Bot 适配（本仓修改）/);return {tool:'read',args:{path:join(bundledSkillDir,'skill-creator','references','schemas.md'),offset:1,limit:5}}}
  assert.match(JSON.stringify(body),/# JSON Schemas/)
  return {text:'bundled skill and reference verified'}
 },{portable})
 const handle=await f.host.ctx.agents.create({sessionId:'bundled-default',agentOptions:f.config.model,meta:{cwd:f.host.ctx.runtimePaths.workspaces,agentPreset:preset},authorizeInput:packet=>packet.source.kind==='user',setup:async ctx=>{await f.host.ctx.agentPresets.mount(ctx,preset)}})
 t.after(()=>handle.dispose())
 if(portable)await f.host.ctx.agents.withInitiator(handle.agent,async()=>{
  const fs=f.host.ctx.agentPresets.serviceFor(handle.agent,'fs'),target=await fs.resolve(join(bundledSkillDir,'skill-creator','SKILL.md'))
  assert.equal(fs.outside(target),false);assert.equal(fs.outside(target,true),true)
  assert.throws(()=>fs.boundary(target,true),{code:'FS_SANDBOX_DENIED'})
  const neighbor=await fs.resolve(join(bundledSkillDir,'..','README.md'))
  assert.equal(fs.outside(neighbor),true);assert.throws(()=>fs.boundary(neighbor),{code:'FS_SANDBOX_DENIED'})
 })
 await handle.enqueue({id:'bundled-input',source:{kind:'user'},content:'Load skill-creator and inspect its schema reference without making business changes.'});await handle.deliver('bundled-input');await handle.whenIdle()
 assert.ok(handle.session instanceof AgentSession)
 const catalog=handle.session.resourceLoader.getSkills().skills
 for(const name of ['skill-creator','work-log-writing']){
  assert.equal(catalog.filter(row=>row.name===name).length,1)
  assert.equal(catalog.find(row=>row.name===name).filePath,join(bundledSkillDir,name,'SKILL.md'))
 }
 assert.equal(f.requests.length,3);assert.deepEqual(f.errors,[])
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id,{requireComplete:true})
 const messages=saved.entries.filter(entry=>entry.type==='message').map(entry=>entry.message)
 const results=messages.filter(message=>message.role==='toolResult')
 assert.deepEqual(results.map(message=>[message.toolName,message.isError??false]),[['skill',false],['read',false]])
 assert.ok(messages.some(message=>message.role==='assistant'&&message.content.some(part=>part.type==='text'&&part.text==='bundled skill and reference verified')))
})

for(const source of ['private','configured'])test(`${source} same-name skill overrides the bundled default in official Pi`,{timeout:40000},async t=>{
 let index=0
 const f=await memoryHost(t,body=>{
  if(++index===1)return {tool:'skill',args:{name:'skill-creator'}}
  assert.match(JSON.stringify(body),/LOCAL_SKILL_OVERRIDE_BODY/)
  assert.doesNotMatch(JSON.stringify(body),/Night Bot 适配（本仓修改）/)
  return {text:'local override verified'}
 },{hostConfig:config=>source==='configured'?{skillDirs:[join(config.installRoot,'custom-skills')]}:{}})
 const directory=join(source==='private'?f.host.ctx.runtimePaths.skills:f.config.skillDirs[0],'skill-creator')
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'SKILL.md'),`---
name: skill-creator
description: Local override
---
LOCAL_SKILL_OVERRIDE_BODY
`)
 const handle=await f.agent('bundled-override');t.after(()=>handle.dispose())
 await handle.enqueue({id:'override-input',source:{kind:'user'},content:'Load the current skill-creator.'});await handle.deliver('override-input');await handle.whenIdle()
 const catalog=handle.session.resourceLoader.getSkills().skills.filter(row=>row.name==='skill-creator')
 assert.equal(catalog.length,1);assert.equal(catalog[0].filePath,join(directory,'SKILL.md'))
 assert.equal(f.requests.length,2);assert.deepEqual(f.errors,[])
})
