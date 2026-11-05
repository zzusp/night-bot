import {isDeepStrictEqual} from 'node:util'
// Direct official SDK model/auth registry. No Night message/chunk conversion.
import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {InMemoryModelsStore,lazyStream} from '@earendil-works/pi-ai'
import {isAbsolute,dirname} from 'node:path'
import {inside} from './runtime/paths.js'
import {configuredPiProvider,thinkingLevels} from './pi-provider-catalog.js'
import {attributionHeaders} from './native-llm-protocol.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}
const levels=model=>!model.reasoning?['off']:thinkingLevels.filter(level=>model.thinkingLevelMap?.[level]!==null&&(!['xhigh','max'].includes(level)||model.thinkingLevelMap?.[level]!==undefined))
const emptyProvider=id=>({id,name:id,auth:{},getModels:()=>[],stream(){throw new Error('Provider route is not configured')},streamSimple(){throw new Error('Provider route is not configured')}})

export class OfficialPiModelRuntime {
 #lifetime=new AbortController()
 #active=new Set()
 #closing
 #defaultScope={}
 #scopes=new WeakMap()
 constructor(ctx,profiles,authentication,{createRuntime=options=>ModelRuntime.create(options)}={}) {this.ctx=ctx;this.profiles=profiles;this.authentication=authentication;this.createRuntime=createRuntime;ctx.effect?.(()=>()=>this.close(),'official Pi model runtime drain')}
 async close() {
  if(!this.#closing){this.#lifetime.abort(new Error('Official Pi model runtime disposed'));this.#closing=Promise.allSettled([...this.#active].map(record=>record.done.promise)).then(()=>{})}
  return this.#closing
 }
 async resolve(config,actorScope) {
  if(this.#lifetime.signal.aborted)fail('OFFICIAL_MODEL_RUNTIME_CLOSED','Official Pi model runtime is closed')
  if(!config || typeof config.provider!=='string' || typeof config.model!=='string')fail('INVALID_MODEL_ROUTE','Explicit provider and model are required')
  config.signal?.throwIfAborted()
  if(config.stop!==undefined)fail('UNSUPPORTED_OPTION','Stop sequences are unsupported by this provider')
  const credentials=actorScope?.credentials
  if(credentials!==undefined && (credentials===null || typeof credentials!=='object'))fail('INVALID_AUTH_SCOPE','Credentials must be an authorized capability')
  const key=credentials??this.#defaultScope
  let pending=this.#scopes.get(key)
  if(!pending) {
   const authentication=credentials===undefined?this.authentication:this.authentication.forAuthorization({credentials})
   pending=this.#create(authentication,credentials)
   this.#scopes.set(key,pending)
   pending.catch(()=>{if(this.#scopes.get(key)===pending)this.#scopes.delete(key)})
  }
  const state=await pending
  if(this.#lifetime.signal.aborted)fail('OFFICIAL_MODEL_RUNTIME_CLOSED','Official Pi model runtime is closed')
  const profiles=this.profiles()
  this.#synchronize(state,profiles)
  const profile=profiles.get(config.provider)
  if(!profile)fail('NO_ADAPTER','Provider route is not configured')
  const invalid=profile.modelErrors.get(config.model)??profile.catalogError
  if(invalid)fail('INVALID_CONFIG',invalid)
  const model=state.runtime.getModel(config.provider,config.model)
  if(!model)fail('UNKNOWN_MODEL','Configured model is unavailable')
  const thinkingLevel=config.reasoningEffort??profile.reasoning??'off'
  if(!levels(model).includes(thinkingLevel))fail('UNSUPPORTED_REASONING_EFFORT','Unsupported model reasoning effort')
  const cap=profile.configuredMaxTokens.get(model.id)??model.maxTokens
  const maxTokens=config.maxTokens??cap
  if(!Number.isSafeInteger(maxTokens)||maxTokens<=0||maxTokens>cap)fail('INVALID_MODEL_MAX_TOKENS','Requested output exceeds configured model limit')
  if(config.temperature!==undefined&&!Number.isFinite(config.temperature))fail('INVALID_TEMPERATURE','Temperature must be finite')
  config.signal?.throwIfAborted()
  return {modelRuntime:state.runtime,model,thinkingLevel,requestOptions:{maxTokens,...config.temperature===undefined?{}:{temperature:config.temperature},maxRetries:0},retryPolicy:profile.retryPolicy}
 }
 #signal(signal) {return signal?AbortSignal.any([this.#lifetime.signal,signal]):this.#lifetime.signal}
 #track(operation) {
  if(this.#lifetime.signal.aborted)return Promise.reject(Object.assign(new Error('Official Pi model runtime is closed'),{code:'OFFICIAL_MODEL_RUNTIME_CLOSED'}))
  const record={done:Promise.withResolvers()};this.#active.add(record)
  return Promise.resolve().then(operation).then(value=>{this.#lifetime.signal.throwIfAborted();return value}).finally(()=>{this.#active.delete(record);record.done.resolve()})
 }
 async #create(authentication,actorCredentials) {
  const store=authentication.credentials
  const credentials={read:(id,options)=>this.#track(()=>store.read(id,{...options,signal:this.#signal(options?.signal)})),list:options=>this.#track(()=>store.list({...options,signal:this.#signal(options?.signal)})),modify:(id,mutate,options)=>this.#track(()=>store.modify(id,mutate,{...options,signal:this.#signal(options?.signal)})),delete:(id,options)=>this.#track(()=>store.delete(id,{...options,signal:this.#signal(options?.signal)}))}
  const runtime=await this.createRuntime({credentials,modelsPath:null,modelsStore:new InMemoryModelsStore(),refreshOnCreate:false,allowModelNetwork:false})
  // ModelRuntime ships built-in catalogs. Mask undeclared routes through its
  // public registry before any awaited availability refresh can use them.
  for(const provider of runtime.getProviders())runtime.registerNativeProvider(emptyProvider(provider.id))
  return {runtime,authentication,actorCredentials,profiles:undefined,registered:new Set()}
 }
 #synchronize(state,profiles) {
  if(state.profiles===profiles)return
  for(const id of state.registered)if(!profiles.has(id)) {state.runtime.unregisterProvider(id);state.runtime.registerNativeProvider(emptyProvider(id))}
  for(const profile of profiles.values()) {
   if(profile.catalogError) {state.runtime.registerNativeProvider(emptyProvider(profile.provider));continue}
   state.runtime.registerNativeProvider(this.#provider(state,profile))
  }
  state.registered=new Set(profiles.keys());state.profiles=profiles
 }
 #provider(state,profile) {
  const provider=configuredPiProvider(profile),authentication=state.authentication
  const paths=this.ctx.get?.('runtimePaths'),secretRoot=paths?.secrets??(paths?.credentials?dirname(paths.credentials):undefined)
  const authContext={env:async name=>state.actorCredentials?(await state.actorCredentials.resolve?.(name))?.value:authentication.authContext.env(name),fileExists:path=>typeof path==='string'&&isAbsolute(path)&&secretRoot&&inside(secretRoot,path)?authentication.authContext.fileExists(path):Promise.resolve(false)}
  const keyAuth=provider.auth.apiKey
  const apiKey=profile.apiKeyEnv?{
   name:profile.displayName,
   async check({signal}){signal.throwIfAborted();await authentication.resolveApiKey(profile);return {type:'api_key',source:'configured credential reference'}},
   async resolve({signal}){signal.throwIfAborted();return {auth:{apiKey:await authentication.resolveApiKey(profile)},source:'configured credential reference'}}
  }:keyAuth?{...keyAuth,...keyAuth.check?{check:input=>keyAuth.check({...input,ctx:authContext})}:{},resolve:input=>keyAuth.resolve({...input,ctx:authContext})}:undefined
  const auth={...provider.auth,...apiKey?{apiKey:{...apiKey,...apiKey.check?{check:input=>this.#track(()=>apiKey.check({...input,signal:this.#signal(input.signal)}))}:{},resolve:input=>this.#track(()=>apiKey.resolve({...input,signal:this.#signal(input.signal)}))}}:{}}
  if(auth.oauth){const oauth=auth.oauth;auth.oauth={...oauth,refresh:(credential,signal)=>this.#track(()=>oauth.refresh(credential,this.#signal(signal))),login:(interaction,options)=>this.#track(()=>oauth.login({...interaction,signal:this.#signal(interaction.signal)},options))}}
  const dispatch=(method,model,context,options={})=>{
   const current=this.profiles().get(profile.provider)
   const canonical=current?.models.find(candidate=>candidate.id===model.id)
   const endpointBound=profile.apiKeyEnv!==undefined||!provider.auth.oauth
   if(current!==profile || !canonical || ['api','contextWindow','maxTokens'].some(key=>canonical[key]!==model[key]) || !isDeepStrictEqual(canonical.compat,model.compat) || !isDeepStrictEqual(canonical.thinkingLevelMap,model.thinkingLevelMap) || endpointBound&&canonical.baseUrl!==model.baseUrl)return lazyStream(model,async()=>fail('OFFICIAL_MODEL_ROUTE_CHANGED','Provider configuration changed; resolve the model again'))
   const controller=new AbortController(),signal=AbortSignal.any([this.#lifetime.signal,controller.signal,...options.signal?[options.signal]:[]])
   let timer
   const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(Object.assign(new Error('Official provider stream idle timeout'),{code:'STREAM_IDLE_TIMEOUT'})),profile.streamIdleTimeoutMs);timer.unref?.()}
   const knobs=Object.fromEntries(['thinkingBudgets','cacheRetention','transport','timeoutMs','websocketConnectTimeoutMs'].filter(key=>profile[key]!==undefined).map(key=>[key,profile[key]]))
   const headers=new Headers(profile.headers),suppressed={}
   for(const [name,value]of Object.entries(options.headers??{})){if(value===null){headers.delete(name);suppressed[name]=null}else if(value!==undefined)headers.set(name,value)}
   for(const [name,value]of Object.entries(attributionHeaders()))headers.set(name,value)
   const cap=profile.configuredMaxTokens.get(model.id)??model.maxTokens
   const requested=options.maxTokens??cap
   const record={done:Promise.withResolvers()};this.#active.add(record)
   return lazyStream(model,async()=>{
    signal.throwIfAborted()
    if(!Number.isSafeInteger(requested)||requested<=0||requested>cap)fail('INVALID_MODEL_MAX_TOKENS','Requested output exceeds configured model limit')
    touch()
    return provider[method](model,context,{...knobs,...options,maxTokens:requested,headers:{...Object.fromEntries(headers),...suppressed},signal,maxRetries:0})
   },{onEvent:touch,onResult:()=>{clearTimeout(timer);controller.abort(new Error('Official provider stream settled'));this.#active.delete(record);record.done.resolve()}})
  }
  return {...provider,auth,stream:(model,context,options)=>dispatch('stream',model,context,options),streamSimple:(model,context,options)=>dispatch('streamSimple',model,context,options)}
 }
}
