import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,rm,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {Context} from '@deepseek-ai/cordis'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {createHost} from '../src/host.js'
import {backupData,restoreData} from '../src/runtime/backup.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {portablePaths} from '../src/runtime/portable.js'
import PiPersistence from '../src/pi-session-persistence.js'
import {apply as authority} from '../src/pi-authority.js'
import {createNativeBusinessState,nativeBusinessAuditKinds} from '../src/runtime/pi-business-state.js'
import {nativeSessionHeader} from './fixtures/native-session-header.js'
const configuration=installRoot=>({installRoot,model:{provider:'fixture',model:'model'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1',apiKeyEnv:'PORTABLE_FIXTURE_KEY',models:[{id:'model',input:['text'],contextWindow:8192,maxTokens:128}]}},memory:{background:false},reflection:{enabled:false},skillWatch:false,credentialsWatch:false})
const boot=root=>createHost(configuration(root),{environmentOptions:{inherited:{PORTABLE_FIXTURE_KEY:'local-only'}}})
const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}

test('own backup restores actual actor cwd, artifact binding and permissions without changing signed Pi entries or user paths',{timeout:20000},async t=>{
 const root=await mkdtemp('/tmp/night-business-portable-'),sourceRoot=join(root,'source'),targetRoot=join(root,'target')
 let source,target,handle,resumed
 t.after(async()=>{try{await resumed?.dispose();await handle?.dispose();await target?.close();await source?.close()}finally{await rm(root,{recursive:true,force:true})}})
 source=await boot(sourceRoot)
 const sourcePaths=source.ctx.runtimePaths,cwd=join(sourcePaths.workspaces,'tasks','owner'),sub=join(cwd,'work','sub'),outputs=join(cwd,'outputs')
 await mkdir(sub,{recursive:true});await mkdir(outputs,{recursive:true})
 await writeFile(join(sub,'input.txt'),'retained task input');await writeFile(join(outputs,'output.txt'),'retained task output')
 handle=await source.ctx.agents.create({sessionId:'portable-owner',meta:{cwd,agentPreset:'night-bot'},agentOptions:{provider:'fixture',model:'model'},authorizeInput:()=>true})
 const actor=handle.agent
 await actor.ctx.get('permissionPresets').set(actor,'danger-full-access')
 await actor.ctx.get('workingDirectory').set(actor,sub)
 await actor.ctx.get('sandboxPolicy').bindArtifactRoot(actor,{ownerId:'owner',artifactRoot:outputs})
 const message={role:'assistant',api:'openai-completions',provider:'fixture',model:'model',responseId:'opaque-response',content:[{type:'text',text:'original path '+cwd,textSignature:'opaque-signature'}],stopReason:'stop',timestamp:2,usage}
 actor.piSession.sessionManager.appendMessage(message);await actor.receipts.commit()
 const sourceFile=source.ctx.sessionPersistence.path(actor.id);let before=await source.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true})
 assert.ok(before.audit.some(receipt=>receipt.domain==='directory'&&receipt.pathBindings.fields.cwd))
 assert.ok(before.audit.some(receipt=>receipt.domain==='sandbox'&&receipt.pathBindings.fields['artifactRoot.sessionCwd']))
 await handle.dispose();before=await source.ctx.sessionPersistence.readNative(actor.id,{requireComplete:true});await source.close()
 const bytes=await readFile(sourceFile),backup=join(sourceRoot,'backups','current')
 await backupData(configuration(sourceRoot),backup)
 const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));assert.equal(manifest.version,1)
 await restoreData(configuration(targetRoot),backup)
 target=await boot(targetRoot)
 const targetPaths=target.ctx.runtimePaths,targetCwd=join(targetPaths.workspaces,'tasks','owner'),targetSub=join(targetCwd,'work','sub'),targetOutputs=join(targetCwd,'outputs')
 const stored=await target.ctx.sessionPersistence.readNative('portable-owner',{requireComplete:true})
 assert.deepEqual(stored.entries,before.entries);assert.deepEqual(stored.context.projection,before.context.projection)
 assert.deepEqual(await readFile(target.ctx.sessionPersistence.path('portable-owner')),bytes)
 assert.deepEqual(stored.context.piMessages.find(value=>value.role==='assistant'&&value.responseId==='opaque-response'),message)
 resumed=await target.ctx.agents.resume({resumeSessionId:'portable-owner',agentOptions:{provider:'fixture',model:'model'},authorizeInput:()=>true})
 const current=resumed.agent
 assert.equal(await readFile(join(targetSub,'input.txt'),'utf8'),'retained task input');assert.equal(await readFile(join(targetOutputs,'output.txt'),'utf8'),'retained task output')
 assert.equal(current.id,actor.id);assert.equal(current.metadata.cwd,targetCwd)
 assert.equal(current.ctx.get('workingDirectory').get(current),targetSub)
 assert.equal(current.ctx.get('permissionPresets').current(current),'danger-full-access')
 assert.deepEqual(current.ctx.get('sandboxPolicy').resolve({actor:current}),{mode:'danger-full-access',workspaceRoot:targetOutputs,sessionId:current.id})
 assert.throws(()=>current.ctx.get('sandboxPolicy').resolve({actor:{...current}}),{code:'PI_SANDBOX_ACTOR_UNBOUND'})
 const retained=targetOutputs+'.held';await rename(targetOutputs,retained)
 try{assert.throws(()=>current.ctx.get('sandboxPolicy').resolve({actor:current,mode:'danger-full-access'}),{code:'ENOENT'})}finally{await rename(retained,targetOutputs)}
 await current.ctx.get('workingDirectory').set(current,join(targetCwd,'work'))
 const audit=await current.receipts.read(),last=audit.findLast(receipt=>receipt.domain==='directory')
 assert.equal(last.pathBindings.originRoot,targetRoot);assert.equal(last.payload.cwd,join(targetCwd,'work'))
 assert.deepEqual((await target.ctx.sessionPersistence.readNative(current.id,{requireComplete:true})).context.piMessages.find(value=>value.responseId==='opaque-response'),message)
 const {setSandboxMode}=await import('../src/native-policy.js'),{memoryWriteAuthorization}=await import('../src/memory/tools.js')
 await setSandboxMode(current,'read-only')
 assert.equal(current.ctx.get('sandboxPolicy').resolve({actor:current}).mode,'read-only')
 assert.equal(memoryWriteAuthorization(current.ctx)(current),false)
})

