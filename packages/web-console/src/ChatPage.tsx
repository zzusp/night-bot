import {useAssistantBrand} from './components/AssistantBrand';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError, errorText, getSessionVersion, type Chat, type Message } from './api';
import { navigate, useResource, useRoute } from './hooks';
import { Button, Composer, Logo } from './components/BoardPrimitives';
import { Loading, Notice } from './components/Shared';
import { ConversationFrame } from './components/ConversationFrame';
import { ConversationMessages } from './components/ConversationMessages';
import { encodeAttachments, newComposerRequestId } from './compose-attachments';

import {createDrafts, emptyDraft, type Draft, type Attempt, type Drafts} from './chat-drafts';
export {createDrafts, type Attempt, type Drafts} from './chat-drafts';
interface Receipt { conversationId: string; status: string; accepted?: boolean }

export default function ChatPage(props: { id?: string; drafts: Drafts; onAccepted: () => void; onResolved?: (id: string) => void }) {
  const current = useResource<{conversationId: string}>('/chat-current');
  const resolvedId = props.id || current.data?.conversationId;
  useEffect(() => { if (resolvedId) props.onResolved?.(resolvedId); }, [resolvedId, props.onResolved]);
  if (!props.id && !current.data) return current.error ? <Notice error={current.error} onRetry={current.refresh} /> : <Loading>正在读取 Web 对话…</Loading>;
  return <ChatContent {...props} id={props.id || current.data?.conversationId} />;
}

function ChatContent({ id, drafts, onAccepted }: { id?: string; drafts: Drafts; onAccepted: () => void }) {
  const brand = useAssistantBrand();
  const key = id || 'new';
  const route = useRoute();
  const { text, files, attempt, error, checking } = useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
  const mounted = useRef(false);
  const liveKey = useRef(key);
  liveKey.current = key;
  const query = useResource<Chat>(id ? `/chat/${encodeURIComponent(id)}` : null, 2500);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const edit = (value: string) => drafts.update(key, previous => previous.attempt ? previous : { ...previous, text: value, error: undefined });
  const editFiles = (next: File[]) => drafts.update(key, previous => previous.attempt ? previous : { ...previous, files: next, error: undefined });
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
      settle(value, previous => ({ text: previous.text, files: previous.files, error: 'Bot 未接纳这条消息，草稿已保留。请核对渠道权限或调整内容后再发送。' }));
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
    const authVersion = getSessionVersion();
    const current = drafts.get(key);
    if (current.checking || (!retry && current.attempt) || (retry && (current.attempt?.requestId !== retry.requestId || current.attempt.state !== 'missing')) || (!current.text.trim() && !current.files?.length)) return;
    if (!retry && (!query.data || query.error)) return;
    const value: Attempt = { ...(retry ?? { conversationId: query.data?.canonicalConversationId || id || newComposerRequestId(), requestId: newComposerRequestId(), text: current.text, files: current.files, createdAt: new Date().toISOString() }), state: 'sending' };
    drafts.update(key, previous => ({ ...previous, attempt: value, error: undefined, checking: false }));
    let attachments;
    try {
      attachments = value.files?.length ? await encodeAttachments(value.files) : undefined;
    } catch {
      settle(value, previous => ({ text: previous.text, files: previous.files, error: '附件无法读取。请移除后重新添加，消息内容已保留。' }));
      return;
    }
    // Encoding is asynchronous: do not send on a different page or auth session.
    if (attachments && (!mounted.current || liveKey.current !== key || getSessionVersion() !== authVersion)) {
      settle(value, previous => ({ text: previous.text, files: previous.files }));
      return;
    }
    try {
      const result = await api<Receipt>('/chat', { method: 'POST', body: { conversationId: value.conversationId, requestId: value.requestId, text: value.text, ...(attachments ? { attachments } : {}) } });
      applyReceipt(result, value);
    } catch (err) {
      if (err instanceof ApiError && ([400, 401, 403, 413, 429].includes(err.status) || err.code === 'WEB_CHAT_SINGLETON')) settle(value, previous => ({ text: previous.text, files: previous.files, error: errorText(err) }));
      else await reconcile(value);
    }
  };
  const messages = query.data?.messages || [];
  const extra: Message[] = attempt && !messages.some(message => message.requestId === attempt.requestId)
    ? [{ id: attempt.requestId, role: 'user', text: attempt.text, attachments: attempt.files?.map(file => ({ name: file.name, mediaType: file.type, bytes: file.size })), createdAt: attempt.createdAt, status: ['sending', 'pending'].includes(attempt.state) ? 'pending' : 'unknown' }] : [];
  const busy = attempt?.state === 'sending';
  return <ConversationFrame endpoint={id ? `/chat/${encodeURIComponent(id)}` : undefined}>
    {query.data?.truncated && <div className="history-scope">当前显示最近 500 条消息；更早记录仍保存在 Bot 中。</div>}
    {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!query.data} />}
    {query.loading && !query.data && id ? <Loading>正在读取会话…</Loading> : <ConversationMessages key={key} endpoint={id ? `/chat/${encodeURIComponent(id)}` : null} accessError={query.error} accessUpdatedAt={query.updatedAt} onRefresh={query.refresh} messages={[...messages, ...extra]}
      pending={['accepted', 'pending', 'running'].includes(query.data?.status || '')}
      footer={query.data?.status === 'ready' && messages.at(-1)?.role === 'user' ? <p className="muted chat-receipt" role="status">消息已接纳</p> : undefined}
      empty={query.error && !query.data ? <></> : <div className="welcome"><div className="welcome-mark"><Logo compact /></div>
        <h2>今天，有什么可以帮你？</h2>
        <div className="suggestions">{[
          { title: '梳理一项任务', prompt: '我想和你一起梳理一项任务：' },
          { title: '一起想想办法', prompt: '帮我分析一下这个问题：' },
          { title: '开始一段对话', prompt: '你好，介绍一下你能如何帮助我。' },
        ].map(item => <button type="button" key={item.title} onClick={() => { edit(item.prompt); document.querySelector<HTMLTextAreaElement>('.board-composer textarea')?.focus(); }}>
          <strong>{item.title}</strong></button>)}</div>
      </div>} />}
    <div className="composer-dock"><div>
      {error && <div className="send-notice" role="alert"><p>{error}</p>{attempt && attempt.state !== 'sending' && <div className="inline-actions">
        <Button variant="secondary" disabled={checking} busy={checking} onClick={() => void reconcile()}>核对发送状态</Button>
        {attempt.state === 'missing' && <Button variant="secondary" disabled={checking} onClick={() => void send(attempt)}>重试这条消息</Button>}
      </div>}</div>}
      <Composer key={key} value={text} files={files} onFilesChange={editFiles} onChange={edit} onSend={() => send()} busy={busy} disabled={!!attempt || !query.data || !!query.error} placeholder={`给 ${brand.name} 发消息…`} />
    </div></div>
  </ConversationFrame>;
}
