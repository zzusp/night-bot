import {failure} from '../../runtime/files.js'
import {dwsReadJson} from './dingtalk-binding.js'
import {hash} from '../../memory/format.js'
import {messageTimestamp,normalizeResourceRefs} from '../../../packages/dingtalk-core/dws-bridge.js'

const present=value=>typeof value==='string'&&value.trim()!==''
// 与 Host 冻结指纹一致；兼容识别不能改写该事实。
export function dingtalkInputFingerprint({principal,envelope:e}){
  return hash(JSON.stringify([principal,e.text,e.resourceRefs??[],e.quotedMessage??null,e.mentionedAgent??null,e.mentions??[],e.platformFlags??{}]))
}
function resourceIdentity(refs){
  if(!Array.isArray(refs)||refs.some(ref=>!['fileId','mediaId','dingtalkDoc'].includes(ref?.type)||!present(ref.resourceId)))return
  return JSON.stringify(refs.map(ref=>JSON.stringify([ref.type,ref.resourceId])).sort())
}
function fileDisplayText(text,refs){
  const file=/^(\[文件\] .+ fileId: ([^\s]+))(?: 注意：如需下载使用dws drive download命令下载)?$/u.exec(text)
  return file&&refs.some(ref=>ref.type==='fileId'&&ref.resourceId===file[2])?file[1]:text
}
/** 只消费已处理来源的可证明重复项，不重新接纳业务或放宽核心指纹。 */
export function retainedDingtalkDuplicate(identity,prior,source,{quoteSenderIds=[]}={}){
  const e=identity.envelope,version=e.messageVersion??1
  if(!prior||dingtalkInputFingerprint(identity)===prior.payloadHash||!source||source.routed!==true
    ||source.groupId!==identity.sessionId||source.messageId!==e.messageId||source.version!==version
    ||(prior.version??1)!==version||source.actorId!==identity.principal)return false
  const resources=source.resources??[],incoming=e.resourceRefs??[],anchors=resourceIdentity(resources)
  if(anchors===undefined||anchors!==resourceIdentity(incoming)
    ||fileDisplayText(source.text,resources)!==fileDisplayText(e.text,incoming))return false
  const quotes=[e.quotedMessage],quote=source.quote
  if(Boolean(quote)!==Boolean(e.quotedMessage))return false
  if(quote){
    if(quote.messageId!==e.quotedMessage.messageId||(quote.text??'')!==(e.quotedMessage.text??''))return false
    const actor=sender=>'channel-actor-'+hash(JSON.stringify([e.channelId,sender]))
    if(e.quotedMessage.senderId!==undefined&&actor(e.quotedMessage.senderId)!==quote.actorId)return false
    const senderId=quoteSenderIds.find(sender=>actor(sender)===quote.actorId)
    if(senderId!==undefined)quotes.push({messageId:quote.messageId,senderId,text:quote.text??''})
  }
  const flags=[e.platformFlags??{}]
  if(e.platformFlags?.messageAiSendFlag==='DWS'&&e.platformFlags.automated===true
    &&Object.keys(e.platformFlags).every(key=>['messageAiSendFlag','automated'].includes(key)))flags.push({})
  // SQLite 来源对象会按键排序；复用原生展示解析重建已观察到的附件字段顺序。
  const parsed=normalizeResourceRefs([],source.text),resourceVariants=[resources]
  if(resourceIdentity(parsed)===anchors)resourceVariants.push(parsed)
  return flags.some(platformFlags=>resourceVariants.some(resourceRefs=>quotes.some(quotedMessage=>
    dingtalkInputFingerprint({...identity,envelope:{...e,text:source.text,resourceRefs,quotedMessage,platformFlags}})===prior.payloadHash)))
}
function historyMessages(value,config){
  if(!Array.isArray(value.messages)||value.complete!==true||value.hasMore!==false||value.partial===true||value.failedCount!==0||!Array.isArray(value.failures)||value.failures.length)throw failure('DINGTALK_HISTORY_INCOMPLETE')
  const binding=config.binding
  for(const message of value.messages){
    const sender=message.senderOpenDingTalkId??message.senderId
    if(!present(message.messageId)||message.conversationId!==binding.conversationId||!present(sender)||!Number.isFinite(messageTimestamp(message.createTime)))throw failure('DINGTALK_HISTORY_IDENTITY_INVALID')
    if(config.conversationType==='chat'&&sender!==binding.peerId&&sender!==binding.actorId)throw failure('DINGTALK_HISTORY_PEER_MISMATCH')
  }
  // 私聊仅接收绑定对端；群回声交给 Host 按精确消息 ID 和持久回执识别。
  return config.conversationType==='chat'?value.messages.filter(message=>(message.senderOpenDingTalkId??message.senderId)===binding.peerId):value.messages
}
/** 复用 bridge 已有的暂停、恢复、补拉和 drain；原生 ID 留在插件内部。 */
export function dingtalkIngressAdapter(adapter,config,{runner,getFromAt=()=>undefined,getDeferredMessages=()=>[],onRangeRead=()=>{}}){
  return {...adapter,
    startGroupSubscription(conversationId,onEvent){
      if(conversationId!==config.binding.conversationId)throw failure('DINGTALK_INGRESS_TARGET_MISMATCH')
      const accept=event=>{
        if(event.conversation_id!==conversationId)return
        const sender=event.sender_open_dingtalk_id??event.sender_id
        if(config.conversationType==='chat'&&sender!==config.binding.peerId)return
        return onEvent(event)
      }
      return config.conversationType==='chat'?adapter.startPrivateSubscription(config.binding.peerId,accept):adapter.startGroupSubscription(conversationId,accept)
    },
    async readGroupRange(conversationId,range){
      if(conversationId!==config.binding.conversationId)throw failure('DINGTALK_INGRESS_TARGET_MISMATCH')
      const fromAt=getFromAt()
      if(Date.parse(range.start)<Date.parse(fromAt))range={...range,start:fromAt}
      const deferredStart=getDeferredMessages().reduce((start,message)=>Math.min(start,Math.max(0,messageTimestamp(message.occurredAt)-30_000)),Date.parse(range.start))
      if(deferredStart<Date.parse(range.start))range={...range,start:new Date(deferredStart).toISOString()}
      const value=config.conversationType==='chat'
        ?await dwsReadJson(runner,['chat','+chat-messages','--open-dingtalk-id',config.binding.peerId,'--start',range.start,'--end',range.end,'--order','asc','--page-all'],config.profile)
        :await adapter.readGroupRange(conversationId,range)
      const messages=historyMessages(value,config),messageIds=new Set(messages.map(message=>message.messageId))
      // 已知暂缓消息未出现时，供应商的 complete 空页不能解除耐久恢复界。
      if(getDeferredMessages().some(message=>!messageIds.has(message.messageId)))throw failure('DINGTALK_DEFERRED_HISTORY_INCOMPLETE')
      onRangeRead({...range})
      return {...value,messages}
    }}
}
