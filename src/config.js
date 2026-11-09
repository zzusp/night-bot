import {assertPiTaskBackendConfiguration} from './runtime/pi-task-backend.js'
import {validatePiFileSourceConfig} from './runtime/pi-file-tool-config.js'
import { readFile,realpath } from 'node:fs/promises'
import { resolve, isAbsolute, relative, sep } from 'node:path'
import {runtimePaths,inside} from './runtime/paths.js'
import {readRegular,atomicWrite,withLock,failure} from './runtime/files.js'

const configFiles=new WeakMap()
export const configFileOf=config=>configFiles.get(config)
export async function loadConfig(path) {
  const config=validateConfig(JSON.parse(await readFile(path, 'utf8')),path)
  configFiles.set(config,resolve(path));return config
}

export function validateConfig(config,path) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('NIGHT_BOT_CONFIG_INVALID')
  assertPiTaskBackendConfiguration(config)
  if(config.permissionMode!==undefined&&!['ask','auto','full'].includes(config.permissionMode))throw failure('NIGHT_BOT_PERMISSION_MODE_INVALID')
  const paths=runtimePaths(config,path)
  if(paths.mode==='portable')Object.assign(config,{installRoot:paths.installRoot,dataDir:paths.data,stateDir:paths.state,workspaceDir:paths.workspaces})
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
  validatePiFileSourceConfig(config.fileTools)
  if (config.maxParallelToolCalls !== undefined && (!Number.isSafeInteger(config.maxParallelToolCalls) || config.maxParallelToolCalls < 1)) throw new Error('NIGHT_BOT_MAX_PARALLEL_TOOL_CALLS_INVALID')
  for(const key of ['web','webFetch','webTools'])if(config[key]!==undefined&&(!config[key]||typeof config[key]!=='object'||Array.isArray(config[key])))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  for(const key of ['searchProvider','fetchProvider'])if(config.web?.[key]!==undefined&&typeof config.web[key]!=='string')throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  for(const key of ['maxResponseBytes','maxBodyChars','timeoutMs'])if(config.webFetch?.[key]!==undefined&&(!Number.isFinite(config.webFetch[key])||config.webFetch[key]<=0||key==='timeoutMs'&&config.webFetch[key]>2147483647))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  if(config.webFetch?.maxRedirects!==undefined&&(!Number.isInteger(config.webFetch.maxRedirects)||config.webFetch.maxRedirects<0))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:maxRedirects')
  if(config.webFetch?.userAgent!==undefined&&typeof config.webFetch.userAgent!=='string')throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:userAgent')
  for(const key of ['search','fetch'])if(config.webTools?.[key]!==undefined&&typeof config.webTools[key]!=='boolean')throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  for(const key of ['searchMaxResults','searchMaxQueries','fetchTimeoutMs','searchTimeoutMs','fetchMaxOutputChars'])if(config.webTools?.[key]!==undefined&&(!Number.isInteger(config.webTools[key])||config.webTools[key]<1||(key==='fetchTimeoutMs'||key==='searchTimeoutMs')&&config.webTools[key]>2147483647))throw new Error('NIGHT_BOT_WEB_CONFIG_INVALID:'+key)
  const resident = config.resident ?? {}
  if(!resident||typeof resident!=='object'||Array.isArray(resident))throw failure('NIGHT_BOT_RESIDENT_CONFIG_INVALID')
  const residentKeys=new Set(['host','port','groups','taskSessions','maxConcurrentTasks','fakeModel'])
  for(const key of Object.keys(resident))if(!residentKeys.has(key))throw failure('NIGHT_BOT_RESIDENT_CONFIG_UNSUPPORTED:'+key)
  if(resident.port!==undefined&&(!Number.isInteger(resident.port)||resident.port<0||resident.port>65535))throw failure('NIGHT_BOT_HTTP_PORT_INVALID')
  if (resident.fakeModel) throw new Error('NIGHT_BOT_FAKE_MODEL_IS_TEST_ONLY')
  if (resident.host && !['127.0.0.1','::1','localhost'].includes(resident.host)) throw new Error('NIGHT_BOT_HTTP_REQUIRES_LOOPBACK')
  for (const profile of Object.values(config.providers)) {
    if ('apiKey' in profile || 'token' in profile || 'password' in profile) throw new Error('NIGHT_BOT_USE_CREDENTIAL_ENV_REFERENCE')
  }
  const validateSecrets=value=>{
    if(!value||typeof value!=='object')return
    for(const [name,item]of Object.entries(value)){
      if(typeof item==='string'&&item&&/^(?:apiKey|token|accessToken|refreshToken|password|privateKey|clientSecret|authorization|cookie)$/i.test(name))throw new Error('NIGHT_BOT_USE_CREDENTIAL_REFERENCE')
      if(typeof item==='string')try{const url=new URL(item);if(url.username||url.password||[...url.searchParams.keys()].some(key=>/^(?:token|password|secret|api[_-]?key|access[_-]?token)$/i.test(key)))throw new Error('NIGHT_BOT_USE_CREDENTIAL_REFERENCE')}catch(error){if(error.message==='NIGHT_BOT_USE_CREDENTIAL_REFERENCE')throw error}
      validateSecrets(item)
    }
  }
  if(config.channelPlugins!==undefined&&(!Array.isArray(config.channelPlugins)||config.channelPlugins.some(plugin=>!plugin||typeof plugin.type!=='string'||typeof plugin.enabled!=='boolean')))throw new Error('NIGHT_CHANNEL_PLUGINS_INVALID')
  if(config.channelPluginDirs!==undefined&&(!Array.isArray(config.channelPluginDirs)||config.channelPluginDirs.some(path=>typeof path!=='string'||!path)))throw new Error('NIGHT_CHANNEL_PLUGIN_DIRECTORIES_INVALID')
  validateSecrets(config)
  return config
}

// 配置保存与运行态分离；--check 不创建锁或临时文件。
export async function updateConfig(path,update,{checkOnly=false}={}) {
  const file=resolve(path),initial=await readRegular(file)
  if(initial===undefined)throw failure('NIGHT_BOT_CONFIG_NOT_FOUND')
  const paths=runtimePaths(JSON.parse(initial),file)
  const assertPath=async()=>{
    if(paths.mode!=='portable'||!inside(paths.config,file)||relative(paths.config,await realpath(paths.config))!==''||relative(file,await realpath(file))!=='')throw failure('NIGHT_BOT_CONFIG_PATH_UNSAFE')
  }
  await assertPath()
  const save=async()=>{
    await assertPath()
    const previous=await readRegular(file)
    if(previous===undefined)throw failure('NIGHT_BOT_CONFIG_NOT_FOUND')
    const current=JSON.parse(previous),next=await update(structuredClone(current))
    validateConfig(structuredClone(next),file)
    const after=runtimePaths(next,file)
    if(after.installRoot!==paths.installRoot||after.data!==paths.data)throw failure('NIGHT_BOT_CONFIG_RELOCATION_REQUIRES_OFFLINE_RESTORE')
    const changed=JSON.stringify(current)!==JSON.stringify(next)
    if(changed&&!checkOnly){
      await assertPath()
      if(await readRegular(file)!==previous)throw failure('NIGHT_BOT_CONFIG_CHANGED')
      await atomicWrite(file,JSON.stringify(next,null,2)+'\n')
    }
    return {config:next,changed,checkOnly,restartRequired:changed}
  }
  return checkOnly?save():withLock(resolve(paths.config,'.configuration.lock'),save)
}
