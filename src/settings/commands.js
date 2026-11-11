import {failure} from '../runtime/files.js'
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)
const spec={
 show:[],plugins:[],appearance:['name','icon','expectedVersion'],
 model:['provider','model','api','baseURL','apiKeyEnv','reasoningEffort','expectedVersion'],
 provider:['action','provider','api','baseURL','model','expectedVersion'],
 'model-list':[],'model-entry':['action','provider','id','model','name','expectedVersion','confirm'],
 role:['role','provider','model','reasoningEffort','expectedVersion'],
 secret:['provider','kind','action','value','confirm','expectedVersion'],
 'work-log':['enabled','time','timezone','expectedVersion'],
 web:['enabled','host','port','publicOrigin','channelId','senderId','operatorName','expectedVersion'],
 'channel-list':[],'channel-save':['type','channelId','enabled','config','expectedVersion','createOnly'],
 'channel-enable':['channelId','enabled','expectedVersion'],'channel-remove':['channelId','expectedVersion','confirm'],
 'channel-ingress':['channelId','paused','expectedVersion','confirm'],
 'dingtalk-get':['channelId'],'dingtalk-add':['channelId','conversationType','targetKind','target','name','prompt','writesAuthorized'],
 'dingtalk-edit':['channelId','expectedVersion','name','prompt','conversationType','targetKind','target','writesAuthorized'],
 'permissions-show':[],'permissions-set':['mode'],'permission-respond':['id','decision'],
}
export const settingsActions=Object.freeze(Object.keys(spec))
export function validateSettingsCommand(input){
 if(!plain(input)||Object.keys(input).some(key=>!['action','body','checkOnly'].includes(key))||!Object.hasOwn(spec,input.action)||!plain(input.body??{})||input.checkOnly!==undefined&&typeof input.checkOnly!=='boolean')throw failure('SETTINGS_COMMAND_INVALID')
 const body=input.body??{}
 if(Object.keys(body).some(key=>!spec[input.action].includes(key)))throw failure('SETTINGS_COMMAND_INVALID')
 return {action:input.action,body,checkOnly:input.checkOnly===true}
}
const unavailable=()=>{throw failure('SETTINGS_RESIDENT_REQUIRED')}
const channelId=value=>{if(typeof value!=='string'||value!==value.trim()||!value||value.length>128||value.includes('\0'))throw failure('SETTINGS_COMMAND_INVALID');return value}
const version=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw failure('SETTINGS_COMMAND_INVALID');return value}
/** Transport-independent dispatcher. Runtime-sensitive actions only invoke the
 * existing Host ports, preserving admission, actor binding, drain and CAS. */
export function createSettingsCommands({settings,channels,permissions,configuration={}}){
 return async input=>{
  const {action,body,checkOnly}=validateSettingsCommand(input),options={checkOnly}
  const channel=()=>channels??unavailable(),permission=()=>permissions??unavailable()
  if(checkOnly&&!['appearance','provider','model','model-entry','role','secret','web','work-log','channel-save','permissions-set'].includes(action))throw failure('SETTINGS_CHECK_UNSUPPORTED')
  if(action==='show')return settings.view()
  if(action==='provider'){version(body.expectedVersion);return settings.saveProvider(body,options)}
  if(action==='model-list')return settings.modelCatalog()
  if(action==='model-entry'){version(body.expectedVersion);return settings.saveModelEntry(body,options)}
  if(action==='plugins')return settings.plugins()
  if(action==='appearance')return settings.saveAppearance(body,options)
  if(action==='model'){version(body.expectedVersion);return (configuration.model??unavailable)({...body,checkOnly})}
  if(action==='role')return settings.saveRoleModel(body,options)
  if(action==='secret'){const {kind,...value}=body;return settings.saveSecret(kind,value,options)}
  if(action==='work-log'){version(body.expectedVersion);return settings.saveWorkLog(body,options)}
  if(action==='web'){version(body.expectedVersion);return (configuration.web??unavailable)({...body,checkOnly})}
  if(action==='channel-save')return settings.saveChannel(body,options)
  if(action==='channel-list'){const {dingtalkConfigVersion}=await import('../channels/plugins/dingtalk-config.js');const port=channel();return {channels:await Promise.all((await port.read()).map(async row=>{const id=row.channelId??row.config?.channelId??row.type;return {type:row.type,channelId:id,enabled:row.enabled,version:dingtalkConfigVersion(row),receivePaused:row.receivePaused===true,...port.getIngress?{ingress:await port.getIngress(id)}:{}}}))}}
  if(action==='channel-enable'){const {channelId:id,...value}=body;channelId(id);version(value.expectedVersion);return channel().setEnabled(id,value)}
  if(action==='channel-ingress'){
   const {channelId:id,...value}=body;channelId(id);version(value.expectedVersion)
   if(typeof value.paused!=='boolean')throw failure('CHANNEL_INGRESS_REQUEST_INVALID')
   if(value.confirm!==true)throw failure('CHANNEL_INGRESS_CONFIRMATION_REQUIRED')
   const result=await (channel().setIngressPaused??unavailable)(id,value)
   return {ok:true,changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied,version:result.version,receivePaused:result.receivePaused,ingress:result.ingress}
  }
  if(action==='channel-remove'){
   const {channelId:id,expectedVersion,confirm}=body;channelId(id);version(expectedVersion)
   if(confirm!==true)throw failure('CHANNEL_DELETE_CONFIRMATION_REQUIRED')
   return channel().remove(id,{expectedVersion})
  }
  if(action==='dingtalk-get')return channel().getDingtalk(channelId(body.channelId))
  if(action==='dingtalk-add'){const value=await channel().addDingtalk(body);return {changed:value.changed,restartRequired:value.restartRequired,liveApplied:value.liveApplied}}
  if(action==='dingtalk-edit'){const {channelId:id,...value}=body;const result=await channel().editDingtalk(channelId(id),value);return {changed:result.changed,restartRequired:result.restartRequired,liveApplied:result.liveApplied,detail:result.detail}}
  if(action==='permissions-show')return permission().view()
  if(action==='permissions-set'){if(!['ask','auto','full'].includes(body.mode))throw failure('PERMISSION_MODE_INVALID');return checkOnly?(configuration.permissions??unavailable)({mode:body.mode,checkOnly}):permission().setMode(body.mode)}
  if(action==='permission-respond'){if(typeof body.id!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(body.id)||!['allow','reject','revoke'].includes(body.decision))throw failure('PERMISSION_DECISION_INVALID');return permission().respond(body.id,body.decision)}
  throw failure('SETTINGS_COMMAND_INVALID')
 }
}
export const settingsSaveResult=result=>({ok:true,changed:result.changed,checkOnly:result.checkOnly,version:result.version,restartRequired:result.restartRequired,liveApplied:false})
