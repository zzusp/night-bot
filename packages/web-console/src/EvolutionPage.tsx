import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import EvolutionContent from './EvolutionContent';
import EvolutionEntryList, { formatEvolutionCount as number, isEvolutionCount } from './components/EvolutionEntryList';
import { RiBookOpenLine, RiBrainLine, RiRefreshLine } from '@remixicon/react';
import { ApiError, EVOLUTION_SNAPSHOT_TIMEOUT_MS, type Evolution, type EvolutionItem, type EvolutionReady } from './api';
import { dateTime, navigate, useResource } from './hooks';
import { Button, EmptyState } from './components/BoardPrimitives';
import { Loading, Notice, Pagination } from './components/Shared';
import './styles/evolution.css';

type Summary = Pick<EvolutionReady, 'memory' | 'skills' | 'cache' | 'usageCoverage'>;

export function EvolutionListActions({ cache, sessionsRead, loading, onRefresh }: { cache: EvolutionReady['cache']; sessionsRead?: number; loading: boolean; onRefresh: () => void }) {
  const updated = cache ? cache.stale ? `旧快照 · ${dateTime(cache.updatedAt ?? undefined)} · ${cache.refreshing ? '统计更新中' : '统计刷新失败'}` : `最近更新 ${dateTime(cache.updatedAt ?? undefined)}` : null;
  const coverage = isEvolutionCount(sessionsRead) ? `已统计 ${number(sessionsRead)} 个会话` : cache ? '统计会话数未记录' : null;
  const status = [updated, coverage].filter(Boolean).join(' · ');
  return <div className="evolution-list-actions">
    {status && <p className="evolution-list-updated" data-stale={cache?.stale || undefined} role="status">{status}</p>}
    <Button variant="ghost" icon={<RiRefreshLine size={16} />} busy={loading} disabled={loading} onClick={onRefresh}>刷新记录</Button>
  </div>;
}

export function UsageSummary({ data }: { data: Summary }) {
  return <div className="evolution-summary">
    <section className="evolution-card" aria-labelledby="memory-summary">
      <header><RiBrainLine size={20} aria-hidden="true" /><h2 id="memory-summary">记忆</h2></header>
      <dl className="evolution-metrics"><div><dt>已应用</dt><dd>{number(data.memory.acceptedCount)}</dd></div><div><dt>读取次数</dt><dd>{number(data.memory.readCount)}</dd></div><div><dt>今日更新</dt><dd>{number(data.memory.todayUpdatedCount)}</dd></div><div><dt>搜索次数</dt><dd>{number(data.memory.searchCount)}</dd></div></dl>
    </section>
    <section className="evolution-card" aria-labelledby="skill-summary">
      <header><RiBookOpenLine size={20} aria-hidden="true" /><h2 id="skill-summary">Skills</h2></header>
      <dl className="evolution-metrics"><div><dt>目录技能</dt><dd>{number(data.skills.installedCount)}</dd></div><div><dt>模型 Skill 调用</dt><dd>{number(data.skills.modelUseCount)}</dd></div><div><dt>今日更新</dt><dd>{number(data.skills.todayUpdatedCount)}</dd></div><div><dt>技能文件读取</dt><dd>{number(data.skills.fileReadCount)}</dd></div></dl>
    </section>
  </div>;
}

