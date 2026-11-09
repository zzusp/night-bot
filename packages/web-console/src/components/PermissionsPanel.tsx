import { useEffect, useId, useRef, useState } from 'react';
import { RiCloseLine, RiRefreshLine, RiShieldKeyholeLine } from '@remixicon/react';
import { api, ApiError, errorText, type PermissionMode, type PermissionRequest, type PermissionsView } from '../api';
import { dateTime, useResource } from '../hooks';
import { Badge, Button, EmptyState, IconButton } from './BoardPrimitives';
import { Loading, Notice } from './Shared';

type Decision = 'allow' | 'reject' | 'revoke';
type Write = { kind: 'mode'; mode: PermissionMode } | { kind: 'request'; id: string; decision: Decision };
const requestStates: Record<PermissionRequest['status'], [string, 'warning' | 'success' | 'neutral']> = {
  pending: ['等待批准', 'warning'], 'allowed-once': ['已批准此次', 'success'],
  rejected: ['已拒绝', 'neutral'], cancelled: ['已撤销', 'neutral'],
};
const protectionStates = { unconfined: '进程未隔离', 'not-attested': '隔离尚未核实', unavailable: '隔离不可用' };

function PermissionContent({ enabled, busy, conflicts, onWrite }: {
  enabled: boolean; busy: Write | null; conflicts: string[]; onWrite: (write: Write) => Promise<void>;
}) {
  const query = useResource<PermissionsView>(enabled ? '/permissions' : null, 5000);
  const [selected, setSelected] = useState<PermissionMode | null>(null);
  const name = useId();
  useEffect(() => { setSelected(query.data?.mode ?? null); }, [query.data?.mode]);
  const blocked = !!busy || query.loading || !!query.error;
  const unreadable = query.error instanceof ApiError && [401, 403].includes(query.error.status);
  if (!enabled) return null;
  return <>
    {query.error && <Notice error={query.error} stale={!!query.data && !unreadable} onRetry={query.refresh} />}
    {!query.data || unreadable ? query.loading && !query.error ? <Loading>正在读取 Host 权限与审批…</Loading>
      : <EmptyState title="权限状态暂不可读" description="读取成功前不能切换权限或作出审批决定。" /> : <>
      <section className="permission-section" aria-labelledby={`${name}-mode`}>
        <div className="permission-section-heading"><h3 id={`${name}-mode`}>当前权限</h3><Badge tone={query.data.mode === 'full' ? 'danger' : 'info'}>{query.data.options.find(option => option.value === query.data!.mode)?.label || '模式未报告'}</Badge></div>
        <p className="permission-help">当前模式来自 Host，不表示工具已执行或任务已完成。</p>
        <div className="permission-protection"><Badge tone="warning">{protectionStates[query.data.protection.status] || '保护状态未报告'}</Badge><span>执行后端：{query.data.protection.backend === 'direct' ? '当前系统账号直接执行' : '未报告已就绪后端'}</span><p>{query.data.protection.description}</p></div>
        <form noValidate onSubmit={event => { event.preventDefault(); if (selected && selected !== query.data!.mode && !blocked) void onWrite({ kind: 'mode', mode: selected }); }}>
          <fieldset className="permission-modes" disabled={blocked}><legend>选择后保存，才会改变新操作的权限</legend>
            <div className="permission-choices">{query.data.options.map(option => <label key={option.value} className={`permission-choice ${selected === option.value ? 'selected' : ''}`}>
              <input type="radio" name={`${name}-mode`} value={option.value} checked={selected === option.value} onChange={() => setSelected(option.value)} />
              <span><strong>{option.label}</strong><span>{option.description}</span></span>
            </label>)}</div>
          </fieldset>
          {(selected === 'full' || query.data.mode === 'full') && <p className="permission-warning">完全访问允许越出业务工作目录执行，权限上限是当前操作系统账号，不会取得管理员权限。进程不再隔离，同账号可访问的凭据与 Host 私有文件不受进程隔离保护。</p>}
          {selected === 'auto' && <p className="permission-help">帮我批准只审查需要批准的动作，使用当前通用模型且不调用工具；无法确定或模型失败时转交人工。</p>}
          <p className="permission-help">切换模式会使旧待批请求和未消费授权失效。刷新、重连和冷恢复不会重放审批；冷恢复后的原待批请求撤销。</p>
          <div className="permission-actions"><Button type="submit" variant="primary" busy={busy?.kind === 'mode'} disabled={blocked || !selected || selected === query.data.mode}>{selected === 'full' ? '保存为完全访问' : '保存权限模式'}</Button><Button variant="ghost" disabled={!!busy || query.loading} onClick={query.refresh} icon={<RiRefreshLine size={16} />}>重新获取</Button></div>
        </form>
      </section>
      <section className="permission-section" aria-labelledby={`${name}-requests`}>
        <div className="permission-section-heading"><h3 id={`${name}-requests`}>操作审批</h3><Badge>{query.data.requests.filter(request => request.status === 'pending').length} 条待批</Badge></div>
        <p className="permission-help">以下目标与命令由 Host 筛选、脱敏。隐藏的原始参数、环境与凭据不会通过本页面展开；参数摘要用于核对同一次调用。批准只对该请求生效，不表示执行成功。</p>
        {query.data.requests.length ? <div className="permission-requests">{query.data.requests.map(request => {
          const state = requestStates[request.status];
          return <article className="permission-request" key={request.id} aria-label={`${request.toolName} 操作审批`}>
            <div className="permission-section-heading"><h4>{request.toolName}</h4><Badge tone={state?.[1] || 'neutral'}>{state?.[0] || '状态未报告'}</Badge></div>
            <p className="permission-summary">{request.display.summary}</p>
            <dl><dt>工作目录</dt><dd><code>{request.display.cwd}</code></dd>
              {request.display.target !== null && <><dt>目标</dt><dd><code>{request.display.target}</code></dd></>}
              {request.display.command !== null && <><dt>命令摘要</dt><dd><pre>{request.display.command}</pre></dd></>}
              <dt>参数摘要</dt><dd><code>{request.display.parametersDigest}</code></dd>
              <dt>调用来源</dt><dd><code>{request.actorId} / {request.callId}</code></dd>
              {request.taskId !== null && <><dt>任务</dt><dd><a href={`#/tasks/${encodeURIComponent(request.taskId)}`}>{request.taskId}</a></dd></>}
              {request.conversationId !== null && <><dt>会话</dt><dd><code>{request.conversationId}</code></dd></>}
              <dt>发起时间</dt><dd>{dateTime(request.createdAt)}</dd>
              {request.decidedAt && <><dt>决定时间</dt><dd>{dateTime(request.decidedAt)}</dd></>}
            </dl>
            {(request.status === 'pending' || request.revocable === true) && (conflicts.includes(request.id) ? <p className="permission-warning">此请求已发生冲突，不会重试该决定。请重新获取最新状态。</p> : <div className="permission-actions">
              {request.status === 'pending' && <><Button variant="primary" disabled={blocked} busy={busy?.kind === 'request' && busy.id === request.id && busy.decision === 'allow'} onClick={() => void onWrite({ kind: 'request', id: request.id, decision: 'allow' })}>仅批准此次</Button>
              <Button disabled={blocked} busy={busy?.kind === 'request' && busy.id === request.id && busy.decision === 'reject'} onClick={() => void onWrite({ kind: 'request', id: request.id, decision: 'reject' })}>拒绝此次</Button></>}
              {request.revocable === true && <Button disabled={blocked} busy={busy?.kind === 'request' && busy.id === request.id && busy.decision === 'revoke'} onClick={() => void onWrite({ kind: 'request', id: request.id, decision: 'revoke' })}>撤销未执行授权</Button>}
            </div>)}
            {request.revocable === true && <p className="permission-help">只能撤销尚未执行的授权；已经发生的效果不会被撤销动作回滚。</p>}
          </article>;
        })}</div> : <p className="permission-help" role="status">当前没有审批请求。需要人工决定的动作出现后，会在这里显示。</p>}
      </section>
    </>}
  </>;
}

