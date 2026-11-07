import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {readFile,lstat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {routerSchema,routerSchemaVersion,routerTables} from '../channels/router-ledger.js'
import {ingressTimestamp} from '../../packages/dingtalk-core/dynamic-task-store.js'
import {runtimePaths,inside} from './paths.js'
import {acquireLock,failure} from './files.js'
import {checkedTaskDirectory} from '../../packages/dingtalk-core/session-workspaces.js'

const sha=value=>createHash('sha256').update(value).digest('hex')
const stable=value=>sha(JSON.stringify(value))
const existsTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
const rows=(db,name)=>existsTable(db,name)?db.prepare(`SELECT id,body FROM ${name} ORDER BY id`).all().map(row=>({...row,body:JSON.parse(row.body)})):[]
const optional=async path=>{try{return (await safeFile(path)).toString('utf8')}catch(error){if(error.code!=='ENOENT')throw error}}
async function safeFile(path){await checkedTaskDirectory(resolve(path,'..'));const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw failure('ROUTER_UPGRADE_UNSAFE_PATH');return readFile(path)}
async function noWal(path){for(const suffix of ['-wal','-shm']){const info=await lstat(path+suffix).catch(error=>{if(error.code!=='ENOENT')throw error});if(info&&(!info.isFile()||info.isSymbolicLink()||info.nlink!==1))throw failure('ROUTER_UPGRADE_UNSAFE_PATH');if(suffix==='-wal'&&info?.size)throw failure('ROUTER_UPGRADE_CHECKPOINT_REQUIRED')}}
function live(pid){if(!Number.isSafeInteger(pid)||pid<1)throw failure('ROUTER_UPGRADE_OWNER_INVALID');try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
function sourceDisposition(source,{sources,contexts,groups}){
  if(sources.some(row=>row.body.groupId===source.groupId&&row.body.messageId===source.messageId&&row.body.version>source.version))return {state:'historical',reason:'superseded-version'}
  const context=contexts[source.groupId],group=groups.find(row=>row.groupId===source.groupId),message=group?.messages?.find(row=>row.messageId===source.messageId&&row.messageVersion===source.version)
  if(!context||!['chat','chat-room'].includes(context.type)||!context.channelId||!context.participants?.[source.actorId])return {state:'held',reason:'authenticated-conversation-unproven'}
  if(message&&(message.senderOpenDingTalkId!==source.actorId||message.text!==source.text))return {state:'held',reason:'source-identity-conflict'}
  if(message?.routingHold)return {state:'held',reason:'unresolved-routing-hold'}
  if(source.processingCompleted&&source.processingPending!==true)return {state:'historical',reason:'recorded-processing-completed'}
  if(source.routed!==true&&source.processingPending===true&&message?.routingStatus==='pending'&&!message.units?.length)return {state:'pending',reason:'recorded-unprocessed-source'}
  return {state:'held',reason:'legacy-disposition-uncertain'}
}
function conversion(db,resident,contexts){
  const sources=rows(db,'dynamic_sources'),groups=Object.values(resident?.tables?.groups??{}),environment={sources,contexts,groups}
  const sourcePlans=sources.map(row=>({sourceId:row.id,messageVersion:row.body.version,conversationId:row.body.groupId,...sourceDisposition(row.body,environment)}))
  const unlinked=[]
  for(const group of groups)for(const message of group.messages??[]){
    if(sources.some(row=>row.body.groupId===group.groupId&&row.body.messageId===message.messageId&&row.body.version===message.messageVersion))continue
    const id='upgrade-message:'+stable([group.groupId,message.messageId,message.messageVersion])
    unlinked.push({id,conversationId:group.groupId,messageId:message.messageId,messageVersion:message.messageVersion,state:'held',reason:'legacy-message-without-authenticated-ledger-source',sourceSnapshot:message})
  }
  const tasks=[...rows(db,'dynamic_tasks'),...rows(db,'dynamic_archived_tasks')]
  const links=[],taskPlans=[]
  for(const row of tasks){
    const task=row.body
    if(!task.topicRefs?.length&&!groups.some(group=>group.groupId===task.groupId))continue
    const owned=sources.filter(source=>(task.sourceRefs??[]).includes(source.id))
    const context=contexts[task.groupId],valid=context&&owned.length===(task.sourceRefs??[]).length&&owned.length>0&&owned.every(source=>source.body.groupId===task.groupId&&context.participants?.[source.body.actorId])
    taskPlans.push({taskId:row.id,conversationId:valid?task.groupId:null,hold:!valid&&task.status!=='completed'&&task.control!=='cancelled'})
    for(const source of owned)links.push({id:'source-link:'+stable([row.id,source.id,source.body.version,'legacy-authorization',null]),taskId:row.id,conversationId:source.body.groupId,sourceId:source.id,messageVersion:source.body.version,relation:'legacy-authorization',anchor:null})
  }
  return {sourcePlans,unlinked,links,taskPlans}
}
async function inspect(config){
  const paths=runtimePaths(config);if(paths.mode!=='portable')throw failure('ROUTER_UPGRADE_PORTABLE_REQUIRED')
  const dbPath=join(paths.state,'tasks.sqlite'),residentPath=join(paths.state,'storage','dingtalk_dsh_assistant.json'),contextPath=join(paths.state,'channels','contexts.json')
  await noWal(dbPath)
  const database=await safeFile(dbPath),markerBytes=await safeFile(dbPath+'.initialized'),residentBytes=await optional(residentPath),contextBytes=await optional(contextPath)
  const marker=JSON.parse(markerBytes),resident=residentBytes===undefined?null:JSON.parse(residentBytes),contexts=JSON.parse(contextBytes??'{}')
  const instanceId=config.resident?.taskSessions?.instanceId
  if(!instanceId||marker.version!==1||typeof marker.initToken!=='string'||!marker.initToken||marker.instanceId!==instanceId||marker.phase!=='initialized')throw failure('ROUTER_UPGRADE_INSTANCE_MISMATCH')
  if(resident&&(resident.unit?.name!=='dingtalk_dsh_assistant'||resident.unit.version!==9||!resident.tables?.groups))throw failure('ROUTER_UPGRADE_RESIDENT_SCHEMA_INVALID')
  // immutable 防止只读检查因 WAL 模式创建 -wal/-shm；不调用会写 owner 的运行时 open。
  const db=new DatabaseSync(pathToFileURL(dbPath).href+'?immutable=1',{readOnly:true})
  try{
    const version=Number(db.prepare('PRAGMA user_version').get().user_version)
    if(db.prepare('PRAGMA application_id').get().application_id!==0x44535453||![2,3,4].includes(version)||db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw failure('ROUTER_UPGRADE_SCHEMA_INVALID')
    const meta=Object.fromEntries(db.prepare('SELECT key,value FROM dynamic_meta').all().map(row=>[row.key,row.value]))
    if(meta.instanceId!==instanceId||meta.initToken!==marker.initToken)throw failure('ROUTER_UPGRADE_INSTANCE_MISMATCH')
    const configuredEpoch=config.resident.taskSessions.ingressEpoch===undefined?null:ingressTimestamp(config.resident.taskSessions.ingressEpoch,false)
    if(config.resident.taskSessions.ingressEpoch!==undefined&&!configuredEpoch||(meta.ingressEpoch??null)!==configuredEpoch||(marker.ingressEpoch??null)!==configuredEpoch)throw failure('ROUTER_UPGRADE_INGRESS_EPOCH_MISMATCH')
    const blockReasons=[]
    const hostLock=await lstat(join(paths.runtime,'.host.lock')).catch(error=>{if(error.code!=='ENOENT')throw error})
    if(hostLock&&(!hostLock.isDirectory()||hostLock.isSymbolicLink()))throw failure('ROUTER_UPGRADE_UNSAFE_PATH')
    const hostOwner=JSON.parse(await optional(join(paths.runtime,'.host.lock','owner.json'))??'null')
    if(hostLock&&!hostOwner)blockReasons.push('host-lock-uncertain')
    if(hostOwner&&live(hostOwner.pid))blockReasons.push('host-running')
    if(meta.owner&&live(Number(meta.owner.split(':')[0])))blockReasons.push('ledger-writer-running')
    for(const name of ['restore.pending.json','task-restore.pending.json'])if(await optional(join(paths.runtime,name))!==undefined)blockReasons.push(name)
    const counts={tasks:rows(db,'dynamic_tasks').filter(row=>!row.body.drained||row.body.recovering).length,executions:rows(db,'dynamic_executions').filter(row=>!row.body.drained||row.body.recovering).length,groups:rows(db,'dynamic_groups').filter(row=>!row.body.drained||row.body.recovering).length,operations:rows(db,'dynamic_operations').filter(row=>!['succeeded','failed','cancelled'].includes(row.body.state)).length,notifications:rows(db,'dynamic_notifications').filter(row=>['starting','unknown'].includes(row.body.state)).length}
    for(const [name,count] of Object.entries(counts))if(count)blockReasons.push('unresolved-'+name)
    if(meta.router_schema!==undefined&&meta.router_schema!==routerSchemaVersion||version===4&&meta.router_schema!==routerSchemaVersion||version!==4&&meta.router_schema!==undefined)throw failure('ROUTER_UPGRADE_SCHEMA_INVALID')
    if(meta.router_schema===undefined&&routerTables.some(name=>rows(db,'dynamic_'+name).length))throw failure('ROUTER_UPGRADE_UNCOMMITTED_ROUTER_STATE')
    const plan=conversion(db,resident,contexts),expectedDigest=stable([sha(database),sha(markerBytes),residentBytes??null,contextBytes??null])
    return {paths,dbPath,residentPath,contextPath,plan,report:{kind:'resident-router-upgrade-check',fromVersion:version,toVersion:4,routerSchema:meta.router_schema??null,alreadyUpgraded:meta.router_schema===routerSchemaVersion,instanceId,expectedDigest,ready:blockReasons.length===0,blockReasons,blockers:counts,sourceDispositions:plan.sourcePlans,heldMessages:plan.unlinked.map(({sourceSnapshot,...reference})=>reference),taskConversions:plan.taskPlans,sourceLinks:plan.links.length,dependenciesCreated:0}}
  }finally{db.close()}
}
export async function inspectResidentRouterUpgrade(config){return (await inspect(config)).report}
async function verifyBackup(checked,backupPath){
  const root=resolve(backupPath??'');if(!backupPath||!inside(join(checked.paths.installRoot,'backups'),root)||root===join(checked.paths.installRoot,'backups'))throw failure('ROUTER_UPGRADE_BACKUP_REQUIRED')
  const manifest=JSON.parse(await safeFile(join(root,'manifest.json')))
  if(manifest.version!==1||manifest.installRoot!==checked.paths.installRoot||manifest.dataRoot!==checked.paths.data||!Array.isArray(manifest.files))throw failure('ROUTER_UPGRADE_BACKUP_INVALID')
  const required=['state/tasks.sqlite','state/tasks.sqlite.initialized',...await optional(checked.residentPath)!==undefined?['state/storage/dingtalk_dsh_assistant.json']:[],...await optional(checked.contextPath)!==undefined?['state/channels/contexts.json']:[]]
  const seen=new Set()
  for(const file of manifest.files){
    if(typeof file.path!=='string'||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(file.path)||!inside(root,resolve(root,file.path)))throw failure('ROUTER_UPGRADE_BACKUP_INVALID')
    seen.add(file.path)
    const bytes=await safeFile(join(root,file.path));if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw failure('ROUTER_UPGRADE_BACKUP_INVALID')
    if(required.includes(file.path)&&sha(await safeFile(join(checked.paths.data,file.path)))!==file.sha256)throw failure('ROUTER_UPGRADE_BACKUP_STALE')
  }
  if(required.some(path=>!seen.has(path)))throw failure('ROUTER_UPGRADE_BACKUP_INCOMPLETE')
}
export async function executeResidentRouterUpgrade(config,{backup,expectedDigest}={}){
  const checked=await inspect(config)
  if(!checked.report.ready)throw failure('ROUTER_UPGRADE_NOT_QUIESCENT')
  if(checked.report.alreadyUpgraded)return {...checked.report,kind:'resident-router-upgrade-result',applied:false}
  if(expectedDigest!==checked.report.expectedDigest)throw failure('ROUTER_UPGRADE_STATE_CHANGED')
  await verifyBackup(checked,backup)
  const release=await acquireLock(join(checked.paths.runtime,'.host.lock'),{timeoutMs:0});let db
  try{
    const locked=await inspect(config)
    // 自己的 host 锁不构成外部 writer；其它排空条件与 digest 仍必须完全匹配。
    if(locked.report.expectedDigest!==expectedDigest||locked.report.blockReasons.some(reason=>reason!=='host-running'))throw failure('ROUTER_UPGRADE_STATE_CHANGED')
    db=new DatabaseSync(checked.dbPath);db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE')
    await noWal(checked.dbPath)
    if(sha(await safeFile(checked.dbPath))!==sha(await safeFile(join(resolve(backup),'state','tasks.sqlite'))))throw failure('ROUTER_UPGRADE_STATE_CHANGED')
    db.exec(routerSchema)
    db.exec('CREATE TABLE IF NOT EXISTS dynamic_router_upgrade_audit(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(json_valid(body)))')
    const put=(table,body)=>db.prepare(`INSERT INTO ${table}(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(body.id,JSON.stringify(body))
    for(const entry of locked.plan.sourcePlans){
      const row=JSON.parse(db.prepare('SELECT body FROM dynamic_sources WHERE id=?').get(entry.sourceId).body)
      row.triageHold=entry.state!=='pending'
      row.routingUpgrade={state:entry.state,reason:entry.reason};put('dynamic_sources',row)
      if(entry.state==='pending')put('dynamic_triage',{id:'triage:'+row.sourceId,conversationId:row.groupId,sourceId:row.sourceId,messageVersion:row.version,state:'pending'})
    }
    for(const entry of locked.plan.unlinked)put('dynamic_router_upgrade_audit',entry)
    for(const entry of locked.plan.links)put('dynamic_source_links',entry)
    for(const entry of locked.plan.taskPlans){
      const table=db.prepare('SELECT 1 FROM dynamic_tasks WHERE id=?').get(entry.taskId)?'dynamic_tasks':'dynamic_archived_tasks',task=JSON.parse(db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(entry.taskId).body)
      if(entry.conversationId)task.conversationId=entry.conversationId
      if(entry.hold){task.control='paused';task.routingUpgradeHold=true}
      db.prepare(`UPDATE ${table} SET body=? WHERE id=?`).run(JSON.stringify(task),entry.taskId)
    }
    db.prepare("INSERT INTO dynamic_meta(key,value) VALUES ('router_schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(routerSchemaVersion)
    db.prepare("INSERT INTO dynamic_meta(key,value) VALUES ('router_upgrade_digest',?)").run(expectedDigest)
    db.exec('PRAGMA user_version=4; COMMIT')
    return {...checked.report,kind:'resident-router-upgrade-result',applied:true,heldEffects:true,automaticDelivery:false}
  }catch(error){if(db?.isTransaction)db.exec('ROLLBACK');throw error}finally{db?.close();await release()}
}
