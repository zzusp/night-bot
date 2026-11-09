import {failure} from '../../runtime/files.js'
import {hash} from '../../memory/format.js'

const fields=new Set(['dingtalk_storage_key','dingtalk_profile','dingtalk_conversation_type','dingtalk_group_id','dingtalk_group_name','dingtalk_user_id','dingtalk_user_name','dingtalk_name','dingtalk_prompt','dingtalk_binding','dingtalk_account_mode','dingtalk_executable','dingtalk_writes_authorized','dingtalk_listen','dingtalk_operator_notifications','dingtalk_operator_peers','dingtalk_human_user_id','dingtalk_current_user_name'])
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const text=(value,key,{required=false,empty=false}={})=>{
  if(value===undefined&&!required)return undefined
  if(typeof value!=='string'||!empty&&!value.trim()||value.includes('\0'))throw failure('DINGTALK_CONFIG_INVALID:'+key)
  return empty?value:value.trim()
}
const boolean=(value,key,fallback)=>{if(value===undefined)return fallback;if(typeof value!=='boolean')throw failure('DINGTALK_CONFIG_INVALID:'+key);return value}

/** 只处理参数；认证解析、环境读取与持久化在外部边界完成。 */
export function validateConfig(config={}){
  if(!object(config))throw failure('DINGTALK_CONFIG_INVALID')
  for(const key of Object.keys(config))if(!fields.has(key))throw failure('DINGTALK_CONFIG_UNKNOWN:'+key)
  const profile=text(config.dingtalk_profile,'dingtalk_profile',{required:true})
  const conversationType=config.dingtalk_conversation_type
  if(!['chat','chat-room'].includes(conversationType))throw failure('DINGTALK_CONVERSATION_TYPE_REQUIRED')
  const groupId=text(config.dingtalk_group_id,'dingtalk_group_id'),groupName=text(config.dingtalk_group_name,'dingtalk_group_name')
  const userId=text(config.dingtalk_user_id,'dingtalk_user_id'),userName=text(config.dingtalk_user_name,'dingtalk_user_name')
  if(conversationType==='chat-room'?(!groupId&&!groupName||userId!==undefined||userName!==undefined):(!userId&&!userName||groupId!==undefined||groupName!==undefined))throw failure('DINGTALK_SINGLE_TARGET_REQUIRED')
  const accountMode=config.dingtalk_account_mode
  if(accountMode!==undefined&&!['system','private'].includes(accountMode))throw failure('DINGTALK_ACCOUNT_MODE_INVALID')
  const binding=config.dingtalk_binding
  if(binding!==undefined){
    const allowed=new Set(['version','profile','corpId','userId','actorId','conversationType','conversationId','peerId','peerUserId'])
    if(!object(binding)||Object.keys(binding).some(key=>!allowed.has(key))||binding.version!==1)throw failure('DINGTALK_BINDING_INVALID')
    for(const key of ['profile','corpId','userId','actorId','conversationId'])text(binding[key],'dingtalk_binding.'+key,{required:true})
    if(binding.profile!==profile||profile!==binding.corpId+':'+binding.userId||binding.conversationType!==conversationType)throw failure('DINGTALK_BINDING_IDENTITY_MISMATCH')
    if(conversationType==='chat-room'&&(!groupId||binding.conversationId!==groupId||binding.peerId!==undefined))throw failure('DINGTALK_BINDING_TARGET_MISMATCH')
    if(conversationType==='chat'&&(!userId||binding.peerUserId!==userId||!text(binding.peerId,'dingtalk_binding.peerId',{required:true})))throw failure('DINGTALK_BINDING_TARGET_MISMATCH')
  }
  const storageKey=config.dingtalk_storage_key
  if(storageKey!==undefined&&(!binding||storageKey!=='legacy'&&storageKey!==dingtalkBindingKey(binding)))throw failure('DINGTALK_STORAGE_IDENTITY_INVALID')
  let operatorPeers=config.dingtalk_operator_peers??[]
  if(!Array.isArray(operatorPeers)||operatorPeers.some(value=>typeof value!=='string'||!value.trim()||value.includes('\0'))||new Set(operatorPeers).size!==operatorPeers.length)throw failure('DINGTALK_OPERATOR_PEERS_INVALID')
  operatorPeers=[...operatorPeers]
  const operatorNotifications=boolean(config.dingtalk_operator_notifications,'dingtalk_operator_notifications',false)
  if(operatorNotifications&&!operatorPeers.length)throw failure('DINGTALK_OPERATOR_PEERS_REQUIRED')
  const name=text(config.dingtalk_name,'dingtalk_name'),prompt=text(config.dingtalk_prompt,'dingtalk_prompt',{empty:true})
  return {profile,conversationType,groupId,groupName,userId,userName,name,prompt,binding:binding?{...binding}:undefined,
    storageKey,accountMode,executable:text(config.dingtalk_executable,'dingtalk_executable'),writesAuthorized:boolean(config.dingtalk_writes_authorized,'dingtalk_writes_authorized',false),listen:boolean(config.dingtalk_listen,'dingtalk_listen',true),
    operatorNotifications,operatorPeers,humanUserId:text(config.dingtalk_human_user_id,'dingtalk_human_user_id'),currentUserName:text(config.dingtalk_current_user_name,'dingtalk_current_user_name'),
    groups:conversationType==='chat-room'&&groupId?[{groupId,...prompt!==undefined?{responsibility:prompt}:{}}]:[],directChats:conversationType==='chat',directPeers:conversationType==='chat'&&binding?[binding.peerId]:[],assistantActorId:binding?.actorId,responsibility:prompt}
}

