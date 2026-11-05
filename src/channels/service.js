import {Service} from '@deepseek-ai/cordis'
import {z} from 'zod'
import {join} from 'node:path'
import {hash} from '../memory/format.js'
import {appendPluginRecord} from '../native-session-protocol.js'
import {createUserMessage} from '../native-message-protocol.js'
import {failure,privateDirectory,readRegular,atomicWrite,withLock} from '../runtime/files.js'
const envelopeSchema=z.object({type:z.enum(['chat','chat-room']),channelId:z.string().min(1).max(128),conversationId:z.string().min(1).max(256),senderId:z.string().min(1).max(256),messageId:z.string().min(1).max(256),text:z.string().min(1).max(32000),sentAt:z.string().optional(),resourceRefs:z.array(z.record(z.string(),z.unknown())).max(32).optional(),quotedMessage:z.object({messageId:z.string(),senderId:z.string().optional(),text:z.string().optional()}).strict().optional()}).strict()
/** Trusted adapter ingress, not an unauthenticated network endpoint. */
export default class Channels extends Service {
  static inject=['agents','sessions','sessionPersistence','agentPresets','agentDefaultModel','memory','runtimePaths']
  constructor(ctx){super(ctx,'channels');this.host=ctx;this.tails=new Map();this.handles=new Map();this.closed=false;this.contexts=new Map();this.transports=new Map();this.observers=new Map();this.ready=this.loadContexts();ctx.effect(()=>async()=>{this.closed=true;await Promise.allSettled([...this.tails.values()]);await Promise.allSettled([...this.handles.values()].map(handle=>handle.dispose()))},'channel drain')}
  async [Service.init](){await this.ready}
  async loadContexts(){for(const [key,value]of Object.entries(JSON.parse(await readRegular(join(this.host.runtimePaths.state,'channels','contexts.json'))??'{}')))this.contexts.set(key,value)}
  groupContext(id){return this.contexts.get(id)}
  async registerConversation(input){await this.ready;const identity=this.identity(input),e=identity.envelope,path=join(this.host.runtimePaths.state,'channels','contexts.json');await withLock(path+'.lock',async()=>{const saved=JSON.parse(await readRegular(path)??'{}'),prior=saved[identity.sessionId],payloadHash=hash(JSON.stringify([identity.principal,e.text,e.resourceRefs??[],e.quotedMessage??null])),priorMessage=prior?.messageFacts?.[e.messageId];if(priorMessage&&priorMessage.payloadHash!==payloadHash)throw failure('CHANNEL_MESSAGE_ID_CONFLICT');const fact=priorMessage??{payloadHash,occurredAt:e.sentAt??new Date().toISOString()};saved[identity.sessionId]={type:e.type,channelId:e.channelId,conversationId:e.conversationId,...identity.binding.groupId?{memoryGroupId:identity.binding.groupId}:{},messageFacts:{...prior?.messageFacts,[e.messageId]:fact},participants:{...prior?.participants,[identity.principal]:e.senderId}};await atomicWrite(path,JSON.stringify(saved,null,2)+'\n');this.contexts.set(identity.sessionId,saved[identity.sessionId])});return identity}
  attachIngress(handler){this.ingress=handler;return ()=>{if(this.ingress===handler)this.ingress=undefined}}
  registerOperationObserver(id,factory){if(this.observers.has(id))throw failure('CHANNEL_OBSERVER_EXISTS');this.observers.set(id,factory);return ()=>this.observers.delete(id)}
  operationCommands(name,args){return [...this.observers.values()].flatMap(factory=>factory.commands?.(name,args)??[])}
  operationObservation(event,commands){return Object.assign({},...[...this.observers.values()].map(factory=>factory.observation?.(event,commands)??{}))}
  createOperationObserver(options){const observers=[...this.observers.values()].map(factory=>factory.createObserver(options));const invoke=(method,...args)=>Promise.all(observers.map(observer=>observer[method]?.(...args)));return {recover:()=>invoke('recover'),beforeIngress:id=>invoke('beforeIngress',id),notificationChanged:n=>{for(const observer of observers)observer.notificationChanged?.(n)},start:(...args)=>{for(const observer of observers)observer.start?.(...args)},observe:(...args)=>invoke('observe',...args),finish:(...args)=>{for(const observer of observers)observer.finish?.(...args)},close:()=>{for(const observer of observers)observer.close?.()}}}
  registerOperatorNotifications(id,notifications){if(this.operatorNotifications)throw failure('CHANNEL_OPERATOR_TRANSPORT_EXISTS');this.operatorNotifications=notifications;return ()=>{if(this.operatorNotifications===notifications)this.operatorNotifications=undefined}}
  registerTransport(channelId,transport){if(!transport||typeof transport.send!=='function'||typeof transport.readback!=='function'||this.transports.has(channelId))throw failure('CHANNEL_TRANSPORT_INVALID');this.transports.set(channelId,transport);return ()=>this.transports.delete(channelId)}
  deliveryEnvelope(notification){const payload=notification.payload??notification,context=this.groupContext(payload.conversationId);if(!context)return undefined;return {type:context.type,channelId:context.channelId,conversationId:context.conversationId,deliveryKey:notification.id,text:payload.text,replyToMessageId:payload.sourceMessageId,senderId:context.participants[payload.actorId],mentions:context.type==='chat'?[]:(payload.atOpenDingTalkIds??[]).map(id=>context.participants[id]).filter(Boolean)}}
  async readResource(method,groupId,messageId,resource){
    const context=this.groupContext(groupId),transport=context&&this.transports.get(context.channelId)
    if(!transport||typeof transport[method]!=='function')throw failure('CHANNEL_RESOURCE_READER_UNAVAILABLE')
    if(method==='readMentioned'&&typeof messageId==='object'){resource={occurredAt:messageId.occurredAt};messageId=messageId.messageId}
    const value=await transport[method]({type:context.type,channelId:context.channelId,conversationId:context.conversationId,messageId,resource})
    if(method!=='readMessage')return value
    if(value?.messageId!==messageId||value.groupId&&value.groupId!==context.conversationId)throw failure('CHANNEL_RESOURCE_SCOPE_MISMATCH')
    const principal=sender=>'channel-actor-'+hash(JSON.stringify([context.channelId,sender]))
    return {...value,groupId,...value.senderOpenDingTalkId?{senderOpenDingTalkId:principal(value.senderOpenDingTalkId)}:{},...value.quotedMessage?{quotedMessage:{...value.quotedMessage,...value.quotedMessage.senderOpenDingTalkId?{senderOpenDingTalkId:principal(value.quotedMessage.senderOpenDingTalkId)}:{}}}:{}}
  }

