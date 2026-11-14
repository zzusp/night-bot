import { useEffect, useState } from 'react';
import { ApiError, type TaskLearning } from '../api';
import { useResource } from '../hooks';
import { taskLearningCounts } from '../task-learning-counts';
import { Notice } from './Shared';

export function TaskLearningSummary({taskId}: {taskId: string}) {
  const query = useResource<TaskLearning>(`/tasks/${encodeURIComponent(taskId)}/learning`, 4000);
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (!query.error) setDenied(false); }, [query.updatedAt]);
  const data = forbidden || denied ? null : query.data;
  const counts = taskLearningCounts(taskId, data);
  return <section className="detail-section task-learning-summary" aria-label="任务复盘">
    <h3>任务复盘</h3>
    <dl className="task-learning-counts">
      <div><dt>记忆</dt><dd>{counts.memory ?? '—'}</dd></div>
      <div><dt>技能</dt><dd>{counts.skill ?? '—'}</dd></div>
    </dl>
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}

  </section>;
}
