import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getBuiltinModels} from '@earendil-works/pi-ai/providers/all'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {modelCatalogView,saveProviderConfiguration,saveModelCatalogEntry,configVersion} from '../src/settings/model-configuration.js'
import {createOperatorSettings} from '../src/settings/operator.js'
import {createSettingsCommands} from '../src/settings/commands.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {resolveRoleModels,roleModelSelection} from '../src/role-models.js'

const profile=()=>({api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'FIXTURE_KEY',headers:{'x-fixture':'FIXTURE_SECRET'},models:[{id:'initial'},{id:'second',name:'Second',contextWindow:8192,maxTokens:1024,input:['text','image'],reasoningEfforts:{low:'low',high:'high'},compat:{supportsStore:false}}]})
async function fixture(t,patch={}){
 const root=await mkdtemp(join(tmpdir(),'night-model-catalog-')),paths=runtimePaths({installRoot:root,dataDir:'data'})
 await prepareRuntimePaths(paths)
 const file=join(paths.config,'config.json'),config={installRoot:root,dataDir:'data',model:{provider:'fixture',model:'initial'},providers:{fixture:profile()},...patch}
 await writeFile(file,JSON.stringify(config),{mode:0o600})
 t.after(()=>rm(root,{recursive:true,force:true}))
 const read=async()=>JSON.parse(await readFile(file,'utf8'))
 const save=async(body,environment={})=>saveModelCatalogEntry(file,{provider:'fixture',expectedVersion:configVersion(await read()),...body},environment)
 return {file,config,read,save}
}

test('safe model catalog edits preserve API, credentials, metadata, and running snapshot',async t=>{
 const f=await fixture(t),original=structuredClone(f.config),view=modelCatalogView(original)
 assert.doesNotMatch(JSON.stringify(view),/FIXTURE_SECRET|FIXTURE_KEY|headers/)
 assert.deepEqual(view.providers[0].models[0].references,['default'])
 assert.equal(view.providers[0].models[0].configuredName,null)
 assert.equal(view.providers[0].models[1].configuredName,'Second')
 const added=await f.save({action:'add',model:'third',name:'Third'})
 assert.equal(added.restartRequired,true)
 await f.save({action:'edit',id:'second',model:'second',name:'Renamed'})
 const saved=await f.read()
 assert.deepEqual(saved.providers.fixture.models[1],{...original.providers.fixture.models[1],name:'Renamed'})
 assert.deepEqual(saved.providers.fixture.headers,original.providers.fixture.headers)
 assert.equal(saved.providers.fixture.apiKeyEnv,'FIXTURE_KEY')
 assert.deepEqual(f.config,original)
 await f.save({action:'edit',id:'third',model:'new-third',name:''})
 assert.equal(modelCatalogView(await f.read()).providers[0].models.find(row=>row.id==='new-third').configuredName,null)
 await f.save({action:'remove',id:'new-third',confirm:true})
 assert.equal((await f.read()).providers.fixture.models.length,2)
})

test('strict CAS, malformed IDs, duplicate IDs, confirmation and check-only never overwrite',async t=>{
 const f=await fixture(t),before=await readFile(f.file,'utf8')
 for(const model of ['', ' ', ' padded', 'x\ny'])await assert.rejects(f.save({action:'add',model}),{code:'SETTINGS_INPUT_INVALID'})
 await assert.rejects(f.save({action:'add',model:'second'}),{code:'SETTINGS_MODEL_EXISTS'})
 await assert.rejects(f.save({action:'add',model:'third',expectedVersion:undefined}),{code:'SETTINGS_INPUT_INVALID'})
 await assert.rejects(f.save({action:'add',model:'third',expectedVersion:'0'.repeat(64)}),{code:'SETTINGS_VERSION_CONFLICT'})
 await assert.rejects(f.save({action:'remove',id:'second'}),{code:'SETTINGS_MODEL_DELETE_CONFIRMATION_REQUIRED'})
 await assert.rejects(f.save({action:'edit',id:'missing',model:'third'}),{code:'NIGHT_BOT_MODEL_NOT_CONFIGURED'})
 const checked=await f.save({action:'add',model:'third',checkOnly:true})
 assert.equal(checked.checkOnly,true);assert.equal(checked.changed,true)
 assert.equal(await readFile(f.file,'utf8'),before)
})

