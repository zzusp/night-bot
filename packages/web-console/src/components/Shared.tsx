import {useAssistantBrand, brandGlyph} from './AssistantBrand';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RiArrowDownLine, RiRefreshLine, RiSearchLine, RiCloseLine } from '@remixicon/react';
import { Badge, Button, EmptyState, IconButton, Spinner } from './BoardPrimitives';
import { errorText, type HistoryReader, type Message, type MessageBodyPage, type MessageSource } from '../api';
import { dateTime, useResource } from '../hooks';

const states: Record<string, [string, 'neutral' | 'success' | 'warning' | 'danger' | 'info']> = {
  running: ['执行中', 'info'], active: ['进行中', 'info'], queued: ['排队中', 'neutral'], pending: ['处理中', 'info'],
  accepted: ['已接纳', 'neutral'], completed: ['已完成', 'success'], complete: ['已完成', 'success'], done: ['已完成', 'success'],
  waiting: ['等待中', 'warning'], blocked: ['受阻', 'warning'], failed: ['失败', 'danger'], error: ['失败', 'danger'],
  cancelled: ['已取消', 'neutral'], canceled: ['已取消', 'neutral'], archived: ['已归档', 'neutral'],
  idle: ['空闲', 'neutral'], sent: ['已发送', 'success'], delivered: ['已送达', 'success'], unknown: ['待核实', 'warning'],
  stopped: ['已停止', 'neutral'], ready: ['就绪', 'success'], settled: ['已处理', 'success'],
  processed: ['已处理', 'neutral'], rejected: ['未接纳', 'warning'], recorded: ['已记录', 'neutral'], paused: ['已暂停', 'warning'],
  'waiting-reply': ['待答复', 'warning'], answered: ['已答复', 'success'], superseded: ['已失效', 'neutral'], closed: ['已关闭', 'neutral'],
  stop: ['已回复', 'neutral'], toolUse: ['调用工具', 'info'], length: ['达到长度限制', 'warning'], aborted: ['已中止', 'neutral'],
  prepared: ['已准备', 'neutral'], recovering: ['恢复中', 'info'], stopping: ['停止中', 'warning'],
  starting: ['启动中', 'info'], 'waiting-auth': ['等待认证', 'warning'], listening: ['监听中', 'success'],
  succeeded: ['已成功', 'success'], stale: ['已失效', 'warning'], not_started: ['未开始', 'neutral'],
};
export function Status({ value }: { value?: string }) {
  const [label, tone] = states[value ?? ''] ?? [value || '未记录', 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}
export function Notice({ error, onRetry, stale = false, message }: { error: unknown; onRetry?: () => void; stale?: boolean; message?: string }) {
  return <div className="notice" role="alert"><span>{stale ? '当前显示上次获取的数据。' : ''}{message ?? errorText(error)}</span>
    {onRetry && <Button variant="ghost" onClick={onRetry} icon={<RiRefreshLine size={16} />}>重新获取</Button>}</div>;
}
export function Loading({ children = '正在获取…' }: { children?: ReactNode }) {
  return <div className="loading" role="status"><Spinner /><span>{children}</span></div>;
}
export function Search({ value, onChange, label = '筛选当前页' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return <div className="search-field"><RiSearchLine size={17} aria-hidden="true" />
    <input ref={ref} type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} />
    {value && <IconButton label="清除搜索" onClick={() => { onChange(''); ref.current?.focus(); }}><RiCloseLine size={16} /></IconButton>}
  </div>;
}
export function Pagination({ offset, total, nextOffset, onPage, loading }: { offset: number; total: number; nextOffset?: number | null; onPage: (offset: number) => void; loading?: boolean }) {
  return <nav className="pagination" aria-label="分页"><span>共 {total} 条{total > 0 && ` · 第 ${Math.floor(offset / 20) + 1} 页`}</span><div>
    <Button variant="secondary" disabled={!offset || loading} onClick={() => onPage(Math.max(0, offset - 20))}>上一页</Button>
    <Button variant="secondary" disabled={nextOffset == null || loading} onClick={() => nextOffset != null && onPage(nextOffset)}>下一页</Button>
  </div></nav>;
}
export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">查看图片：{alt || '附件'}</a>,
  }}>{text}</ReactMarkdown></div>;
}