export function validateDingtalkInstance(instance){
  if(!object(instance)||Object.keys(instance).some(key=>!['type','channelId','enabled','config'].includes(key))||instance.type!=='dingtalk-dws'||typeof instance.enabled!=='boolean'||typeof instance.channelId!=='string'||!instance.channelId.trim()||instance.channelId!==instance.channelId.trim()||instance.channelId.length>128)throw failure('DINGTALK_INSTANCE_INVALID')
  validateConfig(instance.config)
  return structuredClone(instance)
}

/** Docker/专用 CLI 的显式 env 导入；不与调用参数合并。 */
export function dingtalkInstancesFromEnvironment(environment){
  const present=Object.entries(environment).filter(([key,value])=>key.startsWith('DINGTALK_')&&value!==undefined&&value!=='')
  if(!present.length)return []
  if(environment.DINGTALK_CHANNELS_JSON){
    if(present.some(([key])=>key!=='DINGTALK_CHANNELS_JSON'))throw failure('DINGTALK_ENV_INPUT_CONFLICT')
    let rows;try{rows=JSON.parse(environment.DINGTALK_CHANNELS_JSON)}catch{throw failure('DINGTALK_ENV_JSON_INVALID')}
    if(!Array.isArray(rows))throw failure('DINGTALK_ENV_JSON_INVALID')
    const ids=new Set()
    return rows.map(row=>{const value=validateDingtalkInstance(row);if(ids.has(value.channelId))throw failure('DINGTALK_CHANNEL_ID_DUPLICATE');ids.add(value.channelId);return value})
  }
  const config={},controls=new Set(['DINGTALK_CHANNEL_ID','DINGTALK_ENABLED']),booleanFields=new Set(['dingtalk_writes_authorized','dingtalk_listen','dingtalk_operator_notifications'])
  for(const [key,value]of present){
    if(controls.has(key))continue
    const field=key.toLowerCase();if(!fields.has(field))throw failure('DINGTALK_ENV_UNKNOWN:'+key)
    if(booleanFields.has(field)){if(!['true','false'].includes(value))throw failure('DINGTALK_ENV_BOOLEAN_INVALID:'+key);config[field]=value==='true'}
    else if(field==='dingtalk_binding'||field==='dingtalk_operator_peers'){try{config[field]=JSON.parse(value)}catch{throw failure('DINGTALK_ENV_JSON_INVALID:'+key)}}
    else config[field]=value
  }
  if(environment.DINGTALK_ENABLED!==undefined&&!['true','false'].includes(environment.DINGTALK_ENABLED))throw failure('DINGTALK_ENV_BOOLEAN_INVALID:DINGTALK_ENABLED')
  return [validateDingtalkInstance({type:'dingtalk-dws',channelId:environment.DINGTALK_CHANNEL_ID,enabled:environment.DINGTALK_ENABLED!=='false',config})]
}

export const dingtalkConfigVersion=row=>hash(JSON.stringify(row))
export const dingtalkBindingKey=binding=>hash(JSON.stringify([binding.profile,binding.corpId,binding.userId,binding.actorId,binding.conversationType,binding.conversationId,binding.peerId??null,binding.peerUserId??null]))

/** 专用认证编辑投影；不返回账号、凭据或内部绑定。 */
export function dingtalkEditable(row){
  const config=row.config,prefix=config.dingtalk_conversation_type==='chat-room'?'dingtalk_group_':'dingtalk_user_'
  const targetKind=config[prefix+'name']!==undefined?'name':'id'
  return {channelId:row.channelId,version:dingtalkConfigVersion(row),name:config.dingtalk_name??'',prompt:config.dingtalk_prompt??'',conversationType:config.dingtalk_conversation_type,targetKind,target:config[prefix+targetKind],writesAuthorized:config.dingtalk_writes_authorized===true}
}
