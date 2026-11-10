import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {loadConfig,validateConfig} from '../src/config.js'
import {MODEL_ROLES,ROLE_MODEL_ENV_NAMES,validateRoleModels,resolveRoleModels,roleModelSelection,roleModelCatalog,legacyRoleModelSelection} from '../src/role-models.js'
import {saveRoleModelConfiguration,saveModelConfiguration,configVersion,validateModelEndpoint,validateModelCredentialReference} from '../src/settings/model-configuration.js'
import {createLaunchEnvironmentSnapshot,loadNativeEnvironment} from '../src/native-environment.js'

const config=()=>({model:{provider:'fixture',model:'reasoner',reasoningEffort:'high'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'ROLE_CONFIG_SECRET',models:[{id:'reasoner',reasoningEfforts:{off:null,low:'low',high:'high'}},{id:'plain'}]},other:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v2',apiKeyEnv:'OTHER_ROLE_SECRET',models:[{id:'other-model',reasoningEfforts:{low:'low',high:'high'}}]}},resident:{taskSessions:{provider:'other',model:'other-model',reasoningMode:'explicit',reasoningEffort:'low'}}})
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-role-config-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=join(root,'data/config');await mkdir(directory,{recursive:true});const file=join(directory,'config.json'),value={installRoot:root,dataDir:'data',...config()};await writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});return {root,file,value,read:async()=>JSON.parse(await readFile(file,'utf8'))}}
async function snapshot(root){const rows=[];async function visit(path,name){const stat=await lstat(path);rows.push({name,mode:stat.mode,ino:stat.ino,mtimeMs:stat.mtimeMs,...stat.isFile()?{bytes:(await readFile(path)).toString('base64')}:{}});if(stat.isDirectory())for(const name2 of(await readdir(path)).sort())await visit(join(path,name2),name+'/'+name2)}await visit(root,'.');return rows}
const run=promisify(execFile),cli=(file,...args)=>run(process.execPath,[fileURLToPath(new URL('../bin/night-bot-config.js',import.meta.url)),file,...args],{env:{...process.env,ROLE_CONFIG_SECRET:'SECRET_MUST_NOT_BE_SHOWN',NIGHT_BOT_TRIAGE_MODEL:'ambient-value-must-not-be-saved'},windowsHide:true})
const cliJson=async(file,...args)=>JSON.parse((await cli(file,...args)).stdout)

test('role config validates only explicit roles and exposes a capability-only catalog',()=>{
 const value=config();assert.equal(validateRoleModels(value),value);assert.deepEqual(resolveRoleModels(value,{}),{})
 value.roleModels={triage:{provider:'fixture',model:'plain'},router:{provider:'fixture',model:'reasoner',reasoningEffort:'high'},task:{provider:'other',model:'other-model',reasoningEffort:'low'}}
 assert.equal(validateRoleModels(value),value)
 assert.deepEqual(roleModelCatalog(value).map(row=>[row.provider,row.models.map(model=>[model.id,model.reasoningEfforts])]),[['fixture',[['reasoner',['off','low','high']],['plain',['off']]]],['other',[['other-model',['low','high']]]]])
 assert.doesNotMatch(JSON.stringify(roleModelCatalog(value)),/SECRET|baseURL|apiKey|headers/)
})
for(const [name,roleModels,error]of [
 ['array',[],/ROLE_MODELS_INVALID/],['null',null,/ROLE_MODELS_INVALID/],['unknown role',{owner:{provider:'fixture',model:'reasoner'}},/MODEL_ROLE_INVALID/],
 ['partial entry',{triage:{provider:'fixture'}},/ROLE_MODEL_INVALID/],['blank model',{triage:{provider:'fixture',model:' '}},/ROLE_MODEL_INVALID/],
 ['extra authority',{triage:{provider:'fixture',model:'reasoner',permissionMode:'full'}},/ROLE_MODEL_INVALID/],
 ['unconfigured provider',{triage:{provider:'unknown',model:'reasoner'}},/PROVIDER_PROFILE_REQUIRED/],['unconfigured model',{triage:{provider:'fixture',model:'missing'}},/MODEL_NOT_CONFIGURED/],
 ['unsupported Pi level',{triage:{provider:'fixture',model:'reasoner',reasoningEffort:'ultra'}},/UNSUPPORTED_REASONING_EFFORT/],
 ['unsupported model level',{triage:{provider:'fixture',model:'reasoner',reasoningEffort:'medium'}},/UNSUPPORTED_REASONING_EFFORT/],
 ['nonreasoning model level',{triage:{provider:'fixture',model:'plain',reasoningEffort:'high'}},/UNSUPPORTED_REASONING_EFFORT/],
 ['persisted sentinel',{triage:{provider:'fixture',model:'reasoner',reasoningEffort:'model-default'}},/UNSUPPORTED_REASONING_EFFORT/],
 ['null effort',{triage:{provider:'fixture',model:'reasoner',reasoningEffort:null}},/UNSUPPORTED_REASONING_EFFORT/],
])test('role config rejects '+name,()=>{assert.throws(()=>validateRoleModels({...config(),roleModels}),error)})

