import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir,symlink} from 'node:fs/promises'
import fsPromises from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {setImmediate} from 'node:timers/promises'
import {join} from 'node:path'
import sharp from 'sharp'
import {memoryHost} from './fixtures/memory-host.js'
import {officialToolsFixture} from './fixtures/pi-official-tools.js'
import {createScope} from '../src/native-scope.js'
import {bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import {bindSandboxPolicyActor} from '../src/native-policy.js'
import {createAgentSession,SessionManager} from '@earendil-works/pi-coding-agent'
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai'
import {createPiFileTools} from '../src/pi-file-tools.js'
async function fixture(t,options={}){
 const host=await memoryHost(t),sdk=await officialToolsFixture(t,async()=>{}),ctx=host.host.ctx,root=join(ctx.runtimePaths.workspaces,'pi-file-prototype');await mkdir(root)
 const actor={id:sdk.session.sessionId,piSession:sdk.session},scope=createScope(ctx,actor);actor.ctx=scope.ctx
 const detach=ctx.agents.enter(actor);t.after(async()=>{detach();await scope.dispose()})
 let mode='workspace-write'
 bindWorkingDirectoryActor(actor,{initialDirectory:root,isLive:()=>ctx.agents.get(actor.id)===actor,readDirectory:()=>root,appendChange(){throw Error('unused')},admitNotice(){}})
 bindSandboxPolicyActor(actor,{initialDirectory:root,isLive:()=>ctx.agents.get(actor.id)===actor,readPolicy:()=>({mode,artifactRoot:null}),appendPolicy(){throw Error('unused')}})
 const observations=[],charges=[];ctx.on('fs/observed',(target,observation,exec)=>{if(exec.agent===actor)observations.push({target,...observation})})
 const bundle=createPiFileTools({ctx,actor,sourceConfig:options.maxInputBytes?{maxBufferedBytes:options.maxInputBytes}:options.sourceConfig??{},imageBudget:Object.hasOwn(options,'imageBudget')?options.imageBudget:{accept:async value=>{charges.push(value);return true}},transportBudget:Object.hasOwn(options,'transportBudget')?options.transportBudget:{accept:async()=>true}});t.after(()=>bundle.close());const tools=Object.fromEntries(bundle.tools.map(tool=>[tool.name,tool]))
 return {host,ctx,actor,root,bundle,tools,observations,charges,sdk,setMode(value){mode=value},run(name,args,signal){return tools[name].execute('production-'+name,args,signal)}}
}
test('official native schemas + actual PrivateFS support read, multi-edit/fuzzy, guarded create and reject unobserved overwrite',async t=>{
 const f=await fixture(t),path=join(f.root,'text.txt');await writeFile(path,'“hello”   \nsecond\nthird\n')
 assert.ok(f.tools.read.parameters.properties.path);assert.ok(f.tools.edit.parameters.properties.edits)
 await assert.rejects(f.run('edit',{path,edits:[{oldText:'second',newText:'bad'}]}),/FS_NOT_OBSERVED|read.*first/)
 await assert.rejects(f.run('write',{path,content:'blind overwrite'}),error=>error.code==='FS_NOT_OBSERVED')
 const read=await f.run('read',{path,offset:2,limit:1});assert.match(read.content[0].text,/second/)
 const result=await f.run('edit',{path,edits:[{oldText:'"hello"',newText:'HELLO'},{oldText:'third',newText:'THIRD'}]})
 assert.equal(await readFile(path,'utf8'),'HELLO\nsecond\nTHIRD\n');assert.ok(result.details.patch);assert.ok(!JSON.stringify(result).includes('.pi-file-op-'))
 const nested=join(f.root,'new','nested.txt');await f.run('write',{path:nested,content:'created via Pi operations'});assert.equal(await readFile(nested,'utf8'),'created via Pi operations')
})
test('Night CAS spans official edit read/computation/write and aliases; private/symlink/readonly denials survive',async t=>{
 const f=await fixture(t),path=join(f.root,'cas.txt');await writeFile(path,'original');await f.run('read',{path})
 await writeFile(path,'external');await assert.rejects(f.run('edit',{path,edits:[{oldText:'original',newText:'bad'}]}),/FS_STALE_VERSION/);assert.equal(await readFile(path,'utf8'),'external')
 await f.run('read',{path});const alias=join(f.root,'alias.txt');await symlink(path,alias)
 const results=await Promise.allSettled(['one','two'].map(content=>f.run('write',{path:content==='one'?path:alias,content})))
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1)
 const secret=join(f.ctx.runtimePaths.memory,'private-probe.txt');await writeFile(secret,'PRIVATE_TEST_MARKER');await assert.rejects(f.run('read',{path:secret}),error=>error.code==='FS_SANDBOX_DENIED')
 const escape=join(f.root,'private-link');await symlink(secret,escape);await assert.rejects(f.run('read',{path:escape}),error=>error.code==='FS_SANDBOX_DENIED')
 f.setMode('read-only');await assert.rejects(f.run('write',{path:join(f.root,'blocked.txt'),content:'blocked'}),error=>error.code==='FS_SANDBOX_DENIED')
})
test('opaque operation names keep Pi internal Node access probes away from authorized file paths',async t=>{
 const f=await fixture(t),path=join(f.root,'actual-sensitive-file.txt');await writeFile(path,'safe authorized bytes')
 const original=fsPromises.access,probes=[];fsPromises.access=async function(path,...args){probes.push(String(path));return original.call(this,path,...args)};syncBuiltinESMExports()
 try{await f.run('read',{path})}finally{fsPromises.access=original;syncBuiltinESMExports()}
 assert.ok(probes.length);assert.ok(probes.every(probe=>probe.startsWith(join(f.root,'.pi-file-op-'))));assert.ok(!probes.includes(path))
})
test('image bytes use the same verified source snapshot and existing attachment limits/type policy',async t=>{
 const f=await fixture(t),path=join(f.root,'image.png'),png=await sharp({create:{width:2,height:2,channels:4,background:'#168ddd'}}).png().toBuffer();await writeFile(path,png)
 const result=await f.run('read',{path});assert.equal(result.content.find(block=>block.type==='image').mimeType,'image/png');assert.ok(f.charges[0].attachment)
 const target=await f.ctx.fs.resolve(path,{cwd:f.root}),info=await f.ctx.fs.stat(target);assert.equal(f.observations.at(-1).version,info.version)
 const mismatched=join(f.root,'wrong.jpg');await writeFile(mismatched,png);await assert.rejects(f.run('read',{path:mismatched}),error=>error.code==='IMAGE_TYPE_MISMATCH')
 f.ctx.fs.internals.inspectReadBytesAfterStat=async()=>{await writeFile(path,Buffer.concat([png,Buffer.from('changed')]))}
 await assert.rejects(f.run('read',{path}),error=>error.code==='FS_STALE_VERSION');f.ctx.fs.internals.inspectReadBytesAfterStat=undefined
})
test('whole-buffer source cap fails explicitly and a growing file cannot escape bounded reads',async t=>{
 const f=await fixture(t,{maxInputBytes:128}),path=join(f.root,'large.txt');await writeFile(path,'a'.repeat(129));await assert.rejects(f.run('read',{path,offset:100,limit:1}),error=>error.code==='PI_FILE_USE_READ_WINDOW')
 await writeFile(path,'short');f.ctx.fs.internals.inspectReadBytesAfterStat=async()=>{await writeFile(path,'b'.repeat(300))}
 await assert.rejects(f.run('read',{path}),error=>error.code==='FS_TOO_LARGE');f.ctx.fs.internals.inspectReadBytesAfterStat=undefined
})
test('read cancellation joins outstanding capability IO despite official read early rejection',async t=>{
 const f=await fixture(t),path=join(f.root,'cancel.txt');await writeFile(path,'content');const original=f.ctx.fs.readBytes.bind(f.ctx.fs),entered=Promise.withResolvers(),release=Promise.withResolvers(),controller=new AbortController();t.after(()=>release.resolve())
 f.ctx.fs.readBytes=async(...args)=>{entered.resolve();await release.promise;return original(...args)}
 let ended=false;const running=f.run('read',{path},controller.signal).finally(()=>{ended=true});const rejected=assert.rejects(running,/abort/i);await entered.promise;controller.abort();await setImmediate();assert.equal(ended,false);release.resolve();await rejected;f.ctx.fs.readBytes=original
})

