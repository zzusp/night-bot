import {lstat} from 'node:fs/promises'
import {readEvidenceFile,recentLogFiles} from './local-evidence.js'
// Only product-defined classes leave the host. Never return lines, filenames,
// IDs, arbitrary error messages, process environment, chats or configuration.
const codes=new Set(['AUTH_REQUIRED','BOT_NOT_READY','CSRF_INVALID','REFLECTION_SCAN_FAILED','REFLECTION_MODEL_FAILED','TASK_REVIEW_ARCHIVE_FAILED','CHANNEL_AUTH_REQUIRED','CHANNEL_ADAPTER_ERROR','CHANNEL_HISTORY_INCOMPLETE','CHANNEL_HISTORY_RECOVERY_FAILED','CHANNEL_DRAIN_FAILED','WEB_ASSETS_NOT_BUILT','MODEL_REQUEST_FAILED','ECONNREFUSED','ETIMEDOUT','SQLITE_BUSY','SQLITE_LOCKED'])
export async function feedbackErrorCodes(logRoot,signal){
 const counts={};let files=0,bytes=0,skipped=0
 const summary=()=>({counts,files,bytes,skipped,coverage:'allowlisted-recent-log-tails',complete:false,limitations:['empty-counts-do-not-prove-no-errors','only-latest-three-log-tails-up-to-32768-bytes-each']})
 if(!logRoot)return summary()
 const stat=await lstat(logRoot).catch(()=>null)
 if(!stat?.isDirectory()||stat.isSymbolicLink())return summary()
 let candidates
 try{candidates=await recentLogFiles(logRoot,signal,{count:3,extension:/\.log$/})}catch{signal?.throwIfAborted();skipped++;return summary()}
 skipped+=candidates.skipped
 for(const entry of candidates.entries){
  signal?.throwIfAborted();let file
  try{file=await readEvidenceFile(logRoot,entry.path,32768,{tail:true,signal})}catch{signal?.throwIfAborted();skipped++;continue}
  files++;bytes+=file.bytesRead
  for(const word of file.text.match(/\b[A-Z][A-Z_]{3,64}\b/g)??[])if(codes.has(word))counts[word]=(counts[word]??0)+1
 }
 return summary()
}
