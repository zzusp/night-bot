import {createTaskArtifactFiles} from '../../packages/dingtalk-core/task-artifact-files.js'
import {memoryScope} from '../memory/scope.js'
import {ledgerDigest} from './ledger-archive.js'
import {DatabaseSync} from 'node:sqlite'
import {validatePiArchiveSession} from '../pi-session-persistence.js'
import {join,resolve,relative,dirname,isAbsolute} from 'node:path'
import {readdir,lstat,readFile,writeFile,rename,rm,open} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {atomicWrite,privateDirectory,readRegular,withLock,acquireLock,failure} from '../runtime/files.js'
import {runtimePaths,inside,prepareRuntimePaths} from '../runtime/paths.js'
import {registerTaskSession,taskSessionRoutes} from './session-routes.js'
import {taskDirectories,checkedTaskDirectory} from '../../packages/dingtalk-core/session-workspaces.js'
import {openDynamicTaskStore} from '../../packages/dingtalk-core/dynamic-task-store.js'
import {AttachmentFiles} from '../native-attachment-storage.js'
export const archiveHash=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=value=>JSON.stringify(value,null,2)+'\n'
const safeRelative=path=>typeof path==='string'&&path&&!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..')
async function bytes(path){await checkedTaskDirectory(dirname(path));const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw failure('TASK_ARCHIVE_UNSAFE_FILE');const file=await open(path,'r');try{const actual=await file.stat();if(actual.ino!==info.ino||actual.dev!==info.dev)throw failure('TASK_ARCHIVE_FILE_CHANGED');return await file.readFile()}finally{await file.close()}}
async function filesUnder(root,{excludeTmp=false}={}){
  const result=[]
  const walk=async(dir,prefix='')=>{await checkedTaskDirectory(dir);for(const entry of await readdir(dir,{withFileTypes:true})){const ref=prefix+entry.name;if(excludeTmp&&(ref==='tmp'||ref==='.archive.lock'||entry.name==='archive.manifest.json'))continue;if(entry.isSymbolicLink())throw failure('TASK_ARCHIVE_UNSAFE_FILE');if(entry.isDirectory())await walk(join(dir,entry.name),ref+'/');else if(entry.isFile()){const value=await bytes(join(dir,entry.name));result.push({path:ref,bytes:value.length,sha256:archiveHash(value)})}else throw failure('TASK_ARCHIVE_UNSAFE_FILE')}}
  await walk(root);return result.sort((a,b)=>a.path.localeCompare(b.path))
}
function attachmentRefs(value,result=new Map()){
  if(!value||typeof value!=='object')return result
  if(/^sha256:[a-f0-9]{64}$/.test(value.attachmentId??'')&&Number.isSafeInteger(value.bytes))result.set(JSON.stringify(value),value)
  for(const item of Object.values(value))attachmentRefs(item,result);return result
}
export class TaskArchives{
  constructor({paths,store,routes,onFailure=()=>{},onSuccess=()=>{}}){Object.assign(this,{paths,store,routes,onFailure,onSuccess});this.tails=new Map();this.dirty=new Set();this.errors=new Map();this.attachments=new AttachmentFiles(paths.data)}
  async register(task){await taskDirectories(this.paths.workspaces,task.taskId);for(const name of ['sessions','reviews','materials/runtime-evidence/process','materials/runtime-evidence/tools'])await privateDirectory(join(this.paths.workspaces,'tasks',task.taskId,name));return registerTaskSession(this.paths,this.routes,task)}
  schedule(taskId){
    if(!taskId)return;this.dirty.add(taskId);if(this.tails.has(taskId))return this.tails.get(taskId)
    const work=(async()=>{do{this.dirty.delete(taskId);try{await this.capture(taskId);this.errors.delete(taskId);this.onSuccess(taskId)}catch(error){this.errors.set(taskId,error.code??'TASK_ARCHIVE_CAPTURE_FAILED');this.onFailure(taskId,error)}}while(this.dirty.has(taskId))})().finally(()=>{if(this.tails.get(taskId)===work)this.tails.delete(taskId);if(this.dirty.has(taskId))this.schedule(taskId)})
    this.tails.set(taskId,work);return work
  }

