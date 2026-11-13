import {useAssistantBrand, brandGlyph} from './AssistantBrand';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RiArrowDownLine, RiRefreshLine, RiSearchLine, RiCloseLine, RiCheckLine, RiErrorWarningLine, RiLoader4Line, RiArrowRightSLine, RiLightbulbLine, RiFileTextLine, RiTerminalBoxLine, RiPencilLine, RiToolsLine } from '@remixicon/react';
import { Badge, Button, EmptyState, IconButton, Spinner } from './BoardPrimitives';
import { ApiError, errorText, type ExecutionLive, type HistoryReader, type Message, type MessageBodyPage, type MessageSource } from '../api';
import { dateTime, useResource } from '../hooks';
import { executionItems, toolState, type ToolItem } from '../execution-items';
import { mdiCheck, mdiAlertCircle, mdiLoading, mdiChevronRight, mdiHeadLightbulb, mdiFileDocumentOutline, mdiConsoleLine, mdiPencil, mdiMagnify, mdiWrenchOutline } from '@mdi/js';
import { ThreeLineMessage } from './ThreeLineMessage';
import { PiIcon } from './PiIcon';
import { codeLanguage, highlightedLines } from './PiPresentation';
import '../styles/execution-groups.css';

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
export function Pagination({ offset, total, nextOffset, onPage, loading, pageSize = 20 }: { offset: number; total: number; nextOffset?: number | null; onPage: (offset: number) => void; loading?: boolean; pageSize?: number }) {
  return <nav className="pagination" aria-label="分页"><span>共 {total} 条{total > 0 && ` · 第 ${Math.floor(offset / pageSize) + 1} 页`}</span><div>
    <Button variant="secondary" disabled={!offset || loading} onClick={() => onPage(Math.max(0, offset - pageSize))}>上一页</Button>
    <Button variant="secondary" disabled={nextOffset == null || loading} onClick={() => nextOffset != null && onPage(nextOffset)}>下一页</Button>
  </div></nav>;
}
// Stable component identities preserve focused links when scrolling or polling
// rerenders the transcript. Inline renderer functions remount their DOM nodes.
const markdownComponents: Components = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ src, alt }) => <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">查看图片：{alt || '附件'}</a>,
};
export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</ReactMarkdown></div>;
}

