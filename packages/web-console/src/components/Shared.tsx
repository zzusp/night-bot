import {useReadFailure} from './ReadErrors';
import {useAssistantBrand, brandGlyph} from './AssistantBrand';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RiTimeLine, RiArrowDownLine, RiRefreshLine, RiSearchLine, RiCloseLine, RiCheckLine, RiErrorWarningLine, RiLoader4Line, RiArrowRightSLine, RiLightbulbLine, RiFileTextLine, RiTerminalBoxLine, RiPencilLine, RiToolsLine } from '@remixicon/react';
import { Badge, Button, EmptyState, IconButton, Spinner } from './BoardPrimitives';
import { ApiError, errorText, operationErrorText, type ExecutionLive, type HistoryReader, type Message, type MessageBodyPage, type MessageSource } from '../api';
import { dateTime, useResource } from '../hooks';
import { executionItems, toolState, type ExecutionItem, type ToolItem } from '../execution-items';
import { mdiCheck, mdiAlertCircle, mdiLoading, mdiChevronRight, mdiHeadLightbulb, mdiFileDocumentOutline, mdiConsoleLine, mdiPencil, mdiMagnify, mdiWrenchOutline } from '@mdi/js';
import { ThreeLineMessage } from './ThreeLineMessage';
import { executionTurns, type ExecutionTurn } from '../execution-turns';
import '../styles/execution-turns.css';
import { PiIcon } from './PiIcon';
import { codeLanguage, highlightedLines } from './PiPresentation';
import {EditDiff} from './EditDiff';
import {parsePiEditDiff, requestedEditRows} from '../edit-diff';
import '../styles/execution-groups.css';
import '../styles/pi-web-tools.css';
import {mergeResidentTaskAction, residentTaskActionLabel, type ResidentAction} from '../resident-activity-presentation';
import {toolDetailNotice, type ToolDetailPhase} from '../tool-detail-state';
import {sameTodoCounts, taskToolPresentation, todoReceiptCounts} from '../task-tool-presentation';
import {mergeResidentPlan, pairedPublicResult, residentInputRemainder, wholeToolMessage, type ResidentPlan} from '../resident-tool-content';
import SpecializedToolContent, {hasSpecializedToolContent, specializedToolLabel, specializedToolSummary} from './SpecializedToolContent';

const states: Record<string, [string, 'neutral' | 'success' | 'warning' | 'danger' | 'info']> = {
  running: ['执行中', 'info'], active: ['进行中', 'info'], queued: ['排队中', 'neutral'], pending: ['处理中', 'info'],
  'result-unrecorded': ['结果未记录', 'neutral'],
  accepted: ['已接纳', 'neutral'], completed: ['已完成', 'success'], complete: ['已完成', 'success'], done: ['已完成', 'success'],
  waiting: ['等待中', 'warning'], interrupted: ['执行中断', 'warning'], inactive: ['未运行', 'neutral'], blocked: ['受阻', 'warning'], failed: ['失败', 'danger'], error: ['失败', 'danger'],
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
export function Notice({ error, onRetry, stale = false, message, read, title, source }: { error: unknown; onRetry?: () => void; stale?: boolean; message?: string; read?: boolean; title?: string; source?: string }) {
  const grouped=useReadFailure({error,retry:onRetry,stale,message,title,source}, read ?? !!onRetry);
  if ((read ?? !!onRetry) && grouped) return null;
  return <div className="notice" role="alert"><span>{title && <strong>{title}。 </strong>}{stale ? '当前显示上次获取的数据。' : ''}{message ?? ((read ?? !!onRetry) ? errorText(error) : operationErrorText(error))}</span>
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
  const forbidden = query.error instanceof ApiError && ([401, 403, 404].includes(query.error.status) || query.error.code === 'SESSION_RESOURCE_UNAVAILABLE' || (message.resourceContent === true && query.error.status === 409));
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) { setDenied(true); onUnavailable?.(); } }, [forbidden]);
  // Only a fresh successful read of this same page clears revocation. Resetting
  // to the cached first fragment would reveal text without rechecking access.
  useEffect(() => { if (query.updatedAt && !query.error) setDenied(false); }, [query.updatedAt]);
  const needsLatest = (forbidden || denied) && query.error instanceof ApiError && query.error.status === 409;
  if (forbidden || denied) return <>
    {query.error ? <Notice read error={query.error} onRetry={needsLatest ? history?.onRecover : query.refresh} /> : <p className="message-scope">正文暂不可读。</p>}
    {needsLatest && !history?.onRecover && <p className="message-scope">请重新获取执行记录后查看正文。</p>}
    {query.loading ? <Loading>正在重新核验正文访问权限…</Loading> : !query.error && <Button variant="ghost" onClick={query.refresh}>重新获取</Button>}
  </>;
  const body = <>
    {query.error && <Notice read error={query.error} stale={!!page} onRetry={reset} />}
    {offset && !page ? query.loading ? <Loading>正在读取正文…</Loading> : query.error ? null : <p className="message-scope">这一段正文暂不可读，可回到首段重新获取。</p>
      : plain && formatText ? formatText(text || '', offset) : plain ? <pre className="tool-content" tabIndex={0}><code>{text || '此记录没有可展示的文字。'}</code></pre> : message.role === 'user' ? <ThreeLineMessage key={offset} text={text || ''} collapsedLabel={message.kind === 'scheduled-trigger' ? '显示更多' : undefined}><Markdown text={text || ''} /></ThreeLineMessage> : <Markdown text={text || ''} />}
    {!offset && !!message.attachments?.length && <ul className="message-attachments" aria-label="附件">{message.attachments.map((attachment, index) => <li key={index}>{attachment.name}</li>)}</ul>}
    {((nextOffset != null && history) || offset > 0) && <nav className="body-pagination" aria-label="正文分页">
      <span>{text !== undefined ? `正文 ${text.length ? offset + 1 : offset}–${offset + text.length}${total !== undefined ? ` / ${total}` : ''}` : '正文读取中'}</span><div>
        <Button variant="ghost" disabled={!offset} onClick={() => setCursor(previous => ({ ...previous, offsets: previous.offsets.slice(0, -1) }))}>上一段</Button>
        <Button variant="ghost" disabled={nextOffset == null || query.loading || !revision} onClick={() => {
          if (nextOffset != null && revision) setCursor(previous => ({ offsets: [...previous.offsets, nextOffset], revision }));
        }}>下一段</Button>
      </div></nav>}
    {message.role !== 'tool' && (page?.redacted || message.redacted) && <p className="message-scope">敏感信息、未获权字段或非文字数据已省略。</p>}
    {message.truncated && (offset === 0 || nextOffset != null) && <p className="message-scope">{history && nextOffset != null ? '当前显示部分内容。' : '此条长记录的当前接口仅返回部分正文。'}</p>}
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

