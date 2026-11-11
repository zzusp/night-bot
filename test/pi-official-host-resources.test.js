import {symlink} from './fixtures/filesystem-link.js'
import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readFile,lstat,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {createScope} from '../src/native-scope.js'
import NativeAgents from '../src/native-agents.js'
import NativeSkills from '../src/native-skills.js'
import {createOfficialHostResourceResolver} from '../src/pi-official-host-resources.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {recordUsage,readUsage} from '../src/memory/evolution.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-official-resources-')),ctx=new Context(),paths=runtimePaths({installRoot:root});await prepareRuntimePaths(paths)
 new NativeAgents(ctx);new NativeSkills(ctx)
 const models=[],memoryPorts=[],credentials={resolve:async()=>({value:'scoped'})},registry={list:()=>[]},systemPrompt={officialSections:async()=>({night_fixture:'scoped'})}
 let alive=true
 ctx.provide('runtimePaths',paths);ctx.provide('credentials',credentials);ctx.provide('tools',registry);ctx.provide('systemPrompt',systemPrompt)
 ctx.provide('nativePiProvider',{official:{resolve:async(route,scope)=>{models.push({route,credentials:scope.credentials});return {modelRuntime:{},model:{id:route.model},retrySettings:{enabled:true,maxRetries:2,baseDelayMs:25,provider:{maxRetries:1}}}}}})
 ctx.provide('permissionPresets',{authorizeMemoryWrite:actor=>actor===a.actor})
 ctx.provide('memory',{official:ports=>{memoryPorts.push(ports);return {fixture:'official-memory'}}})
 const fs={resolve:async path=>({path}),stat:async target=>{try{const value=await lstat(target.path);return {type:value.isFile()?'file':'directory',size:value.size}}catch(error){if(error.code==='ENOENT')return;throw error}},readText:async target=>readFile(target.path,'utf8'),async *streamText(target){yield await readFile(target.path,'utf8')},processPath:target=>target.path}
 ctx.provide('fs',fs)
 fs.listDir=async target=>(await readdir(target.path,{withFileTypes:true})).map(entry=>({name:entry.name,type:entry.isDirectory()?'directory':'file',target:{displayPath:join(target.path,entry.name)}}))
 const makeActor=id=>{const actor={id},scope=createScope(ctx,actor);actor.ctx=scope.ctx;return {actor,scope,header:{id,cwd:paths.workspaces}}}
 const a=makeActor('actor-a'),b=makeActor('actor-b')
 ctx.provide('workingDirectory',{get:actor=>{const owner=[a,b].find(value=>value.actor===actor);if(!owner)throw new Error('foreign directory owner');return owner.header.cwd}})
 const resolve=createOfficialHostResourceResolver(ctx,{paths,model:{provider:'configured',model:'main'},memoryModel:{provider:'configured',model:'extract'},maxParallelToolCalls:2,isLive:()=>alive})
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {ctx,paths,root,a,b,resolve,models,memoryPorts,fs,closeOwner:()=>{alive=false}}
}
const runtimeSkill={name:'runtime-procedure',description:'Scoped procedure',source:'runtime',content:'CURRENT PROVIDER TEXT',invocation:{modelInvocable:true,userInvocable:true}}

test('resume resolves the model saved by the official projection before the changed deployment default',async t=>{
 const f=await fixture(t),store={manager:{buildSessionProjection:()=>({model:{provider:'saved-provider',modelId:'saved-model'},thinkingLevel:'high'})}}
 await f.resolve({...f.a,mode:'resume',store})
 assert.equal(f.models[0].route.provider,'saved-provider');assert.equal(f.models[0].route.model,'saved-model')
 assert.equal(f.models[0].route.reasoningEffort,undefined,'Pi SDK restores and clamps its own saved thinking level')
 await f.resolve({...f.a,mode:'resume',store,options:{agentOptions:{provider:'explicit-provider',model:'explicit-model'}}})
 assert.equal(f.models[1].route.provider,'explicit-provider');assert.equal(f.models[1].route.model,'explicit-model')
})

