import {dwsEnvironment,dwsAccountPolicy} from './dws-environment.js'
import {channelGroupResponsibilities} from '../service.js'
import {hash} from '../../memory/format.js'
import {join} from 'node:path'
import {createDwsAdapter} from '../../../packages/dingtalk-core/dws-adapter.js'
import {createNodeDwsRunner} from '../../../packages/dingtalk-core/dws-runner.js'
import {normalizeHistoryMessage,startDwsBridge} from '../../../packages/dingtalk-core/dws-bridge.js'
import {sendWorkflowNotification,notificationOpenTaskId} from '../../../packages/dingtalk-core/group-message.js'
import {readTaskNotificationDelivery,readOperatorNotificationDelivery,recallOperatorNotification} from '../../../packages/dingtalk-core/task-notification-readback.js'
import {readTaskFileDelivery} from '../../../packages/dingtalk-core/task-final-delivery.js'
import {createNativeDwsObserver,nativeDwsCommands,nativeDwsObservation} from '../../../packages/dingtalk-core/native-dws-send.js'
import {privateDirectory,atomicWrite,readRegular,failure} from '../../runtime/files.js'
import {prepareSecrets} from '../../runtime/paths.js'
export const name='night-channel-dingtalk-dws',inject=['channels','runtimePaths']
/** Optional channel plugin; retaining the attributed rich CLI adapter/bridge
 * keeps history, subscriptions, media/docs/files and receipt recovery available. */
