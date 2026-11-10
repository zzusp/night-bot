#!/usr/bin/env node
import {parseArgs} from 'node:util'
import {failure} from '../src/runtime/files.js'
import {loadConfig} from '../src/config.js'
import {saveRoleModelConfiguration,saveModelConfiguration} from '../src/settings/model-configuration.js'
import {saveWebConfiguration} from '../src/settings/web-configuration.js'
import {savePermissionConfiguration} from '../src/settings/configuration.js'
import {savedWorkLogConfig} from '../src/work-log/config.js'
import {saveWorkLogConfiguration} from '../src/settings/work-log-configuration.js'
import {safeSettingsError} from '../src/settings/http.js'

const usage='用法：night-bot-config CONFIG show | role-model --role triage|router|task [--provider ID --model NAME --reasoning-effort off|minimal|low|medium|high|xhigh|max|model-default] [--check] | model [--provider ID --model NAME --base-url URL --api API --key-env ENV] [--check] | permissions --permission-mode ask|auto|full [--check] | work-log [--enabled true|false --time HH:mm --timezone local|IANA] [--check] | web --enabled true|false [--host 127.0.0.1|0.0.0.0 --public-origin http://127.0.0.1:PORT --port N --channel-id ID --sender-id ACTOR --operator-name NAME] [--check]'
const view=config=>({workLog:savedWorkLogConfig(config),permissionMode:config.permissionMode??'full',model:Object.fromEntries(['provider','model','reasoningEffort'].filter(key=>config.model?.[key]!==undefined).map(key=>[key,config.model[key]])),roleModels:config.roleModels??{},providers:Object.fromEntries(Object.entries(config.providers??{}).map(([id,value])=>[id,Object.fromEntries(['api','baseURL','apiKeyEnv'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))])),web:(config.channelPlugins??[]).filter(row=>row.type==='web-console').map(row=>({channelId:row.channelId,enabled:row.enabled,host:row.config?.host??'127.0.0.1',port:row.config?.port??3080,publicOrigin:row.config?.publicOrigin,operatorName:row.config?.operatorName}))})
try{
  const [file,command='show',...args]=process.argv.slice(2)
  if(!file||!['show','model','role-model','web','permissions','work-log'].includes(command))throw failure(usage)
  if(command==='show'){
    if(args.length)throw failure(usage)
    console.log(JSON.stringify(view(await loadConfig(file)),null,2))
  }else{
    const names=command==='work-log'?['enabled','time','timezone']:command==='permissions'?['permission-mode']:command==='role-model'?['role','provider','model','reasoning-effort']:command==='model'?['provider','model','base-url','api','key-env']:['enabled','host','port','public-origin','channel-id','sender-id','operator-name']
    const {values}=parseArgs({args,options:{...Object.fromEntries(names.map(key=>[key,{type:'string'}])),check:{type:'boolean'}},strict:true,allowPositionals:false})
    const checkOnly=values.check===true
    let result
    if(command==='work-log'){
      if(values.enabled!==undefined&&!['true','false'].includes(values.enabled))throw failure('NIGHT_BOT_WORK_LOG_ENABLED_INVALID')
      result=await saveWorkLogConfiguration(file,{enabled:values.enabled===undefined?undefined:values.enabled==='true',time:values.time,timezone:values.timezone,checkOnly})
    }
    else if(command==='role-model')result=await saveRoleModelConfiguration(file,{role:values.role,provider:values.provider,model:values.model,reasoningEffort:values['reasoning-effort'],checkOnly})
    else if(command==='model')result=await saveModelConfiguration(file,{provider:values.provider,model:values.model,baseURL:values['base-url'],api:values.api,apiKeyEnv:values['key-env'],checkOnly})
    else if(command==='permissions')result=await savePermissionConfiguration(file,{mode:values['permission-mode'],checkOnly})
    else{
      if(!['true','false'].includes(values.enabled))throw failure('NIGHT_BOT_WEB_ENABLED_REQUIRED')
      const port=values.port===undefined?undefined:/^\d+$/.test(values.port)?Number(values.port):NaN
      result=await saveWebConfiguration(file,{enabled:values.enabled==='true',host:values.host,port,publicOrigin:values['public-origin'],channelId:values['channel-id'],senderId:values['sender-id'],operatorName:values['operator-name'],checkOnly})
    }
    const {config,...state}=result
    console.log(JSON.stringify({...state,...view(config)},null,2))
  }
}catch(error){console.error(error.message===usage?usage:safeSettingsError(error));process.exitCode=1}
