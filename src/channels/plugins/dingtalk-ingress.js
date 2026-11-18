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
/** Recover the original IDs using the raw response, which preserves the author namespace. */
export async function readPausedDeferred(runner,binding,rows,end){
  const ids=new Set(rows.map(row=>row.messageId)),messages=[]
  if(ids.size!==rows.length||[...ids].some(id=>!present(id)||/[\s,\u0000-\u001f]/u.test(id)))throw failure('DINGTALK_DEFERRED_IDENTITY_INVALID')
  const cutoff=Date.parse(end)
  for(let offset=0;offset<rows.length;offset+=50){
    const expected=new Map(rows.slice(offset,offset+50).map(row=>[row.messageId,row]))
    const value=await dwsReadJson(runner,['chat','message','list-by-ids','--msg-ids',[...expected.keys()].join(',')],binding.profile)
    const page=value.result
    if(value.success!==true||value.truncated===true||value.decryptFailedCount!==0||!Array.isArray(page?.messages)||page.success===false||page.partial===true||page.complete===false||page.hasMore===true||page.truncated===true||(page.failedCount??0)!==0||page.failures?.length)throw failure('DINGTALK_DEFERRED_HISTORY_INCOMPLETE')
    for(const row of page.messages){
      const saved=expected.get(row?.messageId),at=messageTimestamp(row?.createTime),originalAt=Date.parse(saved?.occurredAt)
      if(!saved||row.conversationId!==binding.conversationId||row.openConversationId!==undefined&&row.openConversationId!==binding.conversationId
        ||row.openMessageId!==undefined&&row.openMessageId!==row.messageId||!present(row.senderOpenDingTalkId)||row.senderIdentityVerified===false
        ||!Number.isFinite(at)||at>=cutoff||Math.floor(at/1000)!==Math.floor(originalAt/1000))throw failure('DINGTALK_DEFERRED_IDENTITY_INVALID')
      const quote=row.quotedMessage
      if(quote?.messageId&&quote.openMessageId&&quote.messageId!==quote.openMessageId)throw failure('DINGTALK_DEFERRED_IDENTITY_INVALID')
      messages.push({...row,createTime:saved.occurredAt,...quote?{quotedMessage:{...quote,messageId:quote.messageId??quote.openMessageId}}:{}})
      expected.delete(row.messageId)
    }
    if(expected.size)throw failure('DINGTALK_DEFERRED_HISTORY_INCOMPLETE')
  }
  return messages.sort((a,b)=>Date.parse(a.createTime)-Date.parse(b.createTime))
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
export function dingtalkIngressAdapter(adapter,config,{runner,getFromAt=()=>undefined,completeGroupRange,retryDeferredIngress,onRecall,beforeRangeRead=async()=>{}}={}){
  return {...adapter,completeGroupRange,retryDeferredIngress,
    startGroupSubscription(conversationId,onEvent,{isCurrent}={}){
      if(conversationId!==config.binding.conversationId)throw failure('DINGTALK_INGRESS_TARGET_MISMATCH')
      const accept=event=>{
        if(event.conversation_id!==conversationId||isCurrent?.()===false)return
        const sender=event.sender_open_dingtalk_id??event.sender_id
        if(config.conversationType==='chat'&&sender!==config.binding.peerId)return
        if(['user_im_message_recall_group','user_im_message_recall_o2o'].includes(event.type)){
          const expected=config.conversationType==='chat'?'user_im_message_recall_o2o':'user_im_message_recall_group'
          const at=messageTimestamp(event.recall_time??event.event_time??event.timestamp)
          if(event.type!==expected||!present(event.message_id)||!present(sender)||!present(event.recaller_open_dingtalk_id)||!Number.isFinite(at))throw failure('DINGTALK_RECALL_IDENTITY_INVALID')
          if(typeof onRecall!=='function')throw failure('DINGTALK_RECALL_UNSUPPORTED')
          return onRecall({groupId:conversationId,messageId:event.message_id,senderOpenDingTalkId:sender,...event.sender_open_dingtalk_id==null?{senderIdentityVerified:false}:{},text:'[消息已撤回]',occurredAt:new Date(at).toISOString(),retraction:{senderId:event.recaller_open_dingtalk_id,at:new Date(at).toISOString()}})
        }
        return onEvent(event)
      }
      return config.conversationType==='chat'?adapter.startPrivateSubscription(config.binding.peerId,accept,{recalls:true}):adapter.startGroupSubscription(conversationId,accept,{recalls:true})
    },
    async readGroupRange(conversationId,range,{recovering=false}={}){
      if(conversationId!==config.binding.conversationId)throw failure('DINGTALK_INGRESS_TARGET_MISMATCH')
      const fromAt=getFromAt({recovering})
      await beforeRangeRead()
      if(fromAt!==undefined)range={...range,start:fromAt}
      const value=config.conversationType==='chat'
        ?await dwsReadJson(runner,['chat','+chat-messages','--open-dingtalk-id',config.binding.peerId,'--start',range.start,'--end',range.end,'--order','asc','--page-all'],config.profile)
        :await adapter.readGroupRange(conversationId,range)
      return {...value,messages:historyMessages(value,config)}
    }}
}