test('default, explicit roles, legacy task and environment references cannot be removed or renamed',async t=>{
 const f=await fixture(t)
 const variants=[{roleModels:{triage:{provider:'fixture',model:'second'}}},{roleModels:{router:{provider:'fixture',model:'second'}}},{roleModels:{task:{provider:'fixture',model:'second'}}},{resident:{taskSessions:{model:'second'}}},{}]
 for(const patch of variants){
  const config={...f.config,...patch};await writeFile(f.file,JSON.stringify(config))
  const environment=Object.keys(patch).length?{}:{NIGHT_BOT_ROUTER_MODEL:{value:'second',source:'project-env'}}
  const view=modelCatalogView(config,environment)
  assert.ok(view.providers[0].models[1].references.length)
  for(const id of ['initial','second']){
   await assert.rejects(f.save({action:'remove',id,confirm:true},environment),{code:'SETTINGS_MODEL_IN_USE'})
   await assert.rejects(f.save({action:'edit',id,model:'replacement'},environment),{code:'SETTINGS_MODEL_IN_USE'})
  }
  await f.save({action:'edit',id:'second',model:'second',name:'Still allowed'},environment)
 }
})

test('last unreferenced model is protected and invalid existing catalogs fail closed',async t=>{
 const f=await fixture(t,{providers:{fixture:profile(),other:{...profile(),models:[{id:'only'}]}}})
 await assert.rejects(f.save({action:'remove',provider:'other',id:'only',confirm:true}),{code:'SETTINGS_MODEL_LAST_REQUIRED'})
 const bad=[{...profile(),models:[{id:'initial'},{id:'broken',maxTokens:0}]},{...profile(),models:[]},{...profile(),models:[{id:'initial'},{id:'initial'}]}]
 for(const p of bad){
  const config={...f.config,providers:{fixture:p}},before=JSON.stringify(config);await writeFile(f.file,before)
  assert.throws(()=>modelCatalogView(config))
  await assert.rejects(f.save({action:'add',model:'third'}))
  assert.equal(await readFile(f.file,'utf8'),before)
 }
 await writeFile(f.file,JSON.stringify(f.config))
 await assert.rejects(f.save({action:'add',model:'third'},{NIGHT_BOT_TASK_MODEL:'missing'}))
})

test('builtin catalogs retain all models and overrides when materialized as explicit whitelist',async t=>{
 const builtin=getBuiltinModels('openai'),first=builtin[0],second=builtin[1]
 assert.ok(first&&second)
 const config={model:{provider:'openai',model:first.id},providers:{openai:{modelOverrides:{[second.id]:{name:'Custom label',maxTokens:512}}}}}
 const f=await fixture(t,config),before=resolvePiProfiles(config.providers).get('openai').models
 const catalog=modelCatalogView(f.config).providers[0].models
 assert.equal(catalog[0].configuredName,null)
 assert.equal(catalog[1].configuredName,'Custom label')
 await f.save({provider:'openai',action:'edit',id:second.id,model:second.id,name:'Edited label'})
 let saved=await f.read(),after=resolvePiProfiles(saved.providers).get('openai').models
 assert.equal(after.length,before.length);assert.deepEqual(after.map(m=>m.id),before.map(m=>m.id))
 assert.equal(after[1].maxTokens,512)
 assert.equal(modelCatalogView(saved).providers[0].models[1].configuredName,'Edited label')
 await f.save({provider:'openai',action:'edit',id:second.id,model:second.id,name:''})
 const cleared=modelCatalogView(await f.read()).providers[0].models[1]
 assert.equal(cleared.configuredName,null);assert.equal(cleared.name,second.name)
 assert.deepEqual(after[0],before[0]);assert.equal(saved.providers.openai.modelOverrides,undefined)
 await f.save({provider:'openai',action:'add',model:'fixture-custom-model'})
 saved=await f.read();assert.equal(saved.providers.openai.models.length,before.length+1)
 await f.save({provider:'openai',action:'remove',id:second.id,confirm:true})
 assert.equal(resolvePiProfiles((await f.read()).providers).get('openai').models.some(m=>m.id===second.id),false)
})

