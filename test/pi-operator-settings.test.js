import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {mkdtemp,readFile,writeFile,mkdir,rm,stat,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import NativeCredentials from '../src/native-credentials.js'
import {createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {loadConfig} from '../src/config.js'
import {createOperatorSettings} from '../src/settings/operator.js'
import {piAuthentication} from '../src/pi-provider-auth.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {channelPluginRows} from '../src/channels/loader.js'
async function fixture(t,layers=[]){
 const root=await mkdtemp(join(tmpdir(),'night-settings-')),paths=runtimePaths({installRoot:root,dataDir:'data'});await prepareRuntimePaths(paths)
 const file=join(paths.config,'config.json');await writeFile(file,JSON.stringify({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'initial'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'FIXTURE_KEY',models:[{id:'initial'}]}},channelPluginDirs:['plugins']}),{mode:0o600})
 await mkdir(join(root,'plugins','custom'),{recursive:true})
 await writeFile(join(root,'plugins/custom/night-channel.json'),JSON.stringify({apiVersion:1,type:'fixture-custom',entry:'index.js',displayName:'自定义插件',webConfig:{fields:[{name:'room',label:'会话',type:'string',required:true},{name:'credential',label:'凭据引用',type:'credential-ref'}]}}))
 await writeFile(join(root,'plugins/custom/index.js'),`import {writeFileSync} from 'node:fs';writeFileSync(new URL('./executed',import.meta.url),'imported');export const validateConfig=value=>{if(!value.room)throw Error('invalid');return value};export function apply(){}`)
 const ctx=new Context();ctx.provide('launchEnvironment',createLaunchEnvironmentSnapshot(layers));await ctx.plugin(NativeCredentials,{path:paths.credentials,watch:false})
 const running=await loadConfig(file),port=createOperatorSettings({file,paths,running,getCredentials:()=>ctx.credentials})
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 return {root,file,paths,ctx,port,running}
}
test('设置分离凭据与配置，Pi解析使用新Key，Github只读状态不含值，清除与重启持久化',async t=>{
 const f=await fixture(t),initial=await f.port.view();assert.deepEqual(initial.appearance,{name:'Night Bot',icon:'moon'})
 await f.port.saveModel({expectedVersion:initial.version,model:'new-model',api:'openai-completions',baseURL:'https://model.example.invalid/v1'})
 let view=await f.port.view();assert.equal(view.restartRequired,true);assert.equal(view.model.provider,'web-model')
 const fake='TEST_MODEL_SECRET_NEVER_REFLECT';await f.port.saveSecret('model',{expectedVersion:view.version,action:'replace',value:fake,confirm:true})
 const auth=piAuthentication({getCredentials:()=>f.ctx.credentials});assert.equal(await auth.resolveApiKey(JSON.parse(await readFile(f.file,'utf8')).providers['web-model']),fake)
 const github='TEST_GITHUB_SECRET_NEVER_REFLECT';await f.port.saveSecret('github',{expectedVersion:view.version,action:'replace',value:github,confirm:true})
 assert.equal(f.ctx.credentials.resolveCurrent('GITHUB_TOKEN').value,github)
 assert.equal((await f.port.view()).secrets.github.configured,true)
 assert.doesNotMatch(JSON.stringify(await f.port.view()),/TEST_MODEL|TEST_GITHUB/)
 assert.doesNotMatch(await readFile(f.file,'utf8'),/TEST_MODEL|TEST_GITHUB/)
 if(process.platform!=='win32')assert.equal((await stat(f.paths.credentials)).mode&0o777,0o600)
 await f.port.saveAppearance({expectedVersion:view.version,name:'我的助手',icon:'robot'})
 await f.ctx.fiber.dispose()
 const coldContext=new Context();coldContext.provide('launchEnvironment',createLaunchEnvironmentSnapshot([]));await coldContext.plugin(NativeCredentials,{path:f.paths.credentials,watch:false})
 try{
 const cold=createOperatorSettings({file:f.file,paths:f.paths,running:await loadConfig(f.file),getCredentials:()=>coldContext.credentials});assert.deepEqual((await cold.view()).appearance,{name:'我的助手',icon:'robot'});assert.equal((await cold.view()).restartRequired,false)
 assert.equal(coldContext.credentials.resolveCurrent('GITHUB_TOKEN').value,github)
 assert.equal(await piAuthentication({getCredentials:()=>coldContext.credentials}).resolveApiKey((await loadConfig(f.file)).providers['web-model']),fake)
 view=await cold.view();await cold.saveSecret('github',{expectedVersion:view.version,action:'clear',confirm:true});assert.equal((await cold.view()).secrets.github.configured,false)
 }finally{await coldContext.fiber.dispose()}
 assert.equal(resolvePiProfiles((await loadConfig(f.file)).providers).get('web-model').models[0].id,'new-model')
})
test('无确认、外部环境只读、陈旧版本、恶意图标/地址和注入字段均拒绝且不写',async t=>{
 const f=await fixture(t,[{source:'process',values:{GITHUB_TOKEN:'TEST_ENV_KEY'}}]),view=await f.port.view(),before=await readFile(f.file,'utf8')
 assert.equal(view.secrets.github.writable,false)
 await assert.rejects(f.port.saveSecret('github',{expectedVersion:view.version,action:'clear',confirm:true}),{code:'SETTINGS_SECRET_READ_ONLY'})
 await assert.rejects(f.port.saveSecret('model',{expectedVersion:view.version,action:'replace',value:'TEST_KEY'}),{code:'SETTINGS_INPUT_INVALID'})
 for(const icon of ['../../secret','https://host/icon.svg','<svg>'])await assert.rejects(f.port.saveAppearance({name:'x',icon,expectedVersion:view.version}),{code:'SETTINGS_INPUT_INVALID'})
 for(const baseURL of ['http://remote.invalid','https://user:pass@host/v1','https://host/v1?api_key=SECRET','file:///tmp/secret'])await assert.rejects(f.port.saveModel({model:'x',api:'openai-completions',baseURL,expectedVersion:view.version}),{code:'SETTINGS_INPUT_INVALID'})
 await assert.rejects(f.port.saveAppearance({name:'x',icon:'moon',expectedVersion:'stale'}),{code:'SETTINGS_VERSION_CONFLICT'})
 assert.equal(await readFile(f.file,'utf8'),before)
})
test('发现不执行插件，只对声明表单配置自定义渠道，引用不含密钥，重启后正常加载统一插件',async t=>{
 const f=await fixture(t);await mkdir(join(f.root,'plugins/readonly'));await writeFile(join(f.root,'plugins/readonly/night-channel.json'),JSON.stringify({apiVersion:1,type:'fixture-readonly',entry:'index.js'}));await writeFile(join(f.root,'plugins/readonly/index.js'),'export function apply(){}');const plugins=await f.port.plugins();assert.equal(plugins.items[0].type,'fixture-custom');assert.equal(plugins.items[0].configurable,true);assert.equal(plugins.items.find(row=>row.type==='fixture-readonly').configurable,false);await assert.rejects(access(join(f.root,'plugins/custom/executed')));await assert.rejects(f.port.saveChannel({type:'fixture-readonly',channelId:'unsupported',enabled:false,config:{},expectedVersion:plugins.version}),{code:'CHANNEL_WEB_CONFIGURATION_UNSUPPORTED'})
 await f.port.saveChannel({type:'fixture-custom',channelId:'custom-room',enabled:false,config:{room:'room-one',credential:'FIXTURE_CUSTOM_KEY'},expectedVersion:plugins.version})
 let next=await f.port.plugins();assert.equal(next.channels[0].editable,true)
 await assert.rejects(f.port.saveChannel({type:'fixture-custom',channelId:'custom-room',createOnly:true,enabled:true,config:{room:'x',credential:'raw-secret-with-dash',forged:true},expectedVersion:next.version}),{code:'SETTINGS_INPUT_INVALID'})
 await f.port.saveChannel({type:'fixture-custom',channelId:'custom-room',enabled:true,config:{room:'room-one',credential:'FIXTURE_CUSTOM_KEY'},expectedVersion:next.version})
 await assert.rejects(access(join(f.root,'plugins/custom/executed')));const config=await loadConfig(f.file),rows=await channelPluginRows(config,f.paths);await access(join(f.root,'plugins/custom/executed'));assert.equal(rows.length,1);assert.equal(rows[0].config.channelId,'custom-room');assert.equal(rows[0].config.credential,'FIXTURE_CUSTOM_KEY');assert.equal(rows[0].config.room,'room-one');assert.equal(rows[0].config.dingtalk_group_id,undefined)
 next=await f.port.plugins();await assert.rejects(f.port.saveChannel({type:'fixture-custom',channelId:'custom-room',enabled:false,config:{room:'other'},expectedVersion:next.version}),{code:'CHANNEL_EDIT_REQUIRES_STOP'})
})

