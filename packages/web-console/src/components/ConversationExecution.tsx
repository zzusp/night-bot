import { useEffect, useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { ApiError, type Chat, type Task } from '../api';
import { Button, EmptyState } from './BoardPrimitives';
import { Loading, Notice, Status, Markdown } from './Shared';
import {ResponseTimes} from './ResponseTimes';
import { ExecutionHistory } from './ExecutionHistory';
import { useResource, textOf, dateTime } from '../hooks';

export type TaskHistory = Pick<Chat, 'taskIds' | 'taskHistoryStatus'>;
function ChatExecutionGroup({ endpoint, taskId }: { endpoint: string; taskId?: string }) {
  const [open, setOpen] = useState(!taskId);
  const summary = useResource<Task>(taskId && open ? `${endpoint}/tasks/${encodeURIComponent(taskId)}` : null, open ? 2500 : 0);
  const revoked = summary.error instanceof ApiError && [401,403,404].includes(summary.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (revoked) setDenied(true); }, [revoked]);
  useEffect(() => { if (!summary.error && summary.updatedAt) setDenied(false); }, [summary.updatedAt]);
  const task = revoked || denied ? null : summary.data;
  const result = task?.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : null;
  const question = typeof result?.question === 'string' ? result.question : '';
  const limitations = Array.isArray(result?.limitations) ? result.limitations.filter((value): value is string => typeof value === 'string') : [];
  const sessionEndpoint = `${endpoint}${taskId ? `/tasks/${encodeURIComponent(taskId)}` : ''}/session`;
  return <details className="chat-execution-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><RiArrowDownSLine className="chat-execution-chevron" size={18} aria-hidden="true" />
      <span className="chat-execution-label"><strong>{taskId ? '任务执行' : 'Router · 会话安排'}</strong>{taskId && <code>{taskId}</code>}</span>
      <span className="chat-execution-toggle">{open ? '收起记录' : '展开记录'}</span>
    </summary>
    {open && <>
      {taskId && <section className="execution-task-summary" aria-label="任务进展与结果">
        {summary.error && <Notice error={summary.error} stale={!!task} onRetry={summary.refresh} />}
        {task ? <>
          <div className="execution-task-heading"><a href={`#/tasks/${encodeURIComponent(taskId)}`}>{task.title || '查看任务详情'}</a><Status value={task.state} />{task.updatedAt && <time>更新于 {dateTime(task.updatedAt)}</time>}</div>
          {textOf(task.result) ? <div className="execution-task-result"><strong>{task.state === 'completed' ? '处理结果' : '当前反馈'}</strong><Markdown text={textOf(task.result)} /></div> : <p className="muted">{task.state === 'running' ? '任务正在执行，尚未提交处理结果。' : '尚无已提交的处理结果。'}</p>}
          {question && <div className="execution-task-blockers"><strong>需要补充</strong><Markdown text={question}/></div>}
          {limitations.length > 0 && <details><summary>结果限制</summary><ul>{limitations.map((value,index)=><li key={index}>{value}</li>)}</ul></details>}
          {task.blockers?.length ? <div className="execution-task-blockers"><strong>等待处理</strong>{task.blockers.map(row=><p key={row.kind+row.id}>{row.title}{row.status && <Status value={row.status}/>}</p>)}</div> : null}
        </> : !summary.error ? <Loading>正在读取任务进展…</Loading> : null}
      </section>}
      <ExecutionHistory endpoint={sessionEndpoint} router={!taskId} />
    </>}

  </details>;
}

export function ConversationExecution({ endpoint, query }: { endpoint: string; query: { data?: TaskHistory | null; error: Error | null; loading: boolean; refresh: () => void } }) {
  const taskHistoryBlocked = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  return <div className="chat-execution" key={endpoint}>
      <ResponseTimes endpoint={endpoint} />
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
