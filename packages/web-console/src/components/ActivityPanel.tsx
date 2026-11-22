import {useMemo} from 'react';
import {ApiError} from '../api';
import { RiArrowRightSLine, RiCheckboxCircleLine, RiTimeLine, RiLoader4Line } from '@remixicon/react';
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

function TaskSection({title, tasks, href, tone, failed}: {title: string; tasks?: Page<Task> | null; href?: string; tone: 'running' | 'interrupted' | 'recent'; failed: boolean}) {
  const Icon = tone === 'running' ? RiLoader4Line : tone === 'interrupted' ? RiTimeLine : RiCheckboxCircleLine;
  return <section className={`rail-section rail-section-${tone}`} aria-label={title}>
    <div className="rail-section-title"><h3><Icon size={16} aria-hidden="true" />{title}</h3>{href && <a href={href} aria-label={`查看${title}任务`}>查看<RiArrowRightSLine size={15} aria-hidden="true" /></a>}</div>
    {tasks?.items.length ? <div className="rail-task-list">{tasks.items.slice(0, 5).map(task => <TaskRow key={task.taskId} task={task}/>)}</div> : <p className="rail-empty">{failed || !tasks || tasks.total > 0 ? '—' : tone === 'running' ? '暂无执行中的任务' : tone === 'interrupted' ? '暂无中断的任务' : '暂无任务'}</p>}
  </section>;
}

type ActivityData = Pick<Overview, 'tasks' | 'running' | 'interrupted' | 'sectionErrors'>;
type ActivityProps = {conversation: {kind: 'chat'|'conversations'; id?: string}; data?: ActivityData; loading: boolean; error: unknown; onRetry: () => void};
export function ActivityPanel(props: ActivityProps) {
  return props.conversation.kind === 'conversations'
    ? <ChannelActivityPanel key={props.conversation.id ?? 'unselected'} {...props}/>
    : <ActivityPanelContent {...props}/>;
}
function ChannelActivityPanel(props: ActivityProps) {
  const id=props.conversation.id;
  const query=useResource<ActivityData & {scope:{conversationId:string}}>(id ? `/conversations/${encodeURIComponent(id)}/activity` : null,5000,{pauseWhenHidden:true});
  const mismatch=query.data && query.data.scope?.conversationId!==id;
  const error=query.error ?? (mismatch ? new ApiError(503,'ACTIVITY_SCOPE_INVALID') : null);
  return <ActivityPanelContent {...props} data={!error ? query.data ?? undefined : undefined} loading={query.loading} error={error} onRetry={query.refresh}/>;
}
function ActivityPanelContent({data, loading, error, onRetry, conversation}: ActivityProps) {
  // The existing task-list UI cannot retain a channel filter. Do not link to a
  // global collection from a scoped count; individual task details stay linked.
  const allTasks=conversation.kind==='chat' ? '#/tasks' : undefined;
  const runningTasks=allTasks ? '#/tasks?state=running' : undefined;
  const interruptedTasks=allTasks ? '#/tasks?state=interrupted' : undefined;
  // An unavailable page must not become a zero.
  const incomplete = !!Object.keys(data?.sectionErrors || {}).length;
  const partialError=useMemo(()=>new ApiError(503,'OVERVIEW_PARTIAL'),[]);
  const idle = !error && !!data?.running && !!data?.interrupted
    && !data.sectionErrors?.running && !data.sectionErrors?.interrupted
    && data.running.total === 0 && data.interrupted.total === 0
    && data.running.items.length === 0 && data.interrupted.items.length === 0;
  return <aside id="activity-panel" className="activity-rail" aria-label="任务动态">
    <div className="rail-heading"><h2>工作动态</h2>{allTasks && <a href={allTasks}>全部任务<RiArrowRightSLine size={16} aria-hidden="true" /></a>}</div>
    {!!error && <Notice error={error} stale={!!data} onRetry={onRetry}/>}
    {incomplete && !error && <Notice read error={partialError} source={conversation.kind === 'conversations' ? `/conversations/${encodeURIComponent(conversation.id || '')}/activity` : '/overview'} message="部分工作动态暂不可读。" onRetry={onRetry}/>}
    <StageTimingChart kind={conversation.kind} id={conversation.id}/>
    {!data && loading ? <Loading/> : <>
      <div className="activity-counts">
        {runningTasks ? <a href={runningTasks}><span><i className="count-dot info"/>执行中</span><strong>{data?.sectionErrors?.running ? '—' : data?.running?.total ?? '—'}</strong></a> : <div><span><i className="count-dot info"/>执行中</span><strong>{data?.sectionErrors?.running ? '—' : data?.running?.total ?? '—'}</strong></div>}
        {interruptedTasks ? <a href={interruptedTasks}><span><i className="count-dot warning"/>执行中断</span><strong>{data?.sectionErrors?.interrupted ? '—' : data?.interrupted?.total ?? '—'}</strong></a> : <div><span><i className="count-dot warning"/>执行中断</span><strong>{data?.sectionErrors?.interrupted ? '—' : data?.interrupted?.total ?? '—'}</strong></div>}
      </div>
      <TaskSection title="正在执行" tasks={data?.running} href={runningTasks} tone="running" failed={!!data?.sectionErrors?.running}/>
      <TaskSection title="中断的任务" tasks={data?.interrupted} href={interruptedTasks} tone="interrupted" failed={!!data?.sectionErrors?.interrupted}/>
      {idle && <TaskSection title="最近任务" tasks={data?.tasks} href={allTasks} tone="recent" failed={!!data?.sectionErrors?.tasks}/>}
    </>}
  </aside>;
}
