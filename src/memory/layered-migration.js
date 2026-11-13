import {lstat,readdir,unlink,open} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {hash} from './format.js'
import {readLegacySnapshot,readV3Snapshot} from './store.js'
import {buildLayeredWrites,LAYOUT_VERSION} from './layered-format.js'
import {atomicWrite,readRegular,acquireLock,failure} from '../runtime/files.js'

const scope={kind:'bot',id:hash('bot:shared')}
const journalName='layout-migration.pending.json',receiptName='layout-migration.json'
const known=new Set(['topics','scope.json','index.md','candidates.md','usage.json','skill-usage.sqlite','skill-usage.sqlite-wal','skill-usage.sqlite-shm','skill-usage.sqlite-journal','evolution','installed-previous.json','migration.json','.lock',journalName,receiptName,'categories','sources'])
const stat=path=>lstat(path).catch(error=>{if(error.code!=='ENOENT')throw error})
const fail=code=>{throw failure('MEMORY_MIGRATION_'+code)}
async function safePath(path){
  const parent=dirname(path);if(parent!==path)await safePath(parent)
  const info=await stat(path)
  if(info&&(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory()||info.isFile()&&info.nlink!==1))fail('UNSAFE_PATH')
  return info
}
async function tree(directory,prefix=''){
  const files=new Map();if(!await safePath(directory))return files
  for(const name of (await readdir(directory)).sort()){
    const path=join(directory,name),info=await safePath(path),key=prefix+name
    if(info.isDirectory())for(const [name,text]of await tree(path,key+'/'))files.set(name,text)
    else files.set(key,await readRegular(path))
  }
  return files
}
async function inspectRoot(directory){
  await safePath(directory)
  for(const name of await readdir(directory)){
    if(name==='pending.json')fail('RECOVERY_REQUIRED')
    if(!known.has(name))fail('UNKNOWN_FILE')
  }
  await tree(directory)
}
const digest=files=>hash(JSON.stringify([...files].sort(([a],[b])=>a.localeCompare(b))))
async function originals(directory){
  const files=new Map()
  for(const name of ['scope.json','index.md','candidates.md',receiptName]){const text=await readRegular(join(directory,name));if(text!==undefined)files.set(name,text)}
  for(const subtree of ['topics','categories','sources'])for(const [name,text]of await tree(join(directory,subtree),subtree+'/'))files.set(name,text)
  return files
}
function validateSnapshot(snapshot){
  const ids=new Set()
  for(const [,topic]of snapshot.topics){const keys=new Set();for(const entry of topic.entries){if(ids.has(entry.id)||keys.has(entry.key))fail('ENTRY_COLLISION');ids.add(entry.id);keys.add(entry.key)}}
}
async function plan(directory,now){
  const meta=JSON.parse(await readRegular(join(directory,'scope.json'))??'null')
  const snapshot=await (meta?.layoutVersion===3?readV3Snapshot(directory,scope):readLegacySnapshot(directory,scope));validateSnapshot(snapshot)
  const files=await originals(directory),writes=buildLayeredWrites(scope,snapshot,now)
  if(meta?.layoutVersion===3)for(const name of files.keys())if(/^(categories|sources)\//.test(name)&&!snapshot.files?.has(name))fail('DESTINATION_CONFLICT')
  // Retire only obsolete category indices; their exact bytes remain in backup.
  for(const name of files.keys())if(/^categories\/[^/]+\/index\.md$/.test(name)&&!writes.has(name))writes.set(name,null)
  const names=new Set()
  for(const name of writes.keys()){const canonical=name.normalize('NFC').toLowerCase();if(names.has(canonical))fail('PATH_COLLISION');names.add(canonical)}
  return {files,writes,digest:digest(files),entries:[...snapshot.topics.values()].reduce((sum,topic)=>sum+topic.entries.length,0),candidates:snapshot.candidates.length}
}
function locations(installRoot){
  if(typeof installRoot!=='string'||!installRoot.trim())fail('INSTALL_ROOT_REQUIRED')
  const root=resolve(installRoot)
  return {root,directory:join(root,'data/memory/v2/bot'),hostLock:join(root,'data/runtime/.host.lock')}
}
async function rejectRestore(root){for(const name of ['restore.pending.json','task-restore.pending.json'])if(await stat(join(root,'data/runtime',name)))fail('RESTORE_PENDING')}
async function existingReceipt(directory){
  const text=await readRegular(join(directory,receiptName));if(text===undefined)return
  let receipt;try{receipt=JSON.parse(text)}catch{fail('RECEIPT_INVALID')}
  if(receipt.version!==1||![3,LAYOUT_VERSION].includes(receipt.layoutVersion)||receipt.status!=='completed'||!/^[a-f0-9]{64}$/.test(receipt.sourceDigest)||receipt.backup!=='backups/memory-layout-'+receipt.sourceDigest)fail('RECEIPT_INVALID')
  return receipt
}
async function preparation(installRoot,{locked=false,now=Date.now()}={}){
  const paths=locations(installRoot);await safePath(paths.root);await safePath(paths.hostLock);await rejectRestore(paths.root)
  if(!locked&&await stat(paths.hostLock))fail('RUNTIME_ACTIVE_OR_UNCERTAIN')
  if(!await safePath(paths.directory))return {...paths,report:{status:'absent',ready:false,reason:'No existing Bot memory directory'}}
  if(!locked&&await stat(join(paths.directory,'.lock')))fail('RUNTIME_ACTIVE_OR_UNCERTAIN')
  await inspectRoot(paths.directory)
  const journalText=await readRegular(join(paths.directory,journalName)),receipt=await existingReceipt(paths.directory)
  const meta=JSON.parse(await readRegular(join(paths.directory,'scope.json'))??'null')
  if(!journalText&&meta?.layoutVersion===LAYOUT_VERSION)return {...paths,report:{status:'already-layered',ready:true,receipt:receipt??null}}
  if(receipt&&!journalText&&!(meta?.layoutVersion===3&&receipt.layoutVersion===3))fail('RECEIPT_LAYOUT_CONFLICT')
  if(journalText){
    let journal;try{journal=JSON.parse(journalText)}catch{fail('JOURNAL_INVALID')}
    if(journal.targetLayout!==LAYOUT_VERSION)fail('JOURNAL_TARGET_UNSUPPORTED')
    if(journal.version!==1||journal.installRoot!==paths.root||!Number.isSafeInteger(journal.now)||!/^[a-f0-9]{64}$/.test(journal.sourceDigest)||journal.backup!=='backups/memory-layout-'+journal.sourceDigest)fail('JOURNAL_INVALID')
    const backup=join(paths.root,journal.backup);await safePath(backup)
    const planned=await plan(backup,journal.now)
    if(planned.digest!==journal.sourceDigest)fail('BACKUP_CHANGED')
    await verifyBackup(backup,planned);await verifyTargets(paths.directory,planned,true)
    return {...paths,planned,journal,report:{status:'interrupted',ready:true,entries:planned.entries,candidates:planned.candidates,backup:journal.backup,sourceDigest:planned.digest}}
  }
  if(meta?.layoutVersion!==3)for(const name of ['categories','sources'])if(await stat(join(paths.directory,name)))fail('DESTINATION_CONFLICT')
  const planned=await plan(paths.directory,now)
  await verifyTargets(paths.directory,planned,false)
  const journal={version:1,targetLayout:LAYOUT_VERSION,installRoot:paths.root,now,sourceDigest:planned.digest,backup:'backups/memory-layout-'+planned.digest}
  await safePath(join(paths.root,journal.backup));await backupPlan(join(paths.root,journal.backup),planned)
  return {...paths,planned,journal,report:{status:'ready',ready:true,entries:planned.entries,candidates:planned.candidates,backup:journal.backup,sourceDigest:planned.digest}}
}
async function verifyTargets(directory,planned,resuming){
  const retained=await tree(join(directory,'topics'),'topics/')
  if(digest(retained)!==digest(new Map([...planned.files].filter(([name])=>name.startsWith('topics/')))))fail('SOURCE_CHANGED')
  for(const subtree of ['categories','sources'])for(const [name,text]of await tree(join(directory,subtree),subtree+'/'))if(planned.files.get(name)!==text&&(!resuming||planned.writes.get(name)!==text))fail('DESTINATION_CONFLICT')
  for(const [name,text]of planned.writes){
    await safePath(join(directory,name));const current=await readRegular(join(directory,name)),original=planned.files.get(name)
    if(current!==original&&(!resuming||current!==(text??undefined)))fail('DESTINATION_CONFLICT')
  }
}
async function verifyBackup(backup,planned){
  const actual=await tree(backup);const manifest=actual.get('manifest.json');actual.delete('manifest.json')
  if(digest(actual)!==planned.digest||manifest!==JSON.stringify({version:1,sourceDigest:planned.digest,files:[...planned.files].map(([path,text])=>({path,sha256:hash(text)}))},null,2)+'\n')fail('BACKUP_CHANGED')
}
async function backupPlan(backup,planned){
  const actual=await tree(backup),expected=new Map(planned.files)
  expected.set('manifest.json',JSON.stringify({version:1,sourceDigest:planned.digest,files:[...planned.files].map(([path,text])=>({path,sha256:hash(text)}))},null,2)+'\n')
  for(const [name,text]of actual)if(expected.get(name)!==text)fail('BACKUP_CONFLICT')
  return {actual,expected}
}
async function createBackup(backup,planned){
  const {actual,expected}=await backupPlan(backup,planned)
  for(const [name,text]of expected)if(!actual.has(name)){await safePath(join(backup,name));await atomicWrite(join(backup,name),text)}
  await verifyBackup(backup,planned)
}
/** Read-only inspection: no directory creation, chmod, lock acquisition or recovery. */
export async function checkMemoryMigration(installRoot){return (await preparation(installRoot)).report}
/** Explicit offline operation. Hook is fault injection for isolated tests only. */
export async function applyMemoryMigration(installRoot,{afterWrite}={}){
  const paths=locations(installRoot)
  await safePath(paths.root);await safePath(paths.hostLock);await safePath(paths.directory)
  // Validate source and target before creating leases or backup directories.
  const before=await preparation(installRoot,{locked:true})
  if(before.report.status==='absent')return before.report
  const releaseHost=await acquireLock(paths.hostLock,{timeoutMs:0})
  try{
    const releaseMemory=await acquireLock(join(paths.directory,'.lock'),{timeoutMs:0})
    try{
      const checked=await preparation(installRoot,{locked:true})
      if(!checked.planned)return checked.report
      const {planned,journal}=checked,backup=join(paths.root,journal.backup)
      await createBackup(backup,planned)
      await verifyTargets(paths.directory,planned,checked.report.status==='interrupted')
      await atomicWrite(join(paths.directory,journalName),JSON.stringify(journal,null,2)+'\n')
      // Commit metadata last. Runtime refuses the journal at every intermediate stage.
      const writes=[...planned.writes].filter(([name])=>name!=='scope.json')
      writes.push(['scope.json',planned.writes.get('scope.json')])
      for(const [name,text]of writes){if(text===null){if(await readRegular(join(paths.directory,name))!==undefined)await unlink(join(paths.directory,name))}else await atomicWrite(join(paths.directory,name),text);await afterWrite?.(name)}
      const receipt={version:1,layoutVersion:LAYOUT_VERSION,status:'completed',sourceDigest:planned.digest,backup:journal.backup,entries:planned.entries,candidates:planned.candidates,completedAt:new Date().toISOString()}
      await atomicWrite(join(paths.directory,receiptName),JSON.stringify(receipt,null,2)+'\n')
      await unlink(join(paths.directory,journalName))
      if(process.platform!=='win32'){const directory=await open(paths.directory,'r');try{await directory.sync()}finally{await directory.close()}}
      return {status:'completed',ready:true,receipt}
    }finally{await releaseMemory()}
  }finally{await releaseHost()}
}
