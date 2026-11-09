import {Service} from '@deepseek-ai/cordis'
import {z} from 'zod'
import {join} from 'node:path'
import {hash} from '../memory/format.js'
import {notificationAudience} from '../../packages/dingtalk-core/group-notification.js'
import {isDeepStrictEqual} from 'node:util'
import {failure,privateDirectory,readRegular,atomicWrite,withLock} from '../runtime/files.js'
const envelopeSchema=z.object({type:z.enum(['chat','chat-room']),channelId:z.string().min(1).max(128),conversationId:z.string().min(1).max(256),senderId:z.string().min(1).max(256),senderName:z.string().trim().min(1).max(256).optional(),conversationName:z.string().trim().min(1).max(256).optional(),messageId:z.string().min(1).max(256),messageVersion:z.number().int().positive().optional(),text:z.string().min(1).max(32000),sentAt:z.string().optional(),mentionedAgent:z.boolean().optional(),mentions:z.array(z.string().min(1).max(256)).max(256).optional(),platformFlags:z.record(z.string(),z.union([z.string(),z.boolean(),z.number()])).optional(),resourceRefs:z.array(z.record(z.string(),z.unknown())).max(32).optional(),quotedMessage:z.object({messageId:z.string(),senderId:z.string().optional(),text:z.string().optional()}).strict().optional()}).strict()
/** 仅解析可信插件配置；职责不来自入站消息。 */
export function channelGroupResponsibilities(groups=[],responsibility){
  if(!Array.isArray(groups)||responsibility!==undefined&&typeof responsibility!=='string')throw failure('CHANNEL_GROUP_CONFIGURATION_INVALID')
  const responsibilities=new Map()
  for(const group of groups){
    const object=group!==null&&typeof group==='object'&&!Array.isArray(group),groupId=typeof group==='string'?group:object?group.groupId:undefined
    if(typeof groupId!=='string'||!groupId.trim()||responsibilities.has(groupId)||object&&group.responsibility!==undefined&&typeof group.responsibility!=='string')throw failure('CHANNEL_GROUP_CONFIGURATION_INVALID')
    responsibilities.set(groupId,object&&group.responsibility!==undefined?group.responsibility:responsibility)
  }
  return responsibilities
}
/** Trusted adapter ingress, not an unauthenticated network endpoint. */
export default class Channels extends Service {
  static inject=['agents','sessionPersistence','agentPresets','agentDefaultModel','memory','runtimePaths']
  constructor(ctx){super(ctx,'channels');this.host=ctx;this.tails=new Map();this.handles=new Map();this.closed=false;this.contexts=new Map();this.targetHolds=new Map();this.activeTargets=new Map();this.targetInputs=new Set();this.transports=new Map();this.plugins=new Map();this.observers=new Map();this.ready=this.loadContexts();ctx.effect(()=>async()=>{this.closed=true;const pending=await Promise.allSettled([...this.tails.values()]);const disposed=await Promise.allSettled([...this.handles.values()].map(handle=>handle.dispose()));const errors=[...pending,...disposed].filter(result=>result.status==='rejected').map(result=>result.reason);if(errors.length)throw new AggregateError(errors,'Channel drain failed')},'channel drain')}
  async [Service.init](){await this.ready}
  async loadContexts(){for(const [key,value]of Object.entries(JSON.parse(await readRegular(join(this.host.runtimePaths.state,'channels','contexts.json'))??'{}')))this.contexts.set(key,value)}
  groupContext(id){const context=this.contexts.get(id);if(!context)return;const plugin=this.plugins.get(context.channelId),responsibility=plugin?.responsibility?.(context),conversationName=plugin?.conversationDisplayName?.(context);return {...context,...conversationName?{conversationName}:{},...responsibility!==undefined?{responsibility}:{}}}
  responsibility(id){return this.groupContext(id)?.responsibility}
  targetMatches(context,target){return context.type===target.type&&context.conversationId===target.conversationId&&(target.type!=='chat'||Object.values(context.participants??{}).includes(target.peerId)||context.senderId===target.peerId)}
  assertInputTarget(input){
    const hold=this.targetHolds.get(input.channelId),active=this.activeTargets.get(input.channelId)
    if(hold&&(hold.includeAllScopes||!this.targetMatches(input,hold.target))||active&&!this.targetMatches(input,active))throw failure('DINGTALK_CHANNEL_SWITCH_BLOCKED')
  }
  assertGroupTarget(groupId){const context=this.contexts.get(groupId);if(context)this.assertInputTarget(context)}
  withInputTarget(input,work){
    this.assertInputTarget(input)
    const flight={...input};this.targetInputs.add(flight)
    return Promise.resolve().then(()=>{this.assertInputTarget(input);return work()}).finally(()=>this.targetInputs.delete(flight))
  }
  holdChannelTarget(channelId,target,{includeAllScopes=false}={}){
    if(this.targetHolds.has(channelId))throw failure('DINGTALK_CHANNEL_SWITCH_BLOCKED')
    const hold={target,includeAllScopes};this.targetHolds.set(channelId,hold)
    const groups=[...this.contexts].filter(([,context])=>context.channelId===channelId&&(includeAllScopes||!this.targetMatches(context,target))).map(([id])=>id)
    return {groups,hasInflight:()=>[...this.targetInputs].some(input=>input.channelId===channelId&&(includeAllScopes||!this.targetMatches(input,target))),
      activate:()=>{if(this.targetHolds.get(channelId)!==hold)throw failure('DINGTALK_CHANNEL_SWITCH_BLOCKED');this.activeTargets.set(channelId,target)},
      release:()=>{if(this.targetHolds.get(channelId)===hold)this.targetHolds.delete(channelId)}}
  }
  registerConversation(input){const identity=this.identity(input);return this.withInputTarget(identity.envelope,async()=>{await this.ready;this.assertInputTarget(input);const e=identity.envelope,path=join(this.host.runtimePaths.state,'channels','contexts.json');await withLock(path+'.lock',async()=>{this.assertInputTarget(input);const saved=JSON.parse(await readRegular(path)??'{}'),prior=saved[identity.sessionId],payloadHash=hash(JSON.stringify([identity.principal,e.text,e.resourceRefs??[],e.quotedMessage??null,e.mentionedAgent??null,e.mentions??[],e.platformFlags??{}])),priorMessage=prior?.messageFacts?.[e.messageId];const version=e.messageVersion??1;if(priorMessage&&(priorMessage.version??1)>version)throw failure('CHANNEL_MESSAGE_VERSION_STALE');if(priorMessage&&(priorMessage.version??1)===version&&priorMessage.payloadHash!==payloadHash)throw failure('CHANNEL_MESSAGE_ID_CONFLICT');const fact=priorMessage&&(priorMessage.version??1)===version?priorMessage:{payloadHash,version,occurredAt:e.sentAt??new Date().toISOString(),...e.senderName?{senderName:e.senderName}:{}};saved[identity.sessionId]={type:e.type,channelId:e.channelId,conversationId:e.conversationId,...(e.conversationName??prior?.conversationName)?{conversationName:e.conversationName??prior.conversationName}:{},participantNames:{...prior?.participantNames,...e.senderName?{[identity.principal]:e.senderName}:{}},updatedAt:fact.occurredAt>=(prior?.updatedAt??'')?fact.occurredAt:prior.updatedAt,memoryBinding:identity.binding,...identity.binding.groupId?{memoryGroupId:identity.binding.groupId}:{},messageFacts:{...prior?.messageFacts,[e.messageId]:fact},participants:{...prior?.participants,[identity.principal]:e.senderId}};await atomicWrite(path,JSON.stringify(saved,null,2)+'\n');this.contexts.set(identity.sessionId,saved[identity.sessionId])});return identity})}
  attachIngress(handler){this.ingress=handler;return ()=>{if(this.ingress===handler)this.ingress=undefined}}
  registerOperationObserver(id,factory){if(this.observers.has(id))throw failure('CHANNEL_OBSERVER_EXISTS');this.observers.set(id,factory);return ()=>this.observers.delete(id)}
  operationCommands(name,args){return [...this.observers.values()].flatMap(factory=>factory.commands?.(name,args)??[])}
  operationObservation(event,commands){return Object.assign({},...[...this.observers.values()].map(factory=>factory.observation?.(event,commands)??{}))}
  createOperationObserver(options){const observers=[...this.observers.values()].map(factory=>factory.createObserver(options));const invoke=(method,...args)=>Promise.all(observers.map(observer=>observer[method]?.(...args)));return {recover:()=>invoke('recover'),beforeIngress:id=>invoke('beforeIngress',id),notificationChanged:n=>{for(const observer of observers)observer.notificationChanged?.(n)},start:(...args)=>{for(const observer of observers)observer.start?.(...args)},observe:(...args)=>invoke('observe',...args),finish:(...args)=>{for(const observer of observers)observer.finish?.(...args)},close:()=>{for(const observer of observers)observer.close?.()}}}
  registerOperatorNotifications(id,notifications){if(this.operatorNotifications)throw failure('CHANNEL_OPERATOR_TRANSPORT_EXISTS');this.operatorNotifications=notifications;return ()=>{if(this.operatorNotifications===notifications)this.operatorNotifications=undefined}}
  registerPlugin(channelId,plugin){if(this.plugins.has(channelId))throw failure('CHANNEL_PLUGIN_EXISTS');this.plugins.set(channelId,plugin);return ()=>this.plugins.delete(channelId)}
  registerTransport(channelId,transport){if(!transport||typeof transport.send!=='function'||typeof transport.readback!=='function'||this.transports.has(channelId))throw failure('CHANNEL_TRANSPORT_INVALID');this.transports.set(channelId,transport);return ()=>this.transports.delete(channelId)}
  deliveryEnvelope(notification){
    const payload=notification.payload??notification,context=this.groupContext(payload.conversationId)
    if(!context)return undefined
    const audience=notificationAudience(payload),recipientActorIds=audience.recipientActorIds??[]
    const unknownRecipient=recipientActorIds.find(id=>context.participants[id]===undefined)
    if(unknownRecipient!==undefined)throw failure('CHANNEL_RECIPIENT_NOT_IN_CONVERSATION')
    const replyToParticipantId=audience.replyToActorId===undefined?undefined:context.participants[audience.replyToActorId]
    if(audience.replyToActorId!==undefined&&replyToParticipantId===undefined)throw failure('CHANNEL_REPLY_ACTOR_NOT_IN_CONVERSATION')
    const senderId=payload.actorId===undefined?undefined:context.participants[payload.actorId]
    if(payload.actorId!==undefined&&senderId===undefined)throw failure('CHANNEL_ACTOR_NOT_IN_CONVERSATION')
    return {type:context.type,channelId:context.channelId,conversationId:context.conversationId,deliveryKey:notification.id,text:payload.text,replyToMessageId:audience.replyToMessageId??payload.sourceMessageId,senderId,recipientIds:context.type==='chat'?[]:recipientActorIds.map(id=>context.participants[id]),...replyToParticipantId!==undefined?{replyToParticipantId}:{},...(audience.atAll?{atAll:true}:{})}
  }
  async readResource(method,groupId,messageId,resource){
    const context=this.groupContext(groupId),transport=context&&this.transports.get(context.channelId)
    if(!transport||typeof transport[method]!=='function')throw failure('CHANNEL_RESOURCE_READER_UNAVAILABLE')
    if(method==='readMentioned'&&typeof messageId==='object'){resource={occurredAt:messageId.occurredAt};messageId=messageId.messageId}
    const value=await transport[method]({type:context.type,channelId:context.channelId,conversationId:context.conversationId,messageId,resource})
    if(method!=='readMessage')return value
    const remoteConversation=value?.conversationId??value?.groupId
    if(value?.messageId!==messageId||remoteConversation&&remoteConversation!==context.conversationId)throw failure('CHANNEL_RESOURCE_SCOPE_MISMATCH')
    const principal=sender=>'channel-actor-'+hash(JSON.stringify([context.channelId,sender]))
    const senderActor=value.actorId??((value.senderId??value.senderOpenDingTalkId)===undefined?undefined:principal(value.senderId??value.senderOpenDingTalkId)),quote=value.quotedMessage
    const quoteActor=quote?.actorId??((quote?.senderId??quote?.senderOpenDingTalkId)===undefined?undefined:principal(quote.senderId??quote.senderOpenDingTalkId))
    const {senderId:_senderId,senderOpenDingTalkId:_senderOpenDingTalkId,actorId:_actorId,conversationId:_conversationId,groupId:_groupId,quotedMessage:_quotedMessage,...rest}=value
    const quoteView=quote?(({senderId:_quoteSenderId,senderOpenDingTalkId:_quoteSenderOpenDingTalkId,actorId:_quoteActorId,content,text,groupId:_quoteGroupId,conversationId:_quoteConversationId,...quoteRest})=>({...quoteRest,text:text??content??'',conversationId:groupId,...quoteActor!==undefined?{actorId:quoteActor}: {}}))(quote):undefined
    return {...rest,conversationId:groupId,...senderActor!==undefined?{actorId:senderActor}:{},...quoteView?{quotedMessage:quoteView}: {}}
  }

