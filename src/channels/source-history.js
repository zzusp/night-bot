import {conversationSource} from './message-safety.js'

export const sourceHistorySchema=`CREATE INDEX IF NOT EXISTS dynamic_source_history_conversation ON dynamic_sources(json_extract(body,'$.groupId'));
CREATE INDEX IF NOT EXISTS dynamic_source_history_version ON dynamic_sources(json_extract(body,'$.groupId'),json_extract(body,'$.messageId'),json_extract(body,'$.version'));`

const fail=()=>{throw Object.assign(new Error('ROUTER_SOURCE_HISTORY_INVALID'),{code:'ROUTER_SOURCE_HISTORY_INVALID'})}
const clip=(value,limit)=>typeof value==='string'?value.slice(0,limit):undefined
/** Read-only keyset page over the existing source ledger. No new history store. */
export function querySourceHistory(db,{conversationId,keyword,before,after,cursor,anchorSourceId,limit=10}) {
  if(typeof conversationId!=='string'||!conversationId||!Number.isSafeInteger(limit)||limit<1||limit>20)fail()
  if(keyword!==undefined&&(typeof keyword!=='string'||keyword.length>200))fail()
  if(cursor!==undefined&&(!Number.isSafeInteger(cursor)||cursor<1))fail()
  const clauses=["json_extract(s.body,'$.groupId')=?", "coalesce(json_extract(s.body,'$.channel'),'')!='internal'",
    "NOT EXISTS (SELECT 1 FROM dynamic_sources newer WHERE json_extract(newer.body,'$.groupId')=json_extract(s.body,'$.groupId') AND json_extract(newer.body,'$.messageId')=json_extract(s.body,'$.messageId') AND json_extract(newer.body,'$.version')>json_extract(s.body,'$.version'))"], args=[conversationId]
  // Never revive a previous version when the latest is revoked/held.
  for(const flag of ['authorizationRevoked','triageHold','archiveRestoreHold'])clauses.push(`coalesce(json_extract(s.body,'$.${flag}'),0)!=1`)
  if(cursor!==undefined){clauses.push('s.rowid<?');args.push(cursor)}
  if(anchorSourceId!==undefined){
    const anchor=db.prepare("SELECT rowid FROM dynamic_sources WHERE id=? AND json_extract(body,'$.groupId')=?").get(anchorSourceId,conversationId)
    if(!anchor)fail()
    clauses.push('s.rowid<?');args.push(anchor.rowid)
  }
  for(const [key,op,value] of [['before','<=',before],['after','>=',after]])if(value!==undefined){
    if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail()
    clauses.push(`julianday(json_extract(s.body,'$.timestamp'))${op}julianday(?)`);args.push(new Date(value).toISOString())
  }
  if(before!==undefined&&after!==undefined&&Date.parse(after)>Date.parse(before))fail()
  if(keyword){clauses.push("instr(lower(coalesce(json_extract(s.body,'$.text'),'')),lower(?))>0");args.push(keyword)}
  const rows=db.prepare(`SELECT s.rowid,s.body FROM dynamic_sources s INDEXED BY dynamic_source_history_conversation WHERE ${clauses.join(' AND ')} ORDER BY s.rowid DESC LIMIT ?`).all(...args,limit+1)
  const selected=rows.slice(0,limit)
  return {sources:selected.map(row=>sourceHistoryPreview(withCurrentQuote(db,JSON.parse(row.body)))),hasMore:rows.length>limit,nextCursor:rows.length>limit?selected.at(-1).rowid:null,order:'received-desc',backgroundOnly:true}
}

export function sourceHistoryPreview(source){
  const value=conversationSource(source),text=clip(value.text,1200)??''
  return {sourceId:value.sourceId,messageId:value.messageId,messageVersion:value.version,conversationId:value.conversationId,
    actorId:value.actorId,senderName:clip(value.senderName,200),timestamp:value.timestamp,text,truncated:text!==value.text,
    quote:value.quote&&(!value.quote.conversationId||value.quote.conversationId===value.conversationId)?{...value.quote,text:clip(value.quote.text,400)}:undefined,
    hasAttachments:Array.isArray(value.resources)&&value.resources.length>0}
}

/** Frozen per-triage background, not new messages or model write authority. */
export async function recentSourceBackground(query,conversationId,messages){
  if(!query||!messages.length)return {backgroundOnly:true,sources:[]}
  const result=await query('router.source-history',{conversationId,anchorSourceId:messages[0].sourceId,limit:5})
  const current=new Set(messages.map(source=>source.messageId))
  return {...result,sources:result.sources.filter(source=>!current.has(source.messageId)).map(source=>({...source,text:source.text.slice(0,600),truncated:source.truncated||source.text.length>600,quote:source.quote?{...source.quote,text:source.quote.text?.slice(0,200)}:undefined}))}
}

export function queryCurrentSource(db,{conversationId,sourceId}){
  const row=db.prepare("SELECT body FROM dynamic_sources WHERE id=? AND json_extract(body,'$.groupId')=?").get(sourceId,conversationId)
  if(!row)return {status:'unavailable'}
  const source=JSON.parse(row.body)
  const latest=JSON.parse(db.prepare("SELECT body FROM dynamic_sources WHERE json_extract(body,'$.groupId')=? AND json_extract(body,'$.messageId')=? ORDER BY json_extract(body,'$.version') DESC LIMIT 1").get(conversationId,source.messageId).body)
  if([source,latest].some(row=>row.authorizationRevoked||row.triageHold||row.archiveRestoreHold||row.channel==='internal'))return {status:'unavailable'}
  if(source.version!==latest.version)return {sourceId:source.sourceId,messageVersion:source.version,status:'superseded',latestSourceId:latest.sourceId,latestMessageVersion:latest.version}
  return conversationSource(withCurrentQuote(db,source))
}

// An embedded quote is evidence of what was quoted, not current message authority.
function withCurrentQuote(db,source){
 const value=conversationSource(source),q=value.quote
 if(!q)return value
 if(q.conversationId&&q.conversationId!==value.conversationId)return {...value,quote:undefined}
 const row=q.messageId?db.prepare("SELECT body FROM dynamic_sources WHERE json_extract(body,'$.groupId')=? AND json_extract(body,'$.messageId')=? ORDER BY json_extract(body,'$.version') DESC LIMIT 1").get(value.conversationId,q.messageId):null
 const current=row?JSON.parse(row.body):null
 const quote={messageId:q.messageId,actorId:q.actorId,snapshot:true,status:'unverified'}
 if(current){
  if(current.authorizationRevoked||current.triageHold||current.archiveRestoreHold||current.channel==='internal')quote.status='unavailable'
  else {quote.currentSourceId=current.sourceId;quote.currentMessageVersion=current.version;quote.status=current.text===q.text?'current':'superseded';if(quote.status==='current')quote.text=q.text}
 }else quote.text=q.text
 return {...value,quote}
}
