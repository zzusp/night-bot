import type { Task } from '../api';
import { dateTime } from '../hooks';
import { taskDurationText } from '../task-duration';
import { Markdown, Status } from './Shared';

/** Read-only inspector: duration values are supplied by the task API. */
export function TaskOverview({ task }: { task: Task }) {
  return <>
    <section className="detail-section task-summary-card">
      <div className="task-summary-status"><Status value={task.state} /></div>
      <h2 className="task-info-title">{task.title || '未命名任务'}</h2>
      <dl className="task-duration-grid">
        <div><dt>总时长</dt><dd>{taskDurationText(task.durations?.total, task.durations?.observedAt, 0)}</dd></div>
        <div><dt>执行时长</dt><dd>{taskDurationText(task.durations?.execution, task.durations?.observedAt, 0)}</dd></div>
      </dl>
      <dl className="task-facts">
        <div><dt>创建时间</dt><dd><time dateTime={task.createdAt}>{dateTime(task.createdAt)}</time></dd></div>
        <div><dt>最近更新</dt><dd><time dateTime={task.updatedAt}>{dateTime(task.updatedAt)}</time></dd></div>
      </dl>
    </section>
    <section className="detail-section task-objective-card"><h3>任务目标</h3>{task.objective ? <Markdown text={task.objective} /> : <p className="task-empty">暂无任务目标</p>}</section>
  </>;
}
