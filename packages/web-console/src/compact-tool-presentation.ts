import {objectValue, parsePublicObject, residentFields, type ResidentField} from './resident-tool-content.ts';

type Data=Record<string,unknown>;
export type CompactToolView = {
  fields?: ResidentField[];
  items?: {title:string; state?:string; fields?:ResidentField[]}[];
  terms?: string[];
  notice?: string;
};
const usefulText=(value:unknown):value is string=>typeof value==='string' && !!value.trim();
const wholeSeconds=(value:unknown):value is number=>typeof value==='number' && Number.isSafeInteger(value) && value>=0;
const remove=(fields:Data,keys:string[])=>Object.fromEntries(Object.entries(fields).filter(([key])=>!keys.includes(key)));
const scheduleNames = ['schedule_create','schedule_update','schedule_list','schedule_delete',
  'platform_schedule_submit','platform_schedule_list','platform_schedule_update','platform_schedule_delete'];
const jobStatus:Record<string,string>={running:'执行中',stopping:'停止中',completed:'已完成',killed:'已取消',failed:'失败'};

function backgroundJobs(name:string,text:string):CompactToolView|null {
  if(name==='job_list'){
    if(text==='(no background jobs)')return {notice:'没有后台作业'};
    const lines=text.split('\n');
    if(lines.length>100)return null;
    const items:NonNullable<CompactToolView['items']>=[];
    for(const line of lines){
      const match=/^(\S+) \[([^\]\n]+)\] (running|stopping|completed|killed|failed) — (.*)$/.exec(line);
      if(!match)return null;
      const [,id,kind,state,description]=match;
      items.push({title:description || id,state:jobStatus[state],fields:[
        ...description?[{label:'作业编号',value:id}]:[],{label:'作业类型',value:kind},
      ]});
    }
    return items.length?{items}:null;
  }
  const requested=/^requested cancellation of job (\S+)$/.exec(text);
  if(requested)return {notice:'已请求取消',fields:[{label:'作业编号',value:requested[1]}]};
  const finished=/^job (\S+) had already finished \[status: (completed|killed|failed)(?:, ([^\n]+))?\]$/.exec(text);
  if(!finished)return null;
  return {notice:'作业此前已结束',fields:[
    {label:'作业编号',value:finished[1]}, {label:'作业状态',value:jobStatus[finished[2]]},...finished[3]?[{label:'详情',value:finished[3]}]:[],
  ]};
}

function schedule(data:Data):CompactToolView|null {
  if (data.weekdays !== undefined && (!Array.isArray(data.weekdays) || data.weekdays.some(n => !Number.isInteger(n) || n < 1 || n > 7))) return null;
  if ((data.after_seconds!==undefined && !wholeSeconds(data.after_seconds))
    || (data.every_seconds!==undefined && !wholeSeconds(data.every_seconds))
    || (data.at!==undefined && !usefulText(data.at)))return null;
  const cadence:ResidentField[]=[];
  if(wholeSeconds(data.after_seconds))cadence.push({label:'延迟',value:`${data.after_seconds} 秒后`});
  if(wholeSeconds(data.every_seconds))cadence.push({label:'间隔',value:`每 ${data.every_seconds} 秒`});
  if(usefulText(data.at))cadence.push({label:'触发时间',value:data.at});
  for(const [key,label] of [['daily','每日'],['weekly','每周'],['cron','Cron 规则']] as const){
    const slot=data[key];
    if(slot===undefined)continue;
    if(!objectValue(slot) || !usefulText(slot.time_zone))return null;
    if(key==='cron'){
      if(!usefulText(slot.expression) || Object.keys(slot).some(field=>!['expression','time_zone'].includes(field)))return null;
      cadence.push({label,value:`${slot.expression}（${slot.time_zone}）`});
    }else if(key==='daily'){
      if(!usefulText(slot.time) || Object.keys(slot).some(field=>!['time','time_zone'].includes(field)))return null;
      cadence.push({label,value:`${slot.time}（${slot.time_zone}）`});
    }else{
      if(!usefulText(slot.time) || Object.keys(slot).some(field=>!['time','time_zone','weekdays'].includes(field))
        || !Array.isArray(slot.weekdays) || !slot.weekdays.length || slot.weekdays.some(day=>!wholeSeconds(day)||day<1||day>7))return null;
      cadence.push({label,value:`周${slot.weekdays.map(day=>'一二三四五六日'[day-1]).join('、周')} ${slot.time}（${slot.time_zone}）`});
    }
  }
  const weekdays = data.weekdays as number[] | undefined;
  if (weekdays?.length) cadence.push({label:'星期',value: weekdays.map(day=>`周${'一二三四五六日'[day-1]}`).join('、')});
  const fields=[...residentFields(remove(data,['after_seconds','every_seconds','at','daily','weekly','cron','weekdays'])),...cadence];
  return fields.length?{fields}:null;
}

function scheduleRecords(value: Data): CompactToolView | null {
  if (!wholeSeconds(value.scheduleCount) || !Array.isArray(value.schedules) || !value.schedules.every(objectValue)) return null;
  const items: NonNullable<CompactToolView['items']> = [];
  for (const row of value.schedules) {
    const details = schedule(remove(row, ['title','state']));
    if (!details && Object.keys(row).some(key => !['title','state'].includes(key))) return null;
    const state = residentFields({state:row.state})[0];
    items.push({title:usefulText(row.title) ? row.title : '定时事项', state:state && 'value' in state ? state.value : undefined, fields:details?.fields});
  }
  return {items, fields:residentFields(remove(value,['schedules'])), ...(value.scheduleCount === 0 ? {notice:'没有定时事项'} : {})};
}

export function compactToolPresentation(toolName:string,phase:'input'|'output',text:string):CompactToolView|null {
  if(phase==='output'&&['job_list','job_kill'].includes(toolName))return backgroundJobs(toolName,text);
  const value=parsePublicObject(text);
  if(!value)return null;
  if(phase==='input' && toolName==='web_search' && Object.keys(value).length===1
    && Array.isArray(value.queries) && value.queries.length && value.queries.every(usefulText))return {terms:value.queries};
  if (toolName==='communication_guidance_read' && value.scope==='communication-guidance'
    && Object.keys(value).every(key=>['scope','read','documentVersion'].includes(key))) {
    if (phase==='input' && Object.keys(value).length===1) return {fields:[{label:'读取范围',value:'沟通指引'}]};
    if (phase==='output' && value.read===true && (value.documentVersion===undefined || wholeSeconds(value.documentVersion))) {
      return {notice:'这条记录没有可核验的指引正文。'};
    }
  }
  if (scheduleNames.includes(toolName)) return Object.hasOwn(value, 'schedules') ? scheduleRecords(value) : schedule(value);
  if(toolName==='platform_task_query'&&phase==='output'&&Array.isArray(value.tasks)
    && value.tasks.every(task=>objectValue(task)&&usefulText(task.title))){
    const items=value.tasks.map((task:Data)=>{
      const status=residentFields({state:task.state ?? task.status})[0];
      return {title:task.title as string,state:status&&'value' in status?status.value:undefined,fields:residentFields(remove(task,task.state && task.status && task.state!==task.status?['title','state']:['title','state','status']))};
    });
    const fields=residentFields(remove(value,['tasks']));
    return {items,fields,...items.length===0?{notice:'此页没有任务'}:{}};
  }
  if(['platform_task_query','platform_config_query','platform_schedule_submit','job_kill'].includes(toolName)){
    const fields=residentFields(value);
    return fields.length?{fields}:null;
  }
  // Web search results may already be readable text. Do not fetch or augment them.
  return null;
}