test('host resources select official route, fixed extraction credentials and private retry settings after actual scope mount',async t=>{
 const f=await fixture(t),resources=await f.resolve({...f.a,options:{agentOptions:{provider:'configured',model:'override',memoryModel:'forged',credentials:{resolve:()=> 'forged'},authorizeWrite:()=>true}}})
 assert.equal(resources.maxParallelToolCalls,2)
 assert.deepEqual(f.models[0].route,{provider:'configured',model:'override'})
 assert.equal(f.models[0].credentials,f.ctx.credentials)
 assert.equal(resources.settingsManager.getRetrySettings().maxRetries,2);assert.equal(resources.settingsManager.getProviderRetrySettings().maxRetries,1)
 assert.deepEqual(resources.settingsManager.getPackages(),[])
 assert.equal(f.memoryPorts[0].authorizeWrite(f.a.actor),true);assert.equal(f.memoryPorts[0].authorizeWrite(f.b.actor),false)
 await f.memoryPorts[0].resolveExtractionModel(f.a.actor,{})
 assert.deepEqual(f.models[1].route,{provider:'configured',model:'extract'});assert.equal(f.models[1].credentials,f.ctx.credentials)
 await assert.rejects(f.memoryPorts[0].resolveExtractionModel(f.b.actor,{}),{code:'PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED'})
 const other=await f.resolve(f.b);assert.notEqual(resources.agentDir,other.agentDir)
})
test('scoped runtime skill materialization keeps exact text private and never leaks sibling catalog',async t=>{
 const f=await fixture(t);f.a.actor.ctx.skills.register(runtimeSkill)
 const a=await f.resolve(f.a),b=await f.resolve(f.b),skills=await a.context.skills(f.a.actor)
 assert.equal(skills.length,1);assert.equal(await readFile(skills[0].filePath,'utf8'),runtimeSkill.content)
 assert.ok(skills[0].filePath.startsWith(a.agentDir));assert.deepEqual(await b.context.skills(f.b.actor),[])
 if(process.platform!=='win32'){assert.equal((await lstat(skills[0].filePath)).mode&0o777,0o600);assert.equal((await lstat(a.agentDir)).mode&0o777,0o700)}
 assert.equal((await a.context.skills(f.a.actor))[0].filePath,skills[0].filePath)
})
test('instruction roots are explicit current cwd plus configured globals; parent and home are not discovered',async t=>{
 const f=await fixture(t),cwd=join(f.paths.workspaces,'nested');await mkdir(cwd)
 await writeFile(join(f.paths.workspaces,'AGENTS.md'),'PARENT MUST NOT APPEAR')
 await writeFile(join(cwd,'AGENTS.md'),'CURRENT CWD')
 await writeFile(join(f.paths.agentsHome,'AGENTS.md'),'CONFIGURED GLOBAL')
 f.a.header.cwd=cwd
 const resources=await f.resolve(f.a),files=await resources.context.instructions(f.a.actor)
 assert.ok(files.some(file=>file.content==='CURRENT CWD'));assert.ok(files.some(file=>file.content==='CONFIGURED GLOBAL'));assert.ok(!files.some(file=>file.content.includes('PARENT')))
})
test('resource reads fail closed after owner cancellation and never accept a foreign actor',async t=>{
 const f=await fixture(t),resources=await f.resolve(f.a)
 await assert.rejects(resources.context.skills(f.b.actor),{code:'PI_OFFICIAL_RESOURCE_ACTOR_REQUIRED'})
 f.closeOwner();await assert.rejects(resources.context.skills(f.a.actor),{code:'PI_OFFICIAL_RESOURCE_OWNER_CLOSED'})
 await assert.rejects(f.resolve(f.a),{code:'PI_OFFICIAL_RESOURCE_OWNER_CLOSED'})
})
test('materialization refuses symlinked private cache without writing its target',async t=>{
 const f=await fixture(t);f.a.actor.ctx.skills.register(runtimeSkill)
 const resources=await f.resolve(f.a),outside=join(f.root,'other');await mkdir(outside);await symlink(outside,join(resources.agentDir,'skills'),'dir')
 await assert.rejects(resources.context.skills(f.a.actor),{code:'PI_OFFICIAL_RESOURCE_PATH_UNSAFE'})
})

