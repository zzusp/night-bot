import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api';
import { dateTime } from '../hooks';
import { useExecutionStream } from '../useExecutionStream';
import { AgentProgress } from './AgentProgress';
import { Button, EmptyState } from './BoardPrimitives';
import { Loading, MessageList, Notice, Status } from './Shared';

// 聊天与任务共用连续执行流、提交等待和版本冲突处理。
export function ExecutionHistory({ endpoint, router = false, status, taskTitle, taskState, controlsTarget }: { taskTitle?: string; taskState?: string; endpoint: string; router?: boolean; status?: string; controlsTarget?: HTMLElement | null }) {
  const query = useExecutionStream(endpoint);
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  // A retry must not briefly reveal the revoked cache while its request is pending.
  useEffect(() => { if (!query.error) setDenied(false); }, [query.updatedAt]);
  const blocked = forbidden || denied;
  const latest = query.refresh;
  const [readerEpoch, setReaderEpoch] = useState(0);
  const recoveryRead = useRef<number | null | undefined>(undefined);
  // Reset revoked body-page state only after a new authorized history read.
  // Ordinary polling and refreshes retain disclosure and scroll state.
  const recoverBody = () => { recoveryRead.current = query.updatedAt; latest(); };
  useEffect(() => {
    if (recoveryRead.current !== undefined && query.updatedAt !== null && query.updatedAt !== recoveryRead.current && !query.error) {
      recoveryRead.current = undefined;
      setReaderEpoch(value => value + 1);
    }
  }, [query.updatedAt]);
  // The task workspace hosts these controls in its rail; other readers keep them inline.
  // The history component owns one stream regardless of where its controls render.
  const controls = controlsTarget !== undefined ? !blocked && query.data?.status === 'ready' && <dl className="task-record-facts"><div><dt>{query.error ? '上次上下文' : '当前上下文'}</dt><dd><span>{query.data.items.length}</span><span className="muted"> / {query.data.total} 条</span></dd></div></dl> : <div className="execution-scope"><span>{router ? query.data?.scope === 'previous-committed-router-context' ? `已提交的安排记录 · 第 ${query.data.generation} 代（当前第 ${query.data.activeGeneration} 代）` : '当前安排记录' : '当前执行上下文'}</span>
      <div>{query.data?.status === 'ready' && <span>已载入 {query.data.items.length} / {query.data.total} 条记录</span>}{status && <Status value={status} />}{query.updatedAt && <time dateTime={new Date(query.updatedAt).toISOString()}>获取于 {dateTime(query.updatedAt)}</time>}<Button variant="ghost" disabled={query.loading} onClick={latest}>获取最新记录</Button></div>
    </div>;
  return <div className={`execution-history${router && (!query.data?.items.length || blocked) ? ' execution-history-empty' : ''}`}>
    {controlsTarget === undefined ? controls : controlsTarget ? createPortal(controls, controlsTarget) : null}
    {query.error && <Notice error={query.error} stale={!!query.data && !blocked} onRetry={latest} />}
    {!router && !blocked && query.data?.status === 'ready' && query.data.todos && <AgentProgress key={endpoint} items={query.data.todos.items} title={taskTitle} status={taskState} />}

    {query.loading && !query.data ? <Loading>正在读取正式执行记录…</Loading>
      : blocked || (!query.data && query.error) ? <EmptyState title="执行记录暂不可读" />
      : query.data?.status === 'pending' ? <EmptyState title={query.data.reason === 'SESSION_NOT_STARTED' ? router ? '暂无已提交的会话安排' : '执行尚未开始' : '执行记录正在提交'} />
      : query.data?.status === 'unavailable' ? <EmptyState title="执行记录暂不可读" action={<Button variant="secondary" onClick={latest}>重新获取</Button>} />
      : <MessageList key={`${endpoint}:${query.epoch}:${readerEpoch}`} messages={[...(query.data?.items || []), ...(!query.error && query.data?.status === 'ready' ? query.data.live?.items || [] : [])]} userLabel="用户" presentation="execution" older={{ hasMore: !!query.data?.before, loading: query.loadingOlder, error: query.olderError, disabled: !!query.error, onLoad: query.loadOlder }} history={query.data?.revision ? { endpoint, revision: query.data.revision, onRecover: recoverBody } : undefined}
        empty={<EmptyState title="暂无可展示的执行记录" />} />}
  </div>;
}
