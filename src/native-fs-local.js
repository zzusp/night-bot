// Night-owned IO adapter for Pi tool operations. Pi owns model-facing read/edit/write
// semantics; this adapter owns canonical identities, bounded IO and guarded publication.
import {constants} from 'node:buffer'
import {symbols} from '@deepseek-ai/cordis'
import {createReadStream} from 'node:fs'
import {chmod,link,lstat,mkdir,mkdtemp,open,readdir,realpath,rename,rm,stat} from 'node:fs/promises'
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {once} from 'node:events'
import {watch} from 'chokidar'
import z from '@deepseek-ai/schemastery'
import {FileSystem,FsError} from './native-fs-protocol.js'
import {copyFileDaclWin32,replaceFileWin32} from './fs-windows-security.js'

const MAX_BASIS=Math.min(constants.MAX_LENGTH,constants.MAX_STRING_LENGTH)
const missing=e=>e?.code==='ENOENT'||e?.code==='ENOTDIR'
const failure=(code,message,cause)=>new FsError(message,code,cause?{cause}:undefined)
function canceled(signal){if(signal?.aborted)throw failure('FS_ABORTED','Filesystem operation aborted')}
function classify(info){return info.isFile()?'file':info.isDirectory()?'directory':'other'}
function metadata(info,follow=true){return {version:[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':'),size:Number(info.size),mode:Number(info.mode&511n),type:!follow&&info.isSymbolicLink()?'symlink':classify(info)}}
async function inspect(path,follow=true){try{return metadata(await(follow?stat:lstat)(path,{bigint:true}),follow)}catch(e){if(missing(e))return null;throw e}}
function spelling(cwd,path){
 if(typeof path!=='string'||!path.trim())throw failure('FS_NOT_FOUND','path must be a non-empty string')
 // On POSIX `alias/..` follows the physical directory, unlike path.resolve.
 const raw=isAbsolute(path)?path:`${resolve(cwd)}${sep}${path}`
 return process.platform==='win32'||!raw.split(sep).includes('..')?resolve(cwd,path):raw
}
async function identify(cwd,path){
 const displayPath=spelling(cwd,path),suffix=[];let candidate=displayPath
 for(;;){
  try{
   const physical=await realpath(candidate)
   if(suffix.includes('..')||(suffix.length&&!(await stat(physical)).isDirectory()))throw failure('FS_NOT_FOUND','Path traverses a missing or non-directory parent')
   return {displayPath,targetKey:join(physical,...suffix)}
  }catch(e){
   if(e?.code==='ENOTDIR')throw failure('FS_NOT_FOUND','Path parent is not a directory',e)
   if(e?.code!=='ENOENT')throw e
   const parent=dirname(candidate)
   if(parent===candidate)throw failure('FS_NOT_FOUND','No existing filesystem ancestor',e)
   suffix.unshift(basename(candidate));candidate=parent
  }
 }
}
function text(bytes,path){
 if(bytes.subarray(0,8192).includes(0))throw failure('FS_NOT_TEXT',`cannot read "${path}": binary file`)
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch(e){throw failure('FS_NOT_TEXT',`cannot read "${path}": invalid UTF-8 text`,e)}
}
const normalize=value=>value.replaceAll('\r\n','\n')

const notStartedWrites=new WeakMap()
/** Only this backend's actual pre-publication failure is evidence, not error fields. */
export const isLocalFileWriteNotStarted=(fs,error)=>!!fs&&notStartedWrites.get(error)===(fs[symbols.original]??fs)

