#!/usr/bin/env node
import {checkMemoryMigration,applyMemoryMigration} from '../src/memory/layered-migration.js'
const args=process.argv.slice(2)
try{
  let root,apply=false,check=false
  for(let i=0;i<args.length;i++){
    const arg=args[i]
    if(arg==='--install-root'&&!root&&args[i+1]&&!args[i+1].startsWith('--'))root=args[++i]
    else if(arg==='--apply'&&!apply)apply=true
    else if(arg==='--check'&&!check)check=true
    else throw Object.assign(new Error('Usage: node scripts/migrate-memory.mjs --install-root <installation> [--check | --apply]'),{code:'MEMORY_MIGRATION_ARGUMENT_INVALID'})
  }
  if(!root||apply&&check)throw Object.assign(new Error('An explicit --install-root and either --check (default) or --apply are required.'),{code:'MEMORY_MIGRATION_ARGUMENT_INVALID'})
  const result=await (apply?applyMemoryMigration(root):checkMemoryMigration(root))
  process.stdout.write(JSON.stringify(result,null,2)+'\n')
  if(!result.ready)process.exitCode=2
}catch(error){process.stderr.write(JSON.stringify({ok:false,code:error.code??'MEMORY_MIGRATION_FAILED',message:error.message})+'\n');process.exitCode=1}
