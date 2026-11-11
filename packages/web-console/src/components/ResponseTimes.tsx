import { useEffect, useState } from 'react';
import { RiTimerLine } from '@remixicon/react';
import { ApiError, type Message } from '../api';
import { dateTime, useResource } from '../hooks';
import { messageProcessDuration, messageProcessMetricView, type MessageProcessTiming } from '../message-process-duration';
import { Badge } from './BoardPrimitives';
import { Loading, Notice } from './Shared';

interface TimingStep extends MessageProcessTiming { label: string; shared?: boolean; clipped?: boolean }
interface ReplyTiming {
  messageId: string; messageVersion?: number; preview: string; status: string;
  receivedAt: string | null; firstReplyAt: string | null; durationMs: number | null;
  reason: string | null; replyAssociation?: 'direct' | 'task' | null; replyPreview?: string | null; steps: TimingStep[];
}
interface TimingPage { status: string; reason?: string; items: ReplyTiming[]; nextOffset: number | null; total: number; coverage?: string }
const labels: Record<string, string> = {
  confirmed: '首答已确认', unavailable: '历史记录不足', 'invalid-time': '时间记录异常',
  unconfirmed: '回复尚未确认可见', failed: '回复发送失败', pending: '等待发送', 'no-reply': '无需处理及回复', 'awaiting-handling': '等待处理', 'awaiting-reply': '等待回复',
};
const exactTime = (value: string | null) => dateTime(value ?? undefined, true);
const tone = (status: string) => status === 'confirmed' ? 'success' : status === 'failed' || status === 'invalid-time' ? 'danger' : status === 'unconfirmed' || status === 'pending' ? 'warning' : 'neutral';

function MessageJourney({ row, multiple }: { row: ReplyTiming; multiple: boolean }) {
  const confirmed = row.status === 'confirmed' && row.durationMs !== null && Number.isFinite(row.durationMs) && row.durationMs >= 0;
  return <article className="response-time-row">
    {multiple && <p className="response-time-source">{row.preview || '来源消息正文未提供'}</p>}
    <header className="response-time-summary">
      {confirmed ? <><span>首答耗时</span><strong>{messageProcessDuration(row.durationMs!)}</strong></> : <Badge tone={tone(row.status)} title={row.reason ?? undefined}>{labels[row.status] || '记录不足'}</Badge>}
    </header>
    {row.replyAssociation === 'task' && <Badge className="response-time-association">共同回复</Badge>}
    {row.steps.length ? <>
      <div className="response-time-legend" aria-label="时间图例"><span><b aria-hidden="true">+</b>距接收</span><span><RiTimerLine size={12} aria-hidden="true" />阶段耗时</span></div>
      <ol className="response-time-timeline">{row.steps.map((step, index) => {
        const metric = messageProcessMetricView(step, row.receivedAt);
        const clipped = step.clipped === true || step.label.includes('（截至回复可见）');
        return <li key={`${step.kind || step.label}:${step.at}:${index}`} data-timing-type={metric.kind}>
          <span className="response-time-event" title={exactTime(step.at)}>{step.label.replace(/（批次共享）|（截至回复可见）/g, '')}
            {(clipped || step.shared) && <span className="response-time-markers">
              {clipped && <Badge title="截至首条回复可见">至首答</Badge>}
              {step.shared && <Badge title="批次共享，不分摊时长">共享</Badge>}
            </span>}
          </span>
          <span className={`response-time-elapsed response-time-elapsed--${metric.kind}`} data-state={metric.state} role="img" aria-label={metric.label}>
            {metric.kind === 'span' && <RiTimerLine size={12} aria-hidden="true" />}
            <span aria-hidden="true">{metric.value}</span>
          </span>
        </li>;
      })}</ol>
    </> : <Badge>无过程记录</Badge>}

  </article>;
}

export function ResponseTimes({ endpoint, message, onAccessRevoked }: { endpoint: string; message: Message; onAccessRevoked: (error: Error) => void }) {
  const query = useResource<TimingPage>(`${endpoint}/response-times?selectedMessageId=${encodeURIComponent(message.id)}${message.messageVersion ? `&selectedMessageVersion=${message.messageVersion}` : ''}`, 2500, { pauseWhenHidden: true });
  const revoked = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (revoked && query.error) onAccessRevoked(query.error); }, [revoked, query.error, onAccessRevoked]);
  useEffect(() => { if (revoked) setDenied(true); }, [revoked]);
  useEffect(() => { if (!query.error && query.updatedAt) setDenied(false); }, [query.updatedAt]);
  const data = revoked || denied ? null : query.data;
  return <section className="response-times" aria-label="消息首答与处理过程">
    {query.error && <Notice error={query.error} onRetry={query.refresh} message={data ? '读取失败 · 上次快照' : '读取失败'} />}
    {!data ? query.loading ? <Loading>读取中</Loading> : <div className="execution-empty"><Badge>记录不可读</Badge></div>
      : data.status !== 'ready' ? <div className="execution-empty"><Badge title={data.reason}>来源不可核验</Badge></div> : <>
        {!data.items.length && <div className="execution-empty"><Badge>无来源记录</Badge></div>}
        {data.items.length > 1 && <div className="message-process-scope"><Badge>{data.items.length} 个来源</Badge></div>}
        {data.items.map(row => <MessageJourney key={`${row.messageId}:${row.messageVersion ?? 1}`} row={row} multiple={data.items.length > 1} />)}
      </>}
  </section>;
}
