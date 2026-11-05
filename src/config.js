import { readFile } from 'node:fs/promises'
import { resolve, isAbsolute, relative, sep } from 'node:path'

export async function loadConfig(path) {
  const config = JSON.parse(await readFile(path, 'utf8'))
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('NIGHT_BOT_CONFIG_INVALID')
  for (const key of ['stateDir','workspaceDir']) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) throw new Error('NIGHT_BOT_ABSOLUTE_PATH_REQUIRED:' + key)
    config[key] = resolve(config[key])
  }
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path) }
  if (inside(config.stateDir, config.workspaceDir) || inside(config.workspaceDir, config.stateDir)) throw new Error('NIGHT_BOT_STATE_MUST_BE_SEPARATE_FROM_WORKSPACE')
  if (!config.model?.provider || !config.model?.model) throw new Error('NIGHT_BOT_MODEL_REQUIRED')
  if (!config.providers?.[config.model.provider]) throw new Error('NIGHT_BOT_PROVIDER_PROFILE_REQUIRED')
  if (config.skillWatch !== undefined && typeof config.skillWatch !== 'boolean') throw new Error('NIGHT_BOT_SKILL_WATCH_INVALID')
  if (config.credentialsWatch !== undefined && typeof config.credentialsWatch !== 'boolean') throw new Error('NIGHT_BOT_CREDENTIALS_WATCH_INVALID')
  if (config.maxParallelToolCalls !== undefined && (!Number.isSafeInteger(config.maxParallelToolCalls) || config.maxParallelToolCalls < 1)) throw new Error('NIGHT_BOT_MAX_PARALLEL_TOOL_CALLS_INVALID')
  for(const key of ['web','webFetch'])if(config[key]!==undefined&&(!config[key]||typeof config[key]!=='object'||Array.isArray(config[key])))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  for(const key of ['searchProvider','fetchProvider'])if(config.web?.[key]!==undefined&&typeof config.web[key]!=='string')throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  for(const key of ['maxResponseBytes','maxBodyChars','timeoutMs'])if(config.webFetch?.[key]!==undefined&&(!Number.isFinite(config.webFetch[key])||config.webFetch[key]<=0||key==='timeoutMs'&&config.webFetch[key]>2147483647))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  if(config.webFetch?.maxRedirects!==undefined&&(!Number.isInteger(config.webFetch.maxRedirects)||config.webFetch.maxRedirects<0))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:maxRedirects')
  if(config.webFetch?.userAgent!==undefined&&typeof config.webFetch.userAgent!=='string')throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:userAgent')
  const resident = config.resident ?? {}
  if (resident.fakeModel) throw new Error('NIGHT_BOT_FAKE_MODEL_IS_TEST_ONLY')
  if (resident.host && !['127.0.0.1','::1','localhost'].includes(resident.host)) throw new Error('NIGHT_BOT_HTTP_REQUIRES_LOOPBACK')
  if (resident.dws?.writesAuthorized && !resident.dws?.enabled) throw new Error('NIGHT_BOT_DWS_WRITE_CONFIGURATION_INVALID')
  for (const profile of Object.values(config.providers)) {
    if ('apiKey' in profile || 'token' in profile || 'password' in profile) throw new Error('NIGHT_BOT_USE_CREDENTIAL_ENV_REFERENCE')
  }
  return config
}