test('shared dispatcher and operator facade use strict DTO, environment and CAS for catalog actions',async t=>{
 const f=await fixture(t),settings=createOperatorSettings({file:f.file,running:f.config,getCredentials:()=>({describe:async()=>({configured:false}),describeRecord:async()=>({configured:false})}),getEnvironment:()=>({NIGHT_BOT_TASK_MODEL:'second'})})
 const dispatch=createSettingsCommands({settings}),view=await dispatch({action:'model-list'})
 assert.ok(view.providers[0].models[1].references.includes('environment:task'))
 await assert.rejects(dispatch({action:'model-entry',body:{action:'add',provider:'fixture',model:'new',apiKey:'forged',expectedVersion:view.version}}),{code:'SETTINGS_COMMAND_INVALID'})
 const result=await dispatch({action:'model-entry',body:{action:'add',provider:'fixture',model:'new',expectedVersion:view.version}})
 assert.equal(result.liveApplied,false);assert.equal(result.restartRequired,true)
 await assert.rejects(dispatch({action:'model-entry',body:{action:'remove',provider:'fixture',id:'second',confirm:true,expectedVersion:result.version}}),{code:'SETTINGS_MODEL_IN_USE'})
})

test('effective persisted task fallback is protected; explicit task and field-wise ENV overrides supersede it',async t=>{
 const f=await fixture(t,{resident:{taskSessions:{model:'initial'}}})
 const fallback=()=>({task:{provider:'fixture',model:'second'}})
 const settings=createOperatorSettings({file:f.file,running:f.config,getCredentials:()=>({describe:async()=>({configured:false}),describeRecord:async()=>({configured:false})}),getFallbackRoleModels:fallback})
 let view=await settings.modelCatalog()
 assert.ok(view.providers[0].models[1].references.includes('runtime:task'))
 await assert.rejects(settings.saveModelEntry({action:'remove',provider:'fixture',id:'second',confirm:true,expectedVersion:view.version}),{code:'SETTINGS_MODEL_IN_USE'})
 await assert.rejects(settings.saveModelEntry({action:'edit',provider:'fixture',id:'second',model:'renamed',expectedVersion:view.version}),{code:'SETTINGS_MODEL_IN_USE'})
 await assert.rejects(f.save({action:'remove',id:'second',confirm:true}),{code:'SETTINGS_TASK_ROLE_REQUIRED'})
 await assert.rejects(f.save({action:'edit',id:'second',model:'renamed',checkOnly:true}),{code:'SETTINGS_TASK_ROLE_REQUIRED'})
 await f.save({action:'add',model:'third'})
 await f.save({action:'edit',id:'second',model:'second',name:'Offline label'})
 view=await settings.modelCatalog()
 // Even a currently unused entry is guarded in live mode: the old resident
 // endpoint could otherwise select it from its pre-restart catalog afterward.
 await assert.rejects(settings.saveModelEntry({action:'remove',provider:'fixture',id:'third',confirm:true,expectedVersion:view.version}),{code:'SETTINGS_TASK_ROLE_REQUIRED'})
 await assert.rejects(settings.saveModelEntry({action:'edit',provider:'fixture',id:'third',model:'renamed',expectedVersion:view.version}),{code:'SETTINGS_TASK_ROLE_REQUIRED'})
 const overridden={...await f.read(),roleModels:{task:{provider:'fixture',model:'initial'}}}
 await writeFile(f.file,JSON.stringify(overridden));view=await settings.modelCatalog()
 assert.ok(!view.providers[0].models[1].references.includes('runtime:task'))
 await f.save({action:'remove',id:'second',confirm:true})
 // Simulate a subsequent legacy selection of the now-removed entry. The saved
 // explicit task role remains authoritative and the catalog still validates.
 assert.ok((await settings.modelCatalog()).providers[0].models.every(row=>row.id!=='second'))
 const saved=await f.read(),roles=resolveRoleModels(saved,{})
 assert.deepEqual(roleModelSelection({get:()=>roles},'task',fallback().task),{provider:'fixture',model:'initial'})
 // A reasoning-only environment field synthesizes the same legacy-based role
 // selection as resolveRoleModels at startup, not the persisted task default.
 await writeFile(f.file,JSON.stringify(f.config))
 const environment={NIGHT_BOT_TASK_REASONING_EFFORT:'model-default'}
 const envSettings=createOperatorSettings({file:f.file,running:f.config,getCredentials:()=>({describe:async()=>({configured:false}),describeRecord:async()=>({configured:false})}),getFallbackRoleModels:fallback,getEnvironment:()=>environment})
 const envView=await envSettings.modelCatalog()
 assert.ok(envView.providers[0].models[0].references.includes('environment:task'))
 assert.ok(!envView.providers[0].models[1].references.includes('runtime:task'))
 await f.save({action:'remove',id:'second',confirm:true},environment)
})


