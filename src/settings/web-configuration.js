import {join} from 'node:path'
import {updateConfig} from '../config.js'
import {failure} from '../runtime/files.js'
import {packageRoot} from '../runtime/paths.js'
import {webListenOptions} from '../../packages/web-console/server/security.js'
import {configVersion} from './model-configuration.js'
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value)
/** Shared saved Web transport configuration. Listener/identity changes take effect
 * at restart; this never starts a server or replaces an authenticated actor. */
export async function saveWebConfiguration(file,{enabled,host,port,publicOrigin,channelId='web-console',senderId,operatorName,expectedVersion,checkOnly=false}={}){
 if(typeof enabled!=='boolean')throw failure('NIGHT_BOT_WEB_ENABLED_REQUIRED')
 if(!identifier(channelId))throw failure('NIGHT_BOT_WEB_CHANNEL_INVALID')
 const result=await updateConfig(file,config=>{
  if(expectedVersion!==undefined&&expectedVersion!==configVersion(config))throw failure('SETTINGS_VERSION_CONFLICT')
  config.channelPlugins??=[]
  const existing=config.channelPlugins.find(row=>(row.channelId??row.type)===channelId)
  if(existing&&existing.type!=='web-console')throw failure('NIGHT_BOT_CHANNEL_ID_CONFLICT')
  const current=existing?.config??{},actor=senderId??current.senderId??config.resident?.taskSessions?.webActorId
  if(!identifier(actor))throw failure('NIGHT_BOT_WEB_SENDER_REQUIRED')
  if(current.senderId&&current.senderId!==actor)throw failure('NIGHT_BOT_WEB_IDENTITY_REQUIRES_NEW_CHANNEL')
  const selectedPort=port??current.port??3080
  if(!Number.isSafeInteger(selectedPort)||selectedPort<0||selectedPort>65535)throw failure('NIGHT_BOT_HTTP_PORT_INVALID')
  const name=operatorName??current.operatorName
  if(name!==undefined&&(typeof name!=='string'||!name.trim()||name.length>80))throw failure('NIGHT_BOT_WEB_OPERATOR_NAME_INVALID')
  const origin=publicOrigin??current.publicOrigin
  const web={...current,host:host??current.host??'127.0.0.1',port:selectedPort,senderId:actor,...origin!==undefined?{publicOrigin:origin}:{},...name!==undefined?{operatorName:name}:{}}
  webListenOptions(web)
  const row={type:'web-console',channelId,enabled,config:web}
  if(existing)Object.assign(existing,row);else config.channelPlugins.push(row)
  config.channelPluginDirs=[...new Set([...(config.channelPluginDirs??[]),join(packageRoot,'packages')])]
  return config
 },{checkOnly})
 return {...result,version:configVersion(result.config)}
}
