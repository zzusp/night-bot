import {updateConfig} from '../config.js'
import {validateWorkLogConfig} from '../work-log/config.js'
import {failure} from '../runtime/files.js'
import {configVersion} from './model-configuration.js'
export async function saveWorkLogConfiguration(file,{enabled,time,timezone,expectedVersion,checkOnly=false}={}){
 const patch=Object.fromEntries(Object.entries({enabled,time,timezone}).filter(([,value])=>value!==undefined))
 if(!Object.keys(patch).length)throw failure('NIGHT_BOT_WORK_LOG_CONFIG_INVALID')
 validateWorkLogConfig(patch)
 const result=await updateConfig(file,config=>{
  if(expectedVersion!==undefined&&expectedVersion!==configVersion(config))throw failure('SETTINGS_VERSION_CONFLICT')
  config.workLog={...config.workLog,...patch};return config
 },{checkOnly})
 return {...result,version:configVersion(result.config)}
}