export class LocalFileSystem extends FileSystem{
 static Config=z.object({cwd:z.string().default(process.cwd()),diffBasisMaxBytes:z.number().default(10*1024*1024)})
 internals={}
 _tails=new Map()
 constructor(ctx,config){
  super(ctx)
  if(!Number.isSafeInteger(config.diffBasisMaxBytes)||config.diffBasisMaxBytes<=0||config.diffBasisMaxBytes>MAX_BASIS)throw Error('Invalid diffBasisMaxBytes')
  this.config=config
 }
 async withLock(key,operation){
  const pending=(this._tails.get(key)??Promise.resolve()).then(operation),settled=pending.then(()=>{},()=>{})
  this._tails.set(key,settled)
  try{return await pending}finally{if(this._tails.get(key)===settled)this._tails.delete(key)}
 }
 async resolve(path,options){canceled(options?.signal);const target=await identify(options?.cwd??this.config.cwd,path);canceled(options?.signal);return target}
 processPath(target){return String(target.targetKey)}
 processPathFromHostPath(path){return isAbsolute(path)?resolve(path):undefined}
 fileUrl(target){return pathToFileURL(this.processPath(target)).href}
 contains(parent,child){const rel=relative(this.processPath(parent),this.processPath(child));return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`)}
 async stat(target,signal){canceled(signal);const info=await inspect(this.processPath(target));canceled(signal);return info?{type:info.type,size:info.size,version:info.version}:undefined}
 async lstat(path,options,signal){canceled(signal);const info=await inspect(spelling(options?.cwd??this.config.cwd,path),false);canceled(signal);return info?{type:info.type,size:info.size,version:info.version}:undefined}
 async _regular(target,signal){
  canceled(signal);const info=await inspect(this.processPath(target))
  if(!info)throw failure('FS_NOT_FOUND',`cannot read "${target.displayPath}": not found`)
  if(info.type!=='file')throw failure('FS_NOT_REGULAR_FILE',`cannot read "${target.displayPath}": not a regular file`)
  return info
 }
 async *_chunks(target,signal,range){
  canceled(signal)
  const stream=createReadStream(this.processPath(target),{...range,...signal?{signal}:{}})
  try{for await(const chunk of stream){canceled(signal);yield chunk}}catch(e){if(signal?.aborted||e.name==='AbortError')throw failure('FS_ABORTED','Filesystem read aborted',e);throw e}
 }
 async readBytes(target,signal,maxBytes=Infinity){
  const info=await this._regular(target,signal)
  if(info.size>maxBytes)throw failure('FS_TOO_LARGE','File exceeds complete-buffer byte limit')
  await this.internals.inspectReadBytesAfterStat?.(target)
  let size=0;const pieces=[]
  for await(const chunk of this._chunks(target,signal,Number.isFinite(maxBytes)?{end:maxBytes}:{})){
   size+=chunk.length;if(size>maxBytes)throw failure('FS_TOO_LARGE','Growing file exceeds complete-buffer byte limit');pieces.push(chunk)
  }
  return Buffer.concat(pieces,size)
 }
 async readByteRange(target,range,signal){
  await this._regular(target,signal)
  if(!Number.isSafeInteger(range.offset)||!Number.isSafeInteger(range.length)||range.offset<0||range.length<0||!Number.isSafeInteger(range.offset+range.length))throw failure('FS_IO_ERROR','Invalid byte window')
  if(!range.length)return Buffer.alloc(0)
  const pieces=[];for await(const chunk of this._chunks(target,signal,{start:range.offset,end:range.offset+range.length-1}))pieces.push(chunk)
  return Buffer.concat(pieces)
 }
 async readText(target,signal){return text(await this.readBytes(target,signal),target.displayPath)}
 async streamText(target,signal){
  await this._regular(target,signal)
  const self=this
  return(async function*(){
   const decoder=new TextDecoder('utf-8',{fatal:true});let sampled=0
   try{
    for await(const bytes of self._chunks(target,signal,{})){
     const sample=bytes.subarray(0,Math.max(0,8192-sampled));sampled+=sample.length
     if(sample.includes(0))throw failure('FS_NOT_TEXT',`cannot read "${target.displayPath}": binary file`)
     yield decoder.decode(bytes,{stream:true})
    }
    yield decoder.decode()
   }catch(e){if(e instanceof TypeError)throw failure('FS_NOT_TEXT',`cannot read "${target.displayPath}": invalid UTF-8 text`,e);throw e}
  })()
 }
 async listDir(target,signal){
  canceled(signal);const info=await inspect(this.processPath(target))
  if(!info)throw failure('FS_NOT_FOUND','Cannot list a missing directory')
  if(info.type!=='directory')throw failure('FS_NOT_DIRECTORY','Cannot list a non-directory')
  try{
   const entries=await readdir(this.processPath(target)),result=[]
   for(const name of entries.sort((a,b)=>a.localeCompare(b))){
    canceled(signal);const child=await identify(this.processPath(target),name),info=await inspect(child.targetKey)
    result.push({name,type:info?.type??'other',target:{...child,displayPath:spelling(target.displayPath,name)},...info?{version:info.version}:{},...info?.type==='file'?{size:info.size}:{}})
   }
   canceled(signal);return result
  }catch(e){if(e instanceof FsError)throw e;throw failure(missing(e)?'FS_NOT_FOUND':['EACCES','EPERM'].includes(e.code)?'FS_PERMISSION_DENIED':'FS_IO_ERROR','Directory listing failed',e)}
 }
 async watch(target,changed,signal){
  signal.throwIfAborted();const path=this.processPath(target),directory=(await this.stat(target,signal))?.type==='directory',root=directory?path:dirname(path)
  const subscription=watch(root,{ignoreInitial:true,depth:0,ignored:entry=>!directory&&resolve(entry)!==resolve(root)&&resolve(entry)!==resolve(path)})
  subscription.on('all',(_event,entry)=>{if(directory||resolve(entry)===resolve(path))changed()})
  subscription.on('error',e=>changed(e instanceof Error?e:Error(String(e))))
  try{await once(subscription,'ready',{signal});return()=>subscription.close()}catch(e){await subscription.close();throw e}
 }
 async _basis(path,signal){
  // A descriptor-size bound prevents growth/replacement races from allocating
  // an unbounded diff basis. Presentation failure never authorizes a write.
  let handle
  try{
   canceled(signal);handle=await open(path,'r');const info=await handle.stat(),limit=this.config.diffBasisMaxBytes
   if(!info.isFile()||info.size>=limit)return null
   const bytes=Buffer.alloc(info.size+1);let used=0
   while(used<bytes.length){canceled(signal);const read=await handle.read(bytes,used,Math.min(65536,bytes.length-used),null);if(!read.bytesRead)break;used+=read.bytesRead}
   if(used!==info.size||bytes.subarray(0,used).includes(0))return null
   return normalize(text(bytes.subarray(0,used),path))
  }catch(e){if(e.code==='FS_ABORTED')throw e;return null}finally{await handle?.close()}
 }
 async _publish(target,content,existing,expected,signal){
  canceled(signal);const path=this.processPath(target),parent=dirname(path),hooks=this.internals
  await mkdir(parent,{recursive:true});canceled(signal)
  // Use an OS-created unpredictable exclusive directory; no shared temp file.
  let staging,handle,created=false,committed=false
  try{
   staging=hooks.tempDirName?join(parent,hooks.tempDirName(path)):await mkdtemp(join(parent,`.${basename(path)}.`))
   if(hooks.tempDirName)await mkdir(staging,{mode:0o700})
   created=true
   await chmod(staging,0o700)
   const temp=join(staging,hooks.tempName?.(path)??'content')
   handle=await open(temp,'wx',0o600);await handle.chmod(0o600)
   const windows=(hooks.platform??process.platform)==='win32'
   if(windows&&existing)await(hooks.copyFileDacl??copyFileDaclWin32)(path,temp)
   await handle.writeFile(content,{encoding:'utf8',...signal?{signal}:{}});await handle.sync()
   await hooks.inspectTemp?.({stagingDir:staging,tempPath:temp})
   if(existing)await handle.chmod(existing.mode)
   await handle.close();handle=undefined;canceled(signal)
   if(expected?.kind==='createIfAbsent'){
    try{await(hooks.linkFile??link)(temp,path)}catch(e){
     let destination
     try{destination=await(hooks.inspectPublicationTarget??lstat)(path)}catch(probe){if(!missing(probe))throw failure('FS_IO_ERROR','Cannot inspect publication destination',probe)}
     if(destination&&!destination.isFile())throw failure('FS_NOT_REGULAR_FILE','Publication destination is not a regular file',e)
     if(destination||e.code==='EEXIST')throw failure('FS_NOT_OBSERVED','Cannot overwrite an unobserved file',e)
     throw failure('FS_IO_ERROR','Exclusive file publication failed',e)
    }
   }else if(windows&&existing){
    try{await(hooks.replaceFile??replaceFileWin32)(path,temp)}catch(e){if(e.code!=='ENOENT')throw e;await rename(temp,path)}
   }else await rename(temp,path)
   committed=true
  }catch(e){if(e.name==='AbortError')throw failure('FS_ABORTED','Filesystem write aborted',e);throw e}
  finally{
   try{await handle?.close()}finally{
    if(created)try{await(hooks.removeStagingDir??(path=>rm(path,{recursive:true,force:true})))(staging)}catch(e){if(!committed)throw failure('FS_IO_ERROR','Uncommitted staging cleanup failed',e)}
   }
  }
 }
 async writeText(target,content,expected,signal){
  return this.withLock(target.targetKey,async()=>{
   let publishing=false
   try{
    canceled(signal);const existing=await inspect(this.processPath(target))
    if(existing&&existing.type!=='file')throw failure('FS_NOT_REGULAR_FILE','Cannot replace a non-regular file')
    if(expected?.kind==='replaceIfVersion'&&existing?.version!==expected.version)throw failure('FS_STALE_VERSION','File changed since its observation')
    if(expected?.kind==='createIfAbsent'&&existing)throw failure('FS_NOT_OBSERVED','Cannot overwrite an unobserved file')
    const before=existing&&Buffer.byteLength(content)<this.config.diffBasisMaxBytes?await this._basis(this.processPath(target),signal):null
    publishing=true
    await this._publish(target,content,existing,expected,signal)
    const after=await inspect(this.processPath(target))
    return {operation:existing?'update':'create',version:after?.version??`missing:${target.targetKey}`,before,after:normalize(content)}
   }catch(error){if(!publishing&&error instanceof Error)notStartedWrites.set(error,this[symbols.original]??this);throw error}
  })
 }
}
export default LocalFileSystem
