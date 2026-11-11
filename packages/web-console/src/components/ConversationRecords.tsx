import { useEffect, useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { ApiError, type Chat, type Task } from '../api';
import { Button, EmptyState } from './BoardPrimitives';
import { Loading, Notice, Status, Markdown } from './Shared';
import { ExecutionHistory } from './ExecutionHistory';
import { useResource, textOf, dateTime } from '../hooks';

export type TaskHistory = Pick<Chat, 'taskIds' | 'taskHistoryStatus' | 'taskSummaries'>;
function ChatExecutionGroup({ endpoint, taskId, metadata }: { endpoint: string; taskId?: string; metadata?: Pick<Task, 'taskId' | 'title' | 'state' | 'updatedAt'> }) {
  const [open, setOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const summary = useResource<Task>(taskId && open ? `${endpoint}/tasks/${encodeURIComponent(taskId)}` : null, open ? 2500 : 0);
  const revoked = summary.error instanceof ApiError && [401,403,404].includes(summary.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (revoked) setDenied(true); }, [revoked]);
  useEffect(() => { if (!summary.error && summary.updatedAt) setDenied(false); }, [summary.updatedAt]);
  const task = revoked || denied ? null : summary.data;
  const visibleMetadata = revoked || denied ? undefined : metadata;
  const result = task?.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : null;
  const question = typeof result?.question === 'string' ? result.question : '';
  const limitations = Array.isArray(result?.limitations) ? result.limitations.filter((value): value is string => typeof value === 'string') : [];
  const sessionEndpoint = `${endpoint}${taskId ? `/tasks/${encodeURIComponent(taskId)}` : ''}/session`;
  return <details className={`chat-execution-group${taskId ? '' : ' execution-routing-records'}`} data-task-id={taskId} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><RiArrowDownSLine className="chat-execution-chevron" size={18} aria-hidden="true" />
      <span className="chat-execution-label"><strong>{taskId ? (task?.title || visibleMetadata?.title || (revoked || denied ? '任务暂不可读' : '任务名称未记录')) : '会话安排记录'}</strong>
        {taskId && <span className="chat-execution-meta">{(task?.updatedAt || visibleMetadata?.updatedAt) ? `更新于 ${dateTime(task?.updatedAt || visibleMetadata?.updatedAt)}` : '更新时间未记录'}</span>}
      </span>
      {taskId && (task?.state || visibleMetadata?.state) && <Status value={task?.state || visibleMetadata?.state} />}
      <span className="chat-execution-toggle">{open ? '收起' : '查看'}</span>
    </summary>
    {open && <>
      {taskId && <section className="execution-task-summary" aria-label="任务进展与结果">
        {summary.error && <Notice error={summary.error} stale={!!task} onRetry={summary.refresh} />}
        {task ? <>
          <div className="execution-task-heading"><a href={`#/tasks/${encodeURIComponent(taskId)}`}>打开任务详情</a></div>
          {textOf(task.result) ? <div className="execution-task-result"><strong>{task.state === 'completed' ? '处理结果' : '当前反馈'}</strong><Markdown text={textOf(task.result)} /></div> : <p className="muted">{task.state === 'running' ? '任务正在执行，尚未提交处理结果。' : '尚无已提交的处理结果。'}</p>}
          {question && <div className="execution-task-blockers"><strong>需要补充</strong><Markdown text={question}/></div>}
          {limitations.length > 0 && <details><summary>结果限制</summary><ul>{limitations.map((value,index)=><li key={index}>{value}</li>)}</ul></details>}
          {task.blockers?.length ? <div className="execution-task-blockers"><strong>等待处理</strong>{task.blockers.map(row=><p key={row.kind+row.id}>{row.title}{row.status && <Status value={row.status}/>}</p>)}</div> : null}
        </> : !summary.error ? <Loading>正在读取任务进展…</Loading> : null}
      </section>}
      {!taskId ? <ExecutionHistory endpoint={sessionEndpoint} router /> : task && <details className="execution-tool-records" open={recordsOpen} onToggle={event => setRecordsOpen(event.currentTarget.open)}>
        <summary>工具与执行记录</summary>
        {recordsOpen && <ExecutionHistory endpoint={sessionEndpoint} />}
      </details>}
    </>}

  </details>;
}

export function ConversationRecords({ endpoint, query }: { endpoint: string; query: { data?: TaskHistory | null; error: Error | null; loading: boolean; refresh: () => void } }) {
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (!query.error && !query.loading && query.data) setDenied(false); }, [query.data, query.error, query.loading]);
  const taskHistoryBlocked = forbidden || denied;
  if (taskHistoryBlocked) return <div className="chat-execution">
    {query.error && <Notice error={query.error} onRetry={query.refresh} />}
    {query.loading ? <Loading>正在重新核验会话访问权限…</Loading> : <p className="execution-empty">会话暂不可读，已隐藏任务和安排记录。</p>}
  </div>;
  return <div className="chat-execution" key={endpoint}>
      <section className="chat-task-history" aria-label="本会话关联任务">
        <header className="execution-section-heading"><div><h2>后续任务</h2></div>{query.data?.taskHistoryStatus === 'ready' && !taskHistoryBlocked && <span className="execution-task-count">{query.data.taskIds?.length ?? 0} 项</span>}</header>
        {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!query.data && !taskHistoryBlocked} />}
        {query.loading && !query.data ? <Loading>正在读取关联任务…</Loading>
          : taskHistoryBlocked || (!query.data && query.error) ? <EmptyState title="关联任务暂不可读" />
          : query.data?.taskHistoryStatus !== 'ready' || query.data.taskIds === null ? <EmptyState title="关联任务暂不可读" action={<Button variant="secondary" onClick={query.refresh}>重新获取</Button>} />
          : query.data.taskIds.length ? query.data.taskIds.map(taskId => <ChatExecutionGroup key={taskId} endpoint={endpoint} taskId={taskId} metadata={query.data?.taskSummaries?.find(task => task.taskId === taskId)} />)
          : <p className="execution-empty">暂无关联任务</p>}
      </section>
      <ChatExecutionGroup endpoint={endpoint} />
    </div>;
}
