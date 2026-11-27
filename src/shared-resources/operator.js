import {randomUUID} from 'node:crypto'
import {operatorCapability} from '../runtime/operator-capability.js'
import {localRequest} from '../settings/http.js'
import {MAX_SHARED_FILE_BYTES} from './store.js'
const capability=operatorCapability({filename:'shared-resources-operator.credentials.json',prefix:'SHARED_OPERATOR'})
export const createSharedOperatorAuth=capability.createAuth
export const readSharedOperatorToken=capability.readToken
export const SHARED_OPERATOR_ROUTE='/operator/shared-resources'
const send=(response,status,value)=>{
 response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'})
 response.end(JSON.stringify(value))
}
const maxBody=4*Math.ceil(MAX_SHARED_FILE_BYTES/3)+65536
const fail=code=>{throw Object.assign(Error(code),{code})}
async function body(request){
 if(request.headers['content-type']?.split(';')[0].trim()!=='application/json')fail('SHARED_INVALID')
 const chunks=[];let size=0
 for await(const chunk of request){size+=chunk.length;if(size>maxBody)fail('SHARED_TOO_LARGE');chunks.push(chunk)}
 let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('SHARED_INVALID')}
 if(!input||typeof input!=='object'||Array.isArray(input))fail('SHARED_INVALID')
 return input
}
export function createSharedOperatorHttp({auth,execute}){
 return async(request,response)=>{
  if((request.url??'').split('?')[0]!==SHARED_OPERATOR_ROUTE)return false
  if(request.method!=='POST'||request.url!==SHARED_OPERATOR_ROUTE){send(response,404,{error:'SHARED_ROUTE_INVALID'});return true}
  if(!localRequest(request)||!auth.available||!await auth.authorize(request)){send(response,403,{error:'SHARED_OPERATOR_FORBIDDEN'});return true}
  try{
   const {contentBase64,requestId=randomUUID(),...args}=await body(request)
   if(auth.containsSecret(args))fail('SHARED_INVALID')
   if(args.action==='forward')fail('SHARED_INVALID')
   let bytes
   if(contentBase64!==undefined){
    if(!['publish','update'].includes(args.action)||typeof contentBase64!=='string'||contentBase64.length>maxBody)fail('SHARED_INVALID')
    bytes=Buffer.from(contentBase64,'base64')
    if(bytes.length>MAX_SHARED_FILE_BYTES||bytes.toString('base64')!==contentBase64||auth.containsSecret(bytes.toString('utf8')))fail('SHARED_INVALID')
   }
   const output=await execute(args,{bytes,requestId})
   if(output.bytes&&args.action==='read'){
    const filename=encodeURIComponent(output.result.fileName).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16))
    response.writeHead(200,{'content-type':'application/octet-stream','x-content-type-options':'nosniff',
     'cache-control':'no-store','content-length':output.bytes.length,'content-disposition':"attachment; filename*=UTF-8''"+filename,
     'x-night-resource-id':output.result.id,'x-night-resource-version':String(output.result.version),'x-night-resource-sha256':output.result.sha256})
    response.end(output.bytes)
   }else send(response,200,auth.redact(output.result))
  }catch(error){
   const code=typeof error?.code==='string'&&/^SHARED_[A-Z_]+$/.test(error.code)?error.code:'SHARED_UNAVAILABLE'
   send(response,code==='SHARED_FORBIDDEN'?403:/NOT_FOUND|WITHDRAWN/.test(code)?404:/CONFLICT/.test(code)?409:code==='SHARED_TOO_LARGE'?413:code==='SHARED_UNAVAILABLE'?503:400,{error:code})
  }
  return true
 }
}
