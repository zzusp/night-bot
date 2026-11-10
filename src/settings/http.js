import {failure} from '../runtime/files.js'
import {createSettingsCommands} from './commands.js'

export const SETTINGS_OPERATOR_ROUTE='/operator/settings'
const send=(response,status,value)=>{
 response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'})
 response.end(JSON.stringify(value))
}
export function safeSettingsError(error){
 if(error?.committed===true)return 'SETTINGS_COMMIT_UNCERTAIN'
 const code=error?.code
 if(['ERR_PARSE_ARGS_UNKNOWN_OPTION','ERR_PARSE_ARGS_INVALID_OPTION_VALUE','ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'].includes(code))return 'SETTINGS_COMMAND_INVALID'
 if(['UNSUPPORTED_REASONING_EFFORT','WEB_LISTEN_INVALID','WEB_PUBLIC_ORIGIN_REQUIRED','WEB_PUBLIC_ORIGIN_INVALID'].includes(code))return code
 if(typeof code==='string'&&/^NIGHT_BOT_ROLE_MODEL_INVALID:(triage|router|task)$/.test(code))return 'NIGHT_BOT_ROLE_MODEL_INVALID'
 return typeof code==='string'&&/^(?:SETTINGS_|CHANNEL_|DINGTALK_|PERMISSION_|NIGHT_BOT_|NIGHT_DATA_|NIGHT_LOCK_|NIGHT_PATH_)[A-Z_]+$/.test(code)?code:'SETTINGS_OPERATION_FAILED'
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
async function readBody(request){
 if(request.headers['content-type']?.split(';')[0].trim()!=='application/json')throw failure('SETTINGS_JSON_REQUIRED')
 const chunks=[];let size=0
 for await(const chunk of request){size+=chunk.length;if(size>32768)throw failure('SETTINGS_REQUEST_TOO_LARGE');chunks.push(chunk)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw failure('SETTINGS_JSON_INVALID')}
}
/** A CLI-only transport on the existing resident listener. No Web plugin, browser
 * cookies, CORS grant, shell invocation or second Host is involved. */
export function createSettingsHttp({auth,getSettings,getChannels,getPermissions}){
 return async(request,response)=>{
  if((request.url??'').split('?')[0]!==SETTINGS_OPERATOR_ROUTE)return false
  if(request.url!==SETTINGS_OPERATOR_ROUTE||request.method!=='POST'){send(response,404,{error:'SETTINGS_ROUTE_INVALID'});return true}
  if(!localRequest(request)){send(response,403,{error:'SETTINGS_OPERATOR_LOCAL_REQUIRED'});return true}
  if(!auth?.available){send(response,503,{error:'SETTINGS_OPERATOR_PRIVACY_UNAVAILABLE'});return true}
  if(!await auth.authorize(request)){send(response,403,{error:'SETTINGS_OPERATOR_CAPABILITY_REQUIRED'});return true}
  try{
   const input=await readBody(request)
   if(auth.containsSecret(input))throw failure('SETTINGS_OPERATOR_SECRET_IN_REQUEST')
   const settings=getSettings()
   if(!settings)throw failure('SETTINGS_UNAVAILABLE')
   const dispatch=createSettingsCommands({settings,channels:getChannels(),permissions:getPermissions(),configuration:{
    model:({checkOnly,...body})=>settings.saveProviderModel(body,{checkOnly}),
    web:({checkOnly,...body})=>settings.saveWeb(body,{checkOnly}),
    permissions:body=>settings.checkPermission(body),
   }})
   send(response,200,auth.redact(await dispatch(input)))
  }catch(error){
   const code=safeSettingsError(error),invalid=/INVALID|REQUIRED|TOO_LARGE|UNSUPPORTED|SECRET_IN_REQUEST/.test(code),conflict=/CONFLICT|IN_USE|READ_ONLY|BLOCKED|EXISTS/.test(code)
   send(response,invalid?400:conflict?409:503,{error:code})
  }
  return true
 }
}