test('已保存GitHub及可信业务凭据仅在获准full shell启动边界使用，私有命名空间和执行历史不泄露',{skip:process.platform!=='linux'},async t=>{
 const {nativeTaskHost}=await import('./fixtures/routing-official-host.js'),{createHash}=await import('node:crypto')
 const root=await mkdtemp(join(tmpdir(),'night-settings-full-shell-')),token='TEST_SAVED_GITHUB_'+Date.now(),hash=createHash('sha256').update(token).digest('hex');let h,step=0
 const inherited={UNRELATED_FIXTURE_SECRET:'TEST_OTHER_SECRET',NIGHT_BOT_FIXTURE_SECRET:'TEST_PRIVATE_NIGHT_SECRET',DSH_FIXTURE_TOKEN:'TEST_PRIVATE_DSH_TOKEN'},businessHash=createHash('sha256').update(inherited.UNRELATED_FIXTURE_SECRET).digest('hex')
 t.after(async()=>{await h?.close();await rm(root,{recursive:true,force:true})})
 const script=`const c=require('node:crypto'); console.log(JSON.stringify({matches:c.createHash('sha256').update(process.env.GITHUB_TOKEN||'').digest('hex')==='${hash}',businessMatches:c.createHash('sha256').update(process.env.UNRELATED_FIXTURE_SECRET||'').digest('hex')==='${businessHash}',privateAbsent:process.env.NIGHT_BOT_FIXTURE_SECRET===undefined&&process.env.DSH_FIXTURE_TOKEN===undefined}))`
 h=await nativeTaskHost(root,request=>!request.tools.some(tool=>tool.name==='task_result')?[]:[step++===0?{name:'bash',args:{description:'Check fixture environment using booleans only',command:`node -e '${script.replaceAll("'","'\\''")}'`}}:{name:'task_result',args:{decision:{action:'complete',summary:'Checked fixture credentials',evidence:['boolean output'],limitations:[]}}}],{permissionMode:'full',inheritedEnvironment:inherited})
 await h.ctx.credentials.set('GITHUB_TOKEN',token)
 const created=await h.service.createTask({requestId:'settings-credential-full',objective:'Check fixture credential without disclosure'});await h.service.whenIdle()
 const task=await h.query('task.get',{taskId:created.taskId}),result=h.toolResults.find(row=>row.sessionId===task.sessionId&&row.name==='bash')?.result
 assert.ok(result);assert.equal(result.isError,false,JSON.stringify(result));assert.deepEqual(JSON.parse(result.value.stdout.text),{matches:true,businessMatches:true,privateAbsent:true})
 const native=await h.ctx.sessionPersistence.readNative(task.sessionId,{requireComplete:true}),recorded=JSON.stringify({entries:native.entries,requests:h.requests,tools:h.toolResults,jobs:h.ctx.get('jobs').list(task.sessionId)})
 for(const value of [token,...Object.values(inherited)])assert.equal(recorded.includes(value),false)
})

