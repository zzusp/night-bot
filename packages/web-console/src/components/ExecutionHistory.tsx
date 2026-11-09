import { useState } from 'react';
import { type ExecutionPage } from '../api';
import { dateTime, useResource } from '../hooks';
import { Button, EmptyState } from './BoardPrimitives';
import { Loading, MessageList, Notice, Status } from './Shared';

// 聊天与任务共用正式历史分页、提交等待和版本冲突处理。
export function ExecutionHistory({ endpoint, router = false, status }: { endpoint: string; router?: boolean; status?: string }) {
  const [page, setPage] = useState<{ offset: number; revision?: string }>({ offset: 0 });
  const query = useResource<ExecutionPage>(`${endpoint}?limit=50&offset=${page.offset}${page.revision ? `&revision=${encodeURIComponent(page.revision)}` : ''}`, page.offset ? 0 : 2500);
  const latest = () => { setPage({ offset: 0 }); query.refresh(); };
  return <div className="execution-history">
    <div className="execution-scope"><span>{router ? '当前 Router 上下文 · 换代、压缩或分支后，可能不含更早记录' : '当前执行上下文 · 会话压缩或分支后，可能不包含更早记录'}</span>
      <div>{status && <Status value={status} />}{query.updatedAt && <time dateTime={new Date(query.updatedAt).toISOString()}>获取于 {dateTime(query.updatedAt)}</time>}<Button variant="ghost" disabled={query.loading} onClick={latest}>获取最新记录</Button></div>
    </div>
    {query.error && <Notice error={query.error} stale={!!query.data} onRetry={latest} />}
    {query.loading && !query.data ? <Loading>正在读取正式执行记录…</Loading>
      : !query.data && query.error ? <EmptyState title="执行记录暂不可读" description="使用上方按钮重新获取。" />
      : query.data?.status === 'pending' ? <EmptyState title={query.data.reason === 'SESSION_NOT_STARTED' ? '执行尚未开始' : '执行记录正在提交'} description={query.data.reason === 'SESSION_NOT_STARTED' ? '会话开始处理后，记录会自动显示。' : 'Bot 正在保存记录，提交完成后会自动更新。'} />
      : query.data?.status === 'unavailable' ? <EmptyState title="执行记录暂不可读" description="当前无法安全读取此会话，请稍后重新获取。" action={<Button variant="secondary" onClick={latest}>重新获取</Button>} />
      : <MessageList key={`${endpoint}:${page.offset}`} messages={query.data?.items || []} userLabel="用户" history={query.data?.revision ? { endpoint, revision: query.data.revision } : undefined}
        empty={<EmptyState title="暂无可展示的执行记录" description="记录会随着会话推进而更新。" />} />}
    <div className="execution-pagination">{page.offset > 0 && <Button variant="secondary" onClick={latest}>回到最新</Button>}
      {query.data?.nextOffset != null && <Button variant="secondary" disabled={query.loading || !!query.error} onClick={() => setPage({ offset: query.data!.nextOffset!, revision: query.data!.revision })}>查看更早记录</Button>}
    </div>
  </div>;
}
