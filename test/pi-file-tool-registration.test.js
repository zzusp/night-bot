import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import sharp from 'sharp'
import PrivateFileSystem from '../src/memory/private-fs.js'
import {memoryHost} from './fixtures/memory-host.js'
import {registerPiFileTools,preflightPiFileMutation} from '../src/pi-file-tool-registration.js'
import {createPiFileToolBudgets} from '../src/runtime/pi-file-tool-budgets.js'
const waitAbort=signal=>signal.aborted?Promise.resolve():new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))
// Actual factory accounting ports with trace-only wrappers. This test selects
// the registration explicitly; it does not claim default Host installation.
function accounting(){let actor,actual;const calls=[];return {calls,imageBudget:{async accept(value){assert.equal(value.actor,actor);return actual.imageBudget.accept(value)}},transportBudget:{async accept(value){assert.equal(value.actor,actor);calls.push(value);return actual.transportBudget.accept(value)}},bind(value){actor=value;actual=createPiFileToolBudgets({actor})},close(){actual?.close()}}}
async function fixture(t,respond,{timeoutMs,configure,beforeRegister,serviceFactory,onlyMissing=false,nestedScope=false,ports=accounting()}={}){
 const f=await memoryHost(t,respond),ctx=f.host.ctx,root=join(ctx.runtimePaths.workspaces,'registered-files');await mkdir(root)
 const globalBefore=ctx.get('tools').get('read');let registration,actor
 const handle=await ctx.agents.create({sessionId:'pi-files-registered',meta:{cwd:root,agentPreset:'night-bot'},agentOptions:f.config.model,authorizeInput:packet=>packet.source.kind==='user',setup:async(agentCtx,owner)=>{actor=owner;await ctx.get('agentPresets').mount(agentCtx,'night-bot');ports.bind(owner);await beforeRegister?.(agentCtx,owner);const services=await serviceFactory?.(agentCtx,owner);registration=registerPiFileTools({ctx:nestedScope?agentCtx.extend():agentCtx,actor:owner,services,onlyMissing,imageBudget:ports.imageBudget,transportBudget:ports.transportBudget,timeoutMs});await configure?.(agentCtx,owner,registration)}})
 t.after(async()=>{await handle.dispose();await registration.close();ports.close()})
 return {f,ctx,root,actor,handle,registration,ports,globalBefore,async start(){await handle.enqueue({id:'registered-file-input',source:{kind:'user'},content:[{type:'text',text:'Use the official file capabilities within the scoped workspace'}]});return handle.deliver('registered-file-input',{deliverAs:'steer'})},async history(){return (await ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})).entries}}
}
test('actor-scoped registration executes real SDK read/multi-edit/write/window through the NativeTools business pipeline',{timeout:15000},async t=>{
 const plan=[{tool:'read',args:{path:'source.txt'}},{tool:'edit',args:{path:'source.txt',edits:[{oldText:'hello',newText:'HELLO'},{oldText:'last',newText:'LAST'}]}},{tool:'write',args:{path:'created.txt',content:'new file'}},{tool:'read_window',args:{path:'source.txt',offset:1,limit:3}}]
 let n=0;const seen=[],executions=[],observations=[],accepted=[]
 const f=await fixture(t,()=>n<plan.length?plan[n++]:{text:'complete'},{nestedScope:true,configure(ctx){ctx.on('tools/execute',async(exec,next)=>{seen.push(exec.name);executions.push(exec);return next()});ctx.on('fs/observed',(target,observation,exec)=>observations.push({target,observation,exec}));ctx.on('tools/post-execute',async(exec,result,next)=>{accepted.push({exec,result});return next()})}})
 await writeFile(join(f.root,'source.txt'),'hello\nlast\n');assert.equal(f.ctx.get('tools').get('read'),f.globalBefore,'the global registration is not changed by this scoped slice')
 assert.ok(f.ctx.get('tools').get('read',f.actor).parameters.properties.path);assert.equal(f.registration.capabilities.readyForHost,false)
 await f.start();await f.handle.whenIdle()
 assert.equal(await readFile(join(f.root,'source.txt'),'utf8'),'HELLO\nLAST\n');assert.equal(await readFile(join(f.root,'created.txt'),'utf8'),'new file');assert.deepEqual(seen,['read','edit','write','read_window']);assert.equal(f.ports.calls.length,4);assert.equal(observations.length,4);assert.deepEqual(observations.map(row=>row.exec),executions);assert.deepEqual(accepted.map(row=>row.exec),executions);assert.equal(accepted.every(row=>!('content' in row.result.value)&&Array.isArray(row.result.content)),true)
 const entries=await f.history(),results=entries.filter(e=>e.type==='message'&&e.message.role==='toolResult').map(e=>e.message)
 assert.equal(results.length,4);assert.equal(results.every(result=>result.isError===false),true);assert.ok(results[1].details.nativeResult.value.details.patch);assert.equal(results[3].details.nativeResult.value.structuredContent.hasMore,false)
 assert.equal(f.ctx.get('tools').executionMode({name:'read',agent:f.actor,arguments:{path:'source.txt'}}).kind,'parallel');assert.equal(f.ctx.get('tools').executionMode({name:'write',agent:f.actor,arguments:{path:'new',content:'x'}}).kind,'exclusive')
})
test('exact definition and native execution admission reject direct calls, foreign owners and private mutations before effect middleware',{timeout:15000},async t=>{
 let n=0,started=0;let file
 const f=await fixture(t,()=>n++===0?{tool:'write',args:{path:file,content:'must not write'}}:{text:'denied'},{configure(ctx){ctx.on('tools/execute',async(exec,next)=>{if(exec.name==='write')started++;return next()})}});file=join(f.ctx.runtimePaths.memory,'denied.txt')
 const definition=f.registration.definitions.find(tool=>tool.name==='write'),exec={agent:f.actor,name:'write',callId:'forged',arguments:{path:'forged',content:'x'},signal:new AbortController().signal}
 await assert.rejects(definition.execute(exec.arguments,exec),{code:'PI_FILE_NATIVE_EXECUTION_REQUIRED'})
 await assert.rejects(preflightPiFileMutation({...exec,agent:{id:f.actor.id}},definition),{code:'PI_FILE_DEFINITION_REQUIRED'})
 await preflightPiFileMutation(exec,{name:'write'})
 await f.start();await f.handle.whenIdle();assert.equal(started,0);await assert.rejects(stat(file),{code:'ENOENT'});assert.equal((await f.history()).find(e=>e.type==='message'&&e.message.role==='toolResult').message.details.nativeResult.error.message,'PERMISSION_PRIVATE_PATH_DENIED')
})
test('existing NativeTools guard prevents a registered Pi mutation body and effect middleware',{timeout:15000},async t=>{
 let n=0,started=0
 const f=await fixture(t,()=>n++===0?{tool:'write',args:{path:'guarded.txt',content:'denied'}}:{text:'observed denial'},{configure(ctx){ctx.get('tools').guard(exec=>exec.name==='write'?'REGISTERED_GUARD_DENIED':undefined);ctx.on('tools/execute',async(exec,next)=>{started++;return next()})}})
 await f.start();await f.handle.whenIdle();assert.equal(started,0);assert.equal(f.ports.calls.length,0);await assert.rejects(stat(join(f.root,'guarded.txt')),{code:'ENOENT'});assert.match(JSON.stringify(f.f.requests),/REGISTERED_GUARD_DENIED/)
})
test('declared NativeTools timeout waits for the actual Pi mutation result path to drain before SDK continuation',{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),ports=accounting();let signal,exited=false,n=0
 t.after(()=>release.resolve())
 const account=ports.transportBudget
 ports.transportBudget={async accept(value){const accepted=await account.accept(value);signal=value.signal;entered.resolve();await release.promise;exited=true;return accepted}}
 // This case measures cancellation after an actual committed mutation. Give
 // filesystem admission a real scheduling window under concurrent suite load;
 // the budget itself still expires while the accepted result body is held.
 const f=await fixture(t,()=>n++===0?{tool:'write',args:{path:'timeout.txt',content:'one committed write'}}:{text:'timeout drained'},{timeoutMs:1000,ports})
 const running=f.start();await Promise.race([entered.promise,running.then(()=>{throw Error('SDK completed before the committed-result barrier; timeout occurred before this fixture phase')})]);await waitAbort(signal)
 assert.equal(await readFile(join(f.root,'timeout.txt'),'utf8'),'one committed write');assert.equal(exited,false);assert.equal(f.f.requests.length,1);assert.equal((await f.history()).filter(e=>e.type==='message'&&e.message.role==='toolResult').length,0)
 release.resolve();await running;await f.handle.whenIdle();assert.equal(exited,true);assert.equal(f.f.requests.length,2);assert.equal(await readFile(join(f.root,'timeout.txt'),'utf8'),'one committed write')
 const result=(await f.history()).find(e=>e.type==='message'&&e.message.role==='toolResult').message;assert.equal(result.isError,true);assert.equal(result.details.nativeResult.error.info.code,'TOOL_TIMEOUT')
})
test('a declared timeout before body admission never enters file result accounting',{timeout:15000},async t=>{
 let n=0
 const f=await fixture(t,()=>n++===0?{tool:'write',args:{path:'not-started.txt',content:'must not write'}}:{text:'pre-body timeout observed'},{timeoutMs:20,configure(ctx){ctx.on('tools/execute',async(exec,next)=>{if(exec.name==='write')await new Promise(resolve=>setTimeout(resolve,60));return next()})}})
 await f.start();await f.handle.whenIdle();assert.equal(f.ports.calls.length,0);await assert.rejects(stat(join(f.root,'not-started.txt')),{code:'ENOENT'})
 const result=(await f.history()).find(e=>e.type==='message'&&e.message.role==='toolResult').message;assert.equal(result.isError,true);assert.equal(result.details.nativeResult.error.info.code,'TOOL_TIMEOUT');assert.equal(f.f.requests.length,2)
})
test('scoped registration close aborts and joins accepted result accounting before returning',{timeout:15000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers(),ports=accounting();let n=0,signal,exited=false
 t.after(()=>release.resolve())
 const account=ports.transportBudget
 ports.transportBudget={async accept(value){const accepted=await account.accept(value);signal=value.signal;entered.resolve();await release.promise;exited=true;return accepted}}
 const f=await fixture(t,()=>n++===0?{tool:'write',args:{path:'closing.txt',content:'committed once'}}:{text:'closed body joined'},{ports})
 const running=f.start();await entered.promise;let closed=false;const closing=f.registration.close().then(()=>closed=true)
 await waitAbort(signal);await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);assert.equal(exited,false);assert.equal(f.f.requests.length,1)
 release.resolve();await closing;await running;await f.handle.whenIdle();assert.equal(closed,true);assert.equal(exited,true);assert.equal(await readFile(join(f.root,'closing.txt'),'utf8'),'committed once')
 const result=(await f.history()).find(e=>e.type==='message'&&e.message.role==='toolResult').message;assert.equal(result.isError,true);assert.match(result.content[0].text,/committed but result delivery failed/)
})

