import { useEffect, useRef, useState } from 'react';
import { RiArrowRightUpLine, RiChatSmile2Line, RiFileList3Line, RiLightbulbLine } from '@remixicon/react';
import { api, ApiError, errorText, type Chat, type Message } from './api';
import { navigate, useResource } from './hooks';
import { Button, Composer, Logo } from './components/BoardPrimitives';
import { Loading, MessageList, Notice } from './components/Shared';

export interface Attempt { conversationId: string; requestId: string; text: string; createdAt: string; state: 'sending' | 'pending' | 'unknown' | 'missing' }
export interface Drafts { values: Map<string, string>; attempts: Map<string, Attempt> }
interface Receipt { conversationId: string; status: string; accepted?: boolean }

export default function ChatPage({ id, drafts, onAccepted }: { id?: string; drafts: Drafts; onAccepted: () => void }) {
  const key = id || 'new';
  const [text, setText] = useState(() => drafts.values.get(key) || '');
  const [attempt, setAttempt] = useState<Attempt | undefined>(() => drafts.attempts.get(key));
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const liveKey = useRef(key);
  const query = useResource<Chat>(id ? `/chat/${encodeURIComponent(id)}` : null, 2500);
  useEffect(() => {
    liveKey.current = key; setText(drafts.values.get(key) || ''); setAttempt(drafts.attempts.get(key)); setError(null);
  }, [key, drafts]);
  const edit = (value: string) => { setText(value); drafts.values.set(key, value); };
  const updateAttempt = (value?: Attempt) => {
    if (value) drafts.attempts.set(key, value); else drafts.attempts.delete(key);
    if (liveKey.current === key) setAttempt(value);
  };
  const accepted = (conversationId: string) => {
    drafts.values.delete(key); updateAttempt();
    if (liveKey.current === key) { setText(''); setError(null); if (!id) navigate(`/chat/${encodeURIComponent(conversationId)}`); }
    query.refresh(); onAccepted();
  };
  const applyReceipt = (receipt: Receipt, value: Attempt) => {
    if (receipt.status === 'accepted' && receipt.accepted !== false) { accepted(receipt.conversationId); return; }
    if (receipt.status === 'rejected') {
      updateAttempt();
      if (liveKey.current === key) setError('Bot 未接纳这条消息，草稿已保留。请核对渠道权限或调整内容后再发送。');
    } else {
      const pending = receipt.status === 'pending';
      updateAttempt({ ...value, state: pending ? 'pending' : 'unknown' });
      if (liveKey.current === key) setError(pending ? 'Bot 正在确认接纳这条消息，草稿已保留。请稍后核对发送状态，系统不会重复发送。' : '这条消息的处理结果待核实。请查看会话记录；系统不会自动重新发送。');
      query.refresh();
    }
  };
  const reconcile = async (value = attempt) => {
    if (!value) return;
    try {
      applyReceipt(await api<Receipt>(`/requests/${encodeURIComponent(value.requestId)}`), value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) { updateAttempt({ ...value, state: 'missing' }); setError('服务暂未找到这次发送记录。可以使用同一请求重试，避免重复接纳。'); }
      else { updateAttempt({ ...value, state: 'unknown' }); setError('发送结果暂时无法确认。请恢复连接后核对，不要重复发送。'); }
    }
  };
  const send = async (retry?: Attempt) => {
    if (sending.current || (!retry && attempt) || !text.trim()) return;
    const value: Attempt = retry ?? { conversationId: id || crypto.randomUUID(), requestId: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString(), state: 'sending' };
    sending.current = true; updateAttempt({ ...value, state: 'sending' }); setError(null);
    try {
      const result = await api<Receipt>('/chat', { method: 'POST', body: { conversationId: value.conversationId, requestId: value.requestId, text: value.text } });
      applyReceipt(result, value);
    } catch (err) {
      if (err instanceof ApiError && [400, 401, 403, 413, 429].includes(err.status)) { updateAttempt(); setError(errorText(err)); }
      else await reconcile(value);
    } finally { sending.current = false; }
  };
  const messages = query.data?.messages || [];
  const extra: Message[] = attempt && !messages.some(message => message.requestId === attempt.requestId)
    ? [{ id: attempt.requestId, role: 'user', text: attempt.text, createdAt: attempt.createdAt, status: ['sending', 'pending'].includes(attempt.state) ? 'pending' : 'unknown' }] : [];
  const busy = attempt?.state === 'sending';
  return <div className="chat-page">
    {query.data?.truncated && <div className="history-scope">当前显示最近 500 条消息；更早记录仍保存在 Bot 中。</div>}
    {query.error && <Notice error={query.error} onRetry={query.refresh} stale={!!query.data} />}
    {query.loading && !query.data && id ? <Loading>正在读取会话…</Loading> : <MessageList messages={[...messages, ...extra]}
      pending={['accepted', 'pending', 'running'].includes(query.data?.status || '')}
      footer={query.data?.status === 'ready' && messages.at(-1)?.role === 'user' ? <p className="muted chat-receipt" role="status">消息已接纳，后续回复会在这里显示。</p> : undefined}
      empty={<div className="welcome"><div className="welcome-mark"><Logo compact /></div><span className="eyebrow">你的个人助手，随时就绪</span>
        <h2>今天，有什么可以帮你？</h2><p>把想法、问题或任务告诉 Night Bot，<br />在这里对话，也在这里了解工作的进展。</p>
        <div className="suggestions">{[
          { icon: RiFileList3Line, title: '梳理一项任务', description: '把目标拆成清晰的行动', prompt: '我想和你一起梳理一项任务：' },
          { icon: RiLightbulbLine, title: '一起想想办法', description: '分析问题，找到下一步', prompt: '帮我分析一下这个问题：' },
          { icon: RiChatSmile2Line, title: '开始一段对话', description: '从一个问题或想法开始', prompt: '你好，介绍一下你能如何帮助我。' },
        ].map(item => <button type="button" key={item.title} onClick={() => { edit(item.prompt); document.querySelector<HTMLTextAreaElement>('.board-composer textarea')?.focus(); }}>
          <item.icon size={20} /><strong>{item.title}</strong><span>{item.description}</span><RiArrowRightUpLine size={15} /></button>)}</div>
      </div>} />}
    <div className="composer-dock"><div>
      {error && <div className="send-notice" role="alert"><p>{error}</p>{attempt && attempt.state !== 'sending' && <div className="inline-actions">
        <Button variant="secondary" onClick={() => void reconcile()}>核对发送状态</Button>
        {attempt.state === 'missing' && <Button variant="secondary" onClick={() => void send(attempt)}>重试这条消息</Button>}
      </div>}</div>}
      <Composer value={text} onChange={edit} onSend={() => send()} busy={busy} disabled={!!attempt} placeholder="给 Night Bot 发消息…" />
      <div className="composer-note"><span>关闭页面后，任务仍会继续</span></div>
    </div></div>
  </div>;
}
