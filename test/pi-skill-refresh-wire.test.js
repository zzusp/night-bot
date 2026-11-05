import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHost} from '../src/host.js'
import {AgentSession} from '@earendil-works/pi-coding-agent'
import {installSessionSkillRefresh,skillObservationAuditKinds} from '../packages/dingtalk-core/session-skill-refresh.js'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
test('external body-only skill edits notify the next real Pi request and require an explicit reread', {timeout:15000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'night-skill-refresh-wire-')),work=join(root,'work'),dir=join(work,'skills'),file=join(dir,'fixture.md'),requests=[];let host,handle,serverFailure
 const doc=body=>'---\nname: fixture\ndescription: Stable description\n---\n'+body+'\n'
 await mkdir(dir,{recursive:true});await writeFile(file,doc('ORIGINAL_TRUSTED_BODY'))
 const server=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);const index=requests.length,rendered=JSON.stringify(request)
  if(index===2){assert.ok(rendered.includes('ORIGINAL_TRUSTED_BODY'));const before=host.ctx.skills.revision;await writeFile(file,doc('UPDATED_TRUSTED_BODY'));for(let i=0;i<150&&host.ctx.skills.revision===before;i++)await sleep(10);assert.ok(host.ctx.skills.revision>before,'OS watcher must invalidate a body-only change')}
  if(index===3){assert.ok(rendered.includes('本会话已读技能或引用有变化'));assert.ok(!rendered.includes('UPDATED_TRUSTED_BODY'),'change notice must not silently load the new instructions')}
  if(index===4)assert.ok(rendered.includes('UPDATED_TRUSTED_BODY'))
  const name=index===2?'checkpoint':'skill',args=index===2?{}:{name:'fixture'},delta=index<4?{role:'assistant',tool_calls:[{index:0,id:'skill-wire-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'verified'}
  res.writeHead(200,{'content-type':'text/event-stream'});for(const [change,finish_reason]of [[delta,null],[{},index<4?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'skill-refresh-wire',object:'chat.completion.chunk',model:'m',choices:[{index:0,delta:change,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')
 }catch(e){serverFailure=e;res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture assertion failed'}}))}})
 t.after(async()=>{try{await handle?.dispose()}finally{try{await host?.close()}finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 host=await createHost({stateDir:join(root,'state'),workspaceDir:work,skillDirs:[dir],model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',apiKeyEnv:'FIXTURE_SKILL_KEY',baseURL:`http://127.0.0.1:${server.address().port}/v1`,retry:{enabled:false,provider:{maxRetries:0}},models:[{id:'m',contextWindow:32000,maxTokens:512}]}}},{environmentSnapshot:{get(name){return name==='FIXTURE_SKILL_KEY'?{value:'fixture',source:'process'}:undefined},getFrom(name,sources){return sources.includes('process')?this.get(name):undefined}}})
 handle=await host.ctx.agents.create({sessionId:'skill-refresh-proof',agentOptions:{provider:'fixture',model:'m'},auditKinds:skillObservationAuditKinds,meta:{cwd:work},authorizeInput:packet=>packet.id==='skill-input'&&packet.source.kind==='fixture-user',setup:async(ctx,agent)=>{await host.ctx.agentPresets.mount(ctx,'night-bot');ctx.get('tools').register({name:'checkpoint',description:'Read-only fixture checkpoint',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'checkpoint'}]},execute:async()=>({ok:true})})}})
 await assert.rejects(installSessionSkillRefresh(handle.agent.ctx,{...handle.agent},{cwd:work,signal:handle.agent.lifecycle.signal}),{code:'PI_SKILL_OBSERVATION_ACTOR_NOT_LIVE'})
 const observation=await installSessionSkillRefresh(handle.agent.ctx,handle.agent,{cwd:work,signal:handle.agent.lifecycle.signal});t.after(()=>observation.close())
 await handle.enqueue({id:'skill-input',source:{kind:'fixture-user'},content:[{type:'text',text:'Load fixture, checkpoint, then follow the latest applicable instructions.'}]});await handle.deliver('skill-input');await handle.whenIdle()
 assert.equal(serverFailure,undefined,serverFailure?.stack);assert.equal(requests.length,4);assert.ok(handle.session instanceof AgentSession);assert.equal(handle.agent.session,undefined);const saved=await host.ctx.sessionPersistence.readNative(handle.agent.id),messages=saved.entries.filter(e=>e.type==='message').map(e=>e.message);assert.equal(messages.flatMap(m=>m.role==='assistant'?m.content:[]).filter(b=>b.type==='toolCall'&&b.name==='skill').length,2);assert.equal(messages.filter(m=>m.role==='toolResult'&&m.toolName==='skill'&&!m.isError).length,2);assert.equal((await handle.agent.receipts.read()).filter(r=>r.domain==='skill-observation'&&r.kind==='read').length,2)
 const receipts=(await handle.agent.receipts.read()).filter(r=>r.domain==='skill-observation'&&r.kind==='read');for(const receipt of receipts){assert.ok(saved.entries.some(e=>e.id===receipt.payload.resultEntryId&&e.type==='message'&&e.message.role==='toolResult'&&e.message.toolCallId===receipt.payload.callId&&!e.message.isError));assert.doesNotMatch(JSON.stringify(receipt),/ORIGINAL_TRUSTED_BODY|UPDATED_TRUSTED_BODY/)}
 await observation.close();await handle.dispose();handle=await host.ctx.agents.resume({resumeSessionId:'skill-refresh-proof',agentOptions:{provider:'fixture',model:'m'},auditKinds:skillObservationAuditKinds,authorizeInput:packet=>packet.id==='after-delete'&&packet.source.kind==='fixture-user',setup:async ctx=>{await host.ctx.agentPresets.mount(ctx,'night-bot')}})
 const recovered=await installSessionSkillRefresh(handle.agent.ctx,handle.agent,{cwd:work,signal:handle.agent.lifecycle.signal});t.after(()=>recovered.close());const beforeDelete=host.ctx.skills.revision;await rm(file);for(let i=0;i<150&&host.ctx.skills.revision===beforeDelete;i++)await sleep(10);assert.ok(host.ctx.skills.revision>beforeDelete);await handle.enqueue({id:'after-delete',source:{kind:'fixture-user'},content:'Check whether the skill still exists.'});await handle.deliver('after-delete');await handle.whenIdle();assert.equal(requests.length,5);assert.match(JSON.stringify(requests[4]),/本会话已读技能或引用有变化/);assert.match(JSON.stringify(requests[4]),/unavailable/);assert.equal((await handle.agent.receipts.read()).filter(r=>r.domain==='skill-observation'&&r.kind==='read').length,2)
})

for(const reader of ['read','read_window'])test('official '+reader+' reference observations retain exact execution evidence and survive cold restore',{timeout:20000},async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js')
 const {registerPiFileTools}=await import('../src/pi-file-tool-registration.js')
 const {createPiFileToolBudgets}=await import('../src/runtime/pi-file-tool-budgets.js')
 let file,index=0
 const f=await memoryHost(t,async body=>{
  index++
  if(index===1)return {tool:'skill',args:{name:'reference-fixture'}}
  if(index===2)return {tool:reader,args:{path:file,offset:1,limit:1}}
  if(index===3){assert.match(JSON.stringify(body),/REFERENCE_BEFORE_CHANGE/);await writeFile(file,'REFERENCE_AFTER_CHANGE\n');return {tool:'reference_checkpoint',args:{}}}
  assert.match(JSON.stringify(body),/本会话已读技能或引用有变化/)
  assert.ok(!JSON.stringify(body).includes('REFERENCE_AFTER_CHANGE'),'notice must not silently read changed reference content')
  return {text:'reference change verified'}
 })
 const directory=join(f.host.ctx.runtimePaths.workspaces,'reference-skill-'+reader);await mkdir(directory);file=join(directory,'procedure.md');await writeFile(file,'REFERENCE_BEFORE_CHANGE\n')
 f.host.ctx.skills.register({name:'reference-fixture',description:'Reference observation fixture',content:'Read procedure.md only when needed.',source:'fixture',resourceBase:{kind:'directory',path:directory}})
 const resources=[]
 const setup=async(ctx,actor)=>{
  const budgets=createPiFileToolBudgets({actor}),files=registerPiFileTools({ctx,actor,...budgets});resources.push({budgets,files})
  ctx.get('tools').register({name:'reference_checkpoint',description:'Read-only reference checkpoint',effectClass:'read',parameters:{type:'object',properties:{}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'checkpoint'}]},execute:async()=>({ok:true})})
 }
 let handle=await f.host.ctx.agents.create({sessionId:'reference-'+reader,agentOptions:f.config.model,meta:{cwd:f.host.ctx.runtimePaths.workspaces},authorizeInput:packet=>packet.source.kind==='user',setup})
 t.after(async()=>{await handle.dispose();for(const {files,budgets}of resources){await files.close();budgets.close()}})
 await handle.enqueue({id:'reference-input',source:{kind:'user'},content:'Load the skill and read its reference.'});await handle.deliver('reference-input');await handle.whenIdle()
 assert.equal(f.requests.length,4)
 let saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id,{requireComplete:true})
 const reference=saved.audit.find(receipt=>receipt.domain==='skill-observation'&&receipt.payload.record.kind==='reference')
 assert.equal(reference.payload.record.path,file)
 const entry=saved.entries.find(entry=>entry.id===reference.payload.resultEntryId)
 assert.equal(entry.message.toolName,reader);assert.equal(entry.message.isError??false,false);assert.equal(entry.message.toolCallId,reference.payload.callId)
 assert.doesNotMatch(JSON.stringify(reference),/REFERENCE_BEFORE_CHANGE|REFERENCE_AFTER_CHANGE/)
 assert.equal(saved.audit.filter(receipt=>receipt.domain==='skill-observation').length,2)
 await handle.dispose()
 handle=await f.host.ctx.agents.resume({sessionId:'reference-'+reader,agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup})
 await handle.enqueue({id:'reference-after-cold',source:{kind:'user'},content:'Inspect the current reference version notice without rereading.'});await handle.deliver('reference-after-cold');await handle.whenIdle()
 saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id,{requireComplete:true})
 assert.equal(saved.audit.filter(receipt=>receipt.domain==='skill-observation').length,2,'cold receipts are verified against original official read/read_window entries without replay')
 assert.equal(f.requests.length,5)
})

test('a copied execution carrying a canonical observation cannot create a skill reference receipt',{timeout:15000},async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js');let index=0,file
 const f=await memoryHost(t,()=>++index===1?{tool:'skill',args:{name:'copied-exec-skill'}}:index===2?{tool:'read',args:{path:file}}:{text:'done'})
 const directory=join(f.host.ctx.runtimePaths.workspaces,'copied-exec-reference');await mkdir(directory);file=join(directory,'reference.md');await writeFile(file,'REFERENCE_BYTES')
 f.host.ctx.skills.register({name:'copied-exec-skill',description:'Exact execution negative fixture',content:'Read reference only when needed.',source:'fixture',resourceBase:{kind:'directory',path:directory}})
 const handle=await f.host.ctx.agents.create({sessionId:'copied-exec-reference',agentOptions:f.config.model,meta:{cwd:f.host.ctx.runtimePaths.workspaces},authorizeInput:packet=>packet.source.kind==='user',setup:async(ctx,actor)=>{
  ctx.get('tools').register({name:'read',description:'Fixture reader with deliberately unassociated observation',effectClass:'read',parameters:{type:'object',required:['path'],properties:{path:{type:'string'}}},output:{schema:{type:'object'},render:()=>[{type:'text',text:'literal fixture output'}]},async execute(args,exec){
   const fs=ctx.get('agentPresets').serviceFor(actor,'fs')??ctx.get('fs'),target=await fs.resolve(args.path,{cwd:actor.metadata.cwd,signal:exec.signal}),info=await fs.stat(target,exec.signal)
   ctx.emit('fs/observed',target,{kind:'present',version:info.version},{...exec})
   return {text:'literal fixture output',images:[]}
  }})
 }})
 t.after(()=>handle.dispose())
 await handle.enqueue({id:'copied-exec-input',source:{kind:'user'},content:'Load the skill then exercise the reader.'});await handle.deliver('copied-exec-input');await handle.whenIdle()
 const saved=await f.host.ctx.sessionPersistence.readNative(handle.agent.id,{requireComplete:true})
 assert.equal(saved.entries.filter(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&!entry.message.isError).length,2)
 const receipts=saved.audit.filter(receipt=>receipt.domain==='skill-observation')
 assert.equal(receipts.length,1);assert.equal(receipts[0].payload.record.kind,'skill','same actor/name/callId is insufficient without the identical execution object')
})
