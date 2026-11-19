import {opendir,lstat,realpath,open} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute,win32} from 'node:path'
import {fileURLToPath} from 'node:url'
import {constants} from 'node:fs'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {inside} from '../runtime/paths.js'
import {redactFeedback} from './redaction.js'
import {investigationBudget} from './investigation-budget.js'
import {retryEvidenceRead} from './diagnostic-contract.js'
const error=code=>{throw Object.assign(new Error(code),{code})}
const sourceRoots=['src','packages/web-console/src','packages/web-console/server','packages/dingtalk-core','packages/dingtalk-dws','bin']
const extensions=/\.(?:[cm]?js|tsx?)$/
const validOffset=value=>{const offset=value??0;if(!Number.isSafeInteger(offset)||offset<0)error('FEEDBACK_OFFSET_INVALID');return offset}
function page(items,offset,count,metadata){
 const result={...metadata,items:[],nextOffset:null};let end=offset
 while(end<items.length&&end-offset<count){
  result.items.push(items[end])
  if(JSON.stringify(result).length>investigationBudget.pageCharacters-100){result.items.pop();if(end===offset){end++;result.complete=false;result.limitations=[...result.limitations,'single-item-exceeds-page-budget']}break}
  end++
 }
 result.nextOffset=end<items.length?end:null
 return result
}
const knownCodes=['ENOENT','EACCES','EPERM','ECONNREFUSED','ECONNRESET','ETIMEDOUT','SQLITE_BUSY','SQLITE_LOCKED','MODEL_REQUEST_FAILED','CHANNEL_ADAPTER_ERROR','CHANNEL_HISTORY_INCOMPLETE','CHANNEL_HISTORY_RECOVERY_FAILED','DINGTALK_CURSOR_PERSIST_FAILED','DINGTALK_START_FAILED','DWS_CHANNEL_IO_FAILED','AUTH_REQUIRED','BOT_NOT_READY']
const codePatterns=knownCodes.map(code=>[code,new RegExp('\\b'+code+'\\b')])
const categoryPatterns=[['timeout',/timeout|timed out|超时/i],['permission',/permission denied|access denied/i],['connection',/connection (?:refused|reset)/i],['failed',/error|fail|exception|失败|错误/i]]
const numericPatterns=['durationMs','elapsedMs','statusCode','errno','attempt','retryCount'].map(key=>[key,new RegExp('(?:^|\\s)'+key+'=(-?\\d+(?:\\.\\d+)?)(?=\\s|$)')])
let nativePath
async function openedPath(fd){
 if(process.platform==='linux')return realpath('/proc/self/fd/'+fd)
 if(!nativePath){
  const koffi=createRequire(import.meta.url)('koffi')
  if(process.platform==='win32'){
   const kernel=koffi.load('kernel32.dll'),node=koffi.load(null),handle=node.func('uv_get_osfhandle','void *',['int']),getPath=kernel.func('GetFinalPathNameByHandleW','uint32',['void *','void *','uint32','uint32'])
   nativePath=fd=>{const buffer=Buffer.alloc(65536),length=getPath(handle(fd),buffer,32768,0);if(!length||length>=32768)error('FEEDBACK_EVIDENCE_SCOPE');const path=buffer.toString('utf16le',0,length*2);return path.startsWith('\\\\?\\UNC\\')?'\\\\'+path.slice(8):path.replace(/^\\\\\?\\/,'')}
  }else if(process.platform==='darwin'){
   const fcntl=koffi.load('/usr/lib/libSystem.B.dylib').func('fcntl','int',['int','int','void *'])
   nativePath=fd=>{const buffer=Buffer.alloc(1024);if(fcntl(fd,50,buffer)!==0)error('FEEDBACK_EVIDENCE_SCOPE');return buffer.toString('utf8',0,buffer.indexOf(0))}
  }else error('FEEDBACK_EVIDENCE_SCOPE')
 }
 return nativePath(fd)
}
/** Verify the opened handle, not just pathnames which can change before open. */
export function readEvidenceFile(root,path,maxBytes,options={}){
 return retryEvidenceRead(()=>readEvidenceFileOnce(root,path,maxBytes,options),options.signal)
}
async function readEvidenceFileOnce(root,path,maxBytes,{tail=false,signal}={}){
 signal?.throwIfAborted();const base=resolve(root),file=resolve(path)
 if(!inside(base,file)||await realpath(base)!==base||await realpath(file)!==file)error('FEEDBACK_EVIDENCE_SCOPE')
 const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)error('FEEDBACK_EVIDENCE_SCOPE')
 const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0))
 try{
  const current=await fd.stat()
  if(!current.isFile()||current.nlink!==1||current.ino!==stat.ino||current.dev!==stat.dev||resolve(await openedPath(fd.fd))!==file)error('FEEDBACK_EVIDENCE_SCOPE')
  if(!tail&&current.size>maxBytes)return null
  const size=Math.min(current.size,maxBytes),buffer=Buffer.alloc(size),start=tail?Math.max(0,current.size-size):0
  let bytesRead=0
  while(bytesRead<size){signal?.throwIfAborted();const chunk=await fd.read(buffer,bytesRead,size-bytesRead,start+bytesRead);if(!chunk.bytesRead)error('FEEDBACK_EVIDENCE_CHANGED');bytesRead+=chunk.bytesRead}
  const after=await fd.stat();if(!tail&&(after.size!==current.size||after.mtimeMs!==current.mtimeMs))error('FEEDBACK_EVIDENCE_CHANGED')
  let text=buffer.toString('utf8');if(start){const first=text.indexOf('\n');text=first<0?'':text.slice(first+1)}
  return {text,truncated:start>0,bytesRead,sha256:createHash('sha256').update(buffer).digest('hex')}
 }finally{await fd.close()}
}
/** Scan the full directory, retaining only the newest candidates. */
export async function recentLogFiles(root,signal,{count=6,extension=/\.(?:log|jsonl)$/}={}){
 const entries=[];let skipped=0
 for await(const entry of await opendir(root)){
  signal?.throwIfAborted();if(!entry.isFile()||!extension.test(entry.name))continue
  const path=join(root,entry.name)
  try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1){skipped++;continue}entries.push({path,mtime:stat.mtimeMs});entries.sort((a,b)=>b.mtime-a.mtime||a.path.localeCompare(b.path));entries.splice(count)}catch{signal?.throwIfAborted();skipped++}
 }
 return {entries,skipped}
}
/** No arbitrary path, shell, credentials, skill or runtime-data reader. */
export function createLocalEvidence({paths,secrets=[],codeRoot=paths.installRoot}){
 codeRoot=resolve(codeRoot)
 const aliases=new Map(),snapshots=new Map();let sequence=0,retainedRows=0,retainedCharacters=0,logsSnapshot
 const add=(path,kind)=>{for(const [alias,row] of aliases)if(row.path===path&&row.kind===kind)return alias;const alias=kind+'-'+(++sequence);aliases.set(alias,{path,kind});return alias}
 const retain=(items,item)=>{const size=JSON.stringify(item).length;if(retainedRows>=10000||retainedCharacters+size>2*1024*1024)return false;items.push(item);retainedRows++;retainedCharacters+=size;return true}
 async function* files(root,signal,state){
  let dir
  try{const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()){state.skipped++;return}dir=await opendir(root)}catch(e){signal?.throwIfAborted();if(e.code!=='ENOENT'||!sourceRoots.some(sub=>root===join(codeRoot,sub)))state.skipped++;return}
  try{for await(const entry of dir){signal?.throwIfAborted();if(entry.name.startsWith('.')||['node_modules','data','dist','skills'].includes(entry.name))continue
   const path=join(root,entry.name);if(entry.isDirectory())yield*files(path,signal,state);else if(entry.isFile()&&extensions.test(entry.name))yield path
  }}catch{signal?.throwIfAborted();state.skipped++}
 }
 async function logFields(line,frameCache){
  let row;try{row=JSON.parse(line)}catch{row={}}
  const codes=codePatterns.filter(([,pattern])=>pattern.test(line)).map(([code])=>code),categories=categoryPatterns.filter(([,pattern])=>pattern.test(line)).map(([name])=>name)
  const value={codes,categories}
  for(const [key,pattern] of numericPatterns){if(Number.isFinite(row?.[key]))value[key]=row[key];else{const match=line.match(pattern);if(match)value[key]=Number(match[1])}}
  for(const key of ['time','timestamp']){const raw=row?.[key],time=typeof raw==='number'?raw:typeof raw==='string'?Date.parse(raw):NaN;if(Number.isFinite(time)&&Math.abs(time)<=8640000000000000)value[key]=new Date(time).toISOString()}
  if(!value.time&&!value.timestamp){const match=line.match(/^\[?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))/);if(match&&Number.isFinite(Date.parse(match[1])))value.timestamp=new Date(match[1]).toISOString()}
  if(['debug','info','warn','error','fatal'].includes(row?.level))value.level=row.level
  const frames=[],stack=typeof row?.error?.stack==='string'?row.error.stack:typeof row?.stack==='string'?row.stack:line
  for(const match of stack.matchAll(/\(([^()\r\n]+?\.[cm]?[jt]sx?):(\d+)(?::(\d+))?\)|(?:^|\n)\s*(?:at\s+)?((?:file:\/\/\/|[A-Za-z]:[\\/]|\/|(?:src|packages|bin)[\\/])[^\r\n]+?\.[cm]?[jt]sx?):(\d+)(?::(\d+))?(?=\s*(?:$|\n))/g)){
   if(frames.length>=12)break
   const token=match[1]??match[4],lineNumber=match[2]??match[5],column=match[3]??match[6];let path
   try{path=token.startsWith('file:')?fileURLToPath(token):token;if(win32.isAbsolute(path)&&!isAbsolute(path))continue;path=resolve(codeRoot,path)}catch{continue}
   if(!frameCache.has(path)){
    const rel=relative(codeRoot,path).replaceAll('\\','/');let allowed=null
    if(inside(codeRoot,path)&&sourceRoots.some(root=>rel.startsWith(root+'/')))try{if(await realpath(path)===path)allowed=rel}catch{}
    frameCache.set(path,allowed)
   }
   const source=frameCache.get(path)
   if(source){const frame={path:source,line:Number(lineNumber),column:column?Number(column):null};if(JSON.stringify(frames).length+JSON.stringify(frame).length>5000){value.framesTruncated=true;break}frames.push(frame)}
  }
  value.frames=frames;value.messageWithheld=true
  return !codes.length&&!categories.length&&!frames.length&&Object.keys(value).length===4?null:value
 }
 return async(section,signal,args={})=>{
  signal?.throwIfAborted();const offset=validOffset(args.offset)
  if(section==='code_search'){
   if(typeof args.query!=='string'||!args.query.trim()||args.query.length>200)error('FEEDBACK_CODE_QUERY_INVALID')
   const query=args.query.toLowerCase(),key='code:'+query
   if(!snapshots.has(key))snapshots.set(key,(async()=>{
    const state={items:[],scanned:0,bytes:0,skipped:0,truncated:false,availableRoots:0}
    for(const sub of sourceRoots)if((await lstat(join(codeRoot,sub)).catch(()=>null))?.isDirectory())state.availableRoots++
    outer:for(const sub of sourceRoots)for await(const path of files(join(codeRoot,sub),signal,state)){
     if(++state.scanned>3000||state.bytes>=8*1024*1024){state.truncated=true;break outer}
     let file;try{file=await readEvidenceFile(codeRoot,path,256*1024,{signal})}catch{signal?.throwIfAborted();state.skipped++;continue}if(!file){state.skipped++;continue}state.bytes+=file.bytesRead
     const lines=redactFeedback(file.text,secrets,{maxLength:Infinity,preserveLines:true}).split('\n')
     for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(query)){
      if(!retain(state.items,{alias:add(path,'code'),path:relative(codeRoot,path).replaceAll('\\','/'),line:i+1,text:lines[i].slice(0,500)})){state.truncated=true;break outer}
     }
    }
    return state
   })())
   const {items,scanned,bytes,skipped,truncated,availableRoots}=await snapshots.get(key)
   return page(items,offset,20,{scanned,bytes,skipped,complete:!truncated&&!skipped&&availableRoots>0,coverage:availableRoots?'installed-product-source-snapshot':'source-unavailable',limitations:['source-may-differ-from-loaded-process','excluded-data-skills-dependencies-and-build-output',...truncated?['source-scan-or-snapshot-budget-reached']:[]]})
  }
  if(section==='code_read'){
   const row=aliases.get(args.alias);if(row?.kind!=='code')error('FEEDBACK_ALIAS_INVALID')
   const file=await readEvidenceFile(codeRoot,row.path,256*1024,{signal});if(!file)return {coverage:'source-file-too-large',complete:false}
   const lines=redactFeedback(file.text,secrets,{maxLength:Infinity,preserveLines:true}).split('\n'),characterOffset=validOffset(args.characterOffset)
   if(offset>=lines.length||characterOffset>lines[offset].length)error('FEEDBACK_OFFSET_INVALID')
   const meta={alias:args.alias,path:relative(codeRoot,row.path).replaceAll('\\','/'),sha256:file.sha256,fromLine:offset+1,totalLines:lines.length}
   const room=Math.max(0,Math.floor((investigationBudget.pageCharacters-JSON.stringify(meta).length-500)/2))
   let line=offset,column=characterOffset,content='',count=0
   while(line<lines.length&&count<80){
    const prefix=(content?'\n':'')+(line+1)+(column?':'+(column+1):'')+': ',remaining=room-content.length-prefix.length
    if(remaining<=0)break
    const text=lines[line].slice(column,column+remaining);content+=prefix+text;column+=text.length;count++
    if(column<lines[line].length)break
    line++;column=0
   }
   return {...meta,toLine:line+(column?1:0),nextOffset:line<lines.length?line:null,nextCharacterOffset:column,content,complete:line===lines.length}
  }
  if(section==='logs'){
   if(args.query!==undefined&&(typeof args.query!=='string'||!args.query.trim()||args.query.length>200))error('FEEDBACK_CODE_QUERY_INVALID')
   if(!logsSnapshot)logsSnapshot=(async()=>{
    const root=paths.logs,stat=root&&await lstat(root).catch(()=>null)
    if(!stat?.isDirectory()||stat.isSymbolicLink())return {items:[],skipped:0,truncated:false,unavailable:true}
    const {entries,skipped}=await recentLogFiles(root,signal),state={items:[],skipped,truncated:false},frameCache=new Map()
    outer:for(const entry of entries){
     let file;try{file=await readEvidenceFile(root,entry.path,65536,{tail:true,signal})}catch{signal?.throwIfAborted();state.skipped++;continue}
     const alias=add(entry.path,'log'),lines=file.text.split('\n')
     for(let i=0;i<lines.length;i++){
      signal?.throwIfAborted();if(!lines[i])continue
      const value=await logFields(lines[i],frameCache);if(!value)continue
      if(!retain(state.items,{log:alias,lineInTail:i+1,tailTruncated:file.truncated,content:redactFeedback(JSON.stringify(value),secrets)})){state.truncated=true;break outer}
     }
    }
    return state
   })()
   // Match only public fields. Raw private bodies must not become a query oracle.
   const snapshot=await logsSnapshot,query=args.query?.toLowerCase(),items=query?snapshot.items.filter(row=>row.content.toLowerCase().includes(query)):snapshot.items
   return page(items,offset,10,{skipped:snapshot.skipped,complete:false,coverage:snapshot.unavailable?'logs-unavailable':'six-recent-log-tails-64k-each-snapshot',limitations:['retained-tail-not-full-history','message-bodies-and-private-fields-omitted','redaction-is-best-effort','line-number-relative-to-tail','empty-result-not-proof-of-no-error',...snapshot.truncated?['snapshot-budget-reached']:[]]})
  }
  error('FEEDBACK_EVIDENCE_SCOPE')
 }
}
