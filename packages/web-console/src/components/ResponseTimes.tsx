import { useEffect, useState } from 'react';
import { ApiError, type Message } from '../api';
import { dateTime, useResource } from '../hooks';
import { messageProcessDuration } from '../message-process-duration';
import { Badge } from './BoardPrimitives';
import { Loading, Notice } from './Shared';

interface TimingStep { kind?: string; label: string; at: string; shared?: boolean; durationMs?: number }
interface ReplyTiming {
  messageId: string; messageVersion?: number; preview: string; status: string;
  receivedAt: string | null; firstReplyAt: string | null; durationMs: number | null;
  reason: string | null; replyPreview?: string | null; steps: TimingStep[];
}
interface TimingPage { status: string; reason?: string; items: ReplyTiming[]; nextOffset: number | null; total: number; coverage?: string }
const labels: Record<string, string> = {
  confirmed: '首答已确认', unavailable: '历史记录不足', 'invalid-time': '时间记录异常',
  unconfirmed: '回复尚未确认可见', failed: '回复发送失败', pending: '等待发送', 'no-reply': '无需处理及回复', 'awaiting-handling': '等待处理', 'awaiting-reply': '等待回复',
};
const explanations: Record<string, string> = {
  unavailable: '缺少可靠的接收时间或消息关联，无法计算首答耗时。',
  'invalid-time': '接收与回复时间无法对应，暂不计算耗时。',
  unconfirmed: '已有回复记录，但还不能确认哪一条最先可见，暂不计算耗时。',
  failed: '回复发送失败。这里仅展示已有记录，不会重新发送。',
  pending: '回复已准备，尚未确认发送完成。',
  'no-reply': '一级分诊明确无需处理且无需回复。',
  'awaiting-handling': '消息仍待分诊或安排处理，尚未取得首答回执。',
  'awaiting-reply': '消息安排已提交，尚未取得关联回复回执。',
};
const exactTime = (value: string | null) => dateTime(value ?? undefined, true);
const tone = (status: string) => status === 'confirmed' ? 'success' : status === 'failed' || status === 'invalid-time' ? 'danger' : status === 'unconfirmed' || status === 'pending' ? 'warning' : 'neutral';

function MessageJourney({ row, multiple }: { row: ReplyTiming; multiple: boolean }) {
  const confirmed = row.status === 'confirmed' && row.durationMs !== null && Number.isFinite(row.durationMs) && row.durationMs >= 0;
  return <article className="response-time-row">
    {multiple && <p className="response-time-source">{row.preview || '来源消息正文未提供'}</p>}
    <header className="response-time-summary">
      {confirmed ? <><span>首答耗时</span><strong>{messageProcessDuration(row.durationMs!)}</strong></> : <Badge tone={tone(row.status)}>{labels[row.status] || '记录不足'}</Badge>}
    </header>
    {row.reason && <p className="response-time-explanation">{row.reason}</p>}
    {!confirmed && !row.reason && <p className="response-time-explanation">{explanations[row.status] || '当前记录不足，无法确认首答。'}</p>}
    {row.steps.length ? <ol className="response-time-timeline">{row.steps.map((step, index) => {
      const measured = typeof step.durationMs === 'number' && Number.isFinite(step.durationMs) && step.durationMs >= 0;
      return <li key={`${step.kind || step.label}:${step.at}:${index}`}>
        <span className="response-time-event" title={exactTime(step.at)}>{step.label.replace(/（批次共享）$/, '')}
          {step.shared && <small>批次共享</small>}
        </span>
        <span className="response-time-elapsed"><span className="sr-only">{measured ? '节点耗时 ' : '此节点未单独计时'}</span><span aria-hidden={!measured}>{measured ? messageProcessDuration(step.durationMs!) : '—'}</span></span>
      </li>;
    })}</ol> : <p className="response-time-explanation">未记录可展示的中间过程。</p>}
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
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}
    {!data ? query.loading ? <Loading>正在读取消息处理记录…</Loading> : <p className="execution-empty">首答记录暂不可读，请重新获取。</p>
      : data.status !== 'ready' ? <p className="execution-empty">{data.reason || '这条消息暂无可核验的来源记录，无法展示处理过程或计算首答耗时。'}</p> : <>
        {!data.items.length && <p className="execution-empty">这条消息暂无可核实的入站来源，不根据相邻消息推测处理过程。</p>}
        {data.items.length > 1 && <p className="message-process-scope">这条回复关联多条来源消息；各条分别计时。</p>}
        {data.items.map(row => <MessageJourney key={`${row.messageId}:${row.messageVersion ?? 1}`} row={row} multiple={data.items.length > 1} />)}
      </>}
  </section>;
}
