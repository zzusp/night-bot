import {diffLines} from 'diff'
import {join} from 'node:path'
import {bindingSchema,readableScopes} from './scope.js'
import {hash} from './format.js'
import {failure,withLock} from '../runtime/files.js'
import {contentSnapshot,priorSnapshot,boundedRead,CONTENT_LIMIT} from './previous.js'
import {learnedSkillSupported} from './evolution.js'

export function latestComparison(current,previous,basis='saved',reason='not_recorded'){
  if(!previous)return {status:'no_previous',reason,basis,added:0,removed:0,lines:[]}
  const parts=diffLines(previous.text,current.text,{maxEditLength:2000,timeout:100})??[{removed:true,value:previous.text},{added:true,value:current.text}]
  const lines=parts.flatMap(part=>{const values=part.value.split('\n');if(values.at(-1)==='')values.pop();return values.map(text=>({type:part.added?'added':part.removed?'removed':'unchanged',text}))})
  return {status:'available',basis,added:lines.filter(row=>row.type==='added').length,removed:lines.filter(row=>row.type==='removed').length,lines}
}
const checked=(text,revision,updatedAt)=>{const value=contentSnapshot(text,revision,updatedAt);if(!value)throw failure('EVOLUTION_BODY_FORBIDDEN');return value}
const checkVersion=(current,expected)=>{if(String(current)!==expected)throw failure('EVOLUTION_VERSION_STALE')}
/** Explicit authenticated body read. IDs are matched against accessible records;
 * never resolve a caller-supplied filesystem path or infer a missing version. */
export async function inspectEvolutionItem(memory,reflection,readerBinding,{id,revision}={}){
  if(!/^[a-f0-9]{64}$/.test(id??'')||typeof revision!=='string'||!/^(?:[a-f0-9]{64}|\d{1,16})$/.test(revision))throw failure('EVOLUTION_ITEM_NOT_FOUND')
  const binding=bindingSchema.parse(readerBinding)
  for(const {scope}of readableScopes(binding)){
    const found=await memory.store.transaction(scope,state=>{
      const active=entry=>!entry.expiresAt||Date.parse(entry.expiresAt)>memory.store.now()
      const entries=[...[...state.topics].flatMap(([topic,value])=>value.entries.map(entry=>({topic,entry,status:'applied'}))),...state.candidates.map(entry=>({topic:entry.topic,entry,status:'candidate'}))]
      for(const {topic,entry,status}of entries){
        if(!active(entry)||hash(JSON.stringify([scope.kind,scope.id,'memory',status,topic,entry.key]))!==id)continue
        checkVersion(entry.revision,revision)
        const current=checked(entry.text,entry.revision,entry.updatedAt),previous=priorSnapshot(entry.previous)
        return {id,name:topic+'/'+entry.key,kind:'memory',revision:entry.revision,current,previous,comparison:latestComparison(current,previous,'saved',entry.previous===null?'unsafe_previous':entry.revision===1?'new_entry':'not_recorded'),redacted:false}
      }
      return null
    })
    if(found)return found
    const learned=await withLock(join(reflection.directory(scope),'.lock'),async()=>{
      const state=await reflection.state(scope)
      for(const [key,value]of Object.entries(state.skills)){
        if(hash(JSON.stringify([scope.kind,scope.id,'skill',key]))!==id)continue
        checkVersion(value.revision,revision)
        const entries=(await memory.store.read(scope,{topic:'experience'})).entries
        if(value.active&&!learnedSkillSupported(value,entries))throw failure('EVOLUTION_BODY_FORBIDDEN')
        if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)||key.length>60)throw failure('EVOLUTION_BODY_FORBIDDEN')
        let text=reflection.renderSkill(scope,key,value,0)
        if(value.active){
          const saved=await boundedRead(join(reflection.directory(scope),'skills',key,'SKILL.md'),CONTENT_LIMIT,{root:memory.store.directory(scope)})
          const marker=saved?.text.match(/NIGHT_LEARNED_SCOPE=([^;]+);revision=(\d+)/)
          if(!marker||marker[1]!==scope.kind+'/'+scope.id||saved.text!==reflection.renderSkill(scope,key,value,Number(marker[2])))throw failure('EVOLUTION_BODY_FORBIDDEN')
          text=saved.text
        }
        const current=checked(text.replace(/^NIGHT_LEARNED_SCOPE=[^\n]*\n?/gm,''),value.revision,value.updatedAt),previous=priorSnapshot(value.previous)
        return {id,name:'learned-'+key,kind:'skill',revision:value.revision,current,previous,comparison:latestComparison(current,previous,'saved',value.previous===null?'unsafe_previous':value.revision===1?'new_entry':'not_recorded'),redacted:false}
      }
      return null
    })
    if(learned)return learned
  }
  if(memory.installedPrevious){
    const result=await memory.installedPrevious.scan({itemId:id}),item=result?.inventory.items.find(row=>row.id===id)
    if(item){
      checkVersion(item.revision,revision)
      const retained=result.state.items[id]
      // Bounded snapshots may omit an oversized, secret-bearing or excess file.
      const observed=retained?.current??result.bodies.get(id)?.body
      if(!observed)throw failure('EVOLUTION_BODY_FORBIDDEN')
      const current=checked(observed.text,observed.revision,observed.updatedAt),previous=priorSnapshot(retained?.previous)
      return {id,name:item.name,kind:'skill',revision:item.revision,current,previous,comparison:latestComparison(current,previous,'observed'),redacted:false}
    }
  }
  throw failure('EVOLUTION_ITEM_NOT_FOUND')
}
