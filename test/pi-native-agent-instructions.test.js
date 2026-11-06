import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply,inject,loadBaselineInstructions,renderAgentInstructions,discoverBaselineInstructionFiles,officialInstructionFiles} from '../src/native-agent-instructions.js'
import {memoryHost} from './fixtures/memory-host.js'
const fresh=async t=>{const root=await mkdtemp(join(tmpdir(),'night-instructions-'));t.after(()=>rm(root,{recursive:true,force:true}));return root}
const prompt=body=>JSON.stringify(body.messages.filter(message=>message.role==='system'))
async function fixture(t,decide){
 const h=await memoryHost(t,body=>decide?.(body,h)??{text:'official resources verified'}),work=h.host.ctx.runtimePaths.workspaces,handle=await h.agent('native-instruction-proof');t.after(()=>handle.dispose())
 let sequence=0;const actor=handle.actor,services=h.host.ctx.agentPresets
 return {...h,work,handle,actor,fs:services.serviceFor(actor,'fs'),instructions:services.serviceFor(actor,'nativeAgentInstructions'),say:async text=>{const id='native-instruction-'+ ++sequence;await handle.enqueue({id,source:{kind:'user'},content:text});await handle.deliver(id);await handle.whenIdle();await h.host.ctx.memory.whenIdle()},saved:()=>h.host.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})}
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
test('removing an owned instruction root refreshes current SDK resources without probing home lookalikes',async t=>{
 const h=await fixture(t),owned=join(h.host.ctx.runtimePaths.harnessHome,'AGENTS.md'),lookalike=join(h.work,'user-global','AGENTS.md');await mkdir(join(h.work,'user-global'));await writeFile(owned,'OWNED_GLOBAL_TOKEN');await writeFile(join(h.work,'AGENTS.md'),'PROJECT_TOKEN');await writeFile(lookalike,'LOOKALIKE_TOKEN')
 await h.say('inspect current authorized roots');assert.match(prompt(h.requests[0]),/OWNED_GLOBAL_TOKEN/);await rm(owned);await h.say('inspect removed root');assert.match(prompt(h.requests[1]),/PROJECT_TOKEN/);assert.doesNotMatch(prompt(h.requests[1]),/OWNED_GLOBAL_TOKEN|LOOKALIKE_TOKEN/)
})
test('official SDK resource refresh replaces and removes current files without a publication fold',async t=>{
 const h=await fixture(t),path=join(h.work,'AGENTS.md');await writeFile(path,'FIRST_CURRENT_SOURCE');await h.say('first');assert.match(prompt(h.requests[0]),/FIRST_CURRENT_SOURCE/);await writeFile(path,'SECOND_CURRENT_SOURCE');await h.say('replace');assert.match(prompt(h.requests[1]),/SECOND_CURRENT_SOURCE/);assert.doesNotMatch(prompt(h.requests[1]),/FIRST_CURRENT_SOURCE/);await rm(path);await h.say('remove');assert.doesNotMatch(prompt(h.requests[2]),/FIRST_CURRENT_SOURCE|SECOND_CURRENT_SOURCE/);assert.equal(h.actor.session,undefined)
})
test('only successful current-schema native file calls discover nested instructions; errors and cancellation do not',async t=>{
 const h=await fixture(t,(_body,h)=>h.requests.length===1?{tool:'read',args:{path:'sub/data.txt'}}:h.requests.length===3?{tool:'read',args:{path:'denied/no-file.txt'}}:h.requests.length===5?{tool:'read',args:{path:'canceled/data.txt'}}:{text:'read verified'});for(const dir of ['sub','denied','canceled']){await mkdir(join(h.work,dir));await writeFile(join(h.work,dir,'AGENTS.md'),dir.toUpperCase()+'_NESTED_INSTRUCTION')}await writeFile(join(h.work,'sub/data.txt'),'public data');await writeFile(join(h.work,'canceled/data.txt'),'must not discover after cancellation')
 await h.say('discover successful read');assert.match(prompt(h.requests[1]),/SUB_NESTED_INSTRUCTION/);await h.say('failed read is not discovery');assert.doesNotMatch(prompt(h.requests.at(-1)),/DENIED_NESTED_INSTRUCTION/)
 let cancellation;h.actor.ctx.on('tools/pre-execute',(exec,next)=>{if(exec.name==='read'&&exec.arguments.path==='canceled/data.txt')cancellation=h.actor.piSession.abort();return next()})
 await h.say('cancel before read').catch(error=>assert.match(error.message,/abort|cancel/i));await cancellation
 assert.deepEqual(h.instructions.officialDiscoveredPaths(h.actor),[join(h.work,'sub/data.txt')]);const saved=await h.saved(),results=saved.context.piMessages.filter(message=>message.role==='toolResult'&&message.toolName==='read');assert.equal(results.length,3);assert.equal(results[0].isError,false);assert.equal(results[1].isError,true);assert.equal(results[2].isError,true)
})
test('actual scoped instruction reader cannot fall back to raw filesystem after a provider denial',async t=>{
 const h=await fixture(t),path=join(h.work,'AGENTS.md');await writeFile(path,'MUST_STAY_INVISIBLE');const resolve=h.fs.resolve;h.fs.resolve=async function(value,...args){if(value===path)throw Object.assign(Error('denied'),{code:'FS_NOT_FOUND'});return resolve.call(this,value,...args)}
 await h.say('inspect provider-authorized files only');assert.doesNotMatch(prompt(h.requests[0]),/MUST_STAY_INVISIBLE/);assert.equal(await readFile(path,'utf8'),'MUST_STAY_INVISIBLE')
})
test('actor shutdown cancels and joins an admitted official resource read before releasing its writer',{timeout:15000},async t=>{
 const h=await fixture(t),path=join(h.work,'AGENTS.md');await writeFile(path,'LIFETIME_RESOURCE');const entered=Promise.withResolvers(),release=Promise.withResolvers(),stream=h.fs.streamText;let observed,closed=false;t.after(()=>release.resolve())
 h.fs.streamText=async function(target,signal){if(String(target.targetKey)!==path)return stream.call(this,target,signal);observed=signal;return(async function*(){entered.resolve();await release.promise;signal.throwIfAborted();yield 'LIFETIME_RESOURCE'})()}
 const pending=h.say('resource lifetime proof'),rejected=assert.rejects(pending);await Promise.race([entered.promise,pending.then(()=>{throw Error('Expected scoped resource read was not entered')})]);const closing=h.handle.dispose().then(()=>{closed=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(observed.aborted,true);assert.equal(closed,false);release.resolve();await rejected;await closing;assert.equal(h.requests.length,0)
})
test('pre-canceled resource discovery does not read; providerless mount registers no old step or inbox mechanism',async t=>{
 const controller=new AbortController();controller.abort(Error('fixture canceled'));let reads=0
 await assert.rejects(officialInstructionFiles({cwd:'/authorized',projectRoot:'/authorized',maxBytes:65536,signal:controller.signal},{resolve(){reads++;assert.fail('No read after cancellation')}}),/fixture canceled/);assert.equal(reads,0)
 const names=[],disposals=[],ctx={workingDirectory:{},provide(name,value){this[name]=value},on:name=>names.push(name),effect:fn=>disposals.push(fn())};apply(ctx,{maxBytes:65536});assert.deepEqual(inject,['workingDirectory']);assert.deepEqual(names,['tools/result']);assert.equal(ctx.nativeAgentInstructions.contextAuthority,'pi-session-manager');for(const dispose of disposals)await dispose()
})
test('private instruction roots reject relative and tilde aliases instead of selecting another home',async t=>{
 const root=await fresh(t)
 for(const field of ['instructionHome','agentsHome'])for(const path of ['relative','~/outside'])await assert.rejects(discoverBaselineInstructionFiles({cwd:root,[field]:path}),error=>error.code==='NIGHT_INSTRUCTION_ROOT_INVALID')
})
test('official context edits cannot turn historical instruction text into current resource authorization',async t=>{
 const h=await fixture(t),path=join(h.work,'AGENTS.md');await writeFile(path,'REAL_CURRENT_INSTRUCTION');await h.say('first');const manager=h.actor.piSession.sessionManager,id=manager.appendMessage({role:'user',content:'HISTORICAL_RESOURCE_CLAIM',timestamp:1});manager.appendContextEdit(id,{content:[{type:'text',text:'EDITED_RESOURCE_CLAIM'}]});await rm(path);await h.say('inspect actual current files');assert.doesNotMatch(prompt(h.requests.at(-1)),/REAL_CURRENT_INSTRUCTION|HISTORICAL_RESOURCE_CLAIM|EDITED_RESOURCE_CLAIM/);assert.ok((await h.saved()).entries.some(entry=>entry.type==='context_edit'))
})
test('official compaction, branch summaries and abandoned branches do not authorize removed instruction resources',async t=>{
 for(const mode of ['compaction','summary','branch']){
  const h=await fixture(t),path=join(h.work,'AGENTS.md');await writeFile(path,'ORIGINAL_CURRENT_RESOURCE');await h.say('first');const manager=h.actor.piSession.sessionManager,root=manager.appendMessage({role:'user',content:'ordinary branch root',timestamp:1});manager.appendMessage({role:'assistant',content:[{type:'text',text:'HISTORY_RESOURCE_CLAIM'}],api:'openai-completions',provider:'fixture',model:'m',stopReason:'stop',timestamp:1,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}})
  if(mode==='compaction')manager.appendCompaction('HISTORY_RESOURCE_CLAIM',root,100);else if(mode==='summary')manager.branchWithSummary(root,'HISTORY_RESOURCE_CLAIM');else manager.branch(root)
  await rm(path);await h.say('only current authorized resources');assert.doesNotMatch(prompt(h.requests.at(-1)),/ORIGINAL_CURRENT_RESOURCE|HISTORY_RESOURCE_CLAIM/)
 }
})
test('instruction observation rejects foreign and revoked actors without a writer/projection fallback',async t=>{
 const h=await fixture(t);assert.throws(()=>h.instructions.officialDiscoveredPaths({...h.actor}),/PI_INSTRUCTION_ACTOR_REQUIRED/);await h.handle.dispose();assert.throws(()=>h.instructions.officialDiscoveredPaths(h.actor),/PI_INSTRUCTION_ACTOR_REQUIRED/);assert.ok(!inject.includes('sessionProjections'));assert.ok(!inject.includes('piAuthority'))
})
test('reloading current instructions creates no synthetic business input or duplicate model context',async t=>{
 const h=await fixture(t),path=join(h.work,'AGENTS.md');await writeFile(path,'ONE_CURRENT_INSTRUCTION');await h.say('first');await h.say('second');assert.equal(prompt(h.requests.at(-1)).split('ONE_CURRENT_INSTRUCTION').length-1,1)
 const saved=await h.saved(),inputs=saved.entries.filter(entry=>entry.type==='custom_message'&&entry.customType==='night.business-input');assert.equal(inputs.length,2);assert.ok(inputs.every(entry=>entry.details.source.kind==='user'));assert.equal(saved.audit.filter(row=>row.domain==='admission'&&row.kind==='enqueued').length,2);assert.ok(!saved.audit.some(row=>row.domain==='agent-instructions'))
})
test('oversized current instruction source fails the real SDK request before provider dispatch rather than truncating authority',async t=>{
 const h=await fixture(t),path=join(h.work,'AGENTS.md'),content='COMPLETE_SOURCE_MARKER '.repeat(5000);await writeFile(path,content);await assert.rejects(h.say('no budget downgrade'),{code:'PI_OFFICIAL_INSTRUCTION_BUDGET_EXCEEDED'});assert.equal(h.requests.length,0);assert.equal(await readFile(path,'utf8'),content)
})
