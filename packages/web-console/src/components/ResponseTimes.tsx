import { useEffect, useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { ApiError } from '../api';
import { dateTime, useResource } from '../hooks';
import { Badge, Button } from './BoardPrimitives';
import { Loading, Notice } from './Shared';

interface TimingStep { kind?: string; label: string; at: string; shared?: boolean; durationMs?: number }
interface ReplyTiming {
  messageId: string; messageVersion?: number; preview: string; status: string;
  receivedAt: string | null; firstReplyAt: string | null; durationMs: number | null;
  reason: string | null; replyPreview?: string | null; steps: TimingStep[];
}
interface TimingPage { status: string; items: ReplyTiming[]; nextOffset: number | null; total: number; coverage?: string }
const labels: Record<string, string> = {
  confirmed: '首答已确认', unavailable: '历史记录不足', 'invalid-time': '时间记录异常',
  unconfirmed: '回复尚未确认可见', failed: '回复发送失败', pending: '等待发送', 'no-reply': '尚无可核实的首答',
};
const explanations: Record<string, string> = {
  unavailable: '缺少可靠的接收时间或消息关联，无法计算首答耗时。',
  'invalid-time': '接收与回复时间无法对应，暂不计算耗时。',
  unconfirmed: '已有回复记录，但还不能确认哪一条最先可见，暂不计算耗时。',
  failed: '回复发送失败。这里仅展示已有记录，不会重新发送。',
  pending: '回复已准备，尚未确认发送完成。',
  'no-reply': '当前没有可核实的承接或直接答复记录，不代表消息正在处理。',
};
const exactTime = (value: string | null) => dateTime(value ?? undefined, true);
const duration = (ms: number) => ms < 1000 ? `${ms.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 毫秒`
  : `${(ms / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 秒`;
const tone = (status: string) => status === 'confirmed' ? 'success' : status === 'failed' || status === 'invalid-time' ? 'danger' : status === 'unconfirmed' || status === 'pending' ? 'warning' : 'neutral';

function MessageJourney({ row }: { row: ReplyTiming }) {
  const confirmed = row.status === 'confirmed' && row.durationMs !== null && Number.isFinite(row.durationMs) && row.durationMs >= 0;
  const received = row.receivedAt ? Date.parse(row.receivedAt) : NaN;
  return <details className="response-time-row">
    <summary>
      <RiArrowDownSLine className="response-time-chevron" size={18} aria-hidden="true" />
      <span className="response-time-message"><span className="response-time-preview">{row.preview || '消息正文未提供'}</span>
        <span className="response-time-meta">接收于 {exactTime(row.receivedAt)}</span>
      </span>
      <span className="response-time-outcome">{confirmed ? <><strong>{duration(row.durationMs!)}</strong><span>收到消息 → 首答确认</span></> : <Badge tone={tone(row.status)}>{labels[row.status] || '记录不足'}</Badge>}</span>
    </summary>
    <div className="response-time-detail">
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
  </details>;
}

export function ResponseTimes({ endpoint }: { endpoint: string }) {
  const [offset, setOffset] = useState(0);
  const query = useResource<TimingPage>(`${endpoint}/response-times?offset=${offset}&limit=20`, offset ? 0 : 2500);
  const revoked = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (revoked) setDenied(true); }, [revoked]);
  useEffect(() => { if (!query.error && query.updatedAt) setDenied(false); }, [query.updatedAt]);
  const data = revoked || denied ? null : query.data;
  const latest = () => { setOffset(0); query.refresh(); };
  return <section className="response-times" aria-label="消息首答与处理过程">
    <header className="execution-section-heading"><div><h2>消息与首答</h2><p>收到消息后，多久给出第一条承接或直接答复。</p></div>
      <Button variant="ghost" busy={query.loading} onClick={latest}>刷新记录</Button>
    </header>
    {query.error && <Notice error={query.error} stale={!!data} onRetry={query.refresh} />}
    {!data ? query.loading ? <Loading>正在读取消息处理记录…</Loading> : <p className="execution-empty">首答记录暂不可读，请重新获取。</p>
      : data.status !== 'ready' ? <p className="execution-empty">当前 Bot 未提供首答记录，不能判断回复速度。</p> : <>
        {!data.items.length && <p className="execution-empty">尚无可核实的入站消息。收到消息后，记录会显示在这里。</p>}
        {data.items.map(row => <MessageJourney key={`${row.messageId}:${row.messageVersion ?? 1}`} row={row} />)}
        {(offset > 0 || data.nextOffset != null) && <div className="execution-pagination"><span className="muted">{offset + 1}–{offset + data.items.length} / {data.total} 条</span>
          {offset > 0 && <Button disabled={query.loading} onClick={latest}>回到最新</Button>}
          {data.nextOffset != null && <Button disabled={query.loading || !!query.error} onClick={() => setOffset(data.nextOffset!)}>更早消息</Button>}
        </div>}
      </>}
    <details className="execution-reading-note"><summary>计时与记录范围</summary>
      <p>起点是 Bot 实际接收消息，终点是首条承接或直接答复确认可见，不包含后续任务结果，也不代表用户已读。时间缺失、回复用途不明或可见性待核实时，不计算耗时。</p>
      <p>只展示已保存的事实。累计时间不是各阶段独立耗时，批次共享过程不分摊到单条消息。时间按浏览器本地时区显示（{Intl.DateTimeFormat().resolvedOptions().timeZone}）。{endpoint.startsWith('/chat/') && ' Web 仅覆盖当前保留的消息窗口。'}</p>
    </details>
  </section>;
}
