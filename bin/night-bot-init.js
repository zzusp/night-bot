#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {validateConfig} from '../src/config.js'
import {resolvePiProfiles} from '../src/pi-provider-catalog.js'
import {runtimePaths,prepareRuntimePaths,packageRoot} from '../src/runtime/paths.js'
const args=process.argv.slice(2),options={}
try{
  if(args.length%2)throw new Error('Usage: night-bot-init --actor YOUR_ID [--root INSTALL_ROOT] [--provider NAME] [--model NAME] [--key-env ENV_NAME] [--base-url URL] [--api API] [--permission-mode ask|auto|full]')
  for(let i=0;i<args.length;i+=2){if(!['--actor','--root','--provider','--model','--key-env','--base-url','--api','--permission-mode'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('NIGHT_INIT_OPTIONS_INVALID');options[args[i]]=args[i+1]}
  if(!options['--actor']||options['--actor'].length>256)throw new Error('NIGHT_INIT_ACTOR_REQUIRED')
  const root=resolve(options['--root']??packageRoot),config=JSON.parse(await readFile(new URL('../config.example.json',import.meta.url),'utf8'))
  const provider=options['--provider']??config.model.provider,model=options['--model']??config.model.model
  config.permissionMode=options['--permission-mode']??'ask'
  if(!['ask','auto','full'].includes(config.permissionMode))throw new Error('NIGHT_BOT_PERMISSION_MODE_INVALID')
  config.installRoot='../..';config.model={provider,model};config.providers={[provider]:{apiKeyEnv:options['--key-env']??'OPENAI_API_KEY'}}
  const profile=config.providers[provider]
  if(options['--base-url']){const url=new URL(options['--base-url']);if(!['http:','https:'].includes(url.protocol))throw new Error('NIGHT_INIT_BASE_URL_INVALID');profile.baseURL=options['--base-url']}
  if(options['--api'])profile.api=options['--api']
  if(profile.baseURL||profile.api)profile.models=[{id:model}]
  resolvePiProfiles(config.providers)
  config.shell=process.platform==='win32'?'pwsh':'bash';config.resident.taskSessions={...config.resident.taskSessions,instanceId:'night-'+randomUUID(),ownerActorId:options['--actor'],webActorId:options['--actor'],ingressEpoch:new Date().toISOString()}
  const paths=runtimePaths({installRoot:root,dataDir:'data'}),file=join(paths.config,'config.json')
  validateConfig(structuredClone(config),file);await prepareRuntimePaths(paths)
  await writeFile(file,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
  console.log(JSON.stringify({ok:true,config:file,next:'Review model/provider configuration and set the referenced credential environment variable, then run pnpm start '+file,channelWritesEnabled:false}))
}catch(error){console.error(error.code??error.message);process.exitCode=1}