// Adapted from agegr/pi-web MessageView.tsx at 432366bd (MIT © 2026 agegr).
// See licenses/pi-web-MIT.txt. Only the authorized public DTO is rendered here.
function toolObject(item: ToolItem): string {
  const name = (item.call || item.results[0]).toolName || '';
  const result = item.results.at(-1);
  if (name === 'skill' && result?.toolName === 'skill' && result.resourceContent === true && result.skillName
    && result.status === 'completed' && !result.isError) return result.skillName;
  if (name === 'resident_task_action') return residentTaskActionLabel(item.call) ?? specializedToolLabel(name);
  if (hasSpecializedToolContent(name)) return specializedToolLabel(name) || '';
  if (!item.call || item.call.truncated || item.call.textNextOffset != null) return '';
  try {
    const args = JSON.parse(item.call.text);
    const field = ['bash', 'pwsh'].includes(name) ? args.command
      : ['read', 'read_window', 'read_image', 'write', 'edit'].includes(name) ? args.path
      : ['grep', 'find'].includes(name) ? args.pattern || args.glob
      : name === 'web_fetch' ? args.url : undefined;
    return typeof field === 'string' ? field.replace(/\s+/g, ' ').slice(0, 180) : '';
  } catch { return ''; }
}

function ToolElapsed({ item, running }: { item: ToolItem; running: boolean }) {
  const recorded = item.timing?.durationMs;
  const started = item.timing?.startedAt;
  const [elapsed, setElapsed] = useState<number | undefined>();
  useEffect(() => {
    setElapsed(undefined);
    if (!running || !started) return;
    const timestamp = Date.parse(started);
    if (!Number.isFinite(timestamp)) return;
    const initial = Math.max(0, Date.now() - timestamp);
    const clock = performance.now();
    const tick = () => setElapsed(initial + performance.now() - clock);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running, started]);
  const ms = running ? elapsed : recorded;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  const label = ms < 100 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : seconds < 3600
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
  return <span className="pi-web-tool-duration" aria-label={`${running ? '已用时' : '用时'} ${label}`}>{label}</span>;
}

function toolFieldsPresentation(args: Record<string, unknown>): ReactNode {
  return <table className="pi-web-tool-fields"><tbody>{Object.entries(args).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return <tr key={key}><th scope="row">{key}</th><td>{text?.includes('\n')
      ? <pre className="tool-content" tabIndex={0}><code>{text}</code></pre> : <code>{text}</code>}</td></tr>;
  })}</tbody></table>;
}
function toolInputPresentation(name: string, text: string, complete: boolean): ReactNode {
  if (!complete) return plainOutputPresentation(text);
  try {
    const args = JSON.parse(text);
    if (!args || typeof args !== 'object' || Array.isArray(args)) return plainOutputPresentation(text);
    const keys = Object.keys(args);
    if (['read', 'read_window'].includes(name) && typeof args.path === 'string' && keys.every(key => ['path', 'offset', 'limit'].includes(key))) {
      return <div className="pi-read-path"><code>{args.path}</code>{Number.isInteger(args.offset) && <small>从第 {args.offset} 行</small>}{Number.isInteger(args.limit) && <small>{args.limit} 行</small>}</div>;
    }
    if (['bash', 'pwsh'].includes(name) && typeof args.command === 'string') {
      const timeout = typeof args.timeoutMs === 'number' ? args.timeoutMs / 1000 : args.timeout;
      const extra = Object.fromEntries(Object.entries(args).filter(([key]) => !['command', 'timeoutMs', 'timeout', 'description'].includes(key)));
      return <><div className="pi-shell-command"><span aria-hidden="true">$</span><code>{args.command}</code>{typeof timeout === 'number' && <small>(timeout: {timeout}s)</small>}</div>{typeof args.description === 'string' && args.description.trim() && args.description.trim() !== args.command.trim() && <p className="pi-shell-description">{args.description}</p>}{Object.keys(extra).length > 0 && toolFieldsPresentation(extra)}</>;
    }
    if (name === 'write' && typeof args.path === 'string' && typeof args.content === 'string' && keys.every(key => ['path', 'content'].includes(key))) {
      return <><div className="pi-read-path"><code>{args.path}</code></div>{readOutputPresentation(args.content, 0, text)}</>;
    }
    if (name === 'edit' && typeof args.path === 'string' && Array.isArray(args.edits) && args.edits.length > 0
      && keys.every(key => ['path', 'edits'].includes(key)) && args.edits.every((edit: unknown) => edit && typeof edit === 'object'
        && Object.keys(edit).every(key => ['oldText', 'newText'].includes(key)) && typeof (edit as {oldText?: unknown}).oldText === 'string' && typeof (edit as {newText?: unknown}).newText === 'string')) {
      return <><div className="pi-read-path"><code>{args.path}</code><small>请求修改</small></div>
        <div className="pi-web-edit-list">{args.edits.map((edit: {oldText: string; newText: string}, index: number) => {
          const rows = requestedEditRows(edit.oldText, edit.newText);
          return <div key={index}>{args.edits.length > 1 && <p className="pi-web-edit-label">第 {index + 1} 处</p>}
            {rows?.length ? <EditDiff rows={rows} path={args.path} applied={false} /> : toolFieldsPresentation(edit)}</div>;
        })}</div></>;
    }
    return keys.length ? toolFieldsPresentation(args) : <pre className="tool-content"><code>{text}</code></pre>;
  } catch { return plainOutputPresentation(text); }
}
function plainOutputPresentation(text: string): ReactNode {
  const lines = text.split('\n');
  return <pre className="tool-content pi-plain-output" tabIndex={0}><code>{lines.map((line, index) => <span className="pi-code-line" key={index}><span>{line}{index < lines.length - 1 ? '\n' : ''}</span></span>)}</code></pre>;
}
function readOutputPresentation(text: string, offset: number, input?: string): ReactNode {
  let start = 1;
  let language: string | undefined;
  try { const args = JSON.parse(input || '{}'); language = codeLanguage(args.path); const n = args.offset; if (Number.isInteger(n) && n > 0) start = n; } catch { /* no supplied source offset */ }
  // Body page offsets count characters, not source lines. Never invent a line.
  const lines = highlightedLines(text, language);
  return <pre className="tool-content pi-read-output" tabIndex={0}><code>{lines.map((line, index) => <span className="pi-code-line" key={index}>{offset === 0 && <span className="pi-line-number" data-line={start + index} aria-hidden="true" />}<span>{line}{index < lines.length - 1 ? '\n' : ''}</span></span>)}</code></pre>;
}
function isAppliedEditResult(output: Message) {
  return output.editDiff === true && output.toolName === 'edit' && output.status === 'completed' && !output.isError
    && !output.transient && !output.truncated && output.textNextOffset == null;
}

