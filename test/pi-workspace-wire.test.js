import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
import {underArchivedSession} from '../src/native-workspace.js'

let nextInput=0
const input=async(handle,text)=>{const id='workspace-input-'+(++nextInput);await handle.enqueue({id,source:{kind:'workspace-fixture'},content:text});await handle.deliver(id);await handle.whenIdle()}
const until=async check=>{for(let n=0;n<200;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,5))}throw Error('workspace fixture timeout')}
async function fixture(t,decide=()=>undefined){
 const root=await mkdtemp(join(tmpdir(),'night-workspace-wire-')),requests=[],handles=[];let host
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body)
  const decision=await decide(body,requests.length)
  res.writeHead(200,{'content-type':'text/event-stream'})
  const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'workspace-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta,finish_reason}]})+'\n\n')
  if(decision){send({role:'assistant',tool_calls:[{index:0,id:'workspace-tool',type:'function',function:{name:decision.name,arguments:JSON.stringify(decision.args??{})}}]});send({},'tool_calls')}
  else{send({role:'assistant',content:'workspace verified'});send({},'stop')}
  res.end('data: [DONE]\n\n')
 })
 t.after(async()=>{try{for(const handle of handles.toReversed())await handle.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const work=join(root,'work')
 const boot=async()=>host=await createHost({stateDir:join(root,'state'),workspaceDir:work,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_WORKSPACE_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:8192,maxTokens:128}]}}},{environmentOptions:{cwd:root,home:root,inherited:{FIXTURE_WORKSPACE_KEY:'fixture'}}})
 await boot()
 const authorization=packet=>packet.source.kind==='workspace-fixture'
 const create=async(id,meta={},parentAgent,setup)=>{const handle=await host.ctx.agents.create({sessionId:id,meta:{cwd:work,agentPreset:'night-bot',...meta},...parentAgent?{parentAgent}:{},authorizeInput:authorization,...setup?{setup}:{}});handles.push(handle);return handle}
 const resume=async id=>{const handle=await host.ctx.agents.resume({resumeSessionId:id,authorizeInput:authorization});handles.push(handle);return handle}
 return {get host(){return host},root,work,requests,create,resume,boot,async close(){await host?.close();host=undefined},get registry(){return host.ctx.workspaceRegistry}}
}
test('native workspace archive blocks official own/live/cold lineage while independent forks remain independent',{timeout:15000},async t=>{
 const f=await fixture(t),parent=await f.create('workspace-parent'),child=await f.create('workspace-child',{origin:'subagent',parentSession:parent.actor.id},parent.actor),fork=await f.create('workspace-fork',{parentSession:parent.actor.id})
 const workspace=await f.registry.create(f.work);await workspace.attachSession(parent.actor.id);await f.registry.archiveSession(parent.actor.id)
 assert.equal(f.host.ctx.agents.ownerOf(child.actor),parent.actor)
 assert.throws(()=>f.host.ctx.agents.ownerOf({...child.actor}),{code:'NATIVE_AGENT_OWNER_UNBOUND'})
 for(const handle of [parent,child])await assert.rejects(input(handle,'This archived lineage must stay blocked'),{code:'WORKSPACE_SESSION_ARCHIVED'})
 assert.equal(f.requests.length,0)
 await input(fork,'Independent fork may run');assert.equal(f.requests.length,1)
 await child.dispose();await parent.dispose();await f.close();await f.boot()
 assert.equal(f.registry.lineageHeaders.size,0,'cold lineage starts without trusted in-memory ancestor observations')
 const cold=await f.resume('workspace-child')
 await assert.rejects(input(cold,'Cold native header lineage must remain blocked'),{code:'WORKSPACE_SESSION_ARCHIVED'})
 assert.equal(f.requests.length,1)
 await f.registry.unarchiveSession('workspace-parent');await input(cold,'Restored lineage may run');assert.equal(f.requests.length,2)
 assert.equal(cold.actor.metadata.parentSession,'workspace-parent');assert.equal(cold.actor.session,undefined)
})
test('active archive persists its gate before awaiting real cancel and body drain; unarchive uses fresh resume',{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let exited=false
 t.after(()=>release.resolve())
 const f=await fixture(t,(_body,n)=>n===1?{name:'held_effect'}:undefined)
 const handle=await f.create('active-archive',{},undefined,async ctx=>{ctx.get('tools').register({name:'held_effect',description:'Controlled uncooperative body',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[]},async execute(){entered.resolve();await release.promise;exited=true;return{joined:true}}})})
 const running=input(handle,'Start the controlled body').catch(error=>error)
 await entered.promise;await assert.rejects(f.registry.archiveSession(handle.actor.id),error=>error.name==='WorkspaceActiveSessionError')
 assert.equal(f.registry.archivedSessionIds.includes(handle.actor.id),false)
 let completed=false
 const archived=f.registry.archiveSession(handle.actor.id,{stopActivity:true}).then(()=>{completed=true})
 await until(()=>f.registry.archivedSessionIds.includes(handle.actor.id));await new Promise(resolve=>setTimeout(resolve,20))
 assert.equal(completed,false);assert.equal(exited,false);assert.equal(f.host.ctx.agents.get(handle.actor.id),handle.actor);assert.equal(f.requests.length,1)
 release.resolve();await archived;await running
 assert.equal(completed,true);assert.equal(exited,true);assert.equal(handle.session.isStreaming,false)
 await f.registry.unarchiveSession(handle.actor.id)
 await assert.rejects(async()=>handle.enqueue({id:'cannot-reuse-cancelled',source:{kind:'workspace-fixture'},content:'no private flag reset'}),{code:'PI_OFFICIAL_ACTOR_NOT_LIVE'})
 await handle.dispose();const resumed=await f.resume(handle.actor.id);await input(resumed,'Fresh actor after unarchive may run');assert.equal(f.requests.length,2)
})
test('drain failure preserves durable archive and exact owner and is reported again without claiming completion',{timeout:15000},async t=>{
 const f=await fixture(t),handle=await f.create('archive-drain-failed'),cancel=handle.actor.cancel,cause=Error('controlled unresolved drain')
 handle.actor.cancel=async()=>{throw cause}
 try{
  await assert.rejects(f.registry.archiveSession(handle.actor.id,{stopActivity:true}),{code:'WORKSPACE_ARCHIVE_DRAIN_FAILED'})
  assert.ok(f.registry.archivedSessionIds.includes(handle.actor.id));assert.equal(f.host.ctx.agents.get(handle.actor.id),handle.actor)
  await assert.rejects(f.registry.archiveSession(handle.actor.id,{stopActivity:true}),{code:'WORKSPACE_ARCHIVE_DRAIN_FAILED'})
  await assert.rejects(input(handle,'Gate remains closed despite failed cancellation'),{code:'WORKSPACE_SESSION_ARCHIVED'});assert.equal(f.requests.length,0)
 }finally{handle.actor.cancel=cancel}
})
