import {contentSnapshot,CONTENT_LIMIT,boundedRead} from './previous.js'
import {memoryDirectory} from './scope.js'
import {join,dirname,resolve} from 'node:path'
import {readdir,unlink,lstat} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {privateDirectory,atomicWrite,withLock,failure} from '../runtime/files.js'
import {hash,label,checkedText,checkedTextWithLimit,encodeTopic,decodeTopic,checkedMemoryContext,memoryContextText,renderRouterMemory,renderMemoryContent} from './format.js'
import {LAYOUT_VERSION,buildLayeredWrites,decodeRootIndex,decodeLegacyRootIndex,decodeCategoryIndex,renderIndex,decodeEntry,entrySourceReference,categoryPath,entryPath,sourcePath} from './layered-format.js'

const withoutPrevious=({previous,...entry})=>entry
const empty=()=>({version:1,revision:0,forgotten:[],seen:[]})
const active=(entry,now)=>!entry.expiresAt||Date.parse(entry.expiresAt)>now
const FILE_LIMIT=64*1024*1024
async function safeAncestors(path){for(let current=dirname(resolve(path));;current=dirname(current)){const info=await lstat(current).catch(error=>{if(error.code==='ENOENT')return;throw error});if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw failure('NIGHT_PATH_UNSAFE');if(dirname(current)===current)break}}
async function safeRead(dir,name){
  const path=join(dir,name),info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error});if(!info)return
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw failure('NIGHT_PATH_UNSAFE')
  if(info.size>FILE_LIMIT)throw failure('MEMORY_FILE_TOO_LARGE')
  try{return (await boundedRead(path,Math.max(1,info.size),{root:dir}))?.text}
  catch(error){if(error.code==='EVOLUTION_BODY_FORBIDDEN')throw failure('NIGHT_PATH_UNSAFE');if(error.code==='EVOLUTION_VERSION_STALE'||error.code==='EVOLUTION_CONTENT_TOO_LARGE')throw failure('NIGHT_PATH_CHANGED');throw error}
}
function metadata(raw){let value;try{value=JSON.parse(raw??JSON.stringify(empty()))}catch{throw failure('MEMORY_METADATA_INVALID')}if(value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.forgotten)||!Array.isArray(value.seen))throw failure('MEMORY_METADATA_INVALID');return value}
const scopeEqual=(a,b)=>a?.id===b?.id&&a?.kind===b?.kind
const scopedTopic=(raw,scope)=>{const value=decodeTopic(raw);if(!scopeEqual(value.scope,scope))throw failure('MEMORY_TOPIC_FILE_INVALID');return value}
/** Strict old-layout decoder used only by explicit offline migration and retained
 * v1 copy/import. It neither repairs pending transactions nor changes originals. */
