import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {savedWorkLogConfig,resolveWorkLogConfig,validateWorkLogConfig} from '../src/work-log/config.js'
import {validateConfig} from '../src/config.js'
import {saveWorkLogConfiguration} from '../src/settings/work-log-configuration.js'
import {configVersion} from '../src/settings/model-configuration.js'
import {createLaunchEnvironmentSnapshot,loadNativeEnvironment} from '../src/native-environment.js'
import {runSettingsCli} from '../src/settings/cli.js'
import {createOperatorSettings} from '../src/settings/operator.js'
import {runtimePaths} from '../src/runtime/paths.js'

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'night-work-log-config-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data/config'),{recursive:true});const file=join(root,'data/config/config.json'),config={installRoot:root,dataDir:'data',model:{provider:'fixture',model:'fixture'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',models:[{id:'fixture'}]}}};await writeFile(file,JSON.stringify(config),{mode:0o600});return {root,file,config}}
test('daily log defaults are local 23:59 and resolution does not mutate config',()=>{
 const config={},before=structuredClone(config);assert.deepEqual(savedWorkLogConfig(config),{enabled:true,time:'23:59',timezone:'local'});assert.equal(resolveWorkLogConfig(config,{env:{}}).timezone,Intl.DateTimeFormat().resolvedOptions().timeZone);assert.deepEqual(config,before)
 assert.deepEqual(resolveWorkLogConfig({workLog:{time:'00:00'}},{env:{NIGHT_BOT_WORK_LOG_ENABLED:'false',NIGHT_BOT_WORK_LOG_TIMEZONE:'Asia/Shanghai'}}),{enabled:false,time:'00:00',timezone:'Asia/Shanghai'})
})
for(const value of [null,[],false,{enabled:'true'},{time:'24:00'},{time:'1:23'},{time:'23:60'},{time:null},{timezone:'unknown/zone'},{timezone:''},{timezone:' UTC '},{outputPath:'/tmp/private'}])test('reject invalid work log config '+JSON.stringify(value),()=>assert.throws(()=>validateWorkLogConfig(value),/NIGHT_BOT_WORK_LOG_/))
test('invalid environment rejects instead of falling back or persisting',()=>{for(const env of [{NIGHT_BOT_WORK_LOG_ENABLED:'1'},{NIGHT_BOT_WORK_LOG_TIME:''},{NIGHT_BOT_WORK_LOG_TIMEZONE:'bad-zone'}])assert.throws(()=>resolveWorkLogConfig({},{env}),/NIGHT_BOT_WORK_LOG_/)} )
test('configured dotenv supports only exact daily log names, process wins, saved values stay clean',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,'.env'),'NIGHT_BOT_WORK_LOG_TIME=22:15\nNIGHT_BOT_WORK_LOG_TIMEZONE=Asia/Shanghai\n')
 const env=await loadNativeEnvironment({cwd:f.root,inherited:{NIGHT_BOT_WORK_LOG_TIME:'21:30'}})
 assert.deepEqual(resolveWorkLogConfig(f.config,{env}),{enabled:true,time:'21:30',timezone:'Asia/Shanghai'})
 assert.equal(env.get('NIGHT_BOT_WORK_LOG_TIME').source,'process');assert.equal(env.get('NIGHT_BOT_WORK_LOG_TIMEZONE').source,'project-env')
 await writeFile(join(f.root,'.env'),'NIGHT_BOT_WORK_LOG_DIRECTORY=/tmp/other\n');await assert.rejects(loadNativeEnvironment({cwd:f.root,inherited:{}}),/BOOTSTRAP_ENV_REFUSED/)
})
test('config validation, partial saves, CAS and --check share one contract',async t=>{
 const f=await fixture(t);assert.throws(()=>validateConfig({...f.config,workLog:{time:'25:00'}},f.file),/WORK_LOG_TIME_INVALID/)
 const before=await readFile(f.file,'utf8'),version=configVersion(f.config)
 const checked=await saveWorkLogConfiguration(f.file,{time:'22:45',expectedVersion:version,checkOnly:true});assert.equal(checked.checkOnly,true);assert.equal(await readFile(f.file,'utf8'),before)
 const saved=await saveWorkLogConfiguration(f.file,{time:'22:45',expectedVersion:version});assert.equal(saved.restartRequired,true);assert.equal(saved.config.workLog.time,'22:45')
 await assert.rejects(saveWorkLogConfiguration(f.file,{time:'21:00',expectedVersion:version}),{code:'SETTINGS_VERSION_CONFLICT'})
 const second=await saveWorkLogConfiguration(f.file,{enabled:false});assert.deepEqual(second.config.workLog,{time:'22:45',enabled:false})
 await assert.rejects(saveWorkLogConfiguration(f.file,{time:'bad'}),/WORK_LOG_TIME_INVALID/)
})
test('operator displays saved and running values with non-secret environment provenance',async t=>{
 const f=await fixture(t),environment=createLaunchEnvironmentSnapshot([{source:'process',values:{NIGHT_BOT_WORK_LOG_TIME:'21:00',UNRELATED_SECRET:'DO_NOT_REVEAL'}}]);const settings=createOperatorSettings({file:f.file,paths:runtimePaths(f.config,f.file),running:f.config,getEnvironment:()=>environment,getCredentials:()=>({describeRecord:async()=>({configured:false}),describe:async()=>({configured:false})})})
 const before=await settings.view();assert.equal(before.workLog.saved.time,'23:59');assert.equal(before.workLog.running.time,'21:00');assert.equal(before.workLog.environmentOverrides[0].name,'NIGHT_BOT_WORK_LOG_TIME');assert.doesNotMatch(JSON.stringify(before),/DO_NOT_REVEAL|UNRELATED_SECRET/)
 const result=await settings.saveWorkLog({time:'20:00',expectedVersion:before.version});assert.equal(result.workLog.saved.time,'20:00');assert.equal(result.workLog.nextStart.time,'21:00');assert.equal(result.workLog.running.time,'21:00');assert.equal(result.liveApplied,false)
})
test('headless CLI validates and saves work log schedule through shared settings',async t=>{
 const f=await fixture(t),cli=args=>runSettingsCli([f.file,'work-log',...args],{environment:{},write:()=>{}}),before=await readFile(f.file,'utf8')
 assert.equal((await cli(['--time','22:30','--check'])).checkOnly,true);assert.equal(await readFile(f.file,'utf8'),before)
 const result=await cli(['--time','22:30','--timezone','UTC','--enabled','false']);assert.equal(result.restartRequired,true);assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')).workLog,{enabled:false,time:'22:30',timezone:'UTC'})
 await assert.rejects(cli(['--time','25:00']),/WORK_LOG_TIME_INVALID/);await assert.rejects(cli(['--enabled','yes']),/SETTINGS_COMMAND_INVALID/)
})

test('config CLI exposes the same daily log contract without serializing ambient overrides',async t=>{
 const {promisify}=await import('node:util'),{execFile}=await import('node:child_process'),{fileURLToPath}=await import('node:url'),run=promisify(execFile),f=await fixture(t)
 const cli=async(...args)=>JSON.parse((await run(process.execPath,[fileURLToPath(new URL('../bin/night-bot-config.js',import.meta.url)),f.file,...args],{env:{...process.env,NIGHT_BOT_WORK_LOG_TIME:'19:00'}})).stdout)
 const before=await readFile(f.file,'utf8');assert.equal((await cli('work-log','--time','22:00','--check')).checkOnly,true);assert.equal(await readFile(f.file,'utf8'),before)
 assert.equal((await cli('work-log','--time','22:00')).workLog.time,'22:00');assert.equal((await cli('show')).workLog.time,'22:00')
})
