import { useEffect, useRef, useState } from 'react';
import { RiArrowRightLine, RiCheckboxCircleLine, RiTimeLine, RiPulseLine } from '@remixicon/react';
import { ApiError, type Page, type Task } from './api';
import { dateTime, navigate, textOf, useResource, useRoute } from './hooks';
import { Button, EmptyState } from './components/BoardPrimitives';
import { Loading, Markdown, Notice, Pagination, Search, Status } from './components/Shared';
import { ConversationFrame } from './components/ConversationFrame';
import { ExecutionHistory } from './components/ExecutionHistory';
import { LearningChanges } from './components/LearningChanges';
import { taskDurationText } from './task-duration';
import { TaskExecutionDetails } from './components/TaskExecutionDetails';

export function TaskList({ route }: { route: URL }) {
  const state = route.searchParams.get('state') || '';
  const offset = Math.max(0, Number(route.searchParams.get('offset')) || 0);
  const [search, setSearch] = useState(route.searchParams.get('q') || '');
  const query = useResource<Page<Task>>(`/tasks?offset=${offset}&limit=20${state ? `&state=${encodeURIComponent(state)}` : ''}`, 5000);
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
    <div className="list-toolbar"><nav className="filter-tabs" aria-label="任务状态">{[['', '全部'], ['running', '执行中'], ['queued', '排队中'], ['waiting', '等待中'], ['completed', '已结束']].map(([value, label]) =>
      <a key={value} href={`#/tasks${value ? `?state=${value}` : ''}`} aria-current={state === value ? 'page' : undefined}>{label}</a>)}</nav>
      <Search value={search} onChange={value => { setSearch(value); const url = new URL(route); value ? url.searchParams.set('q', value) : url.searchParams.delete('q'); history.replaceState(null, '', '#' + url.pathname + url.search); }} />
    </div>
    {query.error && <Notice error={query.error} stale={!!query.data} onRetry={query.refresh} />}
    <div className="task-table-wrap">{!query.data && query.loading ? <Loading /> : !query.data && query.error ? <EmptyState title="任务列表暂不可读" /> : !items.length ? <EmptyState title={search ? '这一页没有匹配的任务' : '暂无任务'} action={search ? <Button variant="secondary" onClick={() => { setSearch(''); navigate(`/tasks?state=${state}&offset=${offset}`); }}>清除筛选</Button> : <a className="text-link" href="#/chat">与 Bot 对话 <RiArrowRightLine size={16} /></a>} /> :
      <table className="task-table"><caption className="sr-only">任务与最近进度</caption><thead><tr><th scope="col">任务</th><th scope="col" className="task-status">状态</th><th scope="col" className="task-duration">总时长</th><th scope="col" className="task-duration">执行时长</th><th scope="col" className="task-updated">最近更新</th><th scope="col" className="task-action"><span className="sr-only">查看</span></th></tr></thead>
        <tbody>{items.map(task => <tr key={task.taskId}><td><div className="task-name"><span className={`task-glyph ${task.state}`} aria-hidden="true">{task.state === 'completed' ? <RiCheckboxCircleLine size={19} /> : task.state === 'running' ? <RiPulseLine size={19} /> : <RiTimeLine size={19} />}</span><div><a href={`#/tasks/${encodeURIComponent(task.taskId)}`}>{task.title || task.objective || '未命名任务'}</a>{(task.objective && task.objective !== task.title || textOf(task.result)) && <p>{task.objective && task.objective !== task.title ? task.objective : textOf(task.result)}</p>}</div></div></td><td className="task-status"><Status value={task.state} /></td><td className="task-duration">{taskDurationText(task.durations?.total, task.durations?.observedAt, elapsed)}</td><td className="task-duration">{taskDurationText(task.durations?.execution, task.durations?.observedAt, elapsed)}</td><td className="task-updated"><time dateTime={task.updatedAt}>{dateTime(task.updatedAt || task.createdAt)}</time></td><td className="task-action"><a className="row-link" aria-label={`查看任务：${task.title || '未命名任务'}`} href={`#/tasks/${encodeURIComponent(task.taskId)}`}><RiArrowRightLine size={18} /></a></td></tr>)}</tbody></table>}
    </div>
    {query.data && <Pagination offset={offset} total={query.data.total} nextOffset={query.data.nextOffset} onPage={changePage} loading={query.loading} />}
  </div>;
}

