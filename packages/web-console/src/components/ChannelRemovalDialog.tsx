import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { api, ApiError, errorText, type Channel } from '../api';
import { Button, IconButton } from './BoardPrimitives';
import { Notice } from './Shared';
import { channelPath } from '../channel-url';

export type ChannelRemovalRequest = { item: Channel; trigger: HTMLButtonElement | null };
type Draft = { channelId: string; type: string; name: string; expectedVersion: string; uncertain: boolean };
type Removed = { ok: true; channelId: string; changed: boolean; restartRequired: boolean; liveApplied: boolean };

const definitive = (error: unknown) => error instanceof ApiError && (
  [400, 401, 403, 404, 409, 413, 429].includes(error.status) || error.code === 'CHANNEL_CONFIGURATION_UNAVAILABLE'
);
const removalError = (error: unknown) => {
  if (!(error instanceof ApiError)) return errorText(error);
  const messages: Record<string, string> = {
    DINGTALK_CHANNEL_VERSION_CONFLICT: '渠道配置已变化，本次没有删除。请取消后刷新列表，重新核对要删除的配置。',
    DINGTALK_CHANNEL_SWITCH_BLOCKED: '仍有未完成任务、输入或发送结果待核实，系统已阻止删除。请先处理这些依赖。',
    DINGTALK_CHANNEL_NOT_FOUND: '当前已找不到此渠道。请取消并刷新列表核对。',
    CHANNEL_RUNTIME_VERSION_CONFLICT: '保存配置与当前接入版本不一致，系统已阻止删除。请先核对运行状态。',
    CHANNEL_RECONFIGURING: '渠道正在处理另一项配置变更，本次没有删除。请等处理结束后重新核对。',
    CHANNEL_LIVE_LIFECYCLE_UNSUPPORTED: '此渠道暂不支持安全停止并删除，系统没有强制移除。请按渠道运维说明处理。',
    CHANNEL_CONFIGURATION_UNAVAILABLE: '当前运行版本尚不支持删除渠道，未提交删除。请先更新支持此功能的版本。',
    CHANNEL_DELETE_CONFIRMATION_REQUIRED: '删除需要再次确认，未执行本次请求。',
    CHANNEL_DELETE_REQUEST_INVALID: '删除请求未被接纳，请刷新渠道信息后重新确认。',
  };
  return messages[error.code] ?? errorText(error);
};

