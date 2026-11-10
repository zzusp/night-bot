import {inDay,localStamp,shiftDay} from './calendar.js'
import {workLogText} from './redaction.js'
const textBlocks=content=>typeof content==='string'?content:Array.isArray(content)?content.filter(block=>block.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n'):''
const summary=value=>typeof value==='string'?value:typeof value?.summary==='string'?value.summary:''
/** Read-only factual extraction. No model is asked to invent plans or to treat
 * transcript text as instructions. Historical decisions retain their timestamps;
 * current state is explicitly separated from historical catch-up evidence. */
export async function collectWorkLogEvidence({store,persistence,schedule,day,timezone,cutoff=Date.now()}){
 const result={messages:[],progress:[],plans:[],blockers:[],notes:[]},today=localStamp(cutoff,timezone).day
 const sources=await store.query({kind:'source.list'}),allTasks=await store.query({kind:'task.list',archived:'all'}),held=new Set(allTasks.filter(task=>task.archiveRestore?.reviewRequired).map(task=>task.taskId)),tasks=allTasks.filter(task=>!held.has(task.taskId))
 for(const source of sources)if(source.channel!=='internal'&&inDay(source.receivedAt??source.timestamp,day,timezone,cutoff))result.messages.push({at:source.receivedAt??source.timestamp,id:source.sourceId,text:source.text})
 for(const task of tasks){
  if(inDay(task.createdAt,day,timezone,cutoff))result.progress.push({at:task.createdAt,id:task.taskId,title:task.title,text:'已创建事项',kind:'created'})
  let before,page
  do{
   page=await store.query({kind:'task.decisions',taskId:task.taskId,...before?{before}:{},limit:100})
   for(const receipt of page.decisions)if(inDay(receipt.recordedAt,day,timezone,cutoff)){
    const decision=receipt.decision??{}
    result.progress.push({at:receipt.recordedAt,id:receipt.id,title:task.title,text:summary(decision.summary??decision.result),kind:decision.action??'recorded'})
    if(['wait','blocked','failed'].includes(decision.action)||decision.question||decision.limitations?.length)result.blockers.push({at:receipt.recordedAt,id:receipt.id,title:task.title,text:[summary(decision.question),...(Array.isArray(decision.limitations)?decision.limitations.filter(item=>typeof item==='string'):[])].filter(Boolean).join('；')||summary(decision.summary),historical:day!==today})
   }
   before=page.nextBefore
  }while(before&&page.decisions.some(receipt=>localStamp(receipt.recordedAt,timezone)?.day>=day))
  // A current open question is not asserted as a historical-day state.
  if(day===today)for(const request of task.humanRequests??[])if(request.status==='waiting-reply')result.blockers.push({at:request.createdAt,id:request.id,title:task.title,text:summary(request.question??request.text??request.prompt)||'等待人工回复'})
 }
 // Typed task events are immutable and survive archival; arranging or changing
 // a task never implies completion.
 let after=0,page
 do{page=await store.query({kind:'task.events',after,limit:100});for(const event of page.events)if(!held.has(event.taskId)&&inDay(event.recordedAt,day,timezone,cutoff))result.progress.push({at:event.recordedAt,id:event.id,title:tasks.find(task=>task.taskId===event.taskId)?.title??'事项',text:summary(event.result),kind:event.kind==='task.completed'?'completed':event.kind==='task.arranged'?'arranged':'changed'});after=page.nextCursor}while(page.hasMore)
 // Ordinary user sessions are not represented by channel source rows. Count
 // only official committed user input/assistant text, excluding tools/thinking,
 // task/Router/triage/retrospective sessions and their repeated prompt snapshots.
 if(persistence)for(const item of await persistence.list()){
  const header=item.header
  if(header.runtimeOwner||header.agentPreset==='night-bot-task'||header.origin==='subagent'||(header.delegationDepth??0)>0)continue
  const saved=await persistence.readNative(header.id)
  for(const entry of saved.entries??[]){
   if(!inDay(entry.timestamp,day,timezone,cutoff))continue
   if(entry.type==='message'&&entry.message?.role==='user')result.messages.push({at:entry.timestamp,id:entry.id,text:textBlocks(entry.message.content)})
   else if(entry.type==='custom_message'&&entry.customType==='night.business-input'&&entry.details?.source?.kind==='user')result.messages.push({at:entry.timestamp,id:entry.id,text:textBlocks(entry.content)})
   else if(entry.type==='message'&&entry.message?.role==='assistant')result.progress.push({at:entry.timestamp,id:entry.id,title:textBlocks(entry.message.content)?'对话回复':'会话执行',text:textBlocks(entry.message.content)||'已记录模型执行响应；不据此判定工作完成',kind:textBlocks(entry.message.content)?'reply':'activity'})
  }
 }
 // Work performed today can include a running task before a decision is made.
 // Task sessions contribute only committed assistant activity counts, no tools.
 if(persistence)for(const task of tasks)if(task.sessionId){
  const stat=await persistence.stat(task.sessionId);if(!stat)continue
  const saved=await persistence.readNative(task.sessionId)
  const count=(saved.entries??[]).filter(entry=>entry.type==='message'&&entry.message?.role==='assistant'&&inDay(entry.timestamp,day,timezone,cutoff)).length
  if(count)result.progress.push({at:day,id:task.taskId,title:task.title,text:`已记录 ${count} 次执行模型响应；不据此判定任务完成`,kind:'activity'})
 }
 if(schedule)for(const row of await schedule.catalog()){
  if(inDay(row.lastDelivery?.deliveredAt,day,timezone,cutoff))result.progress.push({at:row.lastDelivery.deliveredAt,id:row.id,title:row.title??'提醒',text:'提醒已登记入会话投递队列；不据此判定外部通知送达',kind:'scheduled'})
  if(day===today&&row.status==='active'&&localStamp(row.scheduledAt,timezone)?.day===shiftDay(day))result.plans.push({at:row.scheduledAt,id:row.id,text:row.title??'已登记排期'})
 }
 if(day!==today)result.notes.push('补记日志仅采用带原始时间的消息和工作记录；未用当前状态推断当日阻塞或次日安排。')
 result.active=result.messages.length>0||result.progress.length>0
 return result
}
const names={scheduled:'提醒触发',arranged:'已调整安排',changed:'事项已更新',created:'新建',completed:'完成',complete:'完成',continue:'继续处理',wait:'等待',blocked:'受阻',failed:'失败',reply:'回复',activity:'执行活动',recorded:'进展'}
export function renderWorkLog({day,timezone,cutoff,evidence,secrets=[]}){
 const clean=value=>workLogText(value,secrets),lines=[`# ${day} 工作日志`,'',`时区：${clean(timezone)}。汇总截至：${new Date(cutoff).toISOString()}。`,'','## 当天工作进展','',`收到 ${evidence.messages.length} 条消息，记录 ${evidence.progress.length} 条工作进展。`,'']
 const write=(rows,format,empty)=>{if(!rows.length)lines.push(empty);else{for(const row of rows.slice(0,500))lines.push('- '+format(row));if(rows.length>500)lines.push(`- 另有 ${rows.length-500} 条记录，未在本日志逐项展开。`)}lines.push('')}
 write(evidence.messages,row=>`收到消息：${clean(row.text)||'（无文本）'}（来源：${clean(row.id)}）`,'当天没有新增消息。')
 write(evidence.progress,row=>`${clean(row.title)||'事项'}：${names[row.kind]??'已记录'}${row.text?'；'+clean(row.text):''}（记录：${clean(row.id)}）`,'当天没有已记录的工作进展。')
 lines.push('## 次日工作安排','');write(evidence.plans,row=>`${localStamp(row.at,timezone).time}：${clean(row.text)}（排期：${clean(row.id)}）`,'暂无可核实的次日排期；未将未完成事项推断为次日承诺。')
 lines.push('## 遇到的问题或阻塞','');write(evidence.blockers,row=>`${clean(row.title)||'事项'}：${clean(row.text)||'已记录待处理问题'}${row.historical?'（当时记录，不代表当前仍受阻）':''}`,'没有已记录的问题或阻塞。')
 if(evidence.notes.length)lines.push('## 记录范围','',...evidence.notes.map(note=>'- '+clean(note)),'')
 lines.push('本日志由已保存的业务记录直接汇总；任务完成与消息送达分别以各自收据为准。','')
 return lines.join('\n')
}
