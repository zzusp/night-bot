import {updateConfig} from '../config.js'
import {failure} from '../runtime/files.js'
import {configVersion} from './model-configuration.js'
export async function savePermissionConfiguration(file,{mode,expectedVersion,checkOnly=false}={}){
 if(!['ask','auto','full'].includes(mode))throw failure('NIGHT_BOT_PERMISSION_MODE_INVALID')
 const result=await updateConfig(file,config=>{
  if(expectedVersion!==undefined&&expectedVersion!==configVersion(config))throw failure('SETTINGS_VERSION_CONFLICT')
  return {...config,permissionMode:mode}
 },{checkOnly})
 return {...result,version:configVersion(result.config)}
}