test('registered private spill access is honored and unregistered neighboring process output stays private',async t=>{
 const f=await fixture(t),directory=f.ctx.runtimePaths.processSpills;await mkdir(directory,{recursive:true});const owned=join(directory,'owned.txt'),other=join(directory,'unregistered.txt');await writeFile(owned,'AUTHORIZED_SPILL');await writeFile(other,'PRIVATE_SPILL')
 const done=Promise.withResolvers();f.ctx.memoryPrivacy.spills.track(f.actor,{done:done.promise,collected:{stdout:{readFrom:()=>({spillPath:owned})}}})
 try{const result=await f.run('read',{path:owned});assert.match(result.content[0].text,/AUTHORIZED_SPILL/);await assert.rejects(f.run('read',{path:other}),error=>error.code==='FS_SANDBOX_DENIED')}finally{done.resolve()}
})
for(const kind of ['write','edit'])test(kind+' cancellation joins capability mutation before returning or releasing the official queue',async t=>{
 const f=await fixture(t),path=join(f.root,'cancel-'+kind+'.txt');if(kind==='edit'){await writeFile(path,'original');await f.run('read',{path})}
 const original=f.ctx.fs.writeText.bind(f.ctx.fs),entered=Promise.withResolvers(),release=Promise.withResolvers(),controller=new AbortController();let calls=0
 t.after(()=>release.resolve());f.ctx.fs.writeText=async(...args)=>{if(++calls===1){entered.resolve();await release.promise}return original(...args)}
 const args=kind==='edit'?{path,edits:[{oldText:'original',newText:'must not commit'}]}:{path,content:'must not commit'}
 let ended=false;const running=f.run(kind,args,controller.signal).finally(()=>{ended=true}),rejected=assert.rejects(running,/abort/i);await entered.promise;controller.abort();await setImmediate();assert.equal(ended,false)
 const second=f.run('write',{path,content:'second mutation'});await setImmediate();assert.equal(calls,1,'same-target official mutation queue is still held')
 release.resolve();await rejected;await second;f.ctx.fs.writeText=original;assert.equal(await readFile(path,'utf8'),'second mutation')
})

