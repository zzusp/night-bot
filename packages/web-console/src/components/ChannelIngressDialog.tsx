import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { api, ApiError, errorText, type Channel } from '../api';
import { channelPath } from '../channel-url';
import { ingressStateText, ingressTargetPaused, ingressUnavailable, validChannelIngress, validChannelVersion } from '../channel-ingress';
import { Button, IconButton } from './BoardPrimitives';
import { Notice } from './Shared';

export type ChannelIngressRequest = { item: Channel; trigger: HTMLButtonElement | null };
type Draft = { item: Channel; paused: boolean; uncertain: boolean };
type Receipt = { ok: true; changed: boolean; restartRequired: false; liveApplied: boolean; channel: Channel };
const definitive = (error: unknown) => error instanceof ApiError && error.code !== 'CHANNEL_CONFIGURATION_COMMIT_UNCERTAIN' &&
  ([400, 401, 403, 404, 409, 413, 429].includes(error.status) || ['CHANNEL_INGRESS_CONTROL_UNSUPPORTED', 'CHANNEL_INGRESS_UNAVAILABLE'].includes(error.code));
const ingressError = (error: unknown) => {
  if (!(error instanceof ApiError)) return errorText(error);
  const messages: Record<string, string> = {
    DINGTALK_CHANNEL_VERSION_CONFLICT: '渠道配置已变化，本次没有覆盖。请重新读取状态，核对后再确认。',
    CHANNEL_RUNTIME_VERSION_CONFLICT: '保存配置与当前接入版本不一致，本次没有执行。请先核对运行状态。',
    CHANNEL_INGRESS_CONTROL_UNSUPPORTED: '此渠道尚未声明暂停接收能力，本次没有执行。',
    CHANNEL_INGRESS_UNAVAILABLE: '当前接入暂不可操作，本次没有执行。请恢复渠道运行后重新读取状态。',
    CHANNEL_INGRESS_REQUEST_INVALID: '请求未被接纳，请重新读取渠道状态后确认。',
    CHANNEL_INGRESS_CONFIRMATION_REQUIRED: '此操作需要明确确认，本次没有执行。',
    CHANNEL_RECONFIGURING: '渠道正在处理另一项变更，本次没有执行。请稍后重新读取状态。',
  };
  return messages[error.code] ?? errorText(error);
};