  async capture(taskId){
    const ledger=await this.store.exportTaskArchive(taskId),task=ledger.tables.tasks[0].body,{root}=await this.register(task)
    return withLock(join(root,'.archive.lock'),async()=>{
      const current=await this.store.exportTaskArchive(taskId),refs=attachmentRefs(current)
      const session=this.routes.get(task.sessionId);let journal
      try{journal=await bytes(session)}catch(error){if(error.code!=='ENOENT')throw error;if(task.sessionBound)throw failure('TASK_ARCHIVE_SESSION_MISSING')}
      if(journal)for(const line of journal.toString().split('\n').filter(Boolean))try{attachmentRefs(JSON.parse(line),refs)}catch{throw failure('TASK_ARCHIVE_SESSION_INCOMPLETE')}
      const attachments=[]
      for(const ref of refs.values()){
        const digest=ref.attachmentId.slice(7),target='materials/attachments/'+digest+'.bin';let content
        try{content=await bytes(join(root,target))}catch(error){if(error.code!=='ENOENT')throw error;const source=ref.width!==undefined?this.attachments.imagePath(ref):this.attachments.filePath(ref);await this.attachments.checkedLeaf(source);content=await readFile(source)}
        if(content.length!==ref.bytes||archiveHash(content)!==digest)throw failure('TASK_ARCHIVE_ATTACHMENT_CORRUPT');await atomicWrite(join(root,target),content);attachments.push({ref,path:target,sha256:digest})
      }
      const reviewCoverage=[]
      for(const row of current.tables.task_events){const event=row.body;if(event.kind!=='task.completed')continue;const id=archiveHash(event.id),destination=join(root,'reviews',id+'.json');const owner=current.tables.tasks[0].body.ownerActorId
        if(owner){const binding={actorId:owner,...task.groupId&&task.metadata?.channelType!=='chat'?{groupId:task.metadata?.memoryGroupId??task.groupId,groupWrite:true}:{}},scope=memoryScope(binding,{scope:binding.groupId?'group':'personal'}),source=join(this.paths.memory,'v1',scope.kind,scope.id,'evolution','reviews',id+'.json'),saved=await readRegular(source)
          if(saved){const report=JSON.parse(saved);if(report.taskId!==taskId||report.eventId!==event.id)throw failure('TASK_ARCHIVE_REVIEW_SCOPE_INVALID');if(!report.destinations)report.destinations=(report.lessons??[]).map(lesson=>({memory:{scope,topic:'experience',key:'task-'+id.slice(0,12)+'-'+lesson.key},...lesson.skill?{skill:{scope,key:lesson.key,status:'historical-reference-not-revalidated'}}:{}}));await atomicWrite(destination,json(report))}}
        const report=JSON.parse(await readRegular(destination)??'null');reviewCoverage.push({eventId:event.id,status:report?.status??'not-recorded',...report?{path:'reviews/'+id+'.json'}:{}})
      }
      const body={version:1,kind:'night-bot-task-archive',taskId,sessionId:task.sessionId,sourceInstallRoot:this.paths.installRoot,taskDirectoryRelative:relative(this.paths.installRoot,root).split('\\').join('/'),ledger:current,attachments,reviewCoverage,publicScopeCollectionsIncluded:false,consistency:'live-projection',capturedAt:new Date().toISOString(),authority:'SQLite is authoritative while installed; this file is an export, never polled as commands.'}
      await atomicWrite(join(root,'task.json'),json(body));return body
    })
  }
  async recordReview(taskId,report){const task=await this.store.query({kind:'task.get',taskId});if(!task)return;const {root}=await this.register(task);let changed=false;await withLock(join(root,'.archive.lock'),async()=>{const file=join(root,'reviews',archiveHash(report.eventId)+'.json'),value=json(report);if(await readRegular(file)!==value){await atomicWrite(file,value);changed=true}});if(changed)this.schedule(taskId)}
  async idle(){while(this.tails.size)await Promise.all([...this.tails.values()])}
  async seal(taskId){
    await this.idle();await this.capture(taskId);const root=join(this.paths.workspaces,'tasks',taskId)
    return withLock(join(root,'.archive.lock'),async()=>{
      const snapshot=JSON.parse(await readRegular(join(root,'task.json'))),task=snapshot.ledger.tables.tasks[0].body
      if(!task.drained||task.recovering||snapshot.ledger.tables.executions.length)throw failure('TASK_ARCHIVE_NOT_DRAINED')
      if((await readdir(join(root,'sessions'))).some(name=>name.endsWith('.lock')))throw failure('TASK_ARCHIVE_SESSION_BUSY')
      const current=await this.store.exportTaskArchive(taskId);if(current.digest!==snapshot.ledger.digest)throw failure('TASK_ARCHIVE_STALE')
      snapshot.consistency='offline-sealed';await atomicWrite(join(root,'task.json'),json(snapshot));const files=await filesUnder(root,{excludeTmp:true}),manifest={version:1,kind:'night-bot-task-seal',taskId,ledgerDigest:current.digest,files};await atomicWrite(join(root,'archive.manifest.json'),json(manifest));await validateTaskArchive(root);return {root,manifest,snapshot}
    })
  }
}
export async function validateTaskArchive(root){
  root=resolve(root);await checkedTaskDirectory(root);const manifest=JSON.parse(await readRegular(join(root,'archive.manifest.json'))??'null'),snapshot=JSON.parse(await readRegular(join(root,'task.json'))??'null')
  if(typeof snapshot?.taskId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(snapshot.taskId)||/[.]$/.test(snapshot.taskId)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(snapshot.taskId)||typeof snapshot.sourceInstallRoot!=='string'||!isAbsolute(snapshot.sourceInstallRoot)||manifest?.version!==1||manifest.kind!=='night-bot-task-seal'||!Array.isArray(manifest.files)||snapshot?.kind!=='night-bot-task-archive'||snapshot.consistency!=='offline-sealed'||manifest.taskId!==snapshot.taskId||manifest.ledgerDigest!==snapshot.ledger?.digest)throw failure('TASK_ARCHIVE_MANIFEST_INVALID')
  const seen=new Set();for(const file of manifest.files){if(!safeRelative(file.path)||seen.has(file.path)||file.path==='archive.manifest.json'||file.path.startsWith('tmp/'))throw failure('TASK_ARCHIVE_MANIFEST_INVALID');seen.add(file.path);const value=await bytes(join(root,file.path));if(value.length!==file.bytes||archiveHash(value)!==file.sha256)throw failure('TASK_ARCHIVE_HASH_MISMATCH')}
  const actual=await filesUnder(root,{excludeTmp:true});if(JSON.stringify(actual)!==JSON.stringify(manifest.files)||!seen.has('task.json')||!seen.has('.task-session.json'))throw failure('TASK_ARCHIVE_MANIFEST_INCOMPLETE')
  if(snapshot.ledger.digest!==ledgerDigest({version:snapshot.ledger.version,taskId:snapshot.ledger.taskId,tables:snapshot.ledger.tables}))throw failure('TASK_ARCHIVE_LEDGER_INVALID')
  const owner=JSON.parse(await readRegular(join(root,'.task-session.json')));if(owner.taskId!==snapshot.taskId||owner.sessionId!==snapshot.sessionId||snapshot.taskDirectoryRelative!=='data/workspaces/tasks/'+snapshot.taskId)throw failure('TASK_ARCHIVE_IDENTITY_INVALID')
  const task=snapshot.ledger?.tables?.tasks?.[0]?.body;if(task?.taskId!==snapshot.taskId||task?.sessionId!==snapshot.sessionId)throw failure('TASK_ARCHIVE_IDENTITY_INVALID');const sessionPath='sessions/'+archiveHash(snapshot.sessionId)+'.pi.jsonl';if(task?.sessionBound){if(!seen.has(sessionPath))throw failure('TASK_ARCHIVE_SESSION_MISSING');const session=await validatePiArchiveSession(join(root,sessionPath),snapshot.sessionId);if(session.header.portableCwd!==snapshot.taskDirectoryRelative||session.events.find(event=>event.type==='plugin:night/task-identity')?.data.taskId!==snapshot.taskId||session.committedBytes!==session.totalBytes)throw failure('TASK_ARCHIVE_SESSION_IDENTITY_INVALID')}
  const selected=task.completion?.result?.artifactFiles??[];if(selected.length){const artifacts=createTaskArtifactFiles({root:join(root,'outputs'),getTaskDirectories:id=>{if(id!==snapshot.taskId)throw failure('TASK_ARCHIVE_ARTIFACT_SCOPE_INVALID');return {outputs:join(root,'outputs')}}});await artifacts.validateManifest(selected.map(file=>file.artifact),task)}
  for(const file of snapshot.attachments){if(!safeRelative(file.path)||!seen.has(file.path)||archiveHash(await bytes(join(root,file.path)))!==file.ref.attachmentId?.slice(7))throw failure('TASK_ARCHIVE_ATTACHMENT_CORRUPT')}
  return {root,manifest,snapshot}
}
async function offline(config,work,{allowPending=false}={}){
  const paths=runtimePaths(config);if(paths.mode!=='portable')throw failure('TASK_ARCHIVE_PORTABLE_REQUIRED');await prepareRuntimePaths(paths);const release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0});let store
  try{if(await readRegular(join(paths.runtime,'restore.pending.json'))!==undefined||!allowPending&&await readRegular(join(paths.runtime,'task-restore.pending.json'))!==undefined)throw failure('TASK_ARCHIVE_RESTORE_INCOMPLETE');const c=config.resident?.taskSessions;if(!c?.instanceId)throw failure('TASK_ARCHIVE_CONFIGURATION_REQUIRED');store=await openDynamicTaskStore({...c,dbPath:join(paths.state,'tasks.sqlite')});return await work({paths,store,routes:await taskSessionRoutes(paths)})}finally{await store?.close();await release()}
}
export async function backupTask(config,taskId,destination){return offline(config,async options=>{
  const target=resolve(destination);if(!inside(join(options.paths.installRoot,'backups'),target)||target===join(options.paths.installRoot,'backups'))throw failure('TASK_ARCHIVE_BACKUP_OUTSIDE_ROOT');if(await lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e}))throw failure('TASK_ARCHIVE_DESTINATION_EXISTS')
  const archive=new TaskArchives(options),sealed=await archive.seal(taskId),stage=target+'.pending-'+randomUUID();await checkedTaskDirectory(stage,true)
  try{for(const file of sealed.manifest.files){await privateDirectory(dirname(join(stage,file.path)));await writeFile(join(stage,file.path),await bytes(join(sealed.root,file.path)),{mode:0o600,flag:'wx'})}await atomicWrite(join(stage,'archive.manifest.json'),json(sealed.manifest));await validateTaskArchive(stage);await rename(stage,target);return {ok:true,taskId,destination:target,files:sealed.manifest.files.length}}finally{await rm(stage,{recursive:true,force:true})}
})}
async function repopulateAttachments(options,snapshot,root){const storage=new AttachmentFiles(options.paths.data)
  for(const item of snapshot.attachments){const value=await bytes(join(root,item.path));if(item.ref.width!==undefined)await storage.saveImage({data:value,ref:item.ref});else await storage.saveFile({data:[value],name:item.ref.name})}
}
export async function restoreTask(config,source,{rebuild=false}={}){return offline(config,async options=>{
  const checked=await validateTaskArchive(source),{snapshot,manifest}=checked,root=join(options.paths.workspaces,'tasks',snapshot.taskId),marker=join(options.paths.runtime,'task-restore.pending.json')
  if(rebuild&&resolve(source)!==root)throw failure('TASK_ARCHIVE_REBUILD_SOURCE_INVALID')
  if(!rebuild&&await lstat(root).catch(e=>{if(e.code!=='ENOENT')throw e}))throw failure('TASK_ARCHIVE_DESTINATION_EXISTS')
  if(await options.store.query({kind:'task.get',taskId:snapshot.taskId}))throw failure('TASK_ARCHIVE_TASK_EXISTS')
  const stage=root+'.restore-'+randomUUID();let published=rebuild
  await atomicWrite(marker,json({version:1,taskId:snapshot.taskId,root,source:resolve(source),stage,sourceDigest:snapshot.ledger.digest,phase:'prepared',rebuild,snapshot}))
  try{
    if(!rebuild){await privateDirectory(stage);for(const file of manifest.files){await privateDirectory(dirname(join(stage,file.path)));await writeFile(join(stage,file.path),await bytes(join(checked.root,file.path)),{flag:'wx',mode:0o600})}await atomicWrite(join(stage,'archive.manifest.json'),json(manifest));await validateTaskArchive(stage);await rename(stage,root);published=true}
    await repopulateAttachments(options,snapshot,root);await registerTaskSession(options.paths,options.routes,snapshot.ledger.tables.tasks[0].body)
    const result=await options.store.importTaskArchive(snapshot.ledger)
    await atomicWrite(marker,json({version:1,taskId:snapshot.taskId,root,source:resolve(source),stage,sourceDigest:snapshot.ledger.digest,phase:'committed',rebuild,snapshot}))
    await rebindMaterials(snapshot,root,manifest);await new TaskArchives(options).seal(snapshot.taskId);await rm(marker);return {ok:true,...result,root,reindexed:true,memoryAndSkillsRestored:false}
  }catch(error){if(published)throw Object.assign(failure('TASK_ARCHIVE_RESTORE_INCOMPLETE'),{cause:error,taskId:snapshot.taskId});await rm(marker);throw error}finally{await rm(stage,{recursive:true,force:true})}
})}
export async function inspectTaskArchive(config,taskId){return offline(config,async options=>{const checked=await validateTaskArchive(join(options.paths.workspaces,'tasks',taskId)),current=await options.store.exportTaskArchive(taskId);if(current.digest!==checked.snapshot.ledger.digest)throw failure('TASK_ARCHIVE_STALE');return {ok:true,taskId,files:checked.manifest.files.length,ledgerDigest:current.digest}})}

