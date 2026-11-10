import {join,dirname,resolve,basename} from 'node:path'
import {lstat,mkdir,open,link,unlink,readdir} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {atomicWrite,readRegular,withLock,failure} from '../runtime/files.js'
import {localStamp,lastDueDay,shiftDay,validDay} from './calendar.js'
import {renderWorkLog} from './evidence.js'

async function directory(path){
 const target=resolve(path),parent=dirname(target)
 if(parent!==target)await directory(parent)
 await mkdir(target,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error})
 const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw failure('WORK_LOG_PATH_UNSAFE')
}
async function regular(path){
 let stat=await lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error})
 if(stat?.isFile()&&!stat.isSymbolicLink()&&stat.nlink===2&&/^\d{4}-\d{2}-\d{2}\.md$/.test(basename(path))){
  // Recover only this publisher's exact temporary link after a crash between
  // atomic publication and unlink. Unrelated hard links remain forbidden.
  const prefix='.write-'+basename(path)+'-'
  for(const name of await readdir(dirname(path)))if(name.startsWith(prefix)&&/^[0-9a-f-]{36}$/.test(name.slice(prefix.length))){
   const temp=join(dirname(path),name),candidate=await lstat(temp)
   if(candidate.isFile()&&!candidate.isSymbolicLink()&&candidate.ino===stat.ino&&candidate.dev===stat.dev){await unlink(temp);stat=await lstat(path);break}
  }
 }
 if(stat&&(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1))throw failure('WORK_LOG_PATH_UNSAFE');return stat
}
/** Publish atomically without replacing even a concurrently created user file. */
async function publish(path,text){
 await directory(dirname(path));if(await regular(path))return false
 const temporary=join(dirname(path),'.write-'+basename(path)+'-'+randomUUID());let file
 try{
  file=await open(temporary,'wx',0o600);await file.writeFile(text);await file.sync();await file.close();file=undefined
  try{await link(temporary,path)}catch(error){if(error.code!=='EEXIST')throw error;await regular(path);return false}
  await unlink(temporary)
  if(process.platform!=='win32'){const folder=await open(dirname(path),'r');try{await folder.sync()}finally{await folder.close()}}
  return true
 }finally{await file?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
}
export class DailyWorkLog {
 constructor({paths,config,collect,secrets=async()=>[],clock=Date.now,onError=()=>{},intervalMs=30000}){
  Object.assign(this,{paths,config,collect,secrets,clock,onError,intervalMs});this.closed=false;this.timer=undefined;this.running=undefined;this.lastError=null
  this.output=paths.workLogs??join(paths.data??paths.state,'work-logs');this.stateRoot=join(paths.state,'work-log')
 }
 async start(){
  if(this.closed)return
  if(!this.config.enabled){
   this.running=(async()=>{await directory(this.stateRoot);await withLock(join(this.stateRoot,'.lock'),async()=>{
    if(this.closed)return
    const file=join(this.stateRoot,'scheduler.json');await regular(file);const raw=await readRegular(file);let prior
    try{prior=raw===undefined?{}:JSON.parse(raw)}catch{throw failure('WORK_LOG_CHECKPOINT_INVALID')}
    if(raw!==undefined&&(prior?.version!==1||!validDay(prior.nextDay)))throw failure('WORK_LOG_CHECKPOINT_INVALID')
    await atomicWrite(file,JSON.stringify({...prior,version:1,nextDay:localStamp(this.clock(),this.config.timezone).day,disabled:true})+'\n')
   })})().catch(error=>{this.lastError=error.code??'WORK_LOG_FAILED';try{this.onError(this.lastError)}catch{}}).finally(()=>{this.running=undefined})
   await this.running;return
  }
  await this.tick();this.arm()
 }
 arm(){if(this.closed||!this.config.enabled||this.timer)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.tick().finally(()=>this.arm())},this.intervalMs);this.timer.unref?.()}
 tick(){
  if(this.closed||!this.config.enabled)return Promise.resolve([])
  if(this.running)return this.running
  this.running=this.drive().then(result=>{this.lastError=null;return result},error=>{this.lastError=error.code??'WORK_LOG_FAILED';try{this.onError(this.lastError)}catch{}return []}).finally(()=>{this.running=undefined})
  return this.running
 }
 async drive(){
  await directory(this.stateRoot)
  return withLock(join(this.stateRoot,'.lock'),async()=>{
   if(this.closed)return []
   const now=this.clock(),today=localStamp(now,this.config.timezone).day,due=lastDueDay(now,this.config),stateFile=join(this.stateRoot,'scheduler.json')
   await regular(stateFile)
   const raw=await readRegular(stateFile)
   let state
   try{state=raw===undefined?{version:1,nextDay:today}:JSON.parse(raw)}catch{throw failure('WORK_LOG_CHECKPOINT_INVALID')}
   if(state?.version!==1||!validDay(state.nextDay))throw failure('WORK_LOG_CHECKPOINT_INVALID')
   if(state.disabled){state={...state,nextDay:today,disabled:false};await atomicWrite(stateFile,JSON.stringify(state)+'\n')}
   // First activation starts today; a later restart resumes that persistent date.
   if(raw===undefined)await atomicWrite(stateFile,JSON.stringify(state)+'\n')
   const results=[]
   for(let count=0;state.nextDay<=due&&count<31&&!this.closed;count++){
    const day=state.nextDay,path=join(this.output,day.slice(0,4),day.slice(5,7),day+'.md')
    await directory(dirname(path))
    let status='existing'
    if(!await regular(path)){
     const evidence=await this.collect({day,timezone:this.config.timezone,cutoff:now})
     if(this.closed)break
     if(evidence.active){const values=await this.secrets();status=await publish(path,renderWorkLog({day,timezone:this.config.timezone,cutoff:now,evidence,secrets:values}))?'written':'existing'}else status='empty'
    }
    // Publication precedes the checkpoint. After a crash, an existing date file
    // is preserved and acknowledged, never regenerated or appended twice.
    state={version:1,nextDay:shiftDay(day),lastDay:day,lastStatus:status,timezone:this.config.timezone,processedAt:new Date(now).toISOString()}
    await atomicWrite(stateFile,JSON.stringify(state)+'\n');results.push({day,status,...status!=='empty'?{path}:{}})
   }
   return results
  })
 }
 async close(){this.closed=true;clearTimeout(this.timer);this.timer=undefined;await this.running}
}
