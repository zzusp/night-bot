import {symlink} from './fixtures/filesystem-link.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,stat,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer,request} from 'node:http'
import {spawn} from 'node:child_process'
import {Context} from '@deepseek-ai/cordis'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {loadConfig} from '../src/config.js'
import {createLaunchEnvironmentSnapshot} from '../src/native-environment.js'
import NativeCredentials from '../src/native-credentials.js'
import {createOperatorSettings} from '../src/settings/operator.js'
import {runSettingsCli,requestLiveSettings} from '../src/settings/cli.js'
import {createSettingsCommands} from '../src/settings/commands.js'
import {createSettingsOperatorAuth,readSettingsOperatorToken,SETTINGS_OPERATOR_TOKEN_FILE} from '../src/settings/auth.js'
import {createEffectOperatorAuth,readEffectOperatorToken} from '../src/tasks/effect-operator-auth.js'
import {createSettingsHttp,safeSettingsError} from '../src/settings/http.js'
import {acquireLock} from '../src/runtime/files.js'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'night-settings-cli-')),paths=runtimePaths({installRoot:root,dataDir:'data'})
 await prepareRuntimePaths(paths)
 const file=join(paths.config,'config.json')
 await writeFile(file,JSON.stringify({installRoot:root,dataDir:'data',model:{provider:'fixture',model:'initial'},providers:{fixture:{api:'openai-completions',baseURL:'http://127.0.0.1:9/v1',apiKeyEnv:'FIXTURE_KEY',models:[{id:'initial'}]}},channelPluginDirs:['plugins']}),{mode:0o600})
 await mkdir(join(root,'plugins/custom'),{recursive:true})
 await writeFile(join(root,'plugins/custom/night-channel.json'),JSON.stringify({apiVersion:1,type:'fixture-custom',entry:'index.js',webConfig:{fields:[{name:'room',label:'Room',type:'string',required:true},{name:'credential',label:'Credential',type:'credential-ref'}]}}))
 await writeFile(join(root,'plugins/custom/index.js'),`throw Error('must never execute when configuring')`)
 const ctx=new Context();ctx.provide('launchEnvironment',createLaunchEnvironmentSnapshot([{source:'process',values:{}}]));await ctx.plugin(NativeCredentials,{path:paths.credentials,watch:false})
 const config=await loadConfig(file),settings=createOperatorSettings({file,paths,running:config,getCredentials:()=>ctx.credentials})
 t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})})
 const cli=(args,options={})=>runSettingsCli([file,...args],{environment:{},write:()=>{},...options})
 return {root,paths,file,config,settings,ctx,cli}
}
async function inventory(root){const result={};async function visit(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name),info=await stat(file);result[file]={mode:info.mode,mtime:info.mtimeMs,bytes:entry.isFile()?await readFile(file,'utf8'):null};if(entry.isDirectory())await visit(file)}}await visit(root);return result}
async function post(port,body,headers={}){return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:'/operator/settings',method:'POST',headers:{'content-type':'application/json',...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}))});req.on('error',reject);req.end(JSON.stringify(body))})}

test('headless appearance and credentials use the Web facade, CAS and redaction',async t=>{
 const f=await fixture(t),before=await f.settings.view()
 await f.cli(['appearance','--name','My bot','--icon','star','--expected-version',before.version])
 assert.deepEqual((await f.settings.view()).appearance,{name:'My bot',icon:'star'})
 await assert.rejects(f.cli(['appearance','--name','stale','--icon','moon','--expected-version',before.version]),{code:'SETTINGS_VERSION_CONFLICT'})
 const secret='FIXTURE_SECRET_DO_NOT_PRINT';let output=''
 const result=await f.cli(['secret','--kind','model','--action','replace','--confirm'],{interaction:{prompt:async()=>secret},write:value=>{output+=value}})
 assert.equal(result.state.configured,true);assert.ok(!output.includes(secret))
 await f.ctx.credentials.queueRefresh();assert.equal(f.ctx.credentials.resolveCurrent('FIXTURE_KEY').value,secret)
 await f.cli(['secret','--kind','model','--action','clear','--confirm']);await f.ctx.credentials.queueRefresh();assert.equal(f.ctx.credentials.resolveCurrent('FIXTURE_KEY'),undefined)
 await assert.rejects(f.cli(['secret','--kind','model','--action','replace','--value',secret]),/unknown option/i)
})

