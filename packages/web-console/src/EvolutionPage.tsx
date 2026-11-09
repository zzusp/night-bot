import { RiBookOpenLine, RiBrainLine, RiRefreshLine } from '@remixicon/react';
import { ApiError, type Evolution, type EvolutionReady } from './api';
import { dateTime, navigate, useResource } from './hooks';
import { Badge, Button, EmptyState } from './components/BoardPrimitives';
import { Loading, Notice, Pagination } from './components/Shared';
import './styles/evolution.css';

const number = (value: number | null) => value === null ? '未记录' : new Intl.NumberFormat('zh-CN').format(value);
const scopeLabels = { personal: '个人', group: '群组', project: '项目' };

function UsageSummary({ data }: { data: EvolutionReady }) {
  return <div className="evolution-summary">
    <section className="evolution-card" aria-labelledby="memory-summary">
      <header><RiBrainLine size={20} aria-hidden="true" /><h3 id="memory-summary">记忆</h3></header>
      <dl className="evolution-metrics"><div><dt>已应用</dt><dd>{number(data.memory.acceptedCount)}</dd></div><div><dt>候选</dt><dd>{number(data.memory.candidateCount)}</dd></div><div><dt>读取次数</dt><dd>{number(data.memory.readCount)}</dd></div><div><dt>搜索次数</dt><dd>{number(data.memory.searchCount)}</dd></div></dl>
      <p className="evolution-last-used">最近使用 <time>{dateTime(data.memory.lastUsedAt || undefined)}</time></p>
      <p className="evolution-tracking">{data.memory.trackingSince ? `使用记录始于 ${dateTime(data.memory.trackingSince)}` : '尚未采集使用记录'}</p>
    </section>
    <section className="evolution-card" aria-labelledby="skill-summary">
      <header><RiBookOpenLine size={20} aria-hidden="true" /><h3 id="skill-summary">学习技能</h3><Badge tone="neutral">Skill</Badge></header>
      <dl className="evolution-metrics"><div><dt>已应用</dt><dd>{number(data.skills.activeCount)}</dd></div><div><dt>候选</dt><dd>{number(data.skills.candidateCount)}</dd></div><div><dt>资源加载次数</dt><dd>{number(data.skills.loadCount)}</dd></div></dl>
      <p className="evolution-last-used">最近加载 <time>{dateTime(data.skills.lastUsedAt || undefined)}</time></p>
      <p className="evolution-tracking">{data.skills.trackingSince ? `使用记录始于 ${dateTime(data.skills.trackingSince)}` : '尚未采集使用记录'}</p>
    </section>
  </div>;
}

export default function EvolutionPage({ route }: { route: URL }) {
  const kind = ['memory', 'skill'].includes(route.searchParams.get('kind') || '') ? route.searchParams.get('kind')! : 'all';
  const requestedOffset = Number(route.searchParams.get('offset'));
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  const query = useResource<Evolution>(`/evolution?kind=${kind}&offset=${offset}&limit=20`);
  // 权限撤销立即隐藏旧数据，网络中断才保留带明确标记的快照。
  const data = query.error instanceof ApiError && [401, 403].includes(query.error.status) ? null : query.data;
  const ready = data?.status === 'ready' ? data : null;
  const changePage = (next: number) => navigate(`/evolution?kind=${kind}&offset=${next}`);
  return <div className="page-content evolution-page">
    <div className="page-heading"><div><h2>自进化</h2></div><Button variant="secondary" icon={<RiRefreshLine size={16} />} busy={query.loading} disabled={query.loading} onClick={query.refresh}>刷新记录</Button></div>
    {query.error && <Notice error={query.error} stale={!!ready} onRetry={query.refresh} />}
    {!data && query.loading ? <div className="evolution-pending"><Loading>正在读取自进化记录…</Loading></div>
      : !ready ? <EmptyState title={query.error instanceof ApiError && query.error.status === 403 ? '无权查看自进化记录' : '自进化记录暂不可读'} description="请确认服务和当前身份的访问权限后重新获取。" action={!query.error ? <Button variant="secondary" onClick={query.refresh}>重新获取</Button> : undefined} />
      : <><p className="muted">当前 Web 渠道身份的个人记忆与学习技能；不含其他任务身份、渠道群组、外部安装技能及采集前的调用历史。</p><UsageSummary data={ready} />
        <details className="evolution-coverage"><summary>统计范围</summary><p>仅显示当前身份获准访问的记忆与复盘形成的技能，不包含外部安装技能。记录从新增采集开始，不追溯此前调用。搜索不代表命中或采纳；技能资源加载包含运行时准备，不代表模型调用或执行。</p><p>下方展示当前保留条目的最近更新，不是完整变更历史。候选尚未应用，已遗忘条目不再显示。</p></details>
        <div className="list-toolbar"><nav className="filter-tabs" aria-label="自进化记录类型">{[['all', '全部'], ['memory', '记忆'], ['skill', '学习技能']].map(([value, label]) => <a key={value} href={`#/evolution?kind=${value}`} aria-current={kind === value ? 'page' : undefined}>{label}</a>)}</nav><span className="evolution-list-label">最近更新</span></div>
        <div className="evolution-table-wrap">{!ready.items.length ? <EmptyState title={offset ? '这一页已没有记录' : '暂无自进化记录'} description={offset ? '记录可能已变化，请返回第一页。' : '当前授权范围内尚无记忆或学习技能。'} action={offset ? <Button variant="secondary" onClick={() => changePage(0)}>返回第一页</Button> : undefined} />
          : <table className="evolution-table"><caption className="sr-only">记忆与学习技能的当前状态及最近更新</caption><thead><tr><th scope="col">条目</th><th scope="col">状态</th><th scope="col">最近更新</th></tr></thead><tbody>{ready.items.map(item => <tr key={`${item.kind}:${item.id}`}><td><div className="evolution-item"><span className="evolution-item-icon" aria-hidden="true">{item.kind === 'memory' ? <RiBrainLine size={19} /> : <RiBookOpenLine size={19} />}</span><div><strong>{item.name || '未命名记录'}</strong><div className="evolution-item-meta"><span>{item.kind === 'memory' ? '记忆' : '学习技能'}</span><span>{scopeLabels[item.scope]}</span><span>版本 {item.revision}</span></div>{item.taskId && <a className="text-link" href={`#/tasks/${encodeURIComponent(item.taskId)}?view=learning`}>查看任务复盘</a>}</div></div></td><td><Badge tone={item.status === 'applied' ? 'success' : 'warning'}>{item.status === 'applied' ? '已应用' : '候选，未应用'}</Badge></td><td><time dateTime={item.updatedAt || undefined}>{dateTime(item.updatedAt || undefined)}</time></td></tr>)}</tbody></table>}
        </div><Pagination offset={offset} total={ready.total} nextOffset={ready.nextOffset} onPage={changePage} loading={query.loading} />
      </>}
  </div>;
}
