import type { Task } from './api';

// Only explicit, already-redacted Host result fields. Never infer a conclusion
// from the last tool response, reasoning, delivery receipt or live Pi text.
export function taskConclusion(task: Task): string | null {
  if (!['completed', 'waiting', 'cancelled', 'failed'].includes(task.state)
      || !['idle', 'failed'].includes(task.session?.status || '')) return null;
  const result = task.result;
  if (typeof result === 'string') return result.trim() || null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  if (!summary) return null;
  const question = typeof row.question === 'string' ? row.question.trim() : '';
  const sections = [summary];
  if (question && question !== summary) sections.push(question);
  return sections.join('\n\n');
}

// Same receipt-based cumulative execution time as the task list, excluding waits.
export function taskConclusionDuration(task: Task): string | null {
  const duration = task.durations?.execution;
  if (!taskConclusion(task) || !duration || duration.activeSince != null
      || typeof duration.milliseconds !== 'number' || !Number.isFinite(duration.milliseconds)
      || duration.milliseconds < 0) return null;
  const seconds = Math.floor(duration.milliseconds / 1000);
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return `用时 ${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${s}s`;
}
