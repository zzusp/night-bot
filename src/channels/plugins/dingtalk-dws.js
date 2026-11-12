import {dwsEnvironment,dwsAccountPolicy} from './dws-environment.js'
import {join} from 'node:path'
import {createDwsAdapter} from '../../../packages/dingtalk-core/dws-adapter.js'
import {createNodeDwsRunner} from '../../../packages/dingtalk-core/dws-runner.js'
import {normalizeHistoryMessage,startDwsBridge} from '../../../packages/dingtalk-core/dws-bridge.js'
import {sendWorkflowNotification,notificationOpenTaskId} from '../../../packages/dingtalk-core/group-message.js'
import {readTaskNotificationDelivery,readOperatorNotificationDelivery,recallOperatorNotification} from '../../../packages/dingtalk-core/task-notification-readback.js'
import {readTaskFileDelivery} from '../../../packages/dingtalk-core/task-final-delivery.js'
import {createNativeDwsObserver,nativeDwsCommands,nativeDwsObservation} from '../../../packages/dingtalk-core/native-dws-send.js'
import {privateDirectory,atomicWrite,withLock,failure} from '../../runtime/files.js'
import {prepareSecrets} from '../../runtime/paths.js'
import {resolveDingtalkBinding,verifyDingtalkBinding} from './dingtalk-binding.js'
import {dingtalkChannelPaths,openDingtalkIngress,assertDingtalkStoragePath,assertDingtalkTargetSwitch,readDingtalkBinding} from './dingtalk-storage.js'
import {hash} from '../../memory/format.js'
import {dingtalkIngressAdapter,dingtalkInputFingerprint,retainedDingtalkDuplicate} from './dingtalk-ingress.js'
import {observeDwsLogin} from './dingtalk-auth.js'
export {validateConfig} from './dingtalk-config.js'
export const name='night-channel-dingtalk-dws',inject=['channels','runtimePaths']
export const channelLifecycle=1
export const channelIngressControl=1
/** Optional channel plugin; retaining the attributed rich CLI adapter/bridge
 * keeps history, subscriptions, media/docs/files and receipt recovery available. */
