import {createHash} from 'node:crypto'
import {localStamp,shiftDay,validDay} from '../work-log/calendar.js'

const fail=()=>{throw Object.assign(Error('ROUTER_LOOKUP_ARGUMENT_INVALID'),{code:'ROUTER_LOOKUP_ARGUMENT_INVALID'})}
const DAY_MS=86400000
const LIMIT=24

export function checkArrangementRange(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['day','through','timezone'].includes(key)))fail()
 const {day,through,timezone}=value
 if(!['today','yesterday'].includes(day)&&!validDay(day))fail()
 if(through!==undefined&&(!validDay(day)||!validDay(through)||through<day||Date.parse(through)-Date.parse(day)>=31*DAY_MS))fail()
 if(timezone!==undefined){
  if(typeof timezone!=='string'||!timezone||timezone.length>128)fail()
  try{new Intl.DateTimeFormat('en',{timeZone:timezone})}catch{fail()}
 }
 return {day,...through===undefined?{}:{through},...timezone===undefined?{}:{timezone}}
}

export function arrangementDays(range,sourceTime,defaultTimezone){
 const parsed=checkArrangementRange(range),timezone=parsed.timezone??defaultTimezone
 const sourceDay=localStamp(sourceTime,timezone)?.day
 if(['today','yesterday'].includes(parsed.day)&&!sourceDay)return null
 const day=parsed.day==='today'?sourceDay:parsed.day==='yesterday'?shiftDay(sourceDay,-1):parsed.day
 return {day,through:parsed.through??day,timezone}
}

/** Arrangements are recorded task creations and explicit revisions of arrangements, not starts, completions or native timer deliveries. */
export function queryArrangementHistory(db,{conversationId,day,through,timezone}){
 checkArrangementRange({day,through,timezone})
 if(!validDay(day)||!validDay(through)||typeof timezone!=='string')fail()
 // A padded UTC window covers every applicable zone. Compare local calendar dates
 // below, including days shorter or longer than 24 hours across DST transitions.
 const from=shiftDay(day,-1)+'T00:00:00.000Z',to=shiftDay(through,2)+'T00:00:00.000Z'
 const rows=db.prepare(`
   WITH tasks AS (
     SELECT id,body FROM dynamic_tasks WHERE json_extract(body,'$.groupId')=?
     UNION ALL SELECT id,body FROM dynamic_archived_tasks WHERE json_extract(body,'$.groupId')=?
   ), events AS (
     SELECT id,body FROM dynamic_task_events WHERE json_extract(body,'$.kind')='task.arranged'
     UNION ALL SELECT id,body FROM dynamic_archived_task_events WHERE json_extract(body,'$.kind')='task.arranged'
   ), arrangements AS (
     SELECT t.id AS id,t.id AS taskId,t.body AS task,'created' AS kind,json_extract(t.body,'$.createdAt') AS at,
       1 AS expectedRevision,json_extract(t.body,'$.appliedOperations[0]') AS operationId
       FROM tasks t
     UNION ALL SELECT e.id,t.id,t.body,'arranged',json_extract(e.body,'$.recordedAt'),
       json_extract(e.body,'$.requirementRevision'),json_extract(e.body,'$.operationId')
       FROM events e JOIN tasks t ON t.id=json_extract(e.body,'$.taskId')
   )
   SELECT id,taskId,kind,at,expectedRevision,operationId,
     json_extract(task,'$.requirementRevision') AS currentRevision,
     json_extract(task,'$.title') AS title,json_extract(task,'$.objective') AS objective,
     json_extract(task,'$.archiveRestore.reviewRequired') OR json_extract(task,'$.archiveRestoreHold') AS held
     FROM arrangements WHERE julianday(at)>=julianday(?) AND julianday(at)<julianday(?) ORDER BY at,id
 `).iterate(conversationId,conversationId,from,to)
 const action=db.prepare('SELECT body FROM dynamic_router_actions WHERE id=?')
 const records=[]
 for(const row of rows){
  const local=localStamp(row.at,timezone)
  if(!local||local.day<day||local.day>through)continue
  if(records.length===LIMIT)return {records,complete:false}
  let identity
  if(!row.held){
   if(row.currentRevision===row.expectedRevision)identity=row
   else if(typeof row.operationId==='string'&&row.operationId){
    const key='router-action:'+createHash('sha256').update(JSON.stringify([conversationId,row.operationId])).digest('hex')
    const receipt=action.get(key)
    if(receipt){
     const {result,conversationId:scope}=JSON.parse(receipt.body)
     const snapshot=row.kind==='created'?result?.tasks?.find(task=>task.taskId===row.taskId):result?.task
     if(scope===conversationId&&snapshot?.groupId===conversationId&&snapshot.taskId===row.taskId
       &&snapshot.requirementRevision===row.expectedRevision&&(row.kind!=='created'||snapshot.createdAt===row.at))identity=snapshot
    }
   }
  }
  const title=typeof identity?.title==='string'?identity.title:'',objective=typeof identity?.objective==='string'?identity.objective:''
  records.push({kind:row.kind,localAt:local.day+' '+local.time,title:title.slice(0,160),objective:objective.slice(0,240),
    clipped:title.length>160||objective.length>240,identityMissing:!title&&!objective})
 }
 return {records,complete:true}
}