test('网页保存自定义配置后真实Host发现并启动插件，渠道身份、名称和fake外发沿统一协议',async t=>{
 const f=await fixture(t)
 await writeFile(join(f.root,'plugins/custom/index.js'),`export const inject=['channels'];export const validateConfig=value=>{if(!value.room)throw Error('invalid');return value};export function apply(ctx,config){const sent=[];const stop=ctx.channels.registerTransport(config.channelId,{capabilities:{conversationTypes:['chat-room']},send:async envelope=>{sent.push(envelope);return {messageId:'fake-custom-reply'}},readback:async()=>({messageId:'fake-custom-reply'})});ctx.provide('customSettingsProbe',{sent,ingest:input=>ctx.channels.receive({...input,type:'chat-room',channelId:config.channelId,conversationId:config.room,conversationName:'自定义测试群'})});ctx.effect(()=>stop)}`)
 let view=await f.port.plugins();await f.port.saveChannel({type:'fixture-custom',channelId:'custom-room',createOnly:true,enabled:true,config:{room:'configured-room',credential:'FIXTURE_CUSTOM_KEY'},expectedVersion:view.version})
 await f.ctx.fiber.dispose()
 const {createHost}=await import('../src/host.js'),host=await createHost(await loadConfig(f.file),{environmentOptions:{inherited:{}}});
 try{
 const inputs=[],channels=host.ctx.channels
 channels.attachIngress(async input=>{const identity=await channels.registerConversation(input);inputs.push({input,identity});return {accepted:true}})
 await host.ctx.customSettingsProbe.ingest({senderId:'custom-member',senderName:'自定义成员',messageId:'fake-in-1',text:'fixture message',conversationId:'must-not-override-target'})
 const {input,identity}=inputs[0];assert.equal(input.conversationId,'configured-room');assert.equal(input.channelId,'custom-room');assert.equal(input.senderName,'自定义成员')
 assert.equal(channels.groupContext(identity.sessionId).conversationName,'自定义测试群')
 const ack=await channels.transportCall('send',{id:'fake-out-1',payload:{conversationId:identity.sessionId,actorId:identity.principal,text:'fixture reply',sourceMessageId:'fake-in-1'}})
 assert.equal(ack.messageId,'fake-custom-reply');assert.equal(host.ctx.customSettingsProbe.sent[0].channelId,'custom-room');assert.equal(host.ctx.customSettingsProbe.sent[0].conversationId,'configured-room')
 assert.equal(host.ctx.get('dingtalkChannel'),undefined)
 }finally{await host.close()}
})