function MessageProvenance({ source }: { source?: MessageSource }) {
  return source ? <details className="message-source"><summary>查看记录来源</summary><dl>
    <dt>Pi 会话</dt><dd><code>{source.sessionId}</code></dd><dt>历史条目</dt><dd><code>{source.entryId}</code></dd>
    {source.callId && <><dt>工具调用</dt><dd><code>{source.callId}</code></dd></>}
  </dl></details> : null;
}
function MessageBody({ message, history, plain = false }: { message: Message; history?: HistoryReader; plain?: boolean }) {
  const [cursor, setCursor] = useState<{ offsets: number[]; revision?: string }>({ offsets: [0] });
  const offset = cursor.offsets.at(-1)!;
  const query = useResource<MessageBodyPage>(offset && history && cursor.revision
    ? `${history.endpoint}/messages/${encodeURIComponent(message.id)}?offset=${offset}&limit=16000&revision=${encodeURIComponent(cursor.revision)}` : null);
  const page = offset ? query.data : null;
  const text = offset ? page?.text : message.text;
  const nextOffset = offset ? page?.nextOffset : message.textNextOffset;
  const total = offset ? page?.total : message.textTotal;
  const revision = offset ? cursor.revision : history?.revision;
  const reset = () => setCursor({ offsets: [0] });
  return <>
    {query.error && <Notice error={query.error} stale={!!page} onRetry={reset} />}
    {offset && !page ? query.loading ? <Loading>正在读取正文…</Loading> : <p className="message-scope">这一段正文暂不可读，可回到首段重新获取。</p>
      : plain ? <pre className="tool-content" tabIndex={0}><code>{text || '此记录没有可展示的文字。'}</code></pre> : <Markdown text={text || ''} />}
    {((nextOffset != null && history) || offset > 0) && <nav className="body-pagination" aria-label="正文分页">
      <span>{text !== undefined ? `正文 ${text.length ? offset + 1 : offset}–${offset + text.length}${total !== undefined ? ` / ${total}` : ''}` : '正文读取中'}</span><div>
        <Button variant="ghost" disabled={!offset} onClick={() => setCursor(previous => ({ ...previous, offsets: previous.offsets.slice(0, -1) }))}>上一段</Button>
        <Button variant="ghost" disabled={nextOffset == null || query.loading || !revision} onClick={() => {
          if (nextOffset != null && revision) setCursor(previous => ({ offsets: [...previous.offsets, nextOffset], revision }));
        }}>下一段</Button>
      </div></nav>}
    {(page?.redacted || message.redacted) && <p className="message-scope">{message.role === 'tool' ? '仅展示获准公开的工具字段；其余输入、输出及敏感信息已隐藏。' : '路径及敏感凭据已隐藏。'}</p>}
    {message.truncated && (!history || message.textNextOffset == null) && <p className="message-scope">此条长记录的当前接口仅返回部分正文。</p>}
    <MessageProvenance source={page?.source || message.source} />
  </>;
}

