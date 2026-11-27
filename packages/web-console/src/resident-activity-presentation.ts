import type {Message} from './api';
import {objectValue, pairedPublicResult, parsePublicObject, residentFields, wholeToolMessage, type ResidentField} from './resident-tool-content.ts';

type Data = Record<string, unknown>;
const omit = (value: Data, keys: readonly string[]) => Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const label = (key: string, value: unknown) => {
  const field = residentFields({[key]:value})[0];
  return field && 'value' in field ? field.value : undefined;
};
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;
const requirements = (value: unknown) => Array.isArray(value) && value.every(item=>typeof item==='string') ? value as string[] : undefined;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const actionNames = ['supplement','resume','revise','reopen','control','arrange'];
const recordKeys = ['taskId','prerequisiteTaskId','dependencyId','id','replayed','dispatchEligible','received','accepted','scheduled','settled',
  'drained','dependenciesReady','runSequence','requirementRevision','expectedRequirementRevision','controlRevision','expectedControlRevision',
  'contextRevision','expectedContextRevision','arrangementRevision','expectedArrangementRevision','prerequisiteRequirementRevision'];
const actionKeys = ['kind','title','objective','requirements','handoff','reason','control'];
const taskKeys = ['title','objective','requirements','handoff','status','state','control'];
const receiptKeys = ['task','result'];
const sections = (key: string, fields: ResidentField[]): ResidentField[] => fields.length ? [{label:key,groups:[fields]}] : [];

type TaskSummary = {title: string; state?: string; control?: string; copy: ActionCopy[]; outcome?: {label: string; text: string}};
export type ResidentTaskQuery = {tasks: TaskSummary[]; notice?: string; extra: ResidentField[]};

function taskOutcome(task: Data): TaskSummary['outcome'] {
  const state = task.status ?? task.state;
  if (state === 'completed' || state === 'done') {
    const completion = objectValue(task.completion) ? task.completion : {};
    const result = objectValue(completion.result) ? completion.result : objectValue(task.result) ? task.result : {};
    const summary = text(completion.summary) ?? text(result.summary);
    if (summary) return {label:'结论', text:summary};
  }
  if (state === 'blocked' || state === 'waiting' || state === 'failed' || state === 'error') {
    const decision = objectValue(task.lastDecision) ? task.lastDecision : {};
    const summary = text(decision.question) ?? text(decision.summary);
    if (summary) return {label:'最近判断', text:summary};
  }
}

export function residentTaskQuery(value: Data): ResidentTaskQuery | null {
  if (value.task !== undefined && value.tasks !== undefined) return null;
  const rows = value.task !== undefined ? [value.task] : Array.isArray(value.tasks) ? value.tasks : null;
  if (!rows) return null;
  const tasks: TaskSummary[] = [];
  const records: ResidentField[][] = [];
  for (const row of rows) {
    if (!objectValue(row)) return null;
    const title=text(row.title);
    if (!title) return null;
    const outcome=taskOutcome(row);
    const control=row.control === 'active' ? undefined : label('control',row.control);
    tasks.push({title,state:label('status',row.status) ?? label('state',row.state),
      control,copy:actionCopy({},row),outcome});
    const details = residentFields(omit(row,['title','status','objective','requirements','handoff',...(control ? ['control'] : []),
      ...(row.status === undefined || row.status === row.state ? ['state'] : [])]));
    if (details.length) records.push(rows.length > 1 ? [{label:title,groups:[details]}] : details);
  }
  const extra = [...records.flat(), ...residentFields(omit(value,['task','tasks']))];
  const notice = text(value.reason) ?? (!tasks.length ? '未查到任务' : value.hasMore === true ? '还有更多任务' : undefined);
  return {tasks,notice,extra};
}

export type ActionCopy = {label: string; text?: string; list?: string[]};
export type ResidentAction = {
  title?: string;
  action?: string;
  state?: string;
  control?: string;
  notice?: string;
  outcome?: TaskSummary['outcome'];
  copy: ActionCopy[];
  extra: ResidentField[];
};
function actionCopy(input: Data, task: Data): ActionCopy[] {
  const copy: ActionCopy[] = [];
  const add = (label:string, value?: string) => {if(value)copy.push({label,text:value});};
  const submitted = (mainLabel:string, inputLabel:string, before:unknown, actual:unknown) => {
    const from=text(before), to=text(actual);
    add(mainLabel,to ?? from);
    if(from && to && from !== to)add(inputLabel,from);
  };
  if(text(input.title) && text(task.title) && input.title!==task.title)add('提交的标题',text(input.title));
  submitted('交接','提交的交接',input.handoff,task.handoff);
  add('原因',text(input.reason));
  submitted('目标','提交的目标',input.objective,task.objective);
  const before = requirements(input.requirements), after = requirements(task.requirements);
  const main = after ?? before;
  if(main?.length)copy.push({label:'要求',list:main});
  if(after && before?.length && !equal(before,after))copy.push({label:'提交的要求',list:before});
  return copy;
}