export async function apply(ctx,config={},dependencies={}){
  if(config.enabled!==true)return
  if(typeof config.profile!=='string'||!config.profile.trim())throw failure('DWS_PLUGIN_PROFILE_REQUIRED')
  const responsibilities=channelGroupResponsibilities(config.groups,config.responsibility)
  if(config.directChats===true&&(!Array.isArray(config.directPeers)||!config.directPeers.length||config.directPeers.some(id=>typeof id!=='string'||!id)||!config.assistantActorId))throw failure('DWS_DIRECT_PEERS_AND_SELF_REQUIRED')
  if(config.operatorNotifications===true&&(!Array.isArray(config.operatorPeers)||!config.operatorPeers.length||config.operatorPeers.some(id=>typeof id!=='string'||!id)))throw failure('DWS_OPERATOR_PEERS_REQUIRED')
  const privatePeers=[...new Set([...(config.directChats===true?config.directPeers:[]),...(config.operatorNotifications===true?config.operatorPeers:[])])]
  const channelId=config.channelId??'dingtalk-dws',namespace=channelId==='dingtalk-dws'?'dingtalk-dws':'dingtalk-dws-'+hash(channelId)
  const paths=ctx.runtimePaths,privateHome=join(paths.secrets,namespace),workspace=join(paths.workspaces,'channels',namespace),cache=join(paths.cache,namespace)
  const accountPolicy=dwsAccountPolicy(config.accountMode)
  const environment=dwsEnvironment(paths,privateHome,cache,{accountMode:accountPolicy.mode})
  for(const directory of [...accountPolicy.mode==='private'?[privateHome,join(privateHome,'config'),join(privateHome,'keychain')]:[],workspace,cache])await privateDirectory(directory)
  const runnerFor=cwd=>dependencies.runner?{...dependencies.runner,cwd}:createNodeDwsRunner({executable:config.executable??'dws',cwd,env:environment}),runner=runnerFor(workspace)
  const adapter=createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized===true,profile:config.profile,runner})
  let app,stopBridge,health={healthy:false,configured:true},closed=false
  const normalize=(raw,fallback)=>{const value=normalizeHistoryMessage({...raw,conversationId:raw.conversationId??raw.groupId,createTime:raw.createTime??raw.occurredAt},fallback);if(value.quotedMessage){value.quotedMessage.text=value.quotedMessage.content??'';const sender=raw.quotedMessage?.senderOpenDingTalkId??raw.quotedMessage?.senderId;if(sender)value.quotedMessage.senderOpenDingTalkId=sender}return value}
  const typed=(notification,envelope)=>({...notification,payload:{...notification.payload,conversationId:envelope.conversationId,sourceMessageId:envelope.replyToMessageId,replyToMessageId:envelope.replyToMessageId,actorId:envelope.senderId,replyToSenderOpenDingTalkId:envelope.replyToParticipantId,atOpenDingTalkIds:envelope.recipientIds,text:envelope.text}})
  const notifications={canDisclose:()=>config.writesAuthorized===true,
    send:notification=>notification.payload.audience==='operator'?adapter.sendSelfIntent({userId:notification.payload.recipientUserId,text:notification.payload.text,idempotencyKey:notification.id,taskId:notification.taskId,humanRequestId:notification.payload.humanRequestId}):sendWorkflowNotification(adapter,notification),
    readback:notification=>notification.payload.audience==='operator'?readOperatorNotificationDelivery(adapter,notification):readTaskNotificationDelivery(adapter,notification,{senderActorId:config.assistantActorId}),
    sendFile:(_notification,file)=>createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized===true,profile:config.profile,runner:runnerFor(file.directory)}).sendGroupFile({groupId:_notification.payload.conversationId,fileName:file.fileName,idempotencyKey:_notification.id}),
    readbackFile:notification=>readTaskFileDelivery(adapter,notification),querySendStatus:id=>adapter.querySendStatus(id),recall:notification=>recallOperatorNotification(adapter,notification)}
  const unregister=ctx.channels.registerTransport(channelId,{canSend:()=>config.writesAuthorized===true,
    capabilities:{account:accountPolicy,privateSubscription:{scope:'explicit-peers',peerCount:privatePeers.length},conversationTypes:config.directChats===true?['chat','chat-room']:['chat-room'],files:['chat-room'],quotedReplies:config.directChats===true?['chat','chat-room']:['chat-room']},
    send:(envelope,notification)=>envelope.type==='chat'?adapter.sendDirectIntent({openDingTalkId:envelope.senderId,text:envelope.text,idempotencyKey:notification.id,conversationId:envelope.conversationId,replyToMessageId:envelope.replyToMessageId,replyToSenderId:envelope.senderId}):notifications.send(typed(notification,envelope)),
    readback:async(envelope,notification)=>{
      if(envelope.type!=='chat')return notifications.readback(typed(notification,envelope))
      const receipt=notification.ack??notification.receipt,openTaskId=notificationOpenTaskId(receipt)
      if(!openTaskId){
        const messageId=receipt?.messageId??receipt?.sendReceipt?.messageId??receipt?.sendReceipt?.messageRef?.openMessageId??receipt?.messageRef?.openMessageId??receipt?.result?.openMessageId??receipt?.result?.messageId
        if(messageId)return notifications.readback({...typed(notification,envelope),ack:{...receipt,messageId}})
        return undefined // No send acknowledgement: never infer permission to resend.
      }
      const status=await adapter.querySendStatus(openTaskId),conversationId=status.messageRef?.openConversationId??status.result?.openConversationId,messageId=status.messageRef?.openMessageId??status.result?.openMessageId
      if(status.result?.sendStatus!=='SUCCESS'||conversationId!==envelope.conversationId||!messageId)return undefined
      return {messageId,conversationId,identity:'send-receipt',mentionVerification:'unavailable',observedAt:new Date().toISOString()}
    },
    sendFile:(envelope,notification,file)=>{if(envelope.type==='chat')throw failure('DWS_DIRECT_FILE_UNSUPPORTED');return notifications.sendFile(typed(notification,envelope),file)},readbackFile:(envelope,notification)=>notifications.readbackFile(typed(notification,envelope)),
    readMessage:async({conversationId,messageId})=>normalize(await adapter.readMessage(conversationId,messageId),conversationId),
    readResource:({conversationId,messageId,resource})=>adapter.readMessageResource(conversationId,messageId,resource),
    readMentioned:({conversationId,messageId,resource})=>adapter.isMessageMentioned(conversationId,messageId,resource?.occurredAt)})
  const acceptHistoryMessage=async(raw,{type='chat-room'}={})=>{
    if(!['chat','chat-room'].includes(type)||type==='chat'&&(config.directChats!==true||!config.directPeers.includes(raw.senderOpenDingTalkId)||raw.senderOpenDingTalkId===config.assistantActorId))throw failure('DWS_CHAT_NOT_AUTHORIZED')
    if(closed||!app)throw failure('CHANNEL_PLUGIN_NOT_READY')
    const message=normalize(raw,raw.groupId??raw.conversationId)
    if(!message?.groupId||!message.messageId||!message.senderOpenDingTalkId)throw failure('DWS_PLUGIN_AUTHENTICATED_IDENTITY_REQUIRED')
    const channelInput={type,channelId,conversationId:message.groupId,senderId:message.senderOpenDingTalkId,messageId:message.messageId,text:message.text||'[attachment]',...message.occurredAt?{sentAt:message.occurredAt}:{},...typeof message.mentionedAgent==='boolean'?{mentionedAgent:message.mentionedAgent}:{},...message.mentions?{mentions:message.mentions}:{},...message.messageAiSendFlag?{platformFlags:{messageAiSendFlag:message.messageAiSendFlag,automated:message.messageAiSendFlag==='DWS'}}:{},...message.resourceRefs?.length?{resourceRefs:message.resourceRefs}:{},...message.quotedMessage?.messageId?{quotedMessage:{messageId:message.quotedMessage.messageId,text:message.quotedMessage.text??'',...message.quotedMessage.senderOpenDingTalkId?{senderId:message.quotedMessage.senderOpenDingTalkId}:{}}}:{}}
    const identity=ctx.channels.identity(channelInput)
    if(app.tasks.isOwnNotification({groupId:identity.sessionId,messageId:message.messageId}))return {accepted:false,processing:'ignored',reason:'own-notification',channelType:type,conversationId:message.groupId}
    return ctx.channels.receive(channelInput)
  }
  const plugin={accountPolicy,adapter,notifications,acceptHistoryMessage,responsibility:context=>context.type==='chat-room'&&context.channelId===channelId?responsibilities.get(context.conversationId):undefined,commands:nativeDwsCommands,observation:nativeDwsObservation,createObserver:options=>createNativeDwsObserver({...options,resolveNotificationScope:notification=>{
    const context=ctx.channels.groupContext(notification.payload?.conversationId)
    if(context?.channelId!==channelId||context.type!=='chat-room')return
    return {conversationId:context.conversationId,querySendStatus:id=>adapter.querySendStatus(id)}
  }}),get health(){return health},get accountDirectory(){return accountPolicy.mode==='private'?privateHome:undefined}}
  const unregisterPlugin=ctx.channels.registerPlugin(channelId,plugin)
  if(!ctx.get('dingtalkChannel'))ctx.provide('dingtalkChannel',plugin)
  const stopObserver=ctx.channels.registerOperationObserver(channelId,plugin),stopOperator=config.operatorNotifications===true?ctx.channels.registerOperatorNotifications(channelId,notifications):undefined
  const stop=async()=>{if(closed)return;closed=true;try{await stopBridge?.()}finally{unregister();unregisterPlugin();stopObserver();stopOperator?.();await prepareSecrets(paths)}}
  ctx.effect(()=>stop,'DWS channel shutdown');ctx.on('night/stopping',stop)
  ctx.on('night/ready',async application=>{
    app=application;if(config.listen===false){health={healthy:false,configured:true,listening:false};return}
    const groups=config.groups??[],keyOf=groupId=>ctx.channels.identity({type:'chat-room',channelId,conversationId:groupId,senderId:'namespace-only',messageId:'namespace-only',text:'namespace-only'}).sessionId
    const facade=new Proxy(app.runtime,{get(target,key){
      if(key==='listGroups')return()=>groups.map(group=>facade.getGroup(typeof group==='string'?group:group.groupId))
      if(key==='getGroup')return groupId=>{const data=target.getGroup(keyOf(groupId)),context=ctx.channels.groupContext(keyOf(groupId));return {...data,groupId,messages:(data?.messages??[]).map(message=>({...message,senderOpenDingTalkId:context?.participants[message.senderOpenDingTalkId]??message.senderOpenDingTalkId})),outbox:data?.outbox??[]}}
      if(key==='ingest')return raw=>acceptHistoryMessage(raw)
      if(key==='isOwnNotification')return raw=>app.tasks.isOwnNotification({...raw,groupId:keyOf(raw.groupId)})
      if(key==='isWorkflowGroup')return()=>false
      if(key==='onGroupSubscribed'||key==='onGroupUnsubscribed'||key==='onOutboxAppended')return()=>()=>{}
      if(key==='isTaskSessionMode')return()=>true
      if(key==='taskSessionNotifications')return true
      return Reflect.get(target,key)
    }})
    const stateFile=join(paths.state,'channels',namespace,'ingress.json'),ingressState=JSON.parse(await readRegular(stateFile)??'{"paused":false}')
    stopBridge=startDwsBridge({privatePeerIds:privatePeers,operatorRepliesEnabled:config.operatorNotifications===true,runtime:facade,adapter,logger:{info:()=>{},warn:()=>ctx.logger.warn('DWS_CHANNEL_IO_FAILED'),error:()=>ctx.logger.warn('DWS_CHANNEL_IO_FAILED')},humanUserId:config.humanUserId,currentDwsUserName:config.currentUserName,ingressState,saveIngressState:state=>atomicWrite(stateFile,JSON.stringify(state)+'\n'),onDirectMessage:config.directChats===true?raw=>config.directPeers.includes(raw.senderOpenDingTalkId)&&raw.senderOpenDingTalkId!==config.assistantActorId?acceptHistoryMessage(raw,{type:'chat'}):undefined:undefined,onHealthChange:value=>{health=value}})
  })
}