test('Night text policy rejects invalid UTF-8/binary and Pi edit preserves BOM and CRLF',async t=>{
 const f=await fixture(t),path=join(f.root,'text-policy.txt');await writeFile(path,Buffer.from([0xff,0xfe,0x61]));await assert.rejects(f.run('read',{path}),error=>error.code==='FS_INVALID_UTF8')
 await writeFile(path,Buffer.from([0x61,0,0x62]));await assert.rejects(f.run('read',{path}),error=>error.code==='FS_NOT_TEXT')
 await writeFile(path,'\uFEFFone\r\ntwo\r\n');await f.run('read',{path});await f.run('edit',{path,edits:[{oldText:'one',newText:'ONE'}]});assert.equal(await readFile(path,'utf8'),'\uFEFFONE\r\ntwo\r\n')
})

test('standing permission is sampled again after Pi edit computation instead of borrowing an earlier writable mode',async t=>{
 const f=await fixture(t),path=join(f.root,'permission-race.txt');await writeFile(path,'original');await f.run('read',{path});const original=f.ctx.fs.readBytes.bind(f.ctx.fs)
 f.ctx.fs.readBytes=async(...args)=>{const bytes=await original(...args);f.setMode('read-only');return bytes}
 try{await assert.rejects(f.run('edit',{path,edits:[{oldText:'original',newText:'blocked'}]}),error=>error.code==='FS_SANDBOX_DENIED')}finally{f.ctx.fs.readBytes=original}
 assert.equal(await readFile(path,'utf8'),'original')
})