function MessageProvenance({ source }: { source?: MessageSource }) {
  return source ? <details className="message-source"><summary>查看记录来源</summary><dl>
    <dt>Pi 会话</dt><dd><code>{source.sessionId}</code></dd><dt>历史条目</dt><dd><code>{source.entryId}</code></dd>
    {source.callId && <><dt>工具调用</dt><dd><code>{source.callId}</code></dd></>}
  </dl></details> : null;
}
function MessageBody({ message, history, plain = false, showSource = true, disclosure, onUnavailable, formatText }: { formatText?: (text: string, offset: number) => ReactNode; onUnavailable?: () => void; message: Message; history?: HistoryReader; plain?: boolean; showSource?: boolean; disclosure?: { kind: 'input' | 'output'; name: string; state?: string } }) {
  const [bodyOpen, setBodyOpen] = useState(false);
  const [bodyOpened, setBodyOpened] = useState(false);
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
  const forbidden = query.error instanceof ApiError && ([401, 403, 404].includes(query.error.status) || query.error.code === 'SESSION_RESOURCE_UNAVAILABLE');
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) { setDenied(true); onUnavailable?.(); } }, [forbidden]);
  // Only a fresh successful read of this same page clears revocation. Resetting
  // to the cached first fragment would reveal text without rechecking access.
  useEffect(() => { if (query.updatedAt && !query.error) setDenied(false); }, [query.updatedAt]);
  const needsLatest = denied && query.error instanceof ApiError && query.error.status === 409;
  if (forbidden || denied) return <>
    {query.error ? <Notice error={query.error} onRetry={needsLatest ? undefined : query.refresh} /> : <p className="message-scope">正文暂不可读。</p>}
    {needsLatest && (history?.onRecover ? <Button variant="secondary" onClick={history.onRecover}>获取最新记录</Button> : <p className="message-scope">请重新获取执行记录后查看正文。</p>)}
    {query.loading ? <Loading>正在重新核验正文访问权限…</Loading> : !query.error && <Button variant="ghost" onClick={query.refresh}>重新获取</Button>}
  </>;
  const body = <>
    {query.error && <Notice error={query.error} stale={!!page} onRetry={reset} />}
    {offset && !page ? query.loading ? <Loading>正在读取正文…</Loading> : <p className="message-scope">这一段正文暂不可读，可回到首段重新获取。</p>
      : plain && formatText ? formatText(text || '', offset) : plain ? <pre className="tool-content" tabIndex={0}><code>{text || '此记录没有可展示的文字。'}</code></pre> : message.role === 'user' ? <ThreeLineMessage key={offset} text={text || ''}><Markdown text={text || ''} /></ThreeLineMessage> : <Markdown text={text || ''} />}
    {((nextOffset != null && history) || offset > 0) && <nav className="body-pagination" aria-label="正文分页">
      <span>{text !== undefined ? `正文 ${text.length ? offset + 1 : offset}–${offset + text.length}${total !== undefined ? ` / ${total}` : ''}` : '正文读取中'}</span><div>
        <Button variant="ghost" disabled={!offset} onClick={() => setCursor(previous => ({ ...previous, offsets: previous.offsets.slice(0, -1) }))}>上一段</Button>
        <Button variant="ghost" disabled={nextOffset == null || query.loading || !revision} onClick={() => {
          if (nextOffset != null && revision) setCursor(previous => ({ offsets: [...previous.offsets, nextOffset], revision }));
        }}>下一段</Button>
      </div></nav>}
    {message.role !== 'tool' && (page?.redacted || message.redacted) && <p className="message-scope">敏感信息、未获权字段或非文字数据已省略。</p>}
    {message.truncated && (!history || message.textNextOffset == null) && <p className="message-scope">此条长记录的当前接口仅返回部分正文。</p>}
    {showSource && message.role !== 'tool' && <MessageProvenance source={page?.source || message.source} />}
  </>;
  if (!disclosure) return body;
  const lines = (text || '').split(/\r?\n/);
  const preview = disclosure.kind === 'input' ? (text || '').replace(/\s+/g, ' ').trim() : (lines.find(line => line.trim()) || '暂无输出。').trim();
  const limit = disclosure.kind === 'input' ? 90 : 110;
  const excerpt = preview.length > limit ? `${preview.slice(0, limit)}…` : preview;
  return <details className={`execution-tool-${disclosure.kind}`} open={bodyOpen} onToggle={event => {
    if (event.target !== event.currentTarget) return;
    setBodyOpen(event.currentTarget.open);
    if (event.currentTarget.open) setBodyOpened(true);
  }}>
    <summary><span className="sr-only">{disclosure.kind === 'input' ? '输入' : '输出'}：{disclosure.name} </span>
      {disclosure.kind === 'input' ? <><strong>{disclosure.name}</strong><span className="execution-tool-preview">（{excerpt || '暂无输入。'}）</span></> : <>{message.isError || message.status === 'error' ? <span className="execution-tool-state is-error">失败 · </span> : null}<span className="execution-tool-preview">{excerpt}</span>{lines.length > 1 && <span className="execution-tool-more">（本段另 {lines.length - 1} 行）</span>}</>}
      {disclosure.kind === 'output' && nextOffset != null && <span className="execution-tool-more"> · 可继续读取</span>}
      {disclosure.state && <span className={`execution-tool-state${['error', 'failed'].includes(disclosure.state) ? ' is-error' : ''}`}>{disclosure.state === 'pending' ? '等待结果' : states[disclosure.state]?.[0] || disclosure.state}</span>}
    </summary>
    {bodyOpened && body}
  </details>;

}

