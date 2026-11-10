import { useEffect, useRef, useState } from 'react';
import EvolutionContent from './EvolutionContent';
import { RiBookOpenLine, RiBrainLine, RiRefreshLine } from '@remixicon/react';
import { ApiError, type Evolution, type EvolutionReady, type EvolutionItem, type MemoryProvenance } from './api';
import { dateTime, navigate, useResource } from './hooks';
import { Badge, Button, EmptyState } from './components/BoardPrimitives';
import { Loading, Notice, Pagination } from './components/Shared';
import './styles/evolution.css';

const number = (value: number | null | undefined) => value == null ? '未记录' : new Intl.NumberFormat('zh-CN').format(value);
const scopeLabels = { bot:'Bot 公共', personal: '个人', group: '群组', project: '项目' };

function UsageSummary({ data }: { data: EvolutionReady }) {
  return <div className="evolution-summary">
    <section className="evolution-card" aria-labelledby="memory-summary">
      <header><RiBrainLine size={20} aria-hidden="true" /><h3 id="memory-summary">记忆</h3></header>
      <dl className="evolution-metrics"><div><dt>已应用</dt><dd>{number(data.memory.acceptedCount)}</dd></div><div><dt>候选</dt><dd>{number(data.memory.candidateCount)}</dd></div><div><dt>读取次数</dt><dd>{number(data.memory.readCount)}</dd></div><div><dt>搜索次数</dt><dd>{number(data.memory.searchCount)}</dd></div></dl>
      {data.memory.trackingStatus==='degraded'&&<p role="status">部分记忆访问未能记录，次数可能不完整。</p>}
      <p className="evolution-last-used">最近使用 <time>{dateTime(data.memory.lastUsedAt || undefined)}</time></p>
      <p className="evolution-tracking">{data.memory.trackingSince ? `使用记录始于 ${dateTime(data.memory.trackingSince)}` : '尚未采集使用记录'}</p>
    </section>
    <section className="evolution-card" aria-labelledby="skill-summary">
      <header><RiBookOpenLine size={20} aria-hidden="true" /><h3 id="skill-summary">Skills</h3></header>
      <dl className="evolution-metrics"><div><dt>目录技能</dt><dd>{number(data.skills.installedCount)}</dd></div><div><dt>模型 Skill 调用</dt><dd>{number(data.skills.modelUseCount)}</dd></div><div><dt>用户显式引用</dt><dd>{number(data.skills.userUseCount)}</dd></div><div><dt>技能文件读取</dt><dd>{number(data.skills.fileReadCount)}</dd></div></dl>
      <p className="evolution-last-used">目录可用 {number(data.skills.installedAvailableCount)} · 已学习 {number(data.skills.activeCount)} · 学习候选 {number(data.skills.candidateCount)}</p>
      <p className="evolution-tracking">{data.skills.callTrackingSince?`调用采集始于 ${dateTime(data.skills.callTrackingSince)}`:'调用历史未采集'} · 资源准备不计作调用</p>
      {data.skills.inventoryComplete===false&&<p role="status">技能盘点不完整：{data.skills.inventoryIssues?.join('；')||'部分资源不可读'}</p>}
      {data.skills.contentTrackingStatus==='degraded'&&<p role="status">部分技能的上次内容未能保留；查看时会明确标注，不能还原漏采修改。</p>}
      {data.skills.trackingStatus==='degraded'&&<p role="status">部分调用未能记录，次数可能不完整。</p>}
    </section>
  </div>;
}