function isGuidanceDocument(output?: Message): boolean {
  return output?.toolName === 'communication_guidance_read' && output.resourceContent === true
    && output.status === 'completed' && !output.isError && !output.transient;
}

function toolOutputPresentation(name: string, text: string, offset: number, output: Message, input?: string, plan?: ResidentPlan | null, action?: ResidentAction | null): ReactNode {
  if (name === 'communication_guidance_read' && isGuidanceDocument(output)) {
    return <div className="pi-tool-document"><Markdown text={text} /></div>;
  }
  if (hasSpecializedToolContent(name)) return <SpecializedToolContent toolName={name} phase="output" text={text} offset={offset} status={output.status} isError={output.isError || ['error','failed'].includes(output.status || '')} complete={wholeToolMessage(output)} plan={offset === 0 ? plan : undefined} action={offset === 0 ? action : undefined} />;
  if (!output.isError && !['error', 'failed'].includes(output.status || '') && ['read', 'read_window'].includes(name)) return readOutputPresentation(text, offset, input);
  if (name === 'edit' && offset === 0 && isAppliedEditResult(output)) {
    const rows = parsePiEditDiff(text);
    if (rows) {
      let path: string | undefined;
      try {const candidate = JSON.parse(input || '{}')?.path; if (typeof candidate === 'string') path = candidate;} catch { /* no approved source path */ }
      return <EditDiff rows={rows} path={path} applied />;
    }
  }
  return plainOutputPresentation(text);
}

const shellToolNames = ['bash', 'pwsh'];
const showsResourceContent = (item: ToolItem) => item.results.some(result => result.resourceContent === true && !result.isError && !!result.text.trim());
const foldedResourceTools = new Set(['skill', 'memory_read', 'communication_guidance_read']);
const defaultToolOpen = (item: ToolItem, disclosures?: Map<string, boolean>) => disclosures?.get(item.id)
  ?? (!foldedResourceTools.has((item.call || item.results[0]).toolName ?? '') && showsResourceContent(item));

function ToolDetailState({phase, text}: {phase: ToolDetailPhase; text: string}) {
  return <p className="pi-tool-detail-state"><strong>{phase === 'input' ? '输入' : '输出'}</strong><span>{text}</span></p>;
}

