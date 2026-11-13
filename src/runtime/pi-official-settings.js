import {SettingsManager} from '@earendil-works/pi-coding-agent'
const fail=(code,message)=>{throw Object.assign(new TypeError(message),{code})}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const defined=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined))
const timer=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647
/** Explicit Pi-native retry configuration, with defaults read through Pi's
 * public SettingsManager. No Night code classifier, jitter or retry loop. */
export function officialRetrySettings(input) {
 if(input!==undefined&&!record(input))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Pi retry settings must be an object')
 input??={}
 if(['mode','retryableCodes','backoff','initialDelayMs','jitterRatio','maxDelayMs'].some(key=>Object.hasOwn(input,key)))fail('PI_RETRY_SETTINGS_MIGRATION_REQUIRED','Legacy retry policy is unsupported; configure Pi retry enabled/maxRetries/baseDelayMs/maxAgentDelayMs/provider settings')
 if(Object.keys(input).some(key=>!['enabled','maxRetries','baseDelayMs','maxAgentDelayMs','provider'].includes(key)))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Unknown Pi retry setting')
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Pi retry enabled must be boolean')
 if(input.maxRetries!==undefined&&(!Number.isSafeInteger(input.maxRetries)||input.maxRetries<0))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Pi retry maxRetries must be a finite nonnegative integer')
 for(const key of ['baseDelayMs','maxAgentDelayMs'])if(input[key]!==undefined&&(!timer(input[key])||input[key]===0))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Pi retry delay must be a positive bounded integer')
 if(input.provider!==undefined&&!record(input.provider))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Pi provider retry settings must be an object')
 const provider=input.provider??{}
 if(Object.keys(provider).some(key=>!['timeoutMs','maxRetries','maxRetryDelayMs'].includes(key)))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Unknown Pi provider retry setting')
 for(const [key,value]of Object.entries(provider))if(key==='maxRetries'?(!Number.isSafeInteger(value)||value<0):!timer(value))fail('PI_OFFICIAL_RETRY_SETTINGS_INVALID','Pi provider retry values must be bounded nonnegative integers')
 const defaults=SettingsManager.inMemory()
 return Object.freeze({retry:Object.freeze({...defaults.getRetrySettings(),...input,provider:Object.freeze({...defined(defaults.getProviderRetrySettings()),...provider})})})
}

// Router's operational budget is independent of the provider's real model
// window. Pi owns threshold checks, summarization, recent-tail retention and
// journal projection. This is not a hard input/output limit.
export const ROUTER_CONTEXT_TOKENS = 256 * 1024
export function officialRouterCompactionSettings(model) {
 const defaults = SettingsManager.inMemory().getCompactionSettings(model)
 if (!model || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= defaults.reserveTokens ||
     typeof model.provider !== 'string' || !model.provider || typeof model.id !== 'string' || !model.id) {
  fail('PI_ROUTER_CONTEXT_WINDOW_INVALID', 'Router requires a model with a valid context window larger than Pi reserve tokens')
 }
 const budget = Math.min(ROUTER_CONTEXT_TOKENS, model.contextWindow)
 // Model-keyed settings cannot accidentally apply a large-window reserve to a
 // smaller model. A newly resolved create/resume route gets its own override.
 return {enabled: true, modelOverrides: {[`${model.provider}/${model.id}`]: {
  reserveTokens: model.contextWindow - budget + defaults.reserveTokens,
  keepRecentTokens: Math.min(defaults.keepRecentTokens, Math.floor((budget - defaults.reserveTokens) / 2)),
 }}}
}
