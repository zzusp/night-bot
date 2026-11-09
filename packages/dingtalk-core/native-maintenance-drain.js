import {buildSessionProjection,convertToLlm} from '@earendil-works/pi-coding-agent'
import {readFileSync, lstatSync, openSync, fstatSync, closeSync, constants} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
import {decodePiJournal,piJournalFilename} from '../../src/runtime/pi-journal.js'
import {taskSessionLogRoot} from './task-session-persistence.js'
import {taskFilePath} from './session-workspaces.js'
import { isolationDigest as hash } from './native-restart-isolation.js'

function checkDirectories(directory){
 let current=resolve(directory)
 for(;;){const info=lstatSync(current);if(!info.isDirectory()||info.isSymbolicLink())throw Error('DEPLOY_LOG_REPARSE_POINT');const parent=dirname(current);if(parent===current)break;current=parent}
}
function readStableBytes(path){
 checkDirectories(dirname(path));const before=lstatSync(path)
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error('DEPLOY_LOG_REPARSE_POINT')
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
 try{
  const opened=fstatSync(fd)
  if(opened.dev!==before.dev||opened.ino!==before.ino||!opened.isFile()||opened.nlink!==1)throw Error('DEPLOY_NATIVE_LOG_IDENTITY')
  const bytes=readFileSync(fd),after=fstatSync(fd),named=lstatSync(path)
  if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs||bytes.length!==opened.size
   ||named.dev!==opened.dev||named.ino!==opened.ino||named.nlink!==1||named.isSymbolicLink()
   ||named.size!==opened.size||named.mtimeMs!==opened.mtimeMs||named.ctimeMs!==opened.ctimeMs)throw Error('DEPLOY_NATIVE_LOG_CHANGED')
  checkDirectories(dirname(path));return bytes
 }finally{closeSync(fd)}
}
/** Read one exact Pi journal without discovery, migration or repair. A task's
 * own identity marker selects its archive path. Older Night Bot Pi layouts use
 * the task router's path; no DSH event format or directory importer is involved.
 */
export function readNativeHistory(workspace,row,{pathCodec}={}){
 const taskRoot=dirname(taskFilePath(workspace,row.taskId,'work'));let owner
 try{owner=JSON.parse(readStableBytes(join(taskRoot,'.task-session.json')).toString('utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 if(owner!==undefined&&(owner?.version!==1||owner.taskId!==row.taskId||owner.sessionId!==row.sessionId))throw Error('DEPLOY_NATIVE_LOG_IDENTITY')
 const directory=owner?taskFilePath(workspace,row.taskId,'sessions'):taskSessionLogRoot(workspace,row.taskId)
 const path=join(directory,piJournalFilename(row.sessionId)),bytes=readStableBytes(path)
 const decoded=decodePiJournal(bytes,row.sessionId,{requireComplete:true,codec:pathCodec})
 if(!pathCodec&&decoded.header.portableCwd!==undefined)throw Error('PI_SESSION_PATH_CODEC_REQUIRED')
   const projection=buildSessionProjection(decoded.entries,decoded.entries.at(-1)?.id??null);convertToLlm(projection.messages)
  return {header:decoded.header,audit:decoded.audit,auditEntries:decoded.entries.filter(entry=>entry.type==='custom'&&entry.customType==='night.audit').map((entry,index)=>({...entry,data:decoded.audit[index]})),terminalEntryId:decoded.entries.findLast(entry=>!(entry.type==='custom'&&entry.customType==='night.commit'))?.id,context:{engine:'pi-session-manager',projection,piMessages:projection.messages},digest:hash({text:bytes.toString('utf8')}),path,format:decoded.format}
}
