import { useEffect, useState } from 'react';
import { ApiError, type LearningBody, type LearningChange, type LearningSource, type TaskLearning } from '../api';
import { dateTime, useResource } from '../hooks';
import { Badge, Button, EmptyState } from './BoardPrimitives';
import { Loading, Markdown, Notice } from './Shared';

function LearningProvenance({ source }: { source: LearningSource }) {
  return <details className="message-source"><summary>查看变更来源</summary><dl>
    <dt>任务</dt><dd><code>{source.taskId}</code></dd><dt>复盘</dt><dd><code>{source.reviewId}</code></dd>
    <dt>业务事件</dt><dd><code>{source.eventId}</code></dd>
  </dl></details>;
}
function ChangeRecord({ change, endpoint, onRefresh }: { change: LearningChange; endpoint: string; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const body = useResource<LearningBody>(open && change.canRead ? `${endpoint}/changes/${encodeURIComponent(change.id)}?version=${encodeURIComponent(String(change.version))}` : null);
  const applied = change.status === 'applied';
  return <article className="learning-change">
    <header><div><span className="eyebrow">{change.kind === 'memory' ? '记忆' : '技能'}</span><h4>{change.name || '未命名记录'}</h4></div>
      <Badge tone={applied ? 'success' : change.status === 'candidate' ? 'warning' : 'neutral'}>{applied ? '已应用' : change.status === 'candidate' ? '候选，未应用' : '未应用'}</Badge>
    </header>
    <dl className="learning-metadata"><div><dt>作用域</dt><dd>{{ bot:'Bot 公共', personal: '个人', group: '群组', project: '项目' }[change.scope]}</dd></div>
      <div><dt>变更</dt><dd>{change.action === 'upsert' ? '创建或更新' : '当前版本记录'}</dd></div><div><dt>版本</dt><dd><code>{String(change.version)}</code></dd></div>
    </dl>
    <LearningProvenance source={change.source} />
    <div className="learning-body-action"><Button variant="secondary" disabled={!change.canRead} aria-expanded={change.canRead ? open : undefined} onClick={() => setOpen(value => !value)}>
      {!change.canRead ? '正文未授权' : open ? '收起正文' : '读取授权正文'}
    </Button>{!change.canRead && <span className="message-scope">当前身份无权读取该正文。</span>}</div>
    {open && change.canRead && <div className="learning-body">
      {body.error ? <Notice error={body.error} onRetry={() => {
        if (body.error instanceof ApiError && [403, 409].includes(body.error.status)) { setOpen(false); onRefresh(); }
        else body.refresh();
      }} /> : body.loading && !body.data ? <Loading>正在读取授权正文…</Loading>
        : body.data ? <><Markdown text={body.data.text} /><LearningProvenance source={body.data.source} />
          {body.data.redacted && <p className="message-scope">路径及敏感凭据已隐藏。</p>}
          {body.data.truncated && <p className="message-scope">当前接口仅返回部分正文。</p>}</> : null}
    </div>}
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
    <div className="learning-heading"><p className="muted">复盘完成与学习变更分别记录；候选不等于已经写入记忆或技能。</p><Button variant="secondary" disabled={query.loading} onClick={query.refresh}>刷新复盘记录</Button></div>
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}
    {query.loading && !data ? <Loading>正在读取复盘与学习记录…</Loading>
      : !data && query.error ? <EmptyState title="复盘记录暂不可读" description="请恢复连接后重新获取。" />
      : !data || data.status !== 'ready' || data.reviews === null || data.changes === null ? <EmptyState title="复盘与学习记录暂不可读" description="Host 尚未提供可核验的记录，不能据此判定没有复盘或变更。" action={<Button variant="secondary" onClick={query.refresh}>重新获取</Button>} />
      : <>{section !== 'changes' && <section className="detail-section"><h3>任务复盘</h3>
        {!data.reviews.length ? <p>尚无已记录的复盘。</p> : data.reviews.map(review => <article className="learning-review" key={review.reviewId}>
          <header><time dateTime={review.at}>{dateTime(review.at)}</time><Badge tone={review.status === 'failed' ? 'danger' : review.status === 'done' ? 'success' : 'neutral'}>{review.status === 'done' ? '复盘完成' : review.status === 'skipped' ? '复盘已跳过' : '复盘失败'}</Badge></header>
          {review.summary ? <Markdown text={review.summary} /> : <p className="muted">未记录复盘摘要。</p>}
          <LearningProvenance source={{ taskId: review.taskId, reviewId: review.reviewId, eventId: review.eventId }} />
        </article>)}
      </section>}{section !== 'reviews' && <section className="detail-section"><h3>记忆与技能变更记录</h3>
        {!data.changes.length ? <p>尚无已记录的学习变更。</p> : data.changes.map(change => <ChangeRecord key={JSON.stringify([change.id, change.version])} change={change} endpoint={endpoint} onRefresh={query.refresh} />)}
      </section>}</>}
  </div>;
}