test('provider transport edits and creation preserve every selection and model metadata under CAS',async t=>{
 const f=await fixture(t,{providers:{fixture:profile(),other:{...profile(),apiKeyEnv:'OTHER_KEY'}},roleModels:{task:{provider:'fixture',model:'second',reasoningEffort:'high'}}})
 const before=await f.read(),save=body=>saveProviderConfiguration(f.file,{provider:'other',expectedVersion:configVersion(before),...body})
 const check=await save({baseURL:'https://new.example.invalid/v1',checkOnly:true});assert.equal(check.changed,true);assert.deepEqual(await f.read(),before)
 await save({baseURL:'https://new.example.invalid/v1'})
 const after=await f.read();assert.deepEqual(after.model,before.model);assert.deepEqual(after.roleModels,before.roleModels);assert.deepEqual(after.providers.fixture,before.providers.fixture)
 assert.deepEqual(after.providers.other,{...before.providers.other,baseURL:'https://new.example.invalid/v1'})
 await assert.rejects(save({api:'openai-responses'}),{code:'SETTINGS_VERSION_CONFLICT'})
 await assert.rejects(saveProviderConfiguration(f.file,{provider:'missing',baseURL:'https://valid.invalid',expectedVersion:configVersion(after)}),{code:'NIGHT_BOT_PROVIDER_PROFILE_REQUIRED'})
 for(const baseURL of ['https://user:secret@host/v1','https://host/v1?key=secret','http://remote.invalid',''])await assert.rejects(saveProviderConfiguration(f.file,{provider:'other',baseURL,expectedVersion:configVersion(after)}))
 await saveProviderConfiguration(f.file,{action:'create',provider:'new-route',model:'first',api:'openai-responses',baseURL:'https://new.invalid/v1',expectedVersion:configVersion(after)})
 const created=await f.read();assert.deepEqual(created.model,before.model);assert.deepEqual(created.roleModels,before.roleModels);assert.deepEqual(created.providers['new-route'].models,[{id:'first'}]);assert.equal(created.providers['new-route'].apiKeyEnv,undefined)
})

test('builtin provider endpoint edits keep implicit catalog and override metadata, reset restores builtin defaults',async t=>{
 const first=getBuiltinModels('openai')[0],f=await fixture(t,{model:{provider:'openai',model:first.id},providers:{openai:{modelOverrides:{[first.id]:{name:'Custom',maxTokens:512,baseURL:'https://preserved.invalid'}}}}})
 const before=await f.read(),models=resolvePiProfiles(before.providers).get('openai').models
 await saveProviderConfiguration(f.file,{provider:'openai',baseURL:'https://proxy.invalid/v1',expectedVersion:configVersion(before)})
 let after=await f.read();assert.equal(after.providers.openai.models,undefined);assert.deepEqual(after.providers.openai.modelOverrides,before.providers.openai.modelOverrides)
 assert.deepEqual(resolvePiProfiles(after.providers).get('openai').models.map(x=>x.id),models.map(x=>x.id))
 await saveProviderConfiguration(f.file,{provider:'openai',api:'',baseURL:'',expectedVersion:configVersion(after)})
 assert.deepEqual(await f.read(),before)
 const unsafe=structuredClone(before);unsafe.providers.openai.baseURL='https://user:SECRET@host/v1?token=SECRET';assert.doesNotMatch(JSON.stringify(modelCatalogView(unsafe)),/SECRET/);assert.equal(modelCatalogView(unsafe).providers[0].baseURLConfigured,true)
})

test('native builtin protocol is retained when changing only provider endpoint',async t=>{
 const first=getBuiltinModels('google')[0],f=await fixture(t,{model:{provider:'google',model:first.id},providers:{google:{}}})
 assert.equal(modelCatalogView(f.config).providers[0].api,'')
 await saveProviderConfiguration(f.file,{provider:'google',baseURL:'https://proxy.invalid',expectedVersion:configVersion(f.config)})
 const saved=await f.read();assert.equal(saved.providers.google.api,undefined);assert.equal(saved.providers.google.models,undefined)
 assert.equal(resolvePiProfiles(saved.providers).get('google').models[0].api,'google-generative-ai')
})
