import {failure} from '../../runtime/files.js'
import {validateConfig} from './dingtalk-config.js'

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const nonempty=value=>typeof value==='string'&&value.trim()!==''
const one=(rows,code)=>{if(rows.length!==1)throw failure(rows.length?code+'_AMBIGUOUS':code+'_NOT_FOUND');return rows[0]}
function noPartial(value,code){
  if(!object(value)||value.success===false||value.partial===true||value.hasMore!==undefined&&value.hasMore!==false||value.complete!==undefined&&value.complete!==true||value.truncatedByPageLimit===true||value.failedCount!==undefined&&value.failedCount!==0||value.failures!==undefined&&(!Array.isArray(value.failures)||value.failures.length))throw failure(code+'_INCOMPLETE')
  return value
}
export async function dwsReadJson(runner,args,profile){
  const result=await runner.run([...args,'--format','json',...profile?['--profile',profile]:[]])
  if(result.exitCode!==0)throw failure(result.exitCode===2?'DINGTALK_AUTH_REQUIRED':'DINGTALK_QUERY_FAILED')
  let value;try{value=JSON.parse(result.stdout)}catch{throw failure('DINGTALK_QUERY_INVALID_JSON')}
  return noPartial(value,'DINGTALK_QUERY')
}

/** 只解析 profile list；缺省取明确的全局当前账号，不修改 DWS 默认账号。 */
export function selectDwsProfile(value,selector){
  if(value?.success!==true||!Array.isArray(value.profiles))throw failure('DINGTALK_PROFILE_RESPONSE_INVALID')
  const profiles=value.profiles
  if(!profiles.length)throw failure('DINGTALK_AUTH_REQUIRED')
  if(profiles.some(row=>!object(row)||!nonempty(row.profile)||!nonempty(row.corpId)||!nonempty(row.userId)))throw failure('DINGTALK_PROFILE_RESPONSE_INVALID')
  if(selector===undefined){
    const current=one(profiles.filter(row=>row.isCurrent===true),'DINGTALK_CURRENT_PROFILE')
    if(current.isOrgCurrent!==true)throw failure('DINGTALK_CURRENT_PROFILE_NOT_FOUND')
    return one(profiles.filter(row=>row.corpId===current.corpId&&row.isOrgCurrent===true),'DINGTALK_CURRENT_PROFILE')
  }
  const exact=profiles.filter(row=>row.profile===selector||row.corpId+':'+row.userId===selector)
  if(exact.length)return one(exact,'DINGTALK_PROFILE')
  const split=selector.indexOf(':')
  if(split!==-1){const org=selector.slice(0,split),user=selector.slice(split+1);return one(profiles.filter(row=>(row.corpId===org||row.corpName===org)&&(row.userId===user||row.userName===user)),'DINGTALK_PROFILE')}
  const orgs=profiles.filter(row=>row.corpId===selector||row.corpName===selector)
  if(new Set(orgs.map(row=>row.corpId)).size>1)throw failure('DINGTALK_PROFILE_AMBIGUOUS')
  return one(orgs.filter(row=>row.isOrgCurrent===true),'DINGTALK_PROFILE')
}
function employeeRows(value){
  if(!Array.isArray(value.result)||value.result.some(row=>!object(row)||!object(row.orgEmployeeModel)))throw failure('DINGTALK_IDENTITY_RESPONSE_INVALID')
  return value.result.map(row=>row.orgEmployeeModel)
}
async function searchUsers(runner,profile,query){
  const envelope=await dwsReadJson(runner,['contact','+search-user','--query',query],profile)
  if(envelope.ok!==true||envelope.outcome!=='success')throw failure('DINGTALK_USER_RESPONSE_INCOMPLETE')
  const value=noPartial(envelope.data,'DINGTALK_USER_RESPONSE')
  if(!Array.isArray(value.users)||value.users.some(row=>!object(row)||!nonempty(row.openDingTalkId))||value.count!==value.users.length)throw failure('DINGTALK_USER_RESPONSE_INVALID')
  return value.users
}
export async function resolveDwsAccount(runner,selector){
  const selected=selectDwsProfile(await dwsReadJson(runner,['profile','list']),selector),profile=selected.corpId+':'+selected.userId
  const self=await dwsReadJson(runner,['contact','user','get-self'],profile)
  const employee=one(employeeRows(self).filter(row=>row.corpId===selected.corpId&&(row.userId??row.orgUserId)===selected.userId),'DINGTALK_AUTHENTICATED_ACCOUNT')
  const userName=employee.orgUserName??employee.name??selected.userName
  if(!nonempty(userName))throw failure('DINGTALK_ACCOUNT_NAME_REQUIRED')
  const actor=one((await searchUsers(runner,profile,userName)).filter(row=>row.userId===selected.userId),'DINGTALK_ACCOUNT_ACTOR')
  return {profile,corpId:selected.corpId,userId:selected.userId,actorId:actor.openDingTalkId}
}
async function conversationInfo(runner,profile,args){
  const value=await dwsReadJson(runner,['chat','conversation-info',...args],profile)
  if(value.success!==true||!object(value.result))throw failure('DINGTALK_CONVERSATION_RESPONSE_INVALID')
  const result=noPartial(value.result,'DINGTALK_CONVERSATION_RESPONSE'),info=result.conversationInfo
  if(!object(info)||!nonempty(info.openConversationId))throw failure('DINGTALK_CONVERSATION_RESPONSE_INVALID')
  return info
}
async function resolveTarget(runner,config,account){
  if(config.conversationType==='chat-room'){
    let groupId=config.groupId
    if(config.groupName&&!groupId){
      const value=await dwsReadJson(runner,['chat','+chat-search','--query',config.groupName,'--page-all'],account.profile)
      if(value.complete!==true||value.hasMore!==false||!Array.isArray(value.chats)||value.count!==value.chats.length||value.chats.some(row=>!object(row)||!nonempty(row.openConversationId)))throw failure('DINGTALK_GROUP_RESPONSE_INCOMPLETE')
      groupId=one(value.chats,'DINGTALK_GROUP').openConversationId
    }
    const info=await conversationInfo(runner,account.profile,['--group',groupId])
    if(info.openConversationId!==groupId||info.singleChat!==false)throw failure('DINGTALK_GROUP_IDENTITY_MISMATCH')
    return {conversationId:groupId}
  }
  let userId=config.userId,userName=config.userName
  if(userId){
    const value=await dwsReadJson(runner,['contact','user','get','--ids',userId],account.profile)
    const employee=one(employeeRows(value).filter(row=>(row.userId??row.orgUserId)===userId),'DINGTALK_PEER')
    if(employee.corpId!==undefined&&employee.corpId!==account.corpId)throw failure('DINGTALK_PEER_ORGANIZATION_MISMATCH')
    userName=employee.orgUserName??employee.name
  }
  if(!nonempty(userName))throw failure('DINGTALK_PEER_NAME_REQUIRED')
  const candidates=await searchUsers(runner,account.profile,userName)
  const peer=one(userId?candidates.filter(row=>row.userId===userId):candidates,'DINGTALK_PEER')
  if(!nonempty(peer.userId)||peer.openDingTalkId===account.actorId)throw failure('DINGTALK_PEER_IDENTITY_INVALID')
  const info=await conversationInfo(runner,account.profile,['--open-dingtalk-id',peer.openDingTalkId])
  if(info.singleChat!==true)throw failure('DINGTALK_PEER_CONVERSATION_MISMATCH')
  return {conversationId:info.openConversationId,peerId:peer.openDingTalkId,peerUserId:peer.userId}
}
export async function resolveDingtalkBinding(config,{runner}={}){
  if(!runner||typeof runner.run!=='function')throw failure('DINGTALK_BINDING_RUNNER_REQUIRED')
  const account=await resolveDwsAccount(runner,config.profile),target=await resolveTarget(runner,config,account)
  const binding={version:1,...account,conversationType:config.conversationType,...target}
  if(config.binding&&(Object.keys(binding).some(key=>binding[key]!==config.binding[key])||Object.keys(config.binding).some(key=>binding[key]!==config.binding[key])))throw failure('DINGTALK_BINDING_CHANGED')
  return binding
}
export async function bindDingtalkConfig(publicConfig,{runner}={}){
  const config=validateConfig(publicConfig),binding=await resolveDingtalkBinding(config,{runner})
  const bound={...publicConfig,dingtalk_profile:binding.profile,...config.conversationType==='chat-room'?{dingtalk_group_id:binding.conversationId}:{dingtalk_user_id:binding.peerUserId},dingtalk_binding:binding}
  validateConfig(bound)
  return bound
}
export async function verifyDingtalkBinding(config,{runner}={}){
  if(!config.binding)throw failure('DINGTALK_BINDING_REQUIRED')
  const account=await resolveDwsAccount(runner,config.profile)
  for(const key of ['profile','corpId','userId','actorId'])if(account[key]!==config.binding[key])throw failure('DINGTALK_BOUND_ACCOUNT_CHANGED')
  return account
}
