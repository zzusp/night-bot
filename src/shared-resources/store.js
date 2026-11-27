import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {containsSecret} from '../memory/format.js'

export const MAX_SHARED_FILE_BYTES=20*1024*1024
const text=(value,max=240)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value)
const actions=new Set(['index','search','read','publish','import','update','withdraw','forward','audit'])
const refPattern=/^[a-f0-9-]{36}$/u
const identity=value=>text(value,1024)
const fail=code=>{throw Object.assign(Error('SHARED_'+code),{code:'SHARED_'+code})}
const check=(condition,code='INVALID')=>{if(!condition)fail(code)}
const key=value=>value.normalize('NFKC').toLowerCase()
const hex=value=>createHash('sha256').update(value).digest('hex')
const versionOf=value=>Number.isSafeInteger(value)&&value>0
const onlyKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(field=>keys.includes(field))
const safeFilename=name=>text(name,180)&&!/[/\\<>:"|?*]/u.test(name)&&!/[. ]$/u.test(name)&&! /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)
const validIndexPath=value=>Array.isArray(value)&&value.length<=8&&value.every(segment=>text(segment,80)&&!/[\\/]/u.test(segment)&&!['.','..'].includes(segment)&&!containsSecret(segment))
export function validSharedFilename(name){return safeFilename(name)}
export function parseSharedDirective(text){
 if(typeof text!=='string'||!text.startsWith('/shared ')||text.length>48000)return null
 try{
  const input=JSON.parse(text.slice(8))
  return ['publish','update','withdraw','forward'].includes(input?.action)?input:null
 }catch{return null}
}
// Recognize a direct import request, not file names found in quoted/history
// text. The path still goes through the task's existing work-root guard.
export function sharedImportRequested(source,path){
 if(typeof source!=='string'||typeof path!=='string'||!path.startsWith('work/'))return false
 const input=source.trim()
 // Match a complete initial request clause, not a phrase inside a quotation
 // or a request to discuss/translate it. Later clauses may limit follow-up.
 const first=input.split(/[，,。！？；;\n]/u,1)[0].trim()
 const request=/^(?:请(?:帮我)?\s*)?(?:先\s*)?(?:(?:把|将)\s*([^「」“”"'<>]*?)\s*(?:迁入|迁移到|导入(?:到)?|放进|保存到)|(?:迁入|导入)\s*([^「」“”"'<>]*?)\s*(?:到|至))\s*(?:Bot\s*)?(?:共享)?知识库$/u.exec(first)
 if(!request||/(?:不要执行|不执行|先别执行|请勿执行|不做迁入|不要迁入|不要导入|不用迁入|先别迁入|仅作示例|只是示例|只做翻译|仅翻译)/u.test(input))return false
 const object=request[1]??request[2]
 const named=[...object.matchAll(/(?:^|[\s`（(])(work\/[^\s`，,；;）)]+)(?=$|[\s`，,；;）)])/gu)].map(match=>match[1])
 return named.length===1&&named[0]===path
}

/** Host-only, instance-bound repository. No task or channel path is a lookup
 * key. Records are shared inside the instance; even old versions honor withdrawal. */
export function openSharedResources({dbPath,instanceId}){
 check(identity(instanceId),'INSTANCE_INVALID')
 const db=new DatabaseSync(dbPath)
 db.exec(`
   PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS shared_instance(instance_id TEXT PRIMARY KEY) STRICT;
   CREATE TABLE IF NOT EXISTS shared_items(id TEXT PRIMARY KEY,kind TEXT NOT NULL,version INTEGER NOT NULL,
     name_key TEXT NOT NULL,withdrawn INTEGER NOT NULL DEFAULT 0,
     owner TEXT NOT NULL,scope TEXT NOT NULL,acl TEXT NOT NULL) STRICT;
   CREATE UNIQUE INDEX IF NOT EXISTS shared_current_names ON shared_items(kind,name_key) WHERE withdrawn=0;
   CREATE TABLE IF NOT EXISTS shared_versions(id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,bytes BLOB,
     PRIMARY KEY(id,version),FOREIGN KEY(id) REFERENCES shared_items(id)) STRICT;
   CREATE TABLE IF NOT EXISTS shared_audit(sequence INTEGER PRIMARY KEY,operation TEXT UNIQUE,
     action TEXT NOT NULL,request_hash TEXT NOT NULL,resource_id TEXT,actor TEXT NOT NULL,scope TEXT NOT NULL,
     source TEXT NOT NULL,at TEXT NOT NULL,result TEXT NOT NULL) STRICT;
 `)
 const known=db.prepare('SELECT instance_id FROM shared_instance').all()
 if(known.length&&!(known.length===1&&known[0].instance_id===instanceId)){db.close();fail('INSTANCE_MISMATCH')}
 if(!known.length)db.prepare('INSERT INTO shared_instance VALUES (?)').run(instanceId)
 const item=id=>db.prepare('SELECT * FROM shared_items WHERE id=?').get(id)
 const version=(id,n)=>db.prepare('SELECT body FROM shared_versions WHERE id=? AND version=?').get(id,n)
 // Preserve the old owner/scope/acl columns for existing databases; access no longer depends on them.
 const inspect=(id,n)=>{
  check(typeof id==='string'&&refPattern.test(id)&&(n===undefined||versionOf(n)))
  const row=item(id);if(!row)fail('NOT_FOUND')
  check(row.withdrawn===0,'WITHDRAWN')
  const entry=version(id,n??row.version);if(!entry)fail('NOT_FOUND')
  return {row,entry:JSON.parse(entry.body)}
 }
 function current(id,expected){
  check(versionOf(expected))
  const {row}=inspect(id)
  check(row.version===expected,'VERSION_CONFLICT')
  return row
 }
 function normalizeLinks(links){
  check(Array.isArray(links)&&links.length<=12)
  return links.map(link=>{
   check(onlyKeys(link,['id','version'])&&versionOf(link.version))
   const {row}=inspect(link.id,link.version)
   check(row.kind==='file')
   return {id:link.id,version:link.version}
  })
 }
 function content(args,bytes,kind,id,n,source){
  const {name,topic,keywords=[],indexPath=[],body,links=[],fileName}=args
  check(text(name)&&!containsSecret(name))
  check(topic===undefined||text(topic)&&!containsSecret(topic))
  check(Array.isArray(keywords)&&keywords.length<=16&&keywords.every(word=>text(word,100)&&!containsSecret(word)))
  check(Array.isArray(links))
  check(validIndexPath(indexPath))
  if(kind==='file'){
   check(Buffer.isBuffer(bytes)&&bytes.length<=MAX_SHARED_FILE_BYTES&&safeFilename(fileName)&&!containsSecret(fileName))
   check(body===undefined&&links.length===0)
  }else{
   check(kind==='knowledge'&&bytes===undefined&&fileName===undefined&&typeof body==='string'&&body.trim()&&Buffer.byteLength(body)<=32768&&!containsSecret(body))
  }
  return {id,version:n,kind,name,...topic===undefined?{}:{topic},keywords,indexPath,
   ...(kind==='file'?{fileName,size:bytes.length,sha256:hex(bytes)}:{body,links:normalizeLinks(links)}),
   provenance:{recordedAt:new Date().toISOString(),publicationRef:hex(JSON.stringify(source))}}
 }
 function audit(principal,action,record,source,operation,requestHash){
  db.prepare('INSERT INTO shared_audit(operation, action, request_hash, resource_id, actor, scope, source, at, result) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(operation??null,action,requestHash,record.id??null,principal.actorId,principal.conversationId,JSON.stringify(source),new Date().toISOString(),JSON.stringify(record))
 }
 const metadata=({body,links,...rest})=>rest
 function execute(principal,args,{source,operation,bytes}={}){
  check(identity(principal?.actorId)&&identity(principal?.conversationId),'AUTHORITY_REQUIRED')
  check(args&&actions.has(args.action)&&source&&typeof source==='object','INVALID')
  check(source&&Buffer.byteLength(JSON.stringify(source))<=8192,'INVALID')
  const {action,id}=args
  if(['publish','import','update','withdraw','forward'].includes(action))check(identity(operation),'OPERATION_REQUIRED')
  const requestHash=hex(JSON.stringify([principal.actorId,principal.conversationId,args,bytes?hex(bytes):null]))
  db.exec('BEGIN IMMEDIATE')
  try{
   const previous=operation&&db.prepare('SELECT request_hash,result,resource_id,action FROM shared_audit WHERE operation=?').get(operation)
   let result,returnedBytes
   if(previous){
    check(previous.request_hash===requestHash&&previous.action===action,'OPERATION_CONFLICT')
    if(action==='forward')inspect(id,args.version)
    result=JSON.parse(previous.result)
   }else if(action==='audit'){
    check(principal.operator===true,'FORBIDDEN')
    check(onlyKeys(args,['action','id','after'])&&typeof id==='string'&&refPattern.test(id)&&Number.isSafeInteger(args.after??0)&&(args.after??0)>=0)
    result={records:db.prepare('SELECT sequence,action,actor,scope,source,at FROM shared_audit WHERE resource_id=? AND sequence>? ORDER BY sequence LIMIT 100').all(id,args.after??0).map(row=>({...row,source:JSON.parse(row.source)}))}
   }else if(action==='index'){
    const {indexPath=[],offset=0,limit=20}=args
    check(onlyKeys(args,['action','indexPath','offset','limit'])&&validIndexPath(indexPath))
    check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=50)
    const rows=db.prepare("SELECT r.*,v.body FROM shared_items r JOIN shared_versions v ON v.id=r.id AND v.version=r.version WHERE r.withdrawn=0 AND (r.kind='knowledge' OR json_array_length(v.body,'$.indexPath')>0) ORDER BY r.name_key,r.id").iterate()
    const wanted=indexPath.map(key),branches=new Map(),entries=[]
    for(const row of rows){
     const entry=JSON.parse(row.body),path=entry.indexPath??[]
     if(path.length<wanted.length||!wanted.every((segment,i)=>segment===key(path[i])))continue
     if(path.length===wanted.length)entries.push({type:entry.kind==='file'?'file':'entry',...metadata(entry)})
     else if(!branches.has(key(path[wanted.length])))branches.set(key(path[wanted.length]),{type:'index',name:path[wanted.length],indexPath:path.slice(0,wanted.length+1)})
    }
    const nodes=[...[...branches.values()].sort((a,b)=>a.name.localeCompare(b.name)),...entries],page=nodes.slice(offset,offset+limit)
    result={status:page.length?'found':'not-found',indexPath,nodes:page,nextOffset:offset+page.length<nodes.length?offset+page.length:null}
   }else if(action==='search'){
    check(onlyKeys(args,['action','query','kind','offset','limit'])&&text(args.query)&&!containsSecret(args.query))
    check(args.kind===undefined||['file','knowledge'].includes(args.kind))
    const offset=args.offset??0,limit=args.limit??20
    check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=50)
    const rows=db.prepare('SELECT r.*,v.body FROM shared_items r JOIN shared_versions v ON v.id=r.id AND v.version=r.version WHERE r.withdrawn=0 AND (? IS NULL OR r.kind=?) ORDER BY r.name_key,r.id').iterate(args.kind??null,args.kind??null)
    const query=key(args.query),matches=[];let skipped=0,hasMore=false
    for(const row of rows){
     const entry=JSON.parse(row.body)
     if(![entry.name,entry.topic??'',...entry.keywords,...entry.indexPath??[]].some(field=>key(field).includes(query)))continue
     if(skipped++<offset)continue
     if(matches.length===limit){hasMore=true;break}
     matches.push(metadata(entry))
    }
    result={status:matches.length?'found':'not-found',matches,hasMore,nextOffset:hasMore?offset+matches.length:null}
   }else if(action==='read'||action==='forward'){
    check(onlyKeys(args,['action','id','version'])&&(action==='read'||versionOf(args.version)))
    const {row,entry}=inspect(id,args.version)
    check(action!=='forward'||row.kind==='file')
    if(action==='read'&&row.kind==='knowledge'){
     const links=entry.links.map(link=>{try{return {...link,...metadata(inspect(link.id,link.version).entry)}}catch(error){if(!['SHARED_NOT_FOUND','SHARED_WITHDRAWN'].includes(error.code))throw error;return {status:'unavailable'}}})
     result={...entry,links,status:'read'}
    }else result={...metadata(entry),status:action==='read'?'read':'forward-authorized'}
   }else if(action==='import'){
    check(onlyKeys(args,['action','name','indexPath','fileName'])&&text(args.name))
    const fileId=randomUUID(),entryId=randomUUID()
    const file=content({name:args.name+' · 原文件',fileName:args.fileName},bytes,'file',fileId,1,source)
    for(const [kind,name] of [['file',file.name],['knowledge',args.name]]){
     check(text(name)&&!db.prepare('SELECT 1 FROM shared_items WHERE kind=? AND name_key=? AND withdrawn=0').get(kind,key(name)),'NAME_CONFLICT')
    }
    db.prepare('INSERT INTO shared_items VALUES(?,?,?,?,0,?,?,?)').run(fileId,'file',1,key(file.name),principal.actorId,principal.conversationId,'[]')
    db.prepare('INSERT INTO shared_versions VALUES(?,?,?,?)').run(fileId,1,JSON.stringify(file),bytes)
    const entry=content({name:args.name,indexPath:args.indexPath,body:'核验范围与名单记录以引用的原文件为准。',links:[{id:fileId,version:1}]},undefined,'knowledge',entryId,1,source)
    db.prepare('INSERT INTO shared_items VALUES(?,?,?,?,0,?,?,?)').run(entryId,'knowledge',1,key(entry.name),principal.actorId,principal.conversationId,'[]')
    db.prepare('INSERT INTO shared_versions VALUES(?,?,?,NULL)').run(entryId,1,JSON.stringify(entry))
    result={status:'imported',id:entryId,version:1,name:entry.name,indexPath:entry.indexPath,file:{id:fileId,version:1,sha256:file.sha256}}
    audit(principal,'publish-import-file',metadata(file),source,null,requestHash)
   }else if(action==='publish'||action==='update'){
    check(onlyKeys(args,['action','id','expectedVersion','kind','name','topic','keywords','indexPath','body','links','fileName','knowledge']))
    const creating=action==='publish'
    check(!creating||id===undefined&&args.expectedVersion===undefined)
    const row=creating?null:current(id,args.expectedVersion)
    const kind=row?.kind??args.kind,resourceId=row?.id??randomUUID(),n=(row?.version??0)+1
    check(args.kind===undefined||args.kind===kind)
    const value=content(args,bytes,kind,resourceId,n,source)
    let knowledge
    if(args.knowledge!==undefined){
     check(!creating&&kind==='file'&&onlyKeys(args.knowledge,['id','expectedVersion']))
     const revision=args.knowledge.expectedVersion,reference=args.knowledge.id
     const kb=current(reference,revision)
     check(kb.kind==='knowledge')
     const {entry}=inspect(reference,revision)
     check(entry.links.filter(link=>link.id===id).length===1&&entry.links.some(link=>link.id===id&&link.version===args.expectedVersion),'VERSION_CONFLICT')
     knowledge={...entry,version:revision+1,provenance:value.provenance,links:entry.links.map(link=>link.id===id?{id,version:n}:link)}
    }
    const conflict=db.prepare('SELECT id FROM shared_items WHERE kind=? AND name_key=? AND withdrawn=0 AND id<>?').get(kind,key(value.name),resourceId)
    check(!conflict,'NAME_CONFLICT')
    if(creating)db.prepare('INSERT INTO shared_items VALUES(?,?,?,?,0,?,?,?)').run(resourceId,kind,n,key(value.name),principal.actorId,principal.conversationId,'[]')
    else db.prepare('UPDATE shared_items SET version=?,name_key=? WHERE id=?').run(n,key(value.name),id)
    db.prepare('INSERT INTO shared_versions VALUES(?,?,?,?)').run(resourceId,n,JSON.stringify(value),bytes??null)
    if(knowledge){
     db.prepare('UPDATE shared_items SET version=? WHERE id=?').run(knowledge.version,knowledge.id)
     db.prepare('INSERT INTO shared_versions VALUES(?,?,?,NULL)').run(knowledge.id,knowledge.version,JSON.stringify(knowledge))
     audit(principal,'update-linked-knowledge',metadata(knowledge),source,null,requestHash)
    }
    result={...metadata(value),status:creating?'published':'updated',...(knowledge?{knowledge:{id:knowledge.id,version:knowledge.version}}:{})}
   }else if(action==='withdraw'){
    check(onlyKeys(args,['action','id','expectedVersion']))
    const row=current(id,args.expectedVersion)
    db.prepare('UPDATE shared_items SET withdrawn=1 WHERE id=?').run(id)
    result={id,version:row.version,status:'withdrawn'}
   }
   if(['read','forward'].includes(action)&&result.kind==='file'){
    const {bytes:raw}=db.prepare('SELECT bytes FROM shared_versions WHERE id=? AND version=?').get(result.id,result.version)
    returnedBytes=Buffer.from(raw??[])
    check(returnedBytes.length===result.size&&hex(returnedBytes)===result.sha256,'INTEGRITY')
   }
   if(!previous&&action!=='audit')audit(principal,action,metadata(result),source,operation,requestHash)
   db.exec('COMMIT')
   return {result,...returnedBytes?{bytes:returnedBytes}:{}}
  }catch(error){db.exec('ROLLBACK');throw error}
 }
 function verifyForwardReceipt(operation,{conversationId,sourceId,version:sourceVersion,sha256}){
  const receipt=db.prepare("SELECT actor,scope,source,result FROM shared_audit WHERE operation=? AND action='forward'").get(operation)
  check(receipt&&receipt.scope===conversationId,'FORBIDDEN')
  const source=JSON.parse(receipt.source),file=JSON.parse(receipt.result)
  check(source.sourceId===sourceId&&source.version===sourceVersion&&file.sha256===sha256,'FORBIDDEN')
  inspect(file.id,file.version)
  return receipt.actor
 }
 function metadataForUpdate(id,expectedVersion){
  current(id,expectedVersion)
  return metadata(inspect(id,expectedVersion).entry)
 }
 function verifyImport(result){
  const article=inspect(result.id,result.version).entry
  const file=inspect(result.file.id,result.file.version).entry
  const {bytes}=db.prepare('SELECT bytes FROM shared_versions WHERE id=? AND version=?').get(file.id,file.version)
  check(article.links.length===1&&article.links[0].id===file.id&&article.links[0].version===file.version&&
   bytes.length===file.size&&hex(bytes)===file.sha256&&file.sha256===result.file.sha256,'INTEGRITY')
  return {...result,verified:true,visibility:'bot-instance',originalDisposition:'retained'}
 }
 return {execute,verifyForwardReceipt,metadataForUpdate,verifyImport,close:()=>db.close()}
}
