#!/usr/bin/env node
import {loadConfig} from '../src/config.js'
import {pathInventory} from '../src/runtime/paths.js'
import {backupData,restoreData} from '../src/runtime/backup.js'
const [file,command='paths',destination,...options]=process.argv.slice(2)
try{
  if(!file||!['paths','backup','restore'].includes(command)||options.some(option=>option!=='--include-secrets')||command!=='paths'&&!destination)throw new Error('Usage: night-bot-data CONFIG paths | backup DEST [--include-secrets] | restore BACKUP')
  const config=await loadConfig(file)
  console.log(JSON.stringify(command==='paths'?pathInventory(config,file):command==='backup'?await backupData(config,destination,{includeSecrets:options.includes('--include-secrets')}):await restoreData(config,destination),null,2))
}catch(error){console.error(error.code??error.message);process.exitCode=1}
