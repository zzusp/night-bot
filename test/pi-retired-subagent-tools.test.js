import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {subagentFixture} from './fixtures/pi-subagent-fixture.js'

const retired=['subagent','spawn','fork','spawn_agent','send_message','interrupt_agent']
test('default official Host exposes no subagent architecture and rejects retired tool calls without effects',async t=>{
 const f=await subagentFixture(t,(_body,f)=>f.requests.length===1?{tools:retired.map((name,index)=>({id:'retired-'+index,name,args:{prompt:'Do not create a child',agent_id:'foreign',file_path:'retired-proof.txt'}}))}:{text:'Requested delegation tools are unavailable; no child or effect was created.'})
 for(const name of ['subagents','nativeSubagentProviders','piChildSessions','childSessions'])assert.equal(f.host.ctx.get(name),undefined,name)
 const h=await f.host.ctx.agents.create({sessionId:'retirement-proof',meta:{cwd:join(f.root,'work')},agentOptions:{provider:'fixture',model:'m'},authorizeInput:(packet,actor)=>actor.id==='retirement-proof'&&packet.id==='retired-input'&&packet.source.kind==='fixture-user',setup:async ctx=>{await ctx.get('agentPresets').mount(ctx,'night-bot')}});f.handles.push(h)
 assert.ok(h.session instanceof AgentSession)
 for(const name of retired)assert.equal(h.session.getActiveToolNames().includes(name),false,name)
 const before=(await f.host.ctx.sessionPersistence.list()).length
 await h.enqueue({id:'retired-input',source:{kind:'fixture-user'},content:'Check whether these retired delegation tools are available; do not perform any external work.'});await h.deliver('retired-input');await h.whenIdle()
 assert.equal(f.requests.length,2)
 for(const request of f.requests)assert.ok(!(request.tools??[]).some(tool=>retired.includes(tool.function.name)))
 const saved=await f.host.ctx.sessionPersistence.readNative(h.actor.id),results=saved.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message)
 assert.equal(results.length,retired.length)
 for(const [index,name]of retired.entries()){const result=results.find(result=>result.toolCallId==='retired-'+index);assert.equal(result.toolName,name);assert.equal(result.isError,true);assert.match(JSON.stringify(result.content),/not found|unknown|unavailable|not available/i)}
 assert.equal((await f.host.ctx.sessionPersistence.list()).length,before);assert.deepEqual(f.host.ctx.agents.list().map(actor=>actor.id),[h.actor.id]);assert.deepEqual(f.host.ctx.jobs.list(h.actor.id),[])
 assert.equal(saved.audit.some(receipt=>['child','subagent'].includes(receipt.domain)),false);await assert.rejects(readFile(join(f.root,'work','retired-proof.txt')),{code:'ENOENT'})
 assert.match(h.session.getLastAssistantText(),/unavailable/)
})
