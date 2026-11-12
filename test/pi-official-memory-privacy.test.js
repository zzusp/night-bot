import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {memoryHost} from './fixtures/memory-host.js'
import {bindWorkingDirectoryActor} from '../src/native-working-directory.js'
import {bindSandboxPolicyActor} from '../src/native-policy.js'
import {spillAccess} from '../src/runtime/spill-access.js'
async function fixture(t,{mode='workspace-write'}={}){
 const f=await memoryHost(t),ctx=f.host.ctx,root=join(ctx.runtimePaths.workspaces,'tasks','official-private'),other=join(ctx.runtimePaths.workspaces,'tasks','other-private')
 for(const base of [root,other])for(const child of ['work','tmp','sessions','outputs','materials'])await mkdir(join(base,child),{recursive:true})
 const actor={id:'official-private',ctx,piSession:{}},foreign={...actor};let cwd=root
 bindWorkingDirectoryActor(actor,{initialDirectory:root,isLive:()=>true,readDirectory:()=>cwd,appendChange:async value=>{cwd=value.cwd},admitNotice:async()=>{}})
 bindSandboxPolicyActor(actor,{initialDirectory:root,isLive:()=>true,readPolicy:()=>({mode,artifactRoot:null}),appendPolicy:async()=>{throw Error('not mutating mode')}})
 const run=action=>ctx.agents.withInitiator(actor,action),write=path=>run(async()=>ctx.fs.writeText(await ctx.fs.resolve(path),'proof',undefined,new AbortController().signal))
 return {...f,ctx,root,other,actor,foreign,run,write}
}
test('real generic filesystem with official actor enforces bound read-only policy and private task boundaries',async t=>{
 const f=await fixture(t,{mode:'read-only'}),path=join(f.root,'work','blocked.txt')
 await assert.rejects(f.write(path),error=>error.code==='FS_SANDBOX_DENIED')
 await assert.rejects(readFile(path),{code:'ENOENT'})
 await assert.rejects(f.run(async()=>f.ctx.fs.readText(await f.ctx.fs.resolve(join(f.ctx.runtimePaths.memory,'bindings.json')),new AbortController().signal)),error=>error.code==='FS_SANDBOX_DENIED')
 await writeFile(join(f.other,'work','private.txt'),'OTHER_PRIVATE_MARKER')
 await assert.rejects(f.run(async()=>f.ctx.fs.readText(await f.ctx.fs.resolve(join(f.other,'work','private.txt')),new AbortController().signal)),{code:'PERMISSION_CALL_UNBOUND'})
 assert.equal(await readFile(join(f.other,'work','private.txt'),'utf8'),'OTHER_PRIVATE_MARKER')
})
test('official workspace-write keeps task metadata immutable and canonical symlink escapes denied',async t=>{
 const f=await fixture(t);await f.write(join(f.root,'work','allowed.txt'));assert.equal(await readFile(join(f.root,'work','allowed.txt'),'utf8'),'proof')
 await assert.rejects(f.write(join(f.root,'outputs','forged.txt')),error=>error.code==='FS_SANDBOX_DENIED')
 await symlink(join(f.other,'work'),join(f.root,'work','escape'),'dir')
 // Direct fixture IO has no bound tool call to authorize an outside-origin path.
 await assert.rejects(f.write(join(f.root,'work','escape','cross-task.txt')),{code:'PERMISSION_CALL_UNBOUND'})
 await assert.rejects(readFile(join(f.other,'work','cross-task.txt')),{code:'ENOENT'})
 await assert.rejects(readFile(join(f.root,'outputs','forged.txt')),{code:'ENOENT'})
 await f.ctx.workingDirectory.set(f.actor,join(f.root,'work'))
 await f.write(join(f.root,'tmp','still-authorized.txt'))
 assert.equal(await readFile(join(f.root,'tmp','still-authorized.txt'),'utf8'),'proof','business boundary remains immutable origin after cd')
})
test('same-id official impostor gets no filesystem default policy or spill ownership',async t=>{
 const f=await fixture(t)
 await assert.rejects(f.ctx.agents.withInitiator(f.foreign,async()=>f.ctx.fs.writeText(await f.ctx.fs.resolve(join(f.root,'work','forged.txt')),'forged',undefined,new AbortController().signal)),error=>['PI_WORKING_DIRECTORY_ACTOR_UNBOUND','PI_SANDBOX_ACTOR_UNBOUND'].includes(error.code))
 const paths=f.ctx.runtimePaths,spills=await spillAccess(paths);t.after(()=>spills.close())
 assert.throws(()=>spills.allows(join(paths.spills,'anything'),f.foreign),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
 const done=Promise.withResolvers(),path=join(paths.processSpills,'owned-output.txt');await mkdir(paths.processSpills,{recursive:true});await writeFile(path,'owned output')
 spills.track(f.actor,{done:done.promise,collected:{stdout:{readFrom:()=>({spillPath:path})}}});assert.equal(spills.allows(path,f.actor),true);done.resolve();await spills.close()
 const cold=await spillAccess(paths);t.after(()=>cold.close());assert.equal(cold.allows(path,f.actor),true);assert.throws(()=>cold.allows(path,f.foreign),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
})

test('process privacy uses bound immutable official origin, masks private roots and strips provider credentials',async t=>{
 const f=await fixture(t),{installProcessPrivacy}=await import('../src/memory/privacy.js'),seen=[]
 const port={agents:f.ctx.agents,subprocess:{resolveExecutable:async()=>'/usr/bin/bwrap',spawn(spec){seen.push(spec);return{done:Promise.resolve(),collected:{}}},async spawnTerminal(spec){seen.push(spec);return{done:Promise.resolve(),collected:{}}}},spillStore:{saveText(){}},get:()=>undefined,effect(){}}
 await installProcessPrivacy(port,f.ctx.memoryPrivacy)
 if(process.platform!=='linux'){assert.throws(()=>f.run(()=>port.subprocess.spawn({cwd:join(f.root,'work'),argv:['node','-e','noop']})),{code:'MEMORY_PROCESS_PRIVACY_UNAVAILABLE'});assert.equal(seen.length,0);return}
 await f.run(()=>port.subprocess.spawn({cwd:join(f.root,'work'),argv:['node','-e','noop'],env:{PROVIDER_API_KEY:'PRIVATE_PROVIDER_KEY',PATH:'/bin'},control:'pipe'}).done)
 assert.equal(seen.length,1);assert.equal(seen[0].env.PROVIDER_API_KEY,undefined);assert.equal(seen[0].env.HOME,'/tmp/night-home');assert.ok(seen[0].argv.includes(join(f.root,'sessions')));assert.ok(seen[0].argv.includes(join(f.root,'work')))
 assert.throws(()=>f.ctx.agents.withInitiator(f.foreign,()=>port.subprocess.spawn({cwd:join(f.root,'work'),argv:['node']})),{code:'PI_WORKING_DIRECTORY_ACTOR_UNBOUND'})
 assert.throws(()=>f.run(()=>port.subprocess.spawn({cwd:join(f.other,'work'),argv:['node']})),{code:'NIGHT_WORK_OUTSIDE_WORKSPACES'});assert.equal(seen.length,1)
})

test('authorized direct task process binds its own temp and fails before spawn if unavailable',async t=>{
 const f=await fixture(t),{installProcessPrivacy}=await import('../src/memory/privacy.js'),seen=[]
 const port={agents:f.ctx.agents,subprocess:{resolveExecutable:async()=>'/usr/bin/bwrap',spawn(spec){seen.push(spec);return{done:Promise.resolve(),collected:{}}}},spillStore:{saveText(){}},get:name=>name==='tools'?{resolveProcessAuthorization:({cwd})=>({kind:'direct',cwd})}:undefined,effect(){}}
 await installProcessPrivacy(port,f.ctx.memoryPrivacy)
 await f.run(()=>port.subprocess.spawn({cwd:join(f.root,'work'),argv:['node'],env:{Temp:'/host',KEEP:'value'}}).done)
 assert.equal(seen.length,1);assert.equal(seen[0].env.TEMP,join(f.root,'tmp'));assert.equal(seen[0].env.TMP,join(f.root,'tmp'));assert.equal(seen[0].env.TMPDIR,join(f.root,'tmp'));assert.equal(seen[0].env.Temp,undefined);assert.equal(seen[0].env.KEEP,'value')
 await (await import('node:fs/promises')).rm(join(f.root,'tmp'),{recursive:true})
 assert.throws(()=>f.run(()=>port.subprocess.spawn({cwd:join(f.root,'work'),argv:['node']})),{code:'NIGHT_TASK_TEMP_UNAVAILABLE'});assert.equal(seen.length,1)
})