function ToolActivity({ item, history, compact = false, disclosures, onRecordUnavailable }: { item: ToolItem; history?: HistoryReader; compact?: boolean; disclosures?: Map<string, boolean>; onRecordUnavailable?: (id: string) => void }) {
  const [manualOpen, setOpen] = useState(() => disclosures?.get(item.id));
  const open = manualOpen ?? defaultToolOpen(item);
  const [opened, setOpened] = useState(open);
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
  const name = message.toolName || '工具';
  const shell = shellToolNames.includes(name);
  const state = toolState(item);
  const running = ['running', 'active'].includes(state);
  const receipt = summaryHidden ? null : specializedToolSummary(name, result);
  const failed = ['error', 'failed'].includes(state) || receipt?.tone === 'danger';
  const complete = !!(result || item.resultStatus) && (!receipt || receipt.tone === 'success');
  const previousState = useRef(state);
  const [completionCue, setCompletionCue] = useState(false);
  useEffect(() => {
    if (['running', 'active'].includes(previousState.current) && !running && (failed || !!result)) setCompletionCue(true);
    previousState.current = state;
  }, [state, running, failed, result]);
  const unavailable = (id: string) => { setSummaryHidden(true); onRecordUnavailable?.(item.id); if (id !== item.id) onRecordUnavailable?.(id); };
  const object = summaryHidden || failed ? '' : toolObject(item);
  let duplicateReadPath = false;
  if (object && ['read', 'read_window'].includes(name) && item.call && !item.call.truncated && item.call.textNextOffset == null) {
    try {
      const args = JSON.parse(item.call.text);
      duplicateReadPath = args?.path === object && Object.keys(args).length === 1;
    } catch { /* Non-structured or incomplete input stays visible. */ }
  }
  const duplicateResourceAction = name === 'skill' && showsResourceContent(item) && !item.call?.truncated
    && item.call?.textNextOffset == null && /^\{\s*"action"\s*:\s*"加载技能"\s*\}$/.test(item.call?.text.trim() || '');
  const outputs = item.results;
  const inputNotice = toolDetailNotice('input', item.call, {elsewhere: item.inputElsewhere});
  const appliedEdit = name === 'edit' && wholeToolMessage(item.call) && !inputNotice
    && outputs.length === 1 && isAppliedEditResult(outputs[0]) && !!parsePiEditDiff(outputs[0].text);
  const mergedPlan = !summaryHidden && name === 'resident_task_plan' && outputs.length === 1 ? mergeResidentPlan(item.call, outputs[0]) : null;
  const mergedAction = !summaryHidden && name === 'resident_task_action' && outputs.length === 1 ? mergeResidentTaskAction(item.call, outputs[0]) : null;
  const submittedTodo = name === 'todo_write' && wholeToolMessage(item.call) ? taskToolPresentation(name, item.call.text) : null;
  const todoReceipt = !summaryHidden && submittedTodo?.kind === 'todos' && item.call?.source?.sessionId && outputs.length === 1
    && pairedPublicResult(item.call,outputs[0]) ? todoReceiptCounts(outputs[0].text) : null;
  const todoRecorded = !!(submittedTodo?.kind === 'todos' && todoReceipt && sameTodoCounts(submittedTodo.counts,todoReceipt));
  const residentInput = !summaryHidden && outputs.length === 1 ? residentInputRemainder(item.call, outputs[0]) : null;
  const duplicateGuidanceScope = name === 'communication_guidance_read' && isGuidanceDocument(result) && wholeToolMessage(item.call)
    && /^\{\s*"scope"\s*:\s*"communication-guidance"\s*\}$/u.test(item.call.text.trim());
  const inputRepresented = !inputNotice && (mergedPlan || mergedAction || residentInput === '' || appliedEdit || duplicateResourceAction || duplicateReadPath || duplicateGuidanceScope);
  const outputNotice = !result && toolDetailNotice('output', undefined, {elsewhere: !!item.resultStatus, running});
  const label = receipt?.label || (state === 'completed' && complete ? '成功' : states[state]?.[0] || state);
  const statusIcon = running ? mdiLoading : failed ? mdiAlertCircle : complete ? mdiCheck : undefined;
  const statusClass = `pi-tool-status${running ? ' is-running' : failed ? ' is-error' : complete ? ' is-complete' : ''}`;
  const headerIcon = shell ? mdiConsoleLine : ['read', 'read_window', 'read_image'].includes(name)
    ? mdiFileDocumentOutline : ['write', 'edit'].includes(name) ? mdiPencil
    : ['find', 'grep', 'web_search'].includes(name) ? mdiMagnify : mdiWrenchOutline;
  return <article ref={frame} className={`message message-tool pi-tool-frame pi-web-tool-frame${compact ? ' is-compact' : ''}${running ? ' is-running' : ''}`} data-message-id={item.id} data-record-ids={[item.id, ...item.results.map(output => output.id)].join(' ')}>
    <details className={`pi-tool-step pi-web-tool-card${shell ? ' is-shell' : ''}${failed ? ' is-error' : receipt?.tone === 'neutral' ? ' is-neutral' : receipt?.tone === 'warning' ? ' is-warning' : ''}`} open={open} onToggle={event => {
      if (event.target !== event.currentTarget || !(event.currentTarget instanceof HTMLDetailsElement) || event.currentTarget.open === open) return;
      setOpen(event.currentTarget.open);
      disclosures?.set(item.id, event.currentTarget.open);
      if (event.currentTarget.open) setOpened(true);
    }}>
      <summary className={`pi-web-tool-summary${running ? ' pi-tool-shimmer' : ''}`}>
        <span key={state} className={`pi-web-tool-glyph${running || failed ? ` ${statusClass}` : ''}${completionCue ? ' pi-motion-cue' : ''}`} aria-hidden="true"><PiIcon path={(running || failed) && statusIcon ? statusIcon : headerIcon} size={14} /></span>
        <span className="pi-web-tool-labels">
          <span className="pi-tool-title">{(!shell || !object) && <strong className="pi-web-tool-name">{shell ? 'Shell' : name}</strong>}{object && <> <span className="pi-web-tool-object" title={name === 'skill' ? object : undefined}>{object}</span></>}</span>
          <span className="pi-web-tool-summary-meta"><span className="pi-tool-state">{label}</span><ToolElapsed item={item} running={running} /></span>
        </span>
        <PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} />
      </summary>
      {(opened || open) && <div className="pi-tool-body pi-specialized-tool">
        {shell && <div className="pi-web-tool-body-title">Shell</div>}
        {!inputRepresented && <section className="tool-part">{inputNotice ? <ToolDetailState phase="input" text={inputNotice} /> : item.call && <><p className="sr-only">输入</p><MessageBody message={item.call} history={history} plain formatText={(text, offset) => hasSpecializedToolContent(name)
          ? <SpecializedToolContent toolName={name} phase="input" text={offset === 0 ? residentInput ?? text : text} offset={offset} status={item.call?.status} complete={wholeToolMessage(item.call)} todoRecorded={todoRecorded} />
          : toolInputPresentation(name, text, offset === 0 && !item.call?.truncated && item.call?.textNextOffset == null)} onUnavailable={() => unavailable(item.call!.id)} /></>}</section>}
        {!todoRecorded && outputs.map(output => {
          const notice = toolDetailNotice('output', output);
          return <section className="tool-part" key={output.id + (output.resourceContent === true ? ':resource' : '')}>{notice ? <ToolDetailState phase="output" text={notice} /> : <><p className="sr-only">输出{output.isError || ['error', 'failed'].includes(output.status || '') ? ' · 失败' : ''}</p><MessageBody message={output} history={history} plain formatText={(text, offset) => toolOutputPresentation(name, text, offset, output, item.call?.text, mergedPlan, mergedAction)} onUnavailable={() => unavailable(output.id)} /></>}</section>;
        })}
        {outputNotice && <section className="tool-part"><ToolDetailState phase="output" text={outputNotice} /></section>}
        <div className="pi-web-tool-footer"><span className={statusClass}>{statusIcon && <PiIcon path={statusIcon} size={13} />}<span className="pi-tool-state">{label}</span></span></div>
      </div>}
    </details>
  </article>;
}
function ToolActivityGroup({ tools, history, compact = false, anchorId, disclosures, onRecordUnavailable }: { onRecordUnavailable?: (id: string) => void; tools: ToolItem[]; history?: HistoryReader; compact?: boolean; anchorId?: string; disclosures?: Map<string, boolean> }) {
  const [manualOpen, setOpen] = useState<boolean>();
  const [restoredOpen, setRestoredOpen] = useState(() => tools.some(tool => defaultToolOpen(tool, disclosures)));
  const open = manualOpen ?? (restoredOpen || tools.some(tool => defaultToolOpen(tool, disclosures)));
  const previousTools = useRef(new Set(tools.map(tool => tool.id)));
  useEffect(() => {
    if (tools.some(tool => !previousTools.current.has(tool.id) && disclosures?.get(tool.id))) setRestoredOpen(true);
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
    if (event.target === event.currentTarget && event.currentTarget.open !== open) setOpen(event.currentTarget.open);
  }}>
    <summary>{compact ? <PiIcon path={mdiCheck} className="pi-tool-status is-complete" size={14} /> : <span className="execution-tool-group-chevron" aria-hidden="true">›</span>}<span className="pi-tool-count">{tools.length} 项工具调用</span><span className="execution-tool-group-summary sr-only">{summary}</span><span className="pi-tool-breakdown">{[...counts].map(([label, count]) => { const icon = label === '读取' ? mdiFileDocumentOutline : label === '脚本' ? mdiConsoleLine : label === '编辑' || label === '写入' ? mdiPencil : label === '检索' || label === '搜索' ? mdiMagnify : mdiWrenchOutline; return <span key={label} title={label} aria-label={`${label} ${count} 次`}><PiIcon path={icon} size={12} /><span>{count}</span></span>; })}</span><span className="sr-only">，共 {tools.length} 项工具调用与脚本执行</span>{failures > 0 && (compact ? <span className="execution-tool-state is-error">{failures} 项失败</span> : <Badge tone="danger">{failures} 项失败</Badge>)}<PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} /><span className={compact ? 'sr-only' : 'execution-tool-group-action'}>{open ? '收起' : '展开'}</span></summary>
    <div className="execution-tool-group-items">{tools.map(item => <ToolActivity key={item.id} item={item} history={history} compact={compact} disclosures={disclosures} onRecordUnavailable={onRecordUnavailable} />)}</div>
  </details>;
}
type OlderHistory = {hasMore: boolean; loading: boolean; error: Error | null; disabled: boolean; onLoad: () => void};
function LiveElapsed({startedAt, label}: {startedAt?: string; label?: string}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!startedAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [startedAt]);
  const start = Date.parse(startedAt || '');
  return Number.isFinite(start) ? <span className="pi-live-elapsed">{label && `${label} `}{Math.max(0, Math.floor((now - start) / 1000))}s</span> : null;
}
function recordedDuration(ms?: number) {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${Number(seconds.toFixed(1))}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function LivePhase({live}: {live?: ExecutionLive}) {
  if (!live) return null;
  if (live.notice) {
    const {kind, source, attempt, maxAttempts, message} = live.notice;
    const step = source === 'model' ? '模型请求' : '上下文压缩';
    const label = kind === 'retry' ? `正在重试${step}${attempt === undefined ? '' : `（${attempt}${maxAttempts === undefined ? '' : ` / ${maxAttempts}`}）`}`
      : kind === 'failed' ? `${step}失败` : `已取消${step}`;
    return <div className={`pi-live-phase phase-${kind}`} role="status"><span>{label}</span>{message && <span>{message}</span>}</div>;
  }
  if (!live.active || !live.phase) return null;
  const labels = {preparing: '准备执行', waiting: '等待模型响应', thinking: '思考中', text: '生成中', tool: '工具执行中', compaction: '正在压缩上下文', retry: '正在重试'};
  return <div className={`pi-live-phase is-active phase-${live.phase}`} role="status">
    <PiIcon path={mdiLoading} className="pi-live-spinner" size={14} />
    <span className="pi-live-phase-content"><span className="pi-live-phase-label">{labels[live.phase]}</span>{' '}<LiveElapsed startedAt={live.phaseStartedAt} /></span>
  </div>;
}

function ThinkingMessage({message, history, compact, live, onUnavailable}: {message: Message; history?: HistoryReader; compact: boolean; live?: ExecutionLive; onUnavailable?: () => void}) {
  const [open, setOpen] = useState(!!message.transient);
  const [opened, setOpened] = useState(!!message.transient);
  const [restricted, setRestricted] = useState(false);
  const isThinking = !!message.transient && live?.active && live.phase === 'thinking';
  const preview = restricted ? '' : message.text.trim().split(/\r?\n/, 1)[0]?.slice(0, 128);
  const duration = recordedDuration(message.timing?.durationMs);
  return <details className="thinking-message execution-thought" open={open} onToggle={event => {if(event.target === event.currentTarget){setOpen(event.currentTarget.open); if(event.currentTarget.open)setOpened(true);}}}>
    <summary><PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} /><span className="execution-thought-label">{isThinking ? '思考中' : '思考'}</span><span className="execution-thought-preview">{preview}</span>
      {(isThinking || duration !== undefined) && <span className="execution-timing-meta">
        {isThinking ? <LiveElapsed startedAt={live?.phaseStartedAt} label="用时" /> : duration !== undefined && <span className="execution-turn-time">用时 {duration}</span>}
      </span>}
    </summary>
    {opened && <MessageBody message={message} history={history} showSource={!compact} onUnavailable={() => {setRestricted(true); onUnavailable?.();}} />}
  </details>;
}