test('environment role fields override saved fields without mutation and clear stale effort on route changes',()=>{
 const value=config();value.roleModels={triage:{...value.model},router:{provider:'fixture',model:'reasoner',reasoningEffort:'low'}};const before=structuredClone(value)
 const env={NIGHT_BOT_TRIAGE_MODEL:'plain',NIGHT_BOT_ROUTER_REASONING_EFFORT:'high',NIGHT_BOT_TASK_REASONING_EFFORT:'model-default'}
 assert.deepEqual(resolveRoleModels(value,env),{triage:{provider:'fixture',model:'plain'},router:{provider:'fixture',model:'reasoner',reasoningEffort:'high'},task:{provider:'other',model:'other-model'}})
 assert.deepEqual(value,before)
 const same=resolveRoleModels(value,{NIGHT_BOT_TRIAGE_MODEL:'reasoner'});assert.equal(same.triage.reasoningEffort,'high')
 assert.deepEqual(resolveRoleModels(value,{NIGHT_BOT_TRIAGE_PROVIDER:'other',NIGHT_BOT_TRIAGE_MODEL:'other-model'}).triage,{provider:'other',model:'other-model'})
 assert.throws(()=>resolveRoleModels(value,{NIGHT_BOT_TRIAGE_MODEL:'plain',NIGHT_BOT_TRIAGE_REASONING_EFFORT:'high'}),/UNSUPPORTED_REASONING_EFFORT/)
 assert.throws(()=>resolveRoleModels(value,{NIGHT_BOT_TASK_MODEL:''}),/ROLE_MODEL_INVALID/)
})

test('ENV supports partial legacy fallbacks and snapshot precedence without applying ENV in loadConfig',async t=>{
 const f=await fixture(t),value=config(),environment=createLaunchEnvironmentSnapshot([{source:'user-env',values:{NIGHT_BOT_ROUTER_REASONING_EFFORT:'low'}},{source:'project-env',values:{NIGHT_BOT_ROUTER_REASONING_EFFORT:'high'}},{source:'process',values:{NIGHT_BOT_ROUTER_REASONING_EFFORT:'model-default'}}])
 assert.deepEqual(resolveRoleModels(value,environment),{router:{provider:'fixture',model:'reasoner'}})
 assert.deepEqual(resolveRoleModels(value,{NIGHT_BOT_TASK_REASONING_EFFORT:'high'}).task,{provider:'other',model:'other-model',reasoningEffort:'high'})
 const saved=process.env.NIGHT_BOT_TRIAGE_MODEL;process.env.NIGHT_BOT_TRIAGE_MODEL='missing'
 try{assert.equal((await loadConfig(f.file)).roleModels,undefined);assert.throws(()=>resolveRoleModels(value),/MODEL_NOT_CONFIGURED/)}finally{if(saved===undefined)delete process.env.NIGHT_BOT_TRIAGE_MODEL;else process.env.NIGHT_BOT_TRIAGE_MODEL=saved}
 assert.deepEqual(legacyRoleModelSelection({...value,resident:{taskSessions:{reasoningMode:'model-default'}}},'task'),{provider:'fixture',model:'reasoner'})
})