export async function apply(ctx,config={},dependencies={}){
  if(config.enabled!==true)return
  const channelId=config.channelId,paths=ctx.runtimePaths
  if(!channelId||!config.profile||!['chat','chat-room'].includes(config.conversationType))throw failure('DINGTALK_PLUGIN_NORMALIZED_CONFIG_REQUIRED')
  if(config.receivePaused!==undefined&&typeof config.receivePaused!=='boolean')throw failure('DINGTALK_SETTINGS_INVALID')
  config={...config,receivePaused:config.receivePaused===true}
  if(paths.mode!=='portable')throw failure('DINGTALK_PORTABLE_LAYOUT_REQUIRED')
  const {privateHome,workspace,cache,bindingFile,ingressFile}=dingtalkChannelPaths(paths,channelId,config.storageKey)
  const accountPolicy=dwsAccountPolicy(config.accountMode)
  const environment=dwsEnvironment(paths,privateHome,cache,{accountMode:accountPolicy.mode,...dependencies.environment?{inherited:dependencies.environment}:{}})
  for(const directory of [...accountPolicy.mode==='private'?[privateHome,join(privateHome,'config'),join(privateHome,'keychain')]:[],workspace,cache])await privateDirectory(directory)
  const runnerFor=cwd=>dependencies.runner?{...dependencies.runner,cwd}:createNodeDwsRunner({executable:config.executable??'dws',cwd,env:environment}),runner=runnerFor(workspace)
  let app,adapter,stopBridge,ingressStore,stopAuthObserver,readyBound=false,terminal=false,closed=false,cursorError=false,lastRange,targetValidated=false
  let health={healthy:false,configured:true,state:'starting'},startTail=Promise.resolve(),settingsTail=Promise.resolve(),ingressTail=Promise.resolve()
  const ingressCalls=new Set()
  const readSavedBinding=async()=>{
    const saved=await readDingtalkBinding(bindingFile)
    if(saved&&config.binding&&(Object.keys(saved).some(key=>saved[key]!==config.binding[key])||Object.keys(config.binding).some(key=>saved[key]!==config.binding[key])))throw failure('DINGTALK_BINDING_CHANGED')
    return saved
  }
  const bind=async()=>{
    await assertDingtalkStoragePath(paths,bindingFile)
    await assertDingtalkStoragePath(paths,ingressFile)
    await withLock(bindingFile+'.lock',async()=>{
      const saved=await readSavedBinding()
      const binding=await resolveDingtalkBinding({...config,binding:saved??config.binding},{runner,onDisplayName:name=>{config.conversationName=name}})
      if(saved===undefined)await atomicWrite(bindingFile,JSON.stringify(binding)+'\n')
      Object.assign(config,{profile:binding.profile,binding,groupId:config.conversationType==='chat-room'?binding.conversationId:undefined,groups:config.conversationType==='chat-room'?[binding.conversationId]:[],directPeers:config.conversationType==='chat'?[binding.peerId]:[],assistantActorId:binding.actorId})
    })
    adapter=createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized===true,profile:config.profile,runner})
  }
  let closing,preparing,unregister=()=>{},unregisterPlugin=()=>{},stopObserver=()=>{},stopOperator
  const stop=()=>closing??=(async()=>{
    closed=true
    const errors=[]
    for(const action of [()=>preparing,()=>stopAuthObserver?.(),()=>startTail,()=>settingsTail,()=>stopBridge?.setIngressPaused(true),()=>stopBridge?.(),()=>Promise.allSettled([...ingressCalls]),()=>ingressStore?.drain()])try{await action()}catch(error){errors.push(error)}
    if(errors.length)throw new AggregateError(errors,'DINGTALK_SHUTDOWN_FAILED')
    await stopObserver();await prepareSecrets(paths)
    unregister();unregisterPlugin();stopOperator?.()
  })()
  dependencies.registerStopAndDrain?.(stop)
  ctx.effect(()=>stop,'DWS channel shutdown');ctx.on('night/stopping',stop)
  const privatePeers=config.operatorNotifications===true?config.operatorPeers:[]
  const normalize=(raw,fallback)=>{const value=normalizeHistoryMessage({...raw,conversationId:raw.conversationId??raw.groupId,createTime:raw.createTime??raw.occurredAt},fallback);if(value.quotedMessage){value.quotedMessage.text=value.quotedMessage.content??'';const sender=raw.quotedMessage?.senderOpenDingTalkId??raw.quotedMessage?.senderId;if(sender)value.quotedMessage.senderOpenDingTalkId=sender}return value}
  const assertTarget=(conversationId,type=config.conversationType)=>{if(closed)throw failure('DINGTALK_CHANNEL_DISABLED');if(!readyBound)throw failure('DINGTALK_CHANNEL_NOT_READY');if(conversationId!==config.binding.conversationId||type!==config.conversationType)throw failure('DINGTALK_TARGET_NOT_BOUND')}
  const requireSend=()=>{if(!readyBound||!config.enabled||closed)throw failure('DINGTALK_CHANNEL_DISABLED')}
  const typed=(notification,envelope)=>({...notification,payload:{...notification.payload,conversationId:envelope.conversationId,sourceMessageId:envelope.replyToMessageId,replyToMessageId:envelope.replyToMessageId,actorId:envelope.senderId,replyToSenderOpenDingTalkId:envelope.replyToParticipantId,atOpenDingTalkIds:envelope.recipientIds,text:envelope.text}})
  const notifications={canDisclose:()=>readyBound&&!closed&&config.enabled&&config.writesAuthorized===true,
    send:notification=>{requireSend();if(notification.payload.audience!=='operator')assertTarget(notification.payload.conversationId);return notification.payload.audience==='operator'?adapter.sendSelfIntent({userId:notification.payload.recipientUserId,text:notification.payload.text,idempotencyKey:notification.id,taskId:notification.taskId,humanRequestId:notification.payload.humanRequestId}):sendWorkflowNotification(adapter,notification)},
    readback:notification=>notification.payload.audience==='operator'?readOperatorNotificationDelivery(adapter,notification):readTaskNotificationDelivery(adapter,notification,{senderActorId:config.assistantActorId}),
    sendFile:(_notification,file)=>{requireSend();assertTarget(_notification.payload.conversationId);return createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized===true,profile:config.profile,runner:runnerFor(file.directory)}).sendGroupFile({groupId:_notification.payload.conversationId,fileName:file.fileName,idempotencyKey:_notification.id})},
    readbackFile:notification=>readTaskFileDelivery(adapter,notification),querySendStatus:id=>adapter.querySendStatus(id),recall:notification=>recallOperatorNotification(adapter,notification)}
  // Operator notifications also participate in this channel's authority gate
  // and join barrier, even though they do not carry a conversation envelope.
  for(const method of ['send','sendFile','readback','readbackFile','querySendStatus','recall']){
    const invoke=notifications[method]
    notifications[method]=(...args)=>{
      ctx.channels.assertLifecycle(channelId,{read:['readback','readbackFile','querySendStatus'].includes(method)})
      return ctx.channels.trackChannelCall(channelId,()=>invoke(...args))
    }
  }
  unregister=ctx.channels.registerTransport(channelId,{canSend:()=>readyBound&&!closed&&config.enabled&&config.writesAuthorized===true,
    capabilities:{account:accountPolicy,privateSubscription:{scope:'explicit-peers',peerCount:privatePeers.length+(config.conversationType==='chat'?1:0)},conversationTypes:[config.conversationType],files:config.conversationType==='chat-room'?['chat-room']:[],quotedReplies:[config.conversationType]},
    send:(envelope,notification)=>{requireSend();assertTarget(envelope.conversationId,envelope.type);return envelope.type==='chat'?adapter.sendDirectIntent({openDingTalkId:config.binding.peerId,text:envelope.text,idempotencyKey:notification.id,conversationId:envelope.conversationId,replyToMessageId:envelope.replyToMessageId,replyToSenderId:config.binding.peerId}):notifications.send(typed(notification,envelope))},
    readback:async(envelope,notification)=>{
      assertTarget(envelope.conversationId,envelope.type)
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
    sendFile:(envelope,notification,file)=>{assertTarget(envelope.conversationId,envelope.type);if(envelope.type==='chat')throw failure('DWS_DIRECT_FILE_UNSUPPORTED');return notifications.sendFile(typed(notification,envelope),file)},readbackFile:(envelope,notification)=>{assertTarget(envelope.conversationId,envelope.type);return notifications.readbackFile(typed(notification,envelope))},
    readMessage:async({conversationId,messageId})=>{assertTarget(conversationId);return normalize(await adapter.readMessage(conversationId,messageId),conversationId)},
    readResource:({conversationId,messageId,resource})=>{assertTarget(conversationId);return adapter.readMessageResource(conversationId,messageId,resource)},
    readMentioned:({conversationId,messageId,resource})=>{assertTarget(conversationId);return adapter.isMessageMentioned(conversationId,messageId,resource?.occurredAt)}})
  const channelInputFor=(message,retraction)=>({type:config.conversationType,channelId,
    ...config.conversationName?{conversationName:config.conversationName}:{},
    ...message.senderName&&message.senderName.trim()!==message.senderOpenDingTalkId?{senderName:message.senderName}:{},
    conversationId:message.groupId,senderId:message.senderOpenDingTalkId,messageId:message.messageId,text:retraction?'[消息已撤回]':message.text||'[attachment]',
    ...message.occurredAt?{sentAt:message.occurredAt}:{},
    ...retraction?{platformFlags:retraction}:{
      ...typeof message.mentionedAgent==='boolean'?{mentionedAgent:message.mentionedAgent}:{},...message.mentions?{mentions:message.mentions}:{},
      ...message.messageAiSendFlag?{platformFlags:{messageAiSendFlag:message.messageAiSendFlag,automated:message.messageAiSendFlag==='DWS'}}:{},
      ...message.resourceRefs?.length?{resourceRefs:message.resourceRefs}:{},
      ...message.quotedMessage?.messageId?{quotedMessage:{messageId:message.quotedMessage.messageId,text:message.quotedMessage.text??'',...message.quotedMessage.senderOpenDingTalkId?{senderId:message.quotedMessage.senderOpenDingTalkId}:{}}}:{}
    }})
  const receiveHistoryMessage=async(raw,{type=config.conversationType}={})=>{
    const message=normalize(raw,raw.groupId??raw.conversationId)
    if(type!==config.conversationType||type==='chat'&&message.senderOpenDingTalkId!==config.binding.peerId)throw failure('DWS_CHAT_NOT_AUTHORIZED')
    if(message?.groupId!==config.binding.conversationId||!message.messageId||!message.senderOpenDingTalkId)throw failure('DWS_PLUGIN_AUTHENTICATED_IDENTITY_REQUIRED')
    if(raw.retraction){
      if(typeof raw.retraction.senderId!=='string'||!raw.retraction.senderId||typeof raw.retraction.at!=='string'||!Number.isFinite(Date.parse(raw.retraction.at)))throw failure('DINGTALK_RECALL_IDENTITY_INVALID')
    }
    const retraction=raw.retraction?{retracted:true,retractedBy:ctx.channels.identity({...channelInputFor(message),senderId:raw.retraction.senderId}).principal,retractedAt:raw.retraction.at}:undefined
    let channelInput=channelInputFor(message,retraction),identity=ctx.channels.identity(channelInput)
    if(retraction)await ingressStore.recall({messageId:message.messageId,senderId:message.senderOpenDingTalkId,recallerId:raw.retraction.senderId,occurredAt:raw.retraction.at})
    return ctx.channels.withInputTarget(identity.envelope,async()=>{
      const consumed=(result,{retracted=channelInput.platformFlags?.retracted===true}={})=>ingressStore.consumed(message,{retracted}).then(()=>result)
      if(app.tasks.isOwnNotification({groupId:identity.sessionId,messageId:message.messageId}))return consumed({accepted:false,processing:'ignored',reason:'own-notification',channelType:type,conversationId:message.groupId})
      const context=ctx.channels.groupContext(identity.sessionId),prior=context?.messageFacts?.[message.messageId]
      if(prior){
        channelInput.messageVersion=prior.version??1
        identity=ctx.channels.identity(channelInput)
        const sourceId='im:'+hash(JSON.stringify([identity.sessionId,message.messageId,channelInput.messageVersion]))
        const source=await app.tasks.store?.query({kind:'source.get',sourceId})
        ctx.channels.assertInputTarget(identity.envelope)
        if(prior.retracted){
          if(source?.retracted)return consumed({accepted:false,duplicate:true,processing:'ignored',reason:'message-retracted',channelType:type,conversationId:message.groupId},{retracted:true})
          // 上下文先于业务账本提交；冷恢复只补完原墓碑，不复活旧正文。
          const sender=context.participants[prior.actorId]
          if(!sender||!prior.retraction)throw failure('DINGTALK_RETRACTION_UNSETTLED')
          channelInput={...channelInputFor({...message,senderOpenDingTalkId:sender,occurredAt:prior.occurredAt},prior.retraction),messageVersion:prior.version}
        }else if(prior.payloadHash!==dingtalkInputFingerprint(identity)){
          if(!source&&!retraction)throw failure('DINGTALK_MESSAGE_REVISION_UNSETTLED')
          const actorId=source?.actorId??prior.actorId
          if(actorId!==undefined&&actorId!==identity.principal)throw failure('CHANNEL_MESSAGE_ID_CONFLICT')
          const options={quoteSenderIds:[config.binding.actorId,...Object.values(context.participants??{})]}
          if(retainedDingtalkDuplicate(identity,prior,source,options))return consumed({accepted:false,duplicate:true,processing:'processed',reason:'retained-source',channelType:type,conversationId:message.groupId})
          if(!retraction){
            // 差异事件可能迟到；只以同账号精确回读的当前版本接纳修订。
            const latest=normalize(await adapter.readMessage(config.binding.conversationId,message.messageId),config.binding.conversationId)
            if(latest.groupId!==message.groupId||latest.messageId!==message.messageId||latest.senderOpenDingTalkId!==message.senderOpenDingTalkId)throw failure('DINGTALK_MESSAGE_REVISION_IDENTITY_INVALID')
            channelInput={...channelInputFor(latest),messageVersion:prior.version??1}
            identity=ctx.channels.identity(channelInput)
            if(retainedDingtalkDuplicate(identity,prior,source,options))return consumed({accepted:false,duplicate:true,processing:'processed',reason:'retained-source',channelType:type,conversationId:message.groupId})
          }
          if(prior.payloadHash!==dingtalkInputFingerprint(ctx.channels.identity(channelInput)))channelInput.messageVersion=(prior.version??1)+1
        }
      }
      try{return await consumed(await ctx.channels.receive(channelInput))}
      catch(error){if(error.code==='CHANNEL_NOTIFICATION_IDENTITY_PENDING')await ingressStore.deferred(message);throw error}
    })
  }
  const enqueueIngress=async(raw,options)=>{
    const operation=ingressTail.then(()=>receiveHistoryMessage(raw,options))
    ingressTail=operation.catch(()=>{})
    ingressCalls.add(operation)
    try{return await operation}finally{ingressCalls.delete(operation)}
  }
  const acceptHistoryMessage=(raw,options)=>{
    if(closed||!app||!readyBound||!config.enabled)return Promise.reject(failure('CHANNEL_PLUGIN_NOT_READY'))
    if(config.receivePaused||health.ingress?.paused)return Promise.reject(failure('CHANNEL_INGRESS_PAUSED'))
    return enqueueIngress(raw,options)
  }
  const recoverRecalls=async()=>{
    for(const row of ingressStore.snapshot().pendingRecalls??[])await enqueueIngress({groupId:config.binding.conversationId,messageId:row.messageId,senderOpenDingTalkId:row.senderId,text:'[消息已撤回]',occurredAt:row.occurredAt,retraction:{senderId:row.recallerId,at:row.occurredAt}})
  }
  const serialize=work=>{const operation=settingsTail.then(work);settingsTail=operation.catch(()=>{});return operation}
  const persistPaused=async()=>{
    const state=ingressStore.snapshot()
    try{await ingressStore.saveBridgeState({...state,paused:true,pausedAt:state.pausedAt??new Date().toISOString()})}
    catch(error){cursorError=true;health={...health,healthy:false,state:'error',lastError:'DINGTALK_CURSOR_PERSIST_FAILED'};throw error}
  }
  const changeIngress=async(paused,{enabled=config.enabled}={})=>{
    const previous=config.receivePaused,wasEnabled=config.enabled
    // A resumed listener may call back immediately. Its persisted bridge gate
    // remains closed until the resume write has succeeded.
    if(!paused)config.receivePaused=false
    if(enabled)config.enabled=true
    try{
      if(stopBridge)await stopBridge.setIngressPaused(!enabled||paused)
      else if(ingressStore&&(paused||!enabled))await persistPaused()
      config.receivePaused=paused
      if(paused)await Promise.allSettled([...ingressCalls])
    }catch(error){config.receivePaused=previous;config.enabled=wasEnabled;throw error}
  }
  const ingressControl={version:1,backfill:'history',
    get available(){return !closed&&config.listen!==false},
    getStatus(){
      if(closed||config.listen===false)return {state:'unavailable',errorCode:closed?'CHANNEL_PLUGIN_NOT_READY':'CHANNEL_INGRESS_LISTEN_DISABLED'}
      if(cursorError||health.state==='error')return {state:'error',errorCode:cursorError?'DINGTALK_CURSOR_PERSIST_FAILED':health.lastError??'DINGTALK_START_FAILED'}
      if(config.receivePaused&&ingressStore?.snapshot().paused)return {state:'paused',errorCode:null}
      if(!config.enabled||!readyBound||!stopBridge)return {state:'unavailable',errorCode:!config.enabled?'DINGTALK_CHANNEL_DISABLED':health.lastError??'DINGTALK_CHANNEL_NOT_READY'}
      if(health.ingress?.paused)return {state:'paused',errorCode:null}
      const groups=health.groups??[]
      if(groups.some(group=>group.backfill?.state==='failed'))return {state:'error',errorCode:'DINGTALK_HISTORY_RECOVERY_FAILED'}
      if(health.ingress?.recovering||!groups.length||groups.some(group=>group.listener?.state!=='ready'||group.backfill?.state!=='ok'||group.backfill?.inProgress||group.backfill?.recoveryRequired))return {state:'recovering',errorCode:null}
      return {state:'receiving',errorCode:null}
    },
    setPaused:paused=>serialize(async()=>{
      if(typeof paused!=='boolean')throw failure('DINGTALK_SETTINGS_INVALID')
      if(!ingressControl.available)throw failure('CHANNEL_INGRESS_CONTROL_UNAVAILABLE')
      await preparing
      if(closed||!app||!ingressStore)throw failure('CHANNEL_PLUGIN_NOT_READY')
      if(!paused&&readyBound&&config.enabled)await verifyDingtalkBinding(config,{runner})
      await changeIngress(paused)
      return ingressControl.getStatus()
    }),
  }
  const plugin={channelId,get bindingIdentity(){return config.binding?{...config.binding}:undefined},get bindingActive(){return readyBound&&!closed},get name(){return config.name??channelId},get prompt(){return config.prompt},get enabled(){return config.enabled},
    ingressControl,
    setEnabled:enabled=>serialize(async()=>{
      if(typeof enabled!=='boolean')throw failure('DINGTALK_ENABLED_INVALID')
      if(closed||!app)throw failure('CHANNEL_PLUGIN_NOT_READY')
      if(enabled)await verifyDingtalkBinding(config,{runner})
      await changeIngress(config.receivePaused,{enabled})
      config.enabled=enabled
      return {enabled:config.enabled,health:plugin.health}
    }),
    updateLive:settings=>serialize(async()=>{
      if(closed||!app)throw failure('CHANNEL_PLUGIN_NOT_READY')
      if(typeof settings.enabled!=='boolean'||typeof settings.writesAuthorized!=='boolean'||settings.receivePaused!==undefined&&typeof settings.receivePaused!=='boolean')throw failure('DINGTALK_SETTINGS_INVALID')
      if(settings.enabled&&!config.enabled)await verifyDingtalkBinding(config,{runner})
      const receivePaused=settings.receivePaused??config.receivePaused
      if(settings.enabled!==config.enabled||receivePaused!==config.receivePaused)await changeIngress(receivePaused,{enabled:settings.enabled})
      Object.assign(config,{name:settings.name,prompt:settings.prompt,enabled:settings.enabled,writesAuthorized:settings.writesAuthorized})
      if(readyBound)adapter=createDwsAdapter({enabled:true,writesAuthorized:config.writesAuthorized,profile:config.profile,runner})
      return {enabled:config.enabled,health:plugin.health}
    }),
    updateSettings:settings=>serialize(async()=>{
      if(!settings||Object.keys(settings).some(key=>!['name','prompt'].includes(key))||settings.name!==undefined&&(typeof settings.name!=='string'||!settings.name.trim())||settings.prompt!==undefined&&typeof settings.prompt!=='string')throw failure('DINGTALK_SETTINGS_INVALID')
      if(settings.name!==undefined)config.name=settings.name
      if(settings.prompt!==undefined)config.prompt=settings.prompt
      return {enabled:config.enabled,name:config.name??channelId,promptConfigured:!!config.prompt}
    }),accountPolicy,get adapter(){return adapter},notifications,acceptHistoryMessage,conversationDisplayName:context=>readyBound&&!closed&&context.type===config.conversationType&&context.channelId===channelId&&context.conversationId===config.binding.conversationId?config.conversationName:undefined,responsibility:context=>readyBound&&context.type===config.conversationType&&context.channelId===channelId&&context.conversationId===config.binding.conversationId?config.prompt:undefined,commands:nativeDwsCommands,observation:nativeDwsObservation,createObserver:options=>createNativeDwsObserver({...options,resolveNotificationScope:notification=>{
    const context=ctx.channels.groupContext(notification.payload?.conversationId)
    if(context?.channelId!==channelId||context.type!=='chat-room')return
    return {conversationId:context.conversationId,querySendStatus:id=>adapter.querySendStatus(id)}
  }}),get health(){const {groups,...value}=health;return {...value,...groups?{conversations:groups.map(({groupId,...entry})=>({conversationId:groupId,...entry}))}:{}}},get accountDirectory(){return accountPolicy.mode==='private'?privateHome:undefined}}
  unregisterPlugin=ctx.channels.registerPlugin(channelId,plugin)
  stopObserver=ctx.channels.registerOperationObserver(channelId,plugin);stopOperator=config.operatorNotifications===true?ctx.channels.registerOperatorNotifications(channelId,notifications):undefined
  plugin.stopAndDrain=stop
  const startBridge=async()=>{
    if(closed)return
    await recoverRecalls()
    const contextId=ctx.channels.identity({type:config.conversationType,channelId,conversationId:config.binding.conversationId,senderId:config.binding.peerId??'namespace-only',messageId:'namespace-only',text:'namespace-only'}).sessionId
    const retained=ctx.channels.groupContext(contextId)
    for(const [messageId,fact]of Object.entries(retained?.messageFacts??{}))if(fact.retracted){
      await receiveHistoryMessage({groupId:config.binding.conversationId,messageId,senderOpenDingTalkId:retained.participants[fact.actorId],text:'[消息已撤回]',occurredAt:fact.occurredAt})
    }
    if(config.listen===false){health={healthy:false,configured:true,state:'ready',listening:false};return}
    if(config.receivePaused||!config.enabled)await persistPaused()
    const groups=[config.binding.conversationId],keyOf=groupId=>ctx.channels.identity({type:config.conversationType,channelId,conversationId:groupId,senderId:config.conversationType==='chat'?config.binding.peerId:'namespace-only',messageId:'namespace-only',text:'namespace-only'}).sessionId
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
    const {paused,pausedAt,recoveryFromAt}=ingressStore.snapshot(),ingressState={paused,pausedAt,recoveryFromAt}
    const ingressFrom=()=>{
      const state=ingressStore.snapshot()
      return [state.firstStartedAt,state.recoveryFromAt,health.groups?.[0]?.backfill?.recoveryFromAt].filter(value=>value!==undefined).sort((left,right)=>Date.parse(left)-Date.parse(right))[0]
    }
    stopBridge=startDwsBridge({privatePeerIds:privatePeers,operatorRepliesEnabled:config.operatorNotifications===true,runtime:facade,adapter:dingtalkIngressAdapter(adapter,config,{runner,getFromAt:ingressFrom,getDeferredMessages:()=>ingressStore.snapshot().deferredMessages??[],onRangeRead:range=>{lastRange=range},onRecall:acceptHistoryMessage,beforeRangeRead:recoverRecalls}),logger:{info:()=>{},warn:()=>ctx.logger.warn('DWS_CHANNEL_IO_FAILED'),error:()=>ctx.logger.warn('DWS_CHANNEL_IO_FAILED')},humanUserId:config.humanUserId,currentDwsUserName:config.currentUserName,ingressState,saveIngressState:state=>ingressStore.saveBridgeState(state).catch(error=>{cursorError=true;health={...health,healthy:false,state:'error',lastError:'DINGTALK_CURSOR_PERSIST_FAILED'};throw error}),onHealthChange:value=>{health={...value,configured:true,state:closed?'stopped':cursorError?'error':value.ingress?.paused?'paused':value.ingress?.recovering?'recovering':'listening',...cursorError?{healthy:false,lastError:'DINGTALK_CURSOR_PERSIST_FAILED'}:{}};if(lastRange&&value.groups?.[0]?.backfill?.state==='ok'&&!value.groups[0].backfill.inProgress){const range=lastRange;ingressStore.completedRange(range).catch(()=>{cursorError=true;health={...health,healthy:false,state:'error',lastError:'DINGTALK_CURSOR_PERSIST_FAILED'}})}}})
    // Shutdown also writes a paused checkpoint. Only the Host-selected user
    // preference keeps a new process paused; ordinary restarts resume recovery.
    // Explicit operator-approval subscriptions remain a separate control path.
    if(ingressState.paused&&!config.receivePaused&&config.enabled)await stopBridge.setIngressPaused(false)
  }
  const attemptStart=()=>{
    const operation=startTail.then(async()=>{
      if(closed||readyBound||terminal)return
      try{
        const prepare=async()=>{
          if(config.storageKey!==undefined)await assertDingtalkTargetSwitch(paths,channelId,config.binding)
          await bind()
          if(closed)throw failure('DINGTALK_CHANNEL_DISABLED')
          ingressStore??=await openDingtalkIngress(paths,channelId,{storageKey:config.storageKey,fromAt:app.config.resident.taskSessions.ingressEpoch})
        }
        if(config.storageKey!==undefined&&!targetValidated){
          const binding=config.binding
          await assertDingtalkStoragePath(paths,bindingFile)
          const includeAllScopes=await readSavedBinding()===undefined
          await app.tasks.withChannelTargetSwitch({channelId,includeAllScopes,nextTarget:{type:binding.conversationType,conversationId:binding.conversationId,peerId:binding.peerId}},prepare,{activate:true,publish:()=>{readyBound=true}})
        }else{await prepare();readyBound=true}
        await serialize(startBridge)
        ctx.logger.info?.('DINGTALK_CHANNEL_BOUND '+JSON.stringify({channelId,conversationType:config.conversationType}))
      }catch(error){
        readyBound=false
        if(error.code==='DINGTALK_AUTH_REQUIRED'){health={healthy:false,configured:true,state:'waiting-auth',lastError:'DINGTALK_AUTH_REQUIRED'};ctx.logger.info?.('DINGTALK_CHANNEL_WAITING_AUTH '+JSON.stringify({channelId}))}
        else{terminal=true;health={healthy:false,configured:true,state:'error',lastError:typeof error.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'DINGTALK_START_FAILED'};ctx.logger.warn(health.lastError)}
      }
    })
    startTail=operation.catch(()=>{})
    return operation
  }
  plugin.start=async(application,options={})=>{
    targetValidated=options.targetValidated===true
    if(closed)return
    app=application
    // Repeated ready events must retain the same observer and its shutdown handle.
    preparing??=(async()=>{
      try{
        ingressStore=await openDingtalkIngress(paths,channelId,{storageKey:config.storageKey,fromAt:app.config.resident.taskSessions.ingressEpoch})
        if(config.receivePaused)await persistPaused()
        if(closed)return
        stopAuthObserver=await (dependencies.observeLogin??observeDwsLogin)(environment,{onLogin:attemptStart,onError:error=>{if(!readyBound){terminal=true;health={healthy:false,configured:true,state:'error',lastError:error.code}}else ctx.logger.warn(error.code)}})
      }catch(error){terminal=true;health={healthy:false,configured:true,state:'error',lastError:typeof error.code==='string'?error.code:'DINGTALK_AUTH_OBSERVATION_FAILED'}}
    })()
    await preparing
    await attemptStart()
  }
  ctx.on('night/ready',application=>plugin.start(application))
}
