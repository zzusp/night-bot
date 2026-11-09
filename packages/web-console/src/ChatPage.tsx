import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RiArrowDownSLine, RiArrowRightUpLine, RiChatSmile2Line, RiFileList3Line, RiLightbulbLine } from '@remixicon/react';
import { api, ApiError, errorText, type Chat, type Message } from './api';
import { navigate, useResource, useRoute } from './hooks';
import { Button, Composer, EmptyState, Logo } from './components/BoardPrimitives';
import { Loading, MessageList, Notice } from './components/Shared';
import { ExecutionHistory } from './components/ExecutionHistory';

export interface Attempt { conversationId: string; requestId: string; text: string; createdAt: string; state: 'sending' | 'pending' | 'unknown' | 'missing' }
interface Draft { text: string; attempt?: Attempt; error?: string; checking?: boolean }
const emptyDraft: Draft = { text: '' };
// 请求归属于对话，不能归属于可能随切页卸载的组件；退出时替换整个内存容器。
export function createDrafts() {
  const values = new Map<string, Draft>(), listeners = new Set<() => void>();
  return {
    get: (key: string) => values.get(key) || emptyDraft,
    update(key: string, change: (previous: Draft) => Draft) {
      const previous = values.get(key) || emptyDraft, next = change(previous);
      if (previous === next) return;
      if (next === emptyDraft) values.delete(key); else values.set(key, next);
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type Drafts = ReturnType<typeof createDrafts>;
interface Receipt { conversationId: string; status: string; accepted?: boolean }

function ChatExecutionGroup({ conversationId, taskId }: { conversationId: string; taskId?: string }) {
  const [open, setOpen] = useState(!taskId);
  const endpoint = `/chat/${encodeURIComponent(conversationId)}${taskId ? `/tasks/${encodeURIComponent(taskId)}` : ''}/session`;
  return <details className="chat-execution-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><RiArrowDownSLine className="chat-execution-chevron" size={18} aria-hidden="true" />
      <span className="chat-execution-label"><strong>{taskId ? '任务执行' : 'Router · 会话安排'}</strong>{taskId && <code>{taskId}</code>}</span>
      <span className="chat-execution-toggle">{open ? '收起记录' : '展开记录'}</span>
    </summary>
    {open && <ExecutionHistory endpoint={endpoint} router={!taskId} />}
  </details>;
}

export default function ChatPage(props: { id?: string; drafts: Drafts; onAccepted: () => void }) {
  const current = useResource<{conversationId: string}>('/chat-current');
  if (!props.id && !current.data) return current.error ? <Notice error={current.error} onRetry={current.refresh} /> : <Loading>正在读取 Web 对话…</Loading>;
  return <ChatContent {...props} id={props.id || current.data?.conversationId} />;
}

function ChatContent({ id, drafts, onAccepted }: { id?: string; drafts: Drafts; onAccepted: () => void }) {
  const key = id || 'new';
  const route = useRoute();
  const execution = !!id && route.searchParams.get('view') === 'execution';
  const { text, attempt, error, checking } = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const mounted = useRef(false);
  const liveKey = useRef(key);
  liveKey.current = key;
  const query = useResource<Chat>(id ? `/chat/${encodeURIComponent(id)}` : null, 2500);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const edit = (value: string) => drafts.update(key, previous => previous.attempt ? previous : { text: value });
  const settle = (value: Attempt, change: (previous: Draft) => Draft) => drafts.update(key, previous => previous.attempt?.requestId === value.requestId ? change(previous) : previous);
  const applyReceipt = (receipt: Receipt, value: Attempt) => {
    if (drafts.get(key).attempt?.requestId !== value.requestId) return;
    if (receipt.status === 'accepted' && receipt.accepted !== false) {
      settle(value, () => emptyDraft);
      if (mounted.current && liveKey.current === key) {
        if (!route.pathname.split('/').filter(Boolean)[1] || receipt.conversationId !== id) navigate(`/chat/${encodeURIComponent(receipt.conversationId)}`);
        query.refresh(); onAccepted();
      }
      return;
    }
    if (receipt.status === 'rejected') {
      settle(value, previous => ({ text: previous.text, error: 'Bot 未接纳这条消息，草稿已保留。请核对渠道权限或调整内容后再发送。' }));
    } else {
      const pending = receipt.status === 'pending';
      settle(value, previous => ({ ...previous, checking: false, attempt: { ...value, state: pending ? 'pending' : 'unknown' }, error: pending ? 'Bot 正在确认接纳这条消息，草稿已保留。请稍后核对发送状态，系统不会重复发送。' : '这条消息的处理结果待核实。请查看会话记录；系统不会自动重新发送。' }));
      if (mounted.current && liveKey.current === key) query.refresh();
    }
  };
  const reconcile = async (value = drafts.get(key).attempt) => {
    if (!value || drafts.get(key).checking) return;
    settle(value, previous => ({ ...previous, checking: true }));
    try {
      applyReceipt(await api<Receipt>(`/requests/${encodeURIComponent(value.requestId)}`), value);
    } catch (err) {
      const missing = err instanceof ApiError && err.status === 404;
      settle(value, previous => ({ ...previous, checking: false, attempt: { ...value, state: missing ? 'missing' : 'unknown' }, error: missing ? '服务暂未找到这次发送记录。可以使用同一请求重试，避免重复接纳。' : '发送结果暂时无法确认。请恢复连接后核对，不要重复发送。' }));
    }
  };
  const send = async (retry?: Attempt) => {
    const current = drafts.get(key);
    if (current.checking || (!retry && current.attempt) || (retry && (current.attempt?.requestId !== retry.requestId || current.attempt.state !== 'missing')) || !current.text.trim()) return;
    if (!retry && (!query.data || query.error)) return;
    const value: Attempt = { ...(retry ?? { conversationId: query.data?.canonicalConversationId || id || crypto.randomUUID(), requestId: crypto.randomUUID(), text: current.text, createdAt: new Date().toISOString() }), state: 'sending' };
    drafts.update(key, previous => ({ ...previous, attempt: value, error: undefined, checking: false }));
    try {
      const result = await api<Receipt>('/chat', { method: 'POST', body: { conversationId: value.conversationId, requestId: value.requestId, text: value.text } });
      applyReceipt(result, value);
    } catch (err) {
      if (err instanceof ApiError && ([400, 401, 403, 413, 429].includes(err.status) || err.code === 'WEB_CHAT_SINGLETON')) settle(value, previous => ({ text: previous.text, error: errorText(err) }));
      else await reconcile(value);
    }
  };
  const messages = query.data?.messages || [];
  const extra: Message[] = attempt && !messages.some(message => message.requestId === attempt.requestId)
    ? [{ id: attempt.requestId, role: 'user', text: attempt.text, createdAt: attempt.createdAt, status: ['sending', 'pending'].includes(attempt.state) ? 'pending' : 'unknown' }] : [];
  const busy = attempt?.state === 'sending';
  const taskHistoryBlocked = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  return <div className="chat-page">
    {id && <nav className="filter-tabs chat-history-tabs" aria-label="会话视图">
      <a href={`#/chat/${encodeURIComponent(id)}`} aria-current={!execution ? 'page' : undefined}>对话</a>
      <a href={`#/chat/${encodeURIComponent(id)}?view=execution`} aria-current={execution ? 'page' : undefined}>执行过程</a>
    </nav>}
    {!execution && query.data?.truncated && <div className="history-scope">当前显示最近 500 条消息；更早记录仍保存在 Bot 中。</div>}
    {!execution && query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!query.data} />}
    {execution && id ? <div className="chat-execution" key={id}>
      <ChatExecutionGroup conversationId={id} />
      <section className="chat-task-history" aria-label="本会话关联任务">
        <header><h2>本会话关联任务</h2><p>含已完成和已归档任务，可展开查看。</p></header>
        {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!query.data && !taskHistoryBlocked} />}
        {query.loading && !query.data ? <Loading>正在读取关联任务…</Loading>
          : taskHistoryBlocked || (!query.data && query.error) ? <EmptyState title="关联任务暂不可读" description="请重新获取会话；当前不会读取关联任务的执行记录。" />
          : query.data?.taskHistoryStatus !== 'ready' || query.data.taskIds === null ? <EmptyState title="关联任务暂不可读" description="Host 尚未提供可核验的任务关联，这不表示没有任务。" action={<Button variant="secondary" onClick={query.refresh}>重新获取</Button>} />
          : query.data.taskIds.length ? query.data.taskIds.map(taskId => <ChatExecutionGroup key={taskId} conversationId={id} taskId={taskId} />)
          : <EmptyState title="本会话暂无关联任务" description="Router 安排任务后会在这里显示。" />}
      </section>
    </div> : query.loading && !query.data && id ? <Loading>正在读取会话…</Loading> : <MessageList messages={[...messages, ...extra]}
      pending={['accepted', 'pending', 'running'].includes(query.data?.status || '')}
      footer={query.data?.status === 'ready' && messages.at(-1)?.role === 'user' ? <p className="muted chat-receipt" role="status">消息已接纳，后续回复会在这里显示。</p> : undefined}
      empty={query.error && !query.data ? <EmptyState title="对话暂不可读" description="使用上方按钮重新获取，或从侧栏选择其他对话。" /> : <div className="welcome"><div className="welcome-mark"><Logo compact /></div>
        <h2>今天，有什么可以帮你？</h2>
        <div className="suggestions">{[
          { icon: RiFileList3Line, title: '梳理一项任务', description: '把目标拆成清晰的行动', prompt: '我想和你一起梳理一项任务：' },
          { icon: RiLightbulbLine, title: '一起想想办法', description: '分析问题，找到下一步', prompt: '帮我分析一下这个问题：' },
          { icon: RiChatSmile2Line, title: '开始一段对话', description: '从一个问题或想法开始', prompt: '你好，介绍一下你能如何帮助我。' },
        ].map(item => <button type="button" key={item.title} onClick={() => { edit(item.prompt); document.querySelector<HTMLTextAreaElement>('.board-composer textarea')?.focus(); }}>
          <item.icon size={20} /><strong>{item.title}</strong><span>{item.description}</span><RiArrowRightUpLine size={15} /></button>)}</div>
      </div>} />}
    <div className="composer-dock"><div>
      {error && <div className="send-notice" role="alert"><p>{error}</p>{attempt && attempt.state !== 'sending' && <div className="inline-actions">
        <Button variant="secondary" disabled={checking} busy={checking} onClick={() => void reconcile()}>核对发送状态</Button>
        {attempt.state === 'missing' && <Button variant="secondary" disabled={checking} onClick={() => void send(attempt)}>重试这条消息</Button>}
      </div>}</div>}
      <Composer key={key} value={text} onChange={edit} onSend={() => send()} busy={busy} disabled={!!attempt || !query.data || !!query.error} placeholder="给 Night Bot 发消息…" />
      <div className="composer-note"><span>关闭页面后，任务仍会继续</span></div>
    </div></div>
  </div>;
}