export default function EvolutionPage({ route }: { route: URL }) {
  const [selection, setSelection] = useState<{item: EvolutionItem; route: string} | null>(null);
  useEffect(() => { setSelection(null); }, [route.search]);
  const opener = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const closeContent = () => { restoreFocus.current = true; setSelection(null); };
  useLayoutEffect(() => { if (!selection && restoreFocus.current) { restoreFocus.current = false; opener.current?.focus(); } }, [selection]);
  // Old unfiltered links open the memory tab; the API remains backwards compatible.
  const kind = route.searchParams.get('kind') === 'skill' ? 'skill' : 'memory';
  const requestedOffset = Number(route.searchParams.get('offset'));
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  const path = `/evolution?kind=${kind}&offset=${offset}&limit=10`;
  const query = useResource<Evolution>(path, 300000, {pauseWhenHidden: true, refreshPath: path + '&refresh=1', timeoutMs: EVOLUTION_SNAPSHOT_TIMEOUT_MS});
  const forbidden = query.error instanceof ApiError && [401, 403].includes(query.error.status);
  const busy = query.error instanceof ApiError && query.error.code === 'EVOLUTION_BUSY';
  const [revoked, setRevoked] = useState(false);
  useEffect(() => {
    if (forbidden) setRevoked(true);
    else if (query.data && !query.error && !query.loading) setRevoked(false);
  }, [forbidden, query.data, query.error, query.loading]);
  // Revoked snapshots stay hidden throughout retry, until a fresh read succeeds.
  const data = forbidden || revoked ? null : query.data;
  const ready = data?.status === 'ready' ? data : null;
  const [lastSummary, setLastSummary] = useState<Summary | null>(null);
  useEffect(() => {
    if (forbidden || revoked || query.data?.status === 'unavailable') setLastSummary(null);
    else if (ready) setLastSummary({ memory: ready.memory, skills: ready.skills, cache: ready.cache, usageCoverage: ready.usageCoverage });
  }, [forbidden, revoked, query.data?.status, ready]);
  // Summaries are Bot-wide, so category/page reads must not remove their cards.
  // Permission loss and explicit unavailability still hide the cached values.
  const summary = forbidden || revoked || query.data?.status === 'unavailable' ? null : ready ?? lastSummary;
  const changePage = (next: number) => navigate(`/evolution?kind=${kind}&offset=${next}`);
  useEffect(() => {
    if (ready && !query.loading && !query.error && offset > 0 && offset >= ready.total) {
      navigate(`/evolution?kind=${kind}&offset=${Math.max(0, Math.floor((ready.total - 1) / 10) * 10)}`);
    }
  }, [ready, query.loading, query.error, offset, kind]);
  const selected = selection?.route === route.search && ready?.items.find(item => item.id === selection.item.id && item.kind === selection.item.kind);
  const refreshList = () => { closeContent(); query.refresh(); };
  const body = useRef<HTMLDivElement>(null);
  const bodyHeight = useRef(360);
  useLayoutEffect(() => {
    if (ready && !query.loading && body.current) bodyHeight.current = body.current.getBoundingClientRect().height;
  }, [ready, query.loading]);
  return <div className="page-content evolution-page">
    {selected && <EvolutionContent key={`${selected.id}:${selected.revision}`} item={selected} onClose={closeContent} onRefreshList={refreshList} />}
    <div hidden={!!selected}>{summary && <UsageSummary data={summary} />}</div>
    <section className="evolution-library" aria-label="记忆与技能条目" hidden={!!selected}>
      <div className="evolution-list-toolbar">
        <nav className="filter-tabs" aria-label="自进化记录类型">{[['memory', '记忆'], ['skill', 'Skills']].map(([value, label]) => <a key={value} href={`#/evolution?kind=${value}`} aria-current={kind === value ? 'page' : undefined} aria-controls="evolution-list-body">{label}</a>)}</nav>
        <EvolutionListActions cache={summary?.cache} sessionsRead={summary?.usageCoverage?.sessionsRead} loading={query.loading} onRefresh={refreshList} />
      </div>
      <div ref={body} id="evolution-list-body" className="evolution-list-body" aria-busy={query.loading} style={!ready && query.loading ? {minHeight: bodyHeight.current} : undefined}>
        {query.error && <Notice error={query.error} stale={!!ready || !!summary} onRetry={query.refresh} />}
        {!data && query.loading ? <div className="evolution-pending"><Loading>正在读取自进化记录…</Loading></div>
          : !ready ? <EmptyState title={forbidden || revoked ? '无权查看自进化记录' : busy ? '自进化记录正在更新' : '自进化记录暂不可读'} action={!query.error ? <Button variant="secondary" onClick={query.refresh}>重新获取</Button> : undefined} />
          : <>
            {kind === 'skill' && ready.skills.inventoryComplete === false && <p className="evolution-list-notice" role="status">技能盘点不完整：{ready.skills.inventoryIssues?.join('；') || '部分资源不可读'}</p>}
            {!ready.items.length ? <EmptyState title={offset ? '这一页已没有记录' : '暂无自进化记录'} action={offset ? <Button variant="secondary" onClick={() => changePage(0)}>返回第一页</Button> : undefined} />
              : <EvolutionEntryList items={ready.items} onView={(item, button) => { opener.current = button; setSelection({item, route: route.search}); }} />}
            <Pagination pageSize={10} offset={offset} total={ready.total} nextOffset={ready.nextOffset} onPage={changePage} loading={query.loading} />
          </>}
      </div>
    </section>
  </div>;
}
