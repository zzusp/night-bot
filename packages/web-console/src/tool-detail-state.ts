// Only choose presentation from public DTO metadata. Old DTOs used fixed
// sentences; match only that exact vocabulary, not arbitrary tool-body text.
import type {Message} from './api.ts';

export type ToolDetailPhase = 'input' | 'output';

const legacyNotices: Record<ToolDetailPhase, Map<string, string>> = {
  input: new Map([
    ['此工具尚未声明可展示的输入字段；调用名称与状态保留。', '参数未公开。'],
    ['此调用缺少可核对的参数；未展示私有内容。', '缺少可核对的参数，未展示原文。'],
  ]),
  output: new Map([
    ['此工具尚未声明可展示的结果字段；调用名称与状态保留。', '结果未公开。'],
    ['此工具尚未声明可展示的结果字段。', '结果未公开。'],
    ['此结果缺少可核对的回执；未展示私有内容。', '缺少可核对的回执，未展示原文。'],
    ['未记录可核对的沟通指引正文。', '未记录可核对的沟通指引正文。'],
    ['此结果没有唯一配对的工具调用，正文未展示。', '未找到唯一对应的调用，未展示结果正文。'],
    ['此工具涉及独立的记忆或技能读取权限，请通过记忆与技能入口查看获权正文。', '此工具涉及独立的记忆或技能读取权限，请通过记忆与技能入口查看获权正文。'],
  ]),
};
const unrecorded = (phase: ToolDetailPhase) => phase === 'input' ? '未记录输入参数。' : '未记录工具结果。';
const withheld = (phase: ToolDetailPhase) => phase === 'input' ? '参数未公开。' : '结果未公开。';

export function toolDetailNotice(phase: ToolDetailPhase, record?: Message, options: {elsewhere?: boolean; running?: boolean} = {}): string | null {
  if (!record) return options.elsewhere ? phase === 'input' ? '输入见上方调用。' : '见下方结果。'
    : phase === 'output' && options.running ? '等待工具返回。' : unrecorded(phase);
  // A first fragment is still real content, even when it happens to look
  // exactly like an empty object or a legacy notice. Keep paging and access checks.
  if (record.truncated || record.textNextOffset != null
      || (record.textTotal !== undefined && record.textTotal !== record.text.length)) return null;
  const text = record.text.trim();
  const legacy = record.redacted === true && !record.resourceContent && legacyNotices[phase].get(text);
  if (phase === 'output' && (record.isError || ['failed', 'error'].includes(record.status || ''))) {
    if (text && !legacy) return null; // Actual disclosed reasons and log fragments win.
    if (record.failure) return record.failure.reason + (record.failure.code ? '\n错误码：' + record.failure.code : '');
    return '未记录失败原因';
  }
  if (legacy) return legacy;
  const statePlaceholder = text === '工具已返回，未包含文字正文。' && phase === 'output'
    || record.detailState && ['没有其他详情。', '详情未公开。', '该工具的参数未公开。', '该工具的返回正文未公开。'].includes(text);
  // Never discard actual authorized content because a partial response also
  // reports an omitted field. In particular, redacted is not "withheld".
  if (text && !statePlaceholder && !((phase === 'input' || record.detailState) && /^\{\s*\}$/u.test(text))) return null;
  if (record.detailState === 'withheld' || (record.redacted === true && !record.detailState)) return withheld(phase);
  if (record.detailState === 'not-recorded') return unrecorded(phase);
  if (record.detailState === 'empty' || (phase === 'input' && /^\{\s*\}$/u.test(text))) {
    return phase === 'input' ? '无需参数。' : '已返回，无文字输出。';
  }
  return phase === 'input' ? unrecorded(phase) : '已返回，无文字输出。';
}