function CompactionRecord({message, history, onUnavailable}: {message: Message; history?: HistoryReader; onUnavailable?: () => void}) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const ms = recordedDuration(message.timing?.durationMs);
  const details = message.compaction;
  const tokens = details?.tokensBefore;
  const after = details?.tokensAfter;
  const heading = <><strong>上下文压缩</strong>{details?.mode && <span>{details.mode === 'background' ? '后台' : '前台'}</span>}
    <span className="execution-timing-meta execution-turn-time">{ms === undefined ? '耗时未记录' : `用时 ${ms}`}</span></>;
  if (details?.summaryHidden) return <div className="execution-compaction" data-message-id={message.id}><div className="execution-compaction-heading">{heading}</div></div>;
  return <details className="execution-compaction" data-message-id={message.id} open={open} onToggle={event => {if(event.target === event.currentTarget){setOpen(event.currentTarget.open); if(event.currentTarget.open)setOpened(true);}}}>
    <summary className="execution-compaction-heading"><PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} />{heading}</summary>
    {opened && <div className="execution-compaction-content">
      {tokens !== undefined && <p className="muted">{after !== undefined ? `${tokens.toLocaleString()} → ${after.toLocaleString()} Tokens` : `压缩前 ${tokens.toLocaleString()} Tokens`}</p>}
      <MessageBody message={message} history={history} showSource={false} onUnavailable={onUnavailable} />
    </div>}
  </details>;
}

