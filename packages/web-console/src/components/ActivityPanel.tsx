import {useMemo} from 'react';
import {ApiError} from '../api';
import { RiArrowRightSLine, RiCheckboxCircleLine, RiLoader4Line } from '@remixicon/react';
import type { Overview, Page, Task } from '../api';
import { dateTime, useResource } from '../hooks';
import { Loading, Notice, Status } from './Shared';
import '../styles/activity-panel.css';
import { StageTimingChart } from './StageTimingChart';

function TaskRow({task}: {task: Task}) {
  const title = task.title || task.objective || '未命名任务';
  const updated = task.updatedAt || task.createdAt;
  return <a className="rail-task" href={`#/tasks/${encodeURIComponent(task.taskId)}`} title={title}>
    <div className="rail-task-copy"><strong>{title}</strong><div className="rail-task-meta"><Status value={task.state} /><time title={dateTime(updated, false, true)}>{dateTime(updated)}</time></div></div>
    <RiArrowRightSLine className="rail-task-arrow" size={16} aria-hidden="true" />
  </a>;
}

function TaskSection({title, tasks, tone, failed}: {title: string; tasks?: Page<Task> | null; tone: 'running' | 'recent'; failed: boolean}) {
  const Icon = tone === 'running' ? RiLoader4Line : RiCheckboxCircleLine;
  return <section className={`rail-section rail-section-${tone}`} aria-label={title}>
    <div className="rail-section-title"><h3><Icon size={16} aria-hidden="true" />{title}</h3></div>
    {tasks?.items.length ? <div className="rail-task-list">{tasks.items.slice(0, 5).map(task => <TaskRow key={task.taskId} task={task}/>)}</div> : <p className="rail-empty">{failed || !tasks || tasks.total > 0 ? '—' : tone === 'running' ? '暂无执行中的任务' : '暂无任务'}</p>}
  </section>;
}

type ActivityData = Pick<Overview, 'tasks' | 'running' | 'interrupted' | 'sectionErrors'>;
type ConversationTarget = {kind:'chat'|'conversations';id:string};
export function ActivityPanel({conversation}: {conversation:ConversationTarget}) {
  const {kind,id}=conversation,path=`/${kind}/${encodeURIComponent(id)}/activity`;
  const query=useResource<ActivityData & {scope:{conversationId:string;chatId?:string}}>(path,5000,{pauseWhenHidden:true});
  const mismatch=query.data && (kind==='chat'?query.data.scope?.chatId:query.data.scope?.conversationId)!==id;
  const error=query.error ?? (mismatch ? new ApiError(503,'ACTIVITY_SCOPE_INVALID') : null);
  const data=!error?query.data??undefined:undefined,loading=query.loading,onRetry=query.refresh;
  // The existing task-list UI cannot retain a channel filter. Do not link to a
  // global collection from a scoped activity panel; individual task details stay linked.
  const partialError=useMemo(()=>new ApiError(503,'OVERVIEW_PARTIAL'),[]);
  // Preserve the recent-task fallback: both pages must confirm no current work.
  const idle = !error && !!data?.running && !!data?.interrupted
    && !data.sectionErrors?.running && !data.sectionErrors?.interrupted
    && data.running.total === 0 && data.interrupted.total === 0
    && data.running.items.length === 0 && data.interrupted.items.length === 0;
  // Hidden sections must not contribute a page-level read error.
  const incomplete = !!data?.sectionErrors?.running || (idle && !!data?.sectionErrors?.tasks);
  return <aside id="activity-panel" className="activity-rail" aria-label="任务动态">
    <div className="rail-heading"><h2>工作动态</h2></div>
    {!!error && <Notice error={error} stale={!!data} onRetry={onRetry}/>}
    {incomplete && !error && <Notice read error={partialError} source={path} message="部分工作动态暂不可读。" onRetry={onRetry}/>}
    <StageTimingChart kind={conversation.kind} id={conversation.id}/>
    {!data && loading ? <Loading/> : <>
      <TaskSection title="正在执行" tasks={data?.running} tone="running" failed={!!data?.sectionErrors?.running}/>
      {idle && <TaskSection title="最近任务" tasks={data?.tasks} tone="recent" failed={!!data?.sectionErrors?.tasks}/>}
    </>}
  </aside>;
}
