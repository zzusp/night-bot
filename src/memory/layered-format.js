import {hash,label,checkedMemoryContext,renderRouterMemory,encodeTopic} from './format.js'
import {failure} from '../runtime/files.js'

export const LAYOUT_VERSION=3
// Portable even on case-insensitive filesystems and Windows reserved basenames.
const encode=value=>{let part=Array.from(value,char=>/[a-z0-9_-]/.test(char)?char:char.codePointAt(0)<128?'%'+char.charCodeAt(0).toString(16).toUpperCase():encodeURIComponent(char)).join('');if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part))part='%'+part.charCodeAt(0).toString(16).toUpperCase()+part.slice(1);if(part.length>120)part=part.slice(0,120).replace(/%(?:[0-9A-F])?$/,'')+'--'+hash(value).slice(0,24);return part}
export const categoryPath=topic=>'categories/'+encode(topic)+'/index.md'
export const entryPath=(topic,key)=>'categories/'+encode(topic)+'/entries/'+encode(key)+'.md'
export const sourcePath=id=>'sources/'+id+'.md'
const scopeValue=scope=>({kind:scope.kind,id:scope.id})
const sameScope=(a,b)=>a?.kind===b?.kind&&a?.id===b?.id
const escape=value=>String(value).replace(/[\\\[\]<>]/g,'\\$&').replace(/[\r\n]+/g,' ')
const linkPath=value=>value.split('/').map(encodeURIComponent).join('/')
const line=value=>String(value??'').replace(/\s+/g,' ').trim()
const short=(value,max=240)=>{const text=line(value);return text.length>max?text.slice(0,max-1)+'…':text}
export const entrySummary=entry=>short(entry.context?.summary??entry.text.replace(/^Summary:\s*/,'').split(/\n\s*\n/)[0])
const envelope=(meta,body)=>'---\n'+JSON.stringify({...meta,metadataSha256:hash(JSON.stringify(meta)),bodySha256:hash(body)},null,2)+'\n---\n\n'+body
function decodeEnvelope(text,format){
  const match=/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(text??'')
  if(!match)throw failure('MEMORY_MARKDOWN_INVALID')
  let meta;try{meta=JSON.parse(match[1])}catch{throw failure('MEMORY_MARKDOWN_INVALID')}
  const {metadataSha256,bodySha256,...fields}=meta
  if(meta.format!==format||bodySha256!==hash(match[2])||metadataSha256!==hash(JSON.stringify(fields)))throw failure('MEMORY_CONTENT_CHANGED')
  return {meta,body:match[2]}
}
function checkScope(meta,scope){if(scope&&!sameScope(meta.scope,scope))throw failure('MEMORY_SCOPE_INVALID')}
const validRevision=value=>Number.isSafeInteger(value)&&value>=0
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)
const validExpiry=value=>value===undefined||typeof value==='string'&&Number.isFinite(Date.parse(value))

