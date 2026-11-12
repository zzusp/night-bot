import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useResource } from './hooks';
import { Button } from './components/BoardPrimitives';
import { Loading, Notice } from './components/Shared';
import './styles/feedback.css';

type Feedback = { id: string; state: 'collecting' | 'editing' | 'ready' | 'failed' | 'submitting' | 'submitted' | 'unknown'; title: string; body: string; target: string; error?: string; url?: string };
type Destination = { target: string; model: string; revision: string; endpoint: string };
export const feedbackPrivacyNotice = '只有明确同意后，才会启动独立 Pi 会话收集本地诊断信息，并将脱敏后的问题与诊断信息发送给当前模型服务。仅采集运行信息、渠道状态汇总和日志错误码，不收集密钥、聊天或记忆正文，不上传原始日志。自动脱敏可能遗漏，请勿填写敏感内容；提交 GitHub 前请核对完整内容。';

export default function FeedbackPage() {
  const destination = useResource<Destination>('/feedback');
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [editDraft, setEditDraft] = useState<{title: string; body: string} | null>(null);
  const [consent, setConsent] = useState(false), [confirm, setConfirm] = useState(false);
  const [record, setRecord] = useState<Feedback | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [url, setUrl] = useState(''), [submitAttempted, setSubmitAttempted] = useState(false);
  const editLock = useRef(false), requestLock = useRef(false), submitLock = useRef(false), revokeLock = useRef(false), mounted = useRef(true), titleInput = useRef<HTMLInputElement>(null);
  const polling = useResource<Feedback>(record?.state === 'collecting' ? `/feedback/${encodeURIComponent(record.id)}` : null, 2000);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (polling.data && polling.data.id === record?.id) { setRecord(polling.data); setConfirm(false); } }, [polling.data, record?.id]);
  useEffect(() => { setConsent(false); }, [destination.data?.model, destination.data?.endpoint, destination.data?.revision]);
  const collecting = record?.state === 'collecting';
  const collect = async () => {
    if (requestLock.current || !consent || !destination.data || record) return;
    if (!title.trim() || !description.trim()) { setError('请填写标题与问题详情。'); titleInput.current?.focus(); return; }
    requestLock.current = true; setBusy(true); setError('');
    try {
      const result = await api<Feedback>('/feedback/collect', { method: 'POST', body: { title: title.trim(), description: description.trim(), consent: true, model: destination.data.model, revision: destination.data.revision } });
      if (mounted.current) { setRecord(result); setConfirm(false); }
    } catch (cause) { if (mounted.current) {
      if (cause instanceof ApiError && ['FEEDBACK_MODEL_CHANGED','FEEDBACK_INPUT_INVALID','FEEDBACK_CONSENT_REQUIRED','FEEDBACK_BUSY','FEEDBACK_LIMIT','FEEDBACK_CLOSED','FEEDBACK_UNAVAILABLE'].includes(cause.code)) { requestLock.current = false; setConsent(false); destination.refresh(); setError('诊断尚未启动。请核对模型与输入，稍后重新同意采集。'); }
      else setError('诊断请求未能确认，请勿重复启动；当前问题内容已保留。');
    } }
    finally { if (mounted.current) setBusy(false); /* An uncertain POST is never automatically replayed. */ }
  };
  const revoke = async () => {
    if (!record || busy || submitAttempted || submitLock.current || revokeLock.current || editLock.current) return;
    revokeLock.current = true;
    setBusy(true); setError('');
    try {
      await api(`/feedback/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      if (mounted.current) { setRecord(null); setEditDraft(null); setConsent(false); setConfirm(false); requestLock.current = false; }
    } catch { if (mounted.current) setError('未能确认撤销，请重新核对；未提交 GitHub。'); }
    finally { revokeLock.current = false; if (mounted.current) setBusy(false); }
  };
  const updatePreview = async () => {
    if (!record || record.state !== 'ready' || !editDraft || busy || submitAttempted || editLock.current || submitLock.current || revokeLock.current) return;
    setConfirm(false);
    if (!editDraft.title.trim() || !editDraft.body.trim()) { setError('请填写提交标题与正文。'); return; }
    editLock.current = true; setBusy(true); setError('');
    try {
      const updated = await api<Feedback>(`/feedback/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: { title: editDraft.title, body: editDraft.body } });
      if (!mounted.current) return;
      if (updated.id !== record.id || updated.state !== 'ready') throw new Error('Preview not ready');
      setRecord(updated); setEditDraft(null); setConfirm(false);
    } catch { if (mounted.current) setError('预览更新未完成，修改内容已保留。请重新更新预览，核对脱敏后的内容再提交。'); }
    finally { editLock.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = async () => {
    if (!record || record.state !== 'ready' || editDraft !== null || !confirm || busy || submitAttempted || submitLock.current || revokeLock.current || editLock.current) return;
    submitLock.current = true;
    setSubmitAttempted(true); setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>(`/feedback/${encodeURIComponent(record.id)}/submit`, { method: 'POST', body: { confirm: true, title: record.title, body: record.body } });
      const parsed = new URL(result.url);
      if (parsed.origin !== 'https://github.com' || !parsed.pathname.startsWith(`/${record.target}/issues/`)) throw new Error('Unexpected issue destination');
      if (mounted.current) setUrl(parsed.href);
    } catch { if (mounted.current) { setConfirm(false); setError('提交未能确认。请在目标仓库核对，当前页面不会重复提交。'); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const verify = async () => {
    if (!record || busy || editLock.current) return;
    setBusy(true); setConfirm(false);
    try {
      const current = await api<Feedback>(`/feedback/${encodeURIComponent(record.id)}`);
      if (!mounted.current) return;
      setRecord(current);
      if (current.state === 'ready') { submitLock.current = false; setSubmitAttempted(false); setError('尚未提交。请重新检查当前内容，再明确确认。'); }
      else if (current.state === 'submitted' && current.url && /^https:\/\/github\.com\/zzusp\/night-bot\/issues\/\d+$/.test(current.url)) { setUrl(current.url); setError(''); }
      else setError('提交状态仍未确认，请到目标仓库核对；不会重复提交。');
    } catch { if (mounted.current) setError('暂时无法核对提交状态，请稍后重新核对。'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="page-content feedback-page">
    <section className="feedback-disclosure" aria-label="数据收集与提交提示"><p>{feedbackPrivacyNotice}</p>
      {destination.data && <dl><dt>模型服务</dt><dd>{destination.data.model} · {destination.data.endpoint}</dd><dt>Issue 目标</dt><dd>{destination.data.target}</dd></dl>}
    </section>
    {destination.error && <Notice error={destination.error} onRetry={destination.refresh} />}
    {!destination.data && destination.loading && <Loading />}
    <section className="settings-card"><form noValidate onSubmit={event => { event.preventDefault(); void collect(); }}>
      <label htmlFor="feedback-title">标题</label><input ref={titleInput} id="feedback-title" maxLength={160} value={title} disabled={busy || !!record || requestLock.current} onChange={event => setTitle(event.target.value)} aria-describedby={error ? 'feedback-error' : undefined} />
      <label htmlFor="feedback-description">问题详情</label><textarea className="resize-none" id="feedback-description" rows={7} maxLength={6000} value={description} disabled={busy || !!record || requestLock.current} onChange={event => setDescription(event.target.value)} placeholder="发生了什么、操作步骤、期望结果" />
      {!record && <><label className="feedback-consent"><input type="checkbox" checked={consent} disabled={busy || requestLock.current} onChange={event => setConsent(event.target.checked)} />我同意上述范围的本地采集与模型分析，本次不提交 GitHub。</label><div><Button variant="primary" type="submit" busy={busy} disabled={!consent || !destination.data || requestLock.current}>开始诊断</Button></div></>}
    </form></section>
    {record && !submitAttempted && <Button disabled={busy} onClick={() => void revoke()}>撤销诊断并清除暂存</Button>}
    {collecting && <Loading>Pi 正在诊断</Loading>}
    {polling.error && <Notice error={polling.error} onRetry={polling.refresh} />}
    {record?.state === 'failed' && <Notice error={new Error()} message="本次诊断失败，未提交 GitHub。问题内容已保留。" />}
    {record && ['ready', 'editing', 'submitting', 'submitted', 'unknown'].includes(record.state) && <section className="settings-card feedback-preview" aria-label="提交内容预览"><h2>提交内容</h2><dl><dt>目标仓库</dt><dd>{record.target}</dd></dl>
      {!url && record.state === 'ready' ? <div className="feedback-preview-fields">
        <label htmlFor="feedback-issue-title">提交标题</label><input id="feedback-issue-title" maxLength={160} value={editDraft?.title ?? record.title} disabled={busy || submitAttempted} onChange={event => { setEditDraft({title: event.target.value, body: editDraft?.body ?? record.body}); setConfirm(false); }} />
        <label htmlFor="feedback-issue-body">提交正文</label><textarea className="resize-none" id="feedback-issue-body" rows={16} maxLength={48000} value={editDraft?.body ?? record.body} disabled={busy || submitAttempted} onChange={event => { setEditDraft({title: editDraft?.title ?? record.title, body: event.target.value}); setConfirm(false); }} />
        {editDraft && <div><Button disabled={busy || submitAttempted} busy={busy && editLock.current} onClick={() => void updatePreview()}>更新预览</Button></div>}
      </div> : <><h3>{record.title}</h3><pre tabIndex={0} aria-label="Issue 完整正文">{record.body}</pre></>}
      {!url && record.state === 'ready' && <><label className="feedback-consent"><input type="checkbox" checked={confirm} disabled={busy || submitAttempted || editDraft !== null} onChange={event => setConfirm(event.target.checked)} />我已检查以上完整内容，同意向 {record.target} 提交 Issue，内容可能公开可见。</label><Button variant="primary" disabled={!confirm || submitAttempted || editDraft !== null} busy={busy} onClick={() => void submit()}>确认提交 Issue</Button></>}
    </section>}
    {submitAttempted && !url && <Button disabled={busy} onClick={() => void verify()}>核对提交状态</Button>}
    {error && <p id="feedback-error" role="alert">{error}</p>}
    {url && <p role="status">已提交：<a href={url} target="_blank" rel="noopener noreferrer">查看 Issue</a></p>}
  </div>;
}
