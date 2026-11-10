import {parseArgs} from 'node:util'
import {readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {request} from 'node:http'
import {Context} from '@deepseek-ai/cordis'
import {loadConfig,updateConfig} from '../config.js'
import {loadNativeEnvironment} from '../native-environment.js'
import {runtimePaths,prepareSecrets,environmentPaths} from '../runtime/paths.js'
import {acquireLock,failure,readRegular} from '../runtime/files.js'
import NativeCredentials from '../native-credentials.js'
import {createOperatorInteraction} from '../operator-terminal.js'
import {createOperatorSettings} from './operator.js'
import {createSettingsCommands,settingsSaveResult,settingsActions,validateSettingsCommand} from './commands.js'
import {saveModelConfiguration} from './model-configuration.js'
import {saveWebConfiguration} from './web-configuration.js'
import {savePermissionConfiguration} from './configuration.js'
import {readSettingsOperatorToken} from './auth.js'
import {SETTINGS_OPERATOR_ROUTE,safeSettingsError} from './http.js'

export const settingsCliUsage=`Usage: night-bot-settings CONFIG ACTION [options] [--live] [--check]
Actions: show, plugins, appearance, model, role, secret, web, channel-list,
  channel-save, channel-enable, channel-remove, channel-ingress, dingtalk-get, dingtalk-add,
  dingtalk-edit, permissions-show, permissions-set, permission-respond.
Use --json-file FILE for non-secret payloads. Appearance: --name NAME --icon moon|star|robot|leaf.
Secret: --kind model|github --action replace|clear --confirm (hidden prompt or one stdin line).
Lifecycle commands require --live: the existing resident service, with or without Web.
channel-ingress: --channel-id ID --paused true|false --expected-version VERSION --confirm --live.
Resume starts recovery; use channel-list --live to inspect its actual completion or failure.
--check validates supported saved settings without writing; never applies a live lifecycle action.
No credential value, token, or password is accepted in arguments or printed. OAuth/ref management: night-bot-auth.`
const optionsByAction={
 show:[],plugins:[],appearance:['name','icon','expected-version'],model:['provider','model','api','base-url','key-env','reasoning-effort','expected-version'],
 role:['role','provider','model','reasoning-effort','expected-version'],secret:['kind','action','expected-version'],
 web:['enabled','host','port','public-origin','channel-id','sender-id','operator-name','expected-version'],
 'channel-list':[],'channel-save':[],'channel-enable':['channel-id','enabled','expected-version'],'channel-remove':['channel-id','expected-version'],
 'channel-ingress':['channel-id','paused','expected-version'],
 'dingtalk-get':['channel-id'],'dingtalk-add':[],'dingtalk-edit':[],'permissions-show':[],'permissions-set':['mode'],'permission-respond':['id','decision'],
}
const mapping={'base-url':'baseURL','key-env':'apiKeyEnv','reasoning-effort':'reasoningEffort','expected-version':'expectedVersion','public-origin':'publicOrigin','channel-id':'channelId','sender-id':'senderId','operator-name':'operatorName'}
const readOnly=new Set(['show','plugins','channel-list','dingtalk-get','permissions-show'])
const noFile=new Set([...readOnly,'secret'])
async function jsonFile(path){
 if((await stat(path)).size>32768)throw failure('SETTINGS_REQUEST_TOO_LARGE')
 let value;try{value=JSON.parse(await readFile(path,'utf8'))}catch{throw failure('SETTINGS_JSON_INVALID')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw failure('SETTINGS_JSON_INVALID')
 return value
}
export async function requestLiveSettings(config,file,input,{signal}={}){
 const token=await readSettingsOperatorToken(runtimePaths(config,file)),host=config.resident?.host??'127.0.0.1',port=config.resident?.port??18998
 if(!['127.0.0.1','::1','localhost'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw failure('SETTINGS_OPERATOR_ENDPOINT_INVALID')
 const text=JSON.stringify(input)
 if(text.includes(token))throw failure('SETTINGS_OPERATOR_SECRET_IN_REQUEST')
 if(Buffer.byteLength(text)>32768)throw failure('SETTINGS_REQUEST_TOO_LARGE')
 return new Promise((resolve,reject)=>{
  const req=request({hostname:host==='localhost'?'127.0.0.1':host,port,path:SETTINGS_OPERATOR_ROUTE,method:'POST',agent:false,signal,headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(text)}},res=>{
   const chunks=[];let size=0
   res.on('data',chunk=>{size+=chunk.length;if(size>1048576){res.destroy();reject(failure('SETTINGS_RESPONSE_LIMIT'))}else chunks.push(chunk)})
   res.on('error',()=>reject(failure('SETTINGS_RESPONSE_UNCERTAIN')))
   res.on('end',()=>{
    let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8').replaceAll(token,'[REDACTED]'))}catch{return reject(failure('SETTINGS_RESPONSE_UNCERTAIN'))}
    if(res.statusCode!==200)return reject(failure(safeSettingsError({code:value.error})))
    resolve(value)
   })
  })
  req.setTimeout(30000,()=>req.destroy(failure('SETTINGS_RESPONSE_UNCERTAIN')))
  // Never retry a possibly committed request, and never print request data.
  req.on('error',()=>reject(failure('SETTINGS_RESPONSE_UNCERTAIN')));req.end(text)
 })
}
async function localCommands(config,file,{checkOnly,writing,environment}){
 const paths=runtimePaths(config,file)
 if(paths.mode!=='portable')throw failure('SETTINGS_PORTABLE_LAYOUT_REQUIRED')
 // Validate the owned config path before creating even a lock directory.
 await updateConfig(file,value=>value,{checkOnly:true})
 const ctx=new Context();let release
 try{
  if(writing&&!checkOnly)release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0})
  if(writing&&!checkOnly){
   for(const marker of ['restore.pending.json','task-restore.pending.json'])if(await readRegular(join(paths.runtime,marker))!==undefined)throw failure('SETTINGS_RESTORE_INCOMPLETE')
   await prepareSecrets(paths)
  }
  const snapshot=await loadNativeEnvironment({...environmentPaths(config,file),inherited:environment,materialize:false})
  ctx.provide('launchEnvironment',snapshot)
  await ctx.plugin(NativeCredentials,{path:paths.credentials,watch:false})
  const settings=createOperatorSettings({file,paths,running:config,getCredentials:()=>ctx.credentials,getEnvironment:()=>snapshot,
   // Offline creation of a new instance never imports or starts its plugin.
   // Editing existing targets must use Host lifecycle/dependency guards.
   applyChannel:async({current,next,commit},id)=>{
    if(current.channelPlugins?.some(row=>(row.channelId??row.type)===id))throw failure('SETTINGS_RESIDENT_REQUIRED')
    const contexts=JSON.parse(await readRegular(join(paths.state,'channels','contexts.json'))??'{}')
    if(!contexts||typeof contexts!=='object'||Array.isArray(contexts)||Object.values(contexts).some(row=>!row||typeof row!=='object'||typeof row.channelId!=='string'))throw failure('SETTINGS_RESIDENT_REQUIRED')
    if(Object.values(contexts).some(row=>row.channelId===id))throw failure('SETTINGS_RESIDENT_REQUIRED')
    await commit();return {restartRequired:next.channelPlugins?.some(row=>(row.channelId??row.type)===id&&row.enabled),liveApplied:false}
   }})
  const channels={read:async()=>(await updateConfig(file,value=>value,{checkOnly:true})).config.channelPlugins??[],getDingtalk:async id=>{
   const {dingtalkEditable}=await import('../channels/plugins/dingtalk-config.js'),row=(await channels.read()).find(row=>row.channelId===id&&row.type==='dingtalk-dws')
   if(!row)throw failure('DINGTALK_CHANNEL_NOT_FOUND');return dingtalkEditable(row)
  }}
  const permissions={view:()=>({mode:config.permissionMode??'full',requests:[]}),setMode:async mode=>settingsSaveResult(await savePermissionConfiguration(file,{mode,checkOnly}))}
  return {dispatch:createSettingsCommands({settings,channels,permissions,configuration:{model:async body=>settingsSaveResult(await saveModelConfiguration(file,body)),web:async body=>settingsSaveResult(await saveWebConfiguration(file,body)),permissions:async body=>settingsSaveResult(await savePermissionConfiguration(file,body))}}),close:async()=>{try{await ctx.fiber.dispose()}finally{await release?.()}}}
 }catch(error){try{await ctx.fiber.dispose()}finally{await release?.()}throw error}
}
export async function runSettingsCli(argv,{environment=process.env,write=value=>console.log(value),interaction,signal}={}){
 const interruption=new AbortController();signal=signal?AbortSignal.any([signal,interruption.signal]):interruption.signal
 const [file,action='show',...args]=argv
 if(file==='--help'||action==='--help'){write(settingsCliUsage);return}
 if(!file||!settingsActions.includes(action))throw failure('SETTINGS_COMMAND_INVALID')
 const {values}=parseArgs({args,options:{...Object.fromEntries(optionsByAction[action].map(key=>[key,{type:'string'}])),...noFile.has(action)?{}:{'json-file':{type:'string'}},live:{type:'boolean'},check:{type:'boolean'},...['secret','channel-remove','channel-ingress'].includes(action)?{confirm:{type:'boolean'}}:{}},strict:true,allowPositionals:false})
 const body=values['json-file']?await jsonFile(values['json-file']):{}
 for(const key of optionsByAction[action])if(values[key]!==undefined){const name=mapping[key]??key;if(Object.hasOwn(body,name))throw failure('SETTINGS_COMMAND_INVALID');body[name]=values[key]}
 if(values.confirm!==undefined)body.confirm=values.confirm
 for(const key of ['enabled','paused'])if(typeof body[key]==='string'){if(!['true','false'].includes(body[key]))throw failure('SETTINGS_COMMAND_INVALID');body[key]=body[key]==='true'}
 if(typeof body.port==='string'){if(!/^\d+$/.test(body.port))throw failure('SETTINGS_COMMAND_INVALID');body.port=Number(body.port)}
 const input={action,body,checkOnly:values.check===true};validateSettingsCommand(input)
 const config=await loadConfig(file)
 let local,ownedInteraction
 try{
  const live=values.live===true
  if(!live&&['channel-enable','channel-remove','channel-ingress','dingtalk-add','dingtalk-edit','permission-respond'].includes(action))throw failure('SETTINGS_RESIDENT_REQUIRED')
  if(!live)local=await localCommands(config,file,{checkOnly:input.checkOnly,writing:!readOnly.has(action),environment})
  const dispatch=value=>live?requestLiveSettings(config,file,value,{signal}):local.dispatch(value)
  if(['appearance','model','role','secret','web','channel-save'].includes(action)&&body.expectedVersion===undefined)body.expectedVersion=(await dispatch({action:action==='channel-save'?'plugins':'show'})).version
  if(action==='secret'){
   if(!['model','github'].includes(body.kind)||!['replace','clear'].includes(body.action)||body.confirm!==true)throw failure('SETTINGS_COMMAND_INVALID')
   if(body.action==='replace'){
    const prompt=interaction??(ownedInteraction=createOperatorInteraction({onInterrupt:()=>interruption.abort()}))
    body.value=await prompt.prompt({kind:'secret',message:'Credential value',signal})
    signal?.throwIfAborted()
   }
  }
  const result=await dispatch(input);write(JSON.stringify(result,null,2));return result
 }catch(error){if(signal.aborted&&error.code!=='SETTINGS_RESPONSE_UNCERTAIN')throw failure('SETTINGS_CANCELLED');throw error}
 finally{ownedInteraction?.close();await local?.close()}
}