export function decodeRootIndex(text,scope){
  const {meta}=decodeEnvelope(text,'night-bot-memory-index-v3');checkScope(meta,scope)
  if(!validRevision(meta.revision)||!Array.isArray(meta.topics)||!Number.isSafeInteger(meta.candidateCount)||meta.candidateCount<0||!Array.isArray(meta.candidateExpiries))throw failure('MEMORY_INDEX_INVALID')
  const names=new Set()
  for(const row of meta.topics){
    if(!label(row.topic)||names.has(row.topic)||row.path!==categoryPath(row.topic)||!validHash(row.sha256)||!Number.isSafeInteger(row.count)||row.count<0||!Array.isArray(row.expiries)||row.expiries.length>row.count||typeof row.summary!=='string'||row.expiries.some(value=>!validExpiry(value)))throw failure('MEMORY_INDEX_INVALID')
    names.add(row.topic)
  }
  if(meta.candidateExpiries.length>meta.candidateCount||meta.candidateExpiries.some(value=>!validExpiry(value)))throw failure('MEMORY_INDEX_INVALID')
  return meta
}
export function decodeCategoryIndex(text,scope,topic){
  const {meta}=decodeEnvelope(text,'night-bot-memory-category-v3');checkScope(meta,scope)
  if(!label(meta.topic)||topic!==undefined&&meta.topic!==topic||!validRevision(meta.revision)||!Array.isArray(meta.entries))throw failure('MEMORY_INDEX_INVALID')
  const keys=new Set(),ids=new Set()
  for(const row of meta.entries){
    if(!label(row.key)||row.topic!==meta.topic||keys.has(row.key)||!validId(row.id)||ids.has(row.id)||row.path!=='entries/'+encode(row.key)+'.md'||!validHash(row.sha256)||!validRevision(row.revision)||!validExpiry(row.expiresAt)||typeof row.title!=='string'||typeof row.summary!=='string')throw failure('MEMORY_INDEX_INVALID')
    keys.add(row.key);ids.add(row.id)
  }
  return meta
}
function splitSources(entry){
  const copy=structuredClone(entry),sources={}
  if(copy.context?.evidence){sources.evidence=copy.context.evidence;delete copy.context.evidence}
  if(copy.context?.background?.quote!==undefined){sources.background=copy.context.background;copy.context.background={status:'source-excerpt',messageId:sources.background.messageId,source:sources.background.source,quoteSha256:sources.background.quoteSha256}}
  return {entry:copy,sources:Object.keys(sources).length?sources:undefined}
}
export function encodeEntry(topic,entry,scope){
  const split=splitSources(entry),{text,...fields}=split.entry
  const sourceText=split.sources?envelope({format:'night-bot-memory-sources-v3',scope:scopeValue(scope),id:entry.id,sources:split.sources},'# Sources\n\n'+(split.sources.evidence??[split.sources.background]).map(item=>item.quote).join('\n\n')+'\n'):undefined
  const sources=sourceText?{path:sourcePath(entry.id),sha256:hash(sourceText)}:undefined
  const body='# '+entry.key+'\n\n'+text+'\n'
  return {text:envelope({format:'night-bot-memory-entry-v3',scope:scopeValue(scope),topic,entry:fields,textSha256:hash(text),...sources?{sources}:{}},body),sourceText}
}
export function decodeEntry(text,{scope,topic,key,sourceText,includeSources=false,includePrevious=true}={}){
  const {meta,body}=decodeEnvelope(text,'night-bot-memory-entry-v3');checkScope(meta,scope)
  const entry=structuredClone(meta.entry),prefix='# '+entry?.key+'\n\n'
  if(!label(meta.topic)||topic!==undefined&&meta.topic!==topic||!entry||!validId(entry.id)||!label(entry.key)||key!==undefined&&entry.key!==key||!validRevision(entry.revision)||!entry.source?.messageId||!body.startsWith(prefix)||!body.endsWith('\n'))throw failure('MEMORY_MARKDOWN_INVALID')
  entry.text=body.slice(prefix.length,-1)
  if(hash(entry.text)!==meta.textSha256)throw failure('MEMORY_CONTENT_CHANGED')
  if(meta.sources){
    if(meta.sources.path!==sourcePath(entry.id)||!validHash(meta.sources.sha256))throw failure('MEMORY_SOURCE_INVALID')
    if(includeSources){
      if(hash(sourceText??'')!==meta.sources.sha256)throw failure('MEMORY_SOURCE_CHANGED')
      const {meta:original}=decodeEnvelope(sourceText,'night-bot-memory-sources-v3');checkScope(original,meta.scope)
      if(original.id!==entry.id||!original.sources||!entry.context)throw failure('MEMORY_SOURCE_INVALID')
      if(original.sources.evidence)entry.context.evidence=original.sources.evidence
      if(original.sources.background)entry.context.background=original.sources.background
    }else entry.sourcesAvailable=true
  }
  if(entry.context&&(!meta.sources||includeSources)){
    entry.context=checkedMemoryContext(entry.context)
    if([2,3].includes(entry.context.version)&&entry.text!==renderRouterMemory(entry.context))throw failure('MEMORY_CONTEXT_CONTENT_CHANGED')
  }
  if(!includePrevious)delete entry.previous
  return entry
}
export function entrySourceReference(text){return decodeEnvelope(text,'night-bot-memory-entry-v3').meta.sources}

/** One Markdown library. Indices are derived only from canonical records; no Web
 * catalog, database or duplicate fact body is part of the storage contract. */
export function buildLayeredWrites(scope,{meta,topics,candidates},now=Date.now()){
  const writes=new Map(),rows=[]
  for(const [topic,value]of [...topics].sort(([a],[b])=>a.localeCompare(b))){
    if(!label(topic))throw failure('MEMORY_RECORD_INVALID')
    if(!value.entries.length)continue
    const descriptors=[]
    for(const entry of value.entries){
      const encoded=encodeEntry(topic,entry,scope);writes.set(entryPath(topic,entry.key),encoded.text)
      if(encoded.sourceText)writes.set(sourcePath(entry.id),encoded.sourceText)
      const {id,key,revision,createdAt,updatedAt,expiresAt,provenance,origins,migration,source}=entry
      descriptors.push({id,key,topic,title:key,summary:entrySummary(entry),path:'entries/'+encode(key)+'.md',sha256:hash(encoded.text),revision,createdAt,updatedAt,...expiresAt?{expiresAt}:{},...entry.context?.subject?{subject:entry.context.subject}:{},...source?.actor?{sourceActor:source.actor}:{},...provenance?{provenance}:{},...origins?{origins}:{},...migration?{migration}:{}})
    }
    const category=envelope({format:'night-bot-memory-category-v3',scope:scopeValue(scope),topic,revision:meta.revision,entries:descriptors},'# '+topic+'\n\n'+descriptors.map(row=>`- [${escape(row.title)}](${linkPath(row.path)}) — ${escape(row.summary)}`).join('\n')+'\n')
    const expiries=descriptors.filter(row=>row.expiresAt).map(row=>row.expiresAt)
    writes.set(categoryPath(topic),category)
    rows.push({topic,title:topic,summary:short(descriptors.slice(0,3).map(row=>row.title).join('、'))+'；按需打开条目。',path:categoryPath(topic),sha256:hash(category),count:descriptors.length,expiries})
  }
  const root=envelope({format:'night-bot-memory-index-v3',scope:scopeValue(scope),revision:meta.revision,topics:rows,candidateCount:candidates.length,candidateExpiries:candidates.filter(row=>row.expiresAt).map(row=>row.expiresAt)},'# Memory index\n\n'+rows.map(row=>`- [${escape(row.title)}](${linkPath(row.path)}) — ${escape(row.summary)}`).join('\n')+'\n')
  writes.set('index.md',root);writes.set('scope.json',JSON.stringify({...meta,layoutVersion:LAYOUT_VERSION},null,2)+'\n')
  if(candidates.length)writes.set('candidates.md',encodeTopic('candidates',meta.revision,candidates,scopeValue(scope)))
  return writes
}
