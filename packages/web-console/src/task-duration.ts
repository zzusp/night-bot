import type { TaskDuration } from './api';
export function taskDurationText(value: TaskDuration | undefined, observedAt: string | undefined, elapsed: number) {
  if (!value || value.milliseconds === null) return '—';
  const start = value.activeSince ? Date.parse(value.activeSince) : null;
  const observed = observedAt ? Date.parse(observedAt) : NaN;
  const ms = value.milliseconds + (start === null ? 0 : Math.max(0, observed - start + elapsed));
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
  return `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时`;
}
