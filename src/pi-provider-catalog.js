import {officialRetrySettings} from './runtime/pi-official-settings.js'
import { builtinModels, builtinProviders, getBuiltinModels, getAllBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'

export const thinkingLevels = ['off','minimal','low','medium','high','xhigh','max']
const protocols = { 'openai-completions':openAICompletionsApi, 'openai-responses':openAIResponsesApi, 'anthropic-messages':anthropicMessagesApi }
const completions = 'supportsStore supportsDeveloperRole supportsReasoningEffort supportsUsageInStreaming supportsFinishReason maxTokensField requiresToolResultName requiresAssistantAfterToolResult requiresThinkingAsText requiresReasoningContentOnAssistantMessages thinkingFormat chatTemplateKwargs chatTemplateArgs supportsThinkingTokenBudget thinkingTokenBudgetField vllmPriority supportsStrictMode cacheControlFormat supportsLongCacheRetention'.split(' ')
const responses = 'supportsDeveloperRole supportsMaxOutputTokens supportsStrictMode supportsLongCacheRetention'.split(' ')
const gates = new Map([
  ['openai-completions',completions], ['openai-responses',responses], ['azure-openai-responses',responses], ['openai-codex-responses',responses],
  ['anthropic-messages','supportsEagerToolInputStreaming supportsLongCacheRetention supportsCacheControlOnTools supportsTemperature forceAdaptiveThinking allowEmptySignature supportsStrictTools'.split(' ')],
  ['bedrock-converse-stream',['supportsStrictMode']],
])
const allowedCompat = new Set([...gates.values()].flat())
const catalog = new Map(builtinProviders().filter(p=>getBuiltinModels(p.id).length||!getAllBuiltinModels(p.id).length).map(p=>[p.id,p]))
const invalid = (provider,detail) => Object.assign(new Error(`Pi provider "${provider}": ${detail}`),{code:'INVALID_CONFIG'})
const object = value => value!==null && typeof value==='object' && !Array.isArray(value)
function positive(provider,name,value,{integer=true}={}) {
  if(!Number.isFinite(value)||value<=0||(integer&&!Number.isSafeInteger(value)))throw invalid(provider,`${name} must be positive${integer?' integer':''}`)
  return value
}
function compatEntries(provider,value) {
  if(value===undefined)return []
  if(!object(value))throw invalid(provider,'compat must be an object')
  return Object.entries(value).filter(([key,item])=>{
    if(!allowedCompat.has(key)||item==null)throw invalid(provider,`unsupported or empty compat.${key}`)
    if(object(item)&&!Object.keys(item).length)return false
    if(key==='chatTemplateArgs'||key==='chatTemplateKwargs'){
      if(!object(item))throw invalid(provider,`compat.${key} must be an object`)
      for(const field of Object.values(item))if(!(field===null||['string','boolean','number'].includes(typeof field)||object(field)&&Object.keys(field).length===1&&['thinking.enabled','thinking.effort','thinking.budget'].includes(field.$var)))throw invalid(provider,`invalid compat.${key} value`)
    }else if(key==='vllmPriority'){
      if(!Number.isSafeInteger(item))throw invalid(provider,'compat.vllmPriority must be an integer')
    }else if(['maxTokensField','thinkingFormat','thinkingTokenBudgetField','cacheControlFormat'].includes(key)){
      const choices={maxTokensField:['max_tokens','max_completion_tokens'],thinkingFormat:['openai','deepseek','openrouter','together','baseten','zai','qwen','chat-template','qwen-chat-template','string-thinking','ant-ling'],thinkingTokenBudgetField:['thinking_token_budget','thinking_budget','thinking_budget_tokens'],cacheControlFormat:['anthropic']}[key]
      if(!choices.includes(item))throw invalid(provider,`invalid compat.${key}`)
    }else if(typeof item!=='boolean')throw invalid(provider,`compat.${key} must be boolean`)
    return true
  })
}
function reasoning(provider,entry,base) {
  const declared=entry.reasoningEfforts
  if(declared===undefined)return{reasoning:base?.reasoning??false}
  if(declared===false)return{reasoning:false}
  if(!object(declared)||!Object.keys(declared).length)throw invalid(provider,`${entry.id}: empty reasoningEfforts`)
  for(const [level,wire] of Object.entries(declared))if(!thinkingLevels.includes(level)||(wire===null?level!=='off':typeof wire!=='string'||!wire))throw invalid(provider,`${entry.id}: invalid reasoningEfforts.${level}`)
  if(!Object.keys(declared).some(level=>level!=='off'))throw invalid(provider,`${entry.id}: reasoningEfforts needs a thinking level`)
  const map=Object.fromEntries(thinkingLevels.filter(level=>declared[level]!==null).map(level=>[level,declared[level]??null]))
  return{reasoning:true,thinkingLevelMap:map}
}
function input(provider,value,fallback) {
  if(value===undefined||Array.isArray(value)&&!value.length)return [...fallback]
  if(!Array.isArray(value)||value.some(item=>!['text','image'].includes(item)))throw invalid(provider,'input must contain text/image modalities')
  return [...value]
}
function scalarProfile(provider,source) {
  if(!provider||!object(source))throw invalid(provider,'profile must be an object with a nonempty route')
  if(Object.hasOwn(source,'retryPolicy'))throw Object.assign(new Error('Provider retryPolicy has been removed; use providers.<id>.retry with Pi-native retry settings'),{code:'PI_RETRY_SETTINGS_MIGRATION_REQUIRED'})
  for(const key of ['provider','maxRetries','maxRetryDelayMs'])if(key in source)throw invalid(provider,`removed field ${key}`)
  for(const key of ['baseURL','displayName','apiKeyEnv'])if(source[key]!==undefined&&(typeof source[key]!=='string'||!source[key]))throw invalid(provider,`${key} must be nonempty string`)
  if(source.apiKeyEnv!==undefined&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.apiKeyEnv))throw invalid(provider,'invalid credential reference')
  if(source.api!==undefined&&!protocols[source.api])throw invalid(provider,`unsupported explicit protocol ${source.api}`)
  if(source.headers!==undefined&&!object(source.headers))throw invalid(provider,'headers must be an object')
  for(const [key,value]of Object.entries(source.headers??{})){if(typeof value!=='string')throw invalid(provider,`header ${key} must be string`);try{new Headers([[key,value]])}catch{throw invalid(provider,`invalid header ${key}`)}}
  const result={...structuredClone(source),provider,displayName:source.displayName??provider}
  for(const [key,fallback]of Object.entries({defaultContextWindow:262144,defaultMaxTokens:32768,maxRequestImageBytes:20971520,requestImagePixelBudget:4194304,requestImageMaxBytes:1048576}))result[key]=positive(provider,key,source[key]??fallback)
  result.streamIdleTimeoutMs=positive(provider,'streamIdleTimeoutMs',source.streamIdleTimeoutMs??300000,{integer:false})
  if(result.streamIdleTimeoutMs>2147483647)throw invalid(provider,'streamIdleTimeoutMs exceeds timer limit')
  if(source.defaultInput!==undefined&&(!Array.isArray(source.defaultInput)||!source.defaultInput.length))throw invalid(provider,'defaultInput must not be empty')
  result.defaultInput=input(provider,source.defaultInput,['text'])
  if(source.reasoning!==undefined&&!thinkingLevels.includes(source.reasoning))throw invalid(provider,'invalid reasoning level')
  for(const [key,choices]of Object.entries({cacheRetention:['none','short','long'],transport:['sse','websocket','websocket-cached','auto']}))if(source[key]!==undefined&&!choices.includes(source[key]))throw invalid(provider,`invalid ${key}`)
  for(const key of ['timeoutMs','websocketConnectTimeoutMs'])if(source[key]!==undefined&&(!Number.isSafeInteger(source[key])||source[key]<0))throw invalid(provider,`invalid ${key}`)
  if(source.thinkingBudgets!==undefined){if(!object(source.thinkingBudgets))throw invalid(provider,'thinkingBudgets must be object');for(const [level,value]of Object.entries(source.thinkingBudgets))if(!['minimal','low','medium','high'].includes(level)||!Number.isFinite(value))throw invalid(provider,`invalid thinkingBudgets.${level}`)}
  compatEntries(provider,source.compat)
  result.retrySettings=officialRetrySettings(source.retry).retry
  return result
}
function modelsFor(profile,{deferred}) {
  const {provider}=profile,baseProvider=catalog.get(provider),defaults=new Map((baseProvider?getBuiltinModels(provider):[]).map(m=>[m.id,m]))
  if(profile.models!==undefined&&!Array.isArray(profile.models))throw invalid(provider,'models must be array')
  if(profile.modelOverrides!==undefined&&!object(profile.modelOverrides))throw invalid(provider,'modelOverrides must be object')
  const overrides=profile.modelOverrides??{},errors=new Map(),caps=new Map()
  for(const [id,entry]of Object.entries(overrides)){
    if(!id||!object(entry)||'id'in entry||!defaults.size||profile.models?.length)throw invalid(provider,`invalid modelOverrides.${id}`)
    if(!defaults.has(id)){const error=invalid(provider,`unknown modelOverrides.${id}`);if(!deferred||error.code!=='INVALID_CONFIG')throw error;errors.set(id,error.message)}
  }
  const entries=profile.models?.length?profile.models:[...defaults.values()].map(m=>({id:m.id,...overrides[m.id]}))
  if(!entries.length)throw invalid(provider,'route resolves no models')
  const apis=new Set([...defaults.values()].map(m=>m.api)),shared=apis.size===1?[...apis][0]:undefined,seen=new Set(),models=[]
  for(const entry of entries)try{
    if(!object(entry)||typeof entry.id!=='string'||!entry.id||seen.has(entry.id))throw invalid(provider,'invalid or duplicate model id')
    seen.add(entry.id)
    if(entry.name!==undefined&&typeof entry.name!=='string')throw invalid(provider,`${entry.id}: name must be string`)
    const base=defaults.get(entry.id),api=profile.api??base?.api??shared,baseUrl=profile.baseURL??base?.baseUrl??baseProvider?.baseUrl
    if(api===undefined||baseUrl===undefined)throw invalid(provider,`${entry.id}: api and baseURL required`)
    const gate=gates.get(api)??[],compat=Object.fromEntries(compatEntries(provider,profile.compat).filter(([key])=>gate.includes(key)))
    for(const [key,value]of compatEntries(provider,entry.compat)){if(!gate.includes(key))throw invalid(provider,`${entry.id}: ${api} does not support compat.${key}`);compat[key]=value}
    const model={...structuredClone(base),id:entry.id,name:entry.name??base?.name??entry.id,api,provider,baseUrl,input:input(provider,entry.input,base?.input??profile.defaultInput),cost:base?.cost??{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:positive(provider,'contextWindow',entry.contextWindow??base?.contextWindow??profile.defaultContextWindow),maxTokens:positive(provider,'maxTokens',entry.maxTokens??base?.maxTokens??profile.defaultMaxTokens),...reasoning(provider,entry,base)}
    if(Object.keys(compat).length)model.compat={...(base?.api===api?base.compat:undefined),...compat}
    if(entry.maxTokens!==undefined)caps.set(entry.id,entry.maxTokens)
    models.push(model)
  }catch(error){if(!deferred||error.code!=='INVALID_CONFIG')throw error;errors.set(entry?.id??'',error.message)}
  const serviceable=models.filter(model=>!errors.has(model.id))
  for(const [key]of compatEntries(provider,profile.compat))if(!serviceable.some(model=>gates.get(model.api)?.includes(key)))throw invalid(provider,`compat.${key} is unused by this route`)
  return{models:serviceable,modelErrors:errors,configuredMaxTokens:caps,baseProvider}
}
export function resolvePiProfiles(providers,{deferred=false}={}) {
  if(!object(providers))throw invalid('', 'providers must be a dictionary')
  const result=new Map()
  for(const [id,source]of Object.entries(providers)){
    const profile=scalarProfile(id,source)
    try{Object.assign(profile,modelsFor(profile,{deferred}))}catch(error){if(!deferred||error.code!=='INVALID_CONFIG')throw error;Object.assign(profile,{models:[],modelErrors:new Map(),configuredMaxTokens:new Map(),baseProvider:catalog.get(id),catalogError:error.message})}
    result.set(id,profile)
  }
  return result
}
/** A provider definition, not a second model registry. Both runtime forms use
 * the same validated profile and official protocol implementation. */
export function configuredPiProvider(profile) {
  const base=profile.baseProvider,api=profile.api===undefined?undefined:protocols[profile.api]()
  const keyAuth={name:profile.displayName,resolve:async({credential})=>({auth:credential?.key===undefined?{}:{apiKey:credential.key},source:profile.displayName})}
  const auth=base?{...base.auth,...profile.apiKeyEnv&&!base.auth.apiKey?{apiKey:keyAuth}:{}}:{apiKey:keyAuth}
  const implementation=api??base
  if(!implementation)throw invalid(profile.provider,'no protocol implementation')
  return {id:profile.provider,name:profile.displayName,baseUrl:profile.baseURL??base?.baseUrl,auth,getModels:()=>profile.models,stream:(...args)=>implementation.stream(...args),streamSimple:(...args)=>implementation.streamSimple(...args)}
}
export function configuredPiModels(profiles,options) {
  const collection=builtinModels(options);collection.clearProviders()
  for(const profile of profiles.values())if(!profile.catalogError)collection.setProvider(configuredPiProvider(profile))
  return collection
}

/** 只导入选中模型的官方协议；不创建客户端、读取凭据或发送请求。 */
export async function preloadPiProtocols(profiles,selections){
 const apis=new Set()
 for(const selection of selections){
  const profile=profiles.get(selection?.provider)
  const model=profile?.models.find(model=>model.id===selection?.model)
  if(model&&!profile.catalogError&&!profile.modelErrors.has(model.id))apis.add(model.api)
 }
 for(const api of apis)await import(`@earendil-works/pi-ai/api/${api}`)
 return [...apis]
}