  canDeliver(notification){const context=this.groupContext(notification.payload?.conversationId);if(!context)return true;const transport=this.transports.get(context.channelId);return !!transport&&(!transport.capabilities?.conversationTypes||transport.capabilities.conversationTypes.includes(context.type))&&(!notification.payload?.artifact||typeof transport.sendFile==='function'&&(!transport.capabilities?.files||transport.capabilities.files.includes(context.type)))&&(['unknown','starting'].includes(notification.state)||!transport.canSend||transport.canSend(notification))}
  async transportCall(method,notification,...args){const envelope=this.deliveryEnvelope(notification),transport=envelope&&this.transports.get(envelope.channelId);if(!transport)throw failure('CHANNEL_TRANSPORT_UNAVAILABLE');if(typeof transport[method]!=='function')throw failure('CHANNEL_CAPABILITY_UNAVAILABLE');return transport[method](envelope,notification,...args)}
  identity(input){const e=envelopeSchema.parse(input),principal='channel-actor-'+hash(JSON.stringify([e.channelId,e.senderId])),conversation=hash(JSON.stringify([e.type,e.channelId,e.conversationId,...e.type==='chat'?[e.senderId]:[]]));return {envelope:e,sessionId:'conversation-'+conversation,workspace:join(this.host.runtimePaths.workspaces,'conversations',conversation),binding:{actorId:e.type==='chat'?principal:'channel-room-actor-'+hash(JSON.stringify([e.channelId,e.conversationId])),...e.type==='chat-room'?{groupId:'channel-room-'+hash(JSON.stringify([e.channelId,e.conversationId])),groupWrite:true}:{}},principal}}
  receive(input){
    if(this.closed)throw failure('CHANNELS_CLOSED')
    this.assertInputTarget(input)
    if(this.ingress)return this.ingress(input)
    const identity=this.identity(input),previous=this.tails.get(identity.sessionId)??Promise.resolve(),work=previous.catch(()=>{}).then(async()=>{await this.registerConversation(identity.envelope);return this.deliver(identity)});this.tails.set(identity.sessionId,work);work.finally(()=>{if(this.tails.get(identity.sessionId)===work)this.tails.delete(identity.sessionId)}).catch(()=>{});return work
  }
  async deliver({envelope,sessionId,workspace,binding,principal}){
    await privateDirectory(join(this.host.runtimePaths.workspaces,'conversations'));await privateDirectory(workspace);await this.host.memory.bindSession(sessionId,binding)
    const senderName=this.contexts.get(sessionId)?.messageFacts?.[envelope.messageId]?.senderName
    const source={...senderName?{senderName}:{},kind:'user',channelType:envelope.type,channelId:envelope.channelId,conversationId:envelope.conversationId,senderId:envelope.senderId,channelMessageId:envelope.messageId,messageVersion:envelope.messageVersion??1,principal,...Object.fromEntries(['mentionedAgent','mentions','platformFlags','quotedMessage','resourceRefs'].filter(key=>envelope[key]!==undefined).map(key=>[key,envelope[key]]))}
    const messageKey=hash(JSON.stringify([envelope.channelId,envelope.conversationId,envelope.messageId,envelope.messageVersion??1]))
    source.channelMessageKey=messageKey
    const packet={id:'channel:'+messageKey,source,content:[{type:'text',text:envelope.text}]}
    let handle=this.handles.get(sessionId)
    if(!handle){
      const authorizeInput=async(candidate,actor)=>{
        try{
          const src=candidate.source,entry={type:src.channelType,channelId:src.channelId,conversationId:src.conversationId,senderId:src.senderId,messageId:src.channelMessageId,messageVersion:src.messageVersion??1,text:candidate.content?.[0]?.text,...Object.fromEntries(['mentionedAgent','mentions','platformFlags','quotedMessage','resourceRefs'].filter(key=>src[key]!==undefined).map(key=>[key,src[key]]))}
          const identity=this.identity(entry),saved=this.contexts.get(identity.sessionId),fact=saved?.messageFacts?.[entry.messageId]
          const payloadHash=hash(JSON.stringify([identity.principal,entry.text,entry.resourceRefs??[],entry.quotedMessage??null,entry.mentionedAgent??null,entry.mentions??[],entry.platformFlags??{}]))
          return actor.id===sessionId&&identity.sessionId===sessionId&&!!fact&&(fact.version??1)===(entry.messageVersion??1)&&fact.payloadHash===payloadHash&&src.kind==='user'&&src.senderName===fact.senderName&&src.principal===identity.principal&&candidate.id==='channel:'+hash(JSON.stringify([entry.channelId,entry.conversationId,entry.messageId,entry.messageVersion??1]))&&isDeepStrictEqual(candidate.content,[{type:'text',text:entry.text}])
        }catch{return false}
      }
      const existing=await this.host.sessionPersistence.stat(sessionId)
      const auditKinds={'channel/delivery':value=>value!==null&&typeof value==='object'&&Object.keys(value).length===2&&typeof value.messageKey==='string'&&/^[a-f0-9]{64}$/.test(value.messageKey)&&typeof value.ok==='boolean'}
      const options={agentOptions:this.host.agentDefaultModel.currentSelection(),authorizeInput,auditKinds,
        // Only authenticated direct chat installs the explicit user-command
        // capability. Room/task/schedule intake retains its business routing.
        ...envelope.type==='chat'?{authorizeSkillCommand:async(candidate,name,actor)=>{
          if(!await authorizeInput(candidate,actor))return false
          const skills=actor.ctx.get('skills');if(!skills)return false
          const skill=await this.host.agents.withInitiator(actor,()=>skills.get(name,{scope:actor,cwd:actor.ctx.get('workingDirectory')?.get(actor)??actor.metadata.cwd,signal:actor.lifecycle.signal}))
          return skill?.invocation?.userInvocable===true
        }}:{},setup:async ctx=>{
          await this.host.agentPresets.mount(ctx,'night-bot')
          ctx.get('systemPrompt').section({name:'channel-conversation-responsibility',order:151,interpolate:false,officialText:()=>{const responsibility=this.responsibility(sessionId);return responsibility===undefined?'':'当前会话配置职责：'+responsibility+'。仅适用于当前认证会话，不创造发送许可、任务授权或跨会话访问权限。'}})
        }}
      handle=existing?await this.host.agents.resume({...options,resumeSessionId:sessionId}):await this.host.agents.create({...options,sessionId,meta:{cwd:workspace,agentPreset:'night-bot'}})
      this.handles.set(sessionId,handle)
    }
    const actor=handle.agent,prior=actor.admission.lookupPacket(packet.id)
    if(prior){
      if(!isDeepStrictEqual(prior,packet))throw failure('CHANNEL_MESSAGE_ID_CONFLICT')
      const receipt=(await actor.receipts.read()).find(r=>r.domain==='channel'&&r.kind==='delivery'&&r.payload.messageKey===messageKey)
      return {ok:receipt?.payload.ok===true,duplicate:true,sessionId,...!receipt?{code:'CHANNEL_DELIVERY_UNCERTAIN'}:{}}
    }
    await actor.input.enqueue(packet)
    await actor.input.deliver(packet.id)
    await actor.whenIdle()
    const last=actor.piSession.messages.findLast(message=>message.role==='assistant'),ok=last?.stopReason==='stop'
    actor.receipts.append({domain:'channel',kind:'delivery',version:1,payload:{messageKey,ok}})
    await actor.receipts.commit()
    return {ok,...!ok?{code:'CHANNEL_TURN_INCOMPLETE'}:{},sessionId,channelType:envelope.type,conversationId:envelope.conversationId,senderId:envelope.senderId,taskSource:{actorId:principal,...envelope.type==='chat-room'?{groupId:binding.groupId}:{},channelType:envelope.type,channelId:envelope.channelId,conversationId:envelope.conversationId}}
  }
}