test('real Reflection learned skills use the Bot-shared scope and revision; revocation stops publication to all authenticated actors',async t=>{
 const {default:Reflection}=await import('../src/memory/reflection.js'),{MarkdownMemoryStore}=await import('../src/memory/store.js'),{memoryScope}=await import('../src/memory/scope.js'),{atomicWrite}=await import('../src/runtime/files.js')
 const f=await fixture(t),store=new MarkdownMemoryStore(f.paths.memory);t.after(()=>store.close())
 const aBinding={actorId:'human-a',projects:[]},bBinding={actorId:'human-b',projects:[]},scope=memoryScope(aBinding)
 f.ctx.memory.store=store;f.ctx.memory.binding=async actor=>actor===f.a.actor?aBinding:bBinding
 f.ctx.memory.recordUsage=(scope,counter)=>recordUsage(store,scope,counter)
 const reflection=new Reflection(f.ctx,{enabled:false})
 await store.remember(scope,{topic:'experience',key:'evidence',text:'limited task evidence',source:{sessionId:'session',messageId:'message'}})
 const skill={active:true,supports:[{taskId:'task',memoryKey:'evidence'}],taskIds:['task'],memoryKeys:['evidence'],steps:['Read current evidence'],applicability:'Local tasks',revision:1}
 await atomicWrite(join(reflection.directory(scope),'state.json'),JSON.stringify({version:1,reviews:{},skills:{verify:skill}}))
 await atomicWrite(join(reflection.directory(scope),'skills','verify','SKILL.md'),'STALE DISK BODY')
 f.ctx.skills.invalidateCache()
 const a=await f.resolve(f.a),b=await f.resolve(f.b),loadsBefore=(await readUsage(store,scope))?.loadCount??0
 const resources=await a.context.skills(f.a.actor)
 assert.equal(resources.length,1);assert.equal(resources[0].name,'learned-verify')
 assert.ok((await readUsage(store,scope)).loadCount>loadsBefore,'automatic resource materialization loads bodies without model execution; provider retries may load more than once')
 const content=await readFile(resources[0].filePath,'utf8')
 assert.match(content,/Read current evidence/);assert.match(content,/NIGHT_LEARNED_SCOPE=bot\//);assert.ok(!content.includes('STALE DISK BODY'))
 const shared=await b.context.skills(f.b.actor)
 assert.equal(shared.length,1);assert.equal(shared[0].name,'learned-verify')
 assert.equal(await readFile(shared[0].filePath,'utf8'),content)
 assert.notEqual(shared[0].filePath,resources[0].filePath,'shared content still uses actor-owned resource caches')
 await reflection.forget(scope,'evidence')
 assert.deepEqual(await a.context.skills(f.a.actor),[])
 assert.deepEqual(await b.context.skills(f.b.actor),[])
 assert.equal(await readFile(resources[0].filePath,'utf8'),content,'old private Host cache is not claimed physically erased')
})


test('real NativeSkillFilesystem catalog maps an authorized physical SKILL.md through actor filesystem',async t=>{
 const {NativeSkillFilesystem}=await import('../src/native-skill-filesystem.js'),f=await fixture(t),directory=join(f.paths.skills,'file-skill')
 await mkdir(directory);const path=join(directory,'SKILL.md'),raw='---\nname: file-skill\ndescription: Real filesystem procedure\n---\nORIGINAL FILE BODY\n';await writeFile(path,raw)
 f.ctx.skills.registerProvider(control=>new NativeSkillFilesystem(f.ctx,control,{includeDefaultRoots:false,customSkillDirs:[f.paths.skills],watch:false,agentsHome:f.paths.agentsHome}))
 const snapshot=await f.a.actor.ctx.skills.snapshot({scope:f.a.actor,cwd:f.paths.workspaces})
 assert.equal(snapshot.skills[0].path,path)
 const resources=await f.resolve(f.a),skills=await resources.context.skills(f.a.actor)
 assert.equal(skills[0].filePath,path);assert.equal(await readFile(path,'utf8'),raw)
})
test('factory lifecycle signal protects resource resolution without an options permission flag',async t=>{
 const f=await fixture(t),lifetime=new AbortController();f.a.actor.lifecycle=Object.freeze({signal:lifetime.signal,isLive:()=>!lifetime.signal.aborted})
 const resolve=createOfficialHostResourceResolver(f.ctx,{paths:f.paths,model:{provider:'configured',model:'main'},maxParallelToolCalls:1})
 const resources=await resolve(f.a);assert.equal(resources.maxParallelToolCalls,1)
 lifetime.abort(new Error('owner closed'))
 await assert.rejects(resources.context.skills(f.a.actor),/owner closed/)
})


test('complete instruction budget refuses oversized authorized current file instead of reducing its source limit',async t=>{
 const f=await fixture(t);await writeFile(join(f.paths.workspaces,'AGENTS.md'),'X'.repeat(70000))
 const resources=await f.resolve(f.a)
 await assert.rejects(resources.context.instructions(f.a.actor),{code:'PI_OFFICIAL_INSTRUCTION_BUDGET_EXCEEDED'})
})
test('a preset with no selected filesystem cannot fall back to a broader inherited resource filesystem',async t=>{
 const f=await fixture(t);let reads=0;const original=f.fs.resolve;f.fs.resolve=(...args)=>{reads++;return original(...args)}
 f.ctx.provide('agentPresets',{serviceFor:()=>undefined})
 await assert.rejects(f.resolve(f.a),{code:'PI_OFFICIAL_RESOURCE_SERVICES_REQUIRED'});assert.equal(reads,0)
})

test('absolute-root Host uses owned instruction and skill roots instead of the operating-system user home',async t=>{
 const os=await import('node:os'),{syncBuiltinESMExports}=await import('node:module'),{createHost}=await import('../src/host.js')
 const f=await fixture(t),foreign=join(f.root,'foreign-user'),work=join(f.root,'legacy-work'),config={stateDir:join(f.root,'legacy-state'),workspaceDir:work,model:{provider:'fixture',model:'m'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:1/v1',apiKeyEnv:'ISOLATED_RESOURCE_TEST_KEY',models:[{id:'m',contextWindow:4096,maxTokens:128}]}},skillWatch:false,credentialsWatch:false}
 const paths=runtimePaths(config),foreignSkill=join(foreign,'.agents','skills','foreign','SKILL.md'),ownedSkill=join(paths.agentsHome,'skills','owned','SKILL.md')
 for(const [path,name]of [[foreignSkill,'foreign-private'],[ownedSkill,'owned-resource']]){await mkdir(join(path,'..'),{recursive:true});await writeFile(path,`---\nname: ${name}\ndescription: isolated resource\n---\n${name}`)}
 t.mock.method(os.default,'homedir',()=>foreign);syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports()})
 let host,handle
 try{
  host=await createHost(config,{environmentOptions:{home:foreign,inherited:{ISOLATED_RESOURCE_TEST_KEY:'local-fixture'}}})
  handle=await host.ctx.agents.create({sessionId:'owned-global-resources',agentOptions:config.model,meta:{cwd:work}})
  const options={scope:handle.actor,cwd:work},catalog=await host.ctx.skills.list(options)
  assert.ok(catalog.some(skill=>skill.name==='owned-resource'));assert.ok(!catalog.some(skill=>skill.name==='foreign-private'))
  assert.equal(host.ctx.runtimePaths.agentsHome,paths.agentsHome)
 }finally{await handle?.dispose();await host?.close()}
})

// Mutations happen at exact provider-read boundaries, without timers or model runs.
test('skill refresh retries a real learned body revision change and publishes only current content',async t=>{
 const {default:Reflection}=await import('../src/memory/reflection.js'),{MarkdownMemoryStore}=await import('../src/memory/store.js'),{memoryScope}=await import('../src/memory/scope.js'),{atomicWrite}=await import('../src/runtime/files.js')
 const f=await fixture(t),store=new MarkdownMemoryStore(f.paths.memory);t.after(()=>store.close())
 const binding={actorId:'human-a',projects:[]},scope=memoryScope(binding)
 f.ctx.memory.store=store;f.ctx.memory.binding=async()=>binding;f.ctx.memory.recordUsage=(scope,counter)=>recordUsage(store,scope,counter)
 const reflection=new Reflection(f.ctx,{enabled:false})
 await store.remember(scope,{topic:'experience',key:'evidence',text:'verified task evidence',source:{sessionId:'session',messageId:'message'}})
 const skill={active:true,supports:[{taskId:'task',memoryKey:'evidence'}],taskIds:['task'],memoryKeys:['evidence'],steps:['Read current evidence'],applicability:'Local tasks',revision:1}
 await atomicWrite(join(reflection.directory(scope),'state.json'),JSON.stringify({version:1,reviews:{},skills:{verify:skill}}));f.ctx.skills.invalidateCache()
 const original=reflection.skill.bind(reflection);let reads=0
 reflection.skill=async(...args)=>{
  const value=await original(...args)
  if(++reads===1)await store.remember(scope,{topic:'experience',key:'parallel-retrospective',text:'another completed task',source:{sessionId:'other-session',messageId:'other-message'}})
  return value
 }
 const resources=await f.resolve(f.a),published=await resources.context.skills(f.a.actor)
 assert.equal(published.length,1);assert.equal(reads,5)
 const body=await readFile(published[0].filePath,'utf8'),revision=(await store.index(scope)).revision
 assert.match(body,new RegExp('NIGHT_LEARNED_SCOPE=bot/[^;]+;revision='+revision+'\\n'))
 assert.match(body,/Read current evidence/)
})

test('skill refresh takes a fresh catalog after metadata and invocation policy change',async t=>{
 const f=await fixture(t);let reads=0,lists=0,current={...runtimeSkill,provider:'changing'}
 f.ctx.skills.registerProvider(()=>({name:'changing',list:async()=>{lists++;return [{...current,rank:100}]},get:async()=>{
  if(++reads===1)current={...current,description:'Current procedure',content:'CURRENT REVISED BODY',invocation:{modelInvocable:false,userInvocable:true}}
  return {...current}
 }}))
 const resources=await f.resolve(f.a),published=await resources.context.skills(f.a.actor)
 assert.equal(lists,2);assert.equal(reads,4);assert.equal(published.length,1)
 assert.equal(published[0].description,'Current procedure');assert.equal(published[0].disableModelInvocation,true)
 assert.equal(await readFile(published[0].filePath,'utf8'),'CURRENT REVISED BODY')
})

test('skill refresh removes a skill revoked during materialization instead of publishing its old body',async t=>{
 const f=await fixture(t);let reads=0,lists=0,revoked=false
 f.ctx.skills.registerProvider(()=>({name:'revoking',list:async()=>{lists++;return revoked?[]:[{...runtimeSkill,provider:'revoking',rank:100}]},get:async()=>{
  reads++;revoked=true;return undefined
 }}))
 const resources=await f.resolve(f.a)
 assert.deepEqual(await resources.context.skills(f.a.actor),[]);assert.equal(lists,2);assert.equal(reads,1)
})

test('skill refresh bounds continuous content churn to three materialization attempts',async t=>{
 const f=await fixture(t);let reads=0,lists=0
 f.ctx.skills.registerProvider(()=>({name:'churning',list:async()=>{lists++;return [{...runtimeSkill,provider:'churning',rank:100}]},get:async()=>({...runtimeSkill,provider:'churning',content:'REVISION '+ ++reads})}))
 const resources=await f.resolve(f.a)
 await assert.rejects(resources.context.skills(f.a.actor),{code:'PI_OFFICIAL_SKILL_AUTHORIZATION_CHANGED'})
 assert.equal(lists,3);assert.equal(reads,6)
})

test('skill refresh does not retry non-authorization provider failures or unsafe cache paths',async t=>{
 for(const kind of ['provider','path'])await t.test(kind,async t=>{
  const f=await fixture(t);let reads=0,lists=0
  f.ctx.skills.registerProvider(()=>({name:'failing',list:async()=>{lists++;return [{...runtimeSkill,provider:'failing',rank:100}]},get:async()=>{
   reads++;if(kind==='provider')throw Object.assign(new Error('Provider failed'),{code:'PROVIDER_FAILED'})
   return {...runtimeSkill,provider:'failing'}
  }}))
  const resources=await f.resolve(f.a)
  if(kind==='path'){const outside=join(f.root,'other');await mkdir(outside);await symlink(outside,join(resources.agentDir,'skills'),'dir')}
  await assert.rejects(resources.context.skills(f.a.actor),{code:kind==='provider'?'PROVIDER_FAILED':'PI_OFFICIAL_RESOURCE_PATH_UNSAFE'})
  assert.equal(lists,1);assert.equal(reads,1)
 })
})

test('skill refresh cancellation during a changing provider read is never retried',async t=>{
 const f=await fixture(t);let reads=0,lists=0
 f.ctx.skills.registerProvider(()=>({name:'closing',list:async()=>{lists++;return [{...runtimeSkill,provider:'closing',rank:100}]},get:async()=>{
  reads++;f.closeOwner();return {...runtimeSkill,provider:'closing',content:'CHANGED BODY'}
 }}))
 const resources=await f.resolve(f.a)
 await assert.rejects(resources.context.skills(f.a.actor),{code:'PI_OFFICIAL_RESOURCE_OWNER_CLOSED'})
 assert.equal(lists,1);assert.equal(reads,1)
})

test('skill refresh does not treat an incomplete catalog as a transient authorization change',async t=>{
 const f=await fixture(t);let reads=0,lists=0
 f.ctx.skills.registerProvider(()=>({name:'incomplete',list:async()=>{lists++;return {candidates:[{...runtimeSkill,provider:'incomplete',rank:100}],complete:false}},get:async()=>{reads++;return {...runtimeSkill,provider:'incomplete'}}}))
 const resources=await f.resolve(f.a)
 await assert.rejects(resources.context.skills(f.a.actor),{code:'PI_OFFICIAL_SKILL_SNAPSHOT_REQUIRED'})
 assert.equal(lists,1);assert.equal(reads,0)
})