export async function readLegacySnapshot(directory,scope){
  await safeAncestors(join(directory,'topics','.check'))
  if(await safeRead(directory,'pending.json'))throw failure('MEMORY_MIGRATION_RECOVERY_REQUIRED')
  const meta=metadata(await safeRead(directory,'scope.json'))
  if(meta.layoutVersion!==undefined)throw failure('MEMORY_MIGRATION_LAYOUT_INVALID')
  const topics=new Map()
  for(const name of await readdir(join(directory,'topics')).catch(error=>{if(error.code==='ENOENT')return [];throw error})){
    if(!/^[a-f0-9]{64}\.md$/.test(name))throw failure('MEMORY_TOPIC_FILE_INVALID')
    const value=scopedTopic(await safeRead(directory,'topics/'+name),scope)
    if(name!==hash(value.topic)+'.md'||topics.has(value.topic))throw failure('MEMORY_TOPIC_FILE_INVALID')
    topics.set(value.topic,value)
  }
  const raw=await safeRead(directory,'candidates.md'),candidates=raw?scopedTopic(raw,scope).entries:[]
  return {meta,topics,candidates}
}
/** Explicit offline v3 reader. Never repairs or writes source data. */
export async function readV3Snapshot(directory,scope){
  await safeAncestors(join(directory,'categories','.check'))
  if(await safeRead(directory,'pending.json'))throw failure('MEMORY_MIGRATION_RECOVERY_REQUIRED')
  const meta=metadata(await safeRead(directory,'scope.json'))
  if(meta.layoutVersion!==3)throw failure('MEMORY_MIGRATION_LAYOUT_INVALID')
  const root=decodeLegacyRootIndex(await safeRead(directory,'index.md'),scope),topics=new Map(),files=new Set(['index.md','scope.json','candidates.md'])
  if(root.revision!==meta.revision)throw failure('MEMORY_INDEX_STALE')
  for(const descriptor of root.topics){
    const path=categoryPath(descriptor.topic),raw=await safeRead(directory,path)
    if(hash(raw??'')!==descriptor.sha256)throw failure('MEMORY_INDEX_CHANGED')
    const category=decodeCategoryIndex(raw,scope,descriptor.topic),entries=[];files.add(path)
    if(category.revision!==meta.revision)throw failure('MEMORY_INDEX_STALE')
    for(const row of category.entries){
      const path=entryPath(row.topic,row.key),raw=await safeRead(directory,path);files.add(path)
      if(hash(raw??'')!==row.sha256)throw failure('MEMORY_CONTENT_CHANGED')
      const reference=entrySourceReference(raw)
      if(reference&&(reference.path!==sourcePath(row.id)||!/^[a-f0-9]{64}$/.test(reference.sha256)))throw failure('MEMORY_SOURCE_INVALID')
      if(reference)files.add(reference.path)
      const entry=decodeEntry(raw,{scope,topic:row.topic,key:row.key,includeSources:true,includePrevious:true,sourceText:reference?await safeRead(directory,reference.path):undefined})
      if(entry.id!==row.id||entry.revision!==row.revision)throw failure('MEMORY_INDEX_CHANGED')
      entries.push(entry)
    }
    topics.set(descriptor.topic,{topic:descriptor.topic,entries})
  }
  const candidateText=await safeRead(directory,'candidates.md')
  return {meta,topics,candidates:candidateText?scopedTopic(candidateText,scope).entries:[],files}
}
function allowedWrite(name){
  if(['candidates.md','index.md','scope.json'].includes(name)||/^topics\/[a-f0-9]{64}\.md$/.test(name)||/^sources\/[a-f0-9-]{36}\.md$/.test(name))return true
  const match=/^categories\/([^/]+)\/(?:index\.md|entries\/([^/]+)\.md)$/.exec(name)
  if(!match)return false
  // Logical labels live in checked indices. Bounded hashed path components need
  // not decode back to a label, but must be canonical relative ASCII segments.
  return [match[1],match[2]].filter(Boolean).every(part=>part.length<=146&&/^(?:[a-z0-9_-]|%[0-9A-F]{2})+$/.test(part))
}
/** All readers use the same cross-process lease and recover a committed redo
 * before observing an index. Normal recall opens only selected Markdown layers. */
