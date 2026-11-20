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

// Budgets never enlarge the actual model window. Pi owns compaction/projection.
export const ROUTER_CONTEXT_TOKENS = 472_000
export const TRIAGE_CONTEXT_TOKENS = 500_000
export const CONVERSATION_BACKGROUND_RATIO = 0.6
export const CONVERSATION_FOREGROUND_RATIO = 0.8

/** outputReserveTokens is the actual request output allowance, not the model's
 * advertised maximum. Small windows preserve Pi's native reserve. */
export function officialConversationContextBudget(model, role = 'CONVERSATION', {outputReserveTokens} = {}) {
 const defaults = SettingsManager.inMemory().getCompactionSettings(model)
 if (!model || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= defaults.reserveTokens ||
     typeof model.provider !== 'string' || !model.provider || typeof model.id !== 'string' || !model.id) {
  fail(`PI_${role}_CONTEXT_WINDOW_INVALID`, `${role} requires a model with a valid context window larger than Pi reserve tokens`)
 }
 if (outputReserveTokens !== undefined && (!Number.isSafeInteger(outputReserveTokens) || outputReserveTokens < 0)) fail(`PI_${role}_OUTPUT_RESERVE_INVALID`, 'Output reserve must be a nonnegative integer')
 const targetTokens = role === 'TRIAGE' ? TRIAGE_CONTEXT_TOKENS : ROUTER_CONTEXT_TOKENS
 const budgetTokens = Math.min(targetTokens, model.contextWindow)
 const outputHeadroomTokens = Math.max(defaults.reserveTokens, outputReserveTokens ?? 0)
 if (outputHeadroomTokens >= budgetTokens) fail(`PI_${role}_OUTPUT_RESERVE_INVALID`, 'Output reserve must be smaller than the effective context budget')
 const foregroundTokens = Math.min(Math.floor(budgetTokens * CONVERSATION_FOREGROUND_RATIO), budgetTokens - outputHeadroomTokens)
 const backgroundTokens = Math.min(Math.floor(budgetTokens * CONVERSATION_BACKGROUND_RATIO), Math.floor(foregroundTokens * CONVERSATION_BACKGROUND_RATIO / CONVERSATION_FOREGROUND_RATIO))
 return Object.freeze({targetTokens, budgetTokens, backgroundTokens, foregroundTokens, outputHeadroomTokens,
  reserveTokens: model.contextWindow - foregroundTokens,
  keepRecentTokens: Math.min(defaults.keepRecentTokens, Math.floor(foregroundTokens / 2)),
 })
}
export const officialRouterCompactionSettings = (model, options) => officialConversationCompactionSettings(model, 'ROUTER', options)
export const officialTriageCompactionSettings = (model, options) => officialConversationCompactionSettings(model, 'TRIAGE', options)
function officialConversationCompactionSettings(model, role, options) {
 const {reserveTokens, keepRecentTokens} = officialConversationContextBudget(model, role, options)
 return {enabled: true, modelOverrides: {[`${model.provider}/${model.id}`]: {reserveTokens, keepRecentTokens}}}
}
