import {parseArgs} from 'node:util'
import {join} from 'node:path'
import {loadConfig,updateConfig,validateConfig as validateHostConfig} from '../../config.js'
import {runtimePaths} from '../../runtime/paths.js'
import {acquireLock,failure} from '../../runtime/files.js'
import {validateDingtalkInstance,dingtalkInstancesFromEnvironment} from './dingtalk-config.js'
import {openDingtalkIngress} from './dingtalk-storage.js'

export const dingtalkCliUsage='用法：night-bot-dingtalk CONFIG list | add --channel-id ID --json CONFIG_JSON [--enabled true|false] [--check] | set --channel-id ID --json PATCH_JSON [--check] | enable|disable --channel-id ID [--check] | env [--check]'
const view=row=>({channelId:row.channelId,enabled:row.enabled,name:row.config.dingtalk_name??row.channelId,conversationType:row.config.dingtalk_conversation_type,promptConfigured:!!row.config.dingtalk_prompt})
const parseJson=value=>{let parsed;try{parsed=JSON.parse(value)}catch{throw failure('DINGTALK_CLI_JSON_INVALID')}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw failure('DINGTALK_CLI_JSON_INVALID');return parsed}
function replaceRows(config,rows){
  config.channelPlugins??=[]
  for(const row of rows){
    validateDingtalkInstance(row)
    const existing=config.channelPlugins.find(value=>(value.channelId??value.type)===row.channelId)
    if(existing&&existing.type!=='dingtalk-dws')throw failure('DINGTALK_CHANNEL_ID_CONFLICT')
    if(existing)Object.assign(existing,row);else config.channelPlugins.push(row)
  }
  return config
}
export async function runDingtalkCli(argv,{environment=process.env,write=value=>console.log(value)}={}){
  const [file,command='list',...args]=argv
  if(file==='--help'||command==='--help'){write(dingtalkCliUsage);return}
  if(!file||!['list','add','set','enable','disable','env'].includes(command))throw failure('DINGTALK_CLI_ARGUMENT_INVALID')
  if(command==='list'){
    if(args.length)throw failure('DINGTALK_CLI_ARGUMENT_INVALID')
    write(JSON.stringify({channels:(await loadConfig(file)).channelPlugins?.filter(row=>row.type==='dingtalk-dws').map(view)??[]},null,2));return
  }
  const options={check:{type:'boolean'},...command!=='env'?{'channel-id':{type:'string'}}:{},...['add','set'].includes(command)?{json:{type:'string'}}:{},...command==='add'?{enabled:{type:'string'}}:{}}
  const {values}=parseArgs({args,options,strict:true,allowPositionals:false}),checkOnly=values.check===true
  const initial=await loadConfig(file),paths=runtimePaths(initial,file)
  if(paths.mode!=='portable')throw failure('DINGTALK_PORTABLE_LAYOUT_REQUIRED')
  const envRows=command==='env'?dingtalkInstancesFromEnvironment(environment):undefined
  if(command==='env'&&!envRows.length){write(JSON.stringify({ok:true,changed:false,checkOnly,restartRequired:false,channels:[]}));return}
  if(command!=='env'&&(typeof values['channel-id']!=='string'||!values['channel-id'].trim()))throw failure('DINGTALK_CHANNEL_ID_REQUIRED')
  const patch=['add','set'].includes(command)?parseJson(values.json):undefined
  if(command==='add'&&values.enabled!==undefined&&!['true','false'].includes(values.enabled))throw failure('DINGTALK_CLI_ENABLED_INVALID')
  const configuredAt=new Date().toISOString()
  let releaseHost,ingressChanged=false
  try{
    // 未提供在线控制入口时，必须离线持有 Host 锁；不把磁盘变化称为在线生效。
    if(!checkOnly)releaseHost=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0})
    const result=await updateConfig(file,async config=>{
      const rows=command==='env'?envRows:[(()=>{
        const existing=config.channelPlugins?.find(row=>(row.channelId??row.type)===values['channel-id'])
        if(command==='add'&&existing)throw failure('DINGTALK_CHANNEL_EXISTS')
        if(command!=='add'&&(!existing||existing.type!=='dingtalk-dws'))throw failure('DINGTALK_CHANNEL_NOT_FOUND')
        if(command==='add')return {type:'dingtalk-dws',channelId:values['channel-id'],enabled:values.enabled!=='false',config:patch}
        return {...existing,...['enable','disable'].includes(command)?{enabled:command==='enable'}:{},config:command==='set'?{...existing.config,...patch}:existing.config}
      })()]
      const existingIds=new Set((config.channelPlugins??[]).map(row=>row.channelId??row.type))
      replaceRows(config,rows)
      validateHostConfig(structuredClone(config),file)
      // 离线检查点先于配置提交；启用时由 Host 恢复，不能清掉停用期间的补拉下界。
      for(const row of rows){
        const fromAt=existingIds.has(row.channelId)?config.resident?.taskSessions?.ingressEpoch:configuredAt
        const ingress=await openDingtalkIngress(paths,row.channelId,{fromAt,checkOnly,storageKey:row.config.dingtalk_storage_key}),state=ingress.snapshot()
        await ingress.saveBridgeState({...state,paused:true,pausedAt:state.pausedAt??configuredAt})
        await ingress.drain()
        ingressChanged||=ingress.changed
      }
      return config
    },{checkOnly})
    write(JSON.stringify({ok:true,changed:result.changed||ingressChanged,checkOnly:result.checkOnly,restartRequired:result.restartRequired||ingressChanged,liveApplied:false,channels:result.config.channelPlugins.filter(row=>row.type==='dingtalk-dws').map(view)},null,2))
  }finally{await releaseHost?.()}
}