test('模型路由变更与密钥保存共享配置锁，密钥始终绑定用户确认的路由',async t=>{
 const f=await fixture(t),view=await f.port.view(),entered=Promise.withResolvers(),release=Promise.withResolvers(),store=f.ctx.credentials
 const port=createOperatorSettings({file:f.file,paths:f.paths,running:f.running,getCredentials:()=>({describe:ref=>store.describe(ref),set:async(ref,value)=>{entered.resolve();await release.promise;return store.set(ref,value)}})})
 const secret=port.saveSecret('model',{expectedVersion:view.version,action:'replace',value:'TEST_OLD_ROUTE_KEY',confirm:true});await entered.promise
 const model=f.port.saveModel({expectedVersion:view.version,model:'new-route-model',api:'openai-completions',baseURL:'https://other.example.invalid/v1'})
 release.resolve();await Promise.all([secret,model])
 assert.equal(store.resolveCurrent('FIXTURE_KEY').value,'TEST_OLD_ROUTE_KEY');assert.equal(store.resolveCurrent('NIGHT_WEB_MODEL_API_KEY'),undefined)
 assert.equal((await f.port.view()).model.provider,'web-model');assert.equal((await f.port.view()).secrets.model.configured,false)
})

test('保存模型及Key后冷启动真实Host使用新Pi路由，不发模型请求',async t=>{
 const f=await fixture(t),view=await f.port.view();await f.port.saveModel({expectedVersion:view.version,model:'cold-model',api:'openai-responses',baseURL:'https://never-contact.example.invalid/v1'})
 const saved=await f.port.view();await f.port.saveSecret('model',{expectedVersion:saved.version,action:'replace',value:'TEST_COLD_MODEL_KEY',confirm:true});await f.ctx.fiber.dispose()
 const {createHost}=await import('../src/host.js'),host=await createHost(await loadConfig(f.file),{environmentOptions:{inherited:{}}})
 try{const model=await host.ctx.nativePiProvider.official.resolve({provider:'web-model',model:'cold-model'});assert.equal(model.model.id,'cold-model');assert.equal(model.model.api,'openai-responses');assert.equal(model.model.baseUrl,'https://never-contact.example.invalid/v1');assert.equal(host.ctx.credentials.resolveCurrent('NIGHT_WEB_MODEL_API_KEY').value,'TEST_COLD_MODEL_KEY')}
 finally{await host.close()}
})