function TurnProcess({turn, focusId, children}: {turn: ExecutionTurn; focusId?: string; children: () => ReactNode}) {
  const [open, setOpen] = useState(!turn.complete);
  const [opened, setOpened] = useState(!turn.complete);
  const [choice, setChoice] = useState<boolean>();
  const expected = choice ?? !turn.complete;
  useLayoutEffect(() => { setOpen(expected); if (expected) setOpened(true); }, [expected]);
  const targeted = focusId !== undefined && turn.rows.some(row => row.kind === 'message'
    ? row.message.id === focusId : row.id === focusId || row.results.some(result => result.id === focusId));
  const duration = recordedDuration(turn.durationMs);
  return <details className="execution-turn-process" open={open} data-message-id={`process:${turn.id}`} onToggle={event => {
    if (event.target !== event.currentTarget) return;
    const value = event.currentTarget.open;
    if (value !== open) {setChoice(value); setOpen(value); if (value) setOpened(true);}
  }}>
    <summary><span className="execution-turn-process-label">处理详情</span>{!!turn.toolCount && <span className="execution-turn-count">{turn.toolCount} 次工具调用</span>}{duration && <span className="execution-turn-time">用时 {duration}</span>}<PiIcon path={mdiChevronRight} className="pi-tool-chevron" size={14} /></summary>
    {/* Search mounts only the matching fold before the parent locates its row.
        Once opened, keep nested disclosures and body paging alive. */}
    {(opened || open || targeted) && <div className="execution-turn-items">{children()}</div>}
  </details>;
}