test('unmarked current native receipts read at the original root and fail closed after own backup relocation',async t=>{
 const root=await mkdtemp('/tmp/night-unmarked-portable-'),sourceRoot=join(root,'source'),targetRoot=join(root,'target'),config=configuration(sourceRoot),paths=runtimePaths(config)
 const contexts=[];t.after(async()=>{for(const ctx of contexts)await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 await prepareRuntimePaths(paths);const cwd=join(paths.workspaces,'project'),sub=join(cwd,'sub');await mkdir(sub,{recursive:true})
 const codec=portablePaths(paths),manager=SessionManager.inMemory(cwd);manager.newSession({id:'unmarked'})
 manager.appendCustomEntry('night.header',{storage:{engine:'pi-native',version:1},header:codec.header(nativeSessionHeader('unmarked',{cwd}))})
 manager.appendCustomEntry('night.audit',{version:1,domain:'directory',kind:'changed',payload:{cwd:sub,recovered:false}})
 const piHeader=manager.getHeader(),entries=manager.getEntries(),entriesHash=createHash('sha256').update(JSON.stringify(piHeader)+'\n'+entries.map(entry=>JSON.stringify(entry)).join('\n')).digest('hex')
 manager.appendCustomEntry('night.commit',{version:2,entryCount:entries.length,auditCount:1,previousCommit:null,entriesHash})
 const sourceCtx=new Context();contexts.push(sourceCtx);sourceCtx.provide('portablePaths',codec);authority(sourceCtx)
 const source=new PiPersistence(sourceCtx,{root:join(paths.state,'sessions')});await source.checkedRoot(true)
 const bytes=Buffer.from([piHeader,...manager.getEntries()].map(entry=>JSON.stringify(entry)).join('\n')+'\n');await writeFile(source.path('unmarked'),bytes)
 const original=await source.openNative('unmarked',{auditKinds:nativeBusinessAuditKinds});const state=await createNativeBusinessState(original)
 const actor={id:'unmarked',piSession:{}},unbind=state.bindActor(actor,{isLive:()=>true,admitNotice:async()=>{}})
 const {default:Directory}=await import('../src/native-working-directory.js');assert.equal(Directory.prototype.get(actor),sub);unbind();await original.close();await sourceCtx.fiber.dispose()
 const backup=join(sourceRoot,'backups','current');await backupData(config,backup);await restoreData(configuration(targetRoot),backup)
 const targetPaths=runtimePaths(configuration(targetRoot)),ctx=new Context();contexts.push(ctx);ctx.provide('portablePaths',portablePaths(targetPaths));authority(ctx)
 const target=new PiPersistence(ctx,{root:join(targetPaths.state,'sessions')})
 for(const read of [()=>target.readNative('unmarked',{requireComplete:true}),()=>target.openNative('unmarked',{auditKinds:nativeBusinessAuditKinds})])await assert.rejects(read(),{code:'PI_SESSION_PORTABLE_BUSINESS_PATH_UNPROVEN'})
 assert.equal(ctx.piAuthority.describe('unmarked'),undefined);assert.equal(target.writers.size,0)
 assert.deepEqual(await readFile(target.path('unmarked')),bytes)
})

test('Host stamps only registered controlled fields; forged or missing new sidecars cannot commit or publish a broader path',async t=>{
 const root=await mkdtemp('/tmp/night-path-binding-guard-'),paths=runtimePaths({installRoot:root});await prepareRuntimePaths(paths)
 const ctx=new Context();ctx.provide('portablePaths',portablePaths(paths));authority(ctx)
 const backend=new PiPersistence(ctx,{root:join(paths.state,'sessions')}),cwd=join(paths.workspaces,'project');await mkdir(cwd,{recursive:true})
 t.after(async()=>{try{await ctx.fiber.dispose()}finally{await rm(root,{recursive:true,force:true})}})
 const writer=await backend.createNative(nativeSessionHeader('guard',{cwd}),{auditKinds:nativeBusinessAuditKinds});await writer.commit()
 const payload={cwd,recovered:false},forged={version:1,domain:'directory',kind:'changed',payload,pathBindings:{version:1,kind:'install-relative',originRoot:root,fields:{cwd:'data/workspaces/another'}}}
 assert.throws(()=>writer.appendAudit(forged),{code:'PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY'})
 const entryId=writer.appendAudit({version:1,domain:'directory',kind:'changed',payload});await writer.commit()
 const raw=writer.manager.getEntries().find(entry=>entry.id===entryId).data
 assert.equal(raw.payload.cwd,cwd);assert.deepEqual(raw.pathBindings.fields,{cwd:'data/workspaces/project'})
 const bytes=await readFile(backend.path('guard'))
 writer.manager.appendCustomEntry('night.audit',{version:1,domain:'directory',kind:'changed',payload})
 await assert.rejects(writer.commit(),{code:'PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY'})
 assert.deepEqual(await readFile(backend.path('guard')),bytes)
 assert.equal((await backend.readNative('guard',{requireComplete:true})).audit.filter(receipt=>receipt.domain==='directory').length,1)
 await assert.rejects(writer.close(),{code:'PI_SESSION_AUDIT_PATH_BINDING_HOST_ONLY'})
 const text=bytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))
 text.find(entry=>entry.id===entryId).data.pathBindings.fields.cwd='data/workspaces/another'
 const changed=text.map(entry=>JSON.stringify(entry)).join('\n')+'\n';await writeFile(backend.path('guard'),changed)
 await assert.rejects(backend.readNative('guard',{requireComplete:true}),{code:'PI_SESSION_AUDIT_PATH_BINDING_INVALID'})
 assert.equal(await readFile(backend.path('guard'),'utf8'),changed)
})