async function rebindMaterials(snapshot,root,manifest){
  // Never rewrite chat text, tool arguments or effect receipts.
    const priorRoot=resolve(snapshot.sourceInstallRoot,snapshot.taskDirectoryRelative)
    for(const file of manifest.files.filter(f=>/^materials\/source-[a-f0-9]+\.json$/.test(f.path))){const value=JSON.parse(await readRegular(join(root,file.path)));const rebind=path=>typeof path==='string'&&inside(priorRoot,path)?join(root,relative(priorRoot,path)):path;value.path=rebind(value.path);value.textPath=rebind(value.textPath);for(const resource of value.resources??[]){resource.path=rebind(resource.path);if(resource.value?.image)resource.value.image.path=rebind(resource.value.image.path)}await atomicWrite(join(root,file.path),json(value))}
}

export async function recoverTaskRestore(config){const early=await recoverIndexPublication(config);if(early)return early;return offline(config,async options=>{
  const marker=join(options.paths.runtime,'task-restore.pending.json'),pending=JSON.parse(await readRegular(marker)??'null');if(!pending)return {ok:true,pending:false}
  const manager=new TaskArchives(options)
  if(pending.kind==='adopt'){const result=await adoptOwnedTask(options,pending.taskId);await rm(marker);return {ok:true,recovered:true,...result}}
  if(pending.kind==='index'){
    if(pending.phase!=='committed')throw failure('TASK_ARCHIVE_INDEX_RECOVERY_UNCERTAIN')
    for(const taskId of pending.taskIds){const task=await options.store.query({kind:'task.get',taskId});if(!task?.archiveRestore?.reviewRequired)throw failure('TASK_ARCHIVE_INDEX_RECOVERY_UNCERTAIN');const root=join(options.paths.workspaces,'tasks',taskId),snapshot=JSON.parse(await readRegular(join(root,'task.json')));await repopulateAttachments(options,snapshot,root);await rebindMaterials(snapshot,root,{files:await filesUnder(root,{excludeTmp:true})});await manager.seal(taskId)}await rm(marker);return {ok:true,recovered:true,tasks:pending.taskIds}
  }
  const expected=join(options.paths.workspaces,'tasks',pending.taskId);if(pending.root!==expected||pending.snapshot?.taskId!==pending.taskId)throw failure('TASK_ARCHIVE_RESTORE_MARKER_INVALID')
  const task=await options.store.query({kind:'task.get',taskId:pending.taskId})
  if(task){if(task.archiveRestore?.sourceDigest!==pending.sourceDigest)throw failure('TASK_ARCHIVE_RESTORE_CONFLICT');await rebindMaterials(pending.snapshot,expected,{files:(await filesUnder(expected,{excludeTmp:true})).filter(file=>file.path!=='archive.manifest.json')});await manager.seal(pending.taskId);await rm(marker);return {ok:true,recovered:true,taskId:pending.taskId}}
  if(pending.phase!=='prepared')throw failure('TASK_ARCHIVE_RESTORE_CONFLICT')
  if(!pending.rebuild)await rm(expected,{recursive:true,force:true});if(pending.stage&&inside(options.paths.workspaces,pending.stage))await rm(pending.stage,{recursive:true,force:true});await rm(marker);return {ok:true,rolledBack:true,taskId:pending.taskId}
},{allowPending:true})}