function Source({value}:{value?:MemoryProvenance|null}){
 if(!value)return <span className="muted">来源未知</span>;
 const type=value.conversationType==='chat-room'?'群聊':value.conversationType==='chat'?'私聊':'会话类型未知';
 return <details className="evolution-source"><summary>{value.conversationName?`${type} · ${value.conversationName}`:value.taskTitle||value.channelId||'来源详情'}</summary><dl><dt>渠道</dt><dd>{value.channelId||'未知'}</dd><dt>会话</dt><dd>{type} · {value.conversationName||'名称未知'}</dd><dt>会话 ID</dt><dd>{value.conversationId||'未知'}</dd><dt>关联任务</dt><dd>{value.taskId?<a href={`#/tasks/${encodeURIComponent(value.taskId)}`}>{value.taskTitle||value.taskId}</a>:'未知'}</dd></dl>{value.resolvedFrom&&<p className="muted">来源由保留记录恢复；名称是该记录中的名称。</p>}</details>
}
const statuses:Record<EvolutionItem['status'],string>={applied:'已应用',candidate:'候选，未应用',disabled:'禁止调用',invalid:'格式无效',shadowed:'同名被覆盖',undiscovered:'目录未接入运行时',unsupported:'支持记忆不可用'};
function EntrySource({item}:{item:EvolutionItem}){return item.kind==='memory'?<><Source value={item.provenance}/>{(item.origins?.length||0)>1&&<details><summary>其他来源（{item.origins!.length-1}）</summary>{item.origins!.filter(row=>JSON.stringify(row)!==JSON.stringify(item.provenance)).map((row,index)=><Source key={index} value={row}/>)}</details>}{item.migration?.conflict&&<span className="muted">旧库同名冲突，保留为候选</span>}</>:item.origin==='installed'?<span className="evolution-location">{item.location||'安装目录'}</span>:<>{item.taskIds?.length?item.taskIds.map(id=><a className="text-link" key={id} href={`#/tasks/${encodeURIComponent(id)}`}>任务 {id}</a>):'复盘来源未知'}</>}

