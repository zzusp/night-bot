import {open,lstat,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join} from 'node:path'
import {randomBytes,timingSafeEqual} from 'node:crypto'

export const EFFECT_OPERATOR_TOKEN_FILE='effect-operator.credentials.json'
const fail=code=>Object.assign(new Error(code),{code})
export function effectOperatorTokenPath(paths){
 if(paths?.mode!=='portable'||typeof paths.secrets!=='string')throw fail('EFFECT_OPERATOR_PRIVACY_UNAVAILABLE')
 return join(paths.secrets,EFFECT_OPERATOR_TOKEN_FILE)
}
function safe(info,file=false){
 if(info.isSymbolicLink()||!(file?info.isFile():info.isDirectory())||file&&info.nlink!==1||process.getuid&&info.uid!==process.getuid()||process.platform!=='win32'&&(info.mode&0o7777)!==(file?0o600:0o700))throw fail('EFFECT_OPERATOR_SECRET_UNSAFE')
}
export async function readEffectOperatorToken(paths,{create=false}={}){
 const path=effectOperatorTokenPath(paths);safe(await lstat(paths.secrets));if(await realpath(paths.secrets)!==paths.secrets)throw fail('EFFECT_OPERATOR_SECRET_UNSAFE')
 if(create){let file;try{file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await file.writeFile(JSON.stringify({version:1,token:randomBytes(32).toString('hex')})+'\n');await file.sync()}catch(error){if(error.code!=='EEXIST')throw fail('EFFECT_OPERATOR_SECRET_UNAVAILABLE')}finally{await file?.close()}}
 const before=await lstat(path);safe(before,true)
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const info=await file.stat();safe(info,true);if(info.ino!==before.ino||info.dev!==before.dev||info.size>256)throw fail('EFFECT_OPERATOR_SECRET_UNSAFE')
  const raw=await file.readFile('utf8');let doc;try{doc=JSON.parse(raw)}catch{throw fail('EFFECT_OPERATOR_SECRET_INVALID')}
  if(doc?.version!==1||typeof doc.token!=='string'||! /^[a-f0-9]{64}$/.test(doc.token)||JSON.stringify({version:1,token:doc.token})+'\n'!==raw)throw fail('EFFECT_OPERATOR_SECRET_INVALID')
  const after=await lstat(path);safe(after,true);if(after.ino!==info.ino||after.dev!==info.dev||after.size!==info.size)throw fail('EFFECT_OPERATOR_SECRET_UNSAFE')
  return doc.token
 }finally{await file.close()}
}
export async function createEffectOperatorAuth(paths){
 if(paths?.mode!=='portable')return Object.freeze({available:false,authorize:()=>false})
 const token=await readEffectOperatorToken(paths,{create:true}),expected=Buffer.from(token,'hex')
 return Object.freeze({available:true,async authorize(request){
  const header=request.headers?.authorization
  if(typeof header!=='string'||!/^Bearer [a-f0-9]{64}$/.test(header))return false
  if(request.rawHeaders&&request.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length!==1)return false
  try{const current=await readEffectOperatorToken(paths);return timingSafeEqual(expected,Buffer.from(current,'hex'))&&timingSafeEqual(expected,Buffer.from(header.slice(7),'hex'))}catch{return false}
 },containsSecret(value){return JSON.stringify(value).includes(token)},redact(value){return JSON.parse(JSON.stringify(value).replaceAll(token,'[REDACTED]'))}})
}
