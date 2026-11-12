#!/usr/bin/env node
import {readFile,stat} from 'node:fs/promises'
import {request} from 'node:http'
import {loadConfig} from '../src/config.js'
import {runtimePaths} from '../src/runtime/paths.js'
import {readEffectOperatorToken} from '../src/tasks/effect-operator-auth.js'
import {taskEffectReconciliationIdentity} from '../src/tasks/effect-reconciliation.js'
const fail=code=>Object.assign(new Error(code),{code})
const [configPath,command,...args]=process.argv.slice(2)
if(configPath==='--help'||command==='--help'){
 console.log('Usage: night-bot-effects.js CONFIG inspect TASK_ID INTENT_ENTRY_ID | CONFIG close PROPOSAL.json --operator-text-file NOTE.txt|-\nUses the running loopback service and private operator credential. inspect/close do not invoke a model. Closure records possible partial effects; the Router schedules subsequent task execution. Closed calls are never replayed.')
}else{
 const controller=new AbortController(),abort=()=>controller.abort()
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,abort)
 try{
  if(command==='new-action')throw fail('TASK_EFFECT_NEW_ACTION_RETIRED')
  if(!configPath||!['inspect','close'].includes(command))throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID')
  const config=await loadConfig(configPath),paths=runtimePaths(config,configPath),token=await readEffectOperatorToken(paths)
  const host=config.resident?.host??'127.0.0.1',port=config.resident?.port??18998
  if(!['127.0.0.1','::1','localhost'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw fail('EFFECT_OPERATOR_ENDPOINT_INVALID')
  let body,taskId,intentEntryId
  if(command==='inspect'){
   if(args.length!==2||args.some(value=>!value||value.length>2000))throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID')
   ;[taskId,intentEntryId]=args;body={}
  }else{
   if(args.length!==3||args[1]!=='--operator-text-file')throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID')
   if((await stat(args[0])).size>1048576)throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID')
   const proposal=taskEffectReconciliationIdentity(JSON.parse(await readFile(args[0],'utf8')))
   let operatorText
   if(args[2]==='-'){const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>64000)throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID');chunks.push(chunk)}operatorText=Buffer.concat(chunks).toString('utf8')}
   else{if((await stat(args[2])).size>64000)throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID');operatorText=await readFile(args[2],'utf8')}
   if(!operatorText.trim()||operatorText.length>16000)throw fail('EFFECT_OPERATOR_ARGUMENT_INVALID')
   ;({taskId,intentEntryId}=proposal);body={...proposal,operatorText}
  }
  const text=JSON.stringify(body)
  if(text.includes(token)||taskId.includes(token)||intentEntryId?.includes(token))throw fail('EFFECT_OPERATOR_SECRET_IN_REQUEST')
  const result=await new Promise((resolve,reject)=>{
   const req=request({hostname:host==='localhost'?'127.0.0.1':host,port,path:`/tasks/${encodeURIComponent(taskId)}/effects/${encodeURIComponent(intentEntryId)}/${command}`,method:'POST',agent:false,signal:controller.signal,headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(text)}},res=>{
    const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1048576){res.destroy();reject(fail('EFFECT_OPERATOR_RESPONSE_LIMIT'))}else chunks.push(chunk)});res.on('error',()=>reject(fail('EFFECT_OPERATOR_REQUEST_FAILED')));res.on('end',()=>{let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reject(fail('EFFECT_OPERATOR_RESPONSE_INVALID'))}if(res.statusCode!==200)return reject(fail(typeof value.error==='string'&&/^[A-Z_]+$/.test(value.error)?value.error:'EFFECT_OPERATOR_REQUEST_REJECTED'));resolve(value)})
   })
   req.setTimeout(30000,()=>req.destroy(fail('EFFECT_OPERATOR_REQUEST_TIMEOUT')));req.on('error',()=>reject(fail('EFFECT_OPERATOR_REQUEST_FAILED')));req.end(text)
  })
  console.log(JSON.stringify(result).replaceAll(token,'[REDACTED]'))
 }catch(error){console.error(typeof error.code==='string'&&/^(?:EFFECT_OPERATOR_|TASK_EFFECT_|TASK_SESSION_|DYNAMIC_)[A-Z_]+$/.test(error.code)?error.code:'EFFECT_OPERATOR_FAILED');process.exitCode=controller.signal.aborted?130:1}
 finally{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,abort)}
}
