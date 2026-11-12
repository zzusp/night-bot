import { useEffect, useState } from 'react';
import { RiRefreshLine } from '@remixicon/react';
import { ApiError, type Page, type ScheduledTask, type ScheduleState } from './api';
import { dateTime, navigate, useResource } from './hooks';
import { Button, EmptyState } from './components/BoardPrimitives';
import { Loading, Notice, Pagination } from './components/Shared';
import './styles/schedules.css';

const states: { value: ScheduleState; label: string; empty: string }[] = [
  { value: 'active', label: '启用', empty: '暂无启用的定时任务' },
  { value: 'inactive', label: '停用', empty: '暂无停用的定时任务' },
];

export default function SchedulesPage({ route }: { route: URL }) {
  const selected = states.find(item => item.value === route.searchParams.get('state')) || states[0];
  const requestedOffset = Number(route.searchParams.get('offset'));
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset / 20) * 20 : 0;
  const path = `/schedules?state=${selected.value}&offset=${offset}&limit=20`;
  const query = useResource<Page<ScheduledTask> & { offset: number }>(path, 10000, { pauseWhenHidden: true });
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (query.data && !query.error) setDenied(false); }, [query.updatedAt]);
  const data = forbidden || denied ? null : query.data;
  const changePage = (next: number) => navigate(`/schedules?state=${selected.value}&offset=${next}`);
  // The source may shrink between reads. Keep the restored URL on a real page.
  useEffect(() => {
    if (data && data.offset !== offset) changePage(data.offset);
  }, [data?.offset, offset, selected.value]);

  return <div className="page-content schedules-page">
    <div className="list-toolbar">
      <nav className="filter-tabs" aria-label="定时任务状态">{states.map(item =>
        <a key={item.value} href={`#/schedules?state=${item.value}`} aria-current={selected.value === item.value ? 'page' : undefined}>{item.label}</a>)}</nav>
      <Button variant="secondary" icon={<RiRefreshLine size={16} />} busy={query.loading} disabled={query.loading} onClick={query.refresh}>刷新任务</Button>
    </div>
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}
    <section className="schedule-results" aria-label={`${selected.label}的定时任务`} aria-busy={query.loading}>
      {!data ? query.loading ? <Loading>正在读取定时任务…</Loading> : <EmptyState title="定时任务暂不可读" /> : !data.items.length ?
        <EmptyState title={selected.empty} /> :
        <ul className="schedule-list">{data.items.map(task => <li className="schedule-row" key={task.id}>
          <span className="schedule-title">{task.title || '未命名定时任务'}</span>
          <span className="schedule-meta">{states.find(item => item.value === task.state)?.label || '状态未记录'}<span aria-hidden="true"> · </span><span className="sr-only">，</span>{task.scheduleSummary}{task.kind === 'at' && <> · <time dateTime={task.scheduledAt}>{dateTime(task.scheduledAt, false, true)}</time></>}</span>
        </li>)}</ul>}
    </section>
    {data && <Pagination offset={data.offset} total={data.total} nextOffset={data.nextOffset} onPage={changePage} loading={query.loading} />}
  </div>;
}
