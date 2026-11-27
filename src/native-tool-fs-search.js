// Night-owned safe search IO. Pi's public find tool owns its schema/rendering.
// grep uses a bounded packaged-rg port because Pi 1.5 exposes no spawn override.
import z from '@deepseek-ai/schemastery'
import {randomUUID} from 'node:crypto'
import {scopeOf,scopeChainOf} from './native-scope.js'
import {GLOBSTAR,Minimatch} from 'minimatch'
import {createFindToolDefinition,DEFAULT_MAX_BYTES} from '@earendil-works/pi-coding-agent'
import {isAbsolute,join,parse,relative,resolve,sep} from 'node:path'
import {existsSync} from 'node:fs'
import {opendir} from 'node:fs/promises'
import {HarnessError} from './native-llm-protocol.js'
import {officialWorkingDirectoryOrigin} from './native-working-directory.js'
import {boundText} from './runtime/output-window.js'
import {MAX_TIMER_DELAY_MS} from './runtime/deadlines.js'

export class SearchError extends HarnessError{constructor(message,code,options){super(message,code,options);this.code=code}}
const fail=(code,message,cause)=>new SearchError(message,code,cause?{cause}:undefined)
export const RAW_OUTPUT_MAX_BYTES=20_000_000,SEARCH_TIMEOUT_MS=30_000,SEARCH_STDERR_MAX_BYTES=65536,SEARCH_GRACE_MS=3000,SEARCH_META_MAX_BYTES=65536,GREP_MAX_MATCHES=250,GREP_MAX_LINE_BYTES=2000
export const name='night-native-tool-fs-search',inject=['tools','systemPrompt','subprocess','workingDirectory','fs','agents']
export const Config=z.object({globMaxResults:z.number().default(100),grepMaxMatches:z.number().default(GREP_MAX_MATCHES),grepMaxLineBytes:z.number().default(GREP_MAX_LINE_BYTES),searchMetaMaxBytes:z.number().default(SEARCH_META_MAX_BYTES),rawOutputMaxBytes:z.number().default(RAW_OUTPUT_MAX_BYTES),graceMs:z.number().default(SEARCH_GRACE_MS),stderrMaxBytes:z.number().default(SEARCH_STDERR_MAX_BYTES),timeoutMs:z.number().default(SEARCH_TIMEOUT_MS),maxEntries:z.number().default(10000),maxDepth:z.number().default(64)})
const registrations=new WeakMap()
const excludedSearchNames=new Set(['.git','.svn','.hg','.bzr','.jj','.sl','node_modules'])
const accessDenied=e=>['FS_SANDBOX_DENIED','PERMISSION_PRIVATE_PATH_DENIED','EACCES','EPERM'].includes(e.code)
export function isNativeSearchObservationalTool(definition,actor){
 const port=definition&&registrations.get(definition)
 // 搜索注册在 preset generation；仅承认该作用域链上的真实在册 actor。
 return !!actor&&!!port&&port.agents.get(actor.id)===actor&&scopeChainOf(actor).includes(port.scope)&&port.registry.get(definition.name,actor)===definition
}
let executable
export async function resolveRgPath(){
 executable??=Promise.resolve().then(async()=>{
  const p=parse(process.execPath),sidecar=join(p.dir,p.name+'-rg'+(process.platform==='win32'?'.exe':''))
  if('pkg'in process&&existsSync(sidecar))return sidecar
  const path=(await import('@vscode/ripgrep')).rgPath
  return process.versions.electron?path.replace(/\.asar(?=[\\/])/u,'.asar.unpacked'):path
 });return executable
}
function aborted(signal){if(signal?.aborted)throw fail('SEARCH_ABORTED','Search canceled')}
export function toWorkdirRelative(path,cwd){const rel=relative(cwd,path);return !isAbsolute(path)?path:rel==='..'||rel.startsWith('..'+sep)?path:rel||'.'}
export function previewLine(value,maxBytes){const result=boundText(value,{headBytes:maxBytes});return result.text+(result.truncated?' (line truncated)':'')}
export async function runRipgrep(ctx,exec,toolName,argv,maxBytes,graceMs,stderrMaxBytes,cwd){
 aborted(exec.signal);cwd??=await ctx.workingDirectory.ensure(exec.agent,exec.signal)
 let handle,outcome,problem
 try{handle=ctx.subprocess.spawn({argv:[await resolveRgPath(),'--no-config',...argv],cwd,stdio:{stdin:'ignore',stdout:{maxBytes},stderr:{maxBytes:stderrMaxBytes}},graceMs,signal:exec.signal})}catch(e){aborted(exec.signal);throw fail('SEARCH_FAILED','Search process could not start'+(typeof e?.code==='string'?' ('+e.code+')':''),e)}
 try{outcome=await handle.done}catch(e){problem=e}
 // Completion includes the process range; never release a canceled native tool
 // while its subprocess owner still reports live descendants.
 try{if(typeof handle.waitForExit!=='function')throw Error('Missing process-range drain capability');await handle.waitForExit()}catch(e){throw fail('SEARCH_DRAIN_FAILED','Search process range could not be proven stopped',e)}
 aborted(exec.signal)
 if(problem)throw fail('SEARCH_FAILED','Search process failed',problem)
 const stdout=handle.collected.stdout?.readFrom(0),stderr=handle.collected.stderr?.readFrom(0)
 if(!stdout||!stderr)throw fail('SEARCH_FAILED','Search output capture missing')
 if(outcome.signal!==null||outcome.exitCode===null)throw fail('SEARCH_FAILED','Search process terminated unexpectedly')
 // Exit 1 is ripgrep's clean no-match status, but a containing process
 // (including isolation startup) can return the same code with diagnostics.
 if(outcome.exitCode===1&&(stderr.text.length>0||stderr.lossy||stderr.nextOffset>0))throw fail('SEARCH_FAILED','Search process reported diagnostics instead of a clean no-match result')
 if(![0,1].includes(outcome.exitCode))throw fail(/regex parse error|error parsing glob/i.test(stderr.text)?'SEARCH_INVALID_PATTERN':'SEARCH_FAILED',`Search pattern/process rejected: ${stderr.text}`)
 if(stdout.lossy||Buffer.byteLength(stdout.text)>maxBytes||stdout.nextOffset>maxBytes)throw fail('SEARCH_RAW_OUTPUT_OVERFLOW','Complete search exceeds raw byte cap; narrow the search')
 return {stdout:stdout.text,noMatches:outcome.exitCode===1,workdir:cwd}
}
export function parseGrepMatches(stdout){
 const matches=[]
 for(const row of stdout.split('\n')){
  if(!row)continue
  let packet;try{packet=JSON.parse(row)}catch(e){throw fail('SEARCH_FAILED','Invalid ripgrep JSON record',e)}
  if(!packet||typeof packet!=='object'||Array.isArray(packet))throw fail('SEARCH_FAILED','Invalid search record')
  if(packet.type!=='match')continue
  const data=packet.data,path=data?.path?.text,lineNumber=data?.line_number,line=data?.lines
  if(typeof path!=='string'||!Number.isSafeInteger(lineNumber)||lineNumber<1||!line||typeof line.text!=='string'&&typeof line.bytes!=='string')throw fail('SEARCH_FAILED','Malformed search match')
  matches.push({path,lineNumber,line:typeof line.text==='string'?line.text.replace(/\r?\n$/u,''):'(line is not valid UTF-8)'})
 }
 return matches
}
function textArg(value,label){if(typeof value!=='string'||!value.trim()||value.includes('\0'))throw fail('SEARCH_INVALID_ARGUMENT',`${label} must be non-empty text`);return value}
function searchAuthority(ctx,exec,definition){
 const actor=exec.agent,registry=ctx.get('agents'),tools=ctx.get('tools'),identity=tools.executionIdentity(exec)
 if(!actor?.piSession||registry.get(actor.id)!==actor||registry.currentInitiator()!==actor||identity?.owner!==actor.id||identity.callId!==exec.callId||identity.name!==definition.name||tools.get(definition.name,actor)!==definition)throw fail('SEARCH_ACTOR_REQUIRED','Search requires the actual scoped official invocation')
 officialWorkingDirectoryOrigin(actor)
 const fs=ctx.get('fs');if(typeof fs?.boundary!=='function')throw fail('SEARCH_PRIVATE_FS_REQUIRED','Search requires the private filesystem capability')
 return fs
}
async function allowed(fs,path,cwd,signal){const target=fs.boundary(await fs.resolve(path,{cwd,signal}));return {target,info:await fs.stat(target,signal)}}
export async function enumerateSearchFiles(fs,path,cwd,signal,caps){
 const initial=await allowed(fs,path,cwd,signal),files=[],pending=[{...initial,depth:0}];let count=1,bytes=0
 while(pending.length){
  aborted(signal);const current=pending.pop()
  if(!current.info)continue
  if(count>caps.maxEntries||current.depth>caps.maxDepth)throw fail('SEARCH_ENUMERATION_LIMIT','Search enumeration exceeds entry/depth cap')
  // Recheck canonical target at the last point before passing it to a process.
  const fresh=await allowed(fs,current.target.displayPath,cwd,signal)
  if(fresh.target.targetKey!==current.target.targetKey)throw fail('SEARCH_STALE_PATH','Search path changed during enumeration')
  if(fresh.info?.type==='file'){
   const path=fs.processPath(fresh.target);bytes+=Buffer.byteLength(path)+1
   if(bytes>caps.rawOutputMaxBytes)throw fail('SEARCH_ENUMERATION_LIMIT','Search path list exceeds byte cap')
   files.push(path);continue
  }
  if(fresh.info?.type!=='directory')continue
  for await(const entry of await opendir(fs.processPath(fresh.target))){
   aborted(signal);if(++count>caps.maxEntries)throw fail('SEARCH_ENUMERATION_LIMIT','Search enumeration exceeds entry cap')
   if(excludedSearchNames.has(entry.name))continue
   const path=join(fs.processPath(fresh.target),entry.name)
   // Never hand a symlink to rg, even a currently safe alias. This prevents
   // symlink substitution after authorization from turning into recursive IO.
   if(entry.isSymbolicLink())continue
   try{
    if((await fs.lstat(path,{cwd},signal))?.type==='symlink')continue
    const child=await allowed(fs,path,cwd,signal);pending.push({...child,depth:current.depth+1})
   }catch(e){
    // A protected child (for example a task's sessions/) is not a failure of
    // the authorized search root. Keep it out of the subprocess allowlist.
    if(!['FS_SANDBOX_DENIED','PERMISSION_PRIVATE_PATH_DENIED'].includes(e.code))throw e
   }
  }
 }
 return files
}
const findMatcher=pattern=>new Minimatch(pattern.replace(/^(?:\.\/)+/u,''),{dot:true,matchBase:true,nonegate:true,nocomment:true})
const posix=path=>path.split(sep).join('/')
const safeLiteral=value=>typeof value==='string'&&value&&value!=='.'&&value!=='..'&&!/[\\/:]/u.test(value)
const FIND_PAGE_ENTRIES=256,FIND_CURSOR_TTL=180000,FIND_CURSOR_LIMIT=12
// One open directory per paused search. Child paths are not trusted across
// calls; authorization and identity are checked again when an item is used.
async function inspectFind(fs,state,path,cwd,signal,explicit=false){
 try{
  const lexical=await fs.lstat(path,{cwd},signal)
  if(!lexical)return
  if(lexical.type==='symlink'){if(explicit)state.links++;return}
  const {target,info}=await allowed(fs,path,cwd,signal)
  if(relative(path,fs.processPath(target))!==''||info?.version!==lexical.version)throw fail('SEARCH_STALE_PATH','Search path changed; start again in a narrower directory')
  return info
 }catch(e){
  if(!accessDenied(e))throw e
  state.denied++
 }
}
async function closeFindDirectory(state){
 const current=state.current;state.current=null
 if(current)await current.dir.close().catch(()=>{})
}
async function probeFindPrefix(fs,state,cwd,signal,caps,segments){
 let base=state.root
 for(const [i,name] of segments.entries()){
  if(excludedSearchNames.has(name))return
  if(i+1>caps.maxDepth){state.skipped++;return}
  base=join(base,name)
  const info=await inspectFind(fs,state,base,cwd,signal,true)
  if(info?.type==='file'&&i+1===segments.length&&state.matcher.match(posix(relative(state.root,base))))state.direct.push(base)
  if(info?.type!=='directory')return
 }
 return base
}
async function beginFind(fs,path,cwd,pattern,signal,caps){
 const initial=await allowed(fs,path,cwd,signal),root=fs.processPath(initial.target),matcher=findMatcher(pattern)
 if(!initial.info)throw fail('SEARCH_INVALID_ARGUMENT','Search path was not found')
 const rootInfo=await fs.lstat(path,{cwd},signal)
 if(rootInfo?.type==='symlink')throw fail('SEARCH_INVALID_ARGUMENT','Search roots cannot be symbolic links')
 const state={root,rootKey:initial.target.targetKey,matcher,dirs:[],current:null,finished:0,denied:0,skipped:0,links:0,direct:[],earlyMatch:null}
 const first=matcher.set[0]
 const literalPrefix=matcher.set.length===1&&first?.length>1?first.findIndex(segment=>!safeLiteral(segment)):-1
 const length=matcher.set.length===1&&first?.length>1?(literalPrefix<0?first.length:literalPrefix):0
 if(initial.info.type==='file'){
  if(matcher.match(posix(relative(root,root))))state.direct.push(root)
  return state
 }
 if(initial.info.type!=='directory')return state
 if(matcher.set.length===1&&first?.[0]===GLOBSTAR&&first.length>2&&first.slice(1).every(safeLiteral)){
  // The requested suffix can already resolve under this candidate root.
  // Search the remaining locations only within the normal page budget.
  await probeFindPrefix(fs,state,cwd,signal,caps,first.slice(1))
  state.earlyMatch=state.direct[0]??null
 }
 const base=length?await probeFindPrefix(fs,state,cwd,signal,caps,first.slice(0,length)):root
 // When an exact file pattern names a directory, no descendant can match.
 if(!base||length&&length===first.length)return state
 state.dirs.push({path:base,depth:length})
 return state
}
async function findPage(fs,state,searchPath,cwd,signal,caps,limit){
 const files=[],deadline=performance.now()+Math.max(1,Math.min(10000,caps.timeoutMs*0.5))
 const maxEntries=Math.min(caps.maxEntries,FIND_PAGE_ENTRIES),matchBase=state.matcher.set.some(row=>row.length===1)
 // Pi truncates rendered relative paths independently of the raw path budget.
 // Keep room for the coverage notice and cursor in the final tool response.
 const outputBudget=Math.min(DEFAULT_MAX_BYTES,Math.max(1,caps.searchMetaMaxBytes-1024))
 let visited=0,rawBytes=0,outputBytes=0
 function append(file){
  const raw=Buffer.byteLength(file)+1,shown=Buffer.byteLength(posix(relative(searchPath,file)))+1
  if(raw>caps.rawOutputMaxBytes||shown>outputBudget)throw fail('SEARCH_RESULT_LIMIT','One find path exceeds the page byte budget; search under a narrower directory')
  if(rawBytes+raw>caps.rawOutputMaxBytes||outputBytes+shown>outputBudget){state.direct.push(file);return false}
  files.push(file);rawBytes+=raw;outputBytes+=shown
  return true
 }
 if(state.current){
  const current=state.current,info=await inspectFind(fs,state,current.path,cwd,signal)
  if(info?.type!=='directory'||info.version!==current.version)throw fail('SEARCH_STALE_PATH','The paused directory changed; search that directory again')
 }
 for(const file of state.direct.splice(0)){
  if((await inspectFind(fs,state,file,cwd,signal))?.type==='file')append(file)
 }
 while((state.current||state.dirs.length)&&files.length<limit&&visited<maxEntries&&performance.now()<deadline){
  aborted(signal)
  if(!state.current){
   const next=state.dirs.shift();visited++
   const info=await inspectFind(fs,state,next.path,cwd,signal)
   if(info?.type!=='directory')continue
   let dir
   try{dir=await opendir(next.path)}catch(e){if(accessDenied(e)){state.denied++;continue}throw e}
   state.current={...next,version:info.version,dir}
   const opened=await inspectFind(fs,state,next.path,cwd,signal)
   if(opened?.type!=='directory'||opened.version!==info.version)throw fail('SEARCH_STALE_PATH','Search directory changed while opening')
   continue
  }
  const {dir,path,depth}=state.current
  let entry
  try{entry=await dir.read()}catch(e){if(accessDenied(e)){state.denied++;await closeFindDirectory(state);continue}throw e}
  aborted(signal)
  if(!entry){state.finished++;state.lastFinished=posix(relative(state.root,path))||'.';await closeFindDirectory(state);continue}
  visited++
  if(excludedSearchNames.has(entry.name)||entry.isSymbolicLink())continue
  const child=join(path,entry.name),rel=posix(relative(state.root,child))
  if(entry.isDirectory()){
   if(!matchBase&&!state.matcher.match(rel,true))continue
   if(depth+1>caps.maxDepth||state.dirs.length>=caps.maxEntries){state.skipped++;continue}
   state.dirs.push({path:child,depth:depth+1})
  }else if(entry.isFile()&&child!==state.earlyMatch&&state.matcher.match(rel)){
   if(depth+1>caps.maxDepth){state.skipped++;continue}
   const info=await inspectFind(fs,state,child,cwd,signal)
   if(info?.type!=='file')continue
   if(!append(child))break
  }
 }
 return files
}
function batches(files){const groups=[];let group=[],size=0;for(const file of files){const bytes=Buffer.byteLength(file)+1;if(bytes>16000)throw fail('SEARCH_ENUMERATION_LIMIT','Search filename exceeds argv budget');if(size+bytes>16000){groups.push(group);group=[];size=0}group.push(file);size+=bytes}if(group.length)groups.push(group);return groups}
async function capture(ctx,exec,caps,cwd,files,flags){
 const parts=[];let bytes=0
 for(const group of batches(files)){
  // Repeat authorization after every subprocess join, before the next starts.
  for(const path of group){const fs=ctx.get('fs'),check=await allowed(fs,path,cwd,exec.signal);if(fs.processPath(check.target)!==path||check.info?.type!=='file'||(await fs.lstat(path,{cwd},exec.signal))?.type==='symlink')throw fail('SEARCH_STALE_PATH','Search file identity changed before dispatch')}
  const result=await runRipgrep(ctx,exec,exec.name,[...flags,'--',...group],caps.rawOutputMaxBytes-bytes,caps.graceMs,caps.stderrMaxBytes,cwd)
  bytes+=Buffer.byteLength(result.stdout);if(bytes>caps.rawOutputMaxBytes)throw fail('SEARCH_RAW_OUTPUT_OVERFLOW','Search aggregate raw cap exceeded');parts.push(result.stdout)
 }
 return parts.join('')
}
async function saveComplete(ctx,exec,text){
 const store=ctx.get('spillStore');if(!store)return undefined
 try{return await store.saveText({owner:{sessionId:exec.agent.id},source:{kind:'tool',toolName:exec.name,callId:exec.callId,label:'result'},suggestedName:'search-results.txt',content:text})}catch(e){ctx.logger.warn('Search complete-result retention failed: '+String(e));return undefined}
}
const output={schema:{type:'object',required:['text'],properties:{text:{type:'string'}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:value.text}]}
export async function apply(ctx,caps){
 for(const [key,value]of Object.entries(caps))if(!Number.isSafeInteger(value)||value<1||key==='graceMs'&&value>MAX_TIMER_DELAY_MS)throw Error('Invalid search resource cap: '+key)
 const official=createFindToolDefinition('.')
 const cursors=new Map()
 function takeCursor(id){
  const row=cursors.get(id)
  if(row){cursors.delete(id);clearTimeout(row.timer)}
  return row
 }
 async function discardCursor(id){const row=takeCursor(id);if(row)await closeFindDirectory(row.state)}
 function saveCursor(state,exec,cwd,path,pattern){
  if(cursors.size>=FIND_CURSOR_LIMIT)return
  const id=randomUUID()
  const timer=setTimeout(()=>{void discardCursor(id)},FIND_CURSOR_TTL);timer.unref()
  cursors.set(id,{state,actor:exec.agent,cwd,path,pattern,timer})
  return id
 }
 const parameters=JSON.parse(JSON.stringify(official.parameters))
 parameters.properties.cursor={type:'string',description:'Resume an incomplete search with the same path and pattern using the returned cursor.'}
 const find={name:official.name,description:official.description.replace('Respects .gitignore.','')+' If a relative subpath is known, pass it as pattern under the smallest candidate path. Incomplete results include coverage and may supply a cursor. Only authorized regular files are returned; symlinks, VCS and node_modules are excluded; .gitignore is not applied.',parameters,timeoutMs:caps.timeoutMs,output,
  async execute(args,exec){
   const fs=searchAuthority(ctx,exec,find),cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal),pending=new Set()
   textArg(args.pattern,'pattern');if(args.path!==undefined)textArg(args.path,'path')
   if(args.limit!==undefined&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>caps.globMaxResults))throw fail('SEARCH_INVALID_ARGUMENT','find limit exceeds configured result budget')
   if(args.cursor!==undefined)textArg(args.cursor,'cursor')
   let coverage='',nextCursor
   const operations={exists:async path=>(await allowed(fs,path,cwd,exec.signal)).info!==undefined,glob:async(pattern,path,options)=>{
    const job=(async()=>{
     let state
     try{
      if(args.cursor!==undefined){
       const prior=cursors.get(args.cursor)
       if(!prior||prior.actor!==exec.agent||prior.cwd!==cwd||prior.path!==path||prior.pattern!==pattern)throw fail('SEARCH_CURSOR_INVALID','Search cursor expired or does not match this session, path and pattern')
       state=takeCursor(args.cursor).state
       const root=await allowed(fs,path,cwd,exec.signal)
       if(root.target.targetKey!==state.rootKey)throw fail('SEARCH_STALE_PATH','Search root changed; start again')
      }else state=await beginFind(fs,path,cwd,pattern,exec.signal,caps)
      const matches=await findPage(fs,state,path,cwd,exec.signal,caps,options.limit)
      aborted(exec.signal)
      const remaining=state.dirs.length+Number(!!state.current)
      const more=remaining||state.direct.length
      if(more||state.denied||state.skipped||state.links){
       if(more)nextCursor=saveCursor(state,exec,cwd,path,pattern)
       const label=value=>previewLine(JSON.stringify(value),256)
       const progress=state.finished+' directories finished'+(state.lastFinished?', latest '+label(state.lastFinished):'')
       const unchecked=remaining?'; '+remaining+' discovered directories still pending (may contain more)'+(state.current?', including the remainder of '+label(posix(relative(state.root,state.current.path))||'.'):''):''
       const buffered=state.direct.length?'; a matching path is buffered for the next page':''
       const restricted=state.denied?'; '+state.denied+' paths were not checked because access was denied':''
       const skipped=state.skipped?'; '+state.skipped+' paths were not checked because search bounds were reached':''
       const links=state.links?'; '+state.links+' symbolic link paths were not checked':''
       coverage='[Search incomplete: '+progress+unchecked+buffered+restricted+skipped+links+'.'+(nextCursor?' Continue with the same path and pattern, cursor='+nextCursor+'.':more||state.skipped?' Narrow the search to an authorized candidate directory.':'')+']'
      }else if(args.cursor)coverage='[Search complete: all remaining searchable directories checked.]'
      return matches
     }finally{if(state&&!nextCursor)await closeFindDirectory(state)}
    })();pending.add(job);try{return await job}finally{pending.delete(job)}
   }}
   const tool=createFindToolDefinition(cwd,{operations})
   let result
   try{
    try{result=await tool.execute(exec.callId,{...args,limit:args.limit??caps.globMaxResults},exec.signal,undefined,{cwd})}finally{await Promise.allSettled([...pending])}
    let text=result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')
    if(coverage)text=(text==='No files found matching pattern'?(args.cursor?'No additional matches in this page.':'No matches in the checked scope.'):text)+'\n\n'+coverage
    if(Buffer.byteLength(text)>caps.searchMetaMaxBytes)throw fail('SEARCH_RESULT_LIMIT','find output exceeds configured byte cap')
    return {text}
   }catch(e){if(nextCursor)await discardCursor(nextCursor);throw e}
  }}
 const grep={name:'grep',description:'Search authorized regular files with packaged ripgrep regex. Bounded results; complete larger results are saved privately.',parameters:{type:'object',required:['pattern'],additionalProperties:false,properties:{pattern:{type:'string',minLength:1},path:{type:'string',minLength:1},include:{type:'string',minLength:1}}},timeoutMs:caps.timeoutMs,output,
  async execute(args,exec){
   const fs=searchAuthority(ctx,exec,grep),cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal)
   textArg(args.pattern,'pattern');if(args.path!==undefined)textArg(args.path,'path');if(args.include!==undefined)textArg(args.include,'include')
   const files=await enumerateSearchFiles(fs,args.path??'.',cwd,exec.signal,caps),raw=await capture(ctx,exec,caps,cwd,files,['--json',`--regexp=${args.pattern}`,...args.include===undefined?[]:[`--glob=${args.include}`]])
   const authorized=new Set(files),matches=parseGrepMatches(raw)
   // This is a transport-integrity check, in addition to pre-dispatch allowlist.
   for(const match of matches)if(!authorized.has(resolve(cwd,match.path)))throw fail('SEARCH_FAILED','Search returned an unauthorized file identity')
   const lines=matches.map(match=>`${toWorkdirRelative(match.path,cwd)}:${match.lineNumber}: ${previewLine(match.line,caps.grepMaxLineBytes)}`)
   const shown=lines.slice(0,caps.grepMaxMatches),truncated=lines.length>shown.length
   const spill=truncated?await saveComplete(ctx,exec,lines.join('\n')):undefined
   const header=truncated?`Found ${shown.length} of ${lines.length} matches`:`Found ${lines.length} matches`
   const rendered=lines.length?`${header}\n\n${shown.join('\n')}${truncated?`\n\n${spill?`Full grep result stored at: ${spill.locator}. ${spill.retrievalHint}`:'Complete result could not be saved; narrow the search.'}`:''}`:'No matches found'
   // Bound the retained tool value as well as raw transport. A single huge line
   // cannot evade a result-count limit or inflate model/session metadata.
   if(Buffer.byteLength(rendered)>caps.searchMetaMaxBytes)throw fail('SEARCH_RESULT_LIMIT','Rendered search exceeds result byte cap; narrow the search')
   return {text:rendered}
  }}
 for(const definition of [find,grep]){registrations.set(definition,{scope:scopeOf(ctx),agents:ctx.agents,registry:ctx.tools});ctx.tools.register(definition)}
 const searchGuidance='Use read when a file path is known. For a known subpath, use find in the smallest authorized candidate directory. After an incomplete search or timeout, first narrow using task materials, source attachments or delivery records. Continue broad searches with the returned cursor only when necessary. Unchecked or denied scope is not a no-match result. Use grep to search contents.'
 ctx.systemPrompt.section({name:'tool:safe-search',order:ctx.systemPrompt.getSectionOrder('TOOL_GREP'),text:()=>searchGuidance,officialText:()=>searchGuidance})
}
