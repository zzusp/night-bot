import { RiArrowRightSLine, RiCheckboxCircleLine, RiTimeLine, RiLoader4Line } from '@remixicon/react';
import type { Overview, Page, Task } from '../api';
import { dateTime } from '../hooks';
import { Loading, Notice, Status } from './Shared';
import '../styles/activity-panel.css';

function TaskRow({task}: {task: Task}) {
  const title = task.title || task.objective || '未命名任务';
  const updated = task.updatedAt || task.createdAt;
  return <a className="rail-task" href={`#/tasks/${encodeURIComponent(task.taskId)}`} title={title}>
    <div className="rail-task-copy"><strong>{title}</strong><div className="rail-task-meta"><Status value={task.state} /><time title={dateTime(updated, false, true)}>{dateTime(updated)}</time></div></div>
    <RiArrowRightSLine className="rail-task-arrow" size={16} aria-hidden="true" />
  </a>;
}

function TaskSection({title, tasks, href, tone, failed}: {title: string; tasks?: Page<Task> | null; href: string; tone: 'running' | 'waiting' | 'recent'; failed: boolean}) {
  const Icon = tone === 'running' ? RiLoader4Line : tone === 'waiting' ? RiTimeLine : RiCheckboxCircleLine;
  return <section className={`rail-section rail-section-${tone}`} aria-label={title}>
    <div className="rail-section-title"><h3><Icon size={16} aria-hidden="true" />{title}</h3><a href={href} aria-label={`查看${title}任务`}>查看<RiArrowRightSLine size={15} aria-hidden="true" /></a></div>
    {tasks?.items.length ? <div className="rail-task-list">{tasks.items.slice(0, 5).map(task => <TaskRow key={task.taskId} task={task}/>)}</div> : <p className="rail-empty">{failed || !tasks || tasks.total > 0 ? '暂时无法读取任务，请刷新。' : tone === 'running' ? '暂无执行中的任务' : tone === 'waiting' ? '暂无等待中的任务' : '暂无任务'}</p>}
  </section>;
}

export function ActivityPanel({data, loading, error, onRetry}: {data?: Overview; loading: boolean; error: unknown; onRetry: () => void}) {
  // The overview pages own their totals and membership. Waiting never implies a
  // human approval request, and an unavailable page must not become a zero.
  const incomplete = !!Object.keys(data?.sectionErrors || {}).length;
  const idle = !error && !!data?.running && !!data?.waiting
    && !data.sectionErrors?.running && !data.sectionErrors?.waiting
    && data.running.total === 0 && data.waiting.total === 0
    && data.running.items.length === 0 && data.waiting.items.length === 0;
  return <aside id="activity-panel" className="activity-rail" aria-label="任务动态">
    <div className="rail-heading"><h2>工作动态</h2><a href="#/tasks">全部任务<RiArrowRightSLine size={16} aria-hidden="true" /></a></div>
    {!!error && <Notice error={error} stale={!!data} onRetry={onRetry}/>}
    {incomplete && <p className="rail-empty rail-warning" role="status">部分工作动态暂不可读，可刷新概览重新获取。</p>}
    {!data && loading ? <Loading/> : <>
      <div className="activity-counts">
        <a href="#/tasks?state=running"><span><i className="count-dot info"/>执行中</span><strong>{data?.sectionErrors?.running ? '—' : data?.running?.total ?? '—'}</strong></a>
        <a href="#/tasks?state=waiting"><span><i className="count-dot warning"/>等待中</span><strong>{data?.sectionErrors?.waiting ? '—' : data?.waiting?.total ?? '—'}</strong></a>
      </div>
      <TaskSection title="正在执行" tasks={data?.running} href="#/tasks?state=running" tone="running" failed={!!data?.sectionErrors?.running}/>
      <TaskSection title="等待继续" tasks={data?.waiting} href="#/tasks?state=waiting" tone="waiting" failed={!!data?.sectionErrors?.waiting}/>
      {idle && <TaskSection title="最近任务" tasks={data?.tasks} href="#/tasks" tone="recent" failed={!!data?.sectionErrors?.tasks}/>}
    </>}
  </aside>;
}
