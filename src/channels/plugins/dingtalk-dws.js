import {join} from 'node:path'
import {createDwsAdapter} from '../../../packages/dingtalk-core/dws-adapter.js'
import {createNodeDwsRunner} from '../../../packages/dingtalk-core/dws-runner.js'
import {normalizeHistoryMessage,startDwsBridge} from '../../../packages/dingtalk-core/dws-bridge.js'
import {sendWorkflowNotification} from '../../../packages/dingtalk-core/group-message.js'
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
  const paths=ctx.runtimePaths,privateHome=join(paths.secrets,'dingtalk-dws'),workspace=join(paths.workspaces,'channels','dingtalk-dws'),cache=join(paths.cache,'dingtalk-dws')
  for(const directory of [privateHome,join(privateHome,'config'),workspace,cache])await privateDirectory(directory)
  const environment={...process.env,HOME:privateHome,USERPROFILE:privateHome,XDG_CONFIG_HOME:join(privateHome,'config'),XDG_CACHE_HOME:cache,TMPDIR:paths.temp,TMP:paths.temp,TEMP:paths.temp}
  const runnerFor=cwd=>dependencies.runner?{...dependencies.runner,cwd}:createNodeDwsRunner({executable:config.executable??'dws',cwd,env:environment}),runner=runnerFor(workspace)
  const adapter=createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized===true,profile:config.profile,runner}),channelId=config.channelId??'dingtalk-dws'
  let app,stopBridge,health={healthy:false,configured:true},closed=false
  const normalize=(raw,fallback)=>{const value=normalizeHistoryMessage({...raw,conversationId:raw.conversationId??raw.groupId,createTime:raw.createTime??raw.occurredAt},fallback);if(value.quotedMessage){value.quotedMessage.text=value.quotedMessage.content??'';const sender=raw.quotedMessage?.senderOpenDingTalkId??raw.quotedMessage?.senderId;if(sender)value.quotedMessage.senderOpenDingTalkId=sender}return value}
  const typed=(notification,envelope)=>({...notification,payload:{...notification.payload,conversationId:envelope.conversationId,sourceMessageId:envelope.replyToMessageId,replyToMessageId:envelope.replyToMessageId,actorId:envelope.senderId,replyToSenderOpenDingTalkId:envelope.senderId,atOpenDingTalkIds:envelope.mentions,text:envelope.text}})
  const notifications={canDisclose:()=>config.writesAuthorized===true,
    send:notification=>notification.payload.audience==='operator'?adapter.sendSelfIntent({userId:notification.payload.recipientUserId,text:notification.payload.text,idempotencyKey:notification.id,taskId:notification.taskId,humanRequestId:notification.payload.humanRequestId}):sendWorkflowNotification(adapter,notification),
    readback:notification=>notification.payload.audience==='operator'?readOperatorNotificationDelivery(adapter,notification):readTaskNotificationDelivery(adapter,notification,{senderActorId:config.assistantActorId}),
    sendFile:(_notification,file)=>createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized===true,profile:config.profile,runner:runnerFor(file.directory)}).sendGroupFile({groupId:_notification.payload.conversationId,fileName:file.fileName,idempotencyKey:_notification.id}),
    readbackFile:notification=>readTaskFileDelivery(adapter,notification),querySendStatus:id=>adapter.querySendStatus(id),recall:notification=>recallOperatorNotification(adapter,notification)}
  const unregister=ctx.channels.registerTransport(channelId,{canSend:()=>config.writesAuthorized===true,
    send:(envelope,notification)=>notifications.send(typed(notification,envelope)),readback:(envelope,notification)=>notifications.readback(typed(notification,envelope)),sendFile:(envelope,notification,file)=>notifications.sendFile(typed(notification,envelope),file),readbackFile:(envelope,notification)=>notifications.readbackFile(typed(notification,envelope)),
    readMessage:async({conversationId,messageId})=>normalize(await adapter.readMessage(conversationId,messageId),conversationId),
    readResource:({conversationId,messageId,resource})=>adapter.readMessageResource(conversationId,messageId,resource),
    readMentioned:({conversationId,messageId,resource})=>adapter.isMessageMentioned(conversationId,messageId,resource?.occurredAt)})
  const acceptHistoryMessage=async(raw,{type='chat-room'}={})=>{
    if(closed||!app)throw failure('CHANNEL_PLUGIN_NOT_READY')
    const message=normalize(raw,raw.groupId??raw.conversationId)
    if(!message?.groupId||!message.messageId||!message.senderOpenDingTalkId)throw failure('DWS_PLUGIN_AUTHENTICATED_IDENTITY_REQUIRED')
    return ctx.channels.receive({type,channelId,conversationId:message.groupId,senderId:message.senderOpenDingTalkId,messageId:message.messageId,text:message.text||'[attachment]',...message.occurredAt?{sentAt:message.occurredAt}:{},...message.resourceRefs?.length?{resourceRefs:message.resourceRefs}:{},...message.quotedMessage?.messageId?{quotedMessage:{messageId:message.quotedMessage.messageId,text:message.quotedMessage.text??'',senderId:message.quotedMessage.senderOpenDingTalkId}}:{}})
  }
  const plugin={adapter,notifications,acceptHistoryMessage,commands:nativeDwsCommands,observation:nativeDwsObservation,createObserver:createNativeDwsObserver,get health(){return health},get accountDirectory(){return privateHome}}
  ctx.provide('dingtalkChannel',plugin)
  const stopObserver=ctx.channels.registerOperationObserver(channelId,plugin),stopOperator=config.operatorNotifications===true?ctx.channels.registerOperatorNotifications(channelId,notifications):undefined
  const stop=async()=>{if(closed)return;closed=true;await stopBridge?.();unregister();stopObserver();stopOperator?.();await prepareSecrets(paths)}
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
    const stateFile=join(paths.state,'channels','dingtalk-dws','ingress.json'),ingressState=JSON.parse(await readRegular(stateFile)??'{"paused":false}')
    stopBridge=startDwsBridge({runtime:facade,adapter,logger:{info:()=>{},warn:()=>ctx.logger.warn('DWS_CHANNEL_IO_FAILED'),error:()=>ctx.logger.warn('DWS_CHANNEL_IO_FAILED')},humanUserId:config.humanUserId,currentDwsUserName:config.currentUserName,ingressState,saveIngressState:state=>atomicWrite(stateFile,JSON.stringify(state)+'\n'),onHealthChange:value=>{health=value}})
  })
}