test('通用新增渠道拒绝已有标识而不改写，停用编辑仍使用原协议', async t=>{
 const f=await fixture(t);let view=await f.port.plugins();
 const input={type:'fixture-custom',channelId:'create-only-room',enabled:false,config:{room:'original-room'},createOnly:true,expectedVersion:view.version};
 await f.port.saveChannel(input);view=await f.port.plugins();const before=await readFile(f.file,'utf8');
 await assert.rejects(f.port.saveChannel({...input,config:{room:'must-not-replace'},expectedVersion:view.version}),{code:'CHANNEL_INSTANCE_EXISTS'});
 assert.equal(await readFile(f.file,'utf8'),before);
 await assert.rejects(f.port.saveChannel({...input,createOnly:'true',expectedVersion:view.version}),{code:'SETTINGS_INPUT_INVALID'});
 await f.port.saveChannel({...input,createOnly:false,config:{room:'edited-room'},expectedVersion:view.version});
 assert.equal((await f.port.plugins()).channels.find(row=>row.channelId===input.channelId).config.room,'edited-room');
});

test('三个角色模型独立持久化、真实 Pi 能力目录、版本冲突与默认深度恢复',async t=>{
 const f=await fixture(t),config=JSON.parse(await readFile(f.file,'utf8'))
 config.providers.reasoning={api:'openai-completions',baseURL:'https://never-contact.invalid/v1',headers:{'x-private':'PRIVATE_HEADER'},apiKeyEnv:'PRIVATE_CREDENTIAL_REF',models:[{id:'thinking',reasoningEfforts:{off:null,low:'low',high:'high'}},{id:'plain'}]}
 await writeFile(f.file,JSON.stringify(config))
 let view=await f.port.view()
 assert.equal(view.roleModels.roles.length,3)
 assert.deepEqual(view.roleModels.catalog.find(row=>row.provider==='reasoning').models.find(row=>row.id==='thinking').reasoningEfforts,['off','low','high'])
 assert.doesNotMatch(JSON.stringify(view.roleModels),/PRIVATE_HEADER|PRIVATE_CREDENTIAL_REF|never-contact/)
 const original=view.version
 for(const [role,reasoningEffort]of [['triage','low'],['router','high'],['task','model-default']]){
  const result=await f.port.saveRoleModel({role,provider:'reasoning',model:'thinking',reasoningEffort,expectedVersion:view.version})
  assert.equal(result.ok,true);assert.equal(result.role.role,role);assert.equal(result.changed,true)
  view=await f.port.view();assert.equal(view.version,result.version);assert.equal(view.roleModels.roles.find(row=>row.role===role).running.provider,'fixture')
 }
 const saved=JSON.parse(await readFile(f.file,'utf8'));assert.deepEqual(saved.roleModels,{triage:{provider:'reasoning',model:'thinking',reasoningEffort:'low'},router:{provider:'reasoning',model:'thinking',reasoningEffort:'high'},task:{provider:'reasoning',model:'thinking'}})
 await assert.rejects(f.port.saveRoleModel({role:'triage',provider:'reasoning',model:'thinking',reasoningEffort:'high',expectedVersion:original}),{code:'SETTINGS_VERSION_CONFLICT'})
 await assert.rejects(f.port.saveRoleModel({role:'task',provider:'reasoning',model:'plain',reasoningEffort:'high',expectedVersion:view.version}),{code:'UNSUPPORTED_REASONING_EFFORT'})
 await assert.rejects(f.port.saveRoleModel({role:'task',provider:'reasoning',model:'plain',reasoningEffort:'model-default'}),{code:'SETTINGS_INPUT_INVALID'})
 await f.port.saveRoleModel({role:'triage',provider:'reasoning',model:'thinking',reasoningEffort:'model-default',expectedVersion:view.version})
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).roleModels.triage.reasoningEffort,undefined)
 assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')).model,saved.model)
})

