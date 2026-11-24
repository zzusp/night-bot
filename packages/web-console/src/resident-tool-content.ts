import type {Message} from './api';

type Data = Record<string, unknown>;
export const objectValue = (value: unknown): value is Data => value != null && typeof value === 'object' && !Array.isArray(value);
export function parsePublicObject(text: string): Data | null {
  try {const value: unknown = JSON.parse(text); return objectValue(value) ? value : null;} catch {return null;}
}
export const wholeToolMessage = (message?: Message): message is Message => !!message && !message.truncated && !message.transient
  && message.textNextOffset == null && (message.textTotal === undefined || message.textTotal === message.text.length);
const knownKeys = (value: Data, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const optionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;

export type PlanTask = {title: string; objective?: string; request?: string; submittedRequest?: string; quote?: string; requirements?: string[]; state?: string; control?: string};
type PlanDependency = {condition: string; state?: string; taskTitle?: string; prerequisiteTitle?: string};
export type ResidentPlan = {tasks: PlanTask[]; dependencies: PlanDependency[]; committed: boolean; replayed?: boolean; dispatchEligible?: boolean};

export function residentPlan(value: Data, committed: boolean): ResidentPlan | null {
  const payload = committed ? value.result : value;
  if (committed && (!knownKeys(value,['received','accepted','settled','scheduled','status','replayed','dispatchEligible','result'])
    || value.received === false || value.accepted === false || ['failed','error','unknown'].includes(String(value.status)))) return null;
  if (!objectValue(payload) || !knownKeys(payload,['tasks','dependencies'])
    || !Array.isArray(payload.tasks) || !payload.tasks.length || payload.tasks.length > 15
    || payload.dependencies !== undefined && (!Array.isArray(payload.dependencies) || payload.dependencies.length > 30)) return null;
  const tasks: PlanTask[] = [], dependencies: PlanDependency[] = [];
  for (const task of payload.tasks) {
    if (!objectValue(task) || !knownKeys(task,['taskId','title','objective','request','handoff','requirements','quote','state','status','control','requirementRevision','contextRevision','controlRevision','arrangementRevision','projection','detailAvailable','truncatedFields','drained','dependenciesReady','runSequence','lastDecision','result','completion'])
      || typeof task.title !== 'string' || !task.title.trim()
      || task.requirements !== undefined && (!Array.isArray(task.requirements) || task.requirements.some(item => typeof item !== 'string'))) return null;
    tasks.push({title:task.title, objective:optionalText(task.objective), request:optionalText(task.handoff ?? task.request),
      quote:optionalText(task.quote), requirements:task.requirements as string[] | undefined, state:committed ? optionalText(task.state ?? task.status) : undefined,
      control: committed ? optionalText(task.control) : undefined});
  }
  for (const dependency of (payload.dependencies ?? []) as unknown[]) {
    if (!objectValue(dependency) || !knownKeys(dependency,['id','condition','taskTitle','prerequisiteTitle','taskId','prerequisiteTaskId','state','status','requirementRevision','controlRevision','contextRevision','arrangementRevision','prerequisiteRequirementRevision'])
      || typeof dependency.condition !== 'string' || !dependency.condition.trim()) return null;
    dependencies.push({condition:dependency.condition, state:committed ? optionalText(dependency.state ?? dependency.status) : undefined, taskTitle:optionalText(dependency.taskTitle), prerequisiteTitle:optionalText(dependency.prerequisiteTitle)});
  }
  return {tasks,dependencies,committed, replayed:committed && value.replayed === true, dispatchEligible:committed && typeof value.dispatchEligible === 'boolean' ? value.dispatchEligible : undefined};
}

export function planReceipt(output?: Message): ResidentPlan | null {
  if (!wholeToolMessage(output) || output.toolName !== 'resident_task_plan' || output.isError || output.status !== 'completed') return null;
  const value = parsePublicObject(output.text);
  return value ? residentPlan(value,true) : null;
}

// Suppress only an input that is already fully represented by the paired
// receipt. The Host may shorten objective/requirements in its receipt.
function pairedPublicResult(call?: Message, output?: Message) {
  return wholeToolMessage(call) && wholeToolMessage(output) && !!call.callId && call.callId === output.callId
    && call.toolName === output.toolName && call.source?.sessionId === output.source?.sessionId
    && !output.isError && output.status === 'completed';
}
export function mergeResidentPlan(call?: Message, output?: Message): ResidentPlan | null {
  if (!call || call.toolName !== 'resident_task_plan' || !pairedPublicResult(call,output)) return null;
  const value = parsePublicObject(call.text), request = value && residentPlan(value,false), receipt = planReceipt(output);
  if (!request || !receipt || request.tasks.length !== receipt.tasks.length || request.dependencies.length !== receipt.dependencies.length) return null;
  const compatible = request.tasks.every((task,i) => {
    const applied = receipt.tasks[i];
    return task.title === applied.title && (!task.objective || task.objective === applied.objective)
      && (!task.request || !applied.request || task.request === applied.request) && (!task.quote || task.quote === applied.quote)
      && (!task.requirements?.length || JSON.stringify(task.requirements) === JSON.stringify(applied.requirements));
  }) && request.dependencies.every((line,i) => {
    const actual=receipt.dependencies[i];
    return line.condition === actual.condition && (!line.taskTitle || line.taskTitle === actual.taskTitle)
      && (!line.prerequisiteTitle || line.prerequisiteTitle === actual.prerequisiteTitle);
  });
  if (!compatible) return null;
  return {...receipt,tasks:receipt.tasks.map((task,i)=>({...task,submittedRequest:task.request ? undefined : request.tasks[i].request}))};
}

// null = leave the original body unchanged; empty string = all public input
// fields already appear in the receipt. A partial reduction preserves the
// original MessageBody/authorization and only changes its top-level display.
export function residentInputRemainder(call?: Message, output?: Message): string | null {
  if (!call?.toolName?.startsWith('resident_') || !output || !pairedPublicResult(call,output)) return null;
  const request = parsePublicObject(call.text), receipt = parsePublicObject(output.text);
  if (!request || !receipt || receipt.ok === false || receipt.accepted === false || !Object.keys(request).length) return null;
  const original = Object.entries(request), remaining = original.filter(([key,value]) =>
    !Object.hasOwn(receipt,key) || JSON.stringify(value) !== JSON.stringify(receipt[key]));
  return remaining.length === original.length ? null : remaining.length ? JSON.stringify(Object.fromEntries(remaining)) : '';
}

const fieldLabels: Record<string,string> = {
  replayed:'沿用原回执', dispatchEligible:'允许调度', evaluation:'依赖复核', dependency:'依赖', action:'操作', operation:'操作', scope:'范围', kind:'类型', mode:'查看范围', state:'状态', status:'状态', control:'调度状态', title:'标题',
  objective:'目标', requirements:'要求', condition:'条件', dependencies:'依赖', taskTitle:'后续任务', prerequisiteTitle:'前置任务',
  request:'交办内容', handoff:'交接内容', reason:'原因', sameGoal:'沿用原目标', text:'正文', quote:'引用', summary:'摘要',
  tasks:'任务', task:'任务', result:'回执', results:'结果', decision:'判断', evidence:'依据', completion:'结论', question:'待确认',
  accepted:'已接纳', received:'已收到', settled:'已结清', scheduled:'已安排', sent:'已发送', delivered:'已送达', reused:'复用原结果',
  webOnly:'仅网页', replyToSource:'引用原消息', replyPurpose:'回复用途', deliveryFileCount:'附件数', hasMore:'还有更多',
  persisted:'已保存', committed:'已提交', ok:'成功', active:'已启用', changed:'已变更', duplicate:'复用原操作', removed:'已移除', archived:'已归档',
  revision:'版本', expectedRevision:'预期版本', currentRevision:'当前版本', recordCount:'记录数', activeCount:'启用数',
  dispositions:'来源处理', inspectionReviews:'巡查处理', eventCount:'提交事件数', requestedEventCount:'提交事件数',
  entryCount:'记忆条目数', sourceCount:'来源数', taskCount:'任务数', offset:'查询起点', nextOffset:'下一页起点', limit:'条数上限', total:'总数',
  count:'数量', found:'找到', name:'名称', mediaType:'文件类型', note:'备注', bytes:'字节数', size:'大小', by:'查询依据', filter:'筛选', recipientCount:'收件人数',
  requirementRevision:'需求版本', controlRevision:'调度版本', contextRevision:'上下文版本', arrangementRevision:'依赖版本',
  'context-only':'仅作背景', 'handled-inline':'已直接处理', clarification:'已请求澄清', 'not-assigned':'未交办', 'async-query':'后台查询',
  wait:'等待', continue:'继续', satisfied:'已满足', investigate:'调查', notify:'通知',
  replyCount:'回复数', replies:'回复记录', sources:'来源记录', timestamp:'时间', createdAt:'记录时间',
  deliveredAt:'送达时间', attachmentCount:'附件数', associatedTaskCount:'关联任务数', quoteStatus:'引用状态',
  truncated:'已截断', hasAttachments:'含附件', keywordFilter:'关键词筛选', continued:'继续查询',
  before:'截止时间', after:'起始时间', detail:'查询详细度', index:'位置', messageVersion:'消息版本',
  dependencyId:'依赖编号', taskId:'任务编号', prerequisiteTaskId:'前置任务编号', runSequence:'运行轮次',
  drained:'已退出执行', dependenciesReady:'依赖就绪', lastDecision:'最近判断', activities:'执行记录',
  requiresFullRead:'需完整读取', dependenciesTruncated:'依赖已截断', coverage:'覆盖范围', verification:'证据来源',
  toolName:'工具', toolCalls:'工具调用', isError:'失败', resultAvailable:'有结论', at:'时间',
};
const values: Record<string,Record<string,string>> = {
  mode:{catalog:'索引',topic:'主题',entry:'条目'},
  scope:{'standing-instructions':'长期指令',memory:'记忆',index:'索引',topic:'主题',entry:'条目',inventory:'清单'},
  operation:{remember:'保存',forget:'忘记',keep:'保留',update:'更新',delete:'删除',upsert:'保存或更新',review:'核对',query:'查询'},
  state:{active:'已安排',running:'执行中',pending:'待执行',waiting:'等待中',completed:'已完成',blocked:'受阻',cancelled:'已取消',
    prepared:'已冻结',sending:'发送中',unknown:'状态未知',held:'暂停发送',failed:'失败',delivered:'已送达',
    superseded:'已被替代','awaiting-readback':'等待回查',current:'当前',retracted:'已撤回'},
  quoteStatus:{current:'当前',unverified:'未核验',superseded:'已被替代',unavailable:'不可用'},
  by:{source:'来源',task:'任务',notification:'通知'},
  detail:{index:'索引',summary:'摘要',full:'完整',progress:'进展',handoff:'交接'},
  control:{active:'启用',paused:'已暂停',cancelled:'已取消'},
  decision:{satisfied:'条件已满足',continue:'继续核查',wait:'保持等待'},
  kind:{supplement:'补充任务',resume:'恢复任务',revise:'修订任务',reopen:'重开任务',control:'调整状态',arrange:'安排依赖'},
  action:{upsert:'保存或更新',delete:'删除',remember:'保存记忆',forget:'删除记忆'},
  replyPurpose:{'direct-answer':'直接答复','task-update':'任务进展'},
};
export type ResidentField = {label: string; value: string} | {label: string; groups: ResidentField[][]};
export function residentFields(value: Data, depth=0): ResidentField[] {
  if (depth > 4) return [];
  return Object.entries(value).flatMap(([key, child]):ResidentField[] => {
    if (['taskId','prerequisiteTaskId'].includes(key) && (value.title || value[key === 'taskId' ? 'taskTitle' : 'prerequisiteTitle'])) return [];
    const label=Object.hasOwn(fieldLabels,key)?fieldLabels[key]:key;
    const enumKey=key==='status'?'state':key;
    if (typeof child === 'boolean') return [{label,value:child?'是':'否'}];
    if (typeof child === 'number') return [{label,value:String(child)}];
    if (typeof child === 'string') return child.trim() ? [{label,value:(Object.hasOwn(values,enumKey) && Object.hasOwn(values[enumKey], child) ? values[enumKey][child] : child)}] : [];
    if (Array.isArray(child) && child.every(item=>typeof item==='string')) return child.length ? [{label,value:child.join('\n')}] : [];
    const groups = objectValue(child) ? [residentFields(child,depth+1)]
      : Array.isArray(child) ? child.filter(objectValue).map(item=>residentFields(item,depth+1)) : [];
    return groups.some(group=>group.length) ? [{label,groups:groups.filter(group=>group.length)}] : [];
  });
}
export function planStatusText(task: PlanTask) {
  if (task.control === 'paused' || task.control === 'cancelled') return values.control[task.control];
  return task.state ? (Object.hasOwn(values.state,task.state) ? values.state[task.state] : task.state) : undefined;
}
