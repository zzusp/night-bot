import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, type Message } from '../api';
import { dateTime } from '../hooks';
import { useExecutionStream } from '../useExecutionStream';
import { TaskTokenUsage } from './TaskTokenUsage';
import { ExecutionSearch } from './ExecutionSearch';
import { AgentProgress } from './AgentProgress';
import { Button, EmptyState } from './BoardPrimitives';
import { Loading, Markdown, MessageList, Notice, Status } from './Shared';

const unavailableRecord = new ApiError(503, 'SESSION_UNAVAILABLE');
const noMessages: Message[] = [];
const noExcludedRecords = new Set<string>();
const historyEmpty = <EmptyState title="暂无可展示的执行记录" />;
const emptyWithConclusion = <></>;
// History freshness/metadata can change without changing the rendered rows.
const HistoryMessageList = memo(MessageList);

// 聊天与任务共用连续执行流、提交等待和版本冲突处理。
export function ExecutionHistory({ endpoint, router = false, sessionKind, status, taskTitle, taskState, controlsTarget, conclusion, conclusionDuration, tokenTarget, taskError, taskRetry, refreshAfterInput, inputPreviews, onInputsRecorded }: { refreshAfterInput?: string; inputPreviews?: Message[]; onInputsRecorded?: (requestIds: Set<string>) => void; tokenTarget?: HTMLElement | null; taskError?: Error | null; taskRetry?: () => void; conclusionDuration?: string | null; conclusion?: string | null; taskTitle?: string; taskState?: string; endpoint: string; router?: boolean; sessionKind?: 'router'; status?: string; controlsTarget?: HTMLElement | null }) {
  const query = useExecutionStream(endpoint);
  const [focusRecord, setFocusRecord] = useState<{id: string; version: number; scope: string}>();
  const forbidden = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const [denied, setDenied] = useState(false);
  useEffect(() => { if (forbidden) setDenied(true); }, [forbidden]);
  // A retry must not briefly reveal the revoked cache while its request is pending.
  useEffect(() => { if (!query.error) setDenied(false); }, [query.updatedAt]);
  const blocked = forbidden || denied;
  const live = !query.error && !blocked && query.data?.status === 'ready' ? query.data.live : undefined;
  const committed = query.data?.status === 'ready' ? query.data.items : noMessages;
  const rendered = useMemo(() => {
    if (!live?.tools?.length) return committed;
    const clocks = new Map(live.tools.map(clock => [clock.callId, clock.startedAt]));
    return committed.map(row => row.kind === 'tool-call' && row.callId && clocks.has(row.callId)
      ? {...row, status: 'running', timing: {...row.timing, startedAt: clocks.get(row.callId)}} : row);
  }, [committed, live?.tools]);
  const recorded = useMemo(() => new Set(committed.flatMap(message => message.role === 'user' && message.requestId ? [message.requestId] : [])), [committed]);
  const localInputs = useMemo(() => !blocked && !query.error && inputPreviews?.length
    ? inputPreviews.filter(message => message.requestId && !recorded.has(message.requestId))
      .map(message => !message.status && !live?.active && (taskState === 'not-running' || taskState === 'queued' || taskState === 'scheduled')
        ? {...message, status:'queued'} : message)
    : noMessages, [blocked, query.error, inputPreviews, recorded, live?.active, taskState]);
  const messages = useMemo(() => !live?.items.length && !localInputs.length ? rendered
    : [...rendered, ...(live?.items ?? []), ...localInputs], [rendered, live?.items, localInputs]);
  useEffect(() => {
    if (!blocked && !query.error && inputPreviews?.some(message => message.requestId && recorded.has(message.requestId))) onInputsRecorded?.(recorded);
  }, [blocked, query.error, recorded, inputPreviews, onInputsRecorded]);
  const emptyTitle = sessionKind === 'router' ? '还没有路由记录' : '暂无会话记录';
  const sessionEmpty = !!sessionKind && !query.error && !blocked && (query.data?.status === 'pending' && query.data.reason === 'SESSION_NOT_STARTED' || query.data?.status === 'ready' && query.data.total === 0 && !query.data.items.length && !query.data.live?.items.length && !live?.active && !live?.notice);
  const hasRecords = !blocked && query.data?.status === 'ready' && !!query.data.items.length;
  const readFailed = blocked || !!query.error && !hasRecords || query.data?.status === 'unavailable';
  const latest = query.refresh;
  const refreshedInput = useRef(refreshAfterInput);
  useEffect(() => {
    if (refreshAfterInput && refreshAfterInput !== refreshedInput.current) latest();
    refreshedInput.current = refreshAfterInput;
  }, [refreshAfterInput, latest]);
  const [readerEpoch, setReaderEpoch] = useState(0);
  const searchScope = `${endpoint}:${query.epoch}:${readerEpoch}`;
  const [unavailableSearch, setUnavailableSearch] = useState<{scope: string; ids: Set<string>}>({scope: '', ids: new Set()});
  const onRecordUnavailable = useCallback((id: string) => {
    setUnavailableSearch(previous => previous.scope === searchScope && previous.ids.has(id) ? previous : {scope: searchScope, ids: new Set([...(previous.scope === searchScope ? previous.ids : []), id])});
  }, [searchScope]);
  const excludedSearch = unavailableSearch.scope === searchScope ? unavailableSearch.ids : noExcludedRecords;
  const searchable = useMemo(() => excludedSearch.size ? committed.filter(message => !excludedSearch.has(message.id)) : committed, [committed, excludedSearch]);
  const locate = useCallback((id: string | null) => setFocusRecord(previous => id ? ({id, scope: searchScope, version: (previous?.version ?? 0) + 1}) : undefined), [searchScope]);
  const recoveryRead = useRef<number | null | undefined>(undefined);
  const updatedAt = useRef(query.updatedAt);
  useLayoutEffect(() => { updatedAt.current = query.updatedAt; }, [query.updatedAt]);
  // Reset revoked body-page state only after a new authorized history read.
  // Ordinary polling and refreshes retain disclosure and scroll state.
  const recoverBody = useCallback(() => { recoveryRead.current = updatedAt.current; latest(); }, [latest]);
  useEffect(() => {
    if (recoveryRead.current !== undefined && query.updatedAt !== null && query.updatedAt !== recoveryRead.current && !query.error) {
      recoveryRead.current = undefined;
      setReaderEpoch(value => value + 1);
    }
  }, [query.updatedAt]);
  // The task workspace hosts these controls in its rail; other readers keep them inline.
  // The history component owns one stream regardless of where its controls render.
  const controls = controlsTarget !== undefined ? !blocked && query.data?.status === 'ready' && <dl className="task-record-facts"><div><dt>{query.error || query.committing ? '上次上下文' : '当前上下文'}</dt><dd><span>{query.data.items.length}</span><span className="muted"> / {query.data.total} 条</span></dd></div></dl> : <div className="execution-scope"><span>{router ? query.data?.scope === 'previous-committed-router-context' ? `已提交的安排记录 · 第 ${query.data.generation} 代（当前第 ${query.data.activeGeneration} 代）` : '当前安排记录' : '当前执行上下文'}</span>
      <div>{query.data?.status === 'ready' && <span>已载入 {query.data.items.length} / {query.data.total} 条记录</span>}{status && <Status value={status} />}{query.updatedAt && <time dateTime={new Date(query.updatedAt).toISOString()}>获取于 {dateTime(query.updatedAt)}</time>}<Button variant="ghost" disabled={query.loading} onClick={latest}>获取最新记录</Button></div>
    </div>;
  const revision = query.data?.revision;
  const history = useMemo(() => revision ? {endpoint, revision, onRecover: recoverBody} : undefined, [endpoint, revision, recoverBody]);
  const hasEarlier = !!query.data?.before, hasError = !!query.error;
  const older = useMemo(() => ({hasMore:hasEarlier, loading:query.loadingOlder, error:query.olderError, disabled:hasError, onLoad:query.loadOlder}),
    [hasEarlier, query.loadingOlder, query.olderError, hasError, query.loadOlder]);
  const footerVersion = !hasError && !query.committing && !query.data?.live?.active ? conclusion : null;
  const hasConclusion = !!footerVersion && !localInputs.length && query.data?.status === 'ready';
  // Result messages already carry each committed conclusion, including long paged bodies.
  // Keep the footer only as a fallback for older histories without result messages.
  const footer = useMemo(() => {
    const lastMessage = committed.at(-1);
    const duplicateConclusion = committed.some(message => message.kind === 'task-result') || lastMessage?.role === 'assistant' && lastMessage.kind !== 'thinking'
      && !lastMessage.truncated && lastMessage.text.trim() === conclusion?.trim();
    return hasConclusion && !duplicateConclusion && <article className="message message-assistant task-final-conclusion" aria-label="最后结论">
      {conclusionDuration && <div className="task-conclusion-label">{conclusionDuration}</div>}<div className="message-body"><Markdown text={conclusion || ''} /></div>
    </article>;
  }, [committed, hasConclusion, conclusion, conclusionDuration]);
  return <div className={`execution-history${router && (!query.data?.items.length || blocked) ? ' execution-history-empty' : ''}${sessionEmpty || readFailed ? ' session-records-empty' : ''}${readFailed ? ' execution-read-failed' : ''}`}>
    {tokenTarget && createPortal(<TaskTokenUsage usage={!blocked && query.data?.status === 'ready' ? query.data.tokenUsage : undefined} error={query.error || taskError} stale={!blocked && !!query.data?.tokenUsage} onRetry={query.error ? latest : taskRetry ?? latest} />, tokenTarget)}
    {controlsTarget === undefined ? controls : controlsTarget ? createPortal(controls, controlsTarget) : null}
    {router && !blocked && query.data?.routingMode === 'shared' && <div className="execution-scope router-conversation-scope">统一 Router · 当前对话</div>}
    {query.error && hasRecords && <Notice read stale error={query.error} message={query.error instanceof TypeError ? '连接已断开，当前显示上次记录' : '更新失败，当前显示上次记录'} onRetry={query.loading ? undefined : latest} />}
    {!blocked && query.committing && <div className="execution-scope" role="status">记录正在提交，当前显示上次已提交记录。</div>}
    {!router && !blocked && query.data?.status === 'ready' && query.data.todos && <AgentProgress key={endpoint} items={query.data.todos.items} title={taskTitle} status={taskState} />}

    {!blocked && !query.error && query.data?.status === 'ready' && <ExecutionSearch key={`search:${endpoint}:${query.epoch}:${readerEpoch}`} messages={searchable} onLocate={locate} />}
    {query.loading && !query.data && !localInputs.length ? <Loading>{router ? '正在读取会话记录…' : '正在读取正式执行记录…'}</Loading>
      : readFailed ? <Notice read source={!query.error ? endpoint : undefined} error={query.error ?? unavailableRecord} title={blocked ? '无权查看会话记录' : sessionKind === 'router' ? '路由记录加载失败' : '执行记录加载失败'} onRetry={query.loading ? undefined : latest} />
      : sessionEmpty && !localInputs.length ? <EmptyState title={emptyTitle} />
      : query.data?.status === 'pending' && !localInputs.length ? <EmptyState title={query.data.reason === 'SESSION_NOT_STARTED' ? router ? emptyTitle : '执行尚未开始' : '执行记录正在提交'} />
      : <HistoryMessageList key={`messages:${endpoint}:${query.epoch}:${readerEpoch}`} messages={messages} live={live} userLabel="用户" presentation="execution"
        focusRecord={!blocked && !query.error && focusRecord?.scope === searchScope && !excludedSearch.has(focusRecord.id) ? focusRecord : undefined}
        onRecordUnavailable={onRecordUnavailable} followInput={localInputs.find(message => message.status === 'sending')?.requestId}
        older={older} history={history} footerVersion={footerVersion} footer={footer} empty={conclusion ? emptyWithConclusion : historyEmpty} />}
  </div>;
}