export default function PermissionsPanel() {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<Write | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const writing = useRef(false), live = useRef(true);
  const title = useId();
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  const write = async (action: Write) => {
    if (writing.current) return;
    writing.current = true; setBusy(action); setError(''); setFeedback('');
    try {
      await api<PermissionsView>(action.kind === 'mode' ? '/permissions' : `/permissions/requests/${encodeURIComponent(action.id)}`, {
        method: action.kind === 'mode' ? 'PUT' : 'POST', body: action.kind === 'mode' ? { mode: action.mode } : { decision: action.decision },
      });
      if (!live.current) return;
      setFeedback(action.kind === 'mode' ? '权限设置已保存，请核对重新读取的 Host 状态。' : action.decision === 'allow' ? '此次批准已提交；工具执行结果请查看任务记录。' : action.decision === 'revoke' ? '未执行授权已撤销；已发生的效果不会回滚。' : '此次拒绝已提交。');
    } catch (cause) {
      if (!live.current) return;
      if (cause instanceof ApiError && cause.status === 409 && action.kind === 'request') {
        setConflicts(values => [...new Set([...values, action.id])]);
        setError('请求已过期、已经结束或授权已消费，本次决定不会重试。正在重新获取当前状态。');
      } else setError(`${errorText(cause)} 操作不会自动重发，请核对重新读取的当前状态。`);
    } finally {
      writing.current = false;
      if (live.current) {
        setBusy(null);
        // 换掉旧读取实例，丢弃写入前在途的快照；只重新 GET，不重发决定。
        setGeneration(value => value + 1);
      }
    }
  };
  return <>
    <IconButton label="权限与审批" aria-haspopup="dialog" onClick={() => setOpen(true)}><RiShieldKeyholeLine size={18} /></IconButton>
    <dialog ref={dialog} className="permission-dialog" aria-labelledby={title} onClose={() => setOpen(false)}>
      <header className="permission-dialog-heading"><div><h2 id={title}>权限与审批</h2><p>安装操作者 · 当前 Host</p></div><IconButton label="关闭权限与审批" onClick={() => setOpen(false)}><RiCloseLine size={19} /></IconButton></header>
      <div className="permission-dialog-body">
        {error && <div className="notice" role="alert">{error}</div>}
        {feedback && <p className="permission-feedback" role="status">{feedback}</p>}
        {busy && <p className="permission-help" role="status">正在提交，关闭面板不会取消本次操作。</p>}
        <PermissionContent key={generation} enabled={open} busy={busy} conflicts={conflicts} onWrite={write} />
      </div>
    </dialog>
  </>;
}
