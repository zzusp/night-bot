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
  for (const [key, label] of [['evidence', '依据'], ['limitations', '限制']] as const) {
    const values = Array.isArray(row[key]) ? row[key].filter((value): value is string => typeof value === 'string' && !!value.trim()) : [];
    if (values.length) sections.push(`**${label}**\n\n${values.map(value => `- ${value}`).join('\n')}`);
  }
  return sections.join('\n\n');
}
