import {failure} from '../runtime/files.js'
const formatters=new Map()
export function localStamp(value,timezone){
 const time=typeof value==='number'?value:Date.parse(value)
 if(!Number.isFinite(time))return null
 let formatter=formatters.get(timezone)
 if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatters.set(timezone,formatter)}
 const p=Object.fromEntries(formatter.formatToParts(time).map(row=>[row.type,row.value]))
 return {day:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`}
}
export function validDay(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}
export function shiftDay(day,amount=1){if(!validDay(day))throw failure('WORK_LOG_DAY_INVALID');const value=new Date(day+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+amount);return value.toISOString().slice(0,10)}
export function lastDueDay(now,{timezone,time}){const stamp=localStamp(now,timezone);if(!stamp)throw failure('WORK_LOG_CLOCK_INVALID');return stamp.time>=time?stamp.day:shiftDay(stamp.day,-1)}
export function inDay(value,day,timezone,cutoff){const at=typeof value==='number'?value:Date.parse(value);return Number.isFinite(at)&&at<=cutoff&&localStamp(at,timezone)?.day===day}
