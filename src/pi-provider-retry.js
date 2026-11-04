const defaults={initialDelayMs:500,maxDelayMs:10000,jitterRatio:0.1}
const codes=['EMPTY_RESPONSE','RATE_LIMIT','SERVER','TIMEOUT','TRANSPORT']
const fail=message=>{throw Object.assign(new Error('Pi retry policy: '+message),{code:'INVALID_CONFIG'})}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
export function resolvePiRetryPolicy(config) {
  if(config!==undefined&&(!record(config)||!['normal','always'].includes(config.mode)))fail('mode must be normal or always')
  config??={mode:'normal'}
  for(const key of Object.keys(config))if(!['mode','maxRetries','retryableCodes','backoff'].includes(key))fail('unknown '+key)
  const backoff=config.backoff??{}
  if(!record(backoff))fail('backoff must be an object')
  for(const key of Object.keys(backoff))if(!(key in defaults))fail('unknown backoff.'+key)
  const resolved={...defaults,...backoff}
  for(const key of ['initialDelayMs','maxDelayMs'])if(!Number.isFinite(resolved[key])||resolved[key]<=0||resolved[key]>2147483647)fail('invalid '+key)
  if(resolved.initialDelayMs>resolved.maxDelayMs)fail('initialDelayMs exceeds maxDelayMs')
  if(!Number.isFinite(resolved.jitterRatio)||resolved.jitterRatio<0||resolved.jitterRatio>1)fail('invalid jitterRatio')
  if(config.mode==='always')return Object.freeze({mode:'always',...resolved})
  const maxRetries=config.maxRetries??5,retryableCodes=config.retryableCodes??codes
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0)fail('invalid maxRetries')
  if(!Array.isArray(retryableCodes)||!retryableCodes.length||retryableCodes.some(code=>typeof code!=='string'||!code)||new Set(retryableCodes).size!==retryableCodes.length)fail('invalid retryableCodes')
  return Object.freeze({mode:'normal',maxRetries,retryableCodes:Object.freeze([...retryableCodes]),...resolved})
}