type TranscriptItem = { kind: 'message'; message: Message } | { kind: 'tool'; id: string; call?: Message; results: Message[] };
function transcriptItems(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const calls = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>();
  for (const message of messages) {
    if (message.role !== 'tool') { items.push({ kind: 'message', message }); continue; }
    const key = message.callId ? JSON.stringify([message.source?.sessionId || '', message.callId]) : undefined;
    if (message.kind === 'tool-call') {
      const item: Extract<TranscriptItem, { kind: 'tool' }> = { kind: 'tool', id: message.id, call: message, results: [] };
      items.push(item);
      if (key) calls.set(key, item);
    } else {
      const call = key ? calls.get(key) : undefined;
      if (call && call.call?.toolName === message.toolName) call.results.push(message);
      else items.push({ kind: 'tool', id: message.id, results: [message] });
    }
  }
  return items;
}
function ToolActivity({ item, history }: { item: Extract<TranscriptItem, { kind: 'tool' }>; history?: HistoryReader }) {
  const [open, setOpen] = useState(false);
  const message = item.call || item.results[0];
  const result = item.results.at(-1);
  const state = result ? result.isError ? 'error' : result.status || 'completed' : item.call?.status || 'pending';
  return <article className="message message-tool">
    <div className="message-meta"><span className="message-avatar" aria-hidden="true" /><strong>{message.toolName || '工具'}</strong>
      {message.createdAt && <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
      {state === 'pending' ? <Badge tone="neutral">等待结果</Badge> : <Status value={state} />}
    </div>
    <div className="message-body"><details className="tool-message" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{item.call ? '查看工具输入与结果' : '查看工具结果'}</summary>
      {open && <>
        {item.call ? <section className="tool-part"><h4>输入</h4><MessageBody message={item.call} history={history} plain /></section>
          : <p className="message-scope">本页不含对应调用输入，仅展示已记录的工具结果。</p>}
        {item.results.map(output => <section className="tool-part" key={output.id}><h4>输出 {output.isError || output.status === 'error' ? '· 失败' : ''}</h4><MessageBody message={output} history={history} plain /></section>)}
        {!result && <p className="message-scope">调用已记录，尚无已提交的工具结果；这不表示工具正在执行。</p>}
      </>}
    </details></div>
  </article>;
}
export function MessageList({ messages, pending, empty, footer, userLabel = '你', history }: { messages: Message[]; pending?: boolean; empty?: ReactNode; footer?: ReactNode; userLabel?: string; history?: HistoryReader }) {
  const brand = useAssistantBrand();
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const items = useMemo(() => transcriptItems(messages), [messages]);
  const signature = messages.map(message => `${message.id}:${message.text.length}:${message.status || ''}`).join(',');
  useEffect(() => {
    const element = ref.current;
    if (element && following.current) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
  }, [signature, pending]);
  const latest = () => { following.current = true; setShowLatest(false); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'instant' }); };
  return <div className="transcript-wrap"><div className="transcript" ref={ref} onScroll={() => {
    const el = ref.current!; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; setShowLatest(!following.current);
  }} role="region" aria-label="消息记录" tabIndex={0}>
    <div className={`message-column${messages.length ? '' : ' is-empty'}`}>
      {!messages.length ? empty ?? <EmptyState title="暂无消息" description="消息到达后会显示在这里。" /> : items.map(item => {
        if (item.kind === 'tool') return <ToolActivity key={item.id} item={item} history={history} />;
        const message = item.message;
        return <article className={`message message-${message.role}`} key={message.id}>
          <div className="message-meta"><span className={`message-avatar ${message.role === 'assistant' ? 'bot-avatar' : ''}`}>{message.role === 'assistant' ? (brand.icon === 'moon' ? 'N' : brandGlyph(brand.icon)) : (message.senderName?.slice(0, 1) || userLabel.slice(0, 1))}</span>
            <strong>{message.role === 'assistant' ? brand.name : (message.senderName || userLabel)}</strong>
            {message.createdAt && <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
            {message.status && message.status !== 'delivered' && message.status !== 'sent' && <Status value={message.status} />}
          </div>
          <div className="message-body"><MessageBody message={message} history={history} /></div>
          {message.taskIds?.length ? <div className="message-links">{message.taskIds.map(id => <a key={id} href={`#/tasks/${encodeURIComponent(id)}`}>查看关联任务</a>)}</div> : null}
        </article>;
      })}
      {pending && <div className="thinking" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>Bot 正在处理，完成后会更新回复</div>}
      {footer}
    </div>
  </div>{showLatest && <Button className="jump-latest" variant="secondary" icon={<RiArrowDownLine size={16} />} onClick={latest}>回到最新消息</Button>}</div>;
}