test('all supported --check settings and metadata reads are zero-write including credentials',async t=>{
 const f=await fixture(t),payload=join(f.root,'channel.json');await writeFile(payload,JSON.stringify({type:'fixture-custom',channelId:'draft-channel',enabled:true,config:{room:'room',credential:'FIXTURE_REF'}}))
 const before=await inventory(f.root)
 await f.cli(['show']);await f.cli(['plugins']);await f.cli(['channel-list']);await f.cli(['permissions-show'])
 await f.cli(['appearance','--name','Dry run','--icon','leaf','--check'])
 await f.cli(['secret','--kind','github','--action','replace','--confirm','--check'],{interaction:{prompt:async()=>'FIXTURE_DRY_SECRET'}})
 await f.cli(['channel-save','--json-file',payload,'--check'])
 await f.cli(['permissions-set','--mode','ask','--check'])
 await f.cli(['web','--enabled','false','--sender-id','operator','--check'])
 assert.deepEqual(await inventory(f.root),before)
})

test('offline writes respect Host lock, custom creation never imports adapters, edits need lifecycle',async t=>{
 const f=await fixture(t),release=await acquireLock(join(f.paths.runtime,'.host.lock'),{timeoutMs:0})
 try{await assert.rejects(f.cli(['appearance','--name','Blocked','--icon','moon']),{code:'NIGHT_DATA_IN_USE'})}finally{await release()}
 const payload=join(f.root,'channel.json');await writeFile(payload,JSON.stringify({type:'fixture-custom',channelId:'new-channel',enabled:true,config:{room:'new-room'},createOnly:true}))
 assert.equal((await f.cli(['channel-save','--json-file',payload])).liveApplied,false)
 const current=(await f.settings.plugins()).channels[0];assert.equal(current.config.room,'new-room')
 await writeFile(payload,JSON.stringify({...current,createOnly:false,config:{room:'different'}}))
 // Do not send display-only editable property through the strict transport.
 await writeFile(payload,JSON.stringify({type:current.type,channelId:current.channelId,enabled:current.enabled,config:{room:'different'}}))
 await assert.rejects(f.cli(['channel-save','--json-file',payload]),{code:'SETTINGS_RESIDENT_REQUIRED'})
 for(const action of ['channel-remove','channel-enable','dingtalk-add','dingtalk-edit','permission-respond'])await assert.rejects(f.cli([action]),{code:'SETTINGS_RESIDENT_REQUIRED'})
})

test('settings capability is private and cannot be replaced by effect capability',async t=>{
 const f=await fixture(t),settings=await createSettingsOperatorAuth(f.paths),token=await readSettingsOperatorToken(f.paths)
 const effects=await createEffectOperatorAuth(f.paths),effectToken=await readEffectOperatorToken(f.paths)
 assert.notEqual(token,effectToken);assert.equal(await settings.authorize({headers:{authorization:'Bearer '+effectToken}}),false);assert.equal(await effects.authorize({headers:{authorization:'Bearer '+token}}),false)
 assert.equal(await settings.authorize({headers:{authorization:'Bearer '+token},rawHeaders:['authorization','Bearer '+token,'Authorization','Bearer '+token]}),false)
 if(process.platform!=='win32'){const file=join(f.paths.secrets,SETTINGS_OPERATOR_TOKEN_FILE);await chmod(file,0o644);await assert.rejects(prepareRuntimePaths(f.paths),error=>error.cause?.code==='SETTINGS_OPERATOR_SECRET_UNSAFE');await chmod(file,0o600)}
})

