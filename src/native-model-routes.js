import {getSupportedThinkingLevels} from '@earendil-works/pi-ai'
import {builtinProviders,getBuiltinModels,getAllBuiltinModels} from '@earendil-works/pi-ai/providers/all'
import {discoverPiModels} from './pi-provider-discovery.js'
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}

/** Current configured official model descriptors for application selection UI.
 * This is a view of validated provider declarations, not a model registry or an
 * inference service. Model execution and route validation belong to Pi runtime. */
export class NativeModelRoutes {
 constructor({profiles,official,authentication,settingsNs}){this.profiles=profiles;this.official=official;this.authentication=authentication;this.settingsNs=settingsNs}
 profile(id){const profile=this.profiles().get(id);if(!profile)fail('MODEL_PROVIDER_UNAVAILABLE','Provider route is not configured');return profile}
 listProviders(){return [...this.profiles()].map(([id,profile])=>({id,name:profile.displayName}))}
 async listModels(provider){return this.profile(provider).models.map(model=>({provider,id:model.id,name:model.name,inputModalities:[...model.input]}))}
 async describeModel(provider,id){
  const profile=this.profile(provider),invalid=profile.modelErrors.get(id)??profile.catalogError
  if(invalid)fail('INVALID_CONFIG',invalid)
  const model=profile.models.find(model=>model.id===id)
  if(!model)fail('UNKNOWN_MODEL','Configured model is unavailable')
  const levels=getSupportedThinkingLevels(model),effort=levels.includes(profile.reasoning)?profile.reasoning:undefined
  return {provider,id,name:model.name,inputModalities:[...model.input],context:{contextWindow:model.contextWindow},defaultMaxTokens:profile.configuredMaxTokens.get(id)??model.maxTokens,...model.reasoning?{reasoning:{efforts:levels.map(id=>({id,name:id[0].toUpperCase()+id.slice(1)})),...effort===undefined?{}:{defaultEffort:effort}}}:{}}
 }
 async validateSelection(selection){
  const resolved=await this.official.resolve(selection)
  return {provider:resolved.model.provider,model:resolved.model.id,...resolved.thinkingLevel===undefined?{}:{reasoningEffort:resolved.thinkingLevel}}
 }
 configurableProviders(){
  const catalog=builtinProviders().filter(provider=>getBuiltinModels(provider.id).length||!getAllBuiltinModels(provider.id).length)
  const entries=new Map(catalog.map(provider=>[provider.id,{provider:provider.id,displayName:provider.name,settingsNs:this.settingsNs,settingsPath:['providers',provider.id],declared:false}]))
  for(const [id,profile]of this.profiles())entries.set(id,{provider:id,displayName:profile.displayName,settingsNs:this.settingsNs,settingsPath:['providers',id],declared:!entries.has(id),...profile.catalogError||profile.modelErrors.size?{error:profile.catalogError??profile.modelErrors.values().next().value}:{}})
  return [...entries.values()]
 }
 discover(request,signal){
  if(!request||typeof request.provider!=='string'||!request.provider.trim()||request.provider!==request.provider.trim())fail('DISCOVERY_PROVIDER_REQUIRED','Exact provider id required')
  const profile=this.profiles().get(request.provider),api=request.api??profile?.api,baseURL=request.baseURL??profile?.baseURL??profile?.models[0]?.baseUrl
  // A user may inspect a new endpoint with an explicitly supplied key, but a
  // configured credential must never follow an arbitrary UI endpoint override.
  const sameEndpoint=profile&&(api??profile.models[0]?.api)===(profile.api??profile.models[0]?.api)&&baseURL?.replace(/\/+$/,'')===(profile.baseURL??profile.models[0]?.baseUrl)?.replace(/\/+$/,'')
  if(profile&&!sameEndpoint&&request.apiKey===undefined)fail('DISCOVERY_AUTH_SCOPE_MISMATCH','Configured credentials require the exact configured provider endpoint')
  return discoverPiModels({...request,api,baseURL,...signal?{signal}:{}},()=>sameEndpoint?{headers:profile.headers,resolveApiKey:()=>this.authentication.resolveApiKey(profile)}:undefined)
 }
}
