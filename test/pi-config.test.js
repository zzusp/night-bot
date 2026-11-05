import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'
const valid = () => ({stateDir:'/tmp/night-state',workspaceDir:'/tmp/night-work',model:{provider:'fixture',model:'fixture'},providers:{fixture:{apiKeyEnv:'FIXTURE_KEY'}}})
for (const [name,mutate,code] of [
  ['removed split backend',c=>{c.resident={taskSessions:{executionBackend:'claude-code'}}},'TASK_EXECUTION_BACKEND_UNSUPPORTED'],
  ['removed DSH backend',c=>{c.executionBackend='dsh'},'TASK_EXECUTION_BACKEND_UNSUPPORTED'],
  ['relative state',c=>{c.stateDir='state'},'ABSOLUTE_PATH_REQUIRED'],
  ['same workspace',c=>{c.workspaceDir=c.stateDir},'STATE_MUST_BE_SEPARATE'],
  ['nested state',c=>{c.stateDir=c.workspaceDir+'/state'},'STATE_MUST_BE_SEPARATE'],
  ['missing model',c=>{delete c.model},'MODEL_REQUIRED'],
  ['missing provider',c=>{c.providers={}},'PROVIDER_PROFILE_REQUIRED'],
  ['public API',c=>{c.resident={host:'0.0.0.0'}},'HTTP_REQUIRES_LOOPBACK'],
  ['inconsistent DWS flags',c=>{c.resident={dws:{enabled:false,writesAuthorized:true}}},'DWS_WRITE_CONFIGURATION_INVALID'],
  ['inline key',c=>{c.providers.fixture.apiKey='do-not-copy-credentials'},'USE_CREDENTIAL_ENV_REFERENCE'],
  ['file tool authority injection',c=>{c.fileTools={services:{fs:{}}}},'FILE_TOOLS_CONFIG_INVALID'],
  ['unbounded file scan',c=>{c.fileTools={windowMaxScanBytes:0}},'FILE_TOOLS_CONFIG_INVALID'],
  ['fractional file budget',c=>{c.fileTools={maxEditCount:1.5}},'FILE_TOOLS_CONFIG_INVALID'],
  ['invalid file output budget',c=>{c.fileTools={windowMaxBytes:255}},'FILE_TOOLS_CONFIG_INVALID'],
  ['invalid tool parallelism',c=>{c.maxParallelToolCalls=0},'MAX_PARALLEL_TOOL_CALLS_INVALID'],
  ['invalid credential watcher',c=>{c.credentialsWatch='false'},'CREDENTIALS_WATCH_INVALID'],
  ['invalid web provider selector',c=>{c.web={fetchProvider:1}},'WEB_CONFIG_INVALID'],
  ['invalid web registry config',c=>{c.web=[]},'WEB_CONFIG_INVALID'],
  ['invalid web timeout',c=>{c.webFetch={timeoutMs:2147483648}},'WEB_CONFIG_INVALID'],
  ['invalid redirect limit',c=>{c.webFetch={maxRedirects:-1}},'WEB_CONFIG_INVALID'],
  ['invalid web tool enablement',c=>{c.webTools={fetch:'false'}},'WEB_CONFIG_INVALID'],
  ['invalid web search query cap',c=>{c.webTools={searchMaxQueries:0}},'WEB_CONFIG_INVALID'],
  ['invalid web tool deadline',c=>{c.webTools={searchTimeoutMs:2147483648}},'WEB_CONFIG_INVALID'],
  ['fake production model',c=>{c.resident={fakeModel:true}},'FAKE_MODEL_IS_TEST_ONLY'],
]) test('configuration rejects '+name, async () => {
  const root=await mkdtemp('/tmp/night-config-')
  try {const c=valid();mutate(c);const path=join(root,'config.json');await writeFile(path,JSON.stringify(c));await assert.rejects(loadConfig(path),new RegExp(code))}
  finally {await rm(root,{recursive:true,force:true})}
})
test('configuration keeps disabled transport and provider env reference',async()=>{
  const root=await mkdtemp('/tmp/night-config-')
  try {const path=join(root,'config.json');await writeFile(path,JSON.stringify(valid()));assert.deepEqual(await loadConfig(path),valid())}
  finally {await rm(root,{recursive:true,force:true})}
})

test('configuration preserves explicit native web selection and anonymous HTTP limits',async()=>{const root=await mkdtemp('/tmp/night-config-');try{const config={...valid(),web:{fetchProvider:'http',searchProvider:'search'},webFetch:{timeoutMs:1000,maxRedirects:2,maxResponseBytes:1024,maxBodyChars:1000,userAgent:'fixture-agent'}},path=join(root,'config.json');await writeFile(path,JSON.stringify(config));assert.deepEqual(await loadConfig(path),config)}finally{await rm(root,{recursive:true,force:true})}})

test('configuration preserves explicit official file resource limits',async()=>{const root=await mkdtemp('/tmp/night-config-');try{const config={...valid(),fileTools:{maxBufferedBytes:10485760,maxEditBytes:2097152,windowMaxScanBytes:33554432}},path=join(root,'config.json');await writeFile(path,JSON.stringify(config));assert.deepEqual(await loadConfig(path),config)}finally{await rm(root,{recursive:true,force:true})}})