test('CLI-only HTTP rejects browser origins, hostile hosts, body injection and reuses exact ports',async t=>{
 const f=await fixture(t),auth=await createSettingsOperatorAuth(f.paths),token=await readSettingsOperatorToken(f.paths),calls=[]
 const channels={read:async()=>[{type:'fixture-custom',channelId:'room',enabled:true,config:{credential:'REF'}}],remove:async(...args)=>{calls.push(args);return {changed:true,liveApplied:false,restartRequired:false}}}
 const handle=createSettingsHttp({auth,getSettings:()=>f.settings,getChannels:()=>channels,getPermissions:()=>({view:()=>({mode:'full',requests:[]}),setMode:async mode=>({mode})}),file:f.file})
 const server=createServer((req,res)=>handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
 const port=server.address().port,headers={authorization:'Bearer '+token},show={action:'show'}
 for(const extra of [{},{authorization:'Bearer '+'0'.repeat(64)},{...headers,origin:'http://127.0.0.1:3080'},{...headers,host:'foreign.invalid:'+port}])assert.equal((await post(port,show,extra)).status,403)
 assert.equal((await post(port,{action:'appearance',body:{name:'hello',icon:'moon',actor:'forged'}},headers)).status,400)
 assert.equal((await post(port,{action:'appearance',body:{name:token,icon:'moon'}},headers)).status,400)
 const live={...f.config,resident:{host:'127.0.0.1',port}},view=await requestLiveSettings(live,f.file,show)
 await requestLiveSettings(live,f.file,{action:'appearance',body:{name:'From CLI','icon':'robot',expectedVersion:view.version}})
 assert.equal((await f.settings.view()).appearance.name,'From CLI')
 const listing=await requestLiveSettings(live,f.file,{action:'channel-list'});assert.ok(!JSON.stringify(listing).includes('credential'));const version=listing.channels[0].version
 await assert.rejects(requestLiveSettings(live,f.file,{action:'channel-remove',body:{channelId:'room',expectedVersion:version}}),{code:'CHANNEL_DELETE_CONFIRMATION_REQUIRED'})
 await requestLiveSettings(live,f.file,{action:'channel-remove',body:{channelId:'room',expectedVersion:version,confirm:true}})
 assert.deepEqual(calls,[['room',{expectedVersion:version}]])
 const before=await readFile(f.file,'utf8');assert.equal((await requestLiveSettings(live,f.file,{action:'permissions-set',body:{mode:'ask'},checkOnly:true})).checkOnly,true);assert.equal(await readFile(f.file,'utf8'),before)
})

test('dispatcher cannot check or substitute live channel/permission lifecycle actions',async()=>{
 const calls=[],dispatch=createSettingsCommands({settings:{},channels:{editDingtalk:async(id,body)=>{calls.push({id,body});return {changed:true,detail:{channelId:id}}}},permissions:{respond:async(...args)=>{calls.push(args);return {ok:true}}}})
 const body={channelId:'room',expectedVersion:'1'.repeat(64),name:'Name',prompt:'Prompt',conversationType:'chat-room',targetKind:'id',target:'target'}
 await dispatch({action:'dingtalk-edit',body});assert.deepEqual(calls[0],{id:'room',body:Object.fromEntries(Object.entries(body).filter(([key])=>key!=='channelId'))})
 await assert.rejects(dispatch({action:'dingtalk-edit',body,checkOnly:true}),{code:'SETTINGS_CHECK_UNSUPPORTED'})
 await assert.rejects(dispatch({action:'permission-respond',body:{id:'request',decision:'allow',actor:'forged'}}),{code:'SETTINGS_COMMAND_INVALID'})
 await dispatch({action:'permission-respond',body:{id:'request',decision:'allow'}});assert.deepEqual(calls[1],['request','allow'])
})

test('real resident without Web exposes identical settings and permission services without model calls',async t=>{
 const {memoryHost}=await import('./fixtures/memory-host.js'),f=await memoryHost(t),paths=f.host.ctx.runtimePaths,file=join(paths.config,'config.json'),reserve=createServer()
 await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve))
 const config={...f.config,resident:{host:'127.0.0.1',port,taskSessions:{initialize:true,instanceId:'headless-settings',ownerActorId:'owner',webActorId:'operator',ingressEpoch:new Date().toISOString()}}}
 await writeFile(file,JSON.stringify(config),{mode:0o600});await f.host.ctx.plugin(await import('../src/application.js'),config)
 const cli=(args,options={})=>runSettingsCli([file,...args,'--live'],{write:()=>{},...options})
 assert.equal(f.host.ctx.get('channels').plugins.has('web-console'),false)
 const view=await cli(['show']);await cli(['appearance','--name','Headless bot','--icon','leaf','--expected-version',view.version])
 assert.equal((await f.host.ctx.operatorSettings.view()).appearance.name,'Headless bot')
 await cli(['permissions-set','--mode','full']);assert.equal(f.host.ctx.toolPermissions.view().mode,'full');assert.equal(JSON.parse(await readFile(file,'utf8')).permissionMode,'full')
 const channels=await cli(['channel-list']);assert.deepEqual(channels,{channels:[]})
 const show=await cli(['show']);await cli(['model','--provider','fixture','--model','m','--expected-version',show.version,'--check'])
 assert.equal(f.requests.length,0)
 const actor=(await f.agent('headless-operator-isolation')).agent
 await assert.rejects(async()=>f.host.ctx.agents.withInitiator(actor,()=>f.host.ctx.operatorSettings.saveAppearance({name:'forged',icon:'moon',expectedVersion:show.version})),{code:'CHANNEL_CONFIGURATION_OPERATOR_REQUIRED'})
 assert.equal((await f.host.ctx.operatorSettings.view()).appearance.name,'Headless bot')
})

