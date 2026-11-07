#!/usr/bin/env node
import {parseArgs} from 'node:util'
import {isAbsolute} from 'node:path'
import {loadConfig} from '../src/config.js'
import {inspectResidentRouterUpgrade,executeResidentRouterUpgrade} from '../src/runtime/resident-router-upgrade.js'
try{
  const {values}=parseArgs({options:{check:{type:'boolean'},execute:{type:'boolean'},config:{type:'string'},backup:{type:'string'},'expected-digest':{type:'string'}}})
  if(values.check===values.execute||!isAbsolute(values.config??''))throw Error('用法: node scripts/migrate-resident-router.mjs --check|--execute --config <absolute-config> [--backup <offline-backup> --expected-digest <check-digest>]')
  const config=await loadConfig(values.config)
  const result=values.execute?await executeResidentRouterUpgrade(config,{backup:values.backup,expectedDigest:values['expected-digest']}):await inspectResidentRouterUpgrade(config)
  console.log(JSON.stringify(result,null,2))
  if(!result.ready)process.exitCode=1
}catch(error){console.error(error.code??error.message);process.exitCode=1}
