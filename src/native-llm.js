import {TypertRemoteService,Remote,RemoteError} from './native-typert-protocol.js'
import {deepFreeze} from './native-values.js'
import { LlmError, HarnessError } from '@deepseek-ai/dsh-llm';
import { callConfigEquals, freezeMessage, fileHandleText, contentHasFile, contentHasImage, projectFilesToText, projectImagesForTextModel, projectToolUpdates } from './native-message-protocol.js';
import {resolvePiRetryPolicy} from './pi-provider-retry.js'
const initializers=[]
const ownData=(object,key)=>{try{const d=Object.getOwnPropertyDescriptor(object,key);return d&&'value'in d?d.value:undefined}catch{return}}
function normalizeLlmFailure(value){
 let error=false;try{error=value instanceof Error}catch{}
 if(!error){let message='LLM adapter failed';try{message=String(value)||message}catch{}return Object.freeze({message,code:'UNKNOWN'})}
 const code=ownData(value,'code'),payload=ownData(value,'failure')
 if(payload&&typeof payload==='object')try{const {message,code:carried,status,providerRetryAfterMs,requestId,offloadImages}=payload;if(nonempty(message)&&nonempty(carried)&&carried===code&&(status===undefined||Number.isInteger(status)&&status>=100&&status<=599)&&(providerRetryAfterMs===undefined||Number.isFinite(providerRetryAfterMs)&&providerRetryAfterMs>0)&&(requestId===undefined||nonempty(requestId))&&(offloadImages===undefined||Number.isSafeInteger(offloadImages)&&offloadImages>0))return Object.freeze({message,code:carried,...status!==undefined?{status}:{},...providerRetryAfterMs!==undefined?{providerRetryAfterMs}:{},...requestId!==undefined?{requestId}:{},...offloadImages!==undefined?{offloadImages}:{}})}catch{}
 let message='LLM adapter failed';try{const text=value.message;if(nonempty(text))message=text}catch{}
 let owned=false;try{owned=value instanceof HarnessError}catch{}
 return Object.freeze({message,code:owned&&nonempty(code)?code:'UNKNOWN'})
}
const fail=(message,code)=>{throw new LlmError(message,code)}
const nonempty=value=>typeof value==='string'&&value.length>0
const frozen=value=>deepFreeze(structuredClone(value))
/** Application-owned provider topology, prepared-call ownership and dispatch
 * policy. Public legacy message projection helpers and RPC carrier remain
 * explicit compatibility dependencies; model execution belongs to Pi. */
