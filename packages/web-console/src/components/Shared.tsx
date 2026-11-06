import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RiArrowDownLine, RiCheckLine, RiFileCopyLine, RiRefreshLine, RiSearchLine, RiCloseLine } from '@remixicon/react';
import { Badge, Button, EmptyState, IconButton, Spinner } from './BoardPrimitives';
import { errorText, type Message } from '../api';
import { dateTime } from '../hooks';

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
  succeeded: ['已成功', 'success'], stale: ['已失效', 'warning'], not_started: ['未开始', 'neutral'],
};
export function Status({ value }: { value?: string }) {
  const [label, tone] = states[value ?? ''] ?? [value || '未记录', 'neutral'];
  return <Badge tone={tone}>{label}</Badge>;
}
export function Notice({ error, onRetry, stale = false }: { error: unknown; onRetry?: () => void; stale?: boolean }) {
  return <div className="notice" role="alert"><span>{stale ? '当前显示上次获取的数据。' : ''}{errorText(error)}</span>
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
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState('已复制'); }
    catch { setState('复制失败，请选中文字复制'); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setState(''), 2500);
  };
  return <span className="copy-action"><IconButton label="复制消息" onClick={copy}>{state === '已复制' ? <RiCheckLine size={15} /> : <RiFileCopyLine size={15} />}</IconButton><span role="status">{state}</span></span>;
}
export function MessageList({ messages, pending, empty, footer, userLabel = '你' }: { messages: Message[]; pending?: boolean; empty?: ReactNode; footer?: ReactNode; userLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const signature = messages.map(message => `${message.id}:${message.text.length}`).join(',');
  useEffect(() => {
    const element = ref.current;
    if (element && following.current) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
  }, [signature, pending]);
  const latest = () => { following.current = true; setShowLatest(false); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'instant' }); };
  return <div className="transcript-wrap"><div className="transcript" ref={ref} onScroll={() => {
    const el = ref.current!; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; setShowLatest(!following.current);
  }} role="region" aria-label="消息记录" tabIndex={0}>
    <div className={`message-column${messages.length ? '' : ' is-empty'}`}>
      {!messages.length ? empty ?? <EmptyState title="暂无消息" description="消息到达后会显示在这里。" /> : messages.map(message =>
        <article className={`message message-${message.role}`} key={message.id}>
          <div className="message-meta"><span className={`message-avatar ${message.role === 'assistant' ? 'bot-avatar' : ''}`}>{message.role === 'assistant' ? 'N' : (message.senderName?.slice(0, 1) || userLabel.slice(0, 1))}</span>
            <strong>{message.senderName || (message.role === 'assistant' ? 'Night Bot' : message.role === 'tool' ? message.toolName || '工具' : userLabel)}</strong>
            {message.createdAt && <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
            {message.status && message.status !== 'delivered' && message.status !== 'sent' && <Status value={message.status} />}
          </div>
          <div className="message-body">{message.role === 'tool' ? <details className="tool-message"><summary>{message.kind === 'tool-call' ? '工具调用' : '工具返回'} · {message.toolName || '执行工具'}</summary><Markdown text={message.text} /></details> : <Markdown text={message.text} />}
            {(message.redacted || message.truncated) && <p className="message-scope">{message.redacted ? '路径及敏感凭据已隐藏。' : ''}{message.truncated ? '此条长记录仅展示部分内容。' : ''}</p>}</div>
          {message.taskIds?.length ? <div className="message-links">{message.taskIds.map(id => <a key={id} href={`#/tasks/${encodeURIComponent(id)}`}>查看关联任务</a>)}</div> : null}
          <CopyButton text={message.text} />
        </article>)}
      {pending && <div className="thinking" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>Bot 正在处理，完成后会更新回复</div>}
      {footer}
    </div>
  </div>{showLatest && <Button className="jump-latest" variant="secondary" icon={<RiArrowDownLine size={16} />} onClick={latest}>回到最新消息</Button>}</div>;
}
