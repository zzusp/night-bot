import { useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { ApiError, type Chat } from '../api';
import { Button, EmptyState } from './BoardPrimitives';
import { Loading, Notice } from './Shared';
import { ExecutionHistory } from './ExecutionHistory';

export type TaskHistory = Pick<Chat, 'taskIds' | 'taskHistoryStatus'>;
function ChatExecutionGroup({ endpoint, taskId }: { endpoint: string; taskId?: string }) {
  const [open, setOpen] = useState(!taskId);
  const sessionEndpoint = `${endpoint}${taskId ? `/tasks/${encodeURIComponent(taskId)}` : ''}/session`;
  return <details className="chat-execution-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><RiArrowDownSLine className="chat-execution-chevron" size={18} aria-hidden="true" />
      <span className="chat-execution-label"><strong>{taskId ? '任务执行' : 'Router · 会话安排'}</strong>{taskId && <code>{taskId}</code>}</span>
      <span className="chat-execution-toggle">{open ? '收起记录' : '展开记录'}</span>
    </summary>
    {open && <ExecutionHistory endpoint={sessionEndpoint} router={!taskId} />}
  </details>;
}

export function ConversationExecution({ endpoint, query }: { endpoint: string; query: { data?: TaskHistory | null; error: Error | null; loading: boolean; refresh: () => void } }) {
  const taskHistoryBlocked = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  return <div className="chat-execution" key={endpoint}>
      <ChatExecutionGroup endpoint={endpoint} />
      <section className="chat-task-history" aria-label="本会话关联任务">
        <header><h2>本会话关联任务</h2><p>含已完成和已归档任务，可展开查看。</p></header>
        {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!query.data && !taskHistoryBlocked} />}
        {query.loading && !query.data ? <Loading>正在读取关联任务…</Loading>
          : taskHistoryBlocked || (!query.data && query.error) ? <EmptyState title="关联任务暂不可读" description="请重新获取会话；当前不会读取关联任务的执行记录。" />
          : query.data?.taskHistoryStatus !== 'ready' || query.data.taskIds === null ? <EmptyState title="关联任务暂不可读" description="Host 尚未提供可核验的任务关联，这不表示没有任务。" action={<Button variant="secondary" onClick={query.refresh}>重新获取</Button>} />
          : query.data.taskIds.length ? query.data.taskIds.map(taskId => <ChatExecutionGroup key={taskId} endpoint={endpoint} taskId={taskId} />)
          : <EmptyState title="本会话暂无关联任务" description="Router 安排任务后会在这里显示。" />}
      </section>
    </div>;
}