test('actual SDK image content is projected once from the real exec while business values contain metadata only',{timeout:15000},async t=>{
 let n=0;const f=await fixture(t,()=>n++===0?{tool:'read_image',args:{path:'image.png'}}:{text:'image received'})
 await f.handle.session.setModel({...f.handle.session.model,input:['text','image']})
 await writeFile(join(f.root,'image.png'),await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer())
 await f.start();await f.handle.whenIdle()
 const result=(await f.history()).find(e=>e.type==='message'&&e.message.role==='toolResult').message
 assert.equal(result.isError,false);const image=result.content.find(block=>block.type==='image');assert.ok(image?.data)
 const value=result.details.nativeResult.value;assert.equal('content' in value,false);assert.equal(value.images.length,1);assert.equal(value.images[0].mimeType,'image/png');assert.equal(value.images[0].bytes,Buffer.from(image.data,'base64').byteLength);assert.equal(JSON.stringify(value).includes(image.data),false,JSON.stringify(value));assert.equal(f.ports.calls.length,1)
})

test('explicit trusted service capabilities use the selected real isolated PrivateFileSystem instance',{timeout:15000},async t=>{
 let reads=0,writes=0,selected,ordinary,n=0
 class SelectedFileSystem extends PrivateFileSystem {static inject=['sandboxPolicy','memoryPrivacy'];async readBytes(...args){reads++;return super.readBytes(...args)}async writeText(...args){writes++;return super.writeText(...args)}}
 const f=await fixture(t,()=>n++===0?{tool:'read',args:{path:'selected.txt'}}:n===2?{tool:'write',args:{path:'selected-new.txt',content:'selected instance write'}}:{text:'selected capabilities completed'},{async serviceFactory(ctx,owner){ordinary=ctx.get('fs');const isolated=ctx.root.isolate('fs');selected=new SelectedFileSystem(isolated,{cwd:owner.metadata.cwd,diffBasisMaxBytes:1048576});assert.notEqual(selected,ordinary);return {fs:selected}}})
 await writeFile(join(f.root,'selected.txt'),'selected instance read');await f.start();await f.handle.whenIdle()
 const outcomes=(await f.history()).filter(e=>e.type==='message'&&e.message.role==='toolResult').map(e=>e.message);assert.equal(outcomes.every(row=>!row.isError),true,JSON.stringify(outcomes.map(row=>row.content)));assert.equal(reads,1);assert.equal(writes,1);assert.equal(await readFile(join(f.root,'selected-new.txt'),'utf8'),'selected instance write');assert.equal(f.ports.calls.length,2)
})
test('onlyMissing preserves trusted custom tools and does not certify same-name definitions by name',{timeout:15000},async t=>{
 let custom,n=0,customCalls=0
 const f=await fixture(t,()=>n++===0?{tool:'read',args:{path:'custom-reference'}}:n===2?{tool:'write',args:{path:'installed.txt',content:'missing tool installed'}}:{text:'custom preserved'},{onlyMissing:true,beforeRegister(ctx){custom={name:'read',description:'Trusted custom reader',parameters:{type:'object',required:['path'],properties:{path:{type:'string'}},additionalProperties:false},output:{schema:{type:'object'},render:()=>[{type:'text',text:'custom read'}]},async execute(){customCalls++;return {custom:true}}};ctx.get('tools').register(custom)}})
 assert.equal(f.ctx.get('tools').get('read',f.actor),custom);assert.equal(f.registration.definitions.some(definition=>definition.name==='read'),false);assert.equal(f.registration.definitions.length,4)
 await preflightPiFileMutation({agent:f.actor,name:'read',callId:'not-native',arguments:{path:'unrelated'},signal:new AbortController().signal},custom)
 await f.start();await f.handle.whenIdle();assert.equal(customCalls,1);assert.equal(await readFile(join(f.root,'installed.txt'),'utf8'),'missing tool installed')
})

