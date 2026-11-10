import { useEffect, useRef, useState } from 'react';
import { ApiError, type EvolutionBody, type EvolutionItem } from './api';
import { dateTime, useResource } from './hooks';
import { Badge, Button, EmptyState } from './components/BoardPrimitives';
import {EvolutionEntryMetadata} from './components/EvolutionEntryList';
import { Loading, Notice } from './components/Shared';

/** Explicit, version-bound read. Never persist content or render it as markup. */
export default function EvolutionContent({ item, onClose, onRefreshList }: {
  item: EvolutionItem; onClose: () => void; onRefreshList: () => void;
}) {
  const [view, setView] = useState<'current' | 'changes'>('current');
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useResource<EvolutionBody>(`/evolution/items/${encodeURIComponent(item.id)}?revision=${encodeURIComponent(String(item.revision))}`);
  // Hide cached bodies during every revalidation, including retries after revoked access.
  const body = !query.loading && !query.error ? query.data : null;
  const code = query.error instanceof ApiError ? query.error.code : '';
  const refreshNeeded = ['EVOLUTION_VERSION_STALE', 'EVOLUTION_ITEM_NOT_FOUND'].includes(code);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="evolution-content" aria-labelledby="evolution-content-title">
    <header className="evolution-content-heading">
      <div><h3 id="evolution-content-title" ref={heading} tabIndex={-1}>{item.name || '未命名记录'}</h3><p className="muted">只读内容 · 仅比较最新内容与上次保留的内容</p></div>
      <div className="evolution-content-actions"><Button busy={query.loading} onClick={query.refresh}>刷新内容</Button><Button onClick={onClose}>返回列表</Button></div>
    </header>
    <EvolutionEntryMetadata item={item}/>
    <div className="evolution-content-switch" role="group" aria-label="内容视图">
      <Button variant={view === 'current' ? 'primary' : 'secondary'} aria-pressed={view === 'current'} onClick={() => setView('current')}>当前内容</Button>
      <Button variant={view === 'changes' ? 'primary' : 'secondary'} aria-pressed={view === 'changes'} onClick={() => setView('changes')}>最近差异</Button>
    </div>
    <div className="evolution-content-body" aria-busy={query.loading}>
      {query.loading ? <Loading>正在读取内容…</Loading> : query.error ? <>
        <Notice error={query.error instanceof ApiError ? query.error : new ApiError(503, 'EVOLUTION_READ_FAILED')} onRetry={refreshNeeded ? onRefreshList : query.refresh} />
        <p className="muted">{code === 'EVOLUTION_BODY_FORBIDDEN' ? '当前内容不可安全展示。请检查读取权限、敏感信息或条目是否仍有效。' : code === 'EVOLUTION_VERSION_STALE' ? '条目已经更新，请重新获取列表后查看最新内容。' : code === 'EVOLUTION_ITEM_NOT_FOUND' ? '条目已不存在或不再可见，请重新获取列表。' : '内容暂不可读，请稍后重试。'}</p>
      </> : body && <>
        {body.comparison.basis === 'observed' && <p className="muted">目录文件比较上次采集与当前内容；未采集的中间修改无法还原。</p>}
        {body.redacted && <p role="status" className="muted">敏感信息已隐藏；差异基于可展示的内容。</p>}
        {view === 'current' ? <><p className="evolution-content-meta">最新版本 {String(body.current.revision)} · {dateTime(body.current.updatedAt || undefined)}</p>{body.current.text ? <pre className="evolution-plain-text">{body.current.text}</pre> : <EmptyState title="当前内容为空" description="此条目没有可展示的文字。" />}</>
          : body.comparison.status === 'no_previous' ? <EmptyState title="暂无可比较的上次内容" description={body.comparison.reason === 'new_entry' ? '这是新条目，尚无上次内容。' : body.comparison.reason === 'unsafe_previous' ? '上次内容无法安全展示；仍可查看当前内容。' : '此前未保留上次内容；后续更新后才能比较。'} />
          : <><div className="evolution-diff-summary"><Badge tone="success">新增 {body.comparison.added} 行</Badge><Badge tone="danger">删除 {body.comparison.removed} 行</Badge></div><p className="evolution-content-meta">上次版本 {String(body.previous?.revision ?? '未记录')} → 最新版本 {String(body.current.revision)}</p>
            {!body.comparison.added && !body.comparison.removed && <p role="status">可展示的内容没有变化。</p>}
            <div className="evolution-diff" role="group" aria-label="最新与上次的逐行差异">{body.comparison.lines.map((line, index) => <div key={index} className={`evolution-diff-line evolution-diff-line--${line.type}`}><span className="evolution-diff-sign" aria-hidden="true">{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}</span><span><span className="board-sr-only">{line.type === 'added' ? '新增' : line.type === 'removed' ? '删除' : '未变'}：</span>{line.text || '\u00a0'}</span></div>)}</div>
          </>}
      </>}
    </div>
  </section>;
}
