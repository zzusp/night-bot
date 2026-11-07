import {createHash} from 'node:crypto'
import {archiveTable,receiptOwnerSql} from '../../packages/dingtalk-core/task-archive.js'
const fail=code=>{throw Object.assign(Error(code),{code})}
export const ledgerDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const own=['tasks','executions','operations','wakes','notifications','task_events']
const routing=['source_links','dependencies','completion_evaluations']
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const normalize=body=>Object.fromEntries(Object.entries(body).filter(([key])=>key!=='archiveRestoreHold'))
const tableExists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
const historicalTable='dynamic_task_topic_audit'
function installHistory(db){db.exec(`CREATE TABLE IF NOT EXISTS ${historicalTable}(id TEXT PRIMARY KEY,body TEXT NOT NULL CHECK(json_valid(body)))`)}
function names(version){return [...own,...version===1?['topic_facts']:[...routing,'historical_topic_facts'],'sources','receipts']}
function sqlTable(name){return name==='historical_topic_facts'?historicalTable:'dynamic_'+name}
function receiptOwned(body,taskId){
  const result=body.result??{}
  if(['coordination','members','member','occurrence','schedule','job','runtime','source','tasks','conversation','dependency','evaluation','dispositions'].some(key=>result[key]!==undefined))return false
  const ids=[body.taskDecision?.taskId,...['task','execution','operation','binding','notification'].map(key=>result[key]?.taskId)].filter(id=>id!=null)
  return ids.length>0&&ids.every(id=>id===taskId)
}
export function validateTaskLedger(snapshot){
  if(!record(snapshot)||![1,2].includes(snapshot.version)||snapshot.digest!==ledgerDigest({version:snapshot.version,taskId:snapshot.taskId,tables:snapshot.tables}))fail('TASK_ARCHIVE_LEDGER_INVALID')
  const {taskId,tables}=snapshot,expected=names(snapshot.version)
  if(typeof taskId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(taskId)||!record(tables)||Object.keys(tables).sort().join()!==expected.toSorted().join()||expected.some(name=>!Array.isArray(tables[name]))||tables.tasks.length!==1)fail('TASK_ARCHIVE_LEDGER_INVALID')
  const task=tables.tasks[0]?.body
  if(!record(task)||task.taskId!==taskId||task.id!==taskId)fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
  for(const name of expected){
    const seen=new Set()
    for(const row of tables[name]){
      if(!record(row)||typeof row.id!=='string'||!row.id||!record(row.body)||seen.has(row.id))fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
      seen.add(row.id)
      if(name!=='receipts'&&row.body.id!==row.id||row.sequence!==undefined&&(!Number.isSafeInteger(row.sequence)||row.sequence<1))fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
      if(name==='tasks'?row.id!==taskId:name==='sources'?!(task.sourceRefs??[]).includes(row.id):name==='receipts'?!receiptOwned(row.body,taskId):row.body.taskId!==taskId)fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
      if(name==='sources'&&(row.body.sourceId!==row.id||!Number.isSafeInteger(row.body.version)||row.body.version<1))fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
      if(name==='receipts'&&!/^[a-f0-9]{64}$/.test(row.digest))fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
      if(name==='dependencies'&&(typeof row.body.prerequisiteTaskId!=='string'||row.body.prerequisiteTaskId===taskId||!Number.isSafeInteger(row.body.prerequisiteRequirementRevision)))fail('TASK_ARCHIVE_DEPENDENCY_INVALID')
      if(name==='source_links'&&!tables.sources.some(source=>source.id===row.body.sourceId&&source.body.version===row.body.messageVersion&&source.body.groupId===row.body.conversationId))fail('TASK_ARCHIVE_SOURCE_MISSING')
      if(name==='dependencies'&&!tables.sources.some(source=>source.id===row.body.authorizationSourceId&&source.body.version===row.body.authorizationSourceVersion))fail('TASK_ARCHIVE_SOURCE_MISSING')
      if(name==='completion_evaluations'&&!tables.dependencies.some(dependency=>dependency.id===row.body.dependencyId&&dependency.body.prerequisiteTaskId===row.body.prerequisiteTaskId))fail('TASK_ARCHIVE_DEPENDENCY_INVALID')
    }
  }
  if((task.sourceRefs??[]).some(id=>!tables.sources.some(row=>row.id===id)))fail('TASK_ARCHIVE_SOURCE_MISSING')
  return snapshot
}
/** 调用方持有账本事务；整群 inbox、Router 会话及前置任务全文不属于单任务归档。 */
export function exportTaskLedger(db,taskId){
  if(typeof taskId!=='string'||!taskId)fail('TASK_ARCHIVE_ID_INVALID')
  const tables={}
  for(const name of [...own,...routing]){
    const table=sqlTable(name),cold=archiveTable(table),condition=name==='tasks'?'id=?':"json_extract(body,'$.taskId')=?"
    tables[name]=[table,...cold?[cold]:[]].flatMap(t=>tableExists(db,t)?db.prepare(`SELECT id,body,${t===table?'rowid':'sequence'} AS sequence FROM ${t} WHERE ${condition} ORDER BY sequence`).all(taskId):[]).map(row=>({id:row.id,sequence:Number(row.sequence),body:JSON.parse(row.body)})).sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id))
  }
  const task=tables.tasks[0]?.body;if(!task||tables.tasks.length!==1)fail('TASK_ARCHIVE_TASK_MISSING')
  const history=new Map()
  for(const table of ['dynamic_topic_facts',historicalTable])if(tableExists(db,table))for(const row of db.prepare(`SELECT id,body FROM ${table} WHERE json_extract(body,'$.taskId')=? ORDER BY id`).all(taskId))history.set(row.id,{id:row.id,body:JSON.parse(row.body)})
  tables.historical_topic_facts=[...history.values()]
  tables.sources=(task.sourceRefs??[]).map(id=>db.prepare('SELECT id,body FROM dynamic_sources WHERE id=?').get(id)).map(row=>{if(!row)fail('TASK_ARCHIVE_SOURCE_MISSING');return {id:row.id,body:JSON.parse(row.body)}})
  tables.receipts=db.prepare(`SELECT id,digest,body,sequence FROM (SELECT r.id,r.rowid AS sequence,r.digest,coalesce(a.body,r.body) body FROM dynamic_receipts r LEFT JOIN dynamic_archived_receipts a ON a.id=r.id) WHERE ${receiptOwnerSql}=? ORDER BY sequence`).all(taskId).map(row=>({...row,body:JSON.parse(row.body)})).filter(row=>receiptOwned(row.body,taskId))
  const body={version:2,taskId,tables};return validateTaskLedger({...body,digest:ledgerDigest(body)})
}
export function importTaskLedger(db,snapshot){
  validateTaskLedger(snapshot)
  const {taskId,tables}=snapshot,task=tables.tasks[0].body
  if(!task.drained||task.recovering||tables.executions.length)fail('TASK_ARCHIVE_NOT_DRAINED')
  if(db.prepare('SELECT 1 FROM dynamic_tasks WHERE id=? UNION ALL SELECT 1 FROM dynamic_archived_tasks WHERE id=?').get(taskId,taskId))fail('TASK_ARCHIVE_TASK_EXISTS')
  // v1 的 Topic facts 只进入独立审计表，不恢复旧活动路由或把历史当命令。
  installHistory(db)
  for(const name of names(snapshot.version))for(const row of tables[name]){
    const table=name==='topic_facts'?historicalTable:sqlTable(name),cold=archiveTable(table)
    const prior=db.prepare(`SELECT body FROM ${table} WHERE id=?${cold?' UNION ALL SELECT body FROM '+cold+' WHERE id=?':''}`).get(...cold?[row.id,row.id]:[row.id])
    if(prior&&JSON.stringify(normalize(JSON.parse(prior.body)))!==JSON.stringify(normalize(row.body)))fail('TASK_ARCHIVE_ROW_CONFLICT')
  }
  for(const name of names(snapshot.version))for(const row of [...tables[name]].sort((a,b)=>(a.sequence??0)-(b.sequence??0))){
    const body=structuredClone(row.body),table=name==='topic_facts'?historicalTable:sqlTable(name)
    if(name==='tasks'){body.control='paused';body.drained=true;body.recovering=false;body.archiveRestore={sourceDigest:snapshot.digest,completionEventIds:tables.task_events.filter(row=>row.body.kind==='task.completed').map(row=>row.id),originalControl:task.control,reviewRequired:true,restoredAt:new Date().toISOString()}}
    if(['notifications','topic_facts','historical_topic_facts','sources','dependencies','completion_evaluations'].includes(name))body.archiveRestoreHold=true
    if(name==='dependencies'){body.state='pending';delete body.evaluationId}
    if(name==='receipts')db.prepare('INSERT OR IGNORE INTO dynamic_receipts(id,digest,body) VALUES (?,?,?)').run(row.id,row.digest,JSON.stringify(body))
    else db.prepare(`INSERT OR IGNORE INTO ${table}(id,body) VALUES (?,?)`).run(row.id,JSON.stringify(body))
  }
  return {taskId,paused:true,reviewRequired:true,sourceDigest:snapshot.digest,dependenciesHeld:tables.dependencies?.length??0}
}