test('registered readonly write uses one exact allowed-once approval without granting the next invocation',{timeout:15000},async t=>{
 let step=0,prompts=0,intents=0
 const f=await fixture(t,()=>step++===0?{tool:'write',args:{path:'approved-once.txt',content:'one approved effect',sandbox_permissions:'workspace-write',justification:'Approve only this exact local fixture write'}}:step===2?{tool:'write',args:{path:'no-standing-grant.txt',content:'must not write'}}:{text:'One grant was consumed; readonly remains effective'},{async configure(ctx,actor,registration){
  await ctx.get('permissionPresets').set(actor,'read-only');ctx.get('approval').setPolicy(actor,'ask');assert.equal(ctx.get('approval').policyForActor(actor),'ask')
  ctx.on('approval/request',req=>{assert.equal(req.agent,actor);assert.equal(req.toolName,'write');prompts++;return'allowed-once'})
  const definition=registration.definitions.find(tool=>tool.name==='write')
  ctx.on('tools/execute',async(exec,next)=>{if(exec.name==='write'){intents++;await preflightPiFileMutation(exec,definition);await preflightPiFileMutation(exec,definition)}return next()})
 }})
 await f.start();await f.handle.whenIdle()
 assert.equal(prompts,1,JSON.stringify((await f.history()).filter(e=>e.type==='message'&&e.message.role==='toolResult').map(e=>({name:e.message.toolName,content:e.message.content}))));assert.equal(intents,1,'Unapproved second write never enters effect middleware');assert.equal(await readFile(join(f.root,'approved-once.txt'),'utf8'),'one approved effect');await assert.rejects(stat(join(f.root,'no-standing-grant.txt')),{code:'ENOENT'});assert.equal(f.actor.ctx.get('permissionPresets').permissionState(f.actor).sandbox,'read-only')
 const outcomes=(await f.history()).filter(entry=>entry.type==='message'&&entry.message.role==='toolResult').map(entry=>entry.message);assert.equal(outcomes.length,2);assert.equal(outcomes[0].isError,false,JSON.stringify(outcomes[0].content));assert.equal(outcomes[1].isError,true);assert.equal(outcomes[1].details.nativeResult.error.info.code,'FS_SANDBOX_DENIED')
})