  canDeliver(notification){const context=this.groupContext(notification.payload?.conversationId);if(!context)return true;const transport=this.transports.get(context.channelId);return !!transport&&(!notification.payload?.artifact||typeof transport.sendFile==='function')&&(['unknown','starting'].includes(notification.state)||!transport.canSend||transport.canSend(notification))}
  async transportCall(method,notification,...args){const envelope=this.deliveryEnvelope(notification),transport=envelope&&this.transports.get(envelope.channelId);if(!transport)throw failure('CHANNEL_TRANSPORT_UNAVAILABLE');if(typeof transport[method]!=='function')throw failure('CHANNEL_CAPABILITY_UNAVAILABLE');return transport[method](envelope,notification,...args)}
  identity(input){const e=envelopeSchema.parse(input),principal='channel-actor-'+hash(JSON.stringify([e.channelId,e.senderId])),conversation=hash(JSON.stringify([e.type,e.channelId,e.conversationId,...e.type==='chat'?[e.senderId]:[]]));return {envelope:e,sessionId:'conversation-'+conversation,workspace:join(this.host.runtimePaths.workspaces,'conversations',conversation),binding:{actorId:e.type==='chat'?principal:'channel-room-actor-'+hash(JSON.stringify([e.channelId,e.conversationId])),...e.type==='chat-room'?{groupId:'channel-room-'+hash(JSON.stringify([e.channelId,e.conversationId])),groupWrite:true}:{}},principal}}
  receive(input){
    if(this.closed)throw failure('CHANNELS_CLOSED')
    if(this.ingress)return this.ingress(input)
    const identity=this.identity(input),previous=this.tails.get(identity.sessionId)??Promise.resolve(),work=previous.catch(()=>{}).then(async()=>{await this.registerConversation(identity.envelope);return this.deliver(identity)});this.tails.set(identity.sessionId,work);work.finally(()=>{if(this.tails.get(identity.sessionId)===work)this.tails.delete(identity.sessionId)}).catch(()=>{});return work
  }
  async deliver({envelope,sessionId,workspace,binding,principal}){
    await privateDirectory(join(this.host.runtimePaths.workspaces,'conversations'));await privateDirectory(workspace);await this.host.memory.bindSession(sessionId,binding)
    let handle=this.handles.get(sessionId)
    if(!handle){const existing=await this.host.sessionPersistence.stat(sessionId);const options={agentOptions:this.host.agentDefaultModel.currentSelection(),setup:async ctx=>{await this.host.agentPresets.mount(ctx,'night-bot')}};handle=existing?await this.host.agents.resume({...options,resumeSessionId:sessionId}):await this.host.agents.create({...options,sessionId,meta:{cwd:workspace,agentPreset:'night-bot'}});this.handles.set(sessionId,handle)}
    const messageKey=hash(JSON.stringify([envelope.channelId,envelope.conversationId,envelope.messageId]))
    const prior=handle.agent.session.snapshotEvents().find(e=>e.type==='user/message'&&e.data.source?.channelMessageKey===messageKey)
    if(prior){if(prior.data.content[0]?.text!==envelope.text||prior.data.source.senderId!==envelope.senderId)throw failure('CHANNEL_MESSAGE_ID_CONFLICT');const receipt=handle.agent.session.snapshotEvents().find(e=>e.type==='plugin:night/channel-delivery'&&e.data.messageKey===messageKey);return {ok:receipt?.data.ok===true,duplicate:true,sessionId,...!receipt?{code:'CHANNEL_DELIVERY_UNCERTAIN'}:{}}}
    const start=handle.agent.session.snapshotEvents().length
    handle.agent.followup(createUserMessage({source:{kind:'user',channelType:envelope.type,channelId:envelope.channelId,conversationId:envelope.conversationId,senderId:envelope.senderId,channelMessageId:envelope.messageId,principal,channelMessageKey:messageKey},content:[{type:'text',text:envelope.text}]}))
    await handle.agent.whenIdle();const end=handle.agent.session.snapshotEvents().findLast(e=>e.seq>=start&&e.type==='turn/end'),ok=end?.data.reason.kind==='completed';appendPluginRecord(handle.agent.session,'plugin:night/channel-delivery',{messageKey,ok});await this.host.sessions.flush(handle.agent.session)
    return {ok,...!ok?{code:'CHANNEL_TURN_INCOMPLETE'}:{},sessionId,channelType:envelope.type,conversationId:envelope.conversationId,senderId:envelope.senderId,taskSource:{actorId:principal,...envelope.type==='chat-room'?{groupId:binding.groupId}:{},channelType:envelope.type,channelId:envelope.channelId,conversationId:envelope.conversationId}}
  }
}
