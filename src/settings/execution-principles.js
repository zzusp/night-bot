import {createHash} from 'node:crypto'
import {lstat,open} from 'node:fs/promises'
import {join} from 'node:path'
import {atomicWrite,failure,withLocalFileQueue,withLock} from '../runtime/files.js'

const principlesMaxBytes=65_536
const versionOf=(text,role)=>createHash('sha256').update(role==='router'?'router\0':'').update(text===undefined?'':'\0'+text).digest('hex')
const fileOf=(paths,role)=>join(paths.config,role,'AGENTS.md')
const lockOf=(paths,role)=>join(paths.runtime,`.${role}-principles.lock`)
const stat=path=>lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error})
const valid=text=>typeof text==='string'&&text.isWellFormed()&&!text.includes('\0')&&Buffer.byteLength(text)<=principlesMaxBytes

async function readText(paths,role){
 const file=fileOf(paths,role),invalid=`SETTINGS_${role.toUpperCase()}_PRINCIPLES_INVALID`
 for(const path of [paths.data,paths.config,join(paths.config,role)]){
  const info=await stat(path)
  if(!info)return
  if(!info.isDirectory()||info.isSymbolicLink())throw failure('NIGHT_PATH_UNSAFE')
 }
 const info=await stat(file)
 if(!info)return
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw failure('NIGHT_PATH_UNSAFE')
 if(info.size>principlesMaxBytes)throw failure(invalid)
 const reader=await open(file,'r')
 try{
  const actual=await reader.stat()
  if(actual.dev!==info.dev||actual.ino!==info.ino||actual.nlink!==1)throw failure('NIGHT_PATH_CHANGED')
  const bytes=Buffer.alloc(principlesMaxBytes+1)
  let offset=0
  while(offset<bytes.length){const {bytesRead}=await reader.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead}
  let text
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,offset))}catch{throw failure(invalid)}
  if(!valid(text))throw failure(invalid)
  return text
 }finally{await reader.close()}
}

async function readSnapshot(paths,role){
 const text=await readText(paths,role)
 return {text:text??'',version:versionOf(text,role)}
}

const readPrinciples=(paths,role)=>withLocalFileQueue(lockOf(paths,role),()=>readSnapshot(paths,role))

async function savePrinciples(paths,role,{text,expectedVersion}={}){
 if(!valid(text)||typeof expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(expectedVersion))throw failure('SETTINGS_INPUT_INVALID')
 // Windows 的原子替换不能与同一 Host 的读句柄重叠；读取不持有磁盘锁。
 return withLock(lockOf(paths,role),async()=>{
  const prior=await readText(paths,role)
  if(versionOf(prior,role)!==expectedVersion)throw failure('SETTINGS_VERSION_CONFLICT')
  if(prior!==text)await atomicWrite(fileOf(paths,role),text)
  const saved=await readSnapshot(paths,role)
  if(saved.version!==versionOf(text,role))throw failure('NIGHT_WRITE_COMMIT_UNCERTAIN')
  return saved
 })
}

// Roles are fixed here; no request or model parameter can supply a directory.
export const readExecutionPrinciples=paths=>readPrinciples(paths,'execution')
export const saveExecutionPrinciples=(paths,body)=>savePrinciples(paths,'execution',body)
export const readRouterPrinciples=paths=>readPrinciples(paths,'router')
export const saveRouterPrinciples=(paths,body)=>savePrinciples(paths,'router',body)