export default class NativeLlm extends TypertRemoteService{
 constructor(ctx){super(ctx,'llm');this.adapters=new Map();this.directory=new Map();this.discoveries=new Map();for(const init of initializers)init.call(this)}
 notify(){for(const listener of this.ctx.events.dispatch('emit',['llm/adapters-updated']))try{Promise.resolve(listener()).catch(error=>this.warn(error))}catch(error){this.warn(error)}}
 warn(error){this.ctx.logger.warn('llm: an llm/adapters-updated listener failed');this.ctx.logger.warn(error)}
 registration(provider){const entry=this.adapters.get(provider);if(!entry)fail(`no adapter registered for provider "${provider}"`,'NO_ADAPTER');return entry}
 registerAdapter(providers,adapter){
  const owned=new Set();let released=false
  const commit=routes=>{const prepared=new Map();for(const provider of routes){if(!nonempty(provider))fail('adapter provider names must be non-empty','INVALID_ADAPTER');if(prepared.has(provider)||this.adapters.has(provider)&&!owned.has(provider))fail(`an adapter for provider "${provider}" is already registered`,'DUPLICATE_ADAPTER');const info=adapter.providerInfo(provider);if(info.id!==provider||!nonempty(info.name))fail('adapter metadata must preserve provider identity and name','INVALID_ADAPTER');prepared.set(provider,{adapter,provider:{id:provider,name:info.name},retryPolicy:adapter.providerRetryPolicy(provider)??resolvePiRetryPolicy()})}for(const id of owned)this.adapters.delete(id);owned.clear();for(const [id,entry]of prepared){this.adapters.set(id,entry);owned.add(id)}this.notify()}
  const dispose=this.ctx.effect(()=>{if(!providers.length)fail('an adapter must register at least one provider','INVALID_ADAPTER');commit(providers);return()=>{released=true;for(const id of owned)this.adapters.delete(id);owned.clear();this.notify()}},'native llm registration')
  const handle=()=>void dispose();handle.replace=routes=>{if(released)fail('a disposed adapter registration cannot replace its routes','REGISTRATION_DISPOSED');commit(routes)};return handle
 }
 listProviders(){return[...this.adapters.values()].map(e=>({...e.provider}))}
 registerConfigurableProviders(entries){
  let held=new Set(),released=false
  const commit=candidates=>{const next=new Map();for(const e of candidates){if(!nonempty(e.provider)||!nonempty(e.displayName)||!nonempty(e.settingsNs)||!Array.isArray(e.settingsPath)||e.settingsPath.some(s=>!nonempty(s)))fail('invalid configurable provider metadata','INVALID_DIRECTORY');if(next.has(e.provider)||this.directory.has(e.provider)&&!held.has(e.provider))fail('configurable provider already declared','DUPLICATE_DIRECTORY');next.set(e.provider,{...e,settingsPath:[...e.settingsPath]})}for(const id of held)this.directory.delete(id);for(const [id,e]of next)this.directory.set(id,e);held=new Set(next.keys());this.notify()}
  const dispose=this.ctx.effect(()=>{if(!entries.length)fail('a configurable-provider registration must declare at least one provider','INVALID_DIRECTORY');commit(entries);return()=>{released=true;for(const id of held)this.directory.delete(id);held.clear();this.notify()}},'native llm directory')
  const handle=()=>void dispose();handle.replace=next=>{if(released)fail('directory registration disposed','REGISTRATION_DISPOSED');commit(next)};return handle
 }
 listConfigurableProviders(){return[...this.directory.values()].map(e=>({...e,settingsPath:[...e.settingsPath]}))}
 registerModelDiscovery(ns,discover){const dispose=this.ctx.effect(()=>{if(!nonempty(ns))fail('discovery needs a settings namespace','INVALID_DISCOVERY');if(this.discoveries.has(ns))fail('model discovery already registered','DUPLICATE_DISCOVERY');this.discoveries.set(ns,discover);return()=>this.discoveries.delete(ns)},'native llm discovery');return()=>void dispose()}
 async discoverModels(ns,request,signal){const discover=this.discoveries.get(ns);if(!discover)fail('model discovery is not registered','NO_DISCOVERY');if(!nonempty(request.provider)&&!nonempty(request.baseURL))fail('discovery needs a provider route or baseURL','INVALID_DISCOVERY');signal?.throwIfAborted();const result=await discover(request,signal);signal?.throwIfAborted();const seen=new Set(),models=[];for(const m of result){if(!nonempty(m.id)||seen.has(m.id))continue;seen.add(m.id);models.push({id:m.id,...m.name!==undefined?{name:m.name}:{},...m.contextWindow!==undefined?{contextWindow:m.contextWindow}:{},...m.maxTokens!==undefined?{maxTokens:m.maxTokens}:{},...m.inputModalities!==undefined?{inputModalities:[...m.inputModalities]}:{}})}return models}
 async remoteDiscoverModels(ns,request,signal){try{return await this.discoverModels(ns,request,signal)}catch(error){throw new RemoteError('llm/model-discovery-rejected',error instanceof Error?error.message:String(error),{settingsNs:ns,...request.baseURL!==undefined?{baseURL:request.baseURL}:{}},{cause:error})}}
 providerRetryPolicy(provider){return this.registration(provider).retryPolicy}
 imageRequestPricing(provider,model){return this.adapters.get(provider)?.adapter.imageRequestPricing(provider,model)}
 fileReadPath(ref){let path;try{path=this.ctx.get('attachments')?.fileHostPath(ref)}catch{return}return path===undefined?undefined:this.ctx.get('fs')?.processPathFromHostPath(path)}
 fileRequestText(ref){return fileHandleText(ref,this.fileReadPath(ref))}
 async listModels(provider){const seen=new Set();return(await this.registration(provider).adapter.listModels(provider)).map(m=>{if(m.provider!==provider||!nonempty(m.id)||!nonempty(m.name)||m.description!==undefined&&typeof m.description!=='string'||seen.has(m.id))fail('adapter returned invalid or duplicate model metadata','INVALID_CATALOG');seen.add(m.id);return{provider,id:m.id,name:m.name,...m.description!==undefined?{description:m.description}:{},...m.inputModalities!==undefined?{inputModalities:[...m.inputModalities]}:{}}})}
 normalize(registration,id,resolved){
  const provider=registration.provider.id
  if(resolved.provider!==provider||resolved.id!==id||!nonempty(resolved.name)||resolved.description!==undefined&&typeof resolved.description!=='string')fail('invalid exact model metadata','INVALID_MODEL_INFO')
  if(resolved.context!==undefined&&(!Number.isInteger(resolved.context.contextWindow)||resolved.context.contextWindow<=0))fail('invalid model context','INVALID_MODEL_CONTEXT')
  if(resolved.defaultMaxTokens!==undefined&&(!Number.isSafeInteger(resolved.defaultMaxTokens)||resolved.defaultMaxTokens<=0))fail('invalid default maxTokens','INVALID_MODEL_MAX_TOKENS')
  if(resolved.systemPromptUpdate!==undefined&&resolved.systemPromptUpdate!=='in-history'||resolved.toolUpdate!==undefined&&!['in-history','addition-only'].includes(resolved.toolUpdate))fail('invalid conversation update capability','INVALID_MODEL_INFO')
  const info={provider,id,name:resolved.name,...resolved.description!==undefined?{description:resolved.description}:{},...resolved.inputModalities!==undefined?{inputModalities:[...resolved.inputModalities]}:{},...resolved.context!==undefined?{context:{contextWindow:resolved.context.contextWindow}}:{},...resolved.defaultMaxTokens!==undefined?{defaultMaxTokens:resolved.defaultMaxTokens}:{},...resolved.systemPromptUpdate!==undefined?{systemPromptUpdate:resolved.systemPromptUpdate}:{},...resolved.toolUpdate!==undefined?{toolUpdate:resolved.toolUpdate}:{}}
  if(resolved.reasoning!==undefined){const seen=new Set(),r=resolved.reasoning;if(!r.efforts.length)fail('empty reasoning efforts','INVALID_MODEL_REASONING');const efforts=r.efforts.map(e=>{if(!nonempty(e.id)||!nonempty(e.name)||e.description!==undefined&&typeof e.description!=='string'||seen.has(e.id))fail('invalid reasoning effort','INVALID_MODEL_REASONING');seen.add(e.id);return{id:e.id,name:e.name,...e.description!==undefined?{description:e.description}:{}}});if(r.defaultEffort!==undefined&&!seen.has(r.defaultEffort))fail('unknown default reasoning effort','INVALID_MODEL_REASONING');info.reasoning={efforts,...r.defaultEffort!==undefined?{defaultEffort:r.defaultEffort}:{}}}
  return info
 }
 async resolveModelInfo(provider,id,signal){const entry=this.registration(provider);signal?.throwIfAborted();const result=await entry.adapter.resolveModel(provider,id,signal);signal?.throwIfAborted();return this.normalize(entry,id,result)}
 resolveControls(config,info){let result=config;if(config.maxTokens===undefined&&info.defaultMaxTokens!==undefined)result={...result,maxTokens:info.defaultMaxTokens};const effort=config.reasoningEffort??info.reasoning?.defaultEffort;if(effort!==undefined){if(!info.reasoning?.efforts.some(e=>e.id===effort))fail(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effort}"`,'UNSUPPORTED_REASONING_EFFORT');if(config.reasoningEffort!==effort)result={...result,reasoningEffort:effort}}return result}
 async resolveCallConfig(config,signal){return this.resolveControls(config,await this.resolveModelInfo(config.provider,config.model,signal))}
 async prepareCall(config,signal,configure){
  signal?.throwIfAborted();const {provider,model,...controls}=config,entry=this.registration(provider),call=await entry.adapter.prepareCall(provider,model,signal);signal?.throwIfAborted();const info=this.normalize(entry,model,call.model),proposed=configure?{...configure(frozen(controls),frozen(info)),provider,model}:config;signal?.throwIfAborted();const resolved=frozen(this.resolveControls(proposed,info)),adapterDefaults=frozen({...proposed.reasoningEffort===undefined&&resolved.reasoningEffort!==undefined?{reasoningEffort:true}:{},...proposed.maxTokens===undefined&&resolved.maxTokens!==undefined?{maxTokens:true}:{}});let used=false
  return Object.freeze({config:resolved,retryPolicy:entry.retryPolicy,adapterDefaults,...info.context!==undefined?{context:frozen(info.context)}:{},...info.inputModalities!==undefined?{inputModalities:Object.freeze([...info.inputModalities])}:{},...info.systemPromptUpdate!==undefined?{systemPromptUpdate:info.systemPromptUpdate}:{},...info.toolUpdate!==undefined?{toolUpdate:info.toolUpdate}:{},stream:options=>{if(used||!callConfigEquals(options,resolved))fail('prepared LLM call reused or config changed','INVALID_PREPARED_CALL');used=true;return this.streamWith(options,{entry,info,config:resolved,dispatch:request=>call.stream(request)})}})
 }
 forAdapter(options,adapter){let changed=false;const messages=options.messages.map(m=>{if(m.role!=='assistant'||m.source.replayState===undefined||this.adapters.get(m.source.provider)?.adapter===adapter)return m;changed=true;return freezeMessage({...m,source:{kind:'model',provider:m.source.provider,model:m.source.model}})});if(!changed)return options;const result={...options,messages};return Object.isFrozen(options)?deepFreeze(result):result}
 failure(error,signal){const failure=normalizeLlmFailure(error);return{type:'finish',reason:{kind:signal?.aborted||failure.code==='ABORTED'?'aborted':'error',failure}}}
 async *adapterStream(options,prepared){
  let iterator
  try{
   let entry=prepared?.entry??this.registration(options.provider),info=prepared?.info,config=prepared?.config,dispatch=prepared?.dispatch
   if(!prepared){const call=await entry.adapter.prepareCall(options.provider,options.model,options.signal);info=this.normalize(entry,options.model,call.model);config=this.resolveControls(options,info);dispatch=request=>call.stream(request)}
   if(prepared&&!callConfigEquals(options,config))fail('prepared call configuration changed before dispatch','INVALID_PREPARED_CALL')
   let request=callConfigEquals(options,config)?options:{...options,...config};if(request!==options&&Object.isFrozen(options))deepFreeze(request)
   let messages=request.messages;if(messages.some(m=>contentHasFile(m.content)))messages=projectFilesToText(messages,ref=>this.fileReadPath(ref));if(info.inputModalities&&!info.inputModalities.includes('image')&&messages.some(m=>contentHasImage(m.content)))messages=projectImagesForTextModel(messages)
   const tools=projectToolUpdates(messages,request.tools,info.toolUpdate,request.toolHistory);messages=tools.messages
   if(messages!==request.messages||tools.tools!==request.tools){const projected={...request,messages,...tools.tools!==undefined?{tools:tools.tools}:{}};request=Object.isFrozen(request)?deepFreeze(projected):projected}
   iterator=dispatch(this.forAdapter(request,entry.adapter))[Symbol.asyncIterator]()
  }catch(error){yield this.failure(error,options.signal);return}
  let ended=false
  try{while(true){let item;try{item=await iterator.next()}catch(error){ended=true;yield this.failure(error,options.signal);return}if(item.done){ended=true;return}yield item.value}}finally{if(!ended){const close=iterator.return?.bind(iterator);if(close)await close()}}
 }
 stream(options){return this.streamWith(options)}
 streamWith(options,prepared){return this.ctx.waterfall(this,'llm/stream',options,()=>this.adapterStream(options,prepared))}
}
for(const [name,alias]of [['listProviders'],['listConfigurableProviders'],['remoteDiscoverModels','discoverModels']]){const context={name,kind:'method',static:false,private:false,addInitializer:fn=>initializers.push(fn)};if(alias)Remote(alias)(NativeLlm.prototype[name],context);else Remote(NativeLlm.prototype[name],context)}