// Summaries use only already-redacted public input; never inspect raw Pi files.
function toolSummary(item: ToolItem): string {
  const name = (item.call || item.results[0]).toolName || '工具';
  if (!item.call || item.call.truncated) return name;
  try {
    const args = JSON.parse(item.call.text);
    const field = ['bash', 'pwsh'].includes(name) ? args.command : ['read', 'write', 'edit'].includes(name) ? args.path : ['grep', 'find'].includes(name) ? args.pattern || args.glob : undefined;
    return typeof field === 'string' ? `${['bash', 'pwsh'].includes(name) ? '$' : name} ${field.replace(/\s+/g, ' ').slice(0, 180)}` : name;
  } catch { return name; }
}

// Specialized read/bash presentation uses the same public body reader, so
// pagination, redaction and denied-read behavior still apply to every field.
function toolInputPresentation(name: string, text: string): ReactNode {
  try {
    const args = JSON.parse(text);
    const allowed = ['path', 'offset', 'limit'];
    if (!args || typeof args !== 'object' || Array.isArray(args) || (name === 'read' && Object.keys(args).some(key => !allowed.includes(key)))) throw new Error('generic');
    if (name === 'read' && typeof args.path === 'string') return <div className="pi-read-path"><code>{args.path}</code>{Number.isInteger(args.offset) && <small>从第 {args.offset} 行</small>}{Number.isInteger(args.limit) && <small>{args.limit} 行</small>}</div>;
    if (['bash', 'pwsh'].includes(name) && typeof args.command === 'string') {
      const timeout = typeof args.timeoutMs === 'number' ? args.timeoutMs / 1000 : args.timeout;
      return <div className="pi-shell-command"><span aria-hidden="true">$</span><code>{args.command}</code>{typeof timeout === 'number' && <small>(timeout: {timeout}s)</small>}</div>;
    }
  } catch { /* Unknown/public custom tools retain complete input. */ }
  return <pre className="tool-content"><code>{text}</code></pre>;
}
function plainOutputPresentation(text: string): ReactNode {
  const lines = text.split('\n');
  return <pre className="tool-content pi-plain-output"><code>{lines.map((line, index) => <span className="pi-code-line" key={index}><span>{line}{index < lines.length - 1 ? '\n' : ''}</span></span>)}</code></pre>;
}
function readOutputPresentation(text: string, offset: number, input?: string): ReactNode {
  let start = 1;
  let language: string | undefined;
  try { const args = JSON.parse(input || '{}'); language = codeLanguage(args.path); const n = args.offset; if (Number.isInteger(n) && n > 0) start = n; } catch { /* no supplied source offset */ }
  // Subsequent body pages use character offsets, not source line offsets.
  // Do not invent a line number when the preceding fragments are unavailable.
  const lines = highlightedLines(text, language);
  return <pre className="tool-content pi-read-output"><code>{lines.map((line, index) => <span className="pi-code-line" key={index}>{offset === 0 && <span className="pi-line-number" data-line={start + index} aria-hidden="true" />}<span>{line}{index < lines.length - 1 ? '\n' : ''}</span></span>)}</code></pre>;
}

