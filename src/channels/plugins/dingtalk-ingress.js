import {failure} from '../../runtime/files.js'
import {dwsReadJson} from './dingtalk-binding.js'
import {messageTimestamp} from '../../../packages/dingtalk-core/dws-bridge.js'

const present=value=>typeof value==='string'&&value.trim()!==''
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
