#!/usr/bin/env node
import {readFile} from 'node:fs/promises'
import {loadConfig} from '../src/config.js'
import {inspectNativeJob,reconcileNativeJob} from '../src/tasks/job-reconciliation.js'
const [configFile,command,...args]=process.argv.slice(2)
try{
 if(configFile==='--help'){console.log('Usage: night-bot-jobs CONFIG inspect TASK_ID JOB_ID | close PROPOSAL.json NOTE.json [--check]\nOffline operator closure only. It never runs a model/producer, declares success, changes task drain or ACKs input. Inspect and --check do not write. Stop the Host before close/check. The old invocation remains noReplay.')}
 else{
  if(!configFile||!['inspect','close'].includes(command)||args.length<2||args.length>3||args.length===3&&(command!=='close'||args[2]!=='--check'))throw Error('NIGHT_JOB_OPERATOR_ARGUMENT_INVALID')
  const config=await loadConfig(configFile),result=command==='inspect'?await inspectNativeJob(config,args[0],args[1]):await reconcileNativeJob(config,JSON.parse(await readFile(args[0],'utf8')),JSON.parse(await readFile(args[1],'utf8')),{check:args[2]==='--check'})
  console.log(JSON.stringify(result))
 }
}catch(error){console.error(typeof error.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'NIGHT_JOB_OPERATOR_FAILED');process.exitCode=1}