function ToolActivity({ item, history, compact = false, disclosures }: { item: ToolItem; history?: HistoryReader; compact?: boolean; disclosures?: Map<string, boolean> }) {
  const [open, setOpen] = useState(() => disclosures?.get(item.id) ?? false);
  const [opened, setOpened] = useState(() => disclosures?.get(item.id) ?? false);
  const [summaryHidden, setSummaryHidden] = useState(false);
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!frame.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { for (const entry of entries) entry.target.classList.toggle('pi-offscreen', !entry.isIntersecting); });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const message = item.call || item.results[0];
  const result = item.results.at(-1);
  const state = toolState(item);
  const running = ['running', 'active'].includes(state);
  const failed = ['error', 'failed'].includes(state);
  const previousState = useRef(state);
  const [completionCue, setCompletionCue] = useState(false);
  useEffect(() => {
    if (['running', 'active'].includes(previousState.current) && !running && (failed || !!result)) setCompletionCue(true);
    previousState.current = state;
  }, [state, running, failed, result]);
  if (compact) return <article ref={frame} className={`message message-tool pi-tool-frame${running ? ' is-running' : ''}`} data-message-id={item.id}>
    <details className="pi-tool-step" open={open} onToggle={event => {
      if (event.target !== event.currentTarget) return;
      setOpen(event.currentTarget.open);
      disclosures?.set(item.id, event.currentTarget.open);
      if (event.currentTarget.open) setOpened(true);
    }}>
      <summary className={running ? 'pi-tool-shimmer' : undefined}>
        <span key={state} className={`pi-tool-status${completionCue ? ' pi-motion-cue' : ''}${running ? ' is-running' : failed ? ' is-error' : result ? ' is-complete' : ''}`} aria-hidden="true">{running ? <PiIcon path={mdiLoading} size={14} /> : failed ? <PiIcon path={mdiAlertCircle} size={14} /> : result ? <PiIcon path={mdiCheck} size={14} /> : <span>·</span>}</span>
        <span className="pi-tool-title">{summaryHidden ? message.toolName || '工具' : toolSummary(item)}</span>
        {!result && <span className="pi-tool-state">{states[state]?.[0] || state}</span>}
        <PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} />
      </summary>
      {opened && <div className={`pi-tool-body${['read', 'bash', 'pwsh'].includes(message.toolName || '') ? ' pi-specialized-tool' : ''}`}>
        <section className="tool-part"><h4>输入</h4>{item.call ? <MessageBody message={item.call} history={history} plain formatText={['read', 'bash', 'pwsh'].includes(message.toolName || '') ? text => toolInputPresentation(message.toolName!, text) : undefined} onUnavailable={() => setSummaryHidden(true)} /> : <span className="execution-tool-missing">{item.inputElsewhere ? '输入见上方调用。' : '本页无输入记录。'}</span>}</section>
        {item.results.map(output => <section className="tool-part" key={output.id}><h4>输出</h4><MessageBody message={output} history={history} plain formatText={message.toolName === 'read' ? (text, offset) => readOutputPresentation(text, offset, item.call?.text) : text => plainOutputPresentation(text)} onUnavailable={() => setSummaryHidden(true)} /></section>)}
        {!result && <section className="tool-part"><h4>输出</h4><span className="execution-tool-missing">{item.resultStatus ? '见下方结果。' : '尚无结果。'}</span></section>}
      </div>}
    </details>
  </article>;
  return <article className="message message-tool">
    <div className="message-meta"><span className="message-avatar" aria-hidden="true" /><strong>{message.toolName || '工具'}</strong>
      {message.createdAt && <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
      {state === 'pending' ? <Badge tone="neutral">等待结果</Badge> : <Status value={state} />}
    </div>
    <div className="message-body"><details className="tool-message" open={open} onToggle={event => {
      if (event.target !== event.currentTarget) return;
      setOpen(event.currentTarget.open);
      disclosures?.set(item.id, event.currentTarget.open);
      if (event.currentTarget.open) setOpened(true);
    }}>
      <summary>{item.call ? '查看工具输入与结果' : '查看工具结果'}</summary>
      {opened && <>
        <section className="tool-part"><h4>输入</h4>{item.call ? <MessageBody message={item.call} history={history} plain />
          : <p className="message-scope">{item.inputElsewhere ? '见上方调用。' : '本页无输入记录。'}</p>}</section>
        {item.results.map(output => <section className="tool-part" key={output.id}><h4>输出 {output.isError || output.status === 'error' ? '· 失败' : ''}</h4><MessageBody message={output} history={history} plain formatText={message.toolName === 'read' ? (text, offset) => readOutputPresentation(text, offset, item.call?.text) : text => plainOutputPresentation(text)} onUnavailable={() => setSummaryHidden(true)} /></section>)}
        {!result && <section className="tool-part"><h4>输出</h4><p className="message-scope">{item.resultStatus ? '见下方结果。' : '尚无结果。'}</p></section>}
      </>}
    </details></div>
  </article>;
}
function ToolActivityGroup({ tools, history, compact = false, anchorId, disclosures }: { tools: ToolItem[]; history?: HistoryReader; compact?: boolean; anchorId?: string; disclosures?: Map<string, boolean> }) {
  const [open, setOpen] = useState(() => tools.some(tool => disclosures?.get(tool.id)));
  const previousTools = useRef(new Set(tools.map(tool => tool.id)));
  useEffect(() => {
    if (tools.some(tool => !previousTools.current.has(tool.id) && disclosures?.get(tool.id))) setOpen(true);
    previousTools.current = new Set(tools.map(tool => tool.id));
  }, [tools, disclosures]);
  const failures = tools.filter(item => ['error', 'failed'].includes(toolState(item))).length;
  const categories: Record<string, string> = { read: '读取', read_window: '读取', read_image: '读取',
    bash: '脚本', pwsh: '脚本', grep: '检索', find: '检索', web_search: '搜索', web_fetch: '网页', write: '写入', edit: '编辑' };
  const counts = new Map<string, number>();
  for (const item of tools) {
    const name = (item.call || item.results[0]).toolName || '工具';
    const label = Object.hasOwn(categories, name) ? categories[name] : name;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const summary = [...counts].map(([label, count]) => `${label} ${count} 次`).join(' · ');
  return <details className="execution-tool-group" data-message-id={anchorId} open={open} onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary>{compact ? <PiIcon path={mdiCheck} className="pi-tool-status is-complete" size={14} /> : <span className="execution-tool-group-chevron" aria-hidden="true">›</span>}<span className="pi-tool-count">{tools.length} 项工具调用</span><span className="execution-tool-group-summary sr-only">{summary}</span><span className="pi-tool-breakdown">{[...counts].map(([label, count]) => { const icon = label === '读取' ? mdiFileDocumentOutline : label === '脚本' ? mdiConsoleLine : label === '编辑' || label === '写入' ? mdiPencil : label === '检索' || label === '搜索' ? mdiMagnify : mdiWrenchOutline; return <span key={label} title={label} aria-label={`${label} ${count} 次`}><PiIcon path={icon} size={12} /><span>{count}</span></span>; })}</span><span className="sr-only">，共 {tools.length} 项工具调用与脚本执行</span>{failures > 0 && (compact ? <span className="execution-tool-state is-error">{failures} 项失败</span> : <Badge tone="danger">{failures} 项失败</Badge>)}<PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} /><span className={compact ? 'sr-only' : 'execution-tool-group-action'}>{open ? '收起' : '展开'}</span></summary>
    <div className="execution-tool-group-items">{tools.map(item => <ToolActivity key={item.id} item={item} history={history} compact={compact} disclosures={disclosures} />)}</div>
  </details>;
}
type OlderHistory = {hasMore: boolean; loading: boolean; error: Error | null; disabled: boolean; onLoad: () => void};
function LiveElapsed({startedAt}: {startedAt?: string}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!startedAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [startedAt]);
  const start = Date.parse(startedAt || '');
  return Number.isFinite(start) ? <span className="pi-live-elapsed">{Math.max(0, Math.floor((now - start) / 1000))}s</span> : null;
}
function LivePhase({live}: {live?: ExecutionLive}) {
  if (!live?.active || !live.phase) return null;
  const labels = {waiting: '等待模型响应', thinking: '思考中', text: '生成中', tool: '工具执行中'};
  return <div className={`pi-live-phase phase-${live.phase}`} role="status"><PiIcon path={mdiLoading} className="pi-live-spinner" size={14} /><span>{labels[live.phase]}</span><LiveElapsed startedAt={live.phaseStartedAt} /></div>;
}
function ThinkingMessage({message, history, compact, live}: {message: Message; history?: HistoryReader; compact: boolean; live?: ExecutionLive}) {
  const [open, setOpen] = useState(!!message.transient);
  const isThinking = !!message.transient && live?.active && live.phase === 'thinking';
  return <details className="thinking-message" open={open} onToggle={event => {if(event.target === event.currentTarget)setOpen(event.currentTarget.open);}}><summary><span>{isThinking ? '思考中' : '模型思考'}</span>{isThinking && <LiveElapsed startedAt={live?.phaseStartedAt} />}<PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} /></summary><MessageBody message={message} history={history} showSource={!compact} /></details>;
}