export class MarkdownMemoryStore {
  constructor(root,{now=Date.now,beforeApply,onRead}={}){this.root=root;this.now=now;this.beforeApply=beforeApply;this.onRead=onRead;this.pending=new Set();this.closed=false}
  directory(scope){return memoryDirectory(this.root,scope)}
  async file(dir,name){this.onRead?.(name);return safeRead(dir,name)}
  async close(){this.closed=true;await Promise.allSettled([...this.pending])}
  async locked(scope,work){
    if(this.closed)throw failure('MEMORY_STORE_CLOSED')
    const operation=(async()=>{const dir=this.directory(scope);await safeAncestors(join(dir,'.lock'));await privateDirectory(dir);return withLock(join(dir,'.lock'),async()=>{
      if(await this.file(dir,'layout-migration.pending.json'))throw failure('MEMORY_LAYOUT_MIGRATION_PENDING')
      await this.recover(dir)
      const raw=await this.file(dir,'scope.json'),meta=metadata(raw)
      if(scope.kind==='bot'&&meta.layoutVersion!==LAYOUT_VERSION){
        const oldIndex=await this.file(dir,'index.md'),oldTopics=await readdir(join(dir,'topics')).catch(error=>{if(error.code==='ENOENT')return [];throw error})
        if(raw||oldIndex||oldTopics.length||await this.file(dir,'candidates.md'))throw failure('MEMORY_LAYOUT_MIGRATION_REQUIRED')
      }
      return work(dir,meta)
    })})()
    this.pending.add(operation);try{return await operation}finally{this.pending.delete(operation)}
  }
  async recover(dir){
    const raw=await this.file(dir,'pending.json');if(!raw)return
    let pending;try{pending=JSON.parse(raw)}catch{throw failure('MEMORY_JOURNAL_INVALID')}
    if(pending.version!==1||!Array.isArray(pending.writes)||pending.writes.some(row=>!Array.isArray(row)||row.length!==2||!allowedWrite(row[0])||row[1]!==null&&typeof row[1]!=='string'))throw failure('MEMORY_JOURNAL_INVALID')
    for(const [name]of pending.writes){const path=join(dir,name);await safeAncestors(path);const info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return;throw error});if(info&&(!info.isFile()||info.isSymbolicLink()||info.nlink!==1))throw failure('NIGHT_PATH_UNSAFE')}
    for(const [name,text]of pending.writes){const path=join(dir,name);await safeAncestors(path);if(text===null)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error});else await atomicWrite(path,text)}
    await unlink(join(dir,'pending.json'))
  }
  async rootIndex(dir,scope,meta){
    const raw=await this.file(dir,'index.md')
    if(!raw){if(meta.layoutVersion===LAYOUT_VERSION)throw failure('MEMORY_INDEX_MISSING');return {revision:meta.revision,topics:[],entries:[],markdown:renderIndex([]),candidateCount:0,candidateExpiries:[]}}
    const index=decodeRootIndex(raw,scope,meta)
    if(index.revision!==meta.revision)throw failure('MEMORY_INDEX_STALE')
    return index
  }
  async categoryIndex(dir,scope,root,topic){
    if(!label(topic))throw failure('MEMORY_RECORD_INVALID')
    return {revision:root.revision,topic,entries:root.entries.filter(row=>row.topic===topic)}
  }

  async entry(dir,scope,row,{includeSources=true,includePrevious=false}={}){
    const raw=await this.file(dir,entryPath(row.topic,row.key))
    if(hash(raw??'')!==row.sha256)throw failure('MEMORY_CONTENT_CHANGED')
    const reference=entrySourceReference(raw)
    if(reference&&(reference.path!==sourcePath(row.id)||!/^[a-f0-9]{64}$/.test(reference.sha256)))throw failure('MEMORY_SOURCE_INVALID')
    const sourceText=includeSources&&reference?await this.file(dir,reference.path):undefined
    const entry=decodeEntry(raw,{scope,topic:row.topic,key:row.key,sourceText,includeSources,includePrevious})
    if(entry.id!==row.id||entry.revision!==row.revision)throw failure('MEMORY_INDEX_CHANGED')
    return entry
  }
  async candidates(dir,scope){const raw=await this.file(dir,'candidates.md');return raw?scopedTopic(raw,scope).entries:[]}
  async snapshot(dir,scope,meta){
    if(scope.kind!=='bot')return readLegacySnapshot(dir,scope)
    const root=await this.rootIndex(dir,scope,meta),topics=new Map(),files=new Set(['index.md','scope.json','candidates.md'])
    for(const descriptor of root.topics){
      const category=await this.categoryIndex(dir,scope,root,descriptor.topic),entries=[]
      for(const row of category.entries){const entry=await this.entry(dir,scope,row,{includePrevious:true});entries.push(entry);files.add(entryPath(row.topic,row.key));if(entry.context?.evidence||entry.context?.background?.quote!==undefined)files.add(sourcePath(entry.id))}
      topics.set(descriptor.topic,{topic:descriptor.topic,entries})
    }
    return {meta,topics,candidates:await this.candidates(dir,scope),files,indexEntries:root.entries}
  }
  async transaction(scope,work){return this.locked(scope,async(dir,meta)=>{
    const snapshot=await this.snapshot(dir,scope,meta);let changed=false
    const state={...snapshot,mark:()=>changed=true},result=await work(state)
    if(changed){
      state.meta.revision++;state.meta.seen=state.meta.seen.slice(-1024);state.meta.forgotten=state.meta.forgotten.slice(-2048)
      let files
      if(scope.kind==='bot')files=buildLayeredWrites(scope,state,this.now())
      else{
        files=new Map();for(const [topic,value]of state.topics)if(value.entries.length)files.set('topics/'+hash(topic)+'.md',encodeTopic(topic,state.meta.revision,value.entries,{kind:scope.kind,id:scope.id}))
        if(state.candidates.length)files.set('candidates.md',encodeTopic('candidates',state.meta.revision,state.candidates,{kind:scope.kind,id:scope.id}))
        files.set('scope.json',JSON.stringify(state.meta,null,2)+'\n');files.set('index.md','# Memory index\n')
        snapshot.files=new Set(['index.md','scope.json','candidates.md',...(await readdir(join(dir,'topics')).catch(error=>{if(error.code==='ENOENT')return [];throw error})).map(name=>'topics/'+name)])
      }
      const writes=[...files].filter(([name])=>name!=='scope.json')
      for(const name of snapshot.files??[])if(!files.has(name))writes.push([name,null])
      writes.push(['scope.json',files.get('scope.json')])
      const journal=JSON.stringify({version:1,writes});if(Buffer.byteLength(journal)>FILE_LIMIT||writes.some(([,text])=>text!==null&&Buffer.byteLength(text)>FILE_LIMIT))throw failure('MEMORY_FILE_TOO_LARGE')
      await atomicWrite(join(dir,'pending.json'),journal)
      try{await this.beforeApply?.();await this.recover(dir)}catch(cause){throw Object.assign(failure('MEMORY_COMMIT_UNCERTAIN'),{cause,committed:'uncertain'})}
    }
    return structuredClone(typeof result==='function'?result():result)
  })}
  async index(scope,{topic,includeExpired=false}={}){
    if(scope.kind!=='bot')return this.transaction(scope,s=>({revision:s.meta.revision,topics:[...s.topics].map(([topic,v])=>({topic,count:v.entries.filter(e=>active(e,this.now())).length})),candidateCount:s.candidates.filter(e=>active(e,this.now())).length}))
    return this.locked(scope,async(dir,meta)=>{
      const root=await this.rootIndex(dir,scope,meta),now=this.now(),unexpired=(count,expiries)=>count-expiries.filter(at=>Date.parse(at)<=now).length
      const result={revision:root.revision,topics:root.topics.map(row=>({...row,count:unexpired(row.count,row.expiries)})).filter(row=>row.count),candidateCount:unexpired(root.candidateCount,root.candidateExpiries)}
      result.entries=root.entries.filter(entry=>(topic===undefined||entry.topic===topic)&&(includeExpired||active(entry,now)))
      if(topic!==undefined){if(!label(topic))throw failure('MEMORY_RECORD_INVALID');result.topic=topic}
      result.markdown=renderIndex(result.entries)
      return result
    })
  }
  async read(scope,{topic,key,candidates=false,includeSources=true,includePrevious=false}={}){
    if(key!==undefined&&!label(key))throw failure('MEMORY_RECORD_INVALID')
    if(scope.kind!=='bot')return this.transaction(scope,s=>({revision:s.meta.revision,entries:(candidates?s.candidates:s.topics.get(topic)?.entries??[]).filter(e=>(!key||e.key===key)&&active(e,this.now())).slice(0,50).map(e=>includePrevious?e:withoutPrevious(e))}))
    return this.locked(scope,async(dir,meta)=>{
      const root=await this.rootIndex(dir,scope,meta)
      if(candidates)return {revision:root.revision,entries:(await this.candidates(dir,scope)).filter(e=>(!topic||e.topic===topic)&&(!key||e.key===key)&&active(e,this.now())).slice(0,50).map(e=>includePrevious?e:withoutPrevious(e))}
      const category=await this.categoryIndex(dir,scope,root,topic),rows=category.entries.filter(e=>(!key||e.key===key)&&active(e,this.now())).slice(0,50),entries=[]
      for(const row of rows)entries.push(await this.entry(dir,scope,row,{includeSources,includePrevious}))
      return {revision:root.revision,entries}
    })
  }
  async search(scope,{query,limit=10,mode='index',topic,includeSources=false}={}){
    if(typeof query!=='string'||!query.trim()||query.length>200||!Number.isSafeInteger(limit)||limit<1||limit>20||!['index','fulltext'].includes(mode)||topic!==undefined&&!label(topic))throw failure('MEMORY_QUERY_INVALID')
    const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean),matches=text=>terms.every(term=>text.toLocaleLowerCase().includes(term))
    return this.locked(scope,async(dir,meta)=>{
      const root=await this.rootIndex(dir,scope,meta),entries=[]
      for(const categoryRow of root.topics){
        if(topic!==undefined&&categoryRow.topic!==topic)continue
        const category=await this.categoryIndex(dir,scope,root,categoryRow.topic)
        for(const row of category.entries){
          if(!active(row,this.now()))continue
          if(mode==='index'){if(matches(row.topic+' '+row.key+' '+row.title+' '+row.summary+' '+(row.subject?.description??'')))entries.push(row)}
          else{const entry=await this.entry(dir,scope,row,{includeSources}),contextText=includeSources?memoryContextText(entry.context):[entry.context?.subject?.description,entry.context?.interpretation?.scenario,...entry.context?.interpretation?.boundaries??[]].filter(Boolean).join(' ');if(matches(row.topic+' '+entry.key+' '+entry.text+' '+contextText))entries.push({topic:row.topic,...entry})}
          if(entries.length>=limit)return {revision:root.revision,mode:mode==='index'?'literal-index':'literal-fulltext',entries}
        }
      }
      return {revision:root.revision,mode:mode==='index'?'literal-index':'literal-fulltext',entries}
    })
  }
  async reconciliationReceipt(scope,id){return this.locked(scope,async(_dir,meta)=>structuredClone(meta.reconciliations?.[id]))}
  async remember(scope,{topic,key,text,source,originSource,provenance,context,content,expectedRevision,expiresAt,candidate=false,scopeRevision,validate,reconciliation}={}){
    if(!label(topic)||!label(key)||!source?.messageId||!source?.sessionId)throw failure('MEMORY_RECORD_INVALID')
    if(context!==undefined)context=checkedMemoryContext(context)
    const structured=context?.version===2||context?.version===3||content!==undefined
    if(content!==undefined&&text!==renderMemoryContent(content))throw failure('MEMORY_CONTEXT_CONTENT_CHANGED')
    text=structured?checkedTextWithLimit(text,CONTENT_LIMIT):checkedText(text)
    if(structured&&Buffer.byteLength(text)>CONTENT_LIMIT)throw failure('MEMORY_TEXT_INVALID')
    if(context&&structured&&text!==renderRouterMemory(context))throw failure('MEMORY_CONTEXT_CONTENT_CHANGED')
    checkedText(topic);checkedText(key)
    if(expiresAt!==undefined&&(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=this.now()||!/(Z|[+-]\d\d:\d\d)$/.test(expiresAt)))throw failure('MEMORY_EXPIRY_INVALID')
    return this.transaction(scope,async s=>{
      await validate?.()
      if(reconciliation&&s.meta.reconciliations?.[reconciliation.id]&&s.meta.reconciliations[reconciliation.id].inputHash!==reconciliation.inputHash)throw failure('MEMORY_RECONCILIATION_CONFLICT')
      if(scopeRevision!==undefined&&s.meta.revision!==scopeRevision)throw failure('MEMORY_SCOPE_CHANGED')
      const seen=hash(source.sessionId+':'+source.messageId+':'+topic+':'+key+':'+candidate)
      if(s.meta.seen.includes(seen))return {ok:true,duplicate:true,revision:s.meta.revision}
      const topicState=s.topics.get(topic)??{topic,entries:[]},entries=candidate?s.candidates:topicState.entries,prior=entries.find(e=>e.key===key&&(candidate?e.topic===topic:true))
      if(expectedRevision!==undefined&&(prior?.revision??0)!==expectedRevision)throw failure('MEMORY_REVISION_CONFLICT')
      if(candidate&&(s.meta.forgotten.includes(hash(text))||topicState.entries.some(e=>e.key===key)))return {ok:false,code:'MEMORY_CANDIDATE_SUPPRESSED'}
      const now=new Date(this.now()).toISOString(),entry={id:prior?.id??randomUUID(),key,...candidate?{topic}: {},text,...context?{context}:{},revision:(prior?.revision??0)+1,scope:scope.kind,createdAt:prior?.createdAt??now,updatedAt:now,source:{sessionId:source.sessionId,messageId:source.messageId,observedAt:source.observedAt??now,...source.quoteSha256?{quoteSha256:source.quoteSha256}:{},actor:scope.actor},...(provenance?{provenance:structuredClone(provenance)}:{}),origins:[...new Map([...(prior?.origins??[]),...prior?.provenance?[prior.provenance]:[],...provenance?[provenance]:[]].map(value=>[JSON.stringify(value),value])).values()].slice(-32),...expiresAt?{expiresAt}:{}}
      if(prior)entry.previous=contentSnapshot(prior.text,prior.revision,prior.updatedAt)
      if(originSource)entry.originSource={sessionId:originSource.sessionId,messageId:originSource.messageId,observedAt:originSource.observedAt,quoteSha256:originSource.quoteSha256,actor:originSource.actor}
      if(prior){entries.splice(entries.indexOf(prior),1);if(prior.text!==text)s.meta.forgotten.push(hash(prior.text))}
      entries.push(entry)
      if(!candidate){s.topics.set(topic,topicState);s.candidates=s.candidates.filter(e=>!(e.key===key&&e.topic===topic));s.meta.forgotten=s.meta.forgotten.filter(h=>h!==hash(text))}
      if(reconciliation){s.meta.reconciliations??={};s.meta.reconciliations[reconciliation.id]={inputHash:reconciliation.inputHash,revision:entry.revision};}
      s.meta.seen.push(seen);s.mark()
      return ()=>({ok:true,entry:withoutPrevious(entry),revision:s.meta.revision,candidate})
    })
  }
  async forget(scope,{topic,key,expectedRevision,source,validate,reconciliation}={}){
    if(!label(topic)||!label(key))throw failure('MEMORY_RECORD_INVALID')
    return this.transaction(scope,async s=>{
      await validate?.()
      if(reconciliation&&s.meta.reconciliations?.[reconciliation.id]&&s.meta.reconciliations[reconciliation.id].inputHash!==reconciliation.inputHash)throw failure('MEMORY_RECONCILIATION_CONFLICT')
      const seen=source?.messageId?hash(source.sessionId+':'+source.messageId+':forget:'+topic+':'+key):undefined
      if(seen&&s.meta.seen.includes(seen))return {ok:true,duplicate:true,revision:s.meta.revision}
      const entries=s.topics.get(topic)?.entries??[],prior=entries.find(e=>e.key===key)
      if(expectedRevision!==undefined&&(prior?.revision??0)!==expectedRevision)throw failure('MEMORY_REVISION_CONFLICT')
      for(const entry of [...entries,...s.candidates])if(entry.key===key&&(!entry.topic||entry.topic===topic))s.meta.forgotten.push(hash(entry.text))
      if(prior)entries.splice(entries.indexOf(prior),1)
      s.candidates=s.candidates.filter(e=>e.topic!==topic||e.key!==key)
      if(reconciliation){s.meta.reconciliations??={};s.meta.reconciliations[reconciliation.id]={inputHash:reconciliation.inputHash,revision:prior?.revision};}
      if(seen)s.meta.seen.push(seen)
      // Even a missing entry invalidates outstanding extraction generations.
      s.mark();return ()=>({ok:true,forgotten:!!prior,revision:s.meta.revision})
    })
  }
}
