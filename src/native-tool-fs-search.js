// Night-owned safe search IO. Pi's public find tool owns its schema/rendering.
// grep uses a bounded packaged-rg port because Pi 1.5 exposes no spawn override.
import z from '@deepseek-ai/schemastery'
import {createFindToolDefinition} from '@earendil-works/pi-coding-agent'
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
 try{handle=ctx.subprocess.spawn({argv:[await resolveRgPath(),'--no-config',...argv],cwd,stdio:{stdin:'ignore',stdout:{maxBytes},stderr:{maxBytes:stderrMaxBytes}},graceMs,signal:exec.signal})}catch(e){aborted(exec.signal);throw fail('SEARCH_FAILED','Search process could not start',e)}
 try{outcome=await handle.done}catch(e){problem=e}
 // Completion includes the process range; never release a canceled native tool
 // while its subprocess owner still reports live descendants.
 try{if(typeof handle.waitForExit!=='function')throw Error('Missing process-range drain capability');await handle.waitForExit()}catch(e){throw fail('SEARCH_DRAIN_FAILED','Search process range could not be proven stopped',e)}
 aborted(exec.signal)
 if(problem)throw fail('SEARCH_FAILED','Search process failed',problem)
 const stdout=handle.collected.stdout?.readFrom(0),stderr=handle.collected.stderr?.readFrom(0)
 if(!stdout||!stderr)throw fail('SEARCH_FAILED','Search output capture missing')
 if(outcome.signal!==null||outcome.exitCode===null)throw fail('SEARCH_FAILED','Search process terminated unexpectedly')
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
   if(['.git','.svn','.hg','.bzr','.jj','.sl','node_modules'].includes(entry.name))continue
   const path=join(fs.processPath(fresh.target),entry.name)
   // Never hand a symlink to rg, even a currently safe alias. This prevents
   // symlink substitution after authorization from turning into recursive IO.
   if(entry.isSymbolicLink()||(await fs.lstat(path,{cwd},signal))?.type==='symlink')continue
   try{const child=await allowed(fs,path,cwd,signal);pending.push({...child,depth:current.depth+1})}catch(e){if(e.code!=='FS_SANDBOX_DENIED')throw e}
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
 const find={name:official.name,description:official.description.replace('Respects .gitignore.','')+' Night searches an explicit authorized regular-file allowlist; .gitignore is not applied, and symlinks/VCS/node_modules are excluded.',parameters:JSON.parse(JSON.stringify(official.parameters)),timeoutMs:caps.timeoutMs,output,
  async execute(args,exec){
   const fs=searchAuthority(ctx,exec,find),cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal),pending=new Set()
   textArg(args.pattern,'pattern');if(args.path!==undefined)textArg(args.path,'path')
   if(args.limit!==undefined&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>caps.globMaxResults))throw fail('SEARCH_INVALID_ARGUMENT','find limit exceeds configured result budget')
   const operations={exists:async path=>(await allowed(fs,path,cwd,exec.signal)).info!==undefined,glob:async(pattern,path,options)=>{
    const job=(async()=>{const files=await enumerateSearchFiles(fs,path,cwd,exec.signal,caps),raw=await capture(ctx,exec,caps,cwd,files,['--files','--null','--hidden',`--glob=${pattern}`]);return raw.split('\0').filter(Boolean).slice(0,options.limit)})();pending.add(job);try{return await job}finally{pending.delete(job)}
   }}
   const tool=createFindToolDefinition(cwd,{operations})
   let result
   try{result=await tool.execute(exec.callId,{...args,limit:args.limit??caps.globMaxResults},exec.signal,undefined,{cwd})}finally{await Promise.allSettled([...pending])}
   const text=result.content.filter(block=>block.type==='text').map(block=>block.text).join('\n');if(Buffer.byteLength(text)>caps.searchMetaMaxBytes)throw fail('SEARCH_RESULT_LIMIT','find output exceeds configured byte cap');return {text}
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
 ctx.tools.register(find);ctx.tools.register(grep)
 ctx.systemPrompt.section({name:'tool:safe-search',order:ctx.systemPrompt.getSectionOrder('TOOL_GREP'),text:()=> 'Use find to discover authorized files and grep to search their contents. Use read for surrounding context.',officialText:()=> 'Use find to discover authorized files and grep to search their contents. Use read for surrounding context.'})
}
