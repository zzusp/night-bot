/** Owned byte-ring output capture. Platform launch/termination remains in the
 * separately attributed provider; this module owns only output bytes and files. */
import {constants,closeSync,fsyncSync,lstatSync,mkdtempSync,openSync,rmdirSync,unlinkSync,writeSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {isAbsolute,join} from 'node:path'
import {randomUUID} from 'node:crypto'
let temporaryRoot
function privateOutputRoot(){return temporaryRoot??=mkdtempSync(join(tmpdir(),'night-process-output-'))}
process.once('exit',()=>{if(temporaryRoot)try{rmdirSync(temporaryRoot)}catch{}})
function report(error,label){process.stderr.write(`Night process ${label}: complete output unavailable; bounded tail retained (${String(error)}).\n`)}
export function logSpillFailure(logger,owner){return(error,label)=>logger.error(`${owner}: complete ${label} output unavailable; bounded tail retained.`,error)}
export function prepareManagedProcessBinding({spillDir,onSpillFailure}={}){
 return{spillDir:spillDir??privateOutputRoot(),onSpillFailure:onSpillFailure??report}
}
function limit(value){if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Output byte limit must be a non-negative safe integer');return value}
function privateDirectory(path){
 const info=lstatSync(path)
 if(!info.isDirectory()||info.isSymbolicLink()||process.platform!=='win32'&&((info.mode&0o022)!==0||process.geteuid&&info.uid!==process.geteuid()))throw Object.assign(new Error('Unsafe process output directory'),{code:'NIGHT_PROCESS_OUTPUT_ROOT_UNSAFE'})
}
function writeAll(fd,bytes){let at=0;while(at<bytes.length){const count=writeSync(fd,bytes,at,bytes.length-at);if(count<=0)throw new Error('Process output write made no progress');at+=count}}
export class OutputCollector {
 #limit;#label;#storage;#ring=Buffer.alloc(0);#cursor=0;#held=0;#total=0;#fd;#path;#disabled;#sealed=false
 constructor(maxBytes,label,spill){
  this.#limit=limit(maxBytes)
  if(typeof label!=='string'||!/^[-a-zA-Z0-9_]+$/.test(label))throw new TypeError('Invalid process output label')
  this.#label=label
  if(spill){if(typeof spill.dir!=='string'||!isAbsolute(spill.dir))throw new TypeError('Process output root must be absolute');this.#storage={dir:spill.dir,maxBytes:limit(spill.maxBytes),onFailure:spill.onFailure??report}}
  this.#disabled=!spill
 }
 #tail(){
  if(!this.#held)return Buffer.alloc(0)
  const start=(this.#cursor-this.#held+this.#ring.length)%this.#ring.length
  if(start+this.#held<=this.#ring.length)return Buffer.from(this.#ring.subarray(start,start+this.#held))
  return Buffer.concat([this.#ring.subarray(start),this.#ring.subarray(0,this.#cursor)])
 }
 #retain(bytes){
  const needed=Math.min(this.#limit,this.#held+bytes.length)
  if(!needed)return
  if(this.#ring.length<needed){const prior=this.#tail();this.#ring=Buffer.allocUnsafe(Math.min(this.#limit,Math.max(needed,this.#ring.length*2)));prior.copy(this.#ring);this.#cursor=this.#held}
  if(bytes.length>=this.#ring.length){bytes.copy(this.#ring,0,bytes.length-this.#ring.length);this.#held=this.#ring.length;this.#cursor=0;return}
  const first=Math.min(bytes.length,this.#ring.length-this.#cursor);bytes.copy(this.#ring,this.#cursor,0,first);bytes.copy(this.#ring,0,first);this.#cursor=(this.#cursor+bytes.length)%this.#ring.length;this.#held=Math.min(this.#ring.length,this.#held+bytes.length)
 }
 #discard(){
  this.#disabled=true
  if(this.#fd!==undefined){try{closeSync(this.#fd)}catch{}this.#fd=undefined}
  if(this.#path!==undefined){try{unlinkSync(this.#path)}catch{}this.#path=undefined}
 }
 #fail(error){this.#discard();try{this.#storage.onFailure(error,this.#label)}catch{try{process.stderr.write('Night process output failure reporter failed.\n')}catch{}}}
 push(value){
  if(this.#sealed)throw new Error('Process output already sealed')
  if(!(value instanceof Uint8Array))throw new TypeError('Process output must be bytes')
  const bytes=Buffer.from(value.buffer,value.byteOffset,value.byteLength);this.#total+=bytes.length
  if(!this.#disabled&&(this.#fd!==undefined||this.#total>this.#limit)){
   if(this.#total>this.#storage.maxBytes)this.#discard()
   else try{
    if(this.#fd===undefined){privateDirectory(this.#storage.dir);const path=join(this.#storage.dir,`night-output-${randomUUID()}-${this.#label}.log`);this.#fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);this.#path=path;writeAll(this.#fd,this.#tail())}
    writeAll(this.#fd,bytes)
   }catch(error){this.#fail(error)}
  }
  this.#retain(bytes)
 }
 readFrom(fromByte){
  limit(fromByte);const start=this.#total-this.#held,tail=this.#tail(),lossy=fromByte<start
  return{text:tail.subarray(lossy?0:fromByte-start).toString('utf8'),nextOffset:this.#total,lossy,...this.#path===undefined?{}:{spillPath:this.#path}}
 }
 snapshot(){return{bytes:this.#tail(),totalBytes:this.#total}}
 seal(){
  if(this.#sealed)return;this.#sealed=true
  if(this.#fd!==undefined){const fd=this.#fd;this.#fd=undefined;let failure;try{fsyncSync(fd)}catch(error){failure=error}try{closeSync(fd)}catch(error){failure??=error}if(failure)this.#fail(failure)}
 }
 finalize(){this.seal();return{text:this.#tail().toString('utf8'),truncated:this.#total>this.#limit,...this.#path===undefined?{}:{spillPath:this.#path}}}
}
