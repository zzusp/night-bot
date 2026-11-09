import {readdir,readFile,realpath} from 'node:fs/promises'
import {resolve,join,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {inside} from '../runtime/paths.js'

const builtin=new URL('./plugins/dingtalk-dws.js',import.meta.url).href
const invalid=code=>{throw new Error('NIGHT_CHANNEL_PLUGIN_'+code)}
/** Installed channel code is trusted host code. Discovery never executes it;
 * only explicitly enabled instances are loaded by the host lifecycle. */
export async function discoverChannelPlugins(config,paths){
  const definitions=new Map([['dingtalk-dws',{entry:builtin}]])
  if(config.channelPluginDirs!==undefined&&!Array.isArray(config.channelPluginDirs))invalid('DIRECTORY_INVALID')
  for(const directory of config.channelPluginDirs??[]){
    if(typeof directory!=='string'||!directory)invalid('DIRECTORY_INVALID')
    const root=await realpath(resolve(paths.installRoot,directory))
    for(const item of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(!item.isDirectory())continue
      const base=join(root,item.name),file=join(base,'night-channel.json')
      let manifest;try{manifest=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code==='ENOENT')continue;throw error}
      if(manifest.apiVersion!==1||!/^[-a-z0-9]+$/.test(manifest.type??'')||typeof manifest.entry!=='string'||isAbsolute(manifest.entry)||!manifest.entry)invalid('MANIFEST_INVALID')
      if(definitions.has(manifest.type))invalid('TYPE_DUPLICATE')
      const entry=await realpath(resolve(base,manifest.entry))
      if(!inside(await realpath(base),entry))invalid('ENTRY_OUTSIDE_PACKAGE')
      definitions.set(manifest.type,{entry:pathToFileURL(entry).href,displayName:manifest.displayName,webConfig:manifest.webConfig})
    }
  }
  return definitions
}
export async function channelPluginRows(config,paths){
  const definitions=await discoverChannelPlugins(config,paths)
  const rows=[],ids=new Set()
  for(const instance of config.channelPlugins??[]){
    if(!instance||typeof instance.type!=='string'||typeof instance.enabled!=='boolean')invalid('CONFIG_INVALID')
    if(!instance.enabled)continue
    const definition=definitions.get(instance.type);if(!definition)invalid('UNKNOWN')
    const channelId=instance.channelId??instance.config?.channelId??instance.type
    if(typeof channelId!=='string'||!channelId||channelId.length>128||ids.has(channelId))invalid('ID_INVALID_OR_DUPLICATE')
    ids.add(channelId)
    const plugin=await import(definition.entry)
    if(plugin.validateConfig!==undefined&&typeof plugin.validateConfig!=='function')invalid('VALIDATOR_INVALID')
    const normalized=plugin.validateConfig?plugin.validateConfig(instance.config??{}):instance.config??{}
    if(!normalized||typeof normalized!=='object'||Array.isArray(normalized)||typeof normalized.then==='function')invalid('CONFIG_INVALID')
    rows.push({name:definition.entry,config:{...normalized,enabled:true,channelId}})
  }
  return rows
}
