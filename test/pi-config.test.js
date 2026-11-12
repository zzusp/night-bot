import {tmpdir} from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, lstat, mkdir, rename, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {channelPluginRows} from '../src/channels/loader.js'
import { loadConfig } from '../src/config.js'
const valid = () => ({stateDir:join(tmpdir(),'night-state'),workspaceDir:join(tmpdir(),'night-work'),model:{provider:'fixture',model:'fixture'},providers:{fixture:{apiKeyEnv:'FIXTURE_KEY'}}})
for (const [name,mutate,code] of [
  ['removed split backend',c=>{c.resident={taskSessions:{executionBackend:'claude-code'}}},'TASK_EXECUTION_BACKEND_UNSUPPORTED'],
  ['removed DSH backend',c=>{c.executionBackend='dsh'},'TASK_EXECUTION_BACKEND_UNSUPPORTED'],
  ['relative state',c=>{c.stateDir='state'},'ABSOLUTE_PATH_REQUIRED'],
  ['same workspace',c=>{c.workspaceDir=c.stateDir},'STATE_MUST_BE_SEPARATE'],
  ['nested state',c=>{c.stateDir=c.workspaceDir+'/state'},'STATE_MUST_BE_SEPARATE'],
  ['missing model',c=>{delete c.model},'MODEL_REQUIRED'],
  ['missing provider',c=>{c.providers={}},'PROVIDER_PROFILE_REQUIRED'],
  ['public API',c=>{c.resident={host:'0.0.0.0'}},'HTTP_REQUIRES_LOOPBACK'],
  ['inconsistent DWS flags',c=>{c.resident={dws:{enabled:false,writesAuthorized:true}}},'NIGHT_BOT_RESIDENT_CONFIG_UNSUPPORTED:dws'],
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
  const root=await mkdtemp(join(tmpdir(),'night-config-'))
  try {const c=valid();mutate(c);const path=join(root,'config.json');await writeFile(path,JSON.stringify(c));await assert.rejects(loadConfig(path),new RegExp(code))}
  finally {await rm(root,{recursive:true,force:true})}
})
test('configuration keeps disabled transport and provider env reference',async()=>{
  const root=await mkdtemp(join(tmpdir(),'night-config-'))
  try {const path=join(root,'config.json');await writeFile(path,JSON.stringify(valid()));assert.deepEqual(await loadConfig(path),valid())}
  finally {await rm(root,{recursive:true,force:true})}
})

test('configuration preserves explicit native web selection and anonymous HTTP limits',async()=>{const root=await mkdtemp(join(tmpdir(),'night-config-'));try{const config={...valid(),web:{fetchProvider:'http',searchProvider:'search'},webFetch:{timeoutMs:1000,maxRedirects:2,maxResponseBytes:1024,maxBodyChars:1000,userAgent:'fixture-agent'}},path=join(root,'config.json');await writeFile(path,JSON.stringify(config));assert.deepEqual(await loadConfig(path),config)}finally{await rm(root,{recursive:true,force:true})}})

test('configuration preserves explicit official file resource limits',async()=>{const root=await mkdtemp(join(tmpdir(),'night-config-'));try{const config={...valid(),fileTools:{maxBufferedBytes:10485760,maxEditBytes:2097152,windowMaxScanBytes:33554432}},path=join(root,'config.json');await writeFile(path,JSON.stringify(config));assert.deepEqual(await loadConfig(path),config)}finally{await rm(root,{recursive:true,force:true})}})

