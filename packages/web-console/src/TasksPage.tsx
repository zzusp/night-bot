import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RiArrowRightLine, RiCheckboxCircleLine, RiTimeLine, RiPulseLine, RiLayoutRightLine } from '@remixicon/react';
import { ApiError, type Page, type Task } from './api';
import { dateTime, navigate, textOf, useResource } from './hooks';
import { Badge, Button, EmptyState, IconButton } from './components/BoardPrimitives';
import { Loading, Notice, Pagination, Search } from './components/Shared';
import { ConversationFrame } from './components/ConversationFrame';
import { ExecutionHistory } from './components/ExecutionHistory';
import { ExecutionSearchToolbar } from './components/ExecutionSearch';
import { TaskLearningSummary } from './components/TaskLearningSummary';
import { taskDurationText } from './task-duration';
import { taskConclusion, taskConclusionDuration } from './task-conclusion';
import { ContextWindow, type ContextWindowSnapshot } from './components/ContextWindow';
import { TaskOverview } from './components/TaskOverview';
import { TASK_SIDEBAR_REFRESH_MS } from './task-sidebar-refresh';
import { TaskInputComposer } from './components/TaskInputComposer';
import type {TaskInputDrafts} from './task-input-drafts';

const taskListStates = {
  'not-running': {label: '未在执行', tone: 'neutral'},
  running: {label: '执行中', tone: 'info'},
  completed: {label: '已完成', tone: 'success'},
  cancelled: {label: '已取消', tone: 'neutral'},
} as const;
const taskListFilters = [['', '全部'], ...Object.entries(taskListStates).map(([state, {label}]) => [state, label])];