export function TaskDetail({ id }: { id: string }) {
  const query = useResource<Task>(`/tasks/${encodeURIComponent(id)}`, 4000);
  const route = useRoute();
  const view = route.searchParams.get('view');
  const tab = view === 'execution' || view === 'review' || view === 'learning' ? view : 'task';
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  const [recordControls, setRecordControls] = useState<HTMLDivElement | null>(null);
  const infoContent = useRef<HTMLDivElement>(null);
  useEffect(() => { if (infoContent.current) infoContent.current.scrollTop = 0; }, [tab]);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (!query.error) setDenied(false); }, [query.updatedAt]);
  const task = forbidden || denied ? undefined : query.data;
  const sections = [['task', '任务'], ['execution', '执行'], ['review', '复盘'], ['learning', '学习']];
  return <div className="task-workspace">
    <ConversationFrame label="任务执行记录">
      {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!task} />}
      {!task ? query.loading ? <Loading>正在读取任务…</Loading> : <EmptyState title="无法读取任务" /> :
        <div className="task-dialogue"><ExecutionHistory key={id} endpoint={`/tasks/${encodeURIComponent(id)}/session`} status={task.session?.status} controlsTarget={recordControls} /></div>}
    </ConversationFrame>
    <aside className="task-info-rail" aria-label="任务详情">
      <nav className="filter-tabs task-info-nav" aria-label="任务信息分类">{sections.map(([value, label]) => <a key={value} href={`#/tasks/${encodeURIComponent(id)}${value === 'task' ? '' : `?view=${value}`}`} aria-current={tab === value ? 'page' : undefined}>{label}</a>)}</nav>
      <div className="task-info-content" ref={infoContent}>
        <section className="task-execution-overview" hidden={tab !== 'execution'} aria-label="执行状态">
          {task && <dl className="task-execution-states"><div><dt>执行会话</dt><dd><Status value={task.session?.status} /></dd></div><div><dt>任务控制</dt><dd><Status value={task.controlState} /></dd></div></dl>}
          <div className="task-record-controls" ref={setRecordControls} />
        </section>
        <div key={tab}>
        {!task ? <p className="muted">{query.loading ? '正在读取任务信息…' : '任务信息暂不可读。'}</p> : tab === 'review' || tab === 'learning' ? <LearningChanges key={id} taskId={id} section={tab === 'review' ? 'reviews' : 'changes'} /> : tab === 'task' ? <>
          <section className="detail-section"><h2 className="task-info-title">{task.title || '未命名任务'}</h2><dl className="task-facts"><div><dt>当前状态</dt><dd><Status value={task.state} /></dd></div><div><dt>最近更新</dt><dd><time dateTime={task.updatedAt}>{dateTime(task.updatedAt)}</time></dd></div><div><dt>创建时间</dt><dd><time dateTime={task.createdAt}>{dateTime(task.createdAt)}</time></dd></div></dl></section>
          <section className="detail-section"><h3>任务目标</h3>{task.objective ? <Markdown text={task.objective} /> : <p>未记录任务目标。</p>}</section>
          <section className="detail-section"><h3>处理结果</h3>{textOf(task.result) ? <Markdown text={textOf(task.result)} /> : <p>尚无已记录的处理结果。</p>}</section>
          <section className="detail-section blockers"><h3>等待处理</h3>{task.blockers?.length ? task.blockers.map(blocker => <p key={blocker.kind + ':' + blocker.id}>{blocker.title} {blocker.status && <Status value={blocker.status} />}</p>) : <p>暂无已记录的阻断项。</p>}</section>
        </> : <TaskExecutionDetails task={task} />}
        </div>
      </div>
    </aside>
  </div>;
}
