import {routerTaskSummary} from './router-task-view.js'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const checkedPage=({offset=0,limit=10}={})=>{
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('ROUTER_CONTEXT_PAGE_INVALID')
 return {offset,limit}
}
const terminal=['completed','failed','cancelled']
const columns=['taskId','sessionId','status','control','drained','requirementRevision','controlRevision','contextRevision','arrangementRevision','runSequence','leaseEpoch','updatedAt','archivedAt']
const taskProjection=`json_object(${columns.map(key=>`'${key}',json_extract(t.body,'$.${key}')`).join(',')},'title',substr(json_extract(t.body,'$.title'),1,160),'pendingQuestionCount',(SELECT count(*) FROM json_each(t.body,'$.humanRequests') WHERE json_extract(value,'$.status')='waiting-reply'))`
const refs=values=>{if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!value))fail('ROUTER_CONTEXT_REFERENCE_INVALID');return JSON.stringify([...new Set(values)])}

/** Current SQLite projections never create a second ledger. */
export function queryTaskIndex(db,{conversationId,sourceIds=[],taskIds=[],...page},{dependenciesReady}={}){
 const {offset,limit}=checkedPage(page),sources=refs(sourceIds),tasks=refs(taskIds)
 const where=`json_extract(t.body,'$.groupId')=? AND ((json_extract(t.body,'$.archivedAt') IS NULL AND json_extract(t.body,'$.status') NOT IN (${terminal.map(()=>'?').join(',')})) OR t.id IN (SELECT value FROM json_each(?)) OR EXISTS (SELECT 1 FROM dynamic_source_links l WHERE json_extract(l.body,'$.conversationId')=? AND json_extract(l.body,'$.taskId')=t.id AND json_extract(l.body,'$.sourceId') IN (SELECT value FROM json_each(?))))`
 const args=[conversationId,...terminal,tasks,conversationId,sources]
 const table='(SELECT id,body FROM dynamic_tasks UNION ALL SELECT id,body FROM dynamic_archived_tasks)'
 const total=db.prepare(`SELECT count(*) AS n FROM ${table} t WHERE ${where}`).get(...args).n
 const rows=db.prepare(`SELECT ${taskProjection} AS projection FROM ${table} t WHERE ${where} ORDER BY json_extract(t.body,'$.updatedAt') DESC,t.id LIMIT ? OFFSET ?`).all(...args,limit,offset)
 return {asOf:new Date().toISOString(),tasks:rows.map(row=>{const task=JSON.parse(row.projection);return {...task,...dependenciesReady?{dependenciesReady:dependenciesReady(task)}:{},projection:'index',detailAvailable:true}}),total,hasMore:offset+rows.length<total,nextOffset:offset+rows.length}
}

export function queryReplyHistory(db,{conversationId,sourceId,taskId,notificationId,cursor,limit=10}){
 if([sourceId,taskId,notificationId].filter(value=>value!==undefined).length!==1)fail('ROUTER_REPLY_SELECTOR_REQUIRED')
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||cursor!==undefined&&(!Number.isSafeInteger(cursor)||cursor<1))fail('ROUTER_CONTEXT_PAGE_INVALID')
 const clauses=["json_extract(n.body,'$.payload.conversationId')=?","json_extract(n.body,'$.kind') IN ('triage-reply','router-reply','platform-reply','fixed-topic-reply','question','status')"],args=[conversationId]
 if(sourceId!==undefined){clauses.push("json_extract(n.body,'$.payload.sourceId')=?");args.push(sourceId)}
 if(taskId!==undefined){clauses.push("(json_extract(n.body,'$.taskId')=? OR EXISTS (SELECT 1 FROM json_each(n.body,'$.payload.taskIds') WHERE value=?))");args.push(taskId,taskId)}
 if(notificationId!==undefined){clauses.push('n.id=?');args.push(notificationId)}
 if(cursor!==undefined){clauses.push('n.rowid<?');args.push(cursor)}
 const rows=db.prepare(`SELECT n.rowid AS sequence,n.body FROM dynamic_notifications n WHERE ${clauses.join(' AND ')} ORDER BY n.rowid DESC LIMIT ?`).all(...args,limit+1)
 const selected=rows.slice(0,limit),replies=selected.map(row=>{
  const n=JSON.parse(row.body),p=n.payload??{},text=p.text??''
  const fields={notificationId:n.notificationId??n.id,kind:n.kind,replyPurpose:p.replyPurpose,sourceId:p.sourceId,messageVersion:p.sourceVersion??p.sourceRef?.messageVersion,taskId:n.taskId??p.taskIds?.[0],state:n.state,createdAt:n.createdAt,updatedAt:n.updatedAt,deliveredAt:n.deliveredAt}
  return {...Object.fromEntries(Object.entries(fields).filter(([,value])=>value!==undefined)),...notificationId?{text}:{textPreview:text.slice(0,400),truncated:text.length>400}}
 })
 return {asOf:new Date().toISOString(),replies,hasMore:rows.length>limit,nextCursor:rows.length>limit?selected.at(-1).sequence:null}
}

/** Facts are separate from immutable admitted business packets. */
export async function conversationContext(query,conversationId,{sources=[],taskIds=[],router=false}={}){
 const sourceIds=new Set(sources.map(source=>source.sourceId)),tasks=new Set(taskIds)
 for(const source of sources)if(source.quote?.messageId){const current=await query('router.source-current',{conversationId,sourceId:source.sourceId});if(current?.quote?.currentSourceId)sourceIds.add(current.quote.currentSourceId)}
 for(const sourceId of sourceIds)for(const link of await query('router.source-links',{sourceId}))if(link.conversationId===conversationId)tasks.add(link.taskId)
 const replies=[]
 for(const sourceId of sourceIds)replies.push({sourceId,...await query('router.reply-history',{conversationId,sourceId})})
 for(const taskId of tasks)replies.push({taskId,...await query('router.reply-history',{conversationId,taskId})})
 return {asOf:new Date().toISOString(),historicalReferenceOnly:true,...router?{taskIndex:await query('router.task-index',{conversationId,sourceIds:[...sourceIds],taskIds:[...tasks]})}:{},replyIndex:replies}
}

export const currentContextPolicy='Host 当前账本投影（不是新交办或授权）：prepared仅表示已冻结，unknown需查询原通知，delivered才表示已确认送达。任务向需求提出者发出的提问和任务状态回复也纳入回复索引；同一问题已有通知时查原通知状态，不换措辞重复提问。同一承接不重复发送；实际进度追问应回答新事实或具体阻断。状态以本轮索引或只读查询为准，不以旧摘要推断；分页剩余内容按需查询，通知预览不是完整正文。'
export const progressTaskView=task=>({task:routerTaskSummary(task),asOf:new Date().toISOString(),...Object.fromEntries(['requirements','request','completion','humanRequests'].filter(key=>task[key]!==undefined).map(key=>[key,task[key]]))})
