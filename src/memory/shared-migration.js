import {join} from 'node:path'
import {readdir,lstat} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {readRegular,atomicWrite,withLock,failure,privateDirectory} from '../runtime/files.js'
import {memoryScope} from './scope.js'
import {hash} from './format.js'
const directories=async path=>{const entries=await readdir(path,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error});if(entries.some(entry=>!entry.isDirectory()||entry.isSymbolicLink()))throw failure('MEMORY_MIGRATION_PATH_UNSAFE');return entries.map(entry=>entry.name).sort()}
// Copy-only and resumable. The portable Host installation lease excludes old
// writers before this runs. Legacy originals are retained as an offline backup.
export async function migrateSharedMemory(store){
 const shared=memoryScope({actorId:'host-migration'}),target=store.directory(shared)
 await privateDirectory(store.root)
 return withLock(join(store.root,'.shared-migration.lock'),async()=>{
  await privateDirectory(target)
  const marker=await readRegular(join(target,'migration.json'));if(marker){let saved;try{saved=JSON.parse(marker)}catch{throw failure('MEMORY_MIGRATION_STATE_INVALID')}if(saved.version!==1||saved.status!=='completed'||!Number.isSafeInteger(saved.imported)||!Number.isSafeInteger(saved.conflicts))throw failure('MEMORY_MIGRATION_STATE_INVALID');return {imported:saved.imported,conflicts:saved.conflicts}}
  let imported=0,conflicts=0
  for(const kind of ['personal','group','project']){
   const root=join(store.root,'v1',kind)
   const info=await lstat(root).catch(error=>{if(error.code==='ENOENT')return;throw error})
   if(info?.isSymbolicLink())throw failure('MEMORY_MIGRATION_PATH_UNSAFE')
   for(const id of await directories(root)){
    if(!/^[a-f0-9]{64}$/.test(id))throw failure('MEMORY_MIGRATION_PATH_UNSAFE')
    const legacy={kind,id},token=hash(kind+':'+id),snapshot=await store.transaction(legacy,state=>({meta:state.meta,topics:[...state.topics],candidates:state.candidates}))
    const report=await store.transaction(shared,state=>{
     state.meta.legacyImports??={}
     if(state.meta.legacyImports[token])return state.meta.legacyImports[token]
     const mapping={},counts={imported:0,conflicts:0}
     const copy=(topic,entry,candidate)=>{
      const key=topic+'\0'+entry.key,topicState=state.topics.get(topic)??{topic,entries:[]}
      const list=candidate?state.candidates:topicState.entries,prior=list.find(row=>row.key===entry.key&&(!candidate||row.topic===topic))??(candidate?topicState.entries.find(row=>row.key===entry.key):undefined)
      if(prior?.text===entry.text){prior.origins=[...new Map([...(prior.origins??[]),...(entry.origins??[]),...entry.provenance?[entry.provenance]:[]].map(value=>[JSON.stringify(value),value])).values()];prior.legacySources=[...(prior.legacySources??[]),{kind,id,source:entry.source}];mapping[key]=prior.key;return}
      let name=entry.key,conflict=!!prior
      if(conflict){name=entry.key.slice(0,50)+'-migrated-'+hash(token+'\0'+topic+'\0'+entry.id+'\0'+entry.text).slice(0,10);const base=name;let suffix=1;while(state.candidates.some(row=>row.topic===topic&&row.key===name&&row.text!==entry.text))name=base+'-'+suffix++;counts.conflicts++}
      const copied={...entry,...conflict||[...state.topics.values()].some(value=>value.entries.some(row=>row.id===entry.id))||state.candidates.some(row=>row.id===entry.id)?{id:randomUUID()}: {},key:name,scope:'bot',migration:{legacyKind:kind,legacyScope:id,originalKey:entry.key,conflict},...candidate||conflict?{topic}: {}}
      if(conflict){if(!state.candidates.some(row=>row.topic===topic&&row.key===name))state.candidates.push(copied)}
      else {list.push(copied);if(!candidate)state.topics.set(topic,topicState)}
      mapping[key]=name;counts.imported++
     }
     for(const [topic,value]of snapshot.topics)for(const entry of value.entries)copy(topic,entry,false)
     for(const entry of snapshot.candidates)copy(entry.topic,entry,true)
     state.meta.forgotten=[...new Set([...state.meta.forgotten,...snapshot.meta.forgotten])]
     state.meta.seen=[...new Set([...state.meta.seen,...snapshot.meta.seen])]
     const report={...counts,mapping};state.meta.legacyImports[token]=report;state.mark();return report
    })
    imported+=report.imported;conflicts+=report.conflicts
    const usage=await readRegular(join(store.directory(legacy),'usage.json'))
    if(usage)await withLock(join(target,'usage.json.lock'),async()=>{
     const old=JSON.parse(usage),path=join(target,'usage.json'),current=JSON.parse(await readRegular(path)??'null')
     if(old.version!==1||!Number.isFinite(Date.parse(old.trackingSince))||['readCount','searchCount','loadCount'].some(key=>!Number.isSafeInteger(old[key])||old[key]<0))throw failure('EVOLUTION_USAGE_INVALID')
     const value=current??{version:1,trackingSince:old.trackingSince,readCount:0,searchCount:0,loadCount:0}
     value.legacyImports??=[];if(value.legacyImports.includes(token))return
     for(const key of ['readCount','searchCount','loadCount']){value[key]+=old[key];if(!Number.isSafeInteger(value[key]))throw failure('EVOLUTION_USAGE_INVALID')}
     for(const key of ['memoryLastUsedAt','skillLastUsedAt'])if(old[key]&&(!value[key]||value[key]<old[key]))value[key]=old[key]
     if(old.trackingSince<value.trackingSince)value.trackingSince=old.trackingSince
     value.legacyImports.push(token);await atomicWrite(path,JSON.stringify(value)+'\n')
    })
    const legacyEvolution=join(store.directory(legacy),'evolution'),legacyInfo=await lstat(legacyEvolution).catch(error=>{if(error.code==='ENOENT')return;throw error});if(legacyInfo&&(!legacyInfo.isDirectory()||legacyInfo.isSymbolicLink()))throw failure('MEMORY_MIGRATION_PATH_UNSAFE')
    const raw=await readRegular(join(legacyEvolution,'state.json'))
    if(raw)await withLock(join(target,'evolution','.lock'),async()=>{
     const old=JSON.parse(raw),path=join(target,'evolution','state.json'),state=JSON.parse(await readRegular(path)??'{"version":1,"reviews":{},"skills":{}}')
     if(old.version!==1||!old.reviews||!old.skills||Object.keys(old.reviews).some(id=>!/^[a-f0-9]{64}$/.test(id)))throw failure('MEMORY_MIGRATION_STATE_INVALID')
     const writeReports=async()=>{for(const [id,report]of Object.entries(state.reviews)){if(!/^[a-f0-9]{64}$/.test(id))throw failure('MEMORY_MIGRATION_STATE_INVALID');const destination=join(target,'evolution','reviews',id+'.json'),text=JSON.stringify(report,null,2)+'\n';if(await readRegular(destination)!==text)await atomicWrite(destination,text)}}
     state.legacyImports??=[];if(state.legacyImports.includes(token)){await writeReports();return}
     const skillNames=new Map()
     for(const [key,value]of Object.entries(old.skills)){
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key))throw failure('MEMORY_MIGRATION_STATE_INVALID')
      const name=state.skills[key]&&state.skills[key].signature!==value.signature?key.slice(0,42)+'-import-'+hash(token+'\0'+key+'\0'+value.signature).slice(0,10):key
      if(state.skills[name]&&state.skills[name].signature!==value.signature)throw failure('MEMORY_MIGRATION_SKILL_COLLISION')
      skillNames.set(key,name)
      const supports=(value.supports??[]).map(row=>({...row,memoryKey:report.mapping['experience\0'+row.memoryKey]??row.memoryKey}))
      const previous=state.skills[name]
      const chosen=previous&&(!value.updatedAt||previous.updatedAt&&previous.updatedAt>value.updatedAt)?previous:value
      state.skills[name]={...chosen,revision:Math.max(previous?.revision??0,value.revision??0),active:previous?.active||value.active,supports:[...(previous?.supports??[]),...supports],taskIds:[...new Set([...(previous?.taskIds??[]),...(value.taskIds??[])])],memoryKeys:[...new Set([...(previous?.memoryKeys??[]),...supports.map(row=>row.memoryKey)])],migratedFrom:{kind,id}}
     }
     for(const [key,value]of Object.entries(old.reviews))if(state.reviews[key]&&JSON.stringify(state.reviews[key])!==JSON.stringify(value)){state.legacyReviewConflicts??={};state.legacyReviewConflicts[token+':'+key]=value}else if(!state.reviews[key])state.reviews[key]={...value,migratedFrom:{kind,id},destinations:(value.destinations??[]).map(row=>({...row,...row.memory?{memory:{...row.memory,scope:shared,key:report.mapping[(row.memory.topic??'experience')+'\0'+row.memory.key]??row.memory.key}}:{},...row.skill?{skill:{...row.skill,scope:shared,key:skillNames.get(row.skill.key)??row.skill.key}}:{}}))}
     state.legacyImports.push(token);await atomicWrite(path,JSON.stringify(state,null,2)+'\n');await writeReports()
     // Learned files are derived; the live provider renders from the merged
     // state. inspectTask regenerates/checks these through the same renderer.
    })
   }
  }
  await atomicWrite(join(target,'migration.json'),JSON.stringify({version:1,status:'completed',legacyOriginalsRetained:true,imported,conflicts})+'\n')
  return {imported,conflicts}
 })
}