export function residentTaskAction(request?: Data, receipt?: Data): ResidentAction | null {
  const input=request ?? {};
  if (request && (typeof input.kind !== 'string' || !actionNames.includes(input.kind))) return null;
  const result=objectValue(receipt?.result) ? receipt.result : {};
  const rootTask=objectValue(receipt?.task)?receipt.task:undefined;
  const resultTask=objectValue(result.task)?result.task:undefined;
  // Preserve an unfamiliar envelope using the existing exact unlocked body.
  if (receipt && (!rootTask && !resultTask || rootTask && resultTask && !equal(rootTask,resultTask))) return null;
  const task=resultTask ?? rootTask ?? {};
  if (!request && !text(task.title)) return null;
  const title=text(task.title) ?? text(input.title);
  const state=label('status',task.status) ?? label('state',task.state);
  const control=label('control',task.control) ?? label('control',input.control);
  const output=receipt ?? {};
  const taskExtra=omit(task,[...taskKeys,...recordKeys]);
  if (text(task.status) && text(task.state) && task.status!==task.state) taskExtra.state=task.state;
  const inputExtra=omit(input,[...recordKeys,...actionKeys]);
  if (text(input.control) && text(task.control) && input.control!==task.control) inputExtra.control=input.control;
  const extra=[
    ...residentFields(omit(output,[...recordKeys,...receiptKeys])),
    ...residentFields(omit(result,['task',...recordKeys])),
    ...residentFields(taskExtra),
    ...sections('提交',residentFields(inputExtra)),
  ];
  const notice=output.accepted===false||output.received===false?'操作未接纳':output.replayed===true?'沿用原回执':undefined;
  return {title,action:label('kind',input.kind),state,control,notice,outcome:taskOutcome(task),copy:actionCopy(input,task),extra};
}

export function residentTaskActionLabel(call?:Message) {
  if (!wholeToolMessage(call) || call.toolName!=='resident_task_action')return undefined;
  const input=parsePublicObject(call.text);
  return input && typeof input.kind==='string' && actionNames.includes(input.kind) ? label('kind',input.kind) : undefined;
}

export function mergeResidentTaskAction(call?:Message, output?:Message): ResidentAction | null {
  if (!call?.source?.sessionId || !output || call.toolName!=='resident_task_action' || !pairedPublicResult(call,output))return null;
  const request=parsePublicObject(call.text), receipt=parsePublicObject(output.text);
  if (!request || !receipt || receipt.accepted===false || receipt.received===false
    || ['failed','error','unknown'].includes(String(receipt.status)))return null;
  const task=objectValue(receipt.result)&&objectValue(receipt.result.task)?receipt.result.task:receipt.task;
  if (!objectValue(task) || typeof request.taskId!=='string' || request.taskId!==task.taskId)return null;
  return residentTaskAction(request,receipt);
}

