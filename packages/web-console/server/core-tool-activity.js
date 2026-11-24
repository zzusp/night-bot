import {isDeepStrictEqual} from 'node:util'
import {taskPublicCommunicationInstructions} from '../../../src/channels/message-safety.js'
// Exact presentation contracts for non-resident Host tools. Never summarize
// an extension's arbitrary fields or borrow a resource-access grant.
const scheduleNames = ['schedule_create','schedule_list','schedule_update','schedule_delete',
  'platform_schedule_submit','platform_schedule_list','platform_schedule_update','platform_schedule_delete']
const scheduleTools = new Set(scheduleNames)
const explicit = new Set([...scheduleNames,'communication_guidance_read','memory_index','model_content_read',
  'platform_task_query','platform_config_query','code_search','diagnosis_evidence','run_code'])
export const hasCoreToolActivity = name => explicit.has(name)
export const coreToolPolicyNames = Object.freeze([...explicit])
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const string = (value,max=240) => typeof value === 'string' && value.trim() && value.length <= max ? value : undefined
const uint = value => Number.isSafeInteger(value) && value>=0 ? value : undefined
const oneOf = (value,allowed) => allowed.includes(value) ? value : undefined
const bool = value => typeof value==='boolean' ? value : undefined
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined
const time = value => typeof value==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) ? value : undefined
const zone = value => typeof value==='string' && /^[A-Za-z0-9_+\-/]{1,80}$/.test(value) ? value : undefined
const cron = value => typeof value==='string' && /^[0-9*/,?LWA-Z #\-]{1,180}$/i.test(value) ? value : undefined
const summarize = (toolName,value,detailState) => ({toolName,text:value ? JSON.stringify(value,null,2) : detailState==='empty'?'没有其他详情。':'详情未公开。',redacted:detailState!=='empty',...detailState?{detailState}:{}})
const shape = row => {
  const cadence = row.daily ?? row.weekly ?? row.cron
  const rule = typeof row.cron==='string'?row.cron:row.expression ?? cadence?.expression
  return {
    title:string(row.title,120), state:oneOf(row.state??row.status,['scheduled','overdue','triggered','cancelled','expired']),
    at:instant(row.scheduledAt??row.at), time:time(row.time??cadence?.time),
    timeZone:zone(row.timeZone??row.timezone??cadence?.time_zone??cadence?.timeZone),
    afterSeconds:uint(row.afterSeconds??row.after_seconds), everySeconds:uint(row.everySeconds??row.every_seconds),
    rule:cron(rule), weekdays:Array.isArray(row.weekdays??cadence?.weekdays) ? (row.weekdays??cadence?.weekdays).slice(0,7).filter(v=>Number.isSafeInteger(v)&&v>=0&&v<=7) : undefined,
    kind:oneOf(row.kind??(['daily','weekly','cron'].find(k=>object(row[k]))),['after','at','every','daily','weekly','cron']),
    recurring: bool(row.recurring) ?? ((row.everySeconds??row.every_seconds) || cadence || ['every','daily','weekly','cron'].includes(row.kind) ? true : undefined),
    stopTaskCount:Array.isArray(row.stopWhen?.taskIds) ? Math.min(row.stopWhen.taskIds.length,30) : undefined,
  }
}
const present = value => Object.values(value).some(v=>v!==undefined)
const toolFlags = value => ({code:oneOf(value.code,['invalid_prompt','invalid_selector','invalid_rule','invalid_time_zone','not_future','time_out_of_range','frequency_too_high','subagent_session','internal_error','schedule_not_found','schedule_ended','schedule_conflict']),
  deleted:bool(value.deleted),updated:bool(value.updated)})
export function coreToolInput(name,args) {
  if (!explicit.has(name)||!object(args)) return
  if (name==='communication_guidance_read') return summarize(name,{scope:'communication-guidance'})
  if (scheduleTools.has(name)) {
    const row = object(args.change) ? args.change : args
    const value = {...shape(row), prompt:string(row.prompt,8000),
      changesPrompt:typeof row.prompt==='string'?true:undefined,
      targetSelected:typeof (args.id??args.scheduleId)==='string'?true:undefined}
    return present(value) ? summarize(name,value) : summarize(name,undefined,'empty')
  }
  if (name==='memory_index') return summarize(name,{scope:typeof args.topic==='string'?'topic':'index'})
  if (name==='model_content_read') {
    const value={offset:uint(args.offset),limit:uint(args.limit)}
    return present(value) ? summarize(name,value):summarize(name,undefined,'empty')
  }
  if (name==='diagnosis_evidence') {
    const mode=oneOf(args.kind??args.action,['discover','message','trace','task','schedule','journal','logs','code_search','code_read','evidence'])
    if (mode) return summarize(name,{mode})
  }
}
export function coreToolOutput(name,raw) {
  if (!scheduleTools.has(name)) return
  if (name.endsWith('_list') && Array.isArray(raw)) {
    const schedules=raw.slice(0,100).filter(object).map(shape).filter(present)
    return summarize(name,{scheduleCount:raw.length,schedules,...raw.length>100?{truncated:true}:{}})
  }
  if (object(raw)) {
    const value={...shape(raw),...toolFlags(raw)}
    return present(value)?summarize(name,value):undefined
  }
}

// Only the official repository-authored document is eligible. Workspace
// instructions, other historical versions and extension messages sharing the
// tool name cannot substitute arbitrary output for the approved document.
const guidanceName = 'communication_guidance_read'
const guidance = Object.freeze({id:'communication/v1',content:taskPublicCommunicationInstructions})
const guidanceWire = [{type:'text',text:JSON.stringify(guidance)}]
export function committedCommunicationGuidance(call,message,entry) {
  const original=entry?.type==='message' && entry.message
  const receipt=original?.details?.nativeResult
  if (call?.name!==guidanceName || message?.toolName!==guidanceName ||
    message.role!=='toolResult' || message.isError!==false ||
    original?.toolName!==guidanceName || original.role!=='toolResult' ||
    original.toolCallId!==message.toolCallId || original.isError!==false ||
    receipt?.isError!==false || !isDeepStrictEqual(receipt.value,guidance) ||
    !isDeepStrictEqual(original.content,guidanceWire) ||
    !isDeepStrictEqual(message.content,guidanceWire) ||
    !isDeepStrictEqual(receipt.content,guidanceWire)) return
  return {toolName:guidanceName,text:guidance.content,redacted:false,resourceContent:true}
}