/** Explicitly rebuild only a lost/missing ledger. Existing databases are never replaced. */
export async function rebuildTaskIndex(config){
  const paths=runtimePaths(config);await prepareRuntimePaths(paths);if(paths.mode!=='portable')throw failure('TASK_ARCHIVE_PORTABLE_REQUIRED');const release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0}),dbPath=join(paths.state,'tasks.sqlite'),marker=join(paths.runtime,'task-restore.pending.json'),stage=join(paths.state,'.task-index-'+randomUUID()+'.sqlite');let store,published=false,complete=false
  try{
    if(await lstat(dbPath).catch(e=>{if(e.code!=='ENOENT')throw e}))throw failure('TASK_ARCHIVE_INDEX_DATABASE_EXISTS')
    if(await readRegular(marker)!==undefined)throw failure('TASK_ARCHIVE_RESTORE_INCOMPLETE')
    const routes=await taskSessionRoutes(paths),root=join(paths.workspaces,'tasks'),checked=[]
    for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())throw failure('TASK_ARCHIVE_PATH_UNSAFE');checked.push(await validateTaskArchive(join(root,entry.name)))}
    if(!checked.length)throw failure('TASK_ARCHIVE_NO_TASKS');const c=config.resident?.taskSessions;if(!c?.instanceId)throw failure('TASK_ARCHIVE_CONFIGURATION_REQUIRED')
    store=await openDynamicTaskStore({...c,dbPath:stage,initialize:true});for(const item of checked)await store.importTaskArchive(item.snapshot.ledger);await store.close();store=undefined
    const previous=await readRegular(dbPath+'.initialized');if(previous!==undefined)await atomicWrite(join(paths.installRoot,'backups','task-index-'+randomUUID(),'previous.initialized'),previous)
    // Publish data first. The explicit marker blocks Host startup throughout the paired-file gap.
    await atomicWrite(marker,json({version:1,kind:'index',phase:'prepared',stage,taskIds:checked.map(item=>item.snapshot.taskId)}));await rename(stage,dbPath);published=true;await rename(stage+'.initialized',dbPath+'.initialized')
    await atomicWrite(marker,json({version:1,kind:'index',phase:'committed',taskIds:checked.map(item=>item.snapshot.taskId)}))
    store=await openDynamicTaskStore({...c,dbPath});const manager=new TaskArchives({paths,store,routes});for(const item of checked){await repopulateAttachments({paths},item.snapshot,item.root);await rebindMaterials(item.snapshot,item.root,item.manifest);await manager.seal(item.snapshot.taskId)}await rm(marker);complete=true;return {ok:true,reindexed:checked.map(item=>item.snapshot.taskId),allTasksPaused:true}
  }catch(error){if(published)throw Object.assign(failure('TASK_ARCHIVE_RESTORE_INCOMPLETE'),{cause:error});throw error}finally{await store?.close();if(!published||complete){await rm(stage,{force:true});await rm(stage+'.initialized',{force:true})}await release()}
}