export function TaskList({ route }: { route: URL }) {
  const requestedState = route.searchParams.get('state') || '';
  const state = requestedState === 'queued' ? 'not-running' : Object.hasOwn(taskListStates, requestedState) ? requestedState : '';
  const offset = Math.max(0, Number(route.searchParams.get('offset')) || 0);
  const [search, setSearch] = useState(route.searchParams.get('q') || '');
  const query = useResource<Page<Task>>(`/tasks?offset=${offset}&limit=10${state ? `&state=${encodeURIComponent(state)}` : ''}`, 5000);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (query.error) return;
    setElapsed(0);
    if (!query.data?.items.some(task => task.durations?.total.activeSince || task.durations?.execution.activeSince)) return;
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - start), 1000);
    return () => window.clearInterval(timer);
  }, [query.data, query.error]);
  useEffect(() => setSearch(route.searchParams.get('q') || ''), [route.href]);
  const changePage = (next: number) => navigate(`/tasks?state=${encodeURIComponent(state)}&offset=${next}${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  const items = (query.data?.items || []).filter(task => `${task.title || ''} ${task.objective || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="page-content tasks-page">
    <div className="list-toolbar"><nav className="filter-tabs" aria-label="任务状态">{taskListFilters.map(([value, label]) =>
      <a key={value} href={`#/tasks${value ? `?state=${value}` : ''}`} aria-current={state === value ? 'page' : undefined}>{label}</a>)}</nav>
      <Search value={search} onChange={value => { setSearch(value); const url = new URL(route); value ? url.searchParams.set('q', value) : url.searchParams.delete('q'); history.replaceState(null, '', '#' + url.pathname + url.search); }} />
    </div>
    {query.error && <Notice error={query.error} stale={!!query.data} onRetry={query.refresh} />}
    <div className="task-table-wrap" tabIndex={0} role="region" aria-label="任务列表，可横向滚动">{!query.data && query.loading ? <Loading /> : !query.data && query.error ? null : !items.length ? <EmptyState title={search ? '这一页没有匹配的任务' : '暂无任务'} action={search ? <Button variant="secondary" onClick={() => { setSearch(''); navigate(`/tasks?state=${state}&offset=${offset}`); }}>清除筛选</Button> : <a className="text-link" href="#/chat">与 Bot 对话 <RiArrowRightLine size={16} /></a>} /> :
      <table className="task-table"><caption className="sr-only">任务与最近进度</caption><thead><tr><th scope="col">任务</th><th scope="col" className="task-status">状态</th><th scope="col" className="task-duration">总时长</th><th scope="col" className="task-duration">执行时长</th><th scope="col" className="task-updated">最近更新</th><th scope="col" className="task-action"><span className="sr-only">查看</span></th></tr></thead>
        <tbody>{items.map(task => {
          const state = task.state === 'running' || task.state === 'completed' || task.state === 'cancelled' ? task.state : 'not-running';
          const {label, tone} = taskListStates[state];
          return <tr key={task.taskId}><td><div className="task-name"><span className={`task-glyph ${state}`} aria-hidden="true">{state === 'completed' ? <RiCheckboxCircleLine size={19} /> : state === 'running' ? <RiPulseLine size={19} /> : <RiTimeLine size={19} />}</span><div><a href={`#/tasks/${encodeURIComponent(task.taskId)}`}>{task.title || task.objective || '未命名任务'}</a>{(task.objective && task.objective !== task.title || textOf(task.result)) && <p>{task.objective && task.objective !== task.title ? task.objective : textOf(task.result)}</p>}</div></div></td><td className="task-status"><Badge tone={tone}>{label}</Badge></td><td className="task-duration">{taskDurationText(task.durations?.total, task.durations?.observedAt, elapsed)}</td><td className="task-duration">{taskDurationText(task.durations?.execution, task.durations?.observedAt, elapsed)}</td><td className="task-updated"><time dateTime={task.updatedAt}>{dateTime(task.updatedAt || task.createdAt)}</time></td><td className="task-action"><a className="row-link" aria-label={`查看任务：${task.title || '未命名任务'}`} href={`#/tasks/${encodeURIComponent(task.taskId)}`}><RiArrowRightLine size={18} /></a></td></tr>;
        })}</tbody></table>}
    </div>
    {query.data && <Pagination offset={offset} total={query.data.total} pageSize={10} nextOffset={query.data.nextOffset} onPage={changePage} loading={query.loading} />}
  </div>;
}

export function TaskDetail({ id, header, drafts }: { id: string; header?: ReactNode; drafts: TaskInputDrafts }) {
  const query = useResource<Task>(`/tasks/${encodeURIComponent(id)}`, TASK_SIDEBAR_REFRESH_MS, {pauseWhenHidden:true,quiet:true});
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  const [tokenTarget, setTokenTarget] = useState<HTMLDivElement | null>(null);
  const [searchToolbar, setSearchToolbar] = useState<HTMLDivElement | null>(null);
  const [rail, setRail] = useState(true);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (!query.error) setDenied(false); }, [query.updatedAt]);
  const task = forbidden || denied ? undefined : query.data;
  const context = useResource<ContextWindowSnapshot>(rail && task && !query.error
    ? `/tasks/${encodeURIComponent(id)}/context-window` : null, task?.state === 'running' ? TASK_SIDEBAR_REFRESH_MS : 0, {pauseWhenHidden:true,quiet:true,refreshKey:task?.session?.sessionId});
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.get(id));
  const accepted = useRef(draft.accepted);
  useEffect(() => {
    if (draft.accepted && draft.accepted !== accepted.current) query.refresh();
    accepted.current = draft.accepted;
  }, [draft.accepted, query.refresh]);
  const writableSession = !query.error && task?.taskId === id && task.session?.sessionId
    && (!task.session.role || task.session.role === 'execution') && !task.archivedAt && !['archived', 'cancelled', 'paused'].includes(task.state)
    && (!task.controlState || ['active', 'completed'].includes(task.controlState)) ? task.session.sessionId : undefined;
  return <div className={`task-workspace${rail ? '' : ' task-rail-hidden'}`}>
    <ConversationFrame label="任务执行记录">
      {header}
      <div className="conversation-tools task-panel-tools"><div className="topbar-actions"><div className="conversation-search-slot" ref={setSearchToolbar}/><IconButton label={rail ? '隐藏任务面板' : '显示任务面板'} aria-expanded={rail} aria-controls="task-info-panel" onClick={() => setRail(value => !value)}><RiLayoutRightLine size={18} /></IconButton></div></div>
      {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!task} />}
      {!task ? query.loading ? <Loading>正在读取任务…</Loading> : query.error ? null : <EmptyState title="无法读取任务" /> :
        <div className="task-dialogue"><ExecutionSearchToolbar.Provider value={searchToolbar}><ExecutionHistory key={id} endpoint={`/tasks/${encodeURIComponent(id)}/session`} status={task.session?.status} taskTitle={task.title} taskState={task.state} controlsTarget={null} tokenTarget={tokenTarget} taskError={query.error} taskRetry={query.refresh} conclusion={!query.error ? taskConclusion(task) : null} conclusionDuration={taskConclusionDuration(task)} refreshAfterInput={draft.accepted}
          inputPreviews={!query.error && task.session?.sessionId ? [
            ...(draft.previews ?? []).filter(value => value.sessionId === task.session?.sessionId),
            ...(draft.attempt?.sessionId === task.session?.sessionId && draft.attempt ? [{
              requestId: draft.attempt.requestId, text: draft.attempt.text, createdAt: draft.attempt.createdAt,
              status: draft.attempt.state === 'sending' ? 'sending' : 'unknown',
              attachments: draft.attempt.files.map(file => ({name: file.name, mediaType: file.type, bytes: file.size})),
            }] : []),
          ].map(value => ({...value, id: `web-input:${value.requestId}`, role: 'user' as const, kind: 'local-task-input', text: value.text.trim() ? value.text : '[附件]'})) : []}
          onInputsRecorded={requestIds => drafts.update(id, previous => {
            const previews = previous.previews?.filter(value => !requestIds.has(value.requestId));
            return previews?.length === previous.previews?.length ? previous : {...previous, previews};
          })} /></ExecutionSearchToolbar.Provider>
          <TaskInputComposer taskId={id} sessionId={writableSession} draft={draft} drafts={drafts} />
        </div>}
    </ConversationFrame>
    <aside id="task-info-panel" hidden={!rail} className="task-info-rail" aria-label="任务详情">
      <div className="task-info-content" tabIndex={0} aria-label="任务信息卡片">
        {!task ? <p className="muted">{query.loading ? '正在读取任务信息…' : '任务信息暂不可读。'}</p> : <><TaskOverview task={task} /><ContextWindow task snapshot={context.error ? undefined : context.data ?? undefined} loading={context.loading} /><div ref={setTokenTarget} />{rail && <TaskLearningSummary key={id} taskId={id} state={task.state} />}</>}
      </div>
    </aside>
  </div>;
}