export default function EvolutionPage({ route }: { route: URL }) {
  const [selection, setSelection] = useState<{item: EvolutionItem; route: string} | null>(null);
  useEffect(() => { setSelection(null); }, [route.search]);
  const opener = useRef<HTMLButtonElement | null>(null);
  const closeContent = () => { setSelection(null); opener.current?.focus(); };
  const kind = ['memory', 'skill'].includes(route.searchParams.get('kind') || '') ? route.searchParams.get('kind')! : 'all';
  const requestedOffset = Number(route.searchParams.get('offset'));
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  const query = useResource<Evolution>(`/evolution?kind=${kind}&offset=${offset}&limit=20`);
  // 权限撤销立即隐藏旧数据，网络中断才保留带明确标记的快照。
  const data = query.error instanceof ApiError && [401, 403].includes(query.error.status) ? null : query.data;
  const ready = data?.status === 'ready' ? data : null;
  const changePage = (next: number) => navigate(`/evolution?kind=${kind}&offset=${next}`);
  const selected = selection?.route === route.search && ready?.items.find(item => item.id === selection.item.id && item.kind === selection.item.kind);
  const refreshList = () => { closeContent(); query.refresh(); };
  return <div className="page-content evolution-page">
    <div className="page-heading"><div><h2>自进化</h2></div><Button variant="secondary" icon={<RiRefreshLine size={16} />} busy={query.loading} disabled={query.loading} onClick={refreshList}>刷新记录</Button></div>
    {query.error && <Notice error={query.error} stale={!!ready} onRetry={query.refresh} />}
    {!data && query.loading ? <div className="evolution-pending"><Loading>正在读取自进化记录…</Loading></div>
      : !ready ? <EmptyState title={query.error instanceof ApiError && query.error.status === 403 ? '无权查看自进化记录' : '自进化记录暂不可读'} description="请确认服务和当前身份的访问权限后重新获取。" action={!query.error ? <Button variant="secondary" onClick={query.refresh}>重新获取</Button> : undefined} />
      : <><p className="muted">整个 Bot 共用一套记忆与 Skills；渠道和任务只标记来源，不再拆库。</p><UsageSummary data={ready} />
        {selected && <EvolutionContent key={`${selected.id}:${selected.revision}`} item={selected} onClose={closeContent} onRefreshList={refreshList} />}
        <details className="evolution-coverage"><summary>采集范围与口径</summary><p>盘点本 Bot 安装目录的技能文件，包括可用、停用、同名覆盖与格式异常；最近更新是文件修改或复盘记录时间，不是完整历史。</p><p>模型 Skill 调用只计成功的原生 skill 工具；用户显式引用只计 Pi 确认接纳的 /skill 命令。技能文件读取只统计成功的 read/read_window；Shell、外部程序读取与是否采纳／执行脚本不能据此推断。学习技能资源准备 {number(ready.skills.loadCount)} 次，不算实际调用。调用是采集以来累计值，可包含之后删除的技能；表格展示当前资源，不补造历史。</p><p>条目返回／命中次数{ready.memory.entryTrackingSince?`始于 ${dateTime(ready.memory.entryTrackingSince)}`:'尚未采集'}；全局读取统计可包含旧库已记录的累计值。</p><p>公共记忆保留可核实的渠道、会话和任务来源；历史缺失显示未知。旧库同名内容冲突不覆盖，转为待确认候选。</p>{ready.memory.lastAccess&&<div>最近记忆访问：{ready.memory.lastAccess.counter==='searchCount'?'搜索':'读取'} · {dateTime(ready.memory.lastAccess.at)}<Source value={ready.memory.lastAccess.provenance}/></div>}</details>
        <div className="list-toolbar"><nav className="filter-tabs" aria-label="自进化记录类型">{[['all', '全部'], ['memory', '记忆'], ['skill', 'Skills']].map(([value, label]) => <a key={value} href={`#/evolution?kind=${value}`} aria-current={kind === value ? 'page' : undefined}>{label}</a>)}</nav><span className="evolution-list-label">最近更新</span></div>
        <div className="evolution-table-wrap" role="region" aria-label="自进化条目表格，可横向滚动" tabIndex={0}>{!ready.items.length ? <EmptyState title={offset ? '这一页已没有记录' : '暂无自进化记录'} description={offset ? '记录可能已变化，请返回第一页。' : '公共库尚无记忆或技能记录。'} action={offset ? <Button variant="secondary" onClick={() => changePage(0)}>返回第一页</Button> : undefined} />
          : <table className="evolution-table"><caption className="sr-only">Bot 公共记忆、技能使用、来源与当前更新</caption><thead><tr><th scope="col">条目</th><th scope="col">使用</th><th scope="col">来源</th><th scope="col">最近更新</th></tr></thead><tbody>{ready.items.map(item=><tr key={`${item.kind}:${item.id}`}><td><div className="evolution-item"><span className="evolution-item-icon" aria-hidden="true">{item.kind==='memory'?<RiBrainLine size={19}/>:<RiBookOpenLine size={19}/>}</span><div><strong>{item.name||'未命名记录'}</strong><div className="evolution-item-meta"><span>{item.kind==='memory'?'记忆':item.origin==='installed'?'目录技能':'学习技能'}</span><span>{scopeLabels[item.scope]}</span><span title={String(item.revision)}>版本 {String(item.revision).length>12?String(item.revision).slice(0,12):item.revision}</span></div><Badge tone={item.status==='applied'?'success':'warning'}>{statuses[item.status]}</Badge><Button className="evolution-view-action" aria-label={`查看内容：${item.name || '未命名记录'}`} onClick={event => { opener.current = event.currentTarget; setSelection({item, route: route.search}); }}>查看内容</Button>{item.updatedSinceUse&&<span className="evolution-update-hint">载入版本与当前不同</span>}</div></div></td><td>{item.kind==='skill'?<div className="evolution-use-counts"><span>模型 {number(item.modelUseCount)}</span><span>用户 {number(item.userUseCount)}</span><span>文件读取 {number(item.fileReadCount)}</span><time>{dateTime(item.lastUsedAt||undefined)}</time></div>:item.memoryUse?<div className="evolution-use-counts"><span>读取返回 {number(item.memoryUse.readCount)}</span><span>搜索命中 {number(item.memoryUse.searchCount)}</span>{item.memoryUse.lastAccess&&<><time dateTime={item.memoryUse.lastAccess.at}>最近返回 {dateTime(item.memoryUse.lastAccess.at)}</time><Source value={item.memoryUse.lastAccess.provenance}/></>}</div>:<span className="muted">条目使用历史未记录</span>}</td><td><EntrySource item={item}/></td><td><time dateTime={item.updatedAt||undefined}>{dateTime(item.updatedAt||undefined)}</time></td></tr>)}</tbody></table>}
        </div><Pagination offset={offset} total={ready.total} nextOffset={ready.nextOffset} onPage={changePage} loading={query.loading} />
      </>}
  </div>;
}
