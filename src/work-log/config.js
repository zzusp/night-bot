import {failure} from '../runtime/files.js'

export const WORK_LOG_ENV_NAMES=Object.freeze({enabled:'NIGHT_BOT_WORK_LOG_ENABLED',time:'NIGHT_BOT_WORK_LOG_TIME',timezone:'NIGHT_BOT_WORK_LOG_TIMEZONE'})
export const defaultWorkLogConfig=Object.freeze({enabled:true,time:'23:59',timezone:'local'})
export function validateWorkLogConfig(value){
 if(value===undefined)return
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(defaultWorkLogConfig,key)))throw failure('NIGHT_BOT_WORK_LOG_CONFIG_INVALID')
 if(value.enabled!==undefined&&typeof value.enabled!=='boolean')throw failure('NIGHT_BOT_WORK_LOG_ENABLED_INVALID')
 if(value.time!==undefined&&(typeof value.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)))throw failure('NIGHT_BOT_WORK_LOG_TIME_INVALID')
 if(value.timezone!==undefined){
  if(typeof value.timezone!=='string'||!value.timezone||value.timezone!==value.timezone.trim()||value.timezone.length>128)throw failure('NIGHT_BOT_WORK_LOG_TIMEZONE_INVALID')
  if(value.timezone!=='local')try{new Intl.DateTimeFormat('en',{timeZone:value.timezone})}catch{throw failure('NIGHT_BOT_WORK_LOG_TIMEZONE_INVALID')}
 }
}
export function savedWorkLogConfig(config){validateWorkLogConfig(config.workLog);return {...defaultWorkLogConfig,...config.workLog}}
export function resolveWorkLogConfig(config,{env=process.env}={}){
 const value=savedWorkLogConfig(config)
 for(const [key,name]of Object.entries(WORK_LOG_ENV_NAMES)){
  const entry=typeof env?.get==='function'?env.get(name):env?.[name],raw=entry&&typeof entry==='object'?entry.value:entry
  if(raw===undefined)continue
  if(key==='enabled'){if(raw!=='true'&&raw!=='false')throw failure('NIGHT_BOT_WORK_LOG_ENABLED_INVALID');value.enabled=raw==='true'}else value[key]=raw
 }
 validateWorkLogConfig(value)
 if(value.timezone==='local')value.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone
 return value
}
