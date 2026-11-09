import {memoryDirectory} from './scope.js'
import {join} from 'node:path'
import {readdir,unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {privateDirectory,readRegular,atomicWrite,withLock,failure} from '../runtime/files.js'
import {hash,label,checkedText,encodeTopic,decodeTopic} from './format.js'

const empty=()=>({version:1,revision:0,forgotten:[],seen:[]})
const keyOf=(topic,key)=>hash(topic+'\0'+key)
const active=(entry,now)=>!entry.expiresAt||Date.parse(entry.expiresAt)>now
/** Topic Markdown is authoritative. A redo journal commits topic, candidates,
 * short index and metadata under one cross-process scope lease. */
export class MarkdownMemoryStore {
  constructor(root,{now=Date.now,beforeApply}={}){this.root=root;this.now=now;this.beforeApply=beforeApply;this.pending=new Set();this.closed=false}
  directory(scope){return memoryDirectory(this.root,scope)}
  async transaction(scope,work){
    if(this.closed)throw failure('MEMORY_STORE_CLOSED')
    const operation=this.runTransaction(scope,work);this.pending.add(operation)
    try{return await operation}finally{this.pending.delete(operation)}
  }
  async close(){this.closed=true;await Promise.allSettled([...this.pending])}
  async runTransaction(scope,work){
    const dir=this.directory(scope);await privateDirectory(dir)
    return withLock(join(dir,'.lock'),async()=>{
      const recover=async()=>{
        const raw=await readRegular(join(dir,'pending.json'));if(!raw)return
        const pending=JSON.parse(raw);if(pending.version!==1||!Array.isArray(pending.writes))throw failure('MEMORY_JOURNAL_INVALID')
        for(const [name,text]of pending.writes){if(!/^(?:topics\/[a-f0-9]{64}\.md|candidates\.md|index\.md|scope\.json)$/.test(name))throw failure('MEMORY_JOURNAL_INVALID');const path=join(dir,name);if(text===null)await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e});else await atomicWrite(path,text)}
        await unlink(join(dir,'pending.json'))
      }
      await recover();await privateDirectory(join(dir,'topics'))
      const meta=JSON.parse(await readRegular(join(dir,'scope.json'))??JSON.stringify(empty()))
      if(meta.version!==1||!Number.isSafeInteger(meta.revision)||!Array.isArray(meta.forgotten)||!Array.isArray(meta.seen))throw failure('MEMORY_METADATA_INVALID')
      const topics=new Map()
      for(const name of await readdir(join(dir,'topics'))){if(!/^[a-f0-9]{64}\.md$/.test(name))throw failure('MEMORY_TOPIC_FILE_INVALID');const topic=decodeTopic(await readRegular(join(dir,'topics',name)));if(name!==hash(topic.topic)+'.md'||topic.scope?.id!==scope.id||topic.scope?.kind!==scope.kind)throw failure('MEMORY_TOPIC_FILE_INVALID');topics.set(topic.topic,topic)}
      const rawCandidates=await readRegular(join(dir,'candidates.md')),candidates=rawCandidates?decodeTopic(rawCandidates).entries:[]
      if(rawCandidates){const meta=decodeTopic(rawCandidates);if(meta.scope?.id!==scope.id||meta.scope?.kind!==scope.kind)throw failure('MEMORY_TOPIC_FILE_INVALID')}
      let changed=false
      const state={meta,topics,candidates,mark:()=>changed=true}
      const result=await work(state)
      if(changed){
        meta.revision++;meta.seen=meta.seen.slice(-1024);meta.forgotten=meta.forgotten.slice(-2048)
        const writes=[],existing=new Set(await readdir(join(dir,'topics')))
        for(const [topic,value]of topics){const name=hash(topic)+'.md';existing.delete(name);writes.push(['topics/'+name,value.entries.length?encodeTopic(topic,meta.revision,value.entries,{kind:scope.kind,id:scope.id}):null])}
        for(const name of existing)writes.push(['topics/'+name,null])
        const rows=[...topics].filter(([,v])=>v.entries.some(e=>active(e,this.now()))).sort(([a],[b])=>a.localeCompare(b))
        const index='# Memory index\n\nScope: '+scope.kind+'/'+scope.id+'\nRevision: '+meta.revision+'\n\n'+rows.map(([topic,v])=>`- [${topic}](topics/${hash(topic)}.md) — ${v.entries.filter(e=>active(e,this.now())).length} records`).join('\n')+'\n'
        writes.push(['candidates.md',state.candidates.length?encodeTopic('candidates',meta.revision,state.candidates,{kind:scope.kind,id:scope.id}):null],['index.md',index],['scope.json',JSON.stringify(meta,null,2)+'\n'])
        await atomicWrite(join(dir,'pending.json'),JSON.stringify({version:1,writes}))
        try{await this.beforeApply?.();await recover()}catch(cause){throw Object.assign(failure('MEMORY_COMMIT_UNCERTAIN'),{cause,committed:'uncertain'})}
      }
      return structuredClone(typeof result==='function'?result():result)
    })
  }
  async index(scope){return this.transaction(scope,s=>({revision:s.meta.revision,topics:[...s.topics].map(([topic,value])=>({topic,count:value.entries.filter(e=>active(e,this.now())).length})).filter(t=>t.count).slice(0,40),candidateCount:s.candidates.filter(e=>active(e,this.now())).length}))}
  async read(scope,{topic,key,candidates=false}={}){return this.transaction(scope,s=>({revision:s.meta.revision,entries:(candidates?s.candidates:[...(s.topics.get(topic)?.entries??[])]).filter(e=>(!key||e.key===key)&&active(e,this.now())).slice(0,50)}))}
  async search(scope,{query,limit=10}={}){
    if(typeof query!=='string'||!query.trim()||query.length>200||!Number.isSafeInteger(limit)||limit<1||limit>20)throw failure('MEMORY_QUERY_INVALID')
    const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return this.transaction(scope,s=>({revision:s.meta.revision,mode:'literal-keyword',entries:[...s.topics].flatMap(([topic,value])=>value.entries.filter(e=>active(e,this.now())&&terms.every(term=>(topic+' '+e.key+' '+e.text).toLocaleLowerCase().includes(term))).map(e=>({topic,...e}))).slice(0,limit)}))
  }
  async remember(scope,{topic,key,text,source,originSource,provenance,expectedRevision,expiresAt,candidate=false,scopeRevision}={}){
    if(!label(topic)||!label(key)||!source?.messageId||!source?.sessionId)throw failure('MEMORY_RECORD_INVALID')
    text=checkedText(text)
    checkedText(topic);checkedText(key)
    if(expiresAt!==undefined&&(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=this.now()||!/(Z|[+-]\d\d:\d\d)$/.test(expiresAt)))throw failure('MEMORY_EXPIRY_INVALID')
    return this.transaction(scope,s=>{
      if(scopeRevision!==undefined&&s.meta.revision!==scopeRevision)throw failure('MEMORY_SCOPE_CHANGED')
      const seen=hash(source.sessionId+':'+source.messageId+':'+topic+':'+key+':'+candidate)
      if(s.meta.seen.includes(seen))return {ok:true,duplicate:true,revision:s.meta.revision}
      const topicState=s.topics.get(topic)??{topic,entries:[]},entries=candidate?s.candidates:topicState.entries,prior=entries.find(e=>e.key===key&&(candidate?e.topic===topic:true))
      if(expectedRevision!==undefined&&(prior?.revision??0)!==expectedRevision)throw failure('MEMORY_REVISION_CONFLICT')
      if(candidate&&(s.meta.forgotten.includes(hash(text))||topicState.entries.some(e=>e.key===key)))return {ok:false,code:'MEMORY_CANDIDATE_SUPPRESSED'}
      const now=new Date(this.now()).toISOString(),entry={id:prior?.id??randomUUID(),key,...candidate?{topic}: {},text,revision:(prior?.revision??0)+1,scope:scope.kind,createdAt:prior?.createdAt??now,updatedAt:now,source:{sessionId:source.sessionId,messageId:source.messageId,observedAt:source.observedAt??now,...source.quoteSha256?{quoteSha256:source.quoteSha256}:{},actor:scope.actor},...(provenance?{provenance:structuredClone(provenance)}:{}),origins:[...new Map([...(prior?.origins??[]),...prior?.provenance?[prior.provenance]:[],...provenance?[provenance]:[]].map(value=>[JSON.stringify(value),value])).values()].slice(-32),...expiresAt?{expiresAt}:{}}
      if(originSource)entry.originSource={sessionId:originSource.sessionId,messageId:originSource.messageId,observedAt:originSource.observedAt,quoteSha256:originSource.quoteSha256,actor:originSource.actor}
      if(prior){entries.splice(entries.indexOf(prior),1);if(prior.text!==text)s.meta.forgotten.push(hash(prior.text))}
      entries.push(entry)
      if(!candidate){s.topics.set(topic,topicState);s.candidates=s.candidates.filter(e=>!(e.key===key&&e.topic===topic));s.meta.forgotten=s.meta.forgotten.filter(h=>h!==hash(text))}
      s.meta.seen.push(seen);s.mark()
      return ()=>({ok:true,entry,revision:s.meta.revision,candidate})
    })
  }
  async forget(scope,{topic,key,expectedRevision,source}={}){
    if(!label(topic)||!label(key))throw failure('MEMORY_RECORD_INVALID')
    return this.transaction(scope,s=>{
      const seen=source?.messageId?hash(source.sessionId+':'+source.messageId+':forget:'+topic+':'+key):undefined
      if(seen&&s.meta.seen.includes(seen))return {ok:true,duplicate:true,revision:s.meta.revision}
      const entries=s.topics.get(topic)?.entries??[],prior=entries.find(e=>e.key===key)
      if(expectedRevision!==undefined&&(prior?.revision??0)!==expectedRevision)throw failure('MEMORY_REVISION_CONFLICT')
      for(const entry of [...entries,...s.candidates])if(entry.key===key&&(!entry.topic||entry.topic===topic))s.meta.forgotten.push(hash(entry.text))
      if(prior)entries.splice(entries.indexOf(prior),1)
      s.candidates=s.candidates.filter(e=>e.topic!==topic||e.key!==key)
      if(seen)s.meta.seen.push(seen)
      // Even a missing entry invalidates outstanding extraction generations.
      s.mark();return ()=>({ok:true,forgotten:!!prior,revision:s.meta.revision})
    })
  }
}
