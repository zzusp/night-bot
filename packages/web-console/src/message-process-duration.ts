// First-reply totals and process nodes share the same display boundary.
// Keep the original receipt value intact; rounding is presentation only.
export function messageProcessDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const value = ms < 1000 ? ms : ms / 1000;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} ${ms < 1000 ? '毫秒' : '秒'}`;
}
