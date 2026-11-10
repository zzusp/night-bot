import {watch} from 'chokidar'
import {join} from 'node:path'
import {atomicWrite,withLock,failure} from '../runtime/files.js'
import {inside} from '../runtime/paths.js'
import {installedSkills,botSkillRoots,commonSkillPath} from './skill-usage.js'
import {boundedRead,contentSnapshot,priorSnapshot,CONTENT_LIMIT} from './previous.js'

const MAX_ITEMS=128,STATE_LIMIT=MAX_ITEMS*CONTENT_LIMIT*5
/** File skills are edited outside our store as well. Keep only the current and
 * last observed body; skipped/offline intermediate edits are never invented. */
export class InstalledSkillPrevious {
  constructor(directory,paths,extra=[]){this.file=join(directory,'installed-previous.json');this.paths=paths;this.extra=extra;this.closed=false;this.pending=new Set();this.removed=new Map();this.removalSequence=0;this.error=null}
  async readState(){
    const raw=await boundedRead(this.file,STATE_LIMIT)
    if(!raw)return {version:1,items:{}}
    const value=JSON.parse(raw.text)
    if(value.version!==1||!value.items||typeof value.items!=='object'||Array.isArray(value.items)||Object.keys(value.items).length>MAX_ITEMS)throw failure('EVOLUTION_SNAPSHOT_INVALID')
    for(const [id,row]of Object.entries(value.items))if(!/^[a-f0-9]{64}$/.test(id)||!priorSnapshot(row.current)||row.previous&&!priorSnapshot(row.previous))throw failure('EVOLUTION_SNAPSHOT_INVALID')
    return value
  }
  scan({itemId}={}){
    if(this.closed)return Promise.resolve()
    const job=withLock(this.file+'.lock',async()=>{
      const removed=[...this.removed],state=await this.readState(),next={version:1,items:{}},bodies=new Map();let observedCount=0
      const inventory=await installedSkills(this.paths,this.extra,{onContent:(item,body)=>{observedCount++;if(bodies.size<MAX_ITEMS||item.id===itemId||bodies.has(item.id))bodies.set(item.id,{item,body})}})
      for(const [id,{body}]of [...bodies].slice(0,MAX_ITEMS)){
        const current=contentSnapshot(body.text,body.revision,body.updatedAt)
        // Unsafe/deleted resources are removed, never retained in a hidden history.
        if(!current)continue
        const prior=removed.some(([path])=>inside(path,body.path))?null:state.items[id]
        next.items[id]=prior?.current.revision===current.revision?prior:{current,previous:priorSnapshot(prior?.current),observedAt:new Date().toISOString()}
      }
      if(JSON.stringify(state)!==JSON.stringify(next))await atomicWrite(this.file,JSON.stringify(next)+'\n')
      for(const [path,sequence]of removed)if(this.removed.get(path)===sequence)this.removed.delete(path)
      this.error=this.watchError??(observedCount>MAX_ITEMS?'EVOLUTION_SNAPSHOT_LIMIT':inventory.complete?null:'EVOLUTION_SNAPSHOT_PARTIAL')
      return {inventory,state:next,bodies}
    })
    this.pending.add(job);job.finally(()=>this.pending.delete(job)).catch(()=>{})
    return job
  }
  requestScan(){
    if(this.closed)return
    this.scanRequested=true
    if(this.background)return this.background
    const job=(async()=>{
      do{this.scanRequested=false;try{await this.scan()}catch{this.error='EVOLUTION_SNAPSHOT_UNAVAILABLE'}}while(this.scanRequested&&!this.closed)
    })()
    this.background=job;job.finally(()=>{this.background=undefined}).catch(()=>{})
    return job
  }
  relevant(path){return typeof path==='string'&&commonSkillPath(this.paths,path)&&botSkillRoots(this.paths,this.extra).some(root=>inside(this.paths.installRoot,root)&&inside(root,path))}
  async start(){
    const roots=botSkillRoots(this.paths,this.extra).filter(root=>inside(this.paths.installRoot,root)&&commonSkillPath(this.paths,root))
    if(!roots.length){await this.scan();return}
    this.watcher=watch(roots,{ignoreInitial:true,followSymlinks:false,depth:24,awaitWriteFinish:{stabilityThreshold:100,pollInterval:25}})
    this.watcher.on('all',(event,path)=>{if(this.relevant(path)&&!this.closed){if(event==='unlink'||event==='unlinkDir')this.removed.set(path,++this.removalSequence);this.requestScan()}})
    this.watcher.on('error',()=>{this.watchError=this.error='EVOLUTION_SNAPSHOT_UNAVAILABLE'})
    await new Promise(resolve=>{this.watcher.once('ready',resolve);this.watcher.once('error',resolve)})
    await this.scan()
  }
  async close(){this.closed=true;await this.watcher?.close();await this.background;await Promise.allSettled([...this.pending])}
}
