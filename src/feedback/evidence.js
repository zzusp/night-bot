import {opendir,lstat,realpath,open} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {constants} from 'node:fs'
import {inside} from '../runtime/paths.js'
// Only product-defined classes leave the host. Never return lines, filenames,
// IDs, arbitrary error messages, process environment, chats or configuration.
const codes=new Set(['AUTH_REQUIRED','BOT_NOT_READY','CSRF_INVALID','REFLECTION_SCAN_FAILED','REFLECTION_MODEL_FAILED','TASK_REVIEW_ARCHIVE_FAILED','CHANNEL_AUTH_REQUIRED','CHANNEL_ADAPTER_ERROR','CHANNEL_HISTORY_INCOMPLETE','CHANNEL_HISTORY_RECOVERY_FAILED','CHANNEL_DRAIN_FAILED','WEB_ASSETS_NOT_BUILT','MODEL_REQUEST_FAILED','ECONNREFUSED','ETIMEDOUT','SQLITE_BUSY','SQLITE_LOCKED'])
export async function feedbackErrorCodes(logRoot,signal){
 const counts={};let files=0,bytes=0
 const summary=()=>({counts,files,bytes,coverage:'allowlisted-recent-log-tails',complete:false,limitations:['empty-counts-do-not-prove-no-errors','only-latest-three-log-tails-up-to-32768-bytes-each']})
 if(!logRoot)return summary()
 const stat=await lstat(logRoot).catch(()=>null)
 if(!stat?.isDirectory()||stat.isSymbolicLink())return summary()
 const root=await realpath(logRoot);if(root!==resolve(logRoot))return summary()
 const entries=[];let inspected=0
 for await(const entry of await opendir(root)){signal?.throwIfAborted();if(++inspected>128)break;if(entry.isFile()&&/\.log$/.test(entry.name)){const stat=await lstat(join(root,entry.name)).catch(()=>null);if(stat?.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1)entries.push({name:entry.name,mtime:stat.mtimeMs})}}
 entries.sort((a,b)=>b.mtime-a.mtime);entries.splice(3)
 for(const entry of entries){
  signal?.throwIfAborted();const file=join(root,entry.name),stat=await lstat(file)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!inside(root,await realpath(file)))continue
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
  try{const current=await handle.stat();if(current.dev!==stat.dev||current.ino!==stat.ino)continue
   const size=Math.min(current.size,32768),buffer=Buffer.alloc(size),result=await handle.read(buffer,0,size,Math.max(0,current.size-size));files++;bytes+=result.bytesRead
   for(const word of buffer.toString('utf8',0,result.bytesRead).match(/\b[A-Z][A-Z_]{3,64}\b/g)??[])if(codes.has(word))counts[word]=(counts[word]??0)+1
  }finally{await handle.close()}
 }
 return summary()
}
