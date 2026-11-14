import type { TaskLearning } from './api';

/** Entry identity excludes review/version so repeat updates count only once. */
export function taskLearningCounts(taskId: string, data?: TaskLearning | null) {
  const result: {memory: number | null; skill: number | null} = {memory: null, skill: null};
  if (data?.status !== 'ready' || !Array.isArray(data.changes)) return result;
  for (const kind of ['memory', 'skill'] as const) {
    if (data.changesComplete?.[kind] !== true) continue;
    const entries = new Set<string>();
    let valid = true;
    for (const change of data.changes) {
      if (change.kind !== kind || change.status !== 'applied') continue;
      if (change.taskId !== taskId) continue;
      if (!change.source?.taskId) { valid = false; break; }
      if (change.source.taskId !== taskId) continue;
      if (!change.entryId || !change.reviewId || change.source.reviewId !== change.reviewId || !change.source.eventId) { valid = false; break; }
      entries.add(change.entryId);
    }
    if (valid) result[kind] = entries.size;
  }
  return result;
}