test('角色模型展示真实运行选择与环境来源，冲突环境在保存后明确报告而非丢失回执',async t=>{
 const f=await fixture(t),config=JSON.parse(await readFile(f.file,'utf8'))
 config.providers.fixture.models.push({id:'thinking',reasoningEfforts:{low:'low',high:'high'}})
 config.roleModels={triage:{provider:'fixture',model:'thinking',reasoningEffort:'low'}}
 await writeFile(f.file,JSON.stringify(config))
 const environment=createLaunchEnvironmentSnapshot([{source:'project-env',path:'/PRIVATE_ENV_PATH',values:{NIGHT_BOT_TRIAGE_REASONING_EFFORT:'high'}}])
 const port=createOperatorSettings({file:f.file,paths:f.paths,running:config,getCredentials:()=>f.ctx.credentials,getEnvironment:()=>environment,getRuntimeRoleModels:()=>({triage:{provider:'fixture',model:'thinking',reasoningEffort:'high'},router:{provider:'fixture',model:'initial'},task:{provider:'fixture',model:'initial'}})})
 let view=await port.view(),row=view.roleModels.roles.find(row=>row.role==='triage')
 assert.equal(row.saved.reasoningEffort,'low');assert.equal(row.running.reasoningEffort,'high');assert.equal(row.nextStart.reasoningEffort,'high');assert.equal(row.restartRequired,false)
 assert.deepEqual(row.environmentOverrides,[{name:'NIGHT_BOT_TRIAGE_REASONING_EFFORT',source:'project-env'}]);assert.doesNotMatch(JSON.stringify(view),/PRIVATE_ENV_PATH/)
 const receipt=await port.saveRoleModel({role:'triage',provider:'fixture',model:'initial',reasoningEffort:'model-default',expectedVersion:view.version})
 assert.equal(receipt.ok,true);assert.equal(receipt.role.environmentError,true);assert.equal(receipt.role.nextStart,null)
 view=await port.view();assert.equal(view.roleModels.roles.find(row=>row.role==='triage').environmentError,true)
})

test('网页全局模型保存保留角色所引用的旧 web-model 模型',async t=>{
 const f=await fixture(t);let view=await f.port.view()
 await f.port.saveModel({expectedVersion:view.version,model:'old',api:'openai-completions',baseURL:'https://never-contact.invalid/v1'});view=await f.port.view()
 await f.port.saveRoleModel({expectedVersion:view.version,role:'router',provider:'web-model',model:'old',reasoningEffort:'model-default'});view=await f.port.view()
 await f.port.saveModel({expectedVersion:view.version,model:'new',api:'openai-completions',baseURL:'https://never-contact.invalid/v1'})
 const saved=JSON.parse(await readFile(f.file,'utf8'));assert.deepEqual(saved.providers['web-model'].models.map(row=>row.id),['old','new']);assert.equal(saved.roleModels.router.model,'old')
})