async function recoverIndexPublication(config){
  const paths=runtimePaths(config);await prepareRuntimePaths(paths);const release=await acquireLock(join(paths.runtime,'.host.lock'),{timeoutMs:0});try{
    const marker=join(paths.runtime,'task-restore.pending.json'),pending=JSON.parse(await readRegular(marker)??'null');if(pending?.kind!=='index'||pending.phase!=='prepared')return
    if(typeof pending.stage!=='string'||dirname(pending.stage)!==paths.state||!/^\.task-index-[a-f0-9-]+\.sqlite$/.test(pending.stage.split(/[\\/]/).at(-1)))throw failure('TASK_ARCHIVE_INDEX_RECOVERY_UNCERTAIN')
    const dbPath=join(paths.state,'tasks.sqlite'),exists=await lstat(dbPath).catch(error=>{if(error.code!=='ENOENT')throw error})
    if(!exists){await rm(pending.stage,{force:true});await rm(pending.stage+'.initialized',{force:true});await rm(marker);return {ok:true,rolledBack:true,index:true}}
    if(!exists.isFile()||exists.isSymbolicLink())throw failure('TASK_ARCHIVE_INDEX_RECOVERY_UNCERTAIN')
    const init=JSON.parse(await readRegular(pending.stage+'.initialized')??await readRegular(dbPath+'.initialized')??'null'),db=new DatabaseSync(dbPath,{readOnly:true})
    try{if(!init||init.instanceId!==config.resident?.taskSessions?.instanceId||db.prepare("SELECT value FROM dynamic_meta WHERE key='initToken'").get()?.value!==init.initToken)throw failure('TASK_ARCHIVE_INDEX_RECOVERY_UNCERTAIN');for(const taskId of pending.taskIds){const row=db.prepare('SELECT body FROM dynamic_tasks WHERE id=?').get(taskId);if(!row||!JSON.parse(row.body).archiveRestore?.reviewRequired)throw failure('TASK_ARCHIVE_INDEX_RECOVERY_UNCERTAIN')}}finally{db.close()}
    await atomicWrite(dbPath+'.initialized',json(init));await atomicWrite(marker,json({...pending,phase:'committed'}));await rm(pending.stage+'.initialized',{force:true})
  }finally{await release()}
}
export async function acknowledgeTaskRestore(config,taskId,note){return offline(config,async options=>{
  if(typeof note!=='string'||!note.trim())throw failure('TASK_ARCHIVE_REVIEW_NOTE_REQUIRED');const task=await options.store.query({kind:'task.get',taskId});if(!task)throw failure('TASK_ARCHIVE_TASK_MISSING')
  const result=await options.store.command({id:'archive-review:'+archiveHash(JSON.stringify([taskId,task.archiveRestore?.sourceDigest,note])),kind:'task.archive.reviewed',args:{taskId,actorId:config.resident.taskSessions.webActorId,checks:{effects:true,scope:true,dependencies:true},note}});await new TaskArchives(options).seal(taskId);return {ok:true,taskId,reviewed:true,control:result.result.task.control,notificationsRemainHeld:true}
})}

