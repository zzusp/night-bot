import { useEffect, useState } from 'react';
import { ApiError, type Message } from '../api';
import { dateTime, useResource } from '../hooks';
import { Badge, Button } from './BoardPrimitives';
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
const duration = (ms: number) => ms < 1000 ? `${ms.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 毫秒`
  : `${(ms / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 秒`;
const tone = (status: string) => status === 'confirmed' ? 'success' : status === 'failed' || status === 'invalid-time' ? 'danger' : status === 'unconfirmed' || status === 'pending' ? 'warning' : 'neutral';

function MessageJourney({ row }: { row: ReplyTiming }) {
  const confirmed = row.status === 'confirmed' && row.durationMs !== null && Number.isFinite(row.durationMs) && row.durationMs >= 0;
  const received = row.receivedAt ? Date.parse(row.receivedAt) : NaN;
  return <article className="response-time-row">
    <header className="response-time-summary">
      <span className="response-time-message"><span className="response-time-preview">{row.preview || '消息正文未提供'}</span>
        <span className="response-time-meta">接收于 {exactTime(row.receivedAt)}</span>
      </span>
      <span className="response-time-outcome">{confirmed ? <><strong>{duration(row.durationMs!)}</strong><span>首答耗时</span></> : <Badge tone={tone(row.status)}>{labels[row.status] || '记录不足'}</Badge>}</span>
    </header>
    <div className="response-time-detail">
      {confirmed && row.reason && <p className="response-time-explanation">{row.reason}</p>}
      {confirmed ? <div className="response-time-reply"><span className="response-time-caption">首条回复</span><p>{row.replyPreview || '已确认可见，未提供回复摘要。'}</p></div>
        : <p className="response-time-explanation">{row.reason || explanations[row.status] || '当前记录不足，无法确认首答。'}</p>}
      {row.steps.length ? <>
        <div className="response-time-timeline-heading"><h3>回复前的过程</h3><span>右侧为接收后的累计时间</span></div>
        <ol className="response-time-timeline">{row.steps.map((step, index) => {
          const elapsed = Date.parse(step.at) - received;
          return <li key={`${step.kind || step.label}:${step.at}:${index}`}>
            <span className="response-time-event"><span>{step.label}</span><time dateTime={step.at}>{exactTime(step.at)}</time>
              {step.shared && <small>批次共享，不代表本条消息单独用时</small>}
            </span>
            <span className="response-time-elapsed">{Number.isFinite(elapsed) && elapsed >= 0 ? `+${duration(elapsed)}` : '时间无法对应'}</span>
          </li>;
        })}</ol>
      </> : <p className="muted">未记录可展示的中间过程。</p>}
    </div>
  </article>;
}

export function ResponseTimes({ endpoint, message, onAccessRevoked }: { endpoint: string; message: Message; onAccessRevoked: (error: Error) => void }) {
  const query = useResource<TimingPage>(`${endpoint}/response-times?selectedMessageId=${encodeURIComponent(message.id)}${message.messageVersion ? `&selectedMessageVersion=${message.messageVersion}` : ''}`, 2500);
  const revoked = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (revoked && query.error) onAccessRevoked(query.error); }, [revoked, query.error, onAccessRevoked]);
  useEffect(() => { if (revoked) setDenied(true); }, [revoked]);
  useEffect(() => { if (!query.error && query.updatedAt) setDenied(false); }, [query.updatedAt]);
  const data = revoked || denied ? null : query.data;
  const latest = query.refresh;
  return <section className="response-times" aria-label="消息首答与处理过程">
    <header className="execution-section-heading"><p>从 Bot 接收消息，到首条回复确认送达。</p>
      <Button variant="ghost" busy={query.loading} onClick={latest}>刷新记录</Button>
    </header>
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}
    {!data ? query.loading ? <Loading>正在读取消息处理记录…</Loading> : <p className="execution-empty">首答记录暂不可读，请重新获取。</p>
      : data.status !== 'ready' ? <p className="execution-empty">{data.reason || '这条消息暂无可核验的来源记录，无法展示处理过程或计算首答耗时。'}</p> : <>
        {!data.items.length && <p className="execution-empty">这条消息暂无可核实的入站来源，不根据相邻消息推测处理过程。</p>}
        {data.items.length > 1 && <p className="message-process-scope">这条回复关联多条来源消息；各条分别从自己的接收时间计时。</p>}
        {data.items.map(row => <MessageJourney key={`${row.messageId}:${row.messageVersion ?? 1}`} row={row} />)}

      </>}
    <details className="execution-reading-note"><summary>计时与记录范围</summary>
      <p>起点是 Bot 实际接收消息，终点是第一条关联回复确认送达，包含有历史来源覆盖证明的共同任务回复，不代表用户已读。回复用途不影响计时。只有明确无需处理且无需回复时显示无需回复；其他消息显示等待或实际投递状态。时间缺失或较早回复可见性待核实时，不计算耗时。</p>
      <p>只展示已保存的事实。累计时间不是各阶段独立耗时，批次共享过程不分摊到单条消息。时间按浏览器本地时区显示（{Intl.DateTimeFormat().resolvedOptions().timeZone}）。仅核对所选消息的可验证来源。</p>
    </details>
  </section>;
}