test('configured dotenv admits exactly the role names while retaining bootstrap refusal and source precedence',async t=>{
 const f=await fixture(t),cwd=join(f.root,'dotenv');await mkdir(cwd)
 await writeFile(join(cwd,'.env'),Object.values(ROLE_MODEL_ENV_NAMES).flatMap(names=>Object.entries(names).map(([field,name])=>`${name}=${field==='provider'?'fixture':field==='model'?'reasoner':'low'}`)).join('\n'))
 const environment=await loadNativeEnvironment({cwd,home:cwd,inherited:{NIGHT_BOT_TRIAGE_REASONING_EFFORT:'high'}})
 assert.equal(resolveRoleModels(config(),environment).triage.reasoningEffort,'high');assert.equal(resolveRoleModels(config(),environment).router.reasoningEffort,'low')
 for(const name of ['NIGHT_BOT_RUNTIME_TMPDIR','NIGHT_BOT_TASK_PERMISSION_MODE','NIGHT_BOT_ROUTER_MODEL_EXTRA']){await writeFile(join(cwd,'.env'),`${name}=not-allowed\n`);await assert.rejects(loadNativeEnvironment({cwd,inherited:{}}),/BOOTSTRAP_ENV_REFUSED/)}
})

test('roleModelSelection clones explicit and fallback selections',()=>{const value={triage:{provider:'fixture',model:'reasoner'}},fallback={provider:'other',model:'other-model'};const ctx={get:()=>value},explicit=roleModelSelection(ctx,'triage',fallback),inherited=roleModelSelection(ctx,'task',fallback);explicit.model='changed';inherited.model='changed';assert.equal(value.triage.model,'reasoner');assert.equal(fallback.model,'other-model')})

test('actual headless role CLI validates zero-write check, saves each role, clears effort and redacts secrets',async t=>{
 const f=await fixture(t),before=await snapshot(f.root),args=['role-model','--role','triage','--provider','fixture','--model','reasoner','--reasoning-effort','low']
 const checked=await cliJson(f.file,...args,'--check');assert.equal(checked.checkOnly,true);assert.equal(checked.changed,true);assert.equal(checked.restartRequired,true);assert.deepEqual(await snapshot(f.root),before)
 for(const role of MODEL_ROLES){const result=await cliJson(f.file,...args.map(value=>value==='triage'?role:value));assert.equal(result.changed,true)}
 let value=await f.read();for(const role of MODEL_ROLES)assert.deepEqual(value.roleModels[role],{provider:'fixture',model:'reasoner',reasoningEffort:'low'})
 await cliJson(f.file,'role-model','--role','triage','--reasoning-effort','model-default');assert.deepEqual((await f.read()).roleModels.triage,{provider:'fixture',model:'reasoner'})
 await cliJson(f.file,'role-model','--role','router','--model','plain');assert.deepEqual((await f.read()).roleModels.router,{provider:'fixture',model:'plain'})
 value=await f.read();const shown=await cliJson(f.file,'show');assert.deepEqual(shown.roleModels,value.roleModels);assert.doesNotMatch(JSON.stringify(shown),/SECRET_MUST_NOT_BE_SHOWN|ambient-value/);assert.equal(shown.permissionMode,'full')
 assert.equal((await cliJson(f.file,'role-model','--role','router','--model','plain')).changed,false)
 assert.deepEqual((await loadConfig(f.file)).roleModels,value.roleModels)
})

test('actual role CLI rejects malformed, unknown or incompatible selections without check side effects',async t=>{
 const f=await fixture(t),before=await snapshot(f.root)
 for(const args of [[],['--role','owner'],['--role','triage','--provider','missing'],['--role','triage','--model','missing'],['--role','triage','--reasoning-effort','ultra'],['--role','triage','--model','plain','--reasoning-effort','high'],['--role','triage','--reasoning-effort',''],['--role','triage','--api-key','SECRET']]){
   await assert.rejects(cli(f.file,'role-model',...args,'--check'));assert.deepEqual(await snapshot(f.root),before)
 }
})

