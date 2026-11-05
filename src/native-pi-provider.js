import z from '@deepseek-ai/schemastery'
import {  LlmError, attributionHeaders } from './native-llm-protocol.js'
import { launchEnvironmentOf } from './native-environment.js'
import { builtinProviders,getBuiltinModels,getAllBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { resolvePiProfiles,configuredPiModels,thinkingLevels } from './pi-provider-catalog.js'
import { piAuthentication } from './pi-provider-auth.js'
import { observePiEvents } from './pi-provider-events.js'
import {nativePiEventSink} from './pi-native-stream.js'
import { piProviderContext } from './pi-provider-context.js'
import { discoverPiModels } from './pi-provider-discovery.js'
import { registerPiLoginFlows } from './pi-provider-login.js'
export const name='night-native-pi-provider'
export const inject=['llm']
export const Config=z.object({providers:z.dict(z.any()).default({}).volatile()})
const nativeError=error=>error instanceof LlmError?error:new LlmError(error.message??'Pi provider failed',error.code??'PI_AI_ERROR',{cause:error,...error.offloadImages?{offloadImages:error.offloadImages}:{}})
const levels=model=>!model.reasoning?['off']:thinkingLevels.filter(level=>model.thinkingLevelMap?.[level]!==null&&(!['xhigh','max'].includes(level)||model.thinkingLevelMap?.[level]!==undefined))
export function piConversationUpdates(model) {
  const c=model.compat??{}
  if(!c.supportsMidConvoSystemMessages)return{}
  const result={systemPromptUpdate:'in-history'}
  if(model.api==='anthropic-messages'&&c.supportsMidConvoToolChanges)result.toolUpdate='in-history'
  else if(model.api==='openai-completions'&&c.supportsMidConvoToolAdditions||['openai-responses','azure-openai-responses','openai-codex-responses'].includes(model.api)&&(c.supportsAdditionalTools||c.supportsToolSearch))result.toolUpdate='addition-only'
  return result
}
/** Native Pi model/config/auth/wire implementation behind the remaining generic
 * LLM registry. That registry's middleware and application policy stay active;
 * this module never invokes the former dsh-llm-pi-ai adapter.
 */
export class NativePiProvider {
  constructor(ctx,profiles,authentication){this.ctx=ctx;this.profiles=profiles;this.authentication=authentication}
  current(){const profiles=this.profiles();if(this.snapshot?.profiles!==profiles)this.snapshot={profiles,models:configuredPiModels(profiles,this.authentication)};return this.snapshot}
  profile(snapshot,id){const profile=snapshot.profiles.get(id);if(!profile)throw new LlmError('Provider route is not registered','NO_ADAPTER');return profile}
  model(snapshot,provider,id){const profile=this.profile(snapshot,provider),error=profile.modelErrors.get(id)??profile.catalogError;if(error)throw new LlmError(error,'INVALID_CONFIG');const model=snapshot.models.getModel(provider,id);if(!model)throw new LlmError('Unknown configured model '+provider+'/'+id,'UNKNOWN_MODEL');return model}
  info(snapshot,provider,id){
    const model=this.model(snapshot,provider,id),profile=this.profile(snapshot,provider),supported=levels(model),max=profile.configuredMaxTokens.get(id),effort=supported.includes(profile.reasoning)?profile.reasoning:undefined
    return{provider,id,name:model.name,inputModalities:[...model.input],context:{contextWindow:model.contextWindow},...max===undefined?{}:{defaultMaxTokens:max},...model.reasoning?{reasoning:{efforts:supported.map(id=>({id,name:id[0].toUpperCase()+id.slice(1)})),...effort===undefined?{}:{defaultEffort:effort}}}:{},...piConversationUpdates(model)}
  }
  providerInfo(provider){return{id:provider,name:this.current().profiles.get(provider)?.displayName??provider}}
  imageRequestPricing(){}
  providerRetryPolicy(provider){return this.current().profiles.get(provider)?.retryPolicy}
  async listModels(provider){const snapshot=this.current();this.profile(snapshot,provider);return snapshot.models.getModels(provider).map(m=>({provider,id:m.id,name:m.name,inputModalities:[...m.input]}))}
  async resolveModel(provider,id){return this.info(this.current(),provider,id)}
  async prepareCall(provider,id){const snapshot=this.current();return{model:this.info(snapshot,provider,id),stream:request=>this.streamSnapshot(request,snapshot)}}
  stream(request){return this.streamSnapshot(request,this.current())}
  async *streamSnapshot(request,snapshot){
    const publish=nativePiEventSink()
    const consumer=new AbortController(),signal=request.signal?AbortSignal.any([request.signal,consumer.signal]):consumer.signal
    try{
      if(request.stop!==undefined)throw new LlmError('Stop sequences are unsupported by this provider','UNSUPPORTED_OPTION')
      const profile=this.profile(snapshot,request.provider),model=this.model(snapshot,request.provider,request.model),effort=request.reasoningEffort??profile.reasoning
      if(effort!==undefined&&!levels(model).includes(effort))throw new LlmError('Unsupported model reasoning effort','UNSUPPORTED_REASONING_EFFORT')
      const apiKey=await this.authentication.resolveApiKey(profile),updates=piConversationUpdates(model)
      if(!model.input.includes('image')&&request.messages.some(message=>message.content.some(block=>block.type==='image')))throw new LlmError('Model does not support image input','UNSUPPORTED_CONTENT')
      const context=await piProviderContext({...request,signal},{profile,model,ctx:this.ctx,alreadyProjected:true,toolUpdate:updates.toolUpdate})
      signal.throwIfAborted()
      const headers=new Headers(profile.headers);for(const [key,value]of Object.entries(attributionHeaders()))headers.set(key,value)
      const knobs=Object.fromEntries(['thinkingBudgets','cacheRetention','transport','timeoutMs','websocketConnectTimeoutMs'].filter(key=>profile[key]!==undefined).map(key=>[key,profile[key]]))
      const upstream=snapshot.models.streamSimple(model,context,{...knobs,...apiKey===undefined?{}:{apiKey},...effort===undefined||effort==='off'?{}:{reasoning:effort},...request.temperature===undefined?{}:{temperature:request.temperature},...request.maxTokens===undefined?{}:{maxTokens:request.maxTokens},...request.sessionId===undefined?{}:{sessionId:String(request.sessionId)},headers:Object.fromEntries(headers),signal,maxRetries:0})
      const chunks=[]
      const observed=observePiEvents(upstream,{provider:request.provider,model:request.model,contextWindow:model.contextWindow,signal,idleTimeoutMs:profile.streamIdleTimeoutMs,onChunk:chunk=>{publish.chunk(chunk);chunks.push(chunk)},onCancel:()=>consumer.abort('Pi request stream settled')})
      for await(const event of observed){publish(event);while(chunks.length)yield chunks.shift()}
      while(chunks.length)yield chunks.shift()
    }catch(error){throw nativeError(error)}finally{consumer.abort('Pi request consumer stopped')}
  }
}
export function apply(ctx,config){
  const settingsNs=ctx.fiber.entry?.options.id??name
  ctx.inject(['settings'],child=>child.effect(()=>child.settings.configure({auto:false},ctx.fiber)))
  const authentication=piAuthentication({getCredentials:()=>ctx.get('credentials'),getEnvironment:key=>launchEnvironmentOf(ctx).get(key)?.value})
  let last,profiles
  const current=()=>{const raw=config.providers.get();if(raw!==last){profiles=resolvePiProfiles(raw,{deferred:true});last=raw}return profiles}
  current()
  const adapter=new NativePiProvider(ctx,current,authentication)
  ctx.provide('nativePiProvider',{adapter,profiles:current})
  ctx.inject(['authorization'],child=>registerPiLoginFlows(child,authentication))
  const catalog=builtinProviders().filter(p=>getBuiltinModels(p.id).length||!getAllBuiltinModels(p.id).length)
  let registration,directory,previousFacts
  const update=()=>{
    const snapshot=current(),entries=new Map(catalog.map(p=>[p.id,{provider:p.id,displayName:p.id,settingsNs,settingsPath:['providers',p.id],declared:false}]))
    for(const [id,p]of snapshot)entries.set(id,{provider:id,displayName:p.displayName,settingsNs,settingsPath:['providers',id],declared:!entries.has(id),...p.catalogError||p.modelErrors.size?{error:p.catalogError??p.modelErrors.values().next().value}:{}})
    if(directory)directory.replace([...entries.values()]);else directory=ctx.llm.registerConfigurableProviders([...entries.values()])
    const facts=JSON.stringify([...snapshot].map(([id,p])=>[id,p.displayName,p.retryPolicy]).sort((a,b)=>a[0].localeCompare(b[0])))
    if(facts!==previousFacts){if(registration)registration.replace([...snapshot.keys()]);else if(snapshot.size)registration=ctx.llm.registerAdapter([...snapshot.keys()],adapter);previousFacts=facts}
  }
  update()
  ctx.llm.registerModelDiscovery(settingsNs,(request,signal)=>discoverPiModels({...request,...signal?{signal}:{}},()=>{const p=current().get(request.provider);return p?{headers:p.headers,resolveApiKey:()=>authentication.resolveApiKey(p)}:undefined}))
  ctx.on('loader/volatile-update',()=>{try{update()}catch(error){ctx.logger.error(error)}})
  ctx.on('internal/config',function(_raw,next){const raw=next();if(this===ctx.fiber){const candidate=Config(raw),before=config.providers.get(),changed=Object.fromEntries(Object.entries(candidate.providers.get()).filter(([id,value])=>JSON.stringify(value)!==JSON.stringify(before[id])));resolvePiProfiles(changed)}return raw})
}