test('independent read_window streams oversized files, returns honest continuation and never uses full-buffer read',async t=>{
 const f=await fixture(t,{sourceConfig:{maxBufferedBytes:128}}),path=join(f.root,'window.txt');await writeFile(path,Array.from({length:10000},(_,index)=>'line-'+(index+1)).join('\n'))
 await assert.rejects(f.run('read',{path}),error=>error.code==='PI_FILE_USE_READ_WINDOW')
 const original=f.ctx.fs.readBytes;f.ctx.fs.readBytes=()=>{throw Error('window must not read a complete Buffer')}
 try{
  const result=await f.run('read_window',{path,offset:500,limit:3});assert.deepEqual(result.structuredContent.lines.map(item=>item.text),['line-500','line-501','line-502']);assert.equal(result.structuredContent.nextOffset,503);assert.equal(result.structuredContent.hasMore,true);assert.match(result.content[0].text,/continue with offset=503/)
  const tail=await f.run('read_window',{path,offset:9999,limit:5});assert.deepEqual(tail.structuredContent.lines.map(item=>item.text),['line-9999','line-10000']);assert.equal(tail.structuredContent.hasMore,false);assert.equal(tail.structuredContent.nextOffset,undefined)
 }finally{f.ctx.fs.readBytes=original}
})
test('window bounds UTF-16 line previews, output bytes, scan work and file size without invented full-file content',async t=>{
 const f=await fixture(t,{sourceConfig:{windowMaxLines:10,windowMaxLineCharacters:5,windowMaxBytes:256,windowMaxScanBytes:1000000}}),path=join(f.root,'long-lines.txt');await writeFile(path,'a'.repeat(100000)+'\r\n世界😀xyz\r\ntail')
 const result=await f.run('read_window',{path,offset:1,limit:2});assert.equal(result.structuredContent.lines[0].text,'aaaaa');assert.equal(result.structuredContent.lines[0].truncated,true);assert.equal(result.structuredContent.lines[1].text,'世界😀x');assert.equal(result.structuredContent.lines[1].truncated,true);assert.ok(Buffer.byteLength(result.content[0].text)<=256);assert.equal(result.structuredContent.nextOffset,3)
 const scan=await fixture(t,{sourceConfig:{windowMaxScanBytes:16}});const scanPath=join(scan.root,'scan.txt');await writeFile(scanPath,'large enough to exceed scan budget');await assert.rejects(scan.run('read_window',{path:scanPath}),error=>error.code==='PI_FILE_WINDOW_SCAN_LIMIT')
 const size=await fixture(t,{sourceConfig:{windowMaxFileBytes:16}});const sizePath=join(size.root,'size.txt');await writeFile(sizePath,'large enough to exceed file size');await assert.rejects(size.run('read_window',{path:sizePath}),error=>error.code==='PI_FILE_WINDOW_SIZE_LIMIT')
})
test('window closes and joins the actual stream on success/cancel and refuses changed source observations',async t=>{
 const f=await fixture(t),path=join(f.root,'window-life.txt');await writeFile(path,'one\ntwo\nthree')
 const original=f.ctx.fs.streamText.bind(f.ctx.fs),closed=Promise.withResolvers();let finalized=false
 f.ctx.fs.streamText=async()=>({async *[Symbol.asyncIterator](){try{yield 'one\ntwo\n'}finally{await setImmediate();finalized=true;closed.resolve()}}})
 await f.run('read_window',{path,limit:1});assert.equal(finalized,true)
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),controller=new AbortController();t.after(()=>release.resolve());finalized=false
 f.ctx.fs.streamText=async()=>({async *[Symbol.asyncIterator](){try{entered.resolve();await release.promise;yield 'one'}finally{await setImmediate();finalized=true}}})
 let ended=false;const running=f.run('read_window',{path},controller.signal).finally(()=>{ended=true}),rejected=assert.rejects(running,/abort/i);await entered.promise;controller.abort();await setImmediate();assert.equal(ended,false);release.resolve();await rejected;assert.equal(finalized,true)
 f.ctx.fs.streamText=async()=>({async *[Symbol.asyncIterator](){yield 'one\n';await writeFile(path,'externally changed')}})
 await assert.rejects(f.run('read_window',{path,limit:4}),error=>error.code==='FS_STALE_VERSION');f.ctx.fs.streamText=original
})
test('new tools enforce strict raw arguments, native path names and required external budgets',async t=>{
 const f=await fixture(t),path=join(f.root,'strict.txt');assert.equal(f.bundle.capabilities.ready,true)
 for(const args of [{file_path:path},{path,offset:'2'},{path,offset:1.5},{path,actorId:'forged'}])assert.throws(()=>f.tools.read.prepareArguments(args),error=>error.code==='PI_FILE_ARGUMENTS_INVALID')
 assert.throws(()=>f.tools.edit.prepareArguments({path,edits:'[{"oldText":"a","newText":"b"}]'}),error=>error.code==='PI_FILE_ARGUMENTS_INVALID')
 let getter=0;const captured=f.tools.read.prepareArguments({get path(){getter++;return path}});assert.equal(getter,1);assert.equal(captured.path,path);assert.equal(Object.isFrozen(captured),true)
 const missing=await fixture(t,{transportBudget:null});assert.equal(missing.bundle.capabilities.ready,false);await assert.rejects(missing.run('write',{path:join(missing.root,'blocked.txt'),content:'blocked'}),error=>error.code==='PI_FILE_TRANSPORT_BUDGET_REQUIRED')
 const noImages=await fixture(t,{imageBudget:null});assert.equal(noImages.bundle.capabilities.ready,false);await assert.rejects(noImages.run('read_image',{path:'image.png'}),error=>error.code==='PI_FILE_IMAGE_BUDGET_REQUIRED')
})
test('current official SDK model and aggregate image quota gate native image outputs',async t=>{
 let count=0
 const f=await fixture(t,{imageBudget:{accept:async()=>++count<=1}}),path=join(f.root,'image-quota.png'),png=await sharp({create:{width:2,height:2,channels:4,background:'#888'}}).png().toBuffer();await writeFile(path,png)
 await f.run('read_image',{path});await assert.rejects(f.run('read_image',{path}),error=>error.code==='PI_FILE_IMAGE_AGGREGATE_LIMIT')
 const selected=f.actor.piSession.model;await f.actor.piSession.setModel({...selected,input:['text']});await assert.rejects(f.run('read_image',{path}),error=>error.code==='PI_FILE_MODEL_IMAGE_UNSUPPORTED')
})
test('explicit escalation uses actual NativeApproval once and never turns into a standing permission grant',async t=>{
 const f=await fixture(t),{bindApprovalAudit}=await import('../src/native-approval.js'),entries=[],entered=Promise.withResolvers(),release=Promise.withResolvers();let flushes=0,outcome='allowed-once';f.setMode('read-only');t.after(()=>release.resolve())
 const unbind=bindApprovalAudit(f.actor,{isLive:()=>f.ctx.agents.get(f.actor.id)===f.actor,isTurnOpen:()=>true,approvalPolicy:()=> 'ask',append:(type,data)=>entries.push({type,data}),async flush(){if(++flushes===1){entered.resolve();await release.promise}}});t.after(unbind)
 f.ctx.on('approval/request',()=>outcome)
 const path=join(f.root,'approved.txt'),pending=f.run('write',{path,content:'one approved operation',sandbox_permissions:'workspace-write',justification:'Create this requested workspace file.'});await entered.promise;await assert.rejects(readFile(path),{code:'ENOENT'});release.resolve();await pending
 assert.equal(await readFile(path,'utf8'),'one approved operation');assert.deepEqual(entries.map(item=>item.type),['approval/asked','approval/decided'])
 await assert.rejects(f.run('write',{path:join(f.root,'not-approved.txt'),content:'denied'}),error=>error.code==='FS_SANDBOX_DENIED')
 outcome='rejected';await assert.rejects(f.run('write',{path:join(f.root,'rejected.txt'),content:'denied',sandbox_permissions:'workspace-write',justification:'Request another one-time write.'}),/rejected/)
})
test('post-effect result refusal reports committed uncertainty; module close joins active operations',async t=>{
 const f=await fixture(t,{transportBudget:{accept:async()=>false}}),path=join(f.root,'committed.txt');await assert.rejects(f.run('write',{path,content:'effect happened'}),error=>error.code==='PI_FILE_EFFECT_COMMITTED_RESULT_FAILED'&&error.committed===true);assert.equal(await readFile(path,'utf8'),'effect happened')
 const active=await fixture(t),activePath=join(active.root,'close.txt');await writeFile(activePath,'data');const original=active.ctx.fs.readBytes.bind(active.ctx.fs),entered=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());active.ctx.fs.readBytes=async(...args)=>{entered.resolve();await release.promise;return original(...args)}
 const running=active.run('read',{path:activePath}),rejected=assert.rejects(running,/abort|closed/i);await entered.promise;let closed=false;const closing=active.bundle.close().then(()=>{closed=true});await setImmediate();assert.equal(closed,false);release.resolve();await rejected;await closing
 assert.throws(()=>active.tools.read.execute('late',{path:activePath}),error=>error.code==='PI_FILE_TOOLS_CLOSED');active.ctx.fs.readBytes=original
})

