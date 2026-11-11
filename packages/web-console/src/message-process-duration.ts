// First-reply totals and process nodes share the same display boundary.
// Keep the original receipt value intact; rounding is presentation only.
export function messageProcessDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const value = ms < 1000 ? ms : ms / 1000;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} ${ms < 1000 ? '毫秒' : '秒'}`;
}


export interface MessageProcessTiming {
  kind?: string;
  timingType?: 'milestone' | 'span';
  at: string;
  durationMs?: number;
}

export interface MessageProcessMetricView {
  kind: 'milestone' | 'span';
  value: string;
  label: string;
  state: 'measured' | 'missing' | 'invalid';
}

// Point events share the source receipt origin; neighboring nodes are not spans.
export function messageProcessMetricView(step: MessageProcessTiming, receivedAt: string | null): MessageProcessMetricView {
  const span = step.timingType === 'span' || step.timingType !== 'milestone' &&
    (step.durationMs !== undefined || /^stage-.+-completed$/.test(step.kind ?? ''));
  const kind = span ? 'span' : 'milestone';
  const result = (value: string, label: string, state: MessageProcessMetricView['state']): MessageProcessMetricView => ({ kind, value, label, state });
  if (span) {
    if (step.durationMs === undefined) return result('未记录', '耗时未记录', 'missing');
    return typeof step.durationMs === 'number' && Number.isFinite(step.durationMs) && step.durationMs >= 0
      ? result(messageProcessDuration(step.durationMs), `耗时 ${messageProcessDuration(step.durationMs)}`, 'measured')
      : result('异常', '耗时异常', 'invalid');
  }
  const start = receivedAt ? Date.parse(receivedAt) : NaN;
  const at = Date.parse(step.at);
  if (!Number.isFinite(at)) return result('节点时间缺失', '节点时间缺失', 'missing');
  if (!Number.isFinite(start)) return result('接收时间缺失', '接收时间缺失', 'missing');
  const elapsed = at - start;
  return elapsed >= 0
    ? result(`+${messageProcessDuration(elapsed)}`, `接收后 ${messageProcessDuration(elapsed)}`, 'measured')
    : result('时间异常', '时间异常', 'invalid');
}

export function messageProcessMetric(step: MessageProcessTiming, receivedAt: string | null): string {
  return messageProcessMetricView(step, receivedAt).label;
}
