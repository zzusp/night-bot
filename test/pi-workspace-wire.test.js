import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
import {createUserMessage} from '../packages/capability-compat/llm/index.js'
const input=text=>createUserMessage({source:{kind:'user'},content:[{type:'text',text}]})
test('native workspace archive blocks real Pi requests including subagent lineage and unarchive restores admission', {timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-workspace-wire-')),requests=[],handles=[];let host
 const server=createServer(async(req,res)=>{for await(const _ of req){}requests.push(req.url);res.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason]of [[{role:'assistant',content:'workspace verified'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'workspace-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')})
 t.after(async()=>{try{for(const handle of handles.toReversed())await handle.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const work=join(root,'work');host=await createHost({stateDir:join(root,'state'),workspaceDir:work,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_WORKSPACE_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retryPolicy:{mode:'normal',maxRetries:0},models:[{id:'m',contextWindow:4096,maxTokens:128}]}}},{environmentSnapshot:{get(name){return name==='FIXTURE_WORKSPACE_KEY'?{value:'fixture',source:'process'}:undefined},getFrom(name,sources){return sources.includes('process')?this.get(name):undefined}}})
 assert.equal(host.ctx.workspaceRegistry.constructor.name,'NativeWorkspace')
 const create=async(id,meta={},parentAgent)=>{const h=await host.ctx.agents.create({sessionId:id,...meta.isSeeded?{seed:[],inheritedEventCount:0}:{},agentOptions:{provider:'fixture',model:'m'},meta:{cwd:work,...meta},...parentAgent?{parentAgent}:{}});handles.push(h);return h}
 const parent=await create('workspace-parent'),child=await create('workspace-child',{origin:'subagent',parentSession:'workspace-parent'},parent.agent),fork=await create('workspace-fork',{isSeeded:true,parentSession:'workspace-parent'})
 const workspace=await host.ctx.workspaceRegistry.create(work);await workspace.attachSession('workspace-parent');await host.ctx.workspaceRegistry.archiveSession('workspace-parent')
 for(const h of [parent,child]){h.agent.steer(input('This archived lineage must stay blocked'));await h.agent.whenIdle();assert.equal(h.agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'blocked')}
 assert.equal(requests.length,0);fork.agent.steer(input('Independent fork may run'));await fork.agent.whenIdle();assert.equal(requests.length,1)
 await host.ctx.workspaceRegistry.unarchiveSession('workspace-parent');child.agent.steer(input('Restored lineage may run'));await child.agent.whenIdle();assert.equal(requests.length,2);assert.equal(child.agent.providerStreamProtocol,'pi-native')
})