const runFile=promisify(execFile)
const cli=(name,...args)=>runFile(process.execPath,[fileURLToPath(new URL('../bin/'+name,import.meta.url)),...args],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,
  env:{...process.env,NIGHT_CONFIG_FIXTURE_KEY:'fixture-key-must-not-be-read'},
})
const cliJson=async(name,...args)=>JSON.parse((await cli(name,...args)).stdout)
async function configurationFixture(t){
  const root=await mkdtemp(join(tmpdir(),'night-config-cli-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const install=join(root,'install')
  const initialized=await cliJson('night-bot-init.js','--root',install,'--actor','fixture-actor',
    '--provider','fixture','--model','fixture-first','--api','openai-completions',
    '--base-url','http://127.0.0.1:9/v1','--key-env','NIGHT_CONFIG_FIXTURE_KEY')
  assert.equal(initialized.ok,true)
  assert.equal(initialized.channelWritesEnabled,false)
  assert.equal(initialized.config,join(install,'data','config','config.json'))
  return {root,install,file:initialized.config,read:async()=>JSON.parse(await readFile(initialized.config,'utf8'))}
}
// --check 连目录成员、权限和修改时间都不能改变，不只比较配置正文。
async function configurationSnapshot(root){
  const rows=[]
  async function visit(path,name){
    const stat=await lstat(path)
    rows.push({name,mode:stat.mode,ino:stat.ino,dev:stat.dev,nlink:stat.nlink,mtimeMs:stat.mtimeMs,
      ...(stat.isFile()?{bytes:(await readFile(path)).toString('base64')}:{})})
    if(stat.isDirectory()&&!stat.isSymbolicLink())for(const entry of (await readdir(path)).sort())await visit(join(path,entry),name+'/'+entry)
  }
  await visit(root,'.')
  return rows
}

test('配置CLI真实初始化、零副作用check及model/web保存重读，不读取密钥或启动渠道',async t=>{
  const f=await configurationFixture(t),initial=await f.read(),before=await configurationSnapshot(f.root)
  assert.deepEqual(initial.model,{provider:'fixture',model:'fixture-first'})
  assert.equal(initial.providers.fixture.apiKeyEnv,'NIGHT_CONFIG_FIXTURE_KEY')
  assert.ok(initial.channelPlugins.every(row=>row.enabled===false))
  const modelArgs=[f.file,'model','--provider','fixture','--model','fixture-next',
    '--api','openai-completions','--base-url','http://127.0.0.1:9/v2','--key-env','NIGHT_CONFIG_FIXTURE_KEY']
  const webArgs=[f.file,'web','--enabled','true','--host','0.0.0.0','--port','3080',
    '--public-origin','http://127.0.0.1:49123','--channel-id','fixture-web','--sender-id','fixture-actor','--operator-name','隔离配置验收']
  const checkedModel=await cliJson('night-bot-config.js',...modelArgs,'--check')
  const checkedWeb=await cliJson('night-bot-config.js',...webArgs,'--check')
  for(const result of [checkedModel,checkedWeb]){
    assert.equal(result.checkOnly,true);assert.equal(result.changed,true);assert.equal(result.restartRequired,true)
  }
  assert.deepEqual(await configurationSnapshot(f.root),before)
  assert.deepEqual(await f.read(),initial)
  for(const args of [modelArgs,webArgs]){
    const result=await cliJson('night-bot-config.js',...args)
    assert.equal(result.checkOnly,false);assert.equal(result.changed,true);assert.equal(result.restartRequired,true)
  }
  const saved=await f.read(),loaded=await loadConfig(f.file),shown=await cliJson('night-bot-config.js',f.file,'show')
  assert.deepEqual(saved.model,{provider:'fixture',model:'fixture-next'})
  assert.equal(saved.providers.fixture.baseURL,'http://127.0.0.1:9/v2')
  assert.deepEqual(saved.providers.fixture.models.map(row=>row.id),['fixture-first','fixture-next'])
  assert.deepEqual(shown.model,saved.model)
  assert.deepEqual(shown.providers.fixture,{api:'openai-completions',baseURL:'http://127.0.0.1:9/v2',apiKeyEnv:'NIGHT_CONFIG_FIXTURE_KEY'})
  assert.deepEqual(saved.channelPlugins.find(row=>row.channelId==='fixture-web'),{
    type:'web-console',enabled:true,channelId:'fixture-web',config:{host:'0.0.0.0',port:3080,
      senderId:'fixture-actor',publicOrigin:'http://127.0.0.1:49123',operatorName:'隔离配置验收'},
  })
  assert.deepEqual(loaded.channelPlugins,saved.channelPlugins)
  assert.deepEqual(saved.channelPlugins.filter(row=>row.type!=='web-console'),initial.channelPlugins)
  assert.doesNotMatch(JSON.stringify({saved,shown}),/fixture-key-must-not-be-read/)
  const stable=await configurationSnapshot(f.root)
  await assert.rejects(cli('night-bot-init.js','--root',f.install,'--actor','fixture-actor',
    '--provider','fixture','--model','fixture-first','--api','openai-completions',
    '--base-url','http://127.0.0.1:9/v1','--key-env','NIGHT_CONFIG_FIXTURE_KEY'),error=>/EEXIST/.test(error.stderr))
  assert.deepEqual(await configurationSnapshot(f.root),stable,'再次初始化不能覆盖现有配置')
})

test('配置CLI拒绝秘密URL、非受控配置及目录别名，公开监听仍需固定Origin',async t=>{
  const f=await configurationFixture(t),before=await configurationSnapshot(f.root)
  for(const url of ['http://fixture:fixture-password@127.0.0.1:9/v1','http://127.0.0.1:9/v1?api_key=fixture-secret']){
    await assert.rejects(cli('night-bot-config.js',f.file,'model','--base-url',url,'--check'),
      error=>/SETTINGS_INPUT_INVALID/.test(error.stderr))
    assert.deepEqual(await configurationSnapshot(f.root),before)
  }
  for(const extra of [[],['--public-origin','http://untrusted.invalid:3080'],['--public-origin','http://127.0.0.1:3080/path']]){
    await assert.rejects(cli('night-bot-config.js',f.file,'web','--enabled','true','--host','0.0.0.0',...extra,'--check'),
      error=>/WEB_PUBLIC_ORIGIN_(?:REQUIRED|INVALID)/.test(error.stderr))
    assert.deepEqual(await configurationSnapshot(f.root),before)
  }
  const outside=join(f.root,'outside.json')
  await writeFile(outside,await readFile(f.file))
  const withOutside=await configurationSnapshot(f.root)
  await assert.rejects(cli('night-bot-config.js',outside,'model','--model','fixture-next'),
    error=>/NIGHT_BOT_CONFIG_PATH_UNSAFE/.test(error.stderr))
  assert.deepEqual(await configurationSnapshot(f.root),withOutside)
  const directory=join(f.install,'data','config'),actual=join(f.install,'data','configuration-storage')
  await rename(directory,actual)
  await symlink(actual,directory,process.platform==='win32'?'junction':'dir')
  const aliased=await configurationSnapshot(f.root)
  await assert.rejects(cli('night-bot-config.js',f.file,'model','--model','fixture-next'),
    error=>/NIGHT_BOT_CONFIG_PATH_UNSAFE/.test(error.stderr))
  assert.deepEqual(await configurationSnapshot(f.root),aliased)
})

test('渠道loader每enabled实例只校验一次，disabled模块不执行且异步validator失败关闭',async t=>{
  const root=await mkdtemp(join(tmpdir(),'night-config-loader-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const marker=join(root,'validation.txt'),disabledMarker=join(root,'disabled.txt')
  async function plugin(type,body){
    const directory=join(root,'plugins',type)
    await mkdir(directory,{recursive:true})
    await writeFile(join(directory,'night-channel.json'),JSON.stringify({apiVersion:1,type,entry:'entry.mjs'}))
    await writeFile(join(directory,'entry.mjs'),body)
    return pathToFileURL(join(directory,'entry.mjs')).href
  }
  const entry=await plugin('fixture-sync',`import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(marker)},'loaded;');
export function validateConfig(config){appendFileSync(${JSON.stringify(marker)},'validate:'+config.id+';');return {normalized:config.id}}`)
  await plugin('fixture-disabled',`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(disabledMarker)},'unexpected');throw Error('disabled module loaded')`)
  await plugin('fixture-async','export function validateConfig(){return Promise.resolve({normalized:true})}')
  const config={channelPluginDirs:['plugins'],channelPlugins:[
    {type:'fixture-disabled',enabled:false,channelId:'disabled',config:{}},
    {type:'fixture-sync',enabled:true,channelId:'first',config:{id:'first'}},
    {type:'fixture-sync',enabled:true,channelId:'second',config:{id:'second'}},
  ]}
  const rows=await channelPluginRows(config,{installRoot:root})
  assert.deepEqual(rows,[{name:entry,config:{normalized:'first',enabled:true,channelId:'first',receivePaused:false}},
    {name:entry,config:{normalized:'second',enabled:true,channelId:'second',receivePaused:false}}])
  assert.equal(await readFile(marker,'utf8'),'loaded;validate:first;validate:second;')
  await assert.rejects(lstat(disabledMarker),{code:'ENOENT'})
  await assert.rejects(channelPluginRows({channelPluginDirs:['plugins'],channelPlugins:[
    {type:'fixture-async',enabled:true,channelId:'async',config:{}},
  ]},{installRoot:root}),/NIGHT_CHANNEL_PLUGIN_CONFIG_INVALID/)
  await assert.rejects(channelPluginRows({channelPluginDirs:['plugins'],channelPlugins:[
    {type:'fixture-sync',enabled:true,channelId:'unsupported-pause',receivePaused:true,config:{id:'unsupported-pause'}},
  ]},{installRoot:root}),/NIGHT_CHANNEL_PLUGIN_INGRESS_CONTROL_UNSUPPORTED/)
  const pausedEntry=await plugin('fixture-pausable','export const channelIngressControl=1; export const validateConfig=config=>config')
  const pausedRows=await channelPluginRows({channelPluginDirs:['plugins'],channelPlugins:[
    {type:'fixture-pausable',enabled:true,channelId:'paused',receivePaused:true,config:{receivePaused:false}},
  ]},{installRoot:root})
  assert.deepEqual(pausedRows,[{name:pausedEntry,config:{enabled:true,channelId:'paused',receivePaused:true}}])
})
