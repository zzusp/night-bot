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

// Point events have a trustworthy occurrence time, not an execution span.
// Derive only their distance from the same source's receipt, never from a
// neighboring event: stages can overlap, finish out of order or be shared.
export function messageProcessMetric(step: MessageProcessTiming, receivedAt: string | null): string {
  const span = step.timingType === 'span' || step.timingType !== 'milestone' &&
    (step.durationMs !== undefined || /^stage-.+-completed$/.test(step.kind ?? ''));
  if (span) {
    if (step.durationMs === undefined) return '耗时未记录';
    return typeof step.durationMs === 'number' && Number.isFinite(step.durationMs) && step.durationMs >= 0
      ? `耗时 ${messageProcessDuration(step.durationMs)}` : '耗时异常';
  }
  const start = receivedAt ? Date.parse(receivedAt) : NaN;
  const at = Date.parse(step.at);
  if (!Number.isFinite(at)) return '节点时间缺失';
  if (!Number.isFinite(start)) return '接收时间缺失';
  const elapsed = at - start;
  return elapsed >= 0 ? `接收后 ${messageProcessDuration(elapsed)}` : '时间异常';
}