test('actual official AgentSession executes the new public Pi tools and the independent window using native params',async t=>{
 const f=await fixture(t),path=join(f.root,'sdk.txt');await writeFile(path,'first\nsecond\nthird');const {runtime,model,loader,settings,agentDir}=f.sdk;let phase=0
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
 runtime.registerProvider(model.provider,{api:model.api,streamSimple(){const stream=createAssistantMessageEventStream(),plans=[{name:'read',arguments:{path}},{name:'edit',arguments:{path,edits:[{oldText:'second',newText:'SECOND'}]}},{name:'read_window',arguments:{path,offset:2,limit:1}}],plan=plans[phase++],message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:1,usage,stopReason:plan?'toolUse':'stop',content:plan?[{type:'toolCall',id:'new-file-tool-'+phase,...plan}]:[{type:'text',text:'files verified'}]};queueMicrotask(()=>{stream.push({type:'done',reason:message.stopReason,message});stream.end(message)});return stream}})
 f.actor.piSession.dispose()
 const {session}=await createAgentSession({cwd:f.root,agentDir,modelRuntime:runtime,model,resourceLoader:loader,settingsManager:settings,sessionManager:SessionManager.inMemory(f.root,{id:f.actor.id}),noTools:'builtin',customTools:f.bundle.tools,tools:f.bundle.tools.map(tool=>tool.name)})
 f.actor.piSession=session;t.after(()=>session.dispose())
 await session.prompt('Read, edit and inspect the authorized file')
 assert.equal(await readFile(path,'utf8'),'first\nSECOND\nthird');assert.equal(session.messages.filter(message=>message.role==='toolResult').length,3);assert.ok(session.messages.filter(message=>message.role==='toolResult').every(message=>message.isError!==true));assert.equal(session.getLastAssistantText(),'files verified')
})
test('window output-full EOF returns an honest continuation for the final unreturned line',async t=>{
 const f=await fixture(t,{sourceConfig:{windowMaxLines:10,windowMaxLineCharacters:5,windowMaxBytes:256}}),path=join(f.root,'full-eof.txt');await writeFile(path,Array(5).fill('abcdef').join('\n'))
 const result=await f.run('read_window',{path,limit:10});assert.equal(result.structuredContent.hasMore,true);assert.equal(result.structuredContent.nextOffset,result.structuredContent.lines.at(-1).line+1)
 const final=await f.run('read_window',{path,offset:result.structuredContent.nextOffset,limit:1});assert.equal(final.structuredContent.hasMore,false);assert.equal(final.structuredContent.lines[0].line,5)
})

test('an actual SDK model change during asynchronous result accounting refuses the image before observation',async t=>{
 let f
 f=await fixture(t,{transportBudget:{accept:async()=>{const current=f.actor.piSession.model;await f.actor.piSession.setModel({...current,input:['text']});return true}}})
 const path=join(f.root,'model-race.png');await writeFile(path,await sharp({create:{width:2,height:2,channels:4,background:'#777'}}).png().toBuffer())
 await assert.rejects(f.run('read_image',{path}),error=>error.code==='PI_FILE_MODEL_CHANGED');assert.equal(f.observations.length,0)
})
