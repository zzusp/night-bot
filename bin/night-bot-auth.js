#!/usr/bin/env node
import {loadConfig} from '../src/config.js'
import {loadNativeEnvironment} from '../src/native-environment.js'

const [path,...args]=process.argv.slice(2)
if(!path||path==='--help'||args.includes('--help')){
 console.log('Usage: node bin/night-bot-auth.js /absolute/config.json list | login PROVIDER [METHOD] | logout PROVIDER | describe-ref NAME | set-ref NAME | unset-ref NAME\nSecrets are read from a hidden terminal prompt or one stdin line. No resident or DingTalk service is started.')
 process.exitCode=path?0:2
}else{
 const controller=new AbortController(),abort=()=>controller.abort();let interaction,releaseProxy
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,abort)
 try{
  const config=await loadConfig(path)
  const environmentSnapshot=await loadNativeEnvironment({materialize:true,warn:message=>console.error(message)})
  const {installProxyFromEnvironment}=await import('@deepseek-ai/dsh-http-proxy')
  releaseProxy=await installProxyFromEnvironment(environmentSnapshot,message=>console.error(message))
  const {createOperatorInteraction}=await import('../src/operator-terminal.js')
  const {runAuthCommand}=await import('../src/operator-auth.js')
  // Start reading only for a command which needs an answer. Metadata commands
  // work in noninteractive supervisors without keeping stdin open.
  if(['login','set-ref'].includes(args[0]))interaction=createOperatorInteraction({onInterrupt:abort})
  const result=await runAuthCommand(config,args,{environmentSnapshot,interaction,signal:controller.signal})
  console.log(JSON.stringify(result));if(result.status==='cancelled')process.exitCode=130
 }catch(error){
  // SDK/vendor errors can contain request data. Do not print their messages.
  const code=typeof error.code==='string'&&/^NIGHT_BOT_AUTH_[A-Z_]+$/.test(error.code)?error.code:'NIGHT_BOT_AUTH_FAILED'
  console.error(controller.signal.aborted?'NIGHT_BOT_AUTH_CANCELLED':code);process.exitCode=controller.signal.aborted?130:1
 }finally{
  interaction?.close()
  try{await releaseProxy?.()}catch{console.error('NIGHT_BOT_AUTH_PROXY_CLEANUP_FAILED');process.exitCode=1}
  for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,abort)
 }
}