test('shared writer checks CAS inside config lock, preserves role selections, and uses the same global model path',async t=>{
 const f=await fixture(t),version=configVersion(f.value)
 const result=await saveRoleModelConfiguration(f.file,{role:'router',provider:'fixture',model:'reasoner',reasoningEffort:'low',expectedVersion:version});assert.equal(result.version,configVersion(await f.read()))
 await assert.rejects(saveRoleModelConfiguration(f.file,{role:'task',reasoningEffort:'high',expectedVersion:version}),{code:'SETTINGS_VERSION_CONFLICT'})
 const stable=await readFile(f.file,'utf8');await assert.rejects(saveModelConfiguration(f.file,{model:'other',expectedVersion:version}),{code:'SETTINGS_VERSION_CONFLICT'});assert.equal(await readFile(f.file,'utf8'),stable)
 const next=await saveModelConfiguration(f.file,{provider:'fixture',model:'new-model',expectedVersion:result.version});assert.deepEqual(next.config.roleModels,result.config.roleModels);assert.deepEqual(next.config.providers.fixture.models.map(model=>model.id),['reasoner','plain','new-model']);assert.deepEqual(next.config.model,{provider:'fixture',model:'new-model'})
 const final=await f.read();validateConfig(structuredClone(final),f.file)
})

test('concurrent shared role writes reject a stale CAS instead of overwriting the other role',async t=>{
 const f=await fixture(t),version=configVersion(f.value),results=await Promise.allSettled(MODEL_ROLES.slice(0,2).map(role=>saveRoleModelConfiguration(f.file,{role,provider:'fixture',model:'reasoner',reasoningEffort:'low',expectedVersion:version})))
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.find(row=>row.status==='rejected').reason.code,'SETTINGS_VERSION_CONFLICT');assert.equal(Object.keys((await f.read()).roleModels).length,1)
})

test('Web and CLI model inputs share endpoint and credential-reference validation without returning secret content',async t=>{
 const f=await fixture(t),before=await snapshot(f.root)
 for(const baseURL of ['http://remote.invalid/v1','https://user:SECRET_ENDPOINT@host/v1','https://host/v1?key=SECRET_ENDPOINT','https://host/v1#SECRET_ENDPOINT','https://host/v1?','https://host/v1#','file:///private/SECRET_ENDPOINT','SECRET_ENDPOINT']){
  assert.throws(()=>validateModelEndpoint(baseURL),{code:'SETTINGS_INPUT_INVALID'})
  await assert.rejects(saveModelConfiguration(f.file,{baseURL,checkOnly:true}),error=>error.code==='SETTINGS_INPUT_INVALID'&&!error.message.includes('SECRET_ENDPOINT'))
  await assert.rejects(cli(f.file,'model','--base-url',baseURL,'--check'),error=>/SETTINGS_INPUT_INVALID/.test(error.stderr)&&!error.stderr.includes('SECRET_ENDPOINT'))
 }
 for(const name of ['raw-secret-with-dash','$(SECRET_COMMAND)','A B','']){
  assert.throws(()=>validateModelCredentialReference(name),{code:'NIGHT_BOT_CREDENTIAL_ENV_INVALID'})
  await assert.rejects(saveModelConfiguration(f.file,{apiKeyEnv:name,checkOnly:true}),{code:'NIGHT_BOT_CREDENTIAL_ENV_INVALID'})
 }
 assert.equal(validateModelEndpoint('https://example.invalid/v1/'),'https://example.invalid/v1')
 for(const value of ['http://127.0.0.1:9/v1','http://localhost:9/v1','http://[::1]:9/v1'])assert.equal(validateModelEndpoint(value),value)
 assert.equal(validateModelCredentialReference('_FIXTURE_KEY_1'),'_FIXTURE_KEY_1');assert.deepEqual(await snapshot(f.root),before)
})

test('CLI show whitelists model fields and never prints unknown model metadata or provider headers',async t=>{
 const f=await fixture(t),value=await f.read();value.model.extra={privateMetadata:'PRIVATE_METADATA_MUST_NOT_PRINT'};value.providers.fixture.headers={'X-Fixture':'PRIVATE_HEADER_MUST_NOT_PRINT'}
 await writeFile(f.file,JSON.stringify(value));const shown=await cliJson(f.file,'show')
 assert.deepEqual(shown.model,{provider:'fixture',model:'reasoner',reasoningEffort:'high'});assert.doesNotMatch(JSON.stringify(shown),/PRIVATE_(?:METADATA|HEADER)_MUST_NOT_PRINT/)
})
