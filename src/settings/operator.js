import {createHash} from 'node:crypto'
import {updateConfig} from '../config.js'
import {resolvePiProfiles} from '../pi-provider-catalog.js'
import {piAuthentication} from '../pi-provider-auth.js'
import {discoverChannelPlugins} from '../channels/loader.js'
import {failure} from '../runtime/files.js'

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value)
const text=(value,max=128)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value)
export const defaultAppearance={name:'Night Bot',icon:'moon'}
export function appearance(value){return value&&text(value.name,64)&&['moon','star','robot','leaf'].includes(value.icon)?{name:value.name,icon:value.icon}:{...defaultAppearance}}
function endpoint(value){
 if(typeof value!=='string'||value.length>1024)throw failure('SETTINGS_INPUT_INVALID')
 let url;try{url=new URL(value)}catch{throw failure('SETTINGS_INPUT_INVALID')}
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw failure('SETTINGS_INPUT_INVALID')
 return url.href.replace(/\/$/,'')
}
function schema(definition){
 const fields=definition.webConfig?.fields
 if(!Array.isArray(fields)||fields.length>16)return null
 const names=new Set()
 for(const field of fields){
  if(!field||(typeof field.name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.name)||['constructor','prototype','enabled','channelId','type'].includes(field.name))||!text(field.label,64)||!['string','boolean','credential-ref'].includes(field.type)||names.has(field.name)||field.required!==undefined&&typeof field.required!=='boolean')return null
  if(field.type==='string'&&/token|secret|password|key|credential|authorization/i.test(field.name))return null
  names.add(field.name)
 }
 return fields.map(({name,label,type,required})=>({name,label,type,required:required===true}))
}
export function createOperatorSettings({file,paths,running,getCredentials,run=fn=>fn(),applyChannel,canEditChannel=()=>false}){
 const authentication=piAuthentication({getCredentials})
 const read=async()=> (await updateConfig(file,value=>value,{checkOnly:true})).config
 const check=(config,version)=>{if(version!==hash(config))throw failure('SETTINGS_VERSION_CONFLICT')}
 const credentials=()=>{const value=getCredentials();if(!value)throw failure('SETTINGS_UNAVAILABLE');return value}
 const modelSecret=async config=>{
  const provider=config.model.provider,profile=config.providers[provider]
  return profile.apiKeyEnv?{kind:'ref',id:profile.apiKeyEnv}:{kind:'record',id:provider}
 }
 const secretState=async slot=>{
  const value=slot.kind==='ref'?await credentials().describe(slot.id):await credentials().describeRecord('llm-pi-ai/'+slot.id)
  return {configured:value.configured===true,writable:slot.kind==='record'||!value.configured||value.source==='file',source:value.source==='file'?'saved':value.source?'environment':value.configured?'saved':'none'}
 }
 return {
  appearance:()=>run(async()=>appearance((await read()).assistant)),
  view:()=>run(async()=>{
   const config=await read(),profile=config.providers[config.model.provider],slot=await modelSecret(config)
   let baseURL='';try{baseURL=endpoint(profile.baseURL)}catch{}
   return {version:hash(config),appearance:appearance(config.assistant),model:{provider:config.model.provider,model:config.model.model,api:profile.api??'openai-completions',baseURL},
    secrets:{model:await secretState(slot),github:await secretState({kind:'ref',id:'GITHUB_TOKEN'})},restartRequired:JSON.stringify(config.model)!==JSON.stringify(running.model)||JSON.stringify(config.providers)!==JSON.stringify(running.providers),githubScope:'authorized-full-shell'}
  }),
  saveAppearance:body=>run(async()=>{
   if(!body||!text(body.name,64)||!['moon','star','robot','leaf'].includes(body.icon))throw failure('SETTINGS_INPUT_INVALID')
   await updateConfig(file,config=>{check(config,body.expectedVersion);config.assistant={name:body.name.trim(),icon:body.icon};return config})
   return {ok:true,restartRequired:false}
  }),
  saveModel:body=>run(async()=>{
   if(!body||!text(body.model)||!['openai-completions','openai-responses','anthropic-messages'].includes(body.api))throw failure('SETTINGS_INPUT_INVALID')
   const profile={api:body.api,baseURL:endpoint(body.baseURL),apiKeyEnv:'NIGHT_WEB_MODEL_API_KEY',models:[{id:body.model.trim()}]}
   resolvePiProfiles({'web-model':profile})
   await updateConfig(file,config=>{check(config,body.expectedVersion);config.providers['web-model']=profile;config.model={provider:'web-model',model:body.model.trim()};return config})
   return {ok:true,restartRequired:true}
  }),
  saveSecret:(kind,body)=>run(async()=>{
   if(!['model','github'].includes(kind)||!body||!['replace','clear'].includes(body.action)||body.confirm!==true)throw failure('SETTINGS_INPUT_INVALID')
   let state
   await updateConfig(file,async config=>{
    check(config,body.expectedVersion)
    const slot=kind==='model'?await modelSecret(config):{kind:'ref',id:'GITHUB_TOKEN'}
    if(!(await secretState(slot)).writable)throw failure('SETTINGS_SECRET_READ_ONLY')
    if(body.action==='replace'&&(!text(body.value,8192)||!/^[\x21-\x7e]+$/.test(body.value)))throw failure('SETTINGS_INPUT_INVALID')
    if(slot.kind==='ref'){if(body.action==='clear')await credentials().unset(slot.id);else await credentials().set(slot.id,body.value)}
    else if(body.action==='clear')await authentication.credentials.delete(slot.id)
    else await authentication.credentials.modify(slot.id,()=>({type:'api_key',key:body.value}))
    state=await secretState(slot)
    return config
   })
   return {ok:true,restartRequired:false,state}
  }),
  plugins:()=>run(async()=>{
   const config=await read(),definitions=await discoverChannelPlugins(config,paths)
   return {version:hash(config),items:[...definitions].filter(([type])=>type!=='dingtalk-dws').map(([type,definition])=>({type,name:text(definition.displayName,64)?definition.displayName:type,fields:schema(definition),configurable:!!schema(definition)})),
    channels:(config.channelPlugins??[]).filter(row=>row.type!=='dingtalk-dws'&&row.type!=='web-console').map(row=>{
     const fields=schema(definitions.get(row.type)??{}),allowed=fields?.map(field=>field.name)??[]
     return {type:row.type,channelId:row.channelId??row.type,enabled:row.enabled,editable:canEditChannel(row.channelId??row.type)||!row.enabled&&!(running.channelPlugins??[]).some(live=>(live.channelId??live.type)===(row.channelId??row.type)&&live.enabled),config:fields?Object.fromEntries(allowed.filter(key=>Object.hasOwn(row.config??{},key)).map(key=>[key,row.config[key]])):null}
    })}
  }),
  saveChannel:body=>run(async()=>{
   if(!body||!id(body.type)||body.type==='dingtalk-dws'||body.type==='web-console'||!id(body.channelId)||typeof body.enabled!=='boolean'||!body.config||Array.isArray(body.config)||typeof body.config!=='object')throw failure('SETTINGS_INPUT_INVALID')
   if(body.createOnly!==undefined&&typeof body.createOnly!=='boolean')throw failure('SETTINGS_INPUT_INVALID')
   const before=await read(),definition=(await discoverChannelPlugins(before,paths)).get(body.type),fields=definition&&schema(definition)
   if(!fields)throw failure('CHANNEL_WEB_CONFIGURATION_UNSUPPORTED')
   const selected={}
   for(const key of Object.keys(body.config))if(!fields.some(field=>field.name===key))throw failure('SETTINGS_INPUT_INVALID')
   for(const field of fields){const value=body.config[field.name];if(value===undefined||value===''){if(field.required)throw failure('SETTINGS_INPUT_INVALID');continue}
    if(field.type==='boolean'?typeof value!=='boolean':!text(value,2048))throw failure('SETTINGS_INPUT_INVALID')
    if(field.type==='credential-ref'&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw failure('SETTINGS_INPUT_INVALID')
    if(field.type==='string'){try{const url=new URL(value);if(url.username||url.password||url.search||url.hash)throw failure('SETTINGS_INPUT_INVALID')}catch(error){if(error.code==='SETTINGS_INPUT_INVALID')throw error}}
    selected[field.name]=value
   }
   const result=await updateConfig(file,config=>{
    check(config,body.expectedVersion);config.channelPlugins??=[]
    const row=config.channelPlugins.find(row=>(row.channelId??row.type)===body.channelId)
    if(row&&body.createOnly===true)throw failure('CHANNEL_INSTANCE_EXISTS')
    if(row&&row.type!==body.type)throw failure('SETTINGS_INPUT_INVALID')
    if(!applyChannel&&row&&(row.enabled||(running.channelPlugins??[]).some(live=>(live.channelId??live.type)===body.channelId&&live.enabled)))throw failure('CHANNEL_EDIT_REQUIRES_STOP')
    if(row){row.config={...row.config,...selected};for(const field of fields)if(!(field.name in selected))delete row.config[field.name];row.enabled=body.enabled}
    else config.channelPlugins.push({type:body.type,channelId:body.channelId,enabled:body.enabled,config:selected})
    return config
   },applyChannel?{apply:transaction=>applyChannel(transaction,body.channelId)}:{})
   return {ok:true,restartRequired:result.restartRequired,liveApplied:result.liveApplied??false}
  }),
 }
}
