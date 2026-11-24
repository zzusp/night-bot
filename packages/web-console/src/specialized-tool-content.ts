import {parsePublicObject, residentPlan, residentFields, type ResidentField, type ResidentPlan} from './resident-tool-content.ts';

export type SpecializedToolKind = 'memory' | 'skill' | 'lookup' | 'resident';
type Descriptor = {kind: SpecializedToolKind; label: string};
const descriptors: Record<string, Descriptor> = {
  memory_status: {kind: 'memory', label: '记忆状态'},
  memory_index: {kind: 'memory', label: '记忆索引'},
  memory_candidates: {kind: 'memory', label: '记忆候选'},
  memory_read: {kind: 'memory', label: '读取记忆'},
  memory_search: {kind: 'memory', label: '搜索记忆'},
  memory_remember: {kind: 'memory', label: '保存记忆'},
  memory_forget: {kind: 'memory', label: '忘记记忆'},
  memory_promote: {kind: 'memory', label: '整理记忆'},
  resident_memory_remember: {kind: 'memory', label: '保存记忆'},
  resident_memory_forget: {kind: 'memory', label: '忘记记忆'},
  resident_memory_review: {kind: 'memory', label: '核对记忆'},
  resident_memory_reconcile: {kind: 'memory', label: '维护记忆'},
  skill: {kind: 'skill', label: '加载技能'},
  resident_skill_query: {kind: 'skill', label: '查询技能'},
  resident_skill_mutate: {kind: 'skill', label: '维护技能'},
  resident_task_lookup_async: {kind: 'lookup', label: '后台只读查询'},
  resident_task_plan: {kind: 'resident', label: '安排任务'},
  resident_task_query: {kind: 'resident', label: '查询任务'},
  resident_task_action: {kind: 'resident', label: '调度任务'},
  resident_dependency_evaluate: {kind: 'resident', label: '评估依赖'},
  resident_source_get: {kind: 'resident', label: '读取来源'},
  resident_source_query: {kind: 'resident', label: '查询来源'},
  resident_reply_query: {kind: 'resident', label: '查询回复'},
  resident_router_reply: {kind: 'resident', label: '发送回复'},
  resident_operator_reply: {kind: 'resident', label: '网页答复'},
  resident_router_settle: {kind: 'resident', label: '结清事件'},
  resident_web_attachment: {kind: 'resident', label: '查看附件'},

};
export function specializedToolDescriptor(name: string) {
  return Object.hasOwn(descriptors, name) ? descriptors[name] : null;
}
export const hasSpecializedToolContent = (name: string) => specializedToolDescriptor(name) !== null;
export const specializedToolLabel = (name: string) => specializedToolDescriptor(name)?.label ?? name;

const lookupStatus: Record<string, string> = {
  pending: '已接纳，等待结果', completed: '查询已完成', failed: '查询失败',
  'timed-out': '查询超时', interrupted: '查询已中断',
};
export interface SpecializedToolSummary {label: string; tone: 'neutral' | 'success' | 'warning' | 'danger'}
const lookupSummary: Record<string, SpecializedToolSummary> = {
  pending: {label: '等待查询结果', tone: 'neutral'},
  completed: {label: '查询已完成', tone: 'success'},
  failed: {label: '查询失败', tone: 'danger'},
  'timed-out': {label: '查询超时', tone: 'warning'},
  interrupted: {label: '查询已中断', tone: 'warning'},
};
export function specializedToolSummary(toolName: string, output?: {
  text?: string; status?: string; isError?: boolean; truncated?: boolean;
  textNextOffset?: number | null; textTotal?: number; transient?: boolean;
}): SpecializedToolSummary | null {
  if (!output || output.status !== 'completed'
    || output.isError || output.truncated || output.transient || output.textNextOffset != null
    || typeof output.text !== 'string' || output.textTotal !== undefined && output.textTotal !== output.text.length) return null;
  try {
    const value = parsePublicObject(output.text);
    if (!value) return null;
    if (toolName === 'resident_task_plan' && residentPlan(value,true)) return {label:'安排已记录',tone:'success'};
    if (toolName === 'resident_router_settle' && value.settled === true
      && Number.isSafeInteger(value.requestedEventCount) && (value.requestedEventCount as number) > 0) return {label:'已结清',tone:'success'};
    if ((toolName.startsWith('resident_memory_') || toolName === 'resident_skill_mutate') && value.ok === false)
      return {label:value.committed === true ? '结果待核实' : '未成功',tone:value.committed === true ? 'warning' : 'danger'};
    if (toolName === 'resident_memory_review' && value.ok === true && value.operation === 'review') return {label:'已核对',tone:'success'};
    if (toolName !== 'resident_task_lookup_async') return null;
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2
      && value.readOnly === true && typeof value.status === 'string' && Object.hasOwn(lookupSummary, value.status)
      ? {...lookupSummary[value.status]} : null;
  } catch { return null; }
}
export interface SpecializedToolPresentation {
  kind: SpecializedToolKind;
  label: string;
  fields: {label: string; value: string}[];
  plan?: ResidentPlan;
  resident?: ResidentField[];
  text?: string;
}
/** Only pass the current public MessageBody page, never raw tool arguments/details. */
export function specializedToolPresentation({toolName, phase, text, offset = 0, isError = false, complete = true, status}: {
  toolName: string; phase: 'input' | 'output'; text: string; offset?: number; isError?: boolean; complete?: boolean; status?: string;
}): SpecializedToolPresentation | null {
  const descriptor = specializedToolDescriptor(toolName);
  if (!descriptor) return null;
  const plain = {...descriptor, fields: [], text};
  if (offset !== 0 || isError || !complete) return plain;
  const value = parsePublicObject(text);
  if (!value) return plain;
  if (toolName === 'resident_task_plan') {
    const plan = phase === 'input' ? residentPlan(value,false) : status === 'completed' ? residentPlan(value,true) : null;
    if (plan) return {...descriptor, fields:[], plan};
  }
  // No inference from opaque IDs, skill names/paths, memory keys or partial JSON.
  // Any unfamiliar public field retains the existing exact text presentation.
  if (descriptor.kind === 'lookup') {
    if (phase === 'input' && Object.keys(value).length === 1 && Number.isSafeInteger(value.taskCount)
      && (value.taskCount as number) >= 1 && (value.taskCount as number) <= 3) {
      return {...descriptor, fields: [{label: '请求范围', value: `${value.taskCount} 项任务`}]};
    }
    if (phase === 'output' && Object.keys(value).length === 2 && value.readOnly === true
      && typeof value.status === 'string' && Object.hasOwn(lookupStatus, value.status)) {
      return {...descriptor, fields: [{label: '查询状态', value: lookupStatus[value.status]}, {label: '权限', value: '只读'}]};
    }
  }
  if (toolName.startsWith('resident_') && descriptor.kind !== 'lookup') {
    const resident = residentFields(value);
    if (resident.length) return {...descriptor, fields:[], resident};
  }
  // Existing memory/skill projections deliberately withhold catalog/body data.
  // Keep their exact authorized notice instead of opening a broader source.
  if (phase === 'input' && Object.keys(value).length === 0) return {...descriptor, fields: [{label: '操作', value: descriptor.label}]};
  if (phase === 'input' && toolName === 'skill' && Object.keys(value).length === 1 && value.action === '加载技能') {
    return {...descriptor, fields: [{label: '操作', value: descriptor.label}]};
  }
  return plain;
}
