import { useEffect, useState } from 'react';
import { ApiError, type LearningBody, type LearningChange, type LearningSource, type TaskLearning } from '../api';
import { dateTime, useResource } from '../hooks';
import { Badge, Button, EmptyState } from './BoardPrimitives';
import { Loading, Markdown, Notice } from './Shared';

const scopeLabels = { bot: 'Bot 公共', personal: '个人', group: '群组', project: '项目' };
function LearningProvenance({ source, change }: { source: LearningSource; change?: LearningChange }) {
  return <details className="message-source learning-source"><summary>{change ? '来源与版本' : '复盘来源'}</summary><dl>
    {change && <><dt>作用域</dt><dd>{scopeLabels[change.scope]}</dd><dt>变更</dt><dd>{change.action === 'upsert' ? '创建或更新' : '当前版本记录'}</dd><dt>版本</dt><dd><code>{String(change.version)}</code></dd></>}
    <dt>任务</dt><dd><code>{source.taskId}</code></dd><dt>复盘</dt><dd><code>{source.reviewId}</code></dd>
    <dt>业务事件</dt><dd><code>{source.eventId}</code></dd>
  </dl></details>;
}
function ChangeBody({ change, endpoint, onRefresh }: { change: LearningChange; endpoint: string; onRefresh: () => void }) {
  const body = useResource<LearningBody>(`${endpoint}/changes/${encodeURIComponent(change.id)}?version=${encodeURIComponent(String(change.version))}`);
  const forbidden = body.error instanceof ApiError && [401, 403, 404, 409].includes(body.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (!body.error) setDenied(false); }, [body.updatedAt]);
  return <div className="learning-body">
    {body.error ? <Notice error={body.error} onRetry={forbidden ? onRefresh : body.refresh} />
      : body.loading || denied ? <Loading>正在读取授权正文…</Loading>
        : body.data ? <><Markdown text={body.data.text} />
          {body.data.redacted && <p className="message-scope">路径及敏感凭据已隐藏。</p>}
          {body.data.truncated && <p className="message-scope">当前接口仅返回部分正文。</p>}</> : null}
  </div>;
}
function ChangeRecord({ change, endpoint, onRefresh }: { change: LearningChange; endpoint: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const applied = change.status === 'applied';
  return <article className="learning-change">
    <header><span className="learning-kind">{change.kind === 'memory' ? '记忆' : '技能'}</span>
      <Badge tone={applied ? 'success' : change.status === 'candidate' ? 'warning' : 'neutral'}>{applied ? '已应用' : change.status === 'candidate' ? '候选，未应用' : '未应用'}</Badge>
    </header>
    <h4>{change.canRead ? <Button className="learning-read" variant="ghost" aria-label={`${open ? '收起正文' : '读取授权正文'}：${change.name || '未命名记录'}`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{change.name || '未命名记录'}</span><span className="learning-read-state" aria-hidden="true">{open ? '收起' : '查看'}</span>
    </Button> : change.name || '未命名记录'}</h4>
    <div className="learning-record-meta"><span>{scopeLabels[change.scope]}</span><span>版本 {String(change.version)}</span>{!change.canRead && <span>正文未授权</span>}</div>
    {open && change.canRead && <ChangeBody key={String(change.version)} change={change} endpoint={endpoint} onRefresh={() => { setOpen(false); onRefresh(); }} />}
    <LearningProvenance source={change.source} change={change} />
  </article>;
}
export function LearningChanges({ taskId, section = 'all' }: { taskId: string; section?: 'all' | 'reviews' | 'changes' }) {
  const endpoint = `/tasks/${encodeURIComponent(taskId)}/learning`;
  const query = useResource<TaskLearning>(endpoint, 4000);
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  useEffect(() => { if (!query.error) setDenied(false); }, [query.updatedAt]);
  const data = forbidden || denied ? null : query.data;
  return <div className="learning-page">
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}
    {query.loading && !data ? <Loading>正在读取{section === 'reviews' ? '复盘' : '学习'}记录…</Loading>
      : !data && query.error ? <EmptyState title="记录暂不可读" />
      : !data || data.status !== 'ready' || data.reviews === null || data.changes === null ? <EmptyState title="复盘与学习记录暂不可读" action={<Button variant="secondary" onClick={query.refresh}>重新获取</Button>} />
      : <>{section !== 'changes' && <section className="detail-section"><h3>复盘记录 <span className="task-section-count">{data.reviews.length}</span></h3>
        {!data.reviews.length ? <p className="task-empty">暂无复盘记录</p> : data.reviews.map(review => <article className="learning-review" key={review.reviewId}>
          <header><Badge tone={review.status === 'failed' ? 'danger' : review.status === 'done' ? 'success' : 'neutral'}>{review.status === 'done' ? '复盘完成' : review.status === 'skipped' ? '复盘已跳过' : '复盘失败'}</Badge><time dateTime={review.at}>{dateTime(review.at)}</time></header>
          {review.summary ? <Markdown text={review.summary} /> : <p className="task-empty">未记录复盘结论</p>}
          <LearningProvenance source={{ taskId: review.taskId, reviewId: review.reviewId, eventId: review.eventId }} />
        </article>)}
      </section>}{section !== 'reviews' && <section className="detail-section"><h3>学习变更 <span className="task-section-count">{data.changes.length}</span></h3>
        {!data.changes.length ? <p className="task-empty">暂无学习变更</p> : data.changes.map(change => <ChangeRecord key={JSON.stringify([change.id, change.version])} change={change} endpoint={endpoint} onRefresh={query.refresh} />)}
      </section>}</>}
  </div>;
}
