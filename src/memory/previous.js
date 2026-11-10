import {open,lstat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {resolve,relative,isAbsolute,dirname,basename,sep} from 'node:path'
import {containsSecret,hash} from './format.js'
import {failure} from '../runtime/files.js'

export const CONTENT_LIMIT=64*1024
// A single prior body, not a chain. Reject secrets before any snapshot is saved.
export function contentSnapshot(text,revision,updatedAt){
  if(typeof text!=='string'||Buffer.byteLength(text)>CONTENT_LIMIT||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||containsSecret(text))return null
  return {text,revision,updatedAt:typeof updatedAt==='string'&&Number.isFinite(Date.parse(updatedAt))?updatedAt:null}
}
export function priorSnapshot(value){
  if(!value||!['string','number'].includes(typeof value.revision))return null
  return contentSnapshot(value.text,value.revision,value.updatedAt)
}
const sameIdentity=(left,right)=>left.ino===right.ino&&left.dev===right.dev
const safeDirectory=info=>info.isDirectory()&&!info.isSymbolicLink()
const forbidden=()=>failure('EVOLUTION_BODY_FORBIDDEN')

// Linux openat-equivalent traversal: each child is resolved from a held directory
// descriptor. O_NOFOLLOW applies to every segment, not merely the final file.
// Never fall back to pathname reads if /proc descriptors are unavailable.
async function anchoredParent(path){
  const handles=[],links=[]
  try{
    let parent=await open('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
    handles.push(parent)
    for(const segment of dirname(path).split('/').filter(Boolean)){
      if(handles.length>=256)throw forbidden()
      const target=`/proc/self/fd/${parent.fd}/${segment}`
      const child=await open(target,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
      handles.push(child);links.push({target,identity:await child.stat({bigint:true})});parent=child
    }
    return {path:`/proc/self/fd/${parent.fd}/${basename(path)}`,verify:async()=>{
      for(const {target,identity}of links){const actual=await lstat(target,{bigint:true});if(!safeDirectory(actual)||!sameIdentity(actual,identity))throw failure('EVOLUTION_VERSION_STALE')}
    },close:async()=>{await Promise.allSettled(handles.reverse().map(handle=>handle.close()))}}
  }catch(error){await Promise.allSettled(handles.reverse().map(handle=>handle.close()));throw error}
}

// Portable fallback retains conservative before/after directory identity checks.
// Windows has no Node handle-relative open primitive; this is not a claim of
// Linux-equivalent protection against a hostile concurrent directory mutator.
async function checkedParent(path){
  const directories=[];let current=dirname(path)
  for(;;){
    const info=await lstat(current,{bigint:true});if(!safeDirectory(info))throw forbidden()
    directories.push({path:current,info});const parent=dirname(current);if(parent===current)break;current=parent
  }
  return {path,verify:async()=>{for(const entry of directories){const info=await lstat(entry.path,{bigint:true});if(!safeDirectory(info)||!sameIdentity(info,entry.info))throw failure('EVOLUTION_VERSION_STALE')}},close:async()=>{}}
}

export async function boundedRead(path,limit=CONTENT_LIMIT,{root}={}){
  if(typeof path!=='string'||path.includes('\0')||!Number.isSafeInteger(limit)||limit<1)throw forbidden()
  path=resolve(path)
  if(root!==undefined){
    if(typeof root!=='string'||root.includes('\0'))throw forbidden()
    const relativePath=relative(resolve(root),path)
    if(!relativePath||isAbsolute(relativePath)||relativePath==='..'||relativePath.startsWith('..'+sep))throw forbidden()
  }
  let parent,file
  try{
    parent=await (process.platform==='linux'?anchoredParent(path):checkedParent(path))
    const info=await lstat(parent.path,{bigint:true})
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw forbidden()
    if(info.size>BigInt(limit))throw failure('EVOLUTION_CONTENT_TOO_LARGE')
    // Nonblocking prevents a racing replacement with a FIFO from hanging open.
    file=await open(parent.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0))
    const before=await file.stat({bigint:true})
    if(!before.isFile()||before.nlink!==1n)throw forbidden()
    if(!sameIdentity(before,info))throw failure('EVOLUTION_VERSION_STALE')
    await parent.verify() // no content bytes are read until the path is verified
    const buffer=Buffer.alloc(limit+1);let bytesRead=0
    while(bytesRead<buffer.length){const part=await file.read(buffer,bytesRead,buffer.length-bytesRead,bytesRead);if(!part.bytesRead)break;bytesRead+=part.bytesRead}
    const after=await file.stat({bigint:true})
    if(bytesRead>limit)throw failure('EVOLUTION_CONTENT_TOO_LARGE')
    if(['ino','dev','size','mtimeNs','ctimeNs','nlink'].some(key=>before[key]!==after[key])||BigInt(bytesRead)!==after.size)throw failure('EVOLUTION_VERSION_STALE')
    await parent.verify()
    const final=await lstat(parent.path,{bigint:true})
    if(!final.isFile()||!sameIdentity(final,after))throw failure('EVOLUTION_VERSION_STALE')
    const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytesRead))
    return {text,revision:hash(text),updatedAt:new Date(Number(after.mtimeMs)).toISOString()}
  }catch(error){
    if(error.code==='ENOENT')return null
    if(['ELOOP','ENOTDIR'].includes(error.code))throw forbidden()
    throw error
  }finally{try{await file?.close()}finally{await parent?.close()}}
}