export function MessageList({ messages, pending, empty, footer, footerVersion, userLabel = '你', history, onInspect, inspectedId, presentation = 'chat', older, live, followInput, focusRecord, onRecordUnavailable }: { onRecordUnavailable?: (id: string) => void; focusRecord?: {id: string; version: number}; followInput?: string; live?: ExecutionLive; presentation?: 'chat' | 'execution'; inspectedId?: string; messages: Message[]; pending?: boolean; empty?: ReactNode; footer?: ReactNode; footerVersion?: string | null; userLabel?: string; history?: HistoryReader; onInspect?: (message: Message, trigger: HTMLButtonElement) => void; older?: OlderHistory }) {
  const disclosures = useRef(new Map<string, boolean>()).current;
  const brand = useAssistantBrand();
  const compact = presentation === 'execution';
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const items = useMemo(() => compact ? [] : executionItems(messages), [messages, compact]);
  const turnKeys = useRef(new Map<string, string>());
  const turns = useMemo(() => {
    const next = new Map<string, string>();
    const used = new Set<string>();
    const keyed = (compact ? executionTurns(messages, !!older?.hasMore) : []).map(turn => {
      if (turn.kind === 'standalone') return turn;
      const rowIds = turn.rows.map(row => row.kind === 'message' ? row.message.id : row.id);
      // Loading the preceding page can reveal the start of an existing
      // process. Its retained rows keep the disclosure and scroll identity.
      const retainedKey = rowIds.map(id => turnKeys.current.get(id)).find(key => key && !used.has(key));
      let id = retainedKey ?? turn.id;
      while (used.has(id)) id = 'turn:' + id;
      used.add(id);
      for (const rowId of rowIds) next.set(rowId, id);
      return {...turn, id};
    });
    turnKeys.current = next;
    return keyed;
  }, [messages, compact, older?.hasMore]);
  // A prepend can extend the first tool group. Reuse its existing key so an
  // expanded group and its nested input/output disclosures stay open.
  const groupKeys = useRef(new Map<string, string>());
  const keyedItems = useMemo(() => {
    const next = new Map<string, string>();
    const keyed = items.map(item => {
      if (item.kind !== 'tool-group') {
        return {item, key: item.kind === 'message' ? item.message.id : item.id};
      }
      const key = item.tools.map(tool => groupKeys.current.get(tool.id)).find(Boolean) || `group:${item.id}`;
      for (const tool of item.tools) next.set(tool.id, key);
      return {item, key};
    });
    groupKeys.current = next;
    return keyed;
  }, [items]);
  const anchor = useRef<{id?: string; top: number; height: number; scroll: number} | null>(null);
  // Keep the pre-insert anchor immutable until child layout measurements settle.
  // Programmatic scroll events must not replace it with a displaced row.
  const restoring = useRef<typeof anchor.current>(null);
  const restoreFrame = useRef(0);
  const previousFirst = useRef<string | undefined>(undefined);
  const previousFollowInput = useRef(followInput);
  useEffect(() => () => cancelAnimationFrame(restoreFrame.current), []);
  const cancelRestore = () => { restoring.current = null; cancelAnimationFrame(restoreFrame.current); };
  const captureAnchor = () => {
    const el = ref.current;
    if (!el || restoring.current) return;
    const top = el.getBoundingClientRect().top;
    const bottom = el.getBoundingClientRect().bottom;
    const row = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => {
      const bounds = node.matches('details[open]') ? node.querySelector(':scope > summary')?.getBoundingClientRect() : node.getBoundingClientRect();
      return bounds && bounds.height > 0 && bounds.bottom > top && bounds.top < bottom;
    });
    anchor.current = {id: row?.dataset.messageId, top: row ? row.getBoundingClientRect().top - top : 0, height: el.scrollHeight, scroll: el.scrollTop};
  };
  const loadOlder = () => { if (older?.hasMore && !older.loading && !older.error && !older.disabled) older.onLoad(); };
  const signature = messages.map(message => `${message.id}:${message.text.length}:${message.status || ''}`).join(',');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (followInput && followInput !== previousFollowInput.current) {
      cancelRestore();
      following.current = true;
      setShowLatest(false);
    }
    previousFollowInput.current = followInput;
    const prepended = previousFirst.current !== undefined && messages.findIndex(message => message.id === previousFirst.current) > 0;
    previousFirst.current = messages[0]?.id;
    if (prepended && !following.current && anchor.current) {
      cancelRestore();
      restoring.current = {...anchor.current};
      let frames = 0, stable = 0, lastHeight = -1;
      const settle = () => {
        const saved = restoring.current;
        if (!saved || !ref.current) return;
        const el = ref.current;
        const row = [...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === saved.id);
        if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.top;
        stable = lastHeight === el.scrollHeight ? stable + 1 : 0;
        lastHeight = el.scrollHeight;
        if (++frames < 30 && stable < 3) restoreFrame.current = requestAnimationFrame(settle);
        else {restoring.current = null; captureAnchor();}
      };
      restoreFrame.current = requestAnimationFrame(settle);
    }
    if (following.current) element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    else if (older && anchor.current) {
      const saved = anchor.current;
      const row = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === saved.id && node.getBoundingClientRect().height > 0);
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.top;
      else element.scrollTop = saved.scroll + element.scrollHeight - saved.height;
    }
    captureAnchor();
  }, [signature, pending, footerVersion, followInput]);
  useEffect(() => {
    const element = ref.current;
    // Collapsed tool runs can turn 200 records into only a few lines. Fill the
    // viewport with older history rather than leaving a nearly empty reader.
    if (element && element.scrollHeight <= element.clientHeight + 120) loadOlder();
  }, [signature, older?.loading, older?.hasMore, older?.disabled]);
  useEffect(() => {
    const element = ref.current;
    if (!compact || !element) return;
    let width = element.clientWidth, height = element.clientHeight, contentHeight = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight && contentHeight === element.scrollHeight) return;
      width = element.clientWidth; height = element.clientHeight; contentHeight = element.scrollHeight;
      if (following.current) element.scrollTop = element.scrollHeight;
      else if (anchor.current) {
        const saved = anchor.current;
        const row = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === saved.id);
        if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.top;
      }
      captureAnchor();
    });
    observer.observe(element);
    // Prepended bubbles measure their three-line cutoff after mounting. Their
    // second layout (and later font/image changes) must retain the same row,
    // not only the viewport resize handled above.
    const column = element.querySelector('.message-column');
    if (column) observer.observe(column);
    return () => observer.disconnect();
  }, [compact, !!older]);
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
  useLayoutEffect(() => {
    if (!focusRecord || !ref.current) return;
    const list = ref.current;
    const row = [...list.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === focusRecord.id
      || node.dataset.recordIds?.split(' ').includes(focusRecord.id));
    if (!row) return;
    cancelRestore(); following.current = false;
    const expandable = row.matches('details') ? row as HTMLDetailsElement : row.querySelector('details');
    if (expandable) expandable.open = true;
    for (let parent = row.parentElement; parent && parent !== list; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    requestAnimationFrame(() => {if (row.isConnected) {list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - row.offsetHeight) / 2; captureAnchor();}});
  }, [focusRecord]);
  const latest = () => { cancelRestore(); following.current = true; setShowLatest(false); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'instant' }); };
  const renderItem = (item: ExecutionItem, key: string) => {
        if (item.kind === 'tool-group') return <ToolActivityGroup key={key} anchorId={key} tools={item.tools} history={history} compact={compact} disclosures={disclosures} onRecordUnavailable={onRecordUnavailable} />;
        if (item.kind === 'tool') return <ToolActivity key={item.id} item={item} history={history} compact={compact} disclosures={disclosures} onRecordUnavailable={onRecordUnavailable} />;
        const message = item.message;
        if (message.kind === 'router-packet-boundary') return null;
        if (compact && message.kind === 'compaction') return <CompactionRecord key={key} message={message} history={history} onUnavailable={() => onRecordUnavailable?.(message.id)} />;
        return <article data-message-id={message.id} className={`message message-${message.role}${message.kind === 'scheduled-trigger' ? ' message-scheduled' : message.kind === 'task-result' || message.kind === 'router-reply' ? ' execution-result' : ''}${message.transient ? ' pi-live-message' : ''}${message.transient && live?.active && ((message.kind === 'thinking' && live.phase === 'thinking') || (message.kind !== 'thinking' && live.phase === 'text')) ? ' pi-model-streaming' : ''}${onInspect ? ' message-inspectable' : ''}`} key={key} onClick={onInspect ? event => {
          // Markdown contains links and disclosures: preserve their actions and text selection.
          // The visually hidden native button makes the bubble keyboard accessible without adding a separate action label.
          const target = event.target as HTMLElement;
          if (!target.closest('.message-body') || target.closest('a,button,summary,details,input,textarea,select') || window.getSelection()?.toString()) return;
          const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.message-process-trigger');
          if (trigger) onInspect(message, trigger);
        } : undefined}>
          {compact ? <div className="execution-message-role"><span className="sr-only">{message.role === 'assistant' ? '助手' : message.senderName || userLabel}</span>{message.kind === 'local-task-input' && message.status && <span className="execution-tool-state">{message.status === 'sending' ? '发送中' : message.status === 'queued' ? '等待执行' : '待核实'}</span>}{message.status && ['error', 'failed', 'aborted', 'length'].includes(message.status) && <span className="execution-tool-state is-error">{states[message.status]?.[0] || message.status}</span>}</div> : <div className="message-meta"><span className={`message-avatar ${message.role === 'assistant' ? 'bot-avatar' : ''}`}>{message.role === 'assistant' ? (brand.icon === 'moon' ? 'N' : brandGlyph(brand.icon)) : (message.senderName?.slice(0, 1) || userLabel.slice(0, 1))}</span>
            <strong>{message.role === 'assistant' ? brand.name : (message.senderName || userLabel)}</strong>
            {message.createdAt && <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
            {message.status && message.status !== 'delivered' && message.status !== 'sent' && <Status value={message.status} />}
          </div>}
          {message.kind === 'scheduled-trigger' && <div className="scheduled-message-origin" aria-label="定时触发"><RiTimeLine size={12} aria-hidden="true" /><span>由已安排任务发送</span></div>}
          <div className="message-body">{message.kind === 'context-summary' && <div className="message-origin-label">上下文摘要</div>}{onInspect && <button type="button" className="message-process-trigger sr-only" aria-haspopup="dialog" aria-expanded={inspectedId === message.id} aria-label={`查看消息处理过程：${message.text.slice(0, 40) || '无正文消息'}`} onClick={event => onInspect(message, event.currentTarget)}>处理过程</button>}{message.kind === 'thinking' ? <ThinkingMessage message={message} history={history} compact={compact} live={live} onUnavailable={() => onRecordUnavailable?.(message.id)} /> : <MessageBody key={message.id} message={message} history={history} showSource={!compact} onUnavailable={() => onRecordUnavailable?.(message.id)} />}</div>
          {compact && message.createdAt && ['source','instruction','task-result','router-reply'].includes(message.kind || '') && <time className="execution-message-time" dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>}
        </article>;
  };
  const hasDisplayMessages = messages.some(message => message.kind !== 'router-packet-boundary');
  return <div className={`transcript-wrap${compact ? ' execution-transcript' : ''}`}><div className="transcript" ref={ref} onWheel={cancelRestore} onTouchStart={cancelRestore} onPointerDown={cancelRestore} onKeyDown={cancelRestore} onScroll={() => {
    if (restoring.current) return;
    const el = ref.current!; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < (compact ? 60 : 90); setShowLatest(!following.current);
    captureAnchor();
    if (el.scrollTop < 160) loadOlder();
  }} role="region" aria-label="消息记录" tabIndex={0}>
    <div className={`message-column${hasDisplayMessages || live?.active || footer ? '' : ' is-empty'}`}>
      {older && hasDisplayMessages && <div className="execution-history-start" role="status">{older.error ? <Notice error={older.error} onRetry={older.onLoad} /> : older.loading ? '正在载入更早记录…' : older.hasMore ? '向上滚动载入更早记录' : '已到当前上下文的开始'}</div>}
      {!hasDisplayMessages ? (live?.active || live?.notice ? null : empty ?? <EmptyState title="暂无消息" />) : (compact ? turns.map(turn => turn.kind === 'standalone'
        ? renderItem(turn.row, turn.row.kind === 'message' ? turn.row.message.id : turn.row.id)
        : <TurnProcess key={`process:${turn.id}`} turn={turn} focusId={focusRecord?.id}>{() => turn.rows.map(row => renderItem(row, row.kind === 'message' ? row.message.id : row.id))}</TurnProcess>)
        : keyedItems.map(({item, key}) => renderItem(item, key)))}
      {(live?.notice || live?.active && !(live.phase === 'thinking' && messages.some(message => message.transient && message.kind === 'thinking') || live.phase === 'tool' && messages.some(message => message.role === 'tool' && message.status === 'running'))) && <LivePhase live={live} />}
      {pending && <div className="thinking" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>Bot 正在处理，完成后会更新回复</div>}
      {footer}
    </div>
  </div>{showLatest && <Button className="jump-latest" variant="secondary" icon={compact ? undefined : <RiArrowDownLine size={16} />} onClick={latest}>回到最新消息</Button>}</div>;
}