export function ChannelRemovalDialog({ request, onDismiss, onChanged, focusAfterRemoval }: {
  request: ChannelRemovalRequest | null;
  onDismiss: () => void;
  onChanged: (message: string) => void;
  focusAfterRemoval: () => void;
}) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null), focusPending = useRef(false), removed = useRef(false);
  const unresolved = useRef(new Map<string, Draft>()), live = useRef(true), writing = useRef(false);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<'deleting' | 'checking' | null>(null);
  const [error, setError] = useState<unknown>(null), [feedback, setFeedback] = useState('');
  const [rejected, setRejected] = useState(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useLayoutEffect(() => {
    if (!request) return;
    const { item } = request;
    setDraft(unresolved.current.get(item.channelId) ?? {
      channelId: item.channelId, type: item.type, name: item.name || item.channelId, expectedVersion: item.savedVersion ?? '', uncertain: false,
    });
    trigger.current = request.trigger; focusPending.current = true; removed.current = false;
    setError(null); setFeedback(''); setRejected(false); setOpen(true);
  }, [request]);
  const restoreFocus = () => {
    if (!focusPending.current) return;
    focusPending.current = false;
    if (document.querySelector('dialog[open]')) return;
    if (removed.current || !trigger.current?.isConnected) focusAfterRemoval();
    else trigger.current.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const element = dialog.current;
    if (open && draft && !element?.open) {
      element?.showModal();
      // Always start on the safe action, not the first icon or the destructive button.
      cancel.current = element?.querySelector<HTMLButtonElement>('[data-channel-delete-cancel]') ?? null;
      cancel.current?.focus({ preventScroll: true });
    } else if (!open && element?.open) { element.close(); restoreFocus(); }
  }, [open, draft]);
  const close = () => { if (!writing.current) setOpen(false); };
  const verify = async (value = draft) => {
    if (!value || writing.current) return;
    writing.current = true; setBusy('checking'); setError(null);
    try {
      const result = await api<{ items: Channel[] }>('/channels');
      if (!live.current) return;
      if (!Array.isArray(result.items) || result.items.some(item => !item || typeof item.channelId !== 'string')) throw new ApiError(502, 'INVALID_RESPONSE');
      if (!result.items.some(item => item.channelId === value.channelId)) {
        unresolved.current.delete(value.channelId); removed.current = true; setOpen(false);
        onChanged(`当前列表中已无「${value.name}」。无法确认是否由本次删除完成，已刷新渠道列表。`);
      } else setFeedback('列表中仍有此渠道，删除结果尚未确认。不会重发删除请求；请恢复连接后继续核对。');
    } catch (cause) { if (live.current) { setError(cause); setFeedback('暂时无法核对。原删除请求保持锁定，不会自动重试。'); } }
    finally { writing.current = false; if (live.current) setBusy(null); }
  };
  const remove = async () => {
    if (!draft || draft.uncertain || rejected || writing.current || !/^[a-f0-9]{64}$/.test(draft.expectedVersion)) return;
    writing.current = true; setBusy('deleting'); setError(null); setFeedback('');
    try {
      const result = await api<Removed>(channelPath(draft.channelId), {
        method: 'DELETE', body: { expectedVersion: draft.expectedVersion, confirm: true },
      });
      if (!live.current) return;
      if (result.ok !== true || result.channelId !== draft.channelId || result.changed !== true ||
        typeof result.restartRequired !== 'boolean' || typeof result.liveApplied !== 'boolean') throw new ApiError(502, 'INVALID_RESPONSE');
      unresolved.current.delete(draft.channelId); removed.current = true; setOpen(false);
      onChanged(result.restartRequired ? `「${draft.name}」的配置已删除，当前接入需正常重启后停止。`
        : `「${draft.name}」的渠道配置已删除。${draft.type === 'dingtalk-dws' ? '会话和任务历史仍保留。' : '插件自身清理遵循其生命周期说明。'}`);
    } catch (cause) {
      if (!live.current) return;
      setError(cause);
      if (definitive(cause)) setRejected(true);
      else {
        const pending = { ...draft, uncertain: true };
        unresolved.current.set(pending.channelId, pending); setDraft(pending);
        setFeedback('删除结果未知。原请求已锁定，请只读核对结果，不要重复删除。');
      }
    } finally { writing.current = false; if (live.current) setBusy(null); }
  };
  return <dialog ref={dialog} className="channel-create-dialog channel-delete-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-impact`}
    onCancel={event => { if (writing.current) event.preventDefault(); }}
    onClose={() => { if (dialog.current?.open) return; setOpen(false); restoreFocus(); onDismiss(); }}>
    <header className="channel-create-heading"><h2 id={`${id}-title`}>删除渠道？</h2>
      <IconButton label="关闭删除确认" disabled={!!busy} onClick={close}><RiCloseLine size={19} /></IconButton></header>
    {draft && <div className="channel-delete-body">
      <p id={`${id}-impact`}>将移除「<strong>{draft.name}</strong>」的渠道配置，重新接入需要重新添加。</p>
      <p className="muted">运行中的接入会先尝试安全停止；无法立即应用时，需按结果提示正常重启。{draft.type === 'dingtalk-dws' ? '会话、任务和历史记录不会随配置删除，也不会注销钉钉账号。' : '本操作不主动清理历史记录；插件自身的清理行为遵循该插件说明。'}</p>
      <p className="muted">存在未完成任务或发送结果待核实时，系统会阻止删除。</p>
      {error != null && <Notice error={error} message={draft.uncertain ? '删除结果尚未确认，不能重复提交。' : removalError(error)} />}
      {(feedback || draft.uncertain) && <p className="channel-create-feedback" role="status">{feedback || '此渠道有尚未确认的删除请求。请只读核对结果，不要重复删除。'}</p>}
      {!/^[a-f0-9]{64}$/.test(draft.expectedVersion) && <p className="field-help">缺少有效配置版本，暂时不能删除。请取消后刷新列表。</p>}
      <div className="channel-delete-actions">
        <Button data-channel-delete-cancel disabled={!!busy} onClick={close}>{draft.uncertain ? '关闭' : '取消'}</Button>
        {draft.uncertain ? <Button variant="primary" busy={busy === 'checking'} disabled={!!busy} onClick={() => void verify()}>核对删除结果</Button>
          : <Button className="channel-delete-confirm" busy={busy === 'deleting'} disabled={!!busy || rejected || !/^[a-f0-9]{64}$/.test(draft.expectedVersion)} onClick={() => void remove()}>删除渠道</Button>}
      </div>
    </div>}
  </dialog>;
}
