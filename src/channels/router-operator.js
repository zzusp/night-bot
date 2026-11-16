import {readFile} from 'node:fs/promises'
import {parseArgs} from 'node:util'
import {operatorCapability} from '../runtime/operator-capability.js'
import {runtimePaths} from '../runtime/paths.js'

const fail=code=>Object.assign(new Error(code),{code})
const capability=operatorCapability({filename:'router-operator.credentials.json',prefix:'ROUTER_OPERATOR'})
export const createRouterOperatorAuth=capability.createAuth
export const ROUTER_OPERATOR_ROUTE='/operator/router'
const proposalKeys=['conversationId','generation','sessionId','packetId','failedEntryId','checkpointRevision','inboxDigest']
function proposal(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==proposalKeys.length||proposalKeys.some(key=>!Object.hasOwn(value,key))||!Number.isSafeInteger(value.generation)||value.generation<1||proposalKeys.filter(key=>key!=='generation').some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>512)||! /^[a-f0-9]{64}$/.test(value.inboxDigest)||! /^[a-f0-9]{64}$/.test(value.checkpointRevision))throw fail('ROUTER_OPERATOR_PROPOSAL_INVALID')
 return value
}
function localRequest(request){
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)||request.headers.origin!==undefined)return false
 try{
  const host=request.headers.host
  if(typeof host!=='string'||host.length>200)return false
  const url=new URL('http://'+host)
  return ['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.host===host.toLowerCase()&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&(!request.socket.localPort||Number(url.port||80)===request.socket.localPort)
 }catch{return false}
}
const send=(response,status,value)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(value))}
const safeError=error=>typeof error?.code==='string'&&/^(?:(?:PI_)?ROUTER_|PI_BUSINESS_ADMISSION_)[A-Z_]+$/.test(error.code)?error.code:'ROUTER_OPERATOR_OPERATION_FAILED'
export function createRouterOperatorHttp({auth,getTasks}){
 return async(request,response)=>{
  if((request.url??'').split('?')[0]!==ROUTER_OPERATOR_ROUTE)return false
  if(request.url!==ROUTER_OPERATOR_ROUTE||request.method!=='POST'){send(response,404,{error:'ROUTER_OPERATOR_ROUTE_INVALID'});return true}
  if(!localRequest(request)){send(response,403,{error:'ROUTER_OPERATOR_LOCAL_REQUIRED'});return true}
  if(!auth?.available){send(response,503,{error:'ROUTER_OPERATOR_PRIVACY_UNAVAILABLE'});return true}
  if(!await auth.authorize(request)){send(response,403,{error:'ROUTER_OPERATOR_CAPABILITY_REQUIRED'});return true}
  try{
   if(request.headers['content-type']?.split(';')[0].trim()!=='application/json')throw fail('ROUTER_OPERATOR_JSON_REQUIRED')
   const chunks=[];let size=0
   for await(const chunk of request){size+=chunk.length;if(size>32768)throw fail('ROUTER_OPERATOR_REQUEST_TOO_LARGE');chunks.push(chunk)}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fail('ROUTER_OPERATOR_JSON_INVALID')}
   if(auth.containsSecret(input))throw fail('ROUTER_OPERATOR_SECRET_IN_REQUEST')
   if(!input||typeof input!=='object'||Array.isArray(input))throw fail('ROUTER_OPERATOR_REQUEST_INVALID')
   const tasks=getTasks();let result
   if(input.command==='inspect'){
    if(Object.keys(input).length!==2||typeof input.conversationId!=='string'||!input.conversationId||input.conversationId.length>512)throw fail('ROUTER_OPERATOR_REQUEST_INVALID')
    result=await tasks.inspectRouterBatch({conversationId:input.conversationId})
   }else if(['check','resume'].includes(input.command)){
    if(Object.keys(input).length!==2)throw fail('ROUTER_OPERATOR_REQUEST_INVALID')
    const expected=proposal(input.proposal)
    result=await (input.command==='check'?tasks.checkRouterBatch(expected):tasks.resumeRouterBatch(expected))
   }else throw fail('ROUTER_OPERATOR_REQUEST_INVALID')
   send(response,200,auth.redact(result))
  }catch(error){const code=safeError(error);send(response,/INVALID|REQUIRED|TOO_LARGE|SECRET_IN_REQUEST/.test(code)?400:409,{error:code})}
  return true
 }
}

/** 只连接已有 Host；inspect/check 不启动 Host，不触发恢复或模型请求。 */
export async function runRouterOperatorCli(config,args,{signal,configPath}={}){
 const {values,positionals}=parseArgs({args,options:{proposal:{type:'string'},check:{type:'boolean'}},allowPositionals:true,strict:true})
 const [command,conversationId,...extra]=positionals
 if(extra.length||!['inspect','resume'].includes(command)||command==='inspect'&&(!conversationId||values.proposal||values.check)||command==='resume'&&(conversationId||!values.proposal))throw fail('ROUTER_OPERATOR_COMMAND_INVALID')
 const body=command==='inspect'?{command,conversationId}:{command:values.check?'check':'resume',proposal:proposal(JSON.parse(await readFile(values.proposal,'utf8')))}
 const token=await capability.readToken(runtimePaths(config,configPath))
 if(JSON.stringify(body).includes(token))throw fail('ROUTER_OPERATOR_SECRET_IN_REQUEST')
 const host=config.resident?.host??'127.0.0.1',port=config.resident?.port??18998
 if(!['127.0.0.1','localhost','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw fail('ROUTER_OPERATOR_LOCAL_REQUIRED')
 const url=`http://${host==='::1'?'[::1]':host}:${port}${ROUTER_OPERATOR_ROUTE}`
 signal?.throwIfAborted()
 let response
 try{
  response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal})
  const chunks=[];let size=0
  for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw fail('ROUTER_OPERATOR_RESPONSE_INVALID');chunks.push(chunk)}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(JSON.stringify(result).includes(token))throw fail('ROUTER_OPERATOR_RESPONSE_INVALID')
  if(!response.ok)throw fail(safeError({code:result.error}))
  return result
 }catch(error){
  // 断线/取消不证明服务端未执行；不自动重试已发出的续办。
  if(body.command==='resume'&&(!response||response.ok))throw fail('ROUTER_OPERATOR_RESULT_UNKNOWN')
  throw fail(safeError(error))
 }
}