export type SettleItem = {label:string;count:number};
export type SettleEvent = {
  label: string; recorded: boolean; disposition?: string; inspectionReview?: string; at?: string;
  title?: string; snippet?: string; snippetTruncated?: true;
};
export type ResidentSettlement = {requested:number; dispositions:SettleItem[]; reviews:SettleItem[]; events?:SettleEvent[]};
const eventLabels: Record<string,string> = {
  'router.follow-up':'定时跟进', 'router.self-check':'定时自检', 'router.self-check.completed':'自检结果已返回', 'task.peer.request':'请求协作成员',
  'source.message':'渠道消息', 'operator.message':'网页留言', 'task.completed':'任务完成',
  'task.blocked':'任务受阻', 'task.waiting':'任务等待', 'task.arranged':'任务安排',
  'task.changed':'任务变更', 'task.inspection':'任务巡查', 'router.lookup.completed':'后台查询回执',
  'task.failed':'任务失败', 'task.reopened':'任务重开', 'task.started':'任务开始', 'task.resumed':'任务恢复',
  'task.result':'任务结果', 'task.cancelled':'任务取消', 'task.notification':'任务通知', 'task.interrupted':'任务中断',
  'schedule.triggered':'定时触发', 'notification.delivered':'通知已送达', 'notification.failed':'通知失败',
};
const dispositionKeys=['handled-inline','clarification','not-assigned','context-only','async-query'];
const reviewKeys=['wait','investigate','continue','notify'];
function eventRows(value: unknown, requested: number): SettleEvent[] | null {
  if (!Array.isArray(value) || value.length !== requested) return null;
  const events: SettleEvent[]=[];
  for (const row of value) {
    if (!objectValue(row) || typeof row.recorded !== 'boolean'
      || Object.keys(row).some(key=>!['recorded','kind','disposition','inspectionReview','at','title','snippet','snippetTruncated'].includes(key))) return null;
    const {kind, at, recorded, title, snippet, snippetTruncated} = row;
    if (recorded ? typeof kind !== 'string' || !Object.hasOwn(eventLabels,kind)
      : [kind,at,title,snippet,snippetTruncated,row.disposition,row.inspectionReview].some(field=>field!==undefined)) return null;
    if (at !== undefined && (typeof at !== 'string' || !Number.isFinite(Date.parse(at)))) return null;
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 240 || typeof kind !== 'string' || !kind.startsWith('task.'))) return null;
    if (snippet !== undefined && (typeof snippet !== 'string' || !snippet.trim() || snippet.length > 240 || (kind !== 'source.message' && kind !== 'operator.message'))) return null;
    if (snippetTruncated !== undefined && (snippetTruncated !== true || typeof snippet !== 'string')) return null;
    if (row.disposition !== undefined && (typeof row.disposition !== 'string' || !dispositionKeys.includes(row.disposition))) return null;
    if (row.inspectionReview !== undefined && (typeof row.inspectionReview !== 'string' || !reviewKeys.includes(row.inspectionReview))) return null;
    const disposition = typeof row.disposition === 'string' ? residentFields({[row.disposition]: 1})[0]?.label : undefined;
    const inspectionReview = typeof row.inspectionReview === 'string' ? residentFields({[row.inspectionReview]: 1})[0]?.label : undefined;
    events.push({label: typeof kind === 'string' ? eventLabels[kind] : '未核对到原事件', recorded,
      disposition, inspectionReview, at, title, snippet, snippetTruncated});
  }
  return events;
}
function unlistedCounts(receipts: SettleItem[], events: SettleEvent[], key: 'disposition'|'inspectionReview'): SettleItem[] {
  return receipts.flatMap(item=>{
    const missing = item.count - events.filter(event=>event[key]===item.label).length;
    return missing > 0 ? [{label:item.label,count:missing}] : [];
  });
}
function counts(value: unknown, allowed: readonly string[]): SettleItem[] | null {
  if (value===undefined)return [];
  if (!objectValue(value))return null;
  const items: SettleItem[]=[];
  for(const [key,count] of Object.entries(value)){
    if(!allowed.includes(key) || typeof count!=='number' || !Number.isSafeInteger(count) || count<1 || count>30)return null;
    items.push({label:residentFields({[key]:count})[0].label,count});
  }
  return items;
}
export function residentSettlement(value:Data, output:boolean): ResidentSettlement | null {
  const requested=value.requestedEventCount;
  if (typeof requested!=='number' || !Number.isSafeInteger(requested) || requested<1 || requested>30
    || (output ? value.settled!==true : value.settled!==undefined)
    || Object.keys(value).some(key=>!['requestedEventCount','settled','dispositions','inspectionReviews',...(output?['events']:[])].includes(key)))return null;
  const dispositions=counts(value.dispositions,dispositionKeys);
  const reviews=counts(value.inspectionReviews,reviewKeys);
  if (!dispositions || !reviews) return null;
  if (value.events === undefined) return {requested,dispositions,reviews};
  const events = eventRows(value.events, requested);
  // An unrecognized event field never falls through to a raw payload. A
  // verified aggregate is still useful when the item list isn't readable.
  return events ? {requested,events,dispositions:unlistedCounts(dispositions,events,'disposition'),reviews:unlistedCounts(reviews,events,'inspectionReview')}
    : {requested,dispositions,reviews};
}