export function MessageList({ messages, pending, empty, footer, userLabel = '你', history, onInspect, inspectedId, presentation = 'chat', older, live }: { live?: ExecutionLive; presentation?: 'chat' | 'execution'; inspectedId?: string; messages: Message[]; pending?: boolean; empty?: ReactNode; footer?: ReactNode; userLabel?: string; history?: HistoryReader; onInspect?: (message: Message, trigger: HTMLButtonElement) => void; older?: OlderHistory }) {
  const disclosures = useRef(new Map<string, boolean>()).current;
  const brand = useAssistantBrand();
  const compact = presentation === 'execution';
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const items = useMemo(() => executionItems(messages), [messages]);
  // A prepend can extend the first tool group. Reuse its existing key so an
  // expanded group and its nested input/output disclosures stay open.
  const groupKeys = useRef(new Map<string, string>());
  const keyedItems = useMemo(() => {
    const next = new Map<string, string>();
    const keyed = items.map(item => {
      if (item.kind !== 'tool-group') return {item, key: item.kind === 'message' ? item.message.id : item.id};
      const key = item.tools.map(tool => groupKeys.current.get(tool.id)).find(Boolean) || `group:${item.id}`;
      for (const tool of item.tools) next.set(tool.id, key);
      return {item, key};
    });
    groupKeys.current = next;
    return keyed;
  }, [items]);
  const anchor = useRef<{id?: string; top: number; height: number; scroll: number} | null>(null);
  const captureAnchor = () => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => {
      const bounds = node.matches('details[open]') ? node.querySelector('summary')?.getBoundingClientRect() : node.getBoundingClientRect();
      return bounds && bounds.height > 0 && bounds.bottom > top;
    });
    anchor.current = {id: row?.dataset.messageId, top: row ? row.getBoundingClientRect().top - top : 0, height: el.scrollHeight, scroll: el.scrollTop};
  };
  const loadOlder = () => { if (older?.hasMore && !older.loading && !older.error && !older.disabled) older.onLoad(); };
  const signature = messages.map(message => `${message.id}:${message.text.length}:${message.status || ''}`).join(',');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (following.current) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    else if (older && anchor.current) {
      const saved = anchor.current;
      const row = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === saved.id && node.getBoundingClientRect().height > 0);
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.top;
      else element.scrollTop = saved.scroll + element.scrollHeight - saved.height;
    }
    captureAnchor();
  }, [signature, pending]);
  useEffect(() => {
    const element = ref.current;
    // Collapsed tool runs can turn 200 records into only a few lines. Fill the
    // viewport with older history rather than leaving a nearly empty reader.
    if (element && element.scrollHeight <= element.clientHeight + 120) loadOlder();
  }, [signature, older?.loading, older?.hasMore, older?.disabled]);
  useEffect(() => {
    const element = ref.current;
    if (!compact || !element) return;
    let width = element.clientWidth, height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight) return;
      width = element.clientWidth; height = element.clientHeight;
      if (following.current) element.scrollTop = element.scrollHeight;
      else if (anchor.current) {
        const saved = anchor.current;
        const row = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === saved.id);
        if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.top;
      }
      captureAnchor();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);
  useEffect(() => {
    const element = ref.current;
    if (!compact || !element) return;
    const changed = () => {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
      setShowLatest(!following.current); captureAnchor();
      if (element.scrollHeight <= element.clientHeight + 120) loadOlder();
    };
    element.addEventListener('toggle', changed, true);
    return () => element.removeEventListener('toggle', changed, true);
  }, [compact, older?.loading, older?.hasMore, older?.error, older?.disabled]);
  const latest = () => { following.current = true; setShowLatest(false); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'instant' }); };
  return <div className={`transcript-wrap${compact ? ' execution-transcript' : ''}`}><div className="transcript" ref={ref} onScroll={() => {
    const el = ref.current!; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < (compact ? 60 : 90); setShowLatest(!following.current);
    captureAnchor();
    if (el.scrollTop < 160) loadOlder();
  }} role="region" aria-label="消息记录" tabIndex={0}>
    <div className={`message-column${messages.length || live?.active ? '' : ' is-empty'}`}>
      {older && messages.length > 0 && <div className="execution-history-start" role="status">{older.error ? <Notice error={older.error} onRetry={older.onLoad} /> : older.loading ? '正在载入更早记录…' : older.hasMore ? '向上滚动载入更早记录' : '已到当前上下文的开始'}</div>}
      {!messages.length ? (live?.active ? null : empty ?? <EmptyState title="暂无消息" />) : keyedItems.map(({item, key}) => {
        if (item.kind === 'tool-group') return <ToolActivityGroup key={key} anchorId={key} tools={item.tools} history={history} compact={compact} disclosures={disclosures} />;
        if (item.kind === 'tool') return <ToolActivity key={item.id} item={item} history={history} compact={compact} disclosures={disclosures} />;
        const message = item.message;
        return <article data-message-id={message.id} className={`message message-${message.role}${message.transient ? ' pi-live-message' : ''}${message.transient && live?.active && ((message.kind === 'thinking' && live.phase === 'thinking') || (message.kind !== 'thinking' && live.phase === 'text')) ? ' pi-model-streaming' : ''}${onInspect ? ' message-inspectable' : ''}`} key={message.id} onClick={onInspect ? event => {
          // Markdown contains links and disclosures: preserve their actions and text selection.
          // The visually hidden native button makes the bubble keyboard accessible without adding a separate action label.
          const target = event.target as HTMLElement;
          if (!target.closest('.message-body') || target.closest('a,button,summary,details,input,textarea,select') || window.getSelection()?.toString()) return;
          const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.message-process-trigger');
          if (trigger) onInspect(message, trigger);
        } : undefined}>
          {compact ? <div className="execution-message-role"><span className="sr-only">{message.role === 'assistant' ? '助手' : message.senderName || userLabel}</span>{message.status && ['error', 'failed', 'aborted', 'length'].includes(message.status) && <span className="execution-tool-state is-error">{states[message.status]?.[0] || message.status}</span>}</div> : <div className="message-meta"><span className={`message-avatar ${message.role === 'assistant' ? 'bot-avatar' : ''}`}>{message.role === 'assistant' ? (brand.icon === 'moon' ? 'N' : brandGlyph(brand.icon)) : (message.senderName?.slice(0, 1) || userLabel.slice(0, 1))}</span>
            <strong>{message.role === 'assistant' ? brand.name : (message.senderName || userLabel)}</strong>
            {message.createdAt && <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
            {message.status && message.status !== 'delivered' && message.status !== 'sent' && <Status value={message.status} />}
          </div>}
          <div className="message-body">{onInspect && <button type="button" className="message-process-trigger sr-only" aria-haspopup="dialog" aria-expanded={inspectedId === message.id} aria-label={`查看消息处理过程：${message.text.slice(0, 40) || '无正文消息'}`} onClick={event => onInspect(message, event.currentTarget)}>处理过程</button>}{message.kind === 'thinking' ? <ThinkingMessage message={message} history={history} compact={compact} live={live} /> : <MessageBody message={message} history={history} showSource={!compact} />}</div>
        </article>;
      })}
      {live?.active && !(live.phase === 'thinking' && messages.some(message => message.transient && message.kind === 'thinking')) && <LivePhase live={live} />}
      {pending && <div className="thinking" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>Bot 正在处理，完成后会更新回复</div>}
      {footer}
    </div>
  </div>{showLatest && <Button className="jump-latest" variant="secondary" icon={compact ? undefined : <RiArrowDownLine size={16} />} onClick={latest}>回到最新消息</Button>}</div>;
}
