#!/usr/bin/env node
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {open} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {loadConfig} from '../src/config.js'
import {runtimePaths,prepareRuntimePaths} from '../src/runtime/paths.js'
import {privateDirectory} from '../src/runtime/files.js'

const file=process.argv[2]
let log
try{
  if(!file)throw new Error('Usage: night-bot-run CONFIG')
  const config=await loadConfig(file),paths=runtimePaths(config);if(paths.mode!=='portable')throw new Error('NIGHT_NEW_INSTALL_LAYOUT_REQUIRED');await prepareRuntimePaths(paths)
  const temporary=paths.temp;await privateDirectory(temporary);await privateDirectory(paths.logs)
  log=await open(join(paths.logs,'service.log'),'a',0o600)
  const child=spawn(process.execPath,[fileURLToPath(new URL('./night-bot.js',import.meta.url)),resolve(file)],{cwd:paths.installRoot,env:{...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,XDG_CACHE_HOME:paths.cache,NIGHT_BOT_RUNTIME_TMPDIR:temporary},stdio:['inherit',log.fd,log.fd,'ipc']})
  const shutdown=()=>{if(child.connected)child.send({type:'night-bot-shutdown'})}
  const handlers=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,shutdown]))
  const onMessage=message=>{if(message?.type==='night-bot-shutdown')shutdown()}
  if(process.send)process.on('message',onMessage)
  for(const [signal,handler]of handlers)process.once(signal,handler)
  console.log('Night Bot log: '+join(paths.logs,'service.log'))
  const [code]=await once(child,'exit');for(const [signal,handler]of handlers)process.off(signal,handler);process.off('message',onMessage);if(process.connected)process.disconnect();process.exitCode=code??1
}catch(error){console.error(error.code??error.message);process.exitCode=1}finally{await log?.close()}