test('模型默认深度在冷启后不虚报待重启，省略角色沿用实际持久默认',async t=>{
 const f=await fixture(t),config=JSON.parse(await readFile(f.file,'utf8'))
 config.providers.fixture.models.push({id:'thinking',reasoningEfforts:{low:'low',medium:'medium',high:'high'}})
 config.roleModels={triage:{provider:'fixture',model:'thinking'}}
 await writeFile(f.file,JSON.stringify(config))
 const live={triage:{provider:'fixture',model:'thinking',reasoningEffort:'medium'},router:{provider:'fixture',model:'thinking',reasoningEffort:'high'},task:{provider:'fixture',model:'thinking',reasoningEffort:'low'}}
 const port=createOperatorSettings({file:f.file,paths:f.paths,running:config,getCredentials:()=>f.ctx.credentials,getRoleModels:()=>({triage:live.triage}),getRuntimeRoleModels:()=>live,getFallbackRoleModels:()=>({...live,triage:live.router})})
 const view=await port.view()
 assert.equal(view.roleModels.roles.find(row=>row.role==='triage').saved.reasoningEffort,undefined)
 for(const row of view.roleModels.roles){assert.equal(row.restartRequired,false);assert.deepEqual(row.running,row.nextStart)}
 assert.equal(view.restartRequired,false)
})

test('provider-scoped secrets target selected route only, preserve defaults, redact and reject stale writes',async t=>{
 const f=await fixture(t),initial=await f.port.modelCatalog()
 await f.port.saveProvider({action:'create',provider:'second',model:'second-model',api:'openai-completions',baseURL:'https://fixture.invalid/v1',expectedVersion:initial.version})
 const view=await f.port.modelCatalog(),before=await readFile(f.file,'utf8'),auth=piAuthentication({getCredentials:()=>f.ctx.credentials})
 await f.port.saveSecret('model',{provider:'fixture',expectedVersion:view.version,action:'replace',value:'FIRST_SECRET',confirm:true})
 await f.port.saveSecret('model',{provider:'second',expectedVersion:view.version,action:'replace',value:'SECOND_SECRET',confirm:true})
 const config=JSON.parse(before)
 assert.equal(await auth.resolveApiKey(config.providers.fixture),'FIRST_SECRET')
 assert.equal((await auth.credentials.read('second')).key,'SECOND_SECRET')
 assert.equal(await readFile(f.file,'utf8'),before)
 const states=await f.port.modelCatalog();assert.ok(states.providers.every(row=>row.secret.configured));assert.doesNotMatch(JSON.stringify(states),/FIRST_SECRET|SECOND_SECRET|FIXTURE_KEY/)
 await assert.rejects(f.port.saveSecret('model',{provider:'missing',expectedVersion:view.version,action:'clear',confirm:true}),{code:'SETTINGS_INPUT_INVALID'})
 await assert.rejects(f.port.saveSecret('model',{provider:'second',expectedVersion:initial.version,action:'clear',confirm:true}),{code:'SETTINGS_VERSION_CONFLICT'})
 await f.port.saveSecret('model',{provider:'second',expectedVersion:view.version,action:'clear',confirm:true})
 assert.equal(await auth.resolveApiKey(config.providers.fixture),'FIRST_SECRET');assert.equal((await f.port.modelCatalog()).providers.find(row=>row.provider==='second').secret.configured,false)
 await f.port.saveSecret('model',{expectedVersion:view.version,action:'clear',confirm:true})
 assert.equal((await f.port.modelCatalog()).providers.find(row=>row.provider==='fixture').secret.configured,false)
})

test('provider credential metadata reports shared references and read-only environment sources',async t=>{
 const f=await fixture(t,[{source:'process',values:{FIXTURE_KEY:'ENV_SECRET'}}]),config=JSON.parse(await readFile(f.file,'utf8'))
 config.providers.shared=structuredClone(config.providers.fixture);await writeFile(f.file,JSON.stringify(config))
 const view=await f.port.modelCatalog()
 assert.deepEqual(view.providers[0].secret,{configured:true,writable:false,source:'environment',sharedWith:['shared']})
 assert.doesNotMatch(JSON.stringify(view),/ENV_SECRET|FIXTURE_KEY/)
 await assert.rejects(f.port.saveSecret('model',{provider:'shared',expectedVersion:view.version,action:'replace',value:'NEW_SECRET',confirm:true}),{code:'SETTINGS_SECRET_READ_ONLY'})
})