test('registered private-path escalation is refused before asking an approval answerer',{timeout:15000},async t=>{
 let step=0,prompts=0,intents=0,path
 const f=await fixture(t,()=>step++===0?{tool:'write',args:{path,content:'must never write',sandbox_permissions:'danger-full-access',justification:'Even an escalation cannot authorize private storage'}}:{text:'Private path refused without prompting'},{async configure(ctx,actor){await ctx.get('permissionPresets').set(actor,'read-only');ctx.get('approval').setPolicy(actor,'ask');assert.equal(ctx.get('approval').policyForActor(actor),'ask');ctx.on('approval/request',()=>{prompts++;return'allowed-once'});ctx.on('tools/execute',async(exec,next)=>{if(exec.name==='write')intents++;return next()})}})
 path=join(f.ctx.runtimePaths.memory,'escalation-forbidden.txt');await f.start();await f.handle.whenIdle();assert.equal(prompts,0,'A forbidden path must not solicit a meaningless grant');assert.equal(intents,0);await assert.rejects(stat(path),{code:'ENOENT'});assert.equal((await f.history()).find(e=>e.type==='message'&&e.message.role==='toolResult').message.details.nativeResult.error.message,'PERMISSION_PRIVATE_PATH_DENIED');assert.equal(f.actor.ctx.get('permissionPresets').permissionState(f.actor).sandbox,'read-only')
})
