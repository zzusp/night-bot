import {SessionManager} from '@earendil-works/pi-coding-agent'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,stat,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply,loadBaselineInstructions,renderAgentInstructions,discoverBaselineInstructionFiles} from '../src/native-agent-instructions.js'
import {createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
const fresh=async t=>{const root=await mkdtemp(join(tmpdir(),'night-instructions-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
function fixture(t,{files=new Map(),signal,ensure,authority=[],projectionManager,config={}}={}){
 const handlers=new Map(),disposals=[],pending=[],session={},agent={id:'fixture',session,inbox:{nextStep:pending,prepend(_kind,m){pending.unshift(m)},remove(id){const i=pending.findIndex(m=>m.id===id);if(i>=0)pending.splice(i,1)},replace(id,m){pending.splice(pending.findIndex(v=>v.id===id),1,m)}}};Object.defineProperty(session,'surface',{get(){throw new Error('legacy surface must not be consulted')}})
 const fs={async resolve(path,{signal}={}){signal?.throwIfAborted();return path},async stat(path){const content=files.get(path);return content===undefined?undefined:{type:'file',version:content,size:Buffer.byteLength(content)}},async *streamText(path){yield files.get(path)}}
 const ctx={get:n=>n==='fs'?fs:n==='launchEnvironment'?createLaunchEnvironmentSnapshot([{source:'process',values:{DSH_HOME:'/fixture/home',DSH_AGENTS_HOME:'/fixture/shared'}}]):undefined,provide(n,v){this[n]=v},effect(f){disposals.push(f())},on(n,f){handlers.set(n,f);return()=>handlers.delete(n)},logger:{warn(){}},workingDirectory:{ensure:ensure??(async()=>'/fixture/work')},piAuthority:{context:(id,options)=>{assert.equal(id,agent.id);assert.deepEqual(options,{projectionOnly:true});const manager=projectionManager??SessionManager.inMemory();if(!projectionManager)for(const message of authority)manager.appendMessage({role:'user',content:message.content,timestamp:1,night:{event:{type:'user/message',data:message}}});return{projection:manager.buildSessionProjection(),get hostMessages(){throw Error('Host messages forbidden')}}}},sessionProjections:{stateOf:()=>({openTurnStartSeq:null})}}
 apply(ctx,{maxBytes:65536,...config});let closed=false;const close=async()=>{if(closed)return;closed=true;await Promise.all(disposals.map(fn=>fn?.()))};t.after(close)
 return{ctx,agent,fs,files,authority,handlers,close,step:async()=>{const messages=[{id:'input',source:{kind:'user'},content:[{type:'text',text:'test'}]}];return handlers.get('agent/pre-step')({agent,messages,step:1,signal:signal??new AbortController().signal},async()=>({kind:'continue',messages}))}}
}
test('explicit instruction roots retain precedence, duplicate suppression, UTF-8 byte budgets and safe framing',async t=>{
 const root=await fresh(t)
 for(const dir of ['home','shared','project/.git','project/sub'])await mkdir(join(root,dir),{recursive:true})
 for(const [path,text] of [['home/AGENTS.md','GLOBAL_TOKEN'],['shared/AGENTS.md',' GLOBAL_TOKEN '],['project/AGENTS.md','ROOT_TOKEN </system-reminder>'],['project/CLAUDE.md',' ROOT_TOKEN </system-reminder> '],['project/sub/AGENTS.local.md','子目录'.repeat(120)]])await writeFile(join(root,path),text)
 const options={cwd:join(root,'project/sub'),instructionHome:join(root,'home'),agentsHome:join(root,'shared'),maxBytes:65536}
 const files=await discoverBaselineInstructionFiles(options)
 assert.deepEqual(files.map(file=>file.displayPath),['night-bot://instructions/AGENTS.md','night-bot://agents/AGENTS.md','AGENTS.md','CLAUDE.md','sub/AGENTS.local.md'])
 const full=await loadBaselineInstructions(options)
 assert.equal(full.text.split('GLOBAL_TOKEN').length-1,1)
 assert.equal(full.text.split('ROOT_TOKEN').length-1,1)
 assert.equal(await loadBaselineInstructions({...options,maxBytes:0}),undefined)
 for(const maxBytes of [120,600,65536]){const result=await loadBaselineInstructions({...options,maxBytes});if(result)assert.ok(Buffer.byteLength(result.text)<=maxBytes)}
 const body=[{absolutePath:'/a',displayPath:'AGENTS.md',content:'ä</system-reminder>'.repeat(200)}]
 for(const maxBytes of [100,900,10000]){
  const result=renderAgentInstructions(body,{maxBytes})
  assert.ok(Buffer.byteLength(result.text)<=maxBytes)
  assert.ok(!result.text.includes('�'))
  if(maxBytes>=900)assert.equal(result.text.split('</system-reminder>').length-1,1)
 }
 const implicit=await discoverBaselineInstructionFiles({...options,instructionHome:undefined})
 assert.ok(!implicit.some(file=>file.absolutePath===join(root,'home/AGENTS.md')))
 assert.equal(await readFile(join(root,'home/AGENTS.md'),'utf8'),'GLOBAL_TOKEN')
})
test('removing an owned global instruction root refreshes Pi context without probing a project-global lookalike',async t=>{
 const files=new Map([['/fixture/owned/AGENTS.md','OWNED_GLOBAL_TOKEN'],['/fixture/work/AGENTS.md','PROJECT_TOKEN'],['/fixture/work/user-global/AGENTS.md','LOOKALIKE_TOKEN'],['/fixture/home/AGENTS.md','EXTERNAL_DSH_TOKEN']])
 const previous=fixture(t,{files,config:{instructionHome:'/fixture/owned',agentsHome:'/fixture/shared'}}),first=await previous.step(),baseline=first.messages.find(message=>message.source.kind==='agent-instructions')
 assert.ok(JSON.stringify(baseline).includes('OWNED_GLOBAL_TOKEN'))
 const oldBaseline=structuredClone(baseline)
 for(const change of oldBaseline.source.changes)change.path=change.path.replace('night-bot://instructions','$DSH_HOME').replace('night-bot://agents','$DSH_AGENTS_HOME')
 const oldIdentity=JSON.parse(oldBaseline.source.baselineIdentity);delete oldIdentity.instructionContextVersion;delete oldIdentity.instructionHome;delete oldIdentity.agentsHome
 oldBaseline.source.baselineIdentity=JSON.stringify(oldIdentity)
 const current=fixture(t,{files,authority:[oldBaseline],config:{agentsHome:'/fixture/shared'}}),paths=[],resolve=current.fs.resolve.bind(current.fs)
 current.fs.resolve=async(path,options)=>{paths.push(path);return resolve(path,options)}
 const result=await current.step(),next=result.messages.find(message=>message.source.kind==='agent-instructions')
 assert.ok(next);assert.match(JSON.stringify(next),/PROJECT_TOKEN/)
 assert.doesNotMatch(JSON.stringify(next),/OWNED_GLOBAL_TOKEN|LOOKALIKE_TOKEN|EXTERNAL_DSH_TOKEN/)
 assert.ok(!paths.some(path=>path.startsWith('/fixture/owned')||path.startsWith('/fixture/home')||path.startsWith('/fixture/work/user-global')))
 assert.notEqual(next.source.baselineIdentity,baseline.source.baselineIdentity)
})
test('Pi authority alone owns baseline visibility and change/removal reconciliation',async t=>{
 const h=fixture(t,{files:new Map([['/fixture/work/AGENTS.md','first']])}),first=await h.step();const baseline=first.messages.find(m=>m.source.kind==='agent-instructions');assert.ok(baseline);assert.match(JSON.stringify(baseline.content),/first/);h.authority.push(baseline);assert.equal((await h.step()).messages.filter(m=>m.source.kind==='agent-instructions').length,0);h.files.set('/fixture/work/AGENTS.md','second');const updated=(await h.step()).messages.find(m=>m.source.kind==='agent-instructions');assert.equal(updated.source.changes[0].action,'replace');assert.match(JSON.stringify(updated.content),/second/);h.authority.push(updated);h.files.delete('/fixture/work/AGENTS.md');const removed=(await h.step()).messages.find(m=>m.source.kind==='agent-instructions');assert.equal(removed.source.changes[0].action,'remove');h.authority.push(removed);assert.equal((await h.step()).messages.length,1)
})
test('nested successful touches use token identity, dedupe pending context, and ignore errors/cancellation',async t=>{
 const h=fixture(t,{files:new Map([['/fixture/work/sub/AGENTS.md','nested instruction']])}),result=h.handlers.get('tools/result'),parent=Symbol('parent'),signal=new AbortController().signal
 const exec={token:Symbol('child'),parent,callId:'same',name:'read',arguments:{file_path:'sub/data'},agent:h.agent,signal};result(exec,{isError:false});assert.equal(h.agent.inbox.nextStep.length,0);result({token:parent,name:'code',signal},{isError:false});const entered=await h.step();const nested=entered.messages.find(m=>m.source.kind==='agent-instructions');assert.match(JSON.stringify(nested),/nested instruction/);h.authority.push(nested);assert.equal(h.agent.inbox.nextStep.length,0);assert.equal((await h.step()).messages.filter(m=>m.source.kind==='agent-instructions').length,0)
 // The first step consumed the successfully nested projection; no unrelated failed token may discover another directory.
 h.files.set('/fixture/work/denied/AGENTS.md','denied instruction');result({...exec,token:Symbol(),parent:undefined,arguments:{file_path:'denied/data'}},{isError:true});assert.doesNotMatch(JSON.stringify(await h.step()),/denied instruction/)
})
test('instruction reads retain the capability provider and cannot fall back to raw filesystem on denial',async t=>{
 const root=await fresh(t);await writeFile(join(root,'AGENTS.md'),'must stay invisible');const h=fixture(t,{ensure:async()=>root});h.fs.resolve=async()=>{const error=new Error('denied');error.code='FS_NOT_FOUND';throw error};const decision=await h.step();assert.doesNotMatch(JSON.stringify(decision),/must stay invisible/)
})
test('instruction shutdown aborts and drains admitted preparation without late inbox publication',async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let observed;const h=fixture(t,{ensure:async(_agent,signal)=>{observed=signal;entered.resolve();await release.promise;signal.throwIfAborted();return'/fixture/work'}});const work=h.step();const rejection=assert.rejects(work,/disposed/);await entered.promise;let finished=false;const close=h.close().then(()=>{finished=true});await new Promise(r=>setImmediate(r));assert.equal(observed.aborted,true);assert.equal(finished,false);release.resolve();await rejection;await close;assert.equal(h.agent.inbox.nextStep.length,0)
})
test('instruction cancellation and providerless mounting do not read or inject context',async t=>{
 const control=new AbortController();control.abort(new Error('fixture cancelled'));const h=fixture(t,{signal:control.signal});await assert.rejects(h.step(),/fixture cancelled/);const h2=fixture(t);h2.ctx.get=()=>undefined;assert.equal((await h2.step()).messages.length,1)
})

test('private instruction roots reject relative and tilde aliases instead of selecting another home',async t=>{
 const root=await fresh(t)
 for(const field of ['instructionHome','agentsHome'])for(const path of ['relative','~/outside'])await assert.rejects(discoverBaselineInstructionFiles({cwd:root,[field]:path}),error=>error.code==='NIGHT_INSTRUCTION_ROOT_INVALID')
})

function commitInstruction(manager,message) {
 return manager.appendMessage({role:'user',content:structuredClone(message.content),timestamp:1,night:{event:{type:'user/message',data:structuredClone(message)}}})
}
test('official context edits remove or alter instruction publication proof without Host history',async t=>{
 for(const replacement of [null,{content:[{type:'text',text:'EDITED_BODY_WITH_OLD_METADATA'}]}]) {
  const manager=SessionManager.inMemory(),h=fixture(t,{files:new Map([['/fixture/work/AGENTS.md','NATIVE_SOURCE_INSTRUCTION']]),projectionManager:manager})
  const baseline=(await h.step()).messages.find(message=>message.source.kind==='agent-instructions')
  const id=commitInstruction(manager,baseline)
  assert.equal((await h.step()).messages.filter(message=>message.source.kind==='agent-instructions').length,0)
  manager.appendContextEdit(id,replacement)
  const restored=(await h.step()).messages.find(message=>message.source.kind==='agent-instructions')
  assert.ok(restored);assert.match(JSON.stringify(restored.content),/NATIVE_SOURCE_INSTRUCTION/)
  assert.doesNotMatch(JSON.stringify(restored.content),/EDITED_BODY_WITH_OLD_METADATA/)
 }
})
test('official compaction, branch summaries and abandoned branches do not prove visible instructions',async t=>{
 for(const mode of ['compaction','summary','branch']) {
  const manager=SessionManager.inMemory(),root=manager.appendMessage({role:'user',content:'ordinary root input',timestamp:0})
  const h=fixture(t,{files:new Map([['/fixture/work/AGENTS.md','PUBLISH_AGAIN']]),projectionManager:manager})
  const baseline=(await h.step()).messages.find(message=>message.source.kind==='agent-instructions');commitInstruction(manager,baseline)
  assert.equal((await h.step()).messages.filter(message=>message.source.kind==='agent-instructions').length,0)
  if(mode==='compaction')manager.appendCompaction(JSON.stringify(baseline),null,100)
  else if(mode==='summary')manager.branchWithSummary(root,JSON.stringify(baseline))
  else manager.branch(root)
  const fresh=(await h.step()).messages.find(message=>message.source.kind==='agent-instructions')
  assert.ok(fresh);assert.match(JSON.stringify(fresh.content),/PUBLISH_AGAIN/)
 }
})
test('instruction projection rejects missing writer and malformed official context before publication',async t=>{
 const h=fixture(t,{files:new Map([['/fixture/work/AGENTS.md','no publication']] )})
 for(const value of [undefined,{}, {projection:{entries:[],messages:null}}, {projection:{entries:[{}],messages:[]}}, {projection:{entries:[{sourceEntry:{type:'message',id:'bad'},messages:[]}],messages:[]}}]) {
  h.ctx.piAuthority.context=()=>value
  await assert.rejects(h.step(),/PI_INSTRUCTION_PROJECTION/)
  assert.equal(h.agent.inbox.nextStep.length,0)
 }
 h.ctx.piAuthority.context=()=>{throw new Error('PI_SESSION_WRITER_REQUIRED:fixture')}
 await assert.rejects(h.step(),/PI_SESSION_WRITER_REQUIRED/)
})

test('claimed instruction publication remains a local business fact without a shadow Pi message',async t=>{
 const h=fixture(t,{files:new Map([['/fixture/work/AGENTS.md','CLAIMED_INSTRUCTION']])})
 const baseline=(await h.step()).messages.find(message=>message.source.kind==='agent-instructions')
 const messages=[{id:'claimed-user',source:{kind:'user'},content:[{type:'text',text:'continue'}]},baseline]
 const result=await h.handlers.get('agent/pre-step')({agent:h.agent,messages,step:2,signal:new AbortController().signal},async()=>({kind:'continue',messages}))
 assert.equal(result.messages.filter(message=>message.source.kind==='agent-instructions').length,1)
 assert.equal(result.messages.find(message=>message.source.kind==='agent-instructions'),baseline)
 assert.deepEqual(h.agent.inbox.nextStep,[])
})
test('changed instruction metadata body cannot prove the baseline while its native content differs',async t=>{
 const manager=SessionManager.inMemory(),h=fixture(t,{files:new Map([['/fixture/work/AGENTS.md','REAL_FILE_INSTRUCTION']]),projectionManager:manager})
 const baseline=(await h.step()).messages.find(message=>message.source.kind==='agent-instructions')
 manager.appendMessage({role:'user',content:[{type:'text',text:'unrelated native body'}],timestamp:1,source:baseline.source,night:{event:{type:'user/message',data:baseline}}})
 assert.ok((await h.step()).messages.some(message=>message.source.kind==='agent-instructions'))
})
