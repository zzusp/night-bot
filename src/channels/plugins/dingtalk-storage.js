import {join,dirname,resolve} from 'node:path'
import {lstat,readdir} from 'node:fs/promises'
import {inside} from '../../runtime/paths.js'
import {hash} from '../../memory/format.js'
import {dingtalkBindingKey,validateConfig} from './dingtalk-config.js'
import {atomicWrite,readRegular,failure} from '../../runtime/files.js'

export function dingtalkChannelPaths(paths,channelId,storageKey){
  const namespace=channelId==='dingtalk-dws'?'dingtalk-dws':'dingtalk-dws-'+hash(channelId)
  if(storageKey!==undefined&&storageKey!=='legacy'&&!/^[a-f0-9]{64}$/.test(storageKey))throw failure('DINGTALK_STORAGE_IDENTITY_INVALID')
  const records=storageKey&&storageKey!=='legacy'?join(namespace,'targets',storageKey):namespace
  return {namespace,bindingFile:join(paths.config,'channels',records,'binding.json'),ingressFile:join(paths.state,'channels',records,'ingress.json'),privateHome:join(paths.secrets,namespace),workspace:join(paths.workspaces,'channels',namespace),cache:join(paths.cache,namespace)}
}
export async function assertDingtalkStoragePath(paths,file){
  if(paths.mode!=='portable'||![paths.config,paths.state].some(root=>inside(root,file)))throw failure('DINGTALK_STORAGE_PATH_UNSAFE')
  let at=resolve(file)
  while(inside(paths.installRoot,at)){
    const info=await lstat(at).catch(error=>{if(error.code!=='ENOENT')throw error})
    if(info&&(info.isSymbolicLink()||at!==resolve(file)&&!info.isDirectory()||at===resolve(file)&&(!info.isFile()||info.nlink!==1)))throw failure('DINGTALK_STORAGE_PATH_UNSAFE')
    if(at===resolve(paths.installRoot))return
    at=dirname(at)
  }
  throw failure('DINGTALK_STORAGE_PATH_UNSAFE')
}
/** 只有真实缺席才返回 undefined；损坏的耐久身份证据不能被自动覆盖。 */
export async function readDingtalkBinding(file){
  const raw=await readRegular(file)
  if(raw===undefined)return undefined
  let binding;try{binding=JSON.parse(raw)}catch{throw failure('DINGTALK_BINDING_INVALID')}
  if(!binding||typeof binding!=='object'||Array.isArray(binding))throw failure('DINGTALK_BINDING_INVALID')
  try{return validateConfig({dingtalk_profile:binding.profile,dingtalk_conversation_type:binding.conversationType,
    ...binding.conversationType==='chat-room'?{dingtalk_group_id:binding.conversationId}:{dingtalk_user_id:binding.peerUserId},dingtalk_binding:binding}).binding}catch{throw failure('DINGTALK_BINDING_INVALID')}
}
export async function readDingtalkIngress(file){
  const value=JSON.parse(await readRegular(file)??'{"paused":false}')
  if(!value||typeof value.paused!=='boolean'||['recoveryFromAt','pausedAt','firstStartedAt','backfillThroughAt','consumedAt'].some(key=>value[key]!==undefined&&(typeof value[key]!=='string'||!Number.isFinite(Date.parse(value[key])))))throw failure('DINGTALK_INGRESS_STATE_INVALID')
  if(value.deferredMessages!==undefined&&(!Array.isArray(value.deferredMessages)||value.deferredMessages.some(message=>!message||typeof message.messageId!=='string'||!message.messageId||message.messageId.length>256||typeof message.occurredAt!=='string'||!Number.isFinite(Date.parse(message.occurredAt)))))throw failure('DINGTALK_INGRESS_STATE_INVALID')
  if(value.pendingRecalls!==undefined&&(!Array.isArray(value.pendingRecalls)||value.pendingRecalls.some(row=>!row||['messageId','senderId','recallerId'].some(key=>typeof row[key]!=='string'||!row[key]||row[key].length>256)||typeof row.occurredAt!=='string'||!Number.isFinite(Date.parse(row.occurredAt)))))throw failure('DINGTALK_INGRESS_STATE_INVALID')
  return value
}
export async function openDingtalkIngress(paths,channelId,{fromAt,checkOnly=false,storageKey}={}){
  const file=dingtalkChannelPaths(paths,channelId,storageKey).ingressFile
  await assertDingtalkStoragePath(paths,file)
  let state=await readDingtalkIngress(file),tail=Promise.resolve(),lastError
  const previous=JSON.stringify(state)
  if(fromAt!==undefined&&(typeof fromAt!=='string'||!Number.isFinite(Date.parse(fromAt))))throw failure('DINGTALK_INGRESS_START_INVALID')
  const save=update=>{
    const operation=tail.then(async()=>{const next=update(state);if(JSON.stringify(next)!==JSON.stringify(state)){if(!checkOnly)await atomicWrite(file,JSON.stringify(next)+'\n');state=next}})
    tail=operation.catch(error=>{lastError=error})
    return operation
  }
  if(state.firstStartedAt===undefined){
    const starts=[state.recoveryFromAt,state.pausedAt,fromAt].filter(value=>value!==undefined).sort((left,right)=>Date.parse(left)-Date.parse(right))
    if(!starts.length)throw failure('DINGTALK_INGRESS_START_REQUIRED')
    await save(current=>({...current,firstStartedAt:starts[0]}))
  }
  const overlap=value=>new Date(Math.max(0,Date.parse(value)-30_000)).toISOString()
  const earlier=(...values)=>values.filter(value=>value!==undefined).sort((left,right)=>Date.parse(left)-Date.parse(right))[0]
  const deferredFrom=current=>[...current.deferredMessages??[],...current.pendingRecalls??[]].reduce((from,message)=>earlier(from,overlap(message.occurredAt)),undefined)
  return {
    get changed(){return JSON.stringify(state)!==previous},
    snapshot(){const from=state.backfillThroughAt?overlap(state.backfillThroughAt):state.firstStartedAt;return {...state,recoveryFromAt:earlier(state.recoveryFromAt,from,deferredFrom(state))}},
    // 桥接快照只拥有暂停和恢复界，不能覆盖新消费记录或尚未接纳的消息身份。
    saveBridgeState:next=>save(current=>{
      const value={...current,paused:next.paused},from=earlier(next.recoveryFromAt,deferredFrom(current))
      if(from===undefined)delete value.recoveryFromAt;else value.recoveryFromAt=from
      if(next.pausedAt===undefined)delete value.pausedAt;else value.pausedAt=next.pausedAt
      return value
    }),
    deferred:message=>save(current=>{
      const messages=current.deferredMessages??[],prior=messages.find(row=>row.messageId===message.messageId)
      if(prior&&Date.parse(prior.occurredAt)<=Date.parse(message.occurredAt))return current
      return {...current,deferredMessages:[...messages.filter(row=>row.messageId!==message.messageId),{messageId:message.messageId,occurredAt:message.occurredAt}],recoveryFromAt:earlier(current.recoveryFromAt,overlap(message.occurredAt))}
    }),
    recall:message=>save(current=>{
      if(current.pendingRecalls?.some(row=>row.messageId===message.messageId))return current
      return {...current,pendingRecalls:[...current.pendingRecalls??[],message],recoveryFromAt:earlier(current.recoveryFromAt,overlap(message.occurredAt))}
    }),
    consumed:(message,{retracted=false}={})=>save(current=>{
      const value={...current}
      if(!current.consumedAt||Date.parse(message.occurredAt)>Date.parse(current.consumedAt))Object.assign(value,{consumedAt:message.occurredAt,consumedMessageId:message.messageId})
      if(retracted&&current.pendingRecalls){value.pendingRecalls=current.pendingRecalls.filter(row=>row.messageId!==message.messageId);if(!value.pendingRecalls.length)delete value.pendingRecalls}
      if(current.deferredMessages){value.deferredMessages=current.deferredMessages.filter(row=>row.messageId!==message.messageId);if(!value.deferredMessages.length)delete value.deferredMessages}
      return value
    }),
    completedRange:range=>save(current=>current.deferredMessages?.length||current.pendingRecalls?.length?current:!current.backfillThroughAt||Date.parse(range.end)>Date.parse(current.backfillThroughAt)?{...current,backfillThroughAt:range.end}:current),
    async drain(){await tail;if(lastError)throw lastError},
  }
}

/** 只检查该渠道旧身份的持久延迟消息；不移动或删除旧 binding/ingress。 */
export async function assertDingtalkTargetSwitch(paths,channelId,nextBinding){
  const base=dingtalkChannelPaths(paths,channelId),directory=join(dirname(base.bindingFile),'targets')
  await assertDingtalkStoragePath(paths,join(directory,'probe.json'))
  const keys=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error})
  if(keys.some(key=>!/^[a-f0-9]{64}$/.test(key)))throw failure('DINGTALK_STORAGE_IDENTITY_INVALID')
  for(const key of [undefined,...keys]){
    const files=dingtalkChannelPaths(paths,channelId,key)
    await assertDingtalkStoragePath(paths,files.bindingFile);await assertDingtalkStoragePath(paths,files.ingressFile)
    const binding=await readDingtalkBinding(files.bindingFile)
    if(binding&&dingtalkBindingKey(binding)===dingtalkBindingKey(nextBinding))continue
    const ingress=await readDingtalkIngress(files.ingressFile)
    if(ingress.deferredMessages?.length||ingress.pendingRecalls?.length)throw failure('DINGTALK_CHANNEL_SWITCH_BLOCKED')
  }
}
