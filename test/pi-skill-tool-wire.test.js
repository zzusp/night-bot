import test from 'node:test'
import assert from 'node:assert/strict'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'
async function actorFixture(t){
 const f=await subagentFixture(t,()=>({text:'skill catalog verified'})),remove=f.host.ctx.skills.register({name:'wire-skill',description:'WIRE_SKILL_SUMMARY',content:'WIRE_SKILL_FULL_BODY',source:'fixture',invocation:{modelInvocable:true,userInvocable:true}}),handle=await f.host.ctx.agents.create({sessionId:'skill-tool-catalog',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:f.host.config?.workspaceDir??f.root+'/work'},authorizeInput:packet=>packet.source.kind==='fixture-user',setup:async ctx=>{await f.host.ctx.agentPresets.mount(ctx,'night-bot')}})
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
 await send('gesture','please /wire-skill now');assert.match(JSON.stringify(f.requests[0]),/WIRE_SKILL_FULL_BODY/)
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id);assert.equal(saved.entries.filter(e=>e.type==='message').flatMap(e=>e.message.role==='assistant'?e.message.content:[]).filter(b=>b.type==='toolCall').length,0)
})