async function adoptOwnedTask(options,taskId){
  const task=await options.store.query({kind:'task.get',taskId});if(!task||!task.drained||task.recovering||(await options.store.query({kind:'execution.list',taskId})).length)throw failure('TASK_ARCHIVE_NOT_DRAINED')
  const directories=await taskDirectories(options.paths.workspaces,taskId),central=join(options.paths.state,'sessions',archiveHash(task.sessionId)+'.pi.jsonl'),target=join(directories.root,'sessions',archiveHash(task.sessionId)+'.pi.jsonl')
  if(await lstat(central+'.lock').catch(error=>{if(error.code!=='ENOENT')throw error}))throw failure('TASK_ARCHIVE_SESSION_BUSY')
  const existing=await lstat(central).catch(error=>{if(error.code!=='ENOENT')throw error});const source=existing?central:target
  if(task.sessionBound){const session=await validatePiArchiveSession(source,task.sessionId);if(session.header.agentPreset!=='night-bot-task'||session.header.portableCwd!==relative(options.paths.installRoot,directories.root).split('\\').join('/')||session.events.find(event=>event.type==='plugin:night/task-identity')?.data.taskId!==taskId||session.committedBytes!==session.totalBytes)throw failure('TASK_ARCHIVE_NOT_OWNED_SINGLE_TASK');const value=await bytes(source);if(source!==target){const prior=await lstat(target).catch(error=>{if(error.code!=='ENOENT')throw error});if(prior&&archiveHash(await bytes(target))!==archiveHash(value))throw failure('TASK_ARCHIVE_SESSION_CONFLICT');if(!prior)await atomicWrite(target,value)}}
  await registerTaskSession(options.paths,options.routes,task,{relocate:true});if(existing)await rm(central)
  for(const file of task.completion?.result?.artifactFiles??[]){const artifact=file.artifact;if(artifact.taskId!==taskId||!/^[a-f0-9]{64}$/.test(artifact.artifactId))throw failure('TASK_ARCHIVE_ARTIFACT_SCOPE_INVALID');const from=join(options.paths.workspaces,'delivery-files',taskId,artifact.artifactId),to=join(directories.outputs,taskId,artifact.artifactId);for(const name of [artifact.fileName,'descriptor.json']){if(name.includes('/')||name.includes('\\')||name==='..')throw failure('TASK_ARCHIVE_ARTIFACT_SCOPE_INVALID');const prior=await lstat(join(to,name)).catch(error=>{if(error.code!=='ENOENT')throw error});if(prior)continue;const value=await bytes(join(from,name));if(name!=='descriptor.json'&&(archiveHash(value)!==artifact.sha256||value.length!==artifact.size))throw failure('TASK_ARCHIVE_ARTIFACT_CORRUPT');await atomicWrite(join(to,name),value)}}
  const manager=new TaskArchives(options);await manager.seal(taskId);return {taskId,root:directories.root,existingNightBotOnly:true}
}
/** Explicit offline packing of Night Bot's own existing single-task Pi data;
 * no DSH journals, legacy execution teams or foreign data are imported. */
export async function adoptTaskArchive(config,taskId){return offline(config,async options=>{
  const existing=await options.store.query({kind:'task.get',taskId});if(!existing)throw failure('TASK_ARCHIVE_TASK_MISSING');if(!existing.drained||existing.recovering)throw failure('TASK_ARCHIVE_NOT_DRAINED');await taskDirectories(options.paths.workspaces,taskId);const marker=join(options.paths.runtime,'task-restore.pending.json');await atomicWrite(marker,json({version:1,kind:'adopt',taskId}));try{const result=await adoptOwnedTask(options,taskId);await rm(marker);return {ok:true,...result}}catch(error){throw Object.assign(failure('TASK_ARCHIVE_RESTORE_INCOMPLETE'),{cause:error})}
})}
