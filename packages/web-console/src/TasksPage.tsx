import { useEffect, useState } from 'react';
import { RiArrowLeftLine, RiArrowRightLine, RiCheckboxCircleLine, RiTimeLine, RiPulseLine, RiMoreLine } from '@remixicon/react';
import { type Page, type Task } from './api';
import { dateTime, navigate, textOf, useResource, useRoute } from './hooks';
import { Badge, Button, EmptyState } from './components/BoardPrimitives';
import { Loading, Markdown, Notice, Pagination, Search, Status } from './components/Shared';
import { ExecutionHistory } from './components/ExecutionHistory';
import { LearningChanges } from './components/LearningChanges';

export function TaskList({ route }: { route: URL }) {
  const state = route.searchParams.get('state') || '';
  const offset = Math.max(0, Number(route.searchParams.get('offset')) || 0);
  const [search, setSearch] = useState(route.searchParams.get('q') || '');
  const query = useResource<Page<Task>>(`/tasks?offset=${offset}&limit=20${state ? `&state=${encodeURIComponent(state)}` : ''}`, 5000);
  useEffect(() => setSearch(route.searchParams.get('q') || ''), [route.href]);
  const changePage = (next: number) => navigate(`/tasks?state=${encodeURIComponent(state)}&offset=${next}${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  const items = (query.data?.items || []).filter(task => `${task.title || ''} ${task.objective || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="page-content tasks-page">
    <div className="page-heading"><div><h2>任务</h2></div><Badge tone="neutral">{query.data ? `${query.data.total} 项任务` : '任务记录'}</Badge></div>
    <div className="list-toolbar"><nav className="filter-tabs" aria-label="任务状态">{[['', '全部'], ['running', '执行中'], ['queued', '排队中'], ['waiting', '等待中'], ['completed', '已结束']].map(([value, label]) =>
      <a key={value} href={`#/tasks${value ? `?state=${value}` : ''}`} aria-current={state === value ? 'page' : undefined}>{label}</a>)}</nav>
      <Search value={search} onChange={value => { setSearch(value); const url = new URL(route); value ? url.searchParams.set('q', value) : url.searchParams.delete('q'); history.replaceState(null, '', '#' + url.pathname + url.search); }} />
    </div>
    {query.error && <Notice error={query.error} stale={!!query.data} onRetry={query.refresh} />}
    <div className="task-table-wrap">{!query.data && query.loading ? <Loading /> : !query.data && query.error ? <EmptyState title="任务列表暂不可读" description="使用上方按钮重新获取。" /> : !items.length ? <EmptyState title={search ? '这一页没有匹配的任务' : '这里还没有任务'} description={search ? '试试其他关键词，或清除筛选查看这一页。' : '通过对话安排工作后，任务和进度会出现在这里。'} action={search ? <Button variant="secondary" onClick={() => { setSearch(''); navigate(`/tasks?state=${state}&offset=${offset}`); }}>清除筛选</Button> : <a className="text-link" href="#/chat">与 Bot 对话 <RiArrowRightLine size={16} /></a>} /> :
      <table className="task-table"><caption className="sr-only">任务与最近进度</caption><thead><tr><th scope="col">任务</th><th scope="col">状态</th><th scope="col">最近更新</th><th scope="col"><span className="sr-only">查看</span></th></tr></thead>
        <tbody>{items.map(task => <tr key={task.taskId}><td><div className="task-name"><span className={`task-glyph ${task.state}`} aria-hidden="true">{task.state === 'completed' ? <RiCheckboxCircleLine size={19} /> : task.state === 'running' ? <RiPulseLine size={19} /> : <RiTimeLine size={19} />}</span><div><a href={`#/tasks/${encodeURIComponent(task.taskId)}`}>{task.title || task.objective || '未命名任务'}</a><p>{task.objective && task.objective !== task.title ? task.objective : textOf(task.result) || '查看执行过程与处理结果'}</p></div></div></td><td><Status value={task.state} /></td><td><time dateTime={task.updatedAt}>{dateTime(task.updatedAt || task.createdAt)}</time></td><td><a className="row-link" aria-label={`查看任务：${task.title || '未命名任务'}`} href={`#/tasks/${encodeURIComponent(task.taskId)}`}><RiArrowRightLine size={18} /></a></td></tr>)}</tbody></table>}
    </div>
    {query.data && <Pagination offset={offset} total={query.data.total} nextOffset={query.data.nextOffset} onPage={changePage} loading={query.loading} />}
  </div>;
}

export function TaskDetail({ id }: { id: string }) {
  const query = useResource<Task>(`/tasks/${encodeURIComponent(id)}`, 4000);
  const route = useRoute();
  const view = route.searchParams.get('view');
  const tab = view === 'execution' ? 'dialogue' : view === 'learning' ? 'learning' : 'overview';
  const setTab = (next: 'overview' | 'dialogue' | 'learning') => navigate(`/tasks/${encodeURIComponent(id)}${next === 'overview' ? '' : `?view=${next === 'dialogue' ? 'execution' : 'learning'}`}`);
  const task = query.data;
  const raw = task?.timeline;
  const timeline = [...(raw?.task?.events || []), ...(raw?.human?.segments || []), ...(raw?.executions || []).flatMap(track => track.milestones || [])].sort((a, b) => String(a.at || a.startedAt || '').localeCompare(String(b.at || b.startedAt || '')));
  const eventLabels: Record<string, string> = { created: '任务已创建', completed: '任务已完成', reopened: '任务已重新打开', cancelled: '任务已取消' };
  return <div className="page-content detail-page"><a className="back-link" href="#/tasks"><RiArrowLeftLine size={16} />全部任务</a>
    {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!task} />}
    {!task ? query.loading ? <Loading /> : <EmptyState title="无法读取任务" description="请刷新，或返回任务列表选择其他任务。" /> : <>
      <div className="detail-heading"><div><span className="eyebrow">任务详情</span><h2>{task.title || '未命名任务'}</h2></div><Status value={task.state} /></div>
      <div className="detail-meta"><span>创建于 {dateTime(task.createdAt)}</span><span>更新于 {dateTime(task.updatedAt)}</span>{task.session && <span>执行会话 <Status value={task.session.status} /></span>}</div>
      {task.objective && <div className="task-objective"><Markdown text={task.objective} /></div>}
      <div className="filter-tabs detail-tabs" role="group" aria-label="任务详情视图"><button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>执行信息</button><button type="button" aria-pressed={tab === 'dialogue'} onClick={() => setTab('dialogue')}>执行记录</button><button type="button" aria-pressed={tab === 'learning'} onClick={() => setTab('learning')}>复盘与学习</button></div>
      {tab === 'learning' ? <LearningChanges key={id} taskId={id} /> : tab === 'dialogue' ? <div className="task-dialogue"><ExecutionHistory key={id} endpoint={`/tasks/${encodeURIComponent(id)}/session`} status={task.session?.status} /></div> :
      <div className="detail-columns"><div className="detail-main">
        {textOf(task.result) && <section className="detail-section"><h3><RiCheckboxCircleLine size={18} />处理结果</h3><Markdown text={textOf(task.result)} /></section>}
        <section className="detail-section"><h3><RiPulseLine size={18} />执行动态</h3>{timeline.length ? <ol className="timeline">{timeline.map((event, index) => <li key={String(event.id || index)}><span className="timeline-dot" /><div><strong>{event.summary || event.label || eventLabels[event.kind || ''] || event.description || event.kind || '状态更新'}</strong>{event.at || event.startedAt ? <time>{dateTime(event.at || event.startedAt)}</time> : null}{event.status && <Status value={event.status} />}</div></li>)}</ol> : <p className="muted">暂时没有执行动态，任务推进后会自动更新。</p>}</section>
      </div><aside className="detail-aside"><section className="detail-section"><h3>执行会话</h3><p>每项任务由一个独立会话执行。</p><dl><dt>当前状态</dt><dd><Status value={task.session?.status} /></dd><dt>控制状态</dt><dd><Status value={task.controlState} /></dd></dl></section>
        {task.blockers?.length ? <section className="detail-section blockers"><h3>等待处理</h3>{task.blockers.map(blocker => <p key={blocker.kind + ':' + blocker.id}>{blocker.title} {blocker.status && <Status value={blocker.status} />}</p>)}</section> : null}
        {task.notifications?.length ? <section className="detail-section"><h3>交付记录</h3>{task.notifications.map((item, index) => <div className="delivery-row" key={String(item.id || index)}><RiMoreLine size={16} /><span>{textOf(item) || '结果通知'}</span><Status value={String(item.state || item.status || 'unknown')} /></div>)}</section> : null}
      </aside></div>}
    </>}</div>;
}
