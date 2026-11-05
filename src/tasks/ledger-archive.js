import {createHash} from 'node:crypto'
import {archiveTable,receiptOwnerSql} from '../../packages/dingtalk-core/task-archive.js'
const fail=code=>{throw Object.assign(Error(code),{code})}
export const ledgerDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const own=['tasks','executions','operations','wakes','notifications','task_events','topic_facts']
/** Caller holds the ledger transaction. Files never become a second runtime authority. */
export function exportTaskLedger(db,taskId){
  if(typeof taskId!=='string'||!taskId)fail('TASK_ARCHIVE_ID_INVALID')
  const tables={}
  for(const name of own){const table='dynamic_'+name,cold=archiveTable(table),condition=name==='tasks'?'id=?':"json_extract(body,'$.taskId')=?";tables[name]=[table,...cold?[cold]:[]].flatMap(t=>db.prepare(`SELECT id,body,${t===table?'rowid':'sequence'} AS sequence FROM ${t} WHERE ${condition} ORDER BY sequence`).all(taskId)).map(row=>({id:row.id,sequence:Number(row.sequence),body:JSON.parse(row.body)})).sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id))}
  const task=tables.tasks[0]?.body;if(!task||tables.tasks.length!==1)fail('TASK_ARCHIVE_TASK_MISSING')
  tables.sources=(task.sourceRefs??[]).map(id=>db.prepare('SELECT id,body FROM dynamic_sources WHERE id=?').get(id)).map(row=>{if(!row)fail('TASK_ARCHIVE_SOURCE_MISSING');return {id:row.id,body:JSON.parse(row.body)}})
  tables.receipts=db.prepare(`SELECT id,digest,body,sequence FROM (SELECT r.id,r.rowid AS sequence,r.digest,coalesce(a.body,r.body) body FROM dynamic_receipts r LEFT JOIN dynamic_archived_receipts a ON a.id=r.id) WHERE ${receiptOwnerSql}=? ORDER BY sequence`).all(taskId).map(row=>({...row,body:JSON.parse(row.body)}))
  const body={version:1,taskId,tables};return {...body,digest:ledgerDigest(body)}
}
export function importTaskLedger(db,snapshot){
  if(snapshot?.version!==1||snapshot.digest!==ledgerDigest({version:snapshot.version,taskId:snapshot.taskId,tables:snapshot.tables}))fail('TASK_ARCHIVE_LEDGER_INVALID')
  const {taskId,tables}=snapshot;if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(taskId)||Object.keys(tables).sort().join()!==[...own,'sources','receipts'].sort().join()||tables.tasks.length!==1||tables.executions.length)fail('TASK_ARCHIVE_LEDGER_INVALID')
  const task=tables.tasks[0].body;if(task.taskId!==taskId||task.id!==taskId||!task.drained||task.recovering)fail('TASK_ARCHIVE_NOT_DRAINED')
  if(db.prepare('SELECT 1 FROM dynamic_tasks WHERE id=? UNION ALL SELECT 1 FROM dynamic_archived_tasks WHERE id=?').get(taskId,taskId))fail('TASK_ARCHIVE_TASK_EXISTS')
  for(const name of [...own,'sources','receipts'])for(const row of tables[name]){
    if(typeof row.id!=='string'||!row.body||name==='tasks'&&row.id!==taskId||name!=='tasks'&&name!=='sources'&&name!=='receipts'&&row.body.taskId!==taskId||name==='sources'&&!(task.sourceRefs??[]).includes(row.id))fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
    if(name==='receipts'&&(!/^[a-f0-9]{64}$/.test(row.digest)||![row.body.taskDecision?.taskId,row.body.result?.task?.taskId,row.body.result?.binding?.taskId,row.body.result?.notification?.taskId,row.body.result?.operation?.taskId].includes(taskId)))fail('TASK_ARCHIVE_ROW_SCOPE_INVALID')
    const table='dynamic_'+name,cold=archiveTable(table),prior=db.prepare(`SELECT body FROM ${table} WHERE id=?${cold?' UNION ALL SELECT body FROM '+cold+' WHERE id=?':''}`).get(...cold?[row.id,row.id]:[row.id]);if(prior&&JSON.stringify(name==='sources'?Object.fromEntries(Object.entries(JSON.parse(prior.body)).filter(([key])=>key!=='archiveRestoreHold')):JSON.parse(prior.body))!==JSON.stringify(name==='sources'?Object.fromEntries(Object.entries(row.body).filter(([key])=>key!=='archiveRestoreHold')):row.body))fail('TASK_ARCHIVE_ROW_CONFLICT')
  }
  for(const name of [...own,'sources','receipts'])for(const row of [...tables[name]].sort((a,b)=>(a.sequence??0)-(b.sequence??0))){
    const body=structuredClone(row.body)
    if(name==='tasks'){body.control='paused';body.drained=true;body.recovering=false;body.archiveRestore={sourceDigest:snapshot.digest,completionEventIds:tables.task_events.filter(row=>row.body.kind==='task.completed').map(row=>row.id),originalControl:task.control,reviewRequired:true,restoredAt:new Date().toISOString()}}
    if(name==='notifications'||name==='topic_facts'||name==='sources')body.archiveRestoreHold=true
    if(name==='receipts')db.prepare('INSERT OR IGNORE INTO dynamic_receipts(id,digest,body) VALUES (?,?,?)').run(row.id,row.digest,JSON.stringify(body))
    else db.prepare(`INSERT OR IGNORE INTO dynamic_${name}(id,body) VALUES (?,?)`).run(row.id,JSON.stringify(body))
  }
  return {taskId,paused:true,reviewRequired:true,sourceDigest:snapshot.digest}
}
