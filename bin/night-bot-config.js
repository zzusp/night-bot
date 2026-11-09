#!/usr/bin/env node
import {parseArgs} from 'node:util'
import {join} from 'node:path'
import {failure} from '../src/runtime/files.js'
import {loadConfig,updateConfig} from '../src/config.js'
import {packageRoot} from '../src/runtime/paths.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {webListenOptions} from '../packages/web-console/server/security.js'

const usage='用法：night-bot-config CONFIG show | model [--provider ID --model NAME --base-url URL --api API --key-env ENV] [--check] | permissions --permission-mode ask|auto|full [--check] | web --enabled true|false [--host 127.0.0.1|0.0.0.0 --public-origin http://127.0.0.1:PORT --port N --channel-id ID --sender-id ACTOR --operator-name NAME] [--check]'
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value)
const view=config=>({permissionMode:config.permissionMode??'ask',model:config.model,providers:Object.fromEntries(Object.entries(config.providers??{}).map(([id,value])=>[id,Object.fromEntries(['api','baseURL','apiKeyEnv'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))])),web:(config.channelPlugins??[]).filter(row=>row.type==='web-console').map(row=>({channelId:row.channelId,enabled:row.enabled,host:row.config?.host??'127.0.0.1',port:row.config?.port??3080,publicOrigin:row.config?.publicOrigin,operatorName:row.config?.operatorName}))})
try{
  const [file,command='show',...args]=process.argv.slice(2)
  if(!file||!['show','model','web','permissions'].includes(command))throw failure(usage)
  if(command==='show'){
    if(args.length)throw failure(usage)
    console.log(JSON.stringify(view(await loadConfig(file)),null,2))
  }else{
    const names=command==='permissions'?['permission-mode']:command==='model'?['provider','model','base-url','api','key-env']:['enabled','host','port','public-origin','channel-id','sender-id','operator-name']
    const {values}=parseArgs({args,options:{...Object.fromEntries(names.map(key=>[key,{type:'string'}])),check:{type:'boolean'}},strict:true,allowPositionals:false})
    const result=await updateConfig(file,config=>{
      if(command==='permissions'){
        if(!['ask','auto','full'].includes(values['permission-mode']))throw failure('NIGHT_BOT_PERMISSION_MODE_INVALID')
        config.permissionMode=values['permission-mode']
      }else if(command==='model'){
        const provider=values.provider??config.model?.provider,model=values.model??config.model?.model
        if(typeof provider!=='string'||!provider.trim()||typeof model!=='string'||!model.trim())throw failure('NIGHT_BOT_MODEL_REQUIRED')
        const profile={...config.providers?.[provider]}
        if(values['base-url']!==undefined){const url=new URL(values['base-url']);if(!['http:','https:'].includes(url.protocol))throw failure('NIGHT_BOT_MODEL_URL_INVALID');profile.baseURL=values['base-url']}
        if(values.api!==undefined)profile.api=values.api
        if(values['key-env']!==undefined)profile.apiKeyEnv=values['key-env']
        if(!config.providers?.[provider]&&!profile.apiKeyEnv)throw failure('NIGHT_BOT_PROVIDER_PROFILE_REQUIRED')
        if(profile.baseURL&&profile.api&&!profile.models?.some(row=>row.id===model))profile.models=[...(profile.models??[]),{id:model}]
        const selected=resolvePiProfiles({[provider]:profile}).get(provider)
        if(!selected.models.some(row=>row.id===model))throw failure('NIGHT_BOT_MODEL_NOT_CONFIGURED')
        config.providers={...config.providers,[provider]:profile};config.model={...config.model,provider,model}
      }else{
        if(!['true','false'].includes(values.enabled))throw failure('NIGHT_BOT_WEB_ENABLED_REQUIRED')
        const channelId=values['channel-id']??'web-console'
        if(!identifier(channelId))throw failure('NIGHT_BOT_WEB_CHANNEL_INVALID')
        config.channelPlugins??=[]
        const existing=config.channelPlugins.find(row=>(row.channelId??row.type)===channelId)
        if(existing&&existing.type!=='web-console')throw failure('NIGHT_BOT_CHANNEL_ID_CONFLICT')
        const current=existing?.config??{},senderId=values['sender-id']??current.senderId??config.resident?.taskSessions?.webActorId
        if(!identifier(senderId))throw failure('NIGHT_BOT_WEB_SENDER_REQUIRED')
        if(current.senderId&&current.senderId!==senderId)throw failure('NIGHT_BOT_WEB_IDENTITY_REQUIRES_NEW_CHANNEL')
        const port=values.port===undefined?current.port??3080:/^\d+$/.test(values.port)?Number(values.port):NaN
        if(!Number.isSafeInteger(port)||port<0||port>65535)throw failure('NIGHT_BOT_HTTP_PORT_INVALID')
        const operatorName=values['operator-name']??current.operatorName
        if(operatorName!==undefined&&(typeof operatorName!=='string'||!operatorName.trim()||operatorName.length>80))throw failure('NIGHT_BOT_WEB_OPERATOR_NAME_INVALID')
        const host=values.host??current.host??'127.0.0.1',publicOrigin=values['public-origin']??current.publicOrigin
        const web={...current,host,port,senderId,...(publicOrigin!==undefined?{publicOrigin}:{}),...(operatorName!==undefined?{operatorName}:{})}
        webListenOptions(web)
        const row={type:'web-console',channelId,enabled:values.enabled==='true',config:web}
        if(existing)Object.assign(existing,row);else config.channelPlugins.push(row)
        config.channelPluginDirs=[...new Set([...(config.channelPluginDirs??[]),join(packageRoot,'packages')])]
      }
      return config
    },{checkOnly:values.check===true})
    const {config,...state}=result
    console.log(JSON.stringify({...state,...view(config)},null,2))
  }
}catch(error){console.error(error.code??error.message);process.exitCode=1}
