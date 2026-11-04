import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHost} from '../src/host.js'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
const input=text=>createUserMessage({source:{kind:'user'},content:[{type:'text',text}]})
test('native spawn and fork providers create actual Pi children with isolated or completed parent context',{timeout:20000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-subagent-wire-')),requests=[],children=[],receipts=[],release=Promise.withResolvers(),pending=Promise.withResolvers();let host,parent
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);if(raw.includes('PARENT_PENDING_MARKER')){pending.resolve();await release.promise}res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason]of [[{role:'assistant',content:'subagent verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'subagent-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')})
 t.after(async()=>{release.resolve();try{for(const r of receipts.toReversed())await r.dispose();await parent?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const work=join(root,'work')
 host=await createHost({stateDir:join(root,'state'),workspaceDir:work,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_CHILD_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retryPolicy:{mode:'normal',maxRetries:0},models:[{id:'m',contextWindow:8192,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_CHILD_KEY:'fixture'}}})
 assert.equal(host.ctx.get('nativeSubagentProviders').owner,'night-native-subagent-providers');host.ctx.on('agent/created',({agent})=>{if(agent.session.header.origin==='subagent')children.push({agent,engine:host.ctx.piAuthority.describe(agent.id)?.engine,preset:host.ctx.agentPresets.composedPreset(agent.ctx)})})
 parent=await host.ctx.agents.create({sessionId:'subagent-parent',agentOptions:{provider:'fixture',model:'m'},meta:{cwd:work},setup:async ctx=>{await host.ctx.agentPresets.mount(ctx,'night-bot')}})
 parent.agent.steer(input('PRIVATE_PARENT_MARKER'));await parent.agent.whenIdle();parent.agent.steer(input('PARENT_PENDING_MARKER'));await pending.promise
 for(const provider of ['spawn','fork']){const receipt=await host.ctx.subagents.startActivation({provider,label:provider+' fixture',delivery:'caller',signal:new AbortController().signal,request:{parent:parent.agent,prompt:[{type:'text',text:provider+' child instruction'}],maxDepth:1}});receipts.push(receipt);const result=await receipt.result;assert.equal(result.stopReason,'completed',JSON.stringify(result));assert.ok(result.output.some(b=>b.type==='text'&&b.text.includes('subagent verified')))}
 assert.equal(children.length,2);for(const child of children){assert.equal(child.agent.constructor.name,'PiLoopAgent');assert.equal(child.engine,'pi-session-manager');assert.equal(child.preset,'night-bot');assert.equal(child.agent.session.header.parentSession,'subagent-parent')}
 const spawn=requests.find(r=>JSON.stringify(r.messages).includes('spawn child instruction')),fork=requests.find(r=>JSON.stringify(r.messages).includes('fork child instruction'));assert.ok(spawn);assert.ok(fork);assert.doesNotMatch(JSON.stringify(spawn.messages),/PRIVATE_PARENT_MARKER|PARENT_PENDING_MARKER/);assert.match(JSON.stringify(fork.messages),/PRIVATE_PARENT_MARKER/);assert.doesNotMatch(JSON.stringify(fork.messages),/PARENT_PENDING_MARKER/)
 release.resolve();await parent.agent.whenIdle();assert.equal(requests.length,4)
})
