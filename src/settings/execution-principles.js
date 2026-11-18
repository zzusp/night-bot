import {createHash} from 'node:crypto'
import {lstat,open} from 'node:fs/promises'
import {join} from 'node:path'
import {atomicWrite,failure,withLocalFileQueue,withLock} from '../runtime/files.js'

const executionPrinciplesMaxBytes=65_536
const versionOf=text=>createHash('sha256').update(text===undefined?'':'\0'+text).digest('hex')
const fileOf=paths=>join(paths.config,'execution','AGENTS.md')
const lockOf=paths=>join(paths.runtime,'.execution-principles.lock')
const stat=path=>lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error})
const valid=text=>typeof text==='string'&&text.isWellFormed()&&!text.includes('\0')&&Buffer.byteLength(text)<=executionPrinciplesMaxBytes

async function readText(paths){
 const file=fileOf(paths)
 for(const path of [paths.data,paths.config,join(paths.config,'execution')]){
  const info=await stat(path)
  if(!info)return
  if(!info.isDirectory()||info.isSymbolicLink())throw failure('NIGHT_PATH_UNSAFE')
 }
 const info=await stat(file)
 if(!info)return
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw failure('NIGHT_PATH_UNSAFE')
 if(info.size>executionPrinciplesMaxBytes)throw failure('SETTINGS_EXECUTION_PRINCIPLES_INVALID')
 const reader=await open(file,'r')
 try{
  const actual=await reader.stat()
  if(actual.dev!==info.dev||actual.ino!==info.ino||actual.nlink!==1)throw failure('NIGHT_PATH_CHANGED')
  const bytes=Buffer.alloc(executionPrinciplesMaxBytes+1)
  let offset=0
  while(offset<bytes.length){const {bytesRead}=await reader.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead}
  let text
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,offset))}catch{throw failure('SETTINGS_EXECUTION_PRINCIPLES_INVALID')}
  if(!valid(text))throw failure('SETTINGS_EXECUTION_PRINCIPLES_INVALID')
  return text
 }finally{await reader.close()}
}

async function readSnapshot(paths){
 const text=await readText(paths)
 return {text:text??'',version:versionOf(text)}
}

export function readExecutionPrinciples(paths){
 return withLocalFileQueue(lockOf(paths),()=>readSnapshot(paths))
}

export async function saveExecutionPrinciples(paths,{text,expectedVersion}={}){
 if(!valid(text)||typeof expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(expectedVersion))throw failure('SETTINGS_INPUT_INVALID')
 // Windows 的原子替换不能与同一 Host 的读句柄重叠；读取不持有磁盘锁。
 return withLock(lockOf(paths),async()=>{
  const prior=await readText(paths)
  if(versionOf(prior)!==expectedVersion)throw failure('SETTINGS_VERSION_CONFLICT')
  if(prior!==text)await atomicWrite(fileOf(paths),text)
  const saved=await readSnapshot(paths)
  if(saved.version!==versionOf(text))throw failure('NIGHT_WRITE_COMMIT_UNCERTAIN')
  return saved
 })
}