// Kept outside polling cards so pending receipts survive list refresh and closing.
export function ChannelIngressDialog({ request, onDismiss, onChanged, onPending, focusFallback }: {
  request: ChannelIngressRequest | null; onDismiss: () => void; onChanged: (message: string) => void; onPending: (channelId: string, pending: boolean) => void; focusFallback: () => void;
}) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const unresolved = useRef(new Map<string, Draft>()), live = useRef(true), writing = useRef(false), focusPending = useRef(false);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<'saving' | 'checking' | null>(null), [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState(''), [rejected, setRejected] = useState(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => {
    if (!request) return;
    setDraft(unresolved.current.get(request.item.channelId) ?? { item: request.item, paused: ingressTargetPaused(request.item), uncertain: false });
    trigger.current = request.trigger; focusPending.current = true;
    setError(null); setFeedback(''); setRejected(false); setOpen(true);
  }, [request]);
  const restoreFocus = () => {
    if (!focusPending.current) return;
    focusPending.current = false;
    if (document.querySelector('dialog[open]')) return;
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    else focusFallback();
  };
  useLayoutEffect(() => {
    const element = dialog.current;
    if (open && draft && !element?.open) {
      element?.showModal();
      element?.querySelector<HTMLButtonElement>('[data-channel-ingress-cancel]')?.focus({ preventScroll: true });
    } else if (!open && element?.open) { element.close(); restoreFocus(); }
  }, [open, draft]);
  const close = () => { if (!writing.current) setOpen(false); };
  const check = async () => {
    if (!draft || writing.current) return;
    writing.current = true; setBusy('checking'); setError(null); setFeedback('');
    try {
      const result = await api<{ items: Channel[] }>('/channels');
      if (!live.current) return;
      if (!Array.isArray(result.items) || result.items.some(item => !item || typeof item.channelId !== 'string')) throw new ApiError(502, 'INVALID_RESPONSE');
      const item = result.items.find(value => value.channelId === draft.item.channelId);
      if (!item || !validChannelVersion(item.savedVersion) || !validChannelIngress(item.ingress)) {
        setFeedback('尚未读到此渠道的完整版本和接收状态。原请求保持锁定，请继续只读核对。'); return;
      }
      if (!draft.uncertain) {
        setDraft({ item, paused: draft.paused, uncertain: false }); setRejected(false);
        setFeedback(`已读取最新状态：${ingressStateText(item)}请核对下方说明后重新确认。`);
        onChanged(''); return;
      }
      // A matching intent alone cannot prove application. Require a valid saved
      // revision and the requested actual state, without attributing who changed it.
      const versionObserved = item.savedVersion !== draft.item.savedVersion || draft.item.ingress?.requestedPaused === draft.paused;
      const actualObserved = draft.paused ? ['paused', 'pausing'].includes(item.ingress.state) : ['receiving', 'recovering'].includes(item.ingress.state);
      if (versionObserved && item.ingress.requestedPaused === draft.paused && actualObserved) {
        unresolved.current.delete(item.channelId); onPending(item.channelId, false); setOpen(false);
        onChanged(`只读核对当前状态：「${item.name || item.channelId}」${ingressStateText(item)}无法确认是否由本次请求完成。`);
      } else setFeedback(`当前状态：${ingressStateText(item)}${item.savedVersion === draft.item.savedVersion ? '保存版本未变化。' : '保存版本已变化。'}本次操作结果仍未确认，不会重发请求。`);
    } catch (cause) {
      if (live.current) { setError(cause); setFeedback(draft.uncertain ? '暂时无法核对。原请求保持锁定，不会自动重试。' : '暂时无法重新读取。请恢复连接后再试。'); }
    } finally { writing.current = false; if (live.current) setBusy(null); }
  };
  const submit = async () => {
    if (!draft || draft.uncertain || rejected || writing.current || ingressUnavailable(draft.item)) return;
    writing.current = true; setBusy('saving'); setError(null); setFeedback('');
    try {
      const result = await api<Receipt>(channelPath(draft.item.channelId, 'ingress'), {
        method: 'POST', body: { expectedVersion: draft.item.savedVersion, paused: draft.paused, confirm: true },
      });
      if (!live.current) return;
      const item = result.channel;
      if (result.ok !== true || typeof result.changed !== 'boolean' || result.restartRequired !== false || typeof result.liveApplied !== 'boolean' ||
        item?.channelId !== draft.item.channelId || !validChannelVersion(item.savedVersion) || !validChannelIngress(item.ingress) ||
        !item.ingress.supported || item.ingress.requestedPaused !== draft.paused ||
        !(draft.paused ? ['paused', 'pausing', 'error', 'unavailable'] : ['receiving', 'recovering', 'error', 'unavailable']).includes(item.ingress.state) ||
        (result.changed && item.savedVersion === draft.item.savedVersion)) throw new ApiError(502, 'INVALID_RESPONSE');
      unresolved.current.delete(item.channelId); onPending(item.channelId, false);
      if (item.ingress.state === 'error' || item.ingress.state === 'unavailable' || !result.liveApplied) {
        setDraft({ item, paused: draft.paused, uncertain: false });
        setFeedback(`请求已保存。${ingressStateText(item)}${item.ingress.state === 'error' ? '可在核对运行状态后，再次确认重试本次操作。' : ''}`);
        onChanged(`「${item.name || item.channelId}」${ingressStateText(item)}`);
      } else {
        setOpen(false); onChanged(`「${item.name || item.channelId}」${ingressStateText(item)}`);
      }
    } catch (cause) {
      if (!live.current) return;
      setError(cause);
      if (definitive(cause)) setRejected(true);
      else {
        const pending = { ...draft, uncertain: true };
        unresolved.current.set(draft.item.channelId, pending); onPending(draft.item.channelId, true); setDraft(pending);
        setFeedback('操作结果未知。原请求已锁定，请只读核对接收状态，不要重复提交。');
      }
    } finally { writing.current = false; if (live.current) setBusy(null); }
  };
  const action = draft?.paused ? '暂停接收' : '恢复接收';
  return <dialog ref={dialog} className="channel-create-dialog channel-delete-dialog channel-ingress-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-impact`}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const next = event.shiftKey ? buttons.at(-1) : buttons[0];
      if (!buttons.length || document.activeElement === (event.shiftKey ? buttons[0] : buttons.at(-1))) {
        event.preventDefault(); next?.focus({ preventScroll: true });
      }
    }}
    onCancel={event => { if (writing.current) event.preventDefault(); }}
    onClose={() => { if (dialog.current?.open) return; setOpen(false); restoreFocus(); onDismiss(); }}>
    <header className="channel-create-heading"><h2 id={`${id}-title`}>{action}？</h2>
      <IconButton label="关闭接收确认" disabled={!!busy} onClick={close}><RiCloseLine size={19} /></IconButton></header>
    {draft && <div className="channel-delete-body">
      <p id={`${id}-impact`}>将{action}「<strong>{draft.item.name || draft.item.channelId}</strong>」的渠道消息。</p>
      <p className={draft.item.ingress?.backfill === 'none' ? 'channel-ingress-warning' : 'muted'}>{draft.item.ingress?.backfill === 'none'
        ? '暂停期间无法补拉，恢复只接收后续消息。'
        : draft.paused ? '暂停后不再接纳新的渠道消息。恢复时会补拉暂停期间的消息，是否完成以实际接收状态为准。'
          : '恢复后先补拉暂停期间的消息。恢复请求成功不代表补拉完成，请留意渠道的实际状态。'}</p>
      <p className="muted">此操作不改变渠道启用配置或外发授权，也不会取消已接纳的任务。</p>
      {error != null && <Notice error={error} message={draft.uncertain ? '操作结果尚未确认，不能重复提交。' : ingressError(error)} />}
      {(feedback || draft.uncertain) && <p className="channel-create-feedback" role="status">{feedback || '此渠道有尚未确认的接收变更。请只读核对结果，不要重复提交。'}</p>}
      {ingressUnavailable(draft.item) && <p className="field-help">{ingressUnavailable(draft.item)}</p>}
      <div className="channel-delete-actions">
        <Button data-channel-ingress-cancel disabled={!!busy} onClick={close}>{draft.uncertain ? '关闭' : '取消'}</Button>
        {draft.uncertain || rejected ? <Button variant="primary" busy={busy === 'checking'} disabled={!!busy} onClick={() => void check()}>{draft.uncertain ? '核对接收状态' : '重新读取状态'}</Button>
          : <Button variant="primary" busy={busy === 'saving'} disabled={!!busy || !!ingressUnavailable(draft.item)} onClick={() => void submit()}>{draft.item.ingress?.state === 'error' ? `重试${action}` : action}</Button>}
      </div>
    </div>}
  </dialog>;
}
