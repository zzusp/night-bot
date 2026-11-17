import {opendir,lstat,realpath,open} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {constants} from 'node:fs'
import {createHash} from 'node:crypto'
import {inside} from '../runtime/paths.js'
import {redactFeedback} from './redaction.js'
const error=code=>{throw Object.assign(new Error(code),{code})}
const sourceRoots=['src','packages/web-console/src','packages/web-console/server','packages/dingtalk-core','packages/dingtalk-dws','bin']
const extensions=/\.(?:[cm]?js|tsx?)$/
const validOffset=value=>{const offset=value??0;if(!Number.isSafeInteger(offset)||offset<0)error('FEEDBACK_OFFSET_INVALID');return offset}
/** No arbitrary path, shell, network, credentials, skill or runtime-data reader.
 * Aliases refer only to files discovered under explicit product-code/log roots. */
export function createLocalEvidence({paths,secrets=[],codeRoot=paths.installRoot}){
 const aliases=new Map();let sequence=0
 const add=(path,kind)=>{for(const [alias,row] of aliases)if(row.path===path&&row.kind===kind)return alias;const alias=kind+'-'+(++sequence);aliases.set(alias,{path,kind});return alias}
 async function safeRead(root,path,maxBytes,tail=false){
  const base=resolve(root),file=resolve(path)
  if(!inside(base,file)||await realpath(base)!==base||await realpath(file)!==file)error('FEEDBACK_EVIDENCE_SCOPE')
  const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)error('FEEDBACK_EVIDENCE_SCOPE')
  const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
  try{const current=await fd.stat();if(current.ino!==stat.ino||current.dev!==stat.dev)error('FEEDBACK_EVIDENCE_SCOPE')
   if(!tail&&current.size>maxBytes)return null
   const size=Math.min(current.size,maxBytes),buffer=Buffer.alloc(size),start=tail?Math.max(0,current.size-size):0,{bytesRead}=await fd.read(buffer,0,size,start)
   let text=buffer.toString('utf8',0,bytesRead);if(start)text=text.slice(text.indexOf('\n')+1)
   return {text,truncated:start>0,bytesRead,sha256:createHash('sha256').update(buffer.subarray(0,bytesRead)).digest('hex')}
  }finally{await fd.close()}
 }
 async function* files(root,signal){
  const stat=await lstat(root).catch(()=>null);if(!stat?.isDirectory()||stat.isSymbolicLink())return
  for await(const entry of await opendir(root)){signal?.throwIfAborted();if(entry.name.startsWith('.')||['node_modules','data','dist','skills'].includes(entry.name))continue
   const path=join(root,entry.name)
   if(entry.isDirectory())yield*files(path,signal)
   else if(entry.isFile()&&extensions.test(entry.name))yield path
  }
 }
 return async(section,signal,args={})=>{
  signal?.throwIfAborted();const offset=validOffset(args.offset)
  if(section==='code_search'){
   if(typeof args.query!=='string'||!args.query.trim()||args.query.length>200)error('FEEDBACK_CODE_QUERY_INVALID')
   const query=args.query.toLowerCase(),matches=[];let scanned=0,bytes=0,truncated=false,skipped=0,availableRoots=0
   for(const sub of sourceRoots)if((await lstat(join(codeRoot,sub)).catch(()=>null))?.isDirectory())availableRoots++
   outer:for(const sub of sourceRoots)for await(const path of files(join(codeRoot,sub),signal)){
    if(++scanned>3000||bytes>=8*1024*1024){truncated=true;break outer}
    let file;try{file=await safeRead(codeRoot,path,256*1024)}catch{skipped++;continue}if(!file){skipped++;continue}bytes+=file.bytesRead
    const lines=file.text.split('\n')
    for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(query)){
     matches.push({alias:add(path,'code'),path:relative(codeRoot,path).replaceAll('\\','/'),line:i+1,text:redactFeedback(lines[i],secrets).slice(0,500)})
     if(matches.length>offset+20){truncated=true;break outer}
    }
   }
   return {items:matches.slice(offset,offset+20),nextOffset:matches.length>offset+20?offset+20:null,scanned,bytes,skipped,complete:!truncated&&!skipped&&availableRoots>0,coverage:availableRoots?'installed-product-source-only':'source-unavailable',limitations:['source-may-differ-from-loaded-process','excluded-data-skills-dependencies-and-build-output']}
  }
  if(section==='code_read'){
   const row=aliases.get(args.alias);if(row?.kind!=='code')error('FEEDBACK_ALIAS_INVALID')
   const file=await safeRead(codeRoot,row.path,256*1024);if(!file)return {coverage:'source-file-too-large',complete:false}
   const lines=file.text.split('\n'),end=Math.min(offset+80,lines.length)
   return {alias:args.alias,path:relative(codeRoot,row.path).replaceAll('\\','/'),sha256:file.sha256,fromLine:offset+1,toLine:end,totalLines:lines.length,nextOffset:end<lines.length?end:null,content:redactFeedback(lines.slice(offset,end).map((text,i)=>`${offset+i+1}: ${text}`).join('\n'),secrets),complete:end===lines.length}
  }
  if(section==='logs'){
   if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>200))error('FEEDBACK_CODE_QUERY_INVALID')
   const root=paths.logs,stat=root&&await lstat(root).catch(()=>null)
   if(!stat?.isDirectory()||stat.isSymbolicLink())return {items:[],complete:false,coverage:'logs-unavailable'}
   const candidates=[];let inspected=0
   for await(const entry of await opendir(root)){signal?.throwIfAborted();if(++inspected>256)break;if(entry.isFile()&&/\.(?:log|jsonl)$/.test(entry.name)){const path=join(root,entry.name),stat=await lstat(path);candidates.push({path,mtime:stat.mtimeMs})}}
   candidates.sort((a,b)=>b.mtime-a.mtime);const items=[]
   for(const entry of candidates.slice(0,6)){
    let file;try{file=await safeRead(root,entry.path,65536,true)}catch{continue}if(!file)continue
    const alias=add(entry.path,'log'),lines=file.text.split('\n')
    for(let i=0;i<lines.length;i++){
     signal?.throwIfAborted();const line=lines[i]
     if(!line||args.query&&!line.toLowerCase().includes(args.query.toLowerCase()))continue
     // Never send arbitrary log message bodies. Preserve diagnostic codes,
     // timestamps, numeric measurements and product source locations only.
     let row;try{row=JSON.parse(line)}catch{row={}}
     const knownCodes=['ENOENT','EACCES','EPERM','ECONNREFUSED','ECONNRESET','ETIMEDOUT','SQLITE_BUSY','SQLITE_LOCKED','MODEL_REQUEST_FAILED','CHANNEL_ADAPTER_ERROR','CHANNEL_HISTORY_INCOMPLETE','CHANNEL_HISTORY_RECOVERY_FAILED','DINGTALK_CURSOR_PERSIST_FAILED','DINGTALK_START_FAILED','DWS_CHANNEL_IO_FAILED','AUTH_REQUIRED','BOT_NOT_READY']
     const codes=knownCodes.filter(code=>new RegExp('\\b'+code+'\\b').test(line)),categories=[['timeout',/timeout|timed out|超时/i],['permission',/permission denied|access denied/i],['connection',/connection (?:refused|reset)/i],['failed',/error|fail|exception|失败|错误/i]].filter(([,pattern])=>pattern.test(line)).map(([name])=>name)
     const value={codes,categories};for(const key of ['durationMs','elapsedMs','statusCode','errno','attempt','retryCount'])if(Number.isFinite(row?.[key]))value[key]=row[key]
     for(const key of ['time','timestamp'])if(typeof row?.[key]==='string'&&Number.isFinite(Date.parse(row[key])))value[key]=new Date(row[key]).toISOString()
     if(['debug','info','warn','error','fatal'].includes(row?.level))value.level=row.level
     const frames=[];for(const match of line.matchAll(/((?:src|packages|bin)[/\\][A-Za-z0-9_./\\-]+\.[cm]?[jt]sx?):(\d+)(?::(\d+))?/g)){
      const path=match[1].replaceAll('\\','/');if(!path.split('/').includes('..')&&sourceRoots.some(root=>path.startsWith(root+'/')))frames.push({path,line:Number(match[2]),column:match[3]?Number(match[3]):null})
     }value.frames=frames.slice(0,12);value.messageWithheld=true
     if(!codes.length&&!categories.length&&!frames.length&&Object.keys(value).length===4)continue
     items.push({log:alias,lineInTail:i+1,tailTruncated:file.truncated,content:redactFeedback(JSON.stringify(value),secrets).slice(0,1200)})
    }
   }
   return {items:items.slice(offset,offset+10),nextOffset:offset+10<items.length?offset+10:null,complete:false,coverage:'six-recent-log-tails-64k-each',limitations:['retained-tail-not-full-history','message-bodies-and-private-fields-omitted','redaction-is-best-effort','line-number-relative-to-tail','empty-result-not-proof-of-no-error']}
  }
  error('FEEDBACK_EVIDENCE_SCOPE')
 }
}