test('binary reports only sanitized errors and never accepts credential command-line values',async t=>{
 const f=await fixture(t),secret='FIXTURE_ARG_SECRET_NEVER_PRINT'
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['bin/night-bot-settings.js',f.file,'secret','--kind','model','--action','replace','--confirm','--value',secret],{stdio:['ignore','pipe','pipe']}),chunks=[];child.stdout.on('data',value=>chunks.push(value));child.stderr.on('data',value=>chunks.push(value));child.on('error',reject);child.on('close',code=>resolve({code,text:Buffer.concat(chunks).toString('utf8')}))})
 assert.equal(result.code,1);assert.equal(result.text.trim(),'SETTINGS_COMMAND_INVALID');assert.ok(!result.text.includes(secret))
})

test('offline provisioning cannot reuse historical channel identity or write through a restore marker',async t=>{
 const f=await fixture(t),payload=join(f.root,'historical-channel.json')
 await mkdir(join(f.paths.state,'channels'),{recursive:true});await writeFile(join(f.paths.state,'channels','contexts.json'),JSON.stringify({history:{channelId:'retired-id',conversationId:'old-target'}}))
 await writeFile(payload,JSON.stringify({type:'fixture-custom',channelId:'retired-id',enabled:true,config:{room:'new-target'},createOnly:true}))
 const before=await readFile(f.file,'utf8');await assert.rejects(f.cli(['channel-save','--json-file',payload]),{code:'SETTINGS_RESIDENT_REQUIRED'});assert.equal(await readFile(f.file,'utf8'),before)
 await writeFile(join(f.paths.runtime,'restore.pending.json'),'{}')
 await assert.rejects(f.cli(['appearance','--name','No overwrite','--icon','moon']),{code:'SETTINGS_RESTORE_INCOMPLETE'});assert.equal(await readFile(f.file,'utf8'),before)
})


test('settings errors preserve only fixed Web listen diagnostics without reflecting error text',()=>{
 for(const code of ['WEB_LISTEN_INVALID','WEB_PUBLIC_ORIGIN_REQUIRED','WEB_PUBLIC_ORIGIN_INVALID'])assert.equal(safeSettingsError({code,message:'private detail'}),code)
 assert.equal(safeSettingsError({code:'WEB_PRIVATE_DETAIL',message:'private detail'}),'SETTINGS_OPERATION_FAILED')
 assert.equal(safeSettingsError({message:'WEB_PUBLIC_ORIGIN_INVALID private detail'}),'SETTINGS_OPERATION_FAILED')
})


test('settings capability preserves typed failures for an unsafe token path',async t=>{
 const f=await fixture(t),file=join(f.paths.secrets,SETTINGS_OPERATOR_TOKEN_FILE)
 await symlink(join(f.paths.secrets,'missing'),file,process.platform==='win32'?'junction':'file')
 await assert.rejects(createSettingsOperatorAuth(f.paths),{code:process.platform==='win32'?'SETTINGS_OPERATOR_SECRET_UNAVAILABLE':'SETTINGS_OPERATOR_SECRET_UNSAFE'})
 await assert.rejects(readSettingsOperatorToken(f.paths),{code:'SETTINGS_OPERATOR_SECRET_UNSAFE'})
})
