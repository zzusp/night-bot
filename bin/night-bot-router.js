#!/usr/bin/env node
import {loadConfig} from '../src/config.js'
import {runRouterOperatorCli} from '../src/channels/router-operator.js'
const [configPath,...args]=process.argv.slice(2)
if(configPath==='--help'||args.includes('--help')){
 console.log('Usage: night-bot-router.js CONFIG inspect CONVERSATION_ID | CONFIG resume --proposal PROPOSAL.json [--check]\ninspect returns {proposal,eventIds,pendingCount}; save only proposal as PROPOSAL.json. Run --check before resume. Uses the running local Host. A lost resume response means RESULT_UNKNOWN: inspect before any further action; never automatically retry.')
}else{
 const controller=new AbortController(),abort=()=>controller.abort()
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,abort)
 try{console.log(JSON.stringify(await runRouterOperatorCli(await loadConfig(configPath),args,{signal:controller.signal,configPath})))}
 catch(error){console.error(typeof error.code==='string'&&/^(?:(?:PI_)?ROUTER_|PI_BUSINESS_ADMISSION_)[A-Z_]+$/.test(error.code)?error.code:'ROUTER_OPERATOR_FAILED');process.exitCode=controller.signal.aborted?130:1}
 finally{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,abort)}
}
